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
 * MxfPromptsManager
 *
 * Manages MCP prompt discovery, caching, argument resolution, and composition.
 * Provides the core functionality for the MCP Prompts integration in MXF.
 */

import { Logger } from '../../shared/utils/Logger';
import { EventEmitter } from 'events';
import {
    PromptDefinition,
    ResolvedPrompt,
    PromptCacheStats,
    MxfPromptsConfig,
    PromptResolutionContext,
    ArgumentResolutionResult,
    ArgumentResolutionSource,
    PromptsListRequest,
    PromptsListResponse,
    PromptsGetRequest,
    PromptsGetResponse,
    PromptMessage,
    PromptContent,
    PromptTextContent,
    PromptArgument
} from '../../shared/types/McpPromptTypes';
import { estimateTokens } from '../../shared/utils/TokenEstimator';
import { PromptArgumentInferenceService } from '../../shared/services/PromptArgumentInferenceService';

/**
 * Cache entry for prompt definitions
 */
interface PromptCacheEntry {
    /** Cached prompt definition */
    definition: PromptDefinition;
    /** Timestamp when cached */
    cachedAt: number;
    /** TTL in milliseconds */
    ttl: number;
}

/**
 * MCP Server Client Interface (minimal interface for prompts operations)
 */
interface IMcpServerClient {
    /** Server identifier */
    id: string;
    /** Send a JSON-RPC request to the server */
    sendRequest(method: string, params: any): Promise<any>;
    /** Check if server is connected */
    isConnected(): boolean;
}

/**
 * Manager for MCP Prompts integration
 */
export class MxfPromptsManager extends EventEmitter {
    private logger: Logger;
    private config: MxfPromptsConfig;
    private mcpClients: Map<string, IMcpServerClient> = new Map();
    private promptCache: Map<string, PromptCacheEntry> = new Map();
    private cacheStats: PromptCacheStats = {
        hits: 0,
        misses: 0,
        size: 0,
        maxSize: 1000,
        hitRate: 0.0
    };
    private discoveryTimer?: NodeJS.Timeout;
    private argumentResolver: PromptArgumentResolver;

    constructor(config?: Partial<MxfPromptsConfig>) {
        super();
        this.logger = new Logger('info', 'MxfPromptsManager', 'client');

        // Initialize configuration with defaults
        this.config = {
            enabled: config?.enabled ?? true,
            cache: {
                strategy: config?.cache?.strategy ?? 'memory',
                ttlSeconds: config?.cache?.ttlSeconds ?? 300,
                maxEntries: config?.cache?.maxEntries ?? 1000
            },
            discovery: {
                refreshIntervalSeconds: config?.discovery?.refreshIntervalSeconds ?? 60,
                timeoutMs: config?.discovery?.timeoutMs ?? 5000
            },
            resolution: {
                maxEmbeddedResourceSize: config?.resolution?.maxEmbeddedResourceSize ?? 1024 * 1024, // 1MB
                allowedResourceSchemes: config?.resolution?.allowedResourceSchemes ?? ['resource://', 'file://']
            },
            mxpIntegration: {
                compressEmbeddedResources: config?.mxpIntegration?.compressEmbeddedResources ?? true,
                trackTokenUsage: config?.mxpIntegration?.trackTokenUsage ?? true
            }
        };

        this.cacheStats.maxSize = this.config.cache.maxEntries;
        this.argumentResolver = new PromptArgumentResolver(this.logger);

        this.logger.info('MxfPromptsManager initialized', { config: this.config });
    }

    /**
     * Register an MCP server client for prompt discovery
     */
    public registerMcpClient(client: IMcpServerClient): void {
        if (!this.config.enabled) {
            this.logger.warn('Prompts feature is disabled, skipping client registration');
            return;
        }

        this.mcpClients.set(client.id, client);
        this.logger.info(`Registered MCP client for prompts: ${client.id}`);

        // Trigger discovery for this client
        this.discoverPromptsFromClient(client.id).catch(error => {
            this.logger.error(`Error discovering prompts from ${client.id}:`, error);
        });
    }

    /**
     * Unregister an MCP server client
     */
    public unregisterMcpClient(serverId: string): void {
        this.mcpClients.delete(serverId);
        this.invalidateCache(serverId);
        this.logger.info(`Unregistered MCP client: ${serverId}`);
    }

    /**
     * Start periodic prompt discovery
     */
    public startPeriodicDiscovery(): void {
        if (!this.config.enabled) {
            return;
        }

        const intervalMs = this.config.discovery.refreshIntervalSeconds * 1000;

        this.discoveryTimer = setInterval(() => {
            this.discoverAllPrompts().catch(error => {
                this.logger.error('Error in periodic prompt discovery:', error);
            });
        }, intervalMs);

        this.logger.info(`Started periodic prompt discovery (interval: ${intervalMs}ms)`);
    }

    /**
     * Stop periodic prompt discovery
     */
    public stopPeriodicDiscovery(): void {
        if (this.discoveryTimer) {
            clearInterval(this.discoveryTimer);
            this.discoveryTimer = undefined;
            this.logger.info('Stopped periodic prompt discovery');
        }
    }

    /**
     * List all available prompts from all servers or a specific server
     */
    public async listPrompts(serverId?: string): Promise<PromptDefinition[]> {
        if (!this.config.enabled) {
            throw new Error('Prompts feature is disabled');
        }

        const allPrompts: PromptDefinition[] = [];

        if (serverId) {
            // List prompts from specific server
            const prompts = await this.discoverPromptsFromClient(serverId);
            allPrompts.push(...prompts);
        } else {
            // List prompts from all servers
            for (const clientId of this.mcpClients.keys()) {
                try {
                    const prompts = await this.discoverPromptsFromClient(clientId);
                    allPrompts.push(...prompts);
                } catch (error) {
                    this.logger.error(`Error listing prompts from ${clientId}:`, error);
                }
            }
        }

        return allPrompts;
    }

    /**
     * Get a prompt by name and resolve it with arguments
     */
    public async getPrompt(
        name: string,
        context?: PromptResolutionContext
    ): Promise<ResolvedPrompt> {
        if (!this.config.enabled) {
            throw new Error('Prompts feature is disabled');
        }

        // Find the prompt definition
        const definition = await this.findPromptDefinition(name);
        if (!definition) {
            throw new Error(`Prompt not found: ${name}`);
        }

        // Resolve arguments
        const resolvedArgs = await this.argumentResolver.resolveArguments(
            definition,
            context
        );

        // Get the MCP client for this prompt
        const client = this.mcpClients.get(definition.serverId);
        if (!client || !client.isConnected()) {
            throw new Error(`MCP server not available: ${definition.serverId}`);
        }

        // Request the prompt from the server
        const request: PromptsGetRequest = {
            name: definition.name,
            arguments: resolvedArgs
        };

        const response = await this.sendPromptRequest<PromptsGetResponse>(
            client,
            'prompts/get',
            request
        );

        // Convert to ResolvedPrompt format
        const messages: PromptMessage[] = response.messages.map(msg => ({
            role: msg.role,
            content: msg.content
        }));

        // Estimate token count
        const tokenEstimate = this.estimateTokenCount(messages);

        const resolved: ResolvedPrompt = {
            description: response.description,
            messages,
            metadata: {
                resolvedAt: new Date(),
                serverId: definition.serverId,
                tokenEstimate,
                argumentsUsed: resolvedArgs
            }
        };

        this.logger.info(`Resolved prompt: ${name}`, {
            serverId: definition.serverId,
            tokenEstimate,
            argsUsed: Object.keys(resolvedArgs).length
        });

        return resolved;
    }

    /**
     * Compose multiple prompts into a single resolved prompt
     */
    public async composePrompts(
        names: string[],
        sharedArgs?: Record<string, unknown>
    ): Promise<ResolvedPrompt> {
        if (!this.config.enabled) {
            throw new Error('Prompts feature is disabled');
        }

        if (names.length === 0) {
            throw new Error('At least one prompt name is required');
        }

        // Resolve each prompt
        const resolvedPrompts: ResolvedPrompt[] = [];
        for (const name of names) {
            const context: PromptResolutionContext = {
                explicitArgs: sharedArgs
            };
            const resolved = await this.getPrompt(name, context);
            resolvedPrompts.push(resolved);
        }

        // Combine messages
        const allMessages: PromptMessage[] = [];
        let totalTokens = 0;
        const allArgsUsed: Record<string, unknown> = {};

        for (const prompt of resolvedPrompts) {
            allMessages.push(...prompt.messages);
            totalTokens += prompt.metadata.tokenEstimate;
            Object.assign(allArgsUsed, prompt.metadata.argumentsUsed);
        }

        // Create composed prompt
        const composed: ResolvedPrompt = {
            description: `Composed prompt from: ${names.join(', ')}`,
            messages: allMessages,
            metadata: {
                resolvedAt: new Date(),
                serverId: 'composed',
                tokenEstimate: totalTokens,
                argumentsUsed: allArgsUsed
            }
        };

        this.logger.info(`Composed ${names.length} prompts`, {
            names,
            totalTokens,
            messageCount: allMessages.length
        });

        return composed;
    }

    /**
     * Invalidate cache for a specific server or all servers
     */
    public invalidateCache(serverId?: string): void {
        if (serverId) {
            // Remove entries for specific server
            const keys = Array.from(this.promptCache.keys());
            for (const key of keys) {
                const entry = this.promptCache.get(key);
                if (entry && entry.definition.serverId === serverId) {
                    this.promptCache.delete(key);
                    this.cacheStats.size--;
                }
            }
            this.logger.info(`Invalidated cache for server: ${serverId}`);
        } else {
            // Clear all cache
            this.promptCache.clear();
            this.cacheStats.size = 0;
            this.logger.info('Invalidated all prompt cache');
        }

        this.updateCacheStats();
    }

    /**
     * Get cache statistics
     */
    public getCacheStats(): PromptCacheStats {
        return { ...this.cacheStats };
    }

    /**
     * Discover prompts from a specific client
     */
    private async discoverPromptsFromClient(serverId: string): Promise<PromptDefinition[]> {
        const client = this.mcpClients.get(serverId);
        if (!client) {
            throw new Error(`MCP client not found: ${serverId}`);
        }

        if (!client.isConnected()) {
            throw new Error(`MCP client not connected: ${serverId}`);
        }

        const allPrompts: PromptDefinition[] = [];
        let cursor: string | null | undefined = null;

        // Paginated discovery
        do {
            const request: PromptsListRequest = { cursor };
            const response = await this.sendPromptRequest<PromptsListResponse>(
                client,
                'prompts/list',
                request
            );

            // Add serverId to each prompt
            const prompts = response.prompts.map(p => ({
                ...p,
                serverId
            }));

            allPrompts.push(...prompts);

            // Cache the prompts
            for (const prompt of prompts) {
                this.cachePromptDefinition(prompt);
            }

            cursor = response.nextCursor;
        } while (cursor);

        this.logger.info(`Discovered ${allPrompts.length} prompts from ${serverId}`);

        // Emit discovery event
        this.emit('promptsDiscovered', { serverId, prompts: allPrompts });

        return allPrompts;
    }

    /**
     * Discover prompts from all clients
     */
    private async discoverAllPrompts(): Promise<void> {
        for (const serverId of this.mcpClients.keys()) {
            try {
                await this.discoverPromptsFromClient(serverId);
            } catch (error) {
                this.logger.error(`Error discovering prompts from ${serverId}:`, error);
            }
        }
    }

    /**
     * Find a prompt definition by name (checks cache first)
     */
    private async findPromptDefinition(name: string): Promise<PromptDefinition | null> {
        // Check cache first
        const cached = this.getCachedPrompt(name);
        if (cached) {
            this.cacheStats.hits++;
            this.updateCacheStats();
            return cached.definition;
        }

        this.cacheStats.misses++;
        this.updateCacheStats();

        // Search across all servers
        for (const serverId of this.mcpClients.keys()) {
            try {
                const prompts = await this.discoverPromptsFromClient(serverId);
                const found = prompts.find(p => p.name === name);
                if (found) {
                    return found;
                }
            } catch (error) {
                this.logger.error(`Error finding prompt from ${serverId}:`, error);
            }
        }

        return null;
    }

    /**
     * Cache a prompt definition
     */
    private cachePromptDefinition(definition: PromptDefinition): void {
        if (this.config.cache.strategy === 'none') {
            return;
        }

        const key = `${definition.serverId}:${definition.name}`;
        const ttl = this.config.cache.ttlSeconds * 1000;

        // Check cache size limit
        if (this.promptCache.size >= this.config.cache.maxEntries) {
            // Remove oldest entry
            const oldestKey = Array.from(this.promptCache.keys())[0];
            this.promptCache.delete(oldestKey);
            this.cacheStats.size--;
        }

        this.promptCache.set(key, {
            definition,
            cachedAt: Date.now(),
            ttl
        });

        this.cacheStats.size++;
    }

    /**
     * Get a cached prompt if available and not expired
     */
    private getCachedPrompt(name: string): PromptCacheEntry | null {
        if (this.config.cache.strategy === 'none') {
            return null;
        }

        // Search for prompt by name across all servers in cache
        for (const [key, entry] of this.promptCache.entries()) {
            if (entry.definition.name === name) {
                // Check if expired
                if (Date.now() - entry.cachedAt > entry.ttl) {
                    this.promptCache.delete(key);
                    this.cacheStats.size--;
                    return null;
                }
                return entry;
            }
        }

        return null;
    }

    /**
     * Send a prompt-related request to an MCP server
     */
    private async sendPromptRequest<T>(
        client: IMcpServerClient,
        method: string,
        params: any
    ): Promise<T> {
        const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => {
                reject(new Error(`Prompt request timeout: ${method}`));
            }, this.config.discovery.timeoutMs);
        });

        const requestPromise = client.sendRequest(method, params);

        return Promise.race([requestPromise, timeoutPromise]) as Promise<T>;
    }

    /**
     * Estimate token count for prompt messages
     */
    private estimateTokenCount(messages: PromptMessage[]): number {
        let total = 0;

        for (const message of messages) {
            const contents = Array.isArray(message.content) ? message.content : [message.content];

            for (const content of contents) {
                if (content.type === 'text') {
                    const textContent = content as PromptTextContent;
                    total += estimateTokens(textContent.text);
                } else {
                    // Rough estimate for non-text content
                    total += 100;
                }
            }
        }

        return total;
    }

    /**
     * Update cache statistics
     */
    private updateCacheStats(): void {
        const totalRequests = this.cacheStats.hits + this.cacheStats.misses;
        this.cacheStats.hitRate = totalRequests > 0 ? this.cacheStats.hits / totalRequests : 0.0;
    }

    /**
     * Cleanup resources
     */
    public async cleanup(): Promise<void> {
        this.stopPeriodicDiscovery();
        this.mcpClients.clear();
        this.promptCache.clear();
        this.removeAllListeners();
        this.logger.info('MxfPromptsManager cleaned up');
    }
}

/**
 * Helper class for resolving prompt arguments from various sources
 */
class PromptArgumentResolver {
    private logger: Logger;
    private inferenceService: PromptArgumentInferenceService;

    constructor(logger: Logger) {
        this.logger = logger;
        this.inferenceService = PromptArgumentInferenceService.getInstance();
    }

    /**
     * Resolve arguments for a prompt from the provided context
     */
    public async resolveArguments(
        definition: PromptDefinition,
        context?: PromptResolutionContext
    ): Promise<Record<string, unknown>> {
        const resolved: Record<string, unknown> = {};
        const resolutionDetails: Record<string, ArgumentResolutionResult> = {};

        if (!definition.arguments) {
            return resolved;
        }

        // First pass: resolve from available sources
        const unresolvedArgs: PromptArgument[] = [];

        for (const arg of definition.arguments) {
            const result = await this.resolveArgument(arg.name, arg, context);
            if (result) {
                resolved[arg.name] = result.value;
                resolutionDetails[arg.name] = result;
            } else {
                unresolvedArgs.push(arg);
            }
        }

        // Second pass: try SystemLLM inference for unresolved required arguments
        if (unresolvedArgs.length > 0 && context) {
            this.logger.debug(`Attempting SystemLLM inference for ${unresolvedArgs.length} unresolved arguments`);

            const inferredResults = await this.inferenceService.inferArguments(
                unresolvedArgs,
                definition.name,
                context
            );

            for (const [argName, result] of inferredResults.entries()) {
                resolved[argName] = result.value;
                resolutionDetails[argName] = result;
            }
        }

        // Final validation: check required arguments
        for (const arg of definition.arguments) {
            if (arg.required && resolved[arg.name] === undefined) {
                throw new Error(`Required argument not resolved: ${arg.name}`);
            }
        }

        this.logger.debug('Resolved prompt arguments', {
            promptName: definition.name,
            resolved: Object.keys(resolved),
            sources: Object.entries(resolutionDetails).map(([name, res]) => ({
                name,
                source: res.source,
                confidence: res.confidence
            }))
        });

        return resolved;
    }

    /**
     * Resolve a single argument from available sources
     */
    private async resolveArgument(
        name: string,
        arg: { name: string; required?: boolean; defaultValue?: unknown },
        context?: PromptResolutionContext
    ): Promise<ArgumentResolutionResult | null> {
        // Priority order for argument resolution:
        // 1. Explicit arguments
        // 2. Task context
        // 3. Agent context
        // 4. Channel context
        // 5. Default value

        // Check explicit arguments
        if (context?.explicitArgs?.[name] !== undefined) {
            return {
                value: context.explicitArgs[name],
                source: ArgumentResolutionSource.EXPLICIT,
                confidence: 1.0
            };
        }

        // Check task context
        if (context?.taskContext?.[name] !== undefined) {
            return {
                value: context.taskContext[name],
                source: ArgumentResolutionSource.TASK_CONTEXT,
                confidence: 0.9
            };
        }

        // Check agent context
        if (context?.agentContext?.[name] !== undefined) {
            return {
                value: context.agentContext[name],
                source: ArgumentResolutionSource.AGENT_CONTEXT,
                confidence: 0.8
            };
        }

        // Check channel context
        if (context?.channelContext?.[name] !== undefined) {
            return {
                value: context.channelContext[name],
                source: ArgumentResolutionSource.CHANNEL_CONTEXT,
                confidence: 0.7
            };
        }

        // Use default value if available
        if (arg.defaultValue !== undefined) {
            return {
                value: arg.defaultValue,
                source: ArgumentResolutionSource.DEFAULT,
                confidence: 1.0
            };
        }

        // SystemLLM inference would go here in future enhancement
        // For now, return null if no source found

        return null;
    }
}
