# Tic-Tac-Toe: AI vs AI Showdown

A fast-paced AI vs AI Tic-Tac-Toe game demonstrating MXF's multi-agent capabilities with just 2 agents for quick, entertaining gameplay.

## Overview

Watch two AI personalities battle it out:

- **Professor X** - Supremely confident, loves to taunt
- **Oracle O** - Mysterious, speaks in philosophical riddles

## Key MXF Features Demonstrated

### 1. Channel-Scoped MCP Server

The administrator SDK creates the channel with a channel-specific MCP process, so
the game tools are isolated to that channel. The MXF server operator must set
`MXF_UNSAFE_STDIO_MCP_ENABLED=true` because this starts a process on the MXF host:

```typescript
const channel = await sdk.createChannel('tic-tac-toe-game', {
    name: 'Tic-Tac-Toe Arena',
    mcpServers: [{
        id: 'tic-tac-toe-mcp-server',
        name: 'Tic-Tac-Toe Game Tools',
        transport: 'stdio',
        command: 'bun',
        args: ['run', './examples/tic-tac-toe/server/mcp/TicTacToeMcpServer.ts'],
        autoStart: true,
        keepAliveMinutes: 10,
        environmentVariables: {
            GAME_SERVER_URL: `http://localhost:${GAME_PORT}`
        }
    }]
});
```

The child process speaks MCP over `stdio`. `GAME_SERVER_URL` is the separate game
API that the child calls; it is not an HTTP MCP transport URL.

### 2. Simple Turn-Based Game Loop

```typescript
while (!gameOver) {
    const currentPlayer = turn % 2 === 0 ? playerX : playerO;

    // Assign turn task to current player
    await assignTurnTask(currentPlayer, gameState);

    // Wait for player to commit their move
    await waitForTurnCompletion();

    turn++;
}
```

### 3. Custom Game Tools

| Tool | Description |
|------|-------------|
| `game_getBoard` | Get current board state |
| `game_makeMove` | Place X or O on the board |
| `game_commitTurn` | Finalize the turn |

### 4. Agent Personality via System Prompts

```typescript
import { LlmProviderType } from '@mxf-dev/sdk';

const playerX = await sdk.createAgent({
    agentId: 'professor-x',
    name: 'Professor X',
    channelId: 'tic-tac-toe-game',
    keyId: process.env.PROFESSOR_X_KEY_ID!,
    secretKey: process.env.PROFESSOR_X_SECRET_KEY!,
    llmProvider: LlmProviderType.OPENROUTER,
    defaultModel: '~anthropic/claude-haiku-latest',
    agentConfigPrompt: `You are Professor X, a supremely confident AI player.
    You love to taunt your opponent and celebrate your moves.
    You play X and always aim for the win.`
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
   cd examples/tic-tac-toe
   bun install
   cd client && bun install && cd ..
   ```

### Start the Game

```bash
bun run game
```

## Game Flow

1. **Setup**: Admin agent creates the game channel and registers MCP server
2. **Agent Creation**: Two AI players join the channel
3. **Game Loop**: Players alternate turns using `game_makeMove`
4. **Victory**: Game ends when someone wins or it's a draw
5. **Cleanup**: MCP server unregistered, agents disconnected

## Sample Output

```
[Professor X]: *cracks knuckles* Let's see what you've got, Oracle.
               I'll start in the center - the power position!

[Oracle O]: The center... how predictable. The wise know that
            true victory begins at the corners. *places O*

[Professor X]: Corner play? Please. Watch this diagonal setup!
```

## Learning Points

This demo showcases:

1. **Minimal multi-agent setup** (just 2 agents)
2. **Channel-scoped MCP registration** for game isolation
3. **Turn-based task assignment** for sequential play
4. **Agent personality through prompts** for entertainment
5. **Graceful cleanup** of MCP servers and agents

## Source Code

See the full implementation in `examples/tic-tac-toe/`
