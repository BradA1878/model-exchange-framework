# Memory Operations Examples

Examples demonstrating memory management patterns for both agent-scoped and channel-scoped memory.

## Prerequisites

See [Basic Examples](examples-basic.md#prerequisites) for setup instructions.

## Memory Scopes

MXF supports two memory scopes:
- **Agent Memory**: Private to the agent
- **Channel Memory**: Shared across all agents in the channel

## Example 1: Basic Memory Operations

```typescript
import { MxfSDK, MemoryScope } from '@mxf/sdk';
import credentials from './credentials.json';

const sdk = new MxfSDK({
    serverUrl: 'http://localhost:3001',
    domainKey: process.env.MXF_DOMAIN_KEY!,
    username: process.env.MXF_USERNAME!,
    password: process.env.MXF_PASSWORD!
});

await sdk.connect();

const agent = await sdk.createAgent({
    agentId: 'memory-agent',
    name: 'Memory Agent',
    channelId: credentials.channelId,
    keyId: credentials.keys.agent1.keyId,
    secretKey: credentials.keys.agent1.secretKey,
    llmProvider: 'openrouter',
    defaultModel: 'anthropic/claude-3.5-sonnet',
    apiKey: process.env.OPENROUTER_API_KEY
});

await agent.connect();

// Store agent-scoped memory (private)
await agent.channelService.updateMemory(
    MemoryScope.AGENT,
    'user_preference',
    { theme: 'dark', language: 'en' }
);

// Store channel-scoped memory (shared)
await agent.channelService.updateMemory(
    MemoryScope.CHANNEL,
    'team_info',
    { name: 'Dev Team', members: 5 }
);

// Retrieve agent memory
const prefs = await agent.channelService.getMemory(
    MemoryScope.AGENT,
    'user_preference'
);
console.log('User preferences:', prefs);

// Retrieve channel memory
const teamInfo = await agent.channelService.getMemory(
    MemoryScope.CHANNEL,
    'team_info'
);
console.log('Team info:', teamInfo);
```

## Example 2: Shared Channel Memory

```typescript
// Create two agents in same channel
const agent1 = await sdk.createAgent({
    agentId: 'agent1',
    name: 'Agent 1',
    channelId: credentials.channelId,
    keyId: credentials.keys.agent1.keyId,
    secretKey: credentials.keys.agent1.secretKey,
    llmProvider: 'openrouter',
    defaultModel: 'anthropic/claude-3.5-sonnet',
    apiKey: process.env.OPENROUTER_API_KEY
});

const agent2 = await sdk.createAgent({
    agentId: 'agent2',
    name: 'Agent 2',
    channelId: credentials.channelId,
    keyId: credentials.keys.agent2.keyId,
    secretKey: credentials.keys.agent2.secretKey,
    llmProvider: 'openrouter',
    defaultModel: 'anthropic/claude-3.5-sonnet',
    apiKey: process.env.OPENROUTER_API_KEY
});

await Promise.all([agent1.connect(), agent2.connect()]);

// Agent 1 stores shared data
await agent1.channelService.updateMemory(
    MemoryScope.CHANNEL,
    'project_status',
    { phase: 'development', progress: 45 }
);

// Agent 2 reads shared data
const status = await agent2.channelService.getMemory(
    MemoryScope.CHANNEL,
    'project_status'
);
console.log('Project status (from agent2):', status);
// Output: { phase: 'development', progress: 45 }
```

## Example 3: Memory Event Listening

```typescript
import { Events } from '@mxf/sdk';

// Listen to memory updates
agent.on(Events.Memory.UPDATE_RESULT, (payload) => {
    console.log('Memory updated:');
    console.log('  Scope:', payload.data.scope);
    console.log('  Key:', payload.data.key);
    console.log('  Value:', payload.data.value);
});

// Listen to memory retrievals
agent.on(Events.Memory.GET_RESULT, (payload) => {
    console.log('Memory retrieved:', payload.data);
});

// Perform memory operations
await agent.channelService.updateMemory(
    MemoryScope.AGENT,
    'last_action',
    { action: 'send_message', timestamp: Date.now() }
);
```

## Example 4: Agent Preferences Pattern

```typescript
class AgentPreferences {
    private agent: MxfAgent;

    constructor(agent: MxfAgent) {
        this.agent = agent;
    }

    async set(key: string, value: any): Promise<void> {
        await this.agent.channelService.updateMemory(
            MemoryScope.AGENT,
            `pref_${key}`,
            value
        );
    }

    async get(key: string): Promise<any> {
        return await this.agent.channelService.getMemory(
            MemoryScope.AGENT,
            `pref_${key}`
        );
    }

    async delete(key: string): Promise<void> {
        await this.agent.channelService.deleteMemory(
            MemoryScope.AGENT,
            `pref_${key}`
        );
    }
}

// Usage
const prefs = new AgentPreferences(agent);
await prefs.set('notifications', { enabled: true, frequency: 'daily' });
const notifSettings = await prefs.get('notifications');
```

## Example 5: Channel Context Pattern

```typescript
class ChannelContext {
    private agent: MxfAgent;

    constructor(agent: MxfAgent) {
        this.agent = agent;
    }

    async set(key: string, value: any): Promise<void> {
        await this.agent.channelService.updateMemory(
            MemoryScope.CHANNEL,
            key,
            value
        );
    }

    async get(key: string): Promise<any> {
        return await this.agent.channelService.getMemory(
            MemoryScope.CHANNEL,
            key
        );
    }

    async append(key: string, item: any): Promise<void> {
        const current = await this.get(key) || [];
        if (!Array.isArray(current)) {
            throw new Error('Value is not an array');
        }
        await this.set(key, [...current, item]);
    }
}

// Usage: Shared conversation history
const context = new ChannelContext(agent);
await context.set('conversation_history', []);
await context.append('conversation_history', {
    from: 'agent1',
    message: 'Hello team!',
    timestamp: Date.now()
});
```

## Example 6: Memory-Based State Machine

```typescript
enum AgentState {
    IDLE = 'idle',
    PROCESSING = 'processing',
    WAITING = 'waiting',
    ERROR = 'error'
}

class StatefulAgent {
    private agent: MxfAgent;

    constructor(agent: MxfAgent) {
        this.agent = agent;
    }

    async getState(): Promise<AgentState> {
        const state = await this.agent.channelService.getMemory(
            MemoryScope.AGENT,
            'current_state'
        );
        return (state as AgentState) || AgentState.IDLE;
    }

    async setState(state: AgentState): Promise<void> {
        const previousState = await this.getState();
        await this.agent.channelService.updateMemory(
            MemoryScope.AGENT,
            'current_state',
            state
        );
        console.log(`State transition: ${previousState} → ${state}`);
    }

    async transition(newState: AgentState): Promise<void> {
        const currentState = await this.getState();
        
        // Validate transitions
        const validTransitions: Record<AgentState, AgentState[]> = {
            [AgentState.IDLE]: [AgentState.PROCESSING],
            [AgentState.PROCESSING]: [AgentState.WAITING, AgentState.IDLE, AgentState.ERROR],
            [AgentState.WAITING]: [AgentState.PROCESSING, AgentState.IDLE],
            [AgentState.ERROR]: [AgentState.IDLE]
        };

        if (validTransitions[currentState].includes(newState)) {
            await this.setState(newState);
        } else {
            throw new Error(`Invalid transition: ${currentState} → ${newState}`);
        }
    }
}

// Usage
const statefulAgent = new StatefulAgent(agent);
await statefulAgent.transition(AgentState.PROCESSING);
await statefulAgent.transition(AgentState.IDLE);
```

## See Also

- [Basic Examples](examples-basic.md)
- [Event Handling Examples](examples-events.md)
- [Task Management Examples](examples-tasks.md)
- [Complete Working Examples](examples-complete.md)
