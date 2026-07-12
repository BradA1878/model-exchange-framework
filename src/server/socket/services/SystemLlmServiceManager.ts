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
import { SystemLlmService, SystemLlmServiceConfig } from './SystemLlmService';
import { SystemLlmBudgetService, BudgetStatus } from './SystemLlmBudgetService';
import { EventBus } from '@mxf-dev/core/events/EventBus';
import { Events } from '@mxf-dev/core/events/EventNames';
import { LlmProviderType } from '@mxf-dev/core/protocols/mcp/LlmProviders';
import { ConfigManager } from '@mxf-dev/core/config/ConfigManager';

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
export class SystemLlmServiceManager {
    private static instance: SystemLlmServiceManager;
    private services: Map<ChannelId, SystemLlmService> = new Map();
    private defaultConfig: SystemLlmServiceConfig;
    private cleanupListenerRegistered = false;

    /**
     * Private constructor for singleton pattern
     */
    private constructor(defaultConfig?: SystemLlmServiceConfig) {
        // Check if SystemLLM is enabled
        const isEnabled = process.env.SYSTEMLLM_ENABLED !== 'false';
        
        if (!isEnabled) {
            // Still initialize with dummy config to prevent crashes
            this.defaultConfig = {
                providerType: LlmProviderType.OPENROUTER,
                defaultTemperature: 0.7,
                defaultMaxTokens: 4096
            };
            return;
        }
        
        // Load configuration from environment variables if not provided
        if (!defaultConfig) {
            const envProvider = process.env.SYSTEMLLM_PROVIDER?.toLowerCase() || 'openrouter';
            const providerType = this.parseProviderType(envProvider);
            const defaultModel = process.env.SYSTEMLLM_DEFAULT_MODEL;
            
            
            this.defaultConfig = {
                providerType,
                ...(defaultModel && { defaultModel }),
                defaultTemperature: 0.7,
                defaultMaxTokens: 4096
            };
            
        } else {
            this.defaultConfig = defaultConfig;
        }
        
        
        // Register cleanup listeners
        this.registerCleanupListeners();
    }
    
    /**
     * Parse provider string to LlmProviderType enum
     */
    private parseProviderType(provider: string): LlmProviderType {
        const providerMap: Record<string, LlmProviderType> = {
            'openrouter': LlmProviderType.OPENROUTER,
            'azure-openai': LlmProviderType.AZURE_OPENAI,
            'openai': LlmProviderType.OPENAI,
            'anthropic': LlmProviderType.ANTHROPIC,
            'gemini': LlmProviderType.GEMINI,
            'xai': LlmProviderType.XAI,
            'ollama': LlmProviderType.OLLAMA,
            'custom': LlmProviderType.CUSTOM
        };
        
        return providerMap[provider] || LlmProviderType.OPENROUTER;
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
     * @param config - Optional per-channel overrides
     * @returns The service, or null when SystemLLM must not be used
     */
    public getServiceForChannel(channelId: ChannelId, config?: SystemLlmServiceConfig): SystemLlmService | null {
        // Check if SystemLLM is globally disabled via environment
        if (process.env.SYSTEMLLM_ENABLED === 'false') {

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
            // Create new service instance for this channel
            const serviceConfig = config || this.defaultConfig;
            service = new SystemLlmService(serviceConfig);

            this.services.set(channelId, service);

        }

        return service;
    }

    /**
     * Remove a service instance for a channel
     */
    public removeServiceForChannel(channelId: ChannelId): void {
        if (this.services.has(channelId)) {
            const service = this.services.get(channelId);
            
            // Cleanup the service properly before removing
            if (service) {
                service.cleanupAll();
            }
            
            this.services.delete(channelId);
        }
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
        for (const [channelId, service] of this.services.entries()) {
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
        const count = this.services.size;
        this.services.clear();
    }

    /**
     * Register event listeners for channel lifecycle
     */
    private registerCleanupListeners(): void {
        if (this.cleanupListenerRegistered) {
            return;
        }

        // Listen for channel deletion/archival events
        EventBus.server.on(Events.Channel.DELETED, (payload) => {
            if (payload.channelId) {
                this.removeServiceForChannel(payload.channelId);
            }
        });

        EventBus.server.on(Events.Channel.ARCHIVED, (payload) => {
            if (payload.channelId) {
                this.removeServiceForChannel(payload.channelId);
            }
        });

        // Listen for agent left events - if no agents remain, cleanup
        EventBus.server.on(Events.Channel.AGENT_LEFT, (payload) => {
            const remainingAgents = payload.data?.metadata?.remainingAgents;
            
            if (payload.channelId && remainingAgents === 0) {
                
                // Reduced delay for faster cleanup during development/testing
                setTimeout(() => {
                    // Re-check if channel is still empty
                    // This would require access to ChannelService to verify
                    // For now, we'll trust the event data
                    this.removeServiceForChannel(payload.channelId);
                }, 5000); // 5 second grace period (reduced from 30 seconds)
            }
        });

        this.cleanupListenerRegistered = true;
    }

    /**
     * Update configuration for all existing services
     */
    public updateDefaultConfig(config: SystemLlmServiceConfig): void {
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
