<template>
  <div class="app">
    <!-- Header -->
    <header class="header">
      <h1>
        <span class="title-go">Go</span>
        <span class="title-fish">Fish!</span>
        <span class="fish-emoji">🐟</span>
      </h1>
      <p class="subtitle">AI Card Game Showdown</p>
    </header>

    <!-- Main Game Area -->
    <main class="game-container">
      <!-- Players Row -->
      <div class="players-row">
        <div
          v-for="(player, index) in players"
          :key="player.id"
          class="player-card"
          :class="{
            active: currentPlayerIndex === index && !gameOver,
            thinking: thinkingStates[player.id],
            winner: gameOver && winner === player.id
          }"
          :style="{ '--player-hue': getPlayerHue(index) }"
        >
          <div class="player-avatar">
            {{ getPlayerEmoji(index) }}
          </div>
          <div class="player-info">
            <div class="player-name">{{ player.name }}</div>
            <div class="player-model">{{ player.model || 'AI' }}</div>
          </div>
          <div class="player-stats">
            <div class="stat">
              <span class="stat-value">{{ player.handCount }}</span>
              <span class="stat-label">cards</span>
            </div>
            <div class="stat">
              <span class="stat-value">{{ player.books.length }}</span>
              <span class="stat-label">books</span>
            </div>
          </div>
          <div class="player-books" v-if="player.books.length > 0">
            <span v-for="book in player.books" :key="book" class="book-badge">{{ book }}</span>
          </div>
          <div v-if="thinkingStates[player.id]" class="thinking-indicator">
            <span class="dot"></span><span class="dot"></span><span class="dot"></span>
          </div>
        </div>
      </div>

      <!-- Center Area - Deck and Status -->
      <div class="center-area">
        <div class="deck-display">
          <div class="deck-cards">
            <div class="deck-card" v-for="n in Math.min(5, deckCount)" :key="n" :style="{ '--offset': n }"></div>
          </div>
          <div class="deck-count">{{ deckCount }} cards</div>
        </div>

        <div class="game-status">
          <template v-if="!gameStarted">
            <button class="start-btn" @click="startGame">
              🎣 Start Game
            </button>
          </template>
          <template v-else-if="gameOver">
            <div class="winner-announcement">
              <span class="winner-emoji">🏆</span>
              <span class="winner-name">{{ getWinnerName() }} Wins!</span>
            </div>
            <button class="reset-btn" @click="resetGame">Play Again</button>
          </template>
          <template v-else>
            <div class="turn-indicator">
              <span class="turn-emoji">{{ getPlayerEmoji(currentPlayerIndex) }}</span>
              <span class="turn-name">{{ players[currentPlayerIndex]?.name }}'s turn</span>
            </div>
          </template>
        </div>

        <div class="books-progress">
          <div class="progress-bar">
            <div class="progress-fill" :style="{ width: `${(totalBooks / booksToWin) * 100}%` }"></div>
          </div>
          <div class="progress-label">{{ totalBooks }} / {{ booksToWin }} books collected</div>
        </div>
      </div>

      <!-- Last Action Display -->
      <div class="last-action" v-if="lastAction">
        <div class="action-message" :class="'action-' + lastAction.type">
          {{ lastAction.message }}
        </div>
      </div>
    </main>

    <!-- Chat Section -->
    <section class="chat-section">
      <h2 class="chat-title">🗣️ Table Talk</h2>
      <div class="chat-messages" ref="chatContainer">
        <div
          v-for="msg in chatHistory"
          :key="msg.id"
          class="chat-message"
          :class="'msg-' + msg.type"
        >
          <span class="msg-author" v-if="msg.type !== 'system'">{{ msg.fromName }}:</span>
          <span class="msg-text">{{ msg.message }}</span>
        </div>
        <div v-if="chatHistory.length === 0" class="chat-empty">
          Waiting for players to start chatting...
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
import { ref, computed, onMounted, nextTick, watch } from 'vue'
import { io, Socket } from 'socket.io-client'

// Types
interface Player {
  id: string
  name: string
  model: string
  handCount: number
  books: string[]
}

interface GameAction {
  type: 'ask' | 'go_fish' | 'book' | 'game_over'
  playerId: string
  playerName: string
  targetId?: string
  targetName?: string
  rank?: string
  success?: boolean
  cardsReceived?: number
  message?: string
  timestamp: number
}

interface ChatMessage {
  id: string
  from: string
  fromName: string
  message: string
  type: 'ask' | 'response' | 'system' | 'taunt'
  timestamp: number
}

// State
const socket = ref<Socket | null>(null)
const players = ref<Player[]>([])
const currentPlayerIndex = ref(0)
const deckCount = ref(52)
const gameOver = ref(false)
const winner = ref<string | null>(null)
const booksToWin = ref(13)
const lastAction = ref<GameAction | null>(null)
const gameStarted = ref(false)
const chatHistory = ref<ChatMessage[]>([])
const thinkingStates = ref<Record<string, boolean>>({})
const chatContainer = ref<HTMLElement | null>(null)

// Computed
const totalBooks = computed(() => players.value.reduce((sum, p) => sum + p.books.length, 0))

// Player visuals
const playerEmojis = ['🦊', '🐸', '🐙', '🦉']
const getPlayerEmoji = (index: number) => playerEmojis[index] || '🎮'
const getPlayerHue = (index: number) => [140, 200, 280, 40][index] || 0

const getWinnerName = () => {
  const winnerPlayer = players.value.find(p => p.id === winner.value)
  return winnerPlayer?.name || 'Unknown'
}

// Actions
const startGame = async () => {
  try {
    await fetch('http://localhost:3006/api/game/start', { method: 'POST' })
    gameStarted.value = true
  } catch (error) {
    console.error('Failed to start game:', error)
  }
}

const resetGame = async () => {
  try {
    await fetch('http://localhost:3006/api/game/reset', { method: 'POST' })
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

// Socket connection
onMounted(() => {
  socket.value = io('http://localhost:3006')

  socket.value.on('gameState', (state: any) => {
    players.value = state.players
    currentPlayerIndex.value = state.currentPlayerIndex
    deckCount.value = state.deckCount
    gameOver.value = state.gameOver
    winner.value = state.winner
    lastAction.value = state.lastAction
    booksToWin.value = state.booksToWin || 13
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
    players.value = state.players
    currentPlayerIndex.value = state.currentPlayerIndex
    deckCount.value = state.deckCount
    gameOver.value = state.gameOver
    winner.value = state.winner
    lastAction.value = null
    gameStarted.value = false
  })

  socket.value.on('gameOver', ({ winnerId }: { winnerId: string }) => {
    winner.value = winnerId
    gameOver.value = true
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
  --bg-dark: #0d1f17;
  --bg-card: #132922;
  --emerald-primary: #10b981;
  --emerald-light: #34d399;
  --emerald-dark: #059669;
  --teal-primary: #14b8a6;
  --gold-primary: #fbbf24;
  --gold-dark: #d97706;
  --text-primary: #ffffff;
  --text-secondary: #9ca3af;
  --border-color: #1f4d3d;
}

body {
  font-family: 'Poppins', sans-serif;
  background: linear-gradient(135deg, var(--bg-dark) 0%, #0f2920 100%);
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
  font-size: 3rem;
  font-weight: 900;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
}

.title-go {
  color: var(--emerald-light);
}

.title-fish {
  color: var(--teal-primary);
  text-shadow: 0 0 20px var(--teal-primary);
}

.fish-emoji {
  font-size: 2.5rem;
  animation: swim 2s ease-in-out infinite;
}

@keyframes swim {
  0%, 100% { transform: translateY(0) rotate(0deg); }
  25% { transform: translateY(-5px) rotate(5deg); }
  75% { transform: translateY(5px) rotate(-5deg); }
}

.subtitle {
  color: var(--text-secondary);
  font-size: 1rem;
}

/* Game Container */
.game-container {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

/* Players Row */
.players-row {
  display: flex;
  justify-content: center;
  gap: 1.5rem;
  flex-wrap: wrap;
}

.player-card {
  background: var(--bg-card);
  border-radius: 1rem;
  padding: 1.25rem;
  min-width: 180px;
  text-align: center;
  border: 2px solid var(--border-color);
  transition: all 0.3s ease;
  position: relative;
}

.player-card.active {
  border-color: hsl(var(--player-hue), 70%, 50%);
  box-shadow: 0 0 30px hsla(var(--player-hue), 70%, 50%, 0.3);
  transform: translateY(-5px);
}

.player-card.thinking {
  animation: pulse 1.5s infinite;
}

.player-card.winner {
  border-color: var(--gold-primary);
  box-shadow: 0 0 40px rgba(251, 191, 36, 0.4);
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.7; }
}

.player-avatar {
  font-size: 3rem;
  margin-bottom: 0.5rem;
}

.player-name {
  font-weight: 700;
  font-size: 1.1rem;
  margin-bottom: 0.25rem;
}

.player-model {
  color: var(--text-secondary);
  font-size: 0.75rem;
  margin-bottom: 0.75rem;
}

.player-stats {
  display: flex;
  justify-content: center;
  gap: 1.5rem;
  margin-bottom: 0.75rem;
}

.stat {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.stat-value {
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--emerald-light);
}

.stat-label {
  font-size: 0.7rem;
  color: var(--text-secondary);
  text-transform: uppercase;
}

.player-books {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.25rem;
}

.book-badge {
  background: var(--emerald-dark);
  color: white;
  font-size: 0.75rem;
  font-weight: 700;
  padding: 0.2rem 0.4rem;
  border-radius: 0.25rem;
}

.thinking-indicator {
  position: absolute;
  bottom: -1rem;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 0.3rem;
}

.thinking-indicator .dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--emerald-light);
  animation: bounce 1.4s infinite ease-in-out;
}

.thinking-indicator .dot:nth-child(1) { animation-delay: 0s; }
.thinking-indicator .dot:nth-child(2) { animation-delay: 0.2s; }
.thinking-indicator .dot:nth-child(3) { animation-delay: 0.4s; }

@keyframes bounce {
  0%, 80%, 100% { transform: scale(0); }
  40% { transform: scale(1); }
}

/* Center Area */
.center-area {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 3rem;
  padding: 2rem;
  background: rgba(16, 185, 129, 0.05);
  border-radius: 1rem;
  border: 1px solid var(--border-color);
}

.deck-display {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
}

.deck-cards {
  position: relative;
  width: 80px;
  height: 110px;
}

.deck-card {
  position: absolute;
  width: 70px;
  height: 100px;
  background: linear-gradient(135deg, var(--emerald-dark), var(--teal-primary));
  border-radius: 8px;
  border: 2px solid var(--emerald-light);
  top: calc(var(--offset) * -2px);
  left: calc(var(--offset) * 2px);
  box-shadow: 0 2px 4px rgba(0,0,0,0.2);
}

.deck-count {
  color: var(--text-secondary);
  font-size: 0.9rem;
}

.game-status {
  text-align: center;
}

.start-btn, .reset-btn {
  background: linear-gradient(135deg, var(--emerald-primary), var(--emerald-dark));
  color: white;
  border: none;
  padding: 1rem 2.5rem;
  font-size: 1.2rem;
  font-weight: 700;
  border-radius: 0.5rem;
  cursor: pointer;
  transition: all 0.2s ease;
}

.start-btn:hover, .reset-btn:hover {
  transform: scale(1.05);
  box-shadow: 0 0 20px rgba(16, 185, 129, 0.5);
}

.winner-announcement {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 1rem;
}

.winner-emoji {
  font-size: 3rem;
  animation: celebrate 0.5s ease-in-out infinite alternate;
}

@keyframes celebrate {
  from { transform: scale(1) rotate(-5deg); }
  to { transform: scale(1.1) rotate(5deg); }
}

.winner-name {
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--gold-primary);
  text-shadow: 0 0 10px rgba(251, 191, 36, 0.5);
}

.turn-indicator {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  font-size: 1.2rem;
}

.turn-emoji {
  font-size: 2rem;
}

.turn-name {
  color: var(--emerald-light);
  font-weight: 600;
}

.books-progress {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  min-width: 200px;
}

.progress-bar {
  width: 100%;
  height: 12px;
  background: var(--bg-dark);
  border-radius: 6px;
  overflow: hidden;
  border: 1px solid var(--border-color);
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--emerald-dark), var(--emerald-light));
  transition: width 0.5s ease;
}

.progress-label {
  color: var(--text-secondary);
  font-size: 0.8rem;
}

/* Last Action */
.last-action {
  text-align: center;
  padding: 1rem;
}

.action-message {
  display: inline-block;
  padding: 0.75rem 1.5rem;
  border-radius: 2rem;
  font-weight: 600;
  animation: fadeIn 0.3s ease;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(-10px); }
  to { opacity: 1; transform: translateY(0); }
}

.action-ask {
  background: rgba(16, 185, 129, 0.2);
  border: 1px solid var(--emerald-primary);
  color: var(--emerald-light);
}

.action-go_fish {
  background: rgba(20, 184, 166, 0.2);
  border: 1px solid var(--teal-primary);
  color: var(--teal-primary);
}

.action-book {
  background: rgba(251, 191, 36, 0.2);
  border: 1px solid var(--gold-primary);
  color: var(--gold-primary);
}

.action-game_over {
  background: rgba(251, 191, 36, 0.3);
  border: 2px solid var(--gold-primary);
  color: var(--gold-primary);
  font-size: 1.2rem;
}

/* Chat Section */
.chat-section {
  margin-top: 1.5rem;
  background: var(--bg-card);
  border-radius: 1rem;
  padding: 1rem;
  border: 1px solid var(--border-color);
}

.chat-title {
  font-size: 1rem;
  color: var(--emerald-light);
  margin-bottom: 0.75rem;
}

.chat-messages {
  max-height: 180px;
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
  background: rgba(16, 185, 129, 0.1);
  color: var(--emerald-light);
  text-align: center;
  font-style: italic;
}

.msg-ask {
  background: rgba(20, 184, 166, 0.1);
  border-left: 3px solid var(--teal-primary);
}

.msg-response {
  background: rgba(16, 185, 129, 0.1);
  border-left: 3px solid var(--emerald-primary);
}

.msg-taunt {
  background: rgba(251, 191, 36, 0.1);
  border-left: 3px solid var(--gold-primary);
}

.msg-author {
  font-weight: 600;
  margin-right: 0.5rem;
  color: var(--emerald-light);
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
  color: var(--emerald-primary);
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
  background: var(--emerald-dark);
  border-radius: 3px;
}

::-webkit-scrollbar-thumb:hover {
  background: var(--emerald-primary);
}
</style>
