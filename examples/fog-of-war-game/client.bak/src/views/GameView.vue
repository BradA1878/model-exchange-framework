<template>
  <div class="game-view">
    <!-- Header -->
    <header class="header">
      <button 
        v-if="!gameStore.gameState?.gameStarted"
        class="start-game-button-compact" 
        @click="startGame"
        :disabled="startingGame"
        title="All 8 commanders are connected and ready. Click to begin!"
      >
        {{ startingGame ? '🚀 Starting...' : '🎮 Start Game' }}
      </button>
      
      <h1>🎮 Fog of War: Parallel Minds</h1>
      <div class="subtitle">Multi-Agent Strategy Game • Powered by MXF</div>
      <div class="connection-status" :class="{ connected: gameStore.connected }">
        <span class="status-dot"></span>
        {{ gameStore.connected ? 'Connected' : 'Disconnected' }}
      </div>
    </header>

    <!-- Control Bar -->
    <div class="control-bar">
      <div class="control-item">
        <div class="control-label">Turn</div>
        <div class="control-value">{{ gameStore.gameState?.turn || 0 }}</div>
      </div>
      <div class="control-item">
        <div class="control-label">Phase</div>
        <div class="control-value">{{ gameStore.gameState?.phase || 'waiting' }}</div>
      </div>
      <div class="control-item">
        <div class="control-label">Red Control</div>
        <div class="control-value text-red">
          {{ gameStore.gameState?.resourceControl.red.toFixed(1) || 0 }}%
        </div>
      </div>
      <div class="control-item">
        <div class="control-label">Blue Control</div>
        <div class="control-value text-blue">
          {{ gameStore.gameState?.resourceControl.blue.toFixed(1) || 0 }}%
        </div>
      </div>
      <div class="control-item">
        <div class="control-label">Winner</div>
        <div class="control-value">
          {{ gameStore.gameState?.winner || '-' }}
        </div>
      </div>
      <div class="control-item">
        <div class="control-label">Total Actions</div>
        <div class="control-value text-green">
          {{ gameStore.totalActions }}
        </div>
      </div>
    </div>

    <!-- View Mode Tabs -->
    <div class="view-tabs">
      <button
        v-for="mode in viewModes"
        :key="mode.id"
        class="tab-button"
        :class="{ active: gameStore.viewMode === mode.id }"
        @click="gameStore.setViewMode(mode.id)"
      >
        {{ mode.icon }} {{ mode.label }}
      </button>
      <!-- <button class="tab-button" @click="gameStore.toggleSpectatorMode()">
        {{ gameStore.spectatorMode ? '👁️ Spectator' : '🎯 Commander' }}
      </button> -->
    </div>

    <!-- Main Content Area -->
    <div class="main-content">
      <!-- Left Sidebar - Red Team -->
      <aside class="sidebar sidebar-red">
        <h2>🔴 Red Alliance</h2>
        <CommanderCard
          v-for="commander in gameStore.redCommanders"
          :key="commander.id"
          :commander="commander"
          :selected="gameStore.selectedCommander === commander.id"
          @select="gameStore.selectCommander(commander.id)"
        />
      </aside>

      <!-- Center - View Content -->
      <main class="view-content">
        <MapView v-if="gameStore.viewMode === 'map'" />
        <CommunicationView v-else-if="gameStore.viewMode === 'communication'" />
        <DecisionLogView v-else-if="gameStore.viewMode === 'decisions'" />
        <AnalyticsView v-else-if="gameStore.viewMode === 'analytics'" />
      </main>

      <!-- Right Sidebar - Blue Team -->
      <aside class="sidebar sidebar-blue">
        <h2>🔵 Blue Coalition</h2>
        <CommanderCard
          v-for="commander in gameStore.blueCommanders"
          :key="commander.id"
          :commander="commander"
          :selected="gameStore.selectedCommander === commander.id"
          @select="gameStore.selectCommander(commander.id)"
        />
      </aside>
    </div>
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
  { id: 'map', label: 'Map', icon: '🗺️' },
  { id: 'communication', label: 'Comms', icon: '💬' },
  { id: 'decisions', label: 'Decisions', icon: '⚡' },
  { id: 'analytics', label: 'Analytics', icon: '📊' }
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
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  padding: 20px;
  gap: 20px;
}

.header {
  position: relative;
  text-align: center;
  background: var(--color-bg-secondary);
  padding: 12px 20px;
  border-radius: 8px;
}

.header h1 {
  font-size: 1.5em;
  margin-bottom: 4px;
}

.subtitle {
  font-size: 0.9em;
  color: var(--color-text-secondary);
}

.connection-status {
  position: absolute;
  top: 20px;
  right: 20px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  background: var(--color-bg-tertiary);
  border-radius: 20px;
  font-size: 0.9em;
  color: var(--color-warning);
}

.connection-status.connected {
  color: var(--color-success);
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: currentColor;
  animation: pulse 2s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

.start-game-button-compact {
  position: absolute;
  left: 20px;
  top: 50%;
  transform: translateY(-50%);
  padding: 8px 16px;
  font-size: 0.9em;
  font-weight: bold;
  background: linear-gradient(135deg, #ff6b6b 0%, #ee5a6f 100%);
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s ease;
  box-shadow: 0 2px 8px rgba(255, 107, 107, 0.3);
  z-index: 10;
}

.start-game-button-compact:hover:not(:disabled) {
  transform: translateY(-50%) translateY(-2px);
  box-shadow: 0 4px 12px rgba(255, 107, 107, 0.5);
  background: linear-gradient(135deg, #ff5252 0%, #ff4757 100%);
}

.start-game-button-compact:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.control-bar {
  display: flex;
  justify-content: space-around;
  background: var(--color-bg-secondary);
  padding: 8px 16px;
  border-radius: 8px;
}

.control-item {
  text-align: center;
}

.control-label {
  font-size: 0.75em;
  color: var(--color-text-secondary);
  margin-bottom: 4px;
}

.control-value {
  font-size: 1.2em;
  font-weight: bold;
}

.view-tabs {
  display: flex;
  gap: 8px;
  background: var(--color-bg-secondary);
  padding: 12px;
  border-radius: 12px;
}

.tab-button {
  flex: 1;
  padding: 12px 20px;
  background: var(--color-bg-tertiary);
  border: none;
  border-radius: 8px;
  color: var(--color-text-primary);
  font-size: 1em;
  cursor: pointer;
  transition: all 0.2s;
}

.tab-button:hover {
  background: var(--color-border);
}

.tab-button.active {
  background: var(--color-blue);
  color: white;
}

.main-content {
  display: grid;
  grid-template-columns: 300px 1fr 300px;
  gap: 20px;
  flex: 1;
}

.sidebar {
  background: var(--color-bg-secondary);
  padding: 12px;
  border-radius: 12px;
  overflow-y: auto;
  max-height: calc(100vh - 220px);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.sidebar h2 {
  margin-bottom: 8px;
  padding-bottom: 8px;
  border-bottom: 2px solid var(--color-border);
  font-size: 1.1em;
}

.sidebar-red {
  border-left: 4px solid var(--color-red);
}

.sidebar-blue {
  border-left: 4px solid var(--color-blue);
}

.view-content {
  background: var(--color-bg-secondary);
  padding: 20px;
  border-radius: 12px;
  overflow: auto;
  max-height: calc(100vh - 240px);
}

.text-red {
  color: var(--color-red);
}

.text-blue {
  color: var(--color-blue);
}

.text-green {
  color: var(--color-success);
}
</style>
