<template>
  <div
    class="commander-card"
    :class="[
      commander.team, 
      { 
        selected, 
        defeated: commander.status === 'defeated', 
        active: isActive,
        thinking: activity.status === 'thinking',
        calling: activity.status === 'calling'
      }
    ]"
    @click="$emit('select')"
  >
    <!-- Activity Bar -->
    <div class="activity-bar" :class="activity.status"></div>
    
    <!-- Main Content -->
    <div class="card-content">
      <!-- Header Row -->
      <div class="commander-header">
        <div class="name-row">
          <span class="activity-dot" :class="activity.status"></span>
          <span class="commander-name">{{ commander.name }}</span>
        </div>
        <div class="model-badge" v-if="commander.model">
          {{ formatModelName(commander.model) }}
        </div>
      </div>

      <!-- Stats Row - Compact -->
      <div class="stats-row">
        <div class="stat">
          <span class="stat-icon">◆</span>
          <span class="stat-val">{{ commander.resources }}</span>
        </div>
        <div class="stat">
          <span class="stat-icon">◈</span>
          <span class="stat-val">{{ commander.controlledTerritories.length }}</span>
        </div>
        <div class="units-mini">
          <span 
            v-for="unit in commander.units" 
            :key="unit.id"
            class="unit-badge"
            :title="`${unit.type}: ${unit.count} (${unit.health}% HP)`"
          >
            {{ getUnitIcon(unit.type) }}{{ unit.count }}
          </span>
        </div>
      </div>

      <!-- Activity Display - Shows current action -->
      <div class="activity-display" v-if="activity.status !== 'idle'">
        <div class="activity-content">
          <div v-if="activity.lastTool" class="current-action">
            <span class="action-icon">{{ getToolIcon(activity.lastTool) }}</span>
            <span class="action-name">{{ formatToolName(activity.lastTool) }}</span>
          </div>
          <div v-else-if="activity.status === 'thinking'" class="thinking-indicator">
            <span class="thinking-dot"></span>
            <span class="thinking-dot"></span>
            <span class="thinking-dot"></span>
          </div>
        </div>
      </div>
      
      <!-- Last Response Preview -->
      <div v-if="activity.lastResponse && activity.status === 'idle'" class="response-preview">
        <span class="response-icon">◈</span>
        {{ truncateResponse(activity.lastResponse) }}
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

// Is the agent currently active (not idle)?
const isActive = computed(() => activity.value.status !== 'idle')

function getUnitIcon(type: string): string {
  const icons: Record<string, string> = {
    infantry: '⚔',
    cavalry: '♘',
    archers: '➶'
  }
  return icons[type] || '●'
}

function getToolIcon(tool: string): string {
  const icons: Record<string, string> = {
    game_scanPerimeter: '◎',
    game_viewTerritory: '◉',
    game_moveUnits: '→',
    game_fortifyPosition: '⬡',
    game_collectResources: '◆',
    game_getTeamStatus: '◈',
    game_calculateOptimalPath: '⟁',
    game_commitTurn: '✓',
    messaging_send: '◈'
  }
  return icons[tool] || '●'
}

function formatToolName(tool: string): string {
  return tool.replace('game_', '').replace('messaging_', '').replace(/([A-Z])/g, ' $1').trim()
}

function formatModelName(model: string): string {
  const name = model.split('/')[1] || model
  // Shorten common model names
  if (name.includes('claude')) return 'Claude'
  if (name.includes('gpt-4')) return 'GPT-4'
  if (name.includes('gpt-3')) return 'GPT-3.5'
  if (name.includes('gemini')) return 'Gemini'
  return name.substring(0, 8)
}

function truncateResponse(response: string): string {
  if (response.length <= 35) return response
  return response.substring(0, 32) + '...'
}
</script>

<style scoped>
.commander-card {
  position: relative;
  background: rgba(15, 25, 45, 0.6);
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.3s ease;
  overflow: hidden;
  animation: fade-in-up 0.3s ease forwards;
  opacity: 0;
}

.commander-card::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 6px;
  padding: 1px;
  background: linear-gradient(135deg, transparent 0%, rgba(100, 150, 255, 0.1) 100%);
  -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
  mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
  pointer-events: none;
}

.commander-card.red::before {
  background: linear-gradient(135deg, var(--color-red-subtle) 0%, transparent 50%);
}

.commander-card.blue::before {
  background: linear-gradient(135deg, var(--color-blue-subtle) 0%, transparent 50%);
}

.commander-card:hover {
  transform: translateX(4px);
  background: rgba(25, 40, 70, 0.8);
}

.commander-card.selected {
  background: rgba(35, 55, 90, 0.9);
}

.commander-card.red.selected {
  box-shadow: 0 0 15px var(--color-red-subtle), inset 0 0 20px var(--color-red-subtle);
}

.commander-card.blue.selected {
  box-shadow: 0 0 15px var(--color-blue-subtle), inset 0 0 20px var(--color-blue-subtle);
}

.commander-card.defeated {
  opacity: 0.4;
  filter: grayscale(0.5);
}

.commander-card.active {
  animation: none;
  opacity: 1;
}

.commander-card.thinking {
  box-shadow: 0 0 20px var(--color-warning-glow);
}

.commander-card.calling {
  box-shadow: 0 0 20px var(--color-cyan-glow);
}

/* Activity Bar */
.activity-bar {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 3px;
  background: var(--color-text-dim);
  transition: all 0.3s ease;
}

.commander-card.red .activity-bar {
  background: var(--color-red);
}

.commander-card.blue .activity-bar {
  background: var(--color-blue);
}

.activity-bar.thinking {
  background: var(--color-warning) !important;
  box-shadow: 0 0 10px var(--color-warning-glow);
  animation: pulse-glow 1s ease-in-out infinite;
}

.activity-bar.calling {
  background: var(--color-cyan) !important;
  box-shadow: 0 0 10px var(--color-cyan-glow);
  animation: pulse-glow 0.5s ease-in-out infinite;
}

.activity-bar.responding {
  background: var(--color-success) !important;
  box-shadow: 0 0 10px var(--color-success-glow);
}

/* Card Content */
.card-content {
  padding: 8px 8px 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

/* Header */
.commander-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.name-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  flex: 1;
}

.activity-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--color-text-dim);
  flex-shrink: 0;
}

.activity-dot.thinking {
  background: var(--color-warning);
  animation: activity-pulse 1s ease-in-out infinite;
}

.activity-dot.calling {
  background: var(--color-cyan);
  animation: activity-pulse 0.5s ease-in-out infinite;
}

.activity-dot.responding {
  background: var(--color-success);
  animation: activity-pulse 0.8s ease-in-out infinite;
}

.commander-name {
  font-family: var(--font-display);
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.5px;
  color: var(--color-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
}

.model-badge {
  padding: 2px 6px;
  font-family: var(--font-mono);
  font-size: 0.55rem;
  background: rgba(0, 212, 255, 0.15);
  border: 1px solid rgba(0, 212, 255, 0.3);
  border-radius: 3px;
  color: var(--color-cyan);
  flex-shrink: 0;
}

/* Stats Row */
.stats-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.stat {
  display: flex;
  align-items: center;
  gap: 3px;
}

.stat-icon {
  font-size: 0.65rem;
  color: var(--color-text-dim);
}

.stat-val {
  font-family: var(--font-mono);
  font-size: 0.7rem;
  font-weight: 600;
  color: var(--color-text-primary);
}

.units-mini {
  display: flex;
  gap: 4px;
  margin-left: auto;
}

.unit-badge {
  padding: 1px 4px;
  font-size: 0.6rem;
  background: rgba(0, 0, 0, 0.3);
  border-radius: 3px;
  color: var(--color-text-secondary);
}

/* Activity Display */
.activity-display {
  padding: 4px 6px;
  background: rgba(0, 0, 0, 0.3);
  border-radius: 4px;
  border-left: 2px solid var(--color-cyan);
}

.activity-content {
  display: flex;
  align-items: center;
  gap: 6px;
}

.current-action {
  display: flex;
  align-items: center;
  gap: 4px;
}

.action-icon {
  font-size: 0.8rem;
  color: var(--color-cyan);
}

.action-name {
  font-family: var(--font-mono);
  font-size: 0.6rem;
  color: var(--color-cyan);
  text-transform: capitalize;
}

.thinking-indicator {
  display: flex;
  gap: 3px;
}

.thinking-dot {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--color-warning);
}

.thinking-dot:nth-child(1) { animation: thinking-dots 1.4s infinite 0s; }
.thinking-dot:nth-child(2) { animation: thinking-dots 1.4s infinite 0.2s; }
.thinking-dot:nth-child(3) { animation: thinking-dots 1.4s infinite 0.4s; }

/* Response Preview */
.response-preview {
  display: flex;
  align-items: flex-start;
  gap: 4px;
  font-size: 0.6rem;
  color: var(--color-text-secondary);
  line-height: 1.3;
}

.response-icon {
  color: var(--color-text-dim);
  flex-shrink: 0;
}
</style>
