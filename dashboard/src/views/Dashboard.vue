<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { useAuthStore } from '../stores/auth';
import { useDashboardStore } from '../stores/dashboard';

// Stores
const authStore = useAuthStore();
const dashboardStore = useDashboardStore();

// Error handling
const showErrorSnackbar = ref(false);

// Computed properties from store
const stats = computed(() => dashboardStore.stats);
const recentActivity = computed(() => dashboardStore.recentActivity);
const systemOverview = computed(() => dashboardStore.systemOverview);
const isLoading = computed(() => dashboardStore.isLoading);
const errorMessage = computed(() => dashboardStore.error);

// Methods
const loadDashboardData = async (): Promise<void> => {
    try {
        await dashboardStore.refreshAllData();
    } catch (error) {
        console.error('Failed to load dashboard data:', error);
        showErrorSnackbar.value = true;
    }
};

const refreshData = async (): Promise<void> => {
    await loadDashboardData();
};

const clearError = (): void => {
    dashboardStore.clearError();
    showErrorSnackbar.value = false;
};

// Watch for error changes
watch(errorMessage, (newError) => {
    if (newError) {
        showErrorSnackbar.value = true;
    }
});

onMounted(async () => {
    // Load dashboard data
    await loadDashboardData();
});
</script>

<template>
    <v-container fluid class="pa-4">
        <v-row>
            <!-- Welcome Section -->
            <v-col cols="12">
                <v-card class="gradient-card mb-4">
                    <v-card-text class="pa-6">
                        <div class="d-flex align-center justify-space-between">
                            <div>
                                <h1 class="text-h4 text-white mb-2">
                                    Welcome back, {{ authStore.user?.firstName || 'User' }}!
                                </h1>
                                <p class="text-h6 text-white opacity-90">
                                    Here's an overview of your MXF Dashboard
                                </p>
                            </div>
                            <v-btn 
                                icon="mdi-refresh" 
                                color="white" 
                                variant="text"
                                :loading="isLoading"
                                @click="refreshData"
                            />
                        </div>
                    </v-card-text>
                </v-card>
            </v-col>
        </v-row>

        <!-- Loading State -->
        <div v-if="isLoading && !stats.totalChannels">
            <v-row>
                <v-col v-for="n in 4" :key="n" cols="12" sm="6" md="3">
                    <v-skeleton-loader type="card" />
                </v-col>
            </v-row>
        </div>

        <!-- Stats Cards -->
        <v-row v-else>
            <v-col cols="12" sm="6" md="3">
                <v-card class="stats-card" :loading="isLoading">
                    <v-card-text class="text-center">
                        <v-icon size="40" color="primary" class="mb-2">
                            mdi-forum
                        </v-icon>
                        <div class="text-h4 font-weight-bold">{{ stats.totalChannels }}</div>
                        <div class="text-body-1 text-grey">Total Channels</div>
                    </v-card-text>
                </v-card>
            </v-col>

            <v-col cols="12" sm="6" md="3">
                <v-card class="stats-card" :loading="isLoading">
                    <v-card-text class="text-center">
                        <v-icon size="40" color="success" class="mb-2">
                            mdi-robot
                        </v-icon>
                        <div class="text-h4 font-weight-bold">{{ stats.activeAgents }}</div>
                        <div class="text-body-1 text-grey">Active Agents</div>
                    </v-card-text>
                </v-card>
            </v-col>

            <v-col cols="12" sm="6" md="3">
                <v-card class="stats-card" :loading="isLoading">
                    <v-card-text class="text-center">
                        <v-icon size="40" color="warning" class="mb-2">
                            mdi-check-circle
                        </v-icon>
                        <div class="text-h4 font-weight-bold">{{ stats.completedTasks }}</div>
                        <div class="text-body-1 text-grey">Completed Tasks</div>
                    </v-card-text>
                </v-card>
            </v-col>

        </v-row>

        <v-row class="mt-4">
            <!-- Recent Activity -->
            <v-col cols="12" md="8">
                <v-card>
                    <v-card-title class="d-flex align-center">
                        <v-icon class="me-2">mdi-history</v-icon>
                        Recent Activity
                    </v-card-title>
                    <v-card-text>
                        <!-- Loading State -->
                        <div v-if="isLoading && !recentActivity.length">
                            <v-skeleton-loader v-for="n in 4" :key="n" type="list-item-two-line" class="mb-2" />
                        </div>
                        
                        <!-- No Data State -->
                        <div v-else-if="!recentActivity.length" class="text-center py-8">
                            <v-icon size="48" color="grey-lighten-1" class="mb-2">mdi-history</v-icon>
                            <div class="text-body-1 text-grey">No recent activity</div>
                        </div>
                        
                        <!-- Activity Timeline -->
                        <v-timeline v-else align="start" density="compact">
                            <v-timeline-item
                                v-for="activity in recentActivity"
                                :key="activity.id"
                                :dot-color="activity.color"
                                size="small"
                            >
                                <template #icon>
                                    <v-icon size="14">{{ activity.icon }}</v-icon>
                                </template>
                                <div>
                                    <div class="text-subtitle-2">{{ activity.title }}</div>
                                    <div class="text-caption text-grey">by {{ activity.agent }}</div>
                                    <div class="text-caption text-grey">{{ activity.timestamp }}</div>
                                </div>
                            </v-timeline-item>
                        </v-timeline>
                    </v-card-text>
                </v-card>
            </v-col>

            <!-- System Overview -->
            <v-col cols="12" md="4">
                <v-card height="400">
                    <v-card-title class="d-flex align-center">
                        <v-icon class="me-2">mdi-chart-pie</v-icon>
                        System Overview
                    </v-card-title>
                    <v-card-text>
                        <!-- Loading State -->
                        <div v-if="isLoading && !systemOverview.length" class="text-center py-8">
                            <v-skeleton-loader v-for="n in 3" :key="n" type="list-item" class="mb-4" />
                        </div>
                        
                        <!-- No Data State -->
                        <div v-else-if="!systemOverview.length" class="text-center py-8">
                            <v-icon size="48" color="grey-lighten-1" class="mb-2">mdi-chart-pie</v-icon>
                            <div class="text-body-1 text-grey">No system data available</div>
                        </div>
                        
                        <!-- Overview Chart -->
                        <div v-else class="chart-container">
                            <div 
                                v-for="item in systemOverview" 
                                :key="item.name"
                                class="chart-item mb-4"
                            >
                                <div class="d-flex align-center justify-space-between mb-1">
                                    <span class="text-subtitle-2">{{ item.name }}</span>
                                    <div class="d-flex align-center">
                                        <span class="font-weight-bold me-2">{{ item.value }}</span>
                                        <v-icon 
                                            v-if="item.trend" 
                                            :icon="item.trend === 'up' ? 'mdi-trending-up' : item.trend === 'down' ? 'mdi-trending-down' : 'mdi-trending-neutral'"
                                            :color="item.trend === 'up' ? 'success' : item.trend === 'down' ? 'error' : 'grey'"
                                            size="16"
                                        />
                                    </div>
                                </div>
                                <v-progress-linear
                                    :model-value="item.percentage || (item.value / 200) * 100"
                                    :color="item.color"
                                    height="8"
                                    rounded
                                />
                            </div>
                        </div>
                    </v-card-text>
                </v-card>
            </v-col>
        </v-row>

        <!-- Error Snackbar -->
        <v-snackbar
            v-model="showErrorSnackbar"
            color="error"
            timeout="6000"
            location="top"
        >
            {{ errorMessage }}
            <template #actions>
                <v-btn
                    color="white"
                    variant="text"
                    @click="clearError"
                >
                    Close
                </v-btn>
            </template>
        </v-snackbar>
    </v-container>
</template>

<style scoped>
.gradient-card {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    border-radius: 12px;
}

.stats-card {
    transition: all 0.3s ease;
    height: 140px;
    display: flex;
    align-items: center;
}

.stats-card:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 30px rgba(0, 0, 0, 0.12);
}

.chart-container {
    padding: 20px 0;
}

.chart-item {
    padding: 8px 0;
}

/* Loading and no-data states */
.py-8 {
    padding-top: 32px;
    padding-bottom: 32px;
}

/* Activity timeline styling */
.v-timeline {
    padding-left: 0;
}

/* Responsive adjustments */
@media (max-width: 768px) {
    .stats-card {
        height: auto;
        min-height: 120px;
    }
    
    .gradient-card .v-card-text {
        padding: 24px !important;
    }
    
    .d-flex.justify-space-between {
        flex-direction: column;
        gap: 16px;
    }
}
</style>
