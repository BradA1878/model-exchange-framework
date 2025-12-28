<template>
  <div class="comm-view">
    <!-- Header -->
    <div class="comm-header">
      <span class="comm-title">COMMUNICATIONS</span>
      <div class="channel-tabs">
        <button
          v-for="channel in channels"
          :key="channel.id"
          class="channel-btn"
          :class="{ active: activeChannel === channel.id }"
          @click="activeChannel = channel.id"
        >
          <span class="ch-icon">{{ channel.icon }}</span>
          <span class="ch-label">{{ channel.label }}</span>
        </button>
      </div>
    </div>

    <!-- Messages Stream -->
    <div class="messages-stream" ref="messagesContainer">
      <TransitionGroup name="message">
        <div
          v-for="message in filteredMessages"
          :key="message.id"
          class="message-item"
          :class="getMessageClass(message)"
        >
          <div class="msg-indicator" :class="getMessageClass(message)"></div>
          <div class="msg-content">
            <div class="msg-header">
              <span class="msg-sender">{{ getSenderName(message.senderId) }}</span>
              <span v-if="message.receiverId" class="msg-arrow">→</span>
              <span v-if="message.receiverId" class="msg-receiver">{{ getSenderName(message.receiverId) }}</span>
              <span class="msg-time">{{ formatTime(message.timestamp) }}</span>
            </div>
            <div class="msg-body">{{ message.content }}</div>
          </div>
        </div>
      </TransitionGroup>

      <div v-if="filteredMessages.length === 0" class="empty-state">
        <span class="empty-icon">◈</span>
        <span class="empty-text">Awaiting transmissions...</span>
      </div>
    </div>

    <!-- Status Bar -->
    <div class="status-bar">
      <span class="status-item">
        <span class="s-icon">◉</span>
        <span class="s-count">{{ gameStore.messages.length }}</span>
        <span class="s-label">TOTAL</span>
      </span>
      <span class="status-item">
        <span class="s-icon red">◆</span>
        <span class="s-count">{{ redMessageCount }}</span>
        <span class="s-label">RED</span>
      </span>
      <span class="status-item">
        <span class="s-icon blue">◆</span>
        <span class="s-count">{{ blueMessageCount }}</span>
        <span class="s-label">BLUE</span>
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { useGameStore } from '@/stores/gameStore'
import type { Message } from '@/types/game'

const gameStore = useGameStore()
const activeChannel = ref<'all' | 'red' | 'blue' | 'system'>('all')
const messagesContainer = ref<HTMLElement | null>(null)

const channels = [
  { id: 'all', label: 'ALL', icon: '◎' },
  { id: 'red', label: 'RED', icon: '◆' },
  { id: 'blue', label: 'BLUE', icon: '◆' },
  { id: 'system', label: 'SYS', icon: '◈' }
]

const filteredMessages = computed(() => {
  const messages = gameStore.recentMessages

  if (activeChannel.value === 'all') return messages
  if (activeChannel.value === 'system') return messages.filter(m => m.type === 'system')
  if (activeChannel.value === 'red') return messages.filter(m => m.type === 'team' && isRedCommander(m.senderId))
  if (activeChannel.value === 'blue') return messages.filter(m => m.type === 'team' && isBlueCommander(m.senderId))

  return messages
})

const redMessageCount = computed(() => 
  gameStore.messages.filter(m => m.type === 'team' && isRedCommander(m.senderId)).length
)

const blueMessageCount = computed(() => 
  gameStore.messages.filter(m => m.type === 'team' && isBlueCommander(m.senderId)).length
)

function getSenderName(agentId: string): string {
  if (agentId === 'system') return 'SYSTEM'
  const commander = gameStore.gameState?.commanders.find(c => c.agentId === agentId)
  return commander?.name?.toUpperCase() || agentId
}

function isRedCommander(agentId: string): boolean {
  const commander = gameStore.gameState?.commanders.find(c => c.agentId === agentId)
  return commander?.team === 'red'
}

function isBlueCommander(agentId: string): boolean {
  const commander = gameStore.gameState?.commanders.find(c => c.agentId === agentId)
  return commander?.team === 'blue'
}

function getMessageClass(message: Message): string {
  if (message.type === 'system') return 'system'
  if (isRedCommander(message.senderId)) return 'red'
  if (isBlueCommander(message.senderId)) return 'blue'
  return 'neutral'
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp)
  return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

// Auto-scroll to newest messages
watch(() => gameStore.messages.length, async () => {
  await nextTick()
  if (messagesContainer.value) {
    messagesContainer.value.scrollTop = 0
  }
})
</script>

<style scoped>
.comm-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 8px;
  gap: 8px;
}

/* Header */
.comm-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 12px;
  background: rgba(0, 0, 0, 0.3);
  border-radius: 6px;
  flex-shrink: 0;
}

.comm-title {
  font-family: var(--font-display);
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 2px;
  color: var(--color-cyan);
}

.channel-tabs {
  display: flex;
  gap: 4px;
}

.channel-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  background: transparent;
  border: 1px solid var(--glass-border);
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.channel-btn:hover {
  background: rgba(0, 212, 255, 0.1);
  border-color: var(--color-cyan);
}

.channel-btn.active {
  background: var(--color-cyan);
  border-color: var(--color-cyan);
}

.ch-icon {
  font-size: 0.7rem;
  color: var(--color-text-secondary);
}

.channel-btn.active .ch-icon {
  color: var(--color-bg-primary);
}

.ch-label {
  font-family: var(--font-mono);
  font-size: 0.6rem;
  color: var(--color-text-secondary);
}

.channel-btn.active .ch-label {
  color: var(--color-bg-primary);
}

/* Messages Stream */
.messages-stream {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  background: rgba(0, 0, 0, 0.2);
  border-radius: 6px;
}

.message-item {
  display: flex;
  gap: 8px;
  padding: 8px;
  background: rgba(15, 25, 45, 0.6);
  border-radius: 6px;
  animation: fade-in-up 0.2s ease;
}

.msg-indicator {
  width: 3px;
  border-radius: 2px;
  flex-shrink: 0;
  background: var(--color-neutral);
}

.msg-indicator.red { background: var(--color-red); box-shadow: 0 0 8px var(--color-red-glow); }
.msg-indicator.blue { background: var(--color-blue); box-shadow: 0 0 8px var(--color-blue-glow); }
.msg-indicator.system { background: var(--color-success); box-shadow: 0 0 8px var(--color-success-glow); }

.msg-content {
  flex: 1;
  min-width: 0;
}

.msg-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
}

.msg-sender {
  font-family: var(--font-display);
  font-size: 0.7rem;
  font-weight: 600;
  color: var(--color-text-primary);
}

.message-item.red .msg-sender { color: var(--color-red); }
.message-item.blue .msg-sender { color: var(--color-blue); }
.message-item.system .msg-sender { color: var(--color-success); }

.msg-arrow {
  color: var(--color-text-dim);
  font-size: 0.7rem;
}

.msg-receiver {
  font-family: var(--font-display);
  font-size: 0.7rem;
  color: var(--color-cyan);
}

.msg-time {
  margin-left: auto;
  font-family: var(--font-mono);
  font-size: 0.55rem;
  color: var(--color-text-dim);
}

.msg-body {
  font-size: 0.75rem;
  line-height: 1.4;
  color: var(--color-text-secondary);
  word-wrap: break-word;
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

/* Status Bar */
.status-bar {
  display: flex;
  justify-content: center;
  gap: 24px;
  padding: 6px 12px;
  background: rgba(0, 0, 0, 0.3);
  border-radius: 6px;
  flex-shrink: 0;
}

.status-item {
  display: flex;
  align-items: center;
  gap: 4px;
}

.s-icon {
  font-size: 0.6rem;
  color: var(--color-cyan);
}

.s-icon.red { color: var(--color-red); }
.s-icon.blue { color: var(--color-blue); }

.s-count {
  font-family: var(--font-display);
  font-size: 0.75rem;
  font-weight: 700;
  color: var(--color-text-primary);
}

.s-label {
  font-family: var(--font-mono);
  font-size: 0.55rem;
  color: var(--color-text-dim);
}

/* Transitions */
.message-enter-active {
  transition: all 0.3s ease;
}

.message-leave-active {
  transition: all 0.2s ease;
}

.message-enter-from {
  opacity: 0;
  transform: translateX(-20px);
}

.message-leave-to {
  opacity: 0;
  transform: translateX(20px);
}
</style>
