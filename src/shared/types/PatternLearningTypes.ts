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
 * Pattern Learning Types - Phase 2 Integration
 * 
 * Extends ValidationPerformanceTypes.ts with persistent pattern learning
 * and cross-agent pattern sharing capabilities.
 */

import { AgentId } from './Agent';
import { ChannelId } from './ChannelContext';
import { ValidationMetrics, ValidationEvent } from './ValidationPerformanceTypes';

/**
 * Enhanced parameter pattern with persistence and sharing
 * Extends the in-memory patterns from ValidationPerformanceTypes
 */
export interface EnhancedParameterPattern {
    /** Unique pattern identifier for database storage */
    patternId: string;
    
    /** Original parameter combination */
    parameters: Record<string, any>;
    
    /** Pattern classification */
    patternType: 'successful' | 'failed';
    
    /** Error information for failed patterns */
    errorType?: string;
    errorMessage?: string;
    
    /** Usage statistics */
    frequency: number;
    successCount: number;
    failureCount: number;
    
    /** Confidence score (0.0-1.0) based on usage patterns */
    confidenceScore: number;
    
    /** Temporal data */
    firstSeen: number;
    lastUsed: number;
    
    /** Agent tracking */
    discoveredBy: AgentId;
    usedByAgents: Array<{
        agentId: AgentId;
        usageCount: number;
        lastUsed: number;
    }>;
    
    /** Sharing capabilities */
    isShared: boolean;
    shareMetrics?: {
        totalShares: number;
        successfulAdoptions: number;
        adoptionRate: number;
    };
    
    /** Enhanced metadata */
    metadata: {
        validationInsights: {
            commonMistakes: string[];
            suggestedFixes: string[];
            relatedPatterns: string[];
        };
        performance: {
            averageExecutionTime?: number;
            executionTimeVariance?: number;
        };
        context: {
            systemState?: Record<string, any>;
            environmentInfo?: Record<string, any>;
        };
    };
}

/**
 * Enhanced validation metrics with persistent pattern learning
 * Extends ValidationMetrics from ValidationPerformanceTypes
 */
export interface EnhancedValidationMetrics extends ValidationMetrics {
    /** Enhanced parameter patterns with persistence */
    enhancedParameterPatterns: {
        /** Successful patterns with full metadata */
        successfulPatterns: Record<string, EnhancedParameterPattern[]>;
        
        /** Failed patterns with enhanced error analysis */
        failedPatterns: Record<string, EnhancedParameterPattern[]>;
        
        /** Shared patterns from other agents in the channel */
        sharedPatterns: Record<string, EnhancedParameterPattern[]>;
        
        /** Pattern evolution tracking */
        patternEvolution: Record<string, {
            patternId: string;
            evolutionHistory: Array<{
                version: number;
                timestamp: number;
                agentId: AgentId;
                changeType: string;
                improvementScore: number;
            }>;
        }>;
    };
    
    /** Pattern learning effectiveness metrics */
    patternLearningMetrics: {
        /** Total patterns learned across all tools */
        totalPatternsLearned: number;
        
        /** Patterns successfully shared with other agents */
        patternsShared: number;
        
        /** Patterns adopted from other agents */
        patternsAdopted: number;
        
        /** Average confidence score of learned patterns */
        averagePatternConfidence: number;
        
        /** Pattern usage distribution by tool */
        patternUsageByTool: Record<string, number>;
        
        /** Cross-agent learning metrics */
        crossAgentLearning: {
            agentsSharedWith: AgentId[];
            agentsLearnedFrom: AgentId[];
            collaborationIndex: number;
        };
    };
    
    /** Channel-wide pattern insights */
    channelPatternInsights: {
        /** Most effective shared patterns */
        topSharedPatterns: Array<{
            toolName: string;
            patternId: string;
            adoptionRate: number;
            errorReduction: number;
        }>;
        
        /** Patterns that need improvement */
        problematicPatterns: Array<{
            toolName: string;
            patternId: string;
            issueType: string;
            suggestedActions: string[];
        }>;
        
        /** Channel learning health */
        channelLearningHealth: {
            overallScore: number;
            patternDiversity: number;
            sharingActivity: number;
            knowledgeDistribution: number;
        };
    };
}

/**
 * Pattern recommendation with enhanced context
 */
export interface PatternRecommendation {
    /** Pattern being recommended */
    pattern: EnhancedParameterPattern;
    
    /** Relevance score for current context */
    relevanceScore: number;
    
    /** Confidence in recommendation */
    confidence: number;
    
    /** Reason for recommendation */
    reason: string;
    
    /** Expected benefits */
    expectedBenefits: {
        errorReduction: number;
        timeSavings: number;
        confidenceImprovement: number;
    };
    
    /** Adaptation suggestions */
    adaptationSuggestions: string[];
    
    /** Risk assessment */
    risks: string[];
    
    /** Source information */
    source: {
        sourceAgent?: AgentId;
        discoveryContext: string;
        lastVerified: number;
    };
}

/**
 * Pattern learning event for enhanced tracking
 */
export interface PatternLearningEvent {
    timestamp: number;
    agentId: string;
    channelId: string;
    toolName: string;
    
    /** Enhanced event types for pattern learning */
    eventType: 'validation_error' | 
               'validation_success' | 
               'help_tool_used' | 
               'self_correction' | 
               'parameter_learned' |
               'pattern_discovered' | 
               'pattern_shared' | 
               'pattern_adopted' | 
               'pattern_evolved' | 
               'pattern_deprecated';
    
    /** Enhanced details for pattern events */
    details: {
        /** Base validation event details */
        parameters?: Record<string, any>;
        error?: string;
        errorType?: string;
        recoveryTime?: number;
        correctionAttempt?: number;
        helpToolUsed?: string;
        
        /** Pattern-specific information */
        patternId?: string;
        patternHash?: string;
        sharedFromAgent?: AgentId;
        sharedToAgent?: AgentId;
        evolutionType?: string;
        confidenceScore?: number;
        adoptionSuccess?: boolean;
        
        /** Learning insights */
        learningInsights?: {
            newKnowledge: string[];
            improvedCapabilities: string[];
            knowledgeGaps: string[];
        };
    };
}

/**
 * Pattern search criteria for finding relevant patterns
 */
export interface PatternSearchCriteria {
    /** Channel to search within */
    channelId: ChannelId;
    
    /** Tool name filter */
    toolName?: string;
    
    /** Pattern type filter */
    patternType?: 'successful' | 'failed';
    
    /** Minimum confidence threshold */
    minConfidence?: number;
    
    /** Minimum usage frequency */
    minFrequency?: number;
    
    /** Include shared patterns from other agents */
    includeShared?: boolean;
    
    /** Agent filter (patterns discovered by specific agents) */
    discoveredBy?: AgentId[];
    
    /** Time range filter */
    timeRange?: {
        start: number;
        end: number;
    };
    
    /** Similarity threshold for parameter matching */
    similarityThreshold?: number;
    
    /** Context filters */
    contextFilters?: {
        errorTypes?: string[];
        tags?: string[];
        systemState?: Record<string, any>;
    };
}

/**
 * Pattern learning service configuration
 */
export interface PatternLearningConfig {
    /** Enable pattern sharing between agents */
    enablePatternSharing: boolean;
    
    /** Minimum confidence for pattern sharing */
    sharingConfidenceThreshold: number;
    
    /** Maximum patterns to store per tool */
    maxPatternsPerTool: number;
    
    /** Pattern expiration settings */
    patternExpiration: {
        /** Days after which unused patterns are considered stale */
        staleDays: number;
        
        /** Days after which stale patterns are deleted */
        deletionDays: number;
        
        /** Minimum frequency to prevent deletion */
        minFrequencyForRetention: number;
    };
    
    /** Confidence calculation weights */
    confidenceWeights: {
        frequency: number;
        recentUsage: number;
        successRate: number;
        crossAgentValidation: number;
    };
    
    /** Learning optimization settings */
    learningOptimization: {
        /** Enable automatic pattern evolution */
        enableEvolution: boolean;
        
        /** Threshold for triggering pattern improvements */
        improvementThreshold: number;
        
        /** Enable proactive pattern recommendations */
        enableRecommendations: boolean;
        
        /** Maximum recommendations per session */
        maxRecommendations: number;
    };
}

/**
 * Pattern migration result for transitioning from in-memory to persistent storage
 */
export interface PatternMigrationResult {
    /** Migration summary */
    summary: {
        totalPatternsMigrated: number;
        successfulPatterns: number;
        failedPatterns: number;
        duplicatesSkipped: number;
        migrationDuration: number;
    };
    
    /** Migration details by tool */
    byTool: Record<string, {
        originalCount: number;
        migratedCount: number;
        skippedCount: number;
        errors: string[];
    }>;
    
    /** Post-migration validation */
    validation: {
        dataIntegrityCheck: boolean;
        indexCreationSuccess: boolean;
        queryPerformanceTest: boolean;
    };
    
    /** Recommended next steps */
    recommendations: string[];
    
    /** Any migration warnings or issues */
    warnings: string[];
}

/**
 * Channel pattern analytics for understanding learning across agents
 */
export interface ChannelPatternAnalytics {
    /** Channel identification */
    channelId: ChannelId;
    
    /** Time range for analytics */
    timeRange: {
        start: number;
        end: number;
    };
    
    /** Overall channel learning metrics */
    overallMetrics: {
        totalPatterns: number;
        activeAgents: number;
        sharedPatterns: number;
        adoptionRate: number;
        knowledgeDiversityIndex: number;
    };
    
    /** Agent collaboration matrix */
    agentCollaboration: Record<AgentId, {
        patternsShared: number;
        patternsReceived: number;
        collaborationScore: number;
        topCollaborators: AgentId[];
    }>;
    
    /** Tool learning effectiveness */
    toolLearningEffectiveness: Record<string, {
        totalPatterns: number;
        averageConfidence: number;
        sharedPercentage: number;
        errorReduction: number;
        learningVelocity: number;
    }>;
    
    /** Learning trends */
    learningTrends: {
        patternDiscoveryRate: number[];
        sharingActivity: number[];
        adoptionSuccess: number[];
        knowledgeGrowth: number[];
    };
    
    /** Recommendations for channel improvement */
    improvementRecommendations: Array<{
        category: 'sharing' | 'adoption' | 'diversity' | 'collaboration';
        priority: 'high' | 'medium' | 'low';
        recommendation: string;
        expectedImpact: string;
        targetAgents?: AgentId[];
    }>;
}