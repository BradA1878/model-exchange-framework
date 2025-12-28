<template>
  <div
    class="commander-card"
    :class="[commander.team, { selected, defeated: commander.status === 'defeated', active: isActive }]"
    @click="$emit('select')"
  >
    <div class="commander-header">
      <div class="commander-name">
        <span class="activity-indicator" :class="activityStatus"></span>
        {{ commander.name }}
      </div>
      <div class="commander-model" v-if="commander.model">
        🤖 {{ formatModelName(commander.model) }}
      </div>
    </div>

    <div class="commander-stats">
      <div class="stat-row">
        <span class="stat-label">💰 Resources:</span>
        <span class="stat-value">{{ commander.resources }}</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">🗺️ Territories:</span>
        <span class="stat-value">{{ commander.controlledTerritories.length }}</span>
      </div>
    </div>

    <div class="unit-breakdown">
      <div
        v-for="unit in commander.units"
        :key="unit.id"
        class="unit-item"
        :title="`${unit.type}: ${unit.count} units (${unit.health}% health)`"
      >
        <span class="unit-icon">{{ getUnitIcon(unit.type) }}</span>
        <span class="unit-count">{{ unit.count }}</span>
      </div>
    </div>

    <!-- Activity Display -->
    <div v-if="activity.lastResponse || activity.lastTool" class="activity-display">
      <div v-if="activity.lastTool" class="current-tool">
        <span class="tool-icon">{{ getToolIcon(activity.lastTool) }}</span>
        <span class="tool-name">{{ formatToolName(activity.lastTool) }}</span>
      </div>
      <div v-if="activity.lastResponse" class="last-response" :title="activity.lastResponse">
        💬 {{ truncateResponse(activity.lastResponse) }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useGameStore } from '@/stores/gameStore'
import type { Commander } from '@/types/game'

interface Props {
  commander: Commander
  selected?: boolean
}

const props = defineProps<Props>()
defineEmits<{ select: [] }>()

const gameStore = useGameStore()

// Get activity for this commander
const activity = computed(() => gameStore.getAgentActivity(props.commander.id))

// Activity status for indicator dot
const activityStatus = computed(() => activity.value.status)

// Is the agent currently active (not idle)?
const isActive = computed(() => activity.value.status !== 'idle')

function getUnitIcon(type: string): string {
  const icons: Record<string, string> = {
    infantry: '🚶',
    cavalry: '🐎',
    archers: '🏹'
  }
  return icons[type] || '⚔️'
}

function getToolIcon(tool: string): string {
  const icons: Record<string, string> = {
    game_scanPerimeter: '📡',
    game_viewTerritory: '🔍',
    game_moveUnits: '🚶',
    game_fortifyPosition: '🏰',
    game_collectResources: '💰',
    game_getTeamStatus: '📊',
    game_calculateOptimalPath: '🗺️',
    game_commitTurn: '✅',
    messaging_send: '💬'
  }
  return icons[tool] || '🔧'
}

function formatToolName(tool: string): string {
  // Remove game_ prefix and format nicely
  return tool.replace('game_', '').replace('messaging_', '')
}

function formatModelName(model: string): string {
  // Extract just the model name (after the /)
  return model.split('/')[1] || model
}

function truncateResponse(response: string): string {
  // Truncate to ~50 chars for card display
  if (response.length <= 50) return response
  return response.substring(0, 47) + '...'
}
</script>

<style scoped>
.commander-card {
  background: var(--color-bg-tertiary);
  padding: 8px;
  border-radius: 6px;
  border-left: 3px solid;
  cursor: pointer;
  transition: all 0.2s;
}

.commander-card.red {
  border-left-color: var(--color-red);
}

.commander-card.blue {
  border-left-color: var(--color-blue);
}

.commander-card:hover {
  transform: translateX(4px);
  background: var(--color-border);
}

.commander-card.selected {
  background: var(--color-border);
  box-shadow: 0 0 0 2px currentColor;
}

.commander-card.defeated {
  opacity: 0.5;
}

.commander-header {
  margin-bottom: 6px;
}

.commander-name {
  font-weight: bold;
  font-size: 0.9em;
  margin-bottom: 2px;
  display: flex;
  align-items: center;
}

.commander-model {
  font-size: 0.7em;
  color: var(--color-blue);
  opacity: 0.8;
}

.commander-stats {
  margin-bottom: 6px;
}

.stat-row {
  display: flex;
  justify-content: space-between;
  padding: 2px 0;
  font-size: 0.8em;
}

.stat-label {
  color: var(--color-text-secondary);
}

.stat-value {
  font-weight: bold;
}

.unit-breakdown {
  display: flex;
  gap: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--color-border);
}

.unit-item {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  background: var(--color-bg-secondary);
  border-radius: 4px;
  font-size: 0.85em;
}

.unit-icon {
  font-size: 1.2em;
}

.unit-count {
  font-weight: bold;
}

/* Activity indicator dot */
.activity-indicator {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-right: 6px;
  background: var(--color-text-secondary);
}

.activity-indicator.thinking {
  background: var(--color-warning);
  animation: pulse 1s ease-in-out infinite;
}

.activity-indicator.calling {
  background: var(--color-blue);
  animation: pulse 0.5s ease-in-out infinite;
}

.activity-indicator.responding {
  background: var(--color-success);
  animation: pulse 0.8s ease-in-out infinite;
}

.activity-indicator.idle {
  background: var(--color-text-secondary);
  opacity: 0.5;
}

@keyframes pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.6; transform: scale(1.2); }
}

/* Active card highlight */
.commander-card.active {
  box-shadow: 0 0 8px rgba(59, 130, 246, 0.5);
}

/* Activity display section */
.activity-display {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--color-border);
  font-size: 0.75em;
}

.current-tool {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 6px;
  background: var(--color-bg-secondary);
  border-radius: 4px;
  margin-bottom: 4px;
  color: var(--color-blue);
}

.tool-icon {
  font-size: 1em;
}

.tool-name {
  font-weight: 500;
  text-transform: capitalize;
}

.last-response {
  color: var(--color-text-secondary);
  line-height: 1.3;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
