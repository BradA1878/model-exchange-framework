import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import axios from '../plugins/axios';

export interface MemoryEntry {
    id: string;
    content: string;
    type: string;
    importance: string;
    createdAt: Date;
    updatedAt: Date;
    tags: string[];
    source: string;
}

export interface ChannelMemory {
    channelId: string;
    notes: Record<string, any>;
    sharedState: Record<string, any>;
    conversationHistory: any[];
    customData: Record<string, any>;
    updatedAt: Date;
}

export const useMemoryStore = defineStore('memory', () => {
    // State
    const channelMemory = ref<ChannelMemory | null>(null);
    const memories = ref<MemoryEntry[]>([]);
    const isLoading = ref(false);
    const error = ref<string | null>(null);

    // Getters
    const memoryCount = computed(() => memories.value.length);
    const importantMemories = computed(() => 
        memories.value.filter(m => m.importance === 'high')
    );
    const recentMemories = computed(() => 
        memories.value
            .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
            .slice(0, 10)
    );

    // Actions
    const fetchChannelMemory = async (channelId: string): Promise<void> => {
        isLoading.value = true;
        error.value = null;
        
        try {
            const response = await axios.get(`/api/channels/memory/${channelId}`);
            if (response.data.success) {
                channelMemory.value = response.data.data;
                // Convert shared memory into MemoryEntry format for display
                convertSharedMemoryToEntries();
            } else {
                throw new Error(response.data.message || 'Failed to fetch channel memory');
            }
        } catch (err: any) {
            error.value = err.response?.data?.message || err.message || 'Failed to fetch channel memory';
            console.error('Error fetching channel memory:', err);
        } finally {
            isLoading.value = false;
        }
    };

    const updateChannelMemory = async (channelId: string, updates: Partial<ChannelMemory>): Promise<void> => {
        isLoading.value = true;
        error.value = null;
        
        try {
            const response = await axios.patch(`/api/channels/memory/${channelId}`, updates);
            if (response.data.success) {
                channelMemory.value = response.data.data;
                convertSharedMemoryToEntries();
            } else {
                throw new Error(response.data.message || 'Failed to update channel memory');
            }
        } catch (err: any) {
            error.value = err.response?.data?.message || err.message || 'Failed to update channel memory';
            console.error('Error updating channel memory:', err);
            throw err;
        } finally {
            isLoading.value = false;
        }
    };

    const addMemoryEntry = async (channelId: string, entry: {
        content: string;
        type: string;
        importance: string;
        tags: string[];
        source: string;
    }): Promise<void> => {
        const memoryId = `memory_${Date.now()}`;
        const newEntry = {
            [memoryId]: {
                content: entry.content,
                type: entry.type,
                importance: entry.importance,
                tags: entry.tags,
                source: entry.source,
                createdAt: new Date(),
                updatedAt: new Date()
            }
        };

        await updateChannelMemory(channelId, {
            customData: {
                ...channelMemory.value?.customData,
                ...newEntry
            }
        });
    };

    const deleteMemoryEntry = async (channelId: string, memoryId: string): Promise<void> => {
        if (!channelMemory.value?.customData) return;

        // Send null for the deleted key so the server removes it during merge
        await updateChannelMemory(channelId, {
            customData: { [memoryId]: null }
        });
    };

    // Helper function to convert shared memory structure to MemoryEntry array
    const convertSharedMemoryToEntries = (): void => {
        if (!channelMemory.value) {
            memories.value = [];
            return;
        }

        const entries: MemoryEntry[] = [];

        // Convert notes to memory entries
        Object.entries(channelMemory.value.notes || {}).forEach(([key, value]) => {
            entries.push({
                id: `note_${key}`,
                content: typeof value === 'string' ? value : JSON.stringify(value),
                type: 'note',
                importance: 'medium',
                createdAt: new Date(),
                updatedAt: new Date(),
                tags: ['note'],
                source: 'channel'
            });
        });

        // Convert custom data to memory entries
        Object.entries(channelMemory.value.customData || {}).forEach(([key, value]) => {
            if (typeof value === 'object' && value.content) {
                entries.push({
                    id: key,
                    content: value.content,
                    type: value.type || 'general',
                    importance: value.importance || 'medium',
                    createdAt: new Date(value.createdAt || Date.now()),
                    updatedAt: new Date(value.updatedAt || Date.now()),
                    tags: value.tags || [],
                    source: value.source || 'channel'
                });
            }
        });

        // Convert conversation history to memory entries
        channelMemory.value.conversationHistory?.forEach((message, index) => {
            entries.push({
                id: `conversation_${index}`,
                content: typeof message === 'string' ? message : JSON.stringify(message),
                type: 'conversation',
                importance: 'low',
                createdAt: new Date(),
                updatedAt: new Date(),
                tags: ['conversation'],
                source: 'channel'
            });
        });

        memories.value = entries;
    };

    const clearMemory = (): void => {
        channelMemory.value = null;
        memories.value = [];
        error.value = null;
    };

    return {
        // State
        channelMemory,
        memories,
        isLoading,
        error,
        
        // Getters
        memoryCount,
        importantMemories,
        recentMemories,
        
        // Actions
        fetchChannelMemory,
        updateChannelMemory,
        addMemoryEntry,
        deleteMemoryEntry,
        clearMemory
    };
});
