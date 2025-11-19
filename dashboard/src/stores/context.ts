import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import axios from 'axios';

// Types - Based on ChannelContext types from backend
interface ContextEntry {
    id: string;
    channelId: string;
    name: string;
    description: string;
    createdAt: number;
    createdBy: string;
    lastActivity: number;
    participants: string[];
    metadata: Record<string, any>;
    status: 'active' | 'inactive' | 'archived';
    messageCount: number;
    conversationSummary?: string;
    updatedAt: number;
    topics?: {
        id: string;
        topic: string;
        keywords: string[];
        relevance: number;
    }[];
}

interface ContextMessage {
    messageId: string;
    content: string | Record<string, any>;
    senderId: string;
    timestamp: number;
    type: 'text' | 'command' | 'response' | 'system';
    metadata?: Record<string, any>;
    receiverId?: string;
    conversationId?: string;
    parentId?: string;
    threadId?: string;
}

interface ConversationTopic {
    id: string;
    topic: string;
    keywords: string[];
    relatedAgents: string[];
    firstMentioned: number;
    lastMentioned: number;
    relevanceScore: number;
    messageReferences: string[];
}

interface ContextFilters {
    search: string;
    status: string;
    scope: string;
    type: string;
    participant: string;
    sortBy: 'name' | 'createdAt' | 'lastActivity' | 'messageCount';
    sortOrder: 'asc' | 'desc';
}

interface ContextStats {
    totalContexts: number;
    activeContexts: number;
    inactiveContexts: number;
    archivedContexts: number;
    totalMessages: number;
    totalParticipants: number;
}

export const useContextStore = defineStore('context', () => {
    // State
    const contextEntries = ref<ContextEntry[]>([]);
    const selectedContext = ref<ContextEntry | null>(null);
    const contextMessages = ref<ContextMessage[]>([]);
    const contextTopics = ref<ConversationTopic[]>([]);
    const stats = ref<ContextStats>({
        totalContexts: 0,
        activeContexts: 0,
        inactiveContexts: 0,
        archivedContexts: 0,
        totalMessages: 0,
        totalParticipants: 0
    });

    // Filters and pagination
    const filters = ref<ContextFilters>({
        search: '',
        status: 'all',
        scope: 'all',
        type: 'all',
        participant: 'all',
        sortBy: 'lastActivity',
        sortOrder: 'desc'
    });

    const currentPage = ref(1);
    const itemsPerPage = ref(10);
    const totalContexts = ref(0);

    // Loading states
    const loadingContexts = ref(false);
    const loadingContext = ref(false);
    const loadingMessages = ref(false);
    const loadingTopics = ref(false);
    const loadingStats = ref(false);
    const savingContext = ref(false);
    const deletingContext = ref(false);
    const generatingSummary = ref(false);

    // Error state
    const error = ref<string | null>(null);

    // Computed
    const isLoading = computed(() => 
        loadingContexts.value || loadingContext.value || loadingMessages.value || 
        loadingTopics.value || loadingStats.value
    );

    const filteredContexts = computed(() => {
        let filtered = [...contextEntries.value];

        // Apply search filter
        if (filters.value.search) {
            const searchTerm = filters.value.search.toLowerCase();
            filtered = filtered.filter(context => 
                context.name.toLowerCase().includes(searchTerm) ||
                context.description.toLowerCase().includes(searchTerm) ||
                context.participants.some(p => p.toLowerCase().includes(searchTerm))
            );
        }

        // Apply status filter
        if (filters.value.status !== 'all') {
            filtered = filtered.filter(context => context.status === filters.value.status);
        }

        // Apply participant filter  
        if (filters.value.participant !== 'all') {
            filtered = filtered.filter(context => 
                context.participants.includes(filters.value.participant)
            );
        }

        // Apply sorting
        filtered.sort((a, b) => {
            let aValue: any = a[filters.value.sortBy];
            let bValue: any = b[filters.value.sortBy];
            
            // Handle timestamp values
            if (filters.value.sortBy === 'createdAt' || filters.value.sortBy === 'lastActivity') {
                aValue = new Date(aValue).getTime();
                bValue = new Date(bValue).getTime();
            }
            
            if (filters.value.sortOrder === 'asc') {
                return aValue > bValue ? 1 : -1;
            } else {
                return aValue < bValue ? 1 : -1;
            }
        });

        return filtered;
    });

    const hasContexts = computed(() => contextEntries.value.length > 0);

    // Actions
    const fetchContexts = async (channelId?: string): Promise<void> => {
        loadingContexts.value = true;
        error.value = null;
        
        try {
            // For now, we'll get all contexts and filter by channel if needed
            // In a real implementation, this might be a dedicated endpoint
            const response = await axios.get('/api/channels');
            const channels = response.data.channels || [];
            
            // Transform channel data to context entries
            const contexts: ContextEntry[] = channels.map((channel: any) => ({
                id: channel.id,
                channelId: channel.id,
                name: channel.name,
                description: channel.description || '',
                createdAt: new Date(channel.createdAt).getTime(),
                createdBy: channel.createdBy || 'system',
                lastActivity: new Date(channel.updatedAt || channel.createdAt).getTime(),
                participants: channel.participants || [],
                metadata: channel.metadata || {},
                status: channel.status || 'active',
                messageCount: channel.messageCount || 0,
                conversationSummary: channel.conversationSummary,
                updatedAt: new Date(channel.updatedAt || channel.createdAt).getTime(),
                topics: channel.topics || []
            }));

            if (channelId) {
                contextEntries.value = contexts.filter(context => context.channelId === channelId);
            } else {
                contextEntries.value = contexts;
            }
            
            totalContexts.value = contextEntries.value.length;
        } catch (err: any) {
            console.error('Failed to fetch contexts:', err);
            error.value = err.response?.data?.message || 'Failed to fetch contexts';
        } finally {
            loadingContexts.value = false;
        }
    };

    const fetchContextById = async (contextId: string): Promise<void> => {
        loadingContext.value = true;
        error.value = null;
        
        try {
            const response = await axios.get(`/api/channels/${contextId}/context`);
            const contextData = response.data;
            
            selectedContext.value = {
                id: contextData.id,
                channelId: contextData.channelId,
                name: contextData.name,
                description: contextData.description,
                createdAt: contextData.createdAt,
                createdBy: contextData.createdBy,
                lastActivity: contextData.lastActivity,
                participants: contextData.participants,
                metadata: contextData.metadata,
                status: contextData.status,
                messageCount: contextData.messageCount,
                conversationSummary: contextData.conversationSummary,
                updatedAt: contextData.updatedAt,
                topics: contextData.topics
            };
        } catch (err: any) {
            console.error('Failed to fetch context:', err);
            error.value = err.response?.data?.message || 'Failed to fetch context';
        } finally {
            loadingContext.value = false;
        }
    };

    const fetchContextMessages = async (contextId: string, limit: number = 50): Promise<void> => {
        loadingMessages.value = true;
        error.value = null;
        
        try {
            const response = await axios.get(`/api/channels/${contextId}/messages`, {
                params: { limit }
            });
            
            contextMessages.value = response.data.map((msg: any) => ({
                messageId: msg.messageId,
                content: msg.content,
                senderId: msg.senderId,
                timestamp: msg.timestamp,
                type: msg.type,
                metadata: msg.metadata,
                receiverId: msg.receiverId,
                conversationId: msg.conversationId,
                parentId: msg.parentId,
                threadId: msg.threadId
            }));
        } catch (err: any) {
            console.error('Failed to fetch context messages:', err);
            error.value = err.response?.data?.message || 'Failed to fetch context messages';
        } finally {
            loadingMessages.value = false;
        }
    };

    const fetchContextTopics = async (contextId: string): Promise<void> => {
        loadingTopics.value = true;
        error.value = null;
        
        try {
            const response = await axios.post(`/api/channels/${contextId}/topics`);
            contextTopics.value = response.data.topics || [];
        } catch (err: any) {
            console.error('Failed to fetch context topics:', err);
            error.value = err.response?.data?.message || 'Failed to fetch context topics';
        } finally {
            loadingTopics.value = false;
        }
    };

    const generateContextSummary = async (contextId: string): Promise<string> => {
        generatingSummary.value = true;
        error.value = null;
        
        try {
            const response = await axios.post(`/api/channels/${contextId}/summary`);
            const summary = response.data.summary || '';
            
            // Update the context entry with the new summary
            const contextIndex = contextEntries.value.findIndex(c => c.id === contextId);
            if (contextIndex !== -1) {
                contextEntries.value[contextIndex].conversationSummary = summary;
            }
            
            if (selectedContext.value?.id === contextId) {
                selectedContext.value.conversationSummary = summary;
            }
            
            return summary;
        } catch (err: any) {
            console.error('Failed to generate context summary:', err);
            error.value = err.response?.data?.message || 'Failed to generate context summary';
            throw err;
        } finally {
            generatingSummary.value = false;
        }
    };

    const saveContext = async (contextData: Partial<ContextEntry>): Promise<void> => {
        savingContext.value = true;
        error.value = null;
        
        try {
            if (contextData.id) {
                // Update existing context
                const response = await axios.patch(`/api/channels/${contextData.id}/context`, {
                    name: contextData.name,
                    description: contextData.description,
                    metadata: contextData.metadata,
                    status: contextData.status
                });
                
                // Update in contexts list
                const index = contextEntries.value.findIndex(c => c.id === contextData.id);
                if (index !== -1) {
                    contextEntries.value[index] = { ...contextEntries.value[index], ...response.data };
                }
                
                // Update selected context if it's the same
                if (selectedContext.value?.id === contextData.id) {
                    selectedContext.value = { ...selectedContext.value, ...response.data };
                }
            } else {
                // Create new context (this would need a channel ID)
                if (!contextData.channelId) {
                    throw new Error('Channel ID is required to create new context');
                }
                
                const response = await axios.post(`/api/channels/${contextData.channelId}/context`, {
                    name: contextData.name,
                    description: contextData.description,
                    creatorId: contextData.createdBy || 'system'
                });
                
                const newContext: ContextEntry = {
                    id: response.data.id,
                    channelId: response.data.channelId,
                    name: response.data.name,
                    description: response.data.description,
                    createdAt: response.data.createdAt,
                    createdBy: response.data.createdBy,
                    lastActivity: response.data.lastActivity,
                    participants: response.data.participants,
                    metadata: response.data.metadata,
                    status: response.data.status,
                    messageCount: response.data.messageCount,
                    conversationSummary: response.data.conversationSummary,
                    updatedAt: response.data.updatedAt,
                    topics: response.data.topics
                };
                
                contextEntries.value.unshift(newContext);
                totalContexts.value++;
            }
        } catch (err: any) {
            console.error('Failed to save context:', err);
            error.value = err.response?.data?.message || 'Failed to save context';
            throw err;
        } finally {
            savingContext.value = false;
        }
    };

    const deleteContext = async (contextId: string): Promise<void> => {
        deletingContext.value = true;
        error.value = null;
        
        try {
            // Note: There's no direct delete context endpoint visible, 
            // this might need to be implemented as archiving the context
            await axios.patch(`/api/channels/${contextId}/context`, {
                status: 'archived'
            });
            
            // Remove from contexts list or mark as archived
            const index = contextEntries.value.findIndex(c => c.id === contextId);
            if (index !== -1) {
                contextEntries.value[index].status = 'archived';
            }
            
            // Clear selected context if it's the same
            if (selectedContext.value?.id === contextId) {
                selectedContext.value = null;
            }
        } catch (err: any) {
            console.error('Failed to delete context:', err);
            error.value = err.response?.data?.message || 'Failed to delete context';
            throw err;
        } finally {
            deletingContext.value = false;
        }
    };

    const exportContexts = async (): Promise<void> => {
        try {
            const csvContent = generateCSVContent();
            downloadCSV(csvContent, `contexts-${new Date().toISOString().split('T')[0]}.csv`);
        } catch (err: any) {
            console.error('Failed to export contexts:', err);
            error.value = 'Failed to export contexts';
        }
    };

    // Helper function to generate CSV content
    const generateCSVContent = (): string => {
        const headers = [
            'ID', 'Name', 'Description', 'Status', 'Created At', 'Last Activity',
            'Participants', 'Message Count', 'Summary'
        ];
        
        const csvRows = [headers.join(',')];
        
        contextEntries.value.forEach(context => {
            const row = [
                `"${context.id}"`,
                `"${context.name}"`,
                `"${context.description}"`,
                `"${context.status}"`,
                `"${new Date(context.createdAt).toISOString()}"`,
                `"${new Date(context.lastActivity).toISOString()}"`,
                `"${context.participants.join('; ')}"`,
                context.messageCount.toString(),
                `"${context.conversationSummary || ''}"`
            ];
            csvRows.push(row.join(','));
        });
        
        return csvRows.join('\n');
    };

    // Helper function to download CSV
    const downloadCSV = (content: string, filename: string): void => {
        const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', filename);
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.URL.revokeObjectURL(url);
    };

    const refreshContexts = async (): Promise<void> => {
        await fetchContexts();
        await fetchContextStats();
    };

    const fetchContextStats = async (): Promise<void> => {
        loadingStats.value = true;
        error.value = null;
        
        try {
            // Calculate stats from current contexts
            const total = contextEntries.value.length;
            const active = contextEntries.value.filter(c => c.status === 'active').length;
            const inactive = contextEntries.value.filter(c => c.status === 'inactive').length;
            const archived = contextEntries.value.filter(c => c.status === 'archived').length;
            const totalMessages = contextEntries.value.reduce((sum, c) => sum + c.messageCount, 0);
            const allParticipants = new Set();
            contextEntries.value.forEach(c => {
                c.participants.forEach(p => allParticipants.add(p));
            });
            
            stats.value = {
                totalContexts: total,
                activeContexts: active,
                inactiveContexts: inactive,
                archivedContexts: archived,
                totalMessages,
                totalParticipants: allParticipants.size
            };
        } catch (err: any) {
            console.error('Failed to fetch context stats:', err);
            error.value = err.response?.data?.message || 'Failed to fetch context stats';
        } finally {
            loadingStats.value = false;
        }
    };

    const setFilters = (newFilters: Partial<ContextFilters>): void => {
        Object.assign(filters.value, newFilters);
        currentPage.value = 1; // Reset to first page when filters change
    };

    const setPage = (page: number): void => {
        currentPage.value = page;
    };

    const clearError = (): void => {
        error.value = null;
    };

    const clearContexts = (): void => {
        contextEntries.value = [];
        selectedContext.value = null;
        contextMessages.value = [];
        contextTopics.value = [];
        totalContexts.value = 0;
    };

    return {
        // State
        contextEntries,
        selectedContext,
        contextMessages,
        contextTopics,
        stats,
        filters,
        currentPage,
        itemsPerPage,
        totalContexts,
        
        // Loading states
        loadingContexts,
        loadingContext,
        loadingMessages,
        loadingTopics,
        loadingStats,
        savingContext,
        deletingContext,
        generatingSummary,
        isLoading,
        
        // Error state
        error,
        
        // Computed
        filteredContexts,
        hasContexts,
        
        // Actions
        fetchContexts,
        fetchContextById,
        fetchContextMessages,
        fetchContextTopics,
        generateContextSummary,
        saveContext,
        deleteContext,
        exportContexts,
        refreshContexts,
        fetchContextStats,
        setFilters,
        setPage,
        clearError,
        clearContexts
    };
});
