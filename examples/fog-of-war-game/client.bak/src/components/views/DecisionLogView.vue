<template>
  <div class="decision-log-view">
    <div class="view-header">
      <h2>⚡ Decision Log</h2>
      <div class="filters">
        <select v-model="filterCommander" class="filter-select">
          <option value="">All Commanders</option>
          <option v-for="cmd in allCommanders" :key="cmd.id" :value="cmd.id">
            {{ cmd.name }}
          </option>
        </select>
        <select v-model="filterAction" class="filter-select">
          <option value="">All Actions</option>
          <option value="move">Move</option>
          <option value="fortify">Fortify</option>
          <option value="collect">Collect</option>
          <option value="scout">Scout</option>
        </select>
      </div>
    </div>

    <div class="stats-bar">
      <div class="stat-box">
        <div class="stat-label">Total Actions</div>
        <div class="stat-value">{{ gameStore.actions.length }}</div>
      </div>
      <div class="stat-box">
        <div class="stat-label">This Turn</div>
        <div class="stat-value">{{ actionsThisTurn }}</div>
      </div>
      <div class="stat-box">
        <div class="stat-label">Success Rate</div>
        <div class="stat-value text-success">{{ successRate }}%</div>
      </div>
    </div>

    <div class="actions-container">
      <div
        v-for="action in filteredActions"
        :key="action.id"
        class="action-card"
        :class="`action-${action.status}`"
      >
        <div class="action-header">
          <span class="action-commander">
            {{ getCommanderName(action.commanderId) }}
          </span>
          <span class="action-type">{{ action.actionType }}</span>
          <span class="action-status">{{ action.status }}</span>
          <span class="action-time">{{ formatTime(action.timestamp) }}</span>
        </div>
        <div class="action-details">
          <div v-for="(value, key) in action.parameters" :key="key" class="param">
            <span class="param-key">{{ key }}:</span>
            <span class="param-value">{{ formatValue(value) }}</span>
          </div>
        </div>
        <div v-if="action.result" class="action-result">
          <strong>Result:</strong> {{ action.result.message || 'Completed' }}
        </div>
      </div>

      <div v-if="filteredActions.length === 0" class="empty-state">
        <div class="empty-icon">⚡</div>
        <div>No actions recorded yet</div>
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
    actions = actions.filter((a: Action) => a.actionType === filterAction.value)
  }

  return actions
})

const actionsThisTurn = computed(() => {
  // TODO: Filter by current turn when actions have turn tracking
  return gameStore.actions.length
})

const successRate = computed(() => {
  const total = gameStore.actions.length
  if (total === 0) return 0

  const successful = gameStore.actions.filter((a: Action) => a.status === 'executed').length
  return Math.round((successful / total) * 100)
})

function getCommanderName(commanderId: string): string {
  const commander = gameStore.gameState?.commanders.find((c: Commander) => c.id === commanderId)
  return commander?.name || commanderId
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp)
  return date.toLocaleTimeString()
}

function formatValue(value: any): string {
  if (typeof value === 'object') {
    // Format arrays as comma-separated lists
    if (Array.isArray(value)) {
      if (value.length === 0) return 'none'
      if (value.length <= 5) return value.join(', ')
      return `${value.slice(0, 5).join(', ')} (+${value.length - 5} more)`
    }
    // Format scan results more readably
    if (value.friendlyTiles || value.enemyTiles || value.visibleTileIds) {
      const parts: string[] = []
      if (value.friendlyTiles?.length) parts.push(`Friendly: ${value.friendlyTiles.length}`)
      if (value.enemyTiles?.length) parts.push(`Enemy: ${value.enemyTiles.length}`)
      if (value.neutralTiles?.length) parts.push(`Neutral: ${value.neutralTiles.length}`)
      if (value.tilesWithResources?.length) parts.push(`Resources: ${value.tilesWithResources.length}`)
      return parts.join(' | ') || 'No data'
    }
    // Fallback for other objects - show key count
    const keys = Object.keys(value)
    if (keys.length === 0) return 'empty'
    if (keys.length <= 3) return keys.map(k => `${k}: ${value[k]}`).join(', ')
    return `{${keys.length} fields}`
  }
  return String(value)
}
</script>

<style scoped>
.decision-log-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  gap: 16px;
}

.view-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 16px;
}

.filters {
  display: flex;
  gap: 8px;
}

.filter-select {
  padding: 8px 12px;
  background: var(--color-bg-tertiary);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  color: var(--color-text-primary);
  cursor: pointer;
}

.stats-bar {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}

.stat-box {
  padding: 16px;
  background: var(--color-bg-tertiary);
  border-radius: 8px;
  text-align: center;
}

.stat-label {
  font-size: 0.85em;
  color: var(--color-text-secondary);
  margin-bottom: 8px;
}

.stat-value {
  font-size: 1.8em;
  font-weight: bold;
}

.actions-container {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  background: var(--color-bg-tertiary);
  border-radius: 8px;
}

.action-card {
  background: var(--color-bg-secondary);
  padding: 12px;
  margin-bottom: 12px;
  border-radius: 8px;
  border-left: 4px solid;
}

.action-executed {
  border-left-color: var(--color-success);
}

.action-pending {
  border-left-color: var(--color-warning);
}

.action-failed {
  border-left-color: var(--color-red);
}

.action-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
  flex-wrap: wrap;
}

.action-commander {
  font-weight: bold;
  color: var(--color-blue);
}

.action-type {
  padding: 4px 8px;
  background: var(--color-bg-tertiary);
  border-radius: 4px;
  font-size: 0.85em;
  text-transform: uppercase;
}

.action-status {
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 0.85em;
  text-transform: uppercase;
}

.action-executed .action-status {
  background: var(--color-success);
  color: white;
}

.action-pending .action-status {
  background: var(--color-warning);
  color: white;
}

.action-failed .action-status {
  background: var(--color-red);
  color: white;
}

.action-time {
  margin-left: auto;
  font-size: 0.85em;
  color: var(--color-text-secondary);
}

.action-details {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  padding: 8px 0;
  font-size: 0.9em;
}

.param {
  display: flex;
  gap: 4px;
}

.param-key {
  color: var(--color-text-secondary);
}

.param-value {
  font-weight: bold;
}

.action-result {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--color-border);
  font-size: 0.9em;
  color: var(--color-text-secondary);
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--color-text-secondary);
  gap: 16px;
}

.empty-icon {
  font-size: 4em;
  opacity: 0.3;
}
</style>
