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
 * AutoCorrectionIntegrationService - Phase 4 Auto-Correction System Integration
 * 
 * Provides integration points between all auto-correction components:
 * - EventBus coordination for loose coupling
 * - PatternLearningService integration
 * - Cross-service communication and orchestration
 * - System-wide auto-correction metrics and monitoring
 * - Configuration management across all services
 */

import { Observable, Subject, combineLatest } from 'rxjs';
import { map, filter } from 'rxjs/operators';
import { Logger } from '../utils/Logger';
import { EventBus } from '../events/EventBus';
import { Events } from '../events/EventNames';
import { AutoCorrectionService, CorrectionAttempt } from './AutoCorrectionService';
import { ToolExecutionInterceptor, InterceptorExecutionResult } from './ToolExecutionInterceptor';
import { RecoveryWorkflowService, RecoveryWorkflow } from './RecoveryWorkflowService';
import { ValidationPerformanceService } from './ValidationPerformanceService';
import { PatternLearningService } from './PatternLearningService';
import { AgentId } from '../types/Agent';
import { ChannelId } from '../types/ChannelContext';

/**
 * System-wide auto-correction metrics
 */
export interface SystemAutoCorrectionMetrics {
    correctionService: {
        totalAttempts: number;
        successfulCorrections: number;
        successRate: number;
        strategiesUsed: Record<string, number>;
        mostSuccessfulStrategy: string | null;
    };
    interceptor: {
        totalExecutions: number;
        successfulExecutions: number;
        failedExecutions: number;
        correctionsApplied: number;
        averageExecutionTime: number;
    };
    recoveryWorkflows: {
        totalWorkflows: number;
        successfulRecoveries: number;
        escalatedWorkflows: number;
        circuitBreakerActivations: number;
        averageRecoveryTime: number;
        learnedPatterns: number;
    };
    patternLearning: {
        totalPatterns: number;
        successfulPatterns: number;
        failedPatterns: number;
        sharedPatterns: number;
        crossAgentLearning: number;
    };
    overall: {
        systemHealthScore: number;
        errorReductionPercentage: number;
        learningEffectiveness: number;
        userSatisfactionScore: number;
    };
}

/**
 * Auto-correction system event
 */
export interface AutoCorrectionSystemEvent {
    timestamp: number;
    agentId: AgentId;
    channelId: ChannelId;
    eventType: 'correction_success' | 'correction_failure' | 'pattern_learned' | 'workflow_completed' | 'escalation_required';
    component: 'correction' | 'interceptor' | 'recovery' | 'pattern_learning';
    details: {
        toolName?: string;
        strategy?: string;
        confidence?: number;
        recoveryTime?: number;
        patternId?: string;
        workflowId?: string;
        [key: string]: any;
    };
}

/**
 * Integration service configuration
 */
export interface IntegrationConfig {
    enableCrossServiceLearning: boolean;
    enableSystemMetrics: boolean;
    enableEventAggregation: boolean;
    metricsUpdateIntervalMs: number;
    eventRetentionHours: number;
    enableAutomaticOptimization: boolean;
    optimizationThresholds: {
        lowSuccessRate: number;
        highErrorRate: number;
        slowRecoveryTime: number;
    };
}

/**
 * Auto-correction integration service for system coordination
 */
export class AutoCorrectionIntegrationService {
    private readonly logger: Logger;
    
    // Service references
    private readonly correctionService: AutoCorrectionService;
    private readonly interceptor: ToolExecutionInterceptor;
    private readonly recoveryService: RecoveryWorkflowService;
    private readonly validationService: ValidationPerformanceService;
    private readonly patternService: PatternLearningService;
    
    // Event aggregation
    private readonly systemEvents$ = new Subject<AutoCorrectionSystemEvent>();
    private readonly eventHistory: AutoCorrectionSystemEvent[] = [];
    
    // Metrics tracking
    private currentMetrics: SystemAutoCorrectionMetrics | null = null;
    private metricsUpdateTimer: NodeJS.Timeout | null = null;
    
    // Configuration
    private config: IntegrationConfig;
    
    private static instance: AutoCorrectionIntegrationService;

    private constructor() {
        this.logger = new Logger('info', 'AutoCorrectionIntegrationService', 'server');
        
        // Initialize service references
        this.correctionService = AutoCorrectionService.getInstance();
        this.interceptor = ToolExecutionInterceptor.getInstance();
        this.recoveryService = RecoveryWorkflowService.getInstance();
        this.validationService = ValidationPerformanceService.getInstance();
        this.patternService = PatternLearningService.getInstance();
        
        this.config = this.getDefaultConfig();
        this.setupIntegrationPoints();
        this.startMetricsCollection();
        
    }

    /**
     * Get singleton instance
     */
    public static getInstance(): AutoCorrectionIntegrationService {
        if (!AutoCorrectionIntegrationService.instance) {
            AutoCorrectionIntegrationService.instance = new AutoCorrectionIntegrationService();
        }
        return AutoCorrectionIntegrationService.instance;
    }

    // =============================================================================
    // INTEGRATION SETUP AND COORDINATION
    // =============================================================================

    /**
     * Setup integration points between all services
     */
    private setupIntegrationPoints(): void {

        // Auto-correction service events
        this.correctionService.correctionEvents.subscribe(attempt => {
            this.handleCorrectionEvent(attempt);
            
            if (this.config.enableCrossServiceLearning && attempt.successful) {
                this.coordinateCrossServiceLearning(attempt);
            }
        });

        // Tool execution interceptor events
        this.interceptor.interceptionEvents.subscribe(event => {
            this.handleInterceptorEvent(event);
        });

        // Recovery workflow events
        this.recoveryService.workflowEvents.subscribe(event => {
            this.handleRecoveryWorkflowEvent(event);
        });

        // Pattern learning events
        this.patternService.patternLearningEvents.subscribe(event => {
            this.handlePatternLearningEvent(event);
        });

        // EventBus integration for system-wide coordination
        this.setupEventBusIntegration();
        
    }

    /**
     * Setup EventBus integration for loose coupling
     */
    private setupEventBusIntegration(): void {
        // Listen for tool errors and coordinate response
        EventBus.server.on(Events.Mcp.TOOL_ERROR, async (payload) => {
            if (payload.agentId && payload.channelId && payload.toolName) {
                await this.coordinateErrorResponse(
                    payload.agentId,
                    payload.channelId,
                    payload.toolName, 
                    payload.error || 'Unknown error',
                    payload.parameters
                );
            }
        });

        // Listen for successful tool executions for learning
        EventBus.server.on(Events.Mcp.TOOL_RESULT, async (payload) => {
            if (this.config.enableCrossServiceLearning && payload.agentId && payload.channelId) {
                await this.coordinateSuccessLearning(
                    payload.agentId,
                    payload.channelId,
                    payload.toolName || payload.data?.toolName,
                    payload.parameters || payload.data?.parameters
                );
            }
        });

        // Emit system events to EventBus for external consumers
        this.systemEvents$.subscribe(event => {
            EventBus.server.emit('auto_correction_system_event', event);
        });
    }

    /**
     * Coordinate response to tool errors across all services
     */
    private async coordinateErrorResponse(
        agentId: AgentId,
        channelId: ChannelId,
        toolName: string,
        errorMessage: string,
        parameters?: Record<string, any>
    ): Promise<void> {

        try {
            // 1. Update validation performance metrics
            // This is already handled by ValidationPerformanceService event listeners

            // 2. Store failed pattern for learning if parameters available
            if (parameters) {
                const errorType = this.categorizeError(errorMessage);
                await this.patternService.storeFailedPattern(
                    agentId,
                    channelId,
                    toolName,
                    parameters,
                    errorType,
                    errorMessage
                );
            }

            // 3. Check if auto-correction should be attempted
            const shouldAttemptCorrection = this.shouldAttemptAutoCorrection(toolName, errorMessage);
            
            if (shouldAttemptCorrection) {
                this.emitSystemEvent({
                    agentId,
                    channelId,
                    eventType: 'correction_failure',
                    component: 'correction',
                    details: {
                        toolName,
                        error: errorMessage,
                        coordinatedResponse: true
                    }
                });
            }

        } catch (error) {
            this.logger.warn(`Failed to coordinate error response: ${error}`);
        }
    }

    /**
     * Coordinate learning from successful executions
     */
    private async coordinateSuccessLearning(
        agentId: AgentId, 
        channelId: ChannelId,
        toolName?: string,
        parameters?: Record<string, any>
    ): Promise<void> {
        if (!toolName || !parameters) return;

        try {
            // Store successful pattern
            await this.patternService.storeSuccessfulPattern(
                agentId,
                channelId,
                toolName,
                parameters
            );

            this.emitSystemEvent({
                agentId,
                channelId,
                eventType: 'pattern_learned',
                component: 'pattern_learning',
                details: {
                    toolName,
                    learningType: 'success_pattern'
                }
            });

        } catch (error) {
            this.logger.warn(`Failed to coordinate success learning: ${error}`);
        }
    }

    /**
     * Coordinate cross-service learning from successful corrections
     */
    private async coordinateCrossServiceLearning(attempt: CorrectionAttempt): Promise<void> {

        try {
            // Update validation performance with successful self-correction
            // This is already handled by ValidationPerformanceService

            // Share successful correction pattern across channels if highly confident
            if (attempt.confidence > 0.8) {
                // Store as high-confidence shared pattern
                await this.patternService.storeSuccessfulPattern(
                    attempt.agentId,
                    attempt.channelId,
                    attempt.toolName,
                    attempt.correctedParameters,
                    attempt.recoveryTime,
                    {
                        correctionStrategy: attempt.strategy,
                        originalError: attempt.errorMessage,
                        shared: true
                    }
                );
            }

            this.emitSystemEvent({
                agentId: attempt.agentId,
                channelId: attempt.channelId,
                eventType: 'correction_success',
                component: 'correction',
                details: {
                    toolName: attempt.toolName,
                    strategy: attempt.strategy,
                    confidence: attempt.confidence,
                    recoveryTime: attempt.recoveryTime,
                    crossServiceLearning: true
                }
            });

        } catch (error) {
            this.logger.warn(`Failed to coordinate cross-service learning: ${error}`);
        }
    }

    // =============================================================================
    // EVENT HANDLING
    // =============================================================================

    /**
     * Handle correction service events
     */
    private handleCorrectionEvent(attempt: CorrectionAttempt): void {
        this.emitSystemEvent({
            agentId: attempt.agentId,
            channelId: attempt.channelId,
            eventType: attempt.successful ? 'correction_success' : 'correction_failure',
            component: 'correction',
            details: {
                toolName: attempt.toolName,
                strategy: attempt.strategy,
                confidence: attempt.confidence,
                recoveryTime: attempt.recoveryTime,
                attemptId: attempt.attemptId
            }
        });
    }

    /**
     * Handle interceptor events
     */
    private handleInterceptorEvent(event: any): void {
        if (event.type === 'correction_applied') {
            this.emitSystemEvent({
                agentId: event.context.agentId,
                channelId: event.context.channelId,
                eventType: 'correction_success',
                component: 'interceptor',
                details: {
                    toolName: event.context.toolName,
                    intercepted: true
                }
            });
        }
    }

    /**
     * Handle recovery workflow events
     */
    private handleRecoveryWorkflowEvent(event: any): void {
        if (event.type === 'workflow_completed') {
            this.emitSystemEvent({
                agentId: event.workflow.agentId,
                channelId: event.workflow.channelId,
                eventType: 'workflow_completed',
                component: 'recovery',
                details: {
                    workflowId: event.workflow.workflowId,
                    toolName: event.workflow.toolName,
                    workflowType: event.workflow.workflowType,
                    status: event.workflow.status,
                    attempts: event.workflow.attempts.length,
                    recoveryTime: event.workflow.finalOutcome?.totalRecoveryTime
                }
            });
        } else if (event.type === 'escalation_triggered') {
            this.emitSystemEvent({
                agentId: event.workflow.agentId,
                channelId: event.workflow.channelId,
                eventType: 'escalation_required',
                component: 'recovery',
                details: {
                    workflowId: event.workflow.workflowId,
                    toolName: event.workflow.toolName,
                    escalationReason: event.workflow.escalationReason
                }
            });
        }
    }

    /**
     * Handle pattern learning events
     */
    private handlePatternLearningEvent(event: any): void {
        this.emitSystemEvent({
            agentId: event.agentId,
            channelId: event.channelId,
            eventType: 'pattern_learned',
            component: 'pattern_learning',
            details: {
                toolName: event.toolName,
                eventType: event.eventType,
                patternId: event.details?.patternId,
                confidence: event.details?.confidenceScore
            }
        });
    }

    /**
     * Emit system event
     */
    private emitSystemEvent(event: Omit<AutoCorrectionSystemEvent, 'timestamp'>): void {
        const fullEvent: AutoCorrectionSystemEvent = {
            timestamp: Date.now(),
            ...event
        };

        this.systemEvents$.next(fullEvent);
        this.eventHistory.push(fullEvent);

        // Clean up old events
        const cutoffTime = Date.now() - (this.config.eventRetentionHours * 60 * 60 * 1000);
        const validEvents = this.eventHistory.filter(e => e.timestamp > cutoffTime);
        this.eventHistory.splice(0, this.eventHistory.length - validEvents.length);
    }

    // =============================================================================
    // METRICS AND MONITORING
    // =============================================================================

    /**
     * Start metrics collection
     */
    private startMetricsCollection(): void {
        if (!this.config.enableSystemMetrics) return;

        this.metricsUpdateTimer = setInterval(async () => {
            try {
                this.currentMetrics = await this.collectSystemMetrics();
                
                // Emit metrics event
                EventBus.server.emit('auto_correction_metrics_updated', this.currentMetrics);
                
                // Check for optimization opportunities
                if (this.config.enableAutomaticOptimization) {
                    await this.checkOptimizationOpportunities();
                }

            } catch (error) {
                this.logger.warn(`Failed to collect system metrics: ${error}`);
            }
        }, this.config.metricsUpdateIntervalMs);
    }

    /**
     * Collect comprehensive system metrics
     */
    private async collectSystemMetrics(): Promise<SystemAutoCorrectionMetrics> {
        const correctionStats = this.correctionService.getCorrectionStats();
        const interceptorStats = this.interceptor.getExecutionStats();
        const recoveryStats = this.recoveryService.getRecoveryStats();

        // Calculate pattern learning metrics
        const patternMetrics = {
            totalPatterns: 0,
            successfulPatterns: 0,
            failedPatterns: 0,
            sharedPatterns: 0,
            crossAgentLearning: 0
        };

        // Calculate overall system health
        const systemHealthScore = this.calculateSystemHealthScore(
            correctionStats,
            interceptorStats,
            recoveryStats
        );

        const errorReductionPercentage = this.calculateErrorReduction();
        const learningEffectiveness = this.calculateLearningEffectiveness();

        return {
            correctionService: correctionStats,
            interceptor: interceptorStats,
            recoveryWorkflows: recoveryStats,
            patternLearning: patternMetrics,
            overall: {
                systemHealthScore,
                errorReductionPercentage,
                learningEffectiveness,
                userSatisfactionScore: 0.85 // Placeholder - would be calculated from user feedback
            }
        };
    }

    /**
     * Calculate system health score
     */
    private calculateSystemHealthScore(
        correctionStats: any,
        interceptorStats: any, 
        recoveryStats: any
    ): number {
        const weights = {
            correctionSuccess: 0.3,
            executionSuccess: 0.3,
            recoverySuccess: 0.2,
            escalationRate: 0.2
        };

        const scores = {
            correctionSuccess: correctionStats.successRate,
            executionSuccess: interceptorStats.totalExecutions > 0 
                ? interceptorStats.successfulExecutions / interceptorStats.totalExecutions 
                : 1.0,
            recoverySuccess: recoveryStats.totalWorkflows > 0
                ? recoveryStats.successfulRecoveries / recoveryStats.totalWorkflows
                : 1.0,
            escalationRate: recoveryStats.totalWorkflows > 0
                ? 1 - (recoveryStats.escalatedWorkflows / recoveryStats.totalWorkflows)
                : 1.0
        };

        return Object.entries(weights).reduce((total, [key, weight]) => {
            return total + (scores[key as keyof typeof scores] * weight);
        }, 0);
    }

    /**
     * Calculate error reduction percentage
     */
    private calculateErrorReduction(): number {
        // This would compare current error rates to baseline
        // For now, return a placeholder based on system events
        const recentEvents = this.eventHistory.filter(e => 
            e.timestamp > Date.now() - (24 * 60 * 60 * 1000) // Last 24 hours
        );

        const corrections = recentEvents.filter(e => e.eventType === 'correction_success').length;
        const failures = recentEvents.filter(e => e.eventType === 'correction_failure').length;

        return corrections + failures > 0 ? (corrections / (corrections + failures)) * 100 : 0;
    }

    /**
     * Calculate learning effectiveness
     */
    private calculateLearningEffectiveness(): number {
        const recentLearningEvents = this.eventHistory.filter(e => 
            e.eventType === 'pattern_learned' && 
            e.timestamp > Date.now() - (7 * 24 * 60 * 60 * 1000) // Last 7 days
        );

        // Simple metric based on learning frequency
        return Math.min(recentLearningEvents.length / 10, 1.0); // Cap at 1.0
    }

    /**
     * Check for optimization opportunities
     */
    private async checkOptimizationOpportunities(): Promise<void> {
        if (!this.currentMetrics) return;

        const { optimizationThresholds } = this.config;
        const recommendations: string[] = [];

        // Check correction success rate
        if (this.currentMetrics.correctionService.successRate < optimizationThresholds.lowSuccessRate) {
            recommendations.push('Consider adjusting correction strategies - low success rate detected');
            
            // Auto-adjust confidence threshold
            const currentConfig = this.correctionService.getConfig();
            if (currentConfig.confidenceThreshold > 0.5) {
                this.correctionService.updateConfig({
                    confidenceThreshold: currentConfig.confidenceThreshold - 0.1
                });
            }
        }

        // Check recovery time
        if (this.currentMetrics.recoveryWorkflows.averageRecoveryTime > optimizationThresholds.slowRecoveryTime) {
            recommendations.push('Recovery workflows are taking too long - consider optimizing strategies');
        }

        // Check overall system health
        if (this.currentMetrics.overall.systemHealthScore < 0.7) {
            recommendations.push('System health is below optimal - review configuration and patterns');
        }

        if (recommendations.length > 0) {
            this.logger.warn('🔍 Optimization opportunities detected:', recommendations);
            EventBus.server.emit('auto_correction_optimization_needed', {
                recommendations,
                metrics: this.currentMetrics
            });
        }
    }

    // =============================================================================
    // HELPER METHODS
    // =============================================================================

    /**
     * Determine if auto-correction should be attempted
     */
    private shouldAttemptAutoCorrection(toolName: string, errorMessage: string): boolean {
        // Simple validation error detection
        const validationKeywords = ['required', 'missing', 'invalid', 'validation', 'schema'];
        return validationKeywords.some(keyword => 
            errorMessage.toLowerCase().includes(keyword)
        );
    }

    /**
     * Categorize error for pattern matching
     */
    private categorizeError(errorMessage: string): string {
        const errorLower = errorMessage.toLowerCase();
        
        if (errorLower.includes('required') || errorLower.includes('missing')) return 'missingRequired';
        if (errorLower.includes('unknown') && errorLower.includes('propert')) return 'unknownProperties';
        if (errorLower.includes('type') || errorLower.includes('invalid')) return 'typeMismatch';
        
        return 'other';
    }

    /**
     * Get default configuration
     */
    private getDefaultConfig(): IntegrationConfig {
        return {
            enableCrossServiceLearning: true,
            enableSystemMetrics: true,
            enableEventAggregation: true,
            metricsUpdateIntervalMs: 60000, // 1 minute
            eventRetentionHours: 24,
            enableAutomaticOptimization: true,
            optimizationThresholds: {
                lowSuccessRate: 0.7,
                highErrorRate: 0.3,
                slowRecoveryTime: 10000 // 10 seconds
            }
        };
    }

    // =============================================================================
    // PUBLIC API
    // =============================================================================

    /**
     * Get system events observable
     */
    public get systemEvents(): Observable<AutoCorrectionSystemEvent> {
        return this.systemEvents$.asObservable();
    }

    /**
     * Get current system metrics
     */
    public getCurrentMetrics(): SystemAutoCorrectionMetrics | null {
        return this.currentMetrics;
    }

    /**
     * Get system event history
     */
    public getEventHistory(hours?: number): AutoCorrectionSystemEvent[] {
        if (!hours) return [...this.eventHistory];
        
        const cutoffTime = Date.now() - (hours * 60 * 60 * 1000);
        return this.eventHistory.filter(e => e.timestamp > cutoffTime);
    }

    /**
     * Update integration configuration
     */
    public updateConfig(newConfig: Partial<IntegrationConfig>): void {
        this.config = { ...this.config, ...newConfig };
        
        // Restart metrics collection if interval changed
        if (newConfig.metricsUpdateIntervalMs && this.metricsUpdateTimer) {
            clearInterval(this.metricsUpdateTimer);
            this.startMetricsCollection();
        }
    }

    /**
     * Get current configuration
     */
    public getConfig(): IntegrationConfig {
        return { ...this.config };
    }

    /**
     * Force metrics update
     */
    public async forceMetricsUpdate(): Promise<SystemAutoCorrectionMetrics> {
        this.currentMetrics = await this.collectSystemMetrics();
        return this.currentMetrics;
    }

    /**
     * Get system health status
     */
    public getSystemHealthStatus(): {
        status: 'healthy' | 'warning' | 'critical';
        score: number;
        issues: string[];
        recommendations: string[];
    } {
        if (!this.currentMetrics) {
            return {
                status: 'warning',
                score: 0.5,
                issues: ['Metrics not available'],
                recommendations: ['Wait for metrics collection to complete']
            };
        }

        const score = this.currentMetrics.overall.systemHealthScore;
        const issues: string[] = [];
        const recommendations: string[] = [];

        if (score < 0.5) {
            issues.push('Critical system health score');
            recommendations.push('Review all service configurations and error patterns');
        } else if (score < 0.7) {
            issues.push('Below optimal system health');
            recommendations.push('Monitor correction strategies and success rates');
        }

        return {
            status: score >= 0.7 ? 'healthy' : score >= 0.5 ? 'warning' : 'critical',
            score,
            issues,
            recommendations
        };
    }

    /**
     * Shutdown integration service
     */
    public shutdown(): void {
        if (this.metricsUpdateTimer) {
            clearInterval(this.metricsUpdateTimer);
            this.metricsUpdateTimer = null;
        }
        
        this.systemEvents$.complete();
    }
}