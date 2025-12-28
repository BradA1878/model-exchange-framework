<template>
  <div class="decision-view">
    <!-- Header -->
    <div class="decision-header">
      <span class="decision-title">DECISION LOG</span>
      <div class="filters">
        <select v-model="filterCommander" class="filter-select">
          <option value="">ALL COMMANDERS</option>
          <option v-for="cmd in allCommanders" :key="cmd.id" :value="cmd.id">
            {{ cmd.name.toUpperCase() }}
          </option>
        </select>
        <select v-model="filterAction" class="filter-select">
          <option value="">ALL ACTIONS</option>
          <option value="move">MOVE</option>
          <option value="fortify">FORTIFY</option>
          <option value="collect">COLLECT</option>
          <option value="scan">SCAN</option>
        </select>
      </div>
    </div>

    <!-- Stats Row -->
    <div class="stats-row">
      <div class="stat-card">
        <span class="stat-icon">⚡</span>
        <div class="stat-info">
          <span class="stat-val">{{ gameStore.totalActions }}</span>
          <span class="stat-label">TOTAL</span>
        </div>
      </div>
      <div class="stat-card">
        <span class="stat-icon">◎</span>
        <div class="stat-info">
          <span class="stat-val">{{ actionsThisTurn }}</span>
          <span class="stat-label">THIS TURN</span>
        </div>
      </div>
      <div class="stat-card success">
        <span class="stat-icon">✓</span>
        <div class="stat-info">
          <span class="stat-val">{{ successRate }}%</span>
          <span class="stat-label">SUCCESS</span>
        </div>
      </div>
    </div>

    <!-- Actions Stream -->
    <div class="actions-stream">
      <TransitionGroup name="action">
        <div
          v-for="action in filteredActions"
          :key="action.id"
          class="action-item"
          :class="action.status"
        >
          <div class="action-indicator" :class="action.status"></div>
          <div class="action-content">
            <div class="action-header">
              <span class="action-commander" :class="getCommanderTeam(action.commanderId)">
                {{ getCommanderName(action.commanderId) }}
              </span>
              <span class="action-type">{{ formatActionType(action.actionType) }}</span>
              <span class="action-status-badge" :class="action.status">{{ action.status }}</span>
              <span class="action-time">{{ formatTime(action.timestamp) }}</span>
            </div>
            <div class="action-params" v-if="Object.keys(action.parameters).length > 0">
              <span v-for="(value, key) in action.parameters" :key="key" class="param-item">
                <span class="param-key">{{ key }}:</span>
                <span class="param-val">{{ formatValue(value) }}</span>
              </span>
            </div>
            <div v-if="action.result" class="action-result">
              → {{ action.result.message || 'Completed' }}
            </div>
          </div>
        </div>
      </TransitionGroup>

      <div v-if="filteredActions.length === 0" class="empty-state">
        <span class="empty-icon">⚡</span>
        <span class="empty-text">No actions recorded...</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useGameStore } from '@/stores/gameStore'
import type { Action, Commander } from '@/types/game'

const gameStore = useGameStore()
const filterCommander = ref('')
const filterAction = ref('')

const allCommanders = computed(() => gameStore.gameState?.commanders || [])

const filteredActions = computed(() => {
  let actions = gameStore.recentActions

  if (filterCommander.value) {
    actions = actions.filter((a: Action) => a.commanderId === filterCommander.value)
  }

  if (filterAction.value) {
    actions = actions.filter((a: Action) => 
      a.actionType.toLowerCase().includes(filterAction.value.toLowerCase())
    )
  }

  return actions
})

const actionsThisTurn = computed(() => gameStore.actions.length)

const successRate = computed(() => {
  const total = gameStore.actions.length
  if (total === 0) return 0
  const successful = gameStore.actions.filter((a: Action) => a.status === 'executed').length
  return Math.round((successful / total) * 100)
})

function getCommanderName(commanderId: string): string {
  const commander = gameStore.gameState?.commanders.find((c: Commander) => c.id === commanderId)
  return commander?.name?.toUpperCase() || commanderId
}

function getCommanderTeam(commanderId: string): string {
  const commander = gameStore.gameState?.commanders.find((c: Commander) => c.id === commanderId)
  return commander?.team || 'neutral'
}

function formatActionType(actionType: string): string {
  return actionType.replace('game_', '').replace(/([A-Z])/g, ' $1').trim().toUpperCase()
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp)
  return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function formatValue(value: any): string {
  if (typeof value === 'object') {
    if (Array.isArray(value)) {
      if (value.length === 0) return '[]'
      if (value.length <= 3) return value.join(', ')
      return `[${value.length} items]`
    }
    if (value.friendlyTiles || value.enemyTiles || value.visibleTileIds) {
      const parts: string[] = []
      if (value.friendlyTiles?.length) parts.push(`F:${value.friendlyTiles.length}`)
      if (value.enemyTiles?.length) parts.push(`E:${value.enemyTiles.length}`)
      if (value.neutralTiles?.length) parts.push(`N:${value.neutralTiles.length}`)
      return parts.join(' ') || 'scan data'
    }
    const keys = Object.keys(value)
    if (keys.length === 0) return '{}'
    return `{${keys.length}}`
  }
  return String(value)
}
</script>

<style scoped>
.decision-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 8px;
  gap: 8px;
}

/* Header */
.decision-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 12px;
  background: rgba(0, 0, 0, 0.3);
  border-radius: 6px;
  flex-shrink: 0;
}

.decision-title {
  font-family: var(--font-display);
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 2px;
  color: var(--color-cyan);
}

.filters {
  display: flex;
  gap: 8px;
}

.filter-select {
  padding: 4px 8px;
  font-family: var(--font-mono);
  font-size: 0.6rem;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid var(--glass-border);
  border-radius: 4px;
  color: var(--color-text-primary);
  cursor: pointer;
}

.filter-select:focus {
  outline: none;
  border-color: var(--color-cyan);
}

/* Stats Row */
.stats-row {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  flex-shrink: 0;
}

.stat-card {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: rgba(0, 0, 0, 0.3);
  border-radius: 6px;
  border-left: 3px solid var(--color-cyan);
}

.stat-card.success {
  border-left-color: var(--color-success);
}

.stat-icon {
  font-size: 1rem;
  color: var(--color-cyan);
}

.stat-card.success .stat-icon {
  color: var(--color-success);
}

.stat-info {
  display: flex;
  flex-direction: column;
}

.stat-val {
  font-family: var(--font-display);
  font-size: 1rem;
  font-weight: 700;
  color: var(--color-text-primary);
}

.stat-label {
  font-family: var(--font-mono);
  font-size: 0.55rem;
  color: var(--color-text-dim);
}

/* Actions Stream */
.actions-stream {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  background: rgba(0, 0, 0, 0.2);
  border-radius: 6px;
}

.action-item {
  display: flex;
  gap: 8px;
  padding: 8px;
  background: rgba(15, 25, 45, 0.6);
  border-radius: 6px;
  animation: fade-in-up 0.2s ease;
}

.action-indicator {
  width: 3px;
  border-radius: 2px;
  flex-shrink: 0;
}

.action-indicator.executed { background: var(--color-success); box-shadow: 0 0 8px var(--color-success-glow); }
.action-indicator.pending { background: var(--color-warning); box-shadow: 0 0 8px var(--color-warning-glow); }
.action-indicator.failed { background: var(--color-red); box-shadow: 0 0 8px var(--color-red-glow); }

.action-content {
  flex: 1;
  min-width: 0;
}

.action-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
  flex-wrap: wrap;
}

.action-commander {
  font-family: var(--font-display);
  font-size: 0.7rem;
  font-weight: 600;
}

.action-commander.red { color: var(--color-red); }
.action-commander.blue { color: var(--color-blue); }

.action-type {
  padding: 2px 6px;
  font-family: var(--font-mono);
  font-size: 0.55rem;
  background: rgba(0, 212, 255, 0.15);
  border-radius: 3px;
  color: var(--color-cyan);
}

.action-status-badge {
  padding: 2px 6px;
  font-family: var(--font-mono);
  font-size: 0.5rem;
  border-radius: 3px;
  text-transform: uppercase;
}

.action-status-badge.executed { background: var(--color-success); color: white; }
.action-status-badge.pending { background: var(--color-warning); color: white; }
.action-status-badge.failed { background: var(--color-red); color: white; }

.action-time {
  margin-left: auto;
  font-family: var(--font-mono);
  font-size: 0.55rem;
  color: var(--color-text-dim);
}

.action-params {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 4px;
}

.param-item {
  display: flex;
  gap: 4px;
  font-size: 0.65rem;
}

.param-key {
  color: var(--color-text-dim);
}

.param-val {
  color: var(--color-text-primary);
  font-weight: 600;
}

.action-result {
  font-family: var(--font-mono);
  font-size: 0.6rem;
  color: var(--color-text-secondary);
  padding-top: 4px;
  border-top: 1px solid rgba(100, 150, 200, 0.1);
}

/* Empty State */
.empty-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--color-text-dim);
}

.empty-icon {
  font-size: 2rem;
  opacity: 0.3;
}

.empty-text {
  font-family: var(--font-mono);
  font-size: 0.7rem;
  letter-spacing: 1px;
}

/* Transitions */
.action-enter-active {
  transition: all 0.3s ease;
}

.action-leave-active {
  transition: all 0.2s ease;
}

.action-enter-from {
  opacity: 0;
  transform: translateY(-10px);
}

.action-leave-to {
  opacity: 0;
  transform: translateY(10px);
}
</style>
