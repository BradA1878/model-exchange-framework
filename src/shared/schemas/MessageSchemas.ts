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
 * MessageSchemas.ts
 * 
 * Defines standardized message schemas used throughout the Model Exchange Framework.
 * These schemas provide a consistent structure for all messages exchanged between
 * components, whether they're channel messages, agent messages, or binary data.
 */

/**
 * Data format options for message content
 */
export enum ContentFormat {
    JSON = 'json',
    BINARY = 'binary',
    BASE64 = 'base64',
    TEXT = 'text'
}

/**
 * Security settings for message transmission
 */
export interface SecuritySettings {
    encrypted: boolean;             // Whether the content is encrypted
    encryptionMethod?: string;      // Method used for encryption (if applicable)
    signature?: string;             // Optional digital signature for verification
}

/**
 * Metadata that applies to all message types
 */
export interface MessageMetadata {
    messageId: string;              // Unique identifier for this message
    timestamp: number;              // Unix timestamp when message was created
    correlationId?: string;         // Optional ID to track related messages
    priority?: number;              // Optional priority level (higher = more important)
    ttl?: number;                   // Time-to-live in milliseconds
    
    // MXP optimization metadata
    mxpOptimized?: boolean;         // Whether message was optimized by MXP
    mxpVersion?: string;            // MXP version used for optimization
    mxpContextCompression?: {       // Context compression details
        originalSize: number;
        compressedSize: number;
        strategy: string;
        compressionRatio: number;
    };
    mxpPromptOptimization?: {       // Prompt optimization details
        originalTokens: number;
        optimizedTokens: number;
        strategy: string;
        tokenSavings: number;
    };
}

/**
 * Standardized content wrapper for all message types
 */
export interface ContentWrapper<T = any> {
    format: ContentFormat;          // Format of the content data
    data: T;                        // The actual content data
    encoding?: string;              // If binary, specifies how it's encoded
    compression?: boolean;          // Whether the content is compressed
    schema?: string;                // Optional schema identifier for the data
}

/**
 * Base interface for all tool call messages
 */
export interface StandardToolCall {
    toolType: string;                       // Type of tool call (e.g., "channelMessage", "agentMessage", "binaryData")
    senderId: string;                       // Source agent/entity ID
    receiverId?: string;                    // Target agent/entity ID (optional)
    metadata: MessageMetadata;              // Standard message metadata
    security?: SecuritySettings;            // Optional security settings
    content: ContentWrapper;                // Standardized content wrapper
    context?: {                             // Optional contextual information
        channelId?: string;                 // Channel ID if applicable
        sessionId?: string;                 // Session ID if applicable
        [key: string]: any;                 // Additional context as needed
    };
    routing?: {                             // Optional routing information
        hops?: string[];                    // List of intermediaries this message passed through
        destination?: string;               // Final destination service/component
        [key: string]: any;                 // Additional routing information
    };
}

/**
 * Specific type for channel messages
 */
export interface ChannelMessage extends StandardToolCall {
    toolType: 'channelMessage';
    context: {
        channelId: string;                  // Required for channel messages
        [key: string]: any;
    };
}

/**
 * Specific type for direct agent-to-agent messages
 */
export interface AgentMessage extends StandardToolCall {
    toolType: 'agentMessage';
    receiverId: string;                     // Required for agent messages
}

/**
 * Specific type for binary data transmission
 */
export interface BinaryMessage extends StandardToolCall {
    toolType: 'binaryData';
    content: ContentWrapper<string | Buffer>; // Binary data as base64 string or Buffer
}

/**
 * Asserts that the provided value is a non-empty string.
 * This function provides both runtime validation and TypeScript type narrowing.
 * 
 * @param value - The value to check
 * @param paramName - The name of the parameter (for error message)
 * @throws Error if validation fails
 */
const assertNonEmptyString: (value: unknown, paramName: string) => asserts value is string = (
    value: unknown, 
    paramName: string
): asserts value is string => {
    if (!value || typeof value !== 'string' || value.trim() === '') {
        throw new Error(`${paramName} is required and must be a non-empty string`);
    }
};

/**
 * Asserts that a value is a valid content format.
 * 
 * @param value - The value to check
 * @param paramName - The name of the parameter (for error message)
 * @throws Error if validation fails
 */
const assertValidContentFormat: (value: unknown, paramName: string) => asserts value is ContentFormat = (
    value: unknown,
    paramName: string
): asserts value is ContentFormat => {
    if (
        value !== ContentFormat.JSON &&
        value !== ContentFormat.BINARY &&
        value !== ContentFormat.BASE64 &&
        value !== ContentFormat.TEXT
    ) {
        throw new Error(`${paramName} must be a valid ContentFormat (json, binary, base64, or text)`);
    }
};

/**
 * Helper function to create a standard message metadata object
 * @param overrides - Optional fields to override defaults
 * @returns A MessageMetadata object with defaults and any overrides
 */
export const createMessageMetadata = (overrides: Partial<MessageMetadata> = {}): MessageMetadata => {
    // Generate a random message ID if not provided
    const randomId = (): string => {
        return Math.random().toString(36).substring(2, 15) + 
               Math.random().toString(36).substring(2, 15);
    };
    
    return {
        messageId: overrides.messageId || randomId(),
        timestamp: overrides.timestamp || Date.now(),
        correlationId: overrides.correlationId,
        priority: overrides.priority,
        ttl: overrides.ttl
    };
};

/**
 * Helper function to create a standard channel message
 * @param channelId - ID of the channel
 * @param senderId - ID of the sending agent/entity
 * @param content - Message content (will be wrapped in ContentWrapper)
 * @param options - Additional options for the message
 * @returns A fully formed ChannelMessage
 */
export const createChannelMessage = (
    channelId: string,
    senderId: string,
    content: any,
    options: {
        receiverId?: string;
        format?: ContentFormat;
        encrypted?: boolean;
        metadata?: Partial<MessageMetadata>;
        context?: Record<string, any>;
    } = {}
): ChannelMessage => {
    // Validate critical parameters
    assertNonEmptyString(channelId, 'channelId');
    assertNonEmptyString(senderId, 'senderId');
    
    // Ensure content is provided
    if (content === undefined || content === null) {
        throw new Error('Message content cannot be null or undefined');
    }
    
    // Determine content format - if explicit format provided, verify it's valid
    let format: ContentFormat;
    if (options.format) {
        assertValidContentFormat(options.format, 'format');
        format = options.format;
    } else {
        // Auto-detect format based on content type
        format = typeof content === 'string' ? ContentFormat.TEXT : ContentFormat.JSON;
    }
    
    // Build the channel message
    const message: ChannelMessage = {
        toolType: 'channelMessage',
        senderId,
        receiverId: options.receiverId,
        metadata: createMessageMetadata(options.metadata),
        security: options.encrypted ? { encrypted: true } : undefined,
        content: {
            format,
            data: content,
        },
        context: {
            channelId,
            ...(options.context || {}),
        }
    };
    
    return message;
};

/**
 * Helper function to create a standard agent-to-agent message
 * @param senderId - ID of the sending agent
 * @param receiverId - ID of the receiving agent
 * @param content - Message content (will be wrapped in ContentWrapper)
 * @param options - Additional options for the message
 * @returns A fully formed AgentMessage
 */
export const createAgentMessage = (
    senderId: string,
    receiverId: string,
    content: any,
    options: {
        format?: ContentFormat;
        encrypted?: boolean;
        metadata?: Partial<MessageMetadata>;
        context?: Record<string, any>; 
    } = {}
): AgentMessage => {
    // Validate critical parameters
    assertNonEmptyString(senderId, 'senderId');
    assertNonEmptyString(receiverId, 'receiverId');

    // Ensure content is provided
    if (content === undefined || content === null) {
        throw new Error('Message content cannot be null or undefined');
    }

    // Determine content format
    let format: ContentFormat;
    if (options.format) {
        assertValidContentFormat(options.format, 'format');
        format = options.format;
    } else {
        // Auto-detect format based on content type
        format = typeof content === 'string' ? ContentFormat.TEXT : ContentFormat.JSON;
    }

    // Build the agent message
    const message: AgentMessage = {
        toolType: 'agentMessage',
        senderId,
        receiverId,
        metadata: createMessageMetadata(options.metadata),
        security: options.encrypted ? { encrypted: true } : undefined,
        content: {
            format,
            data: content,
        },
        context: options.context
    };

    return message;
};

/**
 * Helper function to convert an existing message to the standard schema
 * @param message - Message content in any format
 * @param senderId - ID of the sending agent/entity
 * @param options - Additional options for standardization
 * @returns A standardized message
 */
export const standardizeMessage = (
    message: any,
    senderId: string,
    options: {
        toolType?: string;
        receiverId?: string;
        channelId?: string;
        format?: ContentFormat;
    } = {}
): StandardToolCall => {
    // Validate critical parameters
    assertNonEmptyString(senderId, 'senderId');
    
    // Ensure message is provided
    if (message === undefined || message === null) {
        throw new Error('Message content cannot be null or undefined');
    }
    
    // Determine the tool type based on the message category and options
    const toolType = options.toolType || (options.channelId ? 'channelMessage' : 'agentMessage');
    
    // Content format defaults based on message type
    let format: ContentFormat;
    if (options.format) {
        assertValidContentFormat(options.format, 'format');
        format = options.format;
    } else {
        // Auto-detect format based on content type
        format = Buffer.isBuffer(message) 
            ? ContentFormat.BINARY
            : typeof message === 'string' 
                ? ContentFormat.TEXT
                : ContentFormat.JSON;
    }
    
    // Build a standardized message
    const standardMessage: StandardToolCall = {
        toolType,
        senderId,
        receiverId: options.receiverId,
        metadata: createMessageMetadata(),
        content: {
            format,
            data: message,
            compression: false
        },
        context: {}
    };
    
    // Channel messages must include channelId in context and fromAgentId
    if (toolType === 'channelMessage') {
        if (!options.channelId) {
            throw new Error('Channel message requires channelId');
        }
        
        assertNonEmptyString(options.channelId, 'channelId');
        
        standardMessage.context = {
            channelId: options.channelId
        };
        
        // Ensure fromAgentId is explicitly set for channel messages
        (standardMessage as any).fromAgentId = senderId;
    }
    
    return standardMessage;
};

/**
 * Helper function to determine the content format based on the content type
 * @param content - Content to determine format for
 * @returns The appropriate ContentFormat enum value
 */
export const determineContentFormat = (content: any): ContentFormat => {
    if (Buffer.isBuffer(content)) {
        return ContentFormat.BINARY;
    } else if (typeof content === 'string') {
        // Try to parse as JSON, if it fails, treat as text
        try {
            JSON.parse(content);
            return ContentFormat.JSON;
        } catch (e) {
            return ContentFormat.TEXT;
        }
    } else if (typeof content === 'object') {
        return ContentFormat.JSON;
    } else {
        // Default to TEXT for anything else
        return ContentFormat.TEXT;
    }
};

/**
 * Helper function to create a content wrapper
 * @param content - Content to be wrapped
 * @returns A ContentWrapper
 */
export const createContentWrapper = (content: any): ContentWrapper => ({
    format: determineContentFormat(content),
    data: content
});

/**
 * Helper function to wrap binary data in a JSON-compatible format
 * @param content - Binary content as Buffer or string
 * @param format - Explicitly specify the format (will auto-detect if not provided)
 * @returns A ContentWrapper with properly formatted binary data
 */
export const wrapBinaryContent = (
    content: Buffer | string,
    format?: ContentFormat.BINARY | ContentFormat.BASE64
): ContentWrapper => {
    // Default to binary for Buffer, base64 for string
    const contentFormat = format || (Buffer.isBuffer(content) ? ContentFormat.BINARY : ContentFormat.BASE64);
    
    // If content is a Buffer and format is base64, convert to base64 string
    const formattedContent = Buffer.isBuffer(content) && contentFormat === ContentFormat.BASE64
        ? content.toString('base64')
        : content;
    
    return {
        format: contentFormat,
        data: formattedContent,
        compression: false
    };
};
