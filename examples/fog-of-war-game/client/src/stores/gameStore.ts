import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import io from 'socket.io-client'
import type { GameState, Message, Action } from '@/types/game'

// Socket type from socket.io-client
type SocketClient = ReturnType<typeof io>

// Agent activity tracking
interface AgentActivity {
  lastResponse: string
  lastTool: string
  status: 'idle' | 'thinking' | 'calling' | 'responding'
  timestamp: number
}

export const useGameStore = defineStore('game', () => {
  // State
  const socket = ref<SocketClient | null>(null)
  const connected = ref(false)
  const gameState = ref<GameState | null>(null)
  const messages = ref<Message[]>([])
  const actions = ref<Action[]>([])
  const selectedCommander = ref<string | null>(null)
  const viewMode = ref<'map' | 'communication' | 'decisions' | 'analytics'>('map')
  const spectatorMode = ref(true)
  
  // Agent activity state - tracks what each agent is currently doing
  const agentActivity = ref<Record<string, AgentActivity>>({})
  
  // Total action counter - increments with each tool call/action
  const totalActions = ref(0)

  // Computed
  const redCommanders = computed(() =>
    gameState.value?.commanders.filter(c => c.team === 'red') || []
  )

  const blueCommanders = computed(() =>
    gameState.value?.commanders.filter(c => c.team === 'blue') || []
  )

  const activeCommander = computed(() =>
    gameState.value?.commanders.find(c => c.id === selectedCommander.value)
  )

  const recentActions = computed(() =>
    actions.value.slice(0, 50).reverse()
  )

  const recentMessages = computed(() =>
    messages.value.slice(0, 100).reverse()
  )

  // Actions
  function connect(serverUrl: string = 'http://localhost:3002') {
    socket.value = io(serverUrl)

    socket.value.on('connect', () => {
      connected.value = true
      // Reset state on fresh connection to prevent stale data accumulation
      resetState()
      console.log('Connected to game server')
    })

    socket.value.on('disconnect', () => {
      connected.value = false
      // Reset state when disconnected to prevent showing stale data
      resetState()
      console.log('Disconnected from game server')
    })

    socket.value.on('gameState', (state: GameState) => {
      gameState.value = state
    })

    socket.value.on('action', (data: any) => {
      actions.value.unshift({
        id: `${Date.now()}-${Math.random()}`,
        commanderId: data.commanderId,
        actionType: data.action,
        timestamp: Date.now(),
        parameters: data.details || {},
        status: 'executed'
      })
      totalActions.value++
    })

    socket.value.on('turnProgress', (progress: any) => {
      addSystemMessage(`Turn progress: ${progress.ready}/${progress.total} ready`)
    })

    socket.value.on('turnComplete', (data: any) => {
      gameState.value = data.newState
      addSystemMessage(`Turn ${data.turn} completed`)
    })

    socket.value.on('gameOver', (data: any) => {
      addSystemMessage(`🏆 Game Over! Winner: ${data.winner}`)
    })

    socket.value.on('commanderJoined', (data: any) => {
      addSystemMessage(`${data.name} joined (${data.team} ${data.role})`)
    })

    // Agent activity events - for showing live feedback in commander cards
    socket.value.on('agentThinking', (data: any) => {
      updateAgentActivity(data.agentId, {
        status: 'thinking',
        timestamp: data.timestamp
      })
    })

    socket.value.on('agentResponse', (data: any) => {
      updateAgentActivity(data.agentId, {
        lastResponse: data.response,
        status: 'responding',
        timestamp: data.timestamp
      })
      // Add to messages for Comms tab
      addMessage({
        id: `${Date.now()}-${Math.random()}`,
        senderId: data.agentId,
        content: data.response,
        timestamp: data.timestamp,
        type: 'team'  // Use 'team' type for agent messages
      })
    })

    socket.value.on('agentActivity', (data: any) => {
      updateAgentActivity(data.agentId, {
        lastTool: data.tool,
        status: data.status === 'complete' ? 'idle' : 'calling',
        timestamp: data.timestamp
      })
      // Increment total actions on each tool call
      if (data.status === 'calling') {
        totalActions.value++
      }
    })

    // Fetch initial state
    fetchGameState(serverUrl)
  }

  async function fetchGameState(serverUrl: string) {
    try {
      const response = await fetch(`${serverUrl}/api/game/state`)
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }
      const state = await response.json()
      gameState.value = state
    } catch (error) {
      console.error('Failed to fetch game state:', error)
      // Reset state when server not available
      resetState()
    }
  }

  function disconnect() {
    socket.value?.disconnect()
    socket.value = null
    connected.value = false
    resetState()
  }

  function resetState() {
    gameState.value = null
    messages.value = []
    actions.value = []
    selectedCommander.value = null
    agentActivity.value = {}
    totalActions.value = 0
  }

  function updateAgentActivity(agentId: string, update: Partial<AgentActivity>) {
    if (!agentActivity.value[agentId]) {
      agentActivity.value[agentId] = {
        lastResponse: '',
        lastTool: '',
        status: 'idle',
        timestamp: Date.now()
      }
    }
    agentActivity.value[agentId] = {
      ...agentActivity.value[agentId],
      ...update
    }
  }

  function getAgentActivity(agentId: string): AgentActivity {
    return agentActivity.value[agentId] || {
      lastResponse: '',
      lastTool: '',
      status: 'idle',
      timestamp: 0
    }
  }

  function selectCommander(commanderId: string | null) {
    // Toggle off if clicking the same commander
    if (selectedCommander.value === commanderId) {
      selectedCommander.value = null
    } else {
      selectedCommander.value = commanderId
    }
  }

  function setViewMode(mode: typeof viewMode.value) {
    viewMode.value = mode
  }

  function toggleSpectatorMode() {
    spectatorMode.value = !spectatorMode.value
  }

  function addSystemMessage(content: string) {
    messages.value.unshift({
      id: `${Date.now()}-${Math.random()}`,
      senderId: 'system',
      content,
      timestamp: Date.now(),
      type: 'system'
    })
  }

  function addMessage(message: Message) {
    messages.value.unshift(message)
  }

  return {
    // State
    socket,
    connected,
    gameState,
    messages,
    actions,
    selectedCommander,
    viewMode,
    spectatorMode,
    agentActivity,
    totalActions,

    // Computed
    redCommanders,
    blueCommanders,
    activeCommander,
    recentActions,
    recentMessages,

    // Actions
    connect,
    disconnect,
    selectCommander,
    setViewMode,
    toggleSpectatorMode,
    addSystemMessage,
    addMessage,
    getAgentActivity
  }
})
