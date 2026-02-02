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
 * Task Management Types for the MXF Framework
 * 
 * Defines interfaces and types for task creation, assignment, and management
 * across channels with intelligent agent assignment using SystemLlmService
 */

import { AgentId } from './Agent';
import { ChannelId } from './ChannelContext';

/**
 * Task priority levels
 */
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';

/**
 * Task status states
 */
export type TaskStatus = 'pending' | 'assigned' | 'in_progress' | 'completed' | 'failed' | 'cancelled';

/**
 * Task creation source
 */
export type TaskCreatedBy = 'human' | 'system' | AgentId;

/**
 * Agent assignment strategy types
 */
export type AssignmentStrategy = 'role_based' | 'workload_balanced' | 'expertise_driven' | 'manual' | 'intelligent' | 'none';

/**
 * Core Channel Task interface
 */
export interface ChannelTask {
    id: string;
    channelId: ChannelId;
    title: string;
    description: string;
    priority: TaskPriority;
    
    // Assignment and routing
    requiredRoles?: string[];           // e.g., ["accountant", "auditor"]
    requiredCapabilities?: string[];   // e.g., ["financial_analysis", "report_generation"]
    
    // Enhanced assignment options
    assignedAgentId?: AgentId;          // Legacy single agent assignment (deprecated)
    assignedAgentIds?: AgentId[];       // Multi-agent assignment support
    assignmentScope: 'single' | 'multiple' | 'channel-wide';
    assignmentDistribution?: 'parallel' | 'sequential' | 'collaborative';
    
    // Channel-wide task options
    channelWideTask?: boolean;          // Broadcast to all agents in channel
    targetAgentRoles?: string[];        // Target specific roles in channel
    excludeAgentIds?: AgentId[];       // Exclude specific agents from assignment
    maxParticipants?: number;          // Limit concurrent participants
    
    // Task coordination
    coordinationMode?: 'independent' | 'collaborative' | 'sequential' | 'hierarchical';
    leadAgentId?: AgentId;             // Primary coordinator for collaborative tasks
    
    // Agent selection criteria
    agentSelectionCriteria?: {
        minimumCapabilityMatch?: number;    // 0-1 threshold for capability matching
        excludeBusyAgents?: boolean;
        preferIdleAgents?: boolean;
        requireAllCapabilities?: boolean;   // vs. any matching capabilities
    };
    
    // Status tracking
    status: TaskStatus;
    progress?: number;                  // 0-100 percentage
    
    // Timing
    createdAt: number;
    updatedAt: number;
    dueDate?: number;
    estimatedDuration?: number;         // in minutes
    actualDuration?: number;            // in minutes when completed
    
    // Creation and ownership
    createdBy: TaskCreatedBy;
    
    // Task context and metadata
    metadata?: Record<string, any>;
    tags?: string[];
    
    // Dependencies and relationships
    dependsOn?: string[];               // Task IDs this task depends on
    blockedBy?: string[];               // Task IDs that block this task
    
    // Results and outcomes
    result?: {
        success?: boolean;
        output?: any;
        error?: string;
        completedAt?: number;
        completedBy?: string;
    };
    
    assignmentStrategy: AssignmentStrategy;
}

/**
 * Task creation request
 */
export interface CreateTaskRequest {
    channelId: ChannelId;
    title: string;
    description: string;
    priority?: TaskPriority;
    requiredRoles?: string[];
    requiredCapabilities?: string[];
    assignmentStrategy?: AssignmentStrategy;
    
    // Enhanced assignment options
    assignedAgentId?: AgentId;          // Legacy single agent assignment (deprecated)
    assignedAgentIds?: AgentId[];       // Multi-agent assignment support
    assignmentScope?: 'single' | 'multiple' | 'channel-wide';
    assignmentDistribution?: 'parallel' | 'sequential' | 'collaborative';
    
    // Channel-wide task options
    channelWideTask?: boolean;          // Broadcast to all agents in channel
    targetAgentRoles?: string[];        // Target specific roles in channel
    excludeAgentIds?: AgentId[];       // Exclude specific agents from assignment
    maxParticipants?: number;          // Limit concurrent participants
    
    // Task coordination
    coordinationMode?: 'independent' | 'collaborative' | 'sequential' | 'hierarchical';
    leadAgentId?: AgentId;             // Primary coordinator for collaborative tasks
    
    // Agent selection criteria
    agentSelectionCriteria?: {
        minimumCapabilityMatch?: number;    // 0-1 threshold for capability matching
        excludeBusyAgents?: boolean;
        preferIdleAgents?: boolean;
        requireAllCapabilities?: boolean;   // vs. any matching capabilities
    };
    
    dueDate?: number;
    estimatedDuration?: number;
    metadata?: Record<string, any>;
    tags?: string[];
    dependsOn?: string[];
}

/**
 * Task update request
 */
export interface UpdateTaskRequest {
    status?: TaskStatus;
    progress?: number;
    assignedAgentId?: AgentId;
    priority?: TaskPriority;
    dueDate?: number;
    metadata?: Record<string, any>;
    tags?: string[];
}

/**
 * Agent assignment analysis from SystemLLM
 */
export interface AgentAssignmentAnalysis {
    recommendedAgentId: AgentId;
    confidence: number;                 // 0-1 confidence score
    reasoning: string;
    
    // Agent suitability factors
    roleMatch: number;                  // 0-1 how well role matches requirements
    capabilityMatch: number;            // 0-1 how well capabilities match
    workloadScore: number;              // 0-1 workload balance (1 = not overloaded)
    expertiseScore: number;             // 0-1 expertise level for this task type
    availabilityScore: number;          // 0-1 agent availability
    
    // Alternative suggestions
    alternatives?: Array<{
        agentId: AgentId;
        confidence: number;
        reasoning: string;
    }>;
}

/**
 * Channel workload analysis
 */
export interface ChannelWorkloadAnalysis {
    channelId: ChannelId;
    totalTasks: number;
    pendingTasks: number;
    activeTasks: number;
    completedTasks: number;
    failedTasks: number;
    
    // Agent workload distribution
    agentWorkloads: Array<{
        agentId: AgentId;
        activeTasks: number;
        pendingTasks: number;
        completionRate: number;
        averageTaskDuration: number;
        isOverloaded: boolean;
    }>;
    
    // Performance metrics
    averageCompletionTime: number;
    taskThroughput: number;             // tasks completed per hour
    
    // Analysis metadata
    analysisTimestamp: number;
    confidence: number;
}

/**
 * Task assignment result
 */
export interface TaskAssignmentResult {
    taskId: string;
    assignedAgentId: AgentId;
    strategy: AssignmentStrategy;
    confidence: number;
    reasoning: string;
    assignedAt: number;
    estimatedCompletion?: number;
}

/**
 * Task query filters
 */
export interface TaskQueryFilters {
    channelId?: ChannelId;
    status?: TaskStatus | TaskStatus[];
    priority?: TaskPriority | TaskPriority[];
    assignedAgentId?: AgentId;
    createdBy?: TaskCreatedBy;
    tags?: string[];
    dueBefore?: number;
    dueAfter?: number;
    createdBefore?: number;
    createdAfter?: number;
}

/**
 * Task orchestration configuration
 */
export interface TaskOrchestrationConfig {
    // Assignment behavior
    enableIntelligentAssignment: boolean;
    enableWorkloadBalancing: boolean;
    enableExpertiseMatching: boolean;
    
    // Performance thresholds
    maxTasksPerAgent: number;
    agentOverloadThreshold: number;     // Factor for determining overload
    taskTimeoutMinutes: number;
    
    // SystemLLM integration
    enableLlmAssignment: boolean;
    llmConfidenceThreshold: number;     // Minimum confidence for LLM assignments
    fallbackStrategy: AssignmentStrategy;
    
    // Coordination behavior
    enableTaskDependencies: boolean;
    enableLateJoinHandling: boolean;
    preventSimultaneousStart: boolean;
}

/**
 * Task event types for EventBus integration
 */
export type TaskEventType = 
    | 'task_created'
    | 'task_assigned'
    | 'task_started'
    | 'task_progress_updated'
    | 'task_completed'
    | 'task_failed'
    | 'task_cancelled'
    | 'task_reassigned'
    | 'agent_overloaded'
    | 'channel_workload_analyzed';

/**
 * Task event data
 */
export interface TaskEventData {
    task: ChannelTask;
    previousStatus?: TaskStatus;
    assignmentAnalysis?: AgentAssignmentAnalysis;
    workloadAnalysis?: ChannelWorkloadAnalysis;
    trigger: 'manual' | 'automatic' | 'system';
    timestamp: number;
}
