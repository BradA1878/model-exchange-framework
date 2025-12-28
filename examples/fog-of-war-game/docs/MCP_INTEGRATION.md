# MCP Integration Guide

## Overview

The Fog of War game uses the **Model Context Protocol (MCP)** to expose game tools to AI commanders. This document explains how the integration works and leverages MXF's built-in OpenAI function call conversion.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  AI Commander Agents (8 agents)                     │
│  - Use game tools via MCP protocol                  │
│  - Tools appear as OpenAI function calls to LLM     │
└──────────────────┬──────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────┐
│  MXF SDK + OpenRouterMcpClient                      │
│  - Converts MCP tools → OpenAI function format      │
│  - Handles tool execution and result routing        │
│  - OpenRouterMessageAdapter does the conversion     │
└──────────────────┬──────────────────────────────────┘
                   │ JSON-RPC over stdio
                   ▼
┌─────────────────────────────────────────────────────┐
│  FogOfWarMcpServer (MCP Server)                     │
│  - Implements MCP protocol (initialize, tools/list) │
│  - Returns tools in standard MCP schema format      │
│  - Executes game actions via GameTools              │
└──────────────────┬──────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────┐
│  Game Engine (GameStateManager, CombatSystem, etc.) │
│  - Manages game state, combat, fog of war           │
│  - Processes actions and resolves conflicts         │
└─────────────────────────────────────────────────────┘
```

## Key Insight: Automatic Format Conversion

**You don't need to worry about OpenAI function call format in your MCP server!**

The MXF framework automatically handles the conversion:

1. **Your MCP Server** returns tools in standard MCP format:
   ```typescript
   {
     name: 'game_moveUnits',
     description: 'Move units between territories',
     inputSchema: {
       type: 'object',
       properties: {
         from: { type: 'string', description: '...' },
         to: { type: 'string', description: '...' },
         // ... MCP standard schema
       }
     }
   }
   ```

2. **OpenRouterMcpClient** (in `src/shared/protocols/mcp/providers/OpenRouterMcpClient.ts`) automatically converts this to:
   ```typescript
   {
     type: 'function',
     function: {
       name: 'game_moveUnits',
       description: 'Move units between territories',
       parameters: {
         type: 'object',
         properties: {
           from: { type: 'string', description: '...' },
           to: { type: 'string', description: '...' },
           // ... OpenAI function call format
         }
       }
     }
   }
   ```

3. **OpenRouterMessageAdapter** (in `src/shared/protocols/mcp/converters/adapters/OpenRouterMessageAdapter.ts`) handles:
   - Converting tool calls from OpenAI format to MCP format
   - Reordering tool results to immediately follow tool calls (OpenAI requirement)
   - Preserving `tool_call_id` and `tool_calls` fields

4. **Result**: The LLM sees standard OpenAI function calls, but you only implement standard MCP protocol.

## Implementation Files

### 1. FogOfWarMcpServer.ts

**Location**: `server/mcp/FogOfWarMcpServer.ts`

**Purpose**: Implements MCP protocol to expose game tools

**Key Methods**:
- `handleMessage(request)` - Routes MCP JSON-RPC requests
- `initialize` - Returns server capabilities
- `tools/list` - Returns array of 7 game tools in MCP format
- `tools/call` - Executes requested tool with GameTools

**MCP Protocol Implementation**:
```typescript
switch (method) {
  case 'initialize':
    return {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'fog-of-war-game-mcp-server', version: '1.0.0' }
    };

  case 'tools/list':
    return {
      tools: [
        {
          name: 'game_viewTerritory',
          description: 'View territory details with fog of war',
          inputSchema: {
            type: 'object',
            properties: {
              territoryIds: {
                type: 'array',
                items: { type: 'string' },
                description: 'Array of territory IDs'
              }
            },
            required: ['territoryIds']
          }
        },
        // ... 6 more tools
      ]
    };

  case 'tools/call':
    const result = this.gameTools.moveUnits(...);
    return {
      content: [{ type: 'text', text: JSON.stringify(result) }]
    };
}
```

**Transport**: JSON-RPC over stdio (stdin/stdout)

### 2. connect-agents.ts

**Location**: `connect-agents.ts`

**Purpose**: Main entry point that connects everything together

**Steps**:
1. Start Game Server (Express + Socket.IO)
2. Connect to MXF Server (SDK)
3. Create game channel
4. Register FogOfWarMcpServer via `agent.registerExternalMcpServer()`
5. Create 8 commander agents with game tools in `allowedTools`
6. Agents autonomously execute game turns

**Key Code**:
```typescript
// Register custom MCP server
const mcpResult = await adminAgent.registerExternalMcpServer({
  id: 'fog-of-war-game-server',
  name: 'Fog of War Game Tools',
  command: 'ts-node',
  args: ['./server/mcp/FogOfWarMcpServer.ts'],
  autoStart: true
});

// Create commander agents with game tools
const agent = await sdk.createAgent({
  agentId: 'red-scout',
  channelId: channelId,
  allowedTools: [
    'game_viewTerritory',
    'game_moveUnits',
    'game_scanPerimeter',
    // ... etc
  ],
  agentConfigPrompt: `You are Red Scout Alpha...`
});
```

### 3. GameTools.ts

**Location**: `server/mcp/GameTools.ts`

**Purpose**: Business logic for game actions

**Note**: This file remains unchanged! It implements game logic without worrying about MCP or OpenAI formats.

## 7 Game Tools

All tools respect fog of war limitations:

1. **game_viewTerritory** - View specific territory details
2. **game_scanPerimeter** - Scout visible area (essential for reconnaissance)
3. **game_moveUnits** - Move units between territories (combat if enemy present)
4. **game_fortifyPosition** - Strengthen defenses (+20% per level, max 5)
5. **game_collectResources** - Gather resources from controlled territories
6. **game_getTeamStatus** - Get team status for coordination
7. **game_calculateOptimalPath** - Pathfinding with risk assessment

## Running the Demo

### Prerequisites

1. MXF server running:
   ```bash
   cd /path/to/model-exchange-framework-private
   npm run dev
   ```

2. Environment variables in `.env`:
   ```env
   MXF_SERVER_URL=http://localhost:3001
   MXF_DOMAIN_KEY=your-domain-key
   OPENROUTER_API_KEY=your-api-key
   ```

### Start the Game

**Option 1: Full Game (Recommended)**
```bash
cd examples/fog-of-war-game
npm run game
```
This starts both the agent connection and Vue client dashboard.

**Option 2: Agents Only**
```bash
cd examples/fog-of-war-game
npm run connect-agents
```

**Option 3: Separate Windows**
```bash
# Terminal 1: Agent connection
npm run connect-agents

# Terminal 2: Vue dashboard
cd client && npm run dev
```

### What Happens

1. Game server starts on port 3002
2. 8 commanders initialize with starting positions
3. MCP server registers and exposes tools
4. Agents connect and discover tools
5. **Autonomous gameplay begins!**
   - Scouts explore with `game_scanPerimeter()`
   - Warriors attack with `game_moveUnits()`
   - Defenders fortify with `game_fortifyPosition()`
   - Support collects with `game_collectResources()`
   - All coordinate via `messaging_send()`

## How Tool Execution Works

### 1. Agent Decides to Use Tool

LLM sees OpenAI function call format (automatically converted by framework):
```json
{
  "role": "assistant",
  "content": null,
  "tool_calls": [{
    "id": "call_abc123",
    "type": "function",
    "function": {
      "name": "game_moveUnits",
      "arguments": "{\"from\":\"A1\",\"to\":\"B2\",\"unitType\":\"infantry\",\"count\":50}"
    }
  }]
}
```

### 2. Framework Routes to MCP Server

MXF SDK:
- Extracts tool call
- Adds `_commanderId` from agent context
- Sends JSON-RPC request to FogOfWarMcpServer:

```json
{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "params": {
    "name": "game_moveUnits",
    "arguments": {
      "_commanderId": "red-scout",
      "from": "A1",
      "to": "B2",
      "unitType": "infantry",
      "count": 50
    }
  }
}
```

### 3. MCP Server Executes

```typescript
case 'game_moveUnits':
  result = this.gameTools.moveUnits(
    commanderId,  // Extracted from arguments
    toolArgs.from,
    toolArgs.to,
    toolArgs.unitType,
    toolArgs.count
  );
  break;
```

### 4. Result Returns to Agent

MCP format:
```json
{
  "jsonrpc": "2.0",
  "result": {
    "content": [{
      "type": "text",
      "text": "{\"success\":true,\"message\":\"Moving 50 infantry...\"}"
    }]
  }
}
```

Framework converts to OpenAI format:
```json
{
  "role": "tool",
  "tool_call_id": "call_abc123",
  "content": "{\"success\":true,\"message\":\"Moving 50 infantry...\"}"
}
```

### 5. Agent Processes Result

LLM receives tool result in conversation and continues reasoning.

## Benefits of This Architecture

✅ **Standard MCP Protocol** - Works with any MCP-compatible system  
✅ **Automatic Conversion** - OpenAI format handled by framework  
✅ **Clean Separation** - Game logic, MCP server, and agents are independent  
✅ **Type Safety** - Input schemas validated automatically  
✅ **Tool Discovery** - Agents can list available tools  
✅ **Hot Reload** - Register/unregister servers without restart  
✅ **Agent Context** - Commander ID injected automatically  
✅ **No HTTP** - Everything over WebSocket/stdio (faster, cleaner)

## Troubleshooting

### Tools Not Discovered

**Issue**: Agents can't see game tools

**Solution**: 
1. Check MCP server registered successfully (look for "Tools discovered" message)
2. Verify tools are in agent's `allowedTools` array
3. Check MCP server is running (`ps aux | grep FogOfWarMcpServer`)

### Tool Execution Fails

**Issue**: Tool calls return errors

**Solution**:
1. Check `_commanderId` is being injected (MXF does this automatically)
2. Verify game state is initialized (`GAME_STATE_ID` environment variable)
3. Check GameTools has access to GameStateManager

### OpenAI Format Issues

**Issue**: Tool calls malformed or not recognized

**Solution**: 
- **Don't worry about this!** The framework handles OpenAI format conversion automatically
- If you see format issues, it's likely a framework bug, not your MCP server
- Your MCP server should only implement standard MCP protocol

## References

- [MCP Protocol Specification](https://spec.modelcontextprotocol.io/)
- [OpenRouter API Documentation](https://openrouter.ai/docs)
- [MXF External MCP Example](../../external-mcp-registration/)
- [OpenRouterMcpClient Source](../../../src/shared/protocols/mcp/providers/OpenRouterMcpClient.ts)
- [OpenRouterMessageAdapter Source](../../../src/shared/protocols/mcp/converters/adapters/OpenRouterMessageAdapter.ts)

## Next Steps

1. **Run the demo** - See autonomous AI strategy in action
2. **Study agent behavior** - Watch how commanders coordinate
3. **Modify personalities** - Change commander strategies in `connect-agents.ts`
4. **Add new tools** - Extend GameTools and register in MCP server
5. **Create your own game** - Use this as a template for MCP-based applications

---

**The key takeaway**: Implement standard MCP protocol in your server. The framework automatically handles OpenAI function call conversion. You focus on game logic, MXF handles the rest.
