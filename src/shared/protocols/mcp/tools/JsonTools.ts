/**
 * Copyright 2024 Brad Anderson
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * @author Brad Anderson <BradA1878@pm.me>
 * @repository https://github.com/BradA1878/model-exchange-framework
 * @documentation https://brada1878.github.io/model-exchange-framework/
 */

/**
 * JsonTools.ts
 *
 * MCP tools for JSON manipulation with validation and atomic operations.
 * Provides safe, convenient methods for working with JSON files.
 */

import { AgentId, ChannelId } from '../../../types/ChannelContext';
import { Logger } from '../../../utils/Logger';
import { createStrictValidator } from '../../../utils/validation';
import { JSON_TOOLS } from '../../../constants/ToolNames';
import fs from 'fs/promises';
import path from 'path';

const logger = new Logger('info', 'JsonTools', 'server');
const validator = createStrictValidator('JsonTools');

/**
 * MCP Tool: json_append
 * Append an entry to a JSON file (array or object with array property)
 */
export const jsonAppendTool = {
    name: JSON_TOOLS.JSON_APPEND,
    description: 'Append an entry to a JSON file containing an array or object with an array property. Atomic operation with backup support.',
    inputSchema: {
        type: 'object',
        properties: {
            path: {
                type: 'string',
                description: 'Path to JSON file',
                minLength: 1
            },
            entry: {
                type: 'object',
                description: 'Entry to append to the array'
            },
            arrayPath: {
                type: 'string',
                description: 'Path to array within JSON object (e.g., "entries"). Leave empty if root is array.',
                default: ''
            },
            createIfMissing: {
                type: 'boolean',
                description: 'Create file with empty structure if it doesn\'t exist',
                default: true
            },
            updateMetadata: {
                type: 'object',
                description: 'Metadata fields to update (e.g., lastUpdated, totalStorms)',
                properties: {
                    lastUpdatedField: {
                        type: 'string',
                        description: 'Field name for last updated timestamp',
                        default: 'lastUpdated'
                    },
                    countField: {
                        type: 'string',
                        description: 'Field name for total count',
                        default: 'totalStorms'
                    }
                }
            }
        },
        required: ['path', 'entry'],
        additionalProperties: false
    },
    examples: [
        {
            input: {
                path: '/logs/events.json',
                entry: { id: '123', message: 'Event occurred' },
                arrayPath: 'events',
                updateMetadata: {
                    lastUpdatedField: 'lastUpdated',
                    countField: 'totalEvents'
                }
            },
            description: 'Append event to events array in JSON object with metadata update'
        },
        {
            input: {
                path: '/data/items.json',
                entry: { name: 'Item 1', value: 100 }
            },
            description: 'Append to root-level array (simple case)'
        }
    ],

    async handler(input: {
        path: string;
        entry: any;
        arrayPath?: string;
        createIfMissing?: boolean;
        updateMetadata?: {
            lastUpdatedField?: string;
            countField?: string;
        };
    }, context: {
        agentId: AgentId;
        channelId: ChannelId;
        requestId: string;
    }): Promise<{
        summary: string;        // LLM-friendly summary (shown first)
        success: true;
        path: string;
        entriesCount: number;
        entryAdded: any;
        updatedAt: string;
    }> {
        try {
            validator.assertIsString(input.path, 'path');

            if (input.entry === undefined || input.entry === null) {
                throw new Error('entry must be provided');
            }

            const filePath = path.resolve(input.path);

            let jsonData: any;

            // Read existing file or create new structure
            try {
                const fileContent = await fs.readFile(filePath, 'utf-8');
                jsonData = JSON.parse(fileContent);
            } catch (error: any) {
                if (error.code === 'ENOENT' && input.createIfMissing) {
                    // Create new structure
                    if (input.arrayPath) {
                        jsonData = { [input.arrayPath]: [] };
                    } else {
                        jsonData = [];
                    }
                } else {
                    throw new Error(`Failed to read JSON file: ${error.message}`);
                }
            }

            // Navigate to the array
            let targetArray: any[];
            if (input.arrayPath) {
                // Navigate to nested array
                const pathParts = input.arrayPath.split('.');
                let current = jsonData;

                for (let i = 0; i < pathParts.length - 1; i++) {
                    if (!current[pathParts[i]]) {
                        current[pathParts[i]] = {};
                    }
                    current = current[pathParts[i]];
                }

                const lastPart = pathParts[pathParts.length - 1];
                if (!current[lastPart]) {
                    current[lastPart] = [];
                }

                targetArray = current[lastPart];

                if (!Array.isArray(targetArray)) {
                    throw new Error(`Property "${input.arrayPath}" is not an array`);
                }
            } else {
                // Root is the array
                if (!Array.isArray(jsonData)) {
                    throw new Error('JSON root must be an array when arrayPath is not specified');
                }
                targetArray = jsonData;
            }

            // Append the entry
            targetArray.push(input.entry);

            // Update metadata if requested
            if (input.updateMetadata && input.arrayPath) {
                const lastUpdatedField = input.updateMetadata.lastUpdatedField || 'lastUpdated';
                const countField = input.updateMetadata.countField || 'totalStorms';

                jsonData[lastUpdatedField] = new Date().toISOString();
                jsonData[countField] = targetArray.length;
            }

            // Write back to file atomically (write to temp, then rename)
            const tempPath = `${filePath}.tmp.${Date.now()}`;
            const jsonString = JSON.stringify(jsonData, null, 2);

            await fs.writeFile(tempPath, jsonString, 'utf-8');
            await fs.rename(tempPath, filePath);


            // Build LLM-friendly summary
            const fileName = filePath.split('/').pop() || filePath;

            // Extract identifier from entry
            const entryId = input.entry?.id || input.entry?.stormId || input.entry?.name || 'entry';

            let summary = `✓ Successfully appended to ${fileName}\n\n`;
            summary += `📝 Entry: ${entryId}\n`;
            summary += `📊 Total entries: ${targetArray.length}\n`;

            // Add key field highlights if available
            if (typeof input.entry === 'object' && input.entry !== null) {
                const keyFields = ['severity', 'status', 'type', 'priority', 'level'];
                const highlights = keyFields.filter(f => f in input.entry);
                if (highlights.length > 0) {
                    summary += `\n🔑 Key fields:\n`;
                    highlights.forEach(field => {
                        summary += `   ${field}: ${input.entry[field]}\n`;
                    });
                }
            }

            summary += `\n✅ Operation complete. No need to re-read file unless verification needed.`;

            return {
                summary: summary,
                success: true,
                path: filePath,
                entriesCount: targetArray.length,
                entryAdded: input.entry,
                updatedAt: new Date().toISOString()
            };

        } catch (error) {
            logger.error(`Failed to append to JSON file: ${error}`);
            throw new Error(`Failed to append to JSON file: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
};

/**
 * MCP Tool: json_read
 * Read and parse a JSON file with validation
 */
export const jsonReadTool = {
    name: JSON_TOOLS.JSON_READ,
    description: 'Read and parse a JSON file with optional JSON path filtering',
    inputSchema: {
        type: 'object',
        properties: {
            path: {
                type: 'string',
                description: 'Path to JSON file',
                minLength: 1
            },
            jsonPath: {
                type: 'string',
                description: 'Optional JSON path to extract (e.g., "entries[0]", "metadata.count")'
            },
            validate: {
                type: 'boolean',
                description: 'Validate JSON structure',
                default: true
            }
        },
        required: ['path'],
        additionalProperties: false
    },
    examples: [
        {
            input: { path: '/data/config.json' },
            description: 'Read entire JSON file'
        },
        {
            input: { path: '/logs/storms.json', jsonPath: 'entries' },
            description: 'Read only the entries array'
        }
    ],

    async handler(input: {
        path: string;
        jsonPath?: string;
        validate?: boolean;
    }, context: {
        agentId: AgentId;
        channelId: ChannelId;
        requestId: string;
    }): Promise<{
        summary: string;        // LLM-friendly summary (shown first)
        success: true;
        path: string;
        content: any;           // Actual JSON content
        size: number;
        readAt: string;
    }> {
        try {
            validator.assertIsString(input.path, 'path');

            const filePath = path.resolve(input.path);

            const fileContent = await fs.readFile(filePath, 'utf-8');
            let jsonData = JSON.parse(fileContent);

            // Extract nested path if specified
            if (input.jsonPath) {
                const pathParts = input.jsonPath.split('.');
                for (const part of pathParts) {
                    // Handle array access like "entries[0]"
                    const arrayMatch = part.match(/^(\w+)\[(\d+)\]$/);
                    if (arrayMatch) {
                        const [, key, index] = arrayMatch;
                        jsonData = jsonData[key][parseInt(index, 10)];
                    } else {
                        jsonData = jsonData[part];
                    }

                    if (jsonData === undefined) {
                        throw new Error(`Path "${input.jsonPath}" not found in JSON`);
                    }
                }
            }

            // Build LLM-friendly summary
            const fileName = filePath.split('/').pop() || filePath;
            const sizeKB = (fileContent.length / 1024).toFixed(2);

            let summary = `✓ Successfully read ${fileName} (${sizeKB} KB)\n\n`;

            // Add content-specific details
            if (Array.isArray(jsonData)) {
                summary += `📊 Array with ${jsonData.length} items\n`;
                if (jsonData.length > 0 && typeof jsonData[0] === 'object') {
                    const sampleKeys = Object.keys(jsonData[0]).slice(0, 5);
                    summary += `   Sample keys: ${sampleKeys.join(', ')}\n`;
                }
            } else if (typeof jsonData === 'object' && jsonData !== null) {
                const keys = Object.keys(jsonData);
                summary += `📊 Object with ${keys.length} properties\n`;
                if ('lastUpdated' in jsonData) summary += `   Last updated: ${jsonData.lastUpdated}\n`;
                if ('total' in jsonData || 'count' in jsonData) {
                    summary += `   Total count: ${jsonData.total || jsonData.count}\n`;
                }
            }

            summary += `\n📦 Full data is included below (not truncated in tool result).\n\n`;
            summary += `---JSON CONTENT---\n${JSON.stringify(jsonData, null, 2)}`;

            return {
                success: true,
                path: filePath,
                content: jsonData,  // Changed from 'data' to 'content'
                size: fileContent.length,
                readAt: new Date().toISOString(),
                summary: summary  // Add summary field
            };

        } catch (error) {
            logger.error(`Failed to read JSON file: ${error}`);
            throw new Error(`Failed to read JSON file: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
};

export const JsonTools = {
    jsonAppend: jsonAppendTool,
    jsonRead: jsonReadTool
};
