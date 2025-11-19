<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useAnalyticsStore } from '@/stores/analytics';
import { useChannelsStore } from '@/stores/channels';

// Stores
const analyticsStore = useAnalyticsStore();
const channelsStore = useChannelsStore();
const router = useRouter();

// Tab state
const currentTab = ref('data');

// Computed properties from store
const analyticsStats = computed(() => analyticsStore.stats);
const isLoading = computed(() => analyticsStore.isLoading);
const hasError = computed(() => !!analyticsStore.error);

// Methods
const navigateToSubView = (view: 'data' | 'charts'): void => {
    router.push(`/dashboard/analytics/${view}`);
};

const loadAnalyticsData = async (): Promise<void> => {
    try {
        // Load all analytics data with current time range
        await analyticsStore.refreshAllData();
    } catch (error) {
        console.error('Failed to load analytics data:', error);
    }
};

const refreshData = async (): Promise<void> => {
    await loadAnalyticsData();
};

const exportAnalytics = async (): Promise<void> => {
    try {
        await analyticsStore.exportData('events');
    } catch (error) {
        console.error('Failed to export analytics:', error);
    }
};

const clearError = (): void => {
    analyticsStore.clearError();
};

onMounted(async () => {
    await loadAnalyticsData();
});
</script>

<template>
    <div class="analytics-page">
        <!-- Page Header -->
        <div class="page-header mb-8">
            <v-row align="center">
                <v-col>
                    <h1 class="text-h3 mb-2">Analytics</h1>
                    <p class="text-h6 text-medium-emphasis">
                        Monitor your MXF system performance and usage patterns.
                    </p>
                </v-col>
                <v-col cols="auto">
                    <v-btn
                        variant="outlined"
                        color="primary"
                        prepend-icon="mdi-download"
                        @click="exportAnalytics"
                    >
                        Export Report
                    </v-btn>
                </v-col>
            </v-row>
        </div>

        <!-- Summary Stats -->
        <v-row class="mb-8">
            <v-col cols="12" sm="6" lg="3">
                <v-card class="stats-card" elevation="0">
                    <v-card-text>
                        <div class="d-flex align-center">
                            <div class="flex-grow-1">
                                <p class="text-body-2 text-medium-emphasis mb-1">
                                    Total Events
                                </p>
                                <h3 class="text-h4" v-if="!isLoading">{{ analyticsStats.totalEvents.toLocaleString() }}</h3>
                                <v-skeleton-loader v-else type="text" width="40" />
                            </div>
                            <v-icon size="40" color="primary" class="ml-3">
                                mdi-pulse
                            </v-icon>
                        </div>
                    </v-card-text>
                </v-card>
            </v-col>

            <v-col cols="12" sm="6" lg="3">
                <v-card class="stats-card" elevation="0">
                    <v-card-text>
                        <div class="d-flex align-center">
                            <div class="flex-grow-1">
                                <p class="text-body-2 text-medium-emphasis mb-1">
                                    Active Channels
                                </p>
                                <h3 class="text-h4" v-if="!isLoading">{{ analyticsStats.activeChannels }}</h3>
                                <v-skeleton-loader v-else type="text" width="40" />
                            </div>
                            <v-icon size="40" color="success" class="ml-3">
                                mdi-forum
                            </v-icon>
                        </div>
                    </v-card-text>
                </v-card>
            </v-col>

            <v-col cols="12" sm="6" lg="3">
                <v-card class="stats-card" elevation="0">
                    <v-card-text>
                        <div class="d-flex align-center">
                            <div class="flex-grow-1">
                                <p class="text-body-2 text-medium-emphasis mb-1">
                                    Avg Response Time
                                </p>
                                <h3 class="text-h4" v-if="!isLoading">{{ analyticsStats.avgResponseTime }}s</h3>
                                <v-skeleton-loader v-else type="text" width="40" />
                            </div>
                            <v-icon size="40" color="info" class="ml-3">
                                mdi-timer
                            </v-icon>
                        </div>
                    </v-card-text>
                </v-card>
            </v-col>

            <v-col cols="12" sm="6" lg="3">
                <v-card class="stats-card" elevation="0">
                    <v-card-text>
                        <div class="d-flex align-center">
                            <div class="flex-grow-1">
                                <p class="text-body-2 text-medium-emphasis mb-1">
                                    Success Rate
                                </p>
                                <h3 class="text-h4" v-if="!isLoading">{{ analyticsStats.successRate }}%</h3>
                                <v-skeleton-loader v-else type="text" width="40" />
                            </div>
                            <v-icon size="40" color="success" class="ml-3">
                                mdi-check-circle
                            </v-icon>
                        </div>
                    </v-card-text>
                </v-card>
            </v-col>
        </v-row>

        <!-- Navigation Tabs -->
        <v-card class="analytics-nav-card mb-6" elevation="0">
            <v-tabs v-model="currentTab" bg-color="transparent">
                <v-tab value="data" @click="navigateToSubView('data')">
                    <v-icon class="mr-2">mdi-database</v-icon>
                    Data View
                </v-tab>
                <v-tab value="charts" @click="navigateToSubView('charts')">
                    <v-icon class="mr-2">mdi-chart-line</v-icon>
                    Charts & Visualizations
                </v-tab>
            </v-tabs>
        </v-card>

        <!-- Sub-route content -->
        <router-view />

        <!-- Default content when no sub-route is active -->
        <div v-if="$route.path === '/dashboard/analytics'" class="analytics-overview">
            <v-row>
                <v-col cols="12" md="6">
                    <v-card class="overview-card" elevation="0">
                        <v-card-title>
                            <div class="d-flex align-center">
                                <v-icon class="mr-2">mdi-database-eye</v-icon>
                                Data Analytics
                            </div>
                        </v-card-title>
                        <v-card-text>
                            <p class="text-body-1 mb-4">
                                View detailed data tables, filter records, and analyze your system's data patterns.
                            </p>
                            <ul class="feature-list">
                                <li>Real-time data tables</li>
                                <li>Advanced filtering options</li>
                                <li>Export capabilities</li>
                                <li>Data trend analysis</li>
                            </ul>
                        </v-card-text>
                        <v-card-actions>
                            <v-btn
                                color="primary"
                                variant="tonal"
                                @click="navigateToSubView('data')"
                            >
                                View Data
                            </v-btn>
                        </v-card-actions>
                    </v-card>
                </v-col>

                <v-col cols="12" md="6">
                    <v-card class="overview-card" elevation="0">
                        <v-card-title>
                            <div class="d-flex align-center">
                                <v-icon class="mr-2">mdi-chart-multiple</v-icon>
                                Charts & Visualizations
                            </div>
                        </v-card-title>
                        <v-card-text>
                            <p class="text-body-1 mb-4">
                                Interactive charts and visual representations of your system metrics and performance.
                            </p>
                            <ul class="feature-list">
                                <li>Performance metrics charts</li>
                                <li>Usage pattern visualization</li>
                                <li>Real-time monitoring</li>
                                <li>Custom dashboard widgets</li>
                            </ul>
                        </v-card-text>
                        <v-card-actions>
                            <v-btn
                                color="primary"
                                variant="tonal"
                                @click="navigateToSubView('charts')"
                            >
                                View Charts
                            </v-btn>
                        </v-card-actions>
                    </v-card>
                </v-col>
            </v-row>
        </div>
    </div>
</template>

<style scoped>
.analytics-page {
    max-width: 1400px;
    margin: 0 auto;
}

.page-header {
    padding: 2rem 0;
}

.stats-card {
    background: var(--v-theme-card-bg);
    border: 1px solid rgba(255, 255, 255, 0.1);
    transition: all 0.2s ease;
}

.stats-card:hover {
    border-color: rgba(99, 102, 241, 0.3);
    transform: translateY(-2px);
}

.analytics-nav-card {
    background: var(--v-theme-card-bg);
    border: 1px solid rgba(255, 255, 255, 0.1);
}

.overview-card {
    background: var(--v-theme-card-bg);
    border: 1px solid rgba(255, 255, 255, 0.1);
    height: 100%;
}

.feature-list {
    list-style: none;
    padding: 0;
}

.feature-list li {
    padding: 0.25rem 0;
    position: relative;
    padding-left: 1.5rem;
}

.feature-list li::before {
    content: '•';
    color: rgb(var(--v-theme-primary));
    position: absolute;
    left: 0;
    font-weight: bold;
}
</style>
