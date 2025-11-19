import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import axios from 'axios';

// Types based on backend Agent model
interface Agent {
    id: string;
    agentId: string;
    name: string;
    description?: string;
    type: string;
    serviceTypes: string[];
    capabilities: string[];
    status: 'ACTIVE' | 'IDLE' | 'BUSY' | 'OFFLINE' | 'ERROR';
    version: string;
    lastActive: Date;
    performance?: {
        tasksCompleted: number;
        averageResponseTime: number;
        uptime: number;
        errorRate: number;
    };
    metadata?: Record<string, any>;
    createdAt: Date;
    updatedAt: Date;
}

interface AgentFilters {
    search: string;
    status: string;
    type: string;
    serviceType: string;
    sortBy: 'name' | 'status' | 'lastActive' | 'performance';
    sortOrder: 'asc' | 'desc';
}

interface AgentStats {
    total: number;
    active: number;
    idle: number;
    busy: number;
    offline: number;
    error: number;
    averagePerformance: number;
}

export const useAgentsStore = defineStore('agents', () => {
    // State
    const agents = ref<Agent[]>([]);
    const selectedAgent = ref<Agent | null>(null);
    
    // Filters and pagination
    const filters = ref<AgentFilters>({
        search: '',
        status: 'all',
        type: 'all',
        serviceType: 'all',
        sortBy: 'lastActive',
        sortOrder: 'desc'
    });

    // Loading states
    const loadingAgents = ref(false);
    const loadingAgent = ref(false);
    const savingAgent = ref(false);
    const deletingAgent = ref(false);

    // Error state
    const error = ref<string | null>(null);

    // Computed
    const isLoading = computed(() => 
        loadingAgents.value || loadingAgent.value
    );

    const agentStats = computed((): AgentStats => {
        const total = agents.value.length;
        const active = agents.value.filter(a => a.status === 'ACTIVE').length;
        const idle = agents.value.filter(a => a.status === 'IDLE').length;
        const busy = agents.value.filter(a => a.status === 'BUSY').length;
        const offline = agents.value.filter(a => a.status === 'OFFLINE').length;
        const errorCount = agents.value.filter(a => a.status === 'ERROR').length;
        
        // Calculate average performance
        const agentsWithPerf = agents.value.filter(a => a.performance);
        const avgPerformance = agentsWithPerf.length > 0 
            ? Math.round(agentsWithPerf.reduce((sum, a) => sum + (a.performance?.uptime || 0), 0) / agentsWithPerf.length)
            : 0;

        return {
            total,
            active,
            idle,
            busy,
            offline,
            error: errorCount,
            averagePerformance: avgPerformance
        };
    });

    const filteredAgents = computed(() => {
        let filtered = [...agents.value];

        // Apply search filter
        if (filters.value.search) {
            const searchTerm = filters.value.search.toLowerCase();
            filtered = filtered.filter(agent => 
                agent.name.toLowerCase().includes(searchTerm) ||
                agent.description?.toLowerCase().includes(searchTerm) ||
                agent.capabilities.some(cap => cap.toLowerCase().includes(searchTerm)) ||
                agent.serviceTypes.some(st => st.toLowerCase().includes(searchTerm))
            );
        }

        // Apply status filter
        if (filters.value.status !== 'all') {
            filtered = filtered.filter(agent => agent.status === filters.value.status);
        }

        // Apply type filter
        if (filters.value.type !== 'all') {
            filtered = filtered.filter(agent => agent.type === filters.value.type);
        }

        // Apply service type filter
        if (filters.value.serviceType !== 'all') {
            filtered = filtered.filter(agent => 
                agent.serviceTypes.includes(filters.value.serviceType)
            );
        }

        // Apply sorting
        if (filters.value.sortBy) {
            filtered.sort((a: Agent, b: Agent) => {
                let aVal: any = a[filters.value.sortBy as keyof Agent];
                let bVal: any = b[filters.value.sortBy as keyof Agent];

                // Handle performance sorting
                if (filters.value.sortBy === 'performance') {
                    aVal = a.performance?.uptime || 0;
                    bVal = b.performance?.uptime || 0;
                }

                // Handle date sorting
                if (filters.value.sortBy === 'lastActive') {
                    aVal = new Date(aVal).getTime();
                    bVal = new Date(bVal).getTime();
                }

                // Handle string sorting
                if (typeof aVal === 'string') {
                    aVal = aVal.toLowerCase();
                    bVal = bVal.toLowerCase();
                }

                const result = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
                return filters.value.sortOrder === 'desc' ? -result : result;
            });
        }

        return filtered;
    });

    // Actions
    const fetchAgents = async (): Promise<void> => {
        loadingAgents.value = true;
        error.value = null;
        
        try {
            const response = await axios.get('/api/agents');
            
            if (response.data.success) {
                // Transform backend data to match our interface
                agents.value = response.data.data.map((agent: any) => ({
                    id: agent._id || agent.id,
                    agentId: agent.agentId,
                    name: agent.name,
                    description: agent.description,
                    type: agent.type,
                    serviceTypes: agent.serviceTypes || [],
                    capabilities: agent.capabilities || [],
                    status: agent.status,
                    version: agent.version || '1.0.0',
                    lastActive: new Date(agent.lastActive),
                    performance: agent.performance || {
                        tasksCompleted: 0,
                        averageResponseTime: 0,
                        uptime: 0,
                        errorRate: 0
                    },
                    metadata: agent.metadata || {},
                    createdAt: new Date(agent.createdAt),
                    updatedAt: new Date(agent.updatedAt)
                }));
            } else {
                throw new Error(response.data.message || 'Failed to fetch agents');
            }
        } catch (err: any) {
            console.error('Failed to fetch agents:', err);
            error.value = err.response?.data?.message || 'Failed to fetch agents';
            agents.value = [];
        } finally {
            loadingAgents.value = false;
        }
    };

    const fetchAgentById = async (agentId: string): Promise<void> => {
        loadingAgent.value = true;
        error.value = null;
        
        try {
            const response = await axios.get(`/api/agents/${agentId}`);
            
            if (response.data.success) {
                selectedAgent.value = {
                    id: response.data.data._id || response.data.data.id,
                    agentId: response.data.data.agentId,
                    name: response.data.data.name,
                    description: response.data.data.description,
                    type: response.data.data.type,
                    serviceTypes: response.data.data.serviceTypes || [],
                    capabilities: response.data.data.capabilities || [],
                    status: response.data.data.status,
                    version: response.data.data.version || '1.0.0',
                    lastActive: new Date(response.data.data.lastActive),
                    performance: response.data.data.performance || {
                        tasksCompleted: 0,
                        averageResponseTime: 0,
                        uptime: 0,
                        errorRate: 0
                    },
                    metadata: response.data.data.metadata || {},
                    createdAt: new Date(response.data.data.createdAt),
                    updatedAt: new Date(response.data.data.updatedAt)
                };
            } else {
                throw new Error(response.data.message || 'Failed to fetch agent');
            }
        } catch (err: any) {
            console.error('Failed to fetch agent:', err);
            error.value = err.response?.data?.message || 'Failed to fetch agent';
            selectedAgent.value = null;
        } finally {
            loadingAgent.value = false;
        }
    };

    const createAgent = async (agentData: Partial<Agent>): Promise<void> => {
        savingAgent.value = true;
        error.value = null;
        
        try {
            const response = await axios.post('/api/agents', agentData);
            
            if (response.data.success) {
                // Add new agent to the list
                const newAgent: Agent = {
                    id: response.data.data._id || response.data.data.id,
                    agentId: response.data.data.agentId,
                    name: response.data.data.name,
                    description: response.data.data.description,
                    type: response.data.data.type,
                    serviceTypes: response.data.data.serviceTypes || [],
                    capabilities: response.data.data.capabilities || [],
                    status: response.data.data.status,
                    version: response.data.data.version || '1.0.0',
                    lastActive: new Date(response.data.data.lastActive),
                    performance: response.data.data.performance || {
                        tasksCompleted: 0,
                        averageResponseTime: 0,
                        uptime: 0,
                        errorRate: 0
                    },
                    metadata: response.data.data.metadata || {},
                    createdAt: new Date(response.data.data.createdAt),
                    updatedAt: new Date(response.data.data.updatedAt)
                };
                agents.value.push(newAgent);
            } else {
                throw new Error(response.data.message || 'Failed to create agent');
            }
        } catch (err: any) {
            console.error('Failed to create agent:', err);
            error.value = err.response?.data?.message || 'Failed to create agent';
        } finally {
            savingAgent.value = false;
        }
    };

    const updateAgent = async (agentId: string, agentData: Partial<Agent>): Promise<void> => {
        savingAgent.value = true;
        error.value = null;
        
        try {
            const response = await axios.put(`/api/agents/${agentId}`, agentData);
            
            if (response.data.success) {
                // Update agent in the list
                const index = agents.value.findIndex(a => a.agentId === agentId);
                if (index !== -1) {
                    agents.value[index] = {
                        ...agents.value[index],
                        ...response.data.data,
                        updatedAt: new Date()
                    };
                }
            } else {
                throw new Error(response.data.message || 'Failed to update agent');
            }
        } catch (err: any) {
            console.error('Failed to update agent:', err);
            error.value = err.response?.data?.message || 'Failed to update agent';
        } finally {
            savingAgent.value = false;
        }
    };

    const deleteAgent = async (agentId: string): Promise<void> => {
        deletingAgent.value = true;
        error.value = null;
        
        try {
            const response = await axios.delete(`/api/agents/${agentId}`);
            
            if (response.data.success) {
                // Remove agent from the list
                agents.value = agents.value.filter(a => a.agentId !== agentId);
                if (selectedAgent.value?.agentId === agentId) {
                    selectedAgent.value = null;
                }
            } else {
                throw new Error(response.data.message || 'Failed to delete agent');
            }
        } catch (err: any) {
            console.error('Failed to delete agent:', err);
            error.value = err.response?.data?.message || 'Failed to delete agent';
        } finally {
            deletingAgent.value = false;
        }
    };

    const refreshAgents = async (): Promise<void> => {
        await fetchAgents();
    };

    const setFilters = (newFilters: Partial<AgentFilters>): void => {
        Object.assign(filters.value, newFilters);
    };

    const clearError = (): void => {
        error.value = null;
    };

    const clearAgents = (): void => {
        agents.value = [];
        selectedAgent.value = null;
    };

    return {
        // State
        agents,
        selectedAgent,
        filters,
        
        // Loading states
        loadingAgents,
        loadingAgent,
        savingAgent,
        deletingAgent,
        isLoading,
        
        // Error state
        error,
        
        // Computed
        agentStats,
        filteredAgents,
        
        // Actions
        fetchAgents,
        fetchAgentById,
        createAgent,
        updateAgent,
        deleteAgent,
        refreshAgents,
        setFilters,
        clearError,
        clearAgents
    };
});
