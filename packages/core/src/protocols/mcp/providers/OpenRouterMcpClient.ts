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
 * @documentation https://mxf-dev.github.io/mxf/
 */

/**
 * OpenRouter MCP Client
 * 
 * This module implements the Model Context Protocol (MCP) client for OpenRouter's API.
 * OpenRouter provides access to various AI models through a unified API interface.
 * 
 * API Reference: https://openrouter.ai/docs/api-reference/overview
 */

import { Observable } from 'rxjs';
import { v4 as uuidv4 } from 'uuid';
import { BaseMcpClient } from './BaseMcpClient.js';
import {
    McpMessage,
    McpTool,
    McpApiResponse,
    McpContentType,
    McpRole,
    McpContent,
    McpTextContent,
    McpStreamChunk,
    McpStreamEmission
} from '../IMcpClient.js';
import { AgentContext } from '../../../interfaces/AgentContext.js';
import { ConversationMessage } from '../../../interfaces/ConversationMessage.js';
import { Logger } from '../../../utils/Logger.js';
import {
    NetworkRecoveryConfig,
    DEFAULT_NETWORK_RECOVERY_CONFIG
} from '../../../types/NetworkRecoveryTypes.js';
import { NetworkRecoveryManager, extractStatusCodeFromError } from '../utils/NetworkRecovery.js';
import { JsonRecoveryManager } from '../utils/JsonRecovery.js';
import { 
    extractToolCalls, 
    extractToolCallId, 
    extractToolResultText,
    extractTextFromContent,
    convertContentToText
} from '../utils/MessageConverters.js';
import { convertToolsToProviderFormat } from '../utils/ToolHandlers.js';
import { getMessageConverter } from '../converters/UnifiedMessageConverter.js';
import { MessageFormat, ExtendedMcpMessage } from '../converters/IFormatConverter.js';
import { OpenRouterMessageAdapter } from '../converters/adapters/OpenRouterMessageAdapter.js';

// Type definitions for OpenRouter API
interface OpenRouterMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string | Array<{
        type: 'text' | 'image_url' | 'tool_call' | 'tool_result';
        text?: string;
        image_url?: {
            url: string;
            detail?: 'auto' | 'low' | 'high';
        };
        tool_call_id?: string;
        name?: string;
        arguments?: Record<string, any>;
    }>;
    name?: string;
    tool_call_id?: string;
    tool_calls?: Array<{
        id: string;
        type: 'function';
        function: {
            name: string;
            arguments: string;
        };
    }>;
}

interface OpenRouterTool {
    type: 'function';
    function: {
        name: string;
        description: string;
        parameters: Record<string, any>;
    };
}

interface OpenRouterResponse {
    id: string;
    model: string;
    created: number;
    object: string;
    choices: Array<{
        index: number;
        message: OpenRouterMessage;
        finish_reason: string;
    }>;
    usage: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };
}

/**
 * Read a positive integer from the environment, failing fast on garbage.
 * These values bound how long a hung request can stay silent — a NaN or zero
 * from a typo'd env var must not silently disable that bound.
 */
const parsePositiveIntEnv = (name: string, defaultValue: number): number => {
    const raw = process.env[name];
    if (raw === undefined || raw === '') {
        return defaultValue;
    }
    const parsed = parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(`${name} must be a positive integer, got "${raw}"`);
    }
    return parsed;
};

/**
 * True when an error came from an aborted fetch. AbortSignal.timeout() rejects
 * with a DOMException named 'TimeoutError' (Node and Bun); a manual
 * controller.abort() rejects with 'AbortError'. This client owns every signal it
 * passes to fetch, so either name means our own timeout fired.
 */
const isAbortOrTimeoutError = (error: unknown): boolean => {
    const name = (error as any)?.name;
    return name === 'TimeoutError' || name === 'AbortError';
};

/**
 * OpenRouter implementation of the MCP client with network recovery
 */
export class OpenRouterMcpClient extends BaseMcpClient {
    // Base URL for the OpenRouter API
    private readonly baseUrl = 'https://openrouter.ai/api/v1';

    // Logger instance (using 'client' target so we can see server-side debug logs)
    private logger = new Logger('debug', 'OpenRouterMcpClient', 'client');

    // Exacto-supported models (as of October 2025)
    // These models have vetted providers with superior tool-calling performance
    private static readonly EXACTO_SUPPORTED_MODELS = [
        'moonshotai/kimi-k2-0905',
        'deepseek/deepseek-chat-v3.1-terminus',
        'zhipuai/glm-4-6',
        'gpt-oss/gpt-oss-120b',
        'qwen/qwen3-coder'
    ];
    
    constructor() {
        super();
        this.jsonRecovery = new JsonRecoveryManager('OpenRouterMcpClient');
    }

    /**
     * Check if a model supports the Exacto variant
     * Strips any existing variant suffix before checking
     */
    private static isExactoSupported(modelName: string): boolean {
        // Remove existing variant suffixes (e.g., :free, :thinking, :exacto)
        const baseModel = modelName.split(':')[0];
        return OpenRouterMcpClient.EXACTO_SUPPORTED_MODELS.includes(baseModel);
    }

    /**
     * Apply Exacto variant to a model name if supported and requested
     *
     * @param modelName - Original model name (may include existing variant)
     * @param useExacto - Whether to apply Exacto variant
     * @returns Model name with appropriate variant suffix
     */
    private applyExactoVariant(modelName: string, useExacto: boolean): string {
        if (!useExacto) {
            return modelName;
        }

        // Split model and existing variant
        const parts = modelName.split(':');
        const baseModel = parts[0];
        const existingVariant = parts[1];

        // Check if already has :exacto
        if (existingVariant === 'exacto') {
            return modelName;
        }

        // Check if model supports Exacto
        if (!OpenRouterMcpClient.isExactoSupported(baseModel)) {
            // this.logger.warn(`⚠️ Model ${baseModel} does not support :exacto variant. Supported models: ${OpenRouterMcpClient.EXACTO_SUPPORTED_MODELS.join(', ')}`);
            return modelName; // Return original model name
        }

        // If there's an existing variant (e.g., :free, :thinking), warn about replacement
        if (existingVariant) {
        }

        const exactoModel = `${baseModel}:exacto`;
        return exactoModel;
    }

    /**
     * Build the standard OpenRouter request headers.
     *
     * Precedence for app-attribution headers (X-Title and HTTP-Referer):
     *   1. Per-request override via `options.title` / `options.referer`
     *   2. Env vars `OPENROUTER_APP_TITLE` / `OPENROUTER_APP_URL`
     *   3. MXF defaults
     *
     * Set the env vars when embedding MXF in another application so traffic
     * attributes correctly in that application's OpenRouter dashboard.
     */
    private buildOpenRouterHeaders(options?: Record<string, any>): Record<string, string> {
        return {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.config.apiKey}`,
            'HTTP-Referer': options?.referer || process.env.OPENROUTER_APP_URL || 'http://mxf.dev',
            'X-Title': options?.title || process.env.OPENROUTER_APP_TITLE || 'MXF'
        };
    }

    /**
     * Attach the OpenRouter `reasoning` parameter to a request body.
     *
     * OpenRouter's reasoning config accepts { effort?, max_tokens?, exclude?, enabled? }.
     * Three states matter here:
     * - enabled: true  → send effort or max_tokens (mutually exclusive per OpenRouter API)
     * - enabled: false → send { enabled: false }. Some models (GLM 5.x, Qwen, DeepSeek)
     *   reason by default when the request omits `reasoning`, so omission does NOT
     *   disable thinking — only the explicit off-switch does. Without it, default
     *   thinking shares the completion `max_tokens` budget and can starve tool-call
     *   output (truncated arguments → unparseable JSON).
     * - absent/no enabled flag → send nothing and let the provider default apply.
     */
    private applyReasoningParam(requestBody: Record<string, any>, options?: Record<string, any>): void {
        if (options?.reasoning?.enabled === true) {
            requestBody.reasoning = {
                // effort and maxTokens are mutually exclusive per OpenRouter API
                ...(options.reasoning.maxTokens
                    ? { max_tokens: options.reasoning.maxTokens }
                    : { effort: options.reasoning.effort || 'medium' }
                ),
                ...(options.reasoning.exclude !== undefined && { exclude: options.reasoning.exclude })
            };
        } else if (options?.reasoning?.enabled === false) {
            requestBody.reasoning = { enabled: false };
        }
    }

    // Per-instance request queue: keeps one client's requests ordered and spaced.
    // This used to be static (class-level), which serialized every request from
    // every client instance in the process through one queue — one hung request
    // starved every agent's LLM calls, not just its own. Instance scoping plus the
    // per-request timeout below bounds the damage a single request can do to the
    // agent that issued it.
    private requestQueue: Array<() => Promise<any>> = [];
    private isProcessingQueue = false;
    // Configurable delay between requests - reduced from 500ms to 100ms default for better performance
    // Set OPENROUTER_REQUEST_QUEUE_DELAY_MS=0 to disable queueing delay entirely
    private static readonly REQUEST_DELAY_MS = parseInt(process.env.OPENROUTER_REQUEST_QUEUE_DELAY_MS || '100', 10);

    // Network recovery manager
    private networkRecovery: NetworkRecoveryManager | null = null;

    // JSON recovery manager
    private jsonRecovery: JsonRecoveryManager;

    // Hard cap on a single completion request (fetch + body). Generous because
    // reasoning models legitimately run for minutes; finite because a request
    // with no bound turns a hung connection into permanent silence.
    private requestTimeoutMs = 300000;

    // Max silence between SSE chunks on the streaming path. OpenRouter emits
    // keepalive comment lines every few seconds while a model is thinking, so a
    // long quiet gap means a dead connection, not a slow model.
    private streamIdleTimeoutMs = 120000;

    // Threshold for the slow-request WARN that makes slow-vs-hung visible in
    // production logs before any timeout fires.
    private slowRequestWarnMs = 60000;

    /**
     * Process the request queue sequentially to prevent concurrent requests
     */
    private async processQueue(): Promise<void> {
        if (this.isProcessingQueue || this.requestQueue.length === 0) {
            return;
        }

        this.isProcessingQueue = true;

        while (this.requestQueue.length > 0) {
            const request = this.requestQueue.shift()!;
            try {
                await request();
            } catch (error) {
                // Request will handle its own error, just continue processing
            }

            // Wait between requests to prevent rate limiting
            if (this.requestQueue.length > 0) {
                await new Promise(resolve => setTimeout(resolve, OpenRouterMcpClient.REQUEST_DELAY_MS));
            }
        }

        this.isProcessingQueue = false;
    }

    /**
     * Add a request to the queue and process it
     */
    private async queueRequest<T>(requestFn: () => Promise<T>): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            const wrappedRequest = async () => {
                try {
                    const result = await requestFn();
                    resolve(result);
                } catch (error) {
                    reject(error);
                }
            };

            this.requestQueue.push(wrappedRequest);
            this.processQueue();
        });
    }

    /**
     * Start the slow-request watchdog for one LLM request.
     *
     * Emits a WARN once the request has been in flight for slowRequestWarnMs, and
     * another WARN at completion if the total time crossed the threshold. Together
     * with the timeout ERROR this makes slow-vs-hung distinguishable in production
     * logs: a slow request logs WARN…WARN(completed), a hung one WARN…ERROR(timeout).
     *
     * Returns a finish() that must be called exactly once when the request settles.
     */
    private startSlowRequestWatch(
        kind: 'completion' | 'streaming',
        model: string,
        agentId: string,
        requestBytes: number
    ): { finish: (succeeded?: boolean) => void } {
        const startedAt = Date.now();
        let finished = false;
        const timer = setTimeout(() => {
            this.logger.warn(
                `⏱️ OpenRouter ${kind} request still in flight after ${this.slowRequestWarnMs}ms: ` +
                `model=${model}, agent=${agentId}, request=${(requestBytes / 1024).toFixed(1)}KB`
            );
        }, this.slowRequestWarnMs);

        return {
            // Idempotent. The completed-WARN is success-only: failures carry their
            // elapsed time in their own ERROR log, and a "completed" line for a
            // request that timed out would be a lie.
            finish: (succeeded: boolean = true) => {
                if (finished) {
                    return;
                }
                finished = true;
                clearTimeout(timer);
                const elapsedMs = Date.now() - startedAt;
                if (succeeded && elapsedMs >= this.slowRequestWarnMs) {
                    this.logger.warn(
                        `⏱️ OpenRouter ${kind} request completed after ${elapsedMs}ms: ` +
                        `model=${model}, agent=${agentId}`
                    );
                }
            }
        };
    }

    /**
     * Build, log, and return the error for a timed-out LLM request.
     *
     * The error is named 'TimeoutError' and flagged isRequestTimeout so
     * classifyNetworkError maps it to the non-retryable REQUEST_TIMEOUT type:
     * the caller sees the failure immediately instead of a silent retry loop.
     * Logged at ERROR here — unconditionally — because this is the line that
     * turns a production stall from invisible into diagnosable.
     */
    private buildRequestTimeoutError(params: {
        kind: 'completion' | 'streaming';
        detail: string;
        model: string;
        agentId: string;
        elapsedMs: number;
        limitMs: number;
        requestBytes: number;
        messageCount: number;
    }): Error {
        const message =
            `⛔ OpenRouter ${params.kind} request timed out (${params.detail}) after ${params.elapsedMs}ms ` +
            `(limit ${params.limitMs}ms): model=${params.model}, agent=${params.agentId}, ` +
            `request=${(params.requestBytes / 1024).toFixed(1)}KB, messages=${params.messageCount}`;
        this.logger.error(message);

        const error = new Error(message);
        error.name = 'TimeoutError';
        (error as any).isRequestTimeout = true;
        return error;
    }
    
    /**
     * Initialize the OpenRouter provider
     */
    protected async initializeProvider(): Promise<void> {
        // Per-request bounds. All three must be positive and finite — a missing or
        // disabled bound is how a hung connection becomes permanent silence that
        // only a consumer-side backstop can end.
        //
        // requestTimeoutMs defaults to 5 minutes: reasoning models legitimately run
        // for minutes on large contexts, so this is a hang detector, not a latency
        // budget. It is enforced twice: as an AbortSignal on the fetch itself and
        // as an operation bound inside NetworkRecoveryManager.executeWithRetry.
        this.requestTimeoutMs = parsePositiveIntEnv('OPENROUTER_REQUEST_TIMEOUT_MS', 300000);
        this.streamIdleTimeoutMs = parsePositiveIntEnv('OPENROUTER_STREAM_IDLE_TIMEOUT_MS', 120000);
        this.slowRequestWarnMs = parsePositiveIntEnv('OPENROUTER_SLOW_REQUEST_WARN_MS', 60000);

        // Initialize network recovery configuration from environment or defaults
        const networkRecoveryConfig: NetworkRecoveryConfig = {
            ...DEFAULT_NETWORK_RECOVERY_CONFIG,
            maxRetries: parseInt(process.env.OPENROUTER_MAX_RETRIES || '3'),
            baseDelayMs: parseInt(process.env.OPENROUTER_BASE_DELAY_MS || '1000'),
            maxDelayMs: parseInt(process.env.OPENROUTER_MAX_DELAY_MS || '30000'),
            retryMultiplier: parseFloat(process.env.OPENROUTER_RETRY_MULTIPLIER || '2'),
            circuitBreakerThreshold: parseInt(process.env.OPENROUTER_CIRCUIT_BREAKER_THRESHOLD || '5'),
            circuitBreakerCooldownMs: parseInt(process.env.OPENROUTER_CIRCUIT_BREAKER_COOLDOWN_MS || '60000'),
            requestTimeoutMs: this.requestTimeoutMs,
            enableGracefulDegradation: process.env.OPENROUTER_ENABLE_GRACEFUL_DEGRADATION !== 'false',
            enableDetailedLogging: process.env.OPENROUTER_ENABLE_DETAILED_LOGGING !== 'false'
        };

        // Create network recovery manager
        this.networkRecovery = new NetworkRecoveryManager(networkRecoveryConfig, 'OpenRouterMcpClient');


        // Register OpenRouter adapter with the unified converter
        // Use 'client' context since MCP clients run in SDK (client-side)
        const converter = getMessageConverter('client');
        converter.registerAdapter(new OpenRouterMessageAdapter('client'));

    }

    /**
     * Convert ConversationMessage directly to OpenRouter format
     * No MCP intermediate step - preserves all metadata
     */
    private convertConversationToOpenRouter(msg: ConversationMessage): any {
        const role = msg.role === 'system' ? 'system' :
                     msg.role === 'assistant' ? 'assistant' :
                     msg.role === 'tool' ? 'tool' : 'user';

        let content = msg.content;

        // Preserve agent attribution for messages from other agents
        if (role === 'user' && msg.metadata?.fromAgentId) {
            const hasPrefix = content.startsWith('[') && content.includes(']:');
            if (!hasPrefix) {
                content = `[${msg.metadata.fromAgentId}]: ${content}`;
            }
        }

        const openRouterMsg: any = { role, content };

        // Preserve tool_calls for assistant messages
        if (msg.role === 'assistant' && (msg as any).tool_calls) {
            openRouterMsg.tool_calls = (msg as any).tool_calls;
        }

        // Preserve tool_call_id for tool messages
        if (msg.role === 'tool' && msg.metadata?.tool_call_id) {
            openRouterMsg.tool_call_id = msg.metadata.tool_call_id;
        }

        return openRouterMsg;
    }

    /**
     * Convert MCP tools to OpenRouter tools (using utility)
     * 
     * @param tools MCP tools
     * @returns OpenRouter tools
     */
    private convertToOpenRouterTools(tools: McpTool[]): OpenRouterTool[] {
        return convertToolsToProviderFormat(tools, 'openrouter') as OpenRouterTool[];
    }
    
    /**
     * Convert OpenRouter response to MCP response
     * 
     * @param response OpenRouter response
     * @returns MCP response
     */
    private convertToMcpResponse(response: OpenRouterResponse): McpApiResponse {
        // Get the choice with the assistant message
        const choice = response.choices[0];
        
        // Convert content to MCP format
        const content: McpApiResponse['content'] = [];
        
        // Handle reasoning tokens for reasoning models (e.g., o1, deepseek-reasoner, gpt-5)
        // These models return both 'reasoning' and 'content' fields
        const messageContent = choice.message.content;
        const messageReasoning = (choice.message as any).reasoning;
        
        
        if (messageReasoning) {
        } else {
        }
        
        // Handle different response formats
        if (typeof messageContent === 'string') {
            // Simple text content (works for both normal and :thinking models)
            content.push({
                type: McpContentType.TEXT,
                text: messageContent
            });
        } else if (Array.isArray(messageContent)) {
            // Array of content blocks
            messageContent.forEach(item => {
                if (item.type === 'text' && item.text) {
                    content.push({
                        type: McpContentType.TEXT,
                        text: item.text
                    });
                } else if (item.type === 'image_url' && item.image_url) {
                    content.push({
                        type: McpContentType.IMAGE,
                        source: {
                            type: 'url',
                            media_type: 'image/jpeg', // Assuming JPEG
                            data: item.image_url.url
                        }
                    });
                }
            });
        }
        
        // Handle tool calls if present
        if (choice.message.tool_calls && choice.message.tool_calls.length > 0) {
            choice.message.tool_calls.forEach(toolCall => {
                if (toolCall.type === 'function') {
                    // Parse tool call arguments from OpenRouter response
                    let parsedInput = {};
                    try {
                        const args = toolCall.function.arguments?.trim();
                        if (args && args.length > 0) {
                            parsedInput = JSON.parse(args);
                        } else {
                            this.logger.warn(`⚠️ Tool call ${toolCall.function.name} (${toolCall.id}) has empty arguments string`);
                        }
                    } catch (error) {
                        // Log the parse failure — silent {} fallback masks real bugs
                        this.logger.error(`❌ JSON parse failed for tool ${toolCall.function.name} (${toolCall.id}) arguments: ${(error as Error).message}. Raw args: "${toolCall.function.arguments?.substring(0, 200)}"`);
                        parsedInput = {};
                    }
                    
                    content.push({
                        type: McpContentType.TOOL_USE,
                        id: toolCall.id,
                        name: toolCall.function.name,
                        input: parsedInput
                    });
                }
            });
        }
        
        // Create MCP response
        const mcpResponse: McpApiResponse = {
            id: response.id,
            type: 'completion',
            role: 'assistant',
            content,
            model: response.model,
            stop_reason: choice.finish_reason || null,
            stop_sequence: null,
            usage: {
                input_tokens: response.usage.prompt_tokens,
                output_tokens: response.usage.completion_tokens,
                total_tokens: response.usage.total_tokens
            }
        };
        
        // Include reasoning if present (for reasoning models like o1, gpt-5, deepseek-reasoner)
        if (messageReasoning && typeof messageReasoning === 'string') {
            mcpResponse.reasoning = messageReasoning;
        }
        
        return mcpResponse;
    }
    
    /**
     * NEW APPROACH: Send message using full agent context
     * 
     * This method structures messages for OpenRouter based on semantic metadata,
     * eliminating the lossy reconstruction cycle.
     * 
     * OpenRouter-specific structuring:
     * - Combines system prompt + agent identity into single system message
     * - Filters conversation to only dialogue and tool results
     * - Applies OpenRouter's reordering for tool results
     * - Skips framework/action messages (already in system context)
     * 
     * @param context - Complete agent context from SDK
     * @param options - Additional OpenRouter-specific options
     * @returns Observable with OpenRouter response
     */
    public sendWithContext(
        context: AgentContext,
        options?: Record<string, any>
    ): Observable<McpApiResponse> {
        // When streaming is requested, return an Observable that emits McpStreamEmission values:
        // N McpStreamChunk emissions followed by 1 final McpApiResponse, then completes.
        // The caller can use `'streaming' in emission` to discriminate chunk vs final.
        if (options?.stream) {
            this.logger.debug('📡 OpenRouter: stream=true detected, using streaming Observable');
            return new Observable<McpApiResponse>(subscriber => {
                this.sendWithContextStreaming(context, options, (chunk: McpStreamChunk) => {
                    // Emit chunks through the same Observable — consumers must cast to McpStreamEmission
                    (subscriber as any).next(chunk);
                })
                    .then(response => {
                        this.logger.debug('📡 OpenRouter: streaming complete, emitting final response');
                        subscriber.next(response);
                        subscriber.complete();
                    })
                    .catch(error => {
                        this.logger.debug(`📡 OpenRouter: streaming error: ${error?.message}`);
                        subscriber.error(error);
                    });
            });
        }

        return new Observable<McpApiResponse>(subscriber => {
            this.sendWithContextImpl(context, options)
                .then(response => {
                    subscriber.next(response);
                    subscriber.complete();
                })
                .catch(error => subscriber.error(error));
        });
    }
    
    /**
     * Implementation of context-based sending for OpenRouter
     */
    private async sendWithContextImpl(
        context: AgentContext,
        options?: Record<string, any>
    ): Promise<McpApiResponse> {

        // Structure messages for OpenRouter based on context (returns OpenRouter format)
        const openRouterMessages = this.structureMessagesFromContext(context);


        // Apply OpenRouter-specific transformations using adapter
        // CRITICAL: This reorders tool results to immediately follow tool calls
        const converter = getMessageConverter('client');
        const transformedMessages = converter.transform(openRouterMessages, MessageFormat.OPENROUTER);


        // Message count may differ if orphaned tool results were dropped - this is expected
        // and prevents API errors when conversation history is cleared between turns
        if (transformedMessages.length !== openRouterMessages.length) {
            this.logger.debug(`Messages adjusted during transformation: ${openRouterMessages.length} → ${transformedMessages.length} (orphaned tool results dropped)`);
        }

        // Messages are already in OpenRouter format - send directly
        return await this.queueRequest(async () => {
            if (!this.networkRecovery) {
                throw new Error('Network recovery not initialized');
            }

            const result = await this.networkRecovery.executeWithRetry(
                () => this.executeOpenRouterRequestDirect(
                    transformedMessages,
                    context.availableTools as any,
                    // agentId rides along for the slow-request WARN and timeout logs
                    { ...options, agentId: context.agentId }
                ),
                extractStatusCodeFromError
            );

            if (!result.success) {
                if (result.circuitBreakerTriggered) {
                    throw new Error(result.error!.message);
                }
                throw result.error?.originalError || new Error(result.error!.message);
            }

            return result.data!;
        });
    }

    /**
     * Streaming variant of sendWithContextImpl.
     * Makes the same request but with `stream: true`, parses SSE chunks,
     * calls onChunk for each partial token, and returns the accumulated final response.
     *
     * Deliberately NOT wrapped in networkRecovery.executeWithRetry: by the time a
     * streaming request fails, chunks may already have been delivered to the
     * consumer via onChunk, and a retry would replay them. Failures — including
     * the idle-watchdog timeout inside executeStreamingRequest — propagate to the
     * caller instead.
     *
     * @param context - Complete agent context from SDK
     * @param options - Additional options (must include stream: true)
     * @param onChunk - Callback invoked for each streaming chunk
     * @returns The final accumulated McpApiResponse
     */
    private async sendWithContextStreaming(
        context: AgentContext,
        options: Record<string, any>,
        onChunk: (chunk: McpStreamChunk) => void
    ): Promise<McpApiResponse> {
        // Structure and transform messages same as non-streaming path
        const openRouterMessages = this.structureMessagesFromContext(context);
        const converter = getMessageConverter('client');
        const transformedMessages = converter.transform(openRouterMessages, MessageFormat.OPENROUTER);

        return await this.queueRequest(async () => {
            return this.executeStreamingRequest(
                transformedMessages,
                context.availableTools as any,
                // agentId rides along for the slow-request WARN and timeout logs
                { ...options, agentId: context.agentId },
                onChunk
            );
        });
    }

    /**
     * Execute an OpenRouter streaming request via SSE.
     * Parses `data:` lines from the SSE stream, emits partial chunks via onChunk,
     * accumulates the full response, and returns a complete McpApiResponse.
     */
    private async executeStreamingRequest(
        openRouterMessages: any[],
        tools?: McpTool[],
        options?: Record<string, any>,
        onChunk?: (chunk: McpStreamChunk) => void
    ): Promise<McpApiResponse> {
        // Build request body (same as executeOpenRouterRequestCore but with stream: true)
        let model = options?.model || this.config.defaultModel || 'openai/gpt-4-turbo';
        const useExacto = options?.useExactoVariant !== false;
        model = this.applyExactoVariant(model, useExacto);

        const temperature = options?.temperature || this.config.temperature || 0.7;
        const maxTokens = options?.maxTokens || this.config.maxTokens || 4096;

        const requestBody: Record<string, any> = {
            model,
            messages: openRouterMessages,
            temperature,
            max_tokens: maxTokens,
            stream: true,
        };

        // Attach reasoning configuration if requested
        this.applyReasoningParam(requestBody, options);

        // Add tools if provided
        const openRouterTools = tools ? this.convertToOpenRouterTools(tools) : undefined;
        if (openRouterTools && openRouterTools.length > 0) {
            requestBody.tools = openRouterTools;
            requestBody.tool_choice = 'auto';
        }

        // Add provider-specific options
        if (options?.providerOptions) {
            Object.assign(requestBody, options.providerOptions);
        }

        const headers = this.buildOpenRouterHeaders(options);

        // Serialize once so the logged request size is exactly what went on the wire
        const requestBodyJson = JSON.stringify(requestBody);
        const requestBytes = Buffer.byteLength(requestBodyJson, 'utf8');
        const agentId = options?.agentId || 'unknown';
        const requestStartedAt = Date.now();
        const slowWatch = this.startSlowRequestWatch('streaming', model, agentId, requestBytes);

        // Idle watchdog for the SSE stream. A healthy stream is never silent for
        // long — OpenRouter emits keepalive comment lines every few seconds while a
        // model is thinking — so silence past streamIdleTimeoutMs means the
        // connection is dead, not that the model is slow. The watchdog is re-armed
        // on every read; there is deliberately NO total-time cap here, because an
        // actively producing stream is healthy no matter how long it runs.
        //
        // Each read (and the initial fetch) races against abortPromise as well as
        // carrying the AbortController signal: the signal cancels the real network
        // request, the race guarantees the await itself resolves even if the
        // underlying stream implementation ignores the abort.
        const controller = new AbortController();
        let headersReceived = false;
        let idleTimer: ReturnType<typeof setTimeout> | undefined;
        const armIdleWatchdog = () => {
            clearTimeout(idleTimer);
            idleTimer = setTimeout(() => controller.abort(), this.streamIdleTimeoutMs);
        };
        // Plain sentinel rejection — enrichment and logging happen exactly once,
        // in the catch blocks below, regardless of whether this promise or the
        // fetch/read rejection wins the race.
        const abortPromise = new Promise<never>((_, reject) => {
            controller.signal.addEventListener('abort', () => {
                const sentinel = new Error('OpenRouter streaming request aborted by idle watchdog');
                sentinel.name = 'AbortError';
                reject(sentinel);
            }, { once: true });
        });

        // Converts an abort/timeout rejection into the logged, non-retryable
        // request-timeout error; returns any other error unchanged.
        const normalizeStreamError = (error: unknown): unknown => {
            if ((error as any)?.isRequestTimeout || !isAbortOrTimeoutError(error)) {
                return error;
            }
            return this.buildRequestTimeoutError({
                kind: 'streaming',
                detail: headersReceived
                    ? `no SSE data for ${this.streamIdleTimeoutMs}ms`
                    : `no response headers within ${this.streamIdleTimeoutMs}ms`,
                model,
                agentId,
                elapsedMs: Date.now() - requestStartedAt,
                limitMs: this.streamIdleTimeoutMs,
                requestBytes,
                messageCount: openRouterMessages.length
            });
        };

        armIdleWatchdog();
        let response: Response;
        try {
            response = await Promise.race([
                fetch(`${this.baseUrl}/chat/completions`, {
                    method: 'POST',
                    headers,
                    body: requestBodyJson,
                    signal: controller.signal
                }),
                abortPromise
            ]);
            headersReceived = true;
            armIdleWatchdog();

            if (!response.ok) {
                const errorText = await response.text();
                const error = new Error(`OpenRouter API error [${response.status}]: ${errorText}`);
                (error as any).status = response.status;
                (error as any).statusCode = response.status;
                throw error;
            }

            if (!response.body) {
                throw new Error('No response body for streaming request');
            }
        } catch (error) {
            clearTimeout(idleTimer);
            slowWatch.finish(false);
            throw normalizeStreamError(error);
        }

        this.logger.debug(`📡 OpenRouter SSE: Response received, status=${response.status}, starting stream parse`);

        // Parse SSE stream and accumulate the full response
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let accumulatedContent = '';
        let accumulatedReasoning = '';
        let responseId = '';
        let responseModel = model;
        let finishReason: string | null = null;
        let promptTokens = 0;
        let completionTokens = 0;
        let totalTokens = 0;
        // Accumulated tool_calls built from streaming deltas
        const toolCallAccumulators: Map<number, { id: string; type: string; functionName: string; functionArgs: string }> = new Map();

        try {
            while (true) {
                // Race against the idle watchdog: reader.read() on a dead
                // connection can otherwise pend forever with nothing logged.
                const { done, value } = await Promise.race([reader.read(), abortPromise]);
                armIdleWatchdog();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });

                // Process complete SSE lines from the buffer
                const lines = buffer.split('\n');
                // Keep the last incomplete line in the buffer
                buffer = lines.pop() || '';

                for (const line of lines) {
                    const trimmed = line.trim();

                    // Skip empty lines and SSE comments
                    if (!trimmed || trimmed.startsWith(':')) continue;

                    // Handle the [DONE] signal
                    if (trimmed === 'data: [DONE]') continue;

                    // Parse data lines
                    if (trimmed.startsWith('data: ')) {
                        const jsonStr = trimmed.slice(6);
                        try {
                            const chunk = JSON.parse(jsonStr);

                            // Extract response metadata from first chunk
                            if (chunk.id && !responseId) {
                                responseId = chunk.id;
                            }
                            if (chunk.model) {
                                responseModel = chunk.model;
                            }

                            // Extract content delta
                            const delta = chunk.choices?.[0]?.delta;
                            const chunkFinishReason = chunk.choices?.[0]?.finish_reason;

                            if (chunkFinishReason) {
                                finishReason = chunkFinishReason;
                            }

                            if (delta) {
                                const contentDelta = delta.content || '';

                                // OpenRouter reasoning can arrive as:
                                // 1. delta.reasoning (string) — some providers
                                // 2. delta.reasoning_content (string) — Anthropic alias
                                // 3. delta.reasoning_details (array of {type, text}) — Anthropic extended thinking
                                let reasoningDelta = delta.reasoning || delta.reasoning_content || '';
                                if (!reasoningDelta && delta.reasoning_details && Array.isArray(delta.reasoning_details)) {
                                    reasoningDelta = delta.reasoning_details
                                        .filter((d: any) => d.text)
                                        .map((d: any) => d.text)
                                        .join('');
                                }

                                if (contentDelta) {
                                    accumulatedContent += contentDelta;
                                    onChunk?.({ streaming: true, content: contentDelta });
                                }
                                if (reasoningDelta) {
                                    accumulatedReasoning += reasoningDelta;
                                    onChunk?.({ streaming: true, reasoning: reasoningDelta });
                                }

                                // Accumulate tool_calls from streaming deltas
                                if (delta.tool_calls && Array.isArray(delta.tool_calls)) {
                                    for (const tc of delta.tool_calls) {
                                        const idx = tc.index ?? 0;
                                        if (!toolCallAccumulators.has(idx)) {
                                            toolCallAccumulators.set(idx, {
                                                id: tc.id || '',
                                                type: tc.type || 'function',
                                                functionName: tc.function?.name || '',
                                                functionArgs: tc.function?.arguments || '',
                                            });
                                        } else {
                                            const acc = toolCallAccumulators.get(idx)!;
                                            if (tc.id) acc.id = tc.id;
                                            if (tc.function?.name) acc.functionName += tc.function.name;
                                            if (tc.function?.arguments) acc.functionArgs += tc.function.arguments;
                                        }
                                    }
                                }
                            }

                            // Extract usage from final chunk (OpenRouter includes it in the last SSE event)
                            if (chunk.usage) {
                                promptTokens = chunk.usage.prompt_tokens || 0;
                                completionTokens = chunk.usage.completion_tokens || 0;
                                totalTokens = chunk.usage.total_tokens || 0;
                            }
                        } catch {
                            // Skip malformed JSON lines — they occasionally happen in SSE streams
                            this.logger.debug(`Skipping malformed SSE data line: ${jsonStr.substring(0, 100)}`);
                        }
                    }
                }
            }
        } catch (error) {
            // Cancel the underlying stream so the connection is torn down; the
            // losing reader.read() from the race is settled by the cancel/abort
            // and its rejection is already observed by Promise.race.
            slowWatch.finish(false);
            reader.cancel().catch(() => undefined);
            throw normalizeStreamError(error);
        } finally {
            clearTimeout(idleTimer);
            slowWatch.finish();
            reader.releaseLock();
        }

        this.logger.debug(`📡 OpenRouter SSE: Stream complete. Content=${accumulatedContent.length}chars, Reasoning=${accumulatedReasoning.length}chars, ToolCalls=${toolCallAccumulators.size}, Finish=${finishReason}`);

        // Build accumulated tool_calls in OpenRouter format for convertToMcpResponse
        const accumulatedToolCalls = Array.from(toolCallAccumulators.values()).map(tc => ({
            id: tc.id,
            type: tc.type as 'function',
            function: {
                name: tc.functionName,
                arguments: tc.functionArgs,
            }
        }));

        // Build a synthetic OpenRouterResponse from accumulated data for convertToMcpResponse
        const syntheticResponse: OpenRouterResponse = {
            id: responseId || `stream-${Date.now()}`,
            model: responseModel,
            created: Math.floor(Date.now() / 1000),
            object: 'chat.completion',
            choices: [{
                index: 0,
                message: {
                    role: 'assistant',
                    content: accumulatedContent,
                    ...(accumulatedToolCalls.length > 0 ? { tool_calls: accumulatedToolCalls } : {}),
                },
                finish_reason: finishReason || 'stop',
            }],
            usage: {
                prompt_tokens: promptTokens,
                completion_tokens: completionTokens,
                total_tokens: totalTokens,
            },
        };

        const mcpResponse = this.convertToMcpResponse(syntheticResponse);

        // Attach accumulated reasoning if present
        if (accumulatedReasoning) {
            mcpResponse.reasoning = accumulatedReasoning;
        }

        return mcpResponse;
    }

    /**
     * Structure messages from AgentContext for OpenRouter
     *
     * Similar to Azure but applies OpenRouter-specific requirements
     */
    private structureMessagesFromContext(context: AgentContext): any[] {
        const messages: any[] = [];
        
        // 1. System message: Combine framework rules + agent identity
        const systemContent = [
            context.systemPrompt,
            '',
            `## Your Agent Identity`,
            `**You are**: ${(context.agentConfig as any).purpose || context.agentConfig.agentId}`,
            `**Your Agent ID**: ${context.agentId}`,
            ...(context.agentConfig.capabilities ? [`**Capabilities**: ${context.agentConfig.capabilities.join(', ')}`] : [])
        ].join('\n');
        
        messages.push({
            role: 'system',
            content: systemContent
        });
        
        // 2. Conversation history: Filter same as Azure for consistency
        // NOTE: Task message is now added AFTER conversation history to maintain chronological order
        // This fixes the bug where subsequent tasks appeared above existing conversation
        const dialogueMessages = context.conversationHistory.filter(msg => {
            const layer = msg.metadata?.contextLayer;
            
            // INCLUDE: SystemLLM messages - they are "held" until the next real prompt
            // and should be bundled with that prompt to provide coordination insights
            // (Previously these were skipped, breaking the SystemLLM flow)
            
            // INCLUDE: Messages with conversation, tool-result, or task layer
            // Task messages must be included to prevent re-injection on every turn
            if (layer === 'conversation' || layer === 'tool-result' || layer === 'task') {
                return true;
            }
            
            // INCLUDE: Tool role messages (always part of tool execution flow)
            if (msg.role === 'tool') {
                return true;
            }
            
            // SKIP: Messages with system/identity/action layers (already in system context)
            if (layer === 'system' || layer === 'identity' || layer === 'action') {
                return false;
            }
            
            // INCLUDE: Messages without contextLayer (legacy or direct additions)
            // These are likely channel messages, system errors, or other important context
            if (!layer && msg.role !== 'system') {
                return true;
            }
            
            // SKIP: Everything else
            return false;
        });
        

        const toolMessagesInDialogue = dialogueMessages.filter(m => m.role === 'tool');
        if (toolMessagesInDialogue.length > 0) {
            toolMessagesInDialogue.forEach((msg, idx) => {
                const size = msg.content?.length || 0;
                const toolName = msg.metadata?.toolName || 'unknown';
            });
        }

        // Convert directly to OpenRouter format (no MCP round-trip)
        // Reordering will be handled by adapter.transform() in sendWithContextImpl
        const openRouterDialogue = dialogueMessages.map(msg => this.convertConversationToOpenRouter(msg));
        messages.push(...openRouterDialogue);
        
        // 3. Task message (if present) - Only inject if NOT already in conversation history
        // Task messages are now included in dialogueMessages, so they appear in their chronological position.
        // This prevents the task from appearing AFTER tool results, which the LLM interprets as a new request.
        const taskAlreadyInHistory = dialogueMessages.some(m =>
            m.content?.includes('## Current Task') ||
            m.metadata?.contextLayer === 'task'
        );
        if (context.currentTask && !taskAlreadyInHistory) {
            messages.push({
                role: 'user',
                content: `## Current Task\n${context.currentTask.description}`
            });
        }
        
        // 4. Recent actions (if needed for context)
        if (context.recentActions.length > 0) {
            const actionsContent = [
                `## Your Recent Actions`,
                ...context.recentActions.map(a => `- ${a.action}${a.result ? `: ${a.result}` : ''}`)
            ].join('\n');
            
            messages.push({
                role: 'user',
                content: actionsContent
            });
        }
        
        return messages;
    }
    
    /**
     * Legacy MCP message path for simple use cases (SystemLlm, etc.)
     * For complex multi-turn conversations with tools, use sendWithContext()
     *
     * @param messages MCP messages
     * @param tools Optional tools
     * @param options Request options
     */
    protected async sendProviderMessage(
        messages: McpMessage[],
        tools?: McpTool[],
        options?: Record<string, any>
    ): Promise<McpApiResponse> {
        // Convert MCP → OpenRouter using adapter
        const converter = getMessageConverter('client');
        const openRouterMessages = converter.convert(
            messages,
            MessageFormat.MCP,
            MessageFormat.OPENROUTER
        );

        // Apply transformations (reordering)
        const transformedMessages = converter.transform(openRouterMessages, MessageFormat.OPENROUTER);


        // Send directly
        return await this.queueRequest(async () => {
            if (!this.networkRecovery) {
                throw new Error('Network recovery not initialized');
            }

            const result = await this.networkRecovery.executeWithRetry(
                () => this.executeOpenRouterRequestDirect(transformedMessages, tools, options),
                extractStatusCodeFromError
            );

            if (!result.success) {
                if (result.circuitBreakerTriggered) {
                    throw new Error(result.error!.message);
                }
                throw result.error?.originalError || new Error(result.error!.message);
            }

            return result.data!;
        });
    }
    
    /**
     * Execute OpenRouter request with messages already in OpenRouter format
     * Used by sendWithContextImpl to avoid lossy MCP round-trip
     */
    private async executeOpenRouterRequestDirect(
        openRouterMessages: any[],
        tools?: McpTool[],
        options?: Record<string, any>
    ): Promise<McpApiResponse> {
        try {
            // Validate inputs
            if (!Array.isArray(openRouterMessages) || openRouterMessages.length === 0) {
                throw new Error('Messages array cannot be empty');
            }

            // Messages are already in OpenRouter format - just convert tools
            const openRouterTools = tools ? this.convertToOpenRouterTools(tools) : undefined;

            return await this.executeOpenRouterRequestCore(openRouterMessages, openRouterTools, options);
        } catch (error) {
            this.logger.error(`OpenRouter request failed: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    }

    /**
     * Core OpenRouter request execution with messages already in OpenRouter format
     */
    private async executeOpenRouterRequestCore(
        openRouterMessages: any[],
        openRouterTools?: any[],
        options?: Record<string, any>
    ): Promise<McpApiResponse> {
        try {
            
            // Prepare request parameters
            let model = options?.model || this.config.defaultModel || 'openai/gpt-4-turbo';

            // Apply Exacto variant if requested for enhanced tool-calling accuracy
            // Default to true for MXF's tool-heavy architecture unless explicitly disabled
            const useExacto = options?.useExactoVariant !== false; // Default: true
            model = this.applyExactoVariant(model, useExacto);

            const temperature = options?.temperature || this.config.temperature || 0.7;
            const maxTokens = options?.maxTokens || this.config.maxTokens || 4096;
            
            // Prepare request body with model name as-is (OpenRouter handles model variants correctly)
            const requestBody: Record<string, any> = {
                model,
                messages: openRouterMessages,
                temperature,
                max_tokens: maxTokens
            };
            
            // Attach reasoning configuration if requested
            this.applyReasoningParam(requestBody, options);
            
            // Add JSON response format if requested
            if (options?.responseFormat === 'json') {
                requestBody.response_format = { type: 'json_object' };
            }
            
            // Add structured output support using OpenRouter's JSON schema feature
            if (options?.providerOptions?.response_format?.type === 'json_schema') {
                requestBody.response_format = {
                    type: 'json_schema',
                    json_schema: {
                        name: options.providerOptions.response_format.json_schema.name,
                        schema: options.providerOptions.response_format.json_schema.schema,
                        strict: options.providerOptions.response_format.json_schema.strict || true
                    }
                };
            }
            
            // Add tools if provided
            if (openRouterTools && openRouterTools.length > 0) {
                requestBody.tools = openRouterTools;
                // In MXF, agents are designed to work through tools, so prefer tool usage
                requestBody.tool_choice = options?.preferToolUse === false 
                    ? 'auto'  // Still allow some flexibility if explicitly disabled
                    : options?.requireToolUse === true 
                        ? { type: 'function', function: { name: openRouterTools[0].function.name } }
                        : 'auto'; // Strong preference for tool usage in MXF
                
            }
            
            // Add provider-specific options if provided
            if (options?.providerOptions) {
                Object.assign(requestBody, options.providerOptions);
            }
            
            // Add HTTP referer and title for OpenRouter tracking/attribution
            // HTTP-Referer is the primary identifier for app attribution
            // X-Title sets the display name in rankings and analytics
            // Both are needed for proper attribution - see https://openrouter.ai/docs/app-attribution
            // Customize via OPENROUTER_APP_TITLE / OPENROUTER_APP_URL env vars when
            // embedding MXF in another application.
            const headers = this.buildOpenRouterHeaders(options);
            
            // Log basic request info
            // console.log ('')
            // console.log(`🚀 OpenRouter request: ${requestBody.tools?.length || 0} tools`);
            // console.log(JSON.stringify(requestBody));
            // console.log ('')
            

            // console.log(`\n🔧 REQUEST HAS ${requestBody.tools?.length || 0} TOOLS`);
            if (requestBody.tools && requestBody.tools.length > 0) {
                // console.log(`   Tools: ${requestBody.tools.map((t: any) => t.function.name).join(', ')}`);
            }

            // Serialize once so the logged request size is exactly what went on the wire
            const requestBodyJson = JSON.stringify(requestBody);
            const requestBytes = Buffer.byteLength(requestBodyJson, 'utf8');
            const agentId = options?.agentId || 'unknown';
            const requestStartedAt = Date.now();
            const slowWatch = this.startSlowRequestWatch('completion', model, agentId, requestBytes);

            let responseText: string;
            try {
                // AbortSignal.timeout bounds the entire request — connect, headers,
                // and body read — so a hung connection surfaces as an error instead
                // of indefinite silence. Reasoning models can legitimately take
                // minutes; the default limit is sized for that (see initializeProvider).
                const response = await fetch(`${this.baseUrl}/chat/completions`, {
                    method: 'POST',
                    headers,
                    body: requestBodyJson,
                    signal: AbortSignal.timeout(this.requestTimeoutMs)
                });

                // Check for errors with enhanced error information
                if (!response.ok) {
                    let errorText = await response.text();
                    this.logger.error(`🔧 DEBUG: Error response text: ${errorText}`);

                    let errorMessage = errorText;
                    let rateLimitInfo: Record<string, any> = {};

                    try {
                        const errorJson = JSON.parse(errorText);
                        errorMessage = errorJson.error?.message || errorText;

                        // Extract rate limit information if available
                        if (response.status === 429) {
                            rateLimitInfo = {
                                retryAfter: response.headers.get('retry-after'),
                                rateLimitLimit: response.headers.get('x-ratelimit-limit'),
                                rateLimitRemaining: response.headers.get('x-ratelimit-remaining'),
                                rateLimitReset: response.headers.get('x-ratelimit-reset')
                            };
                        }
                    } catch (e) {
                        // Use error text as is if not JSON
                    }

                    // Create detailed error with status code
                    const error = new Error(`OpenRouter API error [${response.status}]: ${errorMessage}`);
                    (error as any).status = response.status;
                    (error as any).statusCode = response.status;
                    (error as any).rateLimitInfo = rateLimitInfo;

                    throw error;
                }

                // Get response text for JSON parsing
                responseText = await response.text();
                slowWatch.finish();
            } catch (error) {
                slowWatch.finish(false);
                if (isAbortOrTimeoutError(error)) {
                    throw this.buildRequestTimeoutError({
                        kind: 'completion',
                        detail: 'no response within the request timeout',
                        model,
                        agentId,
                        elapsedMs: Date.now() - requestStartedAt,
                        limitMs: this.requestTimeoutMs,
                        requestBytes,
                        messageCount: openRouterMessages.length
                    });
                }
                throw error;
            }
            
            // Check if response is empty
            if (!responseText || responseText.length === 0) {
                this.logger.error('🔧 ERROR: Empty response from OpenRouter API');
                throw new Error('Empty response from OpenRouter API');
            }
            
            const trimmedResponseText = responseText.trim();
            
            // Only log if there's significant whitespace trimming
            if (trimmedResponseText.length < responseText.length - 10) {
            }
            
            // Parse JSON response using utility with recovery strategies
            const parseResult = this.jsonRecovery.parseWithRecovery<OpenRouterResponse>(trimmedResponseText);
            
            if (!parseResult.success || !parseResult.data) {
                throw parseResult.error || new Error('Failed to parse OpenRouter response: No valid JSON could be obtained');
            }
            
            const openRouterResponse = parseResult.data;
            
            return this.convertToMcpResponse(openRouterResponse);
        } catch (error) {
            // Request timeouts are already logged with full context and must keep
            // their name/flags so NetworkRecovery classifies them as non-retryable.
            if ((error as any)?.isRequestTimeout === true) {
                throw error;
            }
            this.logger.error(`🔧 ERROR in executeOpenRouterRequest: ${error instanceof Error ? error.message : String(error)}`);
            if (error instanceof Error && error.stack) {
                this.logger.error(`🔧 ERROR STACK: ${error.stack}`);
            }
            throw new Error(`Error processing OpenRouter request: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
}
