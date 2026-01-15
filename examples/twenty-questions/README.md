# Twenty Questions: ORPAR Cognitive Cycle Demo

This example demonstrates the **ORPAR cognitive cycle** using the classic 20 Questions game. Two AI agents play against each other, with each question/answer cycle showcasing the full Observe-Reason-Plan-Act-Reflect loop.

## Why Twenty Questions?

Twenty Questions is the perfect game to demonstrate ORPAR because:

1. **Clear Cognitive Phases**: Each turn requires distinct mental operations
2. **Observable Reasoning**: You can see the agent's deductive logic in action
3. **Strategic Depth**: Requires planning and adapting based on new information
4. **Simple Rules**: Easy to understand, making the cognitive patterns clear

## ORPAR in Action

### Guesser's Cognitive Cycle (per question)

```
┌─────────────────────────────────────────────────────────────────┐
│                    GUESSER'S ORPAR CYCLE                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   OBSERVE ───────────► Review question history & answers        │
│      │                 "I've learned it's alive, not a mammal"  │
│      ▼                                                          │
│   REASON ────────────► Analyze patterns & narrow possibilities  │
│      │                 "Living, not mammal... could be bird,    │
│      │                  reptile, fish, insect..."               │
│      ▼                                                          │
│   PLAN ──────────────► Decide strategy for this turn           │
│      │                 "Ask about size to eliminate categories" │
│      ▼                                                          │
│   ACT ───────────────► Execute: ask question or make guess      │
│      │                 "Is it smaller than a house cat?"        │
│      ▼                                                          │
│   REFLECT ───────────► Update mental model based on answer      │
│                        "Answer was YES - it's a small creature" │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Thinker's Cognitive Cycle (per answer)

```
┌─────────────────────────────────────────────────────────────────┐
│                    THINKER'S ORPAR CYCLE                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   OBSERVE ───────────► Read the incoming question               │
│      │                 "Is it found in water?"                  │
│      ▼                                                          │
│   REASON ────────────► Consider how question applies to secret  │
│      │                 "My secret is 'goldfish' - yes, fish     │
│      │                  are found in water"                     │
│      ▼                                                          │
│   ACT ───────────────► Answer honestly                          │
│      │                 Answer: "YES"                            │
│      ▼                                                          │
│   REFLECT ───────────► Consider what guesser might deduce       │
│                        "They now know it's aquatic..."          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    connect-agents.ts                            │
│                  (Orchestration Script)                         │
│  - Creates agents with ORPAR-aware prompts                      │
│  - Tracks ORPAR phase events                                    │
│  - Manages game loop                                            │
└──────────────────────────┬──────────────────────────────────────┘
                           │
         ┌─────────────────┼─────────────────┐
         │                 │                 │
         ▼                 ▼                 ▼
┌─────────────┐   ┌─────────────┐   ┌─────────────────┐
│  MXF Server │   │ Game Server │   │ MCP Tool Server │
│  (Port 3001)│   │ (Port 3006) │   │ (stdio → HTTP)  │
│             │   │             │   │                 │
│ • ORPAR     │   │ • Game State│   │ • game_getState │
│   Events    │   │ • ORPAR Log │   │ • game_setSecret│
│ • SystemLLM │   │ • WebSocket │   │ • game_askQ...  │
│ • Tasks     │   │ • REST API  │   │ • game_answerQ..│
└─────────────┘   └─────────────┘   │ • game_makeGuess│
                                    └─────────────────┘
```

## Game Tools

| Tool | Role | Description |
|------|------|-------------|
| `game_getState` | Both | Get current game state (question history, remaining questions) |
| `game_setSecret` | Thinker | Set the secret thing and category at game start |
| `game_askQuestion` | Guesser | Ask a yes/no question about the secret |
| `game_answerQuestion` | Thinker | Answer the most recent question honestly |
| `game_makeGuess` | Guesser | Make a final guess about the secret thing |

## Running the Demo

### Prerequisites

1. MXF Server running on port 3001 (`npm start` in root)
2. MongoDB running locally
3. Environment variables in `.env`:
   - `MXF_DOMAIN_KEY`
   - `OPENROUTER_API_KEY`

### Start the Game (with Dashboard)

```bash
cd examples/twenty-questions
npm install
cd client && npm install && cd ..
npm run game
```

This starts both the game agents and the Vue.js dashboard at http://localhost:3007

### Start Without Dashboard (Console Only)

```bash
cd examples/twenty-questions
npm install
npm run connect-agents
```

### Dashboard Features

The Vue.js dashboard (port 3007) visualizes:

- **ORPAR Cycle Diagram**: See which phase each agent is in (Observe → Reason → Plan → Act → Reflect)
- **Phase Timeline**: Real-time log of all ORPAR phase events
- **Question/Answer History**: Complete log of all questions and answers
- **Player Cards**: Thinker and Guesser status with thinking indicators
- **Game State**: Questions remaining, category hint, winner announcement

### Watch ORPAR in Action

The console will show ORPAR phases as they occur:

```
[ORPAR] GUESSER -> OBSERVE
[THINKING] agent-guesser: Looking at the question history...
[ORPAR] GUESSER -> REASON
[THINKING] agent-guesser: Based on the "yes" to "Is it alive?"...
[ORPAR] GUESSER -> PLAN
[THINKING] agent-guesser: I'll ask about whether it's a mammal...
[ORPAR] GUESSER -> ACT
[RESPONSE] agent-guesser: Is it a mammal?
[ORPAR] GUESSER -> REFLECT
```

## Key Differences from Other Examples

| Feature | Tic-Tac-Toe | Go Fish | Twenty Questions |
|---------|-------------|---------|------------------|
| SystemLLM | Disabled | Disabled | **Enabled** |
| ORPAR Events | Not used | Not used | **Tracked** |
| Phase Prompts | No | No | **Yes** |
| Reasoning | Optional | Optional | **Enabled** |

## Understanding the Code

### State Management Between Turns

A critical pattern in turn-based ORPAR applications is clearing state between turns. Without this, agents accumulate context from previous turns which can lead to:

1. **Context overflow**: Conversation history grows unbounded
2. **ORPAR state confusion**: Agents see old phase calls and try to continue from wrong phase
3. **Tool authorization errors**: Phase-gating resets to OBSERVE but ORPAR state still shows old phase

**The solution: Clear both conversation history AND ORPAR state between turns:**

```typescript
// Before each turn
for (const [role, agent] of Object.entries(agents)) {
    // Clear conversation history for fresh context
    const memoryManager = agent.getMemoryManager?.();
    if (memoryManager?.clearConversationHistory) {
        memoryManager.clearConversationHistory();
    }

    // Clear ORPAR state via EventBus
    EventBus.client.emit(OrparEvents.CLEAR_STATE, createBaseEventPayload(
        OrparEvents.CLEAR_STATE,
        agentId,
        channelId,
        { reason: 'New turn starting' },
        { source: 'TwentyQuestions' }
    ));
}
```

Additionally, the `orpar_status` tool has automatic stale state detection - if the phase-gated tools show `orpar_observe` is available but the tracked state shows a different phase, the state is automatically cleared.

### Game State in Task Descriptions

Each turn's task description includes a complete game state summary since conversation history is cleared:

```typescript
taskDescription = `## Your Turn (Question ${state.questionsAsked + 1}/20)

Your conversation history has been cleared for fresh context.

### Current Game State:
- Category: ${state.category}
- Questions asked: ${state.questionsAsked}/${state.maxQuestions}
- Previous Q&A:
  Q1: "Is it alive?" → YES
  Q2: "Is it a mammal?" → NO

### Required ORPAR Sequence:
1. orpar_observe - Document current state
2. orpar_reason - Analyze patterns
3. orpar_plan - Decide strategy
4. orpar_act - Execute game action
5. orpar_reflect - Record learnings
6. task_complete - Signal completion`;
```

### ORPAR Event Tracking

```typescript
// In connect-agents.ts
channel.on(Events.ControlLoop.OBSERVATION, (payload) => {
    console.log(`[ORPAR] ${role} -> OBSERVE`);
    // Send to game server for logging
});

channel.on(Events.ControlLoop.REASONING, (payload) => {
    console.log(`[ORPAR] ${role} -> REASON`);
});
// ... etc for PLAN, ACTION, REFLECTION
```

### Phase-Aware Prompting

The agents receive phase-specific guidance via the system prompt:

```
Current ORPAR Phase: Reason
Focus on analyzing observations and considering options.
```

This is powered by the `PromptTemplateReplacer` which replaces `{{CURRENT_ORPAR_PHASE}}` and `{{CURRENT_ORPAR_PHASE_GUIDANCE}}` at runtime.

### SystemLLM Integration

Unlike the other game examples, Twenty Questions enables `systemLlmEnabled: true`:

```typescript
const channel = await sdk.createChannel(channelId, {
    systemLlmEnabled: true,  // Enable ORPAR orchestration
    // ...
});
```

This allows the server-side control loop to orchestrate the cognitive cycle.

## Files

```
twenty-questions/
├── connect-agents.ts           # Main orchestration script
├── package.json
├── tsconfig.json
├── README.md
├── client/                     # Vue.js Dashboard
│   ├── src/
│   │   ├── App.vue             # Main dashboard component
│   │   └── main.ts             # Vue entry point
│   ├── index.html
│   ├── package.json
│   └── vite.config.ts
└── server/
    ├── types/
    │   └── game.ts             # TypeScript interfaces
    ├── engine/
    │   └── GameStateManager.ts # Game logic & state
    ├── mcp/
    │   └── TwentyQuestionsMcpServer.ts  # MCP tool server
    └── server/
        └── GameServer.ts       # Express + Socket.IO server
```

## Learning Objectives

After studying this example, you should understand:

1. **How ORPAR orchestrates agent cognition** - The 5-phase cycle and how it applies to problem-solving
2. **Event-based phase tracking** - How to observe and log ORPAR phases
3. **Phase-aware prompting** - How agents receive contextual guidance based on current phase
4. **SystemLLM integration** - How server-side LLM enhances agent coordination
5. **Custom MCP tools** - Building game-specific tools that work with ORPAR
6. **Real-time visualization** - Building dashboards that show AI cognition in action

## Extending This Example

Ideas for enhancement:

1. **Multiple Guessers**: Team of agents collaborating to guess
2. **Learning Mode**: Agent improves strategy across games
3. **Difficulty Levels**: Adjust secret complexity or question limit
4. **Phase Analytics**: Track and display ORPAR phase timing statistics
