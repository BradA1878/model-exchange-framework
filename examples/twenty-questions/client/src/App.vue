<template>
  <div class="app">
    <!-- Header -->
    <header class="header">
      <h1>
        <span class="title-icon">?</span>
        <span class="title-text">Twenty Questions</span>
      </h1>
      <p class="subtitle">Advanced MXF Features Demo</p>
    </header>

    <!-- Main Layout -->
    <main class="main-container">
      <!-- Left Column: Players -->
      <aside class="players-column">
        <!-- Thinker Card -->
        <div
          class="player-card thinker"
          :class="{
            active: currentTurn === 'thinker' && !gameOver,
            thinking: thinkingStates['agent-thinker']
          }"
        >
          <div class="player-icon">🧠</div>
          <div class="player-info">
            <div class="player-role">THINKER</div>
            <div class="player-name">{{ players.thinker?.name || 'The Sphinx' }}</div>
            <div class="player-model">{{ players.thinker?.model || 'Waiting...' }}</div>
          </div>
          <div v-if="secretThing && phase !== 'setup'" class="secret-badge">
            Secret: {{ secretThing }}
          </div>
          <div v-if="thinkingStates['agent-thinker']" class="thinking-indicator">
            <span class="dot"></span><span class="dot"></span><span class="dot"></span>
          </div>
        </div>

        <!-- Guesser Card -->
        <div
          class="player-card guesser"
          :class="{
            active: currentTurn === 'guesser' && !gameOver,
            thinking: thinkingStates['agent-guesser']
          }"
        >
          <div class="player-icon">🔍</div>
          <div class="player-info">
            <div class="player-role">GUESSER</div>
            <div class="player-name">{{ players.guesser?.name || 'Detective Mind' }}</div>
            <div class="player-model">{{ players.guesser?.model || 'Waiting...' }}</div>
          </div>
          <div v-if="category" class="category-badge">
            Category: {{ category }}
          </div>
          <!-- Risk Gauge: ML-based guess timing indicator -->
          <div v-if="latestRisk" class="risk-gauge" :class="riskLevel">
            <div class="risk-label">Risk</div>
            <div class="risk-bar-track">
              <div class="risk-bar-fill" :style="{ width: (latestRisk.riskScore * 100) + '%' }"></div>
            </div>
            <div class="risk-text">{{ latestRisk.recommendation === 'guess_now' ? 'Guess!' : 'Ask more' }}</div>
          </div>
          <div v-if="thinkingStates['agent-guesser']" class="thinking-indicator">
            <span class="dot"></span><span class="dot"></span><span class="dot"></span>
          </div>
        </div>

        <!-- Game Controls -->
        <div class="game-controls">
          <template v-if="!gameStarted">
            <button class="btn btn-start" @click="startGame">
              Start Game
            </button>
          </template>
          <template v-else-if="gameOver">
            <div class="winner-badge" :class="winner">
              {{ winner === 'guesser' ? 'Guesser Wins!' : 'Thinker Wins!' }}
            </div>
            <button class="btn btn-reset" @click="resetGame">Play Again</button>
          </template>
          <template v-else>
            <div class="question-counter">
              <span class="count">{{ questionsAsked }}</span>
              <span class="divider">/</span>
              <span class="max">{{ maxQuestions }}</span>
              <span class="label">questions</span>
            </div>
          </template>
        </div>
      </aside>

      <!-- Center: ORPAR Visualization -->
      <section class="orpar-section">
        <h2 class="section-title">ORPAR Cognitive Cycles</h2>

        <!-- THINKER ORPAR Row -->
        <div class="agent-orpar-row thinker-row">
          <div class="agent-orpar-label thinker">
            <span class="agent-icon">🧠</span>
            <span class="agent-name">THINKER</span>
          </div>
          <div class="orpar-row-content">
            <div class="orpar-cycle compact">
              <div
                v-for="(phase, index) in orparPhases"
                :key="'thinker-' + phase.name"
                class="orpar-phase-compact thinker"
                :class="{
                  active: isThinkerPhaseActive(phase.name),
                  completed: isThinkerPhaseCompleted(phase.name, index)
                }"
              >
                <div class="phase-icon-compact">{{ phase.icon }}</div>
                <div class="phase-name-compact">{{ phase.name }}</div>
              </div>
            </div>
            <div v-if="thinkerOrparPhase" class="phase-summary-compact thinker">
              <span class="phase-label">{{ thinkerOrparPhase }}:</span> {{ thinkerPhaseSummary }}
            </div>
          </div>
        </div>

        <!-- GUESSER ORPAR Row -->
        <div class="agent-orpar-row guesser-row">
          <div class="agent-orpar-label guesser">
            <span class="agent-icon">🔍</span>
            <span class="agent-name">GUESSER</span>
          </div>
          <div class="orpar-row-content">
            <div class="orpar-cycle compact">
              <div
                v-for="(phase, index) in orparPhases"
                :key="'guesser-' + phase.name"
                class="orpar-phase-compact guesser"
                :class="{
                  active: isGuesserPhaseActive(phase.name),
                  completed: isGuesserPhaseCompleted(phase.name, index)
                }"
              >
                <div class="phase-icon-compact">{{ phase.icon }}</div>
                <div class="phase-name-compact">{{ phase.name }}</div>
              </div>
            </div>
            <div v-if="guesserOrparPhase" class="phase-summary-compact guesser">
              <span class="phase-label">{{ guesserOrparPhase }}:</span> {{ guesserPhaseSummary }}
            </div>
          </div>
        </div>

        <!-- ORPAR Timeline -->
        <div class="orpar-timeline">
          <h3 class="timeline-title">Phase Timeline</h3>
          <div class="timeline-events" ref="timelineContainer">
            <div
              v-for="event in orparEvents.slice(-10)"
              :key="event.timestamp"
              class="timeline-event"
              :class="[event.role, { 'has-reward': hasMulsRewardForQuestion(event) }]"
            >
              <span class="event-time">{{ formatTime(event.timestamp) }}</span>
              <span class="event-role">{{ event.role }}</span>
              <span class="event-phase">{{ event.phase }}</span>
              <!-- MULS reward indicator on Reflect phase events -->
              <span v-if="event.phase === 'Reflect' && hasMulsRewardForQuestion(event)" class="muls-indicator" title="MULS reward injected">Q</span>
            </div>
            <div v-if="orparEvents.length === 0" class="timeline-empty">
              Waiting for ORPAR events...
            </div>
          </div>
        </div>

        <!-- Knowledge Model Panel: Guesser's mental model of the possibility space -->
        <div class="knowledge-panel">
          <h3 class="knowledge-title">Knowledge Model</h3>
          <div v-if="knowledgeGraph.nodes.length === 0" class="knowledge-empty">
            Guesser hasn't built a model yet...
          </div>
          <div v-else class="knowledge-content">
            <div class="knowledge-stats">
              <span class="kg-stat">{{ knowledgeGraph.nodes.length }} entities</span>
              <span class="kg-stat-sep">|</span>
              <span class="kg-stat">{{ knowledgeGraph.edges.length }} relationships</span>
            </div>
            <!-- Confirmed properties -->
            <div v-if="kgProperties.length > 0" class="kg-section">
              <div class="kg-section-label">Confirmed</div>
              <div class="kg-tags">
                <span v-for="node in kgProperties" :key="node.entity" class="kg-tag property">{{ node.entity }}</span>
              </div>
            </div>
            <!-- Candidate guesses -->
            <div v-if="kgCandidates.length > 0" class="kg-section">
              <div class="kg-section-label">Candidates</div>
              <div class="kg-tags">
                <span v-for="node in kgCandidates" :key="node.entity" class="kg-tag candidate">{{ node.entity }}</span>
              </div>
            </div>
            <!-- Eliminated -->
            <div v-if="kgEliminated.length > 0" class="kg-section">
              <div class="kg-section-label">Eliminated</div>
              <div class="kg-tags">
                <span v-for="node in kgEliminated" :key="node.entity" class="kg-tag eliminated">{{ node.entity }}</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- Right Column: Q&A History -->
      <aside class="qa-column">
        <!-- Secret Display -->
        <div v-if="secretThing && phase !== 'setup'" class="secret-display">
          <div class="secret-header">
            <span class="secret-icon">🎯</span>
            <span class="secret-label">THE SECRET</span>
          </div>
          <div class="secret-value">{{ secretThing }}</div>
          <div v-if="category" class="secret-category">Category: {{ category }}</div>
        </div>

        <h2 class="section-title">Question & Answer Log</h2>

        <div class="qa-history" ref="qaContainer">
          <div
            v-for="qa in questionHistory"
            :key="qa.questionNumber"
            class="qa-item"
          >
            <div class="qa-number">Q{{ qa.questionNumber }}</div>
            <div class="qa-content">
              <div class="qa-question">{{ qa.question }}</div>
              <div class="qa-answer" :class="qa.answer">
                {{ qa.answer.toUpperCase() }}
              </div>
            </div>
          </div>
          <div v-if="questionHistory.length === 0" class="qa-empty">
            No questions asked yet...
          </div>
        </div>

        <!-- Chat/Events -->
        <div class="chat-section">
          <h3 class="chat-title">Events</h3>
          <div class="chat-messages" ref="chatContainer">
            <div
              v-for="msg in chatHistory.slice(-20)"
              :key="msg.id"
              class="chat-message"
              :class="msg.type"
            >
              <span class="msg-author">{{ msg.fromName }}</span>
              <span class="msg-text">{{ msg.message }}</span>
            </div>
            <div v-if="chatHistory.length === 0" class="chat-empty">
              Waiting for game events...
            </div>
          </div>
        </div>
      </aside>
    </main>

    <!-- Footer -->
    <footer class="footer">
      <span>Powered by</span>
      <strong>MXF</strong>
      <span class="separator">|</span>
      <span>Model Exchange Framework</span>
      <span class="separator">|</span>
      <span>ORPAR + Knowledge Graph + MULS + TensorFlow ML</span>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, nextTick, watch, computed } from 'vue'
import { io, Socket } from 'socket.io-client'

// Types
interface PlayerInfo {
  agentId: string
  name: string
  model: string
  personality: string
  orparPhases: OrparPhaseLog[]
}

interface OrparPhaseLog {
  phase: string
  timestamp: number
  summary: string
}

interface QuestionAnswer {
  questionNumber: number
  question: string
  answer: string
  reasoning?: string
  guesserReasoning?: string
  timestamp: number
  orparCycle: number
}

interface ChatMessage {
  id: string
  from: string
  fromName: string
  message: string
  type: 'question' | 'answer' | 'guess' | 'system' | 'orpar'
  timestamp: number
}

interface OrparEvent {
  agentId: string
  role: string
  phase: string
  summary: string
  timestamp: number
}

// Knowledge Graph types for Guesser's mental model
interface KnowledgeNode {
  entity: string
  type: 'category' | 'property' | 'candidate' | 'eliminated'
  confidence: number
  questionNumber: number
}

interface KnowledgeEdge {
  from: string
  to: string
  relationship: string
  questionNumber: number
}

// Risk assessment from TF/ML service
interface RiskAssessment {
  questionNumber: number
  riskScore: number
  confidence: number
  recommendation: string
  timestamp: number
}

// MULS reward tracking
interface MulsReward {
  questionNumber: number
  reward: number
  reason: string
  timestamp: number
}

interface GameState {
  phase: string
  secretThing: string | null
  category: string | null
  questionsAsked: number
  maxQuestions: number
  questionHistory: QuestionAnswer[]
  winner: string | null
  gameOver: boolean
  players: {
    thinker: PlayerInfo
    guesser: PlayerInfo
  }
  currentTurn: string
  orparCycleCount: number
  knowledgeGraph: { nodes: KnowledgeNode[], edges: KnowledgeEdge[] }
  riskAssessments: RiskAssessment[]
  mulsRewards: MulsReward[]
}

// ORPAR phase definitions
const orparPhases = [
  { name: 'Observe', icon: '👁️', description: 'Gather context' },
  { name: 'Reason', icon: '🧠', description: 'Analyze data' },
  { name: 'Plan', icon: '📋', description: 'Create strategy' },
  { name: 'Act', icon: '⚡', description: 'Execute action' },
  { name: 'Reflect', icon: '💭', description: 'Learn & adapt' }
]

// State
const socket = ref<Socket | null>(null)
const phase = ref('setup')
const secretThing = ref<string | null>(null)
const category = ref<string | null>(null)
const questionsAsked = ref(0)
const maxQuestions = ref(20)
const questionHistory = ref<QuestionAnswer[]>([])
const winner = ref<string | null>(null)
const gameOver = ref(false)
const gameStarted = ref(false)
const currentTurn = ref('thinker')
const players = ref<{ thinker: PlayerInfo | null; guesser: PlayerInfo | null }>({
  thinker: null,
  guesser: null
})
const chatHistory = ref<ChatMessage[]>([])
const orparEvents = ref<OrparEvent[]>([])
const thinkingStates = ref<Record<string, boolean>>({})

// Separate ORPAR tracking per agent
const thinkerOrparPhase = ref<string | null>(null)
const thinkerPhaseSummary = ref<string>('')
const guesserOrparPhase = ref<string | null>(null)
const guesserPhaseSummary = ref<string>('')

// Advanced feature state: Knowledge Graph, Risk Assessment, MULS
const knowledgeGraph = ref<{ nodes: KnowledgeNode[], edges: KnowledgeEdge[] }>({ nodes: [], edges: [] })
const latestRisk = ref<RiskAssessment | null>(null)
const mulsRewards = ref<MulsReward[]>([])

// Computed: Knowledge Graph filtered views
const kgProperties = computed(() => knowledgeGraph.value.nodes.filter(n => n.type === 'property'))
const kgCandidates = computed(() => knowledgeGraph.value.nodes.filter(n => n.type === 'candidate'))
const kgEliminated = computed(() => knowledgeGraph.value.nodes.filter(n => n.type === 'eliminated'))

// Computed: Risk level classification for color coding
const riskLevel = computed(() => {
  if (!latestRisk.value) return 'low'
  const score = latestRisk.value.riskScore
  if (score > 0.7) return 'high'
  if (score > 0.4) return 'medium'
  return 'low'
})

// Helper: Check if a MULS reward was injected near an ORPAR event's question
const hasMulsRewardForQuestion = (event: OrparEvent): boolean => {
  // Match rewards that happened within 5 seconds of the event
  return mulsRewards.value.some(r =>
    Math.abs(r.timestamp - event.timestamp) < 5000
  )
}

// Refs for auto-scroll
const qaContainer = ref<HTMLElement | null>(null)
const chatContainer = ref<HTMLElement | null>(null)
const timelineContainer = ref<HTMLElement | null>(null)

// Helper functions for per-agent ORPAR tracking
const isThinkerPhaseActive = (phaseName: string): boolean => {
  return thinkerOrparPhase.value === phaseName
}

const isThinkerPhaseCompleted = (phaseName: string, index: number): boolean => {
  if (!thinkerOrparPhase.value) return false
  const currentIndex = orparPhases.findIndex(p => p.name === thinkerOrparPhase.value)
  return index < currentIndex
}

const isGuesserPhaseActive = (phaseName: string): boolean => {
  return guesserOrparPhase.value === phaseName
}

const isGuesserPhaseCompleted = (phaseName: string, index: number): boolean => {
  if (!guesserOrparPhase.value) return false
  const currentIndex = orparPhases.findIndex(p => p.name === guesserOrparPhase.value)
  return index < currentIndex
}

// Format timestamp
const formatTime = (timestamp: number): string => {
  const date = new Date(timestamp)
  return date.toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
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
    orparEvents.value = []
    // Reset per-agent ORPAR state
    thinkerOrparPhase.value = null
    thinkerPhaseSummary.value = ''
    guesserOrparPhase.value = null
    guesserPhaseSummary.value = ''
    // Reset advanced feature state
    knowledgeGraph.value = { nodes: [], edges: [] }
    latestRisk.value = null
    mulsRewards.value = []
  } catch (error) {
    console.error('Failed to reset game:', error)
  }
}

// Auto-scroll watchers
watch(questionHistory, () => {
  nextTick(() => {
    if (qaContainer.value) {
      qaContainer.value.scrollTop = qaContainer.value.scrollHeight
    }
  })
}, { deep: true })

watch(chatHistory, () => {
  nextTick(() => {
    if (chatContainer.value) {
      chatContainer.value.scrollTop = chatContainer.value.scrollHeight
    }
  })
}, { deep: true })

watch(orparEvents, () => {
  nextTick(() => {
    if (timelineContainer.value) {
      timelineContainer.value.scrollTop = timelineContainer.value.scrollHeight
    }
  })
}, { deep: true })

// Socket connection
onMounted(() => {
  socket.value = io('http://localhost:3006')

  socket.value.on('gameState', (state: GameState) => {
    phase.value = state.phase
    secretThing.value = state.secretThing
    category.value = state.category
    questionsAsked.value = state.questionsAsked
    maxQuestions.value = state.maxQuestions
    questionHistory.value = state.questionHistory
    winner.value = state.winner
    gameOver.value = state.gameOver
    currentTurn.value = state.currentTurn
    players.value = state.players
    // Sync advanced feature state from full game state
    if (state.knowledgeGraph) {
      knowledgeGraph.value = state.knowledgeGraph
    }
    if (state.riskAssessments && state.riskAssessments.length > 0) {
      latestRisk.value = state.riskAssessments[state.riskAssessments.length - 1]
    }
    if (state.mulsRewards) {
      mulsRewards.value = state.mulsRewards
    }
  })

  socket.value.on('chatHistory', (history: ChatMessage[]) => {
    chatHistory.value = history
  })

  socket.value.on('chatMessage', (msg: ChatMessage) => {
    chatHistory.value.push(msg)
  })

  socket.value.on('orparHistory', (history: OrparEvent[]) => {
    orparEvents.value = history
    // Initialize per-agent state from history
    const thinkerEvents = history.filter(e => e.role.toLowerCase() === 'thinker')
    const guesserEvents = history.filter(e => e.role.toLowerCase() === 'guesser')
    if (thinkerEvents.length > 0) {
      const last = thinkerEvents[thinkerEvents.length - 1]
      thinkerOrparPhase.value = last.phase
      thinkerPhaseSummary.value = last.summary
    }
    if (guesserEvents.length > 0) {
      const last = guesserEvents[guesserEvents.length - 1]
      guesserOrparPhase.value = last.phase
      guesserPhaseSummary.value = last.summary
    }
  })

  socket.value.on('orparEvent', (event: OrparEvent) => {
    orparEvents.value.push(event)

    // Update agent-specific ORPAR state
    if (event.role.toLowerCase() === 'thinker') {
      thinkerOrparPhase.value = event.phase
      thinkerPhaseSummary.value = event.summary
    } else if (event.role.toLowerCase() === 'guesser') {
      guesserOrparPhase.value = event.phase
      guesserPhaseSummary.value = event.summary
    }
  })

  socket.value.on('thinkingStates', (states: Record<string, boolean>) => {
    thinkingStates.value = states
  })

  socket.value.on('thinkingState', ({ playerId, isThinking }: { playerId: string; isThinking: boolean }) => {
    thinkingStates.value[playerId] = isThinking
  })

  socket.value.on('phaseChange', ({ phase: newPhase, role }: { phase: string; role: string }) => {
    phase.value = newPhase
    currentTurn.value = role
  })

  socket.value.on('gameOver', ({ winner: w }: { winner: string }) => {
    winner.value = w
    gameOver.value = true
  })

  // Advanced feature event listeners

  // Knowledge Graph: Initial state on connect and live updates
  socket.value.on('knowledgeGraph', (kg: { nodes: KnowledgeNode[], edges: KnowledgeEdge[] }) => {
    knowledgeGraph.value = kg
  })

  socket.value.on('knowledgeUpdate', (event: any) => {
    if (event.knowledgeGraph) {
      knowledgeGraph.value = event.knowledgeGraph
    }
  })

  // Risk Assessment: Track latest ML risk score
  socket.value.on('riskAssessment', (assessment: RiskAssessment) => {
    latestRisk.value = assessment
  })

  // MULS Rewards: Track reward injections
  socket.value.on('mulsReward', (reward: MulsReward) => {
    mulsRewards.value.push(reward)
  })

  // Handle game reset for advanced features
  socket.value.on('gameReset', (state: GameState) => {
    phase.value = state.phase
    secretThing.value = state.secretThing
    category.value = state.category
    questionsAsked.value = state.questionsAsked
    maxQuestions.value = state.maxQuestions
    questionHistory.value = state.questionHistory
    winner.value = state.winner
    gameOver.value = state.gameOver
    currentTurn.value = state.currentTurn
    players.value = state.players
    gameStarted.value = false
    orparEvents.value = []
    // Reset per-agent ORPAR state
    thinkerOrparPhase.value = null
    thinkerPhaseSummary.value = ''
    guesserOrparPhase.value = null
    guesserPhaseSummary.value = ''
    // Reset advanced feature state
    knowledgeGraph.value = { nodes: [], edges: [] }
    latestRisk.value = null
    mulsRewards.value = []
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
  --bg-dark: #0f0f1a;
  --bg-card: #1a1a2e;
  --bg-hover: #252540;
  --purple-primary: #9b59b6;
  --purple-light: #bb6bd9;
  --purple-dark: #7d3c98;
  --teal-primary: #1abc9c;
  --teal-dark: #16a085;
  --orange-primary: #f39c12;
  --orange-light: #f1c40f;
  --blue-primary: #3498db;
  --green-primary: #2ecc71;
  --red-primary: #e74c3c;
  --text-primary: #ffffff;
  --text-secondary: #a0a0b0;
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
  max-width: 1600px;
  margin: 0 auto;
}

/* Header */
.header {
  text-align: center;
  padding: 0.5rem 0 1rem;
}

.header h1 {
  font-size: 2.5rem;
  font-weight: 900;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
}

.title-icon {
  font-size: 3rem;
  color: var(--purple-primary);
  text-shadow: 0 0 20px var(--purple-primary);
}

.title-text {
  background: linear-gradient(135deg, var(--purple-light), var(--teal-primary));
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.subtitle {
  color: var(--text-secondary);
  font-size: 1rem;
  margin-top: 0.25rem;
}

/* Main Layout */
.main-container {
  display: grid;
  grid-template-columns: 240px 1fr 320px;
  gap: 1.5rem;
  flex: 1;
}

/* Section Title */
.section-title {
  font-size: 1rem;
  color: var(--purple-primary);
  text-transform: uppercase;
  letter-spacing: 0.1em;
  margin-bottom: 1rem;
  padding-bottom: 0.5rem;
  border-bottom: 1px solid var(--border-color);
}

/* Players Column */
.players-column {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.player-card {
  background: var(--bg-card);
  border-radius: 1rem;
  padding: 1.25rem;
  border: 2px solid var(--border-color);
  transition: all 0.3s ease;
  position: relative;
}

.player-card.active {
  transform: scale(1.02);
}

.player-card.thinking {
  animation: pulse 1.5s infinite;
}

.player-card.thinker.active {
  border-color: var(--purple-primary);
  box-shadow: 0 0 25px rgba(155, 89, 182, 0.3);
}

.player-card.guesser.active {
  border-color: var(--teal-primary);
  box-shadow: 0 0 25px rgba(26, 188, 156, 0.3);
}

.player-icon {
  font-size: 2.5rem;
  text-align: center;
  margin-bottom: 0.5rem;
}

.player-role {
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.15em;
  text-align: center;
  margin-bottom: 0.25rem;
}

.thinker .player-role { color: var(--purple-primary); }
.guesser .player-role { color: var(--teal-primary); }

.player-name {
  font-weight: 600;
  text-align: center;
  font-size: 1rem;
}

.player-model {
  color: var(--text-secondary);
  font-size: 0.7rem;
  text-align: center;
  margin-top: 0.25rem;
}

.secret-badge, .category-badge {
  margin-top: 0.75rem;
  padding: 0.5rem;
  border-radius: 0.5rem;
  font-size: 0.75rem;
  text-align: center;
}

.secret-badge {
  background: rgba(155, 89, 182, 0.2);
  color: var(--purple-light);
  border: 1px solid var(--purple-dark);
}

.category-badge {
  background: rgba(26, 188, 156, 0.2);
  color: var(--teal-primary);
  border: 1px solid var(--teal-dark);
}

.thinking-indicator {
  position: absolute;
  bottom: -1rem;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 0.25rem;
}

.thinking-indicator .dot {
  width: 6px;
  height: 6px;
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

/* Game Controls */
.game-controls {
  background: var(--bg-card);
  border-radius: 1rem;
  padding: 1rem;
  text-align: center;
}

.btn {
  background: linear-gradient(135deg, var(--purple-primary), var(--purple-dark));
  color: white;
  border: none;
  padding: 0.75rem 1.5rem;
  font-size: 1rem;
  font-weight: 700;
  border-radius: 0.5rem;
  cursor: pointer;
  transition: all 0.2s ease;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  width: 100%;
}

.btn:hover {
  transform: scale(1.02);
  box-shadow: 0 0 20px rgba(155, 89, 182, 0.5);
}

.btn-reset {
  background: linear-gradient(135deg, var(--orange-primary), #d68910);
}

.btn-reset:hover {
  box-shadow: 0 0 20px rgba(243, 156, 18, 0.5);
}

.question-counter {
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: 0.25rem;
}

.question-counter .count {
  font-size: 2.5rem;
  font-weight: 900;
  color: var(--orange-primary);
}

.question-counter .divider {
  font-size: 1.5rem;
  color: var(--text-secondary);
}

.question-counter .max {
  font-size: 1.5rem;
  color: var(--text-secondary);
}

.question-counter .label {
  font-size: 0.75rem;
  color: var(--text-secondary);
  margin-left: 0.5rem;
}

.winner-badge {
  font-size: 1.25rem;
  font-weight: 700;
  padding: 0.75rem;
  border-radius: 0.5rem;
  margin-bottom: 0.75rem;
}

.winner-badge.guesser {
  background: rgba(26, 188, 156, 0.2);
  color: var(--teal-primary);
}

.winner-badge.thinker {
  background: rgba(155, 89, 182, 0.2);
  color: var(--purple-light);
}

/* ORPAR Section */
.orpar-section {
  background: var(--bg-card);
  border-radius: 1rem;
  padding: 1.25rem;
  display: flex;
  flex-direction: column;
}

.orpar-cycle {
  display: flex;
  justify-content: space-between;
  gap: 0.5rem;
  margin-bottom: 1.5rem;
}

.orpar-phase {
  flex: 1;
  background: var(--bg-dark);
  border-radius: 0.75rem;
  padding: 1rem 0.5rem;
  text-align: center;
  border: 2px solid var(--border-color);
  transition: all 0.3s ease;
  position: relative;
}

.orpar-phase::after {
  content: '→';
  position: absolute;
  right: -1rem;
  top: 50%;
  transform: translateY(-50%);
  color: var(--border-color);
  font-size: 1.25rem;
}

.orpar-phase:last-child::after {
  display: none;
}

.orpar-phase.active {
  border-color: var(--orange-primary);
  background: rgba(243, 156, 18, 0.1);
  box-shadow: 0 0 20px rgba(243, 156, 18, 0.3);
  transform: scale(1.05);
}

.orpar-phase.completed {
  border-color: var(--green-primary);
  background: rgba(46, 204, 113, 0.1);
}

.phase-icon {
  font-size: 1.75rem;
  margin-bottom: 0.5rem;
}

.phase-name {
  font-weight: 700;
  font-size: 0.85rem;
  margin-bottom: 0.25rem;
}

.phase-description {
  font-size: 0.65rem;
  color: var(--text-secondary);
}

/* Current Phase Detail */
.current-phase-detail {
  background: var(--bg-dark);
  border-radius: 0.75rem;
  padding: 1rem;
  margin-bottom: 1rem;
  border-left: 4px solid var(--orange-primary);
}

.phase-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}

.phase-agent {
  background: var(--purple-primary);
  color: white;
  padding: 0.25rem 0.5rem;
  border-radius: 0.25rem;
  font-size: 0.7rem;
  font-weight: 700;
}

.phase-arrow {
  color: var(--text-secondary);
}

.phase-name-large {
  font-weight: 700;
  color: var(--orange-primary);
}

.phase-summary {
  color: var(--text-secondary);
  font-size: 0.85rem;
}

/* Agent-specific ORPAR Rows */
.agent-orpar-row {
  display: flex;
  align-items: flex-start;
  gap: 1rem;
  padding: 0.75rem;
  background: var(--bg-dark);
  border-radius: 0.75rem;
  margin-bottom: 0.75rem;
  border: 2px solid var(--border-color);
  transition: all 0.3s ease;
}

.orpar-row-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.agent-orpar-row.thinker-row {
  border-left: 4px solid var(--purple-primary);
}

.agent-orpar-row.guesser-row {
  border-left: 4px solid var(--teal-primary);
}

.agent-orpar-label {
  display: flex;
  flex-direction: column;
  align-items: center;
  min-width: 70px;
}

.agent-orpar-label .agent-icon {
  font-size: 1.5rem;
}

.agent-orpar-label .agent-name {
  font-size: 0.65rem;
  font-weight: 700;
  letter-spacing: 0.1em;
}

.agent-orpar-label.thinker .agent-name {
  color: var(--purple-primary);
}

.agent-orpar-label.guesser .agent-name {
  color: var(--teal-primary);
}

.orpar-cycle.compact {
  display: flex;
  gap: 0.25rem;
  flex: 1;
}

.orpar-phase-compact {
  flex: 1;
  background: var(--bg-card);
  border-radius: 0.5rem;
  padding: 0.5rem 0.25rem;
  text-align: center;
  border: 2px solid var(--border-color);
  transition: all 0.3s ease;
  position: relative;
}

.orpar-phase-compact::after {
  content: '>';
  position: absolute;
  right: -0.5rem;
  top: 50%;
  transform: translateY(-50%);
  color: var(--border-color);
  font-size: 0.75rem;
  font-weight: bold;
}

.orpar-phase-compact:last-child::after {
  display: none;
}

.orpar-phase-compact.thinker.active {
  border-color: var(--purple-primary);
  background: rgba(155, 89, 182, 0.2);
  box-shadow: 0 0 15px rgba(155, 89, 182, 0.4);
  transform: scale(1.05);
}

.orpar-phase-compact.guesser.active {
  border-color: var(--teal-primary);
  background: rgba(26, 188, 156, 0.2);
  box-shadow: 0 0 15px rgba(26, 188, 156, 0.4);
  transform: scale(1.05);
}

.orpar-phase-compact.thinker.completed {
  border-color: var(--purple-dark);
  background: rgba(155, 89, 182, 0.1);
}

.orpar-phase-compact.guesser.completed {
  border-color: var(--teal-dark);
  background: rgba(26, 188, 156, 0.1);
}

.phase-icon-compact {
  font-size: 1rem;
  margin-bottom: 0.15rem;
}

.phase-name-compact {
  font-weight: 600;
  font-size: 0.6rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.phase-summary-compact {
  font-size: 0.75rem;
  color: var(--text-secondary);
  padding: 0.4rem 0.6rem;
  background: var(--bg-card);
  border-radius: 0.35rem;
  line-height: 1.4;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.phase-summary-compact .phase-label {
  font-weight: 700;
  text-transform: capitalize;
}

.phase-summary-compact.thinker {
  border-left: 3px solid var(--purple-primary);
}

.phase-summary-compact.thinker .phase-label {
  color: var(--purple-light);
}

.phase-summary-compact.guesser {
  border-left: 3px solid var(--teal-primary);
}

.phase-summary-compact.guesser .phase-label {
  color: var(--teal-primary);
}

/* ORPAR Timeline */
.orpar-timeline {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.timeline-title {
  font-size: 0.85rem;
  color: var(--text-secondary);
  margin-bottom: 0.5rem;
}

.timeline-events {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  max-height: 200px;
}

.timeline-event {
  display: flex;
  gap: 0.75rem;
  padding: 0.4rem 0.6rem;
  background: var(--bg-dark);
  border-radius: 0.35rem;
  font-size: 0.75rem;
  align-items: center;
}

.timeline-event.thinker {
  border-left: 3px solid var(--purple-primary);
}

.timeline-event.guesser {
  border-left: 3px solid var(--teal-primary);
}

.event-time {
  color: var(--text-secondary);
  font-family: monospace;
  font-size: 0.7rem;
}

.event-role {
  font-weight: 600;
  min-width: 60px;
}

.timeline-event.thinker .event-role { color: var(--purple-light); }
.timeline-event.guesser .event-role { color: var(--teal-primary); }

.event-phase {
  color: var(--orange-primary);
  font-weight: 600;
}

.timeline-empty {
  color: var(--text-secondary);
  font-style: italic;
  text-align: center;
  padding: 1rem;
}

/* Q&A Column */
.qa-column {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

/* Secret Display */
.secret-display {
  background: linear-gradient(135deg, rgba(243, 156, 18, 0.15), rgba(241, 196, 15, 0.1));
  border: 2px solid var(--orange-primary);
  border-radius: 1rem;
  padding: 1rem;
  text-align: center;
  box-shadow: 0 0 20px rgba(243, 156, 18, 0.2);
}

.secret-header {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}

.secret-icon {
  font-size: 1.25rem;
}

.secret-label {
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.15em;
  color: var(--orange-primary);
}

.secret-value {
  font-size: 1.5rem;
  font-weight: 900;
  color: var(--orange-light);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.secret-category {
  font-size: 0.75rem;
  color: var(--text-secondary);
  margin-top: 0.25rem;
}

.qa-history {
  background: var(--bg-card);
  border-radius: 1rem;
  padding: 1rem;
  flex: 1;
  overflow-y: auto;
  max-height: 300px;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.qa-item {
  display: flex;
  gap: 0.75rem;
  padding: 0.75rem;
  background: var(--bg-dark);
  border-radius: 0.5rem;
}

.qa-number {
  background: var(--purple-primary);
  color: white;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.7rem;
  font-weight: 700;
  flex-shrink: 0;
}

.qa-content {
  flex: 1;
}

.qa-question {
  font-size: 0.9rem;
  margin-bottom: 0.5rem;
}

.qa-answer {
  display: inline-block;
  padding: 0.25rem 0.75rem;
  border-radius: 1rem;
  font-size: 0.75rem;
  font-weight: 700;
}

.qa-answer.yes {
  background: rgba(46, 204, 113, 0.2);
  color: var(--green-primary);
}

.qa-answer.no {
  background: rgba(231, 76, 60, 0.2);
  color: var(--red-primary);
}

.qa-answer.sometimes {
  background: rgba(243, 156, 18, 0.2);
  color: var(--orange-primary);
}

.qa-answer.unknown {
  background: rgba(160, 160, 176, 0.2);
  color: var(--text-secondary);
}

.qa-empty {
  color: var(--text-secondary);
  font-style: italic;
  text-align: center;
  padding: 2rem;
}

/* Chat Section */
.chat-section {
  background: var(--bg-card);
  border-radius: 1rem;
  padding: 1rem;
  flex: 1;
  display: flex;
  flex-direction: column;
}

.chat-title {
  font-size: 0.85rem;
  color: var(--orange-primary);
  margin-bottom: 0.5rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
}

.chat-messages {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  max-height: 200px;
}

.chat-message {
  padding: 0.4rem 0.6rem;
  border-radius: 0.35rem;
  font-size: 0.8rem;
}

.chat-message.system {
  background: rgba(243, 156, 18, 0.1);
  color: var(--orange-light);
  text-align: center;
  font-style: italic;
}

.chat-message.question {
  background: rgba(26, 188, 156, 0.1);
  border-left: 3px solid var(--teal-primary);
}

.chat-message.answer {
  background: rgba(155, 89, 182, 0.1);
  border-left: 3px solid var(--purple-primary);
}

.chat-message.guess {
  background: rgba(241, 196, 15, 0.2);
  border-left: 3px solid var(--orange-light);
}

.chat-message.orpar {
  background: rgba(52, 152, 219, 0.1);
  border-left: 3px solid var(--blue-primary);
  font-size: 0.7rem;
}

.msg-author {
  font-weight: 600;
  margin-right: 0.5rem;
}

.chat-empty {
  color: var(--text-secondary);
  font-style: italic;
  text-align: center;
  padding: 1rem;
}

/* Footer */
.footer {
  text-align: center;
  padding: 1rem;
  color: var(--text-secondary);
  font-size: 0.8rem;
}

.footer strong {
  color: var(--purple-primary);
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
  background: var(--purple-dark);
  border-radius: 3px;
}

::-webkit-scrollbar-thumb:hover {
  background: var(--purple-primary);
}

/* Risk Gauge (in Guesser card) */
.risk-gauge {
  margin-top: 0.75rem;
  padding: 0.5rem;
  border-radius: 0.5rem;
  font-size: 0.75rem;
  border: 1px solid var(--border-color);
}

.risk-gauge.low {
  background: rgba(46, 204, 113, 0.15);
  border-color: var(--green-primary);
}

.risk-gauge.medium {
  background: rgba(243, 156, 18, 0.15);
  border-color: var(--orange-primary);
}

.risk-gauge.high {
  background: rgba(231, 76, 60, 0.15);
  border-color: var(--red-primary);
}

.risk-label {
  font-size: 0.6rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--text-secondary);
  margin-bottom: 0.25rem;
}

.risk-bar-track {
  height: 6px;
  background: var(--bg-dark);
  border-radius: 3px;
  overflow: hidden;
  margin-bottom: 0.25rem;
}

.risk-bar-fill {
  height: 100%;
  border-radius: 3px;
  transition: width 0.5s ease;
}

.risk-gauge.low .risk-bar-fill {
  background: var(--green-primary);
}

.risk-gauge.medium .risk-bar-fill {
  background: var(--orange-primary);
}

.risk-gauge.high .risk-bar-fill {
  background: var(--red-primary);
}

.risk-text {
  text-align: center;
  font-weight: 600;
  font-size: 0.7rem;
}

.risk-gauge.low .risk-text { color: var(--green-primary); }
.risk-gauge.medium .risk-text { color: var(--orange-primary); }
.risk-gauge.high .risk-text { color: var(--red-primary); }

/* Knowledge Model Panel */
.knowledge-panel {
  background: var(--bg-dark);
  border-radius: 0.75rem;
  padding: 0.75rem;
  border: 2px solid var(--border-color);
  border-left: 4px solid var(--teal-primary);
}

.knowledge-title {
  font-size: 0.85rem;
  color: var(--teal-primary);
  margin-bottom: 0.5rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
}

.knowledge-empty {
  color: var(--text-secondary);
  font-style: italic;
  font-size: 0.75rem;
  text-align: center;
  padding: 0.5rem;
}

.knowledge-content {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.knowledge-stats {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.7rem;
  color: var(--text-secondary);
}

.kg-stat {
  font-weight: 600;
  color: var(--teal-primary);
}

.kg-stat-sep {
  color: var(--border-color);
}

.kg-section {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.kg-section-label {
  font-size: 0.6rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--text-secondary);
}

.kg-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
}

.kg-tag {
  padding: 0.15rem 0.5rem;
  border-radius: 1rem;
  font-size: 0.65rem;
  font-weight: 600;
}

.kg-tag.property {
  background: rgba(46, 204, 113, 0.2);
  color: var(--green-primary);
  border: 1px solid rgba(46, 204, 113, 0.3);
}

.kg-tag.candidate {
  background: rgba(52, 152, 219, 0.2);
  color: var(--blue-primary);
  border: 1px solid rgba(52, 152, 219, 0.3);
}

.kg-tag.eliminated {
  background: rgba(231, 76, 60, 0.2);
  color: var(--red-primary);
  border: 1px solid rgba(231, 76, 60, 0.3);
  text-decoration: line-through;
}

/* MULS Reward Indicator on Timeline Events */
.muls-indicator {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: rgba(155, 89, 182, 0.3);
  color: var(--purple-light);
  font-size: 0.6rem;
  font-weight: 700;
  margin-left: auto;
  border: 1px solid var(--purple-primary);
}

.timeline-event.has-reward {
  background: rgba(155, 89, 182, 0.08);
}
</style>
