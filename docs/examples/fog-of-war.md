# Fog of War: Parallel Minds

A browser-based team strategy game demonstrating MXF's multi-agent orchestration capabilities. Two teams of four AI commanders compete for resources through parallel decision-making with limited information.

## Overview

This demo showcases:

- **8 AI commanders** (4 per team) with distinct roles and personalities
- **Parallel execution** of autonomous agent decisions
- **Fog of war** system with limited information per agent
- **Real-time coordination** between teammates
- **Turn-based gameplay** with conflict resolution
- **WebSocket updates** for live visualization

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Game Server (Express)                    │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ Game State   │  │  Turn        │  │   MCP        │      │
│  │ Manager      │  │  Orchestrator│  │   Tools      │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└─────────────────────────────────────────────────────────────┘
                            ↕
┌─────────────────────────────────────────────────────────────┐
│                      MXF Server                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ Agent        │  │  Channel     │  │   MCP        │      │
│  │ Management   │  │  Service     │  │   Registry   │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└─────────────────────────────────────────────────────────────┘
```

## Key MXF Features Demonstrated

### 1. Channel-Scoped MCP Server Registration

The administrator SDK registers a channel-scoped MCP process so all game tools are
available only within the game channel. The user session must have the
`administrator` role, and the MXF server operator must set
`MXF_UNSAFE_STDIO_MCP_ENABLED=true`:

```typescript
const mcpResult = await sdk.registerChannelMcpServer('fog-of-war-game', {
    id: 'fog-of-war-game-server',
    name: 'Fog of War Game Tools',
    transport: 'stdio',
    command: 'bun',
    args: ['run', './examples/fog-of-war-game/server/mcp/FogOfWarMcpServerHttp.ts'],
    autoStart: true,
    keepAliveMinutes: 10,
    environmentVariables: {
        GAME_SERVER_URL: 'http://localhost:3002'
    }
});

console.log('Tools discovered:', mcpResult.toolsDiscovered);
// ['game_getState', 'game_scanPerimeter', 'game_moveUnit',
//  'game_attack', 'game_gather', 'game_commitTurn']
```

The registered child process speaks MCP over `stdio`. It acts as an adapter to the
game's HTTP API; MXF does not register that API as an HTTP MCP transport.

### 2. Custom MCP Tools

The game implements custom MCP tools for game mechanics:

| Tool | Description |
|------|-------------|
| `game_getState` | Get current game state for a commander |
| `game_scanPerimeter` | Scan surrounding territory |
| `game_moveUnit` | Move units on the map |
| `game_attack` | Attack enemy units or structures |
| `game_gather` | Gather resources |
| `game_commitTurn` | Commit actions for the turn |

### 3. Multi-Agent Parallel Execution

All commanders make decisions simultaneously within each turn:

```typescript
// Orchestrator prompts all commanders in parallel
await Promise.all(commanders.map(commander =>
    promptAgent(commander, turnContext)
));
```

### 4. Task-Based Turn Management

Each turn is managed as a task, allowing proper lifecycle tracking:

```typescript
const turnTaskId = await commander.mxfService.createTask({
    title: `Turn ${turnNumber} - ${commander.name}`,
    description: 'Make your strategic decisions',
    assignedAgentIds: [commander.agentId]
});
```

## Running the Demo

### Prerequisites

1. MXF server running:
   ```bash
   bun run dev
   ```

2. Install dependencies:
   ```bash
   cd examples/fog-of-war-game
   bun install
   cd client && bun install && cd ..
   ```

### Start the Game

```bash
bun run game
```

Or use the root package script:

```bash
bun run demo:fog-of-war
```

## Game Mechanics

### Teams

- **Red Team**: Aggressive expansion strategy
- **Blue Team**: Defensive resource gathering

### Commander Roles

Each team has 4 specialized commanders:

1. **Scout Commander** - Exploration and reconnaissance
2. **Battle Commander** - Combat and attack coordination
3. **Resource Commander** - Resource gathering and economy
4. **Strategic Commander** - Overall planning and coordination

### Fog of War

Each commander can only see:
- Tiles within their units' vision range
- Previously explored tiles (grayed out)
- Allied units and their immediate surroundings

## Learning Points

This demo showcases:

1. **Channel-scoped MCP server registration** for game-specific tools
2. **A stdio MCP adapter** that calls the game's HTTP API
3. **Parallel agent execution** within turn-based constraints
4. **Task lifecycle management** for turn coordination
5. **Real-time WebSocket updates** for live visualization
6. **Agent personality differentiation** for varied strategies

## Source Code

See the full implementation in `examples/fog-of-war-game/`
