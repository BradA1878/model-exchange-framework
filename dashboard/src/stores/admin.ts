import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import axios from 'axios';

// Types based on backend User model and admin API responses
interface User {
    id: string;
    email: string;
    firstName?: string;
    lastName?: string;
    company?: string;
    role: 'admin' | 'provider' | 'consumer';
    avatar?: string;
    isActive: boolean;
    lastLogin?: Date;
    createdAt: Date;
    updatedAt: Date;
}

interface AdminStats {
    totalUsers: number;
    activeUsers: number;
    totalChannels: number;
    totalAgents: number;
    totalTasks: number;
    mcpToolsCount: number;
    systemUptime: string;
    errorRate: number;
    avgResponseTime: number;
}

interface SystemHealth {
    status: 'healthy' | 'warning' | 'critical';
    services: {
        database: 'online' | 'offline' | 'degraded';
        redis: 'online' | 'offline' | 'degraded';
        socketio: 'online' | 'offline' | 'degraded';
        mcp: 'online' | 'offline' | 'degraded';
    };
    resources: {
        cpuUsage: number;
        memoryUsage: number;
        diskUsage: number;
    };
    lastChecked: Date;
}

interface UserFilters {
    search: string;
    role: string;
    status: string;
    sortBy: 'name' | 'email' | 'role' | 'lastLogin' | 'createdAt';
    sortOrder: 'asc' | 'desc';
}

interface AdminChannel {
    id: string;
    name: string;
    description: string;
    createdBy: string;
    participantCount: number;
    status: 'active' | 'inactive';
    createdAt: Date;
    updatedAt: Date;
}

interface AdminAgent {
    id: string;
    name: string;
    type: string;
    status: string;
    description: string;
    createdBy: string;
    channelId: string;
    createdAt: Date;
    updatedAt: Date;
    lastActivity?: Date;
}

interface MCPTool {
    id: string;
    name: string;
    description: string;
    category: string;
    server: string;
    version: string;
    status: string;
    executions: number;
    lastUsed?: Date;
    createdAt: Date;
}

interface ToolExecution {
    id: string;
    toolName: string;
    agentId: string;
    channelId: string;
    status: string;
    startTime: Date;
    parameters: any;
    progress: number;
}

interface TaskAnalytics {
    id: string;
    channelId: string;
    title: string;
    description: string;
    priority: string;
    status: string;
    progress: number;
    assignedAgentId: string;
    assignmentStrategy: string;
    requiredRoles: string[];
    requiredCapabilities: string[];
    tags: string[];
    createdBy: string;
    createdAt: Date;
    updatedAt: Date;
    dependsOn: string[];
    blockedBy: string[];
}

interface AuditLogEntry {
    id: string;
    eventType: string;
    agentId: string;
    timestamp: Date;
    targetAgentId?: string;
    messageType?: string;
    serviceTypes: string[];
    capabilities: string[];
    error?: string;
    metadata: any;
    createdAt: Date;
}

interface SecurityAnalytics {
    id: string;
    keyId: string;
    channelId: string;
    name: string;
    createdBy: string;
    isActive: boolean;
    lastUsed?: Date;
    createdAt: Date;
}

export const useAdminStore = defineStore('admin', () => {
    // State
    const users = ref<User[]>([]);
    const selectedUser = ref<User | null>(null);
    const channels = ref<AdminChannel[]>([]);
    const agents = ref<AdminAgent[]>([]);
    const mcpTools = ref<MCPTool[]>([]);
    const toolExecutions = ref<ToolExecution[]>([]);
    const tasks = ref<TaskAnalytics[]>([]);
    const auditLogs = ref<AuditLogEntry[]>([]);
    const securityData = ref<SecurityAnalytics[]>([]);
    
    // Analytics data state
    const taskAnalytics = ref<any>({});
    const auditLogAnalytics = ref<any>({});
    const securityAnalytics = ref<any>({});
    const channelPatterns = ref<any>({});
    const agentPatterns = ref<any>({});
    
    const loading = ref(false);
    const error = ref<string | null>(null);
    const stats = ref<AdminStats>({
        totalUsers: 0,
        activeUsers: 0,
        totalChannels: 0,
        totalAgents: 0,
        totalTasks: 0,
        mcpToolsCount: 0,
        systemUptime: '0%',
        errorRate: 0,
        avgResponseTime: 0
    });
    const systemHealth = ref<SystemHealth>({
        status: 'healthy',
        services: {
            database: 'online',
            redis: 'online',
            socketio: 'online',
            mcp: 'online'
        },
        resources: {
            cpuUsage: 0,
            memoryUsage: 0,
            diskUsage: 0
        },
        lastChecked: new Date()
    });

    // Filters
    const filters = ref<UserFilters>({
        search: '',
        role: '',
        status: '',
        sortBy: 'createdAt',
        sortOrder: 'desc'
    });

    // Computed properties
    const filteredUsers = computed(() => {
        let filtered = [...users.value];

        // Apply search filter
        if (filters.value.search) {
            const searchLower = filters.value.search.toLowerCase();
            filtered = filtered.filter(user => 
                user.email.toLowerCase().includes(searchLower) ||
                user.firstName?.toLowerCase().includes(searchLower) ||
                user.lastName?.toLowerCase().includes(searchLower) ||
                user.company?.toLowerCase().includes(searchLower)
            );
        }

        // Apply role filter
        if (filters.value.role) {
            filtered = filtered.filter(user => user.role === filters.value.role);
        }

        // Apply status filter
        if (filters.value.status) {
            const isActive = filters.value.status === 'active';
            filtered = filtered.filter(user => user.isActive === isActive);
        }

        // Apply sorting
        filtered.sort((a, b) => {
            let aVal: any;
            let bVal: any;

            switch (filters.value.sortBy) {
                case 'name':
                    aVal = `${a.firstName || ''} ${a.lastName || ''}`.trim();
                    bVal = `${b.firstName || ''} ${b.lastName || ''}`.trim();
                    break;
                case 'email':
                    aVal = a.email;
                    bVal = b.email;
                    break;
                case 'role':
                    aVal = a.role;
                    bVal = b.role;
                    break;
                case 'lastLogin':
                    aVal = a.lastLogin ? new Date(a.lastLogin).getTime() : 0;
                    bVal = b.lastLogin ? new Date(b.lastLogin).getTime() : 0;
                    break;
                case 'createdAt':
                    aVal = new Date(a.createdAt).getTime();
                    bVal = new Date(b.createdAt).getTime();
                    break;
                default:
                    aVal = a.email;
                    bVal = b.email;
            }

            if (filters.value.sortOrder === 'desc') {
                return aVal > bVal ? -1 : aVal < bVal ? 1 : 0;
            } else {
                return aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
            }
        });

        return filtered;
    });

    const userStats = computed(() => {
        const total = users.value.length;
        const active = users.value.filter(user => user.isActive).length;
        const byRole = users.value.reduce((acc: Record<string, number>, user) => {
            acc[user.role] = (acc[user.role] || 0) + 1;
            return acc;
        }, {});

        return {
            total,
            active,
            inactive: total - active,
            admins: byRole.admin || 0,
            providers: byRole.provider || 0,
            consumers: byRole.consumer || 0
        };
    });

    // Actions
    const fetchUsers = async (): Promise<void> => {
        loading.value = true;
        error.value = null;

        try {
            const response = await axios.get<{ success: boolean; users: User[] }>('/api/users');

            if (response.data.success) {
                users.value = response.data.users || [];
            } else {
                throw new Error('Failed to fetch users');
            }
        } catch (err: any) {
            console.error('Error fetching users:', err);
            error.value = err.response?.data?.message || err.message || 'Failed to fetch users';
        } finally {
            loading.value = false;
        }
    };

    const updateUserRole = async (userId: string, role: 'admin' | 'provider' | 'consumer'): Promise<void> => {
        loading.value = true;
        error.value = null;

        try {
            const response = await axios.patch<{ success: boolean; message: string }>('/api/users/role', {
                userId,
                role
            });

            if (response.data.success) {
                // Update the user in local state
                const userIndex = users.value.findIndex(user => user.id === userId);
                if (userIndex !== -1) {
                    users.value[userIndex].role = role;
                }

                // Update selected user if it's the one being updated
                if (selectedUser.value?.id === userId) {
                    selectedUser.value.role = role;
                }
            } else {
                throw new Error(response.data.message || 'Failed to update user role');
            }
        } catch (err: any) {
            console.error('Error updating user role:', err);
            error.value = err.response?.data?.message || err.message || 'Failed to update user role';
            throw err;
        } finally {
            loading.value = false;
        }
    };

    const fetchAdminStats = async (): Promise<void> => {
        try {
            // Fetch analytics stats for admin overview
            const [analyticsResponse, usersResponse] = await Promise.all([
                axios.get<{ success: boolean; data: any }>('/api/analytics/stats'),
                axios.get<{ success: boolean; users: User[] }>('/api/users')
            ]);

            if (analyticsResponse.data.success && usersResponse.data.success) {
                const analyticsData = analyticsResponse.data.data;
                const usersData = usersResponse.data.users;

                stats.value = {
                    totalUsers: usersData.length,
                    activeUsers: usersData.filter(user => user.isActive).length,
                    totalChannels: analyticsData.activeChannels || 0,
                    totalAgents: analyticsData.activeAgents || 0,
                    totalTasks: analyticsData.tasksCompleted || 0,
                    mcpToolsCount: analyticsData.mcpToolsCount || 0,
                    systemUptime: analyticsData.systemUptime || '0%',
                    errorRate: parseFloat(analyticsData.errorRate?.replace('%', '') || '0'),
                    avgResponseTime: parseFloat(analyticsData.responseTime?.replace('ms', '') || '0')
                };
            }
        } catch (err: any) {
            console.error('Error fetching admin stats:', err);
            // Don't set error state for stats - just log it
        }
    };

    const fetchSystemHealth = async (): Promise<void> => {
        try {
            const response = await axios.get<{ success: boolean; data: any }>('/api/analytics/system/health');

            if (response.data.success) {
                const healthData = response.data.data;
                
                systemHealth.value = {
                    status: healthData.status || 'healthy',
                    services: {
                        database: healthData.services?.database || 'online',
                        redis: healthData.services?.redis || 'online',
                        socketio: healthData.services?.socketio || 'online',
                        mcp: healthData.services?.mcp || 'online'
                    },
                    resources: {
                        cpuUsage: healthData.resources?.cpuUsage || 0,
                        memoryUsage: healthData.resources?.memoryUsage || 0,
                        diskUsage: healthData.resources?.diskUsage || 0
                    },
                    lastChecked: new Date()
                };
            }
        } catch (err: any) {
            console.error('Error fetching system health:', err);
            // Update last checked time even on error
            systemHealth.value.lastChecked = new Date();
        }
    };

    const setFilters = (newFilters: Partial<UserFilters>): void => {
        filters.value = { ...filters.value, ...newFilters };
    };

    const clearFilters = (): void => {
        filters.value = {
            search: '',
            role: '',
            status: '',
            sortBy: 'createdAt',
            sortOrder: 'desc'
        };
    };

    const setSelectedUser = (user: User | null): void => {
        selectedUser.value = user;
    };

    const fetchChannels = async (): Promise<void> => {
        loading.value = true;
        error.value = null;

        try {
            const response = await axios.get<{ success: boolean; channels: AdminChannel[]; patterns: any; total: number }>('/api/analytics/admin/channels');

            if (response.data.success) {
                channels.value = response.data.channels || [];
                channelPatterns.value = response.data.patterns || {};
            } else {
                throw new Error('Failed to fetch channels');
            }
        } catch (err: any) {
            console.error('Error fetching channels:', err);
            error.value = err.response?.data?.message || err.message || 'Failed to fetch channels';
            channels.value = [];
            channelPatterns.value = {};
        } finally {
            loading.value = false;
        }
    };

    const fetchAgents = async (): Promise<void> => {
        loading.value = true;
        error.value = null;

        try {
            const response = await axios.get<{ success: boolean; agents: AdminAgent[]; patterns: any; total: number }>('/api/analytics/admin/agents');

            if (response.data.success) {
                agents.value = response.data.agents || [];
                agentPatterns.value = response.data.patterns || {};
            } else {
                throw new Error('Failed to fetch agents');
            }
        } catch (err: any) {
            console.error('Error fetching agents:', err);
            error.value = err.response?.data?.message || err.message || 'Failed to fetch agents';
            agents.value = [];
            agentPatterns.value = {};
        } finally {
            loading.value = false;
        }
    };

    const fetchMCPTools = async (): Promise<void> => {
        loading.value = true;
        error.value = null;

        try {
            const response = await axios.get<{ success: boolean; tools: MCPTool[]; total: number }>('/api/analytics/admin/mcptools');

            if (response.data.success) {
                mcpTools.value = response.data.tools || [];
            } else {
                throw new Error('Failed to fetch MCP tools');
            }
        } catch (err: any) {
            console.error('Error fetching MCP tools:', err);
            error.value = err.response?.data?.message || err.message || 'Failed to fetch MCP tools';
        } finally {
            loading.value = false;
        }
    };

    const fetchToolExecutions = async (): Promise<void> => {
        loading.value = true;
        error.value = null;
        
        try {
            const response = await axios.get('/api/analytics/admin/executions');
            if (response.data.success) {
                toolExecutions.value = response.data.executions || [];
            } else {
                throw new Error(response.data.message || 'Failed to fetch tool executions');
            }
        } catch (err: any) {
            console.error('Error fetching tool executions:', err);
            error.value = err.response?.data?.message || err.message || 'Failed to fetch tool executions';
            toolExecutions.value = [];
        } finally {
            loading.value = false;
        }
    };

    const fetchTasks = async (): Promise<void> => {
        loading.value = true;
        error.value = null;
        
        try {
            const response = await axios.get('/api/analytics/admin/tasks');
            if (response.data.success) {
                tasks.value = response.data.tasks || [];
                taskAnalytics.value = response.data.analytics || {};
            } else {
                throw new Error(response.data.message || 'Failed to fetch tasks');
            }
        } catch (err: any) {
            console.error('Error fetching tasks:', err);
            error.value = err.response?.data?.message || err.message || 'Failed to fetch tasks';
            tasks.value = [];
            taskAnalytics.value = {};
        } finally {
            loading.value = false;
        }
    };

    const fetchAuditLogs = async (): Promise<void> => {
        loading.value = true;
        error.value = null;
        
        try {
            const response = await axios.get('/api/analytics/admin/auditlogs');
            if (response.data.success) {
                auditLogs.value = response.data.auditLogs || [];
                auditLogAnalytics.value = response.data.analytics || {};
            } else {
                throw new Error(response.data.message || 'Failed to fetch audit logs');
            }
        } catch (err: any) {
            console.error('Error fetching audit logs:', err);
            error.value = err.response?.data?.message || err.message || 'Failed to fetch audit logs';
            auditLogs.value = [];
            auditLogAnalytics.value = {};
        } finally {
            loading.value = false;
        }
    };

    const fetchSecurityAnalytics = async (): Promise<void> => {
        loading.value = true;
        error.value = null;
        
        try {
            const response = await axios.get('/api/analytics/admin/security');
            if (response.data.success) {
                securityData.value = response.data.channelKeys || [];
                securityAnalytics.value = response.data.analytics || {};
            } else {
                throw new Error(response.data.message || 'Failed to fetch security analytics');
            }
        } catch (err: any) {
            console.error('Error fetching security analytics:', err);
            error.value = err.response?.data?.message || err.message || 'Failed to fetch security analytics';
            securityData.value = [];
            securityAnalytics.value = {};
        } finally {
            loading.value = false;
        }
    };

    const clearError = (): void => {
        error.value = null;
    };

    return {
        // State
        users,
        selectedUser,
        channels,
        agents,
        mcpTools,
        toolExecutions,
        tasks,
        auditLogs,
        securityData,
        taskAnalytics,
        auditLogAnalytics,
        securityAnalytics,
        channelPatterns,
        agentPatterns,
        loading,
        error,
        stats,
        systemHealth,
        filters,
        // Computed
        filteredUsers,
        userStats,
        // Actions
        fetchUsers,
        updateUserRole,
        fetchAdminStats,
        fetchSystemHealth,
        fetchChannels,
        fetchAgents,
        fetchMCPTools,
        fetchToolExecutions,
        fetchTasks,
        fetchAuditLogs,
        fetchSecurityAnalytics,
        setFilters,
        clearFilters,
        setSelectedUser,
        clearError
    };
});
