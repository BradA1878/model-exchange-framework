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
 * Unified Message Converter
 *
 * Central orchestrator for message format conversions across LLM providers.
 * Uses adapter pattern to delegate provider-specific logic while maintaining
 * a consistent interface.
 */

import {
    IMessageConverter,
    IMessageAdapter,
    MessageFormat,
    ConversionContext,
    ValidationResult,
    ConversionError,
    ExtendedMcpMessage
} from './IFormatConverter';
import { Logger } from '../../../utils/Logger';

/**
 * Unified message converter with pluggable adapters
 */
export class UnifiedMessageConverter implements IMessageConverter {
    private adapters: Map<MessageFormat, IMessageAdapter> = new Map();
    private logger: Logger;
    private context: 'client' | 'server';

    constructor(context: 'client' | 'server' = 'server') {
        this.context = context;
        this.logger = new Logger('debug', 'UnifiedMessageConverter', context);
    }

    /**
     * Register a format adapter
     */
    public registerAdapter(adapter: IMessageAdapter): void {
        const format = adapter.getFormat();
        if (this.adapters.has(format)) {
            //this.logger.warn(`Overwriting existing adapter for format: ${format}`);
        }
        this.adapters.set(format, adapter);
    }

    /**
     * Get adapter for format (with lazy loading)
     */
    private getAdapter(format: MessageFormat): IMessageAdapter {
        let adapter = this.adapters.get(format);

        if (!adapter) {
            // Lazy load adapter
            adapter = this.loadAdapter(format);
            if (adapter) {
                this.adapters.set(format, adapter);
            } else {
                throw new ConversionError(
                    `No adapter available for format: ${format}`,
                    format,
                    format
                );
            }
        }

        return adapter;
    }

    /**
     * Lazy load adapter for format
     */
    private loadAdapter(format: MessageFormat): IMessageAdapter | undefined {
        try {
            switch (format) {
                case MessageFormat.OPENROUTER:
                    const { OpenRouterMessageAdapter } = require('./adapters/OpenRouterMessageAdapter');
                    return new OpenRouterMessageAdapter(this.context);

                case MessageFormat.OPENAI:
                    const { OpenAiMessageAdapter } = require('./adapters/OpenAiMessageAdapter');
                    return new OpenAiMessageAdapter(this.context);

                case MessageFormat.ANTHROPIC:
                    const { AnthropicMessageAdapter } = require('./adapters/AnthropicMessageAdapter');
                    return new AnthropicMessageAdapter(this.context);

                case MessageFormat.GEMINI:
                    const { GeminiMessageAdapter } = require('./adapters/GeminiMessageAdapter');
                    return new GeminiMessageAdapter(this.context);

                case MessageFormat.XAI:
                    const { XaiMessageAdapter } = require('./adapters/XaiMessageAdapter');
                    return new XaiMessageAdapter(this.context);

                case MessageFormat.BEDROCK:
                    const { BedrockMessageAdapter } = require('./adapters/BedrockMessageAdapter');
                    return new BedrockMessageAdapter(this.context);

                case MessageFormat.MCP:
                    // MCP is the canonical format - no adapter needed
                    return undefined;

                default:
                    this.logger.error(`Unknown message format: ${format}`);
                    return undefined;
            }
        } catch (error) {
            this.logger.error(`Failed to load adapter for ${format}: ${error}`);
            return undefined;
        }
    }

    /**
     * Convert messages between formats
     */
    public convert(
        messages: any[],
        fromFormat: MessageFormat,
        toFormat: MessageFormat,
        context?: ConversionContext
    ): any[] {
        // Short-circuit if same format
        if (fromFormat === toFormat) {
            return messages;
        }


        // Get adapters
        const fromAdapter = fromFormat === MessageFormat.MCP ? null : this.getAdapter(fromFormat);
        const toAdapter = toFormat === MessageFormat.MCP ? null : this.getAdapter(toFormat);

        let result: any[];

        if (fromFormat === MessageFormat.MCP) {
            // MCP → Provider: Direct conversion
            if (!toAdapter) {
                throw new ConversionError('Target format adapter not found', fromFormat, toFormat);
            }
            result = toAdapter.fromMcp(messages as ExtendedMcpMessage[], context);

        } else if (toFormat === MessageFormat.MCP) {
            // Provider → MCP: Direct conversion
            if (!fromAdapter) {
                throw new ConversionError('Source format adapter not found', fromFormat, toFormat);
            }
            result = fromAdapter.toMcp(messages, context);

        } else {
            // Provider A → Provider B: Two-step conversion through MCP
            if (!fromAdapter || !toAdapter) {
                throw new ConversionError('Adapter not found for conversion', fromFormat, toFormat);
            }

            // Convert to canonical MCP format first
            const mcpMessages = fromAdapter.toMcp(messages, context);

            // Convert to target format
            result = toAdapter.fromMcp(mcpMessages, context);
        }


        // Warn if message count changed
        if (result.length !== messages.length) {
            this.logger.warn(`⚠️ Message count changed during conversion: ${messages.length} → ${result.length}`);
        }

        return result;
    }

    /**
     * Validate messages for format
     */
    public validate(messages: any[], format: MessageFormat): ValidationResult {
        if (format === MessageFormat.MCP) {
            // Basic MCP validation
            return this.validateMcpMessages(messages);
        }

        const adapter = this.getAdapter(format);
        return adapter.validate(messages);
    }

    /**
     * Apply format-specific transformations
     */
    public transform(messages: any[], format: MessageFormat): any[] {
        if (format === MessageFormat.MCP) {
            // No transformations for canonical format
            return messages;
        }

        const adapter = this.getAdapter(format);
        return adapter.transform(messages);
    }

    /**
     * Basic MCP message validation
     */
    private validateMcpMessages(messages: any[]): ValidationResult {
        const errors: string[] = [];
        const warnings: string[] = [];

        for (let i = 0; i < messages.length; i++) {
            const msg = messages[i];

            if (!msg.role) {
                errors.push(`Message ${i}: Missing required field 'role'`);
            }

            if (!msg.content) {
                warnings.push(`Message ${i}: Missing content`);
            }

            const validRoles = ['system', 'user', 'assistant', 'tool'];
            if (msg.role && !validRoles.includes(msg.role)) {
                errors.push(`Message ${i}: Invalid role '${msg.role}'`);
            }
        }

        return {
            valid: errors.length === 0,
            errors,
            warnings
        };
    }

    /**
     * Get statistics about registered adapters
     */
    public getAdapterStats(): { format: MessageFormat; loaded: boolean }[] {
        const allFormats = Object.values(MessageFormat);
        return allFormats.map(format => ({
            format,
            loaded: this.adapters.has(format)
        }));
    }
}

/**
 * Singleton instances for client and server contexts
 */
let clientConverterInstance: UnifiedMessageConverter | null = null;
let serverConverterInstance: UnifiedMessageConverter | null = null;

/**
 * Get singleton instance of UnifiedMessageConverter for specified context
 */
export function getMessageConverter(context: 'client' | 'server' = 'server'): UnifiedMessageConverter {
    if (context === 'client') {
        if (!clientConverterInstance) {
            clientConverterInstance = new UnifiedMessageConverter('client');
        }
        return clientConverterInstance;
    } else {
        if (!serverConverterInstance) {
            serverConverterInstance = new UnifiedMessageConverter('server');
        }
        return serverConverterInstance;
    }
}

/**
 * Reset singleton (for testing)
 */
export function resetMessageConverter(context?: 'client' | 'server'): void {
    if (!context || context === 'client') {
        clientConverterInstance = null;
    }
    if (!context || context === 'server') {
        serverConverterInstance = null;
    }
}
