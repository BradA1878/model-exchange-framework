<script setup lang="ts">
import { ref, computed, onMounted, watch, onUnmounted, nextTick } from 'vue';
import { useAnalyticsStore } from '@/stores/analytics';
import { useAgentsStore } from '@/stores/agents';
import ValidationMetrics from '@/components/analytics/ValidationMetrics.vue';
import TaskEffectiveness from '@/components/analytics/TaskEffectiveness.vue';
import {
    Chart,
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    BarElement,
    ArcElement,
    Title,
    Tooltip,
    Legend,
    Filler
} from 'chart.js';

// Register Chart.js components
Chart.register(
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    BarElement,
    ArcElement,
    Title,
    Tooltip,
    Legend,
    Filler
);

// Store
const analyticsStore = useAnalyticsStore();
const agentsStore = useAgentsStore();

// Chart instances
let performanceChart: Chart | null = null;
let toolUsageChart: Chart | null = null;
const performanceChartRef = ref<HTMLCanvasElement | null>(null);
const toolUsageChartRef = ref<HTMLCanvasElement | null>(null);

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
        // Fetch all chart data concurrently via the store's batch method
        await analyticsStore.fetchAllChartData(timeRange.value);
        // Update charts after data is loaded
        await nextTick();
        renderPerformanceChart();
        renderToolUsageChart();
    } catch (error) {
        console.error('Failed to load chart data:', error);
        showErrorSnackbar.value = true;
    }
};

// Check if we have real performance data
const hasPerformanceData = computed(() => {
    const perfData = performanceData.value;
    return perfData.datasets && perfData.datasets.length > 0 &&
           perfData.datasets.some(d => d.data && d.data.length > 0 && d.data.some(v => v > 0));
});

// Check if we have real tool usage data
const hasToolUsageData = computed(() => {
    // Tool usage data would come from the store - for now check if we have any activity
    return channelActivity.value.length > 0 || agentMetrics.value.length > 0;
});

// Chart rendering functions
const renderPerformanceChart = (): void => {
    if (!performanceChartRef.value) return;

    // Destroy existing chart
    if (performanceChart) {
        performanceChart.destroy();
        performanceChart = null;
    }

    // Don't render if no real data
    if (!hasPerformanceData.value) return;

    const ctx = performanceChartRef.value.getContext('2d');
    if (!ctx) return;

    // Generate time-based labels based on timeRange
    const labels = generateTimeLabels(timeRange.value);

    // Get performance data from store
    const perfData = performanceData.value;

    // Use real data only - no sample data generation
    const responseTimeData = perfData.datasets.find(d => d.label === 'Response Time')?.data || [];
    const throughputData = perfData.datasets.find(d => d.label === 'Throughput')?.data || [];

    // Get CSS custom properties for theming
    const primaryColor = getComputedStyle(document.documentElement).getPropertyValue('--primary-500').trim() || '#4A90C2';
    const accentColor = getComputedStyle(document.documentElement).getPropertyValue('--accent-500').trim() || '#10B981';

    performanceChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    label: 'Response Time (ms)',
                    data: responseTimeData,
                    borderColor: primaryColor,
                    backgroundColor: `${primaryColor}20`,
                    fill: true,
                    tension: 0.4,
                    pointRadius: 3,
                    pointHoverRadius: 6
                },
                {
                    label: 'Throughput (req/s)',
                    data: throughputData,
                    borderColor: accentColor,
                    backgroundColor: `${accentColor}20`,
                    fill: true,
                    tension: 0.4,
                    pointRadius: 3,
                    pointHoverRadius: 6
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false
            },
            plugins: {
                legend: {
                    position: 'top',
                    labels: {
                        color: getComputedStyle(document.documentElement).getPropertyValue('--text-secondary').trim() || '#8B95A5',
                        usePointStyle: true,
                        padding: 20
                    }
                },
                tooltip: {
                    backgroundColor: 'rgba(0, 0, 0, 0.8)',
                    titleColor: '#fff',
                    bodyColor: '#fff',
                    padding: 12,
                    cornerRadius: 8
                }
            },
            scales: {
                x: {
                    grid: {
                        color: 'rgba(255, 255, 255, 0.05)'
                    },
                    ticks: {
                        color: getComputedStyle(document.documentElement).getPropertyValue('--text-muted').trim() || '#6B7280'
                    }
                },
                y: {
                    grid: {
                        color: 'rgba(255, 255, 255, 0.05)'
                    },
                    ticks: {
                        color: getComputedStyle(document.documentElement).getPropertyValue('--text-muted').trim() || '#6B7280'
                    }
                }
            }
        }
    });
};

const renderToolUsageChart = (): void => {
    if (!toolUsageChartRef.value) return;

    // Destroy existing chart
    if (toolUsageChart) {
        toolUsageChart.destroy();
        toolUsageChart = null;
    }

    // Don't render if no real data
    if (!hasToolUsageData.value) return;

    const ctx = toolUsageChartRef.value.getContext('2d');
    if (!ctx) return;

    // Tool usage data would come from the API - only show if we have real data
    // For now, use empty arrays if no data is available
    const toolNames: string[] = [];
    const toolCounts: number[] = [];

    // In production, this would be populated from analyticsStore.toolUsageData
    // If no tool data is available, the chart won't render (checked above)

    const colors = ['#4A90C2', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6'];

    toolUsageChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: toolNames,
            datasets: [
                {
                    label: 'Tool Executions',
                    data: toolCounts,
                    backgroundColor: colors.map(c => `${c}CC`),
                    borderColor: colors,
                    borderWidth: 1,
                    borderRadius: 4
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            indexAxis: 'y',
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    backgroundColor: 'rgba(0, 0, 0, 0.8)',
                    titleColor: '#fff',
                    bodyColor: '#fff',
                    padding: 12,
                    cornerRadius: 8
                }
            },
            scales: {
                x: {
                    grid: {
                        color: 'rgba(255, 255, 255, 0.05)'
                    },
                    ticks: {
                        color: getComputedStyle(document.documentElement).getPropertyValue('--text-muted').trim() || '#6B7280'
                    }
                },
                y: {
                    grid: {
                        display: false
                    },
                    ticks: {
                        color: getComputedStyle(document.documentElement).getPropertyValue('--text-secondary').trim() || '#8B95A5'
                    }
                }
            }
        }
    });
};

const generateTimeLabels = (range: string): string[] => {
    const labels: string[] = [];
    const now = new Date();

    switch (range) {
        case '1h':
            for (let i = 11; i >= 0; i--) {
                const time = new Date(now.getTime() - i * 5 * 60 * 1000);
                labels.push(time.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }));
            }
            break;
        case '24h':
            for (let i = 23; i >= 0; i--) {
                const time = new Date(now.getTime() - i * 60 * 60 * 1000);
                labels.push(time.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }));
            }
            break;
        case '7d':
            for (let i = 6; i >= 0; i--) {
                const time = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
                labels.push(time.toLocaleDateString('en-US', { weekday: 'short' }));
            }
            break;
        case '30d':
            for (let i = 29; i >= 0; i--) {
                const time = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
                labels.push(time.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
            }
            break;
        case '90d':
            for (let i = 11; i >= 0; i--) {
                const time = new Date(now.getTime() - i * 7 * 24 * 60 * 60 * 1000);
                labels.push(time.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
            }
            break;
        default:
            for (let i = 23; i >= 0; i--) {
                labels.push(`${i}h ago`);
            }
    }

    return labels;
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

    // Destroy chart instances
    if (performanceChart) {
        performanceChart.destroy();
        performanceChart = null;
    }
    if (toolUsageChart) {
        toolUsageChart.destroy();
        toolUsageChart = null;
    }
});
</script>

<template>
    <div class="an-charts">
        <!-- ░░ Controls Strip ░░ -->
        <div class="an-charts__controls">
            <nav class="an-charts__timerange">
                <button
                    v-for="option in timeRangeOptions"
                    :key="option.value"
                    class="an-charts__range-btn"
                    :class="{ 'an-charts__range-btn--active': timeRange === option.value }"
                    @click="timeRange = option.value"
                >
                    {{ option.title }}
                </button>
            </nav>
            <button class="an-charts__refresh-btn" @click="refreshCharts" :disabled="loading">
                <v-icon size="14">mdi-refresh</v-icon>
                <span>Refresh</span>
            </button>
        </div>

        <!-- ░░ Performance Chart ░░ -->
        <section class="an-charts__card">
            <div class="an-charts__card-head">
                <div class="an-charts__card-title">
                    <v-icon size="14">mdi-chart-line</v-icon>
                    <span>System Performance</span>
                </div>
                <button class="an-charts__icon-btn" @click="exportChart('performance')">
                    <v-icon size="14">mdi-download</v-icon>
                </button>
            </div>
            <div class="an-charts__card-body">
                <div v-if="loading" class="an-charts__loading">
                    <v-progress-circular indeterminate color="primary" size="32" width="2" />
                    <p>Loading performance data...</p>
                </div>
                <div v-else-if="!hasPerformanceData" class="an-charts__empty">
                    <div class="an-charts__empty-ring">
                        <v-icon size="28" style="opacity: 0.35; color: var(--primary-500)">mdi-chart-line-variant</v-icon>
                    </div>
                    <h3>No Performance Data Yet</h3>
                    <p>Performance metrics will appear once your agents start processing tasks.</p>
                </div>
                <div v-else class="an-charts__canvas-wrap an-charts__canvas-wrap--tall">
                    <canvas ref="performanceChartRef"></canvas>
                </div>
            </div>
        </section>

        <!-- ░░ Tool Usage Chart ░░ -->
        <section class="an-charts__card">
            <div class="an-charts__card-head">
                <div class="an-charts__card-title">
                    <v-icon size="14">mdi-tools</v-icon>
                    <span>Tool Usage</span>
                </div>
                <button class="an-charts__icon-btn" :disabled="!hasToolUsageData" @click="exportChart('tools')">
                    <v-icon size="14">mdi-download</v-icon>
                </button>
            </div>
            <div class="an-charts__card-body">
                <div v-if="loading" class="an-charts__loading">
                    <v-progress-circular indeterminate color="primary" size="32" width="2" />
                </div>
                <div v-else-if="!hasToolUsageData" class="an-charts__empty">
                    <div class="an-charts__empty-ring">
                        <v-icon size="28" style="opacity: 0.35; color: var(--primary-500)">mdi-tools</v-icon>
                    </div>
                    <h3>No Tool Usage Data Yet</h3>
                    <p>Tool execution statistics will appear when agents use MCP tools.</p>
                </div>
                <div v-else class="an-charts__canvas-wrap">
                    <canvas ref="toolUsageChartRef"></canvas>
                </div>
            </div>
        </section>

        <!-- ░░ Channel Activity & Agent Metrics ░░ -->
        <div class="an-charts__row">
            <!-- Channel Activity -->
            <section class="an-charts__card">
                <div class="an-charts__card-head">
                    <div class="an-charts__card-title">
                        <v-icon size="14">mdi-chart-donut</v-icon>
                        <span>Channel Activity</span>
                    </div>
                    <button class="an-charts__icon-btn" @click="exportChart('channel-activity')">
                        <v-icon size="14">mdi-download</v-icon>
                    </button>
                </div>
                <div class="an-charts__card-body">
                    <div v-if="loading" class="an-charts__loading">
                        <v-progress-circular indeterminate color="primary" size="32" width="2" />
                    </div>
                    <div v-else-if="channelActivity.length > 0" class="an-charts__channels">
                        <div
                            v-for="channel in channelActivity"
                            :key="channel.name"
                            class="an-charts__channel-item"
                        >
                            <div class="an-charts__channel-head">
                                <div
                                    class="an-charts__channel-dot"
                                    :style="{ backgroundColor: channel.color }"
                                />
                                <span class="an-charts__channel-name">{{ channel.name }}</span>
                                <span class="an-charts__channel-value">{{ channel.value }}%</span>
                            </div>
                            <v-progress-linear
                                :model-value="channel.value"
                                :color="channel.color"
                                height="5"
                                rounded
                            />
                        </div>
                    </div>
                    <div v-else class="an-charts__empty an-charts__empty--compact">
                        <div class="an-charts__empty-ring an-charts__empty-ring--sm">
                            <v-icon size="20" style="opacity: 0.35; color: var(--primary-500)">mdi-forum-outline</v-icon>
                        </div>
                        <h3>No Channel Activity</h3>
                        <p>Channel activity data will appear when channels are active.</p>
                    </div>
                </div>
            </section>

            <!-- Agent Performance -->
            <section class="an-charts__card">
                <div class="an-charts__card-head">
                    <div class="an-charts__card-title">
                        <v-icon size="14">mdi-robot</v-icon>
                        <span>Agent Performance</span>
                    </div>
                    <button class="an-charts__icon-btn" @click="exportChart('agent-performance')">
                        <v-icon size="14">mdi-download</v-icon>
                    </button>
                </div>
                <div class="an-charts__card-body">
                    <div v-if="loading" class="an-charts__loading">
                        <v-progress-circular indeterminate color="primary" size="32" width="2" />
                    </div>
                    <div v-else-if="agentMetrics.length > 0" class="an-charts__agents">
                        <div class="an-charts__agents-header">
                            <span>Agent</span>
                            <span>Tasks</span>
                            <span>Success</span>
                            <span>Avg Time</span>
                        </div>
                        <div
                            v-for="metric in agentMetrics"
                            :key="metric.agent"
                            class="an-charts__agent-row"
                        >
                            <div class="an-charts__agent-name">
                                <v-avatar size="22" color="primary">
                                    <v-icon size="11">mdi-robot</v-icon>
                                </v-avatar>
                                <span>{{ metric.agent }}</span>
                            </div>
                            <span class="an-charts__agent-stat">{{ metric.tasks }}</span>
                            <div>
                                <v-chip
                                    :color="metric.success > 98 ? 'success' : metric.success > 95 ? 'warning' : 'error'"
                                    size="x-small"
                                    variant="tonal"
                                >
                                    {{ metric.success }}%
                                </v-chip>
                            </div>
                            <span class="an-charts__agent-stat an-charts__agent-stat--mono">{{ metric.avgTime }}s</span>
                        </div>
                    </div>
                    <div v-else class="an-charts__empty an-charts__empty--compact">
                        <div class="an-charts__empty-ring an-charts__empty-ring--sm">
                            <v-icon size="20" style="opacity: 0.35; color: var(--primary-500)">mdi-robot-off-outline</v-icon>
                        </div>
                        <h3>No Agent Data</h3>
                        <p>Agent performance metrics will appear when agents are active.</p>
                    </div>
                </div>
            </section>
        </div>

        <!-- ░░ Validation Metrics ░░ -->
        <section class="an-charts__card">
            <div class="an-charts__card-head">
                <div class="an-charts__card-title">
                    <v-icon size="14">mdi-shield-check</v-icon>
                    <span>Validation Performance</span>
                </div>
                <button v-if="showValidationMetrics" class="an-charts__icon-btn" @click="exportChart('validation')">
                    <v-icon size="14">mdi-download</v-icon>
                </button>
            </div>
            <div class="an-charts__card-body">
                <!-- Agent/Channel Selector -->
                <div v-if="!showValidationMetrics" class="an-charts__selector-row">
                    <div class="an-charts__selector-fields">
                        <v-select
                            v-model="selectedAgentId"
                            :items="availableAgents"
                            item-title="name"
                            item-value="id"
                            label="Select Agent"
                            variant="outlined"
                            density="compact"
                            clearable
                            hide-details
                        >
                            <template v-slot:prepend-inner>
                                <v-icon size="small">mdi-robot</v-icon>
                            </template>
                        </v-select>
                        <v-select
                            v-model="selectedChannelId"
                            :items="availableChannels"
                            label="Select Channel"
                            variant="outlined"
                            density="compact"
                            clearable
                            hide-details
                        >
                            <template v-slot:prepend-inner>
                                <v-icon size="small">mdi-forum</v-icon>
                            </template>
                        </v-select>
                        <button
                            class="an-charts__select-btn"
                            :disabled="!selectedAgentId || !selectedChannelId"
                            @click="showValidationMetrics = true"
                        >
                            View Metrics
                        </button>
                    </div>
                </div>

                <ValidationMetrics
                    v-if="showValidationMetrics"
                    :agent-id="selectedAgentId"
                    :channel-id="selectedChannelId"
                />

                <div v-if="!showValidationMetrics" class="an-charts__empty">
                    <div class="an-charts__empty-ring">
                        <v-icon size="28" style="opacity: 0.35; color: var(--primary-500)">mdi-shield-check-outline</v-icon>
                    </div>
                    <h3>No Agent Selected</h3>
                    <p>Select an agent and channel above to view validation performance metrics.</p>
                </div>
            </div>
        </section>

        <!-- ░░ Task Effectiveness ░░ -->
        <section class="an-charts__card">
            <div class="an-charts__card-head">
                <div class="an-charts__card-title">
                    <v-icon size="14">mdi-chart-timeline-variant</v-icon>
                    <span>Task Effectiveness</span>
                </div>
                <v-chip size="x-small" color="success" variant="tonal">New</v-chip>
            </div>
            <div class="an-charts__card-body">
                <TaskEffectiveness
                    :channel-id="selectedChannelId"
                    :time-range="timeRange"
                />
            </div>
        </section>
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
/* ════════════════════════════════════════════
   Analytics Charts View — Polished UI
   ════════════════════════════════════════════ */

.an-charts {
    --an-blue: #4A90C2;
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
}

/* ── Controls Strip ───────────────────── */
.an-charts__controls {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
}

.an-charts__timerange {
    display: flex;
    gap: 2px;
    background: var(--bg-base);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-lg);
    overflow: hidden;
    padding: 2px;
}

.an-charts__range-btn {
    padding: 6px 14px;
    border: none;
    background: transparent;
    color: var(--text-secondary);
    font-size: var(--text-xs);
    font-weight: 500;
    font-family: var(--font-sans);
    cursor: pointer;
    border-radius: var(--radius-md);
    transition: all var(--transition-base);
    white-space: nowrap;
}

.an-charts__range-btn:hover:not(.an-charts__range-btn--active) {
    color: var(--text-primary);
    background: var(--bg-hover);
}

.an-charts__range-btn--active {
    color: var(--an-blue);
    background: rgba(74, 144, 194, 0.12);
    font-weight: 600;
}

.an-charts__refresh-btn {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 6px 14px;
    border-radius: var(--radius-md);
    font-size: var(--text-sm);
    font-weight: 500;
    cursor: pointer;
    transition: all var(--transition-base);
    border: 1px solid var(--border-default);
    background: transparent;
    color: var(--text-secondary);
    font-family: var(--font-sans);
}

.an-charts__refresh-btn:hover {
    color: var(--text-primary);
    border-color: var(--an-blue);
    background: rgba(74, 144, 194, 0.08);
}

.an-charts__refresh-btn:disabled {
    opacity: 0.5;
    cursor: default;
}

/* ── Card (shared pattern) ────────────── */
.an-charts__card {
    background: var(--bg-base);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-lg);
    overflow: hidden;
    transition: border-color var(--transition-base);
}

.an-charts__card:hover {
    border-color: var(--border-default);
}

.an-charts__card-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-4) var(--space-5);
    border-bottom: 1px solid var(--border-subtle);
}

.an-charts__card-title {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--text-primary);
}

.an-charts__card-body {
    padding: var(--space-5);
}

/* ── Icon button ──────────────────────── */
.an-charts__icon-btn {
    width: 30px;
    height: 30px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px solid transparent;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    transition: all var(--transition-base);
}

.an-charts__icon-btn:hover {
    color: var(--text-primary);
    background: var(--bg-hover);
    border-color: var(--border-subtle);
}

.an-charts__icon-btn:disabled {
    opacity: 0.3;
    cursor: default;
}

/* ── Canvas wrappers ──────────────────── */
.an-charts__canvas-wrap {
    width: 100%;
    height: 250px;
    position: relative;
}

.an-charts__canvas-wrap canvas {
    width: 100% !important;
    height: 100% !important;
}

.an-charts__canvas-wrap--tall {
    height: 350px;
}

/* ── Loading State ────────────────────── */
.an-charts__loading {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 200px;
    gap: var(--space-3);
}

.an-charts__loading p {
    font-size: var(--text-sm);
    color: var(--text-muted);
    margin: 0;
}

/* ── Empty State ──────────────────────── */
.an-charts__empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 250px;
    text-align: center;
    padding: var(--space-6);
}

.an-charts__empty-ring {
    width: 72px;
    height: 72px;
    border-radius: 50%;
    background: linear-gradient(135deg, rgba(74, 144, 194, 0.06) 0%, rgba(74, 144, 194, 0.02) 100%);
    border: 1px solid var(--border-subtle);
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: var(--space-2);
}

.an-charts__empty-ring--sm {
    width: 52px;
    height: 52px;
}

.an-charts__empty h3 {
    font-size: var(--text-base);
    font-weight: 600;
    color: var(--text-secondary);
    margin: var(--space-3) 0 var(--space-1);
}

.an-charts__empty p {
    font-size: var(--text-sm);
    color: var(--text-muted);
    margin: 0;
    max-width: 320px;
    line-height: 1.6;
}

.an-charts__empty--compact {
    min-height: 180px;
    padding: var(--space-4);
}

/* ── Side-by-side row ─────────────────── */
.an-charts__row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-4);
}

/* ── Channel Activity ─────────────────── */
.an-charts__channels {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
}

.an-charts__channel-item {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}

.an-charts__channel-head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
}

.an-charts__channel-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    flex-shrink: 0;
}

.an-charts__channel-name {
    font-size: var(--text-sm);
    color: var(--text-secondary);
    flex: 1;
}

.an-charts__channel-value {
    font-family: var(--font-mono);
    font-size: var(--text-base);
    font-weight: 700;
    color: var(--text-primary);
}

/* ── Agent Performance ────────────────── */
.an-charts__agents {
    display: flex;
    flex-direction: column;
}

.an-charts__agents-header {
    display: grid;
    grid-template-columns: 2fr 1fr 1fr 1fr;
    gap: var(--space-2);
    padding: 0 var(--space-2) var(--space-2);
    border-bottom: 1px solid var(--border-subtle);
    margin-bottom: var(--space-2);
}

.an-charts__agents-header span {
    font-size: var(--text-xs);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
}

.an-charts__agent-row {
    display: grid;
    grid-template-columns: 2fr 1fr 1fr 1fr;
    gap: var(--space-2);
    align-items: center;
    padding: var(--space-2);
    border-radius: var(--radius-md);
    transition: background var(--transition-fast);
}

.an-charts__agent-row:hover {
    background: var(--bg-hover);
}

.an-charts__agent-name {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-sm);
    color: var(--text-primary);
}

.an-charts__agent-stat {
    font-size: var(--text-sm);
    color: var(--text-secondary);
}

.an-charts__agent-stat--mono {
    font-family: var(--font-mono);
}

/* ── Selector Row ─────────────────────── */
.an-charts__selector-row {
    margin-bottom: var(--space-4);
}

.an-charts__selector-fields {
    display: grid;
    grid-template-columns: 2fr 2fr auto;
    gap: var(--space-3);
    align-items: start;
}

.an-charts__select-btn {
    padding: 8px 16px;
    border-radius: var(--radius-md);
    font-size: var(--text-sm);
    font-weight: 500;
    cursor: pointer;
    transition: all var(--transition-base);
    border: none;
    background: rgba(74, 144, 194, 0.15);
    color: var(--an-blue);
    font-family: var(--font-sans);
    white-space: nowrap;
    height: 40px;
}

.an-charts__select-btn:hover:not(:disabled) {
    background: rgba(74, 144, 194, 0.25);
}

.an-charts__select-btn:disabled {
    opacity: 0.4;
    cursor: default;
}

/* ── Responsive ───────────────────────── */
@media (max-width: 1024px) {
    .an-charts__row {
        grid-template-columns: 1fr;
    }
}

@media (max-width: 768px) {
    .an-charts__controls {
        flex-direction: column;
        align-items: stretch;
    }

    .an-charts__timerange {
        overflow-x: auto;
    }

    .an-charts__refresh-btn {
        align-self: flex-end;
    }

    .an-charts__selector-fields {
        grid-template-columns: 1fr;
    }
}
</style>
