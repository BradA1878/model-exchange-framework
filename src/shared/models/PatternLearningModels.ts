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
 * MongoDB models for Parameter Pattern Learning System
 * Phase 2: Enhanced validation with pattern learning and sharing
 * 
 * Integrates with existing ValidationPerformanceService to provide
 * persistent storage and cross-agent pattern sharing.
 */

import mongoose, { Schema, Document } from 'mongoose';
import { AgentId } from '../types/Agent';
import { ChannelId } from '../types/ChannelContext';

/**
 * Pattern learning configuration constants
 */
export const PATTERN_LEARNING_CONFIG = {
    // Maximum patterns to store per tool to prevent unbounded growth
    MAX_PATTERNS_PER_TOOL: 1000,
    // Minimum frequency threshold for pattern persistence
    MIN_FREQUENCY_THRESHOLD: 2,
    // Pattern confidence score calculation weights
    CONFIDENCE_WEIGHTS: {
        frequency: 0.4,
        recentUsage: 0.3,
        successRate: 0.3
    },
    // Time-based decay factor for pattern relevance (30 days)
    PATTERN_DECAY_DAYS: 30
} as const;

/**
 * Parameter pattern entry schema
 * Stores successful and failed parameter combinations for learning
 */
const ParameterPatternSchema = new Schema({
    // Core identification
    toolName: {
        type: String,
        required: true,
        index: true
    },
    patternHash: {
        type: String,
        required: true,
        index: true,
        // Hash of parameters for fast duplicate detection
    },
    
    // Pattern context
    channelId: {
        type: String,
        required: true,
        index: true
    },
    isShared: {
        type: Boolean,
        default: false,
        index: true
        // Whether this pattern can be shared across agents in the channel
    },
    
    // Pattern data
    parameters: {
        type: Schema.Types.Mixed,
        required: true
        // The actual parameter combination
    },
    
    // Pattern classification
    patternType: {
        type: String,
        enum: ['successful', 'failed'],
        required: true,
        index: true
    },
    errorType: {
        type: String,
        index: true
        // Only present for failed patterns: 'missingRequired', 'typeMismatch', etc.
    },
    errorMessage: {
        type: String
        // Full error message for failed patterns
    },
    
    // Usage statistics
    frequency: {
        type: Number,
        default: 1,
        min: 1
    },
    successCount: {
        type: Number,
        default: 0,
        min: 0
    },
    failureCount: {
        type: Number,
        default: 0,
        min: 0
    },
    
    // Confidence metrics
    confidenceScore: {
        type: Number,
        default: 0.5,
        min: 0,
        max: 1,
        index: true
    },
    
    // Agent tracking
    discoveredBy: {
        type: String,
        required: true,
        index: true
        // AgentId who first discovered this pattern
    },
    usedByAgents: [{
        agentId: String,
        usageCount: {
            type: Number,
            default: 1
        },
        lastUsed: {
            type: Date,
            default: Date.now
        }
    }],
    
    // Temporal data
    firstSeen: {
        type: Date,
        default: Date.now,
        index: true
    },
    lastUsed: {
        type: Date,
        default: Date.now,
        index: true
    },
    lastUpdated: {
        type: Date,
        default: Date.now
    },
    
    // Metadata for analysis
    metadata: {
        // Parameter validation insights
        validationInsights: {
            commonMistakes: [String],
            suggestedFixes: [String],
            relatedPatterns: [String] // References to similar pattern IDs
        },
        
        // Performance metrics
        performance: {
            averageExecutionTime: Number,
            executionTimeVariance: Number
        },
        
        // Context information
        context: {
            systemState: Schema.Types.Mixed,
            environmentInfo: Schema.Types.Mixed
        }
    }
}, {
    timestamps: true,
    // TTL for automatic cleanup of very old, unused patterns (1 year)
    expires: '365d'
});

/**
 * Pattern evolution tracking schema
 * Tracks how patterns change and improve over time
 */
const PatternEvolutionSchema = new Schema({
    // Reference to the base pattern
    basePatternId: {
        type: Schema.Types.ObjectId,
        ref: 'ParameterPattern',
        required: true,
        index: true
    },
    toolName: {
        type: String,
        required: true,
        index: true
    },
    channelId: {
        type: String,
        required: true,
        index: true
    },
    
    // Evolution metadata
    evolutionType: {
        type: String,
        enum: ['improvement', 'adaptation', 'correction', 'optimization'],
        required: true,
        index: true
    },
    
    // Change tracking
    changes: [{
        timestamp: {
            type: Date,
            default: Date.now
        },
        agentId: String,
        changeType: {
            type: String,
            enum: ['parameter_added', 'parameter_removed', 'parameter_modified', 'metadata_updated']
        },
        oldValue: Schema.Types.Mixed,
        newValue: Schema.Types.Mixed,
        reason: String,
        impact: {
            successRateChange: Number,
            confidenceChange: Number,
            usageChange: Number
        }
    }],
    
    // Evolution metrics
    improvementScore: {
        type: Number,
        default: 0,
        min: -1,
        max: 1
        // Positive values indicate improvement, negative indicate degradation
    },
    
    // Versioning
    version: {
        type: Number,
        default: 1,
        min: 1
    },
    
    // Temporal tracking
    evolutionStarted: {
        type: Date,
        default: Date.now
    },
    lastEvolved: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true
});

/**
 * Pattern sharing analytics schema
 * Tracks how patterns are shared and used across agents
 */
const PatternSharingAnalyticsSchema = new Schema({
    channelId: {
        type: String,
        required: true,
        index: true
    },
    patternId: {
        type: Schema.Types.ObjectId,
        ref: 'ParameterPattern',
        required: true,
        index: true
    },
    toolName: {
        type: String,
        required: true,
        index: true
    },
    
    // Sharing metrics
    shareEvents: [{
        timestamp: {
            type: Date,
            default: Date.now
        },
        fromAgent: String,
        toAgent: String,
        shareType: {
            type: String,
            enum: ['automatic', 'recommended', 'manual']
        },
        adoptionSuccess: Boolean,
        adoptionTime: Number, // milliseconds to successful adoption
        feedbackScore: {
            type: Number,
            min: 0,
            max: 5
        }
    }],
    
    // Aggregated analytics
    totalShares: {
        type: Number,
        default: 0
    },
    successfulAdoptions: {
        type: Number,
        default: 0
    },
    adoptionRate: {
        type: Number,
        default: 0,
        min: 0,
        max: 1
    },
    
    // Impact metrics
    impact: {
        errorReductionPercent: Number,
        timesSaved: Number, // total milliseconds saved across all agents
        agentsHelped: Number
    },
    
    // Channel-wide pattern health
    channelMetrics: {
        totalPatterns: Number,
        sharedPatterns: Number,
        patternDiversity: Number, // Shannon diversity index
        collaborationIndex: Number // measure of cross-agent learning
    }
}, {
    timestamps: true
});

// ============================================================================
// COMPOUND INDEXES FOR OPTIMAL QUERY PERFORMANCE
// ============================================================================

// Primary pattern lookup indexes
ParameterPatternSchema.index({ 
    toolName: 1, 
    channelId: 1, 
    patternType: 1 
});

ParameterPatternSchema.index({ 
    toolName: 1, 
    patternHash: 1 
}, { unique: true });

// Pattern sharing and discovery indexes
ParameterPatternSchema.index({ 
    channelId: 1, 
    isShared: 1, 
    confidenceScore: -1 
});

ParameterPatternSchema.index({ 
    discoveredBy: 1, 
    lastUsed: -1 
});

// Time-based queries for pattern cleanup and analysis
ParameterPatternSchema.index({ 
    lastUsed: -1, 
    frequency: -1 
});

// Pattern evolution tracking
PatternEvolutionSchema.index({ 
    basePatternId: 1, 
    version: -1 
});

PatternEvolutionSchema.index({ 
    toolName: 1, 
    channelId: 1, 
    evolutionType: 1 
});

// Analytics queries
PatternSharingAnalyticsSchema.index({ 
    channelId: 1, 
    'shareEvents.timestamp': -1 
});

PatternSharingAnalyticsSchema.index({ 
    patternId: 1, 
    adoptionRate: -1 
});

// ============================================================================
// TYPESCRIPT INTERFACES ALIGNED WITH MONGODB MODELS
// ============================================================================

/**
 * Parameter pattern document interface
 */
export interface IParameterPattern extends Document {
    toolName: string;
    patternHash: string;
    channelId: ChannelId;
    isShared: boolean;
    parameters: Record<string, any>;
    patternType: 'successful' | 'failed';
    errorType?: string;
    errorMessage?: string;
    frequency: number;
    successCount: number;
    failureCount: number;
    confidenceScore: number;
    discoveredBy: AgentId;
    usedByAgents: Array<{
        agentId: AgentId;
        usageCount: number;
        lastUsed: Date;
    }>;
    firstSeen: Date;
    lastUsed: Date;
    lastUpdated: Date;
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
    createdAt: Date;
    updatedAt: Date;
}

/**
 * Pattern evolution document interface
 */
export interface IPatternEvolution extends Document {
    basePatternId: mongoose.Types.ObjectId;
    toolName: string;
    channelId: ChannelId;
    evolutionType: 'improvement' | 'adaptation' | 'correction' | 'optimization';
    changes: Array<{
        timestamp: Date;
        agentId: AgentId;
        changeType: 'parameter_added' | 'parameter_removed' | 'parameter_modified' | 'metadata_updated';
        oldValue: any;
        newValue: any;
        reason: string;
        impact: {
            successRateChange: number;
            confidenceChange: number;
            usageChange: number;
        };
    }>;
    improvementScore: number;
    version: number;
    evolutionStarted: Date;
    lastEvolved: Date;
    createdAt: Date;
    updatedAt: Date;
}

/**
 * Pattern sharing analytics document interface
 */
export interface IPatternSharingAnalytics extends Document {
    channelId: ChannelId;
    patternId: mongoose.Types.ObjectId;
    toolName: string;
    shareEvents: Array<{
        timestamp: Date;
        fromAgent: AgentId;
        toAgent: AgentId;
        shareType: 'automatic' | 'recommended' | 'manual';
        adoptionSuccess: boolean;
        adoptionTime: number;
        feedbackScore: number;
    }>;
    totalShares: number;
    successfulAdoptions: number;
    adoptionRate: number;
    impact: {
        errorReductionPercent: number;
        timesSaved: number;
        agentsHelped: number;
    };
    channelMetrics: {
        totalPatterns: number;
        sharedPatterns: number;
        patternDiversity: number;
        collaborationIndex: number;
    };
    createdAt: Date;
    updatedAt: Date;
}

// ============================================================================
// MONGOOSE MODELS
// ============================================================================

export const ParameterPattern = mongoose.model<IParameterPattern>(
    'ParameterPattern', 
    ParameterPatternSchema
);

export const PatternEvolution = mongoose.model<IPatternEvolution>(
    'PatternEvolution', 
    PatternEvolutionSchema
);

export const PatternSharingAnalytics = mongoose.model<IPatternSharingAnalytics>(
    'PatternSharingAnalytics', 
    PatternSharingAnalyticsSchema
);

// ============================================================================
// UTILITY FUNCTIONS FOR PATTERN OPERATIONS
// ============================================================================

/**
 * Generate a hash for parameter patterns to enable fast duplicate detection
 */
export function generatePatternHash(toolName: string, parameters: Record<string, any>): string {
    const crypto = require('crypto');
    const normalizedParams = JSON.stringify(parameters, Object.keys(parameters).sort());
    return crypto.createHash('sha256')
        .update(`${toolName}:${normalizedParams}`)
        .digest('hex')
        .substring(0, 16); // Use first 16 chars for storage efficiency
}

/**
 * Calculate confidence score based on usage patterns
 */
export function calculateConfidenceScore(
    frequency: number,
    successCount: number,
    failureCount: number,
    daysSinceLastUsed: number
): number {
    const { frequency: freqWeight, recentUsage: recentWeight, successRate: successWeight } = 
        PATTERN_LEARNING_CONFIG.CONFIDENCE_WEIGHTS;
    
    // Normalize frequency (log scale to handle wide ranges)
    const normalizedFrequency = Math.min(1, Math.log10(frequency + 1) / Math.log10(100));
    
    // Calculate success rate
    const totalAttempts = successCount + failureCount;
    const successRate = totalAttempts > 0 ? successCount / totalAttempts : 0.5;
    
    // Calculate recency factor (exponential decay)
    const decayFactor = Math.exp(-daysSinceLastUsed / PATTERN_LEARNING_CONFIG.PATTERN_DECAY_DAYS);
    
    // Weighted combination
    const confidence = (
        normalizedFrequency * freqWeight +
        decayFactor * recentWeight +
        successRate * successWeight
    );
    
    return Math.max(0, Math.min(1, confidence));
}