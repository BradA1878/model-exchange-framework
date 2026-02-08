/**
 * Memory Browser Pinia Store
 *
 * State management for browsing and searching memories across scopes.
 * Provides access to agent, channel, and relationship memories.
 */

import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import axios from '../plugins/axios';

// Types
export interface MemoryOverview {
    counts: {
        agentMemories: number;
        channelMemories: number;
        relationshipMemories: number;
        total: number;
    };
    qValueStats: {
        agent: {
            avgQValue: number;
            maxQValue: number;
            totalRetrievals: number;
        };
        channel: {
            avgQValue: number;
            maxQValue: number;
            totalRetrievals: number;
        };
    };
    recentActivity: {
        agentMemories: Array<{ agentId: string; updatedAt: number }>;
        channelMemories: Array<{ channelId: string; updatedAt: number }>;
    };
}

export interface AgentMemorySummary {
    id: string;
    agentId: string;
    agentName: string;
    persistenceLevel: string;
    qValue: number;
    retrievalCount: number;
    lastMessage?: string;
    createdAt: number;
    updatedAt: number;
}

export interface AgentMemoryDetail {
    id: string;
    agentId: string;
    agentName: string;
    persistenceLevel: string;
    notes: Record<string, any>;
    customData: Record<string, any>;
    conversationHistory: any[];
    cognitiveMemory: {
        observationIds: string[];
        reasoningIds: string[];
        planIds: string[];
        reflectionIds: string[];
    };
    utility: {
        qValue: number;
        retrievalCount: number;
        successCount: number;
        failureCount: number;
    };
    createdAt: number;
    updatedAt: number;
}

export interface ChannelMemorySummary {
    id: string;
    channelId: string;
    channelName: string;
    persistenceLevel: string;
    qValue: number;
    retrievalCount: number;
    sharedStateKeys: string[];
    createdAt: number;
    updatedAt: number;
}

export interface ChannelMemoryDetail {
    id: string;
    channelId: string;
    channelName: string;
    persistenceLevel: string;
    notes: Record<string, any>;
    sharedState: Record<string, any>;
    customData: Record<string, any>;
    conversationHistory: any[];
    sharedCognitiveInsights: {
        systemSummaries: any[];
        topicExtractions: any[];
        collaborativeReflections: any[];
    };
    utility: {
        qValue: number;
        retrievalCount: number;
        successCount: number;
        failureCount: number;
    };
    createdAt: number;
    updatedAt: number;
}

export interface RelationshipMemorySummary {
    id: string;
    agentId1: string;
    agent1Name: string;
    agentId2: string;
    agent2Name: string;
    channelId?: string;
    interactionCount: number;
    lastInteraction?: any;
    createdAt: number;
    updatedAt: number;
}

export interface CognitiveMemory {
    summary: {
        observationCount: number;
        reasoningCount: number;
        planCount: number;
        reflectionCount: number;
    };
    observations: Array<{ id: string; content: any; createdAt: number }>;
    reasonings: Array<{ id: string; content: any; createdAt: number }>;
    plans: Array<{ id: string; content: any; createdAt: number }>;
    reflections: Array<{ id: string; content: any; createdAt: number }>;
}

export interface HighUtilityMemory {
    id: string;
    scope: 'agent' | 'channel';
    identifier: string;
    qValue: number;
    retrievalCount: number;
    successCount: number;
    updatedAt: number;
}

export const useMemoryBrowserStore = defineStore('memoryBrowser', () => {
    // State
    const overview = ref<MemoryOverview | null>(null);
    const agentMemories = ref<AgentMemorySummary[]>([]);
    const channelMemories = ref<ChannelMemorySummary[]>([]);
    const relationshipMemories = ref<RelationshipMemorySummary[]>([]);
    const selectedAgentMemory = ref<AgentMemoryDetail | null>(null);
    const selectedChannelMemory = ref<ChannelMemoryDetail | null>(null);
    const cognitiveMemory = ref<CognitiveMemory | null>(null);
    const highUtilityMemories = ref<HighUtilityMemory[]>([]);
    const searchResults = ref<any>(null);

    const loading = ref(false);
    const error = ref<string | null>(null);

    // Computed
    const totalMemories = computed(() => overview.value?.counts.total || 0);

    // Actions
    const fetchOverview = async () => {
        loading.value = true;
        error.value = null;
        try {
            const response = await axios.get('/api/memory-browser/overview');
            overview.value = response.data.overview;
            return response.data.overview;
        } catch (err: any) {
            error.value = err.response?.data?.message || err.message || 'Failed to fetch overview';
            throw err;
        } finally {
            loading.value = false;
        }
    };

    const fetchAgentMemories = async (limit: number = 50) => {
        loading.value = true;
        error.value = null;
        try {
            const response = await axios.get('/api/memory-browser/agents', { params: { limit } });
            agentMemories.value = response.data.agentMemories;
            return response.data;
        } catch (err: any) {
            error.value = err.response?.data?.message || err.message || 'Failed to fetch agent memories';
            throw err;
        } finally {
            loading.value = false;
        }
    };

    const fetchAgentMemoryDetail = async (agentId: string) => {
        loading.value = true;
        error.value = null;
        try {
            const response = await axios.get(`/api/memory-browser/agents/${agentId}`);
            selectedAgentMemory.value = response.data.memory;
            return response.data.memory;
        } catch (err: any) {
            error.value = err.response?.data?.message || err.message || 'Failed to fetch agent memory';
            throw err;
        } finally {
            loading.value = false;
        }
    };

    const fetchChannelMemories = async (limit: number = 50) => {
        loading.value = true;
        error.value = null;
        try {
            const response = await axios.get('/api/memory-browser/channels', { params: { limit } });
            channelMemories.value = response.data.channelMemories;
            return response.data;
        } catch (err: any) {
            error.value = err.response?.data?.message || err.message || 'Failed to fetch channel memories';
            throw err;
        } finally {
            loading.value = false;
        }
    };

    const fetchChannelMemoryDetail = async (channelId: string) => {
        loading.value = true;
        error.value = null;
        try {
            const response = await axios.get(`/api/memory-browser/channels/${channelId}`);
            selectedChannelMemory.value = response.data.memory;
            return response.data.memory;
        } catch (err: any) {
            error.value = err.response?.data?.message || err.message || 'Failed to fetch channel memory';
            throw err;
        } finally {
            loading.value = false;
        }
    };

    const fetchRelationshipMemories = async (limit: number = 50) => {
        loading.value = true;
        error.value = null;
        try {
            const response = await axios.get('/api/memory-browser/relationships', { params: { limit } });
            relationshipMemories.value = response.data.relationshipMemories;
            return response.data;
        } catch (err: any) {
            error.value = err.response?.data?.message || err.message || 'Failed to fetch relationship memories';
            throw err;
        } finally {
            loading.value = false;
        }
    };

    const fetchCognitiveMemory = async (agentId: string, channelId?: string) => {
        loading.value = true;
        error.value = null;
        try {
            const response = await axios.get(`/api/memory-browser/cognitive/${agentId}`, {
                params: channelId ? { channelId } : {}
            });
            cognitiveMemory.value = response.data.cognitiveMemory;
            return response.data;
        } catch (err: any) {
            error.value = err.response?.data?.message || err.message || 'Failed to fetch cognitive memory';
            throw err;
        } finally {
            loading.value = false;
        }
    };

    const fetchHighUtility = async (scope: string = 'all', limit: number = 20) => {
        loading.value = true;
        error.value = null;
        try {
            const response = await axios.get('/api/memory-browser/high-utility', { params: { scope, limit } });
            highUtilityMemories.value = response.data.memories;
            return response.data;
        } catch (err: any) {
            error.value = err.response?.data?.message || err.message || 'Failed to fetch high-utility memories';
            throw err;
        } finally {
            loading.value = false;
        }
    };

    const searchMemories = async (query: string, scope: string = 'all', limit: number = 20) => {
        loading.value = true;
        error.value = null;
        try {
            const response = await axios.get('/api/memory-browser/search', { params: { q: query, scope, limit } });
            searchResults.value = response.data;
            return response.data;
        } catch (err: any) {
            error.value = err.response?.data?.message || err.message || 'Failed to search memories';
            throw err;
        } finally {
            loading.value = false;
        }
    };

    const clearSelection = () => {
        selectedAgentMemory.value = null;
        selectedChannelMemory.value = null;
        cognitiveMemory.value = null;
    };

    const reset = () => {
        overview.value = null;
        agentMemories.value = [];
        channelMemories.value = [];
        relationshipMemories.value = [];
        selectedAgentMemory.value = null;
        selectedChannelMemory.value = null;
        cognitiveMemory.value = null;
        highUtilityMemories.value = [];
        searchResults.value = null;
        loading.value = false;
        error.value = null;
    };

    return {
        // State
        overview,
        agentMemories,
        channelMemories,
        relationshipMemories,
        selectedAgentMemory,
        selectedChannelMemory,
        cognitiveMemory,
        highUtilityMemories,
        searchResults,
        loading,
        error,

        // Computed
        totalMemories,

        // Actions
        fetchOverview,
        fetchAgentMemories,
        fetchAgentMemoryDetail,
        fetchChannelMemories,
        fetchChannelMemoryDetail,
        fetchRelationshipMemories,
        fetchCognitiveMemory,
        fetchHighUtility,
        searchMemories,
        clearSelection,
        reset
    };
});
