# DAG Tools API Reference

This document provides detailed API reference for all Task DAG MCP tools.

## Overview

The DAG tools provide agents with the ability to query and manage task dependencies. All tools require the DAG system to be enabled (`TASK_DAG_ENABLED=true`).

## Tools

### dag_get_ready_tasks

Get tasks that have all dependencies satisfied and are ready to execute.

**Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `channelId` | string | No | context | Channel ID (auto-populated from context) |
| `limit` | number | No | 10 | Maximum tasks to return (1-100) |

**Returns:**

```typescript
{
    success: boolean;
    readyTasks: string[];      // Array of task IDs
    count: number;             // Number of ready tasks
    message: string;           // Human-readable message
}
```

**Example:**

```typescript
const result = await agent.callTool('dag_get_ready_tasks', {
    limit: 5
});
// { success: true, readyTasks: ['task-1', 'task-3'], count: 2, message: 'Found 2 tasks ready to execute' }
```

---

### dag_validate_dependency

Check if adding a dependency between two tasks would create a cycle.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `channelId` | string | No | Channel ID (auto-populated from context) |
| `dependentTaskId` | string | **Yes** | Task that will depend on another |
| `dependencyTaskId` | string | **Yes** | Task that must complete first |

**Returns:**

```typescript
{
    success: boolean;
    isValid: boolean;          // true if dependency can be added
    message: string;
    cyclePath?: string[];      // If cycle detected, the path
}
```

**Example:**

```typescript
// Check if task-B can depend on task-A
const result = await agent.callTool('dag_validate_dependency', {
    dependentTaskId: 'task-B',
    dependencyTaskId: 'task-A'
});

if (result.isValid) {
    // Safe to add dependency
} else {
    console.log('Cycle detected:', result.cyclePath);
}
```

---

### dag_get_execution_order

Get tasks in topologically sorted execution order.

**Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `channelId` | string | No | context | Channel ID |
| `includeCompleted` | boolean | No | false | Include completed tasks |
| `includeBlocked` | boolean | No | true | Include blocked tasks |

**Returns:**

```typescript
{
    success: boolean;
    executionOrder: string[];  // Task IDs in execution order
    count: number;
    message: string;
}
```

**Example:**

```typescript
const result = await agent.callTool('dag_get_execution_order', {
    includeCompleted: false
});
// { success: true, executionOrder: ['task-1', 'task-2', 'task-3', 'task-4'], count: 4, ... }
```

**Note:** Tasks appear in order such that all dependencies come before their dependents.

---

### dag_get_blocking_tasks

Get the list of incomplete dependencies blocking a specific task.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `channelId` | string | No | Channel ID (auto-populated from context) |
| `taskId` | string | **Yes** | Task ID to check blockers for |

**Returns:**

```typescript
{
    success: boolean;
    taskId: string;
    blockingTasks: string[];   // IDs of incomplete dependencies
    isReady: boolean;          // true if no blockers
    message: string;
}
```

**Example:**

```typescript
const result = await agent.callTool('dag_get_blocking_tasks', {
    taskId: 'task-5'
});

if (!result.isReady) {
    console.log('Task is blocked by:', result.blockingTasks);
    // Work on blocking tasks first
}
```

---

### dag_get_parallel_groups

Get groups of tasks that can be executed in parallel.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `channelId` | string | No | Channel ID (auto-populated from context) |

**Returns:**

```typescript
{
    success: boolean;
    parallelGroups: string[][]; // Array of task groups
    groupCount: number;         // Number of groups
    totalTasks: number;         // Total tasks across groups
    message: string;
}
```

**Example:**

```typescript
const result = await agent.callTool('dag_get_parallel_groups', {});
// {
//     success: true,
//     parallelGroups: [
//         ['task-1', 'task-2'],      // Level 0: no dependencies
//         ['task-3', 'task-4'],      // Level 1: depend on level 0
//         ['task-5']                  // Level 2: depends on level 1
//     ],
//     groupCount: 3,
//     totalTasks: 5
// }
```

**Note:** Tasks in the same group have no dependencies on each other and can run concurrently.

---

### dag_get_critical_path

Get the critical path (longest dependency chain) in the DAG.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `channelId` | string | No | Channel ID (auto-populated from context) |

**Returns:**

```typescript
{
    success: boolean;
    criticalPath: string[];    // Task IDs in critical path order
    pathLength: number;        // Number of tasks in path
    message: string;
}
```

**Example:**

```typescript
const result = await agent.callTool('dag_get_critical_path', {});
// {
//     success: true,
//     criticalPath: ['task-1', 'task-3', 'task-5', 'task-7'],
//     pathLength: 4,
//     message: 'Critical path has 4 tasks'
// }
```

**Note:** The critical path represents the minimum number of sequential steps required to complete all tasks, assuming optimal parallel execution.

---

### dag_get_stats

Get statistics about the task DAG.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `channelId` | string | No | Channel ID (auto-populated from context) |

**Returns:**

```typescript
{
    success: boolean;
    stats: {
        nodeCount: number;          // Total tasks
        edgeCount: number;          // Total dependencies
        rootCount: number;          // Tasks with no dependencies
        leafCount: number;          // Tasks that nothing depends on
        maxDepth: number;           // Longest chain length
        averageInDegree: number;    // Avg dependencies per task
        averageOutDegree: number;   // Avg tasks blocked per task
        readyTaskCount: number;     // Tasks ready to execute
        blockedTaskCount: number;   // Tasks waiting on dependencies
        completedTaskCount: number; // Completed tasks
    } | null;
    summary: {
        nodes: number;
        edges: number;
        ready: number;
        blocked: number;
        completed: number;
        depth: number;
    };
    message: string;
}
```

**Example:**

```typescript
const result = await agent.callTool('dag_get_stats', {});
// {
//     success: true,
//     stats: {
//         nodeCount: 10,
//         edgeCount: 8,
//         rootCount: 3,
//         leafCount: 2,
//         maxDepth: 4,
//         ...
//     },
//     summary: { nodes: 10, edges: 8, ready: 3, blocked: 5, completed: 2, depth: 4 },
//     message: 'DAG has 10 tasks with 8 dependencies'
// }
```

## Error Handling

All tools return a consistent error structure when something goes wrong:

```typescript
{
    success: false;
    message: string;           // Error description
    error?: string;            // Detailed error (if available)
}
```

### Common Errors

| Error | Cause | Solution |
|-------|-------|----------|
| "DAG system is disabled" | `TASK_DAG_ENABLED` not set | Enable with `TASK_DAG_ENABLED=true` |
| "channelId is required" | No channel context | Provide `channelId` parameter |
| "No DAG exists for this channel" | No tasks in channel | Create tasks first |

## Best Practices

1. **Always validate before adding dependencies**
   ```typescript
   const validation = await agent.callTool('dag_validate_dependency', {...});
   if (validation.isValid) {
       // Safe to add dependency
   }
   ```

2. **Use parallel groups for efficient execution**
   ```typescript
   const groups = await agent.callTool('dag_get_parallel_groups', {});
   for (const group of groups.parallelGroups) {
       // Execute tasks in this group in parallel
       await Promise.all(group.map(taskId => executeTask(taskId)));
   }
   ```

3. **Monitor critical path for bottlenecks**
   ```typescript
   const path = await agent.callTool('dag_get_critical_path', {});
   // Focus optimization efforts on critical path tasks
   ```

4. **Check ready tasks before starting work**
   ```typescript
   const ready = await agent.callTool('dag_get_ready_tasks', {});
   // Only attempt to work on ready tasks
   ```
