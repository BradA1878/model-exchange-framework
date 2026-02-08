import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import axios from '../plugins/axios';

// Types
interface DashboardStats {
    totalChannels: number;
    activeAgents: number;
    completedTasks: number;
    totalCredits: number;
}

interface ActivityItem {
    id: string;
    type: 'task_completed' | 'task_started' | 'channel_created' | 'agent_joined' | 'agent_assigned';
    title: string;
    agent: string;
    channelId?: string;
    taskId?: string;
    timestamp: string;
    icon: string;
    color: 'success' | 'info' | 'primary' | 'warning' | 'error';
}

interface SystemOverview {
    name: string;
    value: number;
    color: string;
    trend?: 'up' | 'down' | 'stable';
    percentage?: number;
}

export const useDashboardStore = defineStore('dashboard', () => {
    // State
    const stats = ref<DashboardStats>({
        totalChannels: 0,
        activeAgents: 0,
        completedTasks: 0,
        totalCredits: 0
    });

    const recentActivity = ref<ActivityItem[]>([]);
    const systemOverview = ref<SystemOverview[]>([]);
    
    // Loading states
    const loadingStats = ref(false);
    const loadingActivity = ref(false);
    const loadingOverview = ref(false);
    
    // Error state
    const error = ref<string | null>(null);

    // Computed
    const isLoading = computed(() => 
        loadingStats.value || loadingActivity.value || loadingOverview.value
    );

    const hasData = computed(() => 
        stats.value.totalChannels > 0 || recentActivity.value.length > 0
    );

    // Actions
    const fetchDashboardStats = async (): Promise<void> => {
        loadingStats.value = true;
        try {
            const response = await axios.get('/api/dashboard/stats');
            stats.value = response.data;
        } catch (err: any) {
            console.error('Failed to fetch dashboard stats:', err);
            error.value = err.response?.data?.message || 'Failed to load dashboard statistics';
        } finally {
            loadingStats.value = false;
        }
    };

    const fetchRecentActivity = async (limit: number = 10): Promise<void> => {
        loadingActivity.value = true;
        try {
            const response = await axios.get(`/api/dashboard/activity?limit=${limit}`);
            recentActivity.value = response.data.map((item: any) => ({
                ...item,
                timestamp: formatTimestamp(item.createdAt || item.timestamp)
            }));
        } catch (err: any) {
            console.error('Failed to fetch recent activity:', err);
            error.value = err.response?.data?.message || 'Failed to load recent activity';
        } finally {
            loadingActivity.value = false;
        }
    };

    const fetchSystemOverview = async (): Promise<void> => {
        loadingOverview.value = true;
        try {
            const response = await axios.get('/api/dashboard/overview');
            systemOverview.value = response.data;
        } catch (err: any) {
            console.error('Failed to fetch system overview:', err);
            error.value = err.response?.data?.message || 'Failed to load system overview';
        } finally {
            loadingOverview.value = false;
        }
    };

    const refreshAllData = async (): Promise<void> => {
        // Load all dashboard data in parallel
        await Promise.all([
            fetchDashboardStats(),
            fetchRecentActivity(),
            fetchSystemOverview()
        ]);
    };

    const clearError = (): void => {
        error.value = null;
    };

    // Utility functions
    const formatTimestamp = (timestamp: string): string => {
        const now = new Date();
        const date = new Date(timestamp);
        const diffMs = now.getTime() - date.getTime();
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMins / 60);
        const diffDays = Math.floor(diffHours / 24);

        if (diffMins < 1) {
            return 'Just now';
        } else if (diffMins < 60) {
            return `${diffMins} minute${diffMins === 1 ? '' : 's'} ago`;
        } else if (diffHours < 24) {
            return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
        } else if (diffDays < 7) {
            return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
        } else {
            return date.toLocaleDateString();
        }
    };

    // Initialize with empty data
    const initializeStore = (): void => {
        // Reset all state to initial values
        stats.value = {
            totalChannels: 0,
            activeAgents: 0,
            completedTasks: 0,
            totalCredits: 0
        };
        recentActivity.value = [];
        systemOverview.value = [];
        error.value = null;
    };

    return {
        // State
        stats,
        recentActivity,
        systemOverview,
        
        // Loading states
        loadingStats,
        loadingActivity,
        loadingOverview,
        isLoading,
        
        // Error state
        error,
        
        // Computed
        hasData,
        
        // Actions
        fetchDashboardStats,
        fetchRecentActivity,
        fetchSystemOverview,
        refreshAllData,
        clearError,
        initializeStore
    };
});
