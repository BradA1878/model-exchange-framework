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
 * Pattern Memory Types for Enhanced Memory Architecture
 * Phase 2: Pattern Recognition and Workflow Optimization
 */

import { AgentId } from './Agent';
import { ChannelId } from './ChannelContext';

/**
 * Extended memory layers for pattern recognition
 */
export enum MemoryLayer {
    CHANNEL = 'channel',           // Existing: shared context for all agents
    AGENT = 'agent',              // Existing: personal context per agent
    PATTERN = 'pattern',          // New: successful interaction patterns within channel
    WORKFLOW = 'workflow',        // New: reusable ORPAR sequences within channel
}

/**
 * Types of patterns that can be recognized and stored
 */
export type PatternType = 'orapr_sequence' | 'tool_chain' | 'collaboration_flow' | 'error_recovery';

/**
 * Pattern memory entry for successful workflows within channels
 */
export interface PatternMemoryEntry {
    /** Unique pattern identifier */
    patternId: string;
    
    /** Channel where pattern was observed - patterns are channel-scoped */
    channelId: ChannelId;
    
    /** Type of pattern observed */
    type: PatternType;
    
    /** The actual pattern data */
    pattern: {
        /** Sequence of steps/actions in the pattern */
        sequence: string[];
        
        /** Conditions under which pattern was successful */
        conditions: Record<string, any>;
        
        /** Outcomes achieved by following this pattern */
        outcomes: Record<string, any>;
        
        /** Tools used in this pattern */
        toolsUsed: string[];
        
        /** Duration of pattern execution in milliseconds */
        executionTime: number;
        
        /** Pattern complexity score (1-10) */
        complexity: number;
    };
    
    /** How effective this pattern has been (0.0-1.0) */
    effectiveness: number;
    
    /** Number of times this pattern has been used */
    usageCount: number;
    
    /** Number of times pattern was successful */
    successCount: number;
    
    /** Last time this pattern was used */
    lastUsed: number;
    
    /** When this pattern was first discovered */
    firstDiscovered: number;
    
    /** Agents who have participated in this pattern */
    agentParticipants: AgentId[];
    
    /** Similar patterns (by ID) for cross-referencing */
    similarPatterns: string[];
    
    /** Tags for pattern categorization */
    tags: string[];
    
    /** Pattern metadata for analysis */
    metadata: {
        /** Channel context when pattern was successful */
        channelContext: string;
        
        /** System state during successful executions */
        systemState: Record<string, any>;
        
        /** Performance metrics for this pattern */
        performanceMetrics: {
            averageExecutionTime: number;
            minExecutionTime: number;
            maxExecutionTime: number;
            standardDeviation: number;
        };
        
        /** Confidence score for pattern recommendations (0.0-1.0) */
        confidence: number;
    };
}

/**
 * Workflow memory entry for reusable ORPAR sequences
 */
export interface WorkflowMemoryEntry {
    /** Unique workflow identifier */
    workflowId: string;
    
    /** Channel where workflow was created */
    channelId: ChannelId;
    
    /** Human-readable workflow name */
    name: string;
    
    /** Workflow description */
    description: string;
    
    /** ORPAR sequence definition */
    oraprSequence: {
        /** Observation patterns */
        observation: {
            expectedInputs: string[];
            dataCollection: string[];
            contextRequirements: string[];
        };
        
        /** Reasoning patterns */
        reasoning: {
            analysisSteps: string[];
            decisionCriteria: string[];
            logicChain: string[];
        };
        
        /** Action patterns */
        action: {
            executionSteps: string[];
            toolsRequired: string[];
            dependencies: string[];
        };
        
        /** Planning patterns */
        planning: {
            planningSteps: string[];
            resourceRequirements: string[];
            timeEstimates: Record<string, number>;
        };
        
        /** Reflection patterns */
        reflection: {
            successCriteria: string[];
            evaluationMetrics: string[];
            improvementAreas: string[];
        };
    };
    
    /** Workflow success metrics */
    metrics: {
        /** Total executions of this workflow */
        totalExecutions: number;
        
        /** Successful executions */
        successfulExecutions: number;
        
        /** Success rate (0.0-1.0) */
        successRate: number;
        
        /** Average execution time per ORPAR phase */
        averagePhaseTimings: {
            observation: number;
            reasoning: number;
            action: number;
            planning: number;
            reflection: number;
        };
        
        /** Workflow efficiency score (0.0-1.0) */
        efficiency: number;
    };
    
    /** Agents who have used this workflow */
    usedByAgents: AgentId[];
    
    /** Last time workflow was executed */
    lastExecuted: number;
    
    /** When workflow was created */
    created: number;
    
    /** Workflow version for iterative improvements */
    version: number;
    
    /** Tags for workflow categorization */
    tags: string[];
}

/**
 * Pattern analysis result from SystemLlmService
 */
export interface PatternAnalysisResult {
    /** Whether a pattern was detected */
    patternDetected: boolean;
    
    /** Type of pattern if detected */
    patternType?: PatternType;
    
    /** Pattern description */
    description: string;
    
    /** Analysis confidence (0.0-1.0) */
    confidence: number;
    
    /** Recommended actions based on pattern */
    recommendations: string[];
    
    /** Pattern metadata */
    metadata: {
        /** Complexity assessment */
        complexity: number;
        
        /** Potential for reuse */
        reuseability: number;
        
        /** Performance impact */
        performanceImpact: 'positive' | 'neutral' | 'negative';
        
        /** Tools involved in pattern */
        toolsInvolved: string[];
        
        /** Estimated effectiveness */
        estimatedEffectiveness: number;
    };
}

/**
 * Pattern search criteria for finding similar patterns
 */
export interface PatternSearchCriteria {
    /** Channel to search within */
    channelId: ChannelId;
    
    /** Pattern type filter */
    patternType?: PatternType;
    
    /** Minimum effectiveness threshold */
    minEffectiveness?: number;
    
    /** Minimum usage count */
    minUsageCount?: number;
    
    /** Tags to match */
    tags?: string[];
    
    /** Tools that must be involved */
    toolsUsed?: string[];
    
    /** Agents that must have participated */
    agentParticipants?: AgentId[];
    
    /** Time range for pattern discovery */
    timeRange?: {
        start: number;
        end: number;
    };
    
    /** Similarity threshold for pattern matching */
    similarityThreshold?: number;
}

/**
 * Pattern recommendation for agents
 */
export interface PatternRecommendation {
    /** Pattern being recommended */
    pattern: PatternMemoryEntry;
    
    /** Relevance score (0.0-1.0) */
    relevance: number;
    
    /** Reason for recommendation */
    reason: string;
    
    /** Expected benefits */
    expectedBenefits: string[];
    
    /** Adaptation suggestions for current context */
    adaptationSuggestions: string[];
    
    /** Risk assessment */
    risks: string[];
    
    /** Confidence in recommendation (0.0-1.0) */
    confidence: number;
}
