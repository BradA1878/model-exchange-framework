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
 * OpenRouter Message Adapter
 *
 * Handles conversion between MCP format and OpenRouter's message format.
 * OpenRouter uses OpenAI-compatible format with strict tool call/result ordering.
 *
 * Key Requirements (from OpenRouter API docs):
 * 1. Tool results MUST immediately follow assistant messages with tool_calls
 * 2. Every tool_call_id MUST have a matching tool result
 * 3. No intermediate messages between tool_calls and results
 * 4. tool_call_id is REQUIRED for all tool messages
 * 5. Orphaned tool results should be preserved (not dropped)
 */

import {
    IMessageAdapter,
    MessageFormat,
    ConversionContext,
    ValidationResult,
    ExtendedMcpMessage
} from '../IFormatConverter';
import { Logger } from '../../../../utils/Logger';

/**
 * OpenRouter message adapter
 * Implements OpenAI-compatible format with OpenRouter-specific reordering
 */
export class OpenRouterMessageAdapter implements IMessageAdapter {
    private logger: Logger;

    constructor(context: 'client' | 'server' = 'server') {
        this.logger = new Logger('debug', 'OpenRouterMessageAdapter', context);
    }

    /**
     * Get the format this adapter handles
     */
    public getFormat(): MessageFormat {
        return MessageFormat.OPENROUTER;
    }

    /**
     * Convert OpenRouter messages to MCP format
     * Preserves all extended fields (tool_calls, tool_call_id)
     */
    public toMcp(messages: any[], context?: ConversionContext): ExtendedMcpMessage[] {

        return messages.map((msg, index) => {
            const mcpMessage: ExtendedMcpMessage = {
                role: this.mapRoleToMcp(msg.role),
                content: this.convertContentToMcp(msg.content),
                id: msg.id,
                timestamp: msg.timestamp || Date.now()
            };

            // CRITICAL: Preserve OpenRouter/OpenAI-specific fields
            if (msg.tool_calls) {
                mcpMessage.tool_calls = msg.tool_calls;
            }

            if (msg.tool_call_id) {
                mcpMessage.tool_call_id = msg.tool_call_id;
            }

            if (msg.name) {
                mcpMessage.name = msg.name;
            }

            if (msg.refusal) {
                mcpMessage.refusal = msg.refusal;
            }

            // Preserve any other metadata
            if (msg.metadata) {
                mcpMessage.metadata = msg.metadata;
            }

            return mcpMessage;
        });
    }

    /**
     * Convert MCP messages to OpenRouter format
     * Restores all extended fields (tool_calls, tool_call_id)
     */
    public fromMcp(messages: ExtendedMcpMessage[], context?: ConversionContext): any[] {

        const openRouterMessages = messages.map((msg, index) => {
            const openRouterMsg: any = {
                role: this.mapRoleFromMcp(msg.role),
                content: this.convertContentFromMcp(msg.content)
            };

            // CRITICAL: Restore OpenRouter-specific fields
            if (msg.tool_calls) {
                openRouterMsg.tool_calls = msg.tool_calls;
                // When tool_calls present, content should be null per OpenAI spec
                if (openRouterMsg.tool_calls.length > 0) {
                    openRouterMsg.content = null;
                }
            }

            if (msg.tool_call_id) {
                openRouterMsg.tool_call_id = msg.tool_call_id;
            }

            if (msg.name) {
                openRouterMsg.name = msg.name;
            }

            if (msg.refusal) {
                openRouterMsg.refusal = msg.refusal;
            }

            return openRouterMsg;
        });

        return openRouterMessages;
    }

    /**
     * Transform messages for OpenRouter's strict requirements
     * CRITICAL: Reorders tool results to immediately follow their tool calls
     * NOTE: Orphaned tool results (with no matching tool call) are dropped to prevent API errors
     */
    public transform(messages: any[]): any[] {

        const reordered = this.reorderMessagesForOpenRouter(messages);

        // Message count may differ if orphaned tool results were dropped - this is expected
        // and prevents Azure/OpenRouter API errors

        return reordered;
    }

    /**
     * Validate messages meet OpenRouter requirements
     */
    public validate(messages: any[]): ValidationResult {
        const errors: string[] = [];
        const warnings: string[] = [];
        const suggestions: string[] = [];

        for (let i = 0; i < messages.length; i++) {
            const msg = messages[i];

            // Check required fields
            if (!msg.role) {
                errors.push(`Message ${i}: Missing required field 'role'`);
            }

            // Validate tool call/result pairing
            if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
                const toolCallIds = new Set(msg.tool_calls.map((tc: any) => tc.id));
                let nextIndex = i + 1;

                // Check that tool results immediately follow
                while (nextIndex < messages.length && messages[nextIndex].role === 'tool') {
                    const toolMsg = messages[nextIndex];

                    if (!toolMsg.tool_call_id) {
                        errors.push(`Message ${nextIndex}: Tool message missing tool_call_id`);
                    } else if (!toolCallIds.has(toolMsg.tool_call_id)) {
                        warnings.push(`Message ${nextIndex}: tool_call_id ${toolMsg.tool_call_id} doesn't match any tool_calls from message ${i}`);
                    } else {
                        toolCallIds.delete(toolMsg.tool_call_id);
                    }

                    nextIndex++;
                }

                // Check for missing tool results
                if (toolCallIds.size > 0) {
                    errors.push(`Message ${i}: Missing tool results for IDs: ${Array.from(toolCallIds).join(', ')}`);
                    suggestions.push(`Add tool messages with tool_call_id matching: ${Array.from(toolCallIds).join(', ')}`);
                }

                // Check for intermediate messages
                if (nextIndex < i + 1 + msg.tool_calls.length) {
                    warnings.push(`Message ${i}: Non-tool messages found between tool_calls and results`);
                    suggestions.push('Tool results should immediately follow tool_calls with no intermediate messages');
                }
            }

            // Check orphaned tool messages
            if (msg.role === 'tool' && !msg.tool_call_id) {
                warnings.push(`Message ${i}: Tool message without tool_call_id (orphaned)`);
                suggestions.push('Add tool_call_id or remove tool message');
            }
        }

        return {
            valid: errors.length === 0,
            errors,
            warnings,
            suggestions: suggestions.length > 0 ? suggestions : undefined
        };
    }

    /**
     * Reorder messages for OpenRouter's strict tool call/result requirements
     *
     * CRITICAL: This function must NOT drop messages. All messages must be preserved.
     *
     * OpenRouter requires:
     * 1. Assistant message with tool_calls
     * 2. Tool result message(s) immediately after (NO intermediate messages)
     * 3. Continue conversation
     *
     * Previous Bug: Orphaned tool results (without tool_call_id) were dropped
     * Fix: Preserve orphaned results by appending them at the end
     */
    private reorderMessagesForOpenRouter(messages: any[]): any[] {
        const reorderedMessages: any[] = [];
        const toolResultsMap = new Map<string, any[]>();
        const orphanedToolResults: any[] = [];  // NEW: Track unmatched tool results

        // Pass 1: Collect tool results by their tool_call_id
        for (const message of messages) {
            if (message.role === 'tool') {
                const toolCallId = message.tool_call_id;

                if (toolCallId) {
                    // Tool result with valid tool_call_id
                    if (!toolResultsMap.has(toolCallId)) {
                        toolResultsMap.set(toolCallId, []);
                    }
                    toolResultsMap.get(toolCallId)!.push(message);
                } else {
                    // Preserve orphaned tool results (no tool_call_id)
                    // These might be from previous conversation turns or malformed responses
                    orphanedToolResults.push(message);
                }
            }
        }

        // Pass 2: Build reordered message list
        for (const message of messages) {
            // Skip tool results in this pass (we'll add them after their tool calls)
            if (message.role === 'tool') {
                continue;
            }

            // Add the non-tool message
            reorderedMessages.push(message);

            // If this is an assistant message with tool calls, add corresponding tool results immediately after
            if (message.role === 'assistant' && message.tool_calls && message.tool_calls.length > 0) {
                for (const toolCall of message.tool_calls) {
                    const toolCallId = toolCall.id;
                    const toolResults = toolResultsMap.get(toolCallId);

                    if (toolResults) {
                        // Add all tool results for this tool_call_id
                        reorderedMessages.push(...toolResults);
                        // Remove from map so we don't add them twice
                        toolResultsMap.delete(toolCallId);
                    } else {
                        // Missing tool result - this is a validation error but don't crash
                        this.logger.warn(`⚠️ Assistant message has tool_call ${toolCallId} but no matching tool result`);
                    }
                }
            }
        }

        // Pass 3: DROP any remaining tool results that didn't match a tool call
        // These cause API errors with Azure/OpenRouter because they expect tool results
        // to have a matching tool call in the conversation history.
        // This can happen when:
        // - Conversation history was cleared between turns
        // - Tool results from aborted/error tool calls
        // - Race conditions during history updates
        const droppedCount = toolResultsMap.size;
        if (droppedCount > 0) {
            const droppedIds = Array.from(toolResultsMap.keys()).join(', ');
            this.logger.debug(`Dropping ${droppedCount} orphaned tool result(s) with no matching tool call: ${droppedIds}`);
            this.logger.debug(`   This is expected after clearing conversation history between turns.`);
        }

        // Pass 4: DROP orphaned tool results (no tool_call_id at all)
        // Same reasoning - these cause API errors
        if (orphanedToolResults.length > 0) {
            this.logger.debug(`Dropping ${orphanedToolResults.length} orphaned tool results (no tool_call_id)`);
        }

        // Note: Message count will differ if we dropped orphaned results - this is intentional
        const expectedDropped = droppedCount + orphanedToolResults.length;
        const actualDropped = messages.length - reorderedMessages.length;
        if (actualDropped !== expectedDropped) {
            this.logger.error(`❌ CRITICAL: Unexpected message loss! Expected to drop ${expectedDropped}, actually dropped ${actualDropped}`);
        }

        return reorderedMessages;
    }

    /**
     * Map role to MCP format
     */
    private mapRoleToMcp(role: string): 'system' | 'user' | 'assistant' | 'tool' {
        switch (role) {
            case 'system':
                return 'system';
            case 'assistant':
                return 'assistant';
            case 'tool':
            case 'function':  // Legacy OpenAI format
                return 'tool';
            case 'user':
            default:
                return 'user';
        }
    }

    /**
     * Map role from MCP to OpenRouter format
     */
    private mapRoleFromMcp(role: string): string {
        // OpenRouter uses standard OpenAI roles
        return role;  // Direct mapping (system, user, assistant, tool)
    }

    /**
     * Convert content to MCP format
     */
    private convertContentToMcp(content: any): any {
        // OpenRouter content can be:
        // - string (most common)
        // - array of content blocks (multimodal)
        // - null (when tool_calls present)

        if (content === null || content === undefined) {
            return { type: 'text', text: '' };
        }

        if (typeof content === 'string') {
            return { type: 'text', text: content };
        }

        if (Array.isArray(content)) {
            // Multimodal content - keep as-is for now
            // MCP can handle array content
            return content;
        }

        // Fallback: stringify
        return { type: 'text', text: JSON.stringify(content) };
    }

    /**
     * Convert content from MCP to OpenRouter format
     */
    private convertContentFromMcp(content: any): string | any[] | null {
        if (!content) {
            return null;
        }

        // MCP content structure
        if (content.type === 'text' && content.text !== undefined) {
            return content.text;
        }

        // Array content (multimodal)
        if (Array.isArray(content)) {
            return content;
        }

        // Fallback: stringify
        if (typeof content === 'object') {
            return JSON.stringify(content);
        }

        return String(content);
    }
}
