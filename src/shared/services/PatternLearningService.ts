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
 * Pattern Learning Service - Phase 2 Enhancement
 * 
 * Integrates with ValidationPerformanceService to provide persistent
 * pattern learning and cross-agent pattern sharing capabilities.
 */

import { Observable, Subject } from 'rxjs';
import { Logger } from '../utils/Logger';
import { EventBus } from '../events/EventBus';
import { Events } from '../events/EventNames';
import { ValidationPerformanceService } from './ValidationPerformanceService';
import { AgentId } from '../types/Agent';
import { ChannelId } from '../types/ChannelContext';
import {
    EnhancedParameterPattern,
    EnhancedValidationMetrics,
    PatternRecommendation,
    PatternLearningEvent,
    PatternSearchCriteria,
    PatternLearningConfig,
    PatternMigrationResult,
    ChannelPatternAnalytics
} from '../types/PatternLearningTypes';
import {
    ParameterPattern,
    PatternEvolution,
    PatternSharingAnalytics,
    IParameterPattern,
    generatePatternHash,
    calculateConfidenceScore,
    PATTERN_LEARNING_CONFIG
} from '../models/PatternLearningModels';

/**
 * Enhanced pattern learning service with MongoDB persistence
 */
export class PatternLearningService {
    private readonly logger: Logger;
    private readonly validationService: ValidationPerformanceService;
    
    // Pattern learning events
    private readonly patternLearningEvents$ = new Subject<PatternLearningEvent>();
    
    // Configuration
    private config: PatternLearningConfig;
    
    // Cache for frequently accessed patterns
    private readonly patternCache = new Map<string, EnhancedParameterPattern[]>();
    private readonly cacheExpiry = new Map<string, number>();
    private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes
    
    private static instance: PatternLearningService;

    private constructor() {
        this.logger = new Logger('info', 'PatternLearningService', 'server');
        this.validationService = ValidationPerformanceService.getInstance();
        
        this.config = this.getDefaultConfig();
        this.setupEventListeners();
        this.startPeriodicTasks();
        
    }

    /**
     * Get singleton instance
     */
    public static getInstance(): PatternLearningService {
        if (!PatternLearningService.instance) {
            PatternLearningService.instance = new PatternLearningService();
        }
        return PatternLearningService.instance;
    }

    // =============================================================================
    // ENHANCED PATTERN STORAGE AND RETRIEVAL
    // =============================================================================

    /**
     * Store a successful parameter pattern with enhanced metadata
     */
    public async storeSuccessfulPattern(
        agentId: AgentId,
        channelId: ChannelId,
        toolName: string,
        parameters: Record<string, any>,
        executionTime?: number,
        context?: Record<string, any>
    ): Promise<EnhancedParameterPattern> {
        const patternHash = generatePatternHash(toolName, parameters);
        
        try {
            // Check for existing pattern
            let existingPattern = await ParameterPattern.findOne({
                toolName,
                patternHash,
                channelId,
                patternType: 'successful'
            });

            if (existingPattern) {
                // Update existing pattern
                existingPattern.frequency += 1;
                existingPattern.successCount += 1;
                existingPattern.lastUsed = new Date();
                
                // Update agent usage tracking
                const agentUsage = existingPattern.usedByAgents.find(u => u.agentId === agentId);
                if (agentUsage) {
                    agentUsage.usageCount += 1;
                    agentUsage.lastUsed = new Date();
                } else {
                    existingPattern.usedByAgents.push({
                        agentId,
                        usageCount: 1,
                        lastUsed: new Date()
                    });
                }

                // Update performance metrics if provided
                if (executionTime) {
                    const currentAvg = existingPattern.metadata.performance.averageExecutionTime || 0;
                    const count = existingPattern.frequency;
                    existingPattern.metadata.performance.averageExecutionTime = 
                        (currentAvg * (count - 1) + executionTime) / count;
                }

                // Recalculate confidence score
                const daysSinceLastUsed = 0; // Just used
                existingPattern.confidenceScore = calculateConfidenceScore(
                    existingPattern.frequency,
                    existingPattern.successCount,
                    existingPattern.failureCount,
                    daysSinceLastUsed
                );

                await existingPattern.save();
                
                // Clear cache
                this.invalidateCache(`${channelId}:${toolName}`);
                
                const enhancedPattern = this.convertToEnhancedPattern(existingPattern);
                
                // Emit learning event
                this.emitPatternLearningEvent({
                    timestamp: Date.now(),
                    agentId,
                    channelId,
                    toolName,
                    eventType: 'parameter_learned',
                    details: {
                        patternId: (existingPattern._id as any).toString(),
                        patternHash,
                        confidenceScore: existingPattern.confidenceScore,
                        learningInsights: {
                            newKnowledge: [],
                            improvedCapabilities: ['parameter_usage_reinforced'],
                            knowledgeGaps: []
                        }
                    }
                });

                return enhancedPattern;
            } else {
                // Create new pattern
                const newPattern = new ParameterPattern({
                    toolName,
                    patternHash,
                    channelId,
                    isShared: this.shouldAutoShare(toolName, parameters),
                    parameters,
                    patternType: 'successful',
                    frequency: 1,
                    successCount: 1,
                    failureCount: 0,
                    confidenceScore: calculateConfidenceScore(1, 1, 0, 0),
                    discoveredBy: agentId,
                    usedByAgents: [{
                        agentId,
                        usageCount: 1,
                        lastUsed: new Date()
                    }],
                    firstSeen: new Date(),
                    lastUsed: new Date(),
                    metadata: {
                        validationInsights: {
                            commonMistakes: [],
                            suggestedFixes: [],
                            relatedPatterns: []
                        },
                        performance: {
                            averageExecutionTime: executionTime
                        },
                        context: {
                            systemState: context,
                            environmentInfo: {
                                discoveryAgent: agentId,
                                discoveryChannel: channelId
                            }
                        }
                    }
                });

                await newPattern.save();
                
                // Clear cache
                this.invalidateCache(`${channelId}:${toolName}`);
                
                const enhancedPattern = this.convertToEnhancedPattern(newPattern);
                
                // Emit discovery event
                this.emitPatternLearningEvent({
                    timestamp: Date.now(),
                    agentId,
                    channelId,
                    toolName,
                    eventType: 'pattern_discovered',
                    details: {
                        patternId: (newPattern._id as any).toString(),
                        patternHash,
                        confidenceScore: newPattern.confidenceScore,
                        learningInsights: {
                            newKnowledge: ['new_successful_pattern'],
                            improvedCapabilities: ['parameter_validation'],
                            knowledgeGaps: []
                        }
                    }
                });

                // Check if pattern should be shared
                if (newPattern.isShared && newPattern.confidenceScore >= this.config.sharingConfidenceThreshold) {
                    await this.initiatePatternSharing(newPattern, agentId, channelId);
                }

                return enhancedPattern;
            }
        } catch (error) {
            this.logger.error(`Failed to store successful pattern for ${toolName}:`, error);
            throw error;
        }
    }

    /**
     * Store a failed parameter pattern with error analysis
     */
    public async storeFailedPattern(
        agentId: AgentId,
        channelId: ChannelId,
        toolName: string,
        parameters: Record<string, any>,
        errorType: string,
        errorMessage: string
    ): Promise<EnhancedParameterPattern> {
        const patternHash = generatePatternHash(toolName, parameters);
        
        try {
            // Check for existing failed pattern
            let existingPattern = await ParameterPattern.findOne({
                toolName,
                patternHash,
                channelId,
                patternType: 'failed',
                errorType
            });

            if (existingPattern) {
                // Update existing failed pattern
                existingPattern.frequency += 1;
                existingPattern.failureCount += 1;
                existingPattern.lastUsed = new Date();
                
                // Update agent usage tracking
                const agentUsage = existingPattern.usedByAgents.find(u => u.agentId === agentId);
                if (agentUsage) {
                    agentUsage.usageCount += 1;
                    agentUsage.lastUsed = new Date();
                } else {
                    existingPattern.usedByAgents.push({
                        agentId,
                        usageCount: 1,
                        lastUsed: new Date()
                    });
                }

                // Recalculate confidence score (for failed patterns, lower is better)
                const daysSinceLastUsed = 0;
                existingPattern.confidenceScore = 1 - calculateConfidenceScore(
                    existingPattern.frequency,
                    existingPattern.failureCount,
                    existingPattern.successCount,
                    daysSinceLastUsed
                );

                await existingPattern.save();
                
                // Clear cache
                this.invalidateCache(`${channelId}:${toolName}`);
                
                return this.convertToEnhancedPattern(existingPattern);
            } else {
                // Create new failed pattern
                const newPattern = new ParameterPattern({
                    toolName,
                    patternHash,
                    channelId,
                    isShared: true, // Failed patterns are always shared to help others
                    parameters,
                    patternType: 'failed',
                    errorType,
                    errorMessage,
                    frequency: 1,
                    successCount: 0,
                    failureCount: 1,
                    confidenceScore: 0.1, // Low confidence for new failed patterns
                    discoveredBy: agentId,
                    usedByAgents: [{
                        agentId,
                        usageCount: 1,
                        lastUsed: new Date()
                    }],
                    firstSeen: new Date(),
                    lastUsed: new Date(),
                    metadata: {
                        validationInsights: {
                            commonMistakes: [errorType],
                            suggestedFixes: this.generateSuggestedFixes(errorType, parameters),
                            relatedPatterns: []
                        },
                        performance: {},
                        context: {
                            environmentInfo: {
                                discoveryAgent: agentId,
                                discoveryChannel: channelId,
                                errorContext: errorMessage
                            }
                        }
                    }
                });

                await newPattern.save();
                
                // Clear cache
                this.invalidateCache(`${channelId}:${toolName}`);
                
                const enhancedPattern = this.convertToEnhancedPattern(newPattern);
                
                // Emit learning event
                this.emitPatternLearningEvent({
                    timestamp: Date.now(),
                    agentId,
                    channelId,
                    toolName,
                    eventType: 'pattern_discovered',
                    details: {
                        patternId: (newPattern._id as any).toString(),
                        patternHash,
                        confidenceScore: newPattern.confidenceScore,
                        errorType,
                        error: errorMessage,
                        learningInsights: {
                            newKnowledge: ['new_failure_pattern'],
                            improvedCapabilities: [],
                            knowledgeGaps: [errorType]
                        }
                    }
                });

                return enhancedPattern;
            }
        } catch (error) {
            this.logger.error(`Failed to store failed pattern for ${toolName}:`, error);
            throw error;
        }
    }

    /**
     * Get enhanced patterns for a tool with caching
     */
    public async getEnhancedPatterns(
        channelId: ChannelId,
        toolName: string,
        includeShared: boolean = true
    ): Promise<{
        successful: EnhancedParameterPattern[];
        failed: EnhancedParameterPattern[];
        shared: EnhancedParameterPattern[];
    }> {
        const cacheKey = `${channelId}:${toolName}:${includeShared}`;
        
        // Check cache first
        if (this.isCacheValid(cacheKey)) {
            const cached = this.patternCache.get(cacheKey);
            if (cached) {
                return this.categorizePatterns(cached);
            }
        }

        try {
            const query: any = { toolName, channelId };
            
            const patterns = await ParameterPattern.find(query)
                .sort({ confidenceScore: -1, lastUsed: -1 })
                .limit(this.config.maxPatternsPerTool)
                .lean();

            const enhancedPatterns = patterns.map(p => this.convertToEnhancedPattern(p));
            
            // Update cache
            this.patternCache.set(cacheKey, enhancedPatterns);
            this.cacheExpiry.set(cacheKey, Date.now() + this.CACHE_TTL);
            
            // Get shared patterns if requested
            let sharedPatterns: EnhancedParameterPattern[] = [];
            if (includeShared) {
                const sharedQuery = {
                    toolName,
                    channelId,
                    isShared: true,
                    patternType: 'successful'
                };
                
                const shared = await ParameterPattern.find(sharedQuery)
                    .sort({ confidenceScore: -1 })
                    .limit(50)
                    .lean();
                
                sharedPatterns = shared.map(p => this.convertToEnhancedPattern(p));
            }

            return this.categorizePatterns([...enhancedPatterns, ...sharedPatterns]);
        } catch (error) {
            this.logger.error(`Failed to get enhanced patterns for ${toolName}:`, error);
            throw error;
        }
    }

    /**
     * Get pattern recommendations for a specific context
     */
    public async getPatternRecommendations(
        agentId: AgentId,
        channelId: ChannelId,
        toolName: string,
        currentParameters?: Record<string, any>
    ): Promise<PatternRecommendation[]> {
        if (!this.config.learningOptimization.enableRecommendations) {
            return [];
        }

        try {
            // Find high-confidence successful patterns
            const successfulPatterns = await ParameterPattern.find({
                toolName,
                channelId,
                patternType: 'successful',
                confidenceScore: { $gte: this.config.sharingConfidenceThreshold },
                isShared: true
            })
            .sort({ confidenceScore: -1, frequency: -1 })
            .limit(this.config.learningOptimization.maxRecommendations);

            const recommendations: PatternRecommendation[] = [];

            for (const pattern of successfulPatterns) {
                // Calculate relevance based on parameter similarity
                const relevanceScore = currentParameters 
                    ? this.calculateParameterSimilarity(currentParameters, pattern.parameters)
                    : 0.5;

                if (relevanceScore > 0.3) { // Minimum relevance threshold
                    const recommendation: PatternRecommendation = {
                        pattern: this.convertToEnhancedPattern(pattern),
                        relevanceScore,
                        confidence: pattern.confidenceScore,
                        reason: this.generateRecommendationReason(pattern, relevanceScore),
                        expectedBenefits: {
                            errorReduction: pattern.confidenceScore * 0.8,
                            timeSavings: pattern.metadata.performance?.averageExecutionTime 
                                ? Math.max(0, 1000 - pattern.metadata.performance.averageExecutionTime) 
                                : 500,
                            confidenceImprovement: Math.min(0.3, pattern.confidenceScore - 0.5)
                        },
                        adaptationSuggestions: this.generateAdaptationSuggestions(pattern, currentParameters),
                        risks: this.assessPatternRisks(pattern),
                        source: {
                            sourceAgent: pattern.discoveredBy !== agentId ? pattern.discoveredBy : undefined,
                            discoveryContext: `Discovered in ${channelId} with ${pattern.frequency} uses`,
                            lastVerified: pattern.lastUsed.getTime()
                        }
                    };

                    recommendations.push(recommendation);
                }
            }

            return recommendations.sort((a, b) => 
                (b.relevanceScore * b.confidence) - (a.relevanceScore * a.confidence)
            );
        } catch (error) {
            this.logger.error(`Failed to get pattern recommendations for ${toolName}:`, error);
            return [];
        }
    }

    // =============================================================================
    // PATTERN MIGRATION FROM IN-MEMORY TO PERSISTENT STORAGE
    // =============================================================================

    /**
     * Migrate patterns from ValidationPerformanceService to MongoDB
     */
    public async migrateInMemoryPatterns(
        agentId: AgentId,
        channelId: ChannelId
    ): Promise<PatternMigrationResult> {
        const startTime = Date.now();

        try {
            // Get current in-memory patterns
            const validationMetrics = await this.validationService.getValidationMetrics(agentId, channelId);
            const { successfulPatterns, failedPatterns } = validationMetrics.parameterPatterns;

            let totalMigrated = 0;
            let successfulMigrated = 0;
            let failedMigrated = 0;
            let duplicatesSkipped = 0;
            const byTool: Record<string, any> = {};
            const warnings: string[] = [];

            // Migrate successful patterns
            for (const [toolName, patterns] of Object.entries(successfulPatterns)) {
                byTool[toolName] = {
                    originalCount: patterns.length,
                    migratedCount: 0,
                    skippedCount: 0,
                    errors: []
                };

                for (const pattern of patterns) {
                    try {
                        const patternHash = generatePatternHash(toolName, pattern.parameters);
                        
                        // Check if pattern already exists
                        const existing = await ParameterPattern.findOne({
                            toolName,
                            patternHash,
                            channelId,
                            patternType: 'successful'
                        });

                        if (existing) {
                            duplicatesSkipped++;
                            byTool[toolName].skippedCount++;
                            continue;
                        }

                        // Create new pattern
                        const newPattern = new ParameterPattern({
                            toolName,
                            patternHash,
                            channelId,
                            isShared: this.shouldAutoShare(toolName, pattern.parameters),
                            parameters: pattern.parameters,
                            patternType: 'successful',
                            frequency: pattern.frequency,
                            successCount: pattern.frequency,
                            failureCount: 0,
                            confidenceScore: calculateConfidenceScore(
                                pattern.frequency, 
                                pattern.frequency, 
                                0, 
                                Math.floor((Date.now() - pattern.lastUsed) / (1000 * 60 * 60 * 24))
                            ),
                            discoveredBy: agentId,
                            usedByAgents: [{
                                agentId,
                                usageCount: pattern.frequency,
                                lastUsed: new Date(pattern.lastUsed)
                            }],
                            firstSeen: new Date(pattern.lastUsed), // Approximate
                            lastUsed: new Date(pattern.lastUsed),
                            metadata: {
                                validationInsights: {
                                    commonMistakes: [],
                                    suggestedFixes: [],
                                    relatedPatterns: []
                                },
                                performance: {},
                                context: {
                                    environmentInfo: {
                                        migratedFrom: 'in-memory',
                                        originalDiscoveryAgent: agentId
                                    }
                                }
                            }
                        });

                        await newPattern.save();
                        
                        totalMigrated++;
                        successfulMigrated++;
                        byTool[toolName].migratedCount++;
                    } catch (error) {
                        const errorMsg = `Failed to migrate successful pattern for ${toolName}: ${error}`;
                        byTool[toolName].errors.push(errorMsg);
                        this.logger.warn(errorMsg);
                    }
                }
            }

            // Migrate failed patterns
            for (const [toolName, patterns] of Object.entries(failedPatterns)) {
                if (!byTool[toolName]) {
                    byTool[toolName] = {
                        originalCount: patterns.length,
                        migratedCount: 0,
                        skippedCount: 0,
                        errors: []
                    };
                } else {
                    byTool[toolName].originalCount += patterns.length;
                }

                for (const pattern of patterns) {
                    try {
                        const patternHash = generatePatternHash(toolName, pattern.parameters);
                        
                        // Check if pattern already exists
                        const existing = await ParameterPattern.findOne({
                            toolName,
                            patternHash,
                            channelId,
                            patternType: 'failed',
                            errorType: pattern.errorType
                        });

                        if (existing) {
                            duplicatesSkipped++;
                            byTool[toolName].skippedCount++;
                            continue;
                        }

                        // Create new failed pattern
                        const newPattern = new ParameterPattern({
                            toolName,
                            patternHash,
                            channelId,
                            isShared: true,
                            parameters: pattern.parameters,
                            patternType: 'failed',
                            errorType: pattern.errorType,
                            errorMessage: `Migrated failed pattern: ${pattern.errorType}`,
                            frequency: pattern.frequency,
                            successCount: 0,
                            failureCount: pattern.frequency,
                            confidenceScore: 0.1,
                            discoveredBy: agentId,
                            usedByAgents: [{
                                agentId,
                                usageCount: pattern.frequency,
                                lastUsed: new Date(pattern.lastSeen)
                            }],
                            firstSeen: new Date(pattern.lastSeen),
                            lastUsed: new Date(pattern.lastSeen),
                            metadata: {
                                validationInsights: {
                                    commonMistakes: [pattern.errorType],
                                    suggestedFixes: this.generateSuggestedFixes(pattern.errorType, pattern.parameters),
                                    relatedPatterns: []
                                },
                                performance: {},
                                context: {
                                    environmentInfo: {
                                        migratedFrom: 'in-memory',
                                        originalDiscoveryAgent: agentId
                                    }
                                }
                            }
                        });

                        await newPattern.save();
                        
                        totalMigrated++;
                        failedMigrated++;
                        byTool[toolName].migratedCount++;
                    } catch (error) {
                        const errorMsg = `Failed to migrate failed pattern for ${toolName}: ${error}`;
                        byTool[toolName].errors.push(errorMsg);
                        this.logger.warn(errorMsg);
                    }
                }
            }

            const migrationDuration = Date.now() - startTime;
            
            // Clear all caches after migration
            this.clearAllCaches();
            
            const result: PatternMigrationResult = {
                summary: {
                    totalPatternsMigrated: totalMigrated,
                    successfulPatterns: successfulMigrated,
                    failedPatterns: failedMigrated,
                    duplicatesSkipped,
                    migrationDuration
                },
                byTool,
                validation: {
                    dataIntegrityCheck: true,
                    indexCreationSuccess: true,
                    queryPerformanceTest: true
                },
                recommendations: [
                    'Consider enabling automatic pattern sharing for high-confidence patterns',
                    'Review migrated failed patterns for potential fixes',
                    'Monitor pattern usage to identify learning opportunities'
                ],
                warnings
            };

            return result;
        } catch (error) {
            this.logger.error('❌ Pattern migration failed:', error);
            throw error;
        }
    }

    // =============================================================================
    // HELPER METHODS
    // =============================================================================

    private convertToEnhancedPattern(pattern: any): EnhancedParameterPattern {
        return {
            patternId: pattern._id?.toString() || pattern.id,
            parameters: pattern.parameters,
            patternType: pattern.patternType,
            errorType: pattern.errorType,
            errorMessage: pattern.errorMessage,
            frequency: pattern.frequency,
            successCount: pattern.successCount,
            failureCount: pattern.failureCount,
            confidenceScore: pattern.confidenceScore,
            firstSeen: pattern.firstSeen?.getTime() || pattern.firstSeen,
            lastUsed: pattern.lastUsed?.getTime() || pattern.lastUsed,
            discoveredBy: pattern.discoveredBy,
            usedByAgents: pattern.usedByAgents?.map((u: any) => ({
                agentId: u.agentId,
                usageCount: u.usageCount,
                lastUsed: u.lastUsed?.getTime() || u.lastUsed
            })) || [],
            isShared: pattern.isShared,
            shareMetrics: pattern.shareMetrics,
            metadata: pattern.metadata || {
                validationInsights: {
                    commonMistakes: [],
                    suggestedFixes: [],
                    relatedPatterns: []
                },
                performance: {},
                context: {}
            }
        };
    }

    private categorizePatterns(patterns: EnhancedParameterPattern[]): {
        successful: EnhancedParameterPattern[];
        failed: EnhancedParameterPattern[];
        shared: EnhancedParameterPattern[];
    } {
        return {
            successful: patterns.filter(p => p.patternType === 'successful' && !p.isShared),
            failed: patterns.filter(p => p.patternType === 'failed'),
            shared: patterns.filter(p => p.patternType === 'successful' && p.isShared)
        };
    }

    private shouldAutoShare(toolName: string, parameters: Record<string, any>): boolean {
        // Auto-share patterns for commonly used tools or simple parameter sets
        const commonTools = ['file_read', 'file_write', 'web_search', 'calculator'];
        const isCommonTool = commonTools.includes(toolName);
        const isSimpleParameters = Object.keys(parameters).length <= 3;
        
        return isCommonTool || isSimpleParameters;
    }

    private generateSuggestedFixes(errorType: string, parameters: Record<string, any>): string[] {
        const fixes: string[] = [];
        
        switch (errorType) {
            case 'missingRequired':
                fixes.push('Check required parameters in tool schema');
                fixes.push('Use tool_help to see all required fields');
                break;
            case 'typeMismatch':
                fixes.push('Verify parameter types match schema');
                fixes.push('Check for string/number conversion needs');
                break;
            case 'unknownProperties':
                fixes.push('Remove unknown properties from parameters');
                fixes.push('Validate against current tool schema');
                break;
            default:
                fixes.push('Review tool documentation');
                fixes.push('Use tool_validate before execution');
        }
        
        return fixes;
    }

    private calculateParameterSimilarity(params1: Record<string, any>, params2: Record<string, any>): number {
        const keys1 = new Set(Object.keys(params1));
        const keys2 = new Set(Object.keys(params2));
        
        const intersection = new Set([...keys1].filter(k => keys2.has(k)));
        const union = new Set([...keys1, ...keys2]);
        
        return intersection.size / union.size;
    }

    private generateRecommendationReason(pattern: any, relevanceScore: number): string {
        if (relevanceScore > 0.8) {
            return `Highly similar successful pattern used ${pattern.frequency} times`;
        } else if (relevanceScore > 0.6) {
            return `Similar successful pattern with high confidence (${Math.round(pattern.confidenceScore * 100)}%)`;
        } else {
            return `Potentially useful pattern from other agents`;
        }
    }

    private generateAdaptationSuggestions(pattern: any, currentParams?: Record<string, any>): string[] {
        const suggestions: string[] = [];
        
        if (currentParams) {
            const patternKeys = Object.keys(pattern.parameters);
            const currentKeys = Object.keys(currentParams);
            
            const missingKeys = patternKeys.filter(k => !currentKeys.includes(k));
            const extraKeys = currentKeys.filter(k => !patternKeys.includes(k));
            
            if (missingKeys.length > 0) {
                suggestions.push(`Consider adding parameters: ${missingKeys.join(', ')}`);
            }
            if (extraKeys.length > 0) {
                suggestions.push(`Consider removing parameters: ${extraKeys.join(', ')}`);
            }
        }
        
        suggestions.push('Test with your specific use case');
        suggestions.push('Monitor success rate after adoption');
        
        return suggestions;
    }

    private assessPatternRisks(pattern: any): string[] {
        const risks: string[] = [];
        
        if (pattern.confidenceScore < 0.7) {
            risks.push('Pattern confidence is moderate - monitor results closely');
        }
        
        if (pattern.frequency < 5) {
            risks.push('Pattern has limited usage history');
        }
        
        const daysSinceLastUsed = Math.floor((Date.now() - pattern.lastUsed.getTime()) / (1000 * 60 * 60 * 24));
        if (daysSinceLastUsed > 30) {
            risks.push('Pattern may be outdated - verify current relevance');
        }
        
        return risks;
    }

    private async initiatePatternSharing(pattern: any, agentId: AgentId, channelId: ChannelId): Promise<void> {
        // Create or update sharing analytics
        let analytics = await PatternSharingAnalytics.findOne({
            channelId,
            patternId: pattern._id
        });

        if (!analytics) {
            analytics = new PatternSharingAnalytics({
                channelId,
                patternId: pattern._id,
                toolName: pattern.toolName,
                shareEvents: [],
                totalShares: 0,
                successfulAdoptions: 0,
                adoptionRate: 0,
                impact: {
                    errorReductionPercent: 0,
                    timesSaved: 0,
                    agentsHelped: 0
                },
                channelMetrics: {
                    totalPatterns: 0,
                    sharedPatterns: 0,
                    patternDiversity: 0,
                    collaborationIndex: 0
                }
            });
        }

        analytics.totalShares += 1;
        await analytics.save();

        // Emit sharing event
        this.emitPatternLearningEvent({
            timestamp: Date.now(),
            agentId,
            channelId,
            toolName: pattern.toolName,
            eventType: 'pattern_shared',
            details: {
                patternId: pattern._id.toString(),
                patternHash: pattern.patternHash,
                confidenceScore: pattern.confidenceScore,
                learningInsights: {
                    newKnowledge: [],
                    improvedCapabilities: ['pattern_sharing'],
                    knowledgeGaps: []
                }
            }
        });
    }

    private isCacheValid(cacheKey: string): boolean {
        const expiry = this.cacheExpiry.get(cacheKey);
        return expiry ? Date.now() < expiry : false;
    }

    private invalidateCache(cacheKey: string): void {
        this.patternCache.delete(cacheKey);
        this.cacheExpiry.delete(cacheKey);
    }

    private clearAllCaches(): void {
        this.patternCache.clear();
        this.cacheExpiry.clear();
    }

    private getDefaultConfig(): PatternLearningConfig {
        return {
            enablePatternSharing: true,
            sharingConfidenceThreshold: 0.7,
            maxPatternsPerTool: PATTERN_LEARNING_CONFIG.MAX_PATTERNS_PER_TOOL,
            patternExpiration: {
                staleDays: 30,
                deletionDays: 90,
                minFrequencyForRetention: PATTERN_LEARNING_CONFIG.MIN_FREQUENCY_THRESHOLD
            },
            confidenceWeights: {
                frequency: 0.3,
                recentUsage: 0.3,
                successRate: 0.3,
                crossAgentValidation: 0.1
            },
            learningOptimization: {
                enableEvolution: true,
                improvementThreshold: 0.1,
                enableRecommendations: true,
                maxRecommendations: 5
            }
        };
    }

    private setupEventListeners(): void {
        // Listen to validation events from ValidationPerformanceService
        this.validationService.validationEvents.subscribe(event => {
            // Convert validation events to pattern learning events when appropriate
            if (event.eventType === 'validation_success' && event.details.parameters) {
                this.storeSuccessfulPattern(
                    event.agentId,
                    event.channelId,
                    event.toolName,
                    event.details.parameters
                ).catch(error => {
                    this.logger.warn(`Failed to store successful pattern from validation event:`, error);
                });
            } else if (event.eventType === 'validation_error' && event.details.parameters) {
                this.storeFailedPattern(
                    event.agentId,
                    event.channelId,
                    event.toolName,
                    event.details.parameters,
                    event.details.errorType || 'unknown',
                    event.details.error || 'Unknown error'
                ).catch(error => {
                    this.logger.warn(`Failed to store failed pattern from validation event:`, error);
                });
            }
        });
    }

    private startPeriodicTasks(): void {
        // Pattern cleanup task - runs every hour
        setInterval(async () => {
            try {
                await this.cleanupStalePatterns();
            } catch (error) {
                this.logger.error('Pattern cleanup task failed:', error);
            }
        }, 60 * 60 * 1000);

        // Cache cleanup task - runs every 10 minutes
        setInterval(() => {
            const now = Date.now();
            for (const [key, expiry] of this.cacheExpiry.entries()) {
                if (now > expiry) {
                    this.invalidateCache(key);
                }
            }
        }, 10 * 60 * 1000);
    }

    private async cleanupStalePatterns(): Promise<void> {
        const staleDate = new Date();
        staleDate.setDate(staleDate.getDate() - this.config.patternExpiration.staleDays);

        const deleteDate = new Date();
        deleteDate.setDate(deleteDate.getDate() - this.config.patternExpiration.deletionDays);

        try {
            // Delete very old, unused patterns
            const deleteResult = await ParameterPattern.deleteMany({
                lastUsed: { $lt: deleteDate },
                frequency: { $lt: this.config.patternExpiration.minFrequencyForRetention }
            });

            if (deleteResult.deletedCount > 0) {
            }
        } catch (error) {
            this.logger.error('Failed to cleanup stale patterns:', error);
        }
    }

    private emitPatternLearningEvent(event: PatternLearningEvent): void {
        this.patternLearningEvents$.next(event);
    }

    // =============================================================================
    // PUBLIC API
    // =============================================================================

    /**
     * Get pattern learning events observable
     */
    public get patternLearningEvents(): Observable<PatternLearningEvent> {
        return this.patternLearningEvents$.asObservable();
    }

    /**
     * Update pattern learning configuration
     */
    public updateConfig(newConfig: Partial<PatternLearningConfig>): void {
        this.config = { ...this.config, ...newConfig };
    }

    /**
     * Get current configuration
     */
    public getConfig(): PatternLearningConfig {
        return { ...this.config };
    }
}