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

import { EventBus } from '@mxf-dev/core/events/EventBus';
import { Events } from '@mxf-dev/core/events/EventNames';
import type { Subscription } from 'rxjs';
import { SystemLlmServiceManager } from './SystemLlmServiceManager';
import { Logger } from '@mxf-dev/core/utils/Logger';
import { createStrictValidator } from '@mxf-dev/core/utils/validation';
import { ControlLoopEvents } from '@mxf-dev/core/events/event-definitions/ControlLoopEvents';
import { MessageEvents } from '@mxf-dev/core/events/event-definitions/MessageEvents';
import { AgentEvents } from '@mxf-dev/core/events/event-definitions/AgentEvents';
import { ChannelMessage } from '@mxf-dev/core/schemas/MessageSchemas';
import { ChannelId, AgentId } from '@mxf-dev/core/types/ChannelContext';
import {
    BaseEventPayload,
    ControlLoopEventPayload,
    McpToolResultEventPayload,
    MessageEventData
} from '@mxf-dev/core/schemas/EventPayloadSchema';
import { AgentEventPayload } from '@mxf-dev/core/schemas/EventPayloadSchema';
import { SystemEvents } from '@mxf-dev/core/events/event-definitions/SystemEvents';

/**
 * Pattern detection interface for ephemeral event triggers
 */
interface DetectedPattern {
    type: 'similar_task' | 'coordination_opportunity';
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
    currentOrparPhase?: 'observation' | 'reasoning' | 'planning' | 'action' | 'reflection';
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
    private agentActivities = new Map<string, AgentActivity>();
    private recentPatterns = new Map<string, number>(); // Pattern ID -> timestamp to prevent spam
    private isInitialized = false;
    private eventSubscriptions: Subscription[] = [];
    
    // Configuration
    private readonly PATTERN_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes cooldown between similar patterns
    private readonly MAX_RECENT_MESSAGES = 10;
    private readonly SIMILARITY_THRESHOLD = 0.7;

    private constructor() {}

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
        this.setupEventListeners();
    }

    private activityKey(agentId: AgentId, channelId: ChannelId): string {
        return `${channelId}\0${agentId}`;
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

        // Record actual successful/failed tool executions, not message keywords.
        this.setupToolListeners();
        
        // Listen to Agent events for activity tracking
        this.setupAgentListeners();

        this.isInitialized = true;
    }

    /**
     * Set up control loop event listeners for ORPAR transitions
     */
    private setupControlLoopListeners(): void {
        // Reasoning phase - check for coordination opportunities
        this.eventSubscriptions.push(EventBus.server.on(ControlLoopEvents.REASONING, async (payload: ControlLoopEventPayload) => {
            try {
                const { agentId, channelId } = payload;
                this.validator.assertIsNonEmptyString(agentId, 'agentId is required');
                this.validator.assertIsNonEmptyString(channelId, 'channelId is required');

                await this.updateAgentActivity(agentId, channelId, 'reasoning');
                await this.detectOrparTransitionPatterns(agentId, channelId, 'pre_reasoning');
                
            } catch (error) {
                this.logger.error(`Error handling reasoning event: ${error}`);
            }
        }));

        // Planning phase - suggest collaboration
        this.eventSubscriptions.push(EventBus.server.on(ControlLoopEvents.PLAN, async (payload: ControlLoopEventPayload) => {
            try {
                const { agentId, channelId } = payload;
                this.validator.assertIsNonEmptyString(agentId, 'agentId is required');
                this.validator.assertIsNonEmptyString(channelId, 'channelId is required');

                await this.updateAgentActivity(agentId, channelId, 'planning');
            } catch (error) {
                this.logger.error(`Error handling planning event: ${error}`);
            }
        }));

        // Action phase - check for tool expertise sharing
        this.eventSubscriptions.push(EventBus.server.on(ControlLoopEvents.ACTION, async (payload: ControlLoopEventPayload) => {
            try {
                const { agentId, channelId } = payload;
                this.validator.assertIsNonEmptyString(agentId, 'agentId is required');
                this.validator.assertIsNonEmptyString(channelId, 'channelId is required');

                await this.updateAgentActivity(agentId, channelId, 'action');
                await this.detectOrparTransitionPatterns(agentId, channelId, 'post_action');
                
            } catch (error) {
                this.logger.error(`Error handling action event: ${error}`);
            }
        }));

        // Error events - detect struggle patterns
        this.eventSubscriptions.push(EventBus.server.on(ControlLoopEvents.ERROR, async (payload: ControlLoopEventPayload) => {
            try {
                const { agentId, channelId } = payload;
                if (agentId && channelId) {
                    await this.detectStrugglePatterns(agentId, channelId, payload.data?.error);
                }
            } catch (error) {
                this.logger.error(`Error handling control loop error event: ${error}`);
            }
        }));
    }

    /**
     * Set up message event listeners for communication pattern analysis
     */
    private setupMessageListeners(): void {
        // Channel messages - analyze content for patterns
        this.eventSubscriptions.push(EventBus.server.on(MessageEvents.CHANNEL_MESSAGE, async (payload: BaseEventPayload<MessageEventData>) => {
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
            } catch (error) {
                this.logger.error(`Error analyzing message patterns: ${error}`);
            }
        }));
    }

    private setupToolListeners(): void {
        this.eventSubscriptions.push(EventBus.server.on(
            Events.Mcp.TOOL_RESULT,
            async (payload: McpToolResultEventPayload) => {
                try {
                    const { agentId, channelId } = payload;
                    const toolName = payload.data?.toolName;
                    this.validator.assertIsNonEmptyString(agentId, 'agentId is required');
                    this.validator.assertIsNonEmptyString(channelId, 'channelId is required');
                    this.validator.assertIsNonEmptyString(toolName, 'toolName is required');
                    await this.updateAgentToolUsage(agentId, channelId, [toolName]);
                } catch (error) {
                    this.logger.error(`Error recording MCP tool activity: ${error}`);
                }
            }
        ));
    }

    /**
     * Set up agent event listeners for connection tracking
     */
    private setupAgentListeners(): void {
        // Agent connected - initialize activity tracking
        this.eventSubscriptions.push(EventBus.server.on(AgentEvents.CONNECTED, async (payload: AgentEventPayload) => {
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
        }));

        // Agent disconnected - clean up activity tracking
        this.eventSubscriptions.push(EventBus.server.on(AgentEvents.DISCONNECTED, async (payload: AgentEventPayload) => {
            try {
                const { agentId, channelId } = payload;
                //;
                
                if (agentId && channelId) {
                    this.agentActivities.delete(this.activityKey(agentId, channelId));
                } else {
                    this.logger.warn(`⚠️ Invalid agent disconnection payload: agentId=${agentId}`);
                }
            } catch (error) {
                this.logger.error(`Error handling agent disconnection: ${error}`);
            }
        }));
    }

    /**
     * Detect patterns during ORPAR phase transitions
     */
    private async detectOrparTransitionPatterns(
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
     * Detect struggle patterns when agents encounter errors
     */
    private async detectStrugglePatterns(
        agentId: AgentId, 
        channelId: ChannelId, 
        errorMessage?: string
    ): Promise<void> {
        const activity = this.agentActivities.get(this.activityKey(agentId, channelId));
        if (!activity) return;

        // Update struggle context
        activity.strugglingWith = errorMessage || 'Unknown error';

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
        const currentActivity = this.agentActivities.get(this.activityKey(agentId, channelId));
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
        trigger: 'pre_reasoning' | 'post_action' | 'pattern_recognized'
    ): Promise<void> {
        try {
            // Map pattern type to injection type
            const injectionTypeMap = {
                'similar_task': 'coordination_hint',
                'coordination_opportunity': 'coordination_hint'
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
        orparPhase: 'observation' | 'reasoning' | 'planning' | 'action' | 'reflection'
    ): Promise<void> {
        const existing = this.agentActivities.get(this.activityKey(agentId, channelId));

        if (existing) {
            existing.lastSeen = Date.now();
            existing.currentOrparPhase = orparPhase;
        } else {
            await this.initializeAgentActivity(agentId, channelId);
            const initialized = this.agentActivities.get(this.activityKey(agentId, channelId));
            if (!initialized) {
                throw new Error(`Failed to initialize activity for ${agentId} in ${channelId}`);
            }
            initialized.currentOrparPhase = orparPhase;
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
        const activity = this.agentActivities.get(this.activityKey(agentId, channelId));
        
        if (activity) {
            activity.lastSeen = Date.now();
            activity.recentMessages.push(message);
            
            // Keep only recent messages
            if (activity.recentMessages.length > this.MAX_RECENT_MESSAGES) {
                activity.recentMessages = activity.recentMessages.slice(-this.MAX_RECENT_MESSAGES);
            }
        } else {
            await this.initializeAgentActivity(agentId, channelId);
            const initialized = this.agentActivities.get(this.activityKey(agentId, channelId));
            if (!initialized) {
                throw new Error(`Failed to initialize activity for ${agentId} in ${channelId}`);
            }
            initialized.recentMessages.push(message);
        }
    }

    /**
     * Update agent tool usage tracking
     */
    private async updateAgentToolUsage(
        agentId: AgentId,
        channelId: ChannelId,
        tools: string[]
    ): Promise<void> {
        const activity = this.agentActivities.get(this.activityKey(agentId, channelId));
        if (activity) {
            activity.toolUsage.push(...tools);
            // Keep only recent tool usage
            if (activity.toolUsage.length > 20) {
                activity.toolUsage = activity.toolUsage.slice(-20);
            }
            
            // Update expertise based on tool usage patterns
            activity.expertise = [...new Set(activity.toolUsage)];
            return;
        }

        await this.initializeAgentActivity(agentId, channelId);
        const initialized = this.agentActivities.get(this.activityKey(agentId, channelId));
        if (!initialized) {
            throw new Error(`Failed to initialize activity for ${agentId} in ${channelId}`);
        }
        initialized.toolUsage.push(...tools);
        initialized.expertise = [...new Set(initialized.toolUsage)];
    }

    /**
     * Initialize activity tracking for a new agent
     */
    private async initializeAgentActivity(agentId: AgentId, channelId: ChannelId): Promise<void> {
        this.agentActivities.set(this.activityKey(agentId, channelId), {
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
    public getAgentActivities(): Map<string, AgentActivity> {
        return new Map(this.agentActivities);
    }

    /** Release every listener and all process-local pattern state. */
    public shutdown(): void {
        for (const subscription of this.eventSubscriptions) {
            subscription.unsubscribe();
        }
        this.eventSubscriptions = [];
        this.agentActivities.clear();
        this.recentPatterns.clear();
        this.isInitialized = false;
    }

    /**
     * Cleanup old activities and patterns (should be called periodically)
     */
    public cleanup(): void {
        const now = Date.now();
        const inactivityThreshold = 60 * 60 * 1000; // 1 hour

        // Remove inactive agents
        for (const [activityKey, activity] of this.agentActivities) {
            if (now - activity.lastSeen > inactivityThreshold) {
                this.agentActivities.delete(activityKey);
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
