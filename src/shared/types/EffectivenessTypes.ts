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
 * Universal Effectiveness Types for MXF
 * 
 * Task-agnostic effectiveness measurement system that adapts to any agent use case
 */

import { AgentId } from './Agent';
import { ChannelId } from './ChannelContext';

/**
 * Core effectiveness metrics applicable to any task
 */
export interface TaskEffectivenessMetrics {
    /** Unique identifier for this task */
    taskId: string;
    
    /** Task metadata */
    metadata: {
        type: string; // User-defined task type
        description: string;
        startTime: number;
        endTime?: number;
        status: 'in_progress' | 'completed' | 'failed' | 'cancelled';
    };
    
    /** Core performance metrics */
    performance: {
        /** Time from start to completion in ms */
        completionTime?: number;
        
        /** Number of discrete steps/actions taken */
        stepCount: number;
        
        /** Number of tools used */
        toolsUsed: number;
        
        /** Unique tools used */
        uniqueTools: string[];
        
        /** Number of agent interactions */
        agentInteractions: number;
        
        /** Number of human interventions required */
        humanInterventions: number;
        
        /** Percentage completed without human help (0-1) */
        autonomyScore: number;
    };
    
    /** Quality metrics (task-specific) */
    quality: {
        /** Was the primary goal achieved? */
        goalAchieved: boolean;
        
        /** Partial success score (0-1) */
        completenessScore: number;
        
        /** Number of iterations/revisions needed */
        iterationCount: number;
        
        /** Errors encountered */
        errorCount: number;
        
        /** Custom quality indicators */
        customMetrics: Record<string, number>;
    };
    
    /** Resource utilization */
    resources: {
        /** Total compute time across all agents (ms) */
        totalComputeTime: number;
        
        /** Peak concurrent agents */
        peakConcurrentAgents: number;
        
        /** Total LLM tokens used (if tracked) */
        totalTokens?: number;
        
        /** Memory snapshots created */
        memoryOperations: number;
    };
    
    /** Collaboration effectiveness */
    collaboration: {
        /** Agents involved */
        participatingAgents: AgentId[];
        
        /** Messages exchanged */
        messageCount: number;
        
        /** Coordination requests */
        coordinationCount: number;
        
        /** Knowledge shared between agents */
        knowledgeTransfers: number;
        
        /** Collaboration efficiency (0-1) */
        collaborationScore: number;
    };
}

/**
 * Task definition for effectiveness tracking
 */
export interface TaskDefinition {
    /** Unique task identifier */
    taskId: string;
    
    /** Channel where task is executed */
    channelId: ChannelId;
    
    /** Task type (user-defined: 'research', 'analysis', 'development', etc.) */
    taskType: string;
    
    /** Human-readable description */
    description: string;
    
    /** Success criteria (optional) */
    successCriteria?: {
        /** Required outcomes */
        required: string[];
        
        /** Optional/bonus outcomes */
        optional?: string[];
        
        /** Measurable targets */
        targets?: Record<string, number>;
    };
    
    /** Baseline for comparison (optional) */
    baseline?: {
        /** Baseline type */
        type: 'human' | 'previous_run' | 'traditional_method' | 'custom';
        
        /** Baseline metrics for comparison */
        metrics: Partial<TaskEffectivenessMetrics>;
        
        /** Additional context */
        context?: string;
    };
}

/**
 * Effectiveness comparison result
 */
export interface EffectivenessComparison {
    /** Current task metrics */
    current: TaskEffectivenessMetrics;
    
    /** Baseline metrics (if available) */
    baseline?: Partial<TaskEffectivenessMetrics>;
    
    /** Calculated improvements */
    improvements: {
        /** Speed improvement (negative = slower) */
        speedImprovement: number; // percentage
        
        /** Autonomy improvement */
        autonomyImprovement: number; // percentage
        
        /** Quality improvement */
        qualityImprovement: number; // percentage
        
        /** Resource efficiency */
        resourceEfficiency: number; // percentage
    };
    
    /** Summary assessment */
    summary: {
        /** Overall effectiveness score (0-1) */
        overallScore: number;
        
        /** Key achievements */
        achievements: string[];
        
        /** Areas for improvement */
        improvements: string[];
        
        /** Recommended optimizations */
        recommendations: string[];
    };
}

/**
 * Aggregated effectiveness analytics
 */
export interface EffectivenessAnalytics {
    /** Time period for analytics */
    period: {
        start: number;
        end: number;
    };
    
    /** Task type breakdown */
    byTaskType: Record<string, {
        count: number;
        avgCompletionTime: number;
        successRate: number;
        avgAutonomyScore: number;
        commonTools: string[];
    }>;
    
    /** Channel effectiveness */
    byChannel: Record<ChannelId, {
        totalTasks: number;
        completedTasks: number;
        avgEffectivenessScore: number;
        topPerformingAgents: AgentId[];
    }>;
    
    /** Trend analysis */
    trends: {
        /** Effectiveness over time */
        effectivenessOverTime: Array<{
            timestamp: number;
            avgScore: number;
            taskCount: number;
        }>;
        
        /** Improving metrics */
        improving: string[];
        
        /** Declining metrics */
        declining: string[];
    };
    
    /** Notable patterns */
    patterns: {
        /** Most effective task types */
        highPerformanceTasks: string[];
        
        /** Tasks needing optimization */
        lowPerformanceTasks: string[];
        
        /** Best agent combinations */
        effectiveTeams: Array<{
            agents: AgentId[];
            taskTypes: string[];
            avgScore: number;
        }>;
    };
}

/**
 * Task execution event for tracking
 */
export interface TaskExecutionEvent {
    eventId: string;
    taskId: string;
    timestamp: number;
    type: 'start' | 'step' | 'tool_use' | 'agent_join' | 'human_input' | 'error' | 'complete';
    agentId?: AgentId;
    details: Record<string, any>;
}

/**
 * Effectiveness tracking configuration
 */
export interface EffectivenessConfig {
    /** Enable automatic tracking */
    autoTrack: boolean;
    
    /** Metrics to track */
    trackingOptions: {
        performance: boolean;
        quality: boolean;
        resources: boolean;
        collaboration: boolean;
    };
    
    /** Custom metric definitions */
    customMetrics?: Array<{
        name: string;
        description: string;
        calculator: (task: TaskEffectivenessMetrics) => number;
    }>;
    
    /** Baseline comparison settings */
    baselineComparison: {
        enabled: boolean;
        defaultBaselineType?: 'human' | 'previous_run' | 'traditional_method';
    };
}