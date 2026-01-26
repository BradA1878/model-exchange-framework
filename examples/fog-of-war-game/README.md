# Fog of War: Parallel Minds

A browser-based team strategy game demonstrating MXF's multi-agent orchestration capabilities. Two teams of four AI commanders compete for resources through parallel decision-making with limited information.

## 🎯 Overview

This demo showcases:
- **8 AI commanders** (4 per team) with distinct roles and personalities
- **Parallel execution** of autonomous agent decisions
- **Fog of war** system with limited information per agent
- **Real-time coordination** between teammates
- **Turn-based gameplay** with conflict resolution
- **WebSocket updates** for live visualization

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Game Server (Express)                    │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ Game State   │  │  Turn        │  │   MCP        │      │
│  │ Manager      │  │  Orchestrator│  │   Tools      │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
│                                                               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ Map          │  │  Combat      │  │   Fog of     │      │
│  │ Generator    │  │  System      │  │   War        │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└─────────────────────────────────────────────────────────────┘
                            ↕
┌─────────────────────────────────────────────────────────────┐
│                    MXF Server (Socket.IO)                    │
│                                                               │
│  ┌──────────────────────────────────────────────────────┐   │
│  │           8 AI Commander Agents                       │   │
│  │  Red: Scout, Warrior, Defender, Support              │   │
│  │  Blue: Scout, Warrior, Defender, Support             │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                            ↕
┌─────────────────────────────────────────────────────────────┐
│                   Frontend Dashboard (Vue 3)                 │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │   Map    │  │  Comms   │  │  Events  │  │Analytics │   │
│  │   View   │  │  View    │  │  Log     │  │Dashboard │   │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## 🚀 Quick Start

### 1. Prerequisites

- Node.js 18+ and npm
- **Running MXF server** (see main project README):
  ```bash
  cd /path/to/model-exchange-framework-private
  bun run dev  # Starts on port 3001
  ```
- OpenRouter API key (for LLM providers)

### 2. Installation

```bash
# Install game server dependencies
cd examples/fog-of-war-game
npm install

# Install Vue 3 client dependencies
cd client
npm install
cd ..
```

### 3. Configuration

Copy the example environment file and configure:

```bash
cp .env.example .env
```

Edit `.env`:
```env
MXF_SERVER_URL=http://localhost:3001
MXF_DOMAIN_KEY=your-domain-key
MXF_USERNAME=demo-user
MXF_PASSWORD=demo-password-1234
OPENROUTER_API_KEY=your-api-key
GAME_SERVER_PORT=3002
```

### 4. Run the Demo

**Option 1 - Full Game (Recommended):**
```bash
cd examples/fog-of-war-game
bun run game
```

This starts:
- Agent connection with 8 AI commanders (port 3002)
- Vue 3 dashboard for visualization (port 3003)
- Custom MCP server with game tools
- Autonomous gameplay begins immediately!

**Option 2 - Agents Only (No Dashboard):**
```bash
cd examples/fog-of-war-game
bun run connect-agents
```

**Option 3 - Separate Terminals:**

**Terminal 1 - Agent Connection:**
```bash
cd examples/fog-of-war-game
bun run connect-agents
```

**Terminal 2 - Vue 3 Dashboard:**
```bash
cd examples/fog-of-war-game/client
bun run dev
```

### 5. Watch the Battle!

- **Dashboard**: http://localhost:3003
- **Game Server API**: http://localhost:3002/api/game/state
- **WebSocket**: ws://localhost:3002

Agents will autonomously:
- Scout territories with `game_scanPerimeter()`
- Attack enemies with `game_moveUnits()`
- Fortify positions with `game_fortifyPosition()`
- Collect resources with `game_collectResources()`
- Coordinate via `messaging_send()`

## 🎮 Game Mechanics

### Teams and Roles

**Red Team:**
- **Scout Alpha** - Reconnaissance specialist
- **Warrior Titan** - Aggressive combat commander
- **Defender Bastion** - Defensive specialist
- **Support Catalyst** - Logistics coordinator

**Blue Team:**
- **Scout Phantom** - Stealth intelligence expert
- **Warrior Tempest** - Tactical combat specialist
- **Defender Aegis** - Fortress commander
- **Support Nexus** - Strategic coordinator

### Victory Conditions

1. **Resource Control**: First team to control 60% of map resources
2. **Turn Limit**: Most resources controlled at turn 15
3. **Elimination**: Destroy all enemy commanders

### Turn Structure

1. **Planning Phase** (45 seconds) - All commanders decide actions simultaneously
2. **Execution Phase** - Actions executed, conflicts resolved
3. **Resolution Phase** - Battles resolved, resources collected
4. **Negotiation Window** (10 seconds) - Inter-team communication

### Fog of War

Each commander can only see:
- Territories they control
- Allied territories
- Enemy units within 1 tile radius
- Previously scouted areas (with limited intel)

## 🛠️ Available MCP Tools

Commanders use these tools to interact with the game:

### Information Tools
- `viewTerritory(ids)` - Get details about specific territories
- `scanPerimeter()` - Scout visible area around controlled positions
- `getTeamStatus()` - Check teammate status and resources

### Action Tools
- `moveUnits(from, to, type, count)` - Move units between territories
- `fortifyPosition(territory)` - Strengthen defenses
- `collectResources(territory)` - Gather resources from controlled areas

### Utility Tools
- `calculateOptimalPath(from, to)` - Find best route between positions
- `commitTurn()` - Signal ready for turn execution

## 📊 API Endpoints

### REST API

- `GET /health` - Server health check
- `GET /api/game/state` - Full game state (spectator view)
- `GET /api/game/commander/:id` - Commander-specific view with fog of war
- `POST /api/mcp/*` - MCP tool execution endpoints

### WebSocket Events

- `gameState` - Initial game state on connection
- `action` - Commander action executed
- `turnProgress` - Turn readiness progress
- `turnComplete` - Turn execution results
- `gameOver` - Game completion notification

## 🔧 MCP Integration

This demo uses the **Model Context Protocol (MCP)** to expose game tools to AI agents. The architecture is:

1. **FogOfWarMcpServer** - Implements MCP protocol (JSON-RPC over stdio)
2. **MXF Framework** - Automatically converts MCP tools to OpenAI function calls
3. **AI Agents** - Use tools seamlessly via OpenRouter

**Key Files**:
- `server/mcp/FogOfWarMcpServer.ts` - MCP server with 7 game tools
- `connect-agents.ts` - Main entry point connecting everything
- `docs/MCP_INTEGRATION.md` - Detailed integration guide

**Important**: You don't need to worry about OpenAI function call format! The framework's `OpenRouterMcpClient` and `OpenRouterMessageAdapter` automatically handle the conversion. Just implement standard MCP protocol.

### Example: Creating a Commander Agent

```typescript
import { MxfSDK } from 'mxf-sdk';

const sdk = new MxfSDK({
  serverUrl: process.env.MXF_SERVER_URL!,
  domainKey: process.env.MXF_DOMAIN_KEY!
});

await sdk.connect();

// Register custom MCP server with game tools
const mcpResult = await adminAgent.registerExternalMcpServer({
  id: 'fog-of-war-game-server',
  command: 'ts-node',
  args: ['./server/mcp/FogOfWarMcpServer.ts'],
  autoStart: true
});

// Create commander agent with game tools
const agent = await sdk.createAgent({
  agentId: 'red-scout',
  name: 'Red Scout Alpha',
  channelId: channelId,
  allowedTools: [
    'game_viewTerritory',
    'game_moveUnits',
    'game_scanPerimeter',
    'game_fortifyPosition',
    'game_collectResources',
    'game_getTeamStatus',
    'game_calculateOptimalPath',
    'messaging_send'
  ],
  agentConfigPrompt: `You are Red Scout Alpha, a reconnaissance specialist...`
});

await agent.connect();
```

See `connect-agents.ts` for the complete implementation with all 8 commanders.

## 🎨 Vue 3 Client Dashboard

The Vue 3 + TypeScript client provides four distinct view modes:

### 1. Map View 🗺️
- Interactive 12x12 game board
- Color-coded territory ownership (Red/Blue/Neutral)
- Resource indicators on each tile
- Unit positions with type icons
- Fortification levels
- Toggle between full visibility and fog-of-war mode
- Click tiles for detailed information

### 2. Communication View 💬
- Real-time message streaming
- Filtered channels: All Messages, Red Team, Blue Team, Cross-Team
- Message type indicators (team/enemy/system)
- Timestamp tracking
- Sender/receiver information

### 3. Decision Log View ⚡
- Real-time MCP tool call monitoring
- Filter by commander or action type
- Action status tracking (pending/executed/failed)
- Success rate analytics
- Detailed parameter inspection
- Turn-by-turn action history

### 4. Analytics Dashboard 📊
- Game progress metrics
- Actions per turn statistics
- Resource control visualization
- Team comparison statistics
- Total resources, territories, and units
- Active commander tracking
- Lead margin calculations

## 📚 Architecture Details

### Game Engine Components

1. **MapGenerator** - Procedural map generation with varied terrain
2. **FogOfWarSystem** - Visibility calculation per commander
3. **CombatSystem** - Rock-paper-scissors unit combat
4. **GameStateManager** - Central game state authority
5. **TurnOrchestrator** - Parallel execution and conflict resolution

### Key Design Patterns

- **Event-driven** - WebSocket for real-time updates
- **RESTful API** - HTTP endpoints for game queries
- **MCP Tools** - Structured interface for AI agents
- **Parallel Execution** - All 8 agents act simultaneously
- **Deterministic Resolution** - Conflicts resolved by game rules

## 🔧 Development

### Project Structure

```
fog-of-war-game/
├── server/             # Game server (Node.js + Express)
│   ├── types/          # TypeScript type definitions
│   ├── engine/         # Game engine (map, combat, state)
│   ├── mcp/            # MCP tool implementations
│   ├── server/         # Express + WebSocket server
│   └── index.ts        # Main entry point
├── client/             # Vue 3 client application
│   ├── src/            # Vue components and stores
│   ├── public/         # Static assets
│   └── package.json    # Client dependencies
├── docs/               # Documentation
├── dist/               # Compiled server code
├── package.json        # Server dependencies
└── tsconfig.json       # TypeScript config
```

### Build Commands

```bash
bun run game         # Run both server and client (recommended)
bun run dev          # Server only (development mode)
bun run dev:client   # Client only (development mode)
bun run build        # Compile server TypeScript
bun run build:client # Build client for production
bun run build:all    # Build both server and client
bun run clean        # Remove build artifacts
bun run rebuild      # Clean + build all
```

## 🎓 Learning Objectives

This demo teaches:

1. **Multi-agent coordination** - 8 agents working in parallel
2. **Information asymmetry** - Fog of war creates realistic constraints
3. **Strategic decision-making** - Agents must plan with incomplete information
4. **Emergent behavior** - Complex strategies from simple rules
5. **Real-time orchestration** - Coordinating asynchronous LLM calls

## 🐛 Troubleshooting

**Game server won't start:**
- Check `.env` configuration
- Ensure MXF server is running
- Verify port 3002 is available

**Commanders not acting:**
- Ensure AI agents are connected via MXF SDK
- Check MCP tool endpoints are accessible
- Verify OpenRouter API key is valid

**WebSocket disconnects:**
- Check network stability
- Increase ping timeout in GameServer.ts
- Review server logs for errors

## 📖 Further Reading

- **[MCP Integration Guide](./docs/MCP_INTEGRATION.md)** - Detailed explanation of MCP architecture
- **[Agent Integration Guide](./docs/AGENT_INTEGRATION.md)** - How to connect AI commanders
- [MXF Documentation](../../docs/)
- [External MCP Registration Example](../external-mcp-registration/)
- [First Contact Demo](../first-contact-demo/) - Multi-agent example
- [MCP Protocol Specification](https://spec.modelcontextprotocol.io/)

## 📄 License

MIT - See main project LICENSE file

---

**Built with ❤️ using the Model Exchange Framework (MXF)**

Showcasing the power of parallel AI agent coordination for complex strategic decision-making.
