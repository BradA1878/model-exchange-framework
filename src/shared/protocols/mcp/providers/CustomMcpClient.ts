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
 * Custom MCP Client
 * 
 * This module provides a base implementation for custom Model Context Protocol (MCP) clients.
 * Developers can extend this class to implement support for other LLM providers while
 * maintaining compatibility with the MXF.
 */

import { v4 as uuidv4 } from 'uuid';
import { BaseMcpClient } from './BaseMcpClient';
import { 
    McpMessage, 
    McpTool, 
    McpApiResponse, 
    McpContentType,
    McpRole
} from '../IMcpClient';

/**
 * Custom implementation of the MCP client
 * Extend this class to add support for additional LLM providers
 */
export class CustomMcpClient extends BaseMcpClient {
    /**
     * Initialize the custom provider
     * Override this method to implement custom initialization logic
     */
    protected async initializeProvider(): Promise<void> {
        // Custom initialization code goes here
        // This method must be implemented by the subclass
        // If no initialization is needed, simply return
    }

    /**
     * Send a message to the custom provider
     * Override this method to implement custom message sending logic
     * 
     * @param messages MCP messages to send
     * @param tools Optional tools to make available
     * @param options Additional options
     * @returns Promise with the provider response
     */
    protected async sendProviderMessage(
        messages: McpMessage[],
        tools?: McpTool[],
        options?: Record<string, any>
    ): Promise<McpApiResponse> {
        // This method must be implemented by the subclass
        throw new Error('sendProviderMessage must be implemented by the subclass');
    }
    
    /**
     * Helper method to create a simple text-only MCP response
     * Useful for quick implementation of custom providers
     * 
     * @param text Text response content
     * @param modelName Name of the model used
     * @returns MCP API response
     */
    protected createTextResponse(text: string, modelName: string): McpApiResponse {
        return {
            id: uuidv4(),
            type: 'completion',
            role: 'assistant',
            content: [{
                type: McpContentType.TEXT,
                text
            }],
            model: modelName,
            stop_reason: 'stop',
            stop_sequence: null,
            usage: {
                input_tokens: 0,  // These should be populated by the actual implementation
                output_tokens: 0,
                total_tokens: 0
            }
        };
    }
    
    /**
     * Helper method to extract plain text from MCP messages
     * Useful for providers that don't support rich content
     * 
     * @param messages MCP messages
     * @returns Plain text representation of the messages
     */
    protected extractPlainText(messages: McpMessage[]): string {
        return messages.map(message => {
            // Convert the role to a format suitable for plain text
            const rolePrefix = message.role === McpRole.SYSTEM 
                ? 'System: ' 
                : message.role === McpRole.USER 
                    ? 'User: ' 
                    : 'Assistant: ';
            
            // Extract text content
            let textContent = '';
            if (Array.isArray(message.content)) {
                // Handle array of content
                for (const item of message.content) {
                    if (item.type === McpContentType.TEXT) {
                        textContent += item.text + '\n';
                    } else if (item.type === McpContentType.IMAGE) {
                        textContent += '[Image]\n';
                    } else if (item.type === McpContentType.TOOL_USE) {
                        textContent += `[Tool Call: ${item.name} with args ${JSON.stringify(item.input)}]\n`;
                    } else if (item.type === McpContentType.TOOL_RESULT) {
                        const resultContent = Array.isArray(item.content) 
                            ? item.content.map(c => c.type === McpContentType.TEXT ? c.text : '[Image]').join('\n')
                            : item.content.type === McpContentType.TEXT ? item.content.text : '[Image]';
                        textContent += `[Tool Result: ${resultContent}]\n`;
                    }
                }
            } else {
                // Handle single content item
                if (message.content.type === McpContentType.TEXT) {
                    textContent = message.content.text;
                } else if (message.content.type === McpContentType.IMAGE) {
                    textContent = '[Image]';
                } else if (message.content.type === McpContentType.TOOL_USE) {
                    textContent = `[Tool Call: ${message.content.name} with args ${JSON.stringify(message.content.input)}]`;
                } else if (message.content.type === McpContentType.TOOL_RESULT) {
                    const resultContent = Array.isArray(message.content.content) 
                        ? message.content.content.map(c => c.type === McpContentType.TEXT ? c.text : '[Image]').join('\n')
                        : message.content.content.type === McpContentType.TEXT ? message.content.content.text : '[Image]';
                    textContent = `[Tool Result: ${resultContent}]`;
                }
            }
            
            return rolePrefix + textContent;
        }).join('\n\n');
    }
    
    /**
     * Helper method to extract tool definitions in a plain text format
     * Useful for providers that don't support structured tool definitions
     * 
     * @param tools MCP tools
     * @returns Plain text representation of the tools
     */
    protected extractToolsAsText(tools: McpTool[]): string {
        if (!tools || tools.length === 0) {
            return '';
        }
        
        return 'Available Tools:\n\n' + tools.map(tool => {
            let toolText = `Tool: ${tool.name}\nDescription: ${tool.description}\nParameters:`;
            
            const properties = tool.input_schema.properties || {};
            for (const [key, value] of Object.entries(properties)) {
                toolText += `\n  - ${key}: ${(value as any).description || 'No description'} (${(value as any).type || 'any'})`;
                if ((value as any).enum) {
                    toolText += ` [Options: ${(value as any).enum.join(', ')}]`;
                }
            }
            
            if (tool.input_schema.required && tool.input_schema.required.length > 0) {
                toolText += `\nRequired: ${tool.input_schema.required.join(', ')}`;
            }
            
            return toolText;
        }).join('\n\n');
    }
}
