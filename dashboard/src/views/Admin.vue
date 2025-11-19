<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAdminStore } from '../stores/admin';

const route = useRoute();
const router = useRouter();
const adminStore = useAdminStore();

// Tab navigation for admin sections
const tabs = [
    { name: 'Users', route: 'users', icon: 'mdi-account-multiple' },
    { name: 'Channels', route: 'channels', icon: 'mdi-forum' },
    { name: 'Agents', route: 'agents', icon: 'mdi-robot' },
    { name: 'MCP Tools', route: 'mcptools', icon: 'mdi-tools' },
    { name: 'Tool Executions', route: 'executions', icon: 'mdi-play-circle' },
    { name: 'Task Analytics', route: 'tasks', icon: 'mdi-chart-line' },
    { name: 'Audit Logs', route: 'auditlogs', icon: 'mdi-shield-search' },
    { name: 'Security', route: 'security', icon: 'mdi-security' },
    { name: 'System Health', route: 'system', icon: 'mdi-monitor-dashboard' }
];

// Local reactive state for active tab
const activeTab = ref('Users');

// Computed properties
const stats = computed(() => adminStore.stats);
const userStats = computed(() => adminStore.userStats);

// Tab navigation method
const navigateToTab = (tabRoute: string): void => {
    const path = `/dashboard/admin/${tabRoute}`;
    const tabName = tabs.find(tab => tab.route === tabRoute)?.name || 'Users';
    activeTab.value = tabName;
    router.push(path);
};

// Watch route changes to update active tab
watch(() => route.path, (newPath) => {
    const pathSegments = newPath.split('/').filter(Boolean);
    const lastSegment = pathSegments[pathSegments.length - 1];
    const matchedTab = tabs.find(tab => tab.route === lastSegment);
    if (matchedTab) {
        activeTab.value = matchedTab.name;
    }
}, { immediate: true });

// Initialize data on mount
onMounted(async () => {
    // Wait a bit to ensure user authentication is fully loaded
    await new Promise(resolve => setTimeout(resolve, 100));
    
    try {
        // Load initial admin data (users will be loaded by the Users tab component)
        await Promise.all([
            adminStore.fetchAdminStats(),
            adminStore.fetchSystemHealth()
        ]);
    } catch (error) {
        console.error('Error loading admin data:', error);
    }
});

// Refresh data periodically for real-time updates
const refreshInterval = ref<number | null>(null);

onMounted(() => {
    // Refresh every 30 seconds
    refreshInterval.value = setInterval(async () => {
        await Promise.all([
            adminStore.fetchAdminStats(),
            adminStore.fetchSystemHealth()
        ]);
    }, 30000);
});

// Cleanup on unmount
watch(() => route.path, (newPath) => {
    if (!newPath.startsWith('/dashboard/admin') && refreshInterval.value) {
        clearInterval(refreshInterval.value);
        refreshInterval.value = null;
    }
});
</script>

<template>
    <div class="admin-page">
        <!-- Page Header -->
        <div class="page-header mb-6">
            <div class="d-flex align-center justify-space-between">
                <div>
                    <h1 class="text-h3 mb-2">
                        <v-icon class="mr-3" size="32">mdi-shield-crown</v-icon>
                        Administration
                    </h1>
                    <p class="text-h6 text-medium-emphasis">
                        System management and user administration
                    </p>
                </div>

                <!-- Quick Stats Cards -->
                <div class="d-flex gap-4">
                    <v-card class="pa-3" elevation="1" min-width="120">
                        <div class="text-center">
                            <v-icon color="primary" size="24" class="mb-1">mdi-account-multiple</v-icon>
                            <div class="text-h6">{{ userStats.total }}</div>
                            <div class="text-caption text-medium-emphasis">Users</div>
                        </div>
                    </v-card>
                    <v-card class="pa-3" elevation="1" min-width="120">
                        <div class="text-center">
                            <v-icon color="success" size="24" class="mb-1">mdi-forum</v-icon>
                            <div class="text-h6">{{ stats.totalChannels }}</div>
                            <div class="text-caption text-medium-emphasis">Channels</div>
                        </div>
                    </v-card>
                    <v-card class="pa-3" elevation="1" min-width="120">
                        <div class="text-center">
                            <v-icon color="info" size="24" class="mb-1">mdi-robot</v-icon>
                            <div class="text-h6">{{ stats.totalAgents }}</div>
                            <div class="text-caption text-medium-emphasis">Agents</div>
                        </div>
                    </v-card>
                    <v-card class="pa-3" elevation="1" min-width="120">
                        <div class="text-center">
                            <v-icon color="warning" size="24" class="mb-1">mdi-tools</v-icon>
                            <div class="text-h6">{{ stats.mcpToolsCount || 0 }}</div>
                            <div class="text-caption text-medium-emphasis">MCP Tools</div>
                        </div>
                    </v-card>
                    <v-card class="pa-3" elevation="1" min-width="120">
                        <div class="text-center">
                            <v-icon color="orange" size="24" class="mb-1">mdi-clipboard-list</v-icon>
                            <div class="text-h6">{{ stats.totalTasks || 0 }}</div>
                            <div class="text-caption text-medium-emphasis">Tasks</div>
                        </div>
                    </v-card>
                </div>
            </div>
        </div>

        <!-- Tab Navigation -->
        <v-card elevation="0" class="mb-6">
            <v-tabs v-model="activeTab" class="admin-tabs">
                <v-tab
                    v-for="tab in tabs"
                    :key="tab.route"
                    :value="tab.name"
                    @click="navigateToTab(tab.route)"
                    class="text-none"
                >
                    <v-icon class="mr-2">{{ tab.icon }}</v-icon>
                    {{ tab.name }}
                </v-tab>
            </v-tabs>
        </v-card>

        <!-- Router View for Admin Tabs -->
        <router-view />
    </div>
</template>

<style scoped>
.admin-page {
    max-width: 1400px;
    margin: 0 auto;
    padding: 0 1rem;
}

.page-header {
    padding: 2rem 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.12);
}

.admin-tabs {
    background: var(--v-theme-card-bg);
    border-radius: 8px;
}

.admin-tabs :deep(.v-tab) {
    min-height: 56px;
}

.gap-4 {
    gap: 1rem;
}
</style>
