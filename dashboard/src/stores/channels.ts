import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import axios from 'axios';

// Types
interface Channel {
    id: string;
    name: string;
    participants: number;
    status: 'active' | 'inactive';
    description?: string;
    domain?: string;
    createdAt?: string;
    updatedAt?: string;
}

interface ChannelMetrics {
    totalMessages: number;
    activeAgents: number;
    completedTasks: number;
    avgResponseTime: number;
}

interface CreateChannelData {
    name: string;
    description?: string;
    domain?: string;
    channelId?: string;
}

export const useChannelsStore = defineStore('channels', () => {
    // State
    const channels = ref<Channel[]>([]);
    const selectedChannelId = ref<string>('');
    const channelMetrics = ref<ChannelMetrics>({
        totalMessages: 0,
        activeAgents: 0,
        completedTasks: 0,
        avgResponseTime: 0
    });
    const loading = ref(false);
    const error = ref<string | null>(null);

    // Getters
    const selectedChannel = computed(() => {
        return channels.value.find(channel => channel?.id === selectedChannelId.value) || null;
    });

    const activeChannels = computed(() => {
        return channels.value.filter(channel => channel.status === 'active');
    });

    // Actions
    const fetchChannels = async (): Promise<void> => {
        loading.value = true;
        error.value = null;
        
        try {
            const response = await axios.get<{ success: boolean; channels: Channel[]; message?: string }>('/api/channels');
            
            if (response.data.success) {
                channels.value = response.data.channels;
                
                // Set default selected channel if none selected
                if (!selectedChannelId.value && channels.value.length > 0) {
                    selectedChannelId.value = channels.value[0].id;
                }
            } else {
                throw new Error(response.data.message || 'Failed to fetch channels');
            }
        } catch (err: any) {
            error.value = err.response?.data?.message || err.message || 'Failed to fetch channels';
            console.error('Fetch channels error:', err);
        } finally {
            loading.value = false;
        }
    };

    const fetchChannelById = async (channelId: string): Promise<Channel | null> => {
        loading.value = true;
        error.value = null;
        
        try {
            const response = await axios.get<{ success: boolean; channel: Channel; message?: string }>(`/api/channels/${channelId}`);
            
            if (response.data.success) {
                // Update the channel in our local state
                const channelIndex = channels.value.findIndex(c => c.id === channelId);
                if (channelIndex >= 0) {
                    channels.value[channelIndex] = response.data.channel;
                } else {
                    channels.value.push(response.data.channel);
                }
                return response.data.channel;
            } else {
                throw new Error(response.data.message || 'Failed to fetch channel');
            }
        } catch (err: any) {
            error.value = err.response?.data?.message || err.message || 'Failed to fetch channel';
            console.error('Fetch channel error:', err);
            return null;
        } finally {
            loading.value = false;
        }
    };

    const createChannel = async (channelData: CreateChannelData): Promise<Channel | null> => {
        loading.value = true;
        error.value = null;
        
        try {
            const response = await axios.post<{ success: boolean; channel: Channel; message?: string }>('/api/channels', channelData);
            
            if (response.data.success && response.data.channel) {
                // Backend now returns consistent format with id field
                channels.value.push(response.data.channel);
                return response.data.channel;
            } else {
                throw new Error(response.data.message || 'Failed to create channel');
            }
        } catch (err: any) {
            error.value = err.response?.data?.message || err.message || 'Failed to create channel';
            console.error('Create channel error:', err);
            return null;
        } finally {
            loading.value = false;
        }
    };

    const updateChannel = async (channelId: string, updateData: Partial<Channel>): Promise<boolean> => {
        loading.value = true;
        error.value = null;
        
        try {
            const response = await axios.put<{ success: boolean; channel: Channel; message?: string }>(`/api/channels/${channelId}`, updateData);
            
            if (response.data.success) {
                // Update the channel in our local state
                const channelIndex = channels.value.findIndex(c => c.id === channelId);
                if (channelIndex >= 0) {
                    channels.value[channelIndex] = response.data.channel;
                }
                return true;
            } else {
                throw new Error(response.data.message || 'Failed to update channel');
            }
        } catch (err: any) {
            error.value = err.response?.data?.message || err.message || 'Failed to update channel';
            console.error('Update channel error:', err);
            return false;
        } finally {
            loading.value = false;
        }
    };

    const deleteChannel = async (channelId: string): Promise<boolean> => {
        loading.value = true;
        error.value = null;
        
        try {
            const response = await axios.delete<{ success: boolean; message?: string }>(`/api/channels/${channelId}`);
            
            if (response.data.success) {
                // Remove the channel from our local state
                channels.value = channels.value.filter(c => c.id !== channelId);
                
                // If deleted channel was selected, select another one
                if (selectedChannelId.value === channelId && channels.value.length > 0) {
                    selectedChannelId.value = channels.value[0].id;
                }
                return true;
            } else {
                throw new Error(response.data.message || 'Failed to delete channel');
            }
        } catch (err: any) {
            error.value = err.response?.data?.message || err.message || 'Failed to delete channel';
            console.error('Delete channel error:', err);
            return false;
        } finally {
            loading.value = false;
        }
    };

    // Fetch channel metrics from analytics API
    const fetchChannelMetrics = async (channelId: string): Promise<void> => {
        loading.value = true;
        error.value = null;
        
        try {
            // Fetch channel activity metrics from analytics API
            const response = await axios.get(`/api/analytics/channels/${channelId}/activity`);
            
            // Transform analytics data to channel metrics format
            const analyticsData = response.data;
            
            channelMetrics.value = {
                totalMessages: analyticsData.totalMessages || 0,
                activeAgents: analyticsData.activeAgents || 0,
                completedTasks: analyticsData.completedTasks || 0,
                avgResponseTime: analyticsData.avgResponseTime || 0
            };
        } catch (err: any) {
            error.value = err.response?.data?.message || err.message || 'Failed to fetch channel metrics';
            console.error('Fetch channel metrics error:', err);
            
            // Provide fallback metrics on error to maintain UI functionality
            channelMetrics.value = {
                totalMessages: 0,
                activeAgents: 0,
                completedTasks: 0,
                avgResponseTime: 0
            };
        } finally {
            loading.value = false;
        }
    };

    const setSelectedChannel = (channelId: string): void => {
        selectedChannelId.value = channelId;
        if (channelId) {
            fetchChannelMetrics(channelId);
        }
    };

    const clearError = (): void => {
        error.value = null;
    };

    return {
        // State
        channels,
        selectedChannelId,
        channelMetrics,
        loading,
        error,
        // Getters
        selectedChannel,
        activeChannels,
        // Actions
        fetchChannels,
        fetchChannelById,
        createChannel,
        updateChannel,
        deleteChannel,
        fetchChannelMetrics,
        setSelectedChannel,
        clearError
    };
});
