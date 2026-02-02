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
 * Task DAG Types
 *
 * Defines interfaces and types for the Task Directed Acyclic Graph (DAG) system.
 * The DAG enforces task dependencies with cycle detection and execution ordering.
 *
 * Key concepts:
 * - TaskDag: The complete graph structure for a channel
 * - TaskDagNode: Individual task nodes with dependency information
 * - TaskDagEdge: Directed edges representing dependencies
 * - TopologicalResult: Result of topological sort operations
 */

import { TaskStatus } from './TaskTypes';
import { ChannelId } from './ChannelContext';

/**
 * A node in the Task DAG representing a single task
 */
export interface TaskDagNode {
    /** The task ID (matches ChannelTask.id) */
    taskId: string;

    /** Current status of the task */
    status: TaskStatus;

    /** Task IDs that this task depends on (incoming edges) */
    dependsOn: string[];

    /** Task IDs that depend on this task (outgoing edges) */
    blockedBy: string[];

    /** Computed in-degree for topological sorting */
    inDegree: number;

    /** Computed out-degree for graph analysis */
    outDegree: number;

    /** Whether this task is currently ready to execute (all dependencies satisfied) */
    isReady: boolean;

    /** Timestamp when the node was added to the DAG */
    addedAt: number;

    /** Timestamp when the node was last updated */
    updatedAt: number;
}

/**
 * A directed edge in the Task DAG representing a dependency relationship
 */
export interface TaskDagEdge {
    /** Unique identifier for the edge */
    id: string;

    /** The task that must complete first (source/dependency) */
    fromTaskId: string;

    /** The task that depends on the source (target/dependent) */
    toTaskId: string;

    /** Optional label describing the dependency type */
    label?: string;

    /** Timestamp when the edge was created */
    createdAt: number;
}

/**
 * The complete Task DAG structure for a channel
 */
export interface TaskDag {
    /** The channel this DAG belongs to */
    channelId: ChannelId;

    /** Map of task IDs to their DAG nodes */
    nodes: Map<string, TaskDagNode>;

    /** Map of edge IDs to their definitions */
    edges: Map<string, TaskDagEdge>;

    /** Adjacency list for efficient traversal (taskId -> dependent taskIds) */
    adjacencyList: Map<string, Set<string>>;

    /** Reverse adjacency list (taskId -> dependency taskIds) */
    reverseAdjacencyList: Map<string, Set<string>>;

    /** Timestamp when the DAG was created */
    createdAt: number;

    /** Timestamp when the DAG was last modified */
    updatedAt: number;

    /** Version number for optimistic concurrency */
    version: number;
}

/**
 * Result of a topological sort operation
 */
export interface TopologicalResult {
    /** Whether the sort was successful (no cycles detected) */
    success: boolean;

    /** Topologically sorted list of task IDs */
    order: string[];

    /** Tasks that are currently ready to execute */
    readyTasks: string[];

    /** Tasks that are blocked by incomplete dependencies */
    blockedTasks: string[];

    /** Tasks that have been completed */
    completedTasks: string[];

    /** Execution levels (tasks at same level can run in parallel) */
    levels: string[][];

    /** Critical path (longest dependency chain) */
    criticalPath: string[];

    /** Error message if sort failed */
    error?: string;
}

/**
 * Result of cycle detection
 */
export interface CycleDetectionResult {
    /** Whether a cycle was detected */
    hasCycle: boolean;

    /** The cycle path if found (list of task IDs forming the cycle) */
    cyclePath?: string[];

    /** Human-readable description of the cycle */
    cycleDescription?: string;
}

/**
 * Result of DAG validation
 */
export interface DagValidationResult {
    /** Whether the DAG is valid */
    isValid: boolean;

    /** List of validation errors */
    errors: DagValidationError[];

    /** List of validation warnings */
    warnings: DagValidationWarning[];

    /** Statistics about the DAG */
    stats: DagStats;
}

/**
 * A validation error in the DAG
 */
export interface DagValidationError {
    /** Error code */
    code: DagErrorCode;

    /** Human-readable error message */
    message: string;

    /** Related task IDs */
    taskIds?: string[];

    /** Related edge IDs */
    edgeIds?: string[];
}

/**
 * A validation warning in the DAG
 */
export interface DagValidationWarning {
    /** Warning code */
    code: DagWarningCode;

    /** Human-readable warning message */
    message: string;

    /** Related task IDs */
    taskIds?: string[];
}

/**
 * Statistics about a DAG
 */
export interface DagStats {
    /** Total number of nodes */
    nodeCount: number;

    /** Total number of edges */
    edgeCount: number;

    /** Number of root nodes (no dependencies) */
    rootCount: number;

    /** Number of leaf nodes (no dependents) */
    leafCount: number;

    /** Maximum depth of the DAG */
    maxDepth: number;

    /** Average in-degree */
    averageInDegree: number;

    /** Average out-degree */
    averageOutDegree: number;

    /** Number of ready tasks */
    readyTaskCount: number;

    /** Number of blocked tasks */
    blockedTaskCount: number;

    /** Number of completed tasks */
    completedTaskCount: number;
}

/**
 * Error codes for DAG validation
 */
export enum DagErrorCode {
    /** A cycle was detected in the graph */
    CYCLE_DETECTED = 'CYCLE_DETECTED',

    /** An edge references a non-existent task */
    MISSING_NODE = 'MISSING_NODE',

    /** Duplicate edge detected */
    DUPLICATE_EDGE = 'DUPLICATE_EDGE',

    /** Self-referential dependency */
    SELF_DEPENDENCY = 'SELF_DEPENDENCY',

    /** Invalid task status transition based on dependencies */
    INVALID_STATUS_TRANSITION = 'INVALID_STATUS_TRANSITION',
}

/**
 * Warning codes for DAG validation
 */
export enum DagWarningCode {
    /** Task has an unusually high number of dependencies */
    HIGH_IN_DEGREE = 'HIGH_IN_DEGREE',

    /** Task has an unusually high number of dependents */
    HIGH_OUT_DEGREE = 'HIGH_OUT_DEGREE',

    /** Long dependency chain detected */
    LONG_CHAIN = 'LONG_CHAIN',

    /** Orphaned node (no edges) */
    ORPHANED_NODE = 'ORPHANED_NODE',
}

/**
 * Configuration for the Task DAG system
 */
export interface DagConfig {
    /** Whether the DAG system is enabled */
    enabled: boolean;

    /** Cache TTL in milliseconds */
    cacheTtlMs: number;

    /** Timeout for cycle detection operations in milliseconds */
    cycleCheckTimeoutMs: number;

    /** Whether to enforce DAG validation on task status changes */
    enforceOnStatusChange: boolean;

    /** Maximum allowed in-degree before warning */
    maxInDegreeWarning: number;

    /** Maximum allowed out-degree before warning */
    maxOutDegreeWarning: number;

    /** Maximum allowed chain length before warning */
    maxChainLengthWarning: number;

    /** Whether to emit events for DAG changes */
    emitEvents: boolean;

    /** Whether to log debug information */
    debug: boolean;

    /** Maximum allowed limit for ready tasks queries (hard cap) */
    maxReadyTasksLimit: number;

    /** Default limit for ready tasks queries when not specified */
    defaultReadyTasksLimit: number;
}

/**
 * Default DAG configuration values
 */
export const DEFAULT_DAG_CONFIG: DagConfig = {
    enabled: false,
    cacheTtlMs: 60000, // 1 minute
    cycleCheckTimeoutMs: 50, // 50ms for performance
    enforceOnStatusChange: true,
    maxInDegreeWarning: 10,
    maxOutDegreeWarning: 10,
    maxChainLengthWarning: 20,
    emitEvents: true,
    debug: false,
    maxReadyTasksLimit: 100,
    defaultReadyTasksLimit: 10,
};

/**
 * Environment variable names for DAG configuration
 */
export const DAG_ENV_VARS = {
    ENABLED: 'TASK_DAG_ENABLED',
    CACHE_TTL_MS: 'DAG_CACHE_TTL_MS',
    CYCLE_CHECK_TIMEOUT_MS: 'DAG_CYCLE_CHECK_TIMEOUT_MS',
    ENFORCE_ON_STATUS_CHANGE: 'DAG_ENFORCE_ON_STATUS_CHANGE',
    MAX_IN_DEGREE_WARNING: 'DAG_MAX_IN_DEGREE_WARNING',
    MAX_OUT_DEGREE_WARNING: 'DAG_MAX_OUT_DEGREE_WARNING',
    MAX_CHAIN_LENGTH_WARNING: 'DAG_MAX_CHAIN_LENGTH_WARNING',
    EMIT_EVENTS: 'DAG_EMIT_EVENTS',
    DEBUG: 'DAG_DEBUG',
    MAX_READY_TASKS_LIMIT: 'DAG_MAX_READY_TASKS_LIMIT',
    DEFAULT_READY_TASKS_LIMIT: 'DAG_DEFAULT_READY_TASKS_LIMIT',
} as const;

/**
 * Request to add a dependency between tasks
 */
export interface AddDependencyRequest {
    /** The task that will depend on another */
    dependentTaskId: string;

    /** The task that must complete first */
    dependencyTaskId: string;

    /** Optional label for the dependency */
    label?: string;
}

/**
 * Request to remove a dependency between tasks
 */
export interface RemoveDependencyRequest {
    /** The task that depends on another */
    dependentTaskId: string;

    /** The task that is a dependency */
    dependencyTaskId: string;
}

/**
 * Result of adding a dependency
 */
export interface AddDependencyResult {
    /** Whether the operation succeeded */
    success: boolean;

    /** The created edge, if successful */
    edge?: TaskDagEdge;

    /** Error message if failed */
    error?: string;

    /** Error code if failed */
    errorCode?: DagErrorCode;

    /** Cycle path if a cycle would be created */
    cyclePath?: string[];
}

/**
 * Options for getting ready tasks
 */
export interface GetReadyTasksOptions {
    /** Filter by specific task IDs */
    taskIds?: string[];

    /** Maximum number of tasks to return */
    limit?: number;

    /** Sort by a specific field */
    sortBy?: 'addedAt' | 'priority';

    /** Sort direction */
    sortDirection?: 'asc' | 'desc';
}

/**
 * Options for getting execution order
 */
export interface GetExecutionOrderOptions {
    /** Whether to include completed tasks */
    includeCompleted?: boolean;

    /** Whether to include blocked tasks */
    includeBlocked?: boolean;

    /** Filter by specific task statuses */
    statuses?: TaskStatus[];
}
