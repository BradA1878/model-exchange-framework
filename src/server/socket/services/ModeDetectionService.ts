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
 * Priority 6: Mode Detection and Adaptive SystemLLM Behavior
 * 
 * Detects agent operating modes and adapts SystemLLM interpretation strategies:
 * - Task Execution Mode: Expects mainly tool calls, minimal interpretation
 * - Coordination Mode: Expects mix of tools and natural language
 * - Parallel Work Mode: Expects context updates, minimal interpretation needed
 */

import { Logger } from '../../../shared/utils/Logger';
import { createStrictValidator } from '../../../shared/utils/validation';
import { EventBus } from '../../../shared/events/EventBus';
import { AgentEvents, MessageEvents, SystemEvents } from '../../../shared/events/EventNames';
// ActionHistoryService removed - action history tracking moved to SDK side for proper client/server separation
// Local interface for basic action history data structure needed for mode detection
interface ActionHistoryEntry {
    id: string;
    agentId: string;
    channelId: string;
    timestamp: number;
    type: string;
    action: string;
    details: any;
    result?: any;
    executionTimeMs?: number;
}

const logger = new Logger('info', 'ModeDetectionService', 'server');
const validator = createStrictValidator('ModeDetectionService');

export enum OperatingMode {
    TASK_EXECUTION = 'task_execution',
    COORDINATION = 'coordination', 
    PARALLEL_WORK = 'parallel_work',
    DISCOVERY = 'discovery',
    PLANNING = 'planning'
}

export interface ModeContext {
    mode: OperatingMode;
    confidence: number;
    reasoning: string;
    adaptationStrategy: InterpretationStrategy;
    contextFactors: {
        recentToolCalls: number;
        recentMessages: number;
        recentContextUpdates: number;
        activeAgentCount: number;
        taskComplexity: 'low' | 'medium' | 'high';
        coordinationLevel: 'none' | 'light' | 'heavy';
    };
}

export interface InterpretationStrategy {
    preferNaturalLanguage: boolean;
    interpretationTimeout: number;
    confidenceThreshold: number;
    fallbackToToolCall: boolean;
    logIntermediateSteps: boolean;
    injectGuidance: boolean;
    guidanceMessage?: string;
}

export class ModeDetectionService {
    private logger = logger;
    private eventBus = EventBus.server;
    
    // Mode tracking per channel
    private channelModes = new Map<string, ModeContext>();
    
    // Mode detection configuration
    private config = {
        analysisWindowMinutes: 10,
        modeConfidenceThreshold: 0.7,
        adaptationUpdateInterval: 30000, // 30 seconds
        taskExecutionToolCallRatio: 0.8, // 80% tool calls = task mode
        coordinationMessageRatio: 0.4,   // 40% messages = coordination mode
        parallelWorkContextRatio: 0.6    // 60% context updates = parallel mode
    };

    constructor() {
        this.initializeEventListeners();
        this.startPeriodicModeAnalysis();
    }

    /**
     * Initialize event listeners for mode detection
     */
    private initializeEventListeners(): void {
        // Listen for agent activities to trigger mode reassessment
        // Note: These events would need to be added to AgentEvents if they don't exist
        this.eventBus.on(AgentEvents.AGENT_MESSAGE, (data: any) => {
            this.triggerModeReassessment(data.channelId);
        });

        // TODO: Add TOOL_CALL and CONTEXT_UPDATE to AgentEvents constants if they don't exist
        this.eventBus.on(AgentEvents.TOOL_CALL, (data: any) => {
            this.triggerModeReassessment(data.channelId);
        });

        this.eventBus.on(AgentEvents.CONTEXT_UPDATE, (data: any) => {
            this.triggerModeReassessment(data.channelId);
        });
    }

    /**
     * Detect operating mode for a channel based on recent activity
     */
    async detectMode(channelId: string, agentHistory?: ActionHistoryEntry[]): Promise<ModeContext> {
        try {
            validator.assertIsNonEmptyString(channelId, 'channelId');

            // Get recent channel activity if not provided
            const history = agentHistory || await this.getChannelActivity(channelId);
            
            // Analyze activity patterns
            const activityAnalysis = this.analyzeActivityPatterns(history);
            
            // Detect mode based on patterns
            const detectedMode = this.classifyMode(activityAnalysis);
            
            // Build interpretation strategy
            const adaptationStrategy = this.buildAdaptationStrategy(detectedMode, activityAnalysis);
            
            const modeContext: ModeContext = {
                mode: detectedMode.mode,
                confidence: detectedMode.confidence,
                reasoning: detectedMode.reasoning,
                adaptationStrategy,
                contextFactors: activityAnalysis
            };

            // Cache the detected mode
            this.channelModes.set(channelId, modeContext);
            
            
            return modeContext;

        } catch (error) {
            this.logger.error(`Failed to detect mode for channel ${channelId}: ${error}`);
            
            // Return default mode on error
            return {
                mode: OperatingMode.TASK_EXECUTION,
                confidence: 0.5,
                reasoning: 'Default mode due to detection error',
                adaptationStrategy: this.getDefaultStrategy(),
                contextFactors: this.getDefaultContextFactors()
            };
        }
    }

    /**
     * Get cached mode for channel or detect if not cached
     */
    async getChannelMode(channelId: string): Promise<ModeContext> {
        const cachedMode = this.channelModes.get(channelId);
        if (cachedMode) {
            return cachedMode;
        }
        
        return await this.detectMode(channelId);
    }

    /**
     * Adapt SystemLLM interpretation strategy based on detected mode
     */
    adaptInterpretationStrategy(mode: OperatingMode, response: string): InterpretationStrategy {
        const baseStrategies: Record<OperatingMode, InterpretationStrategy> = {
            [OperatingMode.TASK_EXECUTION]: {
                preferNaturalLanguage: false,
                interpretationTimeout: 200,
                confidenceThreshold: 0.8,
                fallbackToToolCall: true,
                logIntermediateSteps: false,
                injectGuidance: true,
                guidanceMessage: 'Focus on direct tool calls for fastest execution. Natural language may indicate confusion.'
            },
            
            [OperatingMode.COORDINATION]: {
                preferNaturalLanguage: true,
                interpretationTimeout: 500,
                confidenceThreshold: 0.6,
                fallbackToToolCall: false,
                logIntermediateSteps: true,
                injectGuidance: false
            },
            
            [OperatingMode.PARALLEL_WORK]: {
                preferNaturalLanguage: false,
                interpretationTimeout: 100,
                confidenceThreshold: 0.9,
                fallbackToToolCall: true,
                logIntermediateSteps: false,
                injectGuidance: false
            },
            
            [OperatingMode.DISCOVERY]: {
                preferNaturalLanguage: true,
                interpretationTimeout: 300,
                confidenceThreshold: 0.7,
                fallbackToToolCall: false,
                logIntermediateSteps: true,
                injectGuidance: true,
                guidanceMessage: 'Use agent_discover and context_read tools for information gathering.'
            },
            
            [OperatingMode.PLANNING]: {
                preferNaturalLanguage: true,
                interpretationTimeout: 400,
                confidenceThreshold: 0.6,
                fallbackToToolCall: false,
                logIntermediateSteps: true,
                injectGuidance: true,
                guidanceMessage: 'Use planning_create and planning_update_item tools for structured planning.'
            }
        };

        return baseStrategies[mode];
    }

    /**
     * Analyze activity patterns from channel history
     */
    private analyzeActivityPatterns(history: ActionHistoryEntry[]): ModeContext['contextFactors'] {
        if (history.length === 0) {
            return this.getDefaultContextFactors();
        }

        const cutoffTime = Date.now() - (this.config.analysisWindowMinutes * 60 * 1000);
        const recentHistory = history.filter(entry => entry.timestamp > cutoffTime);

        const toolCalls = recentHistory.filter(entry => entry.type === 'tool_call').length;
        const messages = recentHistory.filter(entry => 
            entry.type === 'message_sent' || entry.type === 'message_received'
        ).length;
        const contextUpdates = recentHistory.filter(entry => entry.type === 'context_update').length;
        
        const uniqueAgents = new Set(recentHistory.map(entry => entry.agentId)).size;
        
        // Determine task complexity based on tool diversity and coordination
        let taskComplexity: 'low' | 'medium' | 'high' = 'low';
        const toolTypes = new Set(recentHistory
            .filter(entry => entry.type === 'tool_call')
            .map(entry => entry.details?.toolName)
        ).size;
        
        if (toolTypes > 5 || uniqueAgents > 3) {
            taskComplexity = 'high';
        } else if (toolTypes > 2 || uniqueAgents > 1) {
            taskComplexity = 'medium';
        }

        // Determine coordination level
        let coordinationLevel: 'none' | 'light' | 'heavy' = 'none';
        const messageRatio = messages / Math.max(recentHistory.length, 1);
        
        if (messageRatio > 0.4) {
            coordinationLevel = 'heavy';
        } else if (messageRatio > 0.2) {
            coordinationLevel = 'light';
        }

        return {
            recentToolCalls: toolCalls,
            recentMessages: messages,
            recentContextUpdates: contextUpdates,
            activeAgentCount: uniqueAgents,
            taskComplexity,
            coordinationLevel
        };
    }

    /**
     * Classify mode based on activity analysis
     */
    private classifyMode(analysis: ModeContext['contextFactors']): { 
        mode: OperatingMode; 
        confidence: number; 
        reasoning: string; 
    } {
        const totalActivity = analysis.recentToolCalls + analysis.recentMessages + analysis.recentContextUpdates;
        
        if (totalActivity === 0) {
            return {
                mode: OperatingMode.TASK_EXECUTION,
                confidence: 0.5,
                reasoning: 'No recent activity, defaulting to task execution mode'
            };
        }

        const toolCallRatio = analysis.recentToolCalls / totalActivity;
        const messageRatio = analysis.recentMessages / totalActivity;
        const contextRatio = analysis.recentContextUpdates / totalActivity;

        // Task Execution Mode: High tool call ratio, low message ratio
        if (toolCallRatio >= this.config.taskExecutionToolCallRatio && 
            messageRatio < 0.3 && 
            analysis.coordinationLevel === 'none') {
            return {
                mode: OperatingMode.TASK_EXECUTION,
                confidence: 0.9,
                reasoning: `High tool call ratio (${(toolCallRatio * 100).toFixed(1)}%) with minimal coordination`
            };
        }

        // Coordination Mode: High message ratio, mixed activity
        if (messageRatio >= this.config.coordinationMessageRatio && 
            analysis.activeAgentCount > 1) {
            return {
                mode: OperatingMode.COORDINATION,
                confidence: 0.8,
                reasoning: `High message ratio (${(messageRatio * 100).toFixed(1)}%) with multiple agents (${analysis.activeAgentCount})`
            };
        }

        // Parallel Work Mode: High context update ratio
        if (contextRatio >= this.config.parallelWorkContextRatio) {
            return {
                mode: OperatingMode.PARALLEL_WORK,
                confidence: 0.7,
                reasoning: `High context update ratio (${(contextRatio * 100).toFixed(1)}%) indicating parallel work`
            };
        }

        // Discovery Mode: Mixed activity with discovery-related tools
        if (analysis.taskComplexity === 'high' && toolCallRatio > 0.5) {
            return {
                mode: OperatingMode.DISCOVERY,
                confidence: 0.6,
                reasoning: 'High task complexity with diverse tool usage suggesting discovery phase'
            };
        }

        // Planning Mode: High coordination with structured activity
        if (analysis.coordinationLevel === 'heavy' && analysis.taskComplexity === 'high') {
            return {
                mode: OperatingMode.PLANNING,
                confidence: 0.7,
                reasoning: 'Heavy coordination with high task complexity suggesting planning phase'
            };
        }

        // Default to task execution
        return {
            mode: OperatingMode.TASK_EXECUTION,
            confidence: 0.6,
            reasoning: 'Mixed activity patterns, defaulting to task execution mode'
        };
    }

    /**
     * Build adaptation strategy based on mode and context
     */
    private buildAdaptationStrategy(
        modeResult: { mode: OperatingMode; confidence: number; reasoning: string },
        analysis: ModeContext['contextFactors']
    ): InterpretationStrategy {
        const baseStrategy = this.adaptInterpretationStrategy(modeResult.mode, '');
        
        // Adjust strategy based on confidence and context factors
        if (modeResult.confidence < 0.7) {
            // Lower confidence means more conservative interpretation
            baseStrategy.confidenceThreshold = Math.min(baseStrategy.confidenceThreshold + 0.1, 0.9);
            baseStrategy.interpretationTimeout += 100;
        }

        if (analysis.taskComplexity === 'high') {
            baseStrategy.logIntermediateSteps = true;
            baseStrategy.interpretationTimeout += 100;
        }

        return baseStrategy;
    }

    /**
     * Helper methods
     */
    private async getChannelActivity(channelId: string): Promise<ActionHistoryEntry[]> {
        // In a real implementation, this would query the action history service
        // For now, return empty array as placeholder
        return [];
    }

    private triggerModeReassessment(channelId: string): void {
        // Remove cached mode to force reassessment on next request
        if (this.channelModes.has(channelId)) {
            this.channelModes.delete(channelId);
        }
    }

    private startPeriodicModeAnalysis(): void {
        setInterval(() => {
            this.performPeriodicModeAnalysis();
        }, this.config.adaptationUpdateInterval);
    }

    private async performPeriodicModeAnalysis(): Promise<void> {
        try {
            // Reassess modes for all active channels
            for (const channelId of this.channelModes.keys()) {
                await this.detectMode(channelId);
            }
        } catch (error) {
            this.logger.error(`Failed periodic mode analysis: ${error}`);
        }
    }

    private getDefaultStrategy(): InterpretationStrategy {
        return {
            preferNaturalLanguage: false,
            interpretationTimeout: 300,
            confidenceThreshold: 0.7,
            fallbackToToolCall: true,
            logIntermediateSteps: false,
            injectGuidance: false
        };
    }

    private getDefaultContextFactors(): ModeContext['contextFactors'] {
        return {
            recentToolCalls: 0,
            recentMessages: 0,
            recentContextUpdates: 0,
            activeAgentCount: 1,
            taskComplexity: 'low',
            coordinationLevel: 'none'
        };
    }

    /**
     * Get mode detection statistics for monitoring
     */
    getStatistics(): {
        totalChannels: number;
        modeDistribution: Record<OperatingMode, number>;
        averageConfidence: number;
    } {
        const modeDistribution: Record<OperatingMode, number> = {
            [OperatingMode.TASK_EXECUTION]: 0,
            [OperatingMode.COORDINATION]: 0,
            [OperatingMode.PARALLEL_WORK]: 0,
            [OperatingMode.DISCOVERY]: 0,
            [OperatingMode.PLANNING]: 0
        };

        let totalConfidence = 0;
        let channelCount = 0;

        for (const modeContext of this.channelModes.values()) {
            modeDistribution[modeContext.mode]++;
            totalConfidence += modeContext.confidence;
            channelCount++;
        }

        return {
            totalChannels: channelCount,
            modeDistribution,
            averageConfidence: channelCount > 0 ? totalConfidence / channelCount : 0
        };
    }

    // Singleton instance
    private static instance: ModeDetectionService | null = null;

    /**
     * Get the singleton instance of ModeDetectionService
     * @returns The mode detection service instance
     */
    public static getInstance(): ModeDetectionService {
        if (!ModeDetectionService.instance) {
            ModeDetectionService.instance = new ModeDetectionService();
        }
        return ModeDetectionService.instance;
    }
}
