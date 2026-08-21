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
 * Task Effectiveness Service
 * 
 * Universal effectiveness tracking for any type of agent task
 */

import { createBaseEventPayload } from '../schemas/EventPayloadSchema.js';
import { v4 as uuidv4 } from 'uuid';
import { Logger } from '../utils/Logger.js';
import { EventBus } from '../events/EventBus.js';
import { Events } from '../events/EventNames.js';
import { AgentId } from '../types/Agent.js';
import { ChannelId } from '../types/ChannelContext.js';
import { TaskEffectivenessModel } from '../models/taskEffectiveness.js';
import {
    TaskEffectivenessMetrics,
    TaskDefinition,
    EffectivenessComparison,
    EffectivenessAnalytics,
    TaskExecutionEvent,
    EffectivenessConfig
} from '../types/EffectivenessTypes.js';

interface PersistedEffectivenessRecord {
    agentId: AgentId;
    channelId: ChannelId;
    metrics: TaskEffectivenessMetrics;
}

interface EffectivenessTrendDataPoint {
    timestamp: number;
    averageScore: number;
    successRate: number;
    avgAutonomy: number;
    taskCount: number;
}

interface EffectivenessTrends {
    dataPoints: EffectivenessTrendDataPoint[];
    intervalMs: number;
    timeRange: { start: number; end: number };
}

interface AgentEffectivenessSummary {
    agentId: AgentId;
    totalTasks: number;
    successRate: number;
    averageScore: number;
    averageAutonomy: number;
    taskTypeBreakdown: Array<{ type: string; count: number }>;
    trend: 'improving' | 'stable' | 'declining';
    timeRange: { start: number; end: number };
}

/**
 * Service for tracking and analyzing task effectiveness
 */
export class TaskEffectivenessService {
    private readonly logger: Logger;
    private static instance: TaskEffectivenessService;
    
    // Active task tracking
    private readonly activeTasks = new Map<string, TaskEffectivenessMetrics>();
    private readonly taskDefinitions = new Map<string, TaskDefinition>();
    private readonly taskEvents = new Map<string, TaskExecutionEvent[]>();
    
    // Completed tasks live in MongoDB (TaskEffectivenessModel), not in memory.
    // They were previously kept in a `completedTasks` Map, so all effectiveness
    // history vanished on restart and any ranking built from it only ever saw
    // the tasks this process happened to run.
    
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
        this.setupEventListeners();
    }

    public static getInstance(): TaskEffectivenessService {
        if (!TaskEffectivenessService.instance) {
            TaskEffectivenessService.instance = new TaskEffectivenessService();
        }
        return TaskEffectivenessService.instance;
    }

    private getTaskKey(taskId: string, agentId: AgentId, channelId: ChannelId): string {
        return JSON.stringify([agentId, channelId, taskId]);
    }

    private requireTenantIdentity(agentId: AgentId, channelId: ChannelId): void {
        if (!agentId?.trim() || !channelId?.trim() ||
            agentId !== agentId.trim() || channelId !== channelId.trim()) {
            throw new Error('Agent ID and channel ID are required');
        }
    }

    private requireTaskIdentity(taskId: string): void {
        if (!taskId?.trim() || taskId !== taskId.trim()) {
            throw new Error('A canonical task ID is required');
        }
    }

    /**
     * Start tracking a new task
     */
    public startTask(definition: TaskDefinition): string {
        try {
            if (!definition.agentId || !definition.channelId || !definition.taskType || !definition.description) {
                throw new Error('Missing required task definition fields');
            }
            this.requireTenantIdentity(definition.agentId, definition.channelId);
            
            const taskId = definition.taskId || uuidv4();
            this.requireTaskIdentity(taskId);
            const taskKey = this.getTaskKey(taskId, definition.agentId, definition.channelId);
            if (this.activeTasks.has(taskKey)) {
                throw new Error(`Task ${taskId} is already being tracked for this agent and channel`);
            }
        
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
                    autonomyScore: 1.0
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
                    participatingAgents: [definition.agentId],
                    messageCount: 0,
                    coordinationCount: 0,
                    knowledgeTransfers: 0,
                    collaborationScore: 0
                }
            };

            this.activeTasks.set(taskKey, metrics);
            this.taskDefinitions.set(taskKey, definition);
            this.taskEvents.set(taskKey, []);

            this.recordEvent({
                eventId: uuidv4(),
                taskId,
                agentId: definition.agentId,
                channelId: definition.channelId,
                timestamp: Date.now(),
                type: 'start',
                details: { definition }
            });

            EventBus.server.emit(Events.Analytics.TASK_STARTED, createBaseEventPayload(
                Events.Analytics.TASK_STARTED,
                definition.agentId,
                definition.channelId,
                {
                    taskId,
                    agentId: definition.agentId,
                    channelId: definition.channelId,
                    taskType: definition.taskType,
                    timestamp: new Date()
                }
            ));
        
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
        if (!event.taskId || !event.type) {
            throw new Error('Task ID and event type are required');
        }
        this.requireTaskIdentity(event.taskId);
        this.requireTenantIdentity(event.agentId, event.channelId);

        const taskKey = this.getTaskKey(event.taskId, event.agentId, event.channelId);
        const events = this.taskEvents.get(taskKey);
        const metrics = this.activeTasks.get(taskKey);
        if (!events || !metrics) {
            throw new Error(`Active task ${event.taskId} was not found for this agent and channel`);
        }

        events.push(event);
        this.updateMetricsFromEvent(metrics, event);

        EventBus.server.emit(Events.Analytics.TASK_EFFECTIVENESS_EVENT, createBaseEventPayload(
            Events.Analytics.TASK_EFFECTIVENESS_EVENT,
            event.agentId,
            event.channelId,
            {
                taskId: event.taskId,
                agentId: event.agentId,
                channelId: event.channelId,
                eventType: event.type,
                details: event.details,
                timestamp: new Date()
            }
        ));
    }

    /**
     * Update task quality metrics
     */
    public updateQuality(
        taskId: string,
        agentId: AgentId,
        channelId: ChannelId,
        updates: Partial<TaskEffectivenessMetrics['quality']>
    ): void {
        this.requireTenantIdentity(agentId, channelId);
        this.requireTaskIdentity(taskId);
        const taskKey = this.getTaskKey(taskId, agentId, channelId);
        const metrics = this.activeTasks.get(taskKey);
        if (!metrics) {
            throw new Error(`Active task ${taskId} was not found for this agent and channel`);
        }

        metrics.quality = { ...metrics.quality, ...updates };

        EventBus.server.emit(Events.Analytics.TASK_EFFECTIVENESS_QUALITY_UPDATE, createBaseEventPayload(
            Events.Analytics.TASK_EFFECTIVENESS_QUALITY_UPDATE,
            agentId,
            channelId,
            {
                taskId,
                agentId,
                channelId,
                qualityUpdates: updates,
                timestamp: new Date()
            }
        ));
    }

    /**
     * Complete a task and calculate final metrics
     */
    public async completeTask(
        taskId: string,
        agentId: AgentId,
        channelId: ChannelId,
        success: boolean,
        customMetrics?: Record<string, number>
    ): Promise<TaskEffectivenessMetrics | null> {
        this.requireTenantIdentity(agentId, channelId);
        this.requireTaskIdentity(taskId);
        const taskKey = this.getTaskKey(taskId, agentId, channelId);
        const metrics = this.activeTasks.get(taskKey);
        if (!metrics) {
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
        
        // Persist to MongoDB, then drop from the active set. Persist first: if
        // it throws, the task stays active rather than disappearing entirely.
        await this.persistTaskToDB(taskId, agentId, channelId, metrics);
        this.activeTasks.delete(taskKey);
        
        // Emit completion event
        EventBus.server.emit(Events.Analytics.TASK_COMPLETED, createBaseEventPayload(
            Events.Analytics.TASK_COMPLETED,
            agentId,
            channelId,
            {
                taskId,
                agentId,
                channelId,
                metrics,
                success,
                timestamp: new Date()
            }
        ));
        
        return metrics;
    }

    /**
     * Compare a task against its baseline.
     *
     * Reads a running task from memory and a finished one from MongoDB, so this
     * keeps working across a restart.
     *
     * @returns null when the task or its definition is unknown
     */
    public async compareWithBaseline(
        taskId: string,
        agentId: AgentId,
        channelId: ChannelId
    ): Promise<EffectivenessComparison | null> {
        this.requireTenantIdentity(agentId, channelId);
        this.requireTaskIdentity(taskId);
        const taskKey = this.getTaskKey(taskId, agentId, channelId);
        let metrics = this.activeTasks.get(taskKey);
        let definition = this.taskDefinitions.get(taskKey);

        if (!metrics || !definition) {
            const taskDoc = await TaskEffectivenessModel.findOne({ taskId, agentId, channelId }).exec();
            if (taskDoc) {
                metrics = metrics ?? (taskDoc.metrics as TaskEffectivenessMetrics);
                definition = definition ?? (taskDoc.definition as TaskDefinition);
            }
        }

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
        comparison.summary.recommendations = this.generateRecommendations(metrics, taskKey);
        
        return comparison;
    }

    /** Effectiveness analytics for one exact agent and channel. */
    public async getAnalytics(
        startTime: number,
        endTime: number,
        agentId: AgentId,
        channelId: ChannelId,
        taskType?: string
    ): Promise<EffectivenessAnalytics> {
        this.requireTenantIdentity(agentId, channelId);
        const tasks = await this.findCompletedTasks({
            startTime,
            endTime,
            agentId,
            channelId,
            taskType
        });

        return this.computeAnalyticsFromRecords(tasks, startTime, endTime);
    }

    /** Channel-wide analytics intended only for the admin-authenticated REST surface. */
    public async getAdministrativeChannelAnalytics(
        startTime: number,
        endTime: number,
        channelId: ChannelId,
        taskType?: string
    ): Promise<EffectivenessAnalytics> {
        if (!channelId?.trim()) {
            throw new Error('Channel ID is required');
        }
        const tasks = await this.findCompletedTasks({ startTime, endTime, channelId, taskType });

        return this.computeAnalyticsFromRecords(tasks, startTime, endTime);
    }

    /**
     * Query persisted task effectiveness records.
     *
     * @throws If the query fails
     */
    private async findCompletedTasks(filter: {
        startTime: number;
        endTime: number;
        channelId?: ChannelId;
        taskType?: string;
        agentId?: AgentId;
    }): Promise<PersistedEffectivenessRecord[]> {
        const query: Record<string, unknown> = {
            'metrics.metadata.startTime': { $gte: filter.startTime, $lte: filter.endTime }
        };

        if (!Number.isFinite(filter.startTime) || !Number.isFinite(filter.endTime) || filter.startTime > filter.endTime) {
            throw new Error('A valid effectiveness analytics time range is required');
        }

        if (filter.channelId) {
            query.channelId = filter.channelId;
        }

        if (filter.taskType) {
            query['metrics.metadata.type'] = filter.taskType;
        }

        if (filter.agentId) {
            query.agentId = filter.agentId;
        }

        try {
            const docs = await TaskEffectivenessModel.find(query).exec();
            return docs.map(doc => {
                if (!doc.agentId || !doc.channelId) {
                    throw new Error(`Task effectiveness record ${doc.taskId} has no tenant identity`);
                }
                return {
                    agentId: doc.agentId as AgentId,
                    channelId: doc.channelId as ChannelId,
                    metrics: doc.metrics as TaskEffectivenessMetrics
                };
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.logger.error(`Failed to query task effectiveness data: ${message}`);
            throw new Error(`Failed to query task effectiveness data: ${message}`);
        }
    }

    /**
     * Persist task effectiveness data to MongoDB.
     *
     * @throws If the task has no definition, or the write fails. A completed task
     *         that is not written down is history that is simply gone; the caller
     *         needs to know.
     */
    private async persistTaskToDB(
        taskId: string,
        agentId: AgentId,
        channelId: ChannelId,
        metrics: TaskEffectivenessMetrics
    ): Promise<void> {
        const taskKey = this.getTaskKey(taskId, agentId, channelId);
        const definition = this.taskDefinitions.get(taskKey);
        if (!definition) {
            throw new Error(`Cannot persist task ${taskId}: no task definition was registered for it`);
        }

        try {
            await TaskEffectivenessModel.findOneAndUpdate(
                { taskId, agentId, channelId },
                {
                    $set: {
                        agentId,
                        channelId,
                        agentIds: metrics.collaboration.participatingAgents,
                        definition,
                        metrics,
                        completedAt: new Date(),
                        updatedAt: new Date()
                    }
                },
                { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
            ).exec();
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.logger.error(`Failed to persist task effectiveness data for ${taskId}: ${message}`);
            throw new Error(`Failed to persist task effectiveness data for ${taskId}: ${message}`);
        }
    }

    /**
     * Compute analytics from metrics array
     */
    private computeAnalyticsFromRecords(
        records: PersistedEffectivenessRecord[],
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

        for (const { metrics: task } of records) {
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
            const typeTasks = records
                .map(record => record.metrics)
                .filter(task => task.metadata.type === type);
            const successful = typeTasks.filter(t => t.quality.goalAchieved).length;
            stats.successRate = typeTasks.length > 0 ? successful / typeTasks.length : 0;
        }

        const channelIds = Array.from(new Set(records.map(record => record.channelId)));
        for (const channelId of channelIds) {
            const channelRecords = records.filter(record => record.channelId === channelId);
            const agentScores = new Map<AgentId, number[]>();
            for (const record of channelRecords) {
                const scores = agentScores.get(record.agentId) ?? [];
                scores.push(this.calculateOverallScore(record.metrics));
                agentScores.set(record.agentId, scores);
            }

            analytics.byChannel[channelId] = {
                totalTasks: channelRecords.length,
                completedTasks: channelRecords.filter(
                    record => record.metrics.metadata.status === 'completed'
                ).length,
                avgEffectivenessScore: channelRecords.length === 0
                    ? 0
                    : channelRecords.reduce(
                        (sum, record) => sum + this.calculateOverallScore(record.metrics),
                        0
                    ) / channelRecords.length,
                topPerformingAgents: Array.from(agentScores.entries())
                    .sort(([, left], [, right]) => {
                        const leftAverage = left.reduce((sum, score) => sum + score, 0) / left.length;
                        const rightAverage = right.reduce((sum, score) => sum + score, 0) / right.length;
                        return rightAverage - leftAverage;
                    })
                    .map(([agentId]) => agentId)
            };
        }

        analytics.trends.effectivenessOverTime = records
            .map(record => ({
                timestamp: record.metrics.metadata.startTime,
                avgScore: this.calculateOverallScore(record.metrics),
                taskCount: 1
            }))
            .sort((left, right) => left.timestamp - right.timestamp);

        if (analytics.trends.effectivenessOverTime.length > 1) {
            const first = analytics.trends.effectivenessOverTime[0].avgScore;
            const last = analytics.trends.effectivenessOverTime.at(-1)!.avgScore;
            if (last > first) {
                analytics.trends.improving.push('overall_effectiveness');
            } else if (last < first) {
                analytics.trends.declining.push('overall_effectiveness');
            }
        }

        // Identify patterns
        analytics.patterns.highPerformanceTasks = Object.entries(analytics.byTaskType)
            .filter(([_, stats]) => stats.successRate > 0.8 && stats.avgAutonomyScore > 0.7)
            .map(([type]) => type);
            
        analytics.patterns.lowPerformanceTasks = Object.entries(analytics.byTaskType)
            .filter(([_, stats]) => stats.successRate < 0.5 || stats.avgAutonomyScore < 0.3)
            .map(([type]) => type);

        const teamRecords = records.filter(record => record.metrics.collaboration.participatingAgents.length > 1);
        analytics.patterns.effectiveTeams = teamRecords.map(record => ({
            agents: [...record.metrics.collaboration.participatingAgents].sort(),
            taskTypes: [record.metrics.metadata.type],
            avgScore: this.calculateOverallScore(record.metrics)
        }));

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
                
            case 'tool_use': {
                metrics.performance.toolsUsed++;
                const toolName = event.details.toolName;
                if (toolName && !metrics.performance.uniqueTools.includes(toolName)) {
                    metrics.performance.uniqueTools.push(toolName);
                }
                break;
            }
                
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
    private generateRecommendations(metrics: TaskEffectivenessMetrics, taskKey: string): string[] {
        const recommendations: string[] = [];
        
        if (metrics.performance.humanInterventions > 0) {
            recommendations.push('Enhance agent training for similar tasks to reduce interventions');
        }
        
        if (metrics.performance.uniqueTools.length > 10) {
            recommendations.push('Consider tool consolidation for efficiency');
        }
        
        if (metrics.quality.errorCount > 0) {
            const commonErrors = this.analyzeCommonErrors(taskKey);
            if (commonErrors.length > 0) {
                recommendations.push(`Address common errors: ${commonErrors.join(', ')}`);
            }
        }
        
        return recommendations;
    }

    /**
     * Analyze common errors for a task
     */
    private analyzeCommonErrors(taskKey: string): string[] {
        const events = this.taskEvents.get(taskKey) || [];
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
        EventBus.server.on(Events.Mcp.TOOL_CALL, (payload) => {
            const taskId = payload.data?.taskId ?? payload.taskId;
            if (taskId && payload.agentId && payload.channelId) {
                const taskKey = this.getTaskKey(taskId, payload.agentId, payload.channelId);
                if (!this.activeTasks.has(taskKey)) {
                    return;
                }
                this.recordEvent({
                    eventId: uuidv4(),
                    taskId,
                    timestamp: Date.now(),
                    type: 'tool_use',
                    agentId: payload.agentId,
                    channelId: payload.channelId,
                    details: { toolName: payload.data?.toolName ?? payload.toolName }
                });
            }
        });

        EventBus.server.on(Events.Mcp.TOOL_ERROR, (payload) => {
            const taskId = payload.data?.taskId ?? payload.taskId;
            if (taskId && payload.agentId && payload.channelId) {
                const taskKey = this.getTaskKey(taskId, payload.agentId, payload.channelId);
                if (!this.activeTasks.has(taskKey)) {
                    return;
                }
                this.recordEvent({
                    eventId: uuidv4(),
                    taskId,
                    timestamp: Date.now(),
                    type: 'error',
                    agentId: payload.agentId,
                    channelId: payload.channelId,
                    details: {
                        errorType: 'tool_error',
                        toolName: payload.data?.toolName ?? payload.toolName,
                        error: payload.data?.error ?? payload.error
                    }
                });
            }
        });

        EventBus.server.on(Events.Message.CHANNEL_MESSAGE, (payload) => {
            const taskId = payload.data?.taskId ?? payload.taskId;
            if (taskId && payload.agentId && payload.channelId) {
                const metrics = this.activeTasks.get(
                    this.getTaskKey(taskId, payload.agentId, payload.channelId)
                );
                if (metrics) {
                    metrics.collaboration.messageCount++;
                }
            }
        });
    }

    /** Get task metrics for one exact tenant task. */
    public async getTaskMetrics(
        taskId: string,
        agentId: AgentId,
        channelId: ChannelId
    ): Promise<TaskEffectivenessMetrics | null> {
        this.requireTenantIdentity(agentId, channelId);
        this.requireTaskIdentity(taskId);
        const activeTask = this.activeTasks.get(this.getTaskKey(taskId, agentId, channelId));
        if (activeTask) {
            return activeTask;
        }

        try {
            const taskDoc = await TaskEffectivenessModel.findOne({ taskId, agentId, channelId }).exec();
            return taskDoc ? (taskDoc.metrics as TaskEffectivenessMetrics) : null;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.logger.error(`Failed to load task ${taskId}: ${message}`);
            throw new Error(`Failed to load task ${taskId}: ${message}`);
        }
    }

    /** Get effectiveness trends for one exact agent and channel. */
    public async getEffectivenessTrends(
        startTime: number,
        endTime: number,
        intervalMs: number,
        agentId: AgentId,
        channelId: ChannelId
    ): Promise<EffectivenessTrends> {
        this.requireTenantIdentity(agentId, channelId);
        const records = await this.findCompletedTasks({ startTime, endTime, agentId, channelId });
        return this.computeEffectivenessTrends(records, startTime, endTime, intervalMs);
    }

    /** Trend analytics intended only for the admin-authenticated REST surface. */
    public async getAdministrativeEffectivenessTrends(
        startTime: number,
        endTime: number,
        intervalMs: number,
        channelId?: ChannelId
    ): Promise<EffectivenessTrends> {
        const records = await this.findCompletedTasks({ startTime, endTime, channelId });
        return this.computeEffectivenessTrends(records, startTime, endTime, intervalMs);
    }

    private computeEffectivenessTrends(
        records: PersistedEffectivenessRecord[],
        startTime: number,
        endTime: number,
        intervalMs: number
    ): EffectivenessTrends {
        if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
            throw new Error('A positive trend interval is required');
        }
        const dataPoints: EffectivenessTrendDataPoint[] = [];
        const intervals = Math.floor((endTime - startTime) / intervalMs);

        for (let i = 0; i < intervals; i++) {
            const intervalStart = startTime + (i * intervalMs);
            const intervalEnd = intervalStart + intervalMs;

            const intervalTasks = records
                .map(record => record.metrics)
                .filter(task =>
                    task.metadata.startTime >= intervalStart &&
                    task.metadata.startTime < intervalEnd
                );
            
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

    /** Get agent-specific effectiveness in one exact channel. */
    public async getAgentEffectiveness(
        agentId: AgentId,
        startTime: number,
        endTime: number,
        channelId: ChannelId
    ): Promise<AgentEffectivenessSummary> {
        this.requireTenantIdentity(agentId, channelId);
        const records = await this.findCompletedTasks({ startTime, endTime, channelId, agentId });
        return this.computeAgentEffectiveness(agentId, records, startTime, endTime);
    }

    /** Agent analytics intended only for the admin-authenticated REST surface. */
    public async getAdministrativeAgentEffectiveness(
        agentId: AgentId,
        startTime: number,
        endTime: number,
        channelId?: ChannelId
    ): Promise<AgentEffectivenessSummary> {
        if (!agentId?.trim()) {
            throw new Error('Agent ID is required');
        }
        const records = await this.findCompletedTasks({ startTime, endTime, channelId, agentId });
        return this.computeAgentEffectiveness(agentId, records, startTime, endTime);
    }

    private computeAgentEffectiveness(
        agentId: AgentId,
        records: PersistedEffectivenessRecord[],
        startTime: number,
        endTime: number
    ): AgentEffectivenessSummary {
        const agentTasks = records.map(record => record.metrics);
        
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
