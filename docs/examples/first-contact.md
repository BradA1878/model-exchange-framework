# First Contact Demo

An epic multi-agent demonstration showcasing the USS Sentinel Horizon crew encountering an alien vessel. This demo highlights authentic LLM agent coordination, task management, and real-time communication capabilities of the MXF framework.

## Overview

The demo simulates a first contact scenario where a starship crew must coordinate to establish communication with an alien commander. It demonstrates:

- **Multi-Agent Coordination**: 5 human crew members + 1 alien commander working together
- **Real LLM Responses**: Using Claude, GPT-4, Gemini Flash, and Grok models via OpenRouter
- **Task Management**: SystemLLM-powered task assignment and monitoring
- **Communication Protocols**: Real-time messaging between agents
- **Translation Challenge**: Xenolinguistics expert translating alien symbols

## Running the Demo

### Prerequisites

1. MXF server running:
   ```bash
   npm run dev
   ```

2. Environment variables (OpenRouter API key required):
   ```bash
   export OPENROUTER_API_KEY=your_key_here
   ```

### Start the Demo

```bash
npx tsx examples/first-contact-demo/first-contact-demo.ts
```

Or use the npm script:

```bash
npm run demo:first-contact
```

## Key MXF Features Demonstrated

### 1. Multi-Agent Creation

```typescript
const sdk = new MxfSDK({
    serverUrl: 'http://localhost:3001',
    domainKey: process.env.MXF_DOMAIN_KEY!,
    username: 'demo-user',
    password: 'demo-password'
});

await sdk.connect();

// Create multiple agents with different LLM models
const captain = await sdk.createAgent({
    agentId: 'captain-chen',
    name: 'Captain Chen',
    personality: 'Calm, decisive leader...',
    provider: 'openrouter',
    model: 'anthropic/claude-opus-4.5'
});
```

### 2. Task Coordination

The demo uses intelligent task assignment where the SystemLLM analyzes agent capabilities and assigns tasks automatically:

```typescript
await sdk.createTask({
    title: 'Establish First Contact',
    description: 'Coordinate crew to safely communicate with alien vessel',
    channelId: 'bridge'
});
```

### 3. Real-Time Communication

Agents communicate through the MXF messaging system with event-driven updates:

```typescript
captain.on('message', (msg) => {
    console.log(`[${msg.agentId}]: ${msg.content}`);
});

await captain.sendMessage('All stations, report status.');
```

## Agents in the Demo

| Agent | Role | LLM Model |
|-------|------|-----------|
| Captain Chen | Ship Commander | Claude 3.5 Sonnet |
| Lt. Commander Okafor | Science Officer | GPT-4 |
| Ensign Park | Communications | Gemini Flash |
| Dr. Reyes | Xenolinguist | Grok |
| Chief Torres | Engineering | GPT-4 mini |
| Zyx'thral | Alien Commander | Claude 3.5 Sonnet |

## Learning Points

This demo showcases:

1. **Creating agents with different LLM providers** via OpenRouter
2. **Channel-based communication** for organized discussions
3. **Task lifecycle management** from creation to completion
4. **Event handling** for real-time agent interactions
5. **SystemLLM integration** for intelligent coordination

## Source Code

See the full implementation in `examples/first-contact-demo/first-contact-demo.ts`
