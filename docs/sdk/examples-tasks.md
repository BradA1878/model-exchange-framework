# Task Management Examples

Examples demonstrating task creation, assignment, monitoring, and completion patterns.

## Prerequisites

See [Basic Examples](examples-basic.md#prerequisites) for setup instructions.

## Example 1: Basic Task Creation and Assignment

```typescript
import { MxfSDK, Events } from '@mxf/sdk';
import credentials from './credentials.json';

const sdk = new MxfSDK({
    serverUrl: 'http://localhost:3001',
    domainKey: process.env.MXF_DOMAIN_KEY!,
    accessToken: process.env.MXF_ACCESS_TOKEN!
});

await sdk.connect();

const agent = await sdk.createAgent({
    agentId: 'task-manager',
    name: 'Task Manager',
    channelId: credentials.channelId,
    keyId: credentials.keys.agent1.keyId,
    secretKey: credentials.keys.agent1.secretKey,
    llmProvider: 'openrouter',
    defaultModel: 'anthropic/claude-3.5-sonnet',
    apiKey: process.env.OPENROUTER_API_KEY
});

await agent.connect();

// Listen for task events
agent.on(Events.Task.CREATED, (payload) => {
    console.log('Task created:', payload.data.taskId);
});

agent.on(Events.Task.ASSIGNED, (payload) => {
    console.log('Task assigned to:', payload.data.assignedTo);
});

// Create a task
const task = await agent.channelService.createTask({
    title: 'Analyze Data',
    description: 'Analyze customer feedback from Q4',
    assignedTo: 'analyst-agent',
    priority: 'high',
    dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours from now
});

console.log('Created task:', task.taskId);
```

## Example 2: Task Completion Handler

```typescript
// Worker agent that completes tasks
const worker = await sdk.createAgent({
    agentId: 'worker',
    name: 'Worker Agent',
    channelId: credentials.channelId,
    keyId: credentials.keys.worker.keyId,
    secretKey: credentials.keys.worker.secretKey,
    llmProvider: 'openrouter',
    defaultModel: 'anthropic/claude-3.5-sonnet',
    apiKey: process.env.OPENROUTER_API_KEY
});

await worker.connect();

// Listen for assigned tasks
worker.on(Events.Task.ASSIGNED, async (payload) => {
    const taskId = payload.data.taskId;
    console.log(`Worker received task: ${taskId}`);
    
    try {
        // Process the task...
        await processTask(payload.data);
        
        // Mark task as complete
        await worker.channelService.completeTask(taskId, {
            result: 'Task completed successfully',
            completedAt: new Date()
        });
        
        console.log(`✓ Task ${taskId} completed`);
    } catch (error) {
        console.error(`✗ Task ${taskId} failed:`, error);
    }
});

async function processTask(task: any): Promise<void> {
    // Simulate task processing
    await new Promise(resolve => setTimeout(resolve, 1000));
}
```

## Example 3: Task Progress Updates

```typescript
// Agent that reports progress
const progressAgent = await sdk.createAgent({
    agentId: 'progress-agent',
    name: 'Progress Agent',
    channelId: credentials.channelId,
    keyId: credentials.keys.agent1.keyId,
    secretKey: credentials.keys.agent1.secretKey,
    llmProvider: 'openrouter',
    defaultModel: 'anthropic/claude-3.5-sonnet',
    apiKey: process.env.OPENROUTER_API_KEY
});

await progressAgent.connect();

// Listen for task assignment
progressAgent.on(Events.Task.ASSIGNED, async (payload) => {
    const taskId = payload.data.taskId;
    
    // Report progress at intervals
    for (let progress = 0; progress <= 100; progress += 25) {
        await progressAgent.channelService.updateTaskProgress(taskId, progress, {
            status: progress < 100 ? 'in_progress' : 'completed',
            message: `Processing: ${progress}% complete`
        });
        
        console.log(`Task ${taskId} progress: ${progress}%`);
        await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    // Complete the task
    await progressAgent.channelService.completeTask(taskId);
});

// Monitor progress updates
progressAgent.on(Events.Task.PROGRESS_UPDATED, (payload) => {
    console.log(`Task ${payload.data.taskId} progress: ${payload.data.progress}%`);
});
```

## Example 4: Task Queue Manager

```typescript
class TaskQueue {
    private agent: MxfAgent;
    private queue: Array<any> = [];
    private processing: boolean = false;

    constructor(agent: MxfAgent) {
        this.agent = agent;
        this.setupListeners();
    }

    private setupListeners(): void {
        this.agent.on(Events.Task.ASSIGNED, (payload) => {
            this.queue.push(payload.data);
            this.processQueue();
        });
    }

    private async processQueue(): Promise<void> {
        if (this.processing || this.queue.length === 0) {
            return;
        }

        this.processing = true;

        while (this.queue.length > 0) {
            const task = this.queue.shift()!;
            await this.processTask(task);
        }

        this.processing = false;
    }

    private async processTask(task: any): Promise<void> {
        console.log(`Processing task: ${task.taskId}`);
        
        try {
            // Simulate work
            await new Promise(resolve => setTimeout(resolve, 3000));
            
            // Complete task
            await this.agent.channelService.completeTask(task.taskId, {
                result: 'Task completed',
                timestamp: new Date()
            });
            
            console.log(`✓ Completed task: ${task.taskId}`);
        } catch (error) {
            console.error(`✗ Failed task: ${task.taskId}`, error);
        }
    }

    public getQueueLength(): number {
        return this.queue.length;
    }
}

// Usage
const taskQueue = new TaskQueue(agent);
```

## Example 5: Task Coordination Between Agents

```typescript
// Coordinator creates tasks for workers
const coordinator = await sdk.createAgent({
    agentId: 'coordinator',
    name: 'Task Coordinator',
    channelId: credentials.channelId,
    keyId: credentials.keys.coordinator.keyId,
    secretKey: credentials.keys.coordinator.secretKey,
    llmProvider: 'openrouter',
    defaultModel: 'anthropic/claude-3.5-sonnet',
    apiKey: process.env.OPENROUTER_API_KEY
});

// Two workers
const worker1 = await sdk.createAgent({
    agentId: 'worker1',
    name: 'Worker 1',
    channelId: credentials.channelId,
    keyId: credentials.keys.worker1.keyId,
    secretKey: credentials.keys.worker1.secretKey,
    llmProvider: 'openrouter',
    defaultModel: 'anthropic/claude-3.5-sonnet',
    apiKey: process.env.OPENROUTER_API_KEY
});

const worker2 = await sdk.createAgent({
    agentId: 'worker2',
    name: 'Worker 2',
    channelId: credentials.channelId,
    keyId: credentials.keys.worker2.keyId,
    secretKey: credentials.keys.worker2.secretKey,
    llmProvider: 'openrouter',
    defaultModel: 'anthropic/claude-3.5-sonnet',
    apiKey: process.env.OPENROUTER_API_KEY
});

await Promise.all([coordinator.connect(), worker1.connect(), worker2.connect()]);

// Track completed tasks
let completedTasks = 0;
coordinator.on(Events.Task.COMPLETED, (payload) => {
    completedTasks++;
    console.log(`Task completed by ${payload.data.agentId} (${completedTasks} total)`);
});

// Assign tasks in round-robin fashion
const tasks = [
    { title: 'Task 1', description: 'Process data set 1' },
    { title: 'Task 2', description: 'Process data set 2' },
    { title: 'Task 3', description: 'Process data set 3' },
    { title: 'Task 4', description: 'Process data set 4' }
];

const workers = ['worker1', 'worker2'];
for (let i = 0; i < tasks.length; i++) {
    const assignedTo = workers[i % workers.length];
    await coordinator.channelService.createTask({
        ...tasks[i],
        assignedTo
    });
}

// Workers handle their tasks
[worker1, worker2].forEach(worker => {
    worker.on(Events.Task.ASSIGNED, async (payload) => {
        console.log(`${worker.agentId} received: ${payload.data.title}`);
        await new Promise(resolve => setTimeout(resolve, 2000));
        await worker.channelService.completeTask(payload.data.taskId);
    });
});
```

## Example 6: Task Dependencies

```typescript
class DependentTaskManager {
    private agent: MxfAgent;
    private dependencies: Map<string, string[]> = new Map();
    private completed: Set<string> = new Set();

    constructor(agent: MxfAgent) {
        this.agent = agent;
        this.setupListeners();
    }

    private setupListeners(): void {
        this.agent.on(Events.Task.COMPLETED, (payload) => {
            const taskId = payload.data.taskId;
            this.completed.add(taskId);
            this.checkDependencies(taskId);
        });
    }

    async createTask(
        taskData: any,
        dependsOn: string[] = []
    ): Promise<string> {
        const task = await this.agent.channelService.createTask(taskData);
        
        if (dependsOn.length > 0) {
            this.dependencies.set(task.taskId, dependsOn);
        }
        
        return task.taskId;
    }

    private checkDependencies(completedTaskId: string): void {
        this.dependencies.forEach((deps, taskId) => {
            const allDepsComplete = deps.every(dep => this.completed.has(dep));
            
            if (allDepsComplete && !this.completed.has(taskId)) {
                console.log(`✓ Dependencies met for task: ${taskId}`);
                // Task can now be assigned to a worker
            }
        });
    }
}

// Usage
const taskManager = new DependentTaskManager(coordinator);

const task1 = await taskManager.createTask({
    title: 'Gather Data',
    assignedTo: 'worker1'
});

const task2 = await taskManager.createTask({
    title: 'Process Data',
    assignedTo: 'worker2'
}, [task1]); // Depends on task1

const task3 = await taskManager.createTask({
    title: 'Generate Report',
    assignedTo: 'worker1'
}, [task2]); // Depends on task2
```

## See Also

- [Basic Examples](examples-basic.md)
- [Multi-Agent Examples](examples-multi-agent.md)
- [Event Handling Examples](examples-events.md)
- [Complete Working Examples](examples-complete.md)
