<script setup lang="ts">
import { ref, computed, onMounted, watch, onUnmounted } from 'vue';
import { useAnalyticsStore } from '@/stores/analytics';
import { useAgentsStore } from '@/stores/agents';
import ValidationMetrics from '@/components/analytics/ValidationMetrics.vue';
import TaskEffectiveness from '@/components/analytics/TaskEffectiveness.vue';

// Store
const analyticsStore = useAnalyticsStore();
const agentsStore = useAgentsStore();

// Loading states from store
const loading = computed(() => analyticsStore.loadingCharts);
const hasError = computed(() => !!analyticsStore.error);

// Chart data from store
const performanceData = computed(() => analyticsStore.performanceData);
const channelActivity = computed(() => analyticsStore.channelActivity);
const agentMetrics = computed(() => analyticsStore.agentMetrics);

// Error handling
const showErrorSnackbar = ref(false);
const errorMessage = computed(() => analyticsStore.error);

// Time range for filtering
const timeRange = ref('24h');
const timeRangeOptions = [
    { value: '1h', title: 'Last Hour' },
    { value: '24h', title: 'Last 24 Hours' },
    { value: '7d', title: 'Last 7 Days' },
    { value: '30d', title: 'Last 30 Days' },
    { value: '90d', title: 'Last 90 Days' }
];

// Selected agent/channel for validation metrics
const selectedAgentId = ref<string>('');
const selectedChannelId = ref<string>('');
const showValidationMetrics = ref(false);

// Get available agents and channels
const availableAgents = computed(() => agentsStore.agents || []);
const availableChannels = computed(() => {
    // Get unique channels from agents
    const channels = new Set<string>();
    availableAgents.value.forEach(agent => {
        if (agent.channelId) {
            channels.add(agent.channelId);
        }
    });
    return Array.from(channels);
});

// Chart refresh interval  
const autoRefresh = ref(true);
const refreshInterval = ref<number | null>(null);

// Methods
const loadChartData = async (): Promise<void> => {
    try {
        // Load performance data
        await analyticsStore.fetchPerformanceData(timeRange.value);
        
        // Load channel activity
        await analyticsStore.fetchChannelActivity(timeRange.value);
        
        // Load agent metrics
        await analyticsStore.fetchAgentMetrics(timeRange.value);
    } catch (error) {
        console.error('Failed to load chart data:', error);
        showErrorSnackbar.value = true;
    }
};

const refreshCharts = async (): Promise<void> => {
    await loadChartData();
};

const toggleAutoRefresh = (): void => {
    if (autoRefresh.value) {
        startAutoRefresh();
    } else {
        stopAutoRefresh();
    }
};

const startAutoRefresh = (): void => {
    if (refreshInterval.value) {
        clearInterval(refreshInterval.value);
    }
    refreshInterval.value = setInterval(() => {
        loadChartData();
    }, 30000); // Refresh every 30 seconds
};

const stopAutoRefresh = (): void => {
    if (refreshInterval.value) {
        clearInterval(refreshInterval.value);
        refreshInterval.value = null;
    }
};

const clearError = (): void => {
    analyticsStore.clearError();
    showErrorSnackbar.value = false;
};

const exportChart = async (chartName: string): Promise<void> => {
    try {
        // Map chart names to export types
        let exportType: 'events' | 'performance' | 'channels' | 'agents';
        
        switch (chartName) {
            case 'performance':
                exportType = 'performance';
                break;
            case 'channels':
            case 'channel-activity':
                exportType = 'channels';
                break;
            case 'agents':
            case 'agent-metrics':
                exportType = 'agents';
                break;
            default:
                exportType = 'performance';
        }
        
        await analyticsStore.exportData(exportType);
    } catch (error) {
        console.error(`Failed to export ${chartName}:`, error);
        showErrorSnackbar.value = true;
    }
};

// Watch for time range changes to reload data
watch(timeRange, async (newRange) => {
    await loadChartData();
});

// Watch for auto refresh toggle
watch(autoRefresh, (newValue) => {
    toggleAutoRefresh();
});

// Watch for error changes
watch(errorMessage, (newError) => {
    if (newError) {
        showErrorSnackbar.value = true;
    }
});

onMounted(async () => {
    // Load initial chart data
    await loadChartData();
    
    // Load agents for validation metrics
    await agentsStore.fetchAgents();
    
    // Start auto refresh if enabled
    if (autoRefresh.value) {
        startAutoRefresh();
    }
});

onUnmounted(() => {
    // Clean up auto refresh interval
    stopAutoRefresh();
});
</script>

<template>
    <div class="charts-analytics">
        <!-- Controls Section -->
        <div class="controls-section mb-6">
            <v-row align="center">
                <v-col>
                    <v-chip-group v-model="timeRange" color="primary" mandatory>
                        <v-chip
                            v-for="option in timeRangeOptions"
                            :key="option.value"
                            :value="option.value"
                            filter
                        >
                            {{ option.title }}
                        </v-chip>
                    </v-chip-group>
                </v-col>
                <v-col cols="auto">
                    <v-btn
                        variant="outlined"
                        prepend-icon="mdi-refresh" 
                        :loading="loading"
                        @click="refreshCharts"
                    >
                        Refresh
                    </v-btn>
                </v-col>
            </v-row>
        </div>

        <!-- Performance Chart -->
        <v-card class="chart-card mb-6" elevation="0">
            <v-card-title>
                <div class="d-flex align-center justify-space-between w-100">
                    <div class="d-flex align-center">
                        <v-icon class="mr-2">mdi-chart-line</v-icon>
                        System Performance
                    </div>
                    <v-btn
                        icon="mdi-download"
                        size="small"
                        variant="text"
                        @click="exportChart('performance')"
                    />
                </div>
            </v-card-title>
            <v-card-text>
                <div class="chart-container performance-chart">
                    <div v-if="loading" class="chart-loading">
                        <v-progress-circular indeterminate color="primary" />
                        <p class="text-body-2 mt-3">Loading performance data...</p>
                    </div>
                    <div v-else class="empty-chart-state">
                        <!-- No data state -->
                        <div class="text-center py-8">
                            <v-icon size="64" color="grey-darken-2" class="mb-4">
                                mdi-chart-line-variant
                            </v-icon>
                            <h3 class="text-h6 text-grey-darken-1 mb-2">
                                No Performance Data Available
                            </h3>
                            <p class="text-body-2 text-grey-darken-2">
                                Performance metrics will appear here when data is collected.
                            </p>
                            <p class="text-caption text-grey-darken-3 mt-2">
                                Time Range: {{ timeRangeOptions.find(opt => opt.value === timeRange)?.title }}
                            </p>
                        </div>
                    </div>
                </div>
            </v-card-text>
        </v-card>

        <!-- Channel Activity & Agent Metrics Row -->
        <v-row>
            <!-- Channel Activity Chart -->
            <v-col cols="12" lg="6">
                <v-card class="chart-card" elevation="0">
                    <v-card-title>
                        <div class="d-flex align-center justify-space-between w-100">
                            <div class="d-flex align-center">
                                <v-icon class="mr-2">mdi-chart-donut</v-icon>
                                Channel Activity
                            </div>
                            <v-btn
                                icon="mdi-download"
                                size="small"
                                variant="text"
                                @click="exportChart('channel-activity')"
                            />
                        </div>
                    </v-card-title>
                    <v-card-text>
                        <div class="channel-chart">
                            <div v-if="loading" class="chart-loading">
                                <v-progress-circular indeterminate color="primary" />
                            </div>
                            <div v-else>
                                <div
                                    v-for="channel in channelActivity"
                                    :key="channel.name"
                                    class="channel-item mb-3"
                                >
                                    <div class="d-flex align-center mb-2">
                                        <div
                                            class="channel-color-dot mr-2"
                                            :style="{ backgroundColor: channel.color }"
                                        />
                                        <span class="text-body-2 flex-grow-1">{{ channel.name }}</span>
                                        <span class="text-h6">{{ channel.value }}%</span>
                                    </div>
                                    <v-progress-linear
                                        :model-value="channel.value"
                                        :color="channel.color"
                                        height="6"
                                        rounded
                                    />
                                </div>
                            </div>
                        </div>
                    </v-card-text>
                </v-card>
            </v-col>

            <!-- Agent Performance Table -->
            <v-col cols="12" lg="6">
                <v-card class="chart-card" elevation="0">
                    <v-card-title>
                        <div class="d-flex align-center justify-space-between w-100">
                            <div class="d-flex align-center">
                                <v-icon class="mr-2">mdi-robot</v-icon>
                                Agent Performance
                            </div>
                            <v-btn
                                icon="mdi-download"
                                size="small"
                                variant="text"
                                @click="exportChart('agent-performance')"
                            />
                        </div>
                    </v-card-title>
                    <v-card-text>
                        <div class="agent-metrics">
                            <div v-if="loading" class="chart-loading">
                                <v-progress-circular indeterminate color="primary" />
                            </div>
                            <div v-else>
                                <div class="metrics-header mb-3">
                                    <v-row class="text-body-2 text-medium-emphasis">
                                        <v-col cols="5">Agent</v-col>
                                        <v-col cols="2">Tasks</v-col>
                                        <v-col cols="3">Success</v-col>
                                        <v-col cols="2">Avg Time</v-col>
                                    </v-row>
                                </div>
                                <div
                                    v-for="metric in agentMetrics"
                                    :key="metric.agent"
                                    class="metric-row mb-2 pa-2"
                                >
                                    <v-row align="center">
                                        <v-col cols="5">
                                            <div class="d-flex align-center">
                                                <v-avatar size="24" color="primary" class="mr-2">
                                                    <v-icon size="12">mdi-robot</v-icon>
                                                </v-avatar>
                                                <span class="text-body-2">{{ metric.agent }}</span>
                                            </div>
                                        </v-col>
                                        <v-col cols="2">
                                            <span class="text-body-2">{{ metric.tasks }}</span>
                                        </v-col>
                                        <v-col cols="3">
                                            <v-chip
                                                :color="metric.success > 98 ? 'success' : metric.success > 95 ? 'warning' : 'error'"
                                                size="small"
                                                variant="tonal"
                                            >
                                                {{ metric.success }}%
                                            </v-chip>
                                        </v-col>
                                        <v-col cols="2">
                                            <span class="text-body-2 text-mono">{{ metric.avgTime }}s</span>
                                        </v-col>
                                    </v-row>
                                </div>
                            </div>
                        </div>
                    </v-card-text>
                </v-card>
            </v-col>
        </v-row>

        <!-- Validation Metrics Section -->
        <v-card class="chart-card mt-6" elevation="0">
            <v-card-title>
                <div class="d-flex align-center justify-space-between w-100">
                    <div class="d-flex align-center">
                        <v-icon class="mr-2">mdi-shield-check</v-icon>
                        Validation Performance
                    </div>
                    <v-btn
                        v-if="showValidationMetrics"
                        icon="mdi-download"
                        size="small"
                        variant="text"
                        @click="exportChart('validation')"
                    />
                </div>
            </v-card-title>
            <v-card-text>
                <!-- Agent/Channel Selector -->
                <v-row v-if="!showValidationMetrics" class="mb-4">
                    <v-col cols="12" md="5">
                        <v-select
                            v-model="selectedAgentId"
                            :items="availableAgents"
                            item-title="name"
                            item-value="id"
                            label="Select Agent"
                            variant="outlined"
                            density="compact"
                            clearable
                        >
                            <template v-slot:prepend-inner>
                                <v-icon size="small">mdi-robot</v-icon>
                            </template>
                        </v-select>
                    </v-col>
                    <v-col cols="12" md="5">
                        <v-select
                            v-model="selectedChannelId"
                            :items="availableChannels"
                            label="Select Channel"
                            variant="outlined"
                            density="compact"
                            clearable
                        >
                            <template v-slot:prepend-inner>
                                <v-icon size="small">mdi-forum</v-icon>
                            </template>
                        </v-select>
                    </v-col>
                    <v-col cols="12" md="2">
                        <v-btn
                            color="primary"
                            variant="tonal"
                            block
                            :disabled="!selectedAgentId || !selectedChannelId"
                            @click="showValidationMetrics = true"
                        >
                            View Metrics
                        </v-btn>
                    </v-col>
                </v-row>

                <!-- Validation Metrics Component -->
                <ValidationMetrics
                    v-if="showValidationMetrics"
                    :agent-id="selectedAgentId"
                    :channel-id="selectedChannelId"
                />
                
                <!-- Empty State -->
                <div v-if="!showValidationMetrics" class="text-center py-8">
                    <v-icon size="64" color="grey-darken-2" class="mb-4">
                        mdi-shield-off
                    </v-icon>
                    <h3 class="text-h6 text-grey-darken-1 mb-2">
                        No Agent Selected
                    </h3>
                    <p class="text-body-2 text-grey-darken-2">
                        Select an agent and channel to view validation performance metrics
                    </p>
                </div>
            </v-card-text>
        </v-card>

        <!-- Task Effectiveness Section -->
        <v-card class="chart-card mb-6" elevation="0">
            <v-card-title>
                <div class="d-flex align-center justify-space-between w-100">
                    <div class="d-flex align-center">
                        <v-icon class="mr-2">mdi-chart-timeline-variant</v-icon>
                        Task Effectiveness
                    </div>
                    <v-chip
                        size="small"
                        color="success"
                        variant="tonal"
                    >
                        New
                    </v-chip>
                </div>
            </v-card-title>
            <v-card-text>
                <TaskEffectiveness 
                    :channel-id="selectedChannelId"
                    :time-range="timeRange"
                />
            </v-card-text>
        </v-card>
    </div>
    
    <!-- Error Snackbar -->
    <v-snackbar
        v-model="showErrorSnackbar"
        color="error"
        timeout="6000"
        multi-line
    >
        <v-icon start>mdi-alert-circle</v-icon>
        {{ errorMessage }}
        <template v-slot:actions>
            <v-btn
                color="white"
                variant="text"
                @click="clearError"
            >
                Close
            </v-btn>
        </template>
    </v-snackbar>
</template>

<style scoped>
.charts-analytics {
    max-width: 1400px;
    margin: 0 auto;
}

.chart-card {
    background: var(--v-theme-card-bg);
    border: 1px solid rgba(255, 255, 255, 0.1);
    height: 100%;
}

.chart-container {
    min-height: 250px;
    display: flex;
    align-items: center;
    justify-content: center;
}

.chart-loading {
    text-align: center;
}

.empty-chart-state {
    width: 100%;
    min-height: 250px;
    display: flex;
    align-items: center;
    justify-content: center;
}

.channel-chart {
    min-height: 200px;
}

.channel-color-dot {
    width: 12px;
    height: 12px;
    border-radius: 50%;
}

.agent-metrics {
    min-height: 200px;
}

.metric-row {
    border-radius: 8px;
    transition: background-color 0.2s ease;
}

.metric-row:hover {
    background-color: rgba(255, 255, 255, 0.05);
}

.text-mono {
    font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
    font-size: 0.875rem;
}

.gap-4 {
    gap: 1rem;
}
</style>
