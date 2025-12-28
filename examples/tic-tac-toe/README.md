# Tic-Tac-Toe: AI vs AI Showdown

A fast-paced AI vs AI Tic-Tac-Toe game demonstrating MXF's multi-agent capabilities with **only 2 agents** for quick, entertaining gameplay.

## Overview

Watch two AI personalities battle it out:
- **Professor X** - Supremely confident, loves to taunt
- **Oracle O** - Mysterious, speaks in philosophical riddles

## Quick Start

### Prerequisites

- Node.js 18+
- Running MXF server (`npm run dev` in main project)
- OpenRouter API key

### Installation

```bash
cd examples/tic-tac-toe

# Install server dependencies
npm install

# Install client dependencies
cd client && npm install && cd ..
```

### Configuration

```bash
cp .env.example .env
# Edit .env with your MXF_DOMAIN_KEY and OPENROUTER_API_KEY
```

### Run the Game

```bash
npm run game
```

This starts both the game server and the Vue dashboard.

Open **http://localhost:3005** and click **Start Game**!

## Features

- **2 AI players** with distinct personalities
- **Real-time board updates** via WebSocket
- **Trash talk** between AI opponents
- **Thinking indicators** showing when AI is reasoning
- **Win tracking** across multiple games
- **Fast gameplay** - games finish in seconds!

## Architecture

```
┌─────────────────────────────────────┐
│     Game Server (Port 3004)         │
│  - Game state management            │
│  - WebSocket for real-time updates  │
│  - MCP tool endpoints               │
└─────────────────────────────────────┘
              ↕
┌─────────────────────────────────────┐
│     MXF Server (Port 3001)          │
│  - 2 AI Player agents               │
│  - Task assignment per turn         │
└─────────────────────────────────────┘
              ↕
┌─────────────────────────────────────┐
│     Vue Dashboard (Port 3005)       │
│  - Interactive game board           │
│  - Player status cards              │
│  - Trash talk feed                  │
└─────────────────────────────────────┘
```

## MCP Tools

Just 3 simple tools:

- `game_getBoard()` - Get current board state
- `game_makeMove(row, col, taunt?)` - Place mark with optional trash talk
- `game_taunt(message)` - Send trash talk without moving

## Color Scheme

- **Orange/Amber** - Primary accent color
- **Cyan** - Player X
- **Magenta** - Player O

## Why This Example?

This demonstrates:
1. **Minimal agent count** - Just 2 agents = fast!
2. **Simple game mechanics** - 1 tool call per turn
3. **Entertaining personalities** - AI trash talk is fun to watch
4. **Quick games** - Max 9 turns, usually 5-7

Perfect for demos where you want to show AI coordination without waiting!

## License

MIT - See main project LICENSE file
