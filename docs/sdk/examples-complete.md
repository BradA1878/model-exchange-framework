# Complete Working Examples

End-to-end examples demonstrating full MXF applications ready to run.

## Prerequisites

See [Basic Examples](examples-basic.md#prerequisites) for setup instructions.

## Example 1: Customer Support Bot

Complete customer support system with multiple specialized agents.

```typescript
import { MxfSDK, Events, MemoryScope } from '@mxf/sdk';
import * as fs from 'fs';

// Load credentials
const credentials = JSON.parse(
    fs.readFileSync('./credentials.json', 'utf-8')
);

// Initialize SDK
const sdk = new MxfSDK({
    serverUrl: 'http://localhost:3001',
    domainKey: process.env.MXF_DOMAIN_KEY!,
    username: process.env.MXF_USERNAME!,
    password: process.env.MXF_PASSWORD!
});

await sdk.connect();

// Create support agents
const frontDesk = await sdk.createAgent({
    agentId: 'front-desk',
    name: 'Front Desk Agent',
    channelId: credentials.channelId,
    keyId: credentials.keys.frontdesk.keyId,
    secretKey: credentials.keys.frontdesk.secretKey,
    llmProvider: 'openrouter',
    defaultModel: 'anthropic/claude-3.5-sonnet',
    apiKey: process.env.OPENROUTER_API_KEY,
    agentConfigPrompt: `You are a friendly front desk agent. 
    Greet customers, understand their needs, and route them to specialists.`,
    allowedTools: ['messaging_send', 'messaging_coordinate', 'task_complete']
});

const technical = await sdk.createAgent({
    agentId: 'technical',
    name: 'Technical Support',
    channelId: credentials.channelId,
    keyId: credentials.keys.technical.keyId,
    secretKey: credentials.keys.technical.secretKey,
    llmProvider: 'openrouter',
    defaultModel: 'anthropic/claude-3.5-sonnet',
    apiKey: process.env.OPENROUTER_API_KEY,
    agentConfigPrompt: `You are a technical support specialist.
    Help customers with technical issues and troubleshooting.`,
    allowedTools: ['messaging_send', 'memory_retrieve', 'task_complete']
});

const billing = await sdk.createAgent({
    agentId: 'billing',
    name: 'Billing Support',
    channelId: credentials.channelId,
    keyId: credentials.keys.billing.keyId,
    secretKey: credentials.keys.billing.secretKey,
    llmProvider: 'openrouter',
    defaultModel: 'anthropic/claude-3.5-sonnet',
    apiKey: process.env.OPENROUTER_API_KEY,
    agentConfigPrompt: `You are a billing support specialist.
    Help customers with billing questions and account issues.`,
    allowedTools: ['messaging_send', 'memory_retrieve', 'task_complete']
});

await Promise.all([
    frontDesk.connect(),
    technical.connect(),
    billing.connect()
]);

// Front desk routes customers
frontDesk.on(Events.Message.AGENT_MESSAGE, async (payload) => {
    const message = payload.data.content.toLowerCase();
    
    if (message.includes('technical') || message.includes('error')) {
        await frontDesk.channelService.sendMessage(
            'Routing you to technical support...'
        );
        await frontDesk.channelService.createTask({
            title: 'Technical Support Request',
            description: payload.data.content,
            assignedTo: 'technical'
        });
    } else if (message.includes('billing') || message.includes('payment')) {
        await frontDesk.channelService.sendMessage(
            'Routing you to billing support...'
        );
        await frontDesk.channelService.createTask({
            title: 'Billing Support Request',
            description: payload.data.content,
            assignedTo: 'billing'
        });
    } else {
        await frontDesk.channelService.sendMessage(
            'How can I help you today?'
        );
    }
});

// Specialists handle their tasks
[technical, billing].forEach(agent => {
    agent.on(Events.Task.ASSIGNED, async (payload) => {
        console.log(`${agent.agentId} handling: ${payload.data.description}`);
        await agent.channelService.sendMessage(
            `I'm looking into your request: ${payload.data.description}`
        );
        // Process and respond...
    });
});

console.log('✓ Customer support system running');
```

## Example 2: Data Processing Pipeline

Multi-stage data processing with specialized agents.

```typescript
import { MxfSDK, Events } from '@mxf/sdk';

const sdk = new MxfSDK({
    serverUrl: 'http://localhost:3001',
    domainKey: process.env.MXF_DOMAIN_KEY!,
    username: process.env.MXF_USERNAME!,
    password: process.env.MXF_PASSWORD!
});

await sdk.connect();

// Pipeline: Collector → Validator → Processor → Reporter
const collector = await sdk.createAgent({
    agentId: 'collector',
    name: 'Data Collector',
    channelId: credentials.channelId,
    keyId: credentials.keys.collector.keyId,
    secretKey: credentials.keys.collector.secretKey,
    llmProvider: 'openrouter',
    defaultModel: 'anthropic/claude-3.5-sonnet',
    apiKey: process.env.OPENROUTER_API_KEY,
    allowedTools: ['filesystem_read', 'memory_store']
});

const validator = await sdk.createAgent({
    agentId: 'validator',
    name: 'Data Validator',
    channelId: credentials.channelId,
    keyId: credentials.keys.validator.keyId,
    secretKey: credentials.keys.validator.secretKey,
    llmProvider: 'openrouter',
    defaultModel: 'anthropic/claude-3.5-sonnet',
    apiKey: process.env.OPENROUTER_API_KEY,
    allowedTools: ['memory_retrieve', 'memory_store']
});

const processor = await sdk.createAgent({
    agentId: 'processor',
    name: 'Data Processor',
    channelId: credentials.channelId,
    keyId: credentials.keys.processor.keyId,
    secretKey: credentials.keys.processor.secretKey,
    llmProvider: 'openrouter',
    defaultModel: 'anthropic/claude-3.5-sonnet',
    apiKey: process.env.OPENROUTER_API_KEY,
    allowedTools: ['memory_retrieve', 'memory_store']
});

const reporter = await sdk.createAgent({
    agentId: 'reporter',
    name: 'Report Generator',
    channelId: credentials.channelId,
    keyId: credentials.keys.reporter.keyId,
    secretKey: credentials.keys.reporter.secretKey,
    llmProvider: 'openrouter',
    defaultModel: 'anthropic/claude-3.5-sonnet',
    apiKey: process.env.OPENROUTER_API_KEY,
    allowedTools: ['memory_retrieve', 'messaging_send']
});

await Promise.all([
    collector.connect(),
    validator.connect(),
    processor.connect(),
    reporter.connect()
]);

// Set up pipeline
collector.on(Events.Task.COMPLETED, async (payload) => {
    console.log('Collection complete, starting validation...');
    await validator.channelService.createTask({
        title: 'Validate Data',
        description: 'Validate collected data',
        assignedTo: 'validator'
    });
});

validator.on(Events.Task.COMPLETED, async (payload) => {
    console.log('Validation complete, starting processing...');
    await processor.channelService.createTask({
        title: 'Process Data',
        description: 'Process validated data',
        assignedTo: 'processor'
    });
});

processor.on(Events.Task.COMPLETED, async (payload) => {
    console.log('Processing complete, generating report...');
    await reporter.channelService.createTask({
        title: 'Generate Report',
        description: 'Create final report',
        assignedTo: 'reporter'
    });
});

reporter.on(Events.Task.COMPLETED, (payload) => {
    console.log('✓ Pipeline complete!');
});

// Start the pipeline
await collector.channelService.createTask({
    title: 'Collect Data',
    description: 'Gather data from sources',
    assignedTo: 'collector'
});
```

## Example 3: Real-time Monitoring Dashboard

Monitor agent activity and system health.

```typescript
import { MxfSDK, Events } from '@mxf/sdk';

class MonitoringDashboard {
    private agents: Map<string, any> = new Map();
    private metrics = {
        messages: 0,
        tasks: { created: 0, completed: 0, failed: 0 },
        tools: 0,
        errors: 0
    };

    async initialize() {
        const sdk = new MxfSDK({
            serverUrl: 'http://localhost:3001',
            domainKey: process.env.MXF_DOMAIN_KEY!,
            username: process.env.MXF_USERNAME!,
            password: process.env.MXF_PASSWORD!
        });

        await sdk.connect();

        const monitor = await sdk.createAgent({
            agentId: 'monitor',
            name: 'System Monitor',
            channelId: credentials.channelId,
            keyId: credentials.keys.monitor.keyId,
            secretKey: credentials.keys.monitor.secretKey,
            llmProvider: 'openrouter',
            defaultModel: 'anthropic/claude-3.5-sonnet',
            apiKey: process.env.OPENROUTER_API_KEY
        });

        await monitor.connect();
        this.setupListeners(monitor);
        this.startDashboard();

        return monitor;
    }

    private setupListeners(agent: any) {
        // Track messages
        agent.on(Events.Message.AGENT_MESSAGE, (payload) => {
            this.metrics.messages++;
            this.recordAgentActivity(payload.data.senderId, 'message');
        });

        // Track tasks
        agent.on(Events.Task.CREATED, () => {
            this.metrics.tasks.created++;
        });

        agent.on(Events.Task.COMPLETED, (payload) => {
            this.metrics.tasks.completed++;
            this.recordAgentActivity(payload.data.agentId, 'task_complete');
        });

        agent.on(Events.Task.FAILED, () => {
            this.metrics.tasks.failed++;
        });

        // Track tool usage
        agent.on(Events.Mcp.TOOL_CALL, () => {
            this.metrics.tools++;
        });

        // Track errors
        agent.on(Events.Agent.ERROR, (payload) => {
            this.metrics.errors++;
            console.error('Error detected:', payload.data.error);
        });

        // Track agent connections
        agent.on(Events.Channel.AGENT_JOINED, (payload) => {
            console.log(`✓ Agent joined: ${payload.data.agentId}`);
            this.agents.set(payload.data.agentId, {
                joinedAt: new Date(),
                activity: []
            });
        });
    }

    private recordAgentActivity(agentId: string, activity: string) {
        if (!this.agents.has(agentId)) {
            this.agents.set(agentId, { activity: [] });
        }
        this.agents.get(agentId).activity.push({
            type: activity,
            timestamp: new Date()
        });
    }

    private startDashboard() {
        setInterval(() => {
            console.clear();
            console.log('═══════════════════════════════════════════');
            console.log('          MXF MONITORING DASHBOARD');
            console.log('═══════════════════════════════════════════');
            console.log();
            console.log('System Metrics:');
            console.log(`  Messages:     ${this.metrics.messages}`);
            console.log(`  Tasks:        ${this.metrics.tasks.created} created, ${this.metrics.tasks.completed} completed`);
            console.log(`  Tool Calls:   ${this.metrics.tools}`);
            console.log(`  Errors:       ${this.metrics.errors}`);
            console.log();
            console.log('Active Agents:', this.agents.size);
            this.agents.forEach((data, agentId) => {
                const recentActivity = data.activity.slice(-3);
                console.log(`  - ${agentId}: ${recentActivity.length} recent actions`);
            });
            console.log();
            console.log(`Last updated: ${new Date().toLocaleTimeString()}`);
        }, 5000);
    }
}

// Usage
const dashboard = new MonitoringDashboard();
await dashboard.initialize();
```

## Example 4: Autonomous Research Team

Self-organizing team that researches topics autonomously.

```typescript
import { MxfSDK, Events, MemoryScope } from '@mxf/sdk';

async function createResearchTeam() {
    const sdk = new MxfSDK({
        serverUrl: 'http://localhost:3001',
        domainKey: process.env.MXF_DOMAIN_KEY!,
        username: process.env.MXF_USERNAME!,
        password: process.env.MXF_PASSWORD!
    });

    await sdk.connect();

    // Team leader coordinates research
    const leader = await sdk.createAgent({
        agentId: 'research-leader',
        name: 'Research Leader',
        channelId: credentials.channelId,
        keyId: credentials.keys.leader.keyId,
        secretKey: credentials.keys.leader.secretKey,
        llmProvider: 'openrouter',
        defaultModel: 'anthropic/claude-3.5-sonnet',
        apiKey: process.env.OPENROUTER_API_KEY,
        agentConfigPrompt: `You lead a research team.
        Break down research topics into subtasks and assign to specialists.`,
        allowedTools: ['messaging_coordinate', 'memory_store', 'task_complete']
    });

    // Specialists
    const specialists = await Promise.all([
        sdk.createAgent({
            agentId: 'academic-researcher',
            name: 'Academic Researcher',
            channelId: credentials.channelId,
            keyId: credentials.keys.academic.keyId,
            secretKey: credentials.keys.academic.secretKey,
            llmProvider: 'openrouter',
            defaultModel: 'anthropic/claude-3.5-sonnet',
            apiKey: process.env.OPENROUTER_API_KEY,
            agentConfigPrompt: 'You research academic papers and scientific literature.'
        }),
        sdk.createAgent({
            agentId: 'industry-analyst',
            name: 'Industry Analyst',
            channelId: credentials.channelId,
            keyId: credentials.keys.analyst.keyId,
            secretKey: credentials.keys.analyst.secretKey,
            llmProvider: 'openrouter',
            defaultModel: 'anthropic/claude-3.5-sonnet',
            apiKey: process.env.OPENROUTER_API_KEY,
            agentConfigPrompt: 'You analyze industry trends and market data.'
        }),
        sdk.createAgent({
            agentId: 'synthesizer',
            name: 'Research Synthesizer',
            channelId: credentials.channelId,
            keyId: credentials.keys.synthesizer.keyId,
            secretKey: credentials.keys.synthesizer.secretKey,
            llmProvider: 'openrouter',
            defaultModel: 'anthropic/claude-3.5-sonnet',
            apiKey: process.env.OPENROUTER_API_KEY,
            agentConfigPrompt: 'You synthesize research from multiple sources into cohesive insights.'
        })
    ]);

    await leader.connect();
    await Promise.all(specialists.map(s => s.connect()));

    // Autonomous research workflow
    leader.on(Events.Message.AGENT_MESSAGE, async (payload) => {
        if (payload.data.content.startsWith('Research:')) {
            const topic = payload.data.content.replace('Research:', '').trim();
            
            // Store research topic
            await leader.channelService.updateMemory(
                MemoryScope.CHANNEL,
                'current_research',
                { topic, status: 'in_progress' }
            );

            // Assign subtasks
            await leader.channelService.createTask({
                title: 'Academic Research',
                description: `Research academic literature on: ${topic}`,
                assignedTo: 'academic-researcher'
            });

            await leader.channelService.createTask({
                title: 'Industry Analysis',
                description: `Analyze industry trends for: ${topic}`,
                assignedTo: 'industry-analyst'
            });
        }
    });

    // When specialists complete, synthesizer combines results
    let completedCount = 0;
    specialists.slice(0, 2).forEach(agent => {
        agent.on(Events.Task.COMPLETED, async (payload) => {
            completedCount++;
            if (completedCount === 2) {
                await leader.channelService.createTask({
                    title: 'Synthesize Research',
                    description: 'Combine all research findings',
                    assignedTo: 'synthesizer'
                });
                completedCount = 0;
            }
        });
    });

    specialists[2].on(Events.Task.COMPLETED, async (payload) => {
        await leader.channelService.updateMemory(
            MemoryScope.CHANNEL,
            'current_research',
            { status: 'complete' }
        );
        await leader.channelService.sendMessage('✓ Research complete!');
    });

    return { leader, specialists };
}

// Start research
const team = await createResearchTeam();
await team.leader.channelService.sendMessage('Research: Impact of AI on software development');
```

## See Also

- [Basic Examples](examples-basic.md)
- [Multi-Agent Examples](examples-multi-agent.md)
- [Event Handling Examples](examples-events.md)
- [Memory Operations Examples](examples-memory.md)
- [Task Management Examples](examples-tasks.md)
- [SDK Overview](index.md)
- [Getting Started Guide](../getting-started.md)
