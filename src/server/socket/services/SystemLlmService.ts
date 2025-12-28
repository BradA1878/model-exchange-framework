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
 * System LLM Service
 * 
 * Centralized service for all System LLM operations in the MXF framework.
 * This service handles LLM operations that run on the server side (as opposed to
 * client-side agent LLMs that operate through the SDK).
 * 
 * Key responsibilities:
 * - Topic extraction from conversations
 * - Conversation summary generation
 * - Control loop reasoning operations
 * - Structured output enforcement with JSON schemas
 * - Unified prompt management and error handling
 */

import { BehaviorSubject, Observable, catchError, map, of, lastValueFrom } from 'rxjs';
import { EventBus } from '../../../shared/events/EventBus';
import { Events } from '../../../shared/events/EventNames';
import { Logger } from '../../../shared/utils/Logger';
import { Observation, Reasoning, PlanAction, Plan, Reflection } from '../../../shared/types/ControlLoopTypes';
import { LlmProviderType } from '../../../shared/protocols/mcp/LlmProviders';
import { COMMUNICATION_TOOLS, CONTEXT_MEMORY_TOOLS, META_TOOLS } from '../../../shared/constants/ToolNames';
import mongoose from 'mongoose';
import { 
    TOPIC_EXTRACTION_SCHEMA, 
    CONVERSATION_SUMMARY_SCHEMA, 
    REASONING_ANALYSIS_SCHEMA,
    PLAN_CREATION_SCHEMA,
    REFLECTION_SCHEMA,
    TOOL_RECOMMENDATION_SCHEMA
} from '../../../shared/schemas/JsonResponseSchemas';
import { 
    createLlmInstructionStartedPayload,
    createLlmInstructionCompletedPayload,
    createLlmInstructionErrorPayload,
    LlmInstructionStartedEventData,
    LlmInstructionCompletedEventData,
    LlmInstructionErrorEventData,
    createSystemEphemeralEventPayload,
    createSystemCoordinationEventPayload,
    createSystemContextAnalysisEventPayload,
    SystemEphemeralEventPayload,
    SystemCoordinationEventPayload,
    SystemContextAnalysisEventPayload,
    createTemporalContext,
    createBasicCoordinationAnalysis,
    validateSystemEventPayload
} from '../../../shared/schemas/EventPayloadSchema';
import { LlmProviderFactory } from '../../../shared/protocols/mcp/LlmProviderFactory';
import { McpMessage, McpRole, McpTextContent, McpContentType, IMcpClient } from '../../../shared/protocols/mcp/IMcpClient';
import { ChannelMessage, AgentId, ChannelId } from '../../../shared/types/ChannelContext';
import { ConversationTopic } from '../../../shared/types/ChannelContext';
import { 
    PromptInput,
    TopicsExtractionInput, 
    TopicExtractionResult,
    ConversationSummaryInput,
    ConversationSummaryResult,
    ReasoningAnalysisInput,
    ReasoningAnalysisResult,
    LlmOptions,
    LlmOperationResult
} from '../../../shared/types/LlmTypes';
import { v4 as uuidv4 } from 'uuid';
import { 
    SystemEvents,
    SystemEphemeralEventData,
    CoordinationAnalysis,
    TemporalContext,
    SystemEventType
} from '../../../shared/events/event-definitions/SystemEvents';
import { HybridMcpService } from '../../../shared/protocols/mcp/services/HybridMcpService';
import { createStrictValidator } from '../../../shared/utils/validation';
import { NetworkErrorType, classifyNetworkError } from '../../../shared/types/NetworkRecoveryTypes';

// JSON Schema definitions for structured outputs
import { McpToolHandlerContext, McpToolHandlerResult } from '../../../shared/protocols/mcp/McpServerTypes';

// ActionHistoryService removed - action history tracking moved to SDK side for proper client/server separation
import { createChannelMessage } from '../../../shared/schemas/MessageSchemas';
import { createChannelMessageEventPayload } from '../../../shared/schemas/EventPayloadSchema';

import { ChannelService } from './ChannelService';
import { AgentService } from './AgentService';
import { ConfigManager, ConfigEvents, ChannelSystemLlmChangeEvent } from '../../../sdk/config/ConfigManager';

const logger = new Logger('debug', 'SystemLlmService', 'server');
const validator = createStrictValidator('SystemLlmService');

/**
 * ORPAR Model Selection Strategy
 * Each ORPAR step uses models optimized for specific cognitive requirements
 */
export interface OrparModelConfig {
    observation: string;    // Fast, efficient data processing
    reasoning: string;      // Deep analysis, complex inference  
    action: string;         // Reliable execution, tool calling
    planning: string;       // Strategic thinking, scenario planning
    reflection: string;     // Meta-cognitive evaluation, learning
}

/**
 * Default ORPAR model configurations by provider
 */
const ORPAR_MODEL_CONFIGS: Record<LlmProviderType, OrparModelConfig> = {
    [LlmProviderType.OPENROUTER]: {
        observation: 'google/gemini-2.0-flash-lite-001',           // Fast, cheap observation processing
        reasoning: 'anthropic/claude-3.5-sonnet',                  // Advanced reasoning capabilities
        action: 'openai/gpt-4o-mini',                              // Reliable, cost-effective execution
        planning: 'google/gemini-2.5-pro-preview-05-06',          // Strategic planning with large context
        reflection: 'anthropic/claude-3.5-sonnet'                 // Meta-cognitive analysis
    },
    [LlmProviderType.GEMINI]: {
        observation: 'gemini-1.5-flash',
        reasoning: 'gemini-1.5-pro',
        action: 'gemini-1.5-flash',
        planning: 'gemini-1.5-pro',
        reflection: 'gemini-1.5-pro'
    },
    [LlmProviderType.OPENAI]: {
        observation: 'gpt-4o-mini',
        reasoning: 'gpt-4o',
        action: 'gpt-4o-mini',
        planning: 'gpt-4o',
        reflection: 'gpt-4o'
    },
    [LlmProviderType.ANTHROPIC]: {
        observation: 'claude-3-5-haiku-20241022',
        reasoning: 'claude-3-5-sonnet-20241022',
        action: 'claude-3-5-haiku-20241022',
        planning: 'claude-3-5-sonnet-20241022',
        reflection: 'claude-3-5-sonnet-20241022'
    },
    [LlmProviderType.AZURE_OPENAI]: {
        observation: 'gpt-4o-mini',
        reasoning: 'gpt-4o',
        action: 'gpt-4o-mini',
        planning: 'gpt-4o',
        reflection: 'gpt-4o'
    },
    [LlmProviderType.XAI]: {
        observation: 'grok-2-1212',
        reasoning: 'grok-2-1212',
        action: 'grok-2-1212',
        planning: 'grok-2-1212',
        reflection: 'grok-2-1212'
    },
    [LlmProviderType.OLLAMA]: {
        observation: 'llama3.2:3b',           // Fast, lightweight model
        reasoning: 'llama3.1:8b',            // Larger model for complex reasoning
        action: 'llama3.2:3b',               // Fast for tool execution
        planning: 'llama3.1:8b',             // Strategic thinking
        reflection: 'llama3.1:8b'            // Meta-cognitive evaluation
    },
    [LlmProviderType.CUSTOM]: {
        observation: 'custom-fast-model',
        reasoning: 'custom-reasoning-model',
        action: 'custom-action-model',
        planning: 'custom-planning-model',
        reflection: 'custom-reflection-model'
    },
    [LlmProviderType.PROVIDER_TYPE_1]: {
        observation: 'provider-1-fast',
        reasoning: 'provider-1-reasoning',
        action: 'provider-1-action',
        planning: 'provider-1-planning',
        reflection: 'provider-1-reflection'
    },
    [LlmProviderType.PROVIDER_TYPE_2]: {
        observation: 'provider-2-fast',
        reasoning: 'provider-2-reasoning',
        action: 'provider-2-action',
        planning: 'provider-2-planning',
        reflection: 'provider-2-reflection'
    },
    [LlmProviderType.PROVIDER_TYPE_3]: {
        observation: 'provider-3-fast',
        reasoning: 'provider-3-reasoning',
        action: 'provider-3-action',
        planning: 'provider-3-planning',
        reflection: 'provider-3-reflection'
    }
};

/**
 * ORPAR operation types for model selection
 */
export type OrparOperationType = 'observation' | 'reasoning' | 'action' | 'planning' | 'reflection';

/**
 * Priority 2: Response Interpretation Layer Interfaces
 */
export interface InterpretedAction {
    originalResponse: string;
    interpretedAction: any;
    confidence: number;
    executionTimeMs: number;
    agentId: string;
    channelId: string;
    timestamp: Date;
}

export interface SystemLLMInterpretationContext {
    agentRegistry: AgentRegistry;
    recentActions: ActionHistoryEntry[];
    channelContext: {
        activeAgents: string[];
        messageCount: number;
        lastActivity: number;
    };
    targetAgentId: string;
}

export interface AgentRegistry {
    [commonName: string]: {
        agentId: string;
        aliases: string[];
        role: string;
        capabilities: string[];
    };
}

export interface ActionHistoryEntry {
    agentId: string;
    action: string;
    timestamp: number;
    summary: string;
}

/**
 * Response interpretation schema for SystemLLM
 */
const RESPONSE_INTERPRETATION_SCHEMA = {
    type: 'object',
    properties: {
        intent: {
            type: 'string',
            enum: ['message', 'task_update', 'information_request', 'internal_reasoning'],
            description: 'The primary intent of the agent response'
        },
        targetAgentId: {
            type: 'string',
            description: 'The resolved target agent ID if this is a message'
        },
        toolCall: {
            type: 'object',
            properties: {
                name: { type: 'string' },
                arguments: { type: 'object' }
            },
            description: 'The recommended tool call to execute'
        },
        confidence: {
            type: 'number',
            minimum: 0,
            maximum: 1,
            description: 'Confidence score for the interpretation'
        },
        reasoning: {
            type: 'string',
            description: 'Explanation of the interpretation logic'
        }
    },
    required: ['intent', 'confidence', 'reasoning']
};

/**
 * Context persistence interface for ORPAR phases
 */
export interface OrparContext {
    id: string;
    agentId: string;
    channelId: string;
    cycleId: string;
    phase: OrparOperationType;
    timestamp: number;
    previousPhaseResults?: {
        observation?: any;
        reasoning?: any;
        planning?: any;
        action?: any;
        reflection?: any;
    };
    sharedContext?: {
        goals: string[];
        constraints: string[];
        resources: string[];
        insights: string[];
        confidence: number;
    };
    metadata: {
        startTime: number;
        phaseCompletionTimes: Map<OrparOperationType, number>;
        modelUsage: Map<OrparOperationType, string>;
        errors: string[];
    };
}

/**
 * Configuration interface for SystemLlmService
 */
export interface SystemLlmServiceConfig {
    providerType?: LlmProviderType;
    defaultModel?: string;
    defaultTemperature?: number;
    defaultMaxTokens?: number;
    orparModels?: Partial<OrparModelConfig>; // Allow custom ORPAR model overrides
    enableRealTimeCoordination?: boolean; // Allow disabling real-time coordination
    enableDynamicModelSelection?: boolean; // Enable complexity-based model switching (recommended for OpenRouter only)
}

/**
 * Default models for each provider type
 */
const DEFAULT_MODELS: Record<LlmProviderType, string> = {
    [LlmProviderType.OPENROUTER]: 'google/gemini-2.5-flash',  // Upgraded from lite for better comprehension
    [LlmProviderType.GEMINI]: 'gemini-1.5-flash',
    [LlmProviderType.OPENAI]: 'gpt-4o-mini',
    [LlmProviderType.ANTHROPIC]: 'claude-3-5-haiku-20241022',
    [LlmProviderType.AZURE_OPENAI]: 'gpt-4o-mini',
    [LlmProviderType.XAI]: 'grok-2-1212',
    [LlmProviderType.OLLAMA]: 'llama3.2:3b',
    [LlmProviderType.CUSTOM]: 'custom-model',
    [LlmProviderType.PROVIDER_TYPE_1]: 'provider-1-model',
    [LlmProviderType.PROVIDER_TYPE_2]: 'provider-2-model',
    [LlmProviderType.PROVIDER_TYPE_3]: 'provider-3-model'
};

/**
 * Cost-performance tiers for OpenRouter models
 */
export const OPENROUTER_MODEL_TIERS = {
    // Ultra-cheap (under $0.10/1M tokens)
    ULTRA_CHEAP: [
        'google/gemini-2.0-flash-lite-001',
        'meta-llama/llama-3.2-3b-instruct',
        'microsoft/phi-3.5-mini-128k-instruct',
        'google/gemini-flash-1.5',
        'openai/gpt-3.5-turbo'
    ],
    
    // Budget (under $1.00/1M tokens)  
    BUDGET: [
        'openai/gpt-4o-mini',
        'anthropic/claude-3.5-haiku',
        'meta-llama/llama-3.1-8b-instruct',
        'google/gemini-2.0-flash-exp',
        'qwen/qwen-2.5-32b-instruct'
    ],
    
    // Standard (under $5.00/1M tokens)
    STANDARD: [
        'anthropic/claude-3.5-sonnet',
        'openai/gpt-4o',
        'google/gemini-2.5-flash-preview-05-20',
        'meta-llama/llama-3.1-70b-instruct',
        'qwen/qwen-2.5-72b-instruct'
    ],
    
    // Premium (under $15.00/1M tokens)
    PREMIUM: [
        'google/gemini-2.5-pro-preview-05-06',
        'anthropic/claude-3-opus',
        'meta-llama/llama-3.1-405b-instruct',
        'mistralai/mistral-large',
        'cohere/command-r-plus'
    ],
    
    // Ultra-premium (reasoning models)
    ULTRA_PREMIUM: [
        'openai/o1-preview',
        'openai/o1-mini',
        'deepseek/deepseek-r1-preview',
        'google/gemini-2.5-flash-preview-05-20:thinking',
        'anthropic/claude-3.5-sonnet:beta'
    ]
} as const;

/**
 * Centralized System LLM Service for server-side AI operations
 * This service provides structured LLM interactions with JSON schema enforcement
 * and works with any configured LLM provider (OpenRouter, Gemini, OpenAI, etc.)
 */
export class SystemLlmService {
    private logger = logger;
    private providerType: LlmProviderType;
    private config: Required<SystemLlmServiceConfig>;
    private clientInstance: IMcpClient | null = null;
    private eventBus = EventBus.server;
    private hybridMcpService?: HybridMcpService;
    private configManager = ConfigManager.getInstance();

    // Real-time coordination tracking
    private coordinationInitialized = false;
    private coordinationEnabled = true; // Runtime coordination enabled flag
    private isShuttingDown = false;
    
    // Store bound function references for proper cleanup
    private boundHandleChannelMessageForCoordination: any;
    private boundHandleOrparEventForCoordination: any;
    private channelActivities = new Map<ChannelId, {
        messageCount: number;
        lastMessage: number;
        activeAgents: Set<AgentId>;
        recentMessages: ChannelMessage[];
        lastCoordinationSuggestion: number;
        suggestionCount: number;
    }>();
    
    // Coordination configuration
    private coordinationConfig = {
        highActivityThreshold: 10,      // Messages per minute - increased from 5
        coordinationCooldown: 600000,   // 10 minutes between suggestions - increased from 5 to reduce spam
        maxSuggestionsPerHour: 1,       // Rate limiting - reduced from 2 to 1
        minAgentsForCoordination: 3,    // Minimum agents needed - increased from 2
        significantActivityWindow: 30000 // 30 seconds - require sustained activity
    };
    
    // Message deduplication
    private processedMessages = new Set<string>();
    
    // Prevent multiple simultaneous coordination suggestions
    private coordinationInProgress = new Set<string>();
    
    // Track recent coordination content to prevent duplicates
    private recentCoordinationContent = new Map<string, { content: string; timestamp: number }>();
    
    // Global coordination cooldown to prevent spam across all channels
    private lastGlobalCoordinationTime = 0;
    
    // Channel-level coordination locks to prevent ANY concurrent coordination per channel
    private channelCoordinationLocks = new Map<string, number>();

    // Metrics collection
    private metrics = {
        requestCount: 0,
        totalResponseTime: 0,
        errorCount: 0,
        lastRequestTime: null as Date | null,
        operationBreakdown: {
            observation: 0,
            reasoning: 0,
            planning: 0,
            action: 0,
            reflection: 0
        },
        responseTimeBreakdown: {
            observation: 0,
            reasoning: 0,
            planning: 0,
            action: 0,
            reflection: 0
        },
        modelUsage: new Map<string, number>(),
        errorBreakdown: new Map<string, number>()
    };

    // Context persistence for ORPAR phases
    private activeContexts = new Map<string, OrparContext>();
    
    // Cleanup configuration
    private cleanupConfig = {
        channelActivityTtl: 1800000,        // 30 minutes TTL for channel activities
        contextTtl: 3600000,                // 1 hour TTL for ORPAR contexts
        cleanupInterval: 300000,            // 5 minutes cleanup interval
        maxChannelActivities: 1000          // Maximum number of channel activities to track
    };
    
    private cleanupTimer?: NodeJS.Timeout;
    private coordinationCleanupTimer?: NodeJS.Timeout;

    constructor(config: SystemLlmServiceConfig = {}, hybridMcpService?: HybridMcpService) {
        
        const providerType = config.providerType || LlmProviderType.OPENROUTER;
        
        
        // Determine if dynamic model selection should be enabled
        // Default: true for OpenRouter, false for other providers (unless explicitly set)
        const enableDynamicModelSelection = config.enableDynamicModelSelection !== undefined 
            ? config.enableDynamicModelSelection
            : (process.env.SYSTEMLLM_DYNAMIC_MODEL_SELECTION === 'true' 
                || (process.env.SYSTEMLLM_DYNAMIC_MODEL_SELECTION === undefined && providerType === LlmProviderType.OPENROUTER));
        
        this.config = {
            providerType,
            defaultModel: config.defaultModel || DEFAULT_MODELS[providerType],
            defaultTemperature: config.defaultTemperature || 0.3,
            defaultMaxTokens: config.defaultMaxTokens || 2000,
            orparModels: config.orparModels || ORPAR_MODEL_CONFIGS[providerType],
            enableRealTimeCoordination: config.enableRealTimeCoordination !== false, // Default to true unless explicitly disabled
            enableDynamicModelSelection
        };

        this.providerType = this.config.providerType;
        this.hybridMcpService = hybridMcpService;


        // Subscribe to config change events
        this.setupConfigEventListener();

        // Initialize real-time coordination if enabled by config
        const coordEnabled = this.configManager.isChannelSystemLlmEnabled(undefined, 'coordination');
        if (coordEnabled && this.config.enableRealTimeCoordination) {
            this.initializeRealTimeCoordination();
        } else {
        }

        // Initialize cleanup mechanisms
        this.initializeCleanupMechanisms();
    }

    /**
     * Set up listener for config change events
     */
    private setupConfigEventListener(): void {
        // Listen on server bus for config changes (events propagate from client bus via shared subject)
        this.eventBus.on(ConfigEvents.CHANNEL_SYSTEM_LLM_CHANGED, (payload: any) => {
            this.handleConfigChange(payload);
        });

    }

    /**
     * Handle configuration change events
     */
    private handleConfigChange(payload: any): void {
        try {
            const data = payload.data as ChannelSystemLlmChangeEvent;
            const channelId = data.channelId;

            // Log state transition
            const scope = channelId ? `channel ${channelId}` : 'global';
            if (data.enabled !== this.coordinationEnabled) {
            }

            // Check if coordination operation is specifically affected
            const coordEnabled = this.configManager.isChannelSystemLlmEnabled(channelId, 'coordination');

            if (!coordEnabled && this.coordinationInitialized) {
                // Coordination was enabled, now disabled
                this.disableCoordination();
                this.coordinationEnabled = false;
            } else if (coordEnabled && !this.coordinationInitialized && this.config.enableRealTimeCoordination) {
                // Coordination was disabled, now enabled
                this.initializeRealTimeCoordination();
                this.coordinationEnabled = true;
            }

        } catch (error) {
            this.logger.error(`❌ Failed to handle config change: ${error}`);
        }
    }

    /**
     * Disable coordination and cleanup listeners
     */
    private disableCoordination(): void {

        // Remove event listeners
        if (this.boundHandleChannelMessageForCoordination) {
            this.eventBus.off(Events.Message.AGENT_MESSAGE_DELIVERED, this.boundHandleChannelMessageForCoordination);
        }
        if (this.boundHandleOrparEventForCoordination) {
            this.eventBus.off(Events.ControlLoop.REASONING, this.boundHandleOrparEventForCoordination);
            this.eventBus.off(Events.ControlLoop.PLAN, this.boundHandleOrparEventForCoordination);
            this.eventBus.off(Events.ControlLoop.ACTION, this.boundHandleOrparEventForCoordination);
        }

        // Clear timers
        if (this.coordinationCleanupTimer) {
            clearInterval(this.coordinationCleanupTimer);
            this.coordinationCleanupTimer = undefined;
        }

        // Clear coordination state
        this.channelCoordinationLocks.clear();
        this.processedMessages.clear();
        this.coordinationInProgress.clear();
        this.recentCoordinationContent.clear();

        this.coordinationInitialized = false;
    }

    /**
     * Create empty coordination analysis when coordination is disabled
     */
    private createEmptyCoordinationAnalysis(channelId: ChannelId): CoordinationAnalysis {
        return {
            channelId,
            activeAgents: [],
            opportunities: [],
            activityMetrics: {
                messageCount: 0,
                toolUsage: 0,
                interactionDensity: 0,
                timePeriod: '0m'
            },
            temporalPatterns: [],
            analysisTime: new Date().toISOString()
        };
    }

    /**
     * Get default model for the configured provider
     */
    get defaultModel(): string {
        return this.config.defaultModel;
    }

    /**
     * Get default temperature setting
     */
    get defaultTemperature(): number {
        return this.config.defaultTemperature;
    }

    /**
     * Get default max tokens setting
     */
    get defaultMaxTokens(): number {
        return this.config.defaultMaxTokens;
    }

    /**
     * Get the appropriate model for a specific ORPAR operation
     */
    public getModelForOperation(operation: OrparOperationType): string {
        const defaultModelConfig = ORPAR_MODEL_CONFIGS[this.providerType];
        const customModelConfig = this.config.orparModels || {};
        
        // Use custom model if provided, otherwise use default for operation
        const selectedModel = customModelConfig[operation] || defaultModelConfig[operation];
        
        
        return selectedModel;
    }

    /**
     * Dynamic model selection based on context complexity
     */
    public getModelForOperationWithComplexity(
        operation: OrparOperationType, 
        context?: OrparContext,
        complexityOverride?: 'simple' | 'moderate' | 'complex'
    ): string {
        const baseModel = this.getModelForOperation(operation);
        
        // Calculate complexity score if context is provided
        let complexity = complexityOverride;
        if (!complexity && context) {
            complexity = this.assessContextComplexity(context);
        }
        
        // If no complexity assessment possible, return base model
        if (!complexity) {
            return baseModel;
        }
        
        // Get complexity-adjusted model
        return this.selectModelByComplexity(operation, complexity);
    }

    /**
     * Assess context complexity for dynamic model selection
     */
    private assessContextComplexity(context: OrparContext): 'simple' | 'moderate' | 'complex' {
        let complexityScore = 0;
        
        // Factor 1: Number of previous phases completed
        const completedPhases = context.metadata.phaseCompletionTimes.size;
        complexityScore += completedPhases * 0.2;
        
        // Factor 2: Number of errors encountered (more errors = higher complexity)
        complexityScore += context.metadata.errors.length * 0.5;
        
        // Factor 3: Shared context richness (more context = higher complexity)
        if (context.sharedContext) {
            const contextRichness = 
                context.sharedContext.goals.length +
                context.sharedContext.constraints.length +
                context.sharedContext.insights.length;
            complexityScore += contextRichness * 0.1;
        }
        
        // Factor 4: Previous phase results complexity (more data = higher complexity)
        if (context.previousPhaseResults) {
            const phaseCount = Object.keys(context.previousPhaseResults).length;
            complexityScore += phaseCount * 0.3;
            
            // Additional complexity for large result sets
            for (const result of Object.values(context.previousPhaseResults)) {
                if (result && typeof result === 'object') {
                    const resultSize = JSON.stringify(result).length;
                    if (resultSize > 5000) complexityScore += 0.3; // Large results
                    if (resultSize > 15000) complexityScore += 0.5; // Very large results
                }
            }
        }
        
        // Factor 5: Confidence level (lower confidence = higher complexity)
        if (context.sharedContext?.confidence !== undefined) {
            complexityScore += (1 - context.sharedContext.confidence) * 0.5;
        }
        
        // Factor 6: Time elapsed (longer cycles may indicate complexity)
        const elapsed = Date.now() - context.metadata.startTime;
        const hoursElapsed = elapsed / (1000 * 60 * 60);
        complexityScore += Math.min(hoursElapsed * 0.2, 1.0);
        
        // Factor 7: Model usage patterns (frequent model changes = higher complexity)
        const uniqueModels = new Set(context.metadata.modelUsage.values()).size;
        if (uniqueModels > 2) complexityScore += 0.3;
        if (uniqueModels > 4) complexityScore += 0.5;
        
        // Factor 8: Phase completion time variance (inconsistent times = complexity)
        const completionTimes = Array.from(context.metadata.phaseCompletionTimes.values());
        if (completionTimes.length > 1) {
            const avgTime = completionTimes.reduce((a, b) => a + b, 0) / completionTimes.length;
            const variance = completionTimes.reduce((sum, time) => sum + Math.pow(time - avgTime, 2), 0) / completionTimes.length;
            const stdDev = Math.sqrt(variance);
            if (stdDev > 30000) complexityScore += 0.3; // High time variance
        }
        
        // Classify complexity with adjusted thresholds
        if (complexityScore < 1.2) return 'simple';
        if (complexityScore < 3.0) return 'moderate';
        return 'complex';
    }

    /**
     * Enhanced complexity assessment with operation-specific weighting
     */
    private assessComplexityForOperation(
        context: OrparContext, 
        operation: OrparOperationType
    ): 'simple' | 'moderate' | 'complex' {
        const baseComplexity = this.assessContextComplexity(context);
        
        // Operation-specific complexity adjustments
        const operationComplexityFactors = {
            observation: 1.0,    // Standard complexity
            reasoning: 1.3,      // Reasoning is inherently more complex
            action: 0.9,         // Actions are often straightforward
            planning: 1.4,       // Planning requires strategic thinking
            reflection: 1.2      // Reflection needs meta-cognitive analysis
        };
        
        const factor = operationComplexityFactors[operation];
        const adjustedScore = this.getComplexityScore(context) * factor;
        
        // Re-classify with adjusted score
        if (adjustedScore < 1.2 * factor) return 'simple';
        if (adjustedScore < 3.0 * factor) return 'moderate';
        return 'complex';
    }

    /**
     * Get numeric complexity score for advanced model selection
     */
    private getComplexityScore(context: OrparContext): number {
        let score = 0;
        
        // All the factors from assessContextComplexity but returning the score
        const completedPhases = context.metadata.phaseCompletionTimes.size;
        score += completedPhases * 0.2;
        
        score += context.metadata.errors.length * 0.5;
        
        if (context.sharedContext) {
            const contextRichness = 
                context.sharedContext.goals.length +
                context.sharedContext.constraints.length +
                context.sharedContext.insights.length;
            score += contextRichness * 0.1;
        }
        
        if (context.previousPhaseResults) {
            const phaseCount = Object.keys(context.previousPhaseResults).length;
            score += phaseCount * 0.3;
        }
        
        if (context.sharedContext?.confidence !== undefined) {
            score += (1 - context.sharedContext.confidence) * 0.5;
        }
        
        const elapsed = Date.now() - context.metadata.startTime;
        const hoursElapsed = elapsed / (1000 * 60 * 60);
        score += Math.min(hoursElapsed * 0.2, 1.0);
        
        return score;
    }

    /**
     * Select model based on complexity level
     */
    private selectModelByComplexity(
        operation: OrparOperationType, 
        complexity: 'simple' | 'moderate' | 'complex'
    ): string {
        const defaultModelConfig = ORPAR_MODEL_CONFIGS[this.providerType];
        const baseModel = defaultModelConfig[operation];
        
        // If dynamic model selection is disabled, always use base model
        if (!this.config.enableDynamicModelSelection) {
            return baseModel;
        }
        
        // Model upgrade mappings based on provider with comprehensive OpenRouter catalog
        const modelUpgrades: Record<LlmProviderType, Record<string, { moderate: string; complex: string }>> = {
            [LlmProviderType.OPENROUTER]: {
                // === FAST/CHEAP MODELS (Simple Tasks) ===
                'google/gemini-2.0-flash-lite-001': {
                    moderate: 'openai/gpt-4o-mini',
                    complex: 'anthropic/claude-3.5-sonnet'
                },
                'openai/gpt-4o-mini-2': {
                    moderate: 'openai/gpt-4o',
                    complex: 'openai/o1-preview'
                },
                'meta-llama/llama-3.2-3b-instruct': {
                    moderate: 'meta-llama/llama-3.1-8b-instruct',
                    complex: 'meta-llama/llama-3.1-70b-instruct'
                },
                'microsoft/phi-3.5-mini-128k-instruct': {
                    moderate: 'microsoft/phi-3-medium-128k-instruct',
                    complex: 'anthropic/claude-3.5-sonnet'
                },
                
                // === REASONING MODELS (Observation/Analysis) ===
                'anthropic/claude-3.5-sonnet': {
                    moderate: 'anthropic/claude-3.5-sonnet:beta',
                    complex: 'anthropic/claude-3-opus'
                },
                'openai/gpt-4o': {
                    moderate: 'openai/o1-mini',
                    complex: 'openai/o1-preview'
                },
                'google/gemini-2.5-flash-preview-05-20': {
                    moderate: 'google/gemini-2.5-pro-preview-05-06',
                    complex: 'google/gemini-2.5-flash-preview-05-20:thinking'
                },
                
                // === PLANNING MODELS (Strategic Thinking) ===
                'google/gemini-2.5-pro-preview-05-06': {
                    moderate: 'openai/o1-mini',
                    complex: 'openai/o1-preview'
                },
                'meta-llama/llama-3.1-70b-instruct': {
                    moderate: 'meta-llama/llama-3.1-405b-instruct',
                    complex: 'openai/o1-preview'
                },
                'qwen/qwen-2.5-72b-instruct': {
                    moderate: 'anthropic/claude-3.5-sonnet',
                    complex: 'anthropic/claude-3-opus'
                },
                
                // === ACTION MODELS (Tool Calling/Execution) ===
                'openai/gpt-4o-mini': {
                    moderate: 'openai/gpt-4o',
                    complex: 'anthropic/claude-3.5-sonnet'
                },
                'google/gemini-2.0-flash-exp': {
                    moderate: 'google/gemini-2.5-pro-preview-05-06',
                    complex: 'openai/gpt-4o'
                },
                'anthropic/claude-3-haiku': {
                    moderate: 'anthropic/claude-3.5-sonnet',
                    complex: 'anthropic/claude-3-opus'
                },
                
                // === REFLECTION MODELS (Meta-cognitive Analysis) ===
                'openai/o1-mini': {
                    moderate: 'openai/o1-preview',
                    complex: 'anthropic/claude-3-opus'
                },
                'anthropic/claude-3-opus': {
                    moderate: 'anthropic/claude-3-opus',
                    complex: 'openai/o1-preview'
                },
                'google/gemini-2.5-flash-preview-05-20:thinking': {
                    moderate: 'openai/o1-mini',
                    complex: 'openai/o1-preview'
                },
                
                // === SPECIALIZED MODELS ===
                'deepseek/deepseek-chat': {
                    moderate: 'deepseek/deepseek-r1-lite-preview',
                    complex: 'deepseek/deepseek-r1-preview'
                },
                'x-ai/grok-2-1212': {
                    moderate: 'x-ai/grok-2-vision-1212',
                    complex: 'anthropic/claude-3-opus'
                },
                'mistralai/mistral-large': {
                    moderate: 'anthropic/claude-3.5-sonnet',
                    complex: 'openai/o1-preview'
                },
                'cohere/command-r-plus': {
                    moderate: 'anthropic/claude-3.5-sonnet',
                    complex: 'anthropic/claude-3-opus'
                },
                
                // === OPEN SOURCE HIGH-PERFORMANCE ===
                'meta-llama/llama-3.1-8b-instruct': {
                    moderate: 'meta-llama/llama-3.1-70b-instruct',
                    complex: 'meta-llama/llama-3.1-405b-instruct'
                },
                'meta-llama/llama-3.1-405b-instruct': {
                    moderate: 'anthropic/claude-3.5-sonnet',
                    complex: 'openai/o1-preview'
                },
                'qwen/qwen-2.5-32b-instruct': {
                    moderate: 'qwen/qwen-2.5-72b-instruct',
                    complex: 'anthropic/claude-3.5-sonnet'
                },
                
                // === COST-OPTIMIZED PATHS ===
                'google/gemini-flash-1.5': {
                    moderate: 'google/gemini-2.0-flash-exp',
                    complex: 'google/gemini-2.5-pro-preview-05-06'
                },
                'anthropic/claude-3.5-haiku': {
                    moderate: 'anthropic/claude-3.5-sonnet',
                    complex: 'anthropic/claude-3-opus'
                },
                'openai/gpt-3.5-turbo': {
                    moderate: 'openai/gpt-4o-mini',
                    complex: 'openai/gpt-4o'
                }
            },
            [LlmProviderType.OPENAI]: {
                'gpt-4o-mini': {
                    moderate: 'gpt-4o',
                    complex: 'gpt-4o'
                },
                'gpt-4o': {
                    moderate: 'gpt-4o',
                    complex: 'gpt-4o'
                }
            },
            [LlmProviderType.ANTHROPIC]: {
                'claude-3-5-haiku-20241022': {
                    moderate: 'claude-3-5-sonnet-20241022',
                    complex: 'claude-3-5-sonnet-20241022'
                },
                'claude-3-5-sonnet-20241022': {
                    moderate: 'claude-3-5-sonnet-20241022',
                    complex: 'claude-3-5-sonnet-20241022'
                }
            },
            [LlmProviderType.AZURE_OPENAI]: {
                'gpt-4o-mini': {
                    moderate: 'gpt-4o',
                    complex: 'gpt-4o'
                },
                'gpt-4o': {
                    moderate: 'gpt-4o',
                    complex: 'gpt-4o'
                }
            },
            // Default mappings for other providers  
            [LlmProviderType.GEMINI]: { 
                [baseModel]: { moderate: baseModel, complex: baseModel }
            },
            [LlmProviderType.XAI]: { 
                [baseModel]: { moderate: baseModel, complex: baseModel }
            },
            [LlmProviderType.OLLAMA]: { 
                [baseModel]: { moderate: baseModel, complex: baseModel }
            },
            [LlmProviderType.CUSTOM]: { 
                [baseModel]: { moderate: baseModel, complex: baseModel }
            },
            [LlmProviderType.PROVIDER_TYPE_1]: { 
                [baseModel]: { moderate: baseModel, complex: baseModel }
            },
            [LlmProviderType.PROVIDER_TYPE_2]: { 
                [baseModel]: { moderate: baseModel, complex: baseModel }
            },
            [LlmProviderType.PROVIDER_TYPE_3]: { 
                [baseModel]: { moderate: baseModel, complex: baseModel }
            }
        };
        
        // Get upgrade path for current provider and base model
        const upgrades = modelUpgrades[this.providerType]?.[baseModel];
        if (!upgrades) {
            return baseModel; // No upgrade available
        }
        
        let selectedModel = baseModel;
        switch (complexity) {
            case 'simple':
                selectedModel = baseModel;
                break;
            case 'moderate':
                selectedModel = upgrades.moderate;
                break;
            case 'complex':
                selectedModel = upgrades.complex;
                break;
        }
        
        
        return selectedModel;
    }

    /**
     * Get cost-aware model recommendation based on budget constraints
     */
    public getCostAwareModel(
        operation: OrparOperationType,
        context?: OrparContext,
        budgetTier: keyof typeof OPENROUTER_MODEL_TIERS = 'STANDARD'
    ): string {
        if (this.providerType !== LlmProviderType.OPENROUTER) {
            return this.getModelForOperationWithComplexity(operation, context);
        }

        const complexity = context ? this.assessContextComplexity(context) : 'simple';
        const tierModels = OPENROUTER_MODEL_TIERS[budgetTier] as readonly string[];
        
        // Select model based on operation type and complexity within budget tier
        const operationModelPreferences = {
            observation: [
                'google/gemini-2.0-flash-lite-001',
                'openai/gpt-4o-mini',
                'anthropic/claude-3.5-haiku',
                'google/gemini-2.0-flash-exp'
            ],
            reasoning: [
                'anthropic/claude-3.5-sonnet',
                'openai/gpt-4o',
                'google/gemini-2.5-flash-preview-05-20',
                'openai/o1-mini'
            ],
            action: [
                'openai/gpt-4o-mini',
                'openai/gpt-4o',
                'anthropic/claude-3.5-sonnet',
                'google/gemini-2.5-pro-preview-05-06'
            ],
            planning: [
                'google/gemini-2.5-pro-preview-05-06',
                'anthropic/claude-3-opus',
                'openai/o1-preview',
                'meta-llama/llama-3.1-405b-instruct'
            ],
            reflection: [
                'anthropic/claude-3.5-sonnet',
                'openai/o1-mini',
                'anthropic/claude-3-opus',
                'openai/o1-preview'
            ]
        };

        // Find intersection of preferred models and budget tier
        const preferredModels = operationModelPreferences[operation];
        const availableInTier = preferredModels.filter(model => tierModels.includes(model));
        
        if (availableInTier.length === 0) {
            // Fallback to first model in tier if no preferences match
            return tierModels[0];
        }

        // Select based on complexity
        const complexityIndex = complexity === 'simple' ? 0 : 
                              complexity === 'moderate' ? Math.min(1, availableInTier.length - 1) :
                              Math.min(2, availableInTier.length - 1);
        
        const selectedModel = availableInTier[complexityIndex];
        

        return selectedModel;
    }

    /**
     * Get model recommendation with load balancing across providers
     */
    public getLoadBalancedModel(
        operation: OrparOperationType,
        context?: OrparContext,
        preferredProviders: string[] = ['anthropic', 'openai', 'google']
    ): string {
        if (this.providerType !== LlmProviderType.OPENROUTER) {
            return this.getModelForOperationWithComplexity(operation, context);
        }

        const complexity = context ? this.assessContextComplexity(context) : 'simple';
        
        // Load balancing logic - rotate through providers based on current load
        const currentHour = new Date().getHours();
        const providerIndex = currentHour % preferredProviders.length;
        const selectedProvider = preferredProviders[providerIndex];

        const providerModels = {
            anthropic: {
                simple: 'anthropic/claude-3.5-haiku',
                moderate: 'anthropic/claude-3.5-sonnet',
                complex: 'anthropic/claude-3-opus'
            },
            openai: {
                simple: 'openai/gpt-4o-mini',
                moderate: 'openai/gpt-4o',
                complex: 'openai/o1-preview'
            },
            google: {
                simple: 'google/gemini-2.0-flash-lite-001',
                moderate: 'google/gemini-2.5-flash-preview-05-20',
                complex: 'google/gemini-2.5-pro-preview-05-06'
            },
            meta: {
                simple: 'meta-llama/llama-3.1-8b-instruct',
                moderate: 'meta-llama/llama-3.1-70b-instruct', 
                complex: 'meta-llama/llama-3.1-405b-instruct'
            },
            deepseek: {
                simple: 'deepseek/deepseek-chat',
                moderate: 'deepseek/deepseek-r1-lite-preview',
                complex: 'deepseek/deepseek-r1-preview'
            }
        };

        const models = providerModels[selectedProvider as keyof typeof providerModels];
        const selectedModel = models ? models[complexity] || this.getModelForOperation(operation) : this.getModelForOperation(operation);


        return selectedModel;
    }

    /**
     * Get optimized model for coordination suggestions - prioritizes speed and cost efficiency
     * Uses simple, fast models instead of complex load balancing to reduce overhead
     */
    private getOptimizedCoordinationModel(): string {
        if (this.providerType !== LlmProviderType.OPENROUTER) {
            return this.getModelForOperation('reasoning');
        }

        // For coordination suggestions, always use the fastest, cheapest models
        // Since coordination suggestions are simple, short tasks (max 80 words)
        // Priority: Speed > Cost > Quality (simple tasks don't need premium models)
        return 'anthropic/claude-3.5-haiku'; // Fast, cheap, reliable for simple coordination tasks
    }

    /**
     * Get specialized model for specific use cases
     */
    public getSpecializedModel(
        operation: OrparOperationType,
        specialization: 'reasoning' | 'coding' | 'analysis' | 'creative' | 'multilingual' | 'speed',
        context?: OrparContext
    ): string {
        if (this.providerType !== LlmProviderType.OPENROUTER) {
            return this.getModelForOperationWithComplexity(operation, context);
        }

        const complexity = context ? this.assessContextComplexity(context) : 'moderate';
        
        const specializationModels = {
            reasoning: {
                simple: 'openai/o1-mini',
                moderate: 'openai/o1-preview',
                complex: 'deepseek/deepseek-r1-preview'
            },
            coding: {
                simple: 'meta-llama/llama-3.1-8b-instruct',
                moderate: 'anthropic/claude-3.5-sonnet',
                complex: 'deepseek/deepseek-r1-preview'
            },
            analysis: {
                simple: 'anthropic/claude-3.5-haiku',
                moderate: 'anthropic/claude-3.5-sonnet',
                complex: 'anthropic/claude-3-opus'
            },
            creative: {
                simple: 'google/gemini-2.0-flash-exp',
                moderate: 'google/gemini-2.5-flash-preview-05-20',
                complex: 'anthropic/claude-3-opus'
            },
            multilingual: {
                simple: 'qwen/qwen-2.5-32b-instruct',
                moderate: 'qwen/qwen-2.5-72b-instruct',
                complex: 'google/gemini-2.5-pro-preview-05-06'
            },
            speed: {
                simple: 'google/gemini-2.0-flash-lite-001',
                moderate: 'openai/gpt-4o-mini',
                complex: 'google/gemini-2.0-flash-exp'
            }
        };

        const selectedModel = specializationModels[specialization][complexity];
        

        return selectedModel;
    }

    /**
     * Execute multiple ORPAR operations in parallel
     */
    public executeParallelOperations<T>(
        operations: Array<{
            type: 'observation' | 'action' | 'reflection';
            data: any;
            context?: OrparContext;
        }>
    ): Observable<Array<{ type: string; result: T | null; error?: Error }>> {
        return new Observable(observer => {
            const parallelObservables = operations.map(op => {
                let operation$: Observable<any>;
                
                switch (op.type) {
                    case 'observation':
                        operation$ = this.processObservationData(op.data, op.context);
                        break;
                    case 'action':
                        operation$ = this.analyzeActionExecution(op.data.action, op.data.result, op.context);
                        break;
                    case 'reflection':
                        operation$ = this.generateReflection(op.data.plan, op.data.actions, op.data.results, op.context);
                        break;
                    default:
                        operation$ = new Observable(obs => obs.error(new Error(`Unknown operation type: ${op.type}`)));
                }
                
                return operation$.pipe(
                    map(result => ({ type: op.type, result: result as T, error: undefined as Error | undefined })),
                    catchError(error => of({ type: op.type, result: null as T | null, error: error as Error }))
                );
            });
            
            // Execute all operations in parallel using forkJoin
            if (parallelObservables.length === 0) {
                observer.next([]);
                observer.complete();
                return;
            }
            
            // Use lastValueFrom to handle the parallel execution
            Promise.all(parallelObservables.map(obs => lastValueFrom(obs)))
                .then(results => {
                    observer.next(results);
                    observer.complete();
                })
                .catch(error => {
                    observer.error(error);
                });
        });
    }

    /**
     * Batch process observations for multiple agents in parallel
     */
    public batchProcessObservations(
        observationBatches: Array<{
            agentId: string;
            observations: Observation[];
            context?: OrparContext;
        }>
    ): Observable<Array<{ agentId: string; result: any; error?: Error }>> {
        return new Observable(observer => {
            const parallelObservables = observationBatches.map(batch => {
                return this.processObservationData(batch.observations, batch.context).pipe(
                    map(result => ({ agentId: batch.agentId, result, error: undefined })),
                    catchError(error => of({ agentId: batch.agentId, result: null, error }))
                );
            });
            
            if (parallelObservables.length === 0) {
                observer.next([]);
                observer.complete();
                return;
            }
            
            Promise.all(parallelObservables.map(obs => lastValueFrom(obs)))
                .then(results => {
                    observer.next(results);
                    observer.complete();
                })
                .catch(error => {
                    observer.error(error);
                });
        });
    }

    /**
     * Parallel action analysis for multiple executed actions
     */
    public batchAnalyzeActions(
        actionBatches: Array<{
            actionId: string;
            action: PlanAction;
            executionResult: any;
            context?: OrparContext;
        }>
    ): Observable<Array<{ actionId: string; result: any; error?: Error }>> {
        return new Observable(observer => {
            const parallelObservables = actionBatches.map(batch => {
                return this.analyzeActionExecution(batch.action, batch.executionResult, batch.context).pipe(
                    map(result => ({ actionId: batch.actionId, result, error: undefined })),
                    catchError(error => of({ actionId: batch.actionId, result: null, error }))
                );
            });
            
            if (parallelObservables.length === 0) {
                observer.next([]);
                observer.complete();
                return;
            }
            
            Promise.all(parallelObservables.map(obs => lastValueFrom(obs)))
                .then(results => {
                    observer.next(results);
                    observer.complete();
                })
                .catch(error => {
                    observer.error(error);
                });
        });
    }

    /**
     * Parallel plan creation for multiple reasoning contexts
     */
    public batchCreatePlans(
        planRequests: Array<{
            planId: string;
            reasoning: Reasoning;
            context?: OrparContext;
            previousPlans?: Plan[];
        }>
    ): Observable<Array<{ planId: string; result: Plan | null; error?: Error }>> {
        return new Observable(observer => {
            const parallelObservables = planRequests.map(request => {
                return this.createPlan(request.reasoning, request.context, request.previousPlans).pipe(
                    map(result => ({ planId: request.planId, result, error: undefined as Error | undefined })),
                    catchError(error => of({ planId: request.planId, result: null as Plan | null, error: error as Error }))
                );
            });
            
            if (parallelObservables.length === 0) {
                observer.next([]);
                observer.complete();
                return;
            }
            
            Promise.all(parallelObservables.map(obs => lastValueFrom(obs)))
                .then(results => {
                    observer.next(results);
                    observer.complete();
                })
                .catch(error => {
                    observer.error(error);
                });
        });
    }

    /**
     * Process multiple LLM requests in parallel with different models
     */
    public parallelLlmRequests(
        requests: Array<{
            id: string;
            prompt: string;
            operation: OrparOperationType;
            schema?: any;
            context?: OrparContext;
            options?: any;
        }>
    ): Observable<Array<{ id: string; result: string; model: string; error?: Error }>> {
        return new Observable(observer => {
            const parallelObservables = requests.map(request => {
                const model = this.getModelForOperationWithComplexity(request.operation, request.context);
                const options = { 
                    ...request.options, 
                    model, 
                    operation: request.operation 
                };
                
                return new Observable<{ id: string; result: string; model: string; error?: Error }>(obs => {
                    this.sendLlmRequestWithRecovery(request.prompt, request.schema, options)
                        .then(result => {
                            obs.next({ id: request.id, result, model, error: undefined });
                            obs.complete();
                        })
                        .catch(error => {
                            obs.next({ id: request.id, result: '', model, error });
                            obs.complete();
                        });
                });
            });
            
            if (parallelObservables.length === 0) {
                observer.next([]);
                observer.complete();
                return;
            }
            
            Promise.all(parallelObservables.map(obs => lastValueFrom(obs)))
                .then(results => {
                    observer.next(results);
                    observer.complete();
                })
                .catch(error => {
                    observer.error(error);
                });
        });
    }

    /**
     * Process observation data with fast, efficient models
     */
    processObservationData(observations: Observation[], context?: OrparContext): Observable<any> {
        const startTime = Date.now();
        const instructionId = this.generateInstructionId('observation');
        this.logger.debug(`[ORPAR:OBSERVATION] Starting observation processing - ${observations.length} observations, context phase: ${context?.phase || 'none'}`);
        this.emitInstructionStarted(instructionId, 'observation-processing');

        const basePrompt = `
        As the MXF coordination intelligence system, analyze these agent observations to identify collaboration opportunities:
        
        Agent Observations:
        ${observations.map(obs => `- ${obs.content} (from ${obs.source})`).join('\n')}
        
        COORDINATION-FOCUSED ANALYSIS:
        1. **Cross-Agent Collaboration Patterns**: What coordination opportunities exist between these agents?
        2. **Skill Synergy Detection**: Which agents have complementary capabilities that could be leveraged?
        3. **Communication Flow Optimization**: How can information sharing between agents be improved?
        4. **Resource Coordination**: What shared resources or tools could enhance multi-agent efficiency?
        5. **Strategic Coordination Insights**: What system-level coordination strategies would maximize agent effectiveness?
        
        Focus on actionable coordination recommendations that enhance multi-agent collaboration.
        `;

        const prompt = this.buildContextAwarePrompt(basePrompt, context);

        const model = this.getModelForOperationWithComplexity('observation', context);
        this.logger.debug(`[ORPAR:OBSERVATION] Selected model: ${model}, prompt length: ${prompt.length} chars`);

        return new Observable(observer => {
            this.sendLlmRequestWithRecovery(prompt, null, { model, operation: 'observation' })
                .then(response => {
                    const elapsed = Date.now() - startTime;
                    this.logger.debug(`[ORPAR:OBSERVATION] Completed in ${elapsed}ms - response length: ${response?.length || 0} chars`);
                    this.emitInstructionCompleted(instructionId, response);
                    observer.next(response);
                    observer.complete();
                })
                .catch(error => {
                    const elapsed = Date.now() - startTime;
                    this.logger.debug(`[ORPAR:OBSERVATION] Failed after ${elapsed}ms - error: ${error.message}`);
                    this.emitInstructionError(instructionId, error.message);
                    observer.error(error);
                });
        });
    }

    /**
     * Create strategic plans with sophisticated planning models
     */
    createPlan(reasoning: Reasoning, orparContext?: OrparContext, previousPlans?: Plan[]): Observable<Plan> {
        const startTime = Date.now();
        const instructionId = this.generateInstructionId('planning');
        this.logger.debug(`[ORPAR:PLANNING] Starting plan creation - reasoning ID: ${reasoning.id}, previous plans: ${previousPlans?.length || 0}`);
        this.emitInstructionStarted(instructionId, 'plan-creation');

        // Extract readable text from reasoning content (handle both string and object formats)
        let reasoningText: string;
        if (typeof reasoning.content === 'string') {
            reasoningText = reasoning.content;
        } else if (reasoning.content && typeof reasoning.content === 'object') {
            // Handle structured reasoning content
            const content = reasoning.content as any;
            const parts = [];
            
            if (content.summary) parts.push(`Summary: ${content.summary}`);
            if (content.details) parts.push(`Details: ${content.details}`);
            if (content.goals && Array.isArray(content.goals)) {
                parts.push(`Suggested Actions: ${content.goals.join(', ')}`);
            }
            if (content.insights && Array.isArray(content.insights)) {
                parts.push(`Insights: ${content.insights.join(', ')}`);
            }
            if (content.confidence !== undefined) {
                parts.push(`Confidence: ${content.confidence}`);
            }
            
            reasoningText = parts.join('\n');
        } else {
            reasoningText = String(reasoning.content);
        }

        const basePrompt = `
        As the MXF coordination intelligence system, create strategic coordination plans based on agent reasoning:
        
        Agent Reasoning Analysis: ${reasoningText}
        ${previousPlans ? `Previous Coordination Initiatives: ${previousPlans.map(p => p.description).join(', ')}` : ''}
        
        STRATEGIC COORDINATION PLANNING:
        1. **Multi-Agent Coordination Objectives**: Define clear collaboration goals that leverage agent synergies
        2. **Cross-Agent Communication Strategy**: Establish optimal information flow patterns between agents
        3. **Resource Sharing Protocols**: Plan efficient allocation and sharing of tools, data, and capabilities
        4. **Collaborative Task Distribution**: Identify how complex tasks can be divided for parallel agent execution
        5. **Coordination Success Metrics**: Define measurable outcomes for multi-agent collaboration effectiveness
        
        Prioritize coordination strategies that maximize collective agent intelligence and minimize redundant efforts.
        `;

        const prompt = this.buildContextAwarePrompt(basePrompt, orparContext);

        const model = this.getModelForOperationWithComplexity('planning', orparContext);
        this.logger.debug(`[ORPAR:PLANNING] Selected model: ${model}, reasoning text length: ${reasoningText.length} chars`);

        return new Observable(observer => {
            this.sendLlmRequestWithRecovery(prompt, PLAN_CREATION_SCHEMA, { model, operation: 'planning' })
                .then(response => {
                    try {
                        const llmResponse = JSON.parse(response);
                        const plan: Plan = {
                            id: uuidv4(),
                            agentId: reasoning.agentId,
                            reasoningId: reasoning.id,
                            actions: llmResponse.plan?.actions?.map((action: any) => ({
                                ...action,
                                timestamp: Date.now(),
                                dependencies: action.dependencies || [],
                                result: undefined,
                                error: undefined
                            })) || [],
                            timestamp: Date.now(),
                            goal: llmResponse.plan?.goal || `Goal based on reasoning: ${reasoning.id}`,
                            description: llmResponse.plan?.description || response,
                            createdAt: new Date(),
                            status: 'created',
                            metadata: {
                                model,
                                instructionId,
                                llmGenerated: true,
                                priority: llmResponse.plan?.priority,
                                estimatedDuration: llmResponse.plan?.estimatedDuration,
                                resources: llmResponse.plan?.resources,
                                successMetrics: llmResponse.plan?.successMetrics,
                                risks: llmResponse.plan?.risks
                            }
                        };
                        
                        const elapsed = Date.now() - startTime;
                        this.logger.debug(`[ORPAR:PLANNING] Plan created in ${elapsed}ms - plan ID: ${plan.id}, ${plan.actions.length} actions, goal: ${plan.goal?.substring(0, 50)}...`);
                        this.emitInstructionCompleted(instructionId, response);
                        observer.next(plan);
                        observer.complete();
                    } catch (parseError) {
                        // Fallback to original structure if JSON parsing fails
                        this.logger.debug(`[ORPAR:PLANNING] JSON parse failed, using fallback structure - error: ${parseError instanceof Error ? parseError.message : String(parseError)}`);
                        const plan: Plan = {
                            id: uuidv4(),
                            agentId: reasoning.agentId,
                            reasoningId: reasoning.id,
                            actions: [],
                            timestamp: Date.now(),
                            goal: `Goal based on reasoning: ${reasoning.id}`,
                            description: response,
                            createdAt: new Date(),
                            status: 'created',
                            metadata: {
                                model,
                                instructionId,
                                llmGenerated: false,
                                parseError: parseError instanceof Error ? parseError.message : String(parseError)
                            }
                        };
                        
                        const elapsed = Date.now() - startTime;
                        this.logger.debug(`[ORPAR:PLANNING] Fallback plan created in ${elapsed}ms - plan ID: ${plan.id}`);
                        this.emitInstructionCompleted(instructionId, response);
                        observer.next(plan);
                        observer.complete();
                    }
                })
                .catch(error => {
                    const elapsed = Date.now() - startTime;
                    this.logger.debug(`[ORPAR:PLANNING] Failed after ${elapsed}ms - error: ${error.message}`);
                    this.emitInstructionError(instructionId, error.message);
                    observer.error(error);
                });
        });
    }

    /**
     * Analyze action execution results with reliable models
     */
    analyzeActionExecution(action: PlanAction, executionResult: any, context?: OrparContext): Observable<any> {
        const startTime = Date.now();
        const instructionId = this.generateInstructionId('action-analysis');
        this.logger.debug(`[ORPAR:ACTION] Starting action analysis - action: ${action.action}, status: ${action.status}`);
        this.emitInstructionStarted(instructionId, 'action-execution-analysis');

        const basePrompt = `
        As the MXF coordination intelligence system, analyze this agent action for multi-agent coordination insights:
        
        Agent Action Executed: ${action.description}
        Action ID: ${action.action}
        Parameters: ${JSON.stringify(action.parameters)}
        Execution Result: ${JSON.stringify(executionResult)}
        Status: ${action.status}
        
        COORDINATION-FOCUSED ACTION ANALYSIS:
        1. **Multi-Agent Impact Assessment**: How does this action affect other agents and their coordination potential?
        2. **Coordination Opportunities Identified**: What new collaboration possibilities emerged from this action?
        3. **Resource Sharing Implications**: How does this action affect shared resources and tools available to other agents?
        4. **Communication Flow Effects**: What coordination information should be shared with other agents?
        5. **Future Coordination Recommendations**: How can similar actions be better coordinated across multiple agents?
        
        Focus on extracting coordination lessons that improve future multi-agent collaboration efficiency.
        `;

        const prompt = this.buildContextAwarePrompt(basePrompt, context);

        const model = this.getModelForOperationWithComplexity('action', context);
        this.logger.debug(`[ORPAR:ACTION] Selected model: ${model}, result size: ${JSON.stringify(executionResult).length} chars`);

        return new Observable(observer => {
            this.sendLlmRequestWithRecovery(prompt, null, { model, operation: 'action' })
                .then(response => {
                    const elapsed = Date.now() - startTime;
                    this.logger.debug(`[ORPAR:ACTION] Analysis completed in ${elapsed}ms - response length: ${response?.length || 0} chars`);
                    this.emitInstructionCompleted(instructionId, response);
                    observer.next(response);
                    observer.complete();
                })
                .catch(error => {
                    const elapsed = Date.now() - startTime;
                    this.logger.debug(`[ORPAR:ACTION] Analysis failed after ${elapsed}ms - error: ${error.message}`);
                    this.emitInstructionError(instructionId, error.message);
                    observer.error(error);
                });
        });
    }

    /**
     * Generate comprehensive reflections with meta-cognitive models
     */
    generateReflection(plan: Plan, executedActions: PlanAction[], results: any[], context?: OrparContext): Observable<Reflection> {
        const startTime = Date.now();
        const instructionId = this.generateInstructionId('reflection');
        const completedCount = executedActions.filter(a => a.status === 'completed').length;
        this.logger.debug(`[ORPAR:REFLECTION] Starting reflection - plan ID: ${plan.id}, actions: ${executedActions.length} (${completedCount} completed), results: ${results.length}`);
        this.emitInstructionStarted(instructionId, 'reflection-generation');

        const basePrompt = `
        As the MXF coordination intelligence system, perform meta-cognitive analysis of this agent plan execution:
        
        Agent Plan Objective: ${plan.goal}
        Plan Description: ${plan.description}
        
        Executed Actions:
        ${executedActions.map(action => `- ${action.description} (Status: ${action.status})`).join('\n')}
        
        Coordination Results: ${JSON.stringify(results)}
        
        META-COGNITIVE COORDINATION ANALYSIS:
        1. **Multi-Agent Coordination Effectiveness**: How well did this plan integrate with other agents' activities?
        2. **Cross-Agent Learning Opportunities**: What coordination insights can be shared with other agents?
        3. **Collaborative Efficiency Assessment**: Where could multi-agent coordination have improved outcomes?
        4. **Communication Pattern Analysis**: How effective were the information flows during plan execution?
        5. **Strategic Coordination Evolution**: How should future coordination strategies evolve based on these results?
        6. **Resource Utilization Optimization**: How can shared resources be better coordinated in future plans?
        
        Generate actionable coordination intelligence that enhances system-wide multi-agent collaboration patterns.
        `;

        const prompt = this.buildContextAwarePrompt(basePrompt, context);

        const model = this.getModelForOperationWithComplexity('reflection', context);
        this.logger.debug(`[ORPAR:REFLECTION] Selected model: ${model}, plan goal: ${plan.goal?.substring(0, 50)}...`);

        return new Observable(observer => {
            this.sendLlmRequestWithRecovery(prompt, REFLECTION_SCHEMA, { model, operation: 'reflection' })
                .then(response => {
                    const reflection: Reflection = {
                        id: uuidv4(),
                        agentId: plan.agentId,
                        planId: plan.id,
                        success: executedActions.every(a => a.status === 'completed'),
                        insights: [response], // LLM will provide insights
                        improvements: [], // Will be extracted from response
                        metadata: {
                            model,
                            instructionId
                        },
                        timestamp: Date.now()
                    };

                    const elapsed = Date.now() - startTime;
                    this.logger.debug(`[ORPAR:REFLECTION] Reflection generated in ${elapsed}ms - reflection ID: ${reflection.id}, success: ${reflection.success}, insights: ${reflection.insights.length}`);
                    this.emitInstructionCompleted(instructionId, response);
                    observer.next(reflection);
                    observer.complete();
                })
                .catch(error => {
                    const elapsed = Date.now() - startTime;
                    this.logger.debug(`[ORPAR:REFLECTION] Failed after ${elapsed}ms - error: ${error.message}`);
                    this.emitInstructionError(instructionId, error.message);
                    observer.error(error);
                });
        });
    }

    /**
     * Generate a unique instruction ID for tracking LLM operations
     */
    private generateInstructionId(operation: string): string {
        return `${operation}-${uuidv4()}`;
    }

    /**
     * Extract JSON from LLM response that might be wrapped in markdown code blocks
     */
    private extractJsonFromResponse(responseText: string): any {
        try {
            // First try direct JSON parsing
            return JSON.parse(responseText);
        } catch (error) {
            // If that fails, try to extract JSON from markdown code blocks
            const jsonMatch = responseText.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
            if (jsonMatch && jsonMatch[1]) {
                try {
                    return JSON.parse(jsonMatch[1]);
                } catch (innerError) {
                    this.logger.warn(`Failed to parse JSON from markdown block: ${innerError}`);
                }
            }
            
            // Try to find JSON-like content without code blocks
            const jsonContentMatch = responseText.match(/\{[\s\S]*\}/);
            if (jsonContentMatch) {
                try {
                    return JSON.parse(jsonContentMatch[0]);
                } catch (innerError) {
                    this.logger.warn(`Failed to parse extracted JSON content: ${innerError}`);
                }
            }
            
            throw error;
        }
    }

    /**
     * Track metrics for an operation
     */
    private trackMetrics(operation: OrparOperationType, responseTime: number, model: string, error?: Error): void {
        this.metrics.requestCount++;
        this.metrics.totalResponseTime += responseTime;
        this.metrics.lastRequestTime = new Date();
        this.metrics.operationBreakdown[operation]++;
        this.metrics.responseTimeBreakdown[operation] += responseTime;
        
        // Track model usage
        const currentUsage = this.metrics.modelUsage.get(model) || 0;
        this.metrics.modelUsage.set(model, currentUsage + 1);
        
        // Track errors
        if (error) {
            this.metrics.errorCount++;
            const errorType = error.constructor.name;
            const currentErrors = this.metrics.errorBreakdown.get(errorType) || 0;
            this.metrics.errorBreakdown.set(errorType, currentErrors + 1);
        }
    }

    /**
     * Get metrics for this service instance
     */
    public getMetrics(): {
        requestCount: number;
        totalResponseTime: number;
        avgResponseTime: number;
        errorCount: number;
        lastRequestTime: Date | null;
        operationBreakdown: Record<OrparOperationType, number>;
        responseTimeBreakdown: Record<OrparOperationType, number>;
        modelUsage: Map<string, number>;
        errorBreakdown: Map<string, number>;
    } {
        return {
            requestCount: this.metrics.requestCount,
            totalResponseTime: this.metrics.totalResponseTime,
            avgResponseTime: this.metrics.requestCount > 0 ? this.metrics.totalResponseTime / this.metrics.requestCount : 0,
            errorCount: this.metrics.errorCount,
            lastRequestTime: this.metrics.lastRequestTime,
            operationBreakdown: { ...this.metrics.operationBreakdown },
            responseTimeBreakdown: { ...this.metrics.responseTimeBreakdown },
            modelUsage: new Map(this.metrics.modelUsage),
            errorBreakdown: new Map(this.metrics.errorBreakdown)
        };
    }

    /**
     * Create or update ORPAR context for a cycle
     */
    public createOrUpdateContext(
        cycleId: string,
        agentId: string,
        channelId: string,
        phase: OrparOperationType,
        result?: any,
        sharedContext?: Partial<OrparContext['sharedContext']>
    ): OrparContext {
        const contextId = `${agentId}-${cycleId}`;
        const existingContext = this.activeContexts.get(contextId);
        
        if (existingContext) {
            // Update existing context
            existingContext.phase = phase;
            existingContext.timestamp = Date.now();
            
            if (result) {
                existingContext.previousPhaseResults = existingContext.previousPhaseResults || {};
                existingContext.previousPhaseResults[phase] = result;
            }
            
            if (sharedContext) {
                existingContext.sharedContext = {
                    goals: existingContext.sharedContext?.goals || [],
                    constraints: existingContext.sharedContext?.constraints || [],
                    resources: existingContext.sharedContext?.resources || [],
                    insights: existingContext.sharedContext?.insights || [],
                    confidence: existingContext.sharedContext?.confidence || 1.0,
                    ...sharedContext
                };
            }
            
            existingContext.metadata.phaseCompletionTimes.set(phase, Date.now());
            existingContext.metadata.modelUsage.set(phase, this.getModelForOperation(phase));
            
            return existingContext;
        } else {
            // Create new context
            const newContext: OrparContext = {
                id: contextId,
                agentId,
                channelId,
                cycleId,
                phase,
                timestamp: Date.now(),
                previousPhaseResults: result ? { [phase]: result } : {},
                sharedContext: {
                    goals: [],
                    constraints: [],
                    resources: [],
                    insights: [],
                    confidence: 1.0,
                    ...sharedContext
                },
                metadata: {
                    startTime: Date.now(),
                    phaseCompletionTimes: new Map([[phase, Date.now()]]),
                    modelUsage: new Map([[phase, this.getModelForOperation(phase)]]),
                    errors: []
                }
            };
            
            this.activeContexts.set(contextId, newContext);
            return newContext;
        }
    }

    /**
     * Get context for a cycle
     */
    public getContext(agentId: string, cycleId: string): OrparContext | undefined {
        const contextId = `${agentId}-${cycleId}`;
        return this.activeContexts.get(contextId);
    }

    /**
     * Clear context after cycle completion
     */
    public clearContext(agentId: string, cycleId: string): void {
        const contextId = `${agentId}-${cycleId}`;
        this.activeContexts.delete(contextId);
    }

    /**
     * Add error to context
     */
    public addContextError(agentId: string, cycleId: string, error: string): void {
        const context = this.getContext(agentId, cycleId);
        if (context) {
            context.metadata.errors.push(error);
        }
    }

    /**
     * Build context-aware prompt that includes previous phase results
     */
    private buildContextAwarePrompt(basePrompt: string, context?: OrparContext): string {
        if (!context || !context.previousPhaseResults) {
            return basePrompt;
        }

        const contextInfo = [];
        
        // Add previous phase results
        if (context.previousPhaseResults.observation) {
            contextInfo.push(`Previous Observations: ${JSON.stringify(context.previousPhaseResults.observation)}`);
        }
        if (context.previousPhaseResults.reasoning) {
            contextInfo.push(`Previous Reasoning: ${JSON.stringify(context.previousPhaseResults.reasoning)}`);
        }
        if (context.previousPhaseResults.planning) {
            contextInfo.push(`Previous Plans: ${JSON.stringify(context.previousPhaseResults.planning)}`);
        }
        if (context.previousPhaseResults.action) {
            contextInfo.push(`Previous Actions: ${JSON.stringify(context.previousPhaseResults.action)}`);
        }

        // Add shared context
        if (context.sharedContext) {
            const shared = context.sharedContext;
            if (shared.goals.length > 0) {
                contextInfo.push(`Current Goals: ${shared.goals.join(', ')}`);
            }
            if (shared.constraints.length > 0) {
                contextInfo.push(`Constraints: ${shared.constraints.join(', ')}`);
            }
            if (shared.insights.length > 0) {
                contextInfo.push(`Key Insights: ${shared.insights.join(', ')}`);
            }
            if (shared.confidence !== undefined) {
                contextInfo.push(`Current Confidence Level: ${shared.confidence}`);
            }
        }

        if (contextInfo.length === 0) {
            return basePrompt;
        }

        return `${basePrompt}\n\nCONTEXT FROM PREVIOUS PHASES:\n${contextInfo.join('\n')}\n\nPlease incorporate this context into your analysis.`;
    }

    /**
     * Initialize cleanup mechanisms for memory management
     */
    private initializeCleanupMechanisms(): void {
        // Set up periodic cleanup
        this.cleanupTimer = setInterval(() => {
            this.performCleanup();
        }, this.cleanupConfig.cleanupInterval);

    }

    /**
     * Perform cleanup of expired data
     */
    private performCleanup(): void {
        const now = Date.now();
        let cleanedActivities = 0;
        let cleanedContexts = 0;

        // Cleanup channel activities
        for (const [channelId, activity] of this.channelActivities.entries()) {
            if (now - activity.lastMessage > this.cleanupConfig.channelActivityTtl) {
                this.channelActivities.delete(channelId);
                cleanedActivities++;
            }
        }

        // Cleanup ORPAR contexts
        for (const [contextId, context] of this.activeContexts.entries()) {
            if (now - context.timestamp > this.cleanupConfig.contextTtl) {
                this.activeContexts.delete(contextId);
                cleanedContexts++;
            }
        }

        // Enforce maximum limits
        if (this.channelActivities.size > this.cleanupConfig.maxChannelActivities) {
            const excess = this.channelActivities.size - this.cleanupConfig.maxChannelActivities;
            const sortedActivities = Array.from(this.channelActivities.entries())
                .sort(([,a], [,b]) => a.lastMessage - b.lastMessage);
            
            for (let i = 0; i < excess; i++) {
                this.channelActivities.delete(sortedActivities[i][0]);
                cleanedActivities++;
            }
        }

        if (cleanedActivities > 0 || cleanedContexts > 0) {
        }
    }

    /**
     * Manual cleanup trigger for testing or immediate cleanup needs
     */
    public triggerCleanup(): void {
        this.performCleanup();
    }

    /**
     * Cleanup all data (useful for shutdown or testing)
     */
    public cleanupAll(): void {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
            this.cleanupTimer = undefined;
        }
        
        if (this.coordinationCleanupTimer) {
            clearInterval(this.coordinationCleanupTimer);
            this.coordinationCleanupTimer = undefined;
        }
        
        // Remove all event listeners to prevent further processing
        if (this.boundHandleChannelMessageForCoordination) {
            this.eventBus.off(Events.Message.AGENT_MESSAGE_DELIVERED, this.boundHandleChannelMessageForCoordination);
        }
        if (this.boundHandleOrparEventForCoordination) {
            this.eventBus.off(Events.ControlLoop.REASONING, this.boundHandleOrparEventForCoordination);
            this.eventBus.off(Events.ControlLoop.PLAN, this.boundHandleOrparEventForCoordination);
            this.eventBus.off(Events.ControlLoop.ACTION, this.boundHandleOrparEventForCoordination);
        }
        
        this.channelActivities.clear();
        this.activeContexts.clear();
        this.coordinationInProgress.clear();
        this.channelCoordinationLocks.clear();
        this.coordinationInitialized = false;
        this.isShuttingDown = true;
        
    }

    /**
     * Get cleanup statistics
     */
    public getCleanupStats(): {
        channelActivities: number;
        activeContexts: number;
        oldestChannelActivity: number | null;
        oldestContext: number | null;
        nextCleanupIn: number;
    } {
        let oldestActivity = null;
        let oldestContext = null;

        for (const activity of this.channelActivities.values()) {
            if (oldestActivity === null || activity.lastMessage < oldestActivity) {
                oldestActivity = activity.lastMessage;
            }
        }

        for (const context of this.activeContexts.values()) {
            if (oldestContext === null || context.timestamp < oldestContext) {
                oldestContext = context.timestamp;
            }
        }

        return {
            channelActivities: this.channelActivities.size,
            activeContexts: this.activeContexts.size,
            oldestChannelActivity: oldestActivity,
            oldestContext: oldestContext,
            nextCleanupIn: this.cleanupConfig.cleanupInterval
        };
    }

    /**
     * Generate fallback response for critical operations during service disruptions
     */
    private generateFallbackResponse(
        operation: OrparOperationType,
        prompt: string,
        error: Error
    ): string {
        const errorType = classifyNetworkError(error);
        
        // Log the fallback with appropriate context
        this.logger.warn(`Using fallback response for ${operation} due to ${errorType}: ${error.message}`);
        
        // Generate operation-specific fallback responses
        switch (operation) {
            case 'observation':
                return JSON.stringify({
                    observation: 'Service temporarily unavailable. Proceeding with cached context.',
                    timestamp: Date.now(),
                    fallback: true,
                    errorType
                });
                
            case 'reasoning':
                return JSON.stringify({
                    reasoning: {
                        summary: 'Automated reasoning based on available context',
                        confidence: 0.3,
                        fallback: true,
                        goals: ['Continue with available information', 'Retry when service available'],
                        insights: ['Service disruption detected', 'Using fallback reasoning']
                    }
                });
                
            case 'planning':
                return JSON.stringify({
                    plan: {
                        goal: 'Continue with basic operations',
                        description: 'Fallback plan due to service unavailability',
                        actions: [{
                            action: 'wait',
                            description: 'Wait for service recovery',
                            parameters: { duration: 5000 },
                            dependencies: [],
                            priority: 'low'
                        }],
                        fallback: true
                    }
                });
                
            case 'action':
                return 'Action analysis unavailable. Proceeding with default behavior.';
                
            case 'reflection':
                return JSON.stringify({
                    reflection: {
                        success: false,
                        insights: ['Service disruption prevented full reflection'],
                        improvements: ['Retry when service is available'],
                        fallback: true
                    }
                });
                
            default:
                return JSON.stringify({
                    message: 'Service temporarily unavailable',
                    fallback: true,
                    errorType,
                    timestamp: Date.now()
                });
        }
    }
    
    /**
     * Send LLM request using the configured provider with structured outputs support and graceful degradation
     */
    private async sendLlmRequestWithRecovery(
        prompt: string,
        schema?: any,
        options: any = {}
    ): Promise<string> {
        const operation = options.operation as OrparOperationType || 'observation';
        const enableGracefulDegradation = process.env.ENABLE_GRACEFUL_DEGRADATION !== 'false';
        const model = options.model || this.defaultModel;
        
        // Debug: Log call stack for observation operations to trace the source
        if (operation === 'observation') {
            const stack = new Error().stack?.split('\n').slice(2, 6).join('\n');
            this.logger.debug(`[SystemLLM:TRACE] Observation call stack:\n${stack}`);
        }
        
        this.logger.debug(`[SystemLLM] Sending request - operation: ${operation}, model: ${model}, schema: ${schema ? 'yes' : 'no'}, prompt: ${prompt.length} chars`);

        try {
            // Try the normal LLM request
            const result = await this.sendLlmRequestInternal(prompt, schema, options);
            this.logger.debug(`[SystemLLM] Request successful - operation: ${operation}, response: ${result.length} chars`, result);
            return result;
        } catch (error) {
            const err = error as Error;
            const errorType = classifyNetworkError(err);

            // Check if we should use graceful degradation
            if (enableGracefulDegradation &&
                (errorType === NetworkErrorType.API_SERVICE_UNAVAILABLE ||
                 errorType === NetworkErrorType.API_BAD_GATEWAY ||
                 errorType === NetworkErrorType.NETWORK_TIMEOUT ||
                 errorType === NetworkErrorType.NETWORK_CONNECTION_REFUSED)) {

                this.logger.warn(`[SystemLLM] Service unavailable (${errorType}), using graceful degradation for ${operation}`);

                // Return a fallback response that allows the system to continue
                return this.generateFallbackResponse(operation, prompt, err);
            }

            this.logger.debug(`[SystemLLM] Request failed - operation: ${operation}, error: ${err.message}`);
            // For non-recoverable errors, throw as usual
            throw error;
        }
    }
    
    /**
     * Internal LLM request implementation (original sendLlmRequest logic)
     */
    private async sendLlmRequestInternal(
        prompt: string, 
        schema?: any, 
        options: any = {}
    ): Promise<string> {
        // Abort if service is shutting down
        if (this.isShuttingDown) {
            throw new Error('Service is shutting down');
        }
        
        const startTime = Date.now();
        const operation = options.operation as OrparOperationType || 'observation';
        
        try {
            const client = await this.initClient();
            const model = options.model || this.defaultModel;
            const temperature = options.temperature || this.defaultTemperature;
            const maxTokens = options.maxTokens || this.defaultMaxTokens;

            const messages: McpMessage[] = [{
                role: McpRole.USER,
                content: {
                    type: McpContentType.TEXT,
                    text: prompt
                } as McpTextContent
            }];

            // Prepare request options with structured outputs for OpenRouter
            const requestOptions: any = {
                model,
                temperature,
                maxTokens
            };

            // Add structured outputs for OpenRouter if schema is provided
            if (schema) {
                requestOptions.response_format = {
                    type: 'json_schema',
                    json_schema: {
                        name: 'structured_response',
                        strict: true,
                        schema: schema
                    }
                };
            }

            return new Promise((resolve, reject) => {
                client.sendMessage(messages, [], requestOptions).subscribe({
                    next: (response: any) => {
                        // Check if service is shutting down before processing response
                        if (this.isShuttingDown) {
                            reject(new Error('Service is shutting down'));
                            return;
                        }
                        
                        // Extract response text
                        let responseText = '';
                        if (response && response.content) {
                            if (Array.isArray(response.content)) {
                                responseText = response.content
                                    .filter((content: any) => content.type === McpContentType.TEXT)
                                    .map((content: any) => content.text)
                                    .join(' ');
                            } else if (typeof response.content === 'string') {
                                responseText = response.content;
                            } else if (response.content.text) {
                                responseText = response.content.text;
                            }
                        } else if (typeof response === 'string') {
                            responseText = response;
                        } else if (response?.text) {
                            responseText = response.text;
                        } else if (response?.message?.content) {
                            responseText = response.message.content;
                        } else {
                            this.logger.error(`Failed to extract text from LLM response. Response structure:`, JSON.stringify(response, null, 2));
                            responseText = '';
                        }
                        
                        // Validate that we got a non-empty response
                        if (!responseText || responseText.trim() === '') {
                            const errorMsg = `Empty or invalid LLM response. Model: ${model}`;
                            this.logger.error(errorMsg);
                            reject(new Error(errorMsg));
                            return;
                        }

                        
                        // Check if service is shutting down before processing response
                        if (this.isShuttingDown) {
                            reject(new Error('Service shutting down'));
                            return;
                        }
                        
                        // Track successful metrics
                        const responseTime = Date.now() - startTime;
                        this.trackMetrics(operation, responseTime, model);
                        this.logger.debug(`[SystemLLM:Internal] LLM call completed - model: ${model}, time: ${responseTime}ms, response: ${responseText.length} chars`);

                        resolve(responseText);
                    },
                    error: (error: any) => {
                        const errorMsg = `LLM request failed for model ${model}: ${error}`;
                        this.logger.error(errorMsg);
                        
                        // Track error metrics
                        const responseTime = Date.now() - startTime;
                        this.trackMetrics(operation, responseTime, model, error);
                        
                        reject(new Error(errorMsg));
                    }
                });
            });
        } catch (error) {
            const errorMsg = `LLM request setup failed: ${error}`;
            this.logger.error(errorMsg);
            
            // Track error metrics
            const responseTime = Date.now() - startTime;
            this.trackMetrics(operation, responseTime, options.model || this.defaultModel, error as Error);
            
            throw new Error(errorMsg);
        }
    }

    /**
     * Send LLM request with automatic recovery and provider-specific handling
     * Public API for services that need direct LLM access
     */
    public async sendLlmRequest(
        prompt: string,
        schema?: any,
        options: any = {}
    ): Promise<string> {
        return this.sendLlmRequestWithRecovery(prompt, schema, options);
    }
    
    /**
     * Initialize the LLM client if not already initialized
     */
    private async initClient(): Promise<IMcpClient> {
        if (this.clientInstance) {
            return this.clientInstance;
        }

        try {
            // Get API key and configuration based on provider type
            let apiKey: string | undefined;
            let baseUrl: string | undefined;
            
            switch (this.providerType) {
                case LlmProviderType.OPENROUTER:
                    apiKey = process.env.OPENROUTER_API_KEY;
                    baseUrl = 'https://openrouter.ai/api/v1';
                    if (!apiKey || apiKey.trim() === '') {
                        throw new Error('OPENROUTER_API_KEY environment variable is not set or empty');
                    }
                    break;
                    
                case LlmProviderType.AZURE_OPENAI:
                    apiKey = process.env.AZURE_OPENAI_API_KEY;
                    baseUrl = process.env.AZURE_OPENAI_ENDPOINT;
                    if (!apiKey || apiKey.trim() === '') {
                        throw new Error('AZURE_OPENAI_API_KEY environment variable is not set or empty');
                    }
                    if (!baseUrl || baseUrl.trim() === '') {
                        throw new Error('AZURE_OPENAI_ENDPOINT environment variable is not set or empty');
                    }
                    break;
                    
                case LlmProviderType.OPENAI:
                    apiKey = process.env.OPENAI_API_KEY;
                    baseUrl = 'https://api.openai.com/v1';
                    if (!apiKey || apiKey.trim() === '') {
                        throw new Error('OPENAI_API_KEY environment variable is not set or empty');
                    }
                    break;
                    
                case LlmProviderType.ANTHROPIC:
                    apiKey = process.env.ANTHROPIC_API_KEY;
                    baseUrl = 'https://api.anthropic.com';
                    if (!apiKey || apiKey.trim() === '') {
                        throw new Error('ANTHROPIC_API_KEY environment variable is not set or empty');
                    }
                    break;
                    
                case LlmProviderType.GEMINI:
                    apiKey = process.env.GEMINI_API_KEY;
                    baseUrl = 'https://generativelanguage.googleapis.com';
                    if (!apiKey || apiKey.trim() === '') {
                        throw new Error('GEMINI_API_KEY environment variable is not set or empty');
                    }
                    break;
                    
                case LlmProviderType.XAI:
                    apiKey = process.env.XAI_API_KEY;
                    baseUrl = 'https://api.x.ai/v1';
                    if (!apiKey || apiKey.trim() === '') {
                        throw new Error('XAI_API_KEY environment variable is not set or empty');
                    }
                    break;
                    
                case LlmProviderType.OLLAMA:
                    apiKey = 'ollama'; // Ollama doesn't require API key
                    baseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
                    break;
                    
                default:
                    throw new Error(`Unsupported provider type: ${this.providerType}`);
            }

            const Implementation = LlmProviderFactory.getImplementation(this.providerType);
            this.clientInstance = new Implementation();
            
            // Build provider-specific config
            const initConfig: any = {
                apiKey: apiKey,
                maxTokens: this.defaultMaxTokens,
                temperature: this.defaultTemperature
            };
            
            // Add baseUrl for providers that need it
            if (baseUrl) {
                initConfig.baseUrl = baseUrl;
            }
            
            // Add Azure-specific configuration
            if (this.providerType === LlmProviderType.AZURE_OPENAI) {
                initConfig.deploymentName = process.env.AZURE_OPENAI_DEPLOYMENT_NAME;
                initConfig.apiVersion = process.env.AZURE_OPENAI_API_VERSION || '2024-04-01-preview';
            }
            
            // Initialize client with provider-specific config
            const initResult = await this.clientInstance.initialize(initConfig);
            
            if (!initResult) {
                throw new Error('LLM client initialization returned false - configuration may be invalid');
            }
            
            return this.clientInstance;
        } catch (error) {
            const errorMessage = `Failed to initialize LLM client: ${error instanceof Error ? error.message : String(error)}`;
            this.logger.error(errorMessage);
            throw new Error(errorMessage);
        }
    }

    // ==========================================
    // PRIORITY 2: RESPONSE INTERPRETATION LAYER
    // ==========================================

    /**
     * Interpret natural language response and convert to action
     */
    async interpretNaturalResponse(
        agentId: string, 
        response: string, 
        channelId: string
    ): Promise<InterpretedAction> {
        try {
            const startTime = Date.now();
            
            // Build context for interpretation
            const context = await this.buildInterpretationContext(agentId, channelId);
            
            // Create interpretation prompt
            const interpretationPrompt = this.buildInterpretationPrompt(agentId, response, context);
            
            // Process with SystemLLM using appropriate model for interpretation complexity
            const interpretationModel = this.selectModelByComplexity('reasoning', 'simple');
            const interpretationObservable = this.processPrompt({
                prompt: interpretationPrompt,
                options: { model: interpretationModel }
            });
            
            const interpretationText = await lastValueFrom(interpretationObservable);
            const interpretationResult = this.extractJsonFromResponse(interpretationText);
            
            const executionTime = Date.now() - startTime;
            
            
            return {
                originalResponse: response,
                interpretedAction: interpretationResult,
                confidence: (interpretationResult as any).confidence || 0.8,
                executionTimeMs: executionTime,
                agentId,
                channelId,
                timestamp: new Date()
            };
            
        } catch (error) {
            this.logger.error(`Failed to interpret natural response for agent ${agentId}: ${error}`);
            throw error;
        }
    }

    /**
     * Build interpretation context including agent registry and recent actions
     */
    private async buildInterpretationContext(
        agentId: string, 
        channelId: string
    ): Promise<SystemLLMInterpretationContext> {
        try {
            // Get agent registry for the channel
            const agentRegistry = await this.buildAgentRegistry(channelId);
            
            // Get recent channel activity
            const recentActivity = this.channelActivities.get(channelId);
            const recentActions = recentActivity?.recentMessages.slice(-10) || [];
            
            // Get channel context
            const channelContext = {
                activeAgents: Array.from(recentActivity?.activeAgents || []),
                messageCount: recentActivity?.messageCount || 0,
                lastActivity: recentActivity?.lastMessage || 0
            };
            
            return {
                agentRegistry,
                recentActions: recentActions.map((msg: any) => ({
                    agentId: msg.senderId,
                    action: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
                    timestamp: msg.timestamp,
                    summary: `${msg.senderId}: ${typeof msg.content === 'string' ? msg.content.substring(0, 100) : JSON.stringify(msg.content).substring(0, 100)}`
                })),
                channelContext,
                targetAgentId: agentId
            };
            
        } catch (error) {
            this.logger.error(`Failed to build interpretation context: ${error}`);
            throw error;
        }
    }

    /**
     * Build agent registry for name resolution and targeting
     */
    private async buildAgentRegistry(channelId: string): Promise<AgentRegistry> {
        try {
            const registry: AgentRegistry = {};
            
            // Get active agents from channel activity
            const channelActivity = this.channelActivities.get(channelId);
            const activeAgentIds = Array.from(channelActivity?.activeAgents || []);
            
            // Build registry entries
            for (const agentId of activeAgentIds) {
                // Create registry entry with common name patterns
                const commonName = this.extractCommonName(agentId);
                const aliases = this.generateAliases(agentId, commonName);
                
                registry[commonName] = {
                    agentId,
                    aliases,
                    role: this.inferAgentRole(agentId),
                    capabilities: this.getAgentCapabilities(agentId)
                };
            }
            
            return registry;
            
        } catch (error) {
            this.logger.error(`Failed to build agent registry for channel ${channelId}: ${error}`);
            return {};
        }
    }

    /**
     * Build interpretation prompt for SystemLLM
     */
    private buildInterpretationPrompt(
        agentId: string, 
        response: string, 
        context: SystemLLMInterpretationContext
    ): string {
        return `# Agent Response Interpretation

Agent "${agentId}" produced this natural language response:
"${response}"

## Channel Agent Registry
${JSON.stringify(context.agentRegistry, null, 2)}

## Recent Channel Actions
${context.recentActions.map(a => `- ${a.summary}`).join('\n')}

## Channel Context
- Active Agents: ${context.channelContext.activeAgents.join(', ')}
- Recent Activity Level: ${context.channelContext.messageCount} messages

## Interpretation Task
Analyze the agent's response and determine the appropriate action. Consider:

1. **Intent Detection:**
   - Is this a message to another agent?
   - Is this a task status update?
   - Is this internal reasoning?
   - Is this a request for information?

2. **Name Resolution:**
   - Map any mentioned agent names to their actual agentIds using the registry above
   - Use the aliases and common names from the Channel Agent Registry
   - Match partial names and variations

3. **Action Extraction:**
   - Messages → messaging_send with resolved target
   - Status updates → task_update or context_write  
   - Information requests → appropriate read/query tool
   - Internal reasoning → mark as internal note

Return the interpreted action with confidence score (0-1).`;
    }

    /**
     * Helper methods for agent registry building
     */
    private extractCommonName(agentId: string): string {
        // Convert agent-id format to common name
        return agentId
            .replace(/-/g, ' ')
            .replace(/\b\w/g, l => l.toUpperCase());
    }

    private generateAliases(agentId: string, commonName: string): string[] {
        const aliases = [agentId, commonName];
        
        // Add variations
        aliases.push(commonName.toLowerCase());
        aliases.push(commonName.split(' ')[0]); // First name only
        
        // Add role-based aliases
        if (agentId.includes('scheduler')) aliases.push('scheduler', 'the scheduler');
        if (agentId.includes('assistant')) aliases.push('assistant', 'the assistant');
        if (agentId.includes('coordinator')) aliases.push('coordinator', 'the coordinator');
        
        return [...new Set(aliases)]; // Remove duplicates
    }

    private inferAgentRole(agentId: string): string {
        if (agentId.includes('scheduler')) return 'scheduling';
        if (agentId.includes('coordinator')) return 'coordination';
        if (agentId.includes('assistant')) return 'assistance';
        if (agentId.includes('analyst')) return 'analysis';
        return 'general';
    }

    private getAgentCapabilities(agentId: string): string[] {
        // Basic capability inference from agent ID
        const capabilities = ['messaging', 'context_access'];
        
        if (agentId.includes('scheduler')) capabilities.push('scheduling', 'calendar_management');
        if (agentId.includes('coordinator')) capabilities.push('task_coordination', 'workflow_management');
        if (agentId.includes('analyst')) capabilities.push('data_analysis', 'reporting');
        
        return capabilities;
    }

    /**
     * Process a prompt using the LLM with structured output
     */
    private processPrompt(input: PromptInput): Observable<string> {
        return new Observable(observer => {
            const executePrompt = async (): Promise<void> => {
                const instructionId = `instruction-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
                
                try {
                    // Emit instruction started event
                    this.emitInstructionStarted(instructionId, input.prompt, input.options);
                    
                    const client = await this.initClient();
                    
                    // Build messages using McpMessage format
                    const messages: McpMessage[] = [{
                        role: McpRole.USER,
                        content: {
                            type: McpContentType.TEXT,
                            text: input.prompt
                        } as McpTextContent
                    }];

                    //;

                    client.sendMessage(messages, [], {
                        model: input.options?.model || this.defaultModel,
                        maxTokens: input.options?.maxTokens || this.defaultMaxTokens,
                        temperature: input.options?.temperature || this.defaultTemperature
                    }).subscribe({
                        next: (response: any) => {
                            // Extract response text
                            let responseText = '';
                            if (response && response.content) {
                                if (Array.isArray(response.content)) {
                                    responseText = response.content
                                        .filter((content: any) => content.type === McpContentType.TEXT)
                                        .map((content: any) => content.text)
                                        .join(' ');
                                } else if (typeof response.content === 'string') {
                                    responseText = response.content;
                                } else if (response.content.text) {
                                    responseText = response.content.text;
                                }
                            } else if (typeof response === 'string') {
                                responseText = response;
                            } else if (response?.text) {
                                responseText = response.text;
                            } else if (response?.message?.content) {
                                responseText = response.message.content;
                            } else {
                                this.logger.error(`Failed to extract text from LLM response. Response structure:`, JSON.stringify(response, null, 2));
                                responseText = '';
                            }
                            
                            // Validate that we got a non-empty response
                            if (!responseText || responseText.trim() === '') {
                                const errorMsg = `Empty or invalid LLM response. Model: ${input.options?.model || this.defaultModel}`;
                                this.logger.error(errorMsg);
                                observer.error(new Error(errorMsg));
                                return;
                            }

                            //;
                            observer.next(responseText);
                            observer.complete();
                        },
                        error: (error) => {
                            // Emit instruction error event
                            this.emitInstructionError(instructionId, error instanceof Error ? error.message : String(error));
                            observer.error(error);
                        }
                    });

                } catch (error) {
                    // Emit instruction error event for initialization failures
                    this.emitInstructionError(instructionId, error instanceof Error ? error.message : String(error));
                    observer.error(error);
                }
            };

            executePrompt();
        });
    }

    /**
     * Extract conversation content from message content
     */
    private extractConversationContent(content: string | Record<string, any>): string {
        if (typeof content === 'string') {
            return content;
        }
        return JSON.stringify(content);
    }

    /**
     * Extract topics from channel messages with structured output enforcement
     * @param messages - Array of channel messages
     * @param options - Optional configuration
     * @returns Observable array of conversation topics
     */
    public extractTopics(
        messages: ChannelMessage[],
        options: LlmOptions = {}
    ): Observable<ConversationTopic[]> {
        return new Observable(observer => {
            try {
                // Convert channel messages to the expected format
                const extractionInput: TopicsExtractionInput = {
                    messages: messages.map(msg => ({
                        content: this.extractConversationContent(msg.content),
                        messageId: msg.messageId,
                        timestamp: msg.timestamp
                    })),
                    minRelevance: options.minRelevance || 0.3,
                    options: options
                };

                // Build prompt for topic extraction
                const prompt = this.buildTopicExtractionPrompt(extractionInput);

                // Process the prompt
                this.processPrompt({
                    prompt,
                    systemPrompt: `You are a topic extraction component in an ORPAR control loop system. Extract conversation topics and respond with valid JSON only.`,
                    options: options
                }).subscribe({
                    next: (response: string) => {
                        try {
                            // Parse and validate the response
                            const result = this.parseStructuredResponse(response, 'topic-extraction', `instruction-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`) as TopicExtractionResult;
                            
                            // Transform to ConversationTopic format
                            const conversationTopics: ConversationTopic[] = result.topics.map((topic: any) => ({
                                id: topic.messageReferences?.[0] || `topic-${Date.now()}`,
                                topic: topic.topic,
                                keywords: topic.keywords,
                                relevanceScore: topic.relevanceScore,
                                messageReferences: topic.messageReferences || [],
                                firstMentioned: topic.firstMentioned || Date.now(),
                                lastMentioned: topic.lastMentioned || Date.now(),
                                relatedAgents: []
                            }));

                            observer.next(conversationTopics);
                            observer.complete();
                        } catch (parseError) {
                            this.logger.error(`Failed to parse topic extraction response: ${parseError instanceof Error ? parseError.message : String(parseError)}`);
                            observer.error(parseError);
                        }
                    },
                    error: (error) => {
                        this.logger.error(`Topic extraction failed: ${error instanceof Error ? error.message : String(error)}`);
                        observer.error(error);
                    }
                });
            } catch (error) {
                this.logger.error(`Topic extraction setup failed: ${error instanceof Error ? error.message : String(error)}`);
                observer.error(error);
            }
        });
    }

    /**
     * Generate conversation summary with structured output enforcement
     * @param messages - Array of channel messages
     * @param options - Optional configuration
     * @returns Observable conversation summary result
     */
    public generateConversationSummary(
        messages: ChannelMessage[],
        options: LlmOptions = {}
    ): Observable<ConversationSummaryResult> {
        return new Observable(observer => {
            try {
                // Convert channel messages to the expected format
                const summaryInput: ConversationSummaryInput = {
                    messages: messages.map(msg => ({
                        content: this.extractConversationContent(msg.content),
                        messageId: msg.messageId,
                        senderId: msg.senderId,
                        timestamp: msg.timestamp
                    })),
                    channelName: options.channelName,
                    channelDescription: options.channelDescription,
                    options: options
                };

                // Build prompt for conversation summary
                const prompt = this.buildConversationSummaryPrompt(summaryInput);


                // Process the prompt
                this.processPrompt({
                    prompt,
                    systemPrompt: `You are a conversation summary component in an ORPAR control loop system. Generate a structured summary and respond with valid JSON only.`,
                    options: options
                }).subscribe({
                    next: (response: string) => {
                        try {
                            const summary = this.parseStructuredResponse(response, 'conversation-summary', `instruction-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`) as ConversationSummaryResult;
                            observer.next(summary);
                            observer.complete();
                        } catch (parseError) {
                            this.logger.error(`Failed to parse conversation summary response: ${parseError instanceof Error ? parseError.message : String(parseError)}`);
                            observer.error(parseError);
                        }
                    },
                    error: (error) => {
                        this.logger.error(`Conversation summary failed: ${error instanceof Error ? error.message : String(error)}`);
                        observer.error(error);
                    }
                });
            } catch (error) {
                this.logger.error(`Conversation summary setup failed: ${error instanceof Error ? error.message : String(error)}`);
                observer.error(error);
            }
        });
    }

    /**
     * Perform reasoning analysis with structured output enforcement
     * @param context - Context information
     * @param observations - Array of observations
     * @param previousActions - Array of previous actions
     * @param options - Optional configuration
     * @returns Observable reasoning analysis result
     */
    public performReasoningAnalysis(
        context: string,
        observations: string[],
        previousActions: string[],
        options: LlmOptions = {}
    ): Observable<ReasoningAnalysisResult> {
        return new Observable(observer => {
            try {
                // Build reasoning input
                const reasoningInput: ReasoningAnalysisInput = {
                    context,
                    observations,
                    previousActions,
                    options: options
                };

                // Build prompt for reasoning analysis
                const prompt = this.buildReasoningAnalysisPrompt(reasoningInput);

                // Process the prompt
                this.processPrompt({
                    prompt,
                    systemPrompt: `You are a reasoning analysis component in an ORPAR control loop system. Analyze the context and observations to provide structured reasoning. Respond with valid JSON only.`,
                    options: {
                        ...options,
                        model: options.modelOverride || this.config.defaultModel
                    }
                }).subscribe({
                    next: (response: string) => {
                        try {
                            const result = this.parseStructuredResponse(response, 'reasoning-analysis', `instruction-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`) as ReasoningAnalysisResult;
                            observer.next(result);
                            observer.complete();
                        } catch (parseError) {
                            this.logger.error(`Failed to parse reasoning analysis response: ${parseError instanceof Error ? parseError.message : String(parseError)}`);
                            observer.error(parseError);
                        }
                    },
                    error: (error) => {
                        this.logger.error(`Reasoning analysis failed: ${error instanceof Error ? error.message : String(error)}`);
                        observer.error(error);
                    }
                });
            } catch (error) {
                this.logger.error(`Reasoning analysis setup failed: ${error instanceof Error ? error.message : String(error)}`);
                observer.error(error);
            }
        });
    }

    /**
     * Legacy method name for backwards compatibility
     */
    public generateReasoningAnalysis(
        context: string,
        observations: string[],
        previousActions: string[],
        options: LlmOptions = {}
    ): Observable<ReasoningAnalysisResult> {
        return this.performReasoningAnalysis(context, observations, previousActions, options);
    }

    /**
     * Generate tool recommendations based on agent intent
     * @param intent - Agent's intent description
     * @param availableTools - Summary of available tools
     * @param maxRecommendations - Maximum number of recommendations
     * @param context - Optional additional context
     * @param options - Optional configuration
     * @returns Observable tool recommendation result
     */
    public generateToolRecommendations(
        intent: string,
        availableTools: any[],
        maxRecommendations: number = 5,
        context?: string,
        options: LlmOptions = {}
    ): Observable<any> {

        const prompt = this.buildToolRecommendationPrompt(intent, context, availableTools, maxRecommendations);

        const model = options.modelOverride || this.config.defaultModel;
        const temperature = options.temperature ?? 0.3;
        const maxTokens = options.maxTokens ?? 2000;

        return this.processPrompt({
            prompt,
            options: {
                model,
                temperature,
                maxTokens,
                ...options
            }
        }).pipe(
            map((response: string) => {
                //;
                try {
                    const sanitizedResponse = this.sanitizeJsonResponse(response);
                    //;
                    const parsed = JSON.parse(sanitizedResponse);
                    return parsed;
                } catch (error) {
                    logger.error('❌ [SystemLlmService] Failed to parse tool recommendations:', error);
                    throw error;
                }
            })
        );
    }

    /**
     * Build tool recommendation prompt
     * @param intent - Agent's intent description
     * @param context - Optional additional context
     * @param availableTools - Summary of available tools
     * @param maxRecommendations - Maximum number of recommendations
     * @returns Formatted prompt string
     */
    private buildToolRecommendationPrompt(
        intent: string,
        context: string | undefined,
        availableTools: any[],
        maxRecommendations: number
    ): string {
        const contextSection = context ? `\n\nAdditional Context: ${context}` : '';
        
        return `# MCP Tool Recommendation Analysis

## CRITICAL CONSTRAINT - READ FIRST
⚠️ **MANDATORY**: You MUST only recommend tools from the "Available Tools" list below. 
Do NOT invent, create, or modify tool names. The "toolName" field in your response MUST exactly match 
one of the tool names from the Available Tools section.

## Examples of Correct Recommendations
Example 1:
Intent: "I want to send a message to another agent"
Correct: {"toolName": "messaging_send", "relevanceScore": 0.9, "reasoning": "This tool directly handles sending messages between agents", "usageHint": "Use with recipient agent ID and message content"}
Incorrect: {"toolName": "send_message", "relevanceScore": 0.9, ...} // Wrong - this tool doesn't exist

Example 2:
Intent: "I need to read a file from the filesystem"
Correct: {"toolName": "read_file", "relevanceScore": 0.95, "reasoning": "This tool reads file contents from the filesystem", "usageHint": "Specify the full file path"}
Incorrect: {"toolName": "file_read", "relevanceScore": 0.95, ...} // Wrong - this tool doesn't exist

## Agent Intent
The agent wants to: ${intent}${contextSection}

## Available Tools
Here are the available MCP tools in the system:

${availableTools.map(tool => `### ${tool.name}
Category: ${tool.category}
Description: ${tool.description}
Input Schema: ${JSON.stringify(tool.inputSchema, null, 2)}
`).join('\n')}

## Task
Analyze the agent's intent and recommend the ${maxRecommendations} most relevant tools. Consider:
1. **Direct relevance**: How well does the tool match the stated intent?
2. **Workflow compatibility**: What tools work well together for this task?
3. **Efficiency**: Prefer tools that accomplish the goal with fewer steps
4. **Prerequisites**: Consider if the agent needs foundational tools first

## Output Requirements
Provide a structured JSON response with tool recommendations ranked by relevance.

For each recommendation, include:
- **toolName**: Exact name of the tool (MUST be from the Available Tools list above)
- **relevanceScore**: Float between 0-1 indicating how relevant this tool is
- **reasoning**: Brief explanation of why this tool is relevant
- **usageHint**: Practical tip on how to use this tool for the stated intent

Also provide an overall **confidence** score (0-1) for the quality of your recommendations.

Focus on tools that directly address the agent's stated intent. If the intent is broad, prioritize the most foundational tools first.

Respond with valid JSON matching this schema:
${JSON.stringify(TOOL_RECOMMENDATION_SCHEMA, null, 2)}`;
    }

    /**
     * Build topic extraction prompt
     * @param input - Topics extraction input
     * @returns Formatted prompt string
     */
    private buildTopicExtractionPrompt(input: TopicsExtractionInput): string {
        const systemPrompt = `You are a topic extraction component in an ORPAR control loop system. Extract conversation topics from messages and respond with valid JSON matching the required schema.`;
        
        // Extract clean conversation content for better LLM processing
        const messagesText = input.messages.map(msg => {
            const cleanContent = this.extractConversationContent(msg.content);
            return `[${new Date(msg.timestamp).toISOString()}] ${msg.messageId}: ${cleanContent}`;
        }).join('\n');

        return `${systemPrompt}\n\nMessages to analyze:\n${messagesText}\n\nExtract topics with relevance >= ${input.minRelevance || 0.3} and respond with JSON matching this schema:\n${JSON.stringify(TOPIC_EXTRACTION_SCHEMA, null, 2)}`;
    }

    /**
     * Build conversation summary prompt
     * @param input - Conversation summary input
     * @returns Formatted prompt string
     */
    private buildConversationSummaryPrompt(input: ConversationSummaryInput): string {
        const systemPrompt = `You are a conversation summary component in an ORPAR control loop system. Generate a structured summary and respond with valid JSON matching the required schema.`;
        
        // Extract clean conversation content for better LLM processing  
        const messagesText = input.messages.map(msg => {
            const cleanContent = this.extractConversationContent(msg.content);
            return `[${new Date(msg.timestamp).toISOString()}] ${msg.senderId}: ${cleanContent}`;
        }).join('\n');

        const contextInfo = input.channelName ? `Channel: ${input.channelName}` : '';
        const descInfo = input.channelDescription ? `Description: ${input.channelDescription}` : '';

        return `${systemPrompt}\n\n${contextInfo}\n${descInfo}\n\nConversation:\n${messagesText}\n\nGenerate a structured summary and respond with JSON matching this schema:\n${JSON.stringify(CONVERSATION_SUMMARY_SCHEMA, null, 2)}`;
    }

    /**
     * Build reasoning analysis prompt
     * @param input - Reasoning analysis input
     * @returns Formatted prompt string
     */
    private buildReasoningAnalysisPrompt(input: ReasoningAnalysisInput): string {
        const systemPrompt = `You are a reasoning analysis component in an ORPAR control loop system. Analyze the context and observations to provide structured reasoning. Respond with valid JSON matching the required schema.`;
        
        const observationsText = input.observations.map((obs, idx) => 
            `Observation ${idx + 1}: ${obs}`
        ).join('\n');

        const actionsText = input.previousActions.length > 0 
            ? `\nPrevious Actions:\n${input.previousActions.map((action, idx) => `Action ${idx + 1}: ${action}`).join('\n')}`
            : '';

        return `${systemPrompt}\n\nContext: ${input.context}\n\nObservations:\n${observationsText}${actionsText}\n\nProvide structured reasoning analysis and respond with JSON matching this schema:\n${JSON.stringify(REASONING_ANALYSIS_SCHEMA, null, 2)}`;
    }

    /**
     * Check if System LLM capabilities are available
     * @returns Boolean indicating if LLM operations can be performed
     */
    public isAvailable(): boolean {
        return process.env.OPENROUTER_API_KEY !== undefined;
    }

    /**
     * Get supported LLM operations
     * @returns Array of available operation types
     */
    public getSupportedOperations(): string[] {
        return [
            'topic-extraction',
            'conversation-summary', 
            'reasoning-analysis'
        ];
    }

    /**
     * Parse structured response from LLM
     * @param responseText - Text response from LLM
     * @param operationType - Type of operation for logging
     * @param instructionId - Instruction ID for tracking
     * @returns Parsed response data with source metadata
     */
    private parseStructuredResponse(responseText: string, operationType: string, instructionId?: string): any {
        try {
            // Validate input
            if (!responseText || typeof responseText !== 'string') {
                throw new Error(`Invalid response text: ${typeof responseText} - ${responseText}`);
            }
            
            
            // Sanitize JSON response
            const sanitizedResponse = this.sanitizeJsonResponse(responseText);
            
            if (!sanitizedResponse || sanitizedResponse.trim() === '') {
                throw new Error(`Empty response after sanitization. Original: "${responseText}"`);
            }
            
            
            // Parse JSON
            const parsedData = JSON.parse(sanitizedResponse);
            
            // Validate that we got a valid object
            if (!parsedData || typeof parsedData !== 'object') {
                throw new Error(`Parsed response is not a valid object: ${typeof parsedData} - ${JSON.stringify(parsedData)}`);
            }
            
            // Add metadata to indicate this is a REAL LLM response
            parsedData._responseSource = 'llm';
            parsedData._instructionId = instructionId;
            parsedData._timestamp = Date.now();
            
            // Specific validation for reasoning analysis
            if (operationType === 'reasoning-analysis') {
                if (!parsedData.analysis) {
                    this.logger.warn(`Reasoning analysis response missing 'analysis' field. Available fields: ${Object.keys(parsedData).join(', ')}`);
                    // Extract analysis string from nested reasoning object if available
                    if (parsedData.reasoning && typeof parsedData.reasoning === 'object' && parsedData.reasoning.analysis) {
                        parsedData.analysis = parsedData.reasoning.analysis;
                        parsedData._responseSource = 'llm-partial';
                    } else {
                        // Use fallback options
                        parsedData.analysis = parsedData.content || parsedData.result || 'Analysis completed';
                        parsedData._responseSource = 'llm-partial';
                    }
                }
                if (!parsedData.confidence) {
                    parsedData.confidence = 0.5; // Default confidence
                    parsedData._responseSource = 'llm-partial';
                }
            }
            
            return parsedData;
            
        } catch (parseError) {
            const error = new Error(`Failed to parse structured response for ${operationType}: ${parseError instanceof Error ? parseError.message : String(parseError)}`);
            this.logger.error(`❌ LLM PARSE FAILED: ${error.message}`);
            this.logger.error(`Raw response text: ${responseText}`);
            
            // For reasoning analysis, provide a fallback structure to prevent undefined
            if (operationType === 'reasoning-analysis') {
                this.logger.warn(`🔄 USING FALLBACK: Providing fallback reasoning analysis structure due to parsing error`);
                return {
                    analysis: responseText || 'Analysis failed but text available',
                    confidence: 0.1,
                    reasoning: responseText || 'Reasoning failed',
                    insights: [],
                    recommendations: [],
                    _responseSource: 'fallback',
                    _fallbackReason: 'json_parse_error',
                    _instructionId: instructionId,
                    _timestamp: Date.now(),
                    _originalError: parseError instanceof Error ? parseError.message : String(parseError)
                };
            }
            
            // For other operations, provide generic fallback
            this.logger.warn(`🔄 USING FALLBACK: Providing fallback structure for ${operationType}`);
            const fallbackResponse = {
                _responseSource: 'fallback',
                _fallbackReason: 'json_parse_error',
                _instructionId: instructionId,
                _timestamp: Date.now(),
                _originalError: parseError instanceof Error ? parseError.message : String(parseError)
            };
            
            // Add operation-specific fallback data
            if (operationType === 'topic-extraction') {
                Object.assign(fallbackResponse, {
                    topics: [],
                    summary: 'Topic extraction failed'
                });
            } else if (operationType === 'conversation-summary') {
                Object.assign(fallbackResponse, {
                    summary: responseText || 'Summary generation failed',
                    keyPoints: [],
                    participantSummaries: []
                });
            }
            
            // Emit error event for fail-fast test detection
            try {
                if (instructionId && typeof instructionId === 'string') {
                    this.emitInstructionError(instructionId, error.message);
                } else {
                    this.logger.warn(`Cannot emit LLM instruction error event - invalid or missing instructionId: ${instructionId || '[MISSING]'}`);
                }
            } catch (eventError) {
                this.logger.error(`Failed to emit LLM error event: ${eventError}`);
            }
            
            return fallbackResponse;
        }
    }

    /**
     * Sanitize JSON response by removing markdown code blocks
     * @param response - Raw response string that may contain markdown
     * @returns Cleaned JSON string
     */
    private sanitizeJsonResponse(response: string): string {
        if (typeof response !== 'string') {
            return response;
        }

        // Remove markdown code blocks (```json...``` or ```...```)
        let cleaned = response.replace(/```(?:json\s*)?([^`]+)```/g, '$1');
        
        // Remove any remaining backticks
        cleaned = cleaned.replace(/`/g, '');
        
        // Remove "json" prefix if it appears at the start of the response
        cleaned = cleaned.replace(/^\s*json\s*/i, '');
        
        // Trim whitespace
        cleaned = cleaned.trim();
        
        return cleaned;
    }

    /**
     * Emit LLM instruction started event using proper payload helper
     * @param instructionId - Unique instruction ID
     * @param prompt - The prompt being processed
     * @param options - LLM options
     */
    private emitInstructionStarted(instructionId: string, prompt: string, options?: any): void {
        try {
            const eventData: LlmInstructionStartedEventData = {
                serviceId: 'SystemLlmService',
                instructionId,
                timestamp: Date.now(),
                prompt,
                options
            };
            
            const payload = createLlmInstructionStartedPayload(
                Events.LlmService.INSTRUCTION_STARTED,
                'system', // Default agentId for system operations
                'system', // Default channelId for system operations
                eventData
            );
            
            this.eventBus.emit(Events.LlmService.INSTRUCTION_STARTED, payload);
        } catch (error) {
            logger.error(`Failed to emit instruction started event: ${error}`);
        }
    }

    /**
     * Emit LLM instruction completed event using proper payload helper
     * @param instructionId - Unique instruction ID
     * @param response - The LLM response
     * @param usage - Usage statistics if available
     */
    private emitInstructionCompleted(instructionId: string, response: string, usage?: any): void {
        try {
            const eventData: LlmInstructionCompletedEventData = {
                serviceId: 'SystemLlmService',
                instructionId,
                timestamp: Date.now(),
                response,
                usage
            };

            const payload = createLlmInstructionCompletedPayload(
                Events.LlmService.INSTRUCTION_COMPLETED,
                'system', // Default agentId for system operations
                'system', // Default channelId for system operations
                eventData
            );

            // Log a preview of what the SystemLLM produced
            const preview = response.length > 500 ? response.substring(0, 500) + '...' : response;
            this.logger.debug(`[SystemLLM:Output] Instruction ${instructionId} completed:\n${preview}`);

            this.eventBus.emit(Events.LlmService.INSTRUCTION_COMPLETED, payload);
        } catch (error) {
            logger.error(`Failed to emit instruction completed event: ${error}`);
        }
    }

    /**
     * Emit LLM instruction error event using proper payload helper
     * @param instructionId - Unique instruction ID
     * @param error - The error message
     */
    private emitInstructionError(instructionId: string, error: string): void {
        try {
            const eventData: LlmInstructionErrorEventData = {
                serviceId: 'SystemLlmService',
                instructionId,
                timestamp: Date.now(),
                error
            };
            
            const payload = createLlmInstructionErrorPayload(
                Events.LlmService.INSTRUCTION_ERROR,
                'system', // Default agentId for system operations
                'system', // Default channelId for system operations
                eventData
            );
            
            this.eventBus.emit(Events.LlmService.INSTRUCTION_ERROR, payload);
        } catch (error) {
            logger.error(`Failed to emit instruction error event: ${error}`);
        }
    }

    // === PHASE 1 ENHANCEMENT: System Ephemeral Events with Temporal Context ===

    /**
     * Generate ephemeral system event with rich temporal context
     * Leverages existing Time MCP server for time-aware intelligence
     * @param channelId - Channel to analyze for context
     * @param trigger - Event trigger type
     * @param injectionType - Type of ephemeral injection
     * @param agentId - Optional specific agent target
     * @returns Promise resolving to generated ephemeral event payload
     */
    public async generateEphemeralEvent(
        channelId: ChannelId,
        trigger: 'pre_reasoning' | 'post_action' | 'high_activity' | 'conflict_detected' | 'pattern_recognized' | 'temporal_shift',
        injectionType: 'coordination_hint' | 'context_reminder' | 'activity_alert' | 'tool_suggestion' | 'pattern_insight',
        agentId?: AgentId
    ): Promise<SystemEphemeralEventPayload> {
        try {

            // Step 1: Get rich temporal context via existing Time MCP server
            const temporalContext = await this.getTemporalContext(channelId);

            // Step 2: Analyze channel for coordination opportunities
            const coordinationAnalysis = await this.analyzeChannelForCoordination(channelId);

            // Step 3: Generate contextual content using LLM
            const content = await this.generateContextualContent(
                trigger,
                injectionType,
                coordinationAnalysis,
                temporalContext
            );

            // Step 4: Calculate confidence and relevance scores
            const confidence = this.calculateEventConfidence(trigger, injectionType, coordinationAnalysis);
            const relevance = this.calculateEventRelevance(temporalContext, coordinationAnalysis);
            const temporalRelevance = this.calculateTemporalRelevance(temporalContext, trigger);

            // Step 5: Create ephemeral event data structure
            const ephemeralEventData: SystemEphemeralEventData = {
                trigger,
                injectionType,
                content,
                temporalContext,
                metadata: {
                    confidence,
                    relevance,
                    channelActivity: coordinationAnalysis.activityMetrics.messageCount,
                    targetAgents: agentId ? [agentId] : coordinationAnalysis.activeAgents,
                    relatedMemory: [], // Can be enhanced with memory integration
                    temporalRelevance,
                    expirationTime: new Date(Date.now() + this.calculateTTL(injectionType)).toISOString(),
                    source: 'system_analysis',
                    suggestedTools: await this.suggestRelevantTools(coordinationAnalysis),
                    orparPhase: this.mapTriggerToOrparPhase(trigger)
                },
                visibility: 'channel_only',
                ttl: this.calculateTTL(injectionType),
                priority: this.calculateEventPriority(trigger, confidence, relevance)
            };

            // Step 6: Create full event payload using helper method
            const eventPayload = createSystemEphemeralEventPayload(
                SystemEvents.EPHEMERAL_INJECTION as SystemEventType,
                agentId || 'system',
                channelId,
                ephemeralEventData,
                coordinationAnalysis,
                {
                    source: 'SystemLlmService',
                    systemConfidence: confidence,
                    analysisMethod: 'coordination_detection'
                }
            );

            // Validate the system event payload
            validateSystemEventPayload(eventPayload);

            return eventPayload;

        } catch (error) {
            this.logger.error(`❌ Failed to generate ephemeral event: ${error}`);
            throw error;
        }
    }

    /**
     * Get rich temporal context via existing Time MCP server integration
     * @param channelId - Channel identifier for timezone context
     * @returns Promise resolving to temporal context data
     */
    private async getTemporalContext(channelId: ChannelId): Promise<TemporalContext> {
        try {
            if (!this.hybridMcpService) {
                return this.getFallbackTemporalContext();
            }

            // Use existing Time MCP server for temporal intelligence
            const timeData = await this.hybridMcpService.executeTool('get_current_time', {
                timezone: 'UTC', // Can be enhanced with channel-specific timezone detection
                include_relative: true,
                include_business_hours: true
            });

            // Process time server response into temporal context
            const temporalContext: TemporalContext = createTemporalContext(timeData);

            validator.assertIsObject(temporalContext, 'TemporalContext must be an object');
            validator.assertIsString(temporalContext.currentTime, 'TemporalContext.currentTime must be a string');
            validator.assertIsString(temporalContext.localTime, 'TemporalContext.localTime must be a string');
            validator.assertIsString(temporalContext.timeZone, 'TemporalContext.timeZone must be a string');

            return temporalContext;

        } catch (error) {
            this.logger.warn(`⚠️ Time server unavailable, using fallback temporal context: ${error}`);
            return this.getFallbackTemporalContext();
        }
    }

    /**
     * Analyze channel state for coordination opportunities and patterns
     * @param channelId - Channel to analyze
     * @returns Promise resolving to coordination analysis
     */
    public async analyzeChannelForCoordination(channelId: ChannelId): Promise<CoordinationAnalysis> {
        // Guard: Check if coordination is enabled for this channel
        if (!this.configManager.isChannelSystemLlmEnabled(channelId, 'coordination')) {
            return this.createEmptyCoordinationAnalysis(channelId);
        }

        try {

            // Use existing available methods to get agent data
            const agentService = AgentService.getInstance();
            const channelService = ChannelService.getInstance();
            
            // Get all agents and extract rich context for active ones
            const allAgents = agentService.getAllAgents();
            const activeAgentIds: string[] = [];
            const agentContexts: Array<{
                id: string;
                capabilities: string[];
                metadata: Record<string, any>;
                lastActivity: number;
                status: string;
            }> = [];
            
            // Extract active agent IDs and their context
            allAgents.forEach((agent, agentId) => {
                // Check for connected agents using the actual enum values
                if (agent.status === 'connected' || agent.socketIds.length > 0) {
                    activeAgentIds.push(agentId);
                    agentContexts.push({
                        id: agentId,
                        capabilities: agent.capabilities || [],
                        metadata: agent.metadata || {},
                        lastActivity: agent.lastActivity,
                        status: agent.status
                    });
                }
            });
            
            
            // Create rich agent descriptions for LLM analysis
            const agentDescriptions = agentContexts.map(agent => {
                const capabilities = agent.capabilities.length > 0 
                    ? `capabilities: [${agent.capabilities.join(', ')}]`
                    : 'capabilities: none specified';
                
                const role = agent.metadata.role || 'unspecified role';
                const description = agent.metadata.description || 'no description';
                const lastActiveMinutes = Math.floor((Date.now() - agent.lastActivity) / (1000 * 60));
                
                return `${agent.id} (${role}): ${description}, ${capabilities}, last active ${lastActiveMinutes} minutes ago, status: ${agent.status}`;
            }).join('\n');
            
            // Get basic metrics (simplified approach)
            const messageCount = 10; // Default placeholder
            const recentActivity = activeAgentIds.length; // Use agent count as activity proxy
            
            // Use LLM to analyze coordination opportunities with rich agent context
            const analysisPrompt = `
                Analyze the following channel activity for coordination opportunities:
                
                Channel: ${channelId}
                Active Agents (${activeAgentIds.length}):
                ${agentDescriptions}
                
                Activity Level: ${recentActivity} active participants
                
                Based on the agent capabilities, roles, and descriptions above, identify:
                1. Potential collaboration opportunities between agents with complementary skills
                2. Coordination patterns that could improve efficiency
                3. Agents that might benefit from working together
                4. Tools or actions that could facilitate better coordination
                
                Provide a JSON response with coordination opportunities and temporal patterns.
                
                Format:
                {
                    "opportunities": [
                        {
                            "type": "collaboration",
                            "description": "...",
                            "confidence": 0.8,
                            "suggestedAction": "...",
                            "involvedAgents": ["agent1", "agent2"],
                            "reasoning": "why these agents should collaborate based on their context"
                        }
                    ],
                    "temporalPatterns": ["pattern1", "pattern2"]
                }
            `;
            
            let llmResponse: any = {};
            try {
                // Use reasoning model for coordination analysis
                const model = this.getModelForOperation('reasoning');
                const responseText = await this.sendLlmRequestWithRecovery(analysisPrompt, {
                    type: 'object',
                    properties: {
                        opportunities: {
                            type: 'array',
                            items: {
                                type: 'object',
                                properties: {
                                    type: { type: 'string' },
                                    description: { type: 'string' },
                                    confidence: { type: 'number' },
                                    suggestedAction: { type: 'string' },
                                    involvedAgents: { type: 'array', items: { type: 'string' } },
                                    reasoning: { type: 'string' }
                                }
                            }
                        },
                        temporalPatterns: {
                            type: 'array',
                            items: { type: 'string' }
                        }
                    }
                }, { 
                    model, 
                    temperature: 0.7,
                    maxTokens: 1000 
                });

                // Parse the LLM response safely using the new extraction utility
                if (typeof responseText === 'string') {
                    try {
                        llmResponse = this.extractJsonFromResponse(responseText);
                    } catch (parseError) {
                        this.logger.warn(`Failed to parse LLM response: ${parseError}`);
                        llmResponse = {};
                    }
                }
            } catch (llmError) {
                this.logger.warn(`LLM analysis failed: ${llmError}`);
            }
            
            const analysis: CoordinationAnalysis = {
                channelId,
                activeAgents: activeAgentIds,
                opportunities: llmResponse.opportunities || [{
                    type: 'collaboration',
                    involvedAgents: activeAgentIds,
                    description: 'General coordination opportunity detected based on channel activity',
                    confidence: 0.7,
                    suggestedAction: 'Consider coordinating on shared objectives',
                    reasoning: 'Agents have complementary skills and are active in the channel'
                }],
                activityMetrics: {
                    messageCount,
                    toolUsage: recentActivity, // Approximate tool usage from activity
                    interactionDensity: recentActivity / 10, // interactions per minute
                    timePeriod: 'last 10 minutes'
                },
                temporalPatterns: llmResponse.temporalPatterns || [],
                analysisTime: new Date().toISOString()
            };
            
            return analysis;

        } catch (error) {
            this.logger.error(`❌ Failed to analyze channel for coordination: ${error}`);
            throw error;
        }
    }

    /**
     * Generate time-aware contextual content for ephemeral events using LLM
     * @param trigger - Event trigger
     * @param injectionType - Type of injection
     * @param coordinationAnalysis - Coordination analysis data
     * @param temporalContext - Temporal context data
     * @returns Promise resolving to generated content
     */
    private async generateContextualContent(
        trigger: string,
        injectionType: string,
        coordinationAnalysis: CoordinationAnalysis,
        temporalContext: TemporalContext
    ): Promise<string> {
        try {
            // Create context-aware prompt for LLM
            const prompt = `Generate a brief, intelligent system hint for agents based on the following context:

Trigger: ${trigger}
Injection Type: ${injectionType}
Time Context: ${temporalContext.contextualTiming}
Channel Activity: ${coordinationAnalysis.activityMetrics.messageCount} messages in ${coordinationAnalysis.activityMetrics.timePeriod}
Active Agents: ${coordinationAnalysis.activeAgents.length}
Business Hours: ${temporalContext.workingHours ? 'Yes' : 'No'}

Create a helpful, contextual hint that provides value without being intrusive. Keep it under 100 words and focus on actionable intelligence.`;

            // Use the existing processPrompt method
            return new Promise((resolve, reject) => {
                this.processPrompt({
                    prompt,
                    systemPrompt: 'You are a helpful system intelligence component. Generate concise, actionable hints for agents.',
                    options: {
                        model: this.getModelForOperation('reasoning' as any),
                        temperature: 0.7,
                        maxTokens: 200
                    }
                }).subscribe({
                    next: (response: string) => {
                        let content = response.trim();
                        resolve(content);
                    },
                    error: (error) => {
                        this.logger.warn(`⚠️ LLM content generation failed, using fallback: ${error}`);
                        resolve(this.getFallbackContent(injectionType, temporalContext));
                    }
                });
            });

        } catch (error) {
            this.logger.warn(`⚠️ LLM content generation failed, using fallback: ${error}`);
            return this.getFallbackContent(injectionType, temporalContext);
        }
    }

    // === Helper Methods for Ephemeral Event Generation ===

    /**
     * Calculate confidence score for ephemeral event
     */
    private calculateEventConfidence(trigger: string, injectionType: string, analysis: CoordinationAnalysis): number {
        let baseConfidence = 0.6;
        
        // Increase confidence based on trigger type
        if (trigger === 'high_activity' && analysis.activityMetrics.messageCount > 5) {
            baseConfidence += 0.2;
        }
        if (trigger === 'conflict_detected') {
            baseConfidence += 0.3;
        }
        
        return Math.min(baseConfidence, 1.0);
    }

    /**
     * Calculate relevance score for ephemeral event
     */
    private calculateEventRelevance(temporalContext: TemporalContext, analysis: CoordinationAnalysis): number {
        let relevance = 0.5;
        
        // Higher relevance during business hours
        if (temporalContext.workingHours) {
            relevance += 0.2;
        }
        
        // Higher relevance with more active agents
        if (analysis.activeAgents.length > 2) {
            relevance += 0.2;
        }
        
        return Math.min(relevance, 1.0);
    }

    /**
     * Calculate temporal relevance score
     */
    private calculateTemporalRelevance(temporalContext: TemporalContext, trigger: string): number {
        let temporalRelevance = 0.5;
        
        if (trigger === 'temporal_shift' || trigger === 'pattern_recognized') {
            temporalRelevance += 0.3;
        }
        
        // Higher relevance during active hours
        if (temporalContext.workingHours && !temporalContext.metadata.isWeekend) {
            temporalRelevance += 0.2;
        }
        
        return Math.min(temporalRelevance, 1.0);
    }

    /**
     * Calculate TTL for ephemeral event based on type
     */
    private calculateTTL(injectionType: string): number {
        switch (injectionType) {
            case 'activity_alert': return 300000; // 5 minutes
            case 'coordination_hint': return 600000; // 10 minutes
            case 'tool_suggestion': return 900000; // 15 minutes
            case 'context_reminder': return 1800000; // 30 minutes
            case 'pattern_insight': return 3600000; // 1 hour
            default: return 600000; // 10 minutes default
        }
    }

    /**
     * Calculate event priority (1-10)
     */
    private calculateEventPriority(trigger: string, confidence: number, relevance: number): 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 {
        const basePriority = Math.round((confidence + relevance) * 5);
        
        // Adjust based on trigger urgency
        let priority = basePriority;
        if (trigger === 'conflict_detected') priority += 3;
        if (trigger === 'high_activity') priority += 2;
        
        return Math.max(1, Math.min(10, priority)) as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;
    }

    /**
     * Suggest relevant tools based on coordination analysis
     */
    private async suggestRelevantTools(analysis: CoordinationAnalysis): Promise<string[]> {
        try {
            // Create intent description based on coordination analysis
            const opportunityDescriptions = analysis.opportunities.map(op => 
                `${op.type}: ${op.description} (confidence: ${op.confidence}, action: ${op.suggestedAction})`
            ).join('; ');
            
            const intent = `
                Coordination Analysis Summary:
                - Channel: ${analysis.channelId}
                - Active Agents: ${analysis.activeAgents.length} (${analysis.activeAgents.join(', ')})
                - Activity: ${analysis.activityMetrics.messageCount} messages, ${analysis.activityMetrics.interactionDensity} interactions/min
                - Opportunities: ${opportunityDescriptions}
                - Temporal Patterns: ${analysis.temporalPatterns.join(', ')}
                
                Recommend tools that would facilitate the identified coordination opportunities and improve agent collaboration.
            `;
            
            // Get available tools from constants
            // Use imported tool name constants
            
            const availableTools = [
                { name: COMMUNICATION_TOOLS.SEND_MESSAGE, category: 'communication', description: 'Send messages between agents' },
                { name: CONTEXT_MEMORY_TOOLS.CHANNEL_CONTEXT_READ, category: 'context', description: 'Read channel context and history' },
                { name: CONTEXT_MEMORY_TOOLS.CHANNEL_MESSAGES_READ, category: 'context', description: 'Read channel messages' },
                { name: META_TOOLS.TOOLS_RECOMMEND, category: 'meta', description: 'Get tool recommendations' }
            ];
            
            // Use the existing LLM-powered tool recommendation system
            const recommendations = await new Promise<any>((resolve, reject) => {
                this.generateToolRecommendations(
                    intent,
                    availableTools,
                    5, // max recommendations
                    `Channel analysis for coordination opportunities`
                ).subscribe({
                    next: (result) => resolve(result),
                    error: (error) => reject(error)
                });
            });
            
            // Extract tool names from LLM recommendations
            const toolNames = recommendations?.recommendations?.map((rec: any) => rec.toolName || rec.name) || [];
            
            // Fallback to basic tools if LLM recommendations are empty
            if (toolNames.length === 0) {
                this.logger.warn('LLM tool recommendations were empty, using fallback');
                return [COMMUNICATION_TOOLS.SEND_MESSAGE];
            }
            
            return toolNames.slice(0, 5); // Limit to top 5
            
        } catch (error) {
            this.logger.warn(`LLM tool recommendation failed: ${error}`);
            // Import fallback tools
            // Use imported tool name constants
            return [COMMUNICATION_TOOLS.SEND_MESSAGE];
        }
    }

    /**
     * Map trigger to ORPAR phase
     */
    private mapTriggerToOrparPhase(trigger: string): 'observation' | 'reasoning' | 'action' | 'planning' | 'reflection' | undefined {
        switch (trigger) {
            case 'pre_reasoning': return 'reasoning';
            case 'post_action': return 'reflection';
            case 'pattern_recognized': return 'observation';
            default: return undefined;
        }
    }

    /**
     * Generate contextual timing description
     */
    private generateContextualTiming(timeData: any): string {
        const hour = new Date().getHours();
        const isWeekend = this.isWeekend();
        
        if (isWeekend) {
            return 'Weekend period - reduced activity expected';
        } else if (hour >= 9 && hour <= 17) {
            return 'Peak collaboration hours - high agent activity';
        } else if (hour >= 18 && hour <= 22) {
            return 'Evening period - moderate activity';
        } else {
            return 'Off-peak hours - limited activity expected';
        }
    }

    /**
     * Check if current time is business hours
     */
    private isBusinessHours(): boolean {
        const hour = new Date().getHours();
        return hour >= 9 && hour <= 17 && !this.isWeekend();
    }

    /**
     * Check if current day is weekend
     */
    private isWeekend(): boolean {
        const day = new Date().getDay();
        return day === 0 || day === 6; // Sunday or Saturday
    }

    /**
     * Get fallback temporal context when Time server unavailable
     */
    private getFallbackTemporalContext(): TemporalContext {
        const now = new Date();
        return {
            currentTime: now.toISOString(),
            localTime: now.toLocaleString(),
            relativeTime: 'now',
            workingHours: this.isBusinessHours(),
            timeZone: 'UTC',
            dayOfWeek: now.toLocaleDateString('en-US', { weekday: 'long' }),
            contextualTiming: 'Standard operating period',
            metadata: {
                timestamp: Date.now(),
                businessHours: { start: '09:00', end: '17:00' },
                utcOffset: 0,
                isWeekend: this.isWeekend()
            }
        };
    }

    /**
     * Get fallback content when LLM generation fails
     */
    private getFallbackContent(injectionType: string, temporalContext: TemporalContext): string {
        switch (injectionType) {
            case 'coordination_hint':
                return `${temporalContext.contextualTiming} - Consider coordinating with other active agents for improved efficiency.`;
            case 'activity_alert':
                return `High channel activity detected during ${temporalContext.contextualTiming} - collaboration opportunities available.`;
            case 'tool_suggestion':
                return `Based on current ${temporalContext.contextualTiming}, relevant tools may help optimize your workflow.`;
            case 'context_reminder':
                return `Context update: ${temporalContext.contextualTiming} - maintaining awareness of temporal patterns.`;
            case 'pattern_insight':
                return `Pattern detected during ${temporalContext.contextualTiming} - consider leveraging established workflows.`;
            default:
                return `System insight available during ${temporalContext.contextualTiming}.`;
        }
    }

    /**
     * Analyze conversation patterns using direct MongoDB access
     * Enhanced with LLM-based pattern analysis instead of MongoDB Lens MCP tools
     */
    public async analyzeConversationPatterns(
        channelId: ChannelId,
        messages: ChannelMessage[]
    ): Promise<any> {
        try {
            // Use LLM to analyze conversation patterns intelligently
            const conversationContext = messages.slice(-20).map(msg => ({
                sender: msg.senderId,
                timestamp: new Date(msg.metadata?.timestamp || Date.now()).toISOString(),
                content: typeof msg.content === 'string' 
                    ? msg.content.substring(0, 200) 
                    : JSON.stringify(msg.content).substring(0, 200),
                type: 'channelMessage' // All messages in this context are channel messages
            }));

            const analysisPrompt = `
                Analyze the following conversation patterns for channel ${channelId}:
                
                Messages: ${messages.length} total
                Recent conversation context (last 20 messages):
                ${conversationContext.map(msg => 
                    `[${msg.timestamp}] ${msg.sender}: ${msg.content} (${msg.type})`
                ).join('\n')}
                
                Analyze patterns in:
                1. Communication frequency and timing
                2. Agent collaboration patterns
                3. Topic clusters and conversation flow
                4. Tool usage patterns
                5. Coordination effectiveness
                
                Provide insights in JSON format:
                {
                    "patterns": {
                        "communicationFrequency": "high|medium|low",
                        "collaborationLevel": "high|medium|low",
                        "topicClusters": ["topic1", "topic2"],
                        "toolUsagePatterns": ["pattern1", "pattern2"],
                        "coordinationEffectiveness": "effective|moderate|ineffective"
                    },
                    "insights": ["insight1", "insight2"],
                    "recommendations": ["recommendation1", "recommendation2"]
                }
            `;

            let llmAnalysis: any = {};
            try {
                // Use reasoning model for conversation pattern analysis
                const model = this.getModelForOperation('reasoning');
                const responseText = await this.sendLlmRequestWithRecovery(analysisPrompt, {
                    type: 'object',
                    properties: {
                        patterns: {
                            type: 'object',
                            properties: {
                                communicationFrequency: { type: 'string' },
                                collaborationLevel: { type: 'string' },
                                topicClusters: { type: 'array', items: { type: 'string' } },
                                toolUsagePatterns: { type: 'array', items: { type: 'string' } },
                                coordinationEffectiveness: { type: 'string' }
                            }
                        },
                        insights: { type: 'array', items: { type: 'string' } },
                        recommendations: { type: 'array', items: { type: 'string' } }
                    }
                }, { 
                    model, 
                    temperature: 0.7,
                    maxTokens: 1000 
                });

                // Parse the LLM response safely using the new extraction utility
                if (typeof responseText === 'string') {
                    try {
                        llmAnalysis = this.extractJsonFromResponse(responseText);
                    } catch (parseError) {
                        this.logger.warn(`Failed to parse LLM conversation analysis: ${parseError}`);
                    }
                }
            } catch (llmError) {
                this.logger.warn(`LLM conversation analysis failed: ${llmError}`);
            }
            
            const participantCount = new Set(messages.map(m => m.senderId)).size;
            const firstTimestamp = messages.length > 0 ? (messages[0].metadata?.timestamp || 0) : 0;
            const lastTimestamp = messages.length > 0 ? (messages[messages.length - 1].metadata?.timestamp || 0) : 0;
            const timespan = lastTimestamp - firstTimestamp;
            const avgMessageLength = messages.length > 0
                ? messages.reduce((sum, m) => sum + (
                    typeof m.content === 'string' 
                        ? m.content.length 
                        : JSON.stringify(m.content).length
                ), 0) / messages.length
                : 0;

            // Combine LLM analysis with calculated metrics
            const conversationPatterns = {
                messageCount: messages.length,
                participantCount,
                timespan,
                avgMessageLength,
                llmAnalysis: llmAnalysis.patterns || {},
                insights: llmAnalysis.insights || [],
                recommendations: llmAnalysis.recommendations || [],
                queryPatterns: [
                    { timestamp: -1, senderId: 1 }, // Common sort pattern
                    { channelId: 1, timestamp: -1 } // Channel-specific queries
                ]
            };

            // Store patterns directly in MongoDB using native operations
            try {
                const db = mongoose.connection.db;
                if (db) {
                    await db.collection('conversation_patterns').updateOne(
                        { channelId },
                        { 
                            $set: { 
                                ...conversationPatterns,
                                updatedAt: new Date(),
                                channelId 
                            } 
                        },
                        { upsert: true }
                    );
                }
            } catch (dbError) {
                this.logger.warn(`Failed to store conversation patterns: ${dbError}`);
            }

            return { conversationPatterns };

        } catch (error) {
            this.logger.error(`Failed to analyze conversation patterns: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    }

    // === REAL-TIME COORDINATION FEATURES ===

    /**
     * Initialize real-time coordination message listening
     */
    private initializeRealTimeCoordination(): void {
        if (this.coordinationInitialized) {
            return;
        }


        // Create bound function references for proper cleanup
        this.boundHandleChannelMessageForCoordination = this.handleChannelMessageForCoordination.bind(this);
        this.boundHandleOrparEventForCoordination = this.handleOrparEventForCoordination.bind(this);

        // Listen to all channel messages for coordination analysis (only one event type to avoid duplicates)
        this.eventBus.on(Events.Message.AGENT_MESSAGE_DELIVERED, this.boundHandleChannelMessageForCoordination);
        
        // Listen to ORPAR events for context injection
        this.eventBus.on(Events.ControlLoop.REASONING, this.boundHandleOrparEventForCoordination);
        this.eventBus.on(Events.ControlLoop.PLAN, this.boundHandleOrparEventForCoordination);
        this.eventBus.on(Events.ControlLoop.ACTION, this.boundHandleOrparEventForCoordination);

        // Clean up old activity data every 10 minutes
        this.coordinationCleanupTimer = setInterval(() => this.cleanupOldCoordinationActivity(), 600000);

        this.coordinationInitialized = true;
    }

    /**
     * Handle incoming channel messages and analyze for coordination opportunities
     */
    private async handleChannelMessageForCoordination(payload: any): Promise<void> {
        try {
            // Check if service is shutting down
            if (this.isShuttingDown) {
                return;
            }

            // Handle different message event formats and extract channelId
            let channelId: string | undefined;
            let message: any;
            
            if (payload.data) {
                // CHANNEL_MESSAGE_DELIVERED format
                channelId = payload.channelId || payload.data.channelId;
                message = payload.data.message || payload.data;
            } else {
                // AGENT_MESSAGE format
                channelId = payload.channelId;
                message = {
                    senderId: payload.data?.senderId || payload.agentId,
                    receiverId: payload.data?.receiverId,
                    content: payload.data?.content || payload.data?.message,
                    timestamp: payload.timestamp || Date.now()
                };
            }
            
            if (!channelId || !message) {
                return;
            }

            // Guard: Check if coordination is enabled for this channel (AFTER channelId is resolved)
            const isEnabled = this.configManager.isChannelSystemLlmEnabled(channelId, 'coordination');
            this.logger.debug(`[COORDINATION_GUARD] Channel ${channelId} - SystemLLM enabled: ${isEnabled}`);
            if (!isEnabled) {
                this.logger.debug(`[COORDINATION_GUARD] Skipping coordination for channel ${channelId} - SystemLLM disabled`);
                return;
            }

            // Skip system messages to avoid coordination loops
            if (message.senderId === 'system') {
                return;
            }
            
            // Create message ID for deduplication
            const messageId = `${channelId}:${message.senderId}:${Date.now()}:${JSON.stringify(message.content).substring(0, 50)}`;
            if (this.processedMessages.has(messageId)) {
                return; // Already processed this message
            }
            this.processedMessages.add(messageId);
            
            // Cleanup old message IDs (keep only last 100)
            if (this.processedMessages.size > 100) {
                const messageIds = Array.from(this.processedMessages);
                messageIds.slice(0, 50).forEach(id => this.processedMessages.delete(id));
            }

            // Update channel activity tracking
            await this.updateChannelActivity(channelId, message);

            // Check for coordination triggers
            const triggerType = await this.detectCoordinationTrigger(channelId);
            
            if (triggerType) {
                // Immediate channel lock to prevent concurrent coordination checks
                const now = Date.now();
                const lastCheck = this.channelCoordinationLocks.get(channelId);
                if (lastCheck && now - lastCheck < 3000) {
                    return;
                }
                this.channelCoordinationLocks.set(channelId, now);
                
                // Update coordination timestamp immediately to prevent race conditions
                const activity = this.channelActivities.get(channelId);
                if (activity) {
                    activity.lastCoordinationSuggestion = now;
                    activity.suggestionCount++;
                    this.lastGlobalCoordinationTime = now;
                }
                
                await this.generateAndInjectCoordinationSuggestion(channelId, triggerType, message);
            }

        } catch (error) {
            this.logger.error(`Failed to handle channel message for coordination: ${error}`);
        }
    }

    /**
     * Handle ORPAR events and inject contextual coordination
     */
    private async handleOrparEventForCoordination(payload: any): Promise<void> {
        try {
            // Check if service is shutting down
            if (this.isShuttingDown) {
                return;
            }

            const { agentId, channelId } = payload;

            if (!channelId) return;

            // Guard: Check if coordination is enabled for this channel
            if (!this.configManager.isChannelSystemLlmEnabled(channelId, 'coordination')) {
                return;
            }

            // Inject ORPAR-specific coordination context
            await this.generateAndInjectCoordinationSuggestion(channelId, 'orpar_context', null, agentId);

        } catch (error) {
            this.logger.error(`Failed to handle ORPAR event for coordination: ${error}`);
        }
    }

    /**
     * Update channel activity tracking
     */
    private async updateChannelActivity(channelId: ChannelId, message: ChannelMessage): Promise<void> {
        let activity = this.channelActivities.get(channelId);
        
        if (!activity) {
            activity = {
                messageCount: 0,
                lastMessage: 0,
                activeAgents: new Set(),
                recentMessages: [],
                lastCoordinationSuggestion: 0,
                suggestionCount: 0
            };
            this.channelActivities.set(channelId, activity);
        }

        const now = Date.now();
        
        // Update activity metrics
        activity.messageCount++;
        activity.lastMessage = now;
        activity.activeAgents.add(message.senderId);
        
        // Keep last 20 messages for context analysis
        activity.recentMessages.push(message);
        if (activity.recentMessages.length > 20) {
            activity.recentMessages.shift();
        }

        // Reset hourly counter if needed
        if (now - activity.lastCoordinationSuggestion > 3600000) { // 1 hour
            activity.suggestionCount = 0;
        }
    }

    /**
     * Detect coordination triggers based on channel activity
     */
    private async detectCoordinationTrigger(channelId: ChannelId): Promise<string | null> {
        const activity = this.channelActivities.get(channelId);
        if (!activity) return null;

        const now = Date.now();

        // Channel-level lock - prevent ANY coordination if one is in progress for this channel
        const channelLock = this.channelCoordinationLocks.get(channelId);
        if (channelLock && now - channelLock < 30000) { // 30 second lock per channel to cover LLM call duration
            return null;
        }

        // Rate limiting - don't suggest too frequently
        if (now - activity.lastCoordinationSuggestion < this.coordinationConfig.coordinationCooldown) {
            return null;
        }
        
        // Global cooldown - prevent any coordination across all channels too frequently
        if (now - this.lastGlobalCoordinationTime < 300000) { // 5 minute global cooldown to reduce spam
            return null;
        }

        // Max suggestions per hour
        if (activity.suggestionCount >= this.coordinationConfig.maxSuggestionsPerHour) {
            return null;
        }

        // Check for high activity trigger with sustained activity requirement
        const recentWindow = 60000; // 1 minute
        const recentMessageCount = activity.recentMessages.filter(
            msg => now - (msg.metadata?.timestamp || msg.timestamp || 0) < recentWindow
        ).length;
        
        // Also check for sustained activity in a shorter window
        const sustainedMessageCount = activity.recentMessages.filter(
            msg => now - (msg.metadata?.timestamp || msg.timestamp || 0) < this.coordinationConfig.significantActivityWindow
        ).length;

        if (recentMessageCount >= this.coordinationConfig.highActivityThreshold && 
            sustainedMessageCount >= Math.floor(this.coordinationConfig.highActivityThreshold / 2)) {
            return 'high_activity';
        }

        // Check for complementary skills only with minimum agents and recent activity
        if (activity.activeAgents.size >= this.coordinationConfig.minAgentsForCoordination && 
            sustainedMessageCount >= 3) { // Require at least 3 messages in 30s window
            return 'complementary_skills';
        }

        return null;
    }

    /**
     * Generate and inject coordination suggestion
     */
    private async generateAndInjectCoordinationSuggestion(
        channelId: ChannelId,
        triggerType: string,
        triggerMessage: ChannelMessage | null,
        _targetAgentId?: AgentId
    ): Promise<void> {
        // Abort if service is shutting down
        if (this.isShuttingDown) {
            return;
        }

        // Guard: Check if coordination is enabled for this channel
        if (!this.configManager.isChannelSystemLlmEnabled(channelId, 'coordination')) {
            return;
        }
        
        try {
            // Prevent multiple simultaneous coordination suggestions for same channel
            const coordinationKey = `${channelId}:${triggerType}`;
            if (this.coordinationInProgress.has(coordinationKey)) {
                return; // Already generating coordination for this channel/trigger
            }
            this.coordinationInProgress.add(coordinationKey);

            // Set channel-level lock to prevent ANY other coordination for this channel
            this.channelCoordinationLocks.set(channelId, Date.now());

            const activity = this.channelActivities.get(channelId);
            if (!activity) {
                this.coordinationInProgress.delete(coordinationKey);
                this.channelCoordinationLocks.delete(channelId);
                return;
            }
            
            // Update suggestion tracking BEFORE generating to prevent duplicates
            activity.lastCoordinationSuggestion = Date.now();
            activity.suggestionCount++;
            this.lastGlobalCoordinationTime = Date.now();
            

            // Analyze channel for coordination opportunities
            const coordinationAnalysis = await this.analyzeChannelForCoordination(channelId);

            // Generate contextual coordination suggestion
            const suggestionContent = await this.generateCoordinationSuggestionContent(
                triggerType, 
                coordinationAnalysis, 
                activity,
                triggerMessage
            );

            if (suggestionContent) {
                await this.injectSystemCoordinationMessage(channelId, suggestionContent, triggerType);
            } else {
                this.logger.warn(`⚠️ No coordination suggestion content generated for ${triggerType}`);
            }

        } catch (error) {
            this.logger.error(`Failed to generate coordination suggestion: ${error}`);
        } finally {
            // Always clean up the coordination lock
            const coordinationKey = `${channelId}:${triggerType}`;
            this.coordinationInProgress.delete(coordinationKey);
            // Clean up the channel-level lock after a delay to ensure no rapid duplicate coordination
            setTimeout(() => {
                this.channelCoordinationLocks.delete(channelId);
            }, 3000); // Keep lock for 3 seconds
        }
    }

    /**
     * Generate contextual coordination suggestion content using System LLM
     */
    private async generateCoordinationSuggestionContent(
        triggerType: string,
        coordinationAnalysis: any,
        activity: any,
        _triggerMessage: ChannelMessage | null
    ): Promise<string | null> {
        // Abort if service is shutting down
        if (this.isShuttingDown) {
            return null;
        }
        
        try {
            // Create context-aware prompt for coordination suggestion
            const recentContext = activity.recentMessages.slice(-5).map((msg: any) => 
                `[${msg.senderId}]: ${typeof msg.content === 'string' ? msg.content.substring(0, 100) : JSON.stringify(msg.content).substring(0, 100)}`
            ).join('\n');

            const prompt = `Generate a brief, helpful coordination suggestion for the following situation:

TRIGGER: ${triggerType}
CHANNEL: ${activity.channelId || 'unknown'}
ACTIVE AGENTS: ${Array.from(activity.activeAgents).join(', ')} (${activity.activeAgents.size} agents)
RECENT ACTIVITY: ${activity.messageCount} messages

RECENT CONVERSATION CONTEXT:
${recentContext}

COORDINATION OPPORTUNITIES:
${coordinationAnalysis.opportunities.map((op: any) => `- ${op.description} (confidence: ${op.confidence})`).join('\n')}

Generate a concise, actionable coordination suggestion (max 80 words) that:
1. Addresses the specific trigger (${triggerType})
2. Provides value without being intrusive  
3. Suggests specific actions agents can take
4. Uses a helpful, system-intelligence tone

Start with "💡 System coordination insight:" followed by your suggestion.`;

        // Use optimized model selection for coordination suggestions (simple, fast models)
        const model = this.getOptimizedCoordinationModel();
        
        // Alternative options for even more variety:
        // const model = this.getSpecializedModel('reasoning', 'analysis'); // Specialized for analysis tasks
        // const model = this.getCostAwareModel('reasoning', 'balanced'); // Cost-optimized selection
            
        // Add timeout protection
        const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error('Coordination suggestion timeout')), 30000);
        });
        
        const response = await Promise.race([
                this.sendLlmRequestWithRecovery(prompt, null, { 
                    model, 
                    temperature: 0.7,
                    maxTokens: 200 
                }),
                timeoutPromise
            ]) as string;

            // Check if service is shutting down before processing response
            if (this.isShuttingDown) {
                return null;
            }

            const trimmedResponse = response?.trim() || null;
            if (trimmedResponse) {
                this.logger.debug(`[SystemLLM:Coordination] Generated suggestion for ${triggerType}:\n${trimmedResponse}`);
            }
            return trimmedResponse;

        } catch (error) {
            this.logger.warn(`LLM coordination suggestion failed, using fallback: ${error}`);
            const fallback = this.getFallbackCoordinationSuggestion(triggerType, activity);
            this.logger.debug(`[SystemLLM:Coordination] Using fallback for ${triggerType}:\n${fallback}`);
            return fallback;
        }
    }

    /**
     * Get fallback coordination suggestion when LLM fails
     */
    private getFallbackCoordinationSuggestion(triggerType: string, activity: any): string {
        switch (triggerType) {
            case 'high_activity':
                return `💡 System coordination insight: High activity detected with ${activity.activeAgents.size} agents. Consider coordinating on shared objectives or dividing tasks for efficiency.`;
            case 'complementary_skills':
                return `💡 System coordination insight: Multiple agents with complementary capabilities are active. Consider collaboration opportunities that leverage each agent's strengths.`;
            case 'orpar_context':
                return `💡 System coordination insight: ORPAR cycle in progress. Consider coordinating with other agents for enhanced reasoning and planning outcomes.`;
            default:
                return `💡 System coordination insight: Coordination opportunity detected. Consider collaborating with other active agents in this channel.`;
        }
    }

    /**
     * Check if two coordination messages are similar
     */
    private isSimilarContent(content1: string, content2: string): boolean {
        // Normalize for comparison
        const normalize = (str: string) => str.toLowerCase().replace(/\s+/g, ' ').trim();
        const norm1 = normalize(content1);
        const norm2 = normalize(content2);
        
        // Exact match
        if (norm1 === norm2) return true;
        
        // Check if one contains most of the other (80% threshold)
        const words1 = norm1.split(' ');
        const words2 = norm2.split(' ');
        const commonWords = words1.filter(w => words2.includes(w)).length;
        const similarity = commonWords / Math.max(words1.length, words2.length);
        
        return similarity > 0.8;
    }

    /**
     * Inject system coordination message into channel
     */
    private async injectSystemCoordinationMessage(
        channelId: ChannelId,
        content: string,
        coordinationType: string
    ): Promise<void> {
        // Abort if service is shutting down
        if (this.isShuttingDown) {
            return;
        }

        // Guard: Check if coordination is enabled for this channel
        if (!this.configManager.isChannelSystemLlmEnabled(channelId, 'coordination')) {
            return;
        }
        
        // Check for duplicate content in recent history
        const now = Date.now();
        const recentKey = `${channelId}:${coordinationType}`;
        const recent = this.recentCoordinationContent.get(recentKey);
        
        if (recent) {
            // If same or very similar content was sent recently, skip
            const timeDiff = now - recent.timestamp;
            const isSimilar = this.isSimilarContent(content, recent.content);
            
            if (timeDiff < 60000 && isSimilar) { // Within 1 minute and similar
                return;
            }
        }
        
        // Clean up old entries (older than 5 minutes)
        for (const [key, value] of this.recentCoordinationContent.entries()) {
            if (now - value.timestamp > 300000) {
                this.recentCoordinationContent.delete(key);
            }
        }
        
        // Store this content
        this.recentCoordinationContent.set(recentKey, { content, timestamp: now });
        
        try {
            // Create channel message with system sender
            const systemMessage = createChannelMessage(
                channelId,
                'system', // System as sender
                content,
                {
                    metadata: {
                        correlationId: `coordination-${coordinationType}-${Date.now()}`,
                        timestamp: Date.now(),
                        priority: 3 // Low priority to not overwhelm
                    },
                    context: {
                        systemGenerated: true,
                        coordinationType,
                        messageType: 'coordination_suggestion',
                        source: 'SystemLlmService'
                    }
                }
            );

            // Create event payload and emit
            const payload = createChannelMessageEventPayload(
                Events.Message.CHANNEL_MESSAGE,
                'system',
                systemMessage
            );

            this.eventBus.emit(Events.Message.CHANNEL_MESSAGE, payload);

            this.logger.debug(`[SystemLLM:ToAgents] Sent to channel ${channelId} (${coordinationType}):\n────────────────────────────────────────\n${content}\n────────────────────────────────────────`);

        } catch (error) {
            this.logger.error(`Failed to inject system coordination message: ${error}`);
        }
    }

    /**
     * Clean up old coordination activity data to prevent memory leaks
     */
    private cleanupOldCoordinationActivity(): void {
        const now = Date.now();
        const maxAge = 3600000; // 1 hour

        for (const [channelId, activity] of this.channelActivities.entries()) {
            if (now - activity.lastMessage > maxAge) {
                this.channelActivities.delete(channelId);
            }
        }
    }

    /**
     * Get current coordination service statistics
     */
    public getCoordinationStats(): any {
        return {
            activeChannels: this.channelActivities.size,
            totalSuggestions: Array.from(this.channelActivities.values()).reduce((sum, activity) => sum + activity.suggestionCount, 0),
            config: this.coordinationConfig,
            initialized: this.coordinationInitialized
        };
    }

    /**
     * Update coordination configuration
     */
    public updateCoordinationConfig(newConfig: Partial<typeof this.coordinationConfig>): void {
        this.coordinationConfig = { ...this.coordinationConfig, ...newConfig };
    }

    // ===== MXP 2.0 TOKEN OPTIMIZATION METHODS =====

    /**
     * Optimize context for MXP token reduction using intelligent compression
     * Leverages existing ORPAR model selection for optimal summarization
     * Respects channel and agent-level MXP configuration
     */
    public async optimizeContextForMxp(
        contextData: any,
        agentId: string,
        channelId: string,
        options: {
            maxTokens?: number;
            preserveImportant?: boolean;
            strategy?: 'context_compression' | 'conversation_summarization';
            compressionRatio?: number;
            mxpConfig?: any; // MxpConfig - will be properly typed when injected
        } = {}
    ): Promise<{
        compressedContext: string;
        originalTokens: number;
        compressedTokens: number;
        compressionRatio: number;
        strategy: string;
    }> {
        const startTime = Date.now();
        
        try {
            // Check MXP configuration before proceeding
            const mxpConfig = options.mxpConfig;
            
            // If MXP is disabled globally, return original context
            if (mxpConfig && !mxpConfig.modules?.tokenOptimization?.enabled) {
                const contextText = this.prepareContextForCompression(contextData);
                const tokens = this.estimateTokenCount(contextText);
                return {
                    compressedContext: contextText,
                    originalTokens: tokens,
                    compressedTokens: tokens,
                    compressionRatio: 1.0,
                    strategy: 'disabled_by_config'
                };
            }
            
            // Check if the specific strategy is enabled
            const strategy = options.strategy || 'context_compression';
            const strategyEnabled = this.isOptimizationStrategyEnabled(mxpConfig, strategy);
            
            if (!strategyEnabled) {
                const contextText = this.prepareContextForCompression(contextData);
                const tokens = this.estimateTokenCount(contextText);
                return {
                    compressedContext: contextText,
                    originalTokens: tokens,
                    compressedTokens: tokens,
                    compressionRatio: 1.0,
                    strategy: `${strategy}_disabled`
                };
            }
            

            // Prepare context for compression
            const contextText = this.prepareContextForCompression(contextData);
            const originalTokens = this.estimateTokenCount(contextText);
            
            // Skip optimization for small contexts
            if (originalTokens < 500) {
                return {
                    compressedContext: contextText,
                    originalTokens,
                    compressedTokens: originalTokens,
                    compressionRatio: 1.0,
                    strategy: 'no_compression_needed'
                };
            }

            // Use existing conversation summary generation for intelligent compression
            const messagesForSummary = [{
                content: contextText,
                messageId: `context_${Date.now()}`,
                senderId: agentId,
                timestamp: Date.now()
            }];
            
            const compressionResult = await lastValueFrom(
                this.generateConversationSummary(messagesForSummary as any, {
                    channelName: `Channel ${channelId}`,
                    channelDescription: 'MXP Context Compression',
                    strategy: options.strategy || 'context_compression'
                })
            );

            const compressedContext = compressionResult.summary || contextText;
            const compressedTokens = this.estimateTokenCount(compressedContext);
            const actualCompressionRatio = compressedTokens / originalTokens;

            // Emit optimization event using basic event emission
            EventBus.server.emit(
                Events.Mxp.CONTEXT_COMPRESSED,
                {
                    agentId,
                    channelId,
                    originalTokens,
                    compressedTokens,
                    compressionRatio: actualCompressionRatio,
                    strategy: options.strategy || 'context_compression',
                    processingTimeMs: Date.now() - startTime,
                    timestamp: Date.now()
                }
            );


            return {
                compressedContext,
                originalTokens,
                compressedTokens,
                compressionRatio: actualCompressionRatio,
                strategy: options.strategy || 'context_compression'
            };

        } catch (error) {
            this.logger.error('MXP context optimization failed', { error: error instanceof Error ? error.message : String(error) });
            
            // Return original context on error
            const fallbackText = this.prepareContextForCompression(contextData);
            const fallbackTokens = this.estimateTokenCount(fallbackText);
            
            return {
                compressedContext: fallbackText,
                originalTokens: fallbackTokens,
                compressedTokens: fallbackTokens,
                compressionRatio: 1.0,
                strategy: 'compression_failed'
            };
        }
    }

    /**
     * Optimize prompts for token reduction while preserving functionality
     */
    public async optimizePromptForMxp(
        promptContent: string,
        options: {
            maxLength?: number;
            preserveInstructions?: boolean;
            strategy?: 'prompt_optimization';
        } = {}
    ): Promise<{
        optimizedPrompt: string;
        originalTokens: number;  
        optimizedTokens: number;
        tokenSavings: number;
    }> {
        const originalTokens = this.estimateTokenCount(promptContent);
        
        // Skip optimization for short prompts
        if (originalTokens < 100) {
            return {
                optimizedPrompt: promptContent,
                originalTokens,
                optimizedTokens: originalTokens,
                tokenSavings: 0
            };
        }

        try {
            // Use existing conversation summary for prompt optimization
            const messagesForOptimization = [{
                content: `OPTIMIZE_PROMPT: ${promptContent}`,
                messageId: `prompt_opt_${Date.now()}`,
                senderId: 'system',
                timestamp: Date.now()
            }];

            const optimizationResult = await lastValueFrom(
                this.generateConversationSummary(messagesForOptimization as any, {
                    channelName: 'Prompt Optimization',
                    channelDescription: 'MXP Prompt Token Reduction',
                    strategy: 'prompt_optimization'
                })
            );

            // Extract the optimized prompt from the summary
            const optimizedPrompt = optimizationResult.summary || promptContent;
            const optimizedTokens = this.estimateTokenCount(optimizedPrompt);
            const tokenSavings = Math.max(0, originalTokens - optimizedTokens);

            return {
                optimizedPrompt,
                originalTokens,
                optimizedTokens,
                tokenSavings
            };

        } catch (error) {
            this.logger.error('Prompt optimization failed', { error: error instanceof Error ? error.message : String(error) });
            return {
                optimizedPrompt: promptContent,
                originalTokens,
                optimizedTokens: originalTokens,
                tokenSavings: 0
            };
        }
    }

    /**
     * Prepare context data for compression analysis
     */
    private prepareContextForCompression(contextData: any): string {
        if (typeof contextData === 'string') {
            return contextData;
        }
        
        if (contextData?.conversationHistory) {
            return contextData.conversationHistory
                .map((msg: any) => `${msg.role}: ${msg.content}`)
                .join('\n');
        }
        
        return JSON.stringify(contextData, null, 2);
    }

    /**
     * Build context compression prompt using MXP strategies
     */
    private buildContextCompressionPrompt(contextText: string, options: any): string {
        const targetRatio = options.compressionRatio || 0.3;
        const targetPercentage = Math.round((1 - targetRatio) * 100);
        
        return `
            You are an expert at intelligent context compression for AI systems. Your task is to compress conversation context while preserving essential information.

            Compression Target: Reduce to ${targetRatio * 100}% of original size (${targetPercentage}% reduction)
            
            Strategy Guidelines:
            1. Preserve key decisions, outcomes, and action items
            2. Maintain entity relationships and important context  
            3. Remove redundant information and verbose explanations
            4. Keep critical technical details and specifications
            5. Summarize repetitive exchanges concisely
            
            Original Context:
            ${contextText}
            
            Provide a compressed version that maintains the essential information in ${targetRatio * 100}% of the original length:
        `;
    }

    /**
     * Estimate token count for text (simple approximation)
     */
    private estimateTokenCount(text: string): number {
        // Simple token estimation: ~4 characters per token on average
        return Math.ceil(text.length / 4);
    }

    /**
     * Check if a specific optimization strategy is enabled in MXP configuration
     */
    private isOptimizationStrategyEnabled(mxpConfig: any, strategy: string): boolean {
        if (!mxpConfig?.modules?.tokenOptimization) {
            return true; // Default to enabled if no config
        }

        const tokenConfig = mxpConfig.modules.tokenOptimization;

        // Check granular strategy settings
        if (tokenConfig.strategies) {
            switch (strategy) {
                case 'context_compression':
                    return tokenConfig.strategies.contextCompression ?? true;
                case 'conversation_summarization':
                    return tokenConfig.strategies.conversationSummarization ?? true;
                case 'prompt_optimization':
                    return tokenConfig.strategies.promptOptimization ?? true;
                case 'template_matching':
                    return tokenConfig.strategies.templateMatching ?? false;
                case 'entity_deduplication':
                    return tokenConfig.strategies.entityDeduplication ?? false;
                case 'tool_schema_reduction':
                    return tokenConfig.strategies.toolSchemaReduction ?? false;
                default:
                    return true;
            }
        }

        return true; // Default to enabled if no specific configuration
    }

    /**
     * Generate embeddings for text using configured LLM provider
     * Respects SYSTEMLLM_PROVIDER setting (OpenRouter, OpenAI, Azure, etc.)
     *
     * @param text Text to generate embedding for
     * @param options Optional configuration
     * @returns Promise resolving to embedding vector
     */
    public async generateEmbedding(
        text: string,
        options?: {
            model?: string;
            dimensions?: number;
        }
    ): Promise<number[]> {
        try {
            // Determine embedding model based on provider
            const embeddingModel = options?.model || this.getDefaultEmbeddingModel();
            const dimensions = options?.dimensions || 1536;


            // Get API configuration based on provider type
            let apiKey: string | undefined;
            let baseUrl: string | undefined;

            switch (this.providerType) {
                case LlmProviderType.OPENROUTER:
                    apiKey = process.env.OPENROUTER_API_KEY;
                    baseUrl = 'https://openrouter.ai/api/v1';
                    if (!apiKey || apiKey.trim() === '') {
                        throw new Error('OPENROUTER_API_KEY environment variable is not set or empty');
                    }
                    break;

                case LlmProviderType.AZURE_OPENAI:
                    apiKey = process.env.AZURE_OPENAI_API_KEY;
                    baseUrl = process.env.AZURE_OPENAI_ENDPOINT;
                    if (!apiKey || apiKey.trim() === '') {
                        throw new Error('AZURE_OPENAI_API_KEY environment variable is not set or empty');
                    }
                    if (!baseUrl || baseUrl.trim() === '') {
                        throw new Error('AZURE_OPENAI_ENDPOINT environment variable is not set or empty');
                    }
                    break;

                case LlmProviderType.OPENAI:
                    apiKey = process.env.OPENAI_API_KEY;
                    baseUrl = 'https://api.openai.com/v1';
                    if (!apiKey || apiKey.trim() === '') {
                        throw new Error('OPENAI_API_KEY environment variable is not set or empty');
                    }
                    break;

                default:
                    this.logger.warn(`Provider ${this.providerType} may not support embeddings directly, falling back to OpenAI API`);
                    apiKey = process.env.OPENAI_API_KEY;
                    baseUrl = 'https://api.openai.com/v1';
                    if (!apiKey || apiKey.trim() === '') {
                        throw new Error('OPENAI_API_KEY environment variable is not set or empty for embedding fallback');
                    }
                    break;
            }

            // Initialize provider client using the factory pattern
            const Implementation = LlmProviderFactory.getImplementation(this.providerType);
            const client = new Implementation();

            // Initialize with provider-specific config
            const initConfig: any = {
                apiKey: apiKey,
                maxTokens: this.config.defaultMaxTokens || 4096,
                temperature: this.config.defaultTemperature || 0.7
            };

            if (baseUrl) {
                initConfig.baseUrl = baseUrl;
            }

            // Add Azure-specific configuration
            if (this.providerType === LlmProviderType.AZURE_OPENAI) {
                initConfig.deploymentName = process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT || process.env.AZURE_OPENAI_DEPLOYMENT_NAME;
                initConfig.apiVersion = process.env.AZURE_OPENAI_API_VERSION || '2024-04-01-preview';
            }

            await client.initialize(initConfig);

            // Import OpenAI dynamically to access embeddings API
            const OpenAI = require('openai').default;
            const openaiClient = new OpenAI({
                apiKey: apiKey,
                baseURL: baseUrl
            });

            // Generate embedding
            const response = await openaiClient.embeddings.create({
                model: embeddingModel,
                input: text,
                dimensions
            });

            const embedding = response.data[0].embedding;

            return embedding;

        } catch (error) {
            //this.logger.error(`Embedding generation failed: ${error instanceof Error ? error.message : String(error)}`);
            throw new Error(`Failed to generate embedding: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Get default embedding model for current provider
     */
    private getDefaultEmbeddingModel(): string {
        switch (this.providerType) {
            case LlmProviderType.OPENROUTER:
                // OpenRouter proxies OpenAI embedding models
                return 'openai/text-embedding-3-small';
            case LlmProviderType.OPENAI:
                return 'text-embedding-3-small';
            case LlmProviderType.AZURE_OPENAI:
                return process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT || 'text-embedding-3-small';
            default:
                this.logger.warn(`No default embedding model for provider ${this.providerType}, using OpenAI default`);
                return 'text-embedding-3-small';
        }
    }
}
