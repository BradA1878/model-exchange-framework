/**
 * DAG (Directed Acyclic Graph) Pinia Store
 *
 * State management for task dependency graph visualization in the dashboard.
 * Provides access to DAG data, critical paths, and ready tasks.
 */

import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import axios from '../plugins/axios';

// Types
export interface DagNode {
    id: string;
    label: string;
    status: string;
    priority: string;
    progress: number;
    inDegree: number;
    outDegree: number;
    isReady: boolean;
    dependsOn: string[];
    blockedBy: string[];
    assignedTo?: string;
    createdAt?: number;
}

export interface DagEdge {
    id: string;
    source: string;
    target: string;
    type: string;
}

export interface DagStats {
    nodeCount: number;
    edgeCount: number;
    rootCount: number;
    leafCount: number;
    maxDepth: number;
    readyTaskCount: number;
    blockedTaskCount: number;
    completedTaskCount: number;
    inProgressCount: number;
    pendingCount: number;
}

export interface TaskDag {
    channelId: string;
    nodes: DagNode[];
    edges: DagEdge[];
    stats: DagStats;
}

export interface CriticalPathTask {
    id: string;
    title: string;
    status: string;
    priority: string;
}

export interface ReadyTask {
    id: string;
    title: string;
    description?: string;
    status: string;
    priority: string;
    assignedTo?: string;
    createdAt?: number;
    tags: string[];
}

export interface ExecutionLevel {
    id: string;
    title: string;
    status: string;
    priority: string;
}

export interface DagChannel {
    channelId: string;
    name: string;
    taskCount: number;
    withDependencies: number;
    pendingCount: number;
    completedCount: number;
    hasDag: boolean;
}

export const useDagStore = defineStore('dag', () => {
    // State
    const currentDag = ref<TaskDag | null>(null);
    const criticalPath = ref<CriticalPathTask[]>([]);
    const readyTasks = ref<ReadyTask[]>([]);
    const executionOrder = ref<ExecutionLevel[]>([]);
    const executionLevels = ref<ExecutionLevel[][]>([]);
    const dagChannels = ref<DagChannel[]>([]);
    const selectedChannelId = ref<string | null>(null);

    const loading = ref(false);
    const error = ref<string | null>(null);
    const dagEnabled = ref(false);

    // Computed
    const hasData = computed(() => currentDag.value !== null && currentDag.value.nodes.length > 0);
    const hasCriticalPath = computed(() => criticalPath.value.length > 0);
    const totalReadyTasks = ref(0);

    // Actions
    const checkStatus = async () => {
        try {
            const response = await axios.get('/api/dag/status');
            dagEnabled.value = response.data.enabled;
            return response.data;
        } catch (err: any) {
            error.value = err.response?.data?.message || err.message || 'Failed to check DAG status';
            throw err;
        }
    };

    const fetchDag = async (channelId: string) => {
        loading.value = true;
        error.value = null;
        try {
            const response = await axios.get(`/api/dag/tasks/${channelId}`);
            currentDag.value = response.data.dag;
            selectedChannelId.value = channelId;
            return response.data.dag;
        } catch (err: any) {
            error.value = err.response?.data?.message || err.message || 'Failed to fetch DAG';
            throw err;
        } finally {
            loading.value = false;
        }
    };

    const fetchCriticalPath = async (channelId: string) => {
        loading.value = true;
        error.value = null;
        try {
            const response = await axios.get(`/api/dag/critical-path/${channelId}`);
            criticalPath.value = response.data.criticalPath;
            return response.data;
        } catch (err: any) {
            error.value = err.response?.data?.message || err.message || 'Failed to fetch critical path';
            throw err;
        } finally {
            loading.value = false;
        }
    };

    const fetchReadyTasks = async (channelId: string, limit: number = 20) => {
        loading.value = true;
        error.value = null;
        try {
            const response = await axios.get(`/api/dag/ready-tasks/${channelId}`, {
                params: { limit }
            });
            readyTasks.value = response.data.readyTasks;
            totalReadyTasks.value = response.data.totalReady;
            return response.data;
        } catch (err: any) {
            error.value = err.response?.data?.message || err.message || 'Failed to fetch ready tasks';
            throw err;
        } finally {
            loading.value = false;
        }
    };

    const fetchExecutionOrder = async (channelId: string) => {
        loading.value = true;
        error.value = null;
        try {
            const response = await axios.get(`/api/dag/execution-order/${channelId}`);
            executionOrder.value = response.data.executionOrder;
            executionLevels.value = response.data.levels;
            return response.data;
        } catch (err: any) {
            error.value = err.response?.data?.message || err.message || 'Failed to fetch execution order';
            throw err;
        } finally {
            loading.value = false;
        }
    };

    const fetchDagChannels = async () => {
        loading.value = true;
        error.value = null;
        try {
            const response = await axios.get('/api/dag/channels');
            dagChannels.value = response.data.channels;
            return response.data.channels;
        } catch (err: any) {
            error.value = err.response?.data?.message || err.message || 'Failed to fetch DAG channels';
            throw err;
        } finally {
            loading.value = false;
        }
    };

    const loadAllData = async (channelId: string) => {
        loading.value = true;
        error.value = null;
        try {
            await Promise.all([
                fetchDag(channelId),
                fetchCriticalPath(channelId),
                fetchReadyTasks(channelId),
                fetchExecutionOrder(channelId)
            ]);
        } catch (err: any) {
            error.value = err.response?.data?.message || err.message || 'Failed to load DAG data';
            throw err;
        } finally {
            loading.value = false;
        }
    };

    const reset = () => {
        currentDag.value = null;
        criticalPath.value = [];
        readyTasks.value = [];
        executionOrder.value = [];
        executionLevels.value = [];
        selectedChannelId.value = null;
        loading.value = false;
        error.value = null;
        totalReadyTasks.value = 0;
    };

    return {
        // State
        currentDag,
        criticalPath,
        readyTasks,
        executionOrder,
        executionLevels,
        dagChannels,
        selectedChannelId,
        loading,
        error,
        dagEnabled,
        totalReadyTasks,

        // Computed
        hasData,
        hasCriticalPath,

        // Actions
        checkStatus,
        fetchDag,
        fetchCriticalPath,
        fetchReadyTasks,
        fetchExecutionOrder,
        fetchDagChannels,
        loadAllData,
        reset
    };
});
