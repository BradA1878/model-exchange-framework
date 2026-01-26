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
 * MCP Prompts Type Definitions
 *
 * Type definitions for the Model Context Protocol (MCP) Prompts feature.
 * Prompts provide server-defined prompt templates that clients can discover
 * and invoke with arguments for dynamic agent configuration and task decomposition.
 *
 * @see https://modelcontextprotocol.io/specification/2025-06-18/server/prompts
 */

/**
 * Argument definition for a prompt
 */
export interface PromptArgument {
    /** Argument name */
    name: string;
    /** Human-readable description of the argument */
    description?: string;
    /** Whether this argument is required */
    required?: boolean;
    /** Default value for the argument (MXF extension) */
    defaultValue?: unknown;
}

/**
 * Prompt definition metadata
 */
export interface PromptDefinition {
    /** Unique identifier for the prompt */
    name: string;
    /** Human-readable title */
    title?: string;
    /** Description of the prompt's purpose */
    description?: string;
    /** List of argument definitions */
    arguments?: PromptArgument[];
    /** Source MCP server ID (MXF extension) */
    serverId: string;
}

/**
 * Text content in a prompt message
 */
export interface PromptTextContent {
    type: 'text';
    text: string;
}

/**
 * Image content in a prompt message
 */
export interface PromptImageContent {
    type: 'image';
    /** Base64-encoded image data */
    data: string;
    /** MIME type of the image */
    mimeType: string;
}

/**
 * Audio content in a prompt message
 */
export interface PromptAudioContent {
    type: 'audio';
    /** Base64-encoded audio data */
    data: string;
    /** MIME type of the audio */
    mimeType: string;
}

/**
 * Embedded resource in a prompt message
 */
export interface EmbeddedResource {
    /** Resource URI (e.g., resource://server/path) */
    uri: string;
    /** MIME type of the resource */
    mimeType?: string;
    /** Text content if available */
    text?: string;
    /** Base64-encoded binary content if available */
    blob?: string;
}

/**
 * Resource content in a prompt message
 */
export interface PromptResourceContent {
    type: 'resource';
    resource: EmbeddedResource;
}

/**
 * Union type for all prompt content types
 */
export type PromptContent =
    | PromptTextContent
    | PromptImageContent
    | PromptAudioContent
    | PromptResourceContent;

/**
 * Message in a resolved prompt
 */
export interface PromptMessage {
    /** Message role */
    role: 'user' | 'assistant';
    /** Message content (can be single or array) */
    content: PromptContent | PromptContent[];
}

/**
 * Metadata for a resolved prompt
 */
export interface PromptMetadata {
    /** Timestamp when the prompt was resolved */
    resolvedAt: Date;
    /** Source MCP server ID */
    serverId: string;
    /** Estimated token count for MXP integration */
    tokenEstimate: number;
    /** Arguments used for resolution */
    argumentsUsed: Record<string, unknown>;
}

/**
 * Fully resolved prompt with messages
 */
export interface ResolvedPrompt {
    /** Optional description of the prompt */
    description?: string;
    /** Array of messages in the prompt */
    messages: PromptMessage[];
    /** Metadata about the resolution */
    metadata: PromptMetadata;
}

/**
 * MCP Protocol: prompts/list request
 */
export interface PromptsListRequest {
    /** Cursor for pagination (null for first page) */
    cursor?: string | null;
}

/**
 * MCP Protocol: prompts/list response
 */
export interface PromptsListResponse {
    /** Array of available prompts */
    prompts: PromptDefinition[];
    /** Cursor for next page, or undefined if no more pages */
    nextCursor?: string;
}

/**
 * MCP Protocol: prompts/get request
 */
export interface PromptsGetRequest {
    /** Name of the prompt to retrieve */
    name: string;
    /** Argument values for prompt resolution */
    arguments?: Record<string, unknown>;
}

/**
 * MCP Protocol: prompts/get response
 */
export interface PromptsGetResponse {
    /** Optional description */
    description?: string;
    /** Array of messages in the prompt */
    messages: Array<{
        role: 'user' | 'assistant';
        content: PromptContent | PromptContent[];
    }>;
}

/**
 * Cache statistics for the prompts manager
 */
export interface PromptCacheStats {
    /** Total cache hits */
    hits: number;
    /** Total cache misses */
    misses: number;
    /** Current number of cached entries */
    size: number;
    /** Maximum cache capacity */
    maxSize: number;
    /** Cache hit rate (0.0 to 1.0) */
    hitRate: number;
}

/**
 * Configuration for MCP Prompts integration
 */
export interface MxfPromptsConfig {
    /** Whether prompts feature is enabled */
    enabled: boolean;
    /** Cache configuration */
    cache: {
        /** Cache strategy: memory, redis, or none */
        strategy: 'memory' | 'redis' | 'none';
        /** Time-to-live in seconds */
        ttlSeconds: number;
        /** Maximum number of cached entries */
        maxEntries: number;
    };
    /** Discovery configuration */
    discovery: {
        /** Refresh interval in seconds */
        refreshIntervalSeconds: number;
        /** Discovery timeout in milliseconds */
        timeoutMs: number;
    };
    /** Resolution configuration */
    resolution: {
        /** Maximum embedded resource size in bytes */
        maxEmbeddedResourceSize: number;
        /** Allowed resource URI schemes */
        allowedResourceSchemes: string[];
    };
    /** MXP integration configuration */
    mxpIntegration: {
        /** Whether to compress embedded resources */
        compressEmbeddedResources: boolean;
        /** Whether to track token usage */
        trackTokenUsage: boolean;
    };
}

/**
 * Source for prompt argument resolution
 */
export enum ArgumentResolutionSource {
    /** Explicitly provided by caller */
    EXPLICIT = 'explicit',
    /** Resolved from task context */
    TASK_CONTEXT = 'task_context',
    /** Resolved from agent context */
    AGENT_CONTEXT = 'agent_context',
    /** Resolved from channel context */
    CHANNEL_CONTEXT = 'channel_context',
    /** Inferred by SystemLLM */
    SYSTEM_LLM = 'system_llm',
    /** Default value from prompt definition */
    DEFAULT = 'default'
}

/**
 * Result of argument resolution
 */
export interface ArgumentResolutionResult {
    /** Resolved value */
    value: unknown;
    /** Where the value came from */
    source: ArgumentResolutionSource;
    /** Confidence score (0.0 to 1.0) for inferred values */
    confidence?: number;
}

/**
 * Context for prompt argument resolution
 */
export interface PromptResolutionContext {
    /** Agent ID requesting the prompt */
    agentId?: string;
    /** Channel ID for context */
    channelId?: string;
    /** Task context */
    taskContext?: Record<string, unknown>;
    /** Agent context */
    agentContext?: Record<string, unknown>;
    /** Channel context */
    channelContext?: Record<string, unknown>;
    /** Explicitly provided arguments */
    explicitArgs?: Record<string, unknown>;
}
