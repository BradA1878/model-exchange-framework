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
 * MCP Tool Call Parser
 * 
 * Provides structured parsing for tool calls from various LLM providers.
 * Handles different formats and provides clear error messages for malformed calls.
 */

import { Logger } from '../../utils/Logger';
import { createStrictValidator } from '../../utils/validation';

const logger = new Logger('info', 'McpToolCallParser', 'server');
const validator = createStrictValidator('McpToolCallParser');

/**
 * Structured tool call format
 */
export interface ParsedToolCall {
    tool: string;
    parameters: Record<string, any>;
    format?: 'json' | 'xml' | 'function' | 'structured';
    raw?: string;
}

/**
 * Tool call parsing result
 */
export interface ToolCallParseResult {
    success: boolean;
    calls?: ParsedToolCall[];
    errors?: string[];
    suggestions?: string[];
}

/**
 * Known tool call formats from various providers
 */
const TOOL_CALL_PATTERNS = {
    // Anthropic-style XML format
    xml: {
        pattern: /<tool>(.*?)<\/tool>.*?<parameters>(.*?)<\/parameters>/gs,
        parser: (match: RegExpExecArray): ParsedToolCall => {
            const toolName = match[1].trim();
            let parameters: Record<string, any> = {};
            
            try {
                // Try to parse as JSON first
                parameters = JSON.parse(match[2]);
            } catch {
                // If not JSON, try to parse as key-value pairs
                const paramString = match[2].trim();
                if (paramString) {
                    // Simple key="value" parser
                    const kvPattern = /(\w+)="([^"]+)"/g;
                    let kvMatch;
                    while ((kvMatch = kvPattern.exec(paramString)) !== null) {
                        parameters[kvMatch[1]] = kvMatch[2];
                    }
                }
            }
            
            return {
                tool: toolName,
                parameters,
                format: 'xml',
                raw: match[0]
            };
        }
    },
    
    // JSON-RPC style
    jsonRpc: {
        pattern: /\{"method":\s*"([^"]+)",\s*"params":\s*(\{[^}]+\})\}/g,
        parser: (match: RegExpExecArray): ParsedToolCall => {
            return {
                tool: match[1],
                parameters: JSON.parse(match[2]),
                format: 'json',
                raw: match[0]
            };
        }
    },
    
    // Function call style
    functionCall: {
        pattern: /(\w+)\s*\((\{[^}]+\})\)/g,
        parser: (match: RegExpExecArray): ParsedToolCall => {
            return {
                tool: match[1],
                parameters: JSON.parse(match[2]),
                format: 'function',
                raw: match[0]
            };
        }
    },
    
    // OpenAI function calling format
    openAiFunction: {
        pattern: /\{"name":\s*"([^"]+)",\s*"arguments":\s*"([^"]+)"\}/g,
        parser: (match: RegExpExecArray): ParsedToolCall => {
            // OpenAI escapes the JSON in arguments
            const unescapedArgs = match[2].replace(/\\"/g, '"');
            return {
                tool: match[1],
                parameters: JSON.parse(unescapedArgs),
                format: 'structured',
                raw: match[0]
            };
        }
    },
    
    // Structured format with clear markers
    structured: {
        pattern: /TOOL:\s*(\w+)\s*PARAMETERS:\s*(\{[^}]+\})/g,
        parser: (match: RegExpExecArray): ParsedToolCall => {
            return {
                tool: match[1],
                parameters: JSON.parse(match[2]),
                format: 'structured',
                raw: match[0]
            };
        }
    }
};

/**
 * Parse tool calls from content
 * @param content - Content potentially containing tool calls
 * @returns Parsed tool calls with success status
 */
export function parseToolCalls(content: string): ToolCallParseResult {
    const calls: ParsedToolCall[] = [];
    const errors: string[] = [];
    const suggestions: string[] = [];
    
    if (!content || typeof content !== 'string') {
        return {
            success: false,
            errors: ['Content must be a non-empty string']
        };
    }
    
    // Try each pattern
    let foundAny = false;
    
    for (const [formatName, format] of Object.entries(TOOL_CALL_PATTERNS)) {
        const pattern = new RegExp(format.pattern);
        let match;
        
        while ((match = pattern.exec(content)) !== null) {
            foundAny = true;
            try {
                const parsed = format.parser(match);
                calls.push(parsed);
            } catch (error) {
                const errorMsg = `Failed to parse ${formatName} tool call: ${error instanceof Error ? error.message : String(error)}`;
                errors.push(errorMsg);
                logger.error(errorMsg);
            }
        }
    }
    
    // If no structured format found, try to detect and suggest corrections
    if (!foundAny) {
        // Look for potential tool names
        const toolNamePattern = /\b(filesystem_read|filesystem_write|memory_store|shell_exec|messaging_send|agent_discover)\b/gi;
        const potentialTools = content.match(toolNamePattern);
        
        if (potentialTools && potentialTools.length > 0) {
            suggestions.push(
                'Detected potential tool names but no valid format. Use one of these formats:',
                '1. XML: <tool>tool_name</tool><parameters>{"key": "value"}</parameters>',
                '2. Function: tool_name({"key": "value"})',
                '3. Structured: TOOL: tool_name PARAMETERS: {"key": "value"}'
            );
            
            // Try to extract JSON-like content
            const jsonPattern = /\{[^{}]*\}/g;
            const jsonMatches = content.match(jsonPattern);
            if (jsonMatches) {
                suggestions.push(`Found potential parameters: ${jsonMatches[0]}`);
            }
        }
    }
    
    return {
        success: calls.length > 0,
        calls: calls.length > 0 ? calls : undefined,
        errors: errors.length > 0 ? errors : undefined,
        suggestions: suggestions.length > 0 ? suggestions : undefined
    };
}

/**
 * Format tool call for display
 * @param call - Parsed tool call
 * @returns Formatted string representation
 */
export function formatToolCall(call: ParsedToolCall): string {
    return `${call.tool}(${JSON.stringify(call.parameters, null, 2)})`;
}

/**
 * Validate parsed tool call against known tools
 * @param call - Parsed tool call
 * @param knownTools - Set of known tool names
 * @returns Validation result with suggestions
 */
export function validateParsedToolCall(
    call: ParsedToolCall,
    knownTools: Set<string>
): { valid: boolean; error?: string; suggestion?: string } {
    if (!knownTools.has(call.tool)) {
        // Find similar tool names
        const similar = Array.from(knownTools).filter(tool => 
            tool.toLowerCase().includes(call.tool.toLowerCase()) ||
            call.tool.toLowerCase().includes(tool.toLowerCase())
        );
        
        return {
            valid: false,
            error: `Unknown tool: ${call.tool}`,
            suggestion: similar.length > 0 
                ? `Did you mean: ${similar.join(', ')}?`
                : `Available tools: ${Array.from(knownTools).slice(0, 5).join(', ')}...`
        };
    }
    
    return { valid: true };
}

/**
 * Generate tool call examples for a given tool
 * @param toolName - Name of the tool
 * @param schema - Tool input schema
 * @returns Array of example formats
 */
export function generateToolCallExamples(
    toolName: string,
    schema: Record<string, any>
): string[] {
    // Create a simple example based on schema
    const exampleParams: Record<string, any> = {};
    
    if (schema.properties) {
        for (const [key, prop] of Object.entries(schema.properties as Record<string, any>)) {
            if (schema.required?.includes(key)) {
                // Generate example value based on type
                switch (prop.type) {
                    case 'string':
                        exampleParams[key] = prop.example || prop.default || 'example_value';
                        break;
                    case 'number':
                    case 'integer':
                        exampleParams[key] = prop.example || prop.default || 0;
                        break;
                    case 'boolean':
                        exampleParams[key] = prop.example || prop.default || false;
                        break;
                    case 'array':
                        exampleParams[key] = prop.example || [];
                        break;
                    case 'object':
                        exampleParams[key] = prop.example || {};
                        break;
                }
            }
        }
    }
    
    const jsonParams = JSON.stringify(exampleParams, null, 2);
    
    return [
        `XML Format:\n<tool>${toolName}</tool>\n<parameters>\n${jsonParams}\n</parameters>`,
        `Function Format:\n${toolName}(${JSON.stringify(exampleParams)})`,
        `Structured Format:\nTOOL: ${toolName}\nPARAMETERS: ${JSON.stringify(exampleParams)}`
    ];
}