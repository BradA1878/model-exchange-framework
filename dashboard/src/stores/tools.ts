import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import axios from '../plugins/axios';

// Tool interface based on hybrid MCP API response shape
export interface McpTool {
    name: string;
    description: string;
    category: string;
    type: 'internal' | 'external';
    source: string;
    enabled: boolean;
    scope: 'global' | 'channel' | 'agent';
    scopeId?: string;
    inputSchema?: Record<string, any>;
    serverId?: string;
    availableToChannels?: string[];
}

// MCP Server status interface matching ExternalServerStatus from server
export interface McpServerStatus {
    id: string;
    name: string;
    status: 'stopped' | 'starting' | 'running' | 'error' | 'restarting';
    pid?: number;
    uptime?: number;
    restartCount: number;
    lastError?: string;
    lastHealthCheck?: number;
    initialized?: boolean;
    tools: Array<{
        name: string;
        description: string;
        inputSchema: Record<string, any>;
    }>;
}

// Server registration config for HTTP API
export interface McpServerRegisterConfig {
    id: string;
    name: string;
    version?: string;
    transport: 'stdio' | 'http';
    command?: string;
    args?: string[];
    url?: string;
    autoStart?: boolean;
    restartOnCrash?: boolean;
    maxRestartAttempts?: number;
    healthCheckInterval?: number;
    startupTimeout?: number;
    environmentVariables?: Record<string, string>;
}

export const useToolsStore = defineStore('tools', () => {
    // State - Tools
    const tools = ref<McpTool[]>([]);
    const loading = ref(false);
    const error = ref<string | null>(null);

    // State - MCP Servers
    const mcpServers = ref<McpServerStatus[]>([]);
    const serversLoading = ref(false);
    const serversError = ref<string | null>(null);
    const serverActionLoading = ref<Record<string, boolean>>({});

    // Computed stats
    const toolStats = computed(() => ({
        total: tools.value.length,
        active: tools.value.filter(t => t.enabled).length,
        disabled: tools.value.filter(t => !t.enabled).length,
        internal: tools.value.filter(t => t.type === 'internal').length,
        external: tools.value.filter(t => t.type === 'external').length
    }));

    // Unique categories extracted from tools data
    const categories = computed(() => {
        const cats = new Set(tools.value.map(t => t.category).filter(Boolean));
        return Array.from(cats).sort();
    });

    // Computed stats for MCP servers
    const serverStats = computed(() => ({
        total: mcpServers.value.length,
        running: mcpServers.value.filter(s => s.status === 'running').length,
        stopped: mcpServers.value.filter(s => s.status === 'stopped').length,
        error: mcpServers.value.filter(s => s.status === 'error').length,
        totalTools: mcpServers.value.reduce((sum, s) => sum + s.tools.length, 0)
    }));

    // Fetch all tools from hybrid MCP endpoint (internal + external unified)
    const fetchTools = async (): Promise<void> => {
        loading.value = true;
        error.value = null;
        try {
            const response = await axios.get('/api/hybrid-mcp/tools');
            if (response.data.success) {
                const data = response.data.data;
                // The hybrid endpoint returns { internal: [], external: [], all: [] }
                // Use the combined 'all' array for the full unified list
                const allTools = data.all || [...(data.internal || []), ...(data.external || [])];
                tools.value = allTools.map((tool: any) => ({
                    name: tool.name,
                    description: tool.description || '',
                    category: tool.category || 'uncategorized',
                    type: tool.isExternal ? 'external' : 'internal',
                    source: tool.source || 'internal',
                    enabled: tool.enabled !== false,
                    scope: tool.scope || 'global',
                    scopeId: tool.scopeId,
                    inputSchema: tool.inputSchema,
                    serverId: tool.serverId,
                    availableToChannels: tool.availableToChannels
                }));
            } else {
                throw new Error(response.data.message || 'Failed to fetch tools');
            }
        } catch (err: any) {
            console.error('Failed to fetch tools:', err);
            error.value = err.response?.data?.message || 'Failed to fetch tools';
            tools.value = [];
        } finally {
            loading.value = false;
        }
    };

    // Fetch from basic MCP tools endpoint (internal only, fallback)
    const fetchMcpTools = async (): Promise<void> => {
        loading.value = true;
        error.value = null;
        try {
            const response = await axios.get('/api/mcp/tools');
            if (response.data.success) {
                tools.value = (response.data.data || []).map((tool: any) => ({
                    name: tool.name,
                    description: tool.description || '',
                    category: tool.metadata?.category || 'uncategorized',
                    type: 'internal' as const,
                    source: 'internal',
                    enabled: true,
                    scope: 'global' as const,
                    inputSchema: tool.inputSchema
                }));
            } else {
                throw new Error(response.data.message || 'Failed to fetch MCP tools');
            }
        } catch (err: any) {
            console.error('Failed to fetch MCP tools:', err);
            error.value = err.response?.data?.message || 'Failed to fetch MCP tools';
            tools.value = [];
        } finally {
            loading.value = false;
        }
    };

    const clearError = (): void => {
        error.value = null;
    };

    const clearServersError = (): void => {
        serversError.value = null;
    };

    // Fetch all MCP servers from hybrid MCP endpoint
    const fetchMcpServers = async (): Promise<void> => {
        serversLoading.value = true;
        serversError.value = null;
        try {
            const response = await axios.get('/api/hybrid-mcp/servers');
            if (response.data.success) {
                // API returns { data: { serverId: status, ... } } as a map
                const serversMap = response.data.data || {};
                mcpServers.value = Object.entries(serversMap).map(([id, status]: [string, any]) => ({
                    id,
                    name: status.name || id,
                    status: status.status || 'stopped',
                    pid: status.pid,
                    uptime: status.uptime,
                    restartCount: status.restartCount || 0,
                    lastError: status.lastError,
                    lastHealthCheck: status.lastHealthCheck,
                    initialized: status.initialized,
                    tools: status.tools || []
                }));
            } else {
                throw new Error(response.data.message || 'Failed to fetch MCP servers');
            }
        } catch (err: any) {
            console.error('Failed to fetch MCP servers:', err);
            serversError.value = err.response?.data?.message || err.message || 'Failed to fetch MCP servers';
            mcpServers.value = [];
        } finally {
            serversLoading.value = false;
        }
    };

    // Start an MCP server
    const startServer = async (serverId: string): Promise<boolean> => {
        serverActionLoading.value[serverId] = true;
        try {
            const response = await axios.post(`/api/hybrid-mcp/servers/${serverId}/start`);
            if (response.data.success) {
                // Refresh server list to get updated status
                await fetchMcpServers();
                return true;
            } else {
                throw new Error(response.data.message || 'Failed to start server');
            }
        } catch (err: any) {
            console.error(`Failed to start server ${serverId}:`, err);
            serversError.value = err.response?.data?.message || err.message || 'Failed to start server';
            return false;
        } finally {
            serverActionLoading.value[serverId] = false;
        }
    };

    // Stop an MCP server
    const stopServer = async (serverId: string): Promise<boolean> => {
        serverActionLoading.value[serverId] = true;
        try {
            const response = await axios.post(`/api/hybrid-mcp/servers/${serverId}/stop`);
            if (response.data.success) {
                // Refresh server list to get updated status
                await fetchMcpServers();
                return true;
            } else {
                throw new Error(response.data.message || 'Failed to stop server');
            }
        } catch (err: any) {
            console.error(`Failed to stop server ${serverId}:`, err);
            serversError.value = err.response?.data?.message || err.message || 'Failed to stop server';
            return false;
        } finally {
            serverActionLoading.value[serverId] = false;
        }
    };

    // Register a new MCP server
    const registerServer = async (config: McpServerRegisterConfig): Promise<boolean> => {
        serversLoading.value = true;
        try {
            const response = await axios.post('/api/hybrid-mcp/servers/register', config);
            if (response.data.success) {
                // Refresh server list to include new server
                await fetchMcpServers();
                return true;
            } else {
                throw new Error(response.data.error || 'Failed to register server');
            }
        } catch (err: any) {
            console.error('Failed to register server:', err);
            serversError.value = err.response?.data?.error || err.message || 'Failed to register server';
            return false;
        } finally {
            serversLoading.value = false;
        }
    };

    // Unregister (delete) an MCP server
    const unregisterServer = async (serverId: string): Promise<boolean> => {
        serverActionLoading.value[serverId] = true;
        try {
            const response = await axios.delete(`/api/hybrid-mcp/servers/${serverId}`);
            if (response.data.success) {
                // Refresh server list to remove the server
                await fetchMcpServers();
                return true;
            } else {
                throw new Error(response.data.error || 'Failed to unregister server');
            }
        } catch (err: any) {
            console.error(`Failed to unregister server ${serverId}:`, err);
            serversError.value = err.response?.data?.error || err.message || 'Failed to unregister server';
            return false;
        } finally {
            serverActionLoading.value[serverId] = false;
        }
    };

    // Get server status by ID
    const getServerStatus = async (serverId: string): Promise<McpServerStatus | null> => {
        try {
            const response = await axios.get(`/api/hybrid-mcp/servers/${serverId}/status`);
            if (response.data.success) {
                return response.data.status;
            }
            return null;
        } catch (err: any) {
            console.error(`Failed to get status for server ${serverId}:`, err);
            return null;
        }
    };

    return {
        // State - Tools
        tools,
        loading,
        error,

        // State - MCP Servers
        mcpServers,
        serversLoading,
        serversError,
        serverActionLoading,

        // Computed - Tools
        toolStats,
        categories,

        // Computed - Servers
        serverStats,

        // Actions - Tools
        fetchTools,
        fetchMcpTools,
        clearError,

        // Actions - Servers
        fetchMcpServers,
        startServer,
        stopServer,
        registerServer,
        unregisterServer,
        getServerStatus,
        clearServersError
    };
});
