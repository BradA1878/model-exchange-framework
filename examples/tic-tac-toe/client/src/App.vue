<template>
  <div class="app">
    <!-- Header -->
    <header class="header">
      <h1>
        <span class="title-x">X</span>
        <span class="title-vs">vs</span>
        <span class="title-o">O</span>
      </h1>
      <p class="subtitle">AI vs AI Showdown</p>
    </header>

    <!-- Main Game Area -->
    <main class="game-container">
      <!-- Player X Card -->
      <div class="player-card player-x" :class="{ active: currentPlayer === 'X' && !gameOver, thinking: thinkingStates['player-x'] }">
        <div class="player-symbol">X</div>
        <div class="player-info">
          <div class="player-name">{{ players.X.name || 'Player X' }}</div>
          <div class="player-model">{{ players.X.model || 'Waiting...' }}</div>
        </div>
        <div class="player-wins">
          <span class="wins-count">{{ players.X.wins }}</span>
          <span class="wins-label">wins</span>
        </div>
        <div v-if="thinkingStates['player-x']" class="thinking-indicator">
          <span class="dot"></span><span class="dot"></span><span class="dot"></span>
        </div>
      </div>

      <!-- Game Board -->
      <div class="board-container">
        <div class="board">
          <div
            v-for="(row, rowIndex) in board"
            :key="rowIndex"
            class="board-row"
          >
            <div
              v-for="(cell, colIndex) in row"
              :key="colIndex"
              class="cell"
              :class="{
                'cell-x': cell === 'X',
                'cell-o': cell === 'O',
                'cell-winning': isWinningCell(rowIndex, colIndex),
                'cell-latest': isLatestMove(rowIndex, colIndex)
              }"
            >
              <span v-if="cell" class="cell-content">{{ cell }}</span>
            </div>
          </div>
        </div>

        <!-- Game Status -->
        <div class="game-status">
          <template v-if="!gameStarted">
            <button class="start-btn" @click="startGame">
              Start Game
            </button>
          </template>
          <template v-else-if="gameOver">
            <div class="status-message" :class="{ 'status-draw': winner === 'draw' }">
              {{ winner === 'draw' ? "It's a Draw!" : `${winner} Wins!` }}
            </div>
            <button class="reset-btn" @click="resetGame">Play Again</button>
          </template>
          <template v-else>
            <div class="turn-indicator">
              <span class="turn-symbol" :class="{ 'turn-x': currentPlayer === 'X', 'turn-o': currentPlayer === 'O' }">
                {{ currentPlayer }}
              </span>
              <span class="turn-text">'s turn</span>
            </div>
          </template>
        </div>

        <!-- Move Counter -->
        <div class="move-counter">
          Move {{ moveHistory.length }} of 9
        </div>
      </div>

      <!-- Player O Card -->
      <div class="player-card player-o" :class="{ active: currentPlayer === 'O' && !gameOver, thinking: thinkingStates['player-o'] }">
        <div class="player-symbol">O</div>
        <div class="player-info">
          <div class="player-name">{{ players.O.name || 'Player O' }}</div>
          <div class="player-model">{{ players.O.model || 'Waiting...' }}</div>
        </div>
        <div class="player-wins">
          <span class="wins-count">{{ players.O.wins }}</span>
          <span class="wins-label">wins</span>
        </div>
        <div v-if="thinkingStates['player-o']" class="thinking-indicator">
          <span class="dot"></span><span class="dot"></span><span class="dot"></span>
        </div>
      </div>
    </main>

    <!-- Chat/Taunt Area -->
    <section class="chat-section">
      <h2 class="chat-title">Trash Talk</h2>
      <div class="chat-messages" ref="chatContainer">
        <div
          v-for="msg in chatHistory"
          :key="msg.id"
          class="chat-message"
          :class="{
            'msg-system': msg.type === 'system',
            'msg-x': msg.from === 'player-x',
            'msg-o': msg.from === 'player-o'
          }"
        >
          <span class="msg-author">{{ msg.fromName }}</span>
          <span class="msg-text">{{ msg.message }}</span>
        </div>
        <div v-if="chatHistory.length === 0" class="chat-empty">
          Waiting for the AI players to start trash talking...
        </div>
      </div>
    </section>

    <!-- Footer -->
    <footer class="footer">
      <span>Powered by</span>
      <strong>MXF</strong>
      <span class="separator">|</span>
      <span>Model Exchange Framework</span>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, nextTick, watch } from 'vue'
import { io, Socket } from 'socket.io-client'

// Types
interface PlayerInfo {
  agentId: string
  name: string
  model: string
  wins: number
  personality: string
}

interface Move {
  player: 'X' | 'O'
  row: number
  col: number
  timestamp: number
  taunt?: string
}

interface ChatMessage {
  id: string
  from: string
  fromName: string
  message: string
  type: 'taunt' | 'system' | 'thinking'
  timestamp: number
}

type Cell = 'X' | 'O' | null
type Board = Cell[][]

// State
const socket = ref<Socket | null>(null)
const board = ref<Board>([
  [null, null, null],
  [null, null, null],
  [null, null, null]
])
const currentPlayer = ref<'X' | 'O'>('X')
const winner = ref<'X' | 'O' | 'draw' | null>(null)
const gameOver = ref(false)
const gameStarted = ref(false)
const moveHistory = ref<Move[]>([])
const players = ref<{ X: PlayerInfo; O: PlayerInfo }>({
  X: { agentId: '', name: 'Player X', model: '', wins: 0, personality: '' },
  O: { agentId: '', name: 'Player O', model: '', wins: 0, personality: '' }
})
const chatHistory = ref<ChatMessage[]>([])
const thinkingStates = ref<Record<string, boolean>>({})
const chatContainer = ref<HTMLElement | null>(null)
const winningCells = ref<{ row: number; col: number }[]>([])

// Check if cell is in winning line
const isWinningCell = (row: number, col: number): boolean => {
  return winningCells.value.some(c => c.row === row && c.col === col)
}

// Check if cell is the latest move
const isLatestMove = (row: number, col: number): boolean => {
  if (moveHistory.value.length === 0) return false
  const lastMove = moveHistory.value[moveHistory.value.length - 1]
  return lastMove.row === row && lastMove.col === col
}

// Calculate winning cells when there's a winner
const calculateWinningCells = () => {
  if (!winner.value || winner.value === 'draw') {
    winningCells.value = []
    return
  }

  const b = board.value
  const w = winner.value

  // Check rows
  for (let r = 0; r < 3; r++) {
    if (b[r][0] === w && b[r][1] === w && b[r][2] === w) {
      winningCells.value = [{ row: r, col: 0 }, { row: r, col: 1 }, { row: r, col: 2 }]
      return
    }
  }

  // Check columns
  for (let c = 0; c < 3; c++) {
    if (b[0][c] === w && b[1][c] === w && b[2][c] === w) {
      winningCells.value = [{ row: 0, col: c }, { row: 1, col: c }, { row: 2, col: c }]
      return
    }
  }

  // Check diagonals
  if (b[0][0] === w && b[1][1] === w && b[2][2] === w) {
    winningCells.value = [{ row: 0, col: 0 }, { row: 1, col: 1 }, { row: 2, col: 2 }]
    return
  }
  if (b[0][2] === w && b[1][1] === w && b[2][0] === w) {
    winningCells.value = [{ row: 0, col: 2 }, { row: 1, col: 1 }, { row: 2, col: 0 }]
    return
  }
}

// Start game
const startGame = async () => {
  try {
    await fetch('http://localhost:3004/api/game/start', { method: 'POST' })
    gameStarted.value = true
  } catch (error) {
    console.error('Failed to start game:', error)
  }
}

// Reset game
const resetGame = async () => {
  try {
    await fetch('http://localhost:3004/api/game/reset', { method: 'POST' })
    winningCells.value = []
  } catch (error) {
    console.error('Failed to reset game:', error)
  }
}

// Auto-scroll chat
watch(chatHistory, () => {
  nextTick(() => {
    if (chatContainer.value) {
      chatContainer.value.scrollTop = chatContainer.value.scrollHeight
    }
  })
}, { deep: true })

// Watch winner changes
watch(winner, calculateWinningCells)

// Socket connection
onMounted(() => {
  socket.value = io('http://localhost:3004')

  socket.value.on('gameState', (state: any) => {
    board.value = state.board
    currentPlayer.value = state.currentPlayer
    winner.value = state.winner
    gameOver.value = state.gameOver
    moveHistory.value = state.moveHistory
    players.value = state.players
    if (state.gameOver) {
      calculateWinningCells()
    }
  })

  socket.value.on('chatHistory', (history: ChatMessage[]) => {
    chatHistory.value = history
  })

  socket.value.on('chatMessage', (msg: ChatMessage) => {
    chatHistory.value.push(msg)
  })

  socket.value.on('thinkingStates', (states: Record<string, boolean>) => {
    thinkingStates.value = states
  })

  socket.value.on('thinkingState', ({ playerId, isThinking }: { playerId: string; isThinking: boolean }) => {
    thinkingStates.value[playerId] = isThinking
  })

  socket.value.on('gameReset', (state: any) => {
    board.value = state.board
    currentPlayer.value = state.currentPlayer
    winner.value = state.winner
    gameOver.value = state.gameOver
    moveHistory.value = state.moveHistory
    players.value = state.players
    gameStarted.value = false
    winningCells.value = []
  })

  socket.value.on('gameOver', ({ winner: w }: { winner: 'X' | 'O' | 'draw' }) => {
    winner.value = w
    gameOver.value = true
    calculateWinningCells()
  })
})
</script>

<style>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

:root {
  --bg-dark: #1a1a2e;
  --bg-card: #16213e;
  --orange-primary: #f39c12;
  --orange-light: #f1c40f;
  --orange-dark: #d68910;
  --cyan-primary: #00d9ff;
  --cyan-dark: #0099cc;
  --magenta-primary: #e91e63;
  --magenta-dark: #ad1457;
  --text-primary: #ffffff;
  --text-secondary: #a0a0a0;
  --border-color: #2d2d44;
}

body {
  font-family: 'Poppins', sans-serif;
  background: var(--bg-dark);
  color: var(--text-primary);
  min-height: 100vh;
}

.app {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  padding: 1rem;
  max-width: 1400px;
  margin: 0 auto;
}

/* Header */
.header {
  text-align: center;
  padding: 1rem 0 1.5rem;
}

.header h1 {
  font-size: 3.5rem;
  font-weight: 900;
  letter-spacing: 0.1em;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
}

.title-x {
  color: var(--cyan-primary);
  text-shadow: 0 0 20px var(--cyan-primary);
}

.title-vs {
  color: var(--orange-primary);
  font-size: 1.5rem;
  font-weight: 600;
}

.title-o {
  color: var(--magenta-primary);
  text-shadow: 0 0 20px var(--magenta-primary);
}

.subtitle {
  color: var(--text-secondary);
  font-size: 1rem;
  margin-top: 0.25rem;
}

/* Game Container */
.game-container {
  display: flex;
  align-items: flex-start;
  justify-content: center;
  gap: 2rem;
  flex: 1;
}

/* Player Cards */
.player-card {
  background: var(--bg-card);
  border-radius: 1rem;
  padding: 1.5rem;
  width: 200px;
  text-align: center;
  border: 2px solid var(--border-color);
  transition: all 0.3s ease;
  position: relative;
}

.player-card.active {
  transform: scale(1.05);
}

.player-card.thinking {
  animation: pulse 1.5s infinite;
}

.player-x.active {
  border-color: var(--cyan-primary);
  box-shadow: 0 0 30px rgba(0, 217, 255, 0.3);
}

.player-o.active {
  border-color: var(--magenta-primary);
  box-shadow: 0 0 30px rgba(233, 30, 99, 0.3);
}

.player-symbol {
  font-size: 4rem;
  font-weight: 900;
  line-height: 1;
  margin-bottom: 0.5rem;
}

.player-x .player-symbol {
  color: var(--cyan-primary);
  text-shadow: 0 0 15px var(--cyan-primary);
}

.player-o .player-symbol {
  color: var(--magenta-primary);
  text-shadow: 0 0 15px var(--magenta-primary);
}

.player-name {
  font-weight: 600;
  font-size: 1.1rem;
  margin-bottom: 0.25rem;
}

.player-model {
  color: var(--text-secondary);
  font-size: 0.75rem;
  margin-bottom: 1rem;
}

.player-wins {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.wins-count {
  font-size: 2rem;
  font-weight: 700;
  color: var(--orange-primary);
}

.wins-label {
  font-size: 0.75rem;
  color: var(--text-secondary);
  text-transform: uppercase;
}

.thinking-indicator {
  position: absolute;
  bottom: -1.5rem;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 0.3rem;
}

.thinking-indicator .dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--orange-primary);
  animation: bounce 1.4s infinite ease-in-out;
}

.thinking-indicator .dot:nth-child(1) { animation-delay: 0s; }
.thinking-indicator .dot:nth-child(2) { animation-delay: 0.2s; }
.thinking-indicator .dot:nth-child(3) { animation-delay: 0.4s; }

@keyframes bounce {
  0%, 80%, 100% { transform: scale(0); }
  40% { transform: scale(1); }
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.7; }
}

/* Board Container */
.board-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1.5rem;
}

/* Board */
.board {
  background: var(--bg-card);
  border-radius: 1rem;
  padding: 1rem;
  border: 2px solid var(--orange-primary);
  box-shadow: 0 0 40px rgba(243, 156, 18, 0.2);
}

.board-row {
  display: flex;
}

.cell {
  width: 100px;
  height: 100px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 2px solid var(--border-color);
  cursor: default;
  transition: all 0.2s ease;
}

.cell:nth-child(2) {
  border-left: 2px solid var(--orange-dark);
  border-right: 2px solid var(--orange-dark);
}

.board-row:nth-child(2) .cell {
  border-top: 2px solid var(--orange-dark);
  border-bottom: 2px solid var(--orange-dark);
}

.cell-content {
  font-size: 4rem;
  font-weight: 900;
  line-height: 1;
}

.cell-x .cell-content {
  color: var(--cyan-primary);
  text-shadow: 0 0 10px var(--cyan-primary);
}

.cell-o .cell-content {
  color: var(--magenta-primary);
  text-shadow: 0 0 10px var(--magenta-primary);
}

.cell-latest {
  background: rgba(243, 156, 18, 0.1);
}

.cell-winning {
  background: rgba(243, 156, 18, 0.3);
  animation: winPulse 0.5s ease-in-out infinite alternate;
}

@keyframes winPulse {
  from { background: rgba(243, 156, 18, 0.2); }
  to { background: rgba(243, 156, 18, 0.4); }
}

/* Game Status */
.game-status {
  text-align: center;
}

.start-btn, .reset-btn {
  background: linear-gradient(135deg, var(--orange-primary), var(--orange-dark));
  color: white;
  border: none;
  padding: 1rem 2.5rem;
  font-size: 1.2rem;
  font-weight: 700;
  border-radius: 0.5rem;
  cursor: pointer;
  transition: all 0.2s ease;
  text-transform: uppercase;
  letter-spacing: 0.1em;
}

.start-btn:hover, .reset-btn:hover {
  transform: scale(1.05);
  box-shadow: 0 0 20px rgba(243, 156, 18, 0.5);
}

.status-message {
  font-size: 2rem;
  font-weight: 700;
  color: var(--orange-light);
  margin-bottom: 1rem;
  text-shadow: 0 0 10px var(--orange-primary);
}

.status-draw {
  color: var(--text-secondary);
  text-shadow: none;
}

.turn-indicator {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  font-size: 1.5rem;
}

.turn-symbol {
  font-weight: 900;
  font-size: 2rem;
}

.turn-x {
  color: var(--cyan-primary);
  text-shadow: 0 0 10px var(--cyan-primary);
}

.turn-o {
  color: var(--magenta-primary);
  text-shadow: 0 0 10px var(--magenta-primary);
}

.turn-text {
  color: var(--text-secondary);
}

.move-counter {
  color: var(--text-secondary);
  font-size: 0.9rem;
}

/* Chat Section */
.chat-section {
  margin-top: 2rem;
  background: var(--bg-card);
  border-radius: 1rem;
  padding: 1rem;
  border: 1px solid var(--border-color);
}

.chat-title {
  font-size: 1rem;
  color: var(--orange-primary);
  margin-bottom: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
}

.chat-messages {
  max-height: 150px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.chat-message {
  padding: 0.5rem 0.75rem;
  border-radius: 0.5rem;
  font-size: 0.9rem;
}

.msg-system {
  background: rgba(243, 156, 18, 0.1);
  color: var(--orange-light);
  text-align: center;
  font-style: italic;
}

.msg-x {
  background: rgba(0, 217, 255, 0.1);
  border-left: 3px solid var(--cyan-primary);
}

.msg-o {
  background: rgba(233, 30, 99, 0.1);
  border-left: 3px solid var(--magenta-primary);
}

.msg-author {
  font-weight: 600;
  margin-right: 0.5rem;
}

.msg-x .msg-author {
  color: var(--cyan-primary);
}

.msg-o .msg-author {
  color: var(--magenta-primary);
}

.chat-empty {
  color: var(--text-secondary);
  text-align: center;
  font-style: italic;
  padding: 1rem;
}

/* Footer */
.footer {
  text-align: center;
  padding: 1.5rem;
  color: var(--text-secondary);
  font-size: 0.85rem;
}

.footer strong {
  color: var(--orange-primary);
}

.separator {
  margin: 0 0.5rem;
  color: var(--border-color);
}

/* Scrollbar */
::-webkit-scrollbar {
  width: 6px;
}

::-webkit-scrollbar-track {
  background: var(--bg-dark);
}

::-webkit-scrollbar-thumb {
  background: var(--orange-dark);
  border-radius: 3px;
}

::-webkit-scrollbar-thumb:hover {
  background: var(--orange-primary);
}
</style>
