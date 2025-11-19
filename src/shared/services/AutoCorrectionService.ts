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
 * AutoCorrectionService - Phase 4 Auto-Correction System
 * 
 * Orchestrates automatic correction of tool execution errors using:
 * - ValidationPerformanceService for error analysis
 * - PatternLearningService for correction strategies
 * - Machine learning-based error pattern recognition
 * - Retry logic with exponential backoff
 * - Safety constraints to prevent infinite loops
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
 * Correction strategy types
 */
export type CorrectionStrategyType = 
    | 'missing_required'
    | 'wrong_parameter_names' 
    | 'type_mismatch'
    | 'constraint_violation'
    | 'unknown_properties'
    | 'pattern_based'
    | 'schema_validation'
    | 'json_string_conversion';

/**
 * Correction attempt result
 */
export interface CorrectionAttempt {
    attemptId: string;
    timestamp: number;
    agentId: AgentId;
    channelId: ChannelId;
    toolName: string;
    originalParameters: Record<string, any>;
    correctedParameters: Record<string, any>;
    strategy: CorrectionStrategyType;
    confidence: number;
    successful: boolean;
    errorMessage?: string;
    recoveryTime?: number;
}

/**
 * Auto-correction configuration
 */
export interface AutoCorrectionConfig {
    enabled: boolean;
    maxRetryAttempts: number;
    confidenceThreshold: number;
    retryDelayBase: number; // milliseconds
    retryDelayMultiplier: number;
    maxRetryDelay: number; // milliseconds
    enabledStrategies: CorrectionStrategyType[];
    learnFromSuccessfulCorrections: boolean;
    auditAllAttempts: boolean;
}

/**
 * Correction strategy interface
 */
export interface CorrectionStrategy {
    type: CorrectionStrategyType;
    analyze(
        toolName: string,
        parameters: Record<string, any>,
        errorMessage: string,
        toolSchema?: any
    ): Promise<{
        canCorrect: boolean;
        confidence: number;
        suggestedCorrection?: Record<string, any>;
        reasoning?: string;
    }>;
}

/**
 * Auto-correction service for orchestrating automatic error correction
 */
export class AutoCorrectionService {
    private readonly logger: Logger;
    private readonly validationService: ValidationPerformanceService;
    private readonly patternService: PatternLearningService;
    
    // Correction tracking
    private readonly correctionAttempts = new Map<string, CorrectionAttempt[]>();
    private readonly retryTimers = new Map<string, NodeJS.Timeout>();
    
    // Events
    private readonly correctionEvents$ = new Subject<CorrectionAttempt>();
    
    // Configuration
    private config: AutoCorrectionConfig;
    
    // Correction strategies
    private readonly strategies = new Map<CorrectionStrategyType, CorrectionStrategy>();
    
    // Separate instances for client and server contexts
    private static serverInstance: AutoCorrectionService;
    private static clientInstance: AutoCorrectionService;

    private constructor(isClient: boolean = false) {
        const context = isClient ? 'client' : 'server';
        this.logger = new Logger('info', 'AutoCorrectionService', context);
        this.validationService = ValidationPerformanceService.getInstance();
        this.patternService = PatternLearningService.getInstance();
        
        this.config = this.getDefaultConfig();
        this.initializeStrategies();
        this.setupEventListeners();
        
    }

    /**
     * Get singleton instance for the specified context
     * @param isClient Whether this is for client-side logging (default: false for server)
     */
    public static getInstance(isClient: boolean = false): AutoCorrectionService {
        if (isClient) {
            if (!AutoCorrectionService.clientInstance) {
                AutoCorrectionService.clientInstance = new AutoCorrectionService(true);
            }
            return AutoCorrectionService.clientInstance;
        } else {
            if (!AutoCorrectionService.serverInstance) {
                AutoCorrectionService.serverInstance = new AutoCorrectionService(false);
            }
            return AutoCorrectionService.serverInstance;
        }
    }

    // =============================================================================
    // CORE AUTO-CORRECTION METHODS
    // =============================================================================

    /**
     * Attempt to automatically correct a failed tool execution
     */
    public async attemptCorrection(
        agentId: AgentId,
        channelId: ChannelId,
        toolName: string,
        originalParameters: Record<string, any>,
        errorMessage: string,
        toolSchema?: any
    ): Promise<{
        corrected: boolean;
        correctedParameters?: Record<string, any>;
        strategy?: CorrectionStrategyType;
        confidence?: number;
        attemptId?: string;
        shouldRetry: boolean;
        retryDelay?: number;
    }> {
        if (!this.config.enabled) {
            return { corrected: false, shouldRetry: false };
        }

        const correctionKey = `${agentId}:${channelId}:${toolName}`;
        const existingAttempts = this.correctionAttempts.get(correctionKey) || [];
        
        // Check if we've exceeded max retry attempts
        if (existingAttempts.length >= this.config.maxRetryAttempts) {
            this.logger.warn(`Max retry attempts (${this.config.maxRetryAttempts}) exceeded for ${toolName}`);
            return { corrected: false, shouldRetry: false };
        }

        const attemptId = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        

        try {
            // Find the best correction strategy
            const bestStrategy = await this.findBestCorrectionStrategy(
                toolName,
                originalParameters,
                errorMessage,
                toolSchema
            );

            if (!bestStrategy || bestStrategy.confidence < this.config.confidenceThreshold) {
                
                // Store failed attempt
                const failedAttempt: CorrectionAttempt = {
                    attemptId,
                    timestamp: Date.now(),
                    agentId,
                    channelId,
                    toolName,
                    originalParameters,
                    correctedParameters: originalParameters,
                    strategy: bestStrategy?.type || 'unknown_properties',
                    confidence: bestStrategy?.confidence || 0,
                    successful: false,
                    errorMessage: 'No suitable correction strategy found'
                };
                
                this.recordCorrectionAttempt(correctionKey, failedAttempt);
                return { 
                    corrected: false, 
                    shouldRetry: false,
                    attemptId
                };
            }

            // Apply the correction
            const correctedParameters = await this.applyCorrectionStrategy(
                bestStrategy.type,
                toolName,
                originalParameters,
                errorMessage,
                toolSchema
            );

            if (!correctedParameters) {
                this.logger.warn(`Correction strategy ${bestStrategy.type} failed to generate parameters`);
                return { corrected: false, shouldRetry: false, attemptId };
            }

            // Create correction attempt record
            const attempt: CorrectionAttempt = {
                attemptId,
                timestamp: Date.now(),
                agentId,
                channelId,
                toolName,
                originalParameters,
                correctedParameters,
                strategy: bestStrategy.type,
                confidence: bestStrategy.confidence,
                successful: false // Will be updated when we know the result
            };

            this.recordCorrectionAttempt(correctionKey, attempt);

            // Calculate retry delay
            const retryDelay = this.calculateRetryDelay(existingAttempts.length);


            return {
                corrected: true,
                correctedParameters,
                strategy: bestStrategy.type,
                confidence: bestStrategy.confidence,
                attemptId,
                shouldRetry: true,
                retryDelay
            };

        } catch (error) {
            this.logger.error(`Auto-correction failed for ${toolName}:`, error);
            return { corrected: false, shouldRetry: false, attemptId };
        }
    }

    /**
     * Report the result of a correction attempt
     */
    public async reportCorrectionResult(
        attemptId: string,
        successful: boolean,
        errorMessage?: string,
        executionTime?: number
    ): Promise<void> {

        // Find the attempt across all correction keys
        let foundAttempt: CorrectionAttempt | undefined;
        let correctionKey: string | undefined;

        for (const [key, attempts] of this.correctionAttempts.entries()) {
            foundAttempt = attempts.find(a => a.attemptId === attemptId);
            if (foundAttempt) {
                correctionKey = key;
                break;
            }
        }

        if (!foundAttempt || !correctionKey) {
            this.logger.warn(`Correction attempt ${attemptId} not found`);
            return;
        }

        // Update the attempt
        foundAttempt.successful = successful;
        foundAttempt.errorMessage = errorMessage;
        foundAttempt.recoveryTime = executionTime;

        // Emit correction event
        this.correctionEvents$.next(foundAttempt);

        if (successful) {
            
            // Learn from successful correction if enabled
            if (this.config.learnFromSuccessfulCorrections) {
                await this.learnFromSuccessfulCorrection(foundAttempt);
            }

            // Clear retry timer if exists
            const timer = this.retryTimers.get(correctionKey);
            if (timer) {
                clearTimeout(timer);
                this.retryTimers.delete(correctionKey);
            }

        } else {
            this.logger.warn(`❌ Auto-correction failed for ${foundAttempt.toolName}: ${errorMessage}`);
        }

        // Audit the attempt if enabled
        if (this.config.auditAllAttempts) {
            await this.auditCorrectionAttempt(foundAttempt);
        }
    }

    // =============================================================================
    // CORRECTION STRATEGY METHODS
    // =============================================================================

    /**
     * Find the best correction strategy for a given error
     */
    private async findBestCorrectionStrategy(
        toolName: string,
        parameters: Record<string, any>,
        errorMessage: string,
        toolSchema?: any
    ): Promise<{
        type: CorrectionStrategyType;
        confidence: number;
        suggestedCorrection?: Record<string, any>;
        reasoning?: string;
    } | null> {
        const strategies: Array<{
            type: CorrectionStrategyType;
            confidence: number;
            suggestedCorrection?: Record<string, any>;
            reasoning?: string;
        }> = [];

        // Evaluate each enabled strategy
        for (const strategyType of this.config.enabledStrategies) {
            const strategy = this.strategies.get(strategyType);
            if (!strategy) continue;

            try {
                const result = await strategy.analyze(toolName, parameters, errorMessage, toolSchema);
                if (result.canCorrect) {
                    strategies.push({
                        type: strategyType,
                        confidence: result.confidence,
                        suggestedCorrection: result.suggestedCorrection,
                        reasoning: result.reasoning
                    });
                }
            } catch (error) {
                this.logger.warn(`Strategy ${strategyType} analysis failed:`, error);
            }
        }

        // Return the highest confidence strategy
        return strategies.length > 0 
            ? strategies.sort((a, b) => b.confidence - a.confidence)[0]
            : null;
    }

    /**
     * Apply a specific correction strategy
     */
    private async applyCorrectionStrategy(
        strategyType: CorrectionStrategyType,
        toolName: string,
        originalParameters: Record<string, any>,
        errorMessage: string,
        toolSchema?: any
    ): Promise<Record<string, any> | null> {
        const strategy = this.strategies.get(strategyType);
        if (!strategy) {
            this.logger.error(`Strategy ${strategyType} not found`);
            return null;
        }

        try {
            const result = await strategy.analyze(toolName, originalParameters, errorMessage, toolSchema);
            return result.suggestedCorrection || null;
        } catch (error) {
            this.logger.error(`Failed to apply strategy ${strategyType}:`, error);
            return null;
        }
    }

    // =============================================================================
    // CORRECTION STRATEGIES IMPLEMENTATION
    // =============================================================================

    /**
     * Initialize correction strategies
     */
    private initializeStrategies(): void {
        // Missing Required Parameters Strategy
        this.strategies.set('missing_required', {
            type: 'missing_required',
            analyze: async (toolName, parameters, errorMessage, toolSchema) => {
                if (!errorMessage.toLowerCase().includes('required') && 
                    !errorMessage.toLowerCase().includes('missing')) {
                    return { canCorrect: false, confidence: 0 };
                }

                // Try to get successful patterns for this tool
                try {
                    const patterns = await this.patternService.getEnhancedPatterns(
                        'default' as ChannelId, // TODO: Get actual channel from context
                        toolName,
                        true
                    );

                    if (patterns.successful.length > 0) {
                        // Use the most successful pattern
                        const bestPattern = patterns.successful
                            .sort((a, b) => b.confidenceScore - a.confidenceScore)[0];

                        // Merge with original parameters, prioritizing pattern values for missing keys
                        const corrected = { ...parameters };
                        for (const [key, value] of Object.entries(bestPattern.parameters)) {
                            if (!(key in corrected)) {
                                corrected[key] = value;
                            }
                        }

                        return {
                            canCorrect: true,
                            confidence: bestPattern.confidenceScore * 0.9, // Slight penalty
                            suggestedCorrection: corrected,
                            reasoning: `Added missing parameters from successful pattern (used ${bestPattern.frequency} times)`
                        };
                    }
                } catch (error) {
                }

                return { canCorrect: false, confidence: 0 };
            }
        });

        // Parameter Name Strategy (with n8n-specific mappings + pattern-based fallback)
        this.strategies.set('wrong_parameter_names', {
            type: 'wrong_parameter_names',
            analyze: async (toolName, parameters, errorMessage, toolSchema) => {
                if (!errorMessage.toLowerCase().includes('unknown') && 
                    !errorMessage.toLowerCase().includes('additional') &&
                    !errorMessage.toLowerCase().includes('required') &&
                    !errorMessage.toLowerCase().includes('missing')) {
                    return { canCorrect: false, confidence: 0 };
                }

                // n8n-specific parameter mapping for workflow tools
                if (toolName === 'create_workflow' || toolName === 'update_workflow' || toolName.includes('workflow')) {
                    const corrected = JSON.parse(JSON.stringify(parameters)); // Deep copy
                    let correctionCount = 0;

                    // n8n Data Table node parameter mappings
                    const n8nMappings: Record<string, string> = {
                        'tableName': 'dataTable',     // Wrong → Right
                        'table': 'dataTable',
                        'insert': 'insertRow',
                        'data': 'dataFields',
                        'fields': 'dataFields'
                    };

                    // Check if this is a workflow with nodes array
                    if (corrected.nodes && Array.isArray(corrected.nodes)) {
                        corrected.nodes = corrected.nodes.map((node: any) => {
                            // Only fix Data Table nodes
                            if (node.type === 'n8n-nodes-base.dataTable' && node.parameters) {
                                const oldParams = { ...node.parameters };
                                const newParams: any = {};

                                // Map old parameter names to correct ones
                                for (const [key, value] of Object.entries(oldParams)) {
                                    const correctKey = n8nMappings[key] || key;
                                    newParams[correctKey] = value;
                                    if (correctKey !== key) {
                                        correctionCount++;
                                    }
                                }

                                return { ...node, parameters: newParams };
                            }
                            return node;
                        });
                    }

                    if (correctionCount > 0) {
                        return {
                            canCorrect: true,
                            confidence: 0.95, // High confidence for known n8n mappings
                            suggestedCorrection: corrected,
                            reasoning: `Corrected ${correctionCount} n8n Data Table parameter name(s) to match API requirements (e.g., tableName→dataTable, insert→insertRow, data→dataFields)`
                        };
                    }
                }

                // Fallback to pattern-based correction
                try {
                    const patterns = await this.patternService.getEnhancedPatterns(
                        'default' as ChannelId,
                        toolName,
                        true
                    );

                    if (patterns.successful.length > 0) {
                        const bestPattern = patterns.successful[0];
                        const patternKeys = Object.keys(bestPattern.parameters);
                        const currentKeys = Object.keys(parameters);

                        // Look for similar key names (fuzzy matching)
                        const corrected = { ...bestPattern.parameters };
                        let matchCount = 0;

                        for (const currentKey of currentKeys) {
                            for (const patternKey of patternKeys) {
                                if (this.areKeysSimilar(currentKey, patternKey)) {
                                    corrected[patternKey] = parameters[currentKey];
                                    matchCount++;
                                    break;
                                }
                            }
                        }

                        if (matchCount > 0) {
                            return {
                                canCorrect: true,
                                confidence: (matchCount / currentKeys.length) * 0.8,
                                suggestedCorrection: corrected,
                                reasoning: `Corrected ${matchCount} parameter names using successful pattern`
                            };
                        }
                    }
                } catch (error) {
                }

                return { canCorrect: false, confidence: 0 };
            }
        });

        // Type Mismatch Strategy (Enhanced with JSON string to object conversion)
        this.strategies.set('type_mismatch', {
            type: 'type_mismatch',
            analyze: async (toolName, parameters, errorMessage, toolSchema) => {
                // Enhanced error detection to catch more type-related errors - make it more lenient
                const errorLower = errorMessage.toLowerCase();
                const hasTypeError = errorLower.includes('type') ||
                    errorLower.includes('expected') ||
                    errorLower.includes('must be') ||
                    errorLower.includes('should be') ||
                    errorLower.includes('invalid') ||
                    errorLower.includes('validation') ||
                    errorLower.includes('schema') ||
                    errorLower.includes('format') ||
                    errorLower.includes('property') ||
                    errorLower.includes('boolean') ||
                    errorLower.includes('object') ||
                    errorLower.includes('string') ||
                    errorLower.includes('number') ||
                    errorLower.includes('required') ||
                    errorLower.includes('missing') ||
                    errorLower.includes('data') ||
                    errorLower.includes('instance');

                if (!hasTypeError) {
                    return { canCorrect: false, confidence: 0 };
                }
                
                // Special handling for common task_complete errors
                if (toolName === 'task_complete') {
                    const corrected = { ...parameters };
                    let correctionCount = 0;
                    
                    // Handle success parameter - convert string "true"/"false" to boolean
                    if ('success' in corrected && typeof corrected.success === 'string') {
                        const successStr = corrected.success.toLowerCase().trim();
                        if (successStr === 'true' || successStr === '1' || successStr === 'yes') {
                            corrected.success = true;
                            correctionCount++;
                        } else if (successStr === 'false' || successStr === '0' || successStr === 'no') {
                            corrected.success = false;
                            correctionCount++;
                        }
                    }
                    
                    // Handle details parameter - convert JSON string to object
                    if ('details' in corrected && typeof corrected.details === 'string') {
                        try {
                            const parsed = JSON.parse(corrected.details);
                            if (typeof parsed === 'object' && parsed !== null) {
                                corrected.details = parsed;
                                correctionCount++;
                            }
                        } catch (error) {
                            // If not valid JSON, create a simple object with the string as a field
                            corrected.details = { description: corrected.details };
                            correctionCount++;
                        }
                    }
                    
                    if (correctionCount > 0) {
                        return {
                            canCorrect: true,
                            confidence: 0.95, // High confidence for task_complete corrections
                            suggestedCorrection: corrected,
                            reasoning: `Fixed ${correctionCount} type issue(s) in task_complete: converted string values to proper types for validation`
                        };
                    }
                }

                const corrected = { ...parameters };
                let correctionCount = 0;
                let schemaBasedCorrections = 0;

                // First, try to use the tool schema if available
                if (toolSchema && toolSchema.properties) {
                    for (const [key, schema] of Object.entries(toolSchema.properties as Record<string, any>)) {
                        if (key in corrected && schema.type) {
                            const currentType = typeof corrected[key];
                            const expectedType = schema.type;
                            
                            // Check if type conversion is needed
                            if ((expectedType === 'object' && currentType === 'string') ||
                                (expectedType === 'array' && currentType === 'string') ||
                                (expectedType === 'number' && currentType === 'string') ||
                                (expectedType === 'boolean' && currentType === 'string') ||
                                (expectedType === 'string' && currentType !== 'string')) {
                                
                                try {
                                    corrected[key] = this.convertType(corrected[key], expectedType as any);
                                    correctionCount++;
                                    schemaBasedCorrections++;
                                } catch (error) {
                                }
                            }
                        }
                    }
                }

                // If no schema-based corrections, try pattern-based corrections
                if (correctionCount === 0) {
                    try {
                        const patterns = await this.patternService.getEnhancedPatterns(
                            'default' as ChannelId,
                            toolName,
                            true
                        );

                        if (patterns.successful.length > 0) {
                            const bestPattern = patterns.successful[0];

                            // Try to match types from successful patterns
                            for (const [key, value] of Object.entries(bestPattern.parameters)) {
                                if (key in corrected && typeof corrected[key] !== typeof value) {
                                    try {
                                        corrected[key] = this.convertType(corrected[key], typeof value as any);
                                        correctionCount++;
                                    } catch (error) {
                                    }
                                }
                            }
                        }
                    } catch (error) {
                    }
                }

                if (correctionCount > 0) {
                    const reasoning = schemaBasedCorrections > 0 
                        ? `Corrected ${correctionCount} type mismatches using tool schema (including JSON string to object conversions)`
                        : `Corrected ${correctionCount} type mismatches using successful pattern`;
                    
                    return {
                        canCorrect: true,
                        confidence: schemaBasedCorrections > 0 ? 0.9 : 0.7,
                        suggestedCorrection: corrected,
                        reasoning
                    };
                }

                return { canCorrect: false, confidence: 0 };
            }
        });

        // Pattern-Based Strategy (uses ML insights)
        this.strategies.set('pattern_based', {
            type: 'pattern_based',
            analyze: async (toolName, parameters, errorMessage, toolSchema) => {
                try {
                    // Get pattern recommendations
                    const recommendations = await this.patternService.getPatternRecommendations(
                        'system' as AgentId,
                        'default' as ChannelId,
                        toolName,
                        parameters
                    );

                    if (recommendations.length > 0) {
                        const bestRecommendation = recommendations[0];
                        
                        return {
                            canCorrect: true,
                            confidence: bestRecommendation.confidence * bestRecommendation.relevanceScore,
                            suggestedCorrection: bestRecommendation.pattern.parameters,
                            reasoning: bestRecommendation.reason
                        };
                    }
                } catch (error) {
                }

                return { canCorrect: false, confidence: 0 };
            }
        });

        // JSON String Correction Strategy (for common LLM mistake)
        this.strategies.set('json_string_conversion', {
            type: 'json_string_conversion' as CorrectionStrategyType,
            analyze: async (toolName, parameters, errorMessage, toolSchema) => {
                // Detect JSON string errors - expanded to catch more validation patterns
                const errorLower = errorMessage.toLowerCase();
                if (!errorLower.includes('must be object') &&
                    !errorLower.includes('must be array') &&
                    !errorLower.includes('expected object') &&
                    !errorLower.includes('expected array') &&
                    !errorLower.includes('should be object') &&
                    !errorLower.includes('should be array') &&
                    !errorLower.includes('instance type') &&
                    !errorLower.includes('data type') &&
                    !errorLower.includes('invalid type') &&
                    !errorLower.includes('validation failed') &&
                    !errorLower.includes('schema validation')) {
                    return { canCorrect: false, confidence: 0 };
                }

                const corrected = { ...parameters };
                let correctionCount = 0;
                const corrections: string[] = [];

                // Check each parameter for JSON strings that should be objects/arrays
                for (const [key, value] of Object.entries(parameters)) {
                    if (typeof value === 'string') {
                        // Check if this looks like JSON
                        const trimmed = value.trim();
                        if ((trimmed.startsWith('{') && trimmed.endsWith('}')) ||
                            (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
                            try {
                                const parsed = JSON.parse(value);
                                if (typeof parsed === 'object' && parsed !== null) {
                                    corrected[key] = parsed;
                                    correctionCount++;
                                    corrections.push(`${key}: string → ${Array.isArray(parsed) ? 'array' : 'object'}`);
                                }
                            } catch (error) {
                                // Not valid JSON, skip
                            }
                        }
                    }
                }

                if (correctionCount > 0) {
                    return {
                        canCorrect: true,
                        confidence: 0.95, // High confidence for this specific pattern
                        suggestedCorrection: corrected,
                        reasoning: `Converted ${correctionCount} JSON string(s) to object(s): ${corrections.join(', ')}. This is a common LLM mistake where objects are stringified unnecessarily.`
                    };
                }

                return { canCorrect: false, confidence: 0 };
            }
        });

    }

    // =============================================================================
    // HELPER METHODS
    // =============================================================================

    /**
     * Check if two parameter keys are similar (for fuzzy matching)
     */
    private areKeysSimilar(key1: string, key2: string): boolean {
        if (key1 === key2) return true;
        
        // Simple similarity checks
        const normalized1 = key1.toLowerCase().replace(/[_-]/g, '');
        const normalized2 = key2.toLowerCase().replace(/[_-]/g, '');
        
        if (normalized1 === normalized2) return true;
        
        // Check if one contains the other
        if (normalized1.includes(normalized2) || normalized2.includes(normalized1)) {
            return true;
        }
        
        return false;
    }

    /**
     * Convert value to target type
     */
    private convertType(value: any, targetType: 'string' | 'number' | 'boolean' | 'object'): any {
        switch (targetType) {
            case 'string':
                return String(value);
            case 'number':
                const num = Number(value);
                if (isNaN(num)) throw new Error(`Cannot convert ${value} to number`);
                return num;
            case 'boolean':
                if (typeof value === 'boolean') return value;
                if (typeof value === 'string') {
                    const lowerValue = value.toLowerCase().trim();
                    // More aggressive string-to-boolean conversion for common LLM mistakes
                    if (lowerValue === 'true' || lowerValue === '1' || lowerValue === 'yes' || lowerValue === 'on' || lowerValue === 'success') return true;
                    if (lowerValue === 'false' || lowerValue === '0' || lowerValue === 'no' || lowerValue === 'off' || lowerValue === 'fail' || lowerValue === 'failed') return false;
                    // If it's any non-empty string, treat as true (common LLM behavior)
                    return lowerValue.length > 0;
                }
                if (typeof value === 'number') {
                    return value !== 0;
                }
                return Boolean(value);
            case 'object':
                // Handle JSON string to object conversion
                if (typeof value === 'string') {
                    try {
                        // Try to parse as JSON
                        const parsed = JSON.parse(value);
                        if (typeof parsed === 'object' && parsed !== null) {
                            return parsed;
                        }
                    } catch (error) {
                        // Not valid JSON, try other conversions
                    }
                    
                    // Try to parse as query string (key=value&key2=value2)
                    if (value.includes('=')) {
                        try {
                            const params = new URLSearchParams(value);
                            const obj: Record<string, string> = {};
                            params.forEach((val, key) => {
                                obj[key] = val;
                            });
                            if (Object.keys(obj).length > 0) {
                                return obj;
                            }
                        } catch (error) {
                        }
                    }
                }
                
                // If already an object, return as is
                if (typeof value === 'object' && value !== null) {
                    return value;
                }
                
                // Last resort: wrap primitive in object
                return { value };
            default:
                return value;
        }
    }

    /**
     * Calculate retry delay with exponential backoff
     */
    private calculateRetryDelay(attemptNumber: number): number {
        const delay = Math.min(
            this.config.retryDelayBase * Math.pow(this.config.retryDelayMultiplier, attemptNumber),
            this.config.maxRetryDelay
        );
        
        // Add jitter to prevent thundering herd
        const jitter = Math.random() * 0.1 * delay;
        return Math.floor(delay + jitter);
    }

    /**
     * Record a correction attempt
     */
    private recordCorrectionAttempt(correctionKey: string, attempt: CorrectionAttempt): void {
        const attempts = this.correctionAttempts.get(correctionKey) || [];
        attempts.push(attempt);
        this.correctionAttempts.set(correctionKey, attempts);

        // Clean up old attempts (keep last 10)
        if (attempts.length > 10) {
            attempts.splice(0, attempts.length - 10);
        }
    }

    /**
     * Learn from successful corrections
     */
    private async learnFromSuccessfulCorrection(attempt: CorrectionAttempt): Promise<void> {
        try {
            // Store the successful correction as a pattern
            await this.patternService.storeSuccessfulPattern(
                attempt.agentId,
                attempt.channelId,
                attempt.toolName,
                attempt.correctedParameters,
                attempt.recoveryTime
            );

        } catch (error) {
            this.logger.warn(`Failed to learn from successful correction: ${error}`);
        }
    }

    /**
     * Audit correction attempt
     */
    private async auditCorrectionAttempt(attempt: CorrectionAttempt): Promise<void> {
        // TODO: Implement audit logging to database or external system
    }

    /**
     * Setup event listeners
     */
    private setupEventListeners(): void {
        // Listen for tool execution errors
        EventBus.server.on(Events.Mcp.TOOL_ERROR, async (payload) => {
            if (!this.config.enabled) return;

            const { agentId, channelId, toolName, error, parameters } = payload;
            
            
            // Auto-correction will be triggered by the ToolExecutionInterceptor
            // This listener is for monitoring and analytics
        });

    }

    /**
     * Get default configuration
     */
    private getDefaultConfig(): AutoCorrectionConfig {
        return {
            enabled: true,
            maxRetryAttempts: 3,
            confidenceThreshold: 0.7,
            retryDelayBase: 1000, // 1 second
            retryDelayMultiplier: 2,
            maxRetryDelay: 30000, // 30 seconds
            enabledStrategies: [
                'missing_required',
                'wrong_parameter_names',
                'type_mismatch',
                'pattern_based',
                'json_string_conversion'
            ],
            learnFromSuccessfulCorrections: true,
            auditAllAttempts: true
        };
    }

    // =============================================================================
    // PUBLIC API
    // =============================================================================

    /**
     * Get correction events observable
     */
    public get correctionEvents(): Observable<CorrectionAttempt> {
        return this.correctionEvents$.asObservable();
    }

    /**
     * Update configuration
     */
    public updateConfig(newConfig: Partial<AutoCorrectionConfig>): void {
        this.config = { ...this.config, ...newConfig };
    }

    /**
     * Get current configuration
     */
    public getConfig(): AutoCorrectionConfig {
        return { ...this.config };
    }

    /**
     * Get correction statistics
     */
    public getCorrectionStats(): {
        totalAttempts: number;
        successfulCorrections: number;
        successRate: number;
        strategiesUsed: Record<CorrectionStrategyType, number>;
        mostSuccessfulStrategy: CorrectionStrategyType | null;
    } {
        let totalAttempts = 0;
        let successfulCorrections = 0;
        const strategiesUsed: Record<string, number> = {};

        for (const attempts of this.correctionAttempts.values()) {
            for (const attempt of attempts) {
                totalAttempts++;
                if (attempt.successful) successfulCorrections++;
                
                strategiesUsed[attempt.strategy] = (strategiesUsed[attempt.strategy] || 0) + 1;
            }
        }

        const successRate = totalAttempts > 0 ? successfulCorrections / totalAttempts : 0;
        
        const mostSuccessfulStrategy = Object.entries(strategiesUsed)
            .sort(([,a], [,b]) => b - a)[0]?.[0] as CorrectionStrategyType || null;

        return {
            totalAttempts,
            successfulCorrections,
            successRate,
            strategiesUsed: strategiesUsed as Record<CorrectionStrategyType, number>,
            mostSuccessfulStrategy
        };
    }

    /**
     * Clear all correction history (for testing/cleanup)
     */
    public clearCorrectionHistory(): void {
        this.correctionAttempts.clear();
        this.retryTimers.forEach(timer => clearTimeout(timer));
        this.retryTimers.clear();
    }
}