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
 * SDK Configuration Framework
 * 
 * Provides a comprehensive configuration system for feature toggles and LLM selection.
 * Enables dynamic configuration of agent behaviors and capabilities.
 */

import { Observable, from } from 'rxjs';
import { map } from 'rxjs/operators';
import { Logger } from '../../shared/utils/Logger';
import { EventBus } from '../../shared/events/EventBus';
import { createBaseEventPayload } from '../../shared/schemas/EventPayloadSchema';
import { EventName } from '../../shared/events/EventNames';

/**
 * LLM model configuration
 */
export interface LlmModelConfig {
    /**
     * Model identifier
     */
    id: string;
    
    /**
     * Model name
     */
    name: string;
    
    /**
     * Model provider type
     */
    providerType: string;
    
    /**
     * Model version
     */
    version: string;
    
    /**
     * Context window size (in tokens)
     */
    contextWindow: number;
    
    /**
     * Default parameters
     */
    defaultParameters: Record<string, any>;
    
    /**
     * Supported features
     */
    features: string[];
}

/**
 * Feature toggle configuration
 */
export interface FeatureToggle {
    /**
     * Feature key
     */
    key: string;
    
    /**
     * Feature name
     */
    name: string;
    
    /**
     * Feature description
     */
    description: string;
    
    /**
     * Whether the feature is enabled
     */
    enabled: boolean;
    
    /**
     * Default value
     */
    defaultValue: boolean;
    
    /**
     * Required features
     */
    requires?: string[];
    
    /**
     * Feature parameters
     */
    parameters?: Record<string, any>;
}

/**
 * SDK configuration
 */
export interface SdkConfig {
    /**
     * SDK version
     */
    version: string;
    
    /**
     * LLM models configuration
     */
    llmModels: LlmModelConfig[];
    
    /**
     * Default LLM model ID
     */
    defaultLlmModel: string;
    
    /**
     * Feature toggles
     */
    features: Record<string, FeatureToggle>;
    
    /**
     * Global SDK parameters
     */
    parameters: Record<string, any>;
    
    /**
     * Agent type configuration
     */
    agentTypes: {
        /**
         * Supported agent roles
         */
        supportedRoles: string[];
        
        /**
         * Default agent role
         */
        defaultRole: string;
        
        /**
         * Supported service types
         */
        supportedServiceTypes: string[];
        
        /**
         * Agent specializations
         */
        supportedSpecializations: string[];
        
        /**
         * Agent capability mapping
         */
        capabilityMapping: Record<string, string[]>;
        
        /**
         * Role-based permissions
         */
        rolePermissions: Record<string, string[]>;
    };
    
    /**
     * Channel-level SystemLLM configuration
     * This overrides agent and task-level SystemLLM settings
     *
     * Can be configured globally or per-channel using channelSystemLlmById
     */
    channelSystemLlm: {
        /**
         * Whether SystemLLM is enabled globally
         * When false, all SystemLLM operations are disabled regardless of agent/task settings
         */
        enabled: boolean;

        /**
         * Optional reason for disabling (for logging/debugging)
         */
        disabledReason?: string;

        /**
         * Override settings for specific operations
         */
        operationOverrides?: {
            taskAssignment?: boolean;
            reasoning?: boolean;
            interpretation?: boolean;
            reflection?: boolean;
            coordination?: boolean;
        };
    };

    /**
     * Per-channel SystemLLM configuration overrides
     * Maps channelId to channel-specific settings
     * When present, these override the global channelSystemLlm settings
     */
    channelSystemLlmById?: Map<string, {
        enabled: boolean;
        disabledReason?: string;
        operationOverrides?: {
            taskAssignment?: boolean;
            reasoning?: boolean;
            interpretation?: boolean;
            reflection?: boolean;
            coordination?: boolean;
        };
    }>;
    
    /**
     * Environment-specific configuration
     */
    environment: {
        /**
         * Environment name
         */
        name: string;
        
        /**
         * Environment-specific overrides
         */
        overrides?: Partial<SdkConfig>;
    };
}

/**
 * Default SDK configuration
 */
const DEFAULT_CONFIG: SdkConfig = {
    version: '1.0.0',
    llmModels: [
        {
            id: 'claude-3-opus-20240229',
            name: 'Claude 3 Opus',
            providerType: 'anthropic',
            version: '1.0',
            contextWindow: 200000,
            defaultParameters: {
                temperature: 0.7,
                maxTokens: 4096
            },
            features: ['MCP', 'tool_use', 'binary_protocol']
        },
        {
            id: 'gpt-4-turbo',
            name: 'GPT-4 Turbo',
            providerType: 'openai',
            version: '1.0',
            contextWindow: 128000,
            defaultParameters: {
                temperature: 0.7,
                maxTokens: 4096
            },
            features: ['tool_use', 'binary_protocol']
        }
    ],
    defaultLlmModel: 'claude-3-opus-20240229',
    features: {
        'binary_protocol': {
            key: 'binary_protocol',
            name: 'Model Excahnge Protocol (MXP)',
            description: 'Uses binary message format for efficient agent communication',
            enabled: true,
            defaultValue: true
        },
        'control_loop': {
            key: 'control_loop',
            name: 'Control Loop',
            description: 'Enables structured decision-making within agents',
            enabled: true,
            defaultValue: true
        },
        'memory_system': {
            key: 'memory_system',
            name: 'Memory System',
            description: 'Provides persistent storage at agent, channel, and shared levels',
            enabled: true,
            defaultValue: true
        },
        'self_reflection': {
            key: 'self_reflection',
            name: 'Self Reflection',
            description: 'Enhances decision quality through feedback loops with reinforcement learning',
            enabled: true,
            defaultValue: true,
            requires: ['memory_system']
        },
        'agent_specialization': {
            key: 'agent_specialization',
            name: 'Agent Specialization',
            description: 'Defines agent capabilities and expertise',
            enabled: true,
            defaultValue: true
        },
        'channel_context': {
            key: 'channel_context',
            name: 'Channel Context',
            description: 'Provides semantic framework for agent interactions',
            enabled: true,
            defaultValue: true
        },
        'mcp_integration': {
            key: 'mcp_integration',
            name: 'MCP Integration',
            description: 'Integrates with Anthropic MCP for LLM-to-tool interactions',
            enabled: true,
            defaultValue: true
        },
        'reinforcement_learning': {
            key: 'reinforcement_learning',
            name: 'Reinforcement Learning',
            description: 'Server-side neural network integration using Brain.js',
            enabled: false,
            defaultValue: false,
            requires: ['self_reflection'],
            parameters: {
                learningRate: 0.01,
                networkType: 'feedforward',
                hiddenLayers: [8, 8]
            }
        },
        'transitional_intelligence': {
            key: 'transitional_intelligence',
            name: 'Transitional Intelligence',
            description: 'Augments core control loop with specialized LLMs',
            enabled: false,
            defaultValue: false,
            requires: ['control_loop']
        },
        'tool_selection_optimization': {
            key: 'tool_selection_optimization',
            name: 'Tool Selection Optimization',
            description: 'Intelligently pre-filters tools to optimize context usage',
            enabled: false,
            defaultValue: false
        }
    },
    parameters: {
        agentConnectTimeout: 30000,
        messageRetryCount: 3,
        messageRetryDelay: 1000,
        logLevel: 'info'
    },
    agentTypes: {
        supportedRoles: ['consumer', 'provider', 'admin'],
        defaultRole: 'consumer',
        supportedServiceTypes: [
            'assistant',           // General assistant agents
            'specialist',          // Domain-specific expert agents
            'coordinator',         // Multi-agent coordination
            'memory',             // Memory management agents
            'tool_provider',      // Tool execution providers
            'data_processor',     // Data processing specialists
            'workflow_manager',   // Workflow orchestration
            'monitoring',         // System monitoring agents
            'integration'         // External system integration
        ],
        supportedSpecializations: [
            // General specializations
            'general_assistant',
            'task_coordinator',
            'workflow_optimizer',
            
            // Technical specializations
            'code_assistant',
            'data_analyst',
            'system_monitor',
            'integration_specialist',
            
            // Domain-specific specializations
            'research',
            'analysis',
            'communication',
            'documentation',
            
            // Advanced specializations
            'pattern_recognition',
            'performance_optimization',
            'error_recovery',
            'multi_agent_coordination'
        ],
        capabilityMapping: {
            'assistant': ['conversation', 'task_execution', 'tool_use'],
            'specialist': ['domain_expertise', 'advanced_reasoning', 'specialized_tools'],
            'coordinator': ['multi_agent_communication', 'task_delegation', 'workflow_management'],
            'memory': ['data_storage', 'pattern_recognition', 'context_management'],
            'tool_provider': ['tool_execution', 'external_integration', 'resource_management'],
            'data_processor': ['data_analysis', 'transformation', 'aggregation'],
            'workflow_manager': ['process_orchestration', 'dependency_management', 'scheduling'],
            'monitoring': ['system_observation', 'performance_tracking', 'alerting'],
            'integration': ['external_api_access', 'protocol_translation', 'data_synchronization']
        },
        rolePermissions: {
            'consumer': ['read_channel', 'send_message', 'use_tools'],
            'provider': ['read_channel', 'send_message', 'use_tools', 'provide_tools', 'coordinate_agents'],
            'admin': ['read_channel', 'send_message', 'use_tools', 'provide_tools', 'coordinate_agents', 'manage_channel', 'system_admin']
        }
    },
    channelSystemLlm: {
        enabled: true,
        operationOverrides: {}
    },
    environment: {
        name: 'development'
    }
};

/**
 * Configuration event types
 */
export const ConfigEvents = {
    /**
     * Config updated event
     */
    CONFIG_UPDATED: 'config:updated' as EventName,
    
    /**
     * Feature state changed event
     */
    FEATURE_STATE_CHANGED: 'config:feature_state_changed' as EventName,
    
    /**
     * LLM model changed event
     */
    LLM_MODEL_CHANGED: 'config:llm_model_changed' as EventName,
    
    /**
     * Channel SystemLLM state changed event
     */
    CHANNEL_SYSTEM_LLM_CHANGED: 'config:channel_system_llm_changed' as EventName,
};

/**
 * Configuration update event
 */
export interface ConfigUpdateEvent {
    /**
     * New configuration
     */
    config: SdkConfig;
    
    /**
     * Updated properties
     */
    updatedProps?: string[];
    
    /**
     * Timestamp of the update
     */
    timestamp: number;
}

/**
 * Feature state change event
 */
export interface FeatureStateChangeEvent {
    /**
     * Feature key
     */
    featureKey: string;
    
    /**
     * New state
     */
    enabled: boolean;
    
    /**
     * Affected dependent features
     */
    affectedFeatures?: string[];
    
    /**
     * Timestamp of the change
     */
    timestamp: number;
}

/**
 * LLM model change event
 */
export interface LlmModelChangeEvent {
    /**
     * Previous model ID
     */
    previousModelId?: string;
    
    /**
     * New model ID
     */
    newModelId: string;
    
    /**
     * Timestamp of the change
     */
    timestamp: number;
}

/**
 * Channel SystemLLM state change event
 */
export interface ChannelSystemLlmChangeEvent {
    /**
     * Whether SystemLLM is enabled
     */
    enabled: boolean;

    /**
     * Optional reason for the change
     */
    reason?: string;

    /**
     * Operation-specific overrides
     */
    operationOverrides?: Record<string, boolean>;

    /**
     * Optional channel ID for channel-specific changes
     * If not provided, applies globally
     */
    channelId?: string;

    /**
     * Timestamp of the change
     */
    timestamp: number;
}

/**
 * Configuration manager interface
 */
export interface IConfigManager {
    /**
     * Get the current configuration
     */
    getConfig(): SdkConfig;
    
    /**
     * Get the configuration as an observable
     */
    getConfigObservable(): Observable<SdkConfig>;
    
    /**
     * Load configuration from a file
     * @param filePath - Path to configuration file
     */
    loadConfigFromFile(filePath: string): Observable<SdkConfig>;
    
    /**
     * Load configuration from an object
     * @param config - Configuration object
     */
    loadConfig(config: Partial<SdkConfig>): Observable<SdkConfig>;
    
    /**
     * Update configuration
     * @param updates - Configuration updates
     */
    updateConfig(updates: Partial<SdkConfig>): Observable<SdkConfig>;
    
    /**
     * Check if a feature is enabled
     * @param featureKey - Feature key
     */
    isFeatureEnabled(featureKey: string): boolean;
    
    /**
     * Get feature toggle by key
     * @param featureKey - Feature key
     */
    getFeature(featureKey: string): FeatureToggle | null;
    
    /**
     * Enable a feature
     * @param featureKey - Feature key
     */
    enableFeature(featureKey: string): Observable<boolean>;
    
    /**
     * Disable a feature
     * @param featureKey - Feature key
     */
    disableFeature(featureKey: string): Observable<boolean>;
    
    /**
     * Get LLM model configuration
     * @param modelId - Model ID (optional, returns default if not specified)
     */
    getLlmModel(modelId?: string): LlmModelConfig | null;
    
    /**
     * Set default LLM model
     * @param modelId - Model ID
     */
    setDefaultLlmModel(modelId: string): Observable<boolean>;
    
    /**
     * Get parameter value
     * @param key - Parameter key
     * @param defaultValue - Default value if parameter not found
     */
    getParameter<T>(key: string, defaultValue?: T): T;
    
    /**
     * Set parameter value
     * @param key - Parameter key
     * @param value - Parameter value
     */
    setParameter<T>(key: string, value: T): Observable<boolean>;
    
    // Agent Type Management Methods
    
    /**
     * Get supported agent roles
     */
    getSupportedAgentRoles(): string[];
    
    /**
     * Get default agent role
     */
    getDefaultAgentRole(): string;
    
    /**
     * Get supported service types
     */
    getSupportedServiceTypes(): string[];
    
    /**
     * Get supported agent specializations
     */
    getSupportedSpecializations(): string[];
    
    /**
     * Get agent capabilities for a service type
     * @param serviceType - Service type
     */
    getAgentCapabilities(serviceType: string): string[];
    
    /**
     * Get role permissions
     * @param role - Agent role
     */
    getRolePermissions(role: string): string[];
    
    /**
     * Validate agent configuration
     * @param role - Agent role
     * @param serviceTypes - Service types
     * @param specialization - Agent specialization
     */
    validateAgentConfig(role: string, serviceTypes: string[], specialization?: string): boolean;
    
    /**
     * Get recommended capabilities for agent configuration
     * @param serviceTypes - Service types
     * @param specialization - Agent specialization
     */
    getRecommendedCapabilities(serviceTypes: string[], specialization?: string): string[];
    
    /**
     * Check if SystemLLM is enabled for the channel
     * @param channelId - Optional channel ID to check (if not provided, checks global)
     * @param operationType - Optional specific operation to check
     */
    isChannelSystemLlmEnabled(channelId?: string, operationType?: string): boolean;
    
    /**
     * Get channel SystemLLM configuration
     */
    getChannelSystemLlmConfig(): SdkConfig['channelSystemLlm'];
    
    /**
     * Set channel SystemLLM enabled state
     * @param enabled - Whether to enable SystemLLM
     * @param channelId - Optional channel ID (if not provided, sets global)
     * @param reason - Optional reason for the change
     */
    setChannelSystemLlmEnabled(enabled: boolean, channelId?: string, reason?: string): Observable<boolean>;
    
    /**
     * Set channel SystemLLM operation override
     * @param operation - Operation name
     * @param enabled - Whether to enable for this operation
     * @param channelId - Optional channel ID (if not provided, sets global)
     */
    setChannelSystemLlmOperationOverride(operation: string, enabled: boolean, channelId?: string): Observable<boolean>;
}

/**
 * Configuration manager implementation
 */
export class ConfigManager implements IConfigManager {
    // Current configuration
    private config: SdkConfig;
    
    // Logger instance for ConfigManager
    private logger: Logger;
    
    // Singleton instance
    private static instance: ConfigManager;
    
    /**
     * Get the singleton instance
     */
    public static getInstance(): ConfigManager {
        if (!ConfigManager.instance) {
            ConfigManager.instance = new ConfigManager();
        }
        
        return ConfigManager.instance;
    }
    
    /**
     * Private constructor to prevent direct instantiation
     * Use ConfigManager.getInstance() instead
     */
    private constructor() {
        // Initialize with default configuration
        this.config = {
            ...DEFAULT_CONFIG,
            channelSystemLlmById: new Map()
        };

        // Initialize logger with proper component name
        this.logger = new Logger('info', 'ConfigManager', 'client');
    }
    
    /**
     * Get the current configuration
     */
    public getConfig(): SdkConfig {
        return { ...this.config };
    }
    
    /**
     * Get the configuration as an observable
     */
    public getConfigObservable(): Observable<SdkConfig> {
        // Create an Observable that subscribes to the EventBus config update event
        return new Observable<SdkConfig>(observer => {
            // Immediately emit the current configuration
            observer.next({ ...this.config });
            
            // Set up event listener for future updates
            const handler = (event: ConfigUpdateEvent) => {
                observer.next({ ...event.config });
            };
            
            // Subscribe to the event
            EventBus.client.on(ConfigEvents.CONFIG_UPDATED, handler);
            
            // Return cleanup function
            return () => {
                // Remove the event listener when Observable is unsubscribed
                EventBus.client.off(ConfigEvents.CONFIG_UPDATED, handler);
            };
        });
    }
    
    /**
     * Load configuration from a file
     * @param filePath - Path to configuration file
     */
    public loadConfigFromFile(filePath: string): Observable<SdkConfig> {
        // In a browser environment, we would use fetch
        // In Node.js, we would use fs.readFile
        
        // This is a simplified implementation that assumes we're in a Node.js environment
        try {
            // Note: In a real implementation, this would be asynchronous
            // For now, we'll just return the current config
            this.logger.warn(`loadConfigFromFile not fully implemented. File path: ${filePath}`);
            
            return from(Promise.resolve(this.config));
        } catch (error) {
            this.logger.error(`Failed to load configuration from file: ${error}`);
            return from(Promise.resolve(this.config));
        }
    }
    
    /**
     * Load configuration from an object
     * @param config - Configuration object
     */
    public loadConfig(config: Partial<SdkConfig>): Observable<SdkConfig> {
        // Merge with default configuration
        this.config = this.mergeConfigs(DEFAULT_CONFIG, config);
        
        // Validate configuration
        this.validateConfig();
        
        // Emit configuration update event
        this.emitConfigUpdated(['all']);
        
        return from(Promise.resolve(this.config));
    }
    
    /**
     * Update configuration
     * @param updates - Configuration updates
     */
    public updateConfig(updates: Partial<SdkConfig>): Observable<SdkConfig> {
        // Capture updated properties for the event
        const updatedProps = Object.keys(updates);
        
        // Merge with current configuration
        this.config = this.mergeConfigs(this.config, updates);
        
        // Validate configuration
        this.validateConfig();
        
        // Emit configuration update event
        this.emitConfigUpdated(updatedProps);
        
        return from(Promise.resolve(this.config));
    }
    
    /**
     * Check if a feature is enabled
     * @param featureKey - Feature key
     */
    public isFeatureEnabled(featureKey: string): boolean {
        const feature = this.config.features[featureKey];
        
        if (!feature) {
            // Feature not found
            return false;
        }
        
        if (feature.requires) {
            // Check if required features are enabled
            for (const requiredFeature of feature.requires) {
                if (!this.isFeatureEnabled(requiredFeature)) {
                    // Required feature is not enabled
                    return false;
                }
            }
        }
        
        return feature.enabled;
    }
    
    /**
     * Get feature toggle by key
     * @param featureKey - Feature key
     */
    public getFeature(featureKey: string): FeatureToggle | null {
        const feature = this.config.features[featureKey];
        
        if (!feature) {
            return null;
        }
        
        return { ...feature };
    }
    
    /**
     * Enable a feature
     * @param featureKey - Feature key
     */
    public enableFeature(featureKey: string): Observable<boolean> {
        const feature = this.config.features[featureKey];
        
        if (!feature) {
            return from(Promise.resolve(false));
        }
        
        if (feature.enabled) {
            return from(Promise.resolve(true));
        }
        
        // Enable feature
        feature.enabled = true;
        
        // Track affected features for the event
        const affectedFeatures: string[] = [];
        
        // Check if dependencies need to be enabled
        if (feature.requires) {
            for (const requiredFeature of feature.requires) {
                if (!this.isFeatureEnabled(requiredFeature)) {
                    this.enableFeature(requiredFeature);
                    affectedFeatures.push(requiredFeature);
                }
            }
        }
        
        // Emit feature state change event
        this.emitFeatureStateChanged(featureKey, true, affectedFeatures);
        
        // Also emit general config update
        this.emitConfigUpdated(['features']);
        
        return from(Promise.resolve(true));
    }
    
    /**
     * Disable a feature
     * @param featureKey - Feature key
     */
    public disableFeature(featureKey: string): Observable<boolean> {
        const feature = this.config.features[featureKey];
        
        if (!feature) {
            return from(Promise.resolve(false));
        }
        
        // Disable feature
        feature.enabled = false;
        
        // Track affected features for the event
        const affectedFeatures: string[] = [];
        
        // Check if other features depend on this one
        for (const [key, otherFeature] of Object.entries(this.config.features)) {
            if (otherFeature.requires && otherFeature.requires.includes(featureKey) && otherFeature.enabled) {
                // Disable dependent feature
                this.disableFeature(key);
                affectedFeatures.push(key);
            }
        }
        
        // Emit feature state change event
        this.emitFeatureStateChanged(featureKey, false, affectedFeatures);
        
        // Also emit general config update
        this.emitConfigUpdated(['features']);
        
        return from(Promise.resolve(true));
    }
    
    /**
     * Get LLM model configuration
     * @param modelId - Model ID (optional, returns default if not specified)
     */
    public getLlmModel(modelId?: string): LlmModelConfig | null {
        const id = modelId || this.config.defaultLlmModel;
        
        const model = this.config.llmModels.find(m => m.id === id);
        
        if (!model) {
            return null;
        }
        
        return { ...model };
    }
    
    /**
     * Set default LLM model
     * @param modelId - Model ID
     */
    public setDefaultLlmModel(modelId: string): Observable<boolean> {
        const model = this.getLlmModel(modelId);
        
        if (!model) {
            return from(Promise.resolve(false));
        }
        
        const previousModelId = this.config.defaultLlmModel;
        
        // Update default model
        this.config.defaultLlmModel = modelId;
        
        // Emit LLM model change event
        this.emitLlmModelChanged(previousModelId, modelId);
        
        // Also emit general config update
        this.emitConfigUpdated(['defaultLlmModel']);
        
        return from(Promise.resolve(true));
    }
    
    /**
     * Get parameter value
     * @param key - Parameter key
     * @param defaultValue - Default value if parameter not found
     */
    public getParameter<T>(key: string, defaultValue?: T): T {
        const value = this.config.parameters[key];
        
        if (value === undefined) {
            return defaultValue as T;
        }
        
        return value as T;
    }
    
    /**
     * Set parameter value
     * @param key - Parameter key
     * @param value - Parameter value
     */
    public setParameter<T>(key: string, value: T): Observable<boolean> {
        // Set parameter
        this.config.parameters[key] = value;
        
        // Emit configuration update event
        this.emitConfigUpdated(['parameters']);
        
        return from(Promise.resolve(true));
    }
    
    /**
     * Get supported agent roles
     */
    public getSupportedAgentRoles(): string[] {
        return this.config.agentTypes.supportedRoles;
    }
    
    /**
     * Get default agent role
     */
    public getDefaultAgentRole(): string {
        return this.config.agentTypes.defaultRole;
    }
    
    /**
     * Get supported service types
     */
    public getSupportedServiceTypes(): string[] {
        return this.config.agentTypes.supportedServiceTypes;
    }
    
    /**
     * Get supported agent specializations
     */
    public getSupportedSpecializations(): string[] {
        return this.config.agentTypes.supportedSpecializations;
    }
    
    /**
     * Get agent capabilities for a service type
     * @param serviceType - Service type
     */
    public getAgentCapabilities(serviceType: string): string[] {
        return this.config.agentTypes.capabilityMapping[serviceType] || [];
    }
    
    /**
     * Get role permissions
     * @param role - Agent role
     */
    public getRolePermissions(role: string): string[] {
        return this.config.agentTypes.rolePermissions[role] || [];
    }
    
    /**
     * Validate agent configuration
     * @param role - Agent role
     * @param serviceTypes - Service types
     * @param specialization - Agent specialization
     */
    public validateAgentConfig(role: string, serviceTypes: string[], specialization?: string): boolean {
        // Check if role is supported
        if (!this.config.agentTypes.supportedRoles.includes(role)) {
            return false;
        }
        
        // Check if service types are supported
        for (const serviceType of serviceTypes) {
            if (!this.config.agentTypes.supportedServiceTypes.includes(serviceType)) {
                return false;
            }
        }
        
        // Check if specialization is supported (if provided)
        if (specialization && !this.config.agentTypes.supportedSpecializations.includes(specialization)) {
            return false;
        }
        
        return true;
    }
    
    /**
     * Get recommended capabilities for agent configuration
     * @param serviceTypes - Service types
     * @param specialization - Agent specialization
     */
    public getRecommendedCapabilities(serviceTypes: string[], specialization?: string): string[] {
        const recommendedCapabilities: string[] = [];
        
        // Get capabilities for each service type
        for (const serviceType of serviceTypes) {
            recommendedCapabilities.push(...this.getAgentCapabilities(serviceType));
        }
        
        // If specialization is provided, add its capabilities
        if (specialization) {
            // For now, assume specialization capabilities are the same as service type capabilities
            // In the future, we can add more complex logic to determine specialization capabilities
            recommendedCapabilities.push(...this.getAgentCapabilities(specialization));
        }
        
        return recommendedCapabilities;
    }
    
    /**
     * Check if SystemLLM is enabled for the channel
     * @param channelId - Optional channel ID to check (if not provided, checks global)
     * @param operationType - Optional specific operation to check
     */
    public isChannelSystemLlmEnabled(channelId?: string, operationType?: string): boolean {
        // If channelId provided, check channel-specific config first
        if (channelId && this.config.channelSystemLlmById) {
            const channelConfig = this.config.channelSystemLlmById.get(channelId);
            if (channelConfig) {
                // Channel has specific config, use it
                if (!channelConfig.enabled) {
                    return false;
                }

                // Check operation-specific override for this channel
                if (operationType && channelConfig.operationOverrides) {
                    const opValue = channelConfig.operationOverrides[operationType as keyof typeof channelConfig.operationOverrides];
                    return opValue ?? true;
                }

                return true;
            }
        }

        // Fall back to global channel setting
        if (!this.config.channelSystemLlm.enabled) {
            return false;
        }

        // If no operation type specified, return global setting
        if (!operationType) {
            return true;
        }

        // Check for global operation-specific override
        const overrides = this.config.channelSystemLlm.operationOverrides;
        if (overrides && operationType in overrides) {
            return overrides[operationType as keyof typeof overrides] ?? true;
        }

        // Default to global setting
        return true;
    }
    
    /**
     * Get channel SystemLLM configuration
     */
    public getChannelSystemLlmConfig(): SdkConfig['channelSystemLlm'] {
        return { ...this.config.channelSystemLlm };
    }
    
    /**
     * Set channel SystemLLM enabled state
     * @param enabled - Whether to enable SystemLLM
     * @param channelId - Optional channel ID (if not provided, sets global)
     * @param reason - Optional reason for the change
     */
    public setChannelSystemLlmEnabled(enabled: boolean, channelId?: string, reason?: string): Observable<boolean> {
        if (channelId) {
            // Set channel-specific configuration
            if (!this.config.channelSystemLlmById) {
                this.config.channelSystemLlmById = new Map();
            }

            const existingConfig = this.config.channelSystemLlmById.get(channelId) || {};
            this.config.channelSystemLlmById.set(channelId, {
                ...existingConfig,
                enabled,
                disabledReason: enabled ? undefined : reason
            });

        } else {
            // Update global configuration
            this.config.channelSystemLlm.enabled = enabled;

            if (reason) {
                this.config.channelSystemLlm.disabledReason = enabled ? undefined : reason;
            }

        }

        // Emit channel SystemLLM change event
        this.emitChannelSystemLlmChanged(enabled, reason, undefined, channelId);

        // Also emit general config update
        this.emitConfigUpdated(['channelSystemLlm']);

        return from(Promise.resolve(true));
    }
    
    /**
     * Set channel SystemLLM operation override
     * @param operation - Operation name
     * @param enabled - Whether to enable for this operation
     * @param channelId - Optional channel ID (if not provided, sets global)
     */
    public setChannelSystemLlmOperationOverride(operation: string, enabled: boolean, channelId?: string): Observable<boolean> {
        if (channelId) {
            // Set channel-specific operation override
            if (!this.config.channelSystemLlmById) {
                this.config.channelSystemLlmById = new Map();
            }

            const existingConfig = this.config.channelSystemLlmById.get(channelId) || { enabled: true };
            if (!existingConfig.operationOverrides) {
                existingConfig.operationOverrides = {};
            }

            existingConfig.operationOverrides[operation as keyof typeof existingConfig.operationOverrides] = enabled;
            this.config.channelSystemLlmById.set(channelId, existingConfig);


            // Emit with channel-specific overrides
            this.emitChannelSystemLlmChanged(
                existingConfig.enabled,
                undefined,
                existingConfig.operationOverrides,
                channelId
            );
        } else {
            // Set global operation override
            if (!this.config.channelSystemLlm.operationOverrides) {
                this.config.channelSystemLlm.operationOverrides = {};
            }

            this.config.channelSystemLlm.operationOverrides[operation as keyof typeof this.config.channelSystemLlm.operationOverrides] = enabled;


            // Emit with global overrides
            this.emitChannelSystemLlmChanged(
                this.config.channelSystemLlm.enabled,
                undefined,
                this.config.channelSystemLlm.operationOverrides,
                undefined
            );
        }

        // Also emit general config update
        this.emitConfigUpdated(['channelSystemLlm']);

        return from(Promise.resolve(true));
    }
    
    /**
     * Merge configurations
     * @param baseConfig - Base configuration
     * @param overrides - Configuration overrides
     * @private
     */
    private mergeConfigs(baseConfig: SdkConfig, overrides: Partial<SdkConfig>): SdkConfig {
        const merged = { ...baseConfig };
        
        // Merge top-level properties
        for (const [key, value] of Object.entries(overrides)) {
            if (key === 'features' || key === 'parameters') {
                // Skip these for now, will handle separately
                continue;
            }
            
            if (key === 'llmModels' && Array.isArray(value)) {
                // Replace LLM models
                merged.llmModels = [...value];
                continue;
            }
            
            // @ts-ignore: Dynamic property assignment
            merged[key] = value;
        }
        
        // Merge features
        if (overrides.features) {
            for (const [key, feature] of Object.entries(overrides.features)) {
                merged.features[key] = {
                    ...merged.features[key],
                    ...feature
                };
            }
        }
        
        // Merge parameters
        if (overrides.parameters) {
            merged.parameters = {
                ...merged.parameters,
                ...overrides.parameters
            };
        }
        
        return merged;
    }
    
    /**
     * Validate configuration
     * @private
     */
    private validateConfig(): void {
        // Check if default LLM model exists
        const defaultModel = this.config.llmModels.find(m => m.id === this.config.defaultLlmModel);
        
        if (!defaultModel) {
            this.logger.warn(`Default LLM model '${this.config.defaultLlmModel}' not found. Using first available model.`);
            
            if (this.config.llmModels.length > 0) {
                this.config.defaultLlmModel = this.config.llmModels[0].id;
            }
        }
        
        // Validate feature dependencies
        for (const [key, feature] of Object.entries(this.config.features)) {
            if (feature.enabled && feature.requires) {
                for (const requiredFeature of feature.requires) {
                    if (!this.config.features[requiredFeature]) {
                        this.logger.warn(`Feature '${key}' requires '${requiredFeature}', but required feature not found.`);
                        feature.enabled = false;
                        break;
                    }
                    
                    if (!this.config.features[requiredFeature].enabled) {
                        this.logger.warn(`Feature '${key}' requires '${requiredFeature}', but required feature is disabled.`);
                        feature.enabled = false;
                        break;
                    }
                }
            }
        }
    }
    
    /**
     * Emit configuration updated event
     * @param updatedProps - Updated properties
     * @private
     */
    private emitConfigUpdated(updatedProps: string[]): void {
        const data = {
            config: { ...this.config },
            updatedProps,
        };
        const payload = createBaseEventPayload(
            ConfigEvents.CONFIG_UPDATED,
            'sdk_system_agent', // Placeholder agentId
            'config_channel',   // Placeholder channelId
            data
        );
        EventBus.client.emit(ConfigEvents.CONFIG_UPDATED, payload);
    }
    
    /**
     * Emit feature state changed event
     * @param featureKey - Feature key
     * @param enabled - New state
     * @param affectedFeatures - Affected dependent features
     * @private
     */
    private emitFeatureStateChanged(featureKey: string, enabled: boolean, affectedFeatures?: string[]): void {
        const data = {
            featureKey,
            enabled,
            affectedFeatures,
        };
        const payload = createBaseEventPayload(
            ConfigEvents.FEATURE_STATE_CHANGED,
            'sdk_system_agent', // Placeholder agentId
            'config_channel',   // Placeholder channelId
            data
        );
        EventBus.client.emit(ConfigEvents.FEATURE_STATE_CHANGED, payload);
    }
    
    /**
     * Emit LLM model changed event
     * @param previousModelId - Previous model ID
     * @param newModelId - New model ID
     * @private
     */
    private emitLlmModelChanged(previousModelId: string, newModelId: string): void {
        const data = {
            previousModelId,
            newModelId,
        };
        const payload = createBaseEventPayload(
            ConfigEvents.LLM_MODEL_CHANGED,
            'sdk_system_agent', // Placeholder agentId
            'config_channel',   // Placeholder channelId
            data
        );
        EventBus.client.emit(ConfigEvents.LLM_MODEL_CHANGED, payload);
    }
    
    /**
     * Emit channel SystemLLM changed event
     * @param enabled - Whether SystemLLM is enabled
     * @param reason - Optional reason for the change
     * @param operationOverrides - Optional operation-specific overrides
     * @param channelId - Optional channel ID for channel-specific changes
     * @private
     */
    private emitChannelSystemLlmChanged(enabled: boolean, reason?: string, operationOverrides?: Record<string, boolean>, channelId?: string): void {
        const data: ChannelSystemLlmChangeEvent = {
            enabled,
            reason,
            operationOverrides,
            channelId,
            timestamp: Date.now()
        };
        const payload = createBaseEventPayload<ChannelSystemLlmChangeEvent>(
            ConfigEvents.CHANNEL_SYSTEM_LLM_CHANGED,
            'sdk_system_agent', // Placeholder agentId
            channelId || 'config_channel',   // Use actual channelId or placeholder
            data,
            { source: 'ConfigManager' }
        );
        // Emit to client bus - will propagate to server via shared eventSubject
        EventBus.client.emit(ConfigEvents.CHANNEL_SYSTEM_LLM_CHANGED, payload);

        // Also emit to server bus to ensure propagation
        EventBus.server.emit(ConfigEvents.CHANNEL_SYSTEM_LLM_CHANGED, payload);
    }
}
