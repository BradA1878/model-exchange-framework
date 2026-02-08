import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import axios from '../plugins/axios';

// Types for analytics data
export interface AnalyticsStats {
    totalEvents: number;
    activeChannels: number;
    avgResponseTime: number;
    successRate: number;
}

export interface EventData {
    id: number;
    timestamp: string;
    eventType: string;
    channel: string;
    agent: string;
    status: string;
    duration: number;
}

export interface PerformanceData {
    labels: string[];
    datasets: Array<{
        label: string;
        data: number[];
        color: string;
    }>;
}

export interface ChannelActivity {
    name: string;
    value: number;
    color: string;
}

export interface AgentMetric {
    agent: string;
    tasks: number;
    success: number;
    avgTime: number;
}

// Color palette for channel activity bars
const CHANNEL_COLORS = [
    '#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
    '#ec4899', '#14b8a6', '#f97316', '#06b6d4', '#84cc16'
];

export const useAnalyticsStore = defineStore('analytics', () => {
    // State
    const stats = ref<AnalyticsStats>({
        totalEvents: 0,
        activeChannels: 0,
        avgResponseTime: 0,
        successRate: 0
    });

    const events = ref<EventData[]>([]);
    const totalEventsCount = ref(0);
    const performanceData = ref<PerformanceData>({
        labels: [],
        datasets: []
    });
    const channelActivity = ref<ChannelActivity[]>([]);
    const agentMetrics = ref<AgentMetric[]>([]);

    // Loading states
    const loadingStats = ref(false);
    const loadingEvents = ref(false);
    const loadingCharts = ref(false);

    // Error states
    const error = ref<string | null>(null);

    // Computed properties
    const hasData = computed(() => events.value.length > 0);
    const totalEventsDisplayed = computed(() => totalEventsCount.value || events.value.length);
    const isLoading = computed(() =>
        loadingStats.value || loadingEvents.value || loadingCharts.value
    );

    // Actions

    /**
     * Fetch analytics summary stats from the server.
     * Maps API response fields (responseTime string, errorRate string) to
     * the numeric fields the UI expects (avgResponseTime, successRate).
     */
    const fetchAnalyticsStats = async (): Promise<void> => {
        loadingStats.value = true;
        error.value = null;

        try {
            const response = await axios.get('/api/analytics/stats');
            if (response.data.success) {
                const apiData = response.data.data;
                // Map API fields to store's AnalyticsStats shape
                stats.value = {
                    totalEvents: apiData.totalEvents || 0,
                    activeChannels: apiData.activeChannels || 0,
                    // responseTime comes as string like "0ms" — extract the number
                    avgResponseTime: parseFloat(apiData.responseTime) || 0,
                    // errorRate comes as string like "0%" — calculate success rate
                    successRate: 100 - (parseFloat(apiData.errorRate) || 0)
                };
            }
        } catch (err: any) {
            console.error('Failed to fetch analytics stats:', err);
            error.value = err.response?.data?.message || 'Failed to fetch analytics stats';
        } finally {
            loadingStats.value = false;
        }
    };

    const fetchEvents = async (filters?: {
        search?: string;
        eventType?: string;
        status?: string;
        dateRange?: string[];
        limit?: number;
        offset?: number;
    }): Promise<void> => {
        loadingEvents.value = true;
        error.value = null;

        try {
            // Build query parameters
            const params = new URLSearchParams();
            if (filters?.search) params.append('search', filters.search);
            if (filters?.eventType) params.append('eventType', filters.eventType);
            if (filters?.status) params.append('status', filters.status);
            if (filters?.dateRange?.[0]) params.append('startDate', filters.dateRange[0]);
            if (filters?.dateRange?.[1]) params.append('endDate', filters.dateRange[1]);
            if (filters?.limit) params.append('limit', filters.limit.toString());
            if (filters?.offset) params.append('offset', filters.offset.toString());

            const response = await axios.get(`/api/analytics/events?${params}`);
            if (response.data.success) {
                events.value = response.data.data || [];
                totalEventsCount.value = response.data.total || events.value.length;
            } else {
                events.value = [];
                totalEventsCount.value = 0;
            }
        } catch (err: any) {
            console.error('Failed to fetch events:', err);
            error.value = err.response?.data?.message || 'Failed to fetch events';
            events.value = [];
            totalEventsCount.value = 0;
        } finally {
            loadingEvents.value = false;
        }
    };

    /**
     * Fetch performance metrics for the charts view.
     * API returns { timeRange, metrics: {...}, chartData: [], timestamp }.
     * Maps to PerformanceData with labels/datasets for Chart.js rendering.
     */
    const fetchPerformanceData = async (timeRange: string = '24h'): Promise<void> => {
        try {
            const response = await axios.get(`/api/analytics/performance?timeRange=${timeRange}`);
            if (response.data.success) {
                const apiData = response.data.data;
                const chartData = apiData.chartData || [];

                if (chartData.length > 0) {
                    // Transform server chartData into Chart.js format
                    performanceData.value = {
                        labels: chartData.map((point: any) => point.label || point.timestamp || ''),
                        datasets: [{
                            label: 'Response Time',
                            data: chartData.map((point: any) => point.responseTime || 0),
                            color: '#6366f1'
                        }, {
                            label: 'Throughput',
                            data: chartData.map((point: any) => point.throughput || 0),
                            color: '#10b981'
                        }]
                    };
                } else {
                    // No chart data available — keep empty
                    performanceData.value = { labels: [], datasets: [] };
                }
            }
        } catch (err: any) {
            console.error('Failed to fetch performance data:', err);
            error.value = err.response?.data?.message || 'Failed to fetch performance data';
        }
    };

    /**
     * Fetch channel activity data.
     * API returns { channels: Array<{_id, name, ...}>, timeRange, totalMetrics }.
     * Transforms the channels array into ChannelActivity[] for progress bar display.
     */
    const fetchChannelActivity = async (timeRange: string = '24h'): Promise<void> => {
        try {
            const response = await axios.get(`/api/analytics/channels?timeRange=${timeRange}`);
            if (response.data.success) {
                const apiData = response.data.data;
                // Extract the channels array from the response object
                const channels = apiData.channels || [];

                if (channels.length > 0) {
                    // Calculate total messages for percentage calculation
                    const totalMessages = channels.reduce(
                        (sum: number, ch: any) => sum + (ch.messageCount || ch.totalMessages || 0), 0
                    ) || 1; // avoid division by zero

                    channelActivity.value = channels.map((ch: any, index: number) => ({
                        name: ch.name || ch._id || `Channel ${index + 1}`,
                        value: Math.round(((ch.messageCount || ch.totalMessages || 0) / totalMessages) * 100),
                        color: CHANNEL_COLORS[index % CHANNEL_COLORS.length]
                    }));
                } else {
                    channelActivity.value = [];
                }
            }
        } catch (err: any) {
            console.error('Failed to fetch channel activity:', err);
        }
    };

    /**
     * Fetch agent performance metrics.
     * API returns { agentId, timeRange, performance: {...}, chartData: [], timestamp }.
     * When agentId is "all", transforms into AgentMetric[] for the table display.
     */
    const fetchAgentMetrics = async (timeRange: string = '24h'): Promise<void> => {
        try {
            const response = await axios.get(`/api/analytics/agents?timeRange=${timeRange}`);
            if (response.data.success) {
                const apiData = response.data.data;

                // The API returns a single performance object for all agents
                // or chartData with per-agent breakdowns
                const chartData = apiData.chartData || [];

                if (chartData.length > 0) {
                    // Transform per-agent chart data into AgentMetric[]
                    agentMetrics.value = chartData.map((item: any) => ({
                        agent: item.agentName || item.agentId || 'Unknown',
                        tasks: item.tasksCompleted || 0,
                        success: Math.round((item.successRate || 0) * 100),
                        avgTime: item.averageResponseTime || 0
                    }));
                } else {
                    // No per-agent breakdown — show empty state
                    agentMetrics.value = [];
                }
            }
        } catch (err: any) {
            console.error('Failed to fetch agent metrics:', err);
        }
    };

    /**
     * Fetch all chart data concurrently.
     * Sets loadingCharts once for all three fetches.
     */
    const fetchAllChartData = async (timeRange: string = '24h'): Promise<void> => {
        loadingCharts.value = true;
        error.value = null;

        try {
            await Promise.all([
                fetchPerformanceData(timeRange),
                fetchChannelActivity(timeRange),
                fetchAgentMetrics(timeRange)
            ]);
        } catch (err: any) {
            console.error('Failed to fetch chart data:', err);
            error.value = err.response?.data?.message || 'Failed to fetch chart data';
        } finally {
            loadingCharts.value = false;
        }
    };

    /**
     * Export analytics data as CSV.
     * Generates CSV client-side from the currently loaded data, since the
     * server does not have a dedicated export endpoint.
     */
    const exportData = async (type: 'events' | 'performance' | 'channels' | 'agents'): Promise<void> => {
        try {
            let csvContent = '';
            const dateStr = new Date().toISOString().split('T')[0];

            switch (type) {
                case 'events': {
                    csvContent = 'Timestamp,Event Type,Channel,Agent,Status,Duration (ms)\n';
                    for (const event of events.value) {
                        csvContent += `${event.timestamp},${event.eventType},${event.channel},${event.agent},${event.status},${event.duration}\n`;
                    }
                    if (events.value.length === 0) {
                        csvContent += 'No event data available\n';
                    }
                    break;
                }
                case 'performance': {
                    csvContent = 'Metric,Value\n';
                    csvContent += `Total Events,${stats.value.totalEvents}\n`;
                    csvContent += `Active Channels,${stats.value.activeChannels}\n`;
                    csvContent += `Avg Response Time,${stats.value.avgResponseTime}ms\n`;
                    csvContent += `Success Rate,${stats.value.successRate}%\n`;
                    break;
                }
                case 'channels': {
                    csvContent = 'Channel,Activity %\n';
                    for (const channel of channelActivity.value) {
                        csvContent += `${channel.name},${channel.value}%\n`;
                    }
                    if (channelActivity.value.length === 0) {
                        csvContent += 'No channel data available\n';
                    }
                    break;
                }
                case 'agents': {
                    csvContent = 'Agent,Tasks,Success %,Avg Time (s)\n';
                    for (const metric of agentMetrics.value) {
                        csvContent += `${metric.agent},${metric.tasks},${metric.success}%,${metric.avgTime}\n`;
                    }
                    if (agentMetrics.value.length === 0) {
                        csvContent += 'No agent data available\n';
                    }
                    break;
                }
            }

            // Create and trigger download
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const url = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', `analytics-${type}-${dateStr}.csv`);
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.URL.revokeObjectURL(url);
        } catch (err: any) {
            console.error(`Failed to export ${type} data:`, err);
            error.value = `Failed to export ${type} data`;
        }
    };

    const refreshAllData = async (timeRange: string = '24h'): Promise<void> => {
        await Promise.all([
            fetchAnalyticsStats(),
            fetchEvents(),
            fetchAllChartData(timeRange)
        ]);
    };

    const clearError = (): void => {
        error.value = null;
    };

    const initializeStore = (): void => {
        stats.value = {
            totalEvents: 0,
            activeChannels: 0,
            avgResponseTime: 0,
            successRate: 0
        };
        events.value = [];
        totalEventsCount.value = 0;
        performanceData.value = { labels: [], datasets: [] };
        channelActivity.value = [];
        agentMetrics.value = [];
        error.value = null;
    };

    return {
        // State
        stats,
        events,
        performanceData,
        channelActivity,
        agentMetrics,

        // Loading states
        loadingStats,
        loadingEvents,
        loadingCharts,
        isLoading,

        // Error state
        error,

        // Computed
        hasData,
        totalEventsDisplayed,

        // Actions
        fetchAnalyticsStats,
        fetchEvents,
        fetchPerformanceData,
        fetchChannelActivity,
        fetchAgentMetrics,
        fetchAllChartData,
        exportData,
        refreshAllData,
        clearError,
        initializeStore
    };
});
