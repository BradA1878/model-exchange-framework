<template>
  <div id="app">
    <router-view />
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import { useGameStore } from '@/stores/gameStore'

const gameStore = useGameStore()

onMounted(() => {
  gameStore.connect()
})

onUnmounted(() => {
  gameStore.disconnect()
})
</script>

<style scoped>
#app {
  width: 100%;
  min-height: 100vh;
}
</style>
