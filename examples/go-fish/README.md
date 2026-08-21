# Go Fish: AI Card Game

An AI vs AI Go Fish card game demonstrating MXF's multi-agent capabilities with memory, strategy, and personality.

## Overview

Watch AI players with distinct personalities play Go Fish:
- **Foxy Fisher** 🦊 - Cunning and playful, always has a trick up their sleeve
- **Captain Ribbit** 🐸 - Dignified frog admiral who plays with military precision

## Quick Start

### Prerequisites

- Bun
- Running MXF server (`bun run dev` in main project)
- OpenRouter API key

### Installation

```bash
cd examples/go-fish

# Install server dependencies
bun install

# Install client dependencies
cd client && bun install && cd ..
```

### Configuration

```bash
cp .env.example .env
# Edit .env with your MXF_DOMAIN_KEY and OPENROUTER_API_KEY
```

### Run the Game

```bash
bun run game
```

This starts both the game server and the Vue dashboard.

Open **http://localhost:3007** and click **Start Game**!

## Game Rules

1. Each player starts with 7 cards
2. On your turn, ask another player for a rank you have
3. If they have cards of that rank, you get them ALL
4. If not, "Go Fish!" - draw from the deck
5. If you draw the rank you asked for, you go again!
6. Collect 4 of a kind to make a "book" and score a point
7. Most books when all 13 are collected wins!

## Features

- **2 AI players** with unique personalities
- **Real-time card updates** via WebSocket
- **Table talk** - players banter and react
- **Thinking indicators** during AI reasoning
- **Book progress tracking** - visual progress bar
- **Turn continuation** - players go again when successful

## Architecture

```
┌─────────────────────────────────────┐
│     Game Server (Port 3006)         │
│  - Card dealing and game state      │
│  - Go Fish rules enforcement        │
│  - WebSocket for real-time updates  │
└─────────────────────────────────────┘
              ↕
┌─────────────────────────────────────┐
│     MXF Server (Port 3001)          │
│  - 2 AI Player agents               │
│  - Task assignment per turn         │
└─────────────────────────────────────┘
              ↕
┌─────────────────────────────────────┐
│     Vue Dashboard (Port 3007)       │
│  - Player cards and stats           │
│  - Deck visualization               │
│  - Table talk feed                  │
└─────────────────────────────────────┘
```

## MCP Tools

Just 3 simple tools:

- `game_getHand()` - Get your cards, books, and available targets
- `game_askForCards(targetId, rank)` - Ask another player for cards
- `game_taunt(message)` - Send a message to the table

## Color Scheme

- **Emerald/Teal** - Primary accent colors
- **Gold** - Highlights and achievements
- Each player has a unique hue

## Why This Example?

This demonstrates:
1. **Hidden information** - Players can't see each other's cards
2. **Memory and strategy** - Remembering what others asked for
3. **Turn continuation** - Multiple actions per turn when successful
4. **Personality-driven gameplay** - Characters react to events

More complex than Tic-Tac-Toe but still fast and entertaining!

## License

MIT - See main project LICENSE file
