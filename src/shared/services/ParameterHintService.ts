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
 * ParameterHintService - Phase 5 Proactive Validation System
 * 
 * Provides real-time parameter hints via WebSocket for parameter completion and validation.
 * Offers debounced hint generation with auto-completion from patterns and inline documentation.
 */

import { Observable, Subject, debounceTime, distinctUntilChanged, switchMap } from 'rxjs';
import { Logger } from '../utils/Logger';
import { EventBus } from '../events/EventBus';
import { Events } from '../events/EventNames';
import { ProactiveValidationService } from './ProactiveValidationService';
import { PatternLearningService } from './PatternLearningService';
import { ValidationCacheService } from './ValidationCacheService';
import { AgentId } from '../types/Agent';
import { ChannelId } from '../types/ChannelContext';

/**
 * Parameter hint request
 */
export interface HintRequest {
    agentId: AgentId;
    channelId: ChannelId;
    toolName: string;
    currentParameters: Record<string, any>;
    cursorPosition?: {
        parameter: string;
        position: number;
    };
    requestId: string;
    timestamp: number;
}

/**
 * Parameter hint response
 */
export interface HintResponse {
    requestId: string;
    hints: ParameterHint[];
    validationPreview: ValidationPreview;
    completionSuggestions: CompletionSuggestion[];
    documentation: InlineDocumentation;
    generateTime: number;
    cached: boolean;
}

/**
 * Individual parameter hint
 */
export interface ParameterHint {
    parameter: string;
    suggestions: ParameterSuggestion[];
    required: boolean;
    type: string;
    description?: string;
    examples: any[];
    constraints?: ParameterConstraints;
    patternBased: boolean;
}

/**
 * Parameter suggestion
 */
export interface ParameterSuggestion {
    value: any;
    displayValue: string;
    confidence: number;
    frequency: number;
    source: 'PATTERN' | 'SCHEMA' | 'HISTORY' | 'TEMPLATE';
    description?: string;
    lastUsed?: number;
}

/**
 * Parameter constraints
 */
export interface ParameterConstraints {
    minLength?: number;
    maxLength?: number;
    pattern?: string;
    enum?: any[];
    minimum?: number;
    maximum?: number;
    format?: string;
}

/**
 * Validation preview
 */
export interface ValidationPreview {
    isValid: boolean;
    errors: ValidationPreviewError[];
    warnings: ValidationPreviewWarning[];
    confidence: number;
    riskLevel: 'HIGH' | 'MEDIUM' | 'LOW';
}

/**
 * Validation preview error
 */
export interface ValidationPreviewError {
    parameter?: string;
    message: string;
    severity: 'HIGH' | 'MEDIUM' | 'LOW';
    suggestedFix?: string;
}

/**
 * Validation preview warning
 */
export interface ValidationPreviewWarning {
    parameter?: string;
    message: string;
    impact: 'HIGH' | 'MEDIUM' | 'LOW';
}

/**
 * Completion suggestion
 */
export interface CompletionSuggestion {
    type: 'PARAMETER' | 'VALUE' | 'TEMPLATE';
    text: string;
    insertText: string;
    description: string;
    confidence: number;
    cursorOffset?: number;
}

/**
 * Inline documentation
 */
export interface InlineDocumentation {
    toolDescription?: string;
    parameterDocs: Record<string, string>;
    examples: DocumentationExample[];
    relatedTools: string[];
    tips: string[];
}

/**
 * Documentation example
 */
export interface DocumentationExample {
    title: string;
    parameters: Record<string, any>;
    description: string;
    confidence: number;
}

/**
 * Hint service configuration
 */
export interface HintServiceConfig {
    enabled: boolean;
    debounceTimeMs: number;
    maxHintsPerParameter: number;
    maxCompletionSuggestions: number;
    cacheHints: boolean;
    cacheTTL: number;
    includePatternHints: boolean;
    includeSchemaHints: boolean;
    includeHistoryHints: boolean;
    webSocketEnabled: boolean;
    performanceThresholds: {
        maxHintGenerationTime: number;
        maxConcurrentRequests: number;
    };
}

/**
 * WebSocket hint event
 */
export interface WebSocketHintEvent {
    type: 'HINT_REQUEST' | 'HINT_RESPONSE' | 'HINT_ERROR';
    agentId: AgentId;
    channelId: ChannelId;
    requestId: string;
    timestamp: number;
    data: any;
}

/**
 * Parameter Hint Service for real-time parameter assistance
 */
export class ParameterHintService {
    private readonly logger: Logger;
    private readonly proactiveValidationService: ProactiveValidationService;
    private readonly patternLearningService: PatternLearningService;
    private readonly validationCacheService: ValidationCacheService;
    
    // Configuration
    private config: HintServiceConfig;
    
    // Hint request streams
    private readonly hintRequests$ = new Subject<HintRequest>();
    private readonly hintResponses$ = new Subject<HintResponse>();
    
    // WebSocket events
    private readonly webSocketEvents$ = new Subject<WebSocketHintEvent>();
    
    // Hint cache
    private readonly hintCache = new Map<string, { response: HintResponse; expiry: number }>();
    
    // Active requests tracking
    private readonly activeRequests = new Map<string, HintRequest>();
    
    // Performance metrics
    private readonly metrics = {
        totalRequests: 0,
        totalResponses: 0,
        cacheHits: 0,
        cacheMisses: 0,
        averageGenerationTime: 0,
        totalGenerationTime: 0,
        errorCount: 0,
        debounceSkips: 0,
        webSocketEvents: 0
    };
    
    // Tool schema cache for hint generation
    private readonly toolSchemaCache = new Map<string, any>();
    
    private static instance: ParameterHintService;

    private constructor() {
        this.logger = new Logger('info', 'ParameterHintService', 'server');
        this.proactiveValidationService = ProactiveValidationService.getInstance();
        this.patternLearningService = PatternLearningService.getInstance();
        this.validationCacheService = ValidationCacheService.getInstance();
        
        this.config = this.getDefaultConfig();
        this.setupHintProcessing();
        this.setupEventListeners();
        this.startPeriodicTasks();
        
    }

    /**
     * Get singleton instance
     */
    public static getInstance(): ParameterHintService {
        if (!ParameterHintService.instance) {
            ParameterHintService.instance = new ParameterHintService();
        }
        return ParameterHintService.instance;
    }

    // =============================================================================
    // CORE HINT GENERATION
    // =============================================================================

    /**
     * Request parameter hints for a tool with current parameters
     */
    public async requestHints(
        agentId: AgentId,
        channelId: ChannelId,
        toolName: string,
        currentParameters: Record<string, any>,
        cursorPosition?: { parameter: string; position: number }
    ): Promise<HintResponse> {
        if (!this.config.enabled) {
            return this.createEmptyHintResponse('disabled');
        }

        const requestId = `hint_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const request: HintRequest = {
            agentId,
            channelId,
            toolName,
            currentParameters,
            cursorPosition,
            requestId,
            timestamp: Date.now()
        };

        this.metrics.totalRequests++;
        this.activeRequests.set(requestId, request);

        try {
            // Check cache first
            const cacheKey = this.createCacheKey(request);
            const cached = this.getCachedHints(cacheKey);
            if (cached) {
                this.metrics.cacheHits++;
                this.activeRequests.delete(requestId);
                return { ...cached, requestId, cached: true };
            }

            this.metrics.cacheMisses++;

            // Generate hints
            const startTime = Date.now();
            const response = await this.generateHints(request);
            const generationTime = Date.now() - startTime;

            // Update metrics
            this.updateGenerationTimeMetrics(generationTime);
            this.metrics.totalResponses++;

            // Cache the response
            if (this.config.cacheHints) {
                this.cacheHints(cacheKey, response);
            }

            // Clean up
            this.activeRequests.delete(requestId);

            // Emit WebSocket event if enabled
            if (this.config.webSocketEnabled) {
                this.emitWebSocketEvent({
                    type: 'HINT_RESPONSE',
                    agentId,
                    channelId,
                    requestId,
                    timestamp: Date.now(),
                    data: response
                });
            }

            return response;

        } catch (error) {
            this.logger.error(`Failed to generate hints for ${toolName}:`, error);
            this.metrics.errorCount++;
            this.activeRequests.delete(requestId);

            const errorResponse = this.createErrorHintResponse(requestId, error);

            // Emit WebSocket error event
            if (this.config.webSocketEnabled) {
                this.emitWebSocketEvent({
                    type: 'HINT_ERROR',
                    agentId,
                    channelId,
                    requestId,
                    timestamp: Date.now(),
                    data: { error: error instanceof Error ? error.message : String(error) }
                });
            }

            return errorResponse;
        }
    }

    /**
     * Request hints via debounced stream (for real-time typing)
     */
    public requestHintsDebounced(request: HintRequest): void {
        if (!this.config.enabled) return;

        this.hintRequests$.next(request);

        // Emit WebSocket request event
        if (this.config.webSocketEnabled) {
            this.emitWebSocketEvent({
                type: 'HINT_REQUEST',
                agentId: request.agentId,
                channelId: request.channelId,
                requestId: request.requestId,
                timestamp: request.timestamp,
                data: { toolName: request.toolName, currentParameters: request.currentParameters }
            });
        }
    }

    // =============================================================================
    // HINT GENERATION IMPLEMENTATION
    // =============================================================================

    private async generateHints(request: HintRequest): Promise<HintResponse> {
        const startTime = Date.now();
        
        // Generate different types of hints in parallel
        const [
            parameterHints,
            validationPreview,
            completionSuggestions,
            documentation
        ] = await Promise.all([
            this.generateParameterHints(request),
            this.generateValidationPreview(request),
            this.generateCompletionSuggestions(request),
            this.generateInlineDocumentation(request)
        ]);

        return {
            requestId: request.requestId,
            hints: parameterHints,
            validationPreview,
            completionSuggestions,
            documentation,
            generateTime: Date.now() - startTime,
            cached: false
        };
    }

    private async generateParameterHints(request: HintRequest): Promise<ParameterHint[]> {
        const hints: ParameterHint[] = [];

        try {
            // Get tool schema
            const schema = await this.getToolSchema(request.toolName);
            
            // Get pattern-based hints
            const patternHints = this.config.includePatternHints 
                ? await this.getPatternBasedHints(request)
                : new Map();

            // Get schema-based hints
            const schemaHints = this.config.includeSchemaHints 
                ? this.getSchemaBasedHints(schema, request.currentParameters)
                : new Map();

            // Get history-based hints
            const historyHints = this.config.includeHistoryHints 
                ? await this.getHistoryBasedHints(request)
                : new Map();

            // Combine all hint sources
            const allParameters = new Set([
                ...patternHints.keys(),
                ...schemaHints.keys(),
                ...historyHints.keys()
            ]);

            for (const parameter of allParameters) {
                const suggestions: ParameterSuggestion[] = [];

                // Add pattern-based suggestions
                const patternSuggestions = patternHints.get(parameter) || [];
                suggestions.push(...patternSuggestions);

                // Add schema-based suggestions
                const schemaSuggestions = schemaHints.get(parameter) || [];
                suggestions.push(...schemaSuggestions);

                // Add history-based suggestions
                const historySuggestions = historyHints.get(parameter) || [];
                suggestions.push(...historySuggestions);

                // Sort suggestions by confidence and frequency
                suggestions.sort((a, b) => 
                    (b.confidence * b.frequency) - (a.confidence * a.frequency)
                );

                // Limit suggestions
                const limitedSuggestions = suggestions.slice(0, this.config.maxHintsPerParameter);

                // Get parameter info from schema
                const paramInfo = schema?.properties?.[parameter] || {};

                hints.push({
                    parameter,
                    suggestions: limitedSuggestions,
                    required: schema?.required?.includes(parameter) || false,
                    type: paramInfo.type || 'any',
                    description: paramInfo.description,
                    examples: this.generateParameterExamples(parameter, suggestions),
                    constraints: this.extractParameterConstraints(paramInfo),
                    patternBased: patternHints.has(parameter)
                });
            }

            // Sort hints by importance (required first, then by suggestion count)
            hints.sort((a, b) => {
                if (a.required && !b.required) return -1;
                if (!a.required && b.required) return 1;
                return b.suggestions.length - a.suggestions.length;
            });

        } catch (error) {
            this.logger.warn(`Failed to generate parameter hints for ${request.toolName}:`, error);
        }

        return hints;
    }

    private async generateValidationPreview(request: HintRequest): Promise<ValidationPreview> {
        try {
            // Use the proactive validation service to get a preview
            const validationHints = await this.proactiveValidationService.getValidationHints(
                request.agentId,
                request.channelId,
                request.toolName,
                request.currentParameters
            );

            return {
                isValid: validationHints.validationPreviews.length === 0,
                errors: validationHints.validationPreviews.map(error => ({
                    parameter: error.field,
                    message: error.message,
                    severity: error.severity,
                    suggestedFix: error.suggestedFix
                })),
                warnings: [], // Could add warnings from validation service
                confidence: 0.8, // Base confidence
                riskLevel: this.determineRiskLevel(validationHints.validationPreviews)
            };

        } catch (error) {
            this.logger.warn(`Failed to generate validation preview for ${request.toolName}:`, error);
            return {
                isValid: true,
                errors: [],
                warnings: [],
                confidence: 0.1,
                riskLevel: 'LOW'
            };
        }
    }

    private async generateCompletionSuggestions(request: HintRequest): Promise<CompletionSuggestion[]> {
        const suggestions: CompletionSuggestion[] = [];

        try {
            // Get validation hints for completion suggestions
            const validationHints = await this.proactiveValidationService.getValidationHints(
                request.agentId,
                request.channelId,
                request.toolName,
                request.currentParameters
            );

            // Convert completion suggestions
            for (const suggestion of validationHints.completionSuggestions) {
                suggestions.push({
                    type: 'PARAMETER',
                    text: suggestion,
                    insertText: suggestion,
                    description: 'Auto-completion suggestion',
                    confidence: 0.7
                });
            }

            // Add parameter completion suggestions
            if (request.cursorPosition) {
                const parameterSuggestions = await this.generateParameterCompletions(request);
                suggestions.push(...parameterSuggestions);
            }

            // Add template suggestions
            const templateSuggestions = this.generateTemplateSuggestions(request);
            suggestions.push(...templateSuggestions);

            // Sort by confidence and limit
            suggestions.sort((a, b) => b.confidence - a.confidence);
            return suggestions.slice(0, this.config.maxCompletionSuggestions);

        } catch (error) {
            this.logger.warn(`Failed to generate completion suggestions for ${request.toolName}:`, error);
            return [];
        }
    }

    private async generateInlineDocumentation(request: HintRequest): Promise<InlineDocumentation> {
        try {
            const schema = await this.getToolSchema(request.toolName);
            
            // Get parameter documentation
            const parameterDocs: Record<string, string> = {};
            if (schema?.properties) {
                for (const [param, info] of Object.entries(schema.properties)) {
                    if (typeof info === 'object' && info !== null && 'description' in info) {
                        parameterDocs[param] = (info as any).description || '';
                    }
                }
            }

            // Get examples from patterns
            const patterns = await this.patternLearningService.getEnhancedPatterns(
                request.channelId,
                request.toolName,
                true
            );

            const examples: DocumentationExample[] = patterns.successful
                .filter(p => p.confidenceScore > 0.7)
                .slice(0, 3)
                .map(p => ({
                    title: `Example with ${p.frequency} uses`,
                    parameters: p.parameters,
                    description: `Successful pattern with ${Math.round(p.confidenceScore * 100)}% confidence`,
                    confidence: p.confidenceScore
                }));

            // Generate tips
            const tips = this.generateParameterTips(request.toolName, request.currentParameters);

            return {
                toolDescription: schema?.description,
                parameterDocs,
                examples,
                relatedTools: [], // Could be enhanced with related tool suggestions
                tips
            };

        } catch (error) {
            this.logger.warn(`Failed to generate inline documentation for ${request.toolName}:`, error);
            return {
                parameterDocs: {},
                examples: [],
                relatedTools: [],
                tips: []
            };
        }
    }

    // =============================================================================
    // HINT SOURCE IMPLEMENTATIONS
    // =============================================================================

    private async getPatternBasedHints(request: HintRequest): Promise<Map<string, ParameterSuggestion[]>> {
        const hints = new Map<string, ParameterSuggestion[]>();

        try {
            const patterns = await this.patternLearningService.getEnhancedPatterns(
                request.channelId,
                request.toolName,
                true
            );

            // Process successful patterns
            for (const pattern of patterns.successful) {
                for (const [param, value] of Object.entries(pattern.parameters)) {
                    if (!hints.has(param)) {
                        hints.set(param, []);
                    }

                    const suggestions = hints.get(param)!;
                    
                    // Check if suggestion already exists
                    const existingSuggestion = suggestions.find(s => 
                        JSON.stringify(s.value) === JSON.stringify(value)
                    );

                    if (existingSuggestion) {
                        // Update existing suggestion
                        existingSuggestion.frequency += pattern.frequency;
                        existingSuggestion.confidence = Math.max(
                            existingSuggestion.confidence, 
                            pattern.confidenceScore
                        );
                    } else {
                        // Add new suggestion
                        suggestions.push({
                            value,
                            displayValue: this.formatDisplayValue(value),
                            confidence: pattern.confidenceScore,
                            frequency: pattern.frequency,
                            source: 'PATTERN',
                            description: `Used ${pattern.frequency} times with ${Math.round(pattern.confidenceScore * 100)}% success`,
                            lastUsed: pattern.lastUsed
                        });
                    }
                }
            }

        } catch (error) {
            this.logger.warn(`Failed to get pattern-based hints for ${request.toolName}:`, error);
        }

        return hints;
    }

    private getSchemaBasedHints(
        schema: any, 
        currentParameters: Record<string, any>
    ): Map<string, ParameterSuggestion[]> {
        const hints = new Map<string, ParameterSuggestion[]>();

        try {
            if (!schema?.properties) return hints;

            for (const [param, info] of Object.entries(schema.properties)) {
                if (currentParameters[param] !== undefined) continue; // Skip already filled parameters

                const suggestions: ParameterSuggestion[] = [];
                const paramInfo = info as any;

                // Generate suggestions based on schema type
                if (paramInfo.enum) {
                    // Enum values
                    paramInfo.enum.forEach((enumValue: any) => {
                        suggestions.push({
                            value: enumValue,
                            displayValue: this.formatDisplayValue(enumValue),
                            confidence: 0.9,
                            frequency: 1,
                            source: 'SCHEMA',
                            description: 'Valid enum value'
                        });
                    });
                } else if (paramInfo.default !== undefined) {
                    // Default value
                    suggestions.push({
                        value: paramInfo.default,
                        displayValue: this.formatDisplayValue(paramInfo.default),
                        confidence: 0.8,
                        frequency: 1,
                        source: 'SCHEMA',
                        description: 'Default value'
                    });
                } else if (paramInfo.examples) {
                    // Example values
                    paramInfo.examples.forEach((example: any) => {
                        suggestions.push({
                            value: example,
                            displayValue: this.formatDisplayValue(example),
                            confidence: 0.7,
                            frequency: 1,
                            source: 'SCHEMA',
                            description: 'Schema example'
                        });
                    });
                }

                if (suggestions.length > 0) {
                    hints.set(param, suggestions);
                }
            }

        } catch (error) {
            this.logger.warn('Failed to get schema-based hints:', error);
        }

        return hints;
    }

    private async getHistoryBasedHints(request: HintRequest): Promise<Map<string, ParameterSuggestion[]>> {
        const hints = new Map<string, ParameterSuggestion[]>();

        try {
            // Get agent's validation metrics for historical data
            const metrics = {
                parameterPatterns: {
                    successfulPatterns: {} as Record<string, any[]>,
                    failedPatterns: {} as Record<string, any[]>
                }
            };

            const successfulPatterns = metrics.parameterPatterns.successfulPatterns[request.toolName] || [];

            for (const pattern of successfulPatterns) {
                for (const [param, value] of Object.entries(pattern.parameters)) {
                    if (!hints.has(param)) {
                        hints.set(param, []);
                    }

                    const suggestions = hints.get(param)!;
                    suggestions.push({
                        value,
                        displayValue: this.formatDisplayValue(value),
                        confidence: 0.6, // Lower confidence for history
                        frequency: pattern.frequency,
                        source: 'HISTORY',
                        description: `Used ${pattern.frequency} times in your history`,
                        lastUsed: pattern.lastUsed
                    });
                }
            }

        } catch (error) {
            this.logger.warn(`Failed to get history-based hints for ${request.toolName}:`, error);
        }

        return hints;
    }

    // =============================================================================
    // HELPER METHODS
    // =============================================================================

    private async getToolSchema(toolName: string): Promise<any> {
        // Check cache first
        if (this.toolSchemaCache.has(toolName)) {
            return this.toolSchemaCache.get(toolName);
        }

        try {
            // This would normally fetch from a schema registry or tool definition
            // For now, return a basic schema structure
            const schema = {
                type: 'object',
                properties: {},
                required: [],
                description: `Schema for ${toolName} tool`
            };

            // Cache the schema
            this.toolSchemaCache.set(toolName, schema);
            return schema;

        } catch (error) {
            this.logger.warn(`Failed to get schema for ${toolName}:`, error);
            return null;
        }
    }

    private async generateParameterCompletions(request: HintRequest): Promise<CompletionSuggestion[]> {
        const suggestions: CompletionSuggestion[] = [];

        try {
            if (!request.cursorPosition) return suggestions;

            const currentParam = request.cursorPosition.parameter;
            const currentValue = request.currentParameters[currentParam];

            if (typeof currentValue === 'string') {
                // Generate string completions based on patterns
                const patterns = await this.patternLearningService.getEnhancedPatterns(
                    request.channelId,
                    request.toolName,
                    true
                );

                for (const pattern of patterns.successful) {
                    const patternValue = pattern.parameters[currentParam];
                    if (typeof patternValue === 'string' && 
                        patternValue.startsWith(currentValue) && 
                        patternValue !== currentValue) {
                        
                        suggestions.push({
                            type: 'VALUE',
                            text: patternValue,
                            insertText: patternValue.substring(currentValue.length),
                            description: `Complete to "${patternValue}"`,
                            confidence: pattern.confidenceScore,
                            cursorOffset: patternValue.length - currentValue.length
                        });
                    }
                }
            }

        } catch (error) {
            this.logger.warn('Failed to generate parameter completions:', error);
        }

        return suggestions;
    }

    private generateTemplateSuggestions(request: HintRequest): CompletionSuggestion[] {
        const suggestions: CompletionSuggestion[] = [];

        // Generate template suggestions based on tool type
        if (request.toolName.includes('file')) {
            suggestions.push({
                type: 'TEMPLATE',
                text: 'File operation template',
                insertText: '{\n  "path": "/path/to/file",\n  "content": ""\n}',
                description: 'Common file operation parameters',
                confidence: 0.6,
                cursorOffset: -1
            });
        }

        if (request.toolName.includes('message')) {
            suggestions.push({
                type: 'TEMPLATE',
                text: 'Message template',
                insertText: '{\n  "recipient": "",\n  "message": "",\n  "priority": "medium"\n}',
                description: 'Common message parameters',
                confidence: 0.6,
                cursorOffset: -1
            });
        }

        return suggestions;
    }

    private generateParameterTips(toolName: string, currentParameters: Record<string, any>): string[] {
        const tips: string[] = [];

        // General tips
        tips.push('Use Ctrl+Space for parameter suggestions');
        tips.push('Hover over parameters for detailed documentation');

        // Tool-specific tips
        if (toolName.includes('file')) {
            tips.push('Use absolute paths for better reliability');
            if (!currentParameters.path) {
                tips.push('The "path" parameter is usually required for file operations');
            }
        }

        if (toolName.includes('memory')) {
            tips.push('Use descriptive keys for better memory management');
            if (!currentParameters.key) {
                tips.push('The "key" parameter is usually required for memory operations');
            }
        }

        if (toolName.includes('message')) {
            tips.push('Specify recipient for targeted messaging');
            tips.push('Use priority levels to manage message importance');
        }

        return tips.slice(0, 5); // Limit to 5 tips
    }

    private formatDisplayValue(value: any): string {
        if (typeof value === 'string') {
            return value.length > 50 ? `${value.substring(0, 47)}...` : value;
        }
        if (typeof value === 'object') {
            return JSON.stringify(value).length > 50 
                ? `${JSON.stringify(value).substring(0, 47)}...`
                : JSON.stringify(value);
        }
        return String(value);
    }

    private generateParameterExamples(parameter: string, suggestions: ParameterSuggestion[]): any[] {
        return suggestions
            .filter(s => s.source === 'PATTERN' || s.source === 'SCHEMA')
            .slice(0, 3)
            .map(s => s.value);
    }

    private extractParameterConstraints(paramInfo: any): ParameterConstraints | undefined {
        if (!paramInfo) return undefined;

        const constraints: ParameterConstraints = {};

        if (paramInfo.minLength !== undefined) constraints.minLength = paramInfo.minLength;
        if (paramInfo.maxLength !== undefined) constraints.maxLength = paramInfo.maxLength;
        if (paramInfo.pattern !== undefined) constraints.pattern = paramInfo.pattern;
        if (paramInfo.enum !== undefined) constraints.enum = paramInfo.enum;
        if (paramInfo.minimum !== undefined) constraints.minimum = paramInfo.minimum;
        if (paramInfo.maximum !== undefined) constraints.maximum = paramInfo.maximum;
        if (paramInfo.format !== undefined) constraints.format = paramInfo.format;

        return Object.keys(constraints).length > 0 ? constraints : undefined;
    }

    private determineRiskLevel(errors: any[]): 'HIGH' | 'MEDIUM' | 'LOW' {
        if (errors.some(e => e.severity === 'HIGH')) return 'HIGH';
        if (errors.some(e => e.severity === 'MEDIUM')) return 'MEDIUM';
        return 'LOW';
    }

    private createCacheKey(request: HintRequest): string {
        return `hint:${request.toolName}:${JSON.stringify(request.currentParameters)}:${request.cursorPosition?.parameter || ''}`;
    }

    private getCachedHints(cacheKey: string): HintResponse | null {
        const cached = this.hintCache.get(cacheKey);
        if (cached && Date.now() < cached.expiry) {
            return cached.response;
        }
        if (cached) {
            this.hintCache.delete(cacheKey);
        }
        return null;
    }

    private cacheHints(cacheKey: string, response: HintResponse): void {
        this.hintCache.set(cacheKey, {
            response,
            expiry: Date.now() + this.config.cacheTTL
        });
    }

    private createEmptyHintResponse(reason: string): HintResponse {
        return {
            requestId: `empty_${Date.now()}`,
            hints: [],
            validationPreview: {
                isValid: true,
                errors: [],
                warnings: [],
                confidence: 0.5,
                riskLevel: 'LOW'
            },
            completionSuggestions: [],
            documentation: {
                parameterDocs: {},
                examples: [],
                relatedTools: [],
                tips: [`Hints disabled: ${reason}`]
            },
            generateTime: 0,
            cached: false
        };
    }

    private createErrorHintResponse(requestId: string, error: any): HintResponse {
        return {
            requestId,
            hints: [],
            validationPreview: {
                isValid: false,
                errors: [{
                    message: `Hint generation error: ${error instanceof Error ? error.message : String(error)}`,
                    severity: 'LOW'
                }],
                warnings: [],
                confidence: 0,
                riskLevel: 'LOW'
            },
            completionSuggestions: [],
            documentation: {
                parameterDocs: {},
                examples: [],
                relatedTools: [],
                tips: ['Error generating hints. Please try again.']
            },
            generateTime: 0,
            cached: false
        };
    }

    private updateGenerationTimeMetrics(generationTime: number): void {
        this.metrics.totalGenerationTime += generationTime;
        this.metrics.averageGenerationTime = 
            this.metrics.totalGenerationTime / this.metrics.totalResponses;
    }

    // =============================================================================
    // DEBOUNCED HINT PROCESSING
    // =============================================================================

    private setupHintProcessing(): void {
        // Set up debounced hint processing stream
        this.hintRequests$.pipe(
            debounceTime(this.config.debounceTimeMs),
            distinctUntilChanged((prev, curr) => 
                prev.toolName === curr.toolName &&
                JSON.stringify(prev.currentParameters) === JSON.stringify(curr.currentParameters) &&
                prev.cursorPosition?.parameter === curr.cursorPosition?.parameter
            ),
            switchMap(request => {
                return this.processHintRequest(request);
            })
        ).subscribe(response => {
            this.hintResponses$.next(response);
        });

    }

    private async processHintRequest(request: HintRequest): Promise<HintResponse> {
        try {
            // Check if we've exceeded concurrent request limit
            if (this.activeRequests.size >= this.config.performanceThresholds.maxConcurrentRequests) {
                this.metrics.debounceSkips++;
                return this.createEmptyHintResponse('too_many_concurrent_requests');
            }

            return await this.generateHints(request);

        } catch (error) {
            this.logger.warn(`Debounced hint processing failed:`, error);
            return this.createErrorHintResponse(request.requestId, error);
        }
    }

    // =============================================================================
    // EVENT HANDLING AND LIFECYCLE
    // =============================================================================

    private setupEventListeners(): void {
        // Listen to tool execution events to learn from successful parameters
        EventBus.server.on(Events.Mcp.TOOL_RESULT, (payload) => {
            this.learnFromToolExecution(payload).catch(error => {
                this.logger.warn('Failed to learn from tool execution:', error);
            });
        });

        // Listen to pattern learning events
        this.patternLearningService.patternLearningEvents.subscribe(event => {
            if (event.eventType === 'pattern_discovered' || event.eventType === 'parameter_learned') {
                // Invalidate related hint caches
                this.invalidateHintCaches(event.toolName);
            }
        });
    }

    private startPeriodicTasks(): void {
        // Cache cleanup
        setInterval(() => {
            this.cleanupExpiredCaches();
        }, 5 * 60 * 1000); // Every 5 minutes

        // Performance reporting
        setInterval(() => {
            this.reportPerformanceMetrics();
        }, 60 * 1000); // Every minute

        // Schema cache refresh
        setInterval(() => {
            this.refreshSchemaCache();
        }, 30 * 60 * 1000); // Every 30 minutes
    }

    private async learnFromToolExecution(payload: any): Promise<void> {
        try {
            // Learn from successful tool executions to improve hints
            const toolName = payload.toolName || payload.data?.toolName;
            const parameters = payload.data?.parameters;

            if (toolName && parameters) {
                // Invalidate hint caches for this tool to refresh with new data
                this.invalidateHintCaches(toolName);
            }
        } catch (error) {
            this.logger.warn('Failed to learn from tool execution:', error);
        }
    }

    private invalidateHintCaches(toolName: string): void {
        let invalidated = 0;
        for (const [key] of this.hintCache.entries()) {
            if (key.includes(`hint:${toolName}:`)) {
                this.hintCache.delete(key);
                invalidated++;
            }
        }
        if (invalidated > 0) {
        }
    }

    private cleanupExpiredCaches(): void {
        const now = Date.now();
        let cleaned = 0;

        for (const [key, cached] of this.hintCache.entries()) {
            if (now > cached.expiry) {
                this.hintCache.delete(key);
                cleaned++;
            }
        }

        if (cleaned > 0) {
        }
    }

    private reportPerformanceMetrics(): void {
        if (this.metrics.totalRequests === 0) return;

        const cacheHitRate = this.metrics.cacheHits / 
                           (this.metrics.cacheHits + this.metrics.cacheMisses);


        // Check performance thresholds
        if (this.metrics.averageGenerationTime > this.config.performanceThresholds.maxHintGenerationTime) {
            this.logger.warn(`⚠️ Hint generation time (${this.metrics.averageGenerationTime.toFixed(1)}ms) ` +
                           `exceeds threshold (${this.config.performanceThresholds.maxHintGenerationTime}ms)`);
        }
    }

    private refreshSchemaCache(): void {
        // Clear schema cache to refresh with updated schemas
        this.toolSchemaCache.clear();
    }

    private emitWebSocketEvent(event: WebSocketHintEvent): void {
        this.webSocketEvents$.next(event);
        this.metrics.webSocketEvents++;
    }

    private getDefaultConfig(): HintServiceConfig {
        return {
            enabled: true,
            debounceTimeMs: 300, // 300ms debounce for real-time typing
            maxHintsPerParameter: 5,
            maxCompletionSuggestions: 10,
            cacheHints: true,
            cacheTTL: 5 * 60 * 1000, // 5 minutes
            includePatternHints: true,
            includeSchemaHints: true,
            includeHistoryHints: true,
            webSocketEnabled: true,
            performanceThresholds: {
                maxHintGenerationTime: 100, // 100ms max to avoid UI lag
                maxConcurrentRequests: 10
            }
        };
    }

    // =============================================================================
    // PUBLIC API
    // =============================================================================

    /**
     * Get hint responses observable (for WebSocket streaming)
     */
    public get hintResponses(): Observable<HintResponse> {
        return this.hintResponses$.asObservable();
    }

    /**
     * Get WebSocket events observable
     */
    public get webSocketEvents(): Observable<WebSocketHintEvent> {
        return this.webSocketEvents$.asObservable();
    }

    /**
     * Update configuration
     */
    public updateConfig(newConfig: Partial<HintServiceConfig>): void {
        this.config = { ...this.config, ...newConfig };
    }

    /**
     * Get current configuration
     */
    public getConfig(): HintServiceConfig {
        return { ...this.config };
    }

    /**
     * Get performance metrics
     */
    public getPerformanceMetrics(): typeof this.metrics {
        return { ...this.metrics };
    }

    /**
     * Clear all caches (for testing/maintenance)
     */
    public clearCaches(): void {
        this.hintCache.clear();
        this.toolSchemaCache.clear();
    }

    /**
     * Get active requests count
     */
    public getActiveRequestsCount(): number {
        return this.activeRequests.size;
    }
}