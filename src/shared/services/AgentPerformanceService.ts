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
 * Agent Performance Service for Enhanced Agent Intelligence
 * Phase 2: Agent Performance Tracking and Optimization
 * 
 * Simplified version that integrates with existing MXF services
 */

import { Observable, BehaviorSubject, of, throwError } from 'rxjs';
import { v4 as uuidv4 } from 'uuid';

import { Logger } from '../utils/Logger';
import { AgentId } from '../types/Agent';
import { ChannelId } from '../types/ChannelContext';
import { 
    AgentPerformanceMetrics,
    OraprTimingMetrics,
    ToolUsageMetrics,
    CollaborationMetrics,
    AgentPerformanceAnalysis,
    PerformanceOptimizationSuggestion
} from '../types/AgentPerformanceTypes';
import { MemoryService } from './MemoryService';
import { EventBus } from '../events/EventBus';
import { Events } from '../events/EventNames';

/**
 * Simplified Agent Performance Service for within-channel performance tracking
 */
export class AgentPerformanceService {
    private readonly logger: Logger;
    private readonly memoryService: MemoryService;
    
    // In-memory cache for performance metrics
    private readonly performanceCache = new Map<string, AgentPerformanceMetrics>();
    
    // Timing tracking for ORPAR phases
    private readonly phaseStartTimes = new Map<string, number>();
    
    // Reactive subjects for real-time updates
    private readonly performanceUpdates$ = new BehaviorSubject<AgentPerformanceMetrics[]>([]);

    private constructor() {
        this.logger = new Logger('info', 'AgentPerformanceService', 'server');
        this.memoryService = MemoryService.getInstance();
        
        this.setupEventListeners();
    }

    /**
     * Get singleton instance
     */
    public static getInstance(): AgentPerformanceService {
        if (!AgentPerformanceService.instance) {
            AgentPerformanceService.instance = new AgentPerformanceService();
        }
        return AgentPerformanceService.instance;
    }

    private static instance: AgentPerformanceService;

    // =============================================================================
    // EVENT LISTENERS FOR PERFORMANCE TRACKING
    // =============================================================================

    private setupEventListeners(): void {
        // Track ORPAR phase timing
        EventBus.server.on(Events.ControlLoop.OBSERVATION, (payload) => {
            this.trackPhaseStart(payload.agentId, payload.channelId, 'observation');
        });

        EventBus.server.on(Events.ControlLoop.REASONING, (payload) => {
            this.trackPhaseTransition(payload.agentId, payload.channelId, 'observation', 'reasoning');
        });

        EventBus.server.on(Events.ControlLoop.PLAN, (payload) => {
            this.trackPhaseTransition(payload.agentId, payload.channelId, 'reasoning', 'planning');
        });

        EventBus.server.on(Events.ControlLoop.ACTION, (payload) => {
            this.trackPhaseTransition(payload.agentId, payload.channelId, 'planning', 'action');
        });

        // Track tool usage - only track on result or error, not on call
        EventBus.server.on(Events.Mcp.TOOL_RESULT, (payload) => {
            this.trackToolUsage(payload.agentId, payload.channelId, payload.data?.toolName || payload.toolName, true);
        });

        EventBus.server.on(Events.Mcp.TOOL_ERROR, (payload) => {
            this.trackToolUsage(payload.agentId, payload.channelId, payload.data?.toolName || payload.toolName, false);
        });

        // Track collaboration
        EventBus.server.on(Events.Message.CHANNEL_MESSAGE, (payload) => {
            this.trackMessageActivity(payload.agentId, payload.channelId, 'sent');
        });

    }

    // =============================================================================
    // PERFORMANCE METRICS MANAGEMENT
    // =============================================================================

    /**
     * Get performance metrics for an agent in a channel
     */
    public async getPerformanceMetrics(
        agentId: AgentId, 
        channelId: ChannelId
    ): Promise<Observable<AgentPerformanceMetrics>> {
        try {
            if (!agentId || !channelId) {
                throw new Error('Agent ID and Channel ID are required');
            }
            
            const cacheKey = `${agentId}:${channelId}`;
            
            // Check cache first
            const cached = this.performanceCache.get(cacheKey);
            if (cached) {
                return of(cached);
            }
            
            // Create new metrics if none exist
            const newMetrics = this.createInitialMetrics(agentId, channelId);
            await this.storeMetrics(newMetrics);
            
            return of(newMetrics);
            
        } catch (error) {
            this.logger.error(` Error getting performance metrics: ${error}`);
            return throwError(() => error);
        }
    }

    /**
     * Analyze agent performance and provide insights (simplified)
     */
    public async analyzePerformance(
        agentId: AgentId,
        channelId: ChannelId
    ): Promise<Observable<AgentPerformanceAnalysis>> {
        try {
            if (!agentId || !channelId) {
                throw new Error('Agent ID and Channel ID are required');
            }
            
            
            // Get current metrics
            const metricsObs = await this.getPerformanceMetrics(agentId, channelId);
            const metrics = await metricsObs.toPromise();
            
            if (!metrics) {
                throw new Error('No performance metrics available for analysis');
            }
            
            // Generate simplified analysis
            const analysis = this.createSimplifiedAnalysis(metrics);
            
            
            return of(analysis);
            
        } catch (error) {
            this.logger.error(` Error analyzing performance: ${error}`);
            return throwError(() => error);
        }
    }

    /**
     * Get performance optimization suggestions
     */
    public async getOptimizationSuggestions(
        agentId: AgentId,
        channelId: ChannelId
    ): Promise<Observable<PerformanceOptimizationSuggestion[]>> {
        try {
            const analysisObs = await this.analyzePerformance(agentId, channelId);
            const analysis = await analysisObs.toPromise();
            
            if (!analysis) {
                return of([]);
            }
            
            return of(analysis.optimizations);
            
        } catch (error) {
            this.logger.error(` Error getting optimization suggestions: ${error}`);
            return throwError(() => error);
        }
    }

    // =============================================================================
    // PERFORMANCE TRACKING METHODS
    // =============================================================================

    private async trackPhaseStart(agentId: AgentId, channelId: ChannelId, phase: string): Promise<void> {
        const key = `${agentId}:${channelId}:${phase}`;
        this.phaseStartTimes.set(key, Date.now());
        
    }

    private async trackPhaseTransition(
        agentId: AgentId, 
        channelId: ChannelId, 
        fromPhase: string, 
        toPhase: string
    ): Promise<void> {
        const fromKey = `${agentId}:${channelId}:${fromPhase}`;
        const startTime = this.phaseStartTimes.get(fromKey);
        
        if (startTime) {
            const duration = Date.now() - startTime;
            await this.updateOraprTiming(agentId, channelId, fromPhase, duration);
            this.phaseStartTimes.delete(fromKey);
        }
        
        // Start tracking the new phase
        await this.trackPhaseStart(agentId, channelId, toPhase);
    }

    private async updateOraprTiming(
        agentId: AgentId,
        channelId: ChannelId,
        phase: string,
        duration: number
    ): Promise<void> {
        try {
            const metricsObs = await this.getPerformanceMetrics(agentId, channelId);
            const metrics = await metricsObs.toPromise();
            
            if (!metrics) return;
            
            const timing = metrics.oraprTiming;
            
            // Update the specific phase timing using running average
            switch (phase) {
                case 'observation':
                    timing.averageObservationTime = this.updateRunningAverage(
                        timing.averageObservationTime, duration, timing.cycleCount
                    );
                    break;
                case 'reasoning':
                    timing.averageReasoningTime = this.updateRunningAverage(
                        timing.averageReasoningTime, duration, timing.cycleCount
                    );
                    break;
                case 'planning':
                    timing.averagePlanningTime = this.updateRunningAverage(
                        timing.averagePlanningTime, duration, timing.cycleCount
                    );
                    break;
                case 'action':
                    timing.averageActionTime = this.updateRunningAverage(
                        timing.averageActionTime, duration, timing.cycleCount
                    );
                    timing.cycleCount += 1; // Increment cycle count on action completion
                    break;
            }
            
            // Update total cycle time
            timing.averageTotalCycleTime = 
                timing.averageObservationTime +
                timing.averageReasoningTime +
                timing.averagePlanningTime +
                timing.averageActionTime;
            
            timing.lastUpdated = Date.now();
            
            await this.storeMetrics(metrics);
            
            
        } catch (error) {
            this.logger.error(` Error updating ORPAR timing: ${error}`);
        }
    }

    private async trackToolUsage(
        agentId: AgentId,
        channelId: ChannelId,
        toolName: string,
        success: boolean
    ): Promise<void> {
        if (!toolName) return;
        
        try {
            const metricsObs = await this.getPerformanceMetrics(agentId, channelId);
            const metrics = await metricsObs.toPromise();
            
            if (!metrics) return;
            
            const toolUsage = metrics.toolUsage;
            
            // Update usage frequency
            toolUsage.toolUsageFrequency[toolName] = (toolUsage.toolUsageFrequency[toolName] || 0) + 1;
            
            // Update success/error rates
            const currentSuccesses = (toolUsage.toolSuccessRates[toolName] || 0) * 
                                   (toolUsage.toolUsageFrequency[toolName] - 1);
            const newSuccesses = currentSuccesses + (success ? 1 : 0);
            toolUsage.toolSuccessRates[toolName] = newSuccesses / toolUsage.toolUsageFrequency[toolName];
            
            const currentErrors = (toolUsage.toolErrorRates[toolName] || 0) * 
                                 (toolUsage.toolUsageFrequency[toolName] - 1);
            const newErrors = currentErrors + (success ? 0 : 1);
            toolUsage.toolErrorRates[toolName] = newErrors / toolUsage.toolUsageFrequency[toolName];
            
            // Update most used tools (top 10)
            const sortedTools = Object.entries(toolUsage.toolUsageFrequency)
                .sort(([,a], [,b]) => b - a)
                .slice(0, 10)
                .map(([tool]) => tool);
            toolUsage.mostUsedTools = sortedTools;
            
            toolUsage.totalToolsUsed += 1;
            toolUsage.uniqueToolsUsed = Object.keys(toolUsage.toolUsageFrequency).length;
            toolUsage.lastToolUsage = Date.now();
            
            await this.storeMetrics(metrics);
            
            
        } catch (error) {
            this.logger.error(` Error tracking tool usage: ${error}`);
        }
    }

    private async trackMessageActivity(
        agentId: AgentId | undefined,
        channelId: ChannelId,
        type: 'sent' | 'received'
    ): Promise<void> {
        if (!agentId) return;
        
        try {
            const metricsObs = await this.getPerformanceMetrics(agentId, channelId);
            const metrics = await metricsObs.toPromise();
            
            if (!metrics) return;
            
            const collaboration = metrics.collaboration;
            
            if (type === 'sent') {
                collaboration.messagesSentInChannel += 1;
            } else {
                collaboration.messagesReceivedInChannel += 1;
            }
            
            collaboration.lastCollaboration = Date.now();
            
            await this.storeMetrics(metrics);
            
        } catch (error) {
            this.logger.error(` Error tracking message activity: ${error}`);
        }
    }

    // =============================================================================
    // PRIVATE HELPER METHODS
    // =============================================================================

    private createInitialMetrics(agentId: AgentId, channelId: ChannelId): AgentPerformanceMetrics {
        const now = Date.now();
        
        return {
            agentId,
            channelId,
            oraprTiming: {
                averageObservationTime: 0,
                averageReasoningTime: 0,
                averagePlanningTime: 0,
                averageActionTime: 0,
                averageReflectionTime: 0,
                averageTotalCycleTime: 0,
                timingConsistency: {
                    observationStdDev: 0,
                    reasoningStdDev: 0,
                    planningStdDev: 0,
                    actionStdDev: 0,
                    reflectionStdDev: 0
                },
                timingBounds: {
                    fastest: {
                        observation: 0,
                        reasoning: 0,
                        planning: 0,
                        action: 0,
                        reflection: 0,
                        total: 0
                    },
                    slowest: {
                        observation: 0,
                        reasoning: 0,
                        planning: 0,
                        action: 0,
                        reflection: 0,
                        total: 0
                    }
                },
                cycleCount: 0,
                lastUpdated: now
            },
            toolUsage: {
                mostUsedTools: [],
                toolSuccessRates: {},
                toolExecutionTimes: {},
                preferredToolCategories: [],
                toolUsageFrequency: {},
                toolErrorRates: {},
                toolCombinations: [],
                toolEfficiencyScores: {},
                toolRecommendationScores: {},
                totalToolsUsed: 0,
                uniqueToolsUsed: 0,
                lastToolUsage: now
            },
            collaboration: {
                messagesSentInChannel: 0,
                messagesReceivedInChannel: 0,
                coordinationRequestsMade: 0,
                coordinationRequestsReceived: 0,
                successfulCollaborations: 0,
                failedCollaborations: 0,
                collaborationSuccessRate: 0,
                averageResponseTime: 0,
                frequentCollaborators: [],
                collaborationPatterns: [],
                communicationEffectiveness: 0,
                leadershipActivities: 0,
                supportActivities: 0,
                lastCollaboration: now
            },
            overallPerformance: {
                efficiency: 0.5,
                effectiveness: 0.5,
                learningProgression: 0.5,
                consistency: 0.5,
                innovation: 0.5,
                reliability: 0.5
            },
            trends: {
                direction: 'stable',
                confidence: 0.5,
                improvingAreas: [],
                concernAreas: [],
                recommendations: []
            },
            benchmark: {
                relativePerformance: {
                    efficiency: 1.0,
                    speed: 1.0,
                    accuracy: 1.0,
                    collaboration: 1.0
                },
                channelRanking: {
                    overall: 1,
                    efficiency: 1,
                    collaboration: 1,
                    toolUsage: 1
                },
                percentiles: {
                    overall: 50,
                    efficiency: 50,
                    speed: 50,
                    collaboration: 50
                }
            },
            metadata: {
                dataPoints: 0,
                dateRange: {
                    start: now,
                    end: now
                },
                lastUpdated: now,
                version: '1.0.0',
                confidence: 0.1
            }
        };
    }

    private createSimplifiedAnalysis(metrics: AgentPerformanceMetrics): AgentPerformanceAnalysis {
        // Simple analysis based on available metrics
        const cycleCount = metrics.oraprTiming.cycleCount;
        const toolsUsed = metrics.toolUsage.totalToolsUsed;
        const messages = metrics.collaboration.messagesSentInChannel + metrics.collaboration.messagesReceivedInChannel;
        
        let overall: 'excellent' | 'good' | 'average' | 'needs_improvement' | 'poor' = 'average';
        if (cycleCount > 10 && toolsUsed > 20) overall = 'good';
        if (cycleCount > 25 && toolsUsed > 50) overall = 'excellent';
        if (cycleCount < 3) overall = 'needs_improvement';
        
        const optimizations: PerformanceOptimizationSuggestion[] = [];
        
        if (metrics.oraprTiming.averageTotalCycleTime > 30000) { // More than 30 seconds
            optimizations.push({
                category: 'timing',
                priority: 'medium',
                title: 'Optimize ORPAR Cycle Time',
                description: 'Your average cycle time could be improved by optimizing reasoning and planning phases.',
                expectedImpact: {
                    areas: ['efficiency', 'speed'],
                    estimatedImprovement: 20,
                    confidence: 0.7
                },
                implementationSteps: ['Review reasoning patterns', 'Streamline planning process'],
                recommendedTools: ['channel_context_read', 'agent_memory_read'],
                successMetrics: ['Reduced cycle time', 'Improved efficiency'],
                risks: ['May reduce thoroughness initially'],
                timeEstimate: '1-2 hours of practice'
            });
        }
        
        if (Object.keys(metrics.toolUsage.toolUsageFrequency).length < 5) {
            optimizations.push({
                category: 'tool_usage',
                priority: 'low',
                title: 'Expand Tool Usage',
                description: 'Consider exploring more tools to enhance your capabilities.',
                expectedImpact: {
                    areas: ['effectiveness', 'versatility'],
                    estimatedImprovement: 15,
                    confidence: 0.6
                },
                implementationSteps: ['Explore available tools', 'Try new tool combinations'],
                recommendedTools: ['tools_recommend'],
                successMetrics: ['Increased tool diversity', 'Better problem solving'],
                risks: ['Learning curve for new tools'],
                timeEstimate: '30 minutes exploration'
            });
        }
        
        return {
            agentId: metrics.agentId,
            channelId: metrics.channelId,
            analysisTimestamp: Date.now(),
            summary: {
                overall,
                strengths: [`Completed ${cycleCount} ORPAR cycles`, `Used ${toolsUsed} tools`, `${messages} messages exchanged`],
                weaknesses: cycleCount < 5 ? ['Limited cycle experience'] : ['Performance tracking active'],
                insights: ['Continue building experience with the ORPAR framework']
            },
            optimizations,
            progressSinceLastAnalysis: {
                timeSinceLastAnalysis: 0,
                metricChanges: {},
                progressAssessment: 'stable',
                completedRecommendations: []
            },
            confidence: 0.7,
            metadata: {
                analysisMethod: 'Simplified',
                dataQuality: cycleCount > 5 ? 'good' : 'fair',
                sampleSize: cycleCount,
                analysisDuration: 0
            }
        };
    }

    private updateRunningAverage(currentAverage: number, newValue: number, count: number): number {
        if (count === 0) return newValue;
        return ((currentAverage * count) + newValue) / (count + 1);
    }

    private getPhaseAverage(timing: OraprTimingMetrics, phase: string): number {
        switch (phase) {
            case 'observation': return timing.averageObservationTime;
            case 'reasoning': return timing.averageReasoningTime;
            case 'planning': return timing.averagePlanningTime;
            case 'action': return timing.averageActionTime;
            case 'reflection': return timing.averageReflectionTime;
            default: return 0;
        }
    }

    private async storeMetrics(metrics: AgentPerformanceMetrics): Promise<void> {
        // Store in agent memory using existing MemoryService structure
        this.memoryService.updateAgentMemory(metrics.agentId, {
            [`performance_${metrics.channelId}`]: JSON.stringify(metrics)
        }).subscribe({
            next: () => null,
            error: (error) => this.logger.warn(` Failed to persist performance metrics: ${error}`)
        });
        
        // Update cache
        const cacheKey = `${metrics.agentId}:${metrics.channelId}`;
        this.performanceCache.set(cacheKey, metrics);
        
        // Emit update
        this.performanceUpdates$.next([metrics]);
    }

    // =============================================================================
    // PUBLIC OBSERVABLES
    // =============================================================================

    /**
     * Observable for performance updates
     */
    public get performanceUpdates(): Observable<AgentPerformanceMetrics[]> {
        return this.performanceUpdates$.asObservable();
    }
}
