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
 * Task Completion Types
 * 
 * Defines types for intelligent task completion monitoring
 * that leverages existing planning tools and memory infrastructure
 */

export type CompletionStrategyType = 
    | 'plan-based'        // Complete when plan steps are done
    | 'systemllm-eval'    // SystemLLM evaluates if complete
    | 'output-based'      // Complete when outputs exist
    | 'time-based'        // Complete after duration
    | 'event-based'       // Complete on specific events
    | 'consensus'         // Multi-agent agreement
    | 'custom'            // Custom evaluation function

export interface PlanBasedCompletion {
    type: 'plan-based';
    planId: string;                    // ID of the plan in channel memory
    completionType: 'all_steps' | 'critical_steps' | 'percentage';
    percentage?: number;               // For percentage type
}

export interface SystemLLMEvalCompletion {
    type: 'systemllm-eval';
    objectives: string[];              // What needs to be achieved
    evaluationInterval: number;        // How often to check (ms)
    confidenceThreshold: number;       // 0-1, required confidence
}

export interface OutputBasedCompletion {
    type: 'output-based';
    requiredOutputs: {
        type: 'file' | 'message' | 'tool_call' | 'memory_entry';
        pattern?: string;              // Regex pattern to match
        count?: number;                // Required count
    }[];
}

export interface TimeBasedCompletion {
    type: 'time-based';
    minimumDuration?: number;          // Must run at least this long
    maximumDuration: number;           // Complete after this time
    requireActivity?: boolean;         // Must have some activity
}

export interface EventBasedCompletion {
    type: 'event-based';
    eventName: string;                 // Event that triggers completion
    eventData?: Record<string, any>;   // Optional data to match
}

export interface ConsensusCompletion {
    type: 'consensus';
    requiredAgents?: string[];         // Specific agents or all
    threshold: number | 'majority' | 'all';
}

export interface CustomCompletion {
    type: 'custom';
    evaluatorFunction: string;         // Name of custom evaluator
    parameters?: Record<string, any>;
}

export type TaskCompletionCriteria = 
    | PlanBasedCompletion
    | SystemLLMEvalCompletion
    | OutputBasedCompletion
    | TimeBasedCompletion
    | EventBasedCompletion
    | ConsensusCompletion
    | CustomCompletion;

export interface TaskCompletionConfig {
    // Enable/disable automatic completion monitoring
    enabled?: boolean; // Default: true
    
    // Primary completion strategy
    primary: TaskCompletionCriteria;
    
    // Fallback strategies if primary doesn't complete
    fallbacks?: TaskCompletionCriteria[];
    
    // Global timeout (applies to all strategies)
    absoluteTimeout?: number;
    timeoutBehavior?: 'complete' | 'fail' | 'alert';
    
    // Whether agents can still manually complete
    allowManualCompletion?: boolean;
}

export interface TaskMonitoringState {
    taskId: string;
    startTime: number;
    lastActivityTime: number;
    activityCount: number;
    
    // Evidence of progress
    evidence: {
        messages: Array<{
            agentId: string;
            content: string;
            timestamp: number;
        }>;
        toolCalls: Array<{
            agentId: string;
            toolName: string;
            result: any;
            timestamp: number;
        }>;
        planProgress?: {
            completedSteps: string[];
            totalSteps: number;
            criticalStepsCompleted: number;
        };
    };
    
    // Completion evaluation results
    evaluations: Array<{
        timestamp: number;
        strategy: CompletionStrategyType;
        result: boolean;
        confidence?: number;
        reason?: string;
    }>;
    
    // Agent contributions
    agentActivity: Map<string, {
        messageCount: number;
        toolCallCount: number;
        lastActive: number;
    }>;
}

export interface TaskCompletionEvent {
    taskId: string;
    completedBy: 'system' | string; // 'system' or agentId
    completionStrategy: CompletionStrategyType;
    evidence: TaskMonitoringState['evidence'];
    confidence: number;
    reason: string;
    duration: number;
}