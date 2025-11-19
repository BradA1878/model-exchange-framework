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
 * Validation Performance Service
 * Phase 1: Extension of AgentPerformanceService for validation metrics
 */

import { Observable, Subject, of } from 'rxjs';
import { Logger } from '../utils/Logger';
import { EventBus } from '../events/EventBus';
import { Events } from '../events/EventNames';
import { AgentPerformanceService } from './AgentPerformanceService';
import { 
    ValidationMetrics, 
    ValidationEvent,
    ValidationPerformanceAnalysis,
    EnhancedToolUsageMetrics
} from '../types/ValidationPerformanceTypes';
import { AgentId } from '../types/Agent';
import { ChannelId } from '../types/ChannelContext';

/**
 * Service for tracking validation-specific performance metrics
 */
export class ValidationPerformanceService {
    private readonly logger: Logger;
    private readonly performanceService: AgentPerformanceService;
    
    // Validation metrics cache
    private readonly validationMetrics = new Map<string, ValidationMetrics>();
    
    // Event tracking for recovery time calculation
    private readonly errorTimestamps = new Map<string, number>();
    
    // Observable for validation events
    private readonly validationEvents$ = new Subject<ValidationEvent>();
    
    private static instance: ValidationPerformanceService;

    private constructor() {
        this.logger = new Logger('info', 'ValidationPerformanceService', 'server');
        this.performanceService = AgentPerformanceService.getInstance();
        
        this.setupEventListeners();
    }

    /**
     * Get singleton instance
     */
    public static getInstance(): ValidationPerformanceService {
        if (!ValidationPerformanceService.instance) {
            ValidationPerformanceService.instance = new ValidationPerformanceService();
        }
        return ValidationPerformanceService.instance;
    }

    // =============================================================================
    // EVENT LISTENERS FOR VALIDATION TRACKING
    // =============================================================================

    private setupEventListeners(): void {
        // Track validation errors
        EventBus.server.on(Events.Mcp.TOOL_ERROR, (payload) => {
            const error = payload.error || payload.data?.error || payload.data?.errorMessage;
            if (this.isValidationError(error)) {
                this.trackValidationError(
                    payload.agentId,
                    payload.channelId,
                    payload.data?.toolName || payload.toolName,
                    error,
                    payload.data?.parameters
                );
            }
        });

        // Track successful tool calls (for success rate calculation)
        EventBus.server.on(Events.Mcp.TOOL_RESULT, (payload) => {
            this.trackValidationSuccess(
                payload.agentId,
                payload.channelId,
                payload.data?.toolName || payload.toolName
            );
        });

        // Track help tool usage
        EventBus.server.on(Events.Mcp.TOOL_CALL, (payload) => {
            const toolName = payload.data?.toolName || payload.toolName;
            if (this.isHelpTool(toolName)) {
                this.trackHelpToolUsage(
                    payload.agentId,
                    payload.channelId,
                    toolName,
                    payload.data?.parameters
                );
            }
        });

    }

    // =============================================================================
    // VALIDATION METRICS METHODS
    // =============================================================================

    /**
     * Get validation metrics for an agent
     */
    public async getValidationMetrics(
        agentId: AgentId,
        channelId: ChannelId
    ): Promise<ValidationMetrics> {
        const cacheKey = `${agentId}:${channelId}`;
        
        let metrics = this.validationMetrics.get(cacheKey);
        if (!metrics) {
            metrics = this.createInitialValidationMetrics();
            this.validationMetrics.set(cacheKey, metrics);
        }
        
        return metrics;
    }

    /**
     * Analyze validation performance
     */
    public async analyzeValidationPerformance(
        agentId: AgentId,
        channelId: ChannelId
    ): Promise<ValidationPerformanceAnalysis> {
        const metrics = await this.getValidationMetrics(agentId, channelId);
        
        // Calculate validation health score
        const validationHealthScore = this.calculateHealthScore(metrics);
        
        // Identify problem areas
        const problemAreas = this.identifyProblemAreas(metrics);
        
        // Assess learning effectiveness
        const learningEffectiveness = this.assessLearningEffectiveness(metrics);
        
        // Generate recommendations
        const recommendations = this.generateRecommendations(metrics, problemAreas);
        
        return {
            validationHealthScore,
            problemAreas,
            learningEffectiveness,
            recommendations
        };
    }

    // =============================================================================
    // TRACKING METHODS
    // =============================================================================

    private async trackValidationError(
        agentId: AgentId,
        channelId: ChannelId,
        toolName: string,
        error: string,
        parameters?: any
    ): Promise<void> {
        const metrics = await this.getValidationMetrics(agentId, channelId);
        
        // Update error counts
        metrics.totalValidationErrors++;
        metrics.validationErrorsByTool[toolName] = 
            (metrics.validationErrorsByTool[toolName] || 0) + 1;
        
        // Categorize error type
        const errorType = this.categorizeError(error);
        metrics.errorTypes[errorType]++;
        
        // Track failed pattern
        if (parameters) {
            if (!metrics.parameterPatterns.failedPatterns[toolName]) {
                metrics.parameterPatterns.failedPatterns[toolName] = [];
            }
            
            const existingPattern = metrics.parameterPatterns.failedPatterns[toolName]
                .find(p => JSON.stringify(p.parameters) === JSON.stringify(parameters));
            
            if (existingPattern) {
                existingPattern.frequency++;
                existingPattern.lastSeen = Date.now();
            } else {
                metrics.parameterPatterns.failedPatterns[toolName].push({
                    parameters,
                    errorType,
                    frequency: 1,
                    lastSeen: Date.now()
                });
            }
        }
        
        // Store timestamp for recovery tracking
        const errorKey = `${agentId}:${channelId}:${toolName}`;
        this.errorTimestamps.set(errorKey, Date.now());
        
        // Update efficiency metrics
        this.updateEfficiencyMetrics(metrics);
        
        // Emit event
        this.emitValidationEvent({
            timestamp: Date.now(),
            agentId,
            channelId,
            toolName,
            eventType: 'validation_error',
            details: {
                parameters,
                error,
                errorType
            }
        });
        
        metrics.lastUpdated = Date.now();
    }

    private async trackValidationSuccess(
        agentId: AgentId,
        channelId: ChannelId,
        toolName: string,
        parameters?: any
    ): Promise<void> {
        const metrics = await this.getValidationMetrics(agentId, channelId);
        
        // Check if this is a recovery from error
        const errorKey = `${agentId}:${channelId}:${toolName}`;
        const errorTimestamp = this.errorTimestamps.get(errorKey);
        
        if (errorTimestamp) {
            const recoveryTime = Date.now() - errorTimestamp;
            
            // Update recovery metrics
            const currentAvg = metrics.recoveryTime.averageRecoveryTime;
            const count = metrics.selfCorrection.successfulCorrections;
            metrics.recoveryTime.averageRecoveryTime = 
                (currentAvg * count + recoveryTime) / (count + 1);
            
            if (recoveryTime < metrics.recoveryTime.fastestRecovery || 
                metrics.recoveryTime.fastestRecovery === 0) {
                metrics.recoveryTime.fastestRecovery = recoveryTime;
            }
            
            if (recoveryTime > metrics.recoveryTime.slowestRecovery) {
                metrics.recoveryTime.slowestRecovery = recoveryTime;
            }
            
            metrics.recoveryTime.byTool[toolName] = recoveryTime;
            
            // Track self-correction
            metrics.selfCorrection.successfulCorrections++;
            if (!metrics.selfCorrection.correctedTools.includes(toolName)) {
                metrics.selfCorrection.correctedTools.push(toolName);
            }
            
            // Clear error timestamp
            this.errorTimestamps.delete(errorKey);
            
            // Emit self-correction event
            this.emitValidationEvent({
                timestamp: Date.now(),
                agentId,
                channelId,
                toolName,
                eventType: 'self_correction',
                details: {
                    recoveryTime,
                    correctionAttempt: 1 // TODO: Track actual attempts
                }
            });
            
            // Update efficiency metrics after self-correction
            this.updateEfficiencyMetrics(metrics);
        }
        
        // Track successful pattern
        if (parameters) {
            if (!metrics.parameterPatterns.successfulPatterns[toolName]) {
                metrics.parameterPatterns.successfulPatterns[toolName] = [];
            }
            
            const existingPattern = metrics.parameterPatterns.successfulPatterns[toolName]
                .find(p => JSON.stringify(p.parameters) === JSON.stringify(parameters));
            
            if (existingPattern) {
                existingPattern.frequency++;
                existingPattern.lastUsed = Date.now();
            } else {
                metrics.parameterPatterns.successfulPatterns[toolName].push({
                    parameters,
                    frequency: 1,
                    lastUsed: Date.now()
                });
            }
            
            // Emit parameter learned event
            this.emitValidationEvent({
                timestamp: Date.now(),
                agentId,
                channelId,
                toolName,
                eventType: 'parameter_learned',
                details: { parameters }
            });
        }
        
        metrics.lastUpdated = Date.now();
    }

    private async trackHelpToolUsage(
        agentId: AgentId,
        channelId: ChannelId,
        helpTool: string,
        parameters?: any
    ): Promise<void> {
        const metrics = await this.getValidationMetrics(agentId, channelId);
        
        // Update help tool usage
        if (helpTool in metrics.helpToolUsage) {
            metrics.helpToolUsage[helpTool as keyof typeof metrics.helpToolUsage]++;
        }
        
        // Emit event
        this.emitValidationEvent({
            timestamp: Date.now(),
            agentId,
            channelId,
            toolName: parameters?.name || parameters?.toolName || 'unknown',
            eventType: 'help_tool_used',
            details: {
                helpToolUsed: helpTool,
                parameters
            }
        });
        
        metrics.lastUpdated = Date.now();
    }

    // =============================================================================
    // ANALYSIS METHODS
    // =============================================================================

    private calculateHealthScore(metrics: ValidationMetrics): number {
        // Weighted scoring based on key metrics
        const weights = {
            firstTrySuccess: 0.4,
            selfCorrection: 0.3,
            helpToolUsage: 0.2,
            trend: 0.1
        };
        
        const scores = {
            firstTrySuccess: metrics.efficiency.firstTrySuccessRate,
            selfCorrection: metrics.efficiency.selfCorrectionRate,
            helpToolUsage: Math.min(metrics.efficiency.helpToolUsageRate * 2, 1), // Encourage help tool usage
            trend: metrics.efficiency.trend === 'improving' ? 1 : 
                   metrics.efficiency.trend === 'stable' ? 0.7 : 0.4
        };
        
        return Object.entries(weights).reduce((total, [key, weight]) => {
            return total + (scores[key as keyof typeof scores] * weight);
        }, 0);
    }

    private identifyProblemAreas(metrics: ValidationMetrics): Array<{
        tool: string;
        errorRate: number;
        commonErrors: string[];
        suggestedActions: string[];
    }> {
        const problemAreas = [];
        
        for (const [tool, errorCount] of Object.entries(metrics.validationErrorsByTool)) {
            if (errorCount > 3) { // Threshold for problem area
                const failedPatterns = metrics.parameterPatterns.failedPatterns[tool] || [];
                const commonErrors = [...new Set(failedPatterns.map(p => p.errorType))];
                
                problemAreas.push({
                    tool,
                    errorRate: errorCount / (errorCount + 1), // TODO: Track total attempts
                    commonErrors,
                    suggestedActions: this.generateToolSpecificActions(tool, commonErrors)
                });
            }
        }
        
        return problemAreas.sort((a, b) => b.errorRate - a.errorRate);
    }

    private assessLearningEffectiveness(metrics: ValidationMetrics): {
        learningRate: number;
        masteredTools: string[];
        learningTools: string[];
        strugglingTools: string[];
    } {
        const toolCategories = {
            mastered: [] as string[],
            learning: [] as string[],
            struggling: [] as string[]
        };
        
        // Analyze each tool's performance
        for (const [tool, errorCount] of Object.entries(metrics.validationErrorsByTool)) {
            const successfulPatterns = metrics.parameterPatterns.successfulPatterns[tool]?.length || 0;
            const failedPatterns = metrics.parameterPatterns.failedPatterns[tool]?.length || 0;
            
            if (successfulPatterns > failedPatterns * 2 && errorCount < 2) {
                toolCategories.mastered.push(tool);
            } else if (metrics.selfCorrection.correctedTools.includes(tool)) {
                toolCategories.learning.push(tool);
            } else if (errorCount > 5) {
                toolCategories.struggling.push(tool);
            }
        }
        
        // Calculate learning rate based on self-correction success
        const learningRate = metrics.selfCorrection.successfulCorrections > 0
            ? metrics.selfCorrection.successfulCorrections / 
              (metrics.selfCorrection.successfulCorrections + metrics.selfCorrection.failedCorrections)
            : 0;
        
        return {
            learningRate,
            masteredTools: toolCategories.mastered,
            learningTools: toolCategories.learning,
            strugglingTools: toolCategories.struggling
        };
    }

    private generateRecommendations(
        metrics: ValidationMetrics,
        problemAreas: any[]
    ): Array<{
        priority: 'high' | 'medium' | 'low';
        action: string;
        expectedImprovement: string;
        tools: string[];
    }> {
        const recommendations = [];
        
        // High priority: Tools with high error rates
        for (const problem of problemAreas.slice(0, 3)) {
            recommendations.push({
                priority: 'high' as const,
                action: `Use tool_help to understand ${problem.tool} parameters`,
                expectedImprovement: `Reduce ${problem.tool} errors by 50%`,
                tools: ['tool_help', problem.tool]
            });
        }
        
        // Medium priority: Improve help tool usage
        if (metrics.efficiency.helpToolUsageRate < 0.3) {
            recommendations.push({
                priority: 'medium' as const,
                action: 'Increase usage of help tools when encountering errors',
                expectedImprovement: 'Faster error recovery and learning',
                tools: ['tool_help', 'tool_validate', 'tool_quick_reference']
            });
        }
        
        // Low priority: Optimize successful patterns
        if (metrics.efficiency.firstTrySuccessRate > 0.8) {
            recommendations.push({
                priority: 'low' as const,
                action: 'Share successful parameter patterns with other agents',
                expectedImprovement: 'Help other agents avoid common mistakes',
                tools: ['memory_store', 'agent_broadcast']
            });
        }
        
        return recommendations;
    }

    // =============================================================================
    // HELPER METHODS
    // =============================================================================

    private isValidationError(error: string | undefined): boolean {
        if (!error || typeof error !== 'string') {
            return false;
        }
        
        const validationKeywords = [
            'Invalid input',
            'validation',
            'schema',
            'required',
            'type',
            'Missing required',
            'Unknown properties',
            'Expected'
        ];
        
        return validationKeywords.some(keyword => 
            error.toLowerCase().includes(keyword.toLowerCase())
        );
    }

    private isHelpTool(toolName: string): boolean {
        return [
            'tool_help',
            'tool_validate', 
            'tool_quick_reference',
            'tool_validation_tips'
        ].includes(toolName);
    }

    private categorizeError(error: string): keyof ValidationMetrics['errorTypes'] {
        if (error.includes('Missing required')) return 'missingRequired';
        if (error.includes('Unknown properties')) return 'unknownProperties';
        if (error.includes('type')) return 'typeMismatch';
        if (error.includes('constraint') || error.includes('minimum') || 
            error.includes('maximum') || error.includes('pattern')) return 'constraintViolation';
        return 'other';
    }

    private updateEfficiencyMetrics(metrics: ValidationMetrics): void {
        const totalAttempts = metrics.totalValidationErrors + 
            metrics.selfCorrection.successfulCorrections;
        
        if (totalAttempts > 0) {
            // First try success rate (inverse of error rate)
            // This is simplified - in production we'd track total attempts
            metrics.efficiency.firstTrySuccessRate = Math.max(
                0,
                1 - (metrics.totalValidationErrors / (totalAttempts * 2))
            );
            
            // Help tool usage rate
            const totalHelpUsage = Object.values(metrics.helpToolUsage).reduce((a, b) => a + b, 0);
            metrics.efficiency.helpToolUsageRate = 
                metrics.totalValidationErrors > 0 
                    ? totalHelpUsage / metrics.totalValidationErrors
                    : 0;
            
            // Self-correction rate
            metrics.efficiency.selfCorrectionRate = 
                metrics.totalValidationErrors > 0
                    ? metrics.selfCorrection.successfulCorrections / metrics.totalValidationErrors
                    : 0;
            
            // Determine trend (simplified)
            if (metrics.efficiency.selfCorrectionRate > 0.7) {
                metrics.efficiency.trend = 'improving';
            } else if (metrics.efficiency.selfCorrectionRate > 0.4) {
                metrics.efficiency.trend = 'stable';
            } else {
                metrics.efficiency.trend = 'declining';
            }
        }
    }

    private generateToolSpecificActions(tool: string, errorTypes: string[]): string[] {
        const actions = [];
        
        if (errorTypes.includes('missingRequired')) {
            actions.push(`Review required parameters for ${tool} using tool_help`);
        }
        if (errorTypes.includes('typeMismatch')) {
            actions.push(`Check parameter types in ${tool} schema`);
        }
        if (errorTypes.includes('unknownProperties')) {
            actions.push(`Use tool_validate before calling ${tool}`);
        }
        
        return actions;
    }

    private createInitialValidationMetrics(): ValidationMetrics {
        return {
            totalValidationErrors: 0,
            validationErrorsByTool: {},
            errorTypes: {
                missingRequired: 0,
                unknownProperties: 0,
                typeMismatch: 0,
                constraintViolation: 0,
                other: 0
            },
            helpToolUsage: {
                tool_help: 0,
                tool_validate: 0,
                tool_quick_reference: 0,
                tool_validation_tips: 0
            },
            selfCorrection: {
                successfulCorrections: 0,
                failedCorrections: 0,
                averageAttemptsToCorrect: 0,
                correctedTools: []
            },
            recoveryTime: {
                averageRecoveryTime: 0,
                fastestRecovery: 0,
                slowestRecovery: 0,
                byTool: {}
            },
            parameterPatterns: {
                successfulPatterns: {},
                failedPatterns: {}
            },
            efficiency: {
                firstTrySuccessRate: 1.0,
                helpToolUsageRate: 0,
                selfCorrectionRate: 0,
                trend: 'stable'
            },
            lastUpdated: Date.now()
        };
    }

    private emitValidationEvent(event: ValidationEvent): void {
        this.validationEvents$.next(event);
    }

    // =============================================================================
    // PUBLIC API
    // =============================================================================

    /**
     * Get observable for validation events
     */
    public get validationEvents(): Observable<ValidationEvent> {
        return this.validationEvents$.asObservable();
    }

    /**
     * Get enhanced tool usage metrics with validation data
     */
    public async getEnhancedToolMetrics(
        agentId: AgentId,
        channelId: ChannelId
    ): Promise<EnhancedToolUsageMetrics> {
        const metrics = await this.getValidationMetrics(agentId, channelId);
        
        // Calculate validation success rates per tool
        const toolValidationSuccessRates: Record<string, number> = {};
        for (const [tool, errorCount] of Object.entries(metrics.validationErrorsByTool)) {
            const successCount = metrics.parameterPatterns.successfulPatterns[tool]?.length || 0;
            const total = errorCount + successCount;
            toolValidationSuccessRates[tool] = total > 0 ? successCount / total : 0;
        }
        
        // Find common validation errors
        const commonValidationErrors: Record<string, string[]> = {};
        for (const [tool, patterns] of Object.entries(metrics.parameterPatterns.failedPatterns)) {
            commonValidationErrors[tool] = [...new Set(patterns.map(p => p.errorType))];
        }
        
        // Identify help-triggering tools
        const helpTriggeringTools = Object.entries(metrics.validationErrorsByTool)
            .filter(([_, errorCount]) => errorCount > 2)
            .map(([tool]) => tool);
        
        // Compile parameter corrections (simplified for now)
        const parameterCorrections = [];
        for (const tool of metrics.selfCorrection.correctedTools) {
            const failed = metrics.parameterPatterns.failedPatterns[tool]?.[0];
            const successful = metrics.parameterPatterns.successfulPatterns[tool]?.[0];
            
            if (failed && successful) {
                parameterCorrections.push({
                    tool,
                    originalParams: failed.parameters,
                    correctedParams: successful.parameters,
                    timestamp: successful.lastUsed,
                    successful: true
                });
            }
        }
        
        return {
            toolValidationSuccessRates,
            commonValidationErrors,
            helpTriggeringTools,
            parameterCorrections
        };
    }
}