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
 * Agent Performance Types for Enhanced Agent Intelligence
 * Phase 2: Agent Performance Tracking and Optimization
 */

import { AgentId } from './Agent';
import { ChannelId } from './ChannelContext';

/**
 * ORPAR phase timing metrics
 */
export interface OrparTimingMetrics {
    /** Average time spent in observation phase (ms) */
    averageObservationTime: number;
    
    /** Average time spent in reasoning phase (ms) */
    averageReasoningTime: number;
    
    /** Average time spent in planning phase (ms) */
    averagePlanningTime: number;
    
    /** Average time spent in action phase (ms) */
    averageActionTime: number;
    
    /** Average time spent in reflection phase (ms) */
    averageReflectionTime: number;
    
    /** Total average ORPAR cycle time (ms) */
    averageTotalCycleTime: number;
    
    /** Standard deviations for timing consistency analysis */
    timingConsistency: {
        observationStdDev: number;
        reasoningStdDev: number;
        planningStdDev: number;
        actionStdDev: number;
        reflectionStdDev: number;
    };
    
    /** Fastest and slowest times for optimization insights */
    timingBounds: {
        fastest: {
            observation: number;
            reasoning: number;
            planning: number;
            action: number;
            reflection: number;
            total: number;
        };
        slowest: {
            observation: number;
            reasoning: number;
            planning: number;
            action: number;
            reflection: number;
            total: number;
        };
    };
    
    /** Number of ORPAR cycles recorded */
    cycleCount: number;
    
    /** Last updated timestamp */
    lastUpdated: number;
}

/**
 * Tool usage patterns and effectiveness metrics
 */
export interface ToolUsageMetrics {
    /** Most frequently used tools */
    mostUsedTools: string[];
    
    /** Tool success rates (toolName -> success rate 0.0-1.0) */
    toolSuccessRates: Record<string, number>;
    
    /** Tool execution times (toolName -> average execution time ms) */
    toolExecutionTimes: Record<string, number>;
    
    /** Preferred tool categories */
    preferredToolCategories: string[];
    
    /** Tool usage frequency (toolName -> usage count) */
    toolUsageFrequency: Record<string, number>;
    
    /** Tool error rates (toolName -> error rate 0.0-1.0) */
    toolErrorRates: Record<string, number>;
    
    /** Tools used together (tool combinations) */
    toolCombinations: Array<{
        tools: string[];
        frequency: number;
        successRate: number;
        averageExecutionTime: number;
    }>;
    
    /** Tool efficiency scores (toolName -> efficiency 0.0-1.0) */
    toolEfficiencyScores: Record<string, number>;
    
    /** Tool recommendation scores (toolName -> recommendation score 0.0-1.0) */
    toolRecommendationScores: Record<string, number>;
    
    /** Total tools used */
    totalToolsUsed: number;
    
    /** Unique tools used */
    uniqueToolsUsed: number;
    
    /** Last tool usage timestamp */
    lastToolUsage: number;
}

/**
 * Collaboration metrics within channel context
 */
export interface CollaborationMetrics {
    /** Messages sent in channel */
    messagesSentInChannel: number;
    
    /** Messages received in channel */
    messagesReceivedInChannel: number;
    
    /** Coordination requests made */
    coordinationRequestsMade: number;
    
    /** Coordination requests received */
    coordinationRequestsReceived: number;
    
    /** Successful collaborations */
    successfulCollaborations: number;
    
    /** Failed collaboration attempts */
    failedCollaborations: number;
    
    /** Collaboration success rate (0.0-1.0) */
    collaborationSuccessRate: number;
    
    /** Average response time to coordination requests (ms) */
    averageResponseTime: number;
    
    /** Agents collaborated with most frequently */
    frequentCollaborators: Array<{
        agentId: AgentId;
        collaborationCount: number;
        successRate: number;
        averageResponseTime: number;
    }>;
    
    /** Collaboration patterns */
    collaborationPatterns: Array<{
        pattern: string;
        frequency: number;
        successRate: number;
        participants: AgentId[];
    }>;
    
    /** Communication effectiveness score (0.0-1.0) */
    communicationEffectiveness: number;
    
    /** Leadership activities (times agent initiated coordination) */
    leadershipActivities: number;
    
    /** Support activities (times agent helped others) */
    supportActivities: number;
    
    /** Last collaboration timestamp */
    lastCollaboration: number;
}

/**
 * Comprehensive agent performance metrics
 */
export interface AgentPerformanceMetrics {
    /** Agent identifier */
    agentId: AgentId;
    
    /** Channel identifier - metrics are channel-scoped */
    channelId: ChannelId;
    
    /** ORPAR cycle timing metrics */
    orparTiming: OrparTimingMetrics;
    
    /** Tool usage patterns and effectiveness */
    toolUsage: ToolUsageMetrics;
    
    /** Collaboration effectiveness within channel */
    collaboration: CollaborationMetrics;
    
    /** Overall performance scores */
    overallPerformance: {
        /** Overall efficiency score (0.0-1.0) */
        efficiency: number;
        
        /** Overall effectiveness score (0.0-1.0) */
        effectiveness: number;
        
        /** Learning progression score (0.0-1.0) */
        learningProgression: number;
        
        /** Consistency score (0.0-1.0) */
        consistency: number;
        
        /** Innovation score (0.0-1.0) - trying new approaches */
        innovation: number;
        
        /** Reliability score (0.0-1.0) */
        reliability: number;
    };
    
    /** Performance trends over time */
    trends: {
        /** Performance trend direction */
        direction: 'improving' | 'stable' | 'declining';
        
        /** Trend confidence (0.0-1.0) */
        confidence: number;
        
        /** Areas showing improvement */
        improvingAreas: string[];
        
        /** Areas needing attention */
        concernAreas: string[];
        
        /** Recommended optimizations */
        recommendations: string[];
    };
    
    /** Benchmarking against channel average */
    benchmark: {
        /** Performance relative to channel average */
        relativePerformance: {
            efficiency: number;      // 1.0 = average, >1.0 = above average
            speed: number;
            accuracy: number;
            collaboration: number;
        };
        
        /** Ranking within channel (1 = best) */
        channelRanking: {
            overall: number;
            efficiency: number;
            collaboration: number;
            toolUsage: number;
        };
        
        /** Percentile scores (0-100) */
        percentiles: {
            overall: number;
            efficiency: number;
            speed: number;
            collaboration: number;
        };
    };
    
    /** Metrics collection metadata */
    metadata: {
        /** Number of data points collected */
        dataPoints: number;
        
        /** Date range of collected data */
        dateRange: {
            start: number;
            end: number;
        };
        
        /** Last metrics update */
        lastUpdated: number;
        
        /** Metrics version for schema evolution */
        version: string;
        
        /** Collection confidence (0.0-1.0) */
        confidence: number;
    };
}

/**
 * Performance optimization suggestion
 */
export interface PerformanceOptimizationSuggestion {
    /** Optimization category */
    category: 'timing' | 'tool_usage' | 'collaboration' | 'workflow' | 'general';
    
    /** Optimization priority */
    priority: 'low' | 'medium' | 'high' | 'critical';
    
    /** Suggestion title */
    title: string;
    
    /** Detailed suggestion description */
    description: string;
    
    /** Expected impact */
    expectedImpact: {
        /** Improvement areas */
        areas: string[];
        
        /** Expected percentage improvement */
        estimatedImprovement: number;
        
        /** Confidence in estimate (0.0-1.0) */
        confidence: number;
    };
    
    /** Implementation steps */
    implementationSteps: string[];
    
    /** Tools or patterns to use */
    recommendedTools: string[];
    
    /** Success metrics to track */
    successMetrics: string[];
    
    /** Potential risks */
    risks: string[];
    
    /** Time estimate for implementation */
    timeEstimate: string;
}

/**
 * Agent performance analysis result
 */
export interface AgentPerformanceAnalysis {
    /** Agent being analyzed */
    agentId: AgentId;
    
    /** Channel context */
    channelId: ChannelId;
    
    /** Analysis timestamp */
    analysisTimestamp: number;
    
    /** Performance summary */
    summary: {
        /** Overall assessment */
        overall: 'excellent' | 'good' | 'average' | 'needs_improvement' | 'poor';
        
        /** Strength areas */
        strengths: string[];
        
        /** Improvement areas */
        weaknesses: string[];
        
        /** Key insights */
        insights: string[];
    };
    
    /** Optimization suggestions */
    optimizations: PerformanceOptimizationSuggestion[];
    
    /** Comparison with previous analysis */
    progressSinceLastAnalysis: {
        /** Time since last analysis */
        timeSinceLastAnalysis: number;
        
        /** Changes in key metrics */
        metricChanges: Record<string, number>;
        
        /** Progress assessment */
        progressAssessment: 'significant_improvement' | 'improvement' | 'stable' | 'decline' | 'significant_decline';
        
        /** Completed recommendations from last analysis */
        completedRecommendations: string[];
    };
    
    /** Analysis confidence (0.0-1.0) */
    confidence: number;
    
    /** Analysis metadata */
    metadata: {
        /** Analysis method used */
        analysisMethod: string;
        
        /** Data quality assessment */
        dataQuality: 'excellent' | 'good' | 'fair' | 'poor';
        
        /** Sample size */
        sampleSize: number;
        
        /** Analysis duration */
        analysisDuration: number;
    };
}
