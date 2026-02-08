/**
 * ORPAR Control Loop Pinia Store
 *
 * State management for ORPAR (Observation, Reasoning, Planning, Action, Reflection)
 * control loop visualization in the dashboard.
 */

import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import axios from '../plugins/axios';

// Types
export type OrparPhase = 'observation' | 'reasoning' | 'plan' | 'reflection' | null;

export interface OrparStatus {
    enabled: boolean;
    activeLoops: number;
    activeAgents: number;
    cognitiveMemoryCount: number;
    phaseCounts: {
        observations: number;
        reasonings: number;
        plans: number;
        reflections: number;
    };
}

export interface ActiveLoop {
    agentId: string;
    agentName: string;
    channelId: string;
    currentPhase: OrparPhase;
    lastActivity: string;
    phaseCount: number;
    status: string;
}

export interface AgentOrparState {
    agentId: string;
    agentName: string;
    channelId: string | null;
    currentPhase: OrparPhase;
    lastPhaseTime: string;
    phaseCounts: {
        observation: number;
        reasoning: number;
        plan: number;
        reflection: number;
    };
    estimatedCycles: number;
    status: string;
}

export interface PhaseTransition {
    id: string;
    phase: OrparPhase;
    summary: string;
    channelId: string;
    timestamp: string;
}

export interface OrparAgent {
    agentId: string;
    agentName: string;
    status: string;
    lastActivity: string;
    totalEntries: number;
    phasesUsed: OrparPhase[];
}

export interface PhaseEntry {
    id: string;
    agentId: string;
    agentName: string;
    channelId: string;
    content: any;
    createdAt: string;
}

export const useOrparStore = defineStore('orpar', () => {
    // State
    const status = ref<OrparStatus | null>(null);
    const activeLoops = ref<ActiveLoop[]>([]);
    const selectedAgentState = ref<AgentOrparState | null>(null);
    const phaseHistory = ref<PhaseTransition[]>([]);
    const observations = ref<any[]>([]);
    const orparAgents = ref<OrparAgent[]>([]);
    const phaseEntries = ref<PhaseEntry[]>([]);

    const loading = ref(false);
    const error = ref<string | null>(null);

    // Computed
    const totalActiveLoops = computed(() => status.value?.activeLoops || 0);
    const totalCognitiveMemory = computed(() => status.value?.cognitiveMemoryCount || 0);

    // Actions
    const fetchStatus = async () => {
        loading.value = true;
        error.value = null;
        try {
            const response = await axios.get('/api/orpar/status');
            status.value = response.data.status;
            return response.data.status;
        } catch (err: any) {
            error.value = err.response?.data?.message || err.message || 'Failed to fetch ORPAR status';
            throw err;
        } finally {
            loading.value = false;
        }
    };

    const fetchActiveLoops = async () => {
        loading.value = true;
        error.value = null;
        try {
            const response = await axios.get('/api/orpar/active');
            activeLoops.value = response.data.activeLoops;
            return response.data;
        } catch (err: any) {
            error.value = err.response?.data?.message || err.message || 'Failed to fetch active loops';
            throw err;
        } finally {
            loading.value = false;
        }
    };

    const fetchAgentState = async (agentId: string, channelId?: string) => {
        loading.value = true;
        error.value = null;
        try {
            const response = await axios.get(`/api/orpar/state/${agentId}`, {
                params: channelId ? { channelId } : {}
            });
            selectedAgentState.value = response.data.state;
            return response.data.state;
        } catch (err: any) {
            error.value = err.response?.data?.message || err.message || 'Failed to fetch agent state';
            throw err;
        } finally {
            loading.value = false;
        }
    };

    const fetchPhaseHistory = async (agentId: string, channelId?: string, limit: number = 50) => {
        loading.value = true;
        error.value = null;
        try {
            const response = await axios.get(`/api/orpar/history/${agentId}`, {
                params: { channelId, limit }
            });
            phaseHistory.value = response.data.history;
            return response.data;
        } catch (err: any) {
            error.value = err.response?.data?.message || err.message || 'Failed to fetch phase history';
            throw err;
        } finally {
            loading.value = false;
        }
    };

    const fetchObservations = async (agentId: string, channelId?: string, limit: number = 20) => {
        loading.value = true;
        error.value = null;
        try {
            const response = await axios.get(`/api/orpar/observations/${agentId}`, {
                params: { channelId, limit }
            });
            observations.value = response.data.observations;
            return response.data;
        } catch (err: any) {
            error.value = err.response?.data?.message || err.message || 'Failed to fetch observations';
            throw err;
        } finally {
            loading.value = false;
        }
    };

    const fetchOrparAgents = async () => {
        loading.value = true;
        error.value = null;
        try {
            const response = await axios.get('/api/orpar/agents');
            orparAgents.value = response.data.agents;
            return response.data;
        } catch (err: any) {
            error.value = err.response?.data?.message || err.message || 'Failed to fetch ORPAR agents';
            throw err;
        } finally {
            loading.value = false;
        }
    };

    const fetchPhaseEntries = async (phase: string, agentId?: string, channelId?: string, limit: number = 50) => {
        loading.value = true;
        error.value = null;
        try {
            const response = await axios.get(`/api/orpar/phases/${phase}`, {
                params: { agentId, channelId, limit }
            });
            phaseEntries.value = response.data.entries;
            return response.data;
        } catch (err: any) {
            error.value = err.response?.data?.message || err.message || 'Failed to fetch phase entries';
            throw err;
        } finally {
            loading.value = false;
        }
    };

    const loadAllData = async () => {
        loading.value = true;
        error.value = null;
        try {
            await Promise.all([
                fetchStatus(),
                fetchActiveLoops(),
                fetchOrparAgents()
            ]);
        } catch (err: any) {
            error.value = err.response?.data?.message || err.message || 'Failed to load ORPAR data';
            throw err;
        } finally {
            loading.value = false;
        }
    };

    const clearSelection = () => {
        selectedAgentState.value = null;
        phaseHistory.value = [];
        observations.value = [];
    };

    const reset = () => {
        status.value = null;
        activeLoops.value = [];
        selectedAgentState.value = null;
        phaseHistory.value = [];
        observations.value = [];
        orparAgents.value = [];
        phaseEntries.value = [];
        loading.value = false;
        error.value = null;
    };

    return {
        // State
        status,
        activeLoops,
        selectedAgentState,
        phaseHistory,
        observations,
        orparAgents,
        phaseEntries,
        loading,
        error,

        // Computed
        totalActiveLoops,
        totalCognitiveMemory,

        // Actions
        fetchStatus,
        fetchActiveLoops,
        fetchAgentState,
        fetchPhaseHistory,
        fetchObservations,
        fetchOrparAgents,
        fetchPhaseEntries,
        loadAllData,
        clearSelection,
        reset
    };
});
