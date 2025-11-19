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
 * ValidationMiddleware - Phase 5 Proactive Validation System
 * 
 * Middleware that intercepts ALL tool calls before execution to apply risk-based validation.
 * Integrates with ToolExecutionInterceptor and adds proactive validation layer.
 */

import { Observable, Subject } from 'rxjs';
import { Logger } from '../utils/Logger';
import { EventBus } from '../events/EventBus';
import { Events } from '../events/EventNames';
import { ProactiveValidationService, ValidationResult, ValidationLevel } from './ProactiveValidationService';
import { ValidationCacheService } from './ValidationCacheService';
import { ToolExecutionInterceptor, ToolExecutionContext } from './ToolExecutionInterceptor';
import { AgentId } from '../types/Agent';
import { ChannelId } from '../types/ChannelContext';

/**
 * Validation middleware result
 */
export interface ValidationMiddlewareResult {
    shouldProceed: boolean;
    validationResult: ValidationResult;
    blockedReason?: string;
    suggestedAlternatives?: string[];
    bypassValidation?: boolean;
}

/**
 * Middleware configuration
 */
export interface ValidationMiddlewareConfig {
    enabled: boolean;
    enforceBlocking: boolean;
    maxValidationTime: number; // ms
    fallbackOnTimeout: boolean;
    cacheValidationResults: boolean;
    logAllInterceptions: boolean;
    bypassForLowRiskTools: boolean;
    emergencyBypass: boolean;
}

/**
 * Middleware events
 */
export interface ValidationMiddlewareEvent {
    timestamp: number;
    agentId: AgentId;
    channelId: ChannelId;
    toolName: string;
    eventType: 'INTERCEPTED' | 'VALIDATED' | 'BLOCKED' | 'BYPASSED' | 'TIMEOUT';
    validationId: string;
    executionTime: number;
    details: any;
}

/**
 * Tool call interception wrapper
 */
export interface InterceptedToolCall {
    originalContext: ToolExecutionContext;
    validationResult: ValidationResult;
    interceptedAt: number;
    shouldExecute: boolean;
    metadata: {
        validationLevel: ValidationLevel;
        cacheHit: boolean;
        bypassReason?: string;
        performanceMetrics: {
            validationTime: number;
            cacheTime: number;
            totalInterceptionTime: number;
        };
    };
}

/**
 * Validation Middleware for intercepting and validating tool calls
 */
export class ValidationMiddleware {
    private readonly logger: Logger;
    private readonly proactiveValidationService: ProactiveValidationService;
    private readonly validationCacheService: ValidationCacheService;
    private readonly toolExecutionInterceptor: ToolExecutionInterceptor;
    
    // Configuration
    private config: ValidationMiddlewareConfig;
    
    // Active interceptions tracking
    private readonly activeInterceptions = new Map<string, InterceptedToolCall>();
    
    // Events
    private readonly middlewareEvents$ = new Subject<ValidationMiddlewareEvent>();
    
    // Performance metrics
    private readonly metrics = {
        totalInterceptions: 0,
        validationsPerformed: 0,
        validationsBlocked: 0,
        validationsBypassed: 0,
        cacheHits: 0,
        cacheMisses: 0,
        timeouts: 0,
        averageValidationTime: 0,
        totalValidationTime: 0
    };
    
    // Emergency bypass tracking
    private emergencyBypassUntil = 0;
    
    private static instance: ValidationMiddleware;

    private constructor() {
        this.logger = new Logger('info', 'ValidationMiddleware', 'server');
        this.proactiveValidationService = ProactiveValidationService.getInstance();
        this.validationCacheService = ValidationCacheService.getInstance();
        this.toolExecutionInterceptor = ToolExecutionInterceptor.getInstance();
        
        this.config = this.getDefaultConfig();
        this.setupIntegrations();
        this.setupEventListeners();
        this.startPeriodicTasks();
        
    }

    /**
     * Get singleton instance
     */
    public static getInstance(): ValidationMiddleware {
        if (!ValidationMiddleware.instance) {
            ValidationMiddleware.instance = new ValidationMiddleware();
        }
        return ValidationMiddleware.instance;
    }

    // =============================================================================
    // CORE INTERCEPTION METHODS
    // =============================================================================

    /**
     * Intercept and validate a tool call before execution
     */
    public async interceptToolCall(
        agentId: AgentId,
        channelId: ChannelId,
        toolName: string,
        parameters: Record<string, any>,
        requestId: string
    ): Promise<ValidationMiddlewareResult> {
        const startTime = Date.now();
        const interceptionId = `mid_${requestId}_${startTime}`;
        
        this.metrics.totalInterceptions++;

        // Check if middleware is enabled
        if (!this.config.enabled) {
            return this.createBypassResult('middleware_disabled', interceptionId);
        }

        // Check emergency bypass
        if (this.isEmergencyBypassActive()) {
            return this.createBypassResult('emergency_bypass', interceptionId);
        }

        // Emit interception event
        this.emitMiddlewareEvent({
            timestamp: startTime,
            agentId,
            channelId,
            toolName,
            eventType: 'INTERCEPTED',
            validationId: interceptionId,
            executionTime: 0,
            details: { parameters }
        });

        try {
            // Check cache first if enabled
            let validationResult: ValidationResult | null = null;
            let cacheHit = false;
            let cacheTime = 0;

            if (this.config.cacheValidationResults) {
                const cacheStart = Date.now();
                validationResult = await this.validationCacheService.getValidationResult(
                    agentId,
                    channelId,
                    toolName,
                    parameters
                );
                cacheTime = Date.now() - cacheStart;

                if (validationResult) {
                    cacheHit = true;
                    this.metrics.cacheHits++;
                } else {
                    this.metrics.cacheMisses++;
                }
            }

            // Perform validation if not cached
            let validationTime = 0;
            if (!validationResult) {
                const validationStart = Date.now();
                
                // Set timeout for validation
                const validationPromise = this.proactiveValidationService.validateToolCall(
                    agentId,
                    channelId,
                    toolName,
                    parameters,
                    requestId
                );

                try {
                    validationResult = await this.withTimeout(
                        validationPromise,
                        this.config.maxValidationTime
                    );
                    
                    validationTime = Date.now() - validationStart;
                    this.metrics.validationsPerformed++;
                    this.updateValidationTimeMetrics(validationTime);

                    // Cache the result if enabled
                    if (this.config.cacheValidationResults && validationResult) {
                        this.validationCacheService.cacheValidationResult(
                            agentId,
                            channelId,
                            toolName,
                            parameters,
                            validationResult
                        ).catch(error => {
                            this.logger.warn(`Failed to cache validation result: ${error}`);
                        });
                    }

                } catch (error) {
                    if (error instanceof Error && error.message === 'TIMEOUT') {
                        this.metrics.timeouts++;
                        this.logger.warn(`Validation timeout for ${toolName} after ${this.config.maxValidationTime}ms`);
                        
                        if (this.config.fallbackOnTimeout) {
                            validationResult = this.createTimeoutFallbackResult(interceptionId);
                        } else {
                            return this.createBlockedResult('validation_timeout', interceptionId);
                        }
                    } else {
                        throw error;
                    }
                }
            }

            // Determine if execution should proceed
            const shouldProceed = this.shouldAllowExecution(validationResult, toolName);
            const totalTime = Date.now() - startTime;

            // Create interception record
            const interceptedCall: InterceptedToolCall = {
                originalContext: {
                    agentId,
                    channelId,
                    toolName,
                    parameters,
                    requestId,
                    timestamp: startTime
                } as ToolExecutionContext,
                validationResult,
                interceptedAt: startTime,
                shouldExecute: shouldProceed,
                metadata: {
                    validationLevel: this.getValidationLevel(validationResult),
                    cacheHit,
                    performanceMetrics: {
                        validationTime,
                        cacheTime,
                        totalInterceptionTime: totalTime
                    }
                }
            };

            // Track active interception
            this.activeInterceptions.set(interceptionId, interceptedCall);

            // Create result
            const result: ValidationMiddlewareResult = {
                shouldProceed,
                validationResult,
                blockedReason: shouldProceed ? undefined : this.getBlockedReason(validationResult),
                suggestedAlternatives: this.getSuggestedAlternatives(validationResult),
                bypassValidation: false
            };

            // Update metrics and emit events
            if (shouldProceed) {
                this.emitMiddlewareEvent({
                    timestamp: Date.now(),
                    agentId,
                    channelId,
                    toolName,
                    eventType: 'VALIDATED',
                    validationId: interceptionId,
                    executionTime: totalTime,
                    details: { 
                        cacheHit, 
                        validationLevel: interceptedCall.metadata.validationLevel,
                        errorsCount: validationResult.errors.length,
                        warningsCount: validationResult.warnings.length
                    }
                });
            } else {
                this.metrics.validationsBlocked++;
                this.emitMiddlewareEvent({
                    timestamp: Date.now(),
                    agentId,
                    channelId,
                    toolName,
                    eventType: 'BLOCKED',
                    validationId: interceptionId,
                    executionTime: totalTime,
                    details: { 
                        reason: result.blockedReason,
                        errors: validationResult.errors,
                        warnings: validationResult.warnings
                    }
                });
            }

            if (this.config.logAllInterceptions) {
            }

            return result;

        } catch (error) {
            this.logger.error(`Validation middleware error for ${toolName}:`, error);
            
            // Clean up
            this.activeInterceptions.delete(interceptionId);
            
            // Emit error event
            this.emitMiddlewareEvent({
                timestamp: Date.now(),
                agentId,
                channelId,
                toolName,
                eventType: 'BLOCKED',
                validationId: interceptionId,
                executionTime: Date.now() - startTime,
                details: { error: error instanceof Error ? error.message : String(error) }
            });

            // Return safe default based on configuration
            if (this.config.fallbackOnTimeout) {
                return this.createBypassResult('validation_error', interceptionId);
            } else {
                return this.createBlockedResult('validation_error', interceptionId);
            }
        }
    }

    /**
     * Create intercepted executor that includes validation middleware
     */
    public createValidatedExecutor<T = any>(
        originalExecutor: (params: Record<string, any>) => Promise<T>
    ): (context: ToolExecutionContext) => Promise<T> {
        return async (context: ToolExecutionContext): Promise<T> => {
            // First run through validation middleware
            const middlewareResult = await this.interceptToolCall(
                context.agentId,
                context.channelId,
                context.toolName,
                context.parameters,
                context.requestId
            );

            // If validation blocks execution, throw an error
            if (!middlewareResult.shouldProceed) {
                const errorMessage = middlewareResult.blockedReason || 'Tool execution blocked by validation';
                this.logger.warn(`🚫 Blocking tool execution: ${context.toolName} - ${errorMessage}`);
                throw new Error(errorMessage);
            }

            // If validation passes, proceed with original execution
            return await originalExecutor(context.parameters);
        };
    }

    // =============================================================================
    // INTEGRATION WITH TOOL EXECUTION INTERCEPTOR
    // =============================================================================

    private setupIntegrations(): void {
        // Integrate with existing ToolExecutionInterceptor
        // This ensures all tool calls go through both validation and auto-correction
        
        // Listen to tool execution interceptor events
        this.toolExecutionInterceptor.interceptionEvents.subscribe(event => {
            this.handleToolExecutionEvent(event);
        });
        
    }

    private handleToolExecutionEvent(event: any): void {
        // Handle events from ToolExecutionInterceptor to learn and improve
        try {
            const { type, context, result } = event;
            
            switch (type) {
                case 'execution_start':
                    // Track that execution started after our validation
                    break;
                    
                case 'execution_error':
                    // Learn from execution errors that passed validation
                    this.learnFromExecutionError(context, result).catch(error => {
                        this.logger.warn('Failed to learn from execution error:', error);
                    });
                    break;
                    
                case 'execution_complete':
                    // Learn from successful executions
                    this.learnFromExecutionSuccess(context, result).catch(error => {
                        this.logger.warn('Failed to learn from execution success:', error);
                    });
                    break;
                    
                case 'correction_applied':
                    // Learn from corrections that happened after validation
                    this.learnFromCorrection(context).catch(error => {
                        this.logger.warn('Failed to learn from correction:', error);
                    });
                    break;
            }
        } catch (error) {
            this.logger.warn('Error handling tool execution event:', error);
        }
    }

    // =============================================================================
    // DECISION LOGIC
    // =============================================================================

    private shouldAllowExecution(validationResult: ValidationResult, toolName: string): boolean {
        // Emergency bypass check
        if (this.isEmergencyBypassActive()) {
            return true;
        }

        // Check if we should bypass for low-risk tools
        if (this.config.bypassForLowRiskTools && 
            validationResult.riskAssessment.overallRisk === 'LOW' &&
            validationResult.errors.length === 0) {
            return true;
        }

        // Block if there are high-severity errors and blocking is enforced
        if (this.config.enforceBlocking) {
            const hasHighSeverityErrors = validationResult.errors.some(e => e.severity === 'HIGH');
            if (hasHighSeverityErrors) {
                return false;
            }
        }

        // Allow execution if validation passed
        return validationResult.valid;
    }

    private getValidationLevel(validationResult: ValidationResult): ValidationLevel {
        return validationResult.riskAssessment.recommendedValidationLevel;
    }

    private getBlockedReason(validationResult: ValidationResult): string {
        const highSeverityErrors = validationResult.errors.filter(e => e.severity === 'HIGH');
        if (highSeverityErrors.length > 0) {
            return `High severity validation errors: ${highSeverityErrors.map(e => e.message).join(', ')}`;
        }

        const mediumSeverityErrors = validationResult.errors.filter(e => e.severity === 'MEDIUM');
        if (mediumSeverityErrors.length > 0) {
            return `Medium severity validation errors: ${mediumSeverityErrors.map(e => e.message).join(', ')}`;
        }

        return 'Tool execution blocked by validation';
    }

    private getSuggestedAlternatives(validationResult: ValidationResult): string[] {
        const alternatives: string[] = [];

        // Extract suggestions from validation result
        validationResult.suggestions.forEach(suggestion => {
            alternatives.push(suggestion.message);
        });

        // Add error-specific suggestions
        validationResult.errors.forEach(error => {
            if (error.suggestedFix) {
                alternatives.push(error.suggestedFix);
            }
        });

        return alternatives.slice(0, 5); // Limit to top 5 alternatives
    }

    // =============================================================================
    // HELPER METHODS
    // =============================================================================

    private createBypassResult(reason: string, validationId: string): ValidationMiddlewareResult {
        this.metrics.validationsBypassed++;
        
        this.emitMiddlewareEvent({
            timestamp: Date.now(),
            agentId: 'system' as AgentId,
            channelId: 'system' as ChannelId,
            toolName: 'unknown',
            eventType: 'BYPASSED',
            validationId,
            executionTime: 0,
            details: { reason }
        });

        return {
            shouldProceed: true,
            validationResult: {
                valid: true,
                validationId,
                errors: [],
                warnings: [{
                    type: 'PERFORMANCE',
                    message: `Validation bypassed: ${reason}`,
                    impact: 'LOW'
                }],
                suggestions: [],
                confidenceScore: 0.5,
                executionTime: 0,
                riskAssessment: {
                    overallRisk: 'LOW',
                    riskFactors: [reason],
                    mitigationStrategies: [],
                    recommendedValidationLevel: ValidationLevel.NONE
                },
                cachedResult: false
            },
            bypassValidation: true
        };
    }

    private createBlockedResult(reason: string, validationId: string): ValidationMiddlewareResult {
        return {
            shouldProceed: false,
            validationResult: {
                valid: false,
                validationId,
                errors: [{
                    type: 'BUSINESS_LOGIC',
                    message: `Execution blocked: ${reason}`,
                    severity: 'HIGH',
                    suggestedFix: 'Contact system administrator or try again later'
                }],
                warnings: [],
                suggestions: [],
                confidenceScore: 0,
                executionTime: 0,
                riskAssessment: {
                    overallRisk: 'HIGH',
                    riskFactors: [reason],
                    mitigationStrategies: ['wait_and_retry'],
                    recommendedValidationLevel: ValidationLevel.STRICT
                },
                cachedResult: false
            },
            blockedReason: reason
        };
    }

    private createTimeoutFallbackResult(validationId: string): ValidationResult {
        return {
            valid: true, // Allow execution on timeout
            validationId,
            errors: [],
            warnings: [{
                type: 'PERFORMANCE',
                message: 'Validation timed out, proceeding with caution',
                impact: 'MEDIUM'
            }],
            suggestions: [{
                type: 'PARAMETER_IMPROVEMENT',
                message: 'Consider simplifying parameters to reduce validation time',
                expectedBenefit: 'Faster validation',
                confidence: 0.7
            }],
            confidenceScore: 0.3,
            executionTime: this.config.maxValidationTime,
            riskAssessment: {
                overallRisk: 'MEDIUM',
                riskFactors: ['validation_timeout'],
                mitigationStrategies: ['monitor_execution'],
                recommendedValidationLevel: ValidationLevel.ASYNC
            },
            cachedResult: false
        };
    }

    private async withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                reject(new Error('TIMEOUT'));
            }, timeoutMs);

            promise
                .then(resolve)
                .catch(reject)
                .finally(() => clearTimeout(timer));
        });
    }

    private isEmergencyBypassActive(): boolean {
        return this.config.emergencyBypass && Date.now() < this.emergencyBypassUntil;
    }

    private updateValidationTimeMetrics(validationTime: number): void {
        this.metrics.totalValidationTime += validationTime;
        this.metrics.averageValidationTime = 
            this.metrics.totalValidationTime / this.metrics.validationsPerformed;
    }

    // =============================================================================
    // LEARNING METHODS
    // =============================================================================

    private async learnFromExecutionError(context: any, result: any): Promise<void> {
        try {
            // If execution failed after passing validation, we need to improve validation
            
            // This could update validation rules or risk profiles
            // Implementation would depend on specific error patterns
            
        } catch (error) {
            this.logger.warn('Failed to learn from execution error:', error);
        }
    }

    private async learnFromExecutionSuccess(context: any, result: any): Promise<void> {
        try {
            // Learn from successful executions to reduce false positives
            
            // This could reduce risk scores for successful patterns
            
        } catch (error) {
            this.logger.warn('Failed to learn from execution success:', error);
        }
    }

    private async learnFromCorrection(context: any): Promise<void> {
        try {
            // Learn from auto-corrections that happened after validation
            
            // This could improve validation to catch issues that required correction
            
        } catch (error) {
            this.logger.warn('Failed to learn from correction:', error);
        }
    }

    // =============================================================================
    // EVENT HANDLING
    // =============================================================================

    private setupEventListeners(): void {
        // Listen to system events for emergency bypass triggers
        EventBus.server.on(Events.System.MAINTENANCE_MODE, () => {
            this.activateEmergencyBypass(30 * 60 * 1000); // 30 minutes
        });

        // Listen to validation performance events
        this.proactiveValidationService.validationEvents.subscribe(event => {
            // Could use these events for additional learning or optimization
        });
    }

    private startPeriodicTasks(): void {
        // Performance reporting
        setInterval(() => {
            this.reportPerformanceMetrics();
        }, 60 * 1000); // Every minute

        // Cleanup expired interceptions
        setInterval(() => {
            this.cleanupExpiredInterceptions();
        }, 5 * 60 * 1000); // Every 5 minutes

        // Health checks
        setInterval(() => {
            this.performHealthCheck();
        }, 30 * 1000); // Every 30 seconds
    }

    private reportPerformanceMetrics(): void {
        if (this.metrics.totalInterceptions === 0) return;

        const cacheHitRate = this.metrics.cacheHits / 
                           (this.metrics.cacheHits + this.metrics.cacheMisses);
        const blockRate = this.metrics.validationsBlocked / this.metrics.totalInterceptions;
        const bypassRate = this.metrics.validationsBypassed / this.metrics.totalInterceptions;


        // Alert on performance issues
        if (this.metrics.averageValidationTime > this.config.maxValidationTime * 0.8) {
            this.logger.warn(`⚠️ Average validation time approaching limit: ` +
                           `${this.metrics.averageValidationTime.toFixed(1)}ms`);
        }

        if (this.metrics.timeouts > 0) {
            this.logger.warn(`⚠️ ${this.metrics.timeouts} validation timeouts detected`);
        }
    }

    private cleanupExpiredInterceptions(): void {
        const expiredTime = Date.now() - (10 * 60 * 1000); // 10 minutes ago
        let cleaned = 0;

        for (const [id, interception] of this.activeInterceptions.entries()) {
            if (interception.interceptedAt < expiredTime) {
                this.activeInterceptions.delete(id);
                cleaned++;
            }
        }

        if (cleaned > 0) {
        }
    }

    private performHealthCheck(): void {
        // Check if validation service is healthy
        const performanceMetrics = this.proactiveValidationService.getPerformanceMetrics();
        
        if (performanceMetrics.averageLatency > this.config.maxValidationTime) {
        }

        // Check cache service health
        if (this.config.cacheValidationResults) {
            const cacheStats = this.validationCacheService.getStats();
            if (cacheStats.hitRate < 0.5) {
            }
        }
    }

    private emitMiddlewareEvent(event: ValidationMiddlewareEvent): void {
        this.middlewareEvents$.next(event);
    }

    private getDefaultConfig(): ValidationMiddlewareConfig {
        return {
            enabled: true,
            enforceBlocking: true,
            maxValidationTime: 50, // 50ms to meet <50ms requirement
            fallbackOnTimeout: true,
            cacheValidationResults: true,
            logAllInterceptions: false, // Set to true for debugging
            bypassForLowRiskTools: true,
            emergencyBypass: false
        };
    }

    // =============================================================================
    // PUBLIC API
    // =============================================================================

    /**
     * Get middleware events observable
     */
    public get middlewareEvents(): Observable<ValidationMiddlewareEvent> {
        return this.middlewareEvents$.asObservable();
    }

    /**
     * Update configuration
     */
    public updateConfig(newConfig: Partial<ValidationMiddlewareConfig>): void {
        this.config = { ...this.config, ...newConfig };
    }

    /**
     * Get current configuration
     */
    public getConfig(): ValidationMiddlewareConfig {
        return { ...this.config };
    }

    /**
     * Get performance metrics
     */
    public getPerformanceMetrics(): {
        totalInterceptions: number;
        validationsPerformed: number;
        validationsBlocked: number;
        validationsBypassed: number;
        cacheHitRate: number;
        averageValidationTime: number;
        timeouts: number;
        activeInterceptions: number;
    } {
        const totalCacheRequests = this.metrics.cacheHits + this.metrics.cacheMisses;
        
        return {
            totalInterceptions: this.metrics.totalInterceptions,
            validationsPerformed: this.metrics.validationsPerformed,
            validationsBlocked: this.metrics.validationsBlocked,
            validationsBypassed: this.metrics.validationsBypassed,
            cacheHitRate: totalCacheRequests > 0 ? this.metrics.cacheHits / totalCacheRequests : 0,
            averageValidationTime: this.metrics.averageValidationTime,
            timeouts: this.metrics.timeouts,
            activeInterceptions: this.activeInterceptions.size
        };
    }

    /**
     * Activate emergency bypass for specified duration
     */
    public activateEmergencyBypass(durationMs: number): void {
        this.emergencyBypassUntil = Date.now() + durationMs;
        this.logger.warn(`🚨 Emergency bypass activated for ${durationMs}ms`);
    }

    /**
     * Deactivate emergency bypass
     */
    public deactivateEmergencyBypass(): void {
        this.emergencyBypassUntil = 0;
    }

    /**
     * Get active interceptions (for monitoring)
     */
    public getActiveInterceptions(): InterceptedToolCall[] {
        return Array.from(this.activeInterceptions.values());
    }

    /**
     * Clear metrics (for testing)
     */
    public clearMetrics(): void {
        Object.assign(this.metrics, {
            totalInterceptions: 0,
            validationsPerformed: 0,
            validationsBlocked: 0,
            validationsBypassed: 0,
            cacheHits: 0,
            cacheMisses: 0,
            timeouts: 0,
            averageValidationTime: 0,
            totalValidationTime: 0
        });
    }
}