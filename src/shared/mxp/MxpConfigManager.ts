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
 * MXP Configuration Manager
 * 
 * Handles channel and agent-level MXP configuration management with granular feature control.
 * Supports configuration inheritance, overrides, and selective feature activation.
 */

import { Logger } from '../utils/Logger';
import { createStrictValidator } from '../utils/validation';
import { MxpConfig, DEFAULT_MXP_CONFIG, SecurityLevel } from '../types/MxpTypes';

export class MxpConfigManager {
    private static instance: MxpConfigManager | null = null;
    
    private readonly logger: Logger;
    private readonly validator = createStrictValidator('MxpConfigManager');
    
    // Configuration storage - in production this would be database-backed
    private channelConfigs = new Map<string, MxpConfig>();
    private agentConfigs = new Map<string, MxpConfig>();

    private constructor() {
        this.logger = new Logger('info', 'MxpConfigManager', 'server');
    }

    /**
     * Get the singleton instance of MxpConfigManager
     */
    public static getInstance(): MxpConfigManager {
        if (!MxpConfigManager.instance) {
            MxpConfigManager.instance = new MxpConfigManager();
        }
        return MxpConfigManager.instance;
    }

    /**
     * Get effective MXP configuration for an agent in a channel
     * Handles inheritance and overrides according to MXP scope rules
     */
    public getEffectiveConfig(channelId: string, agentId?: string): MxpConfig {
        let effectiveConfig = { ...DEFAULT_MXP_CONFIG };

        // Step 1: Apply channel-level configuration
        const channelConfig = this.channelConfigs.get(channelId);
        if (channelConfig) {
            effectiveConfig = this.mergeConfigs(effectiveConfig, channelConfig);
        }

        // Step 2: Apply agent-level configuration if specified
        if (agentId) {
            const agentConfig = this.agentConfigs.get(agentId);
            if (agentConfig) {
                // Check if agent should inherit from channel
                if (agentConfig.scope.inheritFromChannel && channelConfig) {
                    // Merge channel config first, then agent overrides
                    const inheritedConfig = this.mergeConfigs(effectiveConfig, channelConfig);
                    effectiveConfig = this.mergeConfigs(inheritedConfig, agentConfig);
                } else {
                    // Agent config overrides everything
                    effectiveConfig = this.mergeConfigs(effectiveConfig, agentConfig);
                }
            }
        }

        // Update scope to reflect the actual resolution
        effectiveConfig.scope = {
            channelId,
            agentId,
            inheritFromChannel: agentId ? (this.agentConfigs.get(agentId)?.scope.inheritFromChannel ?? true) : false,
            overrideSettings: true
        };

        return effectiveConfig;
    }

    /**
     * Set channel-level MXP configuration
     */
    public setChannelConfig(channelId: string, config: Partial<MxpConfig>): void {
        this.validator.assertIsNonEmptyString(channelId, 'Channel ID is required');
        this.validator.assertIsObject(config, 'Configuration must be an object');

        const fullConfig: MxpConfig = this.mergeConfigs(DEFAULT_MXP_CONFIG, {
            ...config,
            scope: {
                channelId,
                inheritFromChannel: false,
                overrideSettings: config.scope?.overrideSettings ?? true
            }
        });

        this.channelConfigs.set(channelId, fullConfig);
        //     tokenOptimization: fullConfig.modules.tokenOptimization?.enabled,
        //     bandwidthOptimization: fullConfig.modules.bandwidthOptimization?.enabled,
        //     security: fullConfig.modules.security?.level
        // });
    }

    /**
     * Set agent-level MXP configuration
     */
    public setAgentConfig(agentId: string, config: Partial<MxpConfig>): void {
        this.validator.assertIsNonEmptyString(agentId, 'Agent ID is required');
        this.validator.assertIsObject(config, 'Configuration must be an object');

        const fullConfig: MxpConfig = this.mergeConfigs(DEFAULT_MXP_CONFIG, {
            ...config,
            scope: {
                agentId,
                inheritFromChannel: config.scope?.inheritFromChannel ?? true,
                overrideSettings: config.scope?.overrideSettings ?? true
            }
        });

        this.agentConfigs.set(agentId, fullConfig);
    }

    /**
     * Check if a specific MXP feature is enabled for a channel/agent combination
     */
    public isFeatureEnabled(
        channelId: string, 
        feature: 'tokenOptimization' | 'bandwidthOptimization' | 'security' | 'analytics',
        agentId?: string
    ): boolean {
        const config = this.getEffectiveConfig(channelId, agentId);
        return config.modules[feature]?.enabled ?? false;
    }

    /**
     * Check if a specific token optimization strategy is enabled
     */
    public isTokenStrategyEnabled(
        channelId: string,
        strategy: 'contextCompression' | 'promptOptimization' | 'templateMatching' | 'entityDeduplication' | 'toolSchemaReduction' | 'conversationSummarization',
        agentId?: string
    ): boolean {
        const config = this.getEffectiveConfig(channelId, agentId);
        const tokenConfig = config.modules.tokenOptimization;
        
        if (!tokenConfig?.enabled) {
            return false;
        }

        return tokenConfig.strategies?.[strategy] ?? false;
    }

    /**
     * Get all channel configurations (for dashboard/admin UI)
     */
    public getAllChannelConfigs(): Array<{ channelId: string; config: MxpConfig }> {
        return Array.from(this.channelConfigs.entries()).map(([channelId, config]) => ({
            channelId,
            config
        }));
    }

    /**
     * Get all agent configurations (for dashboard/admin UI)
     */
    public getAllAgentConfigs(): Array<{ agentId: string; config: MxpConfig }> {
        return Array.from(this.agentConfigs.entries()).map(([agentId, config]) => ({
            agentId,
            config
        }));
    }

    /**
     * Remove channel configuration
     */
    public removeChannelConfig(channelId: string): boolean {
        const removed = this.channelConfigs.delete(channelId);
        if (removed) {
        }
        return removed;
    }

    /**
     * Remove agent configuration
     */
    public removeAgentConfig(agentId: string): boolean {
        const removed = this.agentConfigs.delete(agentId);
        if (removed) {
        }
        return removed;
    }

    /**
     * Create a channel-specific configuration with selective feature activation
     */
    public createChannelConfig(channelId: string, options: {
        enableTokenOptimization?: boolean;
        enableBandwidthOptimization?: boolean;
        securityLevel?: SecurityLevel;
        tokenStrategies?: {
            contextCompression?: boolean;
            promptOptimization?: boolean;
            templateMatching?: boolean;
            entityDeduplication?: boolean;
            toolSchemaReduction?: boolean;
            conversationSummarization?: boolean;
        };
    }): MxpConfig {
        const config: MxpConfig = {
            ...DEFAULT_MXP_CONFIG,
            scope: {
                channelId,
                inheritFromChannel: false,
                overrideSettings: true
            },
            modules: {
                ...DEFAULT_MXP_CONFIG.modules,
                tokenOptimization: options.enableTokenOptimization !== false ? {
                    ...DEFAULT_MXP_CONFIG.modules.tokenOptimization!,
                    enabled: options.enableTokenOptimization ?? true,
                    strategies: {
                        contextCompression: options.tokenStrategies?.contextCompression ?? true,
                        promptOptimization: options.tokenStrategies?.promptOptimization ?? true,
                        templateMatching: options.tokenStrategies?.templateMatching ?? true,
                        entityDeduplication: options.tokenStrategies?.entityDeduplication ?? false,
                        toolSchemaReduction: options.tokenStrategies?.toolSchemaReduction ?? false,
                        conversationSummarization: options.tokenStrategies?.conversationSummarization ?? true
                    }
                } : undefined,
                bandwidthOptimization: options.enableBandwidthOptimization !== false ? {
                    ...DEFAULT_MXP_CONFIG.modules.bandwidthOptimization!,
                    enabled: options.enableBandwidthOptimization ?? true
                } : undefined,
                security: {
                    ...DEFAULT_MXP_CONFIG.modules.security!,
                    level: options.securityLevel || SecurityLevel.STANDARD
                }
            }
        };

        this.setChannelConfig(channelId, config);
        return config;
    }

    /**
     * Merge two MXP configurations with proper precedence
     */
    private mergeConfigs(base: MxpConfig, override: Partial<MxpConfig>): MxpConfig {
        return {
            version: override.version || base.version,
            scope: { ...base.scope, ...override.scope },
            modules: {
                tokenOptimization: override.modules?.tokenOptimization 
                    ? { ...base.modules.tokenOptimization, ...override.modules.tokenOptimization }
                    : base.modules.tokenOptimization,
                bandwidthOptimization: override.modules?.bandwidthOptimization
                    ? { ...base.modules.bandwidthOptimization, ...override.modules.bandwidthOptimization }
                    : base.modules.bandwidthOptimization,
                security: override.modules?.security
                    ? { ...base.modules.security, ...override.modules.security }
                    : base.modules.security,
                analytics: override.modules?.analytics
                    ? { ...base.modules.analytics, ...override.modules.analytics }
                    : base.modules.analytics
            },
            integration: { ...base.integration, ...override.integration }
        };
    }

    /**
     * Get configuration statistics for monitoring
     */
    public getConfigStats(): {
        totalChannelConfigs: number;
        totalAgentConfigs: number;
        featuresEnabled: {
            tokenOptimization: number;
            bandwidthOptimization: number;
            security: number;
            analytics: number;
        };
    } {
        const allConfigs = [
            ...this.channelConfigs.values(),
            ...this.agentConfigs.values()
        ];

        return {
            totalChannelConfigs: this.channelConfigs.size,
            totalAgentConfigs: this.agentConfigs.size,
            featuresEnabled: {
                tokenOptimization: allConfigs.filter(c => c.modules.tokenOptimization?.enabled).length,
                bandwidthOptimization: allConfigs.filter(c => c.modules.bandwidthOptimization?.enabled).length,
                security: allConfigs.filter(c => c.modules.security?.level !== 'standard').length,
                analytics: allConfigs.filter(c => c.modules.analytics?.enabled).length
            }
        };
    }
}

// Note: Use MxpConfigManager.getInstance() to get the singleton instance
