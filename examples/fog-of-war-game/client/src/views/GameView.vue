<template>
  <div class="game-view">
    <!-- Scan line effect -->
    <div class="scan-line"></div>
    
    <!-- Top HUD Bar - Compact -->
    <header class="top-hud">
      <div class="hud-left">
        <button 
          v-if="!gameStore.gameState?.gameStarted"
          class="start-btn" 
          @click="startGame"
          :disabled="startingGame"
        >
          <span class="btn-icon">{{ startingGame ? '◉' : '▶' }}</span>
          {{ startingGame ? 'INITIALIZING...' : 'START GAME' }}
        </button>
        <div v-else class="game-active-indicator">
          <span class="pulse-dot"></span>
          LIVE
        </div>
      </div>
      
      <div class="hud-center">
        <div class="title-group">
          <h1>FOG OF WAR</h1>
          <span class="subtitle">PARALLEL MINDS • MXF POWERED</span>
        </div>
      </div>
      
      <div class="hud-right">
        <div class="connection-badge" :class="{ connected: gameStore.connected }">
          <span class="conn-dot"></span>
          {{ gameStore.connected ? 'ONLINE' : 'OFFLINE' }}
        </div>
      </div>
    </header>

    <!-- Stats Bar - Ultra Compact -->
    <div class="stats-bar">
      <div class="stat-item">
        <span class="stat-icon">⟳</span>
        <span class="stat-label">TURN</span>
        <span class="stat-value">{{ gameStore.gameState?.turn || 0 }}</span>
      </div>
      <div class="stat-divider"></div>
      <div class="stat-item">
        <span class="stat-icon">◈</span>
        <span class="stat-label">PHASE</span>
        <span class="stat-value phase">{{ gameStore.gameState?.phase || 'WAITING' }}</span>
      </div>
      <div class="stat-divider"></div>
      <div class="stat-item red-stat">
        <span class="stat-icon">◆</span>
        <span class="stat-label">RED</span>
        <span class="stat-value">{{ gameStore.gameState?.resourceControl.red.toFixed(1) || 0 }}%</span>
      </div>
      <div class="stat-divider"></div>
      <div class="stat-item blue-stat">
        <span class="stat-icon">◆</span>
        <span class="stat-label">BLUE</span>
        <span class="stat-value">{{ gameStore.gameState?.resourceControl.blue.toFixed(1) || 0 }}%</span>
      </div>
      <div class="stat-divider"></div>
      <div class="stat-item">
        <span class="stat-icon">⚡</span>
        <span class="stat-label">ACTIONS</span>
        <span class="stat-value actions">{{ gameStore.totalActions }}</span>
      </div>
      <div class="stat-divider"></div>
      <div class="stat-item" v-if="gameStore.gameState?.winner">
        <span class="stat-icon">🏆</span>
        <span class="stat-label">WINNER</span>
        <span class="stat-value winner" :class="gameStore.gameState?.winner">{{ gameStore.gameState?.winner?.toUpperCase() }}</span>
      </div>
      
      <!-- View Mode Tabs - Inline -->
      <div class="view-tabs-inline">
        <button
          v-for="mode in viewModes"
          :key="mode.id"
          class="tab-btn"
          :class="{ active: gameStore.viewMode === mode.id }"
          @click="gameStore.setViewMode(mode.id)"
        >
          {{ mode.icon }}
        </button>
      </div>
    </div>

    <!-- Main Content Area - Optimized 3-Column -->
    <div class="main-content">
      <!-- Left Panel - Red Team -->
      <aside class="team-panel red-panel">
        <div class="panel-header">
          <span class="team-indicator red"></span>
          <span class="team-name">RED ALLIANCE</span>
          <span class="team-count">{{ gameStore.redCommanders.length }}</span>
        </div>
        <div class="commanders-grid">
          <CommanderCard
            v-for="(commander, index) in gameStore.redCommanders"
            :key="commander.id"
            :commander="commander"
            :selected="gameStore.selectedCommander === commander.id"
            :style="{ animationDelay: `${index * 0.1}s` }"
            @select="gameStore.selectCommander(commander.id)"
          />
        </div>
      </aside>

      <!-- Center - Main View -->
      <main class="view-panel">
        <MapView v-if="gameStore.viewMode === 'map'" />
        <CommunicationView v-else-if="gameStore.viewMode === 'communication'" />
        <DecisionLogView v-else-if="gameStore.viewMode === 'decisions'" />
        <AnalyticsView v-else-if="gameStore.viewMode === 'analytics'" />
      </main>

      <!-- Right Panel - Blue Team -->
      <aside class="team-panel blue-panel">
        <div class="panel-header">
          <span class="team-indicator blue"></span>
          <span class="team-name">BLUE COALITION</span>
          <span class="team-count">{{ gameStore.blueCommanders.length }}</span>
        </div>
        <div class="commanders-grid">
          <CommanderCard
            v-for="(commander, index) in gameStore.blueCommanders"
            :key="commander.id"
            :commander="commander"
            :selected="gameStore.selectedCommander === commander.id"
            :style="{ animationDelay: `${index * 0.1}s` }"
            @select="gameStore.selectCommander(commander.id)"
          />
        </div>
      </aside>
    </div>
    
    <!-- Corner Decorations -->
    <div class="corner-decor top-left"></div>
    <div class="corner-decor top-right"></div>
    <div class="corner-decor bottom-left"></div>
    <div class="corner-decor bottom-right"></div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useGameStore } from '@/stores/gameStore';
import CommanderCard from '@/components/CommanderCard.vue';
import MapView from '@/components/views/MapView.vue';
import CommunicationView from '@/components/views/CommunicationView.vue';
import DecisionLogView from '@/components/views/DecisionLogView.vue';
import AnalyticsView from '@/components/views/AnalyticsView.vue';

const gameStore = useGameStore();
const startingGame = ref(false);

const viewModes: { id: 'map' | 'communication' | 'decisions' | 'analytics', label: string, icon: string }[] = [
  { id: 'map', label: 'Map', icon: '◉' },
  { id: 'communication', label: 'Comms', icon: '◈' },
  { id: 'decisions', label: 'Decisions', icon: '⚡' },
  { id: 'analytics', label: 'Analytics', icon: '◇' }
];

const startGame = async (): Promise<void> => {
    if (startingGame.value) return;
    
    startingGame.value = true;
    
    try {
        const response = await fetch('http://localhost:3002/api/game/start', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        if (!response.ok) {
            const error = await response.json();
            console.error('Failed to start game:', error);
            alert('Failed to start game: ' + (error.error || 'Unknown error'));
        } else {
            const result = await response.json();
            console.log('Game started successfully:', result);
        }
    } catch (error) {
        console.error('Error starting game:', error);
        alert('Error starting game. Make sure the game server is running.');
    } finally {
        startingGame.value = false;
    }
};
</script>

<style scoped>
.game-view {
  height: 100vh;
  display: flex;
  flex-direction: column;
  padding: 8px;
  gap: 8px;
  position: relative;
  overflow: hidden;
}

/* Scan line effect */
.scan-line {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: 2px;
  background: linear-gradient(90deg, transparent, var(--color-cyan), transparent);
  opacity: 0.3;
  animation: scan-line 8s linear infinite;
  pointer-events: none;
  z-index: 1000;
}

/* Corner decorations */
.corner-decor {
  position: fixed;
  width: 40px;
  height: 40px;
  border: 2px solid var(--glass-border);
  pointer-events: none;
  z-index: 100;
}

.corner-decor.top-left {
  top: 4px;
  left: 4px;
  border-right: none;
  border-bottom: none;
}

.corner-decor.top-right {
  top: 4px;
  right: 4px;
  border-left: none;
  border-bottom: none;
}

.corner-decor.bottom-left {
  bottom: 4px;
  left: 4px;
  border-right: none;
  border-top: none;
}

.corner-decor.bottom-right {
  bottom: 4px;
  right: 4px;
  border-left: none;
  border-top: none;
}

/* Top HUD */
.top-hud {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 16px;
  background: var(--glass-bg);
  backdrop-filter: var(--glass-blur);
  border: 1px solid var(--glass-border);
  border-radius: 8px;
  min-height: 48px;
}

.hud-left, .hud-right {
  flex: 1;
  display: flex;
  align-items: center;
}

.hud-right {
  justify-content: flex-end;
}

.hud-center {
  flex: 2;
  text-align: center;
}

.title-group h1 {
  font-family: var(--font-display);
  font-size: 1.1rem;
  font-weight: 700;
  letter-spacing: 4px;
  color: var(--color-cyan);
  text-shadow: 0 0 20px var(--color-cyan-glow);
  margin: 0;
}

.subtitle {
  font-family: var(--font-mono);
  font-size: 0.65rem;
  color: var(--color-text-secondary);
  letter-spacing: 2px;
}

.start-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 16px;
  font-family: var(--font-display);
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 1px;
  background: linear-gradient(135deg, var(--color-red) 0%, #ff6b6b 100%);
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.3s ease;
  box-shadow: 0 0 20px var(--color-red-glow);
}

.start-btn:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 0 30px var(--color-red-glow);
}

.start-btn:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}

.btn-icon {
  font-size: 1rem;
}

.game-active-indicator {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  font-family: var(--font-display);
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 2px;
  color: var(--color-success);
  background: var(--color-success-glow);
  border-radius: 4px;
}

.pulse-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--color-success);
  animation: activity-pulse 1s ease-in-out infinite;
}

.connection-badge {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px;
  font-family: var(--font-mono);
  font-size: 0.7rem;
  letter-spacing: 1px;
  color: var(--color-warning);
  background: rgba(245, 158, 11, 0.1);
  border: 1px solid rgba(245, 158, 11, 0.3);
  border-radius: 20px;
}

.connection-badge.connected {
  color: var(--color-success);
  background: rgba(16, 185, 129, 0.1);
  border-color: rgba(16, 185, 129, 0.3);
}

.conn-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
  animation: pulse-glow 2s ease-in-out infinite;
}

/* Stats Bar */
.stats-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 16px;
  background: var(--glass-bg);
  backdrop-filter: var(--glass-blur);
  border: 1px solid var(--glass-border);
  border-radius: 8px;
  min-height: 40px;
}

.stat-item {
  display: flex;
  align-items: center;
  gap: 6px;
}

.stat-icon {
  font-size: 0.8rem;
  color: var(--color-cyan);
}

.stat-label {
  font-family: var(--font-mono);
  font-size: 0.65rem;
  color: var(--color-text-secondary);
  letter-spacing: 1px;
}

.stat-value {
  font-family: var(--font-display);
  font-size: 0.85rem;
  font-weight: 700;
  color: var(--color-text-primary);
}

.stat-value.phase {
  color: var(--color-cyan);
  text-transform: uppercase;
}

.stat-value.actions {
  color: var(--color-success);
  text-shadow: 0 0 10px var(--color-success-glow);
}

.stat-value.winner.red {
  color: var(--color-red);
  text-shadow: 0 0 10px var(--color-red-glow);
}

.stat-value.winner.blue {
  color: var(--color-blue);
  text-shadow: 0 0 10px var(--color-blue-glow);
}

.red-stat .stat-icon,
.red-stat .stat-value {
  color: var(--color-red);
}

.blue-stat .stat-icon,
.blue-stat .stat-value {
  color: var(--color-blue);
}

.stat-divider {
  width: 1px;
  height: 20px;
  background: var(--glass-border);
}

.view-tabs-inline {
  display: flex;
  gap: 4px;
  margin-left: auto;
  padding-left: 12px;
  border-left: 1px solid var(--glass-border);
}

.tab-btn {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1rem;
  background: transparent;
  border: 1px solid var(--glass-border);
  border-radius: 6px;
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: all 0.2s ease;
}

.tab-btn:hover {
  background: var(--glass-bg);
  color: var(--color-cyan);
  border-color: var(--color-cyan);
}

.tab-btn.active {
  background: var(--color-cyan);
  color: var(--color-bg-primary);
  border-color: var(--color-cyan);
  box-shadow: 0 0 15px var(--color-cyan-glow);
}

/* Main Content */
.main-content {
  flex: 1;
  display: grid;
  grid-template-columns: 220px 1fr 220px;
  gap: 8px;
  min-height: 0;
}

/* Team Panels */
.team-panel {
  display: flex;
  flex-direction: column;
  background: var(--glass-bg);
  backdrop-filter: var(--glass-blur);
  border: 1px solid var(--glass-border);
  border-radius: 8px;
  overflow: hidden;
}

.red-panel {
  border-left: 3px solid var(--color-red);
  box-shadow: -5px 0 20px var(--color-red-subtle);
}

.blue-panel {
  border-right: 3px solid var(--color-blue);
  box-shadow: 5px 0 20px var(--color-blue-subtle);
}

.panel-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: rgba(0, 0, 0, 0.2);
  border-bottom: 1px solid var(--glass-border);
}

.team-indicator {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.team-indicator.red {
  background: var(--color-red);
  box-shadow: 0 0 10px var(--color-red-glow);
}

.team-indicator.blue {
  background: var(--color-blue);
  box-shadow: 0 0 10px var(--color-blue-glow);
}

.team-name {
  font-family: var(--font-display);
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 2px;
  color: var(--color-text-primary);
}

.team-count {
  margin-left: auto;
  padding: 2px 8px;
  font-family: var(--font-mono);
  font-size: 0.7rem;
  background: rgba(0, 0, 0, 0.3);
  border-radius: 10px;
  color: var(--color-text-secondary);
}

.commanders-grid {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  overflow-y: auto;
}

/* View Panel */
.view-panel {
  background: var(--glass-bg);
  backdrop-filter: var(--glass-blur);
  border: 1px solid var(--glass-border);
  border-radius: 8px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
</style>
