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
 * ToolExecutionInterceptor - Phase 4 Auto-Correction System Middleware
 * 
 * Intercepts tool execution requests and responses to automatically:
 * - Detect validation errors
 * - Apply auto-corrections when confidence is high
 * - Retry with corrected parameters
 * - Learn from successful corrections
 * - Prevent infinite correction loops
 */

import { Observable, Subject } from 'rxjs';
import { Logger } from '../utils/Logger';
import { EventBus } from '../events/EventBus';
import { Events } from '../events/EventNames';
import { AutoCorrectionService, CorrectionAttempt } from './AutoCorrectionService';
import { AgentId } from '../types/Agent';
import { ChannelId } from '../types/ChannelContext';

/**
 * Tool execution context for interception
 */
export interface ToolExecutionContext {
    agentId: AgentId;
    channelId: ChannelId;
    toolName: string;
    parameters: Record<string, any>;
    requestId: string;
    timestamp: number;
    retryCount?: number;
    originalAttemptId?: string;
}

/**
 * Interceptor execution result (internal to interceptor)
 */
export interface InterceptorExecutionResult {
    success: boolean;
    result?: any;
    error?: string;
    correctionApplied?: boolean;
    correctionAttemptId?: string;
    totalExecutionTime: number;
}

/**
 * Interceptor configuration
 */
export interface InterceptorConfig {
    enabled: boolean;
    autoRetryOnCorrection: boolean;
    maxRetryAttempts: number;
    retryDelayMs: number;
    enableLearning: boolean;
    logAllInterceptions: boolean;
}

/**
 * Tool execution interceptor for automatic error correction
 */
export class ToolExecutionInterceptor {
    private readonly logger: Logger;
    private readonly autoCorrectionService: AutoCorrectionService;
    
    // Execution tracking
    private readonly activeExecutions = new Map<string, ToolExecutionContext>();
    private readonly executionHistory = new Map<string, InterceptorExecutionResult[]>();
    
    // Events
    private readonly interceptionEvents$ = new Subject<{
        type: 'execution_start' | 'execution_error' | 'correction_applied' | 'execution_complete';
        context: ToolExecutionContext;
        result?: InterceptorExecutionResult;
        correctionAttempt?: CorrectionAttempt;
    }>();
    
    // Configuration
    private config: InterceptorConfig;
    
    private static instance: ToolExecutionInterceptor;

    private constructor() {
        this.logger = new Logger('info', 'ToolExecutionInterceptor', 'server');
        this.autoCorrectionService = AutoCorrectionService.getInstance();
        
        this.config = this.getDefaultConfig();
        this.setupEventListeners();
        
    }

    /**
     * Get singleton instance
     */
    public static getInstance(): ToolExecutionInterceptor {
        if (!ToolExecutionInterceptor.instance) {
            ToolExecutionInterceptor.instance = new ToolExecutionInterceptor();
        }
        return ToolExecutionInterceptor.instance;
    }

    // =============================================================================
    // CORE INTERCEPTION METHODS
    // =============================================================================

    /**
     * Intercept a tool execution request
     */
    public async interceptExecution(
        context: ToolExecutionContext,
        executeFunction: (params: Record<string, any>) => Promise<any>
    ): Promise<InterceptorExecutionResult> {
        const executionId = `${context.agentId}:${context.channelId}:${context.requestId}`;
        const startTime = Date.now();
        
        // Track active execution
        this.activeExecutions.set(executionId, context);
        
        // Emit execution start event
        this.interceptionEvents$.next({
            type: 'execution_start',
            context
        });

        if (this.config.logAllInterceptions) {
        }

        try {
            // First execution attempt
            const result = await this.attemptExecution(context, executeFunction, startTime);
            
            // Clean up tracking
            this.activeExecutions.delete(executionId);
            
            // Record execution history
            this.recordExecutionHistory(executionId, result);
            
            return result;

        } catch (error) {
            this.logger.error(`Intercepted execution failed: ${error}`);
            
            // Clean up tracking
            this.activeExecutions.delete(executionId);
            
            const failedResult: InterceptorExecutionResult = {
                success: false,
                error: error instanceof Error ? error.message : String(error),
                totalExecutionTime: Date.now() - startTime
            };
            
            this.recordExecutionHistory(executionId, failedResult);
            return failedResult;
        }
    }

    /**
     * Attempt tool execution with auto-correction support
     */
    private async attemptExecution(
        context: ToolExecutionContext,
        executeFunction: (params: Record<string, any>) => Promise<any>,
        startTime: number
    ): Promise<InterceptorExecutionResult> {
        const maxAttempts = this.config.maxRetryAttempts;
        let currentAttempt = context.retryCount || 0;
        let currentParameters = { ...context.parameters };
        let lastError: string | undefined;
        let correctionAttemptId: string | undefined;

        while (currentAttempt < maxAttempts) {
            try {
                
                // Execute the tool
                const result = await executeFunction(currentParameters);
                
                // Success! Report correction result if there was one
                if (correctionAttemptId) {
                    await this.autoCorrectionService.reportCorrectionResult(
                        correctionAttemptId,
                        true, // successful
                        undefined,
                        Date.now() - startTime
                    );
                }
                
                const successResult: InterceptorExecutionResult = {
                    success: true,
                    result,
                    correctionApplied: !!correctionAttemptId,
                    correctionAttemptId,
                    totalExecutionTime: Date.now() - startTime
                };

                // Emit completion event
                this.interceptionEvents$.next({
                    type: 'execution_complete',
                    context,
                    result: successResult
                });

                return successResult;

            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                lastError = errorMessage;
                
                
                // Emit error event
                this.interceptionEvents$.next({
                    type: 'execution_error',
                    context: { ...context, parameters: currentParameters },
                    result: {
                        success: false,
                        error: errorMessage,
                        totalExecutionTime: Date.now() - startTime
                    }
                });

                // Report previous correction as failed if exists
                if (correctionAttemptId) {
                    await this.autoCorrectionService.reportCorrectionResult(
                        correctionAttemptId,
                        false, // failed
                        errorMessage
                    );
                    correctionAttemptId = undefined;
                }

                // Check if we should attempt auto-correction
                if (this.config.enabled && 
                    this.config.autoRetryOnCorrection && 
                    currentAttempt < maxAttempts - 1 &&
                    this.isValidationError(errorMessage)) {
                    
                    // Attempt auto-correction
                    const correctionResult = await this.autoCorrectionService.attemptCorrection(
                        context.agentId,
                        context.channelId,
                        context.toolName,
                        currentParameters,
                        errorMessage
                    );

                    if (correctionResult.corrected && correctionResult.correctedParameters) {
                        
                        currentParameters = correctionResult.correctedParameters;
                        correctionAttemptId = correctionResult.attemptId;
                        
                        // Emit correction event
                        this.interceptionEvents$.next({
                            type: 'correction_applied',
                            context: { ...context, parameters: currentParameters }
                        });

                        // Wait for retry delay if specified
                        if (correctionResult.retryDelay && correctionResult.retryDelay > 0) {
                            await this.delay(correctionResult.retryDelay);
                        }
                        
                        // Continue to next attempt with corrected parameters
                        currentAttempt++;
                        continue;
                    } else {
                    }
                }

                // No correction possible or not a validation error, increment attempt
                currentAttempt++;
                
                // Add delay between regular retry attempts
                if (currentAttempt < maxAttempts) {
                    await this.delay(this.config.retryDelayMs);
                }
            }
        }

        // All attempts exhausted
        const finalResult: InterceptorExecutionResult = {
            success: false,
            error: lastError || 'Unknown error after all retry attempts',
            correctionApplied: !!correctionAttemptId,
            correctionAttemptId,
            totalExecutionTime: Date.now() - startTime
        };

        // Emit final completion event
        this.interceptionEvents$.next({
            type: 'execution_complete',
            context,
            result: finalResult
        });

        return finalResult;
    }

    // =============================================================================
    // HELPER METHODS
    // =============================================================================

    /**
     * Check if an error is a validation error that can be auto-corrected
     */
    private isValidationError(errorMessage: string): boolean {
        const validationKeywords = [
            'required',
            'missing',
            'invalid',
            'validation',
            'schema',
            'unknown properties',
            'type',
            'expected'
        ];
        
        const errorLower = errorMessage.toLowerCase();
        return validationKeywords.some(keyword => errorLower.includes(keyword));
    }

    /**
     * Add delay for retry attempts
     */
    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Record execution history for analytics
     */
    private recordExecutionHistory(executionId: string, result: InterceptorExecutionResult): void {
        const history = this.executionHistory.get(executionId) || [];
        history.push(result);
        this.executionHistory.set(executionId, history);

        // Keep only last 100 executions per ID
        if (history.length > 100) {
            history.splice(0, history.length - 100);
        }
    }

    /**
     * Setup event listeners
     */
    private setupEventListeners(): void {
        // Listen to auto-correction events for additional processing
        this.autoCorrectionService.correctionEvents.subscribe(attempt => {
            if (this.config.enableLearning) {
            }
        });

        // Listen to general tool errors for monitoring
        EventBus.server.on(Events.Mcp.TOOL_ERROR, (payload) => {
            if (this.config.logAllInterceptions) {
            }
        });

    }

    /**
     * Get default configuration
     */
    private getDefaultConfig(): InterceptorConfig {
        return {
            enabled: true,
            autoRetryOnCorrection: true,
            maxRetryAttempts: 3,
            retryDelayMs: 1000,
            enableLearning: true,
            logAllInterceptions: false // Set to true for debugging
        };
    }

    // =============================================================================
    // PUBLIC API
    // =============================================================================

    /**
     * Get interception events observable
     */
    public get interceptionEvents(): Observable<{
        type: 'execution_start' | 'execution_error' | 'correction_applied' | 'execution_complete';
        context: ToolExecutionContext;
        result?: InterceptorExecutionResult;
        correctionAttempt?: CorrectionAttempt;
    }> {
        return this.interceptionEvents$.asObservable();
    }

    /**
     * Update interceptor configuration
     */
    public updateConfig(newConfig: Partial<InterceptorConfig>): void {
        this.config = { ...this.config, ...newConfig };
    }

    /**
     * Get current configuration
     */
    public getConfig(): InterceptorConfig {
        return { ...this.config };
    }

    /**
     * Get active executions count
     */
    public getActiveExecutionsCount(): number {
        return this.activeExecutions.size;
    }

    /**
     * Get execution statistics
     */
    public getExecutionStats(): {
        totalExecutions: number;
        successfulExecutions: number;
        failedExecutions: number;
        correctionsApplied: number;
        successRate: number;
        averageExecutionTime: number;
    } {
        let totalExecutions = 0;
        let successfulExecutions = 0;
        let failedExecutions = 0;
        let correctionsApplied = 0;
        let totalExecutionTime = 0;

        for (const results of this.executionHistory.values()) {
            for (const result of results) {
                totalExecutions++;
                totalExecutionTime += result.totalExecutionTime;
                
                if (result.success) {
                    successfulExecutions++;
                } else {
                    failedExecutions++;
                }
                
                if (result.correctionApplied) {
                    correctionsApplied++;
                }
            }
        }

        return {
            totalExecutions,
            successfulExecutions,
            failedExecutions,
            correctionsApplied,
            successRate: totalExecutions > 0 ? successfulExecutions / totalExecutions : 0,
            averageExecutionTime: totalExecutions > 0 ? totalExecutionTime / totalExecutions : 0
        };
    }

    /**
     * Clear execution history (for testing/cleanup)
     */
    public clearExecutionHistory(): void {
        this.executionHistory.clear();
        this.activeExecutions.clear();
    }

    /**
     * Create a wrapped executor function that includes interception
     */
    public createInterceptedExecutor<T = any>(
        originalExecutor: (params: Record<string, any>) => Promise<T>
    ): (context: ToolExecutionContext) => Promise<InterceptorExecutionResult> {
        return async (context: ToolExecutionContext) => {
            return await this.interceptExecution(context, originalExecutor);
        };
    }

    /**
     * Utility method to create execution context
     */
    public static createExecutionContext(
        agentId: AgentId,
        channelId: ChannelId,
        toolName: string,
        parameters: Record<string, any>,
        requestId: string,
        retryCount?: number
    ): ToolExecutionContext {
        return {
            agentId,
            channelId,
            toolName,
            parameters,
            requestId,
            timestamp: Date.now(),
            retryCount
        };
    }
}