# Twenty Questions: ORPAR Cognitive Cycle Demo

A classic guessing game demonstrating MXF's ORPAR (Observe-Reason-Plan-Act-Reflect) cognitive cycle with two AI agents taking turns as Thinker and Guesser.

## Overview

This example showcases how agents use the ORPAR cognitive framework to structure their thinking:

- **Thinker Agent** - Chooses a secret and answers yes/no questions
- **Guesser Agent** - Uses deductive reasoning to identify the secret in 20 questions or less

## Key MXF Features Demonstrated

### 1. ORPAR Cognitive Tools

Agents explicitly structure their cognition using the ORPAR tools:

```typescript
// Guesser's cognitive cycle
await agent.callTool('orpar_observe', {
    observations: 'Q5: "Is it a mammal?" → YES',
    keyFacts: ['The secret is alive', 'It is an animal', 'It is a mammal']
});

await agent.callTool('orpar_reason', {
    analysis: 'Based on answers, likely a common pet or farm animal.',
    confidence: 0.6
});

await agent.callTool('orpar_plan', {
    plan: 'Narrow down by size - ask if it is typically kept as a house pet.'
});

// Execute action
await agent.callTool('game_askQuestion', {
    question: 'Is it commonly kept as a house pet?'
});

await agent.callTool('orpar_act', {
    action: 'Asked about house pet status',
    outcome: 'YES - it is commonly a house pet'
});

await agent.callTool('orpar_reflect', {
    reflection: 'Small mammal house pet - dog, cat, hamster, rabbit likely candidates.'
});
```

### 2. Flow Validation

The ORPAR tools enforce the cognitive cycle sequence:

```
observe → reason → plan → act → reflect → observe (new cycle)
```

Skipping phases triggers helpful guidance:

```typescript
// If agent tries to act without planning
await agent.callTool('orpar_act', { action: '...' });
// Returns: { warning: "Phase 'act' called but expected 'plan'. Consider completing 'plan' first..." }
```

### 3. Channel-Scoped MCP Server

Game tools are isolated to the game channel:

```typescript
const mcpResult = await adminAgent.registerChannelMcpServer({
    id: 'twenty-questions-mcp-server',
    name: 'Twenty Questions Game Server',
    transport: 'http',
    url: `http://localhost:${GAME_PORT}/mcp`,
    autoStart: true,
    keepAliveMinutes: 30
});
```

### 4. Custom Game Tools

| Tool | Role | Description |
|------|------|-------------|
| `game_getState` | Both | Get current game state from your perspective |
| `game_setSecret` | Thinker | Set the secret thing and category |
| `game_askQuestion` | Guesser | Ask a yes/no question |
| `game_answerQuestion` | Thinker | Answer with yes/no/sometimes/unknown |
| `game_makeGuess` | Guesser | Make a final guess |

### 5. ORPAR Phase Tracking

The game tracks each agent's ORPAR phases for visualization:

```typescript
interface PlayerInfo {
    agentId: string;
    name: string;
    model: string;
    personality: string;
    orparPhases: OrparPhaseLog[];  // Tracked for visualization
}

interface OrparPhaseLog {
    phase: 'Observe' | 'Reason' | 'Plan' | 'Act' | 'Reflect';
    timestamp: number;
    summary: string;
}
```

## Game Flow

### Thinker's ORPAR Cycle

1. **Observe**: Receive question from Guesser
2. **Reason**: Analyze if question applies to the secret
3. **Act**: Provide honest yes/no answer
4. **Reflect**: Consider what information was revealed

### Guesser's ORPAR Cycle

1. **Observe**: Gather current game state and answer history
2. **Reason**: Analyze patterns and narrow possibilities
3. **Plan**: Strategize next question for maximum information gain
4. **Act**: Ask the question or make a guess
5. **Reflect**: Update mental model based on answer

## Running the Demo

### Prerequisites

1. MXF server running:
   ```bash
   npm run dev
   ```

2. Install dependencies:
   ```bash
   cd examples/twenty-questions
   npm install
   ```

### Start the Game

```bash
# Terminal 1: Start game server
npm run server

# Terminal 2: Connect agents and play
npm run agents
```

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/api/game/state` | GET | Get full game state |
| `/api/game/chat` | GET | Get chat/event history |
| `/api/game/orpar` | GET | Get ORPAR phase events |
| `/api/game/start` | POST | Start the game |
| `/api/game/reset` | POST | Reset the game |

## Sample Output

```
[Thinker] Setting up the game...
  📝 OBSERVE: Game starting, I need to choose a secret
  🧠 REASON: Should pick something common but not too obvious
  🎯 ACT: Setting secret to "elephant" (category: animal)
  💭 REFLECT: Good choice - distinctive features for yes/no questions

[Guesser] Beginning deduction...
  📝 OBSERVE: Category is "animal", 20 questions available
  🧠 REASON: Start with broad binary splits for maximum info
  📋 PLAN: Ask if it's a mammal to split animal kingdom
  🎯 ACT: "Is it a mammal?"
  💭 REFLECT: YES - eliminated fish, birds, reptiles, insects

[Thinker]
  📝 OBSERVE: Question: "Is it a mammal?"
  🧠 REASON: Elephants are mammals
  🎯 ACT: Answering "yes"
  💭 REFLECT: Correct answer, many mammals remain possible

[Guesser]
  📝 OBSERVE: Q1: "Is it a mammal?" → YES (19 remaining)
  🧠 REASON: Large category, need to split by size or habitat
  📋 PLAN: Ask about size to narrow significantly
  🎯 ACT: "Is it larger than a human?"
  💭 REFLECT: This splits mammals roughly in half

...continues until guess or 20 questions...

[Guesser] Making final guess...
  📝 OBSERVE: Large mammal, gray, has trunk, African origin
  🧠 REASON: All evidence points to elephant
  🎯 ACT: Guessing "elephant"

🎉 CORRECT! The secret was "elephant"
   Winner: Guesser (12 questions used)
```

## Learning Points

This demo showcases:

1. **Explicit cognitive structuring** - Agents use ORPAR tools to document their thinking
2. **Flow validation** - System guides agents through proper cognitive sequence
3. **Phase visualization** - ORPAR phases tracked for dashboard display
4. **Complementary control loops** - Agent-driven ORPAR tools + server-side ControlLoop
5. **Channel-scoped game isolation** - Game tools only available in game channel
6. **Turn-based coordination** - Alternating Thinker/Guesser responsibilities

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Twenty Questions Demo                      │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌─────────────┐           ┌─────────────┐                  │
│  │   Thinker   │           │   Guesser   │                  │
│  │   Agent     │◄─────────►│   Agent     │                  │
│  │             │   MXF     │             │                  │
│  │  ORPAR:     │  Channel  │  ORPAR:     │                  │
│  │  O→R→A→R    │           │  O→R→P→A→R  │                  │
│  └─────────────┘           └─────────────┘                  │
│         │                         │                          │
│         └──────────┬──────────────┘                          │
│                    │                                          │
│         ┌──────────▼──────────┐                              │
│         │   Game MCP Server   │                              │
│         │   (Channel-Scoped)  │                              │
│         │                     │                              │
│         │  • game_getState    │                              │
│         │  • game_setSecret   │                              │
│         │  • game_askQuestion │                              │
│         │  • game_answerQuestion                             │
│         │  • game_makeGuess   │                              │
│         └─────────────────────┘                              │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

## Related Documentation

- [ORPAR Cognitive Cycle](../mxf/orpar.md) - Deep dive into ORPAR
- [Tool Reference - ORPAR Tools](../mxf/tool-reference.md#control-loop--orpar) - All ORPAR tools
- [Channel-Scoped MCP](../sdk/channel-mcp-servers.md) - Registering game tools

## Source Code

See the full implementation in `examples/twenty-questions/`
