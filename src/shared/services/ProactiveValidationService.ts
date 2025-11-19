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
 * ProactiveValidationService - Phase 5 Proactive Validation System
 * 
 * Orchestrates pre-execution validation for tool calls with risk-based validation levels.
 * Provides proactive validation to prevent errors before tool execution.
 */

import { Observable, Subject } from 'rxjs';
import { Logger } from '../utils/Logger';
import { EventBus } from '../events/EventBus';
import { Events } from '../events/EventNames';
import { ValidationPerformanceService } from './ValidationPerformanceService';
import { PatternLearningService } from './PatternLearningService';
import { AgentId } from '../types/Agent';
import { ChannelId } from '../types/ChannelContext';

/**
 * Risk-based validation levels
 */
export enum ValidationLevel {
    NONE = 'NONE',           // No validation, direct execution
    ASYNC = 'ASYNC',         // Background validation, don't block execution
    BLOCKING = 'BLOCKING',   // Block execution until validation passes
    STRICT = 'STRICT'        // Strict validation with enhanced checks
}

/**
 * Validation context for a tool call
 */
export interface ValidationContext {
    agentId: AgentId;
    channelId: ChannelId;
    toolName: string;
    parameters: Record<string, any>;
    requestId: string;
    timestamp: number;
    validationLevel: ValidationLevel;
    riskScore: number;
    executionHistory?: any[];
}

/**
 * Validation result
 */
export interface ValidationResult {
    valid: boolean;
    validationId: string;
    errors: ValidationError[];
    warnings: ValidationWarning[];
    suggestions: ValidationSuggestion[];
    confidenceScore: number;
    executionTime: number;
    riskAssessment: RiskAssessment;
    cachedResult: boolean;
}

/**
 * Validation error
 */
export interface ValidationError {
    type: 'SCHEMA' | 'BUSINESS_LOGIC' | 'SECURITY' | 'PERFORMANCE' | 'PATTERN';
    message: string;
    field?: string;
    severity: 'HIGH' | 'MEDIUM' | 'LOW';
    suggestedFix?: string;
}

/**
 * Validation warning
 */
export interface ValidationWarning {
    type: 'PERFORMANCE' | 'BEST_PRACTICE' | 'DEPRECATION' | 'PATTERN';
    message: string;
    field?: string;
    impact: 'HIGH' | 'MEDIUM' | 'LOW';
}

/**
 * Validation suggestion
 */
export interface ValidationSuggestion {
    type: 'PARAMETER_IMPROVEMENT' | 'ALTERNATIVE_TOOL' | 'PATTERN_USAGE';
    message: string;
    expectedBenefit: string;
    confidence: number;
}

/**
 * Risk assessment
 */
export interface RiskAssessment {
    overallRisk: 'HIGH' | 'MEDIUM' | 'LOW';
    riskFactors: string[];
    mitigationStrategies: string[];
    recommendedValidationLevel: ValidationLevel;
}

/**
 * Tool risk profile
 */
export interface ToolRiskProfile {
    toolName: string;
    baseRiskLevel: ValidationLevel;
    riskFactors: {
        parametersComplexity: number;
        failureRate: number;
        securityImpact: number;
        performanceImpact: number;
    };
    validationRules: ValidationRule[];
    lastUpdated: number;
}

/**
 * Validation rule
 */
export interface ValidationRule {
    ruleId: string;
    type: 'SCHEMA' | 'BUSINESS_LOGIC' | 'SECURITY' | 'PERFORMANCE' | 'PATTERN';
    condition: string;
    action: 'BLOCK' | 'WARN' | 'SUGGEST';
    message: string;
    enabled: boolean;
}

/**
 * Proactive validation configuration
 */
export interface ProactiveValidationConfig {
    enabled: boolean;
    defaultValidationLevel: ValidationLevel;
    maxValidationLatency: number; // ms
    cacheEnabled: boolean;
    cacheTTL: number; // ms
    riskAssessmentEnabled: boolean;
    learningEnabled: boolean;
    performanceThresholds: {
        validationLatency: number;
        cacheHitRate: number;
        errorReduction: number;
    };
}

/**
 * Validation events
 */
export interface ValidationEvent {
    timestamp: number;
    agentId: AgentId;
    channelId: ChannelId;
    toolName: string;
    eventType: 'VALIDATION_START' | 'VALIDATION_COMPLETE' | 'VALIDATION_FAILED' | 'RISK_ASSESSED';
    validationId: string;
    details: any;
}

/**
 * Proactive Validation Service
 */
export class ProactiveValidationService {
    private readonly logger: Logger;
    private readonly validationPerformanceService: ValidationPerformanceService;
    private readonly patternLearningService: PatternLearningService;
    
    // Configuration
    private config: ProactiveValidationConfig;
    
    // Tool risk profiles cache
    private readonly toolRiskProfiles = new Map<string, ToolRiskProfile>();
    private readonly toolRiskCacheExpiry = new Map<string, number>();
    private readonly RISK_CACHE_TTL = 30 * 60 * 1000; // 30 minutes
    
    // Active validations tracking
    private readonly activeValidations = new Map<string, ValidationContext>();
    
    // Events
    private readonly validationEvents$ = new Subject<ValidationEvent>();
    
    // Performance metrics
    private readonly metrics = {
        totalValidations: 0,
        validationLatencySum: 0,
        cacheHits: 0,
        cacheMisses: 0,
        errorsBlocked: 0,
        warningsGenerated: 0,
        suggestionsProvided: 0
    };
    
    private static instance: ProactiveValidationService;

    private constructor() {
        this.logger = new Logger('info', 'ProactiveValidationService', 'server');
        this.validationPerformanceService = ValidationPerformanceService.getInstance();
        this.patternLearningService = PatternLearningService.getInstance();
        
        this.config = this.getDefaultConfig();
        this.setupEventListeners();
        this.startPeriodicTasks();
        
    }

    /**
     * Get singleton instance
     */
    public static getInstance(): ProactiveValidationService {
        if (!ProactiveValidationService.instance) {
            ProactiveValidationService.instance = new ProactiveValidationService();
        }
        return ProactiveValidationService.instance;
    }

    // =============================================================================
    // CORE VALIDATION METHODS
    // =============================================================================

    /**
     * Validate a tool call before execution
     */
    public async validateToolCall(
        agentId: AgentId,
        channelId: ChannelId,
        toolName: string,
        parameters: Record<string, any>,
        requestId: string
    ): Promise<ValidationResult> {
        if (!this.config.enabled) {
            return this.createPassthroughResult(requestId);
        }

        const startTime = Date.now();
        const validationId = `val_${requestId}_${startTime}`;
        
        // Assess risk and determine validation level
        const riskScore = await this.assessRisk(agentId, channelId, toolName, parameters);
        const validationLevel = this.determineValidationLevel(toolName, riskScore);
        
        const context: ValidationContext = {
            agentId,
            channelId,
            toolName,
            parameters,
            requestId,
            timestamp: startTime,
            validationLevel,
            riskScore
        };

        // Track active validation
        this.activeValidations.set(validationId, context);
        
        // Emit validation start event
        this.emitValidationEvent({
            timestamp: startTime,
            agentId,
            channelId,
            toolName,
            eventType: 'VALIDATION_START',
            validationId,
            details: { validationLevel, riskScore }
        });

        try {
            // Perform validation based on level
            let result: ValidationResult;
            
            switch (validationLevel) {
                case ValidationLevel.NONE:
                    result = this.createPassthroughResult(validationId);
                    break;
                case ValidationLevel.ASYNC:
                    result = await this.performAsyncValidation(context);
                    break;
                case ValidationLevel.BLOCKING:
                    result = await this.performBlockingValidation(context);
                    break;
                case ValidationLevel.STRICT:
                    result = await this.performStrictValidation(context);
                    break;
                default:
                    result = await this.performBlockingValidation(context);
            }

            // Update metrics
            this.updateMetrics(result, Date.now() - startTime);
            
            // Clean up
            this.activeValidations.delete(validationId);
            
            // Emit validation complete event
            this.emitValidationEvent({
                timestamp: Date.now(),
                agentId,
                channelId,
                toolName,
                eventType: 'VALIDATION_COMPLETE',
                validationId,
                details: { 
                    valid: result.valid, 
                    errors: result.errors.length, 
                    warnings: result.warnings.length,
                    executionTime: result.executionTime
                }
            });

            return result;

        } catch (error) {
            this.logger.error(`Validation failed for ${toolName}:`, error);
            
            // Clean up
            this.activeValidations.delete(validationId);
            
            // Emit validation failed event
            this.emitValidationEvent({
                timestamp: Date.now(),
                agentId,
                channelId,
                toolName,
                eventType: 'VALIDATION_FAILED',
                validationId,
                details: { error: error instanceof Error ? error.message : String(error) }
            });

            // Return permissive result on validation failure
            return {
                valid: true,
                validationId,
                errors: [{
                    type: 'BUSINESS_LOGIC',
                    message: `Validation system error: ${error instanceof Error ? error.message : String(error)}`,
                    severity: 'LOW',
                    suggestedFix: 'Contact system administrator if this persists'
                }],
                warnings: [],
                suggestions: [],
                confidenceScore: 0.1,
                executionTime: Date.now() - startTime,
                riskAssessment: {
                    overallRisk: 'LOW',
                    riskFactors: ['validation_system_error'],
                    mitigationStrategies: ['proceed_with_caution'],
                    recommendedValidationLevel: ValidationLevel.NONE
                },
                cachedResult: false
            };
        }
    }

    /**
     * Get validation hints for parameter completion
     */
    public async getValidationHints(
        agentId: AgentId,
        channelId: ChannelId,
        toolName: string,
        partialParameters: Record<string, any>
    ): Promise<{
        parameterHints: Record<string, any>;
        validationPreviews: ValidationError[];
        patternSuggestions: any[];
        completionSuggestions: string[];
    }> {
        try {
            // Get patterns for this tool
            const patterns = await this.patternLearningService.getEnhancedPatterns(
                channelId, 
                toolName, 
                true
            );

            // Get parameter hints from successful patterns
            const parameterHints: Record<string, any> = {};
            for (const pattern of patterns.successful) {
                for (const [key, value] of Object.entries(pattern.parameters)) {
                    if (!partialParameters[key]) {
                        if (!parameterHints[key]) {
                            parameterHints[key] = [];
                        }
                        parameterHints[key].push({
                            value,
                            frequency: pattern.frequency,
                            confidence: pattern.confidenceScore
                        });
                    }
                }
            }

            // Sort hints by frequency and confidence
            for (const key in parameterHints) {
                parameterHints[key] = parameterHints[key]
                    .sort((a: any, b: any) => (b.frequency * b.confidence) - (a.frequency * a.confidence))
                    .slice(0, 5); // Top 5 hints per parameter
            }

            // Preview validation errors
            const validationPreviews = await this.previewValidationErrors(
                toolName, 
                partialParameters
            );

            // Get pattern-based suggestions
            const patternSuggestions = patterns.successful
                .filter(p => p.confidenceScore > 0.7)
                .slice(0, 3)
                .map(p => ({
                    parameters: p.parameters,
                    confidence: p.confidenceScore,
                    frequency: p.frequency,
                    reason: `Used successfully ${p.frequency} times`
                }));

            // Generate completion suggestions
            const completionSuggestions = this.generateCompletionSuggestions(
                toolName,
                partialParameters,
                patterns
            );

            return {
                parameterHints,
                validationPreviews,
                patternSuggestions,
                completionSuggestions
            };

        } catch (error) {
            this.logger.error(`Failed to get validation hints for ${toolName}:`, error);
            return {
                parameterHints: {},
                validationPreviews: [],
                patternSuggestions: [],
                completionSuggestions: []
            };
        }
    }

    // =============================================================================
    // VALIDATION LEVEL IMPLEMENTATIONS
    // =============================================================================

    private async performAsyncValidation(context: ValidationContext): Promise<ValidationResult> {
        // Async validation - don't block execution, validate in background
        const startTime = Date.now();
        
        // Start background validation
        this.performBackgroundValidation(context).catch(error => {
            this.logger.warn(`Background validation failed for ${context.toolName}:`, error);
        });

        return {
            valid: true, // Allow execution to proceed
            validationId: `async_${context.requestId}`,
            errors: [],
            warnings: [{
                type: 'PERFORMANCE',
                message: 'Validation running in background',
                impact: 'LOW'
            }],
            suggestions: [],
            confidenceScore: 0.8,
            executionTime: Date.now() - startTime,
            riskAssessment: {
                overallRisk: 'LOW',
                riskFactors: ['async_validation'],
                mitigationStrategies: ['background_monitoring'],
                recommendedValidationLevel: ValidationLevel.ASYNC
            },
            cachedResult: false
        };
    }

    private async performBlockingValidation(context: ValidationContext): Promise<ValidationResult> {
        const startTime = Date.now();
        const errors: ValidationError[] = [];
        const warnings: ValidationWarning[] = [];
        const suggestions: ValidationSuggestion[] = [];

        // Schema validation
        const schemaErrors = await this.validateSchema(context.toolName, context.parameters);
        errors.push(...schemaErrors);

        // Business logic validation
        const businessLogicErrors = await this.validateBusinessLogic(context);
        errors.push(...businessLogicErrors);

        // Pattern-based validation
        const patternAnalysis = await this.validateAgainstPatterns(context);
        errors.push(...patternAnalysis.errors);
        warnings.push(...patternAnalysis.warnings);
        suggestions.push(...patternAnalysis.suggestions);

        // Performance validation
        const performanceWarnings = await this.validatePerformance(context);
        warnings.push(...performanceWarnings);

        const valid = errors.filter(e => e.severity === 'HIGH').length === 0;
        const confidenceScore = this.calculateConfidenceScore(errors, warnings, context.riskScore);

        return {
            valid,
            validationId: `blocking_${context.requestId}`,
            errors,
            warnings,
            suggestions,
            confidenceScore,
            executionTime: Date.now() - startTime,
            riskAssessment: await this.createRiskAssessment(context, errors, warnings),
            cachedResult: false
        };
    }

    private async performStrictValidation(context: ValidationContext): Promise<ValidationResult> {
        const startTime = Date.now();
        
        // Perform blocking validation first
        const blockingResult = await this.performBlockingValidation(context);
        
        // Add strict validation checks
        const securityErrors = await this.validateSecurity(context);
        const complianceErrors = await this.validateCompliance(context);
        const crossValidationWarnings = await this.performCrossValidation(context);

        blockingResult.errors.push(...securityErrors, ...complianceErrors);
        blockingResult.warnings.push(...crossValidationWarnings);

        // Strict validation requires no HIGH or MEDIUM severity errors
        const valid = blockingResult.errors.filter(e => 
            e.severity === 'HIGH' || e.severity === 'MEDIUM'
        ).length === 0;

        blockingResult.valid = valid;
        blockingResult.validationId = `strict_${context.requestId}`;
        blockingResult.executionTime = Date.now() - startTime;
        blockingResult.confidenceScore = this.calculateConfidenceScore(
            blockingResult.errors, 
            blockingResult.warnings, 
            context.riskScore
        );

        return blockingResult;
    }

    // =============================================================================
    // RISK ASSESSMENT
    // =============================================================================

    private async assessRisk(
        agentId: AgentId,
        channelId: ChannelId,
        toolName: string,
        parameters: Record<string, any>
    ): Promise<number> {
        try {
            let riskScore = 0;

            // Get tool risk profile
            const toolProfile = await this.getToolRiskProfile(toolName);
            riskScore += toolProfile.riskFactors.parametersComplexity * 0.2;
            riskScore += toolProfile.riskFactors.failureRate * 0.3;
            riskScore += toolProfile.riskFactors.securityImpact * 0.3;
            riskScore += toolProfile.riskFactors.performanceImpact * 0.2;

            // Agent-specific risk factors
            const validationMetrics = await this.validationPerformanceService.getValidationMetrics(
                agentId, 
                channelId
            );
            
            const toolErrorRate = validationMetrics.validationErrorsByTool[toolName] || 0;
            if (toolErrorRate > 5) {
                riskScore += 0.3; // High error rate increases risk
            }

            // Parameter complexity risk
            const parameterCount = Object.keys(parameters).length;
            if (parameterCount > 5) {
                riskScore += 0.1;
            }

            // Check for known failed patterns
            const patterns = await this.patternLearningService.getEnhancedPatterns(
                channelId, 
                toolName, 
                false
            );
            
            const hasFailedPattern = patterns.failed.some(p => 
                this.parametersMatch(parameters, p.parameters, 0.8)
            );
            
            if (hasFailedPattern) {
                riskScore += 0.4;
            }

            return Math.min(1.0, Math.max(0, riskScore));

        } catch (error) {
            this.logger.warn(`Risk assessment failed for ${toolName}:`, error);
            return 0.5; // Default medium risk
        }
    }

    private determineValidationLevel(toolName: string, riskScore: number): ValidationLevel {
        // Get tool-specific base level
        const toolProfile = this.toolRiskProfiles.get(toolName);
        const baseLevel = toolProfile?.baseRiskLevel || this.config.defaultValidationLevel;

        // Adjust based on risk score
        if (riskScore >= 0.8) {
            return ValidationLevel.STRICT;
        } else if (riskScore >= 0.5) {
            return ValidationLevel.BLOCKING;
        } else if (riskScore >= 0.2) {
            return ValidationLevel.ASYNC;
        } else {
            return baseLevel;
        }
    }

    private async getToolRiskProfile(toolName: string): Promise<ToolRiskProfile> {
        // Check cache first
        const cached = this.toolRiskProfiles.get(toolName);
        const cacheExpiry = this.toolRiskCacheExpiry.get(toolName);
        
        if (cached && cacheExpiry && Date.now() < cacheExpiry) {
            return cached;
        }

        // Create or update tool risk profile
        const profile: ToolRiskProfile = {
            toolName,
            baseRiskLevel: this.getDefaultRiskLevel(toolName),
            riskFactors: {
                parametersComplexity: this.assessParametersComplexity(toolName),
                failureRate: await this.getToolFailureRate(toolName),
                securityImpact: this.assessSecurityImpact(toolName),
                performanceImpact: this.assessPerformanceImpact(toolName)
            },
            validationRules: this.getValidationRules(toolName),
            lastUpdated: Date.now()
        };

        // Cache the profile
        this.toolRiskProfiles.set(toolName, profile);
        this.toolRiskCacheExpiry.set(toolName, Date.now() + this.RISK_CACHE_TTL);

        return profile;
    }

    // =============================================================================
    // VALIDATION IMPLEMENTATIONS
    // =============================================================================

    private async validateSchema(toolName: string, parameters: Record<string, any>): Promise<ValidationError[]> {
        const errors: ValidationError[] = [];
        
        // Basic schema validation - this would be enhanced with actual schema definitions
        try {
            // Check for null/undefined required parameters
            if (!parameters || typeof parameters !== 'object') {
                errors.push({
                    type: 'SCHEMA',
                    message: 'Parameters must be a valid object',
                    severity: 'HIGH',
                    suggestedFix: 'Provide a valid parameters object'
                });
            }

            // Tool-specific schema checks would go here
            // This is a simplified implementation
            
        } catch (error) {
            errors.push({
                type: 'SCHEMA',
                message: `Schema validation error: ${error instanceof Error ? error.message : String(error)}`,
                severity: 'MEDIUM',
                suggestedFix: 'Check parameter format and types'
            });
        }

        return errors;
    }

    private async validateBusinessLogic(context: ValidationContext): Promise<ValidationError[]> {
        const errors: ValidationError[] = [];
        
        // Business logic validation based on tool and context
        try {
            // Example: Check for potentially destructive operations
            if (this.isDestructiveOperation(context.toolName, context.parameters)) {
                errors.push({
                    type: 'BUSINESS_LOGIC',
                    message: 'Potentially destructive operation detected',
                    severity: 'HIGH',
                    suggestedFix: 'Verify this operation is intentional and safe'
                });
            }

            // Example: Check for resource intensive operations
            if (this.isResourceIntensive(context.toolName, context.parameters)) {
                errors.push({
                    type: 'PERFORMANCE',
                    message: 'Resource intensive operation detected',
                    severity: 'MEDIUM',
                    suggestedFix: 'Consider optimizing parameters or using alternative approach'
                });
            }

        } catch (error) {
            this.logger.warn(`Business logic validation error for ${context.toolName}:`, error);
        }

        return errors;
    }

    private async validateAgainstPatterns(context: ValidationContext): Promise<{
        errors: ValidationError[];
        warnings: ValidationWarning[];
        suggestions: ValidationSuggestion[];
    }> {
        const errors: ValidationError[] = [];
        const warnings: ValidationWarning[] = [];
        const suggestions: ValidationSuggestion[] = [];

        try {
            const patterns = await this.patternLearningService.getEnhancedPatterns(
                context.channelId,
                context.toolName,
                true
            );

            // Check against failed patterns
            for (const failedPattern of patterns.failed) {
                if (this.parametersMatch(context.parameters, failedPattern.parameters, 0.9)) {
                    errors.push({
                        type: 'PATTERN',
                        message: `Parameters match known failed pattern: ${failedPattern.errorType}`,
                        severity: 'HIGH',
                        suggestedFix: failedPattern.metadata.validationInsights.suggestedFixes[0] || 'Modify parameters'
                    });
                }
            }

            // Check for improvement opportunities
            for (const successfulPattern of patterns.successful) {
                if (successfulPattern.confidenceScore > 0.8 && 
                    this.parametersMatch(context.parameters, successfulPattern.parameters, 0.7)) {
                    
                    suggestions.push({
                        type: 'PATTERN_USAGE',
                        message: `Similar successful pattern available with ${Math.round(successfulPattern.confidenceScore * 100)}% confidence`,
                        expectedBenefit: 'Higher success rate and faster execution',
                        confidence: successfulPattern.confidenceScore
                    });
                }
            }

        } catch (error) {
            this.logger.warn(`Pattern validation error for ${context.toolName}:`, error);
        }

        return { errors, warnings, suggestions };
    }

    private async validatePerformance(context: ValidationContext): Promise<ValidationWarning[]> {
        const warnings: ValidationWarning[] = [];

        try {
            // Check for known performance issues with this tool/parameter combination
            const validationMetrics = await this.validationPerformanceService.getValidationMetrics(
                context.agentId,
                context.channelId
            );

            const toolRecoveryTime = validationMetrics.recoveryTime.byTool[context.toolName];
            if (toolRecoveryTime && toolRecoveryTime > 5000) { // 5 seconds
                warnings.push({
                    type: 'PERFORMANCE',
                    message: `Tool has historically slow recovery time: ${toolRecoveryTime}ms`,
                    impact: 'MEDIUM'
                });
            }

        } catch (error) {
            this.logger.warn(`Performance validation error for ${context.toolName}:`, error);
        }

        return warnings;
    }

    private async validateSecurity(context: ValidationContext): Promise<ValidationError[]> {
        const errors: ValidationError[] = [];

        try {
            // Security validation checks
            if (this.hasSecurityRisk(context.toolName, context.parameters)) {
                errors.push({
                    type: 'SECURITY',
                    message: 'Potential security risk detected in parameters',
                    severity: 'HIGH',
                    suggestedFix: 'Review and sanitize sensitive parameters'
                });
            }

        } catch (error) {
            this.logger.warn(`Security validation error for ${context.toolName}:`, error);
        }

        return errors;
    }

    private async validateCompliance(context: ValidationContext): Promise<ValidationError[]> {
        const errors: ValidationError[] = [];

        try {
            // Compliance validation checks would go here
            // This is a placeholder for future compliance requirements
            
        } catch (error) {
            this.logger.warn(`Compliance validation error for ${context.toolName}:`, error);
        }

        return errors;
    }

    private async performCrossValidation(context: ValidationContext): Promise<ValidationWarning[]> {
        const warnings: ValidationWarning[] = [];

        try {
            // Cross-validation against other agents' experiences
            // This would check patterns across multiple agents/channels
            
        } catch (error) {
            this.logger.warn(`Cross validation error for ${context.toolName}:`, error);
        }

        return warnings;
    }

    // =============================================================================
    // HELPER METHODS
    // =============================================================================

    private createPassthroughResult(validationId: string): ValidationResult {
        return {
            valid: true,
            validationId,
            errors: [],
            warnings: [],
            suggestions: [],
            confidenceScore: 1.0,
            executionTime: 0,
            riskAssessment: {
                overallRisk: 'LOW',
                riskFactors: [],
                mitigationStrategies: [],
                recommendedValidationLevel: ValidationLevel.NONE
            },
            cachedResult: false
        };
    }

    private async performBackgroundValidation(context: ValidationContext): Promise<void> {
        // Perform validation without blocking
        setTimeout(async () => {
            try {
                const result = await this.performBlockingValidation(context);
                
                // Store results for future reference
                if (!result.valid) {
                    this.logger.warn(`Background validation found issues for ${context.toolName}:`, result.errors);
                    
                    // Could emit events or store for analytics
                    this.emitValidationEvent({
                        timestamp: Date.now(),
                        agentId: context.agentId,
                        channelId: context.channelId,
                        toolName: context.toolName,
                        eventType: 'VALIDATION_COMPLETE',
                        validationId: `bg_${context.requestId}`,
                        details: { backgroundValidation: true, result }
                    });
                }
            } catch (error) {
                this.logger.warn(`Background validation failed for ${context.toolName}:`, error);
            }
        }, 0);
    }

    private async previewValidationErrors(
        toolName: string, 
        partialParameters: Record<string, any>
    ): Promise<ValidationError[]> {
        try {
            // Quick validation preview without full context
            return await this.validateSchema(toolName, partialParameters);
        } catch (error) {
            this.logger.warn(`Validation preview failed for ${toolName}:`, error);
            return [];
        }
    }

    private generateCompletionSuggestions(
        toolName: string,
        partialParameters: Record<string, any>,
        patterns: any
    ): string[] {
        const suggestions: string[] = [];

        try {
            // Generate suggestions based on missing parameters
            const allSuccessfulParams = new Set<string>();
            patterns.successful.forEach((p: any) => {
                Object.keys(p.parameters).forEach(key => allSuccessfulParams.add(key));
            });

            const currentParams = new Set(Object.keys(partialParameters));
            const missingParams = [...allSuccessfulParams].filter(p => !currentParams.has(p));

            if (missingParams.length > 0) {
                suggestions.push(`Consider adding parameters: ${missingParams.slice(0, 3).join(', ')}`);
            }

            // Tool-specific suggestions
            if (toolName.includes('file') && !partialParameters.path) {
                suggestions.push('File operations typically require a path parameter');
            }

            if (toolName.includes('memory') && !partialParameters.key) {
                suggestions.push('Memory operations typically require a key parameter');
            }

        } catch (error) {
            this.logger.warn(`Failed to generate completion suggestions for ${toolName}:`, error);
        }

        return suggestions;
    }

    private parametersMatch(params1: Record<string, any>, params2: Record<string, any>, threshold: number): boolean {
        try {
            const keys1 = new Set(Object.keys(params1));
            const keys2 = new Set(Object.keys(params2));
            
            const intersection = new Set([...keys1].filter(k => keys2.has(k)));
            const union = new Set([...keys1, ...keys2]);
            
            const similarity = intersection.size / union.size;
            return similarity >= threshold;
        } catch (error) {
            return false;
        }
    }

    private calculateConfidenceScore(
        errors: ValidationError[], 
        warnings: ValidationWarning[], 
        riskScore: number
    ): number {
        let score = 1.0;

        // Reduce score based on errors
        errors.forEach(error => {
            switch (error.severity) {
                case 'HIGH':
                    score -= 0.3;
                    break;
                case 'MEDIUM':
                    score -= 0.2;
                    break;
                case 'LOW':
                    score -= 0.1;
                    break;
            }
        });

        // Reduce score based on warnings
        warnings.forEach(warning => {
            switch (warning.impact) {
                case 'HIGH':
                    score -= 0.15;
                    break;
                case 'MEDIUM':
                    score -= 0.1;
                    break;
                case 'LOW':
                    score -= 0.05;
                    break;
            }
        });

        // Factor in risk score
        score -= riskScore * 0.2;

        return Math.max(0, Math.min(1, score));
    }

    private async createRiskAssessment(
        context: ValidationContext,
        errors: ValidationError[],
        warnings: ValidationWarning[]
    ): Promise<RiskAssessment> {
        const riskFactors: string[] = [];
        const mitigationStrategies: string[] = [];

        // Analyze errors and warnings for risk factors
        errors.forEach(error => {
            riskFactors.push(`${error.type.toLowerCase()}_error`);
        });

        warnings.forEach(warning => {
            riskFactors.push(`${warning.type.toLowerCase()}_concern`);
        });

        if (context.riskScore > 0.7) {
            riskFactors.push('high_risk_tool');
            mitigationStrategies.push('consider_alternative_approach');
        }

        // Determine overall risk
        const overallRisk = errors.some(e => e.severity === 'HIGH') ? 'HIGH' :
                           errors.some(e => e.severity === 'MEDIUM') || warnings.some(w => w.impact === 'HIGH') ? 'MEDIUM' :
                           'LOW';

        // Recommend validation level based on risk
        const recommendedValidationLevel = overallRisk === 'HIGH' ? ValidationLevel.STRICT :
                                         overallRisk === 'MEDIUM' ? ValidationLevel.BLOCKING :
                                         ValidationLevel.ASYNC;

        return {
            overallRisk,
            riskFactors,
            mitigationStrategies,
            recommendedValidationLevel
        };
    }

    // Tool-specific helper methods
    private getDefaultRiskLevel(toolName: string): ValidationLevel {
        // Define default risk levels for different tool categories

        // High-risk tools requiring blocking validation
        if (toolName.includes('file') || toolName.includes('shell') || toolName.includes('code_execute')) {
            return ValidationLevel.BLOCKING;
        }

        // Medium-risk tools with async validation
        if (toolName.includes('memory') || toolName.includes('context')) {
            return ValidationLevel.ASYNC;
        }
        if (toolName.includes('message') || toolName.includes('coordinate')) {
            return ValidationLevel.ASYNC;
        }

        return ValidationLevel.ASYNC;
    }

    private assessParametersComplexity(toolName: string): number {
        // Simplified complexity assessment
        if (toolName.includes('coordinate') || toolName.includes('controlLoop')) {
            return 0.8;
        }
        if (toolName.includes('memory') || toolName.includes('context')) {
            return 0.6;
        }
        return 0.4;
    }

    private async getToolFailureRate(toolName: string): Promise<number> {
        try {
            // This would query historical failure rates
            // Simplified implementation
            return 0.1; // 10% default failure rate
        } catch (error) {
            return 0.1;
        }
    }

    private assessSecurityImpact(toolName: string): number {
        // High security impact - execution and file system access
        if (toolName.includes('shell') || toolName.includes('file') || toolName.includes('code_execute')) {
            return 0.9;
        }
        // Medium security impact - data access
        if (toolName.includes('memory') || toolName.includes('context')) {
            return 0.5;
        }
        // Low security impact - read-only or benign operations
        return 0.2;
    }

    private assessPerformanceImpact(toolName: string): number {
        if (toolName.includes('controlLoop') || toolName.includes('coordinate')) {
            return 0.7;
        }
        if (toolName.includes('memory') || toolName.includes('search')) {
            return 0.5;
        }
        return 0.3;
    }

    private getValidationRules(toolName: string): ValidationRule[] {
        // Return tool-specific validation rules
        const rules: ValidationRule[] = [];

        // Common rules for all tools
        rules.push({
            ruleId: 'non_empty_params',
            type: 'SCHEMA',
            condition: 'parameters != null && parameters != undefined',
            action: 'BLOCK',
            message: 'Parameters cannot be null or undefined',
            enabled: true
        });

        return rules;
    }

    private isDestructiveOperation(toolName: string, parameters: Record<string, any>): boolean {
        const destructiveKeywords = ['delete', 'remove', 'clear', 'reset', 'destroy'];
        return destructiveKeywords.some(keyword => 
            toolName.toLowerCase().includes(keyword) ||
            JSON.stringify(parameters).toLowerCase().includes(keyword)
        );
    }

    private isResourceIntensive(toolName: string, parameters: Record<string, any>): boolean {
        // Check for operations that might be resource intensive
        return toolName.includes('controlLoop') || 
               (parameters.limit && parameters.limit > 1000) ||
               (parameters.count && parameters.count > 100);
    }

    private hasSecurityRisk(toolName: string, parameters: Record<string, any>): boolean {
        // Basic security risk detection
        const riskKeywords = ['password', 'token', 'secret', 'key'];
        const paramString = JSON.stringify(parameters).toLowerCase();
        
        return riskKeywords.some(keyword => paramString.includes(keyword));
    }

    private updateMetrics(result: ValidationResult, executionTime: number): void {
        this.metrics.totalValidations++;
        this.metrics.validationLatencySum += executionTime;
        
        if (result.cachedResult) {
            this.metrics.cacheHits++;
        } else {
            this.metrics.cacheMisses++;
        }
        
        this.metrics.errorsBlocked += result.errors.filter(e => e.severity === 'HIGH').length;
        this.metrics.warningsGenerated += result.warnings.length;
        this.metrics.suggestionsProvided += result.suggestions.length;
    }

    private getDefaultConfig(): ProactiveValidationConfig {
        return {
            enabled: true,
            defaultValidationLevel: ValidationLevel.ASYNC,
            maxValidationLatency: 50, // 50ms max latency requirement
            cacheEnabled: true,
            cacheTTL: 5 * 60 * 1000, // 5 minutes
            riskAssessmentEnabled: true,
            learningEnabled: true,
            performanceThresholds: {
                validationLatency: 50,
                cacheHitRate: 0.7,
                errorReduction: 0.3
            }
        };
    }

    private setupEventListeners(): void {
        // Listen to tool execution events for learning
        EventBus.server.on(Events.Mcp.TOOL_ERROR, (payload) => {
            // Learn from validation failures
            this.learnFromValidationFailure(payload).catch(error => {
                this.logger.warn('Failed to learn from validation failure:', error);
            });
        });

        EventBus.server.on(Events.Mcp.TOOL_RESULT, (payload) => {
            // Learn from successful validations
            this.learnFromValidationSuccess(payload).catch(error => {
                this.logger.warn('Failed to learn from validation success:', error);
            });
        });
    }

    private startPeriodicTasks(): void {
        // Performance metrics reporting
        setInterval(() => {
            this.reportPerformanceMetrics();
        }, 60 * 1000); // Every minute

        // Risk profile updates
        setInterval(() => {
            this.updateRiskProfiles().catch(error => {
                this.logger.warn('Failed to update risk profiles:', error);
            });
        }, 10 * 60 * 1000); // Every 10 minutes

        // Cache cleanup
        setInterval(() => {
            this.cleanupExpiredCaches();
        }, 5 * 60 * 1000); // Every 5 minutes
    }

    private async learnFromValidationFailure(payload: any): Promise<void> {
        // Update tool risk profiles based on failures
        try {
            const toolName = payload.toolName || payload.data?.toolName;
            if (toolName) {
                const profile = await this.getToolRiskProfile(toolName);
                profile.riskFactors.failureRate = Math.min(1.0, profile.riskFactors.failureRate + 0.1);
                profile.lastUpdated = Date.now();
                
                // Update cache
                this.toolRiskProfiles.set(toolName, profile);
            }
        } catch (error) {
            this.logger.warn('Failed to learn from validation failure:', error);
        }
    }

    private async learnFromValidationSuccess(payload: any): Promise<void> {
        // Update tool risk profiles based on successes
        try {
            const toolName = payload.toolName || payload.data?.toolName;
            if (toolName) {
                const profile = await this.getToolRiskProfile(toolName);
                profile.riskFactors.failureRate = Math.max(0, profile.riskFactors.failureRate - 0.05);
                profile.lastUpdated = Date.now();
                
                // Update cache
                this.toolRiskProfiles.set(toolName, profile);
            }
        } catch (error) {
            this.logger.warn('Failed to learn from validation success:', error);
        }
    }

    private reportPerformanceMetrics(): void {
        if (this.metrics.totalValidations === 0) return;

        const avgLatency = this.metrics.validationLatencySum / this.metrics.totalValidations;
        const cacheHitRate = this.metrics.cacheHits / (this.metrics.cacheHits + this.metrics.cacheMisses);


        // Check if performance thresholds are met
        if (avgLatency > this.config.performanceThresholds.validationLatency) {
            this.logger.warn(`⚠️ Validation latency (${avgLatency.toFixed(1)}ms) exceeds threshold ` +
                           `(${this.config.performanceThresholds.validationLatency}ms)`);
        }

        if (cacheHitRate < this.config.performanceThresholds.cacheHitRate) {
            this.logger.warn(`⚠️ Cache hit rate (${(cacheHitRate * 100).toFixed(1)}%) below threshold ` +
                           `(${(this.config.performanceThresholds.cacheHitRate * 100).toFixed(1)}%)`);
        }
    }

    private async updateRiskProfiles(): Promise<void> {
        try {
            // Update risk profiles based on recent performance data
            for (const [toolName, profile] of this.toolRiskProfiles.entries()) {
                if (Date.now() - profile.lastUpdated > this.RISK_CACHE_TTL) {
                    // Refresh the profile
                    await this.getToolRiskProfile(toolName);
                }
            }
        } catch (error) {
            this.logger.warn('Failed to update risk profiles:', error);
        }
    }

    private cleanupExpiredCaches(): void {
        const now = Date.now();
        for (const [key, expiry] of this.toolRiskCacheExpiry.entries()) {
            if (now > expiry) {
                this.toolRiskProfiles.delete(key);
                this.toolRiskCacheExpiry.delete(key);
            }
        }
    }

    private emitValidationEvent(event: ValidationEvent): void {
        this.validationEvents$.next(event);
    }

    // =============================================================================
    // PUBLIC API
    // =============================================================================

    /**
     * Get validation events observable
     */
    public get validationEvents(): Observable<ValidationEvent> {
        return this.validationEvents$.asObservable();
    }

    /**
     * Update configuration
     */
    public updateConfig(newConfig: Partial<ProactiveValidationConfig>): void {
        this.config = { ...this.config, ...newConfig };
    }

    /**
     * Get current configuration
     */
    public getConfig(): ProactiveValidationConfig {
        return { ...this.config };
    }

    /**
     * Get performance metrics
     */
    public getPerformanceMetrics(): {
        totalValidations: number;
        averageLatency: number;
        cacheHitRate: number;
        errorsBlocked: number;
        warningsGenerated: number;
        suggestionsProvided: number;
    } {
        const totalCacheRequests = this.metrics.cacheHits + this.metrics.cacheMisses;
        
        return {
            totalValidations: this.metrics.totalValidations,
            averageLatency: this.metrics.totalValidations > 0 
                ? this.metrics.validationLatencySum / this.metrics.totalValidations 
                : 0,
            cacheHitRate: totalCacheRequests > 0 
                ? this.metrics.cacheHits / totalCacheRequests 
                : 0,
            errorsBlocked: this.metrics.errorsBlocked,
            warningsGenerated: this.metrics.warningsGenerated,
            suggestionsProvided: this.metrics.suggestionsProvided
        };
    }

    /**
     * Get active validations count
     */
    public getActiveValidationsCount(): number {
        return this.activeValidations.size;
    }

    /**
     * Get tool risk profile
     */
    public async getToolRiskProfilePublic(toolName: string): Promise<ToolRiskProfile> {
        return await this.getToolRiskProfile(toolName);
    }

    /**
     * Clear all caches (for testing/maintenance)
     */
    public clearCaches(): void {
        this.toolRiskProfiles.clear();
        this.toolRiskCacheExpiry.clear();
    }
}