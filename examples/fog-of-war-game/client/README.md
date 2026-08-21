# Vue 3 Frontend - Fog of War Dashboard

Modern, real-time dashboard for visualizing the Fog of War multi-agent strategy game.

## 🎨 Tech Stack

- **Vue 3** - Composition API with `<script setup>`
- **TypeScript** - Full type safety
- **Vite** - Lightning-fast build tool
- **Pinia** - State management
- **Vue Router** - Routing
- **Socket.IO Client** - Real-time WebSocket connection
- **Chart.js** - Data visualization (for future enhancements)

## 📦 Project Structure

```
client/
├── src/
│   ├── components/
│   │   ├── CommanderCard.vue         # Commander status cards
│   │   └── views/
│   │       ├── MapView.vue           # Interactive game map
│   │       ├── CommunicationView.vue # Message streaming
│   │       ├── DecisionLogView.vue   # Action tracking
│   │       └── AnalyticsView.vue     # Metrics dashboard
│   ├── stores/
│   │   └── gameStore.ts              # Pinia game state store
│   ├── router/
│   │   └── index.ts                  # Vue Router config
│   ├── types/
│   │   └── game.ts                   # TypeScript type definitions
│   ├── views/
│   │   └── GameView.vue              # Main layout component
│   ├── App.vue                       # Root component
│   ├── main.ts                       # Entry point
│   └── style.css                     # Global styles
├── public/                            # Static assets
├── index.html                         # HTML entry point
├── vite.config.ts                     # Vite configuration
├── tsconfig.json                      # TypeScript config
└── package.json
```

## 🚀 Quick Start

### Development

```bash
# Install dependencies
bun install

# Start dev server (requires game server running on :3002)
bun run dev
```

Frontend will be available at http://localhost:3003

### Production Build

```bash
# Build for production
bun run build

# Preview production build
bun run preview
```

## 🎮 Features

### View Modes

**1. Map View** 🗺️
- 12x12 interactive grid
- Real-time territory updates
- Fog of war visualization
- Unit and resource indicators
- Tile detail inspection

**2. Communication View** 💬
- Live message streaming
- Channel filtering (All/Red/Blue/Cross-team)
- Message type indicators
- Real-time timestamps

**3. Decision Log** ⚡
- MCP tool call monitoring
- Action filtering by commander/type
- Status tracking (pending/executed/failed)
- Success rate analytics
- Detailed parameter display

**4. Analytics Dashboard** 📊
- Game progress metrics
- Resource control charts
- Team comparisons
- Performance statistics

### Interactive Elements

- **Commander Cards**: Click to view individual perspectives
- **View Mode Tabs**: Switch between different visualizations
- **Spectator Toggle**: Full visibility vs. fog-of-war
- **Tile Selection**: Click map tiles for details
- **Real-time Updates**: WebSocket-powered live data

## 🔧 Configuration

The frontend proxies API requests to the game server:

```typescript
// vite.config.ts
server: {
  port: 3003,
  proxy: {
    '/api': {
      target: 'http://localhost:3002',
      changeOrigin: true
    }
  }
}
```

## 📡 WebSocket Integration

The app connects to the game server via Socket.IO:

```typescript
// Automatic connection on mount
socket = io('http://localhost:3002')

// Event listeners
socket.on('gameState', handleGameState)
socket.on('action', handleAction)
socket.on('turnComplete', handleTurnComplete)
socket.on('gameOver', handleGameOver)
```

## 🎨 Styling

Using CSS variables for theming:

```css
:root {
  --color-bg-primary: #0f172a;
  --color-bg-secondary: #1e293b;
  --color-red: #ef4444;
  --color-blue: #3b82f6;
  /* ... */
}
```

## 🏗️ State Management

Pinia store manages all game state:

```typescript
// Game store exports
const gameStore = useGameStore()

// State
gameStore.gameState        // Current game state
gameStore.commanders       // All commanders
gameStore.messages         // Message history
gameStore.actions          // Action log
gameStore.connected        // WebSocket status

// Computed
gameStore.redCommanders    // Red team commanders
gameStore.blueCommanders   // Blue team commanders
gameStore.activeCommander  // Currently selected

// Actions
gameStore.connect()        // Connect to server
gameStore.setViewMode()    // Change view
gameStore.selectCommander() // Select commander
```

## 🔍 Type Safety

Full TypeScript support with shared types:

```typescript
import type { GameState, Commander, Tile } from '@/types/game'
```

## 🚧 Future Enhancements

- [ ] Chart.js integration for trend graphs
- [ ] Replay controls (pause, rewind, fast-forward)
- [ ] Settings panel (LLM provider, turn duration, etc.)
- [ ] Network topology visualization
- [ ] Token usage graphs
- [ ] Export game data/replays
- [ ] Commander perspective switching with fog-of-war
- [ ] Animation for unit movements and battles
- [ ] Audio notifications for major events

## 📝 Development Notes

### Adding New View Modes

1. Create component in `src/components/views/`
2. Import in `GameView.vue`
3. Add to `viewModes` array
4. Add route if needed

### Adding WebSocket Events

1. Add handler in `gameStore.ts`:
   ```typescript
   socket.on('newEvent', (data) => {
     // Handle event
   })
   ```

2. Add event type to TypeScript definitions

### Styling Guidelines

- Use CSS variables for colors
- Follow BEM-like class naming
- Keep components self-contained
- Use scoped styles
- Responsive by default

## 🐛 Troubleshooting

**Frontend won't connect:**
- Ensure game server is running on port 3002
- Check CORS settings in game server
- Verify WebSocket connection in browser console

**Map not displaying:**
- Check if `gameState.map` is populated
- Verify grid size calculation
- Check console for errors

**Real-time updates not working:**
- Confirm WebSocket connection status
- Check browser console for Socket.IO errors
- Verify event names match between client/server

## 📚 Resources

- [Vue 3 Docs](https://vuejs.org/)
- [Vite Guide](https://vitejs.dev/)
- [Pinia](https://pinia.vuejs.org/)
- [Socket.IO Client](https://socket.io/docs/v4/client-api/)
- [TypeScript](https://www.typescriptlang.org/)

---

Built with ❤️ using Vue 3 + TypeScript
