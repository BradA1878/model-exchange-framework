<template>
  <div class="analytics-view">
    <!-- Header -->
    <div class="analytics-header">
      <span class="analytics-title">ANALYTICS</span>
      <span class="game-progress">
        <span class="progress-label">PROGRESS</span>
        <span class="progress-bar">
          <span class="progress-fill" :style="{ width: `${gameProgress}%` }"></span>
        </span>
        <span class="progress-text">{{ gameStore.gameState?.turn || 0 }}/{{ maxTurns }}</span>
      </span>
    </div>

    <!-- Key Metrics Row -->
    <div class="metrics-row">
      <div class="metric-card">
        <span class="metric-icon">⚡</span>
        <div class="metric-data">
          <span class="metric-value">{{ actionsPerTurn }}</span>
          <span class="metric-label">ACT/TURN</span>
        </div>
      </div>
      <div class="metric-card leader" :class="leader">
        <span class="metric-icon">◆</span>
        <div class="metric-data">
          <span class="metric-value">{{ leader.toUpperCase() }}</span>
          <span class="metric-label">+{{ leadMargin.toFixed(1) }}%</span>
        </div>
      </div>
      <div class="metric-card">
        <span class="metric-icon">◎</span>
        <div class="metric-data">
          <span class="metric-value">{{ activeCommanders }}/{{ totalCommanders }}</span>
          <span class="metric-label">ACTIVE</span>
        </div>
      </div>
      <div class="metric-card">
        <span class="metric-icon">⟳</span>
        <div class="metric-data">
          <span class="metric-value">{{ gameStore.totalActions }}</span>
          <span class="metric-label">TOTAL</span>
        </div>
      </div>
    </div>

    <!-- Resource Control Visualization -->
    <div class="control-section">
      <div class="section-header">
        <span class="section-title">TERRITORY CONTROL</span>
      </div>
      <div class="control-display">
        <div class="control-bar-container">
          <div class="control-bar red" :style="{ width: `${gameStore.gameState?.resourceControl.red || 0}%` }">
            <span class="control-label" v-if="(gameStore.gameState?.resourceControl.red || 0) > 15">
              {{ (gameStore.gameState?.resourceControl.red || 0).toFixed(1) }}%
            </span>
          </div>
          <div class="control-bar neutral" :style="{ width: `${gameStore.gameState?.resourceControl.neutral || 0}%` }">
            <span class="control-label" v-if="(gameStore.gameState?.resourceControl.neutral || 0) > 15">
              {{ (gameStore.gameState?.resourceControl.neutral || 0).toFixed(1) }}%
            </span>
          </div>
          <div class="control-bar blue" :style="{ width: `${gameStore.gameState?.resourceControl.blue || 0}%` }">
            <span class="control-label" v-if="(gameStore.gameState?.resourceControl.blue || 0) > 15">
              {{ (gameStore.gameState?.resourceControl.blue || 0).toFixed(1) }}%
            </span>
          </div>
        </div>
        <div class="control-legend">
          <span class="legend-item"><span class="leg-dot red"></span>RED</span>
          <span class="legend-item"><span class="leg-dot neutral"></span>NEUTRAL</span>
          <span class="legend-item"><span class="leg-dot blue"></span>BLUE</span>
        </div>
      </div>
    </div>

    <!-- Team Comparison -->
    <div class="teams-section">
      <!-- Red Team -->
      <div class="team-card red">
        <div class="team-header">
          <span class="team-indicator"></span>
          <span class="team-name">RED ALLIANCE</span>
        </div>
        <div class="team-stats">
          <div class="stat-item">
            <span class="stat-label">RESOURCES</span>
            <span class="stat-value">{{ redResources }}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">TERRITORIES</span>
            <span class="stat-value">{{ redTerritories }}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">UNITS</span>
            <span class="stat-value">{{ redUnits }}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">COMMANDERS</span>
            <span class="stat-value">{{ redActiveCommanders }}/{{ gameStore.redCommanders.length }}</span>
          </div>
        </div>
        <div class="team-strength">
          <div class="strength-bar" :style="{ width: `${redStrength}%` }"></div>
        </div>
      </div>

      <!-- VS Indicator -->
      <div class="vs-indicator">VS</div>

      <!-- Blue Team -->
      <div class="team-card blue">
        <div class="team-header">
          <span class="team-indicator"></span>
          <span class="team-name">BLUE COALITION</span>
        </div>
        <div class="team-stats">
          <div class="stat-item">
            <span class="stat-label">RESOURCES</span>
            <span class="stat-value">{{ blueResources }}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">TERRITORIES</span>
            <span class="stat-value">{{ blueTerritories }}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">UNITS</span>
            <span class="stat-value">{{ blueUnits }}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">COMMANDERS</span>
            <span class="stat-value">{{ blueActiveCommanders }}/{{ gameStore.blueCommanders.length }}</span>
          </div>
        </div>
        <div class="team-strength">
          <div class="strength-bar" :style="{ width: `${blueStrength}%` }"></div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useGameStore } from '@/stores/gameStore'

const gameStore = useGameStore()
const maxTurns = 15

const gameProgress = computed(() => {
  return Math.round(((gameStore.gameState?.turn || 0) / maxTurns) * 100)
})

const actionsPerTurn = computed(() => {
  const turn = gameStore.gameState?.turn || 1
  return turn > 0 ? Math.round(gameStore.totalActions / turn) : 0
})

const leader = computed(() => {
  const red = gameStore.gameState?.resourceControl.red || 0
  const blue = gameStore.gameState?.resourceControl.blue || 0
  return red > blue ? 'red' : blue > red ? 'blue' : 'neutral'
})

const leadMargin = computed(() => {
  const red = gameStore.gameState?.resourceControl.red || 0
  const blue = gameStore.gameState?.resourceControl.blue || 0
  return Math.abs(red - blue)
})

const activeCommanders = computed(() => {
  return gameStore.gameState?.commanders.filter(c => c.status === 'active').length || 0
})

const totalCommanders = computed(() => {
  return gameStore.gameState?.commanders.length || 0
})

const redResources = computed(() =>
  gameStore.redCommanders.reduce((sum, c) => sum + c.resources, 0)
)

const blueResources = computed(() =>
  gameStore.blueCommanders.reduce((sum, c) => sum + c.resources, 0)
)

const redTerritories = computed(() =>
  gameStore.redCommanders.reduce((sum, c) => sum + c.controlledTerritories.length, 0)
)

const blueTerritories = computed(() =>
  gameStore.blueCommanders.reduce((sum, c) => sum + c.controlledTerritories.length, 0)
)

const redUnits = computed(() =>
  gameStore.redCommanders.reduce(
    (sum, c) => sum + c.units.reduce((s, u) => s + u.count, 0),
    0
  )
)

const blueUnits = computed(() =>
  gameStore.blueCommanders.reduce(
    (sum, c) => sum + c.units.reduce((s, u) => s + u.count, 0),
    0
  )
)

const redActiveCommanders = computed(() =>
  gameStore.redCommanders.filter(c => c.status === 'active').length
)

const blueActiveCommanders = computed(() =>
  gameStore.blueCommanders.filter(c => c.status === 'active').length
)

const redStrength = computed(() => {
  const total = redResources.value + blueResources.value
  return total > 0 ? (redResources.value / total) * 100 : 50
})

const blueStrength = computed(() => {
  const total = redResources.value + blueResources.value
  return total > 0 ? (blueResources.value / total) * 100 : 50
})
</script>

<style scoped>
.analytics-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 8px;
  gap: 12px;
  overflow-y: auto;
}

/* Header */
.analytics-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 12px;
  background: rgba(0, 0, 0, 0.3);
  border-radius: 6px;
  flex-shrink: 0;
}

.analytics-title {
  font-family: var(--font-display);
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 2px;
  color: var(--color-cyan);
}

.game-progress {
  display: flex;
  align-items: center;
  gap: 8px;
}

.progress-label {
  font-family: var(--font-mono);
  font-size: 0.55rem;
  color: var(--color-text-dim);
}

.progress-bar {
  width: 100px;
  height: 6px;
  background: rgba(0, 0, 0, 0.4);
  border-radius: 3px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--color-cyan), var(--color-purple));
  transition: width 0.5s ease;
}

.progress-text {
  font-family: var(--font-mono);
  font-size: 0.65rem;
  color: var(--color-text-secondary);
}

/* Metrics Row */
.metrics-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  flex-shrink: 0;
}

.metric-card {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  background: rgba(0, 0, 0, 0.3);
  border-radius: 6px;
  border-left: 3px solid var(--color-cyan);
}

.metric-card.leader.red { border-left-color: var(--color-red); }
.metric-card.leader.blue { border-left-color: var(--color-blue); }
.metric-card.leader.neutral { border-left-color: var(--color-neutral); }

.metric-icon {
  font-size: 1.2rem;
  color: var(--color-cyan);
}

.metric-card.leader.red .metric-icon { color: var(--color-red); }
.metric-card.leader.blue .metric-icon { color: var(--color-blue); }

.metric-data {
  display: flex;
  flex-direction: column;
}

.metric-value {
  font-family: var(--font-display);
  font-size: 0.9rem;
  font-weight: 700;
  color: var(--color-text-primary);
}

.metric-label {
  font-family: var(--font-mono);
  font-size: 0.5rem;
  color: var(--color-text-dim);
}

/* Control Section */
.control-section {
  background: rgba(0, 0, 0, 0.2);
  border-radius: 6px;
  padding: 12px;
  flex-shrink: 0;
}

.section-header {
  margin-bottom: 12px;
}

.section-title {
  font-family: var(--font-display);
  font-size: 0.65rem;
  font-weight: 600;
  letter-spacing: 1px;
  color: var(--color-text-secondary);
}

.control-display {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.control-bar-container {
  display: flex;
  height: 32px;
  border-radius: 4px;
  overflow: hidden;
}

.control-bar {
  display: flex;
  align-items: center;
  justify-content: center;
  transition: width 0.5s ease;
}

.control-bar.red { 
  background: linear-gradient(90deg, var(--color-red), rgba(255, 71, 87, 0.7));
}
.control-bar.blue { 
  background: linear-gradient(90deg, rgba(59, 130, 246, 0.7), var(--color-blue));
}
.control-bar.neutral { 
  background: var(--color-neutral);
}

.control-label {
  font-family: var(--font-mono);
  font-size: 0.65rem;
  font-weight: 700;
  color: white;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
}

.control-legend {
  display: flex;
  justify-content: center;
  gap: 16px;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 4px;
  font-family: var(--font-mono);
  font-size: 0.55rem;
  color: var(--color-text-secondary);
}

.leg-dot {
  width: 8px;
  height: 8px;
  border-radius: 2px;
}

.leg-dot.red { background: var(--color-red); }
.leg-dot.blue { background: var(--color-blue); }
.leg-dot.neutral { background: var(--color-neutral); }

/* Teams Section */
.teams-section {
  flex: 1;
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  gap: 8px;
  align-items: stretch;
  min-height: 0;
}

.team-card {
  display: flex;
  flex-direction: column;
  background: rgba(0, 0, 0, 0.2);
  border-radius: 6px;
  overflow: hidden;
}

.team-card.red {
  border-top: 3px solid var(--color-red);
}

.team-card.blue {
  border-top: 3px solid var(--color-blue);
}

.team-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: rgba(0, 0, 0, 0.2);
}

.team-indicator {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.team-card.red .team-indicator {
  background: var(--color-red);
  box-shadow: 0 0 8px var(--color-red-glow);
}

.team-card.blue .team-indicator {
  background: var(--color-blue);
  box-shadow: 0 0 8px var(--color-blue-glow);
}

.team-name {
  font-family: var(--font-display);
  font-size: 0.65rem;
  font-weight: 600;
  letter-spacing: 1px;
  color: var(--color-text-primary);
}

.team-stats {
  flex: 1;
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 6px;
  padding: 8px;
}

.stat-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 6px 8px;
  background: rgba(0, 0, 0, 0.2);
  border-radius: 4px;
}

.stat-label {
  font-family: var(--font-mono);
  font-size: 0.5rem;
  color: var(--color-text-dim);
}

.stat-value {
  font-family: var(--font-display);
  font-size: 0.85rem;
  font-weight: 700;
  color: var(--color-text-primary);
}

.team-card.red .stat-value {
  color: var(--color-red);
}

.team-card.blue .stat-value {
  color: var(--color-blue);
}

.team-strength {
  height: 4px;
  background: rgba(0, 0, 0, 0.4);
}

.team-card.red .strength-bar {
  height: 100%;
  background: var(--color-red);
  transition: width 0.5s ease;
}

.team-card.blue .strength-bar {
  height: 100%;
  background: var(--color-blue);
  transition: width 0.5s ease;
}

.vs-indicator {
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--font-display);
  font-size: 0.9rem;
  font-weight: 700;
  color: var(--color-text-dim);
  padding: 0 8px;
}
</style>
