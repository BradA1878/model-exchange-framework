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
 * Tool Help Tools
 * 
 * MCP tools that help agents learn how to use other tools correctly.
 * These meta-tools provide documentation, examples, and validation assistance.
 */

import { META_TOOLS } from '../../../constants/ToolNames';
import { McpToolDocumentationService } from '../../../services/McpToolDocumentationService';
import { parseToolCalls, validateParsedToolCall } from '../McpToolCallParser';
import { Logger } from '../../../utils/Logger';

const logger = new Logger('info', 'ToolHelpTools', 'server');

/**
 * Get detailed help and examples for a specific tool
 */
export const toolHelpTool = {
    name: 'tool_help',
    description: 'Get detailed documentation, schema, and examples for how to use a specific tool',
    enabled: true,
    inputSchema: {
        type: 'object',
        properties: {
            toolName: {
                type: 'string',
                description: 'Name of the tool to get help for',
                minLength: 1
            }
        },
        required: ['toolName'],
        additionalProperties: false
    },
    examples: [
        {
            input: { toolName: 'filesystem_read' },
            description: 'Get help for the filesystem_read tool'
        }
    ],
    metadata: {
        category: 'meta',
        timeout: 5000
    },
    
    async handler(input: { toolName: string }, context: any): Promise<any> {
        try {
            const docService = McpToolDocumentationService.getInstance();
            const help = docService.getToolHelp(input.toolName);
            
            return {
                toolName: input.toolName,
                documentation: help,
                timestamp: Date.now()
            };
        } catch (error) {
            logger.error(`Failed to get tool help: ${error}`);
            throw error;
        }
    }
};

/**
 * Get a quick reference of all available tools
 */
export const toolQuickReferenceTool = {
    name: 'tool_quick_reference',
    description: 'Get a quick reference guide showing all available tools and their basic usage',
    enabled: true,
    inputSchema: {
        type: 'object',
        properties: {
            category: {
                type: 'string',
                description: 'Optional category filter',
                enum: ['communication', 'controlLoop', 'infrastructure', 'contextMemory', 'meta', 'web', 'git', 'typescript', 'coordination']
            }
        },
        additionalProperties: false
    },
    examples: [
        {
            input: {},
            description: 'Get quick reference for all tools'
        },
        {
            input: { category: 'infrastructure' },
            description: 'Get quick reference for infrastructure tools only'
        }
    ],
    metadata: {
        category: 'meta',
        timeout: 5000
    },
    
    async handler(input: { category?: string }, context: any): Promise<any> {
        try {
            const docService = McpToolDocumentationService.getInstance();
            const reference = docService.getQuickReference();
            
            // Filter by category if requested
            if (input.category) {
                const lines = reference.split('\n');
                const filtered: string[] = [];
                let inCategory = false;
                let categoryFound = false;
                
                for (const line of lines) {
                    if (line.startsWith('### ')) {
                        inCategory = line.toLowerCase().includes(input.category.toLowerCase());
                        if (inCategory) categoryFound = true;
                    }
                    
                    if (inCategory || !categoryFound) {
                        filtered.push(line);
                    }
                }
                
                return {
                    reference: filtered.join('\n'),
                    category: input.category,
                    timestamp: Date.now()
                };
            }
            
            return {
                reference,
                timestamp: Date.now()
            };
        } catch (error) {
            logger.error(`Failed to get tool quick reference: ${error}`);
            throw error;
        }
    }
};

/**
 * Validate a tool call before executing it
 */
export const toolValidateTool = {
    name: 'tool_validate',
    description: 'Validate a tool call format and parameters before execution',
    enabled: true,
    inputSchema: {
        type: 'object',
        properties: {
            content: {
                type: 'string',
                description: 'The tool call content to validate',
                minLength: 1
            }
        },
        required: ['content'],
        additionalProperties: false
    },
    examples: [
        {
            input: { content: '<tool>filesystem_read</tool><parameters>{"path": "/tmp/test.txt"}</parameters>' },
            description: 'Validate an XML-formatted tool call'
        },
        {
            input: { content: 'filesystem_write({"path": "/tmp/out.txt", "content": "Hello"})' },
            description: 'Validate a function-style tool call'
        }
    ],
    metadata: {
        category: 'meta',
        timeout: 5000
    },
    
    async handler(input: { content: string }, context: any): Promise<any> {
        try {
            const parseResult = parseToolCalls(input.content);
            
            if (!parseResult.success) {
                return {
                    valid: false,
                    errors: parseResult.errors,
                    suggestions: parseResult.suggestions,
                    timestamp: Date.now()
                };
            }
            
            // Validate each parsed call
            const validationResults = [];
            const docService = McpToolDocumentationService.getInstance();
            
            for (const call of parseResult.calls!) {
                // Get all known tools
                const knownTools = new Set(Array.from(docService['toolCache'].keys()));
                
                const validation = validateParsedToolCall(call, knownTools);
                
                if (!validation.valid) {
                    validationResults.push({
                        tool: call.tool,
                        valid: false,
                        error: validation.error,
                        suggestion: validation.suggestion
                    });
                } else {
                    // Further validate parameters against schema
                    // This would need access to the actual tool schemas
                    validationResults.push({
                        tool: call.tool,
                        valid: true,
                        format: call.format,
                        parameters: call.parameters
                    });
                }
            }
            
            return {
                valid: validationResults.every(r => r.valid),
                calls: validationResults,
                timestamp: Date.now()
            };
        } catch (error) {
            logger.error(`Failed to validate tool call: ${error}`);
            throw error;
        }
    }
};

/**
 * Get validation tips for better tool calling
 */
export const toolValidationTipsTool = {
    name: 'tool_validation_tips',
    description: 'Get tips and best practices for making successful tool calls',
    enabled: true,
    inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false
    },
    examples: [
        {
            input: {},
            description: 'Get general validation tips'
        }
    ],
    metadata: {
        category: 'meta',
        timeout: 5000
    },
    
    async handler(input: {}, context: any): Promise<any> {
        try {
            const docService = McpToolDocumentationService.getInstance();
            const tips = docService.getValidationTips();
            
            return {
                tips,
                formats: [
                    'XML: <tool>tool_name</tool><parameters>{...}</parameters>',
                    'Function: tool_name({...})',
                    'Structured: TOOL: tool_name PARAMETERS: {...}'
                ],
                timestamp: Date.now()
            };
        } catch (error) {
            logger.error(`Failed to get validation tips: ${error}`);
            throw error;
        }
    }
};

// Export all tool help tools
export const toolHelpTools = [
    toolHelpTool,
    toolQuickReferenceTool,
    toolValidateTool,
    toolValidationTipsTool
];