# Twenty Questions: Advanced MXF Features Demo

This example demonstrates **advanced MXF features** using the classic 20 Questions game. Two AI agents play against each other, with each question/answer cycle showcasing ORPAR, Knowledge Graphs, MULS memory learning, and TensorFlow ML risk assessment.

## Features Demonstrated

| Feature | Description | Where |
|---------|-------------|-------|
| **ORPAR Cognitive Cycle** | Observe-Reason-Plan-Act-Reflect loop | Both agents, every turn |
| **Knowledge Graph** | Guesser builds explicit model of possibility space | OBSERVE (read), ACT (write) |
| **MULS** | Q-value weighted memory utility tracking | REFLECT phase rewards |
| **TensorFlow ML** | Risk assessment for guess timing | REASON phase scoring |
| **ORPAR-Memory Integration** | Phase-aware memory strata routing | When enabled via env flag |
| **Phase-Gated Tools** | Dynamic tool access based on ORPAR phase | All phases |
| **Custom MCP Tools** | Game-specific tool server | All game actions |

## Why Twenty Questions?

Twenty Questions is the perfect game to demonstrate these features because:

1. **Clear Cognitive Phases**: Each turn requires distinct mental operations
2. **Observable Reasoning**: You can see the agent's deductive logic in action
3. **Knowledge Building**: The Guesser naturally builds a model of what's known
4. **Strategic Depth**: Risk assessment maps naturally to "should I guess now?"
5. **Simple Rules**: Easy to understand, making the feature patterns clear

## ORPAR in Action

### Guesser's Cognitive Cycle (per question)

```
+---------------------------------------------------------------------+
|                    GUESSER'S ORPAR CYCLE                            |
+---------------------------------------------------------------------+
|                                                                     |
|   OBSERVE ---------> Review history, query KG, detect anomalies    |
|      |               "I've learned it's alive, not a mammal"       |
|      v                                                              |
|   REASON ----------> Analyze patterns, calculate risk score         |
|      |               "Risk 35% - keep asking. Could be bird..."    |
|      v                                                              |
|   PLAN ------------> Decide strategy for this turn                  |
|      |               "Ask about size to eliminate categories"       |
|      v                                                              |
|   ACT -------------> Execute: ask question, update knowledge graph  |
|      |               "Is it smaller than a house cat?" + KG update |
|      v                                                              |
|   REFLECT ---------> Inject MULS reward, review Q-value analytics   |
|                      "Answer YES - rewarding the size strategy"     |
|                                                                     |
+---------------------------------------------------------------------+
```

### Thinker's Cognitive Cycle (per answer)

```
+---------------------------------------------------------------------+
|                    THINKER'S ORPAR CYCLE                            |
+---------------------------------------------------------------------+
|                                                                     |
|   OBSERVE ---------> Read question, detect answer consistency       |
|      |               "Is it found in water?"                        |
|      v                                                              |
|   REASON ----------> Consider how question applies to secret        |
|      |               "My secret is 'goldfish' - yes, found in      |
|      |                water"                                        |
|      v                                                              |
|   ACT -------------> Answer honestly                                |
|      |               Answer: "YES"                                  |
|      v                                                              |
|   REFLECT ---------> Consider what guesser might deduce, reward     |
|                      "They now know it's aquatic..."                |
|                                                                     |
+---------------------------------------------------------------------+
```

## Architecture

```
+---------------------------------------------------------------------+
|                    connect-agents.ts                                 |
|                  (Orchestration Script)                              |
|  - Creates agents with ORPAR-aware prompts                          |
|  - Tracks ORPAR + KG + MULS + TF events                            |
|  - Manages game loop and event forwarding                           |
+-------------------------------+-------------------------------------+
                                |
          +---------------------+---------------------+
          |                     |                     |
          v                     v                     v
  +---------------+   +------------------+   +-------------------+
  |  MXF Server   |   |  Game Server     |   | MCP Tool Server   |
  |  (Port 3001)  |   |  (Port 3006)     |   | (stdio -> HTTP)   |
  |               |   |                  |   |                   |
  | * ORPAR       |   | * Game State     |   | * game_getState   |
  |   Events      |   | * KG tracking    |   | * game_setSecret  |
  | * KG Events   |   | * Risk tracking  |   | * game_askQ...    |
  | * MULS Events |   | * MULS tracking  |   | * game_answerQ... |
  | * TF Events   |   | * WebSocket      |   | * game_makeGuess  |
  | * SystemLLM   |   | * REST API       |   |                   |
  +---------------+   +------------------+   +-------------------+
```

## Tools

### Game Tools

| Tool | Role | Description |
|------|------|-------------|
| `game_getState` | Both | Get current game state (question history, remaining questions) |
| `game_setSecret` | Thinker | Set the secret thing and category at game start |
| `game_askQuestion` | Guesser | Ask a yes/no question about the secret |
| `game_answerQuestion` | Thinker | Answer the most recent question honestly |
| `game_makeGuess` | Guesser | Make a final guess about the secret thing |

### Knowledge Graph Tools (Guesser primary)

| Tool | Phase | Description |
|------|-------|-------------|
| `kg_get_entity` | OBSERVE | Query a known entity |
| `kg_get_neighbors` | OBSERVE | Get connected entities |
| `kg_get_phase_context` | OBSERVE | Get phase-appropriate KG context |
| `kg_create_entity` | ACT | Create entity (property, candidate, eliminated) |
| `kg_create_relationship` | ACT | Create relationship between entities |
| `kg_extract_from_text` | ACT | Auto-extract entities from text |

### MULS Tools

| Tool | Phase | Description |
|------|-------|-------------|
| `memory_inject_reward` | REFLECT | Reward effective strategies/memories |
| `memory_qvalue_analytics` | REFLECT | Review Q-value statistics |

### ML/TensorFlow Tools

| Tool | Phase | Description |
|------|-------|-------------|
| `calculate_risk` | REASON | Risk score for "guess now vs ask more" |
| `detect_anomalies` | OBSERVE | Check for answer pattern inconsistencies |

## Running the Demo

### Prerequisites

1. MXF Server running on port 3001 (`bun run start:dev` in root)
2. MongoDB running locally
3. Environment variables in `.env`:
   - `MXF_DOMAIN_KEY`
   - `OPENROUTER_API_KEY`

### Start the Game (with Dashboard)

```bash
cd examples/twenty-questions
npm install
cd client && npm install && cd ..
bun run game
```

This starts both the game agents and the Vue.js dashboard at http://localhost:3007

### Start Without Dashboard (Console Only)

```bash
cd examples/twenty-questions
npm install
bun run connect-agents
```

### Dashboard Features

The Vue.js dashboard (port 3007) visualizes:

- **ORPAR Cycle Diagram**: Per-agent ORPAR phase indicators with summaries
- **Phase Timeline**: Real-time log of all ORPAR phase events with MULS reward indicators
- **Knowledge Model Panel**: Guesser's mental model (confirmed properties, candidates, eliminated)
- **Risk Gauge**: ML-based risk score in the Guesser card (green/yellow/red)
- **Question/Answer History**: Complete log of all questions and answers
- **Player Cards**: Thinker and Guesser status with thinking indicators
- **Game State**: Questions remaining, category hint, winner announcement

### Watch Features in Action

The console shows all feature events as they occur:

```
[ORPAR] GUESSER -> OBSERVE
  [KG] Entity: "alive" (property, confidence: 0.9)
[ORPAR] GUESSER -> REASON
  [TF/Risk] Risk score: 25% | Confidence: 60% | ask_more
[ORPAR] GUESSER -> PLAN
[ORPAR] GUESSER -> ACT
  [KG] Relationship: "secret" -[has_property]-> "not_mammal"
[ORPAR] GUESSER -> REFLECT
  [MULS] Reward attributed: 0.8 to 2 memories - effective elimination strategy
```

## Key Differences from Other Examples

| Feature | Tic-Tac-Toe | Go Fish | Twenty Questions |
|---------|-------------|---------|------------------|
| SystemLLM | Disabled | Disabled | **Enabled** |
| ORPAR Events | Not used | Not used | **Tracked** |
| Knowledge Graph | Not used | Not used | **Guesser model** |
| MULS | Not used | Not used | **Strategy rewards** |
| TensorFlow ML | Not used | Not used | **Risk scoring** |
| Phase-Gated Tools | Not used | Not used | **Dynamic gating** |

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

    // Clear ORPAR state directly for synchronous guarantee
    clearAgentOrparState(agentId, channelId);
}
```

### Phase-Gated Tool Configuration

Tools are dynamically restricted based on ORPAR phase:

```typescript
const PHASE_TOOLS = {
    observe: ['orpar_observe', 'game_getState', 'kg_get_entity', 'kg_get_neighbors',
              'kg_get_phase_context', 'detect_anomalies', ...memoryReadTools],
    reason:  ['orpar_reason', 'calculate_risk'],
    plan:    ['orpar_plan', 'planning_create', 'planning_view'],
    act:     { // Role-specific
        thinker: ['orpar_act', 'game_setSecret', 'game_answerQuestion'],
        guesser: ['orpar_act', 'game_askQuestion', 'game_makeGuess',
                  'kg_create_entity', 'kg_create_relationship', 'kg_extract_from_text']
    },
    reflect: ['orpar_reflect', 'task_complete', 'memory_inject_reward',
              'memory_qvalue_analytics', ...memoryWriteTools]
};
```

### Event Tracking

The orchestration script listens for events from multiple MXF subsystems:

```typescript
// ORPAR events
channel.on(Events.Orpar.OBSERVE, ...)
channel.on(Events.Orpar.REASON, ...)

// Knowledge Graph events
channel.on(Events.KnowledgeGraph.ENTITY_CREATED, ...)
channel.on(Events.KnowledgeGraph.RELATIONSHIP_CREATED, ...)

// MULS events
channel.on(Events.MemoryUtility.REWARD_ATTRIBUTED, ...)
channel.on(Events.MemoryUtility.QVALUE_UPDATED, ...)

// TensorFlow events
channel.on(Events.TensorFlow.INFERENCE_COMPLETED, ...)
channel.on(Events.TensorFlow.INFERENCE_FALLBACK, ...)
```

### ORPAR-Memory Integration

When `ORPAR_MEMORY_INTEGRATION_ENABLED=true`, the PhaseStrataRouter automatically routes memory queries to appropriate strata:

| Phase | Strata | Lambda | Rationale |
|-------|--------|--------|-----------|
| OBSERVE | Working + Short-term | 0.2 | Recent context, semantic accuracy |
| REASON | Episodic + Semantic | 0.5 | Balanced explore/exploit |
| PLAN | Semantic + Long-term | 0.7 | Proven strategies |
| ACT | Working + Short-term | 0.3 | Grounded execution |
| REFLECT | All strata | 0.6 | Holistic review |

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
    │   └── game.ts             # TypeScript interfaces (incl. KG, risk, MULS types)
    ├── engine/
    │   └── GameStateManager.ts # Game logic & state (incl. KG/risk/MULS tracking)
    ├── mcp/
    │   └── TwentyQuestionsMcpServer.ts  # MCP tool server
    └── server/
        └── GameServer.ts       # Express + Socket.IO server (incl. KG/risk/MULS endpoints)
```

## Learning Objectives

After studying this example, you should understand:

1. **How ORPAR orchestrates agent cognition** - The 5-phase cycle and how it applies to problem-solving
2. **Knowledge Graph integration** - How agents build and query explicit knowledge models
3. **MULS memory learning** - How Q-value rewards improve memory retrieval over time
4. **ML risk assessment** - How TensorFlow tools provide decision support
5. **Phase-gated tool access** - How to dynamically restrict tools based on cognitive phase
6. **Event-based tracking** - How to observe and log events from multiple MXF subsystems
7. **Real-time visualization** - Building dashboards that show AI cognition and knowledge building
8. **ORPAR-Memory integration** - Phase-aware memory strata routing
