<template>
  <div class="map-view">
    <div class="map-header">
      <h2>🗺️ Battle Map</h2>
      <div class="map-controls">
        <button
          class="control-btn"
          :class="{ active: !fogEnabled }"
          @click="fogEnabled = false"
        >
          👁️ Full View
        </button>
        <button
          class="control-btn"
          :class="{ active: fogEnabled }"
          @click="fogEnabled = true"
        >
          🌫️ Fog of War
        </button>
      </div>
    </div>

    <div class="map-legend">
      <div class="legend-item">
        <div class="legend-color" style="background: var(--color-red);"></div>
        <span>Red Territory</span>
      </div>
      <div class="legend-item">
        <div class="legend-color" style="background: var(--color-blue);"></div>
        <span>Blue Territory</span>
      </div>
      <div class="legend-item">
        <div class="legend-color" style="background: var(--color-neutral);"></div>
        <span>Neutral</span>
      </div>
      <div class="legend-item">
        <div class="legend-color" style="background: #2a2a2a;"></div>
        <span>Hidden (Fog)</span>
      </div>
    </div>

    <div class="map-container">
      <div class="map-grid" :style="{ gridTemplateColumns: `repeat(${mapSize}, 1fr)` }">
        <div
          v-for="(tile, index) in flattenedMap"
          :key="index"
          class="map-tile"
          :class="[
            getTileClass(tile),
            {
              'has-units': tile.units.length > 0,
              'has-fortress': tile.fortificationLevel > 0
            }
          ]"
          :title="getTileTooltip(tile)"
          @click="selectTile(tile)"
        >
          <div v-if="tile.resourceValue > 0" class="resource-indicator">
            {{ tile.resourceValue }}
          </div>
          <div v-if="tile.units.length > 0" class="unit-indicator">
            {{ getUnitIcon(tile.units[0].type) }}
          </div>
          <div v-if="tile.fortificationLevel > 0" class="fortress-indicator">
            🏰
          </div>
        </div>
      </div>
    </div>

    <!-- Selected Tile Details -->
    <div v-if="selectedTile" class="tile-details">
      <h3>{{ getTileId(selectedTile.position) }}</h3>
      <div class="detail-row">
        <span>Terrain:</span>
        <span>{{ selectedTile.terrain }}</span>
      </div>
      <div class="detail-row">
        <span>Owner:</span>
        <span :class="`text-${selectedTile.owner}`">{{ selectedTile.owner }}</span>
      </div>
      <div class="detail-row">
        <span>Resources:</span>
        <span>{{ selectedTile.resourceValue }}</span>
      </div>
      <div class="detail-row">
        <span>Fortification:</span>
        <span>Level {{ selectedTile.fortificationLevel }}</span>
      </div>
      <div v-if="selectedTile.units.length > 0" class="units-list">
        <h4>Units Present:</h4>
        <div v-for="unit in selectedTile.units" :key="unit.id" class="unit-detail">
          {{ getUnitIcon(unit.type) }} {{ unit.count }} {{ unit.type }} ({{ unit.team }})
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useGameStore } from '@/stores/gameStore'
import type { Tile } from '@/types/game'

const gameStore = useGameStore()
const fogEnabled = ref(false)
const selectedTile = ref<Tile | null>(null)

const mapSize = computed(() => gameStore.gameState?.map.length || 12)

const flattenedMap = computed(() => {
  if (!gameStore.gameState?.map) return []
  return gameStore.gameState.map.flat()
})

function getTileClass(tile: Tile): string {
  if (fogEnabled.value) {
    if (gameStore.activeCommander) {
      // Show fog based on selected commander's visibility
      const isVisible = gameStore.activeCommander.visibility.some(
        v => v.x === tile.position.x && v.y === tile.position.y
      )
      if (!isVisible) return 'hidden'
    } else {
      // Show fog based on ALL commanders' combined visibility
      const allCommanders = gameStore.gameState?.commanders || []
      const isVisibleToAny = allCommanders.some(commander =>
        commander.visibility.some(
          v => v.x === tile.position.x && v.y === tile.position.y
        )
      )
      if (!isVisibleToAny) return 'hidden'
    }
  }
  return `owner-${tile.owner}`
}

function getTileId(pos: { x: number; y: number }): string {
  const letter = String.fromCharCode(65 + pos.x)
  const number = pos.y + 1
  return `${letter}${number}`
}

function getTileTooltip(tile: Tile): string {
  const id = getTileId(tile.position)
  const parts = [
    `${id} - ${tile.terrain}`,
    `Owner: ${tile.owner}`,
    `Resources: ${tile.resourceValue}`
  ]
  if (tile.fortificationLevel > 0) {
    parts.push(`Fortification: Level ${tile.fortificationLevel}`)
  }
  if (tile.units.length > 0) {
    parts.push(`Units: ${tile.units.length} groups`)
  }
  return parts.join(' | ')
}

function getUnitIcon(type: string): string {
  const icons: Record<string, string> = {
    infantry: '🚶',
    cavalry: '🐎',
    archers: '🏹'
  }
  return icons[type] || '⚔️'
}

function selectTile(tile: Tile) {
  selectedTile.value = tile
}
</script>

<style scoped>
.map-view {
  display: flex;
  flex-direction: column;
  gap: 16px;
  height: 100%;
}

.map-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.map-controls {
  display: flex;
  gap: 8px;
}

.control-btn {
  padding: 8px 16px;
  background: var(--color-bg-tertiary);
  border: none;
  border-radius: 6px;
  color: var(--color-text-primary);
  cursor: pointer;
  transition: all 0.2s;
}

.control-btn:hover {
  background: var(--color-border);
}

.control-btn.active {
  background: var(--color-blue);
}

.map-legend {
  display: flex;
  gap: 16px;
  padding: 12px;
  background: var(--color-bg-tertiary);
  border-radius: 6px;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.9em;
}

.legend-color {
  width: 20px;
  height: 20px;
  border-radius: 4px;
  border: 1px solid var(--color-border);
}

.map-container {
  flex: 1;
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 20px;
  background: var(--color-bg-tertiary);
  border-radius: 8px;
}

.map-grid {
  display: grid;
  gap: 2px;
  max-width: 100%;
  aspect-ratio: 1;
}

.map-tile {
  aspect-ratio: 1;
  background: #2a2a2a;
  border: 1px solid #444;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  font-size: 0.7em;
  cursor: pointer;
  transition: all 0.2s;
  position: relative;
  min-width: 40px;
}

.map-tile:hover {
  transform: scale(1.15);
  z-index: 10;
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.3);
}

.map-tile.owner-red {
  background: var(--color-red);
}

.map-tile.owner-blue {
  background: var(--color-blue);
}

.map-tile.owner-neutral {
  background: var(--color-neutral);
}

.map-tile.hidden {
  background: #1a1a1a;
  opacity: 0.3;
}

.map-tile.has-fortress {
  box-shadow: inset 0 0 10px rgba(255, 215, 0, 0.5);
}

.resource-indicator {
  position: absolute;
  top: 2px;
  right: 2px;
  font-size: 0.8em;
  font-weight: bold;
  color: gold;
}

.unit-indicator {
  font-size: 1.2em;
}

.fortress-indicator {
  position: absolute;
  top: 2px;
  left: 2px;
  font-size: 0.8em;
}

.tile-details {
  padding: 16px;
  background: var(--color-bg-tertiary);
  border-radius: 8px;
}

.tile-details h3 {
  margin-bottom: 12px;
  color: var(--color-blue);
}

.detail-row {
  display: flex;
  justify-content: space-between;
  padding: 6px 0;
  border-bottom: 1px solid var(--color-border);
}

.units-list {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 2px solid var(--color-border);
}

.units-list h4 {
  margin-bottom: 8px;
  font-size: 0.9em;
  color: var(--color-text-secondary);
}

.unit-detail {
  padding: 6px;
  background: var(--color-bg-secondary);
  border-radius: 4px;
  margin-bottom: 4px;
}
</style>
