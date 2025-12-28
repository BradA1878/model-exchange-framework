# AI Agent Integration Guide

This guide explains how to connect MXF AI agents to control commanders in the Fog of War game.

## Overview

The integration works in three layers:

```
┌─────────────────────────────────────────┐
│   MXF Agent (AI Commander)              │
│   - Autonomous decision-making          │
│   - Natural language reasoning          │
│   - Tool execution via MCP              │
└─────────────────┬───────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────┐
│   MCP Tools (Game Interface)            │
│   - viewTerritory()                     │
│   - moveUnits()                         │
│   - scanPerimeter()                     │
│   - etc.                                │
└─────────────────┬───────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────┐
│   Game Server (State & Logic)           │
│   - Game state management               │
│   - Combat resolution                   │
│   - Turn orchestration                  │
└─────────────────────────────────────────┘
```

## Integration Methods

### Method 1: Direct MCP Tool Calls (Recommended for Testing)

For testing individual commanders, you can call MCP tools directly via HTTP:

```typescript
// Example: Move units from territory A1 to B2
const response = await fetch('http://localhost:3002/api/mcp/moveUnits', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    commanderId: 'red-scout',
    from: 'A1',
    to: 'B2',
    unitType: 'infantry',
    count: 50
  })
});

const result = await response.json();
console.log(result);
// { success: true, message: "Moving 50 infantry...", ... }
```

### Method 2: MXF SDK Integration (Recommended for Full Demo)

For autonomous AI commanders, integrate using the MXF SDK:

```typescript
import { MxfSDK, LlmProviderType } from 'mxf-sdk';

// 1. Initialize SDK
const sdk = new MxfSDK({
  serverUrl: 'http://localhost:3001',
  domainKey: process.env.MXF_DOMAIN_KEY!,
  username: 'game-user',
  password: 'demo-password'
});

await sdk.connect();

// 2. Create game channel
const channel = await sdk.createChannel('fog-of-war-game-1', {
  name: 'Fog of War Battle',
  description: 'Autonomous AI strategy game',
  maxAgents: 10
});

// 3. Generate authentication key
const key = await sdk.generateKey(channel.id, 'red-scout', 'Red Scout Key');

// 4. Create AI agent for commander
const agent = await sdk.createAgent({
  agentId: 'red-scout',
  name: 'Red Scout Alpha',
  channelId: channel.id,
  keyId: key.keyId,
  secretKey: key.secretKey,
  llmProvider: LlmProviderType.OPENROUTER,
  apiKey: process.env.OPENROUTER_API_KEY!,
  defaultModel: 'anthropic/claude-3.5-haiku',
  temperature: 0.7,
  maxTokens: 100000,
  reasoning: { enabled: false }, // Disable for faster gameplay

  // IMPORTANT: Allow game-specific tools
  allowedTools: [
    'messaging_send',
    'memory_search_conversations',
    // Custom game tools would be registered here
  ],

  // Commander personality and objectives
  agentConfigPrompt: `You are Red Scout Alpha, a reconnaissance specialist in a fog-of-war strategy game.

## Your Role
- Team: Red Alliance
- Specialization: Scouting and intelligence gathering
- Starting Position: Territory A1 (top-left quadrant)
- Starting Units: 100 infantry, 20 cavalry, 30 archers

## Game Rules
- Map: 12x12 grid with varied terrain
- Visibility: You can only see your territories + 1 tile radius (fog of war)
- Victory: First team to 60% resource control OR most resources at turn 15
- Turn Time: 45 seconds for planning, then simultaneous execution

## Your Objectives (Priority Order)
1. Scout aggressively to reduce fog of war
2. Identify enemy positions and report to team
3. Locate high-value resource nodes
4. Avoid direct combat unless necessary
5. Support teammates with intelligence

## Available Actions
You have access to these MCP tools:
- scanPerimeter() - Scout your visible area
- viewTerritory([ids]) - Get details on specific territories
- moveUnits(from, to, type, count) - Move units between territories
- getTeamStatus() - Check teammate resources and status
- collectResources(territory) - Gather resources from controlled areas
- commitTurn() - Signal you're ready for turn execution

You can also communicate with teammates via:
- messaging_send(targetAgentId, message) - Direct team messages

## Strategy Guidelines
- Use mobility to explore quickly
- Share ALL intelligence immediately with team via messaging_send
- Don't hoard resources - collect and share
- Avoid combat unless defending critical positions
- Coordinate with teammates for combined assaults

## Current Game State
Turn: 0 (Initial deployment)
Your visible area: A1, A2, B1, B2 (starting territories)
Team resources: 100 (starting resources)
Teammates: Red Warrior Titan, Red Defender Bastion, Red Support Catalyst

## Example Turn Sequence
1. scanPerimeter() to see what's around you
2. If you spot resources: collectResources(territory)
3. If you spot enemies: messaging_send to warn teammates
4. moveUnits to explore new areas
5. commitTurn() when you've planned your actions

Remember: You're autonomous. The game engine will prompt you each turn to make decisions.
Act boldly but intelligently. Your team is counting on you!`
});

// 5. Connect agent
await agent.connect();

console.log(`✅ Agent ${agent.agentId} connected and ready!`);
```

## Registering Custom MCP Tools

To make game tools available to agents, register them as MCP tools:

```typescript
import { McpToolRegistry } from '../../src/shared/protocols/mcp/McpToolRegistry';
import { GameTools } from '../src/mcp/GameTools';

// Get game tools instance
const gameTools = new GameTools(gameStateManager);

// Register viewTerritory tool
McpToolRegistry.getInstance().registerTool({
  name: 'game_viewTerritory',
  description: 'View details about specific territories on the game map',
  inputSchema: {
    type: 'object',
    properties: {
      territoryIds: {
        type: 'array',
        items: { type: 'string' },
        description: 'Array of territory IDs like ["A1", "B3", "C5"]'
      }
    },
    required: ['territoryIds']
  },
  handler: async (input: any) => {
    const commanderId = input.commanderId; // From agent context
    return gameTools.viewTerritory(commanderId, input.territoryIds);
  },
  examples: [
    {
      input: { territoryIds: ['A1', 'B2'] },
      output: {
        territories: [
          {
            id: 'A1',
            terrain: 'plains',
            owner: 'red',
            resources: 5,
            units: [{ type: 'infantry', count: 100, team: 'red' }],
            fortification: 0,
            visible: true
          }
        ]
      }
    }
  ]
});

// Repeat for all game tools...
```

## Complete Integration Example

Here's a full example connecting all 8 commanders:

```typescript
// examples/fog-of-war-game/src/connect-agents.ts

import { MxfSDK, LlmProviderType } from 'mxf-sdk';
import { Team, CommanderRole } from './types/game';

const COMMANDERS = [
  { id: 'red-scout', name: 'Red Scout Alpha', team: Team.RED, role: CommanderRole.SCOUT },
  { id: 'red-warrior', name: 'Red Warrior Titan', team: Team.RED, role: CommanderRole.WARRIOR },
  // ... (all 8 commanders)
];

async function connectAllAgents() {
  const sdk = new MxfSDK({
    serverUrl: process.env.MXF_SERVER_URL!,
    domainKey: process.env.MXF_DOMAIN_KEY!
  });

  await sdk.connect();

  const channel = await sdk.createChannel('fog-of-war-game');
  const agents = [];

  for (const commander of COMMANDERS) {
    const key = await sdk.generateKey(channel.id, commander.id);

    const agent = await sdk.createAgent({
      agentId: commander.id,
      name: commander.name,
      channelId: channel.id,
      keyId: key.keyId,
      secretKey: key.secretKey,
      llmProvider: LlmProviderType.OPENROUTER,
      apiKey: process.env.OPENROUTER_API_KEY!,
      defaultModel: 'anthropic/claude-3.5-haiku',
      agentConfigPrompt: generatePersonality(commander)
    });

    await agent.connect();
    agents.push(agent);

    console.log(`✅ ${commander.name} connected`);
  }

  return { sdk, channel, agents };
}

function generatePersonality(commander: any): string {
  // Return role-specific personality (scout, warrior, defender, support)
  // ... (implementation)
}

connectAllAgents().then(({ agents }) => {
  console.log(`\n🎮 All ${agents.length} commanders ready for battle!`);
});
```

## Turn-Based Gameplay Loop

Agents operate in a turn-based loop:

```typescript
// Pseudo-code for agent turn loop

while (!gameOver) {
  // OBSERVATION PHASE
  const perimeter = await agent.callTool('scanPerimeter');
  const teamStatus = await agent.callTool('getTeamStatus');

  // REASONING PHASE
  // Agent's LLM processes information and decides actions

  // ACTION PHASE
  // Agent executes planned actions
  await agent.callTool('moveUnits', { from: 'A1', to: 'B2', ... });
  await agent.callTool('collectResources', { territory: 'A1' });

  // COMMUNICATION PHASE
  await agent.callTool('messaging_send', {
    targetAgentId: 'red-warrior',
    message: 'Enemy spotted at C5 - 50 infantry detected'
  });

  // COMMIT PHASE
  await agent.callTool('commitTurn');

  // Wait for turn execution
  await waitForTurnComplete();
}
```

## Monitoring Agent Activity

Monitor agent decisions in real-time:

```typescript
import { Events } from 'mxf-sdk';

// Create channel monitor
const monitor = sdk.createChannelMonitor(channel.id);

// Listen for agent messages
monitor.on(Events.Message.AGENT_MESSAGE, (payload) => {
  console.log(`[${payload.data.senderId}]: ${payload.data.content}`);
});

// Listen for tool executions
monitor.on(Events.Agent.LLM_RESPONSE, (payload) => {
  console.log(`Agent ${payload.agentId} is thinking...`);
});

// Listen for task completions (turn ends)
monitor.on(Events.Task.COMPLETED, (payload) => {
  console.log(`Turn ${payload.data.turn} complete!`);
});
```

## Debugging Tips

1. **Enable verbose logging:**
   ```typescript
   agent.mxfService.setLogLevel('debug');
   ```

2. **Test tools individually:**
   ```bash
   curl -X POST http://localhost:3002/api/mcp/scanPerimeter \
     -H "Content-Type: application/json" \
     -d '{"commanderId":"red-scout"}'
   ```

3. **Monitor WebSocket events:**
   ```typescript
   const socket = io('http://localhost:3002');
   socket.on('action', (data) => console.log('Action:', data));
   socket.on('turnComplete', (data) => console.log('Turn:', data));
   ```

4. **Check agent memory:**
   ```typescript
   const memory = await agent.mxfService.readMemory({
     key: 'enemy-positions',
     scope: 'agent'
   });
   ```

## Performance Optimization

For faster gameplay:

1. **Disable reasoning mode:**
   ```typescript
   reasoning: { enabled: false }
   ```

2. **Use faster models:**
   ```typescript
   defaultModel: 'anthropic/claude-3-haiku' // Faster than Opus/Sonnet
   ```

3. **Limit token usage:**
   ```typescript
   maxTokens: 50000 // Reduce context size
   ```

4. **Batch tool calls:**
   ```typescript
   // Instead of sequential calls:
   await Promise.all([
     agent.callTool('scanPerimeter'),
     agent.callTool('getTeamStatus'),
     agent.callTool('viewTerritory', { ids: ['A1', 'B2'] })
   ]);
   ```

## Next Steps

- Review [First Contact Demo](../../first-contact-demo/) for working multi-agent example
- Check [MCP Tool Documentation](../../../docs/mcp/) for tool development
- See [Game Requirements](./requirments.md) for full game specifications

---

**Questions?** Check the main MXF documentation or open an issue on GitHub.
