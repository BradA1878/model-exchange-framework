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
 * Task Effectiveness Service
 * 
 * Universal effectiveness tracking for any type of agent task
 */

import { v4 as uuidv4 } from 'uuid';
import { Logger } from '../utils/Logger';
import { EventBus } from '../events/EventBus';
import { Events } from '../events/EventNames';
import { AgentId } from '../types/Agent';
import { ChannelId } from '../types/ChannelContext';
import { AgentPerformanceService } from './AgentPerformanceService';
import { TaskEffectivenessModel, ITaskEffectiveness } from '../models/taskEffectiveness';
import {
    TaskEffectivenessMetrics,
    TaskDefinition,
    EffectivenessComparison,
    EffectivenessAnalytics,
    TaskExecutionEvent,
    EffectivenessConfig
} from '../types/EffectivenessTypes';

/**
 * Service for tracking and analyzing task effectiveness
 */
export class TaskEffectivenessService {
    private readonly logger: Logger;
    private readonly performanceService: AgentPerformanceService;
    private static instance: TaskEffectivenessService;
    
    // Active task tracking
    private readonly activeTasks = new Map<string, TaskEffectivenessMetrics>();
    private readonly taskDefinitions = new Map<string, TaskDefinition>();
    private readonly taskEvents = new Map<string, TaskExecutionEvent[]>();
    
    // Historical data (in production, this would be in MongoDB)
    private readonly completedTasks = new Map<string, TaskEffectivenessMetrics>();
    
    // Configuration
    private config: EffectivenessConfig = {
        autoTrack: true,
        trackingOptions: {
            performance: true,
            quality: true,
            resources: true,
            collaboration: true
        },
        baselineComparison: {
            enabled: true
        }
    };

    private constructor() {
        this.logger = new Logger('info', 'TaskEffectivenessService', 'server');
        this.performanceService = AgentPerformanceService.getInstance();
        this.setupEventListeners();
    }

    public static getInstance(): TaskEffectivenessService {
        if (!TaskEffectivenessService.instance) {
            TaskEffectivenessService.instance = new TaskEffectivenessService();
        }
        return TaskEffectivenessService.instance;
    }

    /**
     * Start tracking a new task
     */
    public startTask(definition: TaskDefinition): string {
        try {
            if (!definition.channelId || !definition.taskType || !definition.description) {
                throw new Error('Missing required task definition fields');
            }
            
            const taskId = definition.taskId || uuidv4();
        
        const metrics: TaskEffectivenessMetrics = {
            taskId,
            metadata: {
                type: definition.taskType,
                description: definition.description,
                startTime: Date.now(),
                status: 'in_progress'
            },
            performance: {
                stepCount: 0,
                toolsUsed: 0,
                uniqueTools: [],
                agentInteractions: 0,
                humanInterventions: 0,
                autonomyScore: 1.0 // Starts at 100%, decreases with interventions
            },
            quality: {
                goalAchieved: false,
                completenessScore: 0,
                iterationCount: 0,
                errorCount: 0,
                customMetrics: {}
            },
            resources: {
                totalComputeTime: 0,
                peakConcurrentAgents: 0,
                memoryOperations: 0
            },
            collaboration: {
                participatingAgents: [],
                messageCount: 0,
                coordinationCount: 0,
                knowledgeTransfers: 0,
                collaborationScore: 0
            }
        };
        
        this.activeTasks.set(taskId, metrics);
        this.taskDefinitions.set(taskId, definition);
        this.taskEvents.set(taskId, []);
        
        // Emit task started event
        this.recordEvent({
            eventId: uuidv4(),
            taskId,
            timestamp: Date.now(),
            type: 'start',
            details: { definition }
        });
        
        EventBus.server.emit(Events.Analytics.TASK_STARTED, {
            taskId,
            channelId: definition.channelId,
            taskType: definition.taskType,
            timestamp: new Date()
        });
        
            return taskId;
        } catch (error) {
            this.logger.error(`Failed to start task tracking: ${error}`);
            throw error;
        }
    }

    /**
     * Record a task execution event
     */
    public recordEvent(event: TaskExecutionEvent): void {
        try {
            if (!event.taskId || !event.type) {
                this.logger.warn('Invalid event: missing taskId or type');
                return;
            }
            
            const events = this.taskEvents.get(event.taskId);
            if (events) {
                events.push(event);
            }
            
            // Update metrics based on event
            const metrics = this.activeTasks.get(event.taskId);
            if (metrics) {
                this.updateMetricsFromEvent(metrics, event);
            } else {
            }
            
            // Emit event for analytics tracking
            EventBus.server.emit(Events.Analytics.TASK_EFFECTIVENESS_EVENT, {
                taskId: event.taskId,
                agentId: event.agentId || 'unknown',
                eventType: event.type,
                details: event.details,
                timestamp: new Date()
            });
        } catch (error) {
            this.logger.error(`Failed to record event: ${error}`);
        }
    }

    /**
     * Update task quality metrics
     */
    public updateQuality(
        taskId: string, 
        updates: Partial<TaskEffectivenessMetrics['quality']>,
        agentId?: AgentId
    ): void {
        const metrics = this.activeTasks.get(taskId) || this.completedTasks.get(taskId);
        if (metrics) {
            metrics.quality = { ...metrics.quality, ...updates };
            
            // Emit quality update event
            EventBus.server.emit(Events.Analytics.TASK_EFFECTIVENESS_QUALITY_UPDATE, {
                taskId,
                agentId: agentId || 'unknown',
                qualityUpdates: updates,
                timestamp: new Date()
            });
        }
    }

    /**
     * Complete a task and calculate final metrics
     */
    public async completeTask(
        taskId: string, 
        success: boolean,
        customMetrics?: Record<string, number>
    ): Promise<TaskEffectivenessMetrics | null> {
        const metrics = this.activeTasks.get(taskId);
        if (!metrics) {
            this.logger.warn(`Cannot complete unknown task ${taskId}`);
            return null;
        }
        
        // Update final metrics
        metrics.metadata.endTime = Date.now();
        metrics.metadata.status = success ? 'completed' : 'failed';
        metrics.performance.completionTime = metrics.metadata.endTime - metrics.metadata.startTime;
        metrics.quality.goalAchieved = success;
        
        if (customMetrics) {
            metrics.quality.customMetrics = { ...metrics.quality.customMetrics, ...customMetrics };
        }
        
        // Calculate collaboration score
        if (metrics.collaboration.participatingAgents.length > 1) {
            metrics.collaboration.collaborationScore = this.calculateCollaborationScore(metrics);
        }
        
        // Move to completed
        this.activeTasks.delete(taskId);
        this.completedTasks.set(taskId, metrics);
        
        // Persist to MongoDB
        await this.persistTaskToDB(taskId, metrics);
        
        // Emit completion event
        EventBus.server.emit(Events.Analytics.TASK_COMPLETED, {
            taskId,
            metrics,
            success,
            timestamp: new Date()
        });
        
        return metrics;
    }

    /**
     * Get comparison with baseline
     */
    public compareWithBaseline(taskId: string): EffectivenessComparison | null {
        const metrics = this.completedTasks.get(taskId) || this.activeTasks.get(taskId);
        const definition = this.taskDefinitions.get(taskId);
        
        if (!metrics || !definition) {
            return null;
        }
        
        const baseline = definition.baseline?.metrics;
        
        const comparison: EffectivenessComparison = {
            current: metrics,
            baseline,
            improvements: {
                speedImprovement: 0,
                autonomyImprovement: 0,
                qualityImprovement: 0,
                resourceEfficiency: 0
            },
            summary: {
                overallScore: 0,
                achievements: [],
                improvements: [],
                recommendations: []
            }
        };
        
        // Calculate improvements if baseline exists
        if (baseline) {
            if (baseline.performance?.completionTime && metrics.performance.completionTime) {
                comparison.improvements.speedImprovement = 
                    ((baseline.performance.completionTime - metrics.performance.completionTime) / 
                     baseline.performance.completionTime) * 100;
            }
            
            if (baseline.performance?.autonomyScore !== undefined) {
                comparison.improvements.autonomyImprovement = 
                    ((metrics.performance.autonomyScore - baseline.performance.autonomyScore) / 
                     baseline.performance.autonomyScore) * 100;
            }
        }
        
        // Calculate overall score
        comparison.summary.overallScore = this.calculateOverallScore(metrics);
        
        // Generate insights
        comparison.summary.achievements = this.identifyAchievements(metrics, baseline);
        comparison.summary.improvements = this.identifyImprovements(metrics);
        comparison.summary.recommendations = this.generateRecommendations(metrics);
        
        return comparison;
    }

    /**
     * Get analytics for a time period
     */
    public getAnalytics(
        startTime: number,
        endTime: number,
        channelId?: ChannelId
    ): EffectivenessAnalytics {
        const relevantTasks = Array.from(this.completedTasks.values()).filter(task => {
            const inTimeRange = task.metadata.startTime >= startTime && 
                               task.metadata.startTime <= endTime;
            const inChannel = !channelId || 
                             this.taskDefinitions.get(task.taskId)?.channelId === channelId;
            return inTimeRange && inChannel;
        });
        
        // Initialize analytics
        const analytics: EffectivenessAnalytics = {
            period: { start: startTime, end: endTime },
            byTaskType: {},
            byChannel: {},
            trends: {
                effectivenessOverTime: [],
                improving: [],
                declining: []
            },
            patterns: {
                highPerformanceTasks: [],
                lowPerformanceTasks: [],
                effectiveTeams: []
            }
        };
        
        // Aggregate by task type
        for (const task of relevantTasks) {
            const type = task.metadata.type;
            if (!analytics.byTaskType[type]) {
                analytics.byTaskType[type] = {
                    count: 0,
                    avgCompletionTime: 0,
                    successRate: 0,
                    avgAutonomyScore: 0,
                    commonTools: []
                };
            }
            
            const typeStats = analytics.byTaskType[type];
            typeStats.count++;
            typeStats.avgCompletionTime = 
                (typeStats.avgCompletionTime * (typeStats.count - 1) + 
                 (task.performance.completionTime || 0)) / typeStats.count;
            typeStats.avgAutonomyScore = 
                (typeStats.avgAutonomyScore * (typeStats.count - 1) + 
                 task.performance.autonomyScore) / typeStats.count;
            
            // Track tools
            for (const tool of task.performance.uniqueTools) {
                if (!typeStats.commonTools.includes(tool)) {
                    typeStats.commonTools.push(tool);
                }
            }
        }
        
        // Calculate success rates
        for (const [type, stats] of Object.entries(analytics.byTaskType)) {
            const typeTasks = relevantTasks.filter(t => t.metadata.type === type);
            const successful = typeTasks.filter(t => t.quality.goalAchieved).length;
            stats.successRate = typeTasks.length > 0 ? successful / typeTasks.length : 0;
        }
        
        // Identify patterns
        analytics.patterns.highPerformanceTasks = Object.entries(analytics.byTaskType)
            .filter(([_, stats]) => stats.successRate > 0.8 && stats.avgAutonomyScore > 0.7)
            .map(([type]) => type);
            
        analytics.patterns.lowPerformanceTasks = Object.entries(analytics.byTaskType)
            .filter(([_, stats]) => stats.successRate < 0.5 || stats.avgAutonomyScore < 0.3)
            .map(([type]) => type);
        
        return analytics;
    }

    /**
     * Persist task effectiveness data to MongoDB
     */
    private async persistTaskToDB(taskId: string, metrics: TaskEffectivenessMetrics): Promise<void> {
        try {
            const definition = this.taskDefinitions.get(taskId);
            if (!definition) {
                this.logger.warn(`No definition found for task ${taskId}, skipping DB persistence`);
                return;
            }

            const taskDoc = await TaskEffectivenessModel.findOneAndUpdate(
                { taskId },
                {
                    $set: {
                        channelId: definition.channelId,
                        agentIds: metrics.collaboration.participatingAgents,
                        definition,
                        metrics,
                        updatedAt: new Date()
                    }
                },
                { upsert: true, new: true }
            );

        } catch (error) {
            this.logger.error(`Failed to persist task effectiveness data: ${error}`);
        }
    }

    /**
     * Load task effectiveness data from MongoDB
     */
    private async loadTaskFromDB(taskId: string): Promise<TaskEffectivenessMetrics | null> {
        try {
            const taskDoc = await TaskEffectivenessModel.findOne({ taskId });
            if (!taskDoc) {
                return null;
            }

            // Store in caches
            this.completedTasks.set(taskId, taskDoc.metrics);
            this.taskDefinitions.set(taskId, taskDoc.definition);

            return taskDoc.metrics;
        } catch (error) {
            this.logger.error(`Failed to load task effectiveness data: ${error}`);
            return null;
        }
    }

    /**
     * Enhanced analytics with MongoDB queries
     */
    public async getEnhancedAnalytics(
        startTime: number,
        endTime: number,
        channelId?: ChannelId,
        taskType?: string
    ): Promise<EffectivenessAnalytics> {
        try {
            const query: any = {
                'metrics.metadata.startTime': { $gte: startTime, $lte: endTime }
            };

            if (channelId) {
                query.channelId = channelId;
            }

            if (taskType) {
                query['metrics.metadata.type'] = taskType;
            }

            const tasks = await TaskEffectivenessModel.find(query).exec();
            
            // Convert to in-memory format and use existing analytics logic
            const taskMetrics = tasks.map(task => task.metrics);
            
            // Use existing analytics logic but with MongoDB data
            return this.computeAnalyticsFromMetrics(taskMetrics, startTime, endTime);
        } catch (error) {
            this.logger.error(`Failed to get enhanced analytics: ${error}`);
            // Fallback to in-memory analytics
            return this.getAnalytics(startTime, endTime, channelId);
        }
    }

    /**
     * Compute analytics from metrics array
     */
    private computeAnalyticsFromMetrics(
        tasks: TaskEffectivenessMetrics[],
        startTime: number,
        endTime: number
    ): EffectivenessAnalytics {
        // Initialize analytics (similar to existing getAnalytics method)
        const analytics: EffectivenessAnalytics = {
            period: { start: startTime, end: endTime },
            byTaskType: {},
            byChannel: {},
            trends: {
                effectivenessOverTime: [],
                improving: [],
                declining: []
            },
            patterns: {
                highPerformanceTasks: [],
                lowPerformanceTasks: [],
                effectiveTeams: []
            }
        };

        // Aggregate by task type (reuse existing logic)
        for (const task of tasks) {
            const type = task.metadata.type;
            if (!analytics.byTaskType[type]) {
                analytics.byTaskType[type] = {
                    count: 0,
                    avgCompletionTime: 0,
                    successRate: 0,
                    avgAutonomyScore: 0,
                    commonTools: []
                };
            }
            
            const typeStats = analytics.byTaskType[type];
            typeStats.count++;
            typeStats.avgCompletionTime = 
                (typeStats.avgCompletionTime * (typeStats.count - 1) + 
                 (task.performance.completionTime || 0)) / typeStats.count;
            typeStats.avgAutonomyScore = 
                (typeStats.avgAutonomyScore * (typeStats.count - 1) + 
                 task.performance.autonomyScore) / typeStats.count;
            
            // Track tools
            for (const tool of task.performance.uniqueTools) {
                if (!typeStats.commonTools.includes(tool)) {
                    typeStats.commonTools.push(tool);
                }
            }
        }

        // Calculate success rates
        for (const [type, stats] of Object.entries(analytics.byTaskType)) {
            const typeTasks = tasks.filter(t => t.metadata.type === type);
            const successful = typeTasks.filter(t => t.quality.goalAchieved).length;
            stats.successRate = typeTasks.length > 0 ? successful / typeTasks.length : 0;
        }

        // Identify patterns
        analytics.patterns.highPerformanceTasks = Object.entries(analytics.byTaskType)
            .filter(([_, stats]) => stats.successRate > 0.8 && stats.avgAutonomyScore > 0.7)
            .map(([type]) => type);
            
        analytics.patterns.lowPerformanceTasks = Object.entries(analytics.byTaskType)
            .filter(([_, stats]) => stats.successRate < 0.5 || stats.avgAutonomyScore < 0.3)
            .map(([type]) => type);

        return analytics;
    }

    /**
     * Update metrics from event
     */
    private updateMetricsFromEvent(metrics: TaskEffectivenessMetrics, event: TaskExecutionEvent): void {
        switch (event.type) {
            case 'step':
                metrics.performance.stepCount++;
                break;
                
            case 'tool_use':
                metrics.performance.toolsUsed++;
                const toolName = event.details.toolName;
                if (toolName && !metrics.performance.uniqueTools.includes(toolName)) {
                    metrics.performance.uniqueTools.push(toolName);
                }
                break;
                
            case 'agent_join':
                if (event.agentId && !metrics.collaboration.participatingAgents.includes(event.agentId)) {
                    metrics.collaboration.participatingAgents.push(event.agentId);
                    metrics.performance.agentInteractions++;
                }
                break;
                
            case 'human_input':
                metrics.performance.humanInterventions++;
                // Reduce autonomy score
                metrics.performance.autonomyScore = Math.max(0, 
                    metrics.performance.autonomyScore - (1 / (metrics.performance.stepCount || 1))
                );
                break;
                
            case 'error':
                metrics.quality.errorCount++;
                break;
        }
    }

    /**
     * Calculate overall effectiveness score
     */
    private calculateOverallScore(metrics: TaskEffectivenessMetrics): number {
        const weights = {
            completion: 0.3,
            autonomy: 0.2,
            efficiency: 0.2,
            quality: 0.2,
            collaboration: 0.1
        };
        
        const scores = {
            completion: metrics.quality.goalAchieved ? 1 : metrics.quality.completenessScore,
            autonomy: metrics.performance.autonomyScore,
            efficiency: Math.min(1, 10000 / (metrics.performance.completionTime || 10000)), // Normalize to 0-1
            quality: 1 - (metrics.quality.errorCount / Math.max(1, metrics.performance.stepCount)),
            collaboration: metrics.collaboration.collaborationScore
        };
        
        return Object.entries(weights).reduce((total, [key, weight]) => {
            return total + (scores[key as keyof typeof scores] * weight);
        }, 0);
    }

    /**
     * Calculate collaboration effectiveness
     */
    private calculateCollaborationScore(metrics: TaskEffectivenessMetrics): number {
        if (metrics.collaboration.participatingAgents.length < 2) return 0;
        
        const factors = {
            agentDiversity: Math.min(1, metrics.collaboration.participatingAgents.length / 5),
            communicationRate: Math.min(1, metrics.collaboration.messageCount / 
                                       (metrics.performance.stepCount * metrics.collaboration.participatingAgents.length)),
            coordinationEfficiency: metrics.collaboration.coordinationCount > 0 ? 0.8 : 0.5,
            knowledgeSharing: Math.min(1, metrics.collaboration.knowledgeTransfers / 
                                      metrics.collaboration.participatingAgents.length)
        };
        
        return Object.values(factors).reduce((sum, val) => sum + val, 0) / Object.keys(factors).length;
    }

    /**
     * Identify achievements
     */
    private identifyAchievements(
        metrics: TaskEffectivenessMetrics, 
        baseline?: Partial<TaskEffectivenessMetrics>
    ): string[] {
        const achievements: string[] = [];
        
        if (metrics.quality.goalAchieved) {
            achievements.push('Successfully completed primary goal');
        }
        
        if (metrics.performance.autonomyScore > 0.9) {
            achievements.push('Achieved high autonomy (>90%)');
        }
        
        if (baseline?.performance?.completionTime && 
            metrics.performance.completionTime && 
            metrics.performance.completionTime < baseline.performance.completionTime * 0.5) {
            achievements.push('Completed 50% faster than baseline');
        }
        
        if (metrics.quality.errorCount === 0 && metrics.performance.stepCount > 10) {
            achievements.push('Zero errors in complex task');
        }
        
        if (metrics.collaboration.participatingAgents.length > 3) {
            achievements.push('Effective multi-agent collaboration');
        }
        
        return achievements;
    }

    /**
     * Identify areas for improvement
     */
    private identifyImprovements(metrics: TaskEffectivenessMetrics): string[] {
        const improvements: string[] = [];
        
        if (metrics.performance.humanInterventions > metrics.performance.stepCount * 0.3) {
            improvements.push('High human intervention rate');
        }
        
        if (metrics.quality.errorCount > metrics.performance.stepCount * 0.1) {
            improvements.push('Error rate exceeds 10%');
        }
        
        if (metrics.quality.iterationCount > 5) {
            improvements.push('Required many iterations');
        }
        
        if (metrics.collaboration.participatingAgents.length > 1 && 
            metrics.collaboration.messageCount < metrics.performance.stepCount) {
            improvements.push('Low collaboration communication');
        }
        
        return improvements;
    }

    /**
     * Generate optimization recommendations
     */
    private generateRecommendations(metrics: TaskEffectivenessMetrics): string[] {
        const recommendations: string[] = [];
        
        if (metrics.performance.humanInterventions > 0) {
            recommendations.push('Enhance agent training for similar tasks to reduce interventions');
        }
        
        if (metrics.performance.uniqueTools.length > 10) {
            recommendations.push('Consider tool consolidation for efficiency');
        }
        
        if (metrics.quality.errorCount > 0) {
            const commonErrors = this.analyzeCommonErrors(metrics.taskId);
            if (commonErrors.length > 0) {
                recommendations.push(`Address common errors: ${commonErrors.join(', ')}`);
            }
        }
        
        return recommendations;
    }

    /**
     * Analyze common errors for a task
     */
    private analyzeCommonErrors(taskId: string): string[] {
        const events = this.taskEvents.get(taskId) || [];
        const errors = events.filter(e => e.type === 'error');
        
        // Group by error type
        const errorTypes = new Map<string, number>();
        for (const error of errors) {
            const type = error.details.errorType || 'unknown';
            errorTypes.set(type, (errorTypes.get(type) || 0) + 1);
        }
        
        // Return top error types
        return Array.from(errorTypes.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([type]) => type);
    }

    /**
     * Setup event listeners
     */
    private setupEventListeners(): void {
        // Track tool usage
        EventBus.server.on(Events.Mcp.TOOL_CALL, (payload: any) => {
            if (payload.taskId) {
                this.recordEvent({
                    eventId: uuidv4(),
                    taskId: payload.taskId,
                    timestamp: Date.now(),
                    type: 'tool_use',
                    agentId: payload.agentId,
                    details: { toolName: payload.toolName }
                });
            }
        });
        
        // Track errors
        EventBus.server.on(Events.Mcp.TOOL_ERROR, (payload: any) => {
            if (payload.taskId) {
                this.recordEvent({
                    eventId: uuidv4(),
                    taskId: payload.taskId,
                    timestamp: Date.now(),
                    type: 'error',
                    agentId: payload.agentId,
                    details: { 
                        errorType: 'tool_error',
                        toolName: payload.toolName,
                        error: payload.error
                    }
                });
            }
        });
        
        // Track agent collaboration
        EventBus.server.on(Events.Message.CHANNEL_MESSAGE, (payload: any) => {
            if (payload.taskId) {
                const metrics = this.activeTasks.get(payload.taskId);
                if (metrics) {
                    metrics.collaboration.messageCount++;
                }
            }
        });
    }

    /**
     * Get task metrics by ID
     */
    public async getTaskMetrics(taskId: string): Promise<TaskEffectivenessMetrics | null> {
        // Check active tasks first
        const activeTask = this.activeTasks.get(taskId);
        if (activeTask) {
            return activeTask;
        }
        
        // Check completed tasks
        const completedTask = this.completedTasks.get(taskId);
        if (completedTask) {
            return completedTask;
        }
        
        // Try to load from MongoDB
        try {
            const taskDoc = await TaskEffectivenessModel.findOne({ taskId });
            if (taskDoc) {
                return taskDoc.metrics as TaskEffectivenessMetrics;
            }
        } catch (error) {
            this.logger.error(`Error loading task from DB: ${error}`);
        }
        
        return null;
    }

    /**
     * Get effectiveness trends over time
     */
    public async getEffectivenessTrends(
        startTime: number,
        endTime: number,
        intervalMs: number,
        channelId?: ChannelId
    ): Promise<any> {
        const dataPoints: any[] = [];
        const intervals = Math.floor((endTime - startTime) / intervalMs);
        
        for (let i = 0; i < intervals; i++) {
            const intervalStart = startTime + (i * intervalMs);
            const intervalEnd = intervalStart + intervalMs;
            
            const intervalTasks = Array.from(this.completedTasks.values()).filter(task => {
                const taskChannel = this.taskDefinitions.get(task.taskId)?.channelId;
                return task.metadata.startTime >= intervalStart &&
                       task.metadata.startTime < intervalEnd &&
                       (!channelId || taskChannel === channelId);
            });
            
            if (intervalTasks.length > 0) {
                const avgScore = intervalTasks.reduce((sum, task) => 
                    sum + this.calculateOverallScore(task), 0) / intervalTasks.length;
                
                const successRate = intervalTasks.filter(t => t.quality.goalAchieved).length / 
                                   intervalTasks.length;
                
                const avgAutonomy = intervalTasks.reduce((sum, task) => 
                    sum + task.performance.autonomyScore, 0) / intervalTasks.length;
                
                dataPoints.push({
                    timestamp: intervalStart,
                    averageScore: avgScore,
                    successRate,
                    avgAutonomy,
                    taskCount: intervalTasks.length
                });
            }
        }
        
        return {
            dataPoints,
            intervalMs,
            timeRange: { start: startTime, end: endTime }
        };
    }

    /**
     * Get agent-specific effectiveness
     */
    public async getAgentEffectiveness(
        agentId: AgentId,
        startTime: number,
        endTime: number,
        channelId?: ChannelId
    ): Promise<any> {
        const agentTasks = Array.from(this.completedTasks.values()).filter(task => {
            const taskChannel = this.taskDefinitions.get(task.taskId)?.channelId;
            const hasAgent = task.collaboration.participatingAgents.includes(agentId);
            
            return hasAgent &&
                   task.metadata.startTime >= startTime &&
                   task.metadata.startTime <= endTime &&
                   (!channelId || taskChannel === channelId);
        });
        
        const totalTasks = agentTasks.length;
        const successfulTasks = agentTasks.filter(t => t.quality.goalAchieved).length;
        const successRate = totalTasks > 0 ? successfulTasks / totalTasks : 0;
        
        const averageScore = totalTasks > 0 ?
            agentTasks.reduce((sum, task) => sum + this.calculateOverallScore(task), 0) / totalTasks : 0;
        
        const averageAutonomy = totalTasks > 0 ?
            agentTasks.reduce((sum, task) => sum + task.performance.autonomyScore, 0) / totalTasks : 0;
        
        // Task type breakdown
        const taskTypeMap = new Map<string, number>();
        agentTasks.forEach(task => {
            const type = task.metadata.type;
            taskTypeMap.set(type, (taskTypeMap.get(type) || 0) + 1);
        });
        
        const taskTypeBreakdown = Array.from(taskTypeMap.entries())
            .map(([type, count]) => ({ type, count }))
            .sort((a, b) => b.count - a.count);
        
        // Determine trend
        const recentTasks = agentTasks.filter(t => 
            t.metadata.startTime > endTime - (7 * 24 * 60 * 60 * 1000) // Last week
        );
        const olderTasks = agentTasks.filter(t => 
            t.metadata.startTime <= endTime - (7 * 24 * 60 * 60 * 1000)
        );
        
        let trend: 'improving' | 'stable' | 'declining' = 'stable';
        if (recentTasks.length > 0 && olderTasks.length > 0) {
            const recentAvg = recentTasks.reduce((sum, t) => 
                sum + this.calculateOverallScore(t), 0) / recentTasks.length;
            const olderAvg = olderTasks.reduce((sum, t) => 
                sum + this.calculateOverallScore(t), 0) / olderTasks.length;
            
            if (recentAvg > olderAvg * 1.05) trend = 'improving';
            else if (recentAvg < olderAvg * 0.95) trend = 'declining';
        }
        
        return {
            agentId,
            totalTasks,
            successRate,
            averageScore,
            averageAutonomy,
            taskTypeBreakdown,
            trend,
            timeRange: { start: startTime, end: endTime }
        };
    }
}