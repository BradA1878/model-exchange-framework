# Interview Scheduling Demo

A multi-agent system demonstrating autonomous coordination for interview scheduling. Three AI agents (Candidate, Recruiter, Scheduler) work together to find and book interview times using natural language communication.

## Overview

This demo showcases:

- **Multi-Agent Coordination**: Three specialized agents working autonomously
- **Natural Language Communication**: Agents communicate without rigid protocols
- **Task Delegation**: Intelligent task routing based on agent capabilities
- **Channel-Based Collaboration**: Shared workspace for interview coordination

## Agents

| Agent | Role | Description |
|-------|------|-------------|
| Candidate | Interview Participant | Provides availability, preferences, and responds to scheduling options |
| Recruiter | Coordination Lead | Manages the interview process, communicates requirements |
| Scheduler | Logistics Expert | Finds optimal time slots, handles calendar operations |

## Key MXF Features Demonstrated

### 1. SDK Initialization and Authentication

```typescript
import { MxfSDK } from '@mxf/sdk';

const sdk = new MxfSDK({
    username: 'demo-user',
    password: 'demo-password',
    serverUrl: 'http://localhost:3001'
});

await sdk.connect();
```

### 2. Channel Creation for Collaboration

```typescript
const channel = await sdk.createChannel({
    channelId: 'interview-scheduling',
    name: 'Interview Scheduling',
    description: 'Agent collaboration space for interview coordination'
});
```

### 3. Agent Key Generation

Each agent needs authentication keys to join the channel:

```typescript
const candidateKey = await sdk.generateKey({
    channelId: 'interview-scheduling',
    name: 'Candidate Key'
});

const recruiterKey = await sdk.generateKey({
    channelId: 'interview-scheduling',
    name: 'Recruiter Key'
});
```

### 4. Creating Specialized Agents

```typescript
const candidate = await sdk.createAgent({
    agentId: 'candidate-agent',
    name: 'Alex Johnson',
    channelId: 'interview-scheduling',
    keyId: candidateKey.keyId,
    secretKey: candidateKey.secretKey,
    llmProvider: LlmProviderType.OPENROUTER,
    apiKey: process.env.OPENROUTER_API_KEY!,
    defaultModel: 'anthropic/claude-haiku-4',
    personality: `You are Alex Johnson, a software engineer looking for a new position.
    You have flexible availability this week except Tuesday mornings.
    You prefer afternoon interviews.`,
    allowedTools: ['messaging_send', 'messaging_discover']
});

const recruiter = await sdk.createAgent({
    agentId: 'recruiter-agent',
    name: 'Sarah Chen',
    channelId: 'interview-scheduling',
    keyId: recruiterKey.keyId,
    secretKey: recruiterKey.secretKey,
    llmProvider: LlmProviderType.OPENROUTER,
    apiKey: process.env.OPENROUTER_API_KEY!,
    defaultModel: 'anthropic/claude-opus-4.5',
    personality: `You are Sarah Chen, a technical recruiter at TechCorp.
    You're coordinating a first-round interview for a senior developer position.
    The interview should be 45-60 minutes with two engineers.`,
    allowedTools: ['messaging_send', 'messaging_discover', 'task_complete']
});
```

### 5. Channel Monitoring

```typescript
const monitor = sdk.createChannelMonitor('interview-scheduling');

monitor.on(Events.Message.AGENT_MESSAGE, (payload) => {
    console.log(`[${payload.agentId}]: ${payload.data.content}`);
});

monitor.on(Events.Task.TASK_COMPLETED, (payload) => {
    console.log(`Task completed: ${payload.data.taskId}`);
});
```

### 6. Starting the Conversation

```typescript
// Recruiter initiates the scheduling process
await recruiter.sendMessage(
    'Hi Alex! I wanted to reach out about scheduling your technical interview at TechCorp. ' +
    'What does your availability look like this week?'
);
```

## Running the Demo

### Prerequisites

1. **One-Time Setup**:
   ```bash
   # Start MXF server
   npm run start:dev

   # In another terminal, create demo user
   npm run server:cli -- demo:setup
   ```

2. **Environment Variables**:
   ```bash
   export OPENROUTER_API_KEY=your_key_here
   ```

### Run the Demo

```bash
# Terminal 1: Ensure MXF server is running
npm run start:dev

# Terminal 2: Run the demo
npx tsx examples/interview-scheduling-demo/interview-scheduling-demo.ts
```

## Sample Conversation Flow

```
[Sarah Chen]: Hi Alex! I wanted to reach out about scheduling your
technical interview at TechCorp. What does your availability look
like this week?

[Alex Johnson]: Hi Sarah! Thanks for reaching out. I'm quite flexible
this week. I'm available Monday through Friday, though Tuesday mornings
don't work well for me. I generally prefer afternoon slots if possible.

[Scheduler]: Based on both parties' availability, I see the following
optimal slots:
- Wednesday 2:00 PM - 3:00 PM
- Thursday 3:30 PM - 4:30 PM
- Friday 1:00 PM - 2:00 PM

All slots accommodate the 45-60 minute interview requirement.

[Sarah Chen]: Perfect! Alex, would Thursday at 3:30 PM work for you?
That gives our engineers time to prepare after their standup.

[Alex Johnson]: Thursday at 3:30 PM works great for me!

[Scheduler]: Confirmed! I've scheduled the interview:
- Date: Thursday
- Time: 3:30 PM - 4:30 PM
- Format: Video call (link to be sent)
- Participants: Alex Johnson, 2 TechCorp engineers

[Sarah Chen]: Wonderful! You'll receive a calendar invite shortly.
Looking forward to meeting you, Alex!
```

## Learning Points

This demo showcases:

1. **Channel-based agent collaboration** for organized discussions
2. **Role-based agent specialization** through personality prompts
3. **Tool access control** via `allowedTools` parameter
4. **Event monitoring** for real-time conversation tracking
5. **Multi-turn natural language coordination** without rigid protocols
6. **Task lifecycle management** for tracking interview scheduling completion

## Extending the Demo

You could enhance this demo by:

- Adding calendar integration via external MCP server
- Implementing email notifications through custom tools
- Adding timezone handling for distributed teams
- Creating a dashboard view of scheduled interviews

## Source Code

See the full implementation in `examples/interview-scheduling-demo/interview-scheduling-demo.ts`
