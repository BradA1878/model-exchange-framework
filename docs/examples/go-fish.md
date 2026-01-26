# Go Fish: AI Card Game

An AI vs AI Go Fish card game demonstrating MXF's multi-agent capabilities with memory, strategy, and personality.

## Overview

Watch AI players with distinct personalities play Go Fish:

- **Foxy Fisher** - Cunning and playful, always has a trick up their sleeve
- **Captain Ribbit** - Dignified frog admiral who plays with military precision

## Key MXF Features Demonstrated

### 1. Channel-Scoped MCP Server Registration

```typescript
const mcpResult = await adminAgent.registerChannelMcpServer({
    id: 'go-fish-mcp-server',
    name: 'Go Fish Game Server',
    transport: 'http',
    url: `http://localhost:${GAME_PORT}/mcp`,
    autoStart: true,
    keepAliveMinutes: 30
});
```

### 2. Memory-Based Strategy

Agents remember what cards opponents have asked for:

```typescript
// Agent can use memory to track opponent requests
const recentRequests = await agent.getChannelMemory('opponent_requests');
```

### 3. Custom Game Tools

| Tool | Description |
|------|-------------|
| `game_getHand` | View your current cards |
| `game_askFor` | Ask opponent for a specific rank |
| `game_goFish` | Draw from the deck |
| `game_layDownSet` | Complete a set of 4 |
| `game_commitTurn` | End your turn |

### 4. Turn-Based Task Management

```typescript
const turnTask = await sdk.createTask({
    title: `${currentPlayer.name}'s Turn`,
    description: `It's your turn. Your hand: ${hand.join(', ')}`,
    channelId: gameChannelId,
    assignedAgentId: currentPlayer.agentId
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
   cd examples/go-fish
   npm install
   cd client && npm install && cd ..
   ```

### Start the Game

```bash
# Terminal 1: Start game server
bun run server

# Terminal 2: Connect agents and play
bun run agents
```

## Game Flow

1. **Deal Cards**: Each player receives 7 cards
2. **Turn Sequence**:
   - Player views their hand
   - Asks opponent for a specific rank
   - If opponent has cards, they hand them over
   - If not, player draws from deck ("Go Fish!")
   - If drawn card matches request, player goes again
3. **Complete Sets**: When a player has 4 of a kind, they lay it down
4. **Victory**: Player with most sets when deck is empty wins

## Agent Personalities

### Foxy Fisher
```
A cunning and playful fox who treats Go Fish like a heist.
Uses memory to track patterns and make strategic requests.
Celebrates with sly remarks when successful.
```

### Captain Ribbit
```
A dignified frog admiral who plays with military precision.
Announces moves formally and treats each turn as a tactical operation.
Maintains composure even when forced to "Go Fish."
```

## Sample Output

```
[Foxy Fisher]: *adjusts monocle* I have a hunch you're holding some 7s,
               my amphibious friend. Hand them over!

[Captain Ribbit]: Blast it all! The fox outfoxed me. Here are your 7s.
                  *reluctantly hands over two cards*

[Foxy Fisher]: Delightful! That completes my set of 7s!
               *lays down four 7s triumphantly*
```

## Learning Points

This demo showcases:

1. **Channel-scoped MCP server** for game-specific tools
2. **Agent memory** for strategic gameplay
3. **Task-based turn management** for sequential play
4. **Rich agent personalities** through detailed prompts
5. **Complex game state** with hidden information (hands)

## Source Code

See the full implementation in `examples/go-fish/`
