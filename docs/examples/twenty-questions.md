# Twenty Questions: Advanced MXF Features Demo

A classic guessing game demonstrating advanced MXF features -- ORPAR cognitive cycles, Knowledge Graph, MULS memory learning, and TensorFlow ML risk assessment -- with two AI agents playing as Thinker and Guesser.

## Overview

This example showcases how multiple MXF subsystems work together in a real application. Each question/answer cycle exercises ORPAR phase-gated tools, Knowledge Graph entity tracking, MULS reward attribution, and ML-based risk scoring.

- **Thinker Agent** - Chooses a secret and answers yes/no questions using ORPAR
- **Guesser Agent** - Uses deductive reasoning with KG, MULS, and TF risk assessment to identify the secret in 20 questions or less

## Key MXF Features Demonstrated

| Feature | Description | Where |
|---------|-------------|-------|
| **ORPAR Cognitive Cycle** | Observe-Reason-Plan-Act-Reflect loop | Both agents, every turn |
| **Knowledge Graph** | Guesser builds explicit model of possibility space | OBSERVE (read), ACT (write) |
| **MULS** | Q-value weighted memory utility tracking | REFLECT phase rewards |
| **TensorFlow ML** | Risk assessment for guess timing | REASON phase scoring |
| **ORPAR-Memory Integration** | Phase-aware memory strata routing | When enabled via env flag |
| **Phase-Gated Tools** | Dynamic tool access based on ORPAR phase | All phases |
| **Custom MCP Tools** | Game-specific tool server | All game actions |

### 1. ORPAR Cognitive Cycle

Agents use the full ORPAR cycle each turn. The Guesser's cycle is the most feature-rich:

```
OBSERVE ----> Review history, query KG, detect anomalies
   |          "I've learned it's alive, not a mammal"
   v
REASON -----> Analyze patterns, calculate risk score
   |          "Risk 35% - keep asking. Could be bird..."
   v
PLAN -------> Decide strategy for this turn
   |          "Ask about size to eliminate categories"
   v
ACT --------> Execute: ask question, update knowledge graph
   |          "Is it smaller than a house cat?" + KG update
   v
REFLECT ----> Inject MULS reward, review Q-value analytics
              "Answer YES - rewarding the size strategy"
```

### 2. Knowledge Graph Integration

The Guesser builds an explicit knowledge model during the game using KG tools:

- **OBSERVE phase**: `kg_get_entity`, `kg_get_neighbors`, `kg_get_phase_context` -- query what is known
- **ACT phase**: `kg_create_entity`, `kg_create_relationship`, `kg_extract_from_text` -- record new knowledge

Entities include properties (confirmed facts), candidates (possible answers), and eliminated options.

### 3. MULS Memory Learning

During the REFLECT phase, agents attribute rewards to effective strategies:

- `memory_inject_reward` -- reward memories associated with successful question strategies
- `memory_qvalue_analytics` -- review Q-value statistics to understand which approaches work

### 4. TensorFlow ML Risk Assessment

ML tools provide decision support during the reasoning phase:

- `calculate_risk` (REASON phase) -- risk score for "guess now vs. ask more questions"
- `detect_anomalies` (OBSERVE phase) -- check for answer pattern inconsistencies

### 5. Phase-Gated Tool Access

Tools are dynamically restricted based on the current ORPAR phase:

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

### 6. Channel-Scoped MCP Server

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

## Tools Reference

### Game Tools

| Tool | Role | Description |
|------|------|-------------|
| `game_getState` | Both | Get current game state (question history, remaining questions) |
| `game_setSecret` | Thinker | Set the secret thing and category at game start |
| `game_askQuestion` | Guesser | Ask a yes/no question about the secret |
| `game_answerQuestion` | Thinker | Answer the most recent question honestly |
| `game_makeGuess` | Guesser | Make a final guess about the secret thing |

### Knowledge Graph Tools (Guesser Primary)

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

1. MXF server running on port 3001 (`bun run start:dev` in root)
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

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/api/game/state` | GET | Get full game state |
| `/api/game/chat` | GET | Get chat/event history |
| `/api/game/orpar` | GET | Get ORPAR phase events |
| `/api/events/knowledge` | GET | Get Knowledge Graph events |
| `/api/events/risk` | GET | Get risk assessment events |
| `/api/events/muls` | GET | Get MULS reward events |
| `/api/game/start` | POST | Start the game |
| `/api/game/reset` | POST | Reset the game |

### Dashboard Features

The Vue.js dashboard (port 3007) visualizes:

- **ORPAR Cycle Diagram**: Per-agent ORPAR phase indicators with summaries
- **Phase Timeline**: Real-time log of all ORPAR phase events with MULS reward indicators
- **Knowledge Model Panel**: Guesser's mental model (confirmed properties, candidates, eliminated)
- **Risk Gauge**: ML-based risk score in the Guesser card (green/yellow/red)
- **Question/Answer History**: Complete log of all questions and answers
- **Player Cards**: Thinker and Guesser status with thinking indicators
- **Game State**: Questions remaining, category hint, winner announcement

## Sample Output

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

## Event Tracking

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

## ORPAR-Memory Integration

When `ORPAR_MEMORY_INTEGRATION_ENABLED=true`, the PhaseStrataRouter automatically routes memory queries to appropriate strata:

| Phase | Strata | Lambda | Rationale |
|-------|--------|--------|-----------|
| OBSERVE | Working + Short-term | 0.2 | Recent context, semantic accuracy |
| REASON | Episodic + Semantic | 0.5 | Balanced explore/exploit |
| PLAN | Semantic + Long-term | 0.7 | Proven strategies |
| ACT | Working + Short-term | 0.3 | Grounded execution |
| REFLECT | All strata | 0.6 | Holistic review |

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

## Key Differences from Other Examples

| Feature | Tic-Tac-Toe | Go Fish | Twenty Questions |
|---------|-------------|---------|------------------|
| SystemLLM | Disabled | Disabled | **Enabled** |
| ORPAR Events | Not used | Not used | **Tracked** |
| Knowledge Graph | Not used | Not used | **Guesser model** |
| MULS | Not used | Not used | **Strategy rewards** |
| TensorFlow ML | Not used | Not used | **Risk scoring** |
| Phase-Gated Tools | Not used | Not used | **Dynamic gating** |

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

## Related Documentation

- [ORPAR Cognitive Cycle](../mxf/orpar.md) - Deep dive into ORPAR
- [Tool Reference - ORPAR Tools](../mxf/tool-reference.md#control-loop--orpar) - All ORPAR tools
- [Channel-Scoped MCP](../sdk/channel-mcp-servers.md) - Registering game tools
- [Knowledge Graph](../features/dag-knowledge-graph.md) - KG entity and relationship operations
- [MULS](../mxf/memory-utility-learning.md) - Memory Utility Learning System
- [TensorFlow.js Integration](../mxf/index.md#tensorflow) - On-device ML models

## Source Code

See the full implementation and developer README in [`examples/twenty-questions/`](../../examples/twenty-questions/README.md).
