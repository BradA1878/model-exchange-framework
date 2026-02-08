<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useAdminStore } from '../../stores/admin';
import { useToolsStore } from '../../stores/tools';

const adminStore = useAdminStore();
const toolsStore = useToolsStore();

// Local state for snackbar
const snackbar = ref(false);
const snackbarMessage = ref('');
const snackbarColor = ref('success');

// Computed properties - Tools from admin store
const mcpTools = computed(() => adminStore.mcpTools);
const loading = computed(() => adminStore.loading);

// Computed properties - Servers from tools store
const mcpServers = computed(() => toolsStore.mcpServers);
const serversLoading = computed(() => toolsStore.serversLoading);
const serverStats = computed(() => toolsStore.serverStats);
const serverActionLoading = computed(() => toolsStore.serverActionLoading);

// Active section tab
const activeSection = ref('tools');

// Search and pagination - Tools
const search = ref('');
const itemsPerPage = ref(25);
const page = ref(1);
const selectedCategory = ref('');

// Search - Servers
const serverSearch = ref('');

// Dialogs
const serverDetailsDialog = ref(false);
const selectedServer = ref<any>(null);
const registerServerDialog = ref(false);
const newServerForm = ref({
    id: '',
    name: '',
    transport: 'stdio' as 'stdio' | 'http',
    command: '',
    args: '',
    url: '',
    autoStart: true,
    restartOnCrash: true
});

// Auto-refresh interval for servers
const refreshInterval = ref<number | null>(null);
const autoRefreshEnabled = ref(false);

// Table headers - Tools
const headers = [
    { title: 'Tool Name', key: 'name', sortable: true },
    { title: 'Description', key: 'description', sortable: false },
    { title: 'Category', key: 'category', sortable: true },
    { title: 'Server', key: 'server', sortable: true },
    { title: 'Version', key: 'version', sortable: true },
    { title: 'Status', key: 'status', sortable: true },
    { title: 'Executions', key: 'executions', sortable: true },
    { title: 'Last Used', key: 'lastUsed', sortable: true },
    { title: 'Actions', key: 'actions', sortable: false }
];

// Table headers - Servers
const serverHeaders = [
    { title: 'Server', key: 'name', sortable: true },
    { title: 'Status', key: 'status', sortable: true },
    { title: 'Tools', key: 'toolCount', sortable: true },
    { title: 'Uptime', key: 'uptime', sortable: true },
    { title: 'Restarts', key: 'restartCount', sortable: true },
    { title: 'Last Check', key: 'lastHealthCheck', sortable: true },
    { title: 'Actions', key: 'actions', sortable: false }
];

// Get unique categories
const categories = computed(() => {
    const cats = new Set(mcpTools.value.map(tool => tool.category));
    return ['', ...Array.from(cats)];
});

// Filtered and searched tools
const filteredTools = computed(() => {
    let filtered = [...mcpTools.value];

    if (search.value) {
        const searchLower = search.value.toLowerCase();
        filtered = filtered.filter(tool =>
            tool.name.toLowerCase().includes(searchLower) ||
            tool.description.toLowerCase().includes(searchLower) ||
            tool.category.toLowerCase().includes(searchLower) ||
            tool.server.toLowerCase().includes(searchLower)
        );
    }

    if (selectedCategory.value) {
        filtered = filtered.filter(tool => tool.category === selectedCategory.value);
    }

    return filtered;
});

// Filtered servers
const filteredServers = computed(() => {
    if (!serverSearch.value) return mcpServers.value;

    const searchLower = serverSearch.value.toLowerCase();
    return mcpServers.value.filter(server =>
        server.name.toLowerCase().includes(searchLower) ||
        server.id.toLowerCase().includes(searchLower)
    );
});

// Status color mapping
const getStatusColor = (status: string): string => {
    switch (status.toLowerCase()) {
        case 'active':
        case 'enabled':
        case 'running':
            return 'success';
        case 'inactive':
        case 'disabled':
        case 'stopped':
            return 'grey';
        case 'deprecated':
        case 'error':
            return 'error';
        case 'starting':
        case 'restarting':
            return 'warning';
        default:
            return 'grey';
    }
};

// Category color mapping
const getCategoryColor = (category: string): string => {
    switch (category.toLowerCase()) {
        case 'development':
            return 'blue';
        case 'analytics':
            return 'green';
        case 'communication':
            return 'purple';
        case 'file':
        case 'filesystem':
            return 'orange';
        case 'database':
            return 'cyan';
        case 'api':
            return 'pink';
        case 'utility':
            return 'teal';
        default:
            return 'grey';
    }
};

// Format date function
const formatDate = (date: Date | number | null | undefined): string => {
    if (!date) return 'Never';
    const d = typeof date === 'number' ? new Date(date) : new Date(date);
    return d.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
};

// Format uptime
const formatUptime = (seconds: number | undefined): string => {
    if (!seconds) return 'N/A';
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
};

// Show snackbar helper
const showSnackbar = (message: string, color: string): void => {
    snackbarMessage.value = message;
    snackbarColor.value = color;
    snackbar.value = true;
};

// Initialize data
onMounted(async () => {
    try {
        await Promise.all([
            adminStore.fetchMCPTools(),
            toolsStore.fetchMcpServers()
        ]);
    } catch (err) {
        console.error('Error initializing MCP data:', err);
        showSnackbar('Failed to load MCP data', 'error');
    }
});

// Cleanup on unmount
onUnmounted(() => {
    if (refreshInterval.value) {
        clearInterval(refreshInterval.value);
    }
});

// Toggle auto-refresh
const toggleAutoRefresh = (): void => {
    autoRefreshEnabled.value = !autoRefreshEnabled.value;

    if (autoRefreshEnabled.value) {
        refreshInterval.value = setInterval(async () => {
            await toolsStore.fetchMcpServers();
        }, 10000) as unknown as number;
        showSnackbar('Auto-refresh enabled (10s)', 'success');
    } else {
        if (refreshInterval.value) {
            clearInterval(refreshInterval.value);
            refreshInterval.value = null;
        }
        showSnackbar('Auto-refresh disabled', 'info');
    }
};

// Refresh functions
const refreshTools = async (): Promise<void> => {
    try {
        await adminStore.fetchMCPTools();
        showSnackbar('MCP Tools refreshed successfully', 'success');
    } catch (err) {
        console.error('Error refreshing MCP tools:', err);
        showSnackbar('Failed to refresh MCP tools', 'error');
    }
};

const refreshServers = async (): Promise<void> => {
    try {
        await toolsStore.fetchMcpServers();
        showSnackbar('MCP Servers refreshed successfully', 'success');
    } catch (err) {
        console.error('Error refreshing MCP servers:', err);
        showSnackbar('Failed to refresh MCP servers', 'error');
    }
};

// Server actions
const handleStartServer = async (serverId: string): Promise<void> => {
    const success = await toolsStore.startServer(serverId);
    if (success) {
        showSnackbar(`Server ${serverId} started successfully`, 'success');
    } else {
        showSnackbar(toolsStore.serversError || 'Failed to start server', 'error');
    }
};

const handleStopServer = async (serverId: string): Promise<void> => {
    const success = await toolsStore.stopServer(serverId);
    if (success) {
        showSnackbar(`Server ${serverId} stopped successfully`, 'success');
    } else {
        showSnackbar(toolsStore.serversError || 'Failed to stop server', 'error');
    }
};

const openServerDetails = (server: any): void => {
    selectedServer.value = server;
    serverDetailsDialog.value = true;
};

const openRegisterServer = (): void => {
    newServerForm.value = {
        id: '',
        name: '',
        transport: 'stdio',
        command: '',
        args: '',
        url: '',
        autoStart: true,
        restartOnCrash: true
    };
    registerServerDialog.value = true;
};

const handleRegisterServer = async (): Promise<void> => {
    const config = {
        id: newServerForm.value.id,
        name: newServerForm.value.name,
        transport: newServerForm.value.transport,
        command: newServerForm.value.transport === 'stdio' ? newServerForm.value.command : undefined,
        args: newServerForm.value.transport === 'stdio' && newServerForm.value.args
            ? newServerForm.value.args.split(' ').filter(Boolean)
            : undefined,
        url: newServerForm.value.transport === 'http' ? newServerForm.value.url : undefined,
        autoStart: newServerForm.value.autoStart,
        restartOnCrash: newServerForm.value.restartOnCrash
    };

    const success = await toolsStore.registerServer(config);
    if (success) {
        showSnackbar('Server registered successfully', 'success');
        registerServerDialog.value = false;
    } else {
        showSnackbar(toolsStore.serversError || 'Failed to register server', 'error');
    }
};

const handleUnregisterServer = async (serverId: string): Promise<void> => {
    const success = await toolsStore.unregisterServer(serverId);
    if (success) {
        showSnackbar(`Server ${serverId} unregistered`, 'success');
    } else {
        showSnackbar(toolsStore.serversError || 'Failed to unregister server', 'error');
    }
};
</script>

<template>
    <div class="admin-mcptools">
        <!-- Header Section -->
        <div class="d-flex align-center justify-space-between mb-6">
            <div>
                <h2 class="text-h4 mb-2">
                    <v-icon class="mr-3" size="32">mdi-tools</v-icon>
                    MCP Tools & Servers
                </h2>
                <p class="text-subtitle-1 text-medium-emphasis">
                    View and manage Model Context Protocol tools and external servers
                </p>
            </div>
            <v-btn
                color="primary"
                prepend-icon="mdi-refresh"
                variant="elevated"
                @click="activeSection === 'tools' ? refreshTools() : refreshServers()"
                :loading="loading || serversLoading"
            >
                Refresh
            </v-btn>
        </div>

        <!-- Section Tabs -->
        <v-card elevation="0" class="mb-6">
            <v-tabs v-model="activeSection">
                <v-tab value="tools">
                    <v-icon class="mr-2">mdi-tools</v-icon>
                    Tools Registry
                    <v-chip size="x-small" class="ml-2" color="primary">{{ mcpTools.length }}</v-chip>
                </v-tab>
                <v-tab value="servers">
                    <v-icon class="mr-2">mdi-server</v-icon>
                    MCP Servers
                    <v-chip size="x-small" class="ml-2" :color="serverStats.running > 0 ? 'success' : 'grey'">
                        {{ serverStats.running }}/{{ serverStats.total }}
                    </v-chip>
                </v-tab>
            </v-tabs>
        </v-card>

        <v-window v-model="activeSection">
            <!-- Tools Section -->
            <v-window-item value="tools">
                <!-- Stats Cards -->
                <div class="d-flex gap-4 mb-6">
                    <v-card class="flex-1" elevation="2">
                        <v-card-text class="text-center">
                            <v-icon color="primary" size="32" class="mb-2">mdi-tools</v-icon>
                            <div class="text-h5">{{ mcpTools.length }}</div>
                            <div class="text-subtitle-2 text-medium-emphasis">Total Tools</div>
                        </v-card-text>
                    </v-card>
                    <v-card class="flex-1" elevation="2">
                        <v-card-text class="text-center">
                            <v-icon color="success" size="32" class="mb-2">mdi-check-circle</v-icon>
                            <div class="text-h5">{{ mcpTools.filter(t => ['active', 'enabled'].includes(t.status.toLowerCase())).length }}</div>
                            <div class="text-subtitle-2 text-medium-emphasis">Active Tools</div>
                        </v-card-text>
                    </v-card>
                    <v-card class="flex-1" elevation="2">
                        <v-card-text class="text-center">
                            <v-icon color="warning" size="32" class="mb-2">mdi-alert-circle</v-icon>
                            <div class="text-h5">{{ mcpTools.filter(t => t.status.toLowerCase() === 'deprecated').length }}</div>
                            <div class="text-subtitle-2 text-medium-emphasis">Deprecated</div>
                        </v-card-text>
                    </v-card>
                    <v-card class="flex-1" elevation="2">
                        <v-card-text class="text-center">
                            <v-icon color="info" size="32" class="mb-2">mdi-play</v-icon>
                            <div class="text-h5">{{ mcpTools.reduce((sum, t) => sum + t.executions, 0).toLocaleString() }}</div>
                            <div class="text-subtitle-2 text-medium-emphasis">Total Executions</div>
                        </v-card-text>
                    </v-card>
                </div>

                <!-- Search and Filters -->
                <v-card class="mb-6" elevation="2">
                    <v-card-text>
                        <div class="d-flex gap-4 align-center">
                            <v-text-field
                                v-model="search"
                                placeholder="Search tools..."
                                prepend-inner-icon="mdi-magnify"
                                variant="outlined"
                                density="compact"
                                hide-details
                                clearable
                                class="flex-1"
                            />
                            <v-select
                                v-model="selectedCategory"
                                :items="categories"
                                label="Category"
                                variant="outlined"
                                density="compact"
                                hide-details
                                clearable
                                style="max-width: 180px;"
                            >
                                <template #item="{ props, item }">
                                    <v-list-item v-bind="props">
                                        <template #prepend v-if="item.raw">
                                            <v-chip
                                                :color="getCategoryColor(item.raw)"
                                                size="x-small"
                                                class="mr-2"
                                            >
                                                {{ item.raw }}
                                            </v-chip>
                                        </template>
                                    </v-list-item>
                                </template>
                            </v-select>
                            <v-select
                                v-model="itemsPerPage"
                                :items="[10, 25, 50, 100]"
                                label="Items per page"
                                variant="outlined"
                                density="compact"
                                hide-details
                                style="max-width: 140px;"
                            />
                        </div>
                    </v-card-text>
                </v-card>

                <!-- Tools Table -->
                <v-card elevation="2">
                    <v-data-table
                        :headers="headers"
                        :items="filteredTools"
                        :loading="loading"
                        :items-per-page="itemsPerPage"
                        :page="page"
                        @update:page="page = $event"
                        class="tools-table"
                        item-value="id"
                        show-current-page
                    >
                        <template #item.name="{ item }">
                            <div class="text-body-2 font-weight-medium">
                                <v-icon class="mr-2" size="16">mdi-tool</v-icon>
                                {{ item.name }}
                            </div>
                        </template>

                        <template #item.description="{ item }">
                            <div class="text-body-2" style="max-width: 300px;">
                                {{ item.description }}
                            </div>
                        </template>

                        <template #item.category="{ item }">
                            <v-chip
                                :color="getCategoryColor(item.category)"
                                size="small"
                                variant="flat"
                            >
                                {{ item.category.toUpperCase() }}
                            </v-chip>
                        </template>

                        <template #item.version="{ item }">
                            <v-chip color="grey" size="small" variant="outlined">
                                v{{ item.version }}
                            </v-chip>
                        </template>

                        <template #item.status="{ item }">
                            <v-chip
                                :color="getStatusColor(item.status)"
                                size="small"
                                variant="flat"
                            >
                                <v-icon start size="12" :icon="getStatusColor(item.status) === 'success' ? 'mdi-check-circle' :
                                       getStatusColor(item.status) === 'warning' ? 'mdi-alert-circle' : 'mdi-close-circle'" />
                                {{ item.status.toUpperCase() }}
                            </v-chip>
                        </template>

                        <template #item.executions="{ item }">
                            <v-chip :color="item.executions > 0 ? 'primary' : 'grey'" size="small" variant="flat">
                                {{ item.executions.toLocaleString() }}
                            </v-chip>
                        </template>

                        <template #item.lastUsed="{ item }">
                            <div class="text-body-2">{{ formatDate(item.lastUsed) }}</div>
                        </template>

                        <template #item.actions="{ item }">
                            <v-btn icon="mdi-information" variant="text" size="small" color="primary" />
                        </template>

                        <template #loading>
                            <v-skeleton-loader type="table-row@10" />
                        </template>

                        <template #no-data>
                            <div class="text-center py-8">
                                <v-icon size="64" color="grey-lighten-1" class="mb-4">mdi-tools</v-icon>
                                <div class="text-h6 text-medium-emphasis">No MCP tools found</div>
                            </div>
                        </template>
                    </v-data-table>
                </v-card>
            </v-window-item>

            <!-- Servers Section -->
            <v-window-item value="servers">
                <!-- Server Stats Cards -->
                <div class="d-flex gap-4 mb-6">
                    <v-card class="flex-1" elevation="2">
                        <v-card-text class="text-center">
                            <v-icon color="primary" size="32" class="mb-2">mdi-server</v-icon>
                            <div class="text-h5">{{ serverStats.total }}</div>
                            <div class="text-subtitle-2 text-medium-emphasis">Total Servers</div>
                        </v-card-text>
                    </v-card>
                    <v-card class="flex-1" elevation="2">
                        <v-card-text class="text-center">
                            <v-icon color="success" size="32" class="mb-2">mdi-check-network</v-icon>
                            <div class="text-h5">{{ serverStats.running }}</div>
                            <div class="text-subtitle-2 text-medium-emphasis">Running</div>
                        </v-card-text>
                    </v-card>
                    <v-card class="flex-1" elevation="2">
                        <v-card-text class="text-center">
                            <v-icon color="grey" size="32" class="mb-2">mdi-stop-circle</v-icon>
                            <div class="text-h5">{{ serverStats.stopped }}</div>
                            <div class="text-subtitle-2 text-medium-emphasis">Stopped</div>
                        </v-card-text>
                    </v-card>
                    <v-card class="flex-1" elevation="2">
                        <v-card-text class="text-center">
                            <v-icon color="error" size="32" class="mb-2">mdi-alert-circle</v-icon>
                            <div class="text-h5">{{ serverStats.error }}</div>
                            <div class="text-subtitle-2 text-medium-emphasis">Error</div>
                        </v-card-text>
                    </v-card>
                    <v-card class="flex-1" elevation="2">
                        <v-card-text class="text-center">
                            <v-icon color="info" size="32" class="mb-2">mdi-tools</v-icon>
                            <div class="text-h5">{{ serverStats.totalTools }}</div>
                            <div class="text-subtitle-2 text-medium-emphasis">External Tools</div>
                        </v-card-text>
                    </v-card>
                </div>

                <!-- Search and Actions -->
                <v-card class="mb-6" elevation="2">
                    <v-card-text>
                        <div class="d-flex gap-4 align-center">
                            <v-text-field
                                v-model="serverSearch"
                                placeholder="Search servers..."
                                prepend-inner-icon="mdi-magnify"
                                variant="outlined"
                                density="compact"
                                hide-details
                                clearable
                                class="flex-1"
                            />
                            <v-btn
                                :color="autoRefreshEnabled ? 'success' : 'grey'"
                                :variant="autoRefreshEnabled ? 'flat' : 'outlined'"
                                prepend-icon="mdi-sync"
                                @click="toggleAutoRefresh"
                            >
                                Auto-Refresh
                            </v-btn>
                            <v-btn
                                color="primary"
                                prepend-icon="mdi-plus"
                                @click="openRegisterServer"
                            >
                                Register Server
                            </v-btn>
                        </div>
                    </v-card-text>
                </v-card>

                <!-- Servers Table -->
                <v-card elevation="2">
                    <v-data-table
                        :headers="serverHeaders"
                        :items="filteredServers"
                        :loading="serversLoading"
                        item-value="id"
                    >
                        <template #item.name="{ item }">
                            <div class="d-flex align-center">
                                <v-icon class="mr-2" size="20" :color="getStatusColor(item.status)">
                                    mdi-server
                                </v-icon>
                                <div>
                                    <div class="text-body-2 font-weight-medium">{{ item.name }}</div>
                                    <div class="text-caption text-medium-emphasis">{{ item.id }}</div>
                                </div>
                            </div>
                        </template>

                        <template #item.status="{ item }">
                            <v-chip :color="getStatusColor(item.status)" size="small" variant="flat">
                                <v-icon start size="12" :icon="item.status === 'running' ? 'mdi-play-circle' :
                                       item.status === 'stopped' ? 'mdi-stop-circle' : 'mdi-alert-circle'" />
                                {{ item.status.toUpperCase() }}
                            </v-chip>
                        </template>

                        <template #item.toolCount="{ item }">
                            <v-chip color="info" size="small" variant="outlined">
                                {{ item.tools?.length || 0 }} tools
                            </v-chip>
                        </template>

                        <template #item.uptime="{ item }">
                            <span class="text-body-2">{{ formatUptime(item.uptime) }}</span>
                        </template>

                        <template #item.restartCount="{ item }">
                            <v-chip :color="item.restartCount > 0 ? 'warning' : 'grey'" size="small" variant="outlined">
                                {{ item.restartCount }}
                            </v-chip>
                        </template>

                        <template #item.lastHealthCheck="{ item }">
                            <span class="text-caption">{{ formatDate(item.lastHealthCheck) }}</span>
                        </template>

                        <template #item.actions="{ item }">
                            <div class="d-flex gap-1">
                                <v-btn
                                    icon="mdi-eye"
                                    variant="text"
                                    size="small"
                                    @click="openServerDetails(item)"
                                />
                                <v-btn
                                    v-if="item.status !== 'running'"
                                    icon="mdi-play"
                                    variant="text"
                                    size="small"
                                    color="success"
                                    :loading="serverActionLoading[item.id]"
                                    @click="handleStartServer(item.id)"
                                />
                                <v-btn
                                    v-else
                                    icon="mdi-stop"
                                    variant="text"
                                    size="small"
                                    color="warning"
                                    :loading="serverActionLoading[item.id]"
                                    @click="handleStopServer(item.id)"
                                />
                                <v-btn
                                    icon="mdi-delete"
                                    variant="text"
                                    size="small"
                                    color="error"
                                    :loading="serverActionLoading[item.id]"
                                    @click="handleUnregisterServer(item.id)"
                                />
                            </div>
                        </template>

                        <template #loading>
                            <v-skeleton-loader type="table-row@5" />
                        </template>

                        <template #no-data>
                            <div class="text-center py-8">
                                <v-icon size="64" color="grey-lighten-1" class="mb-4">mdi-server-off</v-icon>
                                <div class="text-h6 text-medium-emphasis">No MCP servers registered</div>
                                <div class="text-body-2 text-medium-emphasis mb-4">
                                    Register external MCP servers to extend tool capabilities
                                </div>
                                <v-btn color="primary" prepend-icon="mdi-plus" @click="openRegisterServer">
                                    Register Server
                                </v-btn>
                            </div>
                        </template>
                    </v-data-table>
                </v-card>
            </v-window-item>
        </v-window>

        <!-- Server Details Dialog -->
        <v-dialog v-model="serverDetailsDialog" max-width="600">
            <v-card v-if="selectedServer">
                <v-card-title class="d-flex align-center">
                    <v-icon class="mr-2" :color="getStatusColor(selectedServer.status)">mdi-server</v-icon>
                    {{ selectedServer.name }}
                </v-card-title>
                <v-card-text>
                    <v-list>
                        <v-list-item>
                            <v-list-item-title>Server ID</v-list-item-title>
                            <v-list-item-subtitle><code>{{ selectedServer.id }}</code></v-list-item-subtitle>
                        </v-list-item>
                        <v-list-item>
                            <v-list-item-title>Status</v-list-item-title>
                            <v-list-item-subtitle>
                                <v-chip :color="getStatusColor(selectedServer.status)" size="small">
                                    {{ selectedServer.status }}
                                </v-chip>
                            </v-list-item-subtitle>
                        </v-list-item>
                        <v-list-item v-if="selectedServer.pid">
                            <v-list-item-title>Process ID</v-list-item-title>
                            <v-list-item-subtitle>{{ selectedServer.pid }}</v-list-item-subtitle>
                        </v-list-item>
                        <v-list-item>
                            <v-list-item-title>Uptime</v-list-item-title>
                            <v-list-item-subtitle>{{ formatUptime(selectedServer.uptime) }}</v-list-item-subtitle>
                        </v-list-item>
                        <v-list-item>
                            <v-list-item-title>Restart Count</v-list-item-title>
                            <v-list-item-subtitle>{{ selectedServer.restartCount }}</v-list-item-subtitle>
                        </v-list-item>
                        <v-list-item v-if="selectedServer.lastError">
                            <v-list-item-title>Last Error</v-list-item-title>
                            <v-list-item-subtitle class="text-error">{{ selectedServer.lastError }}</v-list-item-subtitle>
                        </v-list-item>
                        <v-divider class="my-3" />
                        <v-list-item>
                            <v-list-item-title>Tools ({{ selectedServer.tools?.length || 0 }})</v-list-item-title>
                            <v-list-item-subtitle>
                                <div class="d-flex flex-wrap gap-1 mt-2">
                                    <v-chip
                                        v-for="tool in selectedServer.tools"
                                        :key="tool.name"
                                        size="small"
                                        variant="outlined"
                                    >
                                        {{ tool.name }}
                                    </v-chip>
                                    <span v-if="!selectedServer.tools?.length" class="text-medium-emphasis">
                                        No tools available
                                    </span>
                                </div>
                            </v-list-item-subtitle>
                        </v-list-item>
                    </v-list>
                </v-card-text>
                <v-card-actions>
                    <v-spacer />
                    <v-btn variant="text" @click="serverDetailsDialog = false">Close</v-btn>
                </v-card-actions>
            </v-card>
        </v-dialog>

        <!-- Register Server Dialog -->
        <v-dialog v-model="registerServerDialog" max-width="600">
            <v-card>
                <v-card-title class="d-flex align-center">
                    <v-icon class="mr-2">mdi-plus</v-icon>
                    Register MCP Server
                </v-card-title>
                <v-card-text>
                    <v-form>
                        <v-text-field
                            v-model="newServerForm.id"
                            label="Server ID"
                            hint="Unique identifier (e.g., github-mcp)"
                            persistent-hint
                            variant="outlined"
                            class="mb-4"
                            :rules="[v => !!v || 'Server ID is required']"
                        />
                        <v-text-field
                            v-model="newServerForm.name"
                            label="Display Name"
                            variant="outlined"
                            class="mb-4"
                            :rules="[v => !!v || 'Name is required']"
                        />
                        <v-select
                            v-model="newServerForm.transport"
                            :items="[
                                { title: 'Standard I/O (stdio)', value: 'stdio' },
                                { title: 'HTTP/SSE', value: 'http' }
                            ]"
                            label="Transport"
                            variant="outlined"
                            class="mb-4"
                        />
                        <template v-if="newServerForm.transport === 'stdio'">
                            <v-text-field
                                v-model="newServerForm.command"
                                label="Command"
                                hint="e.g., npx or /path/to/mcp-server"
                                persistent-hint
                                variant="outlined"
                                class="mb-4"
                            />
                            <v-text-field
                                v-model="newServerForm.args"
                                label="Arguments"
                                hint="Space-separated arguments"
                                persistent-hint
                                variant="outlined"
                                class="mb-4"
                            />
                        </template>
                        <template v-else>
                            <v-text-field
                                v-model="newServerForm.url"
                                label="Server URL"
                                hint="e.g., http://localhost:3100/sse"
                                persistent-hint
                                variant="outlined"
                                class="mb-4"
                            />
                        </template>
                        <v-switch
                            v-model="newServerForm.autoStart"
                            label="Auto-start on registration"
                            color="primary"
                            class="mb-2"
                        />
                        <v-switch
                            v-model="newServerForm.restartOnCrash"
                            label="Restart on crash"
                            color="primary"
                        />
                    </v-form>
                </v-card-text>
                <v-card-actions>
                    <v-spacer />
                    <v-btn variant="text" @click="registerServerDialog = false">Cancel</v-btn>
                    <v-btn
                        color="primary"
                        variant="elevated"
                        :loading="serversLoading"
                        :disabled="!newServerForm.id || !newServerForm.name"
                        @click="handleRegisterServer"
                    >
                        Register
                    </v-btn>
                </v-card-actions>
            </v-card>
        </v-dialog>

        <!-- Snackbar -->
        <v-snackbar
            v-model="snackbar"
            :color="snackbarColor"
            timeout="5000"
            location="top"
        >
            {{ snackbarMessage }}
            <template #actions>
                <v-btn variant="text" @click="snackbar = false">Close</v-btn>
            </template>
        </v-snackbar>
    </div>
</template>

<style scoped>
.admin-mcptools {
    max-width: 1400px;
    margin: 0 auto;
    padding: 1rem;
}

.tools-table :deep(.v-data-table__wrapper) {
    border-radius: 8px;
}

.gap-4 {
    gap: 1rem;
}

.gap-1 {
    gap: 0.25rem;
}
</style>
