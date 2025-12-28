<template>
  <div class="analytics-view">
    <div class="view-header">
      <h2>📊 Analytics Dashboard</h2>
    </div>

    <!-- Key Metrics -->
    <div class="metrics-grid">
      <div class="metric-card">
        <div class="metric-icon">🎮</div>
        <div class="metric-content">
          <div class="metric-label">Game Progress</div>
          <div class="metric-value">
            {{ gameStore.gameState?.turn || 0 }} / {{ maxTurns }}
          </div>
          <div class="metric-subtext">
            {{ Math.round(((gameStore.gameState?.turn || 0) / maxTurns) * 100) }}% Complete
          </div>
        </div>
      </div>

      <div class="metric-card">
        <div class="metric-icon">⚡</div>
        <div class="metric-content">
          <div class="metric-label">Actions/Turn</div>
          <div class="metric-value">{{ actionsPerTurn }}</div>
          <div class="metric-subtext">{{ totalActions }} total actions</div>
        </div>
      </div>

      <div class="metric-card">
        <div class="metric-icon">🏆</div>
        <div class="metric-content">
          <div class="metric-label">Leader</div>
          <div class="metric-value" :class="`text-${leader}`">
            {{ leader.toUpperCase() }}
          </div>
          <div class="metric-subtext">
            +{{ leadMargin.toFixed(1) }}% advantage
          </div>
        </div>
      </div>

      <div class="metric-card">
        <div class="metric-icon">👥</div>
        <div class="metric-content">
          <div class="metric-label">Active Commanders</div>
          <div class="metric-value">{{ activeCommanders }}</div>
          <div class="metric-subtext">of {{ totalCommanders }} total</div>
        </div>
      </div>
    </div>

    <!-- Resource Control Chart -->
    <div class="chart-card">
      <h3>📈 Resource Control Over Time</h3>
      <div class="chart-placeholder">
        <div class="resource-bars">
          <div class="resource-bar">
            <div class="bar-label">Red Alliance</div>
            <div class="bar-container">
              <div
                class="bar-fill bg-red"
                :style="{ width: `${gameStore.gameState?.resourceControl.red || 0}%` }"
              ></div>
              <span class="bar-value">
                {{ (gameStore.gameState?.resourceControl.red || 0).toFixed(1) }}%
              </span>
            </div>
          </div>
          <div class="resource-bar">
            <div class="bar-label">Blue Coalition</div>
            <div class="bar-container">
              <div
                class="bar-fill bg-blue"
                :style="{ width: `${gameStore.gameState?.resourceControl.blue || 0}%` }"
              ></div>
              <span class="bar-value">
                {{ (gameStore.gameState?.resourceControl.blue || 0).toFixed(1) }}%
              </span>
            </div>
          </div>
          <div class="resource-bar">
            <div class="bar-label">Neutral</div>
            <div class="bar-container">
              <div
                class="bar-fill bg-neutral"
                :style="{ width: `${gameStore.gameState?.resourceControl.neutral || 0}%` }"
              ></div>
              <span class="bar-value">
                {{ (gameStore.gameState?.resourceControl.neutral || 0).toFixed(1) }}%
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Team Comparison -->
    <div class="comparison-grid">
      <div class="comparison-card">
        <h3>🔴 Red Alliance</h3>
        <div class="team-stats">
          <div class="team-stat">
            <span>Total Resources:</span>
            <strong>{{ redResources }}</strong>
          </div>
          <div class="team-stat">
            <span>Territories:</span>
            <strong>{{ redTerritories }}</strong>
          </div>
          <div class="team-stat">
            <span>Total Units:</span>
            <strong>{{ redUnits }}</strong>
          </div>
          <div class="team-stat">
            <span>Active Commanders:</span>
            <strong>{{ redActiveCommanders }}</strong>
          </div>
        </div>
      </div>

      <div class="comparison-card">
        <h3>🔵 Blue Coalition</h3>
        <div class="team-stats">
          <div class="team-stat">
            <span>Total Resources:</span>
            <strong>{{ blueResources }}</strong>
          </div>
          <div class="team-stat">
            <span>Territories:</span>
            <strong>{{ blueTerritories }}</strong>
          </div>
          <div class="team-stat">
            <span>Total Units:</span>
            <strong>{{ blueUnits }}</strong>
          </div>
          <div class="team-stat">
            <span>Active Commanders:</span>
            <strong>{{ blueActiveCommanders }}</strong>
          </div>
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

const totalActions = computed(() => gameStore.actions.length)

const actionsPerTurn = computed(() => {
  const turn = gameStore.gameState?.turn || 1
  return turn > 0 ? Math.round(totalActions.value / turn) : 0
})

const leader = computed(() => {
  const red = gameStore.gameState?.resourceControl.red || 0
  const blue = gameStore.gameState?.resourceControl.blue || 0
  return red > blue ? 'red' : 'blue'
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
</script>

<style scoped>
.analytics-view {
  display: flex;
  flex-direction: column;
  gap: 20px;
  height: 100%;
  overflow-y: auto;
}

.metrics-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 16px;
}

.metric-card {
  display: flex;
  gap: 16px;
  padding: 20px;
  background: var(--color-bg-tertiary);
  border-radius: 8px;
}

.metric-icon {
  font-size: 2.5em;
}

.metric-content {
  flex: 1;
}

.metric-label {
  font-size: 0.85em;
  color: var(--color-text-secondary);
  margin-bottom: 4px;
}

.metric-value {
  font-size: 1.8em;
  font-weight: bold;
  margin-bottom: 4px;
}

.metric-subtext {
  font-size: 0.85em;
  color: var(--color-text-secondary);
}

.chart-card {
  padding: 20px;
  background: var(--color-bg-tertiary);
  border-radius: 8px;
}

.chart-card h3 {
  margin-bottom: 20px;
}

.resource-bars {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.resource-bar {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.bar-label {
  font-weight: bold;
  font-size: 0.9em;
}

.bar-container {
  position: relative;
  height: 40px;
  background: var(--color-bg-secondary);
  border-radius: 6px;
  overflow: hidden;
}

.bar-fill {
  height: 100%;
  transition: width 0.5s ease;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding-right: 12px;
}

.bar-value {
  position: absolute;
  right: 12px;
  top: 50%;
  transform: translateY(-50%);
  font-weight: bold;
  color: white;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
}

.comparison-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 16px;
}

.comparison-card {
  padding: 20px;
  background: var(--color-bg-tertiary);
  border-radius: 8px;
}

.comparison-card h3 {
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 2px solid var(--color-border);
}

.team-stats {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.team-stat {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px;
  background: var(--color-bg-secondary);
  border-radius: 6px;
}

.team-stat span {
  color: var(--color-text-secondary);
}

.team-stat strong {
  font-size: 1.2em;
  color: var(--color-text-primary);
}
</style>
