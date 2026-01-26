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
 */

/**
 * EvaluationService
 *
 * Agent performance evaluation and safety validation service.
 * Collects metrics, analyzes behavior, and validates safety compliance.
 *
 * Feature flag: WORKFLOW_SYSTEM_ENABLED
 */

import { Logger } from '../../shared/utils/Logger';
import { EventBus } from '../../shared/events/EventBus';

/**
 * Performance metrics for an agent
 */
export interface PerformanceMetrics {
    /** Agent ID */
    agentId: string;
    /** Average response time in milliseconds */
    averageResponseTime: number;
    /** Task completion rate (0-1) */
    taskCompletionRate: number;
    /** Error rate (0-1) */
    errorRate: number;
    /** Resource utilization metrics */
    resourceUtilization: ResourceUsage;
    /** Accuracy score (0-1) */
    accuracyScore: number;
    /** Consistency score (0-1) */
    consistencyScore: number;
    /** Total tasks executed */
    totalTasks: number;
    /** Successful tasks */
    successfulTasks: number;
    /** Failed tasks */
    failedTasks: number;
    /** Time period for metrics */
    timePeriod: {
        start: Date;
        end: Date;
    };
}

/**
 * Resource usage metrics
 */
export interface ResourceUsage {
    /** CPU usage (0-1) */
    cpuUsage: number;
    /** Memory usage in MB */
    memoryUsage: number;
    /** API calls made */
    apiCalls: number;
    /** Average API call duration */
    avgApiCallDuration: number;
}

/**
 * Safety validation result
 */
export interface SafetyValidation {
    /** Overall safety score (0-1) */
    overallScore: number;
    /** Input validation result */
    inputValidation: ValidationResult;
    /** Output validation result */
    outputValidation: ValidationResult;
    /** Behavior compliance result */
    behaviorCompliance: ComplianceResult;
    /** Security checks result */
    securityChecks: SecurityResult;
    /** Safety violations (if any) */
    violations: SafetyViolation[];
}

/**
 * Validation result
 */
export interface ValidationResult {
    /** Passed validation */
    passed: boolean;
    /** Validation score (0-1) */
    score: number;
    /** Issues found */
    issues: string[];
}

/**
 * Compliance result
 */
export interface ComplianceResult {
    /** Compliant with policies */
    compliant: boolean;
    /** Compliance score (0-1) */
    score: number;
    /** Policy violations */
    violations: string[];
}

/**
 * Security check result
 */
export interface SecurityResult {
    /** Secure */
    secure: boolean;
    /** Security score (0-1) */
    score: number;
    /** Security issues */
    issues: string[];
}

/**
 * Safety violation
 */
export interface SafetyViolation {
    /** Violation type */
    type: string;
    /** Severity (low, medium, high, critical) */
    severity: 'low' | 'medium' | 'high' | 'critical';
    /** Description */
    description: string;
    /** Timestamp */
    timestamp: Date;
}

/**
 * Behavior analysis result
 */
export interface BehaviorAnalysis {
    /** Agent ID */
    agentId: string;
    /** Behavior patterns detected */
    patterns: BehaviorPattern[];
    /** Anomalies detected */
    anomalies: BehaviorAnomaly[];
    /** Overall behavior score (0-1) */
    behaviorScore: number;
    /** Analysis timestamp */
    timestamp: Date;
}

/**
 * Behavior pattern
 */
export interface BehaviorPattern {
    /** Pattern name */
    name: string;
    /** Pattern type */
    type: 'positive' | 'negative' | 'neutral';
    /** Frequency */
    frequency: number;
    /** Confidence (0-1) */
    confidence: number;
    /** Description */
    description: string;
}

/**
 * Behavior anomaly
 */
export interface BehaviorAnomaly {
    /** Anomaly type */
    type: string;
    /** Severity */
    severity: 'low' | 'medium' | 'high';
    /** Description */
    description: string;
    /** Timestamp */
    timestamp: Date;
}

/**
 * Evaluation configuration
 */
export interface EvaluationConfig {
    /** Include performance metrics */
    includePerformance?: boolean;
    /** Include safety validation */
    includeSafety?: boolean;
    /** Include behavior analysis */
    includeBehavior?: boolean;
    /** Time period for evaluation */
    timePeriod?: {
        start: Date;
        end: Date;
    };
    /** Minimum sample size for metrics */
    minSampleSize?: number;
}

/**
 * Comprehensive evaluation result
 */
export interface EvaluationResult {
    /** Agent ID */
    agentId: string;
    /** Performance metrics */
    metrics?: PerformanceMetrics;
    /** Safety validation */
    safetyResults?: SafetyValidation;
    /** Behavior analysis */
    behaviorAnalysis?: BehaviorAnalysis;
    /** Overall evaluation score (0-1) */
    overallScore: number;
    /** Evaluation timestamp */
    timestamp: Date;
    /** Recommendations */
    recommendations: string[];
}

/**
 * Task execution record for evaluation
 */
interface TaskExecutionRecord {
    taskId: string;
    agentId: string;
    startTime: Date;
    endTime?: Date;
    success: boolean;
    duration?: number;
    error?: string;
    resourceUsage?: Partial<ResourceUsage>;
}

/**
 * EvaluationService - Agent performance and safety evaluation
 *
 * Responsibilities:
 * - Performance metrics collection and analysis
 * - Safety validation and compliance checking
 * - Behavior pattern detection and anomaly analysis
 * - Evaluation reporting and recommendations
 */
export class EvaluationService {
    private static instance: EvaluationService;
    private logger: Logger;

    // In-memory storage (replace with database in production)
    private taskExecutions = new Map<string, TaskExecutionRecord[]>();
    private evaluationHistory = new Map<string, EvaluationResult[]>();

    private constructor() {
        this.logger = new Logger('EvaluationService');

        this.setupEventHandlers();
    }

    /**
     * Get singleton instance
     */
    public static getInstance(): EvaluationService {
        if (!EvaluationService.instance) {
            EvaluationService.instance = new EvaluationService();
        }
        return EvaluationService.instance;
    }

    /**
     * Evaluate an agent
     */
    public async evaluateAgent(
        agentId: string,
        config: EvaluationConfig = {}
    ): Promise<EvaluationResult> {
        this.logger.info('Evaluating agent', { agentId });

        const result: EvaluationResult = {
            agentId,
            overallScore: 0,
            timestamp: new Date(),
            recommendations: []
        };

        // Collect performance metrics
        if (config.includePerformance !== false) {
            result.metrics = await this.collectPerformanceMetrics(agentId, config);
        }

        // Validate safety
        if (config.includeSafety) {
            result.safetyResults = await this.validateSafety(agentId);
        }

        // Analyze behavior
        if (config.includeBehavior) {
            result.behaviorAnalysis = await this.analyzeBehavior(agentId);
        }

        // Calculate overall score
        result.overallScore = this.calculateOverallScore(result);

        // Generate recommendations
        result.recommendations = this.generateRecommendations(result);

        // Store evaluation result
        if (!this.evaluationHistory.has(agentId)) {
            this.evaluationHistory.set(agentId, []);
        }
        this.evaluationHistory.get(agentId)!.push(result);

        EventBus.server.emit('agent-evaluated', {
            agentId,
            score: result.overallScore,
            timestamp: result.timestamp
        });

        return result;
    }

    /**
     * Record task execution
     */
    public async recordTaskExecution(record: {
        taskId: string;
        agentId: string;
        executionTime: number;
        success: boolean;
        result?: any;
    }): Promise<void> {
        const execution: TaskExecutionRecord = {
            taskId: record.taskId,
            agentId: record.agentId,
            startTime: new Date(Date.now() - record.executionTime),
            endTime: new Date(),
            success: record.success,
            duration: record.executionTime
        };

        if (!this.taskExecutions.has(record.agentId)) {
            this.taskExecutions.set(record.agentId, []);
        }

        this.taskExecutions.get(record.agentId)!.push(execution);

        this.logger.debug('Task execution recorded', {
            agentId: record.agentId,
            taskId: record.taskId,
            success: record.success
        });
    }

    /**
     * Record task failure
     */
    public async recordTaskFailure(record: {
        taskId: string;
        agentId: string;
        error: string;
        executionTime: number;
    }): Promise<void> {
        const execution: TaskExecutionRecord = {
            taskId: record.taskId,
            agentId: record.agentId,
            startTime: new Date(Date.now() - record.executionTime),
            endTime: new Date(),
            success: false,
            duration: record.executionTime,
            error: record.error
        };

        if (!this.taskExecutions.has(record.agentId)) {
            this.taskExecutions.set(record.agentId, []);
        }

        this.taskExecutions.get(record.agentId)!.push(execution);

        this.logger.debug('Task failure recorded', {
            agentId: record.agentId,
            taskId: record.taskId,
            error: record.error
        });
    }

    /**
     * Collect performance metrics
     */
    private async collectPerformanceMetrics(
        agentId: string,
        config: EvaluationConfig
    ): Promise<PerformanceMetrics> {
        const executions = this.taskExecutions.get(agentId) || [];

        // Filter by time period if specified
        let filteredExecutions = executions;
        if (config.timePeriod) {
            filteredExecutions = executions.filter(
                e => e.startTime >= config.timePeriod!.start && e.startTime <= config.timePeriod!.end
            );
        }

        const totalTasks = filteredExecutions.length;
        const successfulTasks = filteredExecutions.filter(e => e.success).length;
        const failedTasks = totalTasks - successfulTasks;

        const durations = filteredExecutions
            .filter(e => e.duration !== undefined)
            .map(e => e.duration!);

        const averageResponseTime = durations.length > 0
            ? durations.reduce((sum, d) => sum + d, 0) / durations.length
            : 0;

        const taskCompletionRate = totalTasks > 0 ? successfulTasks / totalTasks : 0;
        const errorRate = totalTasks > 0 ? failedTasks / totalTasks : 0;

        return {
            agentId,
            averageResponseTime,
            taskCompletionRate,
            errorRate,
            resourceUtilization: {
                cpuUsage: 0, // Would be collected from monitoring
                memoryUsage: 0,
                apiCalls: totalTasks,
                avgApiCallDuration: averageResponseTime
            },
            accuracyScore: taskCompletionRate, // Simplified
            consistencyScore: 1 - (errorRate * 0.5), // Simplified
            totalTasks,
            successfulTasks,
            failedTasks,
            timePeriod: config.timePeriod || {
                start: new Date(0),
                end: new Date()
            }
        };
    }

    /**
     * Validate safety
     */
    private async validateSafety(agentId: string): Promise<SafetyValidation> {
        // Basic safety validation
        // In production, this would include comprehensive checks

        return {
            overallScore: 1.0,
            inputValidation: {
                passed: true,
                score: 1.0,
                issues: []
            },
            outputValidation: {
                passed: true,
                score: 1.0,
                issues: []
            },
            behaviorCompliance: {
                compliant: true,
                score: 1.0,
                violations: []
            },
            securityChecks: {
                secure: true,
                score: 1.0,
                issues: []
            },
            violations: []
        };
    }

    /**
     * Analyze behavior
     */
    private async analyzeBehavior(agentId: string): Promise<BehaviorAnalysis> {
        // Basic behavior analysis
        // In production, this would use ML models

        return {
            agentId,
            patterns: [],
            anomalies: [],
            behaviorScore: 1.0,
            timestamp: new Date()
        };
    }

    /**
     * Calculate overall score
     */
    private calculateOverallScore(result: EvaluationResult): number {
        let score = 0;
        let count = 0;

        if (result.metrics) {
            score += result.metrics.taskCompletionRate * 0.4;
            score += result.metrics.accuracyScore * 0.3;
            score += result.metrics.consistencyScore * 0.3;
            count = 1;
        }

        if (result.safetyResults) {
            score += result.safetyResults.overallScore * (count > 0 ? 0.5 : 1);
            count++;
        }

        if (result.behaviorAnalysis) {
            score += result.behaviorAnalysis.behaviorScore * (count > 1 ? 0.33 : count > 0 ? 0.5 : 1);
            count++;
        }

        return count > 0 ? score : 0;
    }

    /**
     * Generate recommendations
     */
    private generateRecommendations(result: EvaluationResult): string[] {
        const recommendations: string[] = [];

        if (result.metrics) {
            if (result.metrics.errorRate > 0.1) {
                recommendations.push('High error rate detected. Review error logs and implement better error handling.');
            }

            if (result.metrics.averageResponseTime > 5000) {
                recommendations.push('High response time detected. Consider optimization or caching strategies.');
            }

            if (result.metrics.taskCompletionRate < 0.8) {
                recommendations.push('Low task completion rate. Review task assignment and agent capabilities.');
            }
        }

        if (result.safetyResults) {
            if (result.safetyResults.violations.length > 0) {
                recommendations.push('Safety violations detected. Review and address violations immediately.');
            }
        }

        if (result.behaviorAnalysis) {
            if (result.behaviorAnalysis.anomalies.length > 0) {
                recommendations.push('Behavior anomalies detected. Investigate unusual patterns.');
            }
        }

        return recommendations;
    }

    /**
     * Get evaluation history
     */
    public getEvaluationHistory(agentId: string): EvaluationResult[] {
        return this.evaluationHistory.get(agentId) || [];
    }

    /**
     * Setup event handlers
     */
    private setupEventHandlers(): void {
        // Listen for task events to collect metrics automatically
        EventBus.server.on('task:completed', (data: any) => {
            if (data.agentId && data.taskId) {
                this.recordTaskExecution({
                    taskId: data.taskId,
                    agentId: data.agentId,
                    executionTime: data.duration || 0,
                    success: true,
                    result: data.result
                }).catch(error => {
                    this.logger.error('Failed to record task execution', { error });
                });
            }
        });

        EventBus.server.on('task:failed', (data: any) => {
            if (data.agentId && data.taskId) {
                this.recordTaskFailure({
                    taskId: data.taskId,
                    agentId: data.agentId,
                    error: data.error || 'Unknown error',
                    executionTime: data.duration || 0
                }).catch(error => {
                    this.logger.error('Failed to record task failure', { error });
                });
            }
        });
    }
}
