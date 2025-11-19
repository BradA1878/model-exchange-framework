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
 * RecoveryWorkflowService - Phase 4 Auto-Correction System Recovery Workflows
 * 
 * Manages recovery workflows for tool execution failures:
 * - Automatic retry with corrections
 * - Escalation when auto-correction fails
 * - Recovery pattern storage and learning
 * - Safety constraints and circuit breaker patterns
 * - Recovery analytics and reporting
 */

import { Observable, Subject } from 'rxjs';
import { Logger } from '../utils/Logger';
import { EventBus } from '../events/EventBus';
import { Events } from '../events/EventNames';
import { AutoCorrectionService, CorrectionAttempt } from './AutoCorrectionService';
import { ToolExecutionInterceptor, ToolExecutionContext, InterceptorExecutionResult } from './ToolExecutionInterceptor';
import { PatternLearningService } from './PatternLearningService';
import { AgentId } from '../types/Agent';
import { ChannelId } from '../types/ChannelContext';

/**
 * Recovery workflow types
 */
export type RecoveryWorkflowType = 
    | 'auto_retry'
    | 'escalate_to_human'
    | 'fallback_tool'
    | 'circuit_breaker'
    | 'pattern_learning'
    | 'complete_failure';

/**
 * Recovery workflow status
 */
export type RecoveryStatus = 
    | 'initiated'
    | 'in_progress'
    | 'correction_applied'
    | 'successful'
    | 'escalated'
    | 'failed'
    | 'circuit_open';

/**
 * Recovery workflow execution
 */
export interface RecoveryWorkflow {
    workflowId: string;
    agentId: AgentId;
    channelId: ChannelId;
    toolName: string;
    originalParameters: Record<string, any>;
    originalError: string;
    workflowType: RecoveryWorkflowType;
    status: RecoveryStatus;
    startTime: number;
    endTime?: number;
    attempts: RecoveryAttempt[];
    finalOutcome?: {
        success: boolean;
        result?: any;
        error?: string;
        totalRecoveryTime: number;
    };
    escalationReason?: string;
    learnedPatterns?: string[];
}

/**
 * Individual recovery attempt
 */
export interface RecoveryAttempt {
    attemptId: string;
    timestamp: number;
    strategy: string;
    parameters: Record<string, any>;
    success: boolean;
    error?: string;
    executionTime: number;
    correctionAttemptId?: string;
}

/**
 * Circuit breaker state for preventing cascading failures
 */
interface CircuitBreakerState {
    isOpen: boolean;
    failureCount: number;
    lastFailureTime: number;
    nextRetryTime: number;
    halfOpenTime?: number;
}

/**
 * Recovery workflow configuration
 */
export interface RecoveryWorkflowConfig {
    enabled: boolean;
    maxRecoveryAttempts: number;
    escalationThreshold: number; // number of failed workflows before escalation
    circuitBreakerEnabled: boolean;
    circuitBreakerFailureThreshold: number;
    circuitBreakerTimeoutMs: number;
    circuitBreakerHalfOpenTimeoutMs: number;
    enablePatternLearning: boolean;
    enableFallbackTools: boolean;
    recoveryTimeoutMs: number;
    auditAllWorkflows: boolean;
}

/**
 * Recovery workflow service for managing systematic error recovery
 */
export class RecoveryWorkflowService {
    private readonly logger: Logger;
    private readonly autoCorrectionService: AutoCorrectionService;
    private readonly interceptor: ToolExecutionInterceptor;
    private readonly patternService: PatternLearningService;
    
    // Workflow tracking
    private readonly activeWorkflows = new Map<string, RecoveryWorkflow>();
    private readonly workflowHistory = new Map<string, RecoveryWorkflow[]>();
    private readonly circuitBreakers = new Map<string, CircuitBreakerState>();
    
    // Events
    private readonly workflowEvents$ = new Subject<{
        type: 'workflow_initiated' | 'attempt_made' | 'workflow_completed' | 'escalation_triggered' | 'circuit_opened';
        workflow: RecoveryWorkflow;
        attempt?: RecoveryAttempt;
    }>();
    
    // Configuration
    private config: RecoveryWorkflowConfig;
    
    // Recovery patterns (learned from successful recoveries)
    private readonly recoveryPatterns = new Map<string, {
        toolName: string;
        errorPattern: string;
        successfulStrategy: string;
        successCount: number;
        lastUsed: number;
        averageRecoveryTime: number;
    }>();

    private static instance: RecoveryWorkflowService;

    private constructor() {
        this.logger = new Logger('info', 'RecoveryWorkflowService', 'server');
        this.autoCorrectionService = AutoCorrectionService.getInstance();
        this.interceptor = ToolExecutionInterceptor.getInstance();
        this.patternService = PatternLearningService.getInstance();
        
        this.config = this.getDefaultConfig();
        this.setupEventListeners();
        this.startCircuitBreakerMonitoring();
        
    }

    /**
     * Get singleton instance
     */
    public static getInstance(): RecoveryWorkflowService {
        if (!RecoveryWorkflowService.instance) {
            RecoveryWorkflowService.instance = new RecoveryWorkflowService();
        }
        return RecoveryWorkflowService.instance;
    }

    // =============================================================================
    // CORE RECOVERY WORKFLOW METHODS
    // =============================================================================

    /**
     * Initiate a recovery workflow for a failed tool execution
     */
    public async initiateRecovery(
        agentId: AgentId,
        channelId: ChannelId,
        toolName: string,
        originalParameters: Record<string, any>,
        originalError: string,
        executeFunction: (params: Record<string, any>) => Promise<any>
    ): Promise<RecoveryWorkflow> {
        if (!this.config.enabled) {
            throw new Error('Recovery workflows are disabled');
        }

        const workflowId = `recovery_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const circuitBreakerKey = `${agentId}:${toolName}`;
        
        // Check circuit breaker
        if (this.isCircuitOpen(circuitBreakerKey)) {
            const workflow: RecoveryWorkflow = {
                workflowId,
                agentId,
                channelId,
                toolName,
                originalParameters,
                originalError,
                workflowType: 'circuit_breaker',
                status: 'circuit_open',
                startTime: Date.now(),
                attempts: [],
                escalationReason: 'Circuit breaker is open - too many recent failures'
            };
            
            this.recordCompletedWorkflow(workflow);
            
            // Emit circuit breaker event
            this.workflowEvents$.next({
                type: 'circuit_opened',
                workflow
            });
            
            return workflow;
        }

        // Determine workflow type based on context
        const workflowType = await this.determineWorkflowType(toolName, originalError, agentId, channelId);
        
        const workflow: RecoveryWorkflow = {
            workflowId,
            agentId,
            channelId,
            toolName,
            originalParameters,
            originalError,
            workflowType,
            status: 'initiated',
            startTime: Date.now(),
            attempts: []
        };

        this.activeWorkflows.set(workflowId, workflow);
        
        
        // Emit workflow initiated event
        this.workflowEvents$.next({
            type: 'workflow_initiated',
            workflow
        });

        // Execute the recovery workflow
        try {
            await this.executeRecoveryWorkflow(workflow, executeFunction);
        } catch (error) {
            this.logger.error(`Recovery workflow execution failed: ${error}`);
            workflow.status = 'failed';
            workflow.finalOutcome = {
                success: false,
                error: error instanceof Error ? error.message : String(error),
                totalRecoveryTime: Date.now() - workflow.startTime
            };
        }

        // Complete the workflow
        workflow.endTime = Date.now();
        this.activeWorkflows.delete(workflowId);
        this.recordCompletedWorkflow(workflow);
        
        // Update circuit breaker
        this.updateCircuitBreaker(circuitBreakerKey, workflow.finalOutcome?.success || false);
        
        // Emit completion event
        this.workflowEvents$.next({
            type: 'workflow_completed',
            workflow
        });

        return workflow;
    }

    /**
     * Execute the recovery workflow based on type
     */
    private async executeRecoveryWorkflow(
        workflow: RecoveryWorkflow,
        executeFunction: (params: Record<string, any>) => Promise<any>
    ): Promise<void> {
        workflow.status = 'in_progress';
        
        switch (workflow.workflowType) {
            case 'auto_retry':
                await this.executeAutoRetryWorkflow(workflow, executeFunction);
                break;
                
            case 'pattern_learning':
                await this.executePatternLearningWorkflow(workflow, executeFunction);
                break;
                
            case 'fallback_tool':
                await this.executeFallbackToolWorkflow(workflow, executeFunction);
                break;
                
            case 'escalate_to_human':
                await this.executeEscalationWorkflow(workflow);
                break;
                
            default:
                throw new Error(`Unknown workflow type: ${workflow.workflowType}`);
        }
    }

    /**
     * Execute auto-retry workflow with corrections
     */
    private async executeAutoRetryWorkflow(
        workflow: RecoveryWorkflow,
        executeFunction: (params: Record<string, any>) => Promise<any>
    ): Promise<void> {
        const maxAttempts = this.config.maxRecoveryAttempts;
        let currentParameters = { ...workflow.originalParameters };
        
        for (let attemptNumber = 1; attemptNumber <= maxAttempts; attemptNumber++) {
            const attemptId = `${workflow.workflowId}_attempt_${attemptNumber}`;
            const attemptStart = Date.now();
            let correctionResult: any = { corrected: false };
            
            try {
                // First, try to get auto-correction
                correctionResult = await this.autoCorrectionService.attemptCorrection(
                    workflow.agentId,
                    workflow.channelId,
                    workflow.toolName,
                    currentParameters,
                    workflow.originalError
                );

                if (correctionResult.corrected && correctionResult.correctedParameters) {
                    currentParameters = correctionResult.correctedParameters;
                    workflow.status = 'correction_applied';
                    
                }

                // Execute with current parameters
                const result = await executeFunction(currentParameters);
                
                // Success!
                const successfulAttempt: RecoveryAttempt = {
                    attemptId,
                    timestamp: attemptStart,
                    strategy: correctionResult.corrected ? `auto_correction_${correctionResult.strategy}` : 'retry',
                    parameters: currentParameters,
                    success: true,
                    executionTime: Date.now() - attemptStart,
                    correctionAttemptId: correctionResult.attemptId
                };
                
                workflow.attempts.push(successfulAttempt);
                workflow.status = 'successful';
                workflow.finalOutcome = {
                    success: true,
                    result,
                    totalRecoveryTime: Date.now() - workflow.startTime
                };

                // Report correction success if applicable
                if (correctionResult.attemptId) {
                    await this.autoCorrectionService.reportCorrectionResult(
                        correctionResult.attemptId,
                        true,
                        undefined,
                        Date.now() - attemptStart
                    );
                }

                // Learn from successful recovery
                if (this.config.enablePatternLearning) {
                    await this.learnFromSuccessfulRecovery(workflow, successfulAttempt);
                }
                
                // Emit attempt event
                this.workflowEvents$.next({
                    type: 'attempt_made',
                    workflow,
                    attempt: successfulAttempt
                });

                return; // Success, exit workflow

            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                
                const failedAttempt: RecoveryAttempt = {
                    attemptId,
                    timestamp: attemptStart,
                    strategy: 'auto_retry',
                    parameters: currentParameters,
                    success: false,
                    error: errorMessage,
                    executionTime: Date.now() - attemptStart,
                    correctionAttemptId: correctionResult.attemptId
                };
                
                workflow.attempts.push(failedAttempt);
                
                // Report correction failure if applicable
                if (correctionResult.attemptId) {
                    await this.autoCorrectionService.reportCorrectionResult(
                        correctionResult.attemptId,
                        false,
                        errorMessage
                    );
                }

                // Emit attempt event
                this.workflowEvents$.next({
                    type: 'attempt_made',
                    workflow,
                    attempt: failedAttempt
                });

                this.logger.warn(`❌ Recovery attempt ${attemptNumber} failed: ${errorMessage}`);
                
                // Wait before next attempt (except for last attempt)
                if (attemptNumber < maxAttempts) {
                    await this.delay(1000 * attemptNumber); // Exponential backoff
                }
            }
        }

        // All attempts failed - escalate or fail
        if (workflow.attempts.length >= this.config.escalationThreshold) {
            workflow.workflowType = 'escalate_to_human';
            workflow.escalationReason = `Auto-retry failed after ${maxAttempts} attempts`;
            await this.executeEscalationWorkflow(workflow);
        } else {
            workflow.status = 'failed';
            workflow.finalOutcome = {
                success: false,
                error: `Recovery failed after ${maxAttempts} attempts`,
                totalRecoveryTime: Date.now() - workflow.startTime
            };
        }
    }

    /**
     * Execute pattern learning workflow (uses learned patterns)
     */
    private async executePatternLearningWorkflow(
        workflow: RecoveryWorkflow,
        executeFunction: (params: Record<string, any>) => Promise<any>
    ): Promise<void> {
        // Look for learned recovery patterns
        const patternKey = `${workflow.toolName}_${this.categorizeError(workflow.originalError)}`;
        const learnedPattern = this.recoveryPatterns.get(patternKey);
        
        if (learnedPattern) {
            
            // Try the learned pattern
            const attemptId = `${workflow.workflowId}_pattern_attempt`;
            const attemptStart = Date.now();
            
            try {
                // Apply the learned strategy (simplified - in a real implementation, this would be more sophisticated)
                const result = await executeFunction(workflow.originalParameters);
                
                const successfulAttempt: RecoveryAttempt = {
                    attemptId,
                    timestamp: attemptStart,
                    strategy: `learned_pattern_${learnedPattern.successfulStrategy}`,
                    parameters: workflow.originalParameters,
                    success: true,
                    executionTime: Date.now() - attemptStart
                };
                
                workflow.attempts.push(successfulAttempt);
                workflow.status = 'successful';
                workflow.finalOutcome = {
                    success: true,
                    result,
                    totalRecoveryTime: Date.now() - workflow.startTime
                };
                
                // Update pattern success metrics
                learnedPattern.successCount++;
                learnedPattern.lastUsed = Date.now();
                learnedPattern.averageRecoveryTime = 
                    (learnedPattern.averageRecoveryTime + successfulAttempt.executionTime) / 2;
                
                return;
                
            } catch (error) {
                this.logger.warn(`Learned pattern failed, falling back to auto-retry: ${error}`);
                // Fall back to auto-retry workflow
                workflow.workflowType = 'auto_retry';
                await this.executeAutoRetryWorkflow(workflow, executeFunction);
            }
        } else {
            // No learned pattern, fall back to auto-retry
            workflow.workflowType = 'auto_retry';
            await this.executeAutoRetryWorkflow(workflow, executeFunction);
        }
    }

    /**
     * Execute fallback tool workflow
     */
    private async executeFallbackToolWorkflow(
        workflow: RecoveryWorkflow,
        executeFunction: (params: Record<string, any>) => Promise<any>
    ): Promise<void> {
        // This would require a registry of fallback tools
        // For now, escalate to human
        workflow.workflowType = 'escalate_to_human';
        workflow.escalationReason = 'Fallback tool workflow not implemented';
        await this.executeEscalationWorkflow(workflow);
    }

    /**
     * Execute escalation workflow
     */
    private async executeEscalationWorkflow(workflow: RecoveryWorkflow): Promise<void> {
        workflow.status = 'escalated';
        
        const escalationData = {
            workflowId: workflow.workflowId,
            agentId: workflow.agentId,
            channelId: workflow.channelId,
            toolName: workflow.toolName,
            originalError: workflow.originalError,
            attemptsSummary: workflow.attempts.map(a => ({
                strategy: a.strategy,
                success: a.success,
                error: a.error
            })),
            escalationReason: workflow.escalationReason,
            timestamp: Date.now()
        };
        
        // Emit escalation event for human intervention systems
        EventBus.server.emit(Events.System.ACTIVITY_ALERT, escalationData);
        
        // Emit workflow escalation event
        this.workflowEvents$.next({
            type: 'escalation_triggered',
            workflow
        });
        
        workflow.finalOutcome = {
            success: false,
            error: 'Escalated to human intervention',
            totalRecoveryTime: Date.now() - workflow.startTime
        };
        
        this.logger.warn(`🚨 Recovery workflow escalated to human: ${workflow.escalationReason}`);
    }

    // =============================================================================
    // CIRCUIT BREAKER METHODS
    // =============================================================================

    /**
     * Check if circuit breaker is open for a given key
     */
    private isCircuitOpen(circuitBreakerKey: string): boolean {
        if (!this.config.circuitBreakerEnabled) return false;
        
        const state = this.circuitBreakers.get(circuitBreakerKey);
        if (!state) return false;
        
        const now = Date.now();
        
        if (state.isOpen) {
            if (now >= state.nextRetryTime) {
                // Try half-open state
                state.isOpen = false;
                state.halfOpenTime = now;
                return false;
            }
            return true;
        }
        
        return false;
    }

    /**
     * Update circuit breaker state
     */
    private updateCircuitBreaker(circuitBreakerKey: string, success: boolean): void {
        if (!this.config.circuitBreakerEnabled) return;
        
        let state = this.circuitBreakers.get(circuitBreakerKey);
        if (!state) {
            state = {
                isOpen: false,
                failureCount: 0,
                lastFailureTime: 0,
                nextRetryTime: 0
            };
            this.circuitBreakers.set(circuitBreakerKey, state);
        }
        
        const now = Date.now();
        
        if (success) {
            // Reset on success
            state.failureCount = 0;
            state.isOpen = false;
            delete state.halfOpenTime;
        } else {
            state.failureCount++;
            state.lastFailureTime = now;
            
            // Open circuit if threshold exceeded
            if (state.failureCount >= this.config.circuitBreakerFailureThreshold) {
                state.isOpen = true;
                state.nextRetryTime = now + this.config.circuitBreakerTimeoutMs;
                
                this.logger.warn(`🔒 Circuit breaker opened for ${circuitBreakerKey} (${state.failureCount} failures)`);
            }
        }
    }

    /**
     * Start circuit breaker monitoring
     */
    private startCircuitBreakerMonitoring(): void {
        // Monitor and log circuit breaker states every 5 minutes
        setInterval(() => {
            if (this.circuitBreakers.size > 0) {
                const openCircuits = Array.from(this.circuitBreakers.entries())
                    .filter(([_, state]) => state.isOpen);
                
                if (openCircuits.length > 0) {
                }
            }
        }, 5 * 60 * 1000);
    }

    // =============================================================================
    // HELPER METHODS
    // =============================================================================

    /**
     * Determine the appropriate workflow type
     */
    private async determineWorkflowType(
        toolName: string,
        errorMessage: string,
        agentId: AgentId,
        channelId: ChannelId
    ): Promise<RecoveryWorkflowType> {
        // Check for learned patterns first
        const errorCategory = this.categorizeError(errorMessage);
        const patternKey = `${toolName}_${errorCategory}`;
        
        if (this.recoveryPatterns.has(patternKey) && this.config.enablePatternLearning) {
            return 'pattern_learning';
        }
        
        // Check if this is a validation error suitable for auto-correction
        if (this.isValidationError(errorMessage)) {
            return 'auto_retry';
        }
        
        // Check for fallback tools (if implemented)
        if (this.config.enableFallbackTools && this.hasFallbackTool(toolName)) {
            return 'fallback_tool';
        }
        
        // Default to escalation for complex errors
        return 'escalate_to_human';
    }

    /**
     * Check if error is suitable for validation-based auto-correction
     */
    private isValidationError(errorMessage: string): boolean {
        const validationKeywords = [
            'required', 'missing', 'invalid', 'validation', 
            'schema', 'unknown properties', 'type', 'expected'
        ];
        
        const errorLower = errorMessage.toLowerCase();
        return validationKeywords.some(keyword => errorLower.includes(keyword));
    }

    /**
     * Categorize error for pattern matching
     */
    private categorizeError(errorMessage: string): string {
        const errorLower = errorMessage.toLowerCase();
        
        if (errorLower.includes('required') || errorLower.includes('missing')) return 'missing_required';
        if (errorLower.includes('unknown') && errorLower.includes('propert')) return 'unknown_properties';
        if (errorLower.includes('type') || errorLower.includes('invalid')) return 'type_mismatch';
        if (errorLower.includes('timeout') || errorLower.includes('connection')) return 'timeout';
        if (errorLower.includes('permission') || errorLower.includes('access')) return 'permission';
        
        return 'other';
    }

    /**
     * Check if a fallback tool exists
     */
    private hasFallbackTool(toolName: string): boolean {
        // This would check a registry of fallback tools
        // For now, return false
        return false;
    }

    /**
     * Learn from successful recovery
     */
    private async learnFromSuccessfulRecovery(
        workflow: RecoveryWorkflow,
        attempt: RecoveryAttempt
    ): Promise<void> {
        const errorCategory = this.categorizeError(workflow.originalError);
        const patternKey = `${workflow.toolName}_${errorCategory}`;
        
        let pattern = this.recoveryPatterns.get(patternKey);
        if (!pattern) {
            pattern = {
                toolName: workflow.toolName,
                errorPattern: errorCategory,
                successfulStrategy: attempt.strategy,
                successCount: 0,
                lastUsed: 0,
                averageRecoveryTime: 0
            };
            this.recoveryPatterns.set(patternKey, pattern);
        }
        
        pattern.successCount++;
        pattern.lastUsed = Date.now();
        pattern.averageRecoveryTime = 
            (pattern.averageRecoveryTime + attempt.executionTime) / 2;
        
        if (!workflow.learnedPatterns) {
            workflow.learnedPatterns = [];
        }
        workflow.learnedPatterns.push(patternKey);
        
    }

    /**
     * Record completed workflow
     */
    private recordCompletedWorkflow(workflow: RecoveryWorkflow): void {
        const historyKey = `${workflow.agentId}:${workflow.toolName}`;
        const history = this.workflowHistory.get(historyKey) || [];
        
        history.push(workflow);
        this.workflowHistory.set(historyKey, history);
        
        // Keep only last 50 workflows per key
        if (history.length > 50) {
            history.splice(0, history.length - 50);
        }
        
        // Audit workflow if enabled
        if (this.config.auditAllWorkflows) {
            this.auditWorkflow(workflow);
        }
    }

    /**
     * Audit workflow execution
     */
    private auditWorkflow(workflow: RecoveryWorkflow): void {
    }

    /**
     * Add delay utility
     */
    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Setup event listeners
     */
    private setupEventListeners(): void {
        // Listen to tool execution interceptor events
        this.interceptor.interceptionEvents.subscribe(event => {
            if (event.type === 'execution_complete' && !event.result?.success) {
                // Potential candidate for recovery workflow
            }
        });

    }

    /**
     * Get default configuration
     */
    private getDefaultConfig(): RecoveryWorkflowConfig {
        return {
            enabled: true,
            maxRecoveryAttempts: 3,
            escalationThreshold: 2,
            circuitBreakerEnabled: true,
            circuitBreakerFailureThreshold: 5,
            circuitBreakerTimeoutMs: 60000, // 1 minute
            circuitBreakerHalfOpenTimeoutMs: 30000, // 30 seconds
            enablePatternLearning: true,
            enableFallbackTools: false, // Not implemented yet
            recoveryTimeoutMs: 300000, // 5 minutes
            auditAllWorkflows: true
        };
    }

    // =============================================================================
    // PUBLIC API
    // =============================================================================

    /**
     * Get workflow events observable
     */
    public get workflowEvents(): Observable<{
        type: 'workflow_initiated' | 'attempt_made' | 'workflow_completed' | 'escalation_triggered' | 'circuit_opened';
        workflow: RecoveryWorkflow;
        attempt?: RecoveryAttempt;
    }> {
        return this.workflowEvents$.asObservable();
    }

    /**
     * Update configuration
     */
    public updateConfig(newConfig: Partial<RecoveryWorkflowConfig>): void {
        this.config = { ...this.config, ...newConfig };
    }

    /**
     * Get current configuration
     */
    public getConfig(): RecoveryWorkflowConfig {
        return { ...this.config };
    }

    /**
     * Get recovery statistics
     */
    public getRecoveryStats(): {
        totalWorkflows: number;
        successfulRecoveries: number;
        escalatedWorkflows: number;
        circuitBreakerActivations: number;
        averageRecoveryTime: number;
        learnedPatterns: number;
        workflowsByType: Record<RecoveryWorkflowType, number>;
    } {
        let totalWorkflows = 0;
        let successfulRecoveries = 0;
        let escalatedWorkflows = 0;
        let totalRecoveryTime = 0;
        const workflowsByType: Record<string, number> = {};

        for (const workflows of this.workflowHistory.values()) {
            for (const workflow of workflows) {
                totalWorkflows++;
                totalRecoveryTime += workflow.endTime ? workflow.endTime - workflow.startTime : 0;
                
                if (workflow.status === 'successful') successfulRecoveries++;
                if (workflow.status === 'escalated') escalatedWorkflows++;
                
                workflowsByType[workflow.workflowType] = (workflowsByType[workflow.workflowType] || 0) + 1;
            }
        }

        const circuitBreakerActivations = Array.from(this.circuitBreakers.values())
            .filter(state => state.isOpen).length;

        return {
            totalWorkflows,
            successfulRecoveries,
            escalatedWorkflows,
            circuitBreakerActivations,
            averageRecoveryTime: totalWorkflows > 0 ? totalRecoveryTime / totalWorkflows : 0,
            learnedPatterns: this.recoveryPatterns.size,
            workflowsByType: workflowsByType as Record<RecoveryWorkflowType, number>
        };
    }

    /**
     * Get active workflows
     */
    public getActiveWorkflows(): RecoveryWorkflow[] {
        return Array.from(this.activeWorkflows.values());
    }

    /**
     * Get circuit breaker states
     */
    public getCircuitBreakerStates(): Record<string, CircuitBreakerState> {
        const states: Record<string, CircuitBreakerState> = {};
        for (const [key, state] of this.circuitBreakers.entries()) {
            states[key] = { ...state };
        }
        return states;
    }

    /**
     * Reset circuit breaker for a specific key
     */
    public resetCircuitBreaker(circuitBreakerKey: string): boolean {
        const state = this.circuitBreakers.get(circuitBreakerKey);
        if (state) {
            state.isOpen = false;
            state.failureCount = 0;
            delete state.halfOpenTime;
            return true;
        }
        return false;
    }

    /**
     * Clear all workflow history (for testing/cleanup)
     */
    public clearWorkflowHistory(): void {
        this.workflowHistory.clear();
        this.activeWorkflows.clear();
        this.recoveryPatterns.clear();
        this.circuitBreakers.clear();
    }
}