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

import { EventBus } from '../../../shared/events/EventBus';
import { Events } from '../../../shared/events/EventNames';
import { SystemLlmService } from './SystemLlmService';
import { SystemLlmServiceManager } from './SystemLlmServiceManager';
import { Logger } from '../../../shared/utils/Logger';
import { createStrictValidator } from '../../../shared/utils/validation';
import { ControlLoopEvents } from '../../../shared/events/event-definitions/ControlLoopEvents';
import { MessageEvents } from '../../../shared/events/event-definitions/MessageEvents';
import { AgentEvents } from '../../../shared/events/event-definitions/AgentEvents';
import { ChannelMessage } from '../../../shared/schemas/MessageSchemas';
import { ChannelId, AgentId } from '../../../shared/types/ChannelContext';
import { ControlLoopEventPayload } from '../../../shared/schemas/EventPayloadSchema';
import { BaseEventPayload, MessageEventData } from '../../../shared/schemas/EventPayloadSchema';
import { AgentEventPayload } from '../../../shared/schemas/EventPayloadSchema';
import { SystemEvents } from '../../../shared/events/event-definitions/SystemEvents';

/**
 * Pattern detection interface for ephemeral event triggers
 */
interface DetectedPattern {
    type: 'similar_task' | 'tool_struggle' | 'coordination_opportunity' | 'expertise_sharing' | 'workload_imbalance';
    confidence: number;
    channelId: ChannelId;
    triggerAgentId?: AgentId;
    relatedAgents?: AgentId[];
    context: {
        description: string;
        suggestedAction: string;
        urgency: 'low' | 'medium' | 'high';
    };
}

/**
 * Agent activity tracking for pattern analysis
 */
interface AgentActivity {
    agentId: AgentId;
    channelId: ChannelId;
    lastSeen: number;
    currentOraprPhase?: 'observation' | 'reasoning' | 'planning' | 'action' | 'reflection';
    recentMessages: ChannelMessage[];
    toolUsage: string[];
    strugglingWith?: string;
    expertise?: string[];
}

/**
 * Service that detects patterns in agent behavior and triggers ephemeral events
 * for intelligent cross-agent coordination
 */
export class EphemeralEventPatternService {
    private static instance: EphemeralEventPatternService;
    private logger = new Logger('debug', 'EphemeralEventPatternService', 'server');
    private validator = createStrictValidator('EphemeralEventPatternService');
    
    // Pattern detection state
    private agentActivities = new Map<AgentId, AgentActivity>();
    private recentPatterns = new Map<string, number>(); // Pattern ID -> timestamp to prevent spam
    private isInitialized = false;
    
    // Configuration
    private readonly PATTERN_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes cooldown between similar patterns
    private readonly MAX_RECENT_MESSAGES = 10;
    private readonly SIMILARITY_THRESHOLD = 0.7;

    private constructor() {
        // Removed SystemLlmService - now uses fallback heuristics for pattern analysis
    }

    public static getInstance(): EphemeralEventPatternService {
        if (!EphemeralEventPatternService.instance) {
            EphemeralEventPatternService.instance = new EphemeralEventPatternService();
        }
        return EphemeralEventPatternService.instance;
    }

    /**
     * Initialize the service and set up event listeners
     */
    public async initialize(): Promise<void> {
        
        // Removed SystemLlmService validation - now uses fallback heuristics

        // Set up event listeners
        this.setupControlLoopListeners();
        this.setupMessageListeners();  
        this.setupAgentListeners();

    }

    /**
     * Initialize pattern detection by setting up event listeners
     */
    private setupEventListeners(): void {
        if (this.isInitialized) {
            return;
        }

        // Listen to Control Loop events for ORPAR phase transitions
        this.setupControlLoopListeners();
        
        // Listen to Message events for communication patterns
        this.setupMessageListeners();
        
        // Listen to Agent events for activity tracking
        this.setupAgentListeners();

        this.isInitialized = true;
    }

    /**
     * Set up control loop event listeners for ORPAR transitions
     */
    private setupControlLoopListeners(): void {
        // Reasoning phase - check for coordination opportunities
        EventBus.server.on(ControlLoopEvents.REASONING, async (payload: ControlLoopEventPayload) => {
            try {
                const { agentId, channelId } = payload;
                this.validator.assertIsNonEmptyString(agentId, 'agentId is required');
                this.validator.assertIsNonEmptyString(channelId, 'channelId is required');

                await this.updateAgentActivity(agentId, channelId, 'reasoning');
                await this.detectOraprTransitionPatterns(agentId, channelId, 'pre_reasoning');
                
            } catch (error) {
                this.logger.error(`Error handling reasoning event: ${error}`);
            }
        });

        // Planning phase - suggest collaboration
        EventBus.server.on(ControlLoopEvents.PLAN, async (payload: ControlLoopEventPayload) => {
            try {
                const { agentId, channelId } = payload;
                this.validator.assertIsNonEmptyString(agentId, 'agentId is required');
                this.validator.assertIsNonEmptyString(channelId, 'channelId is required');

                await this.updateAgentActivity(agentId, channelId, 'planning');
                await this.detectWorkloadPatterns(channelId);
                
            } catch (error) {
                this.logger.error(`Error handling planning event: ${error}`);
            }
        });

        // Action phase - check for tool expertise sharing
        EventBus.server.on(ControlLoopEvents.ACTION, async (payload: ControlLoopEventPayload) => {
            try {
                const { agentId, channelId } = payload;
                this.validator.assertIsNonEmptyString(agentId, 'agentId is required');
                this.validator.assertIsNonEmptyString(channelId, 'channelId is required');

                await this.updateAgentActivity(agentId, channelId, 'action');
                await this.detectOraprTransitionPatterns(agentId, channelId, 'post_action');
                
            } catch (error) {
                this.logger.error(`Error handling action event: ${error}`);
            }
        });

        // Error events - detect struggle patterns
        EventBus.server.on(ControlLoopEvents.ERROR, async (payload: ControlLoopEventPayload) => {
            try {
                const { agentId, channelId } = payload;
                if (agentId && channelId) {
                    await this.detectStrugglePatterns(agentId, channelId, payload.data?.error);
                }
            } catch (error) {
                this.logger.error(`Error handling control loop error event: ${error}`);
            }
        });
    }

    /**
     * Set up message event listeners for communication pattern analysis
     */
    private setupMessageListeners(): void {
        // Channel messages - analyze content for patterns
        EventBus.server.on(MessageEvents.CHANNEL_MESSAGE, async (payload: BaseEventPayload<MessageEventData>) => {
            try {
                const message = payload.data?.message as ChannelMessage;
                if (!message) {
                    //;
                    return;
                }

                const { agentId, channelId } = payload;
                
                this.validator.assertIsNonEmptyString(agentId, 'agentId is required');
                this.validator.assertIsNonEmptyString(channelId, 'channelId is required');

                // Update agent activity with message content
                await this.updateAgentActivityWithMessage(agentId, channelId, message);
                
                // Analyze message for patterns
                await this.analyzeMessagePatterns(agentId, channelId, message);
                
                
                // Trigger workload pattern detection periodically
                if (Math.random() < 0.1) { // 10% chance to trigger analysis
                    await this.detectWorkloadPatterns(channelId);
                }
            } catch (error) {
                this.logger.error(`Error analyzing message patterns: ${error}`);
            }
        });
    }

    /**
     * Set up agent event listeners for connection tracking
     */
    private setupAgentListeners(): void {
        // Agent connected - initialize activity tracking
        EventBus.server.on(AgentEvents.CONNECTED, async (payload: AgentEventPayload) => {
            try {
                const { agentId, channelId } = payload;                
                if (agentId && channelId) {
                    await this.initializeAgentActivity(agentId, channelId);
                } else {
                    this.logger.warn(`⚠️ Invalid agent connection payload: agentId=${agentId}, channelId=${channelId}`);
                }
            } catch (error) {
                this.logger.error(`Error handling agent connection: ${error}`);
            }
        });

        // Agent disconnected - clean up activity tracking
        EventBus.server.on(AgentEvents.DISCONNECTED, async (payload: AgentEventPayload) => {
            try {
                const { agentId } = payload;
                //;
                
                if (agentId) {
                    const wasTracked = this.agentActivities.has(agentId);
                    this.agentActivities.delete(agentId);
                } else {
                    this.logger.warn(`⚠️ Invalid agent disconnection payload: agentId=${agentId}`);
                }
            } catch (error) {
                this.logger.error(`Error handling agent disconnection: ${error}`);
            }
        });
    }

    /**
     * Detect patterns during ORPAR phase transitions
     */
    private async detectOraprTransitionPatterns(
        agentId: AgentId, 
        channelId: ChannelId, 
        trigger: 'pre_reasoning' | 'post_action'
    ): Promise<void> {
        const patterns = await this.findSimilarTaskPatterns(agentId, channelId);
        
        for (const pattern of patterns) {
            if (this.shouldTriggerPattern(pattern)) {
                await this.generateEphemeralEvent(pattern, trigger);
            }
        }
    }

    /**
     * Detect workload imbalance patterns
     */
    private async detectWorkloadPatterns(channelId: ChannelId): Promise<void> {
        const channelAgents = Array.from(this.agentActivities.values())
            .filter(activity => activity.channelId === channelId);


        if (channelAgents.length <= 1) {
            return;
        }

        // Check for workload imbalance - use 2 minutes for responsiveness (was 10 minutes)
        const activeAgents = channelAgents.filter(a => {
            const timeSinceLastSeen = Date.now() - a.lastSeen;
            const isActive = timeSinceLastSeen < 2 * 60 * 1000; // Active in last 2 minutes
            return isActive;
        });


        if (activeAgents.length >= 2) {
            const pattern: DetectedPattern = {
                type: 'workload_imbalance',
                confidence: 0.8,
                channelId,
                relatedAgents: activeAgents.map(a => a.agentId),
                context: {
                    description: `${activeAgents.length} agents active simultaneously in channel`,
                    suggestedAction: 'Consider coordinating tasks to avoid duplication',
                    urgency: 'medium'
                }
            };


            if (this.shouldTriggerPattern(pattern)) {
                await this.generateEphemeralEvent(pattern, 'high_activity');
            }
        } else {
        }
    }

    /**
     * Detect struggle patterns when agents encounter errors
     */
    private async detectStrugglePatterns(
        agentId: AgentId, 
        channelId: ChannelId, 
        errorMessage?: string
    ): Promise<void> {
        const activity = this.agentActivities.get(agentId);
        if (!activity) return;

        // Update struggle context
        activity.strugglingWith = errorMessage || 'Unknown error';

        // Look for agents with relevant expertise
        const expertsInChannel = Array.from(this.agentActivities.values())
            .filter(a => 
                a.channelId === channelId && 
                a.agentId !== agentId &&
                a.expertise && a.expertise.length > 0
            );

        if (expertsInChannel.length > 0) {
            const pattern: DetectedPattern = {
                type: 'expertise_sharing',
                confidence: 0.9,
                channelId,
                triggerAgentId: agentId,
                relatedAgents: expertsInChannel.map(e => e.agentId),
                context: {
                    description: `Agent struggling with task, experts available in channel`,
                    suggestedAction: 'Share expertise or coordinate assistance',
                    urgency: 'high'
                }
            };

            if (this.shouldTriggerPattern(pattern)) {
                await this.generateEphemeralEvent(pattern, 'conflict_detected');
            }
        }
    }

    /**
     * Analyze message content for patterns
     */
    private async analyzeMessagePatterns(
        agentId: AgentId, 
        channelId: ChannelId, 
        message: ChannelMessage
    ): Promise<void> {
        // Extract string content from ContentWrapper
        const content = typeof message.content?.data === 'string' 
            ? message.content.data.toLowerCase() 
            : String(message.content?.data || '').toLowerCase();
        
        // Detect tool usage patterns
        const toolAnalysis = await this.analyzeToolUsagePatterns(content, agentId);
        if (toolAnalysis.toolsUsed.length > 0) {
            await this.updateAgentToolUsage(agentId, toolAnalysis.toolsUsed);
        }

        // Detect struggle indicators
        const struggleKeywords = ['help', 'stuck', 'error', 'failed', 'struggling', 'confused'];
        if (struggleKeywords.some(keyword => content.includes(keyword))) {
            await this.detectStrugglePatterns(agentId, channelId, content);
        }

        // Detect coordination requests
        const coordKeywords = ['coordinate', 'together', 'collaborate', 'share', 'work with'];
        if (coordKeywords.some(keyword => content.includes(keyword))) {
            const pattern: DetectedPattern = {
                type: 'coordination_opportunity',
                confidence: 0.8,
                channelId,
                triggerAgentId: agentId,
                context: {
                    description: 'Agent explicitly requesting coordination',
                    suggestedAction: 'Facilitate multi-agent collaboration',
                    urgency: 'medium'
                }
            };


            if (this.shouldTriggerPattern(pattern)) {
                await this.generateEphemeralEvent(pattern, 'pattern_recognized');
            }
        }
    }

    /**
     * Find similar task patterns across agents
     */
    private async findSimilarTaskPatterns(agentId: AgentId, channelId: ChannelId): Promise<DetectedPattern[]> {
        const patterns: DetectedPattern[] = [];
        const currentActivity = this.agentActivities.get(agentId);
        if (!currentActivity) return patterns;

        // Find other agents in the same channel
        const otherAgents = Array.from(this.agentActivities.values())
            .filter(activity => 
                activity.channelId === channelId && 
                activity.agentId !== agentId &&
                activity.recentMessages.length > 0
            );

        for (const otherActivity of otherAgents) {
            const similarity = this.calculateTaskSimilarity(currentActivity, otherActivity);
            
            if (similarity > this.SIMILARITY_THRESHOLD) {
                patterns.push({
                    type: 'similar_task',
                    confidence: similarity,
                    channelId,
                    triggerAgentId: agentId,
                    relatedAgents: [otherActivity.agentId],
                    context: {
                        description: `Agent ${otherActivity.agentId} working on similar task`,
                        suggestedAction: 'Consider coordination or knowledge sharing',
                        urgency: 'medium'
                    }
                });
            }
        }

        return patterns;
    }

    /**
     * Calculate task similarity between two agents based on their recent activity
     */
    private calculateTaskSimilarity(activity1: AgentActivity, activity2: AgentActivity): number {
        // Simple similarity calculation based on tool usage and message content
        const tools1 = new Set(activity1.toolUsage);
        const tools2 = new Set(activity2.toolUsage);
        
        const commonTools = new Set([...tools1].filter(tool => tools2.has(tool)));
        const toolSimilarity = commonTools.size / Math.max(tools1.size, tools2.size, 1);

        // Message content similarity (simplified)
        const messages1 = activity1.recentMessages.map(m => {
            const content = typeof m.content?.data === 'string' 
                ? m.content.data 
                : String(m.content?.data || '');
            return content.toLowerCase();
        }).join(' ');
        const messages2 = activity2.recentMessages.map(m => {
            const content = typeof m.content?.data === 'string' 
                ? m.content.data 
                : String(m.content?.data || '');
            return content.toLowerCase();
        }).join(' ');
        
        const words1 = new Set(messages1.split(/\s+/).filter(w => w.length > 3));
        const words2 = new Set(messages2.split(/\s+/).filter(w => w.length > 3));
        
        const commonWords = new Set([...words1].filter(word => words2.has(word)));
        const wordSimilarity = commonWords.size / Math.max(words1.size, words2.size, 1);

        return (toolSimilarity * 0.6 + wordSimilarity * 0.4);
    }

    /**
     * Analyze message content for tool usage patterns
     * Uses fallback heuristic analysis (SystemLLM analysis removed)
     */
    private async analyzeToolUsagePatterns(content: string, agentId: AgentId): Promise<{
        toolsUsed: string[];
        strugglingWith: string[];
        expertiseAreas: string[];
        confidence: number;
    }> {
        // Use heuristic analysis instead of SystemLLM to avoid global instance creation
        return this.fallbackToolAnalysis(content);
    }

    /**
     * Analyze coordination opportunities using per-channel SystemLLM instance
     */
    private async analyzeCoordinationOpportunities(
        recentMessages: string[],
        channelId: ChannelId,
        agentActivities: string[]
    ): Promise<{
        opportunities: string[];
        urgency: 'low' | 'medium' | 'high';
        recommendedActions: string[];
        confidence: number;
    }> {
        try {
            // Get per-channel SystemLlmService instance
            const systemLlm = SystemLlmServiceManager.getInstance().getServiceForChannel(channelId);
            if (!systemLlm) {
                this.logger.warn(`No SystemLLM available for channel ${channelId}, using fallback`);
                return this.fallbackCoordinationAnalysis();
            }
            
            const coordinationPrompt = `Analyze agent coordination opportunities in this channel:

Channel ID: ${channelId}
Recent Messages: ${recentMessages.slice(-5).join(' | ')}
Agent Activities: ${agentActivities.join(' | ')}

Please analyze:
1. What coordination opportunities exist between agents?
2. How urgent is coordination needed (low/medium/high)?
3. What specific actions would improve coordination?
4. How confident are you in this analysis (0.0-1.0)?

Consider:
- Duplicate work detection
- Complementary skills identification
- Resource sharing opportunities
- Knowledge transfer needs

Respond with JSON format:
{
    "opportunities": ["opportunity1", "opportunity2"],
    "urgency": "medium",
    "recommendedActions": ["action1", "action2"],
    "confidence": 0.7
}`;

            // Use SystemLLM to analyze coordination opportunities
            const analysis = await systemLlm.sendLlmRequest(coordinationPrompt, null, {
                model: systemLlm.getModelForOperation('reasoning'),
                maxTokens: 400
            });

            // Parse LLM response with fallback
            try {
                const result = JSON.parse(analysis);
                return {
                    opportunities: Array.isArray(result.opportunities) ? result.opportunities : [],
                    urgency: ['low', 'medium', 'high'].includes(result.urgency) ? result.urgency : 'medium',
                    recommendedActions: Array.isArray(result.recommendedActions) ? result.recommendedActions : [],
                    confidence: typeof result.confidence === 'number' ? result.confidence : 0.5
                };
            } catch (parseError) {
                this.logger.warn(`Failed to parse SystemLLM coordination analysis: ${parseError}`);
                return this.fallbackCoordinationAnalysis();
            }

        } catch (error) {
            this.logger.error(`SystemLLM coordination analysis failed: ${error}`);
            return this.fallbackCoordinationAnalysis();
        }
    }

    /**
     * Analyze activity patterns using per-channel SystemLLM instance
     */
    private async analyzeActivityPatterns(
        channelId: ChannelId,
        recentActivity: string[]
    ): Promise<{
        patterns: string[];
        anomalies: string[];
        insights: string[];
        confidence: number;
    }> {
        try {
            // Get per-channel SystemLlmService instance
            const systemLlm = SystemLlmServiceManager.getInstance().getServiceForChannel(channelId);
            if (!systemLlm) {
                this.logger.warn(`No SystemLLM available for channel ${channelId}, using fallback`);
                return this.fallbackActivityAnalysis();
            }
            
            const activityPrompt = `Analyze agent activity patterns in this channel:

Channel ID: ${channelId}
Recent Activity: ${recentActivity.slice(-10).join(' | ')}

Please analyze:
1. What patterns do you see in agent activities?
2. Are there any anomalies or unusual behaviors?
3. What insights can help improve agent coordination?
4. How confident are you in this analysis (0.0-1.0)?

Consider:
- Timing patterns
- Tool usage patterns
- Communication patterns
- Work distribution patterns

Respond with JSON format:
{
    "patterns": ["pattern1", "pattern2"],
    "anomalies": ["anomaly1", "anomaly2"],
    "insights": ["insight1", "insight2"],
    "confidence": 0.8
}`;

            // Use SystemLLM to analyze activity patterns
            const analysis = await systemLlm.sendLlmRequest(activityPrompt, null, {
                model: systemLlm.getModelForOperation('reasoning'),
                maxTokens: 400
            });

            // Parse LLM response with fallback
            try {
                const result = JSON.parse(analysis);
                return {
                    patterns: Array.isArray(result.patterns) ? result.patterns : [],
                    anomalies: Array.isArray(result.anomalies) ? result.anomalies : [],
                    insights: Array.isArray(result.insights) ? result.insights : [],
                    confidence: typeof result.confidence === 'number' ? result.confidence : 0.5
                };
            } catch (parseError) {
                this.logger.warn(`Failed to parse SystemLLM activity analysis: ${parseError}`);
                return this.fallbackActivityAnalysis();
            }

        } catch (error) {
            this.logger.error(`SystemLLM activity analysis failed: ${error}`);
            return this.fallbackActivityAnalysis();
        }
    }

    /**
     * Fallback tool analysis when SystemLLM is unavailable
     */
    private fallbackToolAnalysis(content: string): {
        toolsUsed: string[];
        strugglingWith: string[];
        expertiseAreas: string[];
        confidence: number;
    } {
        // Basic regex patterns as fallback
        const toolPatterns = [
            { pattern: /calculator|calculate|math/gi, tool: 'calculator' },
            { pattern: /file|read|write|save/gi, tool: 'file_operations' },
            { pattern: /memory|remember|store/gi, tool: 'memory' },
            { pattern: /search|find|query/gi, tool: 'search' },
            { pattern: /git|repository|commit/gi, tool: 'git' },
            { pattern: /time|timezone|date/gi, tool: 'time' }
        ];

        const strugglingPatterns = [
            { pattern: /error|failed|struggling|help|stuck/gi, issue: 'general_difficulty' },
            { pattern: /don't know|unsure|confused/gi, issue: 'knowledge_gap' }
        ];

        const toolsUsed = toolPatterns
            .filter(({ pattern }) => pattern.test(content))
            .map(({ tool }) => tool);

        const strugglingWith = strugglingPatterns
            .filter(({ pattern }) => pattern.test(content))
            .map(({ issue }) => issue);

        return {
            toolsUsed,
            strugglingWith,
            expertiseAreas: [], // Cannot determine expertise from simple patterns
            confidence: 0.3 // Low confidence for fallback analysis
        };
    }

    /**
     * Fallback coordination analysis when SystemLLM is unavailable
     */
    private fallbackCoordinationAnalysis(): {
        opportunities: string[];
        urgency: 'low' | 'medium' | 'high';
        recommendedActions: string[];
        confidence: number;
    } {
        return {
            opportunities: ['potential_collaboration'],
            urgency: 'medium',
            recommendedActions: ['monitor_activity'],
            confidence: 0.2 // Very low confidence for fallback
        };
    }

    /**
     * Fallback activity analysis when SystemLLM is unavailable
     */
    private fallbackActivityAnalysis(): {
        patterns: string[];
        anomalies: string[];
        insights: string[];
        confidence: number;
    } {
        return {
            patterns: ['standard_activity'],
            anomalies: [],
            insights: ['requires_deeper_analysis'],
            confidence: 0.2 // Very low confidence for fallback
        };
    }

    /**
     * Check if pattern should trigger an ephemeral event (prevents spam)
     */
    private shouldTriggerPattern(pattern: DetectedPattern): boolean {
        const patternKey = `${pattern.type}_${pattern.channelId}_${pattern.relatedAgents?.join('_') || ''}`;
        const lastTriggered = this.recentPatterns.get(patternKey);
        
        if (lastTriggered && Date.now() - lastTriggered < this.PATTERN_COOLDOWN_MS) {
            return false; // Still in cooldown period
        }

        return pattern.confidence >= 0.6; // Minimum confidence threshold
    }

    /**
     * Generate ephemeral event based on detected pattern
     */
    private async generateEphemeralEvent(
        pattern: DetectedPattern, 
        trigger: 'pre_reasoning' | 'post_action' | 'high_activity' | 'conflict_detected' | 'pattern_recognized'
    ): Promise<void> {
        try {
            // Map pattern type to injection type
            const injectionTypeMap = {
                'similar_task': 'coordination_hint',
                'tool_struggle': 'tool_suggestion',
                'coordination_opportunity': 'coordination_hint',
                'expertise_sharing': 'coordination_hint',
                'workload_imbalance': 'activity_alert'
            } as const;

            const injectionType = injectionTypeMap[pattern.type];
            
            // Get per-channel SystemLlmService instance
            const systemLlm = SystemLlmServiceManager.getInstance().getServiceForChannel(pattern.channelId);
            if (!systemLlm) {
                this.logger.warn(`No SystemLLM available for channel ${pattern.channelId}, skipping ephemeral event generation`);
                return;
            }
            
            // Generate ephemeral event using per-channel SystemLlmService
            const ephemeralEvent = await systemLlm.generateEphemeralEvent(
                pattern.channelId,
                trigger,
                injectionType,
                pattern.triggerAgentId
            );

            // Mark pattern as recently triggered
            const patternKey = `${pattern.type}_${pattern.channelId}_${pattern.relatedAgents?.join('_') || ''}`;
            this.recentPatterns.set(patternKey, Date.now());

            // Emit the ephemeral event
            EventBus.server.emit(SystemEvents.EPHEMERAL_INJECTION, ephemeralEvent);


        } catch (error) {
            this.logger.error(`Failed to generate ephemeral event for pattern ${pattern.type}: ${error}`);
        }
    }

    /**
     * Update agent activity tracking
     */
    private async updateAgentActivity(
        agentId: AgentId, 
        channelId: ChannelId, 
        oraprPhase: 'observation' | 'reasoning' | 'planning' | 'action' | 'reflection'
    ): Promise<void> {
        const existing = this.agentActivities.get(agentId);
        
        if (existing) {
            existing.lastSeen = Date.now();
            existing.currentOraprPhase = oraprPhase;
        } else {
            await this.initializeAgentActivity(agentId, channelId);
        }
    }

    /**
     * Update agent activity with message content
     */
    private async updateAgentActivityWithMessage(
        agentId: AgentId, 
        channelId: ChannelId, 
        message: ChannelMessage
    ): Promise<void> {
        const activity = this.agentActivities.get(agentId);
        
        if (activity) {
            activity.lastSeen = Date.now();
            activity.recentMessages.push(message);
            
            // Keep only recent messages
            if (activity.recentMessages.length > this.MAX_RECENT_MESSAGES) {
                activity.recentMessages = activity.recentMessages.slice(-this.MAX_RECENT_MESSAGES);
            }
        } else {
            await this.initializeAgentActivity(agentId, channelId);
        }
    }

    /**
     * Update agent tool usage tracking
     */
    private async updateAgentToolUsage(agentId: AgentId, tools: string[]): Promise<void> {
        const activity = this.agentActivities.get(agentId);
        if (activity) {
            activity.toolUsage.push(...tools);
            // Keep only recent tool usage
            if (activity.toolUsage.length > 20) {
                activity.toolUsage = activity.toolUsage.slice(-20);
            }
            
            // Update expertise based on tool usage patterns
            activity.expertise = [...new Set(activity.toolUsage)];
        }
    }

    /**
     * Initialize activity tracking for a new agent
     */
    private async initializeAgentActivity(agentId: AgentId, channelId: ChannelId): Promise<void> {
        this.agentActivities.set(agentId, {
            agentId,
            channelId,
            lastSeen: Date.now(),
            recentMessages: [],
            toolUsage: [],
            expertise: []
        });
    }

    /**
     * Get current agent activities (for debugging/monitoring)
     */
    public getAgentActivities(): Map<AgentId, AgentActivity> {
        return new Map(this.agentActivities);
    }

    /**
     * Cleanup old activities and patterns (should be called periodically)
     */
    public cleanup(): void {
        const now = Date.now();
        const inactivityThreshold = 60 * 60 * 1000; // 1 hour

        // Remove inactive agents
        for (const [agentId, activity] of this.agentActivities) {
            if (now - activity.lastSeen > inactivityThreshold) {
                this.agentActivities.delete(agentId);
            }
        }

        // Remove old patterns
        for (const [patternKey, timestamp] of this.recentPatterns) {
            if (now - timestamp > this.PATTERN_COOLDOWN_MS * 2) {
                this.recentPatterns.delete(patternKey);
            }
        }

    }
}
