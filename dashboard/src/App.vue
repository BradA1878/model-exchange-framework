<script setup lang="ts">
import { onMounted } from 'vue';
import { useAuthStore } from './stores/auth';

const authStore = useAuthStore();

onMounted(async () => {
    console.log('🏠 App.vue onMounted called');
    // Check for existing authentication token on app startup
    await authStore.checkAuth();
    console.log('🏠 App.vue checkAuth completed');
});
</script>

<template>
    <v-app>
        <router-view />
    </v-app>
</template>

<style scoped>
/* Global app styles */
.v-application {
    font-family: 'Inter', sans-serif !important;
}
</style>
