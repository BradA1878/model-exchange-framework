import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import axios from 'axios';

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

export const useAnalyticsStore = defineStore('analytics', () => {
    // State
    const stats = ref<AnalyticsStats>({
        totalEvents: 0,
        activeChannels: 0,
        avgResponseTime: 0,
        successRate: 0
    });

    const events = ref<EventData[]>([]);
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
    const totalEventsDisplayed = computed(() => events.value.length);
    const isLoading = computed(() => 
        loadingStats.value || loadingEvents.value || loadingCharts.value
    );

    // Actions
    const fetchAnalyticsStats = async (): Promise<void> => {
        loadingStats.value = true;
        error.value = null;

        try {
            // Fetch analytics summary stats
            const response = await axios.get('/api/analytics/stats');
            stats.value = response.data.success ? response.data.data : {};
        } catch (err: any) {
            console.error('Failed to fetch analytics stats:', err);
            error.value = err.response?.data?.message || 'Failed to fetch analytics stats';
            
            // Keep existing stats on error to maintain UI state
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
            events.value = response.data.success ? response.data.data : [];
        } catch (err: any) {
            console.error('Failed to fetch events:', err);
            error.value = err.response?.data?.message || 'Failed to fetch events';
            
            // Clear events on error to show error state
            events.value = [];
        } finally {
            loadingEvents.value = false;
        }
    };

    const fetchPerformanceData = async (timeRange: string = '24h'): Promise<void> => {
        loadingCharts.value = true;
        error.value = null;

        try {
            const response = await axios.get(`/api/analytics/performance?timeRange=${timeRange}`);
            performanceData.value = response.data.success ? response.data.data : {};
        } catch (err: any) {
            console.error('Failed to fetch performance data:', err);
            error.value = err.response?.data?.message || 'Failed to fetch performance data';
            
            // Keep existing data on error
        } finally {
            loadingCharts.value = false;
        }
    };

    const fetchChannelActivity = async (timeRange: string = '24h'): Promise<void> => {
        try {
            const response = await axios.get(`/api/analytics/channels?timeRange=${timeRange}`);
            channelActivity.value = response.data.success ? response.data.data : {};
        } catch (err: any) {
            console.error('Failed to fetch channel activity:', err);
            // Keep existing data on error
        }
    };

    const fetchAgentMetrics = async (timeRange: string = '24h'): Promise<void> => {
        try {
            const response = await axios.get(`/api/analytics/agents?timeRange=${timeRange}`);
            agentMetrics.value = response.data.success ? response.data.data : {};
        } catch (err: any) {
            console.error('Failed to fetch agent metrics:', err);
            // Keep existing data on error
        }
    };

    const fetchAllChartData = async (timeRange: string = '24h'): Promise<void> => {
        loadingCharts.value = true;
        error.value = null;

        try {
            // Fetch all chart data concurrently
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

    const exportData = async (type: 'events' | 'performance' | 'channels' | 'agents'): Promise<void> => {
        try {
            const response = await axios.get(`/api/analytics/export/${type}`, {
                responseType: 'blob'
            });
            
            // Create download link
            const url = window.URL.createObjectURL(new Blob([response.data]));
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', `analytics-${type}-${new Date().toISOString().split('T')[0]}.csv`);
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.URL.revokeObjectURL(url);
        } catch (err: any) {
            console.error(`Failed to export ${type} data:`, err);
            error.value = err.response?.data?.message || `Failed to export ${type} data`;
        }
    };

    const refreshAllData = async (timeRange: string = '24h'): Promise<void> => {
        // Refresh all analytics data
        await Promise.all([
            fetchAnalyticsStats(),
            fetchEvents(),
            fetchAllChartData(timeRange)
        ]);
    };

    const clearError = (): void => {
        error.value = null;
    };

    // Initialize with empty data
    const initializeStore = (): void => {
        // Reset all state to initial values
        stats.value = {
            totalEvents: 0,
            activeChannels: 0,
            avgResponseTime: 0,
            successRate: 0
        };
        events.value = [];
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
