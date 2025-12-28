<template>
  <div class="map-view">
    <!-- Map Header - Minimal -->
    <div class="map-header">
      <div class="header-left">
        <span class="map-title">TACTICAL MAP</span>
        <span class="map-size">{{ mapSize }}×{{ mapSize }}</span>
      </div>
      
      <div class="map-controls">
        <button
          class="control-btn"
          :class="{ active: !fogEnabled }"
          @click="fogEnabled = false"
          title="Full visibility"
        >
          ◉
        </button>
        <button
          class="control-btn"
          :class="{ active: fogEnabled }"
          @click="fogEnabled = true"
          title="Fog of War"
        >
          ◈
        </button>
      </div>
      
      <div class="legend-compact">
        <span class="legend-item"><span class="leg-color red"></span>RED</span>
        <span class="legend-item"><span class="leg-color blue"></span>BLUE</span>
        <span class="legend-item"><span class="leg-color neutral"></span>NEU</span>
      </div>
    </div>

    <!-- Map Container -->
    <div class="map-container">
      <div class="map-grid" :style="gridStyle">
        <div
          v-for="(tile, index) in flattenedMap"
          :key="index"
          class="map-tile"
          :class="getTileClasses(tile)"
          :title="getTileTooltip(tile)"
          @click="selectTile(tile)"
        >
          <!-- Resource indicator -->
          <span v-if="tile.resourceValue > 0 && !isHidden(tile)" class="resource-val">
            {{ tile.resourceValue }}
          </span>
          
          <!-- Unit indicator -->
          <span v-if="tile.units.length > 0 && !isHidden(tile)" class="unit-marker" :class="tile.units[0].team">
            {{ getUnitIcon(tile.units[0].type) }}
          </span>
          
          <!-- Fortress indicator -->
          <span v-if="tile.fortificationLevel > 0 && !isHidden(tile)" class="fort-marker">
            ⬡
          </span>
          
          <!-- Coordinate label (corner tiles only) -->
          <span v-if="showCoordinate(tile)" class="coord-label">
            {{ getTileId(tile.position) }}
          </span>
        </div>
      </div>
      
      <!-- Grid overlay effect -->
      <div class="grid-overlay"></div>
    </div>

    <!-- Tile Details Panel - Compact -->
    <div v-if="selectedTile" class="tile-details">
      <div class="detail-header">
        <span class="tile-id">{{ getTileId(selectedTile.position) }}</span>
        <span class="tile-terrain">{{ selectedTile.terrain }}</span>
        <button class="close-btn" @click="selectedTile = null">×</button>
      </div>
      <div class="detail-grid">
        <div class="detail-item">
          <span class="d-label">OWNER</span>
          <span class="d-value" :class="selectedTile.owner">{{ selectedTile.owner }}</span>
        </div>
        <div class="detail-item">
          <span class="d-label">RESOURCES</span>
          <span class="d-value">{{ selectedTile.resourceValue }}</span>
        </div>
        <div class="detail-item">
          <span class="d-label">FORTIFY</span>
          <span class="d-value">LV{{ selectedTile.fortificationLevel }}</span>
        </div>
        <div v-if="selectedTile.units.length > 0" class="detail-item full">
          <span class="d-label">UNITS</span>
          <div class="units-list">
            <span v-for="unit in selectedTile.units" :key="unit.id" class="unit-tag" :class="unit.team">
              {{ getUnitIcon(unit.type) }} {{ unit.count }} {{ unit.type }}
            </span>
          </div>
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

const gridStyle = computed(() => ({
  gridTemplateColumns: `repeat(${mapSize.value}, 1fr)`,
  gridTemplateRows: `repeat(${mapSize.value}, 1fr)`
}))

function isHidden(tile: Tile): boolean {
  if (!fogEnabled.value) return false
  
  if (gameStore.activeCommander) {
    return !gameStore.activeCommander.visibility.some(
      v => v.x === tile.position.x && v.y === tile.position.y
    )
  }
  
  const allCommanders = gameStore.gameState?.commanders || []
  return !allCommanders.some(commander =>
    commander.visibility.some(
      v => v.x === tile.position.x && v.y === tile.position.y
    )
  )
}

function getTileClasses(tile: Tile): Record<string, boolean> {
  const hidden = isHidden(tile)
  return {
    'hidden': hidden,
    'owner-red': !hidden && tile.owner === 'red',
    'owner-blue': !hidden && tile.owner === 'blue',
    'owner-neutral': !hidden && tile.owner === 'neutral',
    'has-units': !hidden && tile.units.length > 0,
    'has-fortress': !hidden && tile.fortificationLevel > 0,
    'selected': selectedTile.value?.position.x === tile.position.x && 
                selectedTile.value?.position.y === tile.position.y
  }
}

function getTileId(pos: { x: number; y: number }): string {
  const letter = String.fromCharCode(65 + pos.x)
  return `${letter}${pos.y + 1}`
}

function showCoordinate(tile: Tile): boolean {
  // Show coordinates on corner tiles and every 4th tile
  const x = tile.position.x
  const y = tile.position.y
  const max = mapSize.value - 1
  return (x === 0 && y === 0) || (x === max && y === 0) || 
         (x === 0 && y === max) || (x === max && y === max) ||
         (x % 4 === 0 && y % 4 === 0)
}

function getTileTooltip(tile: Tile): string {
  if (isHidden(tile)) return 'Unknown territory'
  const id = getTileId(tile.position)
  return `${id} • ${tile.terrain} • ${tile.owner} • Res: ${tile.resourceValue}`
}

function getUnitIcon(type: string): string {
  const icons: Record<string, string> = {
    infantry: '⚔',
    cavalry: '♘',
    archers: '➶'
  }
  return icons[type] || '●'
}

function selectTile(tile: Tile) {
  if (isHidden(tile)) return
  selectedTile.value = selectedTile.value?.position.x === tile.position.x && 
                       selectedTile.value?.position.y === tile.position.y 
                       ? null : tile
}
</script>

<style scoped>
.map-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 8px;
  gap: 8px;
}

/* Header */
.map-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 12px;
  background: rgba(0, 0, 0, 0.3);
  border-radius: 6px;
  flex-shrink: 0;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.map-title {
  font-family: var(--font-display);
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 2px;
  color: var(--color-cyan);
}

.map-size {
  font-family: var(--font-mono);
  font-size: 0.65rem;
  color: var(--color-text-dim);
}

.map-controls {
  display: flex;
  gap: 4px;
}

.control-btn {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.9rem;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid var(--glass-border);
  border-radius: 4px;
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: all 0.2s ease;
}

.control-btn:hover {
  background: rgba(0, 212, 255, 0.1);
  border-color: var(--color-cyan);
  color: var(--color-cyan);
}

.control-btn.active {
  background: var(--color-cyan);
  border-color: var(--color-cyan);
  color: var(--color-bg-primary);
}

.legend-compact {
  display: flex;
  gap: 12px;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 4px;
  font-family: var(--font-mono);
  font-size: 0.6rem;
  color: var(--color-text-secondary);
}

.leg-color {
  width: 10px;
  height: 10px;
  border-radius: 2px;
}

.leg-color.red { background: var(--color-red); }
.leg-color.blue { background: var(--color-blue); }
.leg-color.neutral { background: var(--color-neutral); }

/* Map Container */
.map-container {
  flex: 1;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.2);
  border-radius: 8px;
  overflow: hidden;
  min-height: 0;
}

.map-grid {
  display: grid;
  gap: 1px;
  width: 100%;
  height: 100%;
  max-width: min(100%, calc(100vh - 200px));
  max-height: 100%;
  aspect-ratio: 1;
  padding: 4px;
}

.grid-overlay {
  position: absolute;
  inset: 0;
  background: 
    linear-gradient(90deg, rgba(0, 212, 255, 0.03) 1px, transparent 1px),
    linear-gradient(rgba(0, 212, 255, 0.03) 1px, transparent 1px);
  background-size: 20px 20px;
  pointer-events: none;
}

/* Map Tiles */
.map-tile {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(30, 40, 60, 0.6);
  border: 1px solid rgba(50, 70, 100, 0.3);
  border-radius: 2px;
  cursor: pointer;
  transition: all 0.15s ease;
  font-size: clamp(0.5rem, 1.5vw, 0.8rem);
}

.map-tile:hover {
  transform: scale(1.1);
  z-index: 10;
  border-color: var(--color-cyan);
  box-shadow: 0 0 10px var(--color-cyan-glow);
}

.map-tile.selected {
  border-color: var(--color-cyan);
  box-shadow: 0 0 15px var(--color-cyan-glow), inset 0 0 10px rgba(0, 212, 255, 0.2);
}

.map-tile.owner-red {
  background: linear-gradient(135deg, rgba(255, 71, 87, 0.4) 0%, rgba(255, 71, 87, 0.2) 100%);
  border-color: rgba(255, 71, 87, 0.4);
}

.map-tile.owner-blue {
  background: linear-gradient(135deg, rgba(59, 130, 246, 0.4) 0%, rgba(59, 130, 246, 0.2) 100%);
  border-color: rgba(59, 130, 246, 0.4);
}

.map-tile.owner-neutral {
  background: linear-gradient(135deg, rgba(100, 116, 139, 0.3) 0%, rgba(100, 116, 139, 0.15) 100%);
  border-color: rgba(100, 116, 139, 0.3);
}

.map-tile.hidden {
  background: rgba(10, 15, 25, 0.8);
  border-color: rgba(30, 40, 60, 0.3);
  cursor: default;
}

.map-tile.hidden:hover {
  transform: none;
  box-shadow: none;
}

.map-tile.has-fortress {
  box-shadow: inset 0 0 8px rgba(255, 215, 0, 0.4);
}

/* Tile indicators */
.resource-val {
  position: absolute;
  top: 1px;
  right: 2px;
  font-family: var(--font-mono);
  font-size: 0.5em;
  font-weight: 700;
  color: gold;
  text-shadow: 0 0 4px rgba(255, 215, 0, 0.8);
}

.unit-marker {
  font-size: 1.2em;
  text-shadow: 0 0 6px currentColor;
}

.unit-marker.red { color: var(--color-red); }
.unit-marker.blue { color: var(--color-blue); }

.fort-marker {
  position: absolute;
  bottom: 1px;
  left: 2px;
  font-size: 0.6em;
  color: gold;
  text-shadow: 0 0 4px rgba(255, 215, 0, 0.6);
}

.coord-label {
  position: absolute;
  bottom: 0;
  right: 1px;
  font-family: var(--font-mono);
  font-size: 0.4em;
  color: rgba(100, 150, 200, 0.5);
}

/* Tile Details */
.tile-details {
  position: absolute;
  bottom: 12px;
  left: 12px;
  width: 240px;
  background: var(--glass-bg);
  backdrop-filter: var(--glass-blur);
  border: 1px solid var(--glass-border);
  border-radius: 8px;
  padding: 10px;
  animation: fade-in-up 0.2s ease;
}

.detail-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--glass-border);
}

.tile-id {
  font-family: var(--font-display);
  font-size: 0.9rem;
  font-weight: 700;
  color: var(--color-cyan);
}

.tile-terrain {
  font-family: var(--font-mono);
  font-size: 0.65rem;
  color: var(--color-text-secondary);
  text-transform: uppercase;
}

.close-btn {
  margin-left: auto;
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 1px solid var(--glass-border);
  border-radius: 4px;
  color: var(--color-text-secondary);
  cursor: pointer;
  font-size: 0.9rem;
}

.close-btn:hover {
  border-color: var(--color-red);
  color: var(--color-red);
}

.detail-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

.detail-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.detail-item.full {
  grid-column: 1 / -1;
}

.d-label {
  font-family: var(--font-mono);
  font-size: 0.55rem;
  color: var(--color-text-dim);
  letter-spacing: 0.5px;
}

.d-value {
  font-family: var(--font-display);
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--color-text-primary);
  text-transform: uppercase;
}

.d-value.red { color: var(--color-red); }
.d-value.blue { color: var(--color-blue); }
.d-value.neutral { color: var(--color-neutral); }

.units-list {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.unit-tag {
  padding: 2px 6px;
  font-family: var(--font-mono);
  font-size: 0.6rem;
  background: rgba(0, 0, 0, 0.3);
  border-radius: 3px;
  color: var(--color-text-secondary);
}

.unit-tag.red { border-left: 2px solid var(--color-red); }
.unit-tag.blue { border-left: 2px solid var(--color-blue); }
</style>
