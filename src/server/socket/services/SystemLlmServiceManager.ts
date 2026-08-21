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
 * SystemLlmServiceManager
 * 
 * Manages per-channel instances of SystemLlmService to provide isolation
 * and prevent bottlenecks in high-scale multi-channel environments.
 * 
 * Key features:
 * - One SystemLlmService instance per channel
 * - Lazy instantiation when first needed
 * - Automatic cleanup when channels are destroyed
 * - Thread-safe operations
 * - Monitoring and metrics support
 */

import { Logger } from '@mxf-dev/core/utils/Logger';
import { ChannelId } from '@mxf-dev/core/types/ChannelContext';
import { SystemLlmService, SystemLlmServiceConfig, OrparModelConfig, OrparOperationType } from './SystemLlmService';
import { SystemLlmBudgetService, BudgetStatus } from './SystemLlmBudgetService';
import { EventBus } from '@mxf-dev/core/events/EventBus';
import { Events } from '@mxf-dev/core/events/EventNames';
import { LlmProviderType } from '@mxf-dev/core/protocols/mcp/LlmProviders';
import { ConfigManager } from '@mxf-dev/core/config/ConfigManager';
import { Subscription } from 'rxjs';
import { requireEnv } from '@mxf-dev/core/utils/env';

const logger = new Logger('debug', 'SystemLlmServiceManager', 'server');

/**
 * Metrics for a channel's LLM service usage
 */
export interface ChannelLlmMetrics {
    channelId: ChannelId;
    requestCount: number;
    totalResponseTime: number;
    avgResponseTime: number;
    errorCount: number;
    lastRequestTime: Date | null;
    operationBreakdown: {
        observation: number;
        reasoning: number;
        planning: number;
        action: number;
        reflection: number;
    };
}

/**
 * Manager for per-channel SystemLlmService instances
 */
const PROVIDER_BY_NAME: Record<string, LlmProviderType> = {
    'openrouter': LlmProviderType.OPENROUTER,
    'azure-openai': LlmProviderType.AZURE_OPENAI,
    'openai': LlmProviderType.OPENAI,
    'anthropic': LlmProviderType.ANTHROPIC,
    'gemini': LlmProviderType.GEMINI,
    'xai': LlmProviderType.XAI,
    'ollama': LlmProviderType.OLLAMA
};

/** Per-operation model variables; each overrides SYSTEMLLM_DEFAULT_MODEL for one operation. */
const OPERATION_MODEL_ENV: Record<OrparOperationType, string> = {
    observation: 'SYSTEMLLM_MODEL_OBSERVATION',
    reasoning: 'SYSTEMLLM_MODEL_REASONING',
    action: 'SYSTEMLLM_MODEL_ACTION',
    planning: 'SYSTEMLLM_MODEL_PLANNING',
    reflection: 'SYSTEMLLM_MODEL_REFLECTION'
};

/** SystemLLM is on unless SYSTEMLLM_ENABLED is exactly 'false'. */
export const isSystemLlmEnabled = (): boolean => process.env.SYSTEMLLM_ENABLED !== 'false';

const parseProviderType = (provider: string): LlmProviderType => {
    const providerType = PROVIDER_BY_NAME[provider];
    if (!providerType) {
        throw new Error(
            `Unsupported SYSTEMLLM_PROVIDER '${provider}'. Expected one of: ` +
            Object.keys(PROVIDER_BY_NAME).join(', ')
        );
    }
    return providerType;
};

/** Provider credentials must be present before any channel starts work. */
const assertProviderEnvironment = (providerType: LlmProviderType): void => {
    switch (providerType) {
        case LlmProviderType.OPENROUTER:
            requireEnv('OPENROUTER_API_KEY', 'Required while SystemLLM uses OpenRouter.');
            return;
        case LlmProviderType.OPENAI:
            requireEnv('OPENAI_API_KEY', 'Required while SystemLLM uses OpenAI.');
            return;
        case LlmProviderType.ANTHROPIC:
            requireEnv('ANTHROPIC_API_KEY', 'Required while SystemLLM uses Anthropic.');
            return;
        case LlmProviderType.GEMINI:
            requireEnv('GEMINI_API_KEY', 'Required while SystemLLM uses Gemini.');
            return;
        case LlmProviderType.XAI:
            requireEnv('XAI_API_KEY', 'Required while SystemLLM uses xAI.');
            return;
        case LlmProviderType.AZURE_OPENAI:
            requireEnv('AZURE_OPENAI_API_KEY', 'Required while SystemLLM uses Azure OpenAI.');
            requireEnv('AZURE_OPENAI_ENDPOINT', 'Required while SystemLLM uses Azure OpenAI.');
            requireEnv(
                'AZURE_OPENAI_DEPLOYMENT_NAME',
                'Required while SystemLLM uses Azure OpenAI.'
            );
            return;
        case LlmProviderType.OLLAMA:
            return;
        default:
            throw new Error(`Unsupported SystemLLM provider type '${providerType}'`);
    }
};

/**
 * Read SystemLLM configuration from the environment.
 *
 * Returns null when SystemLLM is off. When it is on, the provider's
 * credentials and SYSTEMLLM_DEFAULT_MODEL are required — there are no
 * built-in model ids — and each SYSTEMLLM_MODEL_<OPERATION> variable, when
 * set, overrides the default for that ORPAR operation. A variable that is
 * set but blank is an error, not a silent fall-through to the default.
 *
 * @throws Error naming the missing or invalid variable
 */
export const loadSystemLlmEnvironmentConfig = (): SystemLlmServiceConfig | null => {
    if (!isSystemLlmEnabled()) {
        return null;
    }

    const providerType = parseProviderType(process.env.SYSTEMLLM_PROVIDER?.toLowerCase() || 'openrouter');
    assertProviderEnvironment(providerType);
    const defaultModel = requireEnv(
        'SYSTEMLLM_DEFAULT_MODEL',
        'SystemLLM is on and has no built-in model. Set the model it should use ' +
        '(for example ~anthropic/claude-sonnet-latest on OpenRouter), or set SYSTEMLLM_ENABLED=false.'
    ).trim();

    const orparModels: Partial<OrparModelConfig> = {};
    for (const [operation, variable] of Object.entries(OPERATION_MODEL_ENV) as Array<[OrparOperationType, string]>) {
        const value = process.env[variable];
        if (value === undefined) {
            continue;
        }
        if (value.trim().length === 0) {
            throw new Error(`${variable} is set but blank. Name a model, or remove it to use SYSTEMLLM_DEFAULT_MODEL.`);
        }
        orparModels[operation] = value.trim();
    }

    return {
        providerType,
        defaultModel,
        orparModels,
        defaultTemperature: 0.7,
        defaultMaxTokens: 4096
    };
};

/**
 * Fail at startup, before any service initializes, when SystemLLM is on and
 * its provider credentials or model are not configured.
 */
export const assertSystemLlmConfigured = (): void => {
    loadSystemLlmEnvironmentConfig();
};

export class SystemLlmServiceManager {
    private static instance: SystemLlmServiceManager | undefined;
    private services: Map<ChannelId, SystemLlmService> = new Map();
    /** Env- or caller-derived defaults; null while SystemLLM is off. */
    private defaultConfig: SystemLlmServiceConfig | null;
    private cleanupListenerRegistered = false;
    private cleanupSubscriptions: Subscription[] = [];
    private channelCleanupTimers = new Set<NodeJS.Timeout>();
    private isShutdown = false;

    /**
     * Private constructor for singleton pattern
     */
    private constructor(defaultConfig?: SystemLlmServiceConfig) {
        if (!isSystemLlmEnabled()) {
            // getServiceForChannel() returns null while SystemLLM is off, so no
            // service is ever built from this.
            this.defaultConfig = null;
            return;
        }

        // Explicit config (tests, embedding) must name its own model; the
        // environment is the source otherwise, validated at boot by
        // assertSystemLlmConfigured() and again here.
        this.defaultConfig = defaultConfig ?? loadSystemLlmEnvironmentConfig();

        // Register cleanup listeners
        this.registerCleanupListeners();
    }
    
    /**
     * Get the singleton instance
     */
    public static getInstance(defaultConfig?: SystemLlmServiceConfig): SystemLlmServiceManager {
        if (!SystemLlmServiceManager.instance) {
            SystemLlmServiceManager.instance = new SystemLlmServiceManager(defaultConfig);
        }
        return SystemLlmServiceManager.instance;
    }

    /**
     * Get or create a SystemLlmService instance for a channel
     *
     * Returns null when SystemLLM is off for this process, off for this channel,
     * or when the daily spend ceiling has been reached. Callers already treat null
     * as "no SystemLLM available" and take their heuristic path, so the budget
     * ceiling degrades the system the same way an unconfigured provider does —
     * rather than by quietly spending more money.
     *
     * @param channelId - Channel the service is for
     * @param config - Optional per-channel overrides, layered over the configured defaults
     * @returns The service, or null when SystemLLM must not be used
     */
    public getServiceForChannel(channelId: ChannelId, config?: Partial<SystemLlmServiceConfig>): SystemLlmService | null {
        if (this.isShutdown) {
            throw new Error('SystemLlmServiceManager is shut down');
        }

        // Check if SystemLLM is globally disabled via environment
        if (!isSystemLlmEnabled()) {

            // Clean up existing service if present
            if (this.services.has(channelId)) {
                this.removeServiceForChannel(channelId);
            }

            return null;
        }

        // Hard spend ceiling. SystemLlmService checks again immediately before each
        // request — this gate stops new work being started, that one stops work
        // already holding a service reference.
        if (SystemLlmBudgetService.getInstance().isExhausted()) {
            logger.warn(
                `SystemLLM daily budget exhausted — refusing to start SystemLLM work for channel ${channelId}`
            );
            return null;
        }

        // Check if SystemLLM is disabled for this specific channel via config
        const configManager = ConfigManager.getInstance();
        if (!configManager.isChannelSystemLlmEnabled(channelId)) {

            // CRITICAL: Remove existing service if config says it should be disabled
            if (this.services.has(channelId)) {
                this.removeServiceForChannel(channelId);
            }

            return null;
        }

        // Check if service already exists
        let service = this.services.get(channelId);

        if (!service) {
            if (!this.defaultConfig) {
                throw new Error('SystemLLM configuration is not loaded: SYSTEMLLM_ENABLED changed after boot');
            }
            // Per-channel overrides layer over the env-derived defaults, so a
            // channel that only tunes temperature keeps the configured model.
            const serviceConfig: SystemLlmServiceConfig = { ...this.defaultConfig, ...config };
            service = new SystemLlmService(channelId, serviceConfig);

            this.services.set(channelId, service);

        }

        return service;
    }

    /**
     * Remove a service instance for a channel
     */
    public removeServiceForChannel(channelId: ChannelId): void {
        const service = this.services.get(channelId);
        if (!service) {
            return;
        }

        // Remove first so re-entrant lifecycle events cannot retrieve an instance
        // that is already shutting down, then release every listener/timer it owns.
        this.services.delete(channelId);
        service.cleanupAll();
    }

    /**
     * Get statistics about managed services with detailed metrics
     */
    public getStats(): {
        totalInstances: number;
        channelIds: string[];
        channelMetrics: Map<string, ChannelLlmMetrics>;
        totalRequests: number;
        avgResponseTime: number;
    } {
        const channelMetrics = new Map<string, ChannelLlmMetrics>();
        let totalRequests = 0;
        let totalResponseTime = 0;

        // Collect metrics from each service instance
        for (const channelId of this.services.keys()) {
            const metrics = this.getServiceMetrics(channelId);
            channelMetrics.set(channelId, metrics);
            totalRequests += metrics.requestCount;
            totalResponseTime += metrics.totalResponseTime;
        }

        return {
            totalInstances: this.services.size,
            channelIds: Array.from(this.services.keys()),
            channelMetrics,
            totalRequests,
            avgResponseTime: totalRequests > 0 ? totalResponseTime / totalRequests : 0
        };
    }

    /**
     * Get metrics for a specific channel's LLM service
     */
    public getServiceMetrics(channelId: ChannelId): ChannelLlmMetrics {
        const service = this.services.get(channelId);
        if (!service) {
            return {
                channelId,
                requestCount: 0,
                totalResponseTime: 0,
                avgResponseTime: 0,
                errorCount: 0,
                lastRequestTime: null,
                operationBreakdown: {
                    observation: 0,
                    reasoning: 0,
                    planning: 0,
                    action: 0,
                    reflection: 0
                }
            };
        }

        // Get actual metrics from the service
        const metrics = service.getMetrics();
        return {
            channelId,
            requestCount: metrics.requestCount,
            totalResponseTime: metrics.totalResponseTime,
            avgResponseTime: metrics.avgResponseTime,
            errorCount: metrics.errorCount,
            lastRequestTime: metrics.lastRequestTime,
            operationBreakdown: {
                observation: metrics.operationBreakdown.observation,
                reasoning: metrics.operationBreakdown.reasoning,
                planning: metrics.operationBreakdown.planning,
                action: metrics.operationBreakdown.action,
                reflection: metrics.operationBreakdown.reflection
            }
        };
    }

    /**
     * Clear all service instances (useful for testing)
     */
    public clearAll(): void {
        // Detach every instance before invoking user/service lifecycle code. This
        // mirrors removeServiceForChannel() and prevents a re-entrant cleanup from
        // retrieving an instance that has already begun shutting down.
        const services = Array.from(this.services.values());
        this.services.clear();

        for (const service of services) {
            service.cleanupAll();
        }
    }

    /**
     * Release manager-owned listeners/timers and every channel service. Unlike
     * clearAll(), this is terminal for the exact manager reference; getInstance()
     * returns a clean singleton for a later lifecycle.
     */
    public shutdown(): void {
        if (this.isShutdown) {
            return;
        }
        this.isShutdown = true;

        for (const timer of this.channelCleanupTimers) {
            clearTimeout(timer);
        }
        this.channelCleanupTimers.clear();

        for (const subscription of this.cleanupSubscriptions) {
            if (!subscription.closed) {
                subscription.unsubscribe();
            }
        }
        this.cleanupSubscriptions = [];
        this.cleanupListenerRegistered = false;

        this.clearAll();
        if (SystemLlmServiceManager.instance === this) {
            SystemLlmServiceManager.instance = undefined;
        }
    }

    /**
     * Register event listeners for channel lifecycle
     */
    private registerCleanupListeners(): void {
        if (this.cleanupListenerRegistered) {
            return;
        }

        // Listen for channel deletion/archival events
        this.cleanupSubscriptions.push(
            EventBus.server.on(Events.Channel.DELETED, (payload) => {
                if (payload.channelId) {
                    this.removeServiceForChannel(payload.channelId);
                }
            }),
            EventBus.server.on(Events.Channel.ARCHIVED, (payload) => {
                if (payload.channelId) {
                    this.removeServiceForChannel(payload.channelId);
                }
            }),
            // Listen for agent left events - if no agents remain, cleanup.
            EventBus.server.on(Events.Channel.AGENT_LEFT, (payload) => {
                const remainingAgents = payload.data?.metadata?.remainingAgents;
                const channelId = payload.channelId;

                if (channelId && remainingAgents === 0) {
                    const timer = setTimeout(() => {
                        this.channelCleanupTimers.delete(timer);
                        if (!this.isShutdown) {
                            this.removeServiceForChannel(channelId);
                        }
                    }, 5000);
                    timer.unref?.();
                    this.channelCleanupTimers.add(timer);
                }
            })
        );

        this.cleanupListenerRegistered = true;
    }

    /**
     * Update configuration for all existing services
     */
    public updateDefaultConfig(config: SystemLlmServiceConfig): void {
        if (this.isShutdown) {
            throw new Error('SystemLlmServiceManager is shut down');
        }
        this.defaultConfig = config;
    }

    /**
     * Get a specific service instance (for monitoring/debugging)
     */
    public getService(channelId: ChannelId): SystemLlmService | undefined {
        return this.services.get(channelId);
    }

    /**
     * Check if a service exists for a channel
     */
    public hasService(channelId: ChannelId): boolean {
        return this.services.has(channelId);
    }

    /**
     * Current SystemLLM spend against the daily ceiling.
     *
     * Exposed here so health and analytics can report it without reaching for the
     * budget singleton directly.
     *
     * @returns Spend, ceiling, and whether calls are currently refused
     */
    public getBudgetStatus(): BudgetStatus {
        return SystemLlmBudgetService.getInstance().getStatus();
    }
}
