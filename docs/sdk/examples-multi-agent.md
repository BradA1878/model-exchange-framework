# Multi-Agent Coordination Examples

Examples demonstrating multi-agent systems, coordination patterns, and team-based workflows.

## Prerequisites

See [Basic Examples](examples-basic.md#prerequisites) for setup instructions.

## Example 1: Simple Multi-Agent Communication

```typescript
import { MxfSDK, Events } from '@mxf/sdk';
import credentials from './credentials.json';

const sdk = new MxfSDK({
    serverUrl: 'http://localhost:3001',
    domainKey: process.env.MXF_DOMAIN_KEY!,
    username: process.env.MXF_USERNAME!,
    password: process.env.MXF_PASSWORD!
});

await sdk.connect();

// Create two agents in same channel
const agent1 = await sdk.createAgent({
    agentId: 'agent1',
    name: 'Agent One',
    channelId: credentials.channelId,
    keyId: credentials.keys.agent1.keyId,
    secretKey: credentials.keys.agent1.secretKey,
    llmProvider: 'openrouter',
    defaultModel: 'anthropic/claude-3.5-sonnet',
    apiKey: process.env.OPENROUTER_API_KEY
});

const agent2 = await sdk.createAgent({
    agentId: 'agent2',
    name: 'Agent Two',
    channelId: credentials.channelId,
    keyId: credentials.keys.agent2.keyId,
    secretKey: credentials.keys.agent2.secretKey,
    llmProvider: 'openrouter',
    defaultModel: 'anthropic/claude-3.5-sonnet',
    apiKey: process.env.OPENROUTER_API_KEY
});

await Promise.all([agent1.connect(), agent2.connect()]);

// Agent 1 listens for messages
agent1.on(Events.Message.AGENT_MESSAGE, (payload) => {
    if (payload.data.senderId === 'agent2') {
        console.log('Agent 1 received from Agent 2:', payload.data.content);
    }
});

// Agent 2 listens for messages
agent2.on(Events.Message.AGENT_MESSAGE, (payload) => {
    if (payload.data.senderId === 'agent1') {
        console.log('Agent 2 received from Agent 1:', payload.data.content);
    }
});

// Agents communicate
await agent1.channelService.sendMessage('Hello Agent 2!');
await agent2.channelService.sendMessage('Hello Agent 1!');
```

## Example 2: Coordinator-Worker Pattern

```typescript
import { MxfSDK, Events } from '@mxf/sdk';

const sdk = new MxfSDK({
    serverUrl: 'http://localhost:3001',
    domainKey: process.env.MXF_DOMAIN_KEY!,
    username: process.env.MXF_USERNAME!,
    password: process.env.MXF_PASSWORD!
});

await sdk.connect();

// Coordinator agent
const coordinator = await sdk.createAgent({
    agentId: 'coordinator',
    name: 'Task Coordinator',
    channelId: credentials.channelId,
    keyId: credentials.keys.coordinator.keyId,
    secretKey: credentials.keys.coordinator.secretKey,
    llmProvider: 'openrouter',
    defaultModel: 'anthropic/claude-3.5-sonnet',
    apiKey: process.env.OPENROUTER_API_KEY,
    agentConfigPrompt: `You are a task coordinator. 
    Assign tasks to workers and monitor their progress.`
});

// Worker agents
const workers = await Promise.all([
    sdk.createAgent({
        agentId: 'worker1',
        name: 'Worker 1',
        channelId: credentials.channelId,
        keyId: credentials.keys.worker1.keyId,
        secretKey: credentials.keys.worker1.secretKey,
        llmProvider: 'openrouter',
        defaultModel: 'anthropic/claude-3.5-sonnet',
        apiKey: process.env.OPENROUTER_API_KEY
    }),
    sdk.createAgent({
        agentId: 'worker2',
        name: 'Worker 2',
        channelId: credentials.channelId,
        keyId: credentials.keys.worker2.keyId,
        secretKey: credentials.keys.worker2.secretKey,
        llmProvider: 'openrouter',
        defaultModel: 'anthropic/claude-3.5-sonnet',
        apiKey: process.env.OPENROUTER_API_KEY
    })
]);

await coordinator.connect();
await Promise.all(workers.map(w => w.connect()));

// Coordinator monitors task completions
coordinator.on(Events.Task.COMPLETED, (payload) => {
    console.log(`Task ${payload.data.taskId} completed by ${payload.data.agentId}`);
});

// Workers listen for task assignments
workers.forEach(worker => {
    worker.on(Events.Task.ASSIGNED, (payload) => {
        console.log(`${worker.agentId} received task: ${payload.data.taskId}`);
    });
});

// Coordinator creates and assigns tasks
const task = await coordinator.channelService.createTask({
    title: 'Process Data',
    description: 'Analyze customer feedback data',
    assignedTo: 'worker1'
});

console.log('Task assigned:', task.taskId);
```

## Example 3: Specialized Agent Team

```typescript
// Create specialized agents for different roles
const researchAgent = await sdk.createAgent({
    agentId: 'researcher',
    name: 'Research Agent',
    channelId: credentials.channelId,
    keyId: credentials.keys.researcher.keyId,
    secretKey: credentials.keys.researcher.secretKey,
    llmProvider: 'openrouter',
    defaultModel: 'anthropic/claude-3.5-sonnet',
    apiKey: process.env.OPENROUTER_API_KEY,
    agentConfigPrompt: 'You gather and synthesize information from various sources.',
    allowedTools: ['filesystem_read', 'memory_retrieve', 'tools_recommend']
});

const analysisAgent = await sdk.createAgent({
    agentId: 'analyst',
    name: 'Analysis Agent',
    channelId: credentials.channelId,
    keyId: credentials.keys.analyst.keyId,
    secretKey: credentials.keys.analyst.secretKey,
    llmProvider: 'openrouter',
    defaultModel: 'anthropic/claude-3.5-sonnet',
    apiKey: process.env.OPENROUTER_API_KEY,
    agentConfigPrompt: 'You analyze data and identify patterns and insights.',
    allowedTools: ['memory_retrieve', 'memory_store', 'task_complete']
});

const reportAgent = await sdk.createAgent({
    agentId: 'reporter',
    name: 'Report Agent',
    channelId: credentials.channelId,
    keyId: credentials.keys.reporter.keyId,
    secretKey: credentials.keys.reporter.secretKey,
    llmProvider: 'openrouter',
    defaultModel: 'anthropic/claude-3.5-sonnet',
    apiKey: process.env.OPENROUTER_API_KEY,
    agentConfigPrompt: 'You create clear, structured reports from analysis.',
    allowedTools: ['memory_retrieve', 'messaging_send', 'task_complete']
});

await Promise.all([
    researchAgent.connect(),
    analysisAgent.connect(),
    reportAgent.connect()
]);

// Workflow: Research → Analysis → Report
researchAgent.on(Events.Task.COMPLETED, async (payload) => {
    console.log('Research complete, assigning to analyst...');
    await analysisAgent.channelService.createTask({
        title: 'Analyze Research',
        description: 'Analyze the research findings',
        assignedTo: 'analyst'
    });
});

analysisAgent.on(Events.Task.COMPLETED, async (payload) => {
    console.log('Analysis complete, assigning to reporter...');
    await reportAgent.channelService.createTask({
        title: 'Generate Report',
        description: 'Create final report from analysis',
        assignedTo: 'reporter'
    });
});

reportAgent.on(Events.Task.COMPLETED, (payload) => {
    console.log('✓ Complete workflow finished');
});
```

## See Also

- [Basic Examples](examples-basic.md)
- [Event Handling Examples](examples-events.md)
- [Task Management Examples](examples-tasks.md)
- [Complete Working Examples](examples-complete.md)
