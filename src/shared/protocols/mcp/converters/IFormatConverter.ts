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
 * Message Format Converters - Unified Interface for Provider-Specific Formatting
 *
 * This module provides a clean abstraction for converting between MCP's internal
 * message format and provider-specific formats (OpenAI, Anthropic, Google, etc.)
 *
 * Design Goals:
 * 1. No metadata loss during conversions
 * 2. Single source of truth for format requirements
 * 3. Provider-specific logic isolated in adapters
 * 4. Testable and maintainable
 */

/**
 * Supported message formats across LLM providers
 */
export enum MessageFormat {
    MCP = 'mcp',                    // MXF internal format
    OPENAI = 'openai',             // OpenAI format (function calling)
    OPENROUTER = 'openrouter',     // OpenRouter (OpenAI-compatible with routing)
    ANTHROPIC = 'anthropic',       // Claude format (tool_use/tool_result)
    GEMINI = 'gemini',             // Google Gemini (function_declarations)
    XAI = 'xai',                   // xAI Grok format
    BEDROCK = 'bedrock'            // AWS Bedrock format
}

/**
 * Context for format conversion
 * Provides additional information needed for provider-specific transformations
 */
export interface ConversionContext {
    /**
     * Whether to preserve extended metadata fields
     * Default: true
     */
    preserveMetadata?: boolean;

    /**
     * Apply strict validation to output format
     * Default: false (warnings only)
     */
    strictValidation?: boolean;

    /**
     * Provider-specific options
     * e.g., { anthropicVersion: '2023-06-01', geminiProject: 'my-project' }
     */
    providerOptions?: Record<string, any>;

    /**
     * Agent context for dynamic formatting decisions
     */
    agentId?: string;
    channelId?: string;
}

/**
 * Result of format validation
 */
export interface ValidationResult {
    /**
     * Whether the messages pass validation
     */
    valid: boolean;

    /**
     * Critical errors that prevent API calls
     */
    errors: string[];

    /**
     * Non-critical warnings (suggest fixes but don't block)
     */
    warnings: string[];

    /**
     * Suggested corrections
     */
    suggestions?: string[];
}

/**
 * Core message converter interface
 * Converts between different LLM provider message formats
 */
export interface IMessageConverter {
    /**
     * Convert messages from one format to another
     *
     * @param messages Messages in source format
     * @param fromFormat Source format
     * @param toFormat Target format
     * @param context Optional conversion context
     * @returns Messages in target format
     */
    convert(
        messages: any[],
        fromFormat: MessageFormat,
        toFormat: MessageFormat,
        context?: ConversionContext
    ): any[];

    /**
     * Validate messages conform to format requirements
     *
     * @param messages Messages to validate
     * @param format Expected format
     * @returns Validation result with errors/warnings
     */
    validate(messages: any[], format: MessageFormat): ValidationResult;

    /**
     * Apply format-specific transformations
     * e.g., OpenRouter reordering, Anthropic system message handling
     *
     * @param messages Messages to transform
     * @param format Target format
     * @returns Transformed messages
     */
    transform(messages: any[], format: MessageFormat): any[];
}

/**
 * Tool converter interface
 * Converts tool definitions between provider formats
 */
export interface IToolConverter {
    /**
     * Convert tool definitions to provider format
     *
     * @param tools MCP tool definitions
     * @param toFormat Target provider format
     * @param context Optional conversion context
     * @returns Tools in provider format
     */
    convertTools(
        tools: any[],
        toFormat: MessageFormat,
        context?: ConversionContext
    ): any[];

    /**
     * Convert tool results to provider format
     *
     * @param results Tool execution results
     * @param toFormat Target provider format
     * @param context Optional conversion context
     * @returns Tool results in provider format
     */
    convertToolResults(
        results: any[],
        toFormat: MessageFormat,
        context?: ConversionContext
    ): any[];

    /**
     * Validate tool definitions for format
     *
     * @param tools Tools to validate
     * @param format Expected format
     * @returns Validation result
     */
    validateTools(tools: any[], format: MessageFormat): ValidationResult;
}

/**
 * Message adapter interface
 * Provider-specific implementation of message conversions
 */
export interface IMessageAdapter {
    /**
     * Convert provider-specific messages to canonical MCP format
     *
     * @param messages Provider-formatted messages
     * @param context Optional conversion context
     * @returns Messages in MCP format (with extended fields preserved)
     */
    toMcp(messages: any[], context?: ConversionContext): any[];

    /**
     * Convert MCP messages to provider-specific format
     *
     * @param messages MCP-formatted messages
     * @param context Optional conversion context
     * @returns Messages in provider format
     */
    fromMcp(messages: any[], context?: ConversionContext): any[];

    /**
     * Apply provider-specific transformations
     * e.g., OpenRouter's strict tool call/result reordering
     *
     * @param messages Provider-formatted messages
     * @returns Transformed messages
     */
    transform(messages: any[]): any[];

    /**
     * Validate messages for provider requirements
     *
     * @param messages Messages to validate
     * @returns Validation result
     */
    validate(messages: any[]): ValidationResult;

    /**
     * Get the message format this adapter handles
     */
    getFormat(): MessageFormat;
}

/**
 * Extended MCP Message that preserves provider-specific metadata
 *
 * This extends the base McpMessage with optional fields from various providers.
 * During conversions, these fields are preserved to prevent metadata loss.
 */
export interface ExtendedMcpMessage {
    /**
     * Message role (standard across all providers)
     */
    role: 'system' | 'user' | 'assistant' | 'tool';

    /**
     * Message content (MCP standard format)
     */
    content: any;

    /**
     * Optional message ID
     */
    id?: string;

    /**
     * Message timestamp
     */
    timestamp?: number;

    /**
     * Extended metadata from original format
     */
    metadata?: Record<string, any>;

    // ============================================================================
    // OPENAI / OPENROUTER FIELDS
    // ============================================================================

    /**
     * Tool calls array (OpenAI/OpenRouter format)
     * Present on assistant messages that request tool execution
     */
    tool_calls?: Array<{
        id: string;
        type: 'function';
        function: {
            name: string;
            arguments: string;  // JSON-stringified
        };
    }>;

    /**
     * Tool call ID (OpenAI/OpenRouter format)
     * Present on tool result messages, links to tool_calls[].id
     */
    tool_call_id?: string;

    /**
     * Function call (legacy OpenAI format, deprecated)
     */
    function_call?: {
        name: string;
        arguments: string;
    };

    // ============================================================================
    // ANTHROPIC FIELDS
    // ============================================================================

    /**
     * Tool use blocks (Anthropic Claude format)
     * Present in assistant content array
     */
    tool_use?: Array<{
        id: string;
        name: string;
        input: Record<string, any>;
    }>;

    /**
     * Tool result (Anthropic Claude format)
     * Present in user content array
     */
    tool_result?: {
        tool_use_id: string;
        content: string | any[];
        is_error?: boolean;
    };

    // ============================================================================
    // GOOGLE GEMINI FIELDS
    // ============================================================================

    /**
     * Function call (Gemini format)
     * Present on model messages
     */
    functionCall?: {
        name: string;
        args: Record<string, any>;
    };

    /**
     * Function response (Gemini format)
     * Present on function messages
     */
    functionResponse?: {
        name: string;
        response: Record<string, any>;
    };

    // ============================================================================
    // COMMON OPTIONAL FIELDS
    // ============================================================================

    /**
     * Message name (for function/tool messages)
     */
    name?: string;

    /**
     * Message refusal (when model refuses to answer)
     */
    refusal?: string;
}

/**
 * Conversion error with context
 */
export class ConversionError extends Error {
    constructor(
        message: string,
        public fromFormat: MessageFormat,
        public toFormat: MessageFormat,
        public messageIndex?: number,
        public originalMessage?: any
    ) {
        super(`Conversion error (${fromFormat}→${toFormat}): ${message}`);
        this.name = 'ConversionError';
    }
}

/**
 * Validation error with details
 */
export class ValidationError extends Error {
    constructor(
        message: string,
        public format: MessageFormat,
        public errors: string[],
        public warnings: string[]
    ) {
        super(`Validation error (${format}): ${message}`);
        this.name = 'ValidationError';
    }
}
