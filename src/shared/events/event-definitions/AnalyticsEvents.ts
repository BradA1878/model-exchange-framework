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
 * Analytics Events
 * 
 * Event definitions for analytics, performance metrics, and reporting operations
 */

export const AnalyticsEvents = {
    // Performance metrics events
    AGENT_PERFORMANCE_UPDATED: 'analytics:agent:performance:updated',
    CHANNEL_ACTIVITY_UPDATED: 'analytics:channel:activity:updated',
    TASK_COMPLETION_ANALYTICS: 'analytics:task:completion:updated',
    SYSTEM_HEALTH_UPDATED: 'analytics:system:health:updated',
    
    // Report generation events
    REPORT_REQUESTED: 'analytics:report:requested',
    REPORT_GENERATED: 'analytics:report:generated',
    REPORT_FAILED: 'analytics:report:failed',
    
    // Performance alert events
    PERFORMANCE_ALERT: 'analytics:performance:alert',
    HEALTH_ALERT: 'analytics:health:alert',
    THRESHOLD_EXCEEDED: 'analytics:threshold:exceeded',
    
    // Validation and optimization events
    METRIC_UPDATE: 'analytics:metric:update',
    AB_TEST_STARTED: 'analytics:ab:test:started',
    AB_TEST_COMPLETED: 'analytics:ab:test:completed',
    ANOMALY_DETECTED: 'analytics:anomaly:detected',
    PERFORMANCE_PROFILE_COMPLETED: 'analytics:performance:profile:completed',
    HIGH_ERROR_RISK_PREDICTED: 'analytics:high:error:risk:predicted',
    
    // Task effectiveness events
    TASK_STARTED: 'analytics:task:started',
    TASK_COMPLETED: 'analytics:task:completed',
    TASK_EFFECTIVENESS_EVENT: 'analytics:task:effectiveness:event',
    TASK_EFFECTIVENESS_QUALITY_UPDATE: 'analytics:task:effectiveness:quality:update',
} as const;

export type AnalyticsEventName = typeof AnalyticsEvents[keyof typeof AnalyticsEvents];

/**
 * Agent Performance Metrics Interface
 */
export interface AgentPerformanceMetrics {
    agentId: string;
    taskCount: number;
    completionRate: number;
    averageTaskDuration: number;
    successRate: number;
    errorCount: number;
    lastActive: Date;
    responseTime: number;
    capabilities: string[];
    workloadScore: number;
}

/**
 * Channel Activity Metrics Interface
 */
export interface ChannelActivityMetrics {
    channelId: string;
    participantCount: number;
    messageCount: number;
    taskCount: number;
    averageTaskDuration: number;
    completionRate: number;
    lastActivity: Date;
    activityScore: number;
}

/**
 * Task Completion Analytics Interface
 */
export interface TaskCompletionAnalytics {
    totalTasks: number;
    completedTasks: number;
    failedTasks: number;
    cancelledTasks: number;
    averageDuration: number;
    completionRate: number;
    tasksByStatus: Record<string, number>;
    tasksByChannel: Record<string, number>;
    tasksByAgent: Record<string, number>;
    timeRange: {
        start: Date;
        end: Date;
    };
}

/**
 * System Health Metrics Interface
 */
export interface SystemHealthMetrics {
    uptime: number;
    memoryUsage: {
        used: number;
        total: number;
        percentage: number;
    };
    cpuUsage: number;
    activeConnections: number;
    totalAgents: number;
    activeAgents: number;
    totalChannels: number;
    activeChannels: number;
    taskQueueSize: number;
    eventBusHealth: boolean;
}

/**
 * Report Request Interface
 */
export interface ReportRequest {
    reportId: string;
    reportType: 'performance' | 'activity' | 'completion' | 'health';
    parameters: {
        timeRange?: {
            start: Date;
            end: Date;
        };
        agentIds?: string[];
        channelIds?: string[];
        includeDetails?: boolean;
    };
    requestedBy: string;
    requestedAt: Date;
}

/**
 * Generated Report Interface
 */
export interface GeneratedReport {
    reportId: string;
    reportType: string;
    data: any;
    generatedAt: Date;
    generatedBy: string;
    format: 'json' | 'csv' | 'pdf';
    downloadUrl?: string;
}

/**
 * Performance Alert Interface
 */
export interface PerformanceAlert {
    alertId: string;
    alertType: 'performance' | 'health' | 'threshold';
    severity: 'low' | 'medium' | 'high' | 'critical';
    message: string;
    source: string;
    sourceType: 'agent' | 'channel' | 'system';
    metrics: Record<string, any>;
    threshold?: {
        metric: string;
        threshold: number;
        actual: number;
    };
    timestamp: Date;
}

/**
 * Analytics Event Payloads
 */
export interface AnalyticsPayloads {
    'analytics:agent:performance:updated': {
        agentId: string;
        metrics: AgentPerformanceMetrics;
        timestamp: Date;
    };
    'analytics:channel:activity:updated': {
        channelId: string;
        metrics: ChannelActivityMetrics;
        timestamp: Date;
    };
    'analytics:task:completion:updated': {
        analytics: TaskCompletionAnalytics;
        timestamp: Date;
    };
    'analytics:system:health:updated': {
        metrics: SystemHealthMetrics;
        timestamp: Date;
    };
    'analytics:report:requested': {
        request: ReportRequest;
        timestamp: Date;
    };
    'analytics:report:generated': {
        report: GeneratedReport;
        timestamp: Date;
    };
    'analytics:report:failed': {
        reportId: string;
        error: string;
        timestamp: Date;
    };
    'analytics:performance:alert': {
        alert: PerformanceAlert;
        timestamp: Date;
    };
    'analytics:health:alert': {
        alert: PerformanceAlert;
        timestamp: Date;
    };
    'analytics:threshold:exceeded': {
        alert: PerformanceAlert;
        timestamp: Date;
    };
    'analytics:metric:update': {
        agentId: string;
        metricName: string;
        value: number;
        metadata?: Record<string, any>;
        timestamp: Date;
    };
    'analytics:ab:test:started': {
        testId: string;
        testName: string;
        variants: string[];
        parameters: Record<string, any>;
        timestamp: Date;
    };
    'analytics:ab:test:completed': {
        testId: string;
        testName: string;
        results: Record<string, any>;
        winningVariant?: string;
        timestamp: Date;
    };
    'analytics:anomaly:detected': {
        anomalyId: string;
        type: string;
        severity: 'low' | 'medium' | 'high' | 'critical';
        description: string;
        metrics: Record<string, any>;
        timestamp: Date;
    };
    'analytics:performance:profile:completed': {
        profileId: string;
        agentId?: string;
        channelId?: string;
        metrics: Record<string, any>;
        duration: number;
        timestamp: Date;
    };
    'analytics:high:error:risk:predicted': {
        predictionId: string;
        agentId: string;
        channelId: string;
        toolName: string;
        riskScore: number;
        details: Record<string, any>;
        timestamp: Date;
    };
    'analytics:task:started': {
        taskId: string;
        channelId: string;
        taskType: string;
        timestamp: Date;
    };
    'analytics:task:completed': {
        taskId: string;
        metrics: any; // TaskEffectivenessMetrics
        success: boolean;
        timestamp: Date;
    };
    'analytics:task:effectiveness:event': {
        taskId: string;
        agentId: string;
        eventType: string;
        details: Record<string, any>;
        timestamp: Date;
    };
    'analytics:task:effectiveness:quality:update': {
        taskId: string;
        agentId: string;
        qualityUpdates: Record<string, any>;
        timestamp: Date;
    };
}
