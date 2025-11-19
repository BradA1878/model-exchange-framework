import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export interface CoordinationRequest {
  coordinationId: string
  type: 'collaborate' | 'delegate' | 'review' | 'assist' | 'parallel' | 'sequential'
  state: 'requested' | 'accepted' | 'rejected' | 'in_progress' | 'completed' | 'cancelled'
  requestingAgent: string
  targetAgents: string[]
  acceptedAgents: string[]
  rejectedAgents: Array<{ agentId: string; reason: string }>
  taskDescription: string
  requirements?: Record<string, any>
  deadline?: number
  createdAt: number
  updatedAt: number
  completedAt?: number
  results?: Record<string, any>
  progress?: {
    percentage?: number
    milestone?: string
    blockers?: string[]
  }
}

export interface CoordinationMessage {
  type: 'coordination_request' | 'coordination_acceptance' | 'coordination_rejection' | 'coordination_update' | 'coordination_complete'
  coordinationId: string
  agentId: string
  timestamp: number
  data: any
}

export const useCoordinationStore = defineStore('coordination', () => {
  // State
  const coordinations = ref<Map<string, CoordinationRequest>>(new Map())
  const coordinationMessages = ref<CoordinationMessage[]>([])
  const activeCoordinations = ref<Set<string>>(new Set())

  // Computed
  const allCoordinations = computed(() => Array.from(coordinations.value.values()))
  
  const requestedCoordinations = computed(() => 
    allCoordinations.value.filter(c => c.state === 'requested')
  )
  
  const activeCoordinationsList = computed(() => 
    allCoordinations.value.filter(c => 
      c.state === 'accepted' || c.state === 'in_progress'
    )
  )
  
  const completedCoordinations = computed(() => 
    allCoordinations.value.filter(c => c.state === 'completed')
  )

  const getCoordinationById = computed(() => (id: string) => 
    coordinations.value.get(id)
  )

  const getCoordinationsByAgent = computed(() => (agentId: string) => 
    allCoordinations.value.filter(c => 
      c.requestingAgent === agentId || 
      c.targetAgents.includes(agentId) ||
      c.acceptedAgents.includes(agentId)
    )
  )

  // Actions
  function addCoordination(coordination: CoordinationRequest) {
    coordinations.value.set(coordination.coordinationId, coordination)
    if (coordination.state === 'accepted' || coordination.state === 'in_progress') {
      activeCoordinations.value.add(coordination.coordinationId)
    }
  }

  function updateCoordination(coordinationId: string, updates: Partial<CoordinationRequest>) {
    const existing = coordinations.value.get(coordinationId)
    if (existing) {
      const updated = { ...existing, ...updates, updatedAt: Date.now() }
      coordinations.value.set(coordinationId, updated)
      
      // Update active set based on state
      if (updated.state === 'accepted' || updated.state === 'in_progress') {
        activeCoordinations.value.add(coordinationId)
      } else {
        activeCoordinations.value.delete(coordinationId)
      }
    }
  }

  function addCoordinationMessage(message: CoordinationMessage) {
    coordinationMessages.value.push(message)
    
    // Process message based on type
    switch (message.type) {
      case 'coordination_request':
        addCoordination({
          coordinationId: message.data.coordinationId,
          type: message.data.coordinationType,
          state: 'requested',
          requestingAgent: message.data.requestingAgent,
          targetAgents: message.data.targetAgents || [],
          acceptedAgents: [],
          rejectedAgents: [],
          taskDescription: message.data.taskDescription,
          requirements: message.data.requirements,
          deadline: message.data.deadline,
          createdAt: message.timestamp,
          updatedAt: message.timestamp
        })
        break
        
      case 'coordination_acceptance':
        updateCoordination(message.coordinationId, {
          acceptedAgents: [...(getCoordinationById.value(message.coordinationId)?.acceptedAgents || []), message.agentId],
          state: 'accepted'
        })
        break
        
      case 'coordination_rejection':
        const coord = getCoordinationById.value(message.coordinationId)
        if (coord) {
          updateCoordination(message.coordinationId, {
            rejectedAgents: [...coord.rejectedAgents, { agentId: message.agentId, reason: message.data.reason }]
          })
        }
        break
        
      case 'coordination_update':
        updateCoordination(message.coordinationId, {
          state: message.data.state || undefined,
          progress: message.data.progress || undefined,
          results: message.data.results || undefined
        })
        break
        
      case 'coordination_complete':
        updateCoordination(message.coordinationId, {
          state: 'completed',
          completedAt: message.timestamp,
          results: message.data.results
        })
        break
    }
  }

  function clearCoordinations() {
    coordinations.value.clear()
    coordinationMessages.value = []
    activeCoordinations.value.clear()
  }

  return {
    // State
    coordinations: computed(() => coordinations.value),
    coordinationMessages: computed(() => coordinationMessages.value),
    activeCoordinations: computed(() => activeCoordinations.value),
    
    // Computed
    allCoordinations,
    requestedCoordinations,
    activeCoordinationsList,
    completedCoordinations,
    getCoordinationById,
    getCoordinationsByAgent,
    
    // Actions
    addCoordination,
    updateCoordination,
    addCoordinationMessage,
    clearCoordinations
  }
})