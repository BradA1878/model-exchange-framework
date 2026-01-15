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
 * Anthropic Message Adapter
 *
 * Handles conversion between MCP format and Anthropic Claude's message format.
 * Anthropic uses a unique format with:
 * - tool_use blocks for tool calls
 * - tool_result blocks for tool responses
 * - Content arrays for mixed content types
 * - System message as separate parameter (not in messages array)
 *
 * Key Requirements (from Anthropic API docs):
 * 1. System message is passed separately, not in messages array
 * 2. tool_use blocks are part of assistant message content array
 * 3. tool_result blocks are part of user message content array
 * 4. tool_use_id links tool_result back to tool_use
 * 5. is_error flag indicates tool execution failure
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
 * Anthropic content block types
 */
interface AnthropicTextBlock {
    type: 'text';
    text: string;
}

interface AnthropicToolUseBlock {
    type: 'tool_use';
    id: string;
    name: string;
    input: Record<string, any>;
}

interface AnthropicToolResultBlock {
    type: 'tool_result';
    tool_use_id: string;
    content?: string | AnthropicContentBlock[];
    is_error?: boolean;
}

interface AnthropicImageBlock {
    type: 'image';
    source: {
        type: 'base64';
        media_type: string;
        data: string;
    };
}

type AnthropicContentBlock = AnthropicTextBlock | AnthropicToolUseBlock | AnthropicToolResultBlock | AnthropicImageBlock;

interface AnthropicMessage {
    role: 'user' | 'assistant';
    content: string | AnthropicContentBlock[];
}

/**
 * Anthropic message adapter
 * Handles Anthropic Claude's unique message format with tool_use/tool_result blocks
 */
export class AnthropicMessageAdapter implements IMessageAdapter {
    private logger: Logger;

    constructor(context: 'client' | 'server' = 'server') {
        this.logger = new Logger('debug', 'AnthropicMessageAdapter', context);
    }

    /**
     * Get the format this adapter handles
     */
    public getFormat(): MessageFormat {
        return MessageFormat.ANTHROPIC;
    }

    /**
     * Convert Anthropic messages to MCP format
     * Transforms tool_use/tool_result blocks to MCP tool_calls structure
     */
    public toMcp(messages: any[], context?: ConversionContext): ExtendedMcpMessage[] {
        const mcpMessages: ExtendedMcpMessage[] = [];

        for (const msg of messages) {
            // Handle system messages (stored in context, not in array in Anthropic format)
            if (msg.role === 'system') {
                mcpMessages.push({
                    role: 'system',
                    content: this.convertContentToMcp(msg.content),
                    timestamp: msg.timestamp || Date.now()
                });
                continue;
            }

            // Convert Anthropic message
            const mcpMessage: ExtendedMcpMessage = {
                role: this.mapRoleToMcp(msg.role),
                content: this.convertContentToMcp(msg.content),
                id: msg.id,
                timestamp: msg.timestamp || Date.now()
            };

            // Extract tool_use blocks from content and convert to tool_calls
            if (msg.role === 'assistant' && Array.isArray(msg.content)) {
                const toolUseBlocks = msg.content.filter((block: any) => block.type === 'tool_use');
                if (toolUseBlocks.length > 0) {
                    mcpMessage.tool_calls = toolUseBlocks.map((block: AnthropicToolUseBlock) => ({
                        id: block.id,
                        type: 'function',
                        function: {
                            name: block.name,
                            arguments: JSON.stringify(block.input)
                        }
                    }));
                }
            }

            // Extract tool_result blocks and convert to tool message format
            if (msg.role === 'user' && Array.isArray(msg.content)) {
                const toolResultBlocks = msg.content.filter((block: any) => block.type === 'tool_result');
                if (toolResultBlocks.length > 0) {
                    // Each tool_result becomes a separate tool message in MCP
                    for (const result of toolResultBlocks as AnthropicToolResultBlock[]) {
                        mcpMessages.push({
                            role: 'tool',
                            content: this.toolResultContentToMcp(result.content),
                            tool_call_id: result.tool_use_id,
                            timestamp: msg.timestamp || Date.now(),
                            metadata: result.is_error ? { error: true } : undefined
                        });
                    }
                    // If there are non-tool-result blocks, still add the user message
                    const nonToolBlocks = msg.content.filter((block: any) => block.type !== 'tool_result');
                    if (nonToolBlocks.length > 0) {
                        mcpMessage.content = this.convertContentToMcp(nonToolBlocks);
                        mcpMessages.push(mcpMessage);
                    }
                    continue; // Skip adding the original message since we split it
                }
            }

            mcpMessages.push(mcpMessage);
        }

        return mcpMessages;
    }

    /**
     * Convert MCP messages to Anthropic format
     * Transforms tool_calls to tool_use blocks and tool messages to tool_result blocks
     */
    public fromMcp(messages: ExtendedMcpMessage[], context?: ConversionContext): any[] {
        const anthropicMessages: AnthropicMessage[] = [];
        let i = 0;

        while (i < messages.length) {
            const msg = messages[i];

            // Skip system messages in output (Anthropic handles them separately)
            if (msg.role === 'system') {
                // System messages are passed separately in Anthropic API
                // Store in providerOptions if context is provided
                if (context) {
                    if (!context.providerOptions) {
                        context.providerOptions = {};
                    }
                    context.providerOptions.systemMessage = typeof msg.content === 'string'
                        ? msg.content
                        : this.extractTextFromContent(msg.content);
                }
                i++;
                continue;
            }

            // Handle assistant messages with tool_calls
            if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
                const contentBlocks: AnthropicContentBlock[] = [];

                // Add text content if present
                const textContent = this.extractTextFromContent(msg.content);
                if (textContent) {
                    contentBlocks.push({ type: 'text', text: textContent });
                }

                // Convert tool_calls to tool_use blocks
                for (const toolCall of msg.tool_calls) {
                    // Handle both standard OpenAI format (function.name) and direct format
                    const toolName = toolCall.function?.name || (toolCall as any).name || 'unknown';
                    const toolArgs = toolCall.function?.arguments || (toolCall as any).arguments;
                    contentBlocks.push({
                        type: 'tool_use',
                        id: toolCall.id,
                        name: toolName,
                        input: this.parseToolArguments(toolArgs)
                    });
                }

                anthropicMessages.push({
                    role: 'assistant',
                    content: contentBlocks
                });
                i++;
                continue;
            }

            // Handle tool messages - collect consecutive tool results into a user message
            if (msg.role === 'tool') {
                const toolResultBlocks: AnthropicToolResultBlock[] = [];

                // Collect all consecutive tool messages
                while (i < messages.length && messages[i].role === 'tool') {
                    const toolMsg = messages[i];
                    toolResultBlocks.push({
                        type: 'tool_result',
                        tool_use_id: toolMsg.tool_call_id || '',
                        content: this.extractTextFromContent(toolMsg.content),
                        is_error: toolMsg.metadata?.error === true
                    });
                    i++;
                }

                // Add as user message with tool_result blocks
                anthropicMessages.push({
                    role: 'user',
                    content: toolResultBlocks
                });
                continue;
            }

            // Handle regular user/assistant messages
            anthropicMessages.push({
                role: this.mapRoleFromMcp(msg.role) as 'user' | 'assistant',
                content: this.convertContentFromMcp(msg.content)
            });
            i++;
        }

        return anthropicMessages;
    }

    /**
     * Transform messages for Anthropic's requirements
     * Ensures proper message alternation and content structure
     */
    public transform(messages: any[]): any[] {
        const transformed: any[] = [];

        for (let i = 0; i < messages.length; i++) {
            const msg = messages[i];

            // Skip system messages (handled separately in Anthropic)
            if (msg.role === 'system') {
                continue;
            }

            // Ensure message alternation: user -> assistant -> user -> assistant
            const lastRole = transformed.length > 0 ? transformed[transformed.length - 1].role : null;

            // If same role consecutively (except for merging), merge content
            if (lastRole === msg.role && msg.role === 'user') {
                const lastMsg = transformed[transformed.length - 1];
                lastMsg.content = this.mergeContent(lastMsg.content, msg.content);
                continue;
            }

            // Ensure content is array for messages with tool blocks
            let content = msg.content;
            if (typeof content === 'string') {
                content = [{ type: 'text', text: content }];
            }

            transformed.push({
                ...msg,
                content
            });
        }

        return transformed;
    }

    /**
     * Validate messages meet Anthropic requirements
     */
    public validate(messages: any[]): ValidationResult {
        const errors: string[] = [];
        const warnings: string[] = [];
        const suggestions: string[] = [];

        let lastRole: string | null = null;

        for (let i = 0; i < messages.length; i++) {
            const msg = messages[i];

            // Check required fields
            if (!msg.role) {
                errors.push(`Message ${i}: Missing required field 'role'`);
            }

            // Check for valid roles
            if (msg.role && !['user', 'assistant'].includes(msg.role)) {
                if (msg.role === 'system') {
                    warnings.push(`Message ${i}: System messages should be passed separately in Anthropic API`);
                    suggestions.push('Extract system message and pass as system parameter');
                } else {
                    errors.push(`Message ${i}: Invalid role '${msg.role}' - must be 'user' or 'assistant'`);
                }
            }

            // Check content format
            if (msg.content === undefined || msg.content === null) {
                errors.push(`Message ${i}: Missing content`);
            }

            // Validate tool_use blocks in assistant messages
            if (msg.role === 'assistant' && Array.isArray(msg.content)) {
                const toolUseBlocks = msg.content.filter((b: any) => b.type === 'tool_use');
                for (const block of toolUseBlocks) {
                    if (!block.id) {
                        errors.push(`Message ${i}: tool_use block missing id`);
                    }
                    if (!block.name) {
                        errors.push(`Message ${i}: tool_use block missing name`);
                    }
                }
            }

            // Validate tool_result blocks in user messages
            if (msg.role === 'user' && Array.isArray(msg.content)) {
                const toolResultBlocks = msg.content.filter((b: any) => b.type === 'tool_result');
                for (const block of toolResultBlocks) {
                    if (!block.tool_use_id) {
                        errors.push(`Message ${i}: tool_result block missing tool_use_id`);
                    }
                }
            }

            // Check alternation (after first message)
            if (lastRole !== null && msg.role === lastRole && msg.role !== 'system') {
                warnings.push(`Message ${i}: Consecutive ${msg.role} messages - should alternate`);
                suggestions.push('Merge consecutive messages or add alternating message');
            }

            lastRole = msg.role;
        }

        // First message should be user (in Anthropic format)
        if (messages.length > 0 && messages[0].role !== 'user') {
            if (messages[0].role !== 'system') {
                warnings.push('First message should typically be from user');
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
     * Map role to MCP format
     */
    private mapRoleToMcp(role: string): 'system' | 'user' | 'assistant' | 'tool' {
        switch (role) {
            case 'assistant':
                return 'assistant';
            case 'user':
            default:
                return 'user';
        }
    }

    /**
     * Map role from MCP to Anthropic format
     */
    private mapRoleFromMcp(role: string): string {
        switch (role) {
            case 'assistant':
                return 'assistant';
            case 'tool':
                return 'user'; // Tool results are user messages in Anthropic
            case 'system':
            case 'user':
            default:
                return 'user';
        }
    }

    /**
     * Convert content to MCP format
     */
    private convertContentToMcp(content: any): any {
        if (content === null || content === undefined) {
            return { type: 'text', text: '' };
        }

        if (typeof content === 'string') {
            return { type: 'text', text: content };
        }

        if (Array.isArray(content)) {
            // Extract text from content blocks
            const textBlocks = content.filter((b: any) => b.type === 'text');
            if (textBlocks.length > 0) {
                return { type: 'text', text: textBlocks.map((b: any) => b.text).join('\n') };
            }
            return content;
        }

        return { type: 'text', text: JSON.stringify(content) };
    }

    /**
     * Convert tool result content to MCP format
     */
    private toolResultContentToMcp(content: any): any {
        if (!content) {
            return { type: 'text', text: '' };
        }

        if (typeof content === 'string') {
            return { type: 'text', text: content };
        }

        if (Array.isArray(content)) {
            const texts = content
                .filter((b: any) => b.type === 'text')
                .map((b: any) => b.text);
            return { type: 'text', text: texts.join('\n') };
        }

        return { type: 'text', text: JSON.stringify(content) };
    }

    /**
     * Convert content from MCP to Anthropic format
     */
    private convertContentFromMcp(content: any): string | AnthropicContentBlock[] {
        if (!content) {
            return '';
        }

        if (content.type === 'text' && content.text !== undefined) {
            return content.text;
        }

        if (Array.isArray(content)) {
            return content;
        }

        if (typeof content === 'object') {
            return JSON.stringify(content);
        }

        return String(content);
    }

    /**
     * Extract text from various content formats
     */
    private extractTextFromContent(content: any): string {
        if (!content) {
            return '';
        }

        if (typeof content === 'string') {
            return content;
        }

        if (content.type === 'text' && content.text !== undefined) {
            return content.text;
        }

        if (Array.isArray(content)) {
            return content
                .filter((b: any) => b.type === 'text')
                .map((b: any) => b.text || '')
                .join('\n');
        }

        return JSON.stringify(content);
    }

    /**
     * Parse tool arguments from string or object
     */
    private parseToolArguments(args: any): Record<string, any> {
        if (!args) {
            return {};
        }

        if (typeof args === 'string') {
            try {
                return JSON.parse(args);
            } catch {
                return { raw: args };
            }
        }

        return args;
    }

    /**
     * Merge content arrays or strings
     */
    private mergeContent(existing: any, newContent: any): AnthropicContentBlock[] {
        const existingBlocks = Array.isArray(existing)
            ? existing
            : [{ type: 'text' as const, text: String(existing) }];

        const newBlocks = Array.isArray(newContent)
            ? newContent
            : [{ type: 'text' as const, text: String(newContent) }];

        return [...existingBlocks, ...newBlocks];
    }
}
