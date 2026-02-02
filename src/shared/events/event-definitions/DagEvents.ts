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
 * DAG Events
 *
 * Event definitions for the Task DAG system.
 * Includes dependency resolution, blocking, cycle detection, and validation events.
 */

/**
 * DAG event names
 */
export const DagEvents = {
    // Task dependency lifecycle events
    TASK_DEPENDENCIES_RESOLVED: 'dag:task_dependencies_resolved',
    TASK_BLOCKED: 'dag:task_blocked',
    TASK_UNBLOCKED: 'dag:task_unblocked',

    // DAG structure events
    DEPENDENCY_ADDED: 'dag:dependency_added',
    DEPENDENCY_REMOVED: 'dag:dependency_removed',
    DAG_UPDATED: 'dag:updated',

    // Validation events
    CYCLE_DETECTED: 'dag:cycle_detected',
    VALIDATION_FAILED: 'dag:validation_failed',
    VALIDATION_WARNING: 'dag:validation_warning',

    // Execution events
    EXECUTION_ORDER_COMPUTED: 'dag:execution_order_computed',
    CRITICAL_PATH_COMPUTED: 'dag:critical_path_computed',
} as const;

export type DagEventName = typeof DagEvents[keyof typeof DagEvents];

/**
 * Task dependencies resolved event data
 * Emitted when all dependencies for a task have been completed
 */
export interface TaskDependenciesResolvedEventData {
    /** The task that is now unblocked */
    taskId: string;

    /** The channel containing the task */
    channelId: string;

    /** IDs of the dependencies that were resolved */
    resolvedDependencies: string[];

    /** Timestamp when the dependencies were resolved */
    resolvedAt: number;
}

/**
 * Task blocked event data
 * Emitted when a task cannot proceed due to unresolved dependencies
 */
export interface TaskBlockedEventData {
    /** The task that is blocked */
    taskId: string;

    /** The channel containing the task */
    channelId: string;

    /** IDs of the tasks blocking this one */
    blockingTasks: string[];

    /** The status transition that was attempted */
    attemptedStatus: string;

    /** Reason for the block */
    reason: string;
}

/**
 * Task unblocked event data
 * Emitted when a blocking dependency is resolved
 */
export interface TaskUnblockedEventData {
    /** The task that was unblocked */
    taskId: string;

    /** The channel containing the task */
    channelId: string;

    /** The dependency that was resolved */
    resolvedDependency: string;

    /** Remaining blocking tasks (if any) */
    remainingBlockers: string[];

    /** Whether the task is now fully ready */
    isReady: boolean;
}

/**
 * Dependency added event data
 */
export interface DependencyAddedEventData {
    /** The edge ID */
    edgeId: string;

    /** The dependent task */
    dependentTaskId: string;

    /** The dependency task */
    dependencyTaskId: string;

    /** The channel containing the tasks */
    channelId: string;

    /** Optional label for the dependency */
    label?: string;
}

/**
 * Dependency removed event data
 */
export interface DependencyRemovedEventData {
    /** The edge ID */
    edgeId: string;

    /** The dependent task */
    dependentTaskId: string;

    /** The dependency task */
    dependencyTaskId: string;

    /** The channel containing the tasks */
    channelId: string;
}

/**
 * DAG updated event data
 */
export interface DagUpdatedEventData {
    /** The channel whose DAG was updated */
    channelId: string;

    /** Type of update */
    updateType: 'node_added' | 'node_removed' | 'edge_added' | 'edge_removed' | 'status_changed';

    /** Affected task IDs */
    affectedTaskIds: string[];

    /** New DAG version */
    version: number;
}

/**
 * Cycle detected event data
 * Emitted when a dependency would create a cycle
 */
export interface CycleDetectedEventData {
    /** The channel where the cycle was detected */
    channelId: string;

    /** The dependency that would create the cycle */
    dependentTaskId: string;

    /** The dependency task that would complete the cycle */
    dependencyTaskId: string;

    /** The full cycle path */
    cyclePath: string[];

    /** Human-readable description of the cycle */
    cycleDescription: string;
}

/**
 * Validation failed event data
 */
export interface ValidationFailedEventData {
    /** The channel where validation failed */
    channelId: string;

    /** Error code */
    errorCode: string;

    /** Error message */
    errorMessage: string;

    /** Related task IDs */
    taskIds?: string[];

    /** Related edge IDs */
    edgeIds?: string[];
}

/**
 * Validation warning event data
 */
export interface ValidationWarningEventData {
    /** The channel where the warning was generated */
    channelId: string;

    /** Warning code */
    warningCode: string;

    /** Warning message */
    warningMessage: string;

    /** Related task IDs */
    taskIds?: string[];
}

/**
 * Execution order computed event data
 */
export interface ExecutionOrderComputedEventData {
    /** The channel */
    channelId: string;

    /** The computed execution order */
    executionOrder: string[];

    /** Execution levels (parallel groups) */
    levels: string[][];

    /** Number of ready tasks */
    readyTaskCount: number;

    /** Number of blocked tasks */
    blockedTaskCount: number;
}

/**
 * Critical path computed event data
 */
export interface CriticalPathComputedEventData {
    /** The channel */
    channelId: string;

    /** The critical path (longest dependency chain) */
    criticalPath: string[];

    /** Length of the critical path */
    pathLength: number;
}

/**
 * DAG event payloads mapping
 */
export interface DagPayloads {
    'dag:task_dependencies_resolved': TaskDependenciesResolvedEventData;
    'dag:task_blocked': TaskBlockedEventData;
    'dag:task_unblocked': TaskUnblockedEventData;
    'dag:dependency_added': DependencyAddedEventData;
    'dag:dependency_removed': DependencyRemovedEventData;
    'dag:updated': DagUpdatedEventData;
    'dag:cycle_detected': CycleDetectedEventData;
    'dag:validation_failed': ValidationFailedEventData;
    'dag:validation_warning': ValidationWarningEventData;
    'dag:execution_order_computed': ExecutionOrderComputedEventData;
    'dag:critical_path_computed': CriticalPathComputedEventData;
}
