<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useAdminStore } from '../../stores/admin';
import { useAgentsStore } from '../../stores/agents';

const adminStore = useAdminStore();
const agentsStore = useAgentsStore();

// Local state for snackbar
const snackbar = ref(false);
const snackbarMessage = ref('');
const snackbarColor = ref('success');

// Computed properties
const agents = computed(() => adminStore.agents);
const loading = computed(() => adminStore.loading);
const error = computed(() => adminStore.error);

// Search and pagination
const search = ref('');
const itemsPerPage = ref(25);
const page = ref(1);

// Table headers
const headers = [
    { title: 'Agent ID', key: 'id', sortable: true },
    { title: 'Name', key: 'name', sortable: true },
    { title: 'Type', key: 'type', sortable: true },
    { title: 'Status', key: 'status', sortable: true },
    { title: 'Channel', key: 'channelId', sortable: true },
    { title: 'Created By', key: 'createdBy', sortable: true },
    { title: 'Last Activity', key: 'lastActivity', sortable: true },
    { title: 'Created', key: 'createdAt', sortable: true },
    { title: 'Actions', key: 'actions', sortable: false }
];

// Filtered and searched agents
const filteredAgents = computed(() => {
    let filtered = [...agents.value];
    
    if (search.value) {
        const searchLower = search.value.toLowerCase();
        filtered = filtered.filter(agent => 
            agent.name.toLowerCase().includes(searchLower) ||
            agent.type.toLowerCase().includes(searchLower) ||
            agent.id.toLowerCase().includes(searchLower) ||
            agent.channelId.toLowerCase().includes(searchLower) ||
            agent.createdBy.toLowerCase().includes(searchLower)
        );
    }
    
    return filtered;
});

// Status color mapping
const getStatusColor = (status: string): string => {
    switch (status.toLowerCase()) {
        case 'active':
        case 'online':
        case 'running':
            return 'success';
        case 'inactive':
        case 'offline':
        case 'stopped':
            return 'error';
        case 'idle':
        case 'waiting':
            return 'warning';
        default:
            return 'grey';
    }
};

// Type color mapping
const getTypeColor = (type: string): string => {
    switch (type.toLowerCase()) {
        case 'coordinator':
            return 'purple';
        case 'executor':
            return 'blue';
        case 'analyzer':
            return 'green';
        case 'reporter':
            return 'orange';
        default:
            return 'grey';
    }
};

// Format date function
const formatDate = (date: Date | null | undefined): string => {
    if (!date) return 'N/A';
    return new Date(date).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
};

// Initialize data
onMounted(async () => {
    try {
        await adminStore.fetchAgents();
    } catch (error) {
        console.error('Error initializing agents:', error);
        snackbarMessage.value = 'Failed to load agents data';
        snackbarColor.value = 'error';
        snackbar.value = true;
    }
});

// Refresh function
const refreshAgents = async (): Promise<void> => {
    try {
        await adminStore.fetchAgents();
        snackbarMessage.value = 'Agents refreshed successfully';
        snackbarColor.value = 'success';
        snackbar.value = true;
    } catch (error) {
        console.error('Error refreshing agents:', error);
        snackbarMessage.value = 'Failed to refresh agents';
        snackbarColor.value = 'error';
        snackbar.value = true;
    }
};

// Helper to show snackbar messages
const showSnackbar = (message: string, color: string = 'success'): void => {
    snackbarMessage.value = message;
    snackbarColor.value = color;
    snackbar.value = true;
};

// Lifecycle control state
const metricsDialog = ref(false);
const metricsData = ref<any>(null);
const metricsLoading = ref(false);
const metricsAgent = ref<any>(null);
const confirmDialog = ref(false);
const confirmAction = ref<{ title: string; message: string; action: () => Promise<void> } | null>(null);
const lifecycleLoading = computed(() => agentsStore.lifecycleLoading);

// Admin agents use 'id' field as the agent identifier for API calls
const getAgentIdForApi = (item: any): string => item.agentId || item.id;

// Lifecycle action handlers
const handleViewMetrics = async (item: any): Promise<void> => {
    metricsAgent.value = item;
    metricsLoading.value = true;
    metricsDialog.value = true;
    try {
        metricsData.value = await agentsStore.getAgentMetrics(getAgentIdForApi(item));
    } catch {
        showSnackbar('Failed to load agent metrics', 'error');
        metricsDialog.value = false;
    } finally {
        metricsLoading.value = false;
    }
};

const handleRestart = async (item: any): Promise<void> => {
    try {
        await agentsStore.restartAgent(getAgentIdForApi(item));
        showSnackbar(`Agent "${item.name}" restart requested`);
        await adminStore.fetchAgents();
    } catch {
        showSnackbar('Failed to restart agent', 'error');
    }
};

const handlePauseResume = async (item: any): Promise<void> => {
    const isPaused = item.status?.toLowerCase() === 'paused';
    try {
        if (isPaused) {
            await agentsStore.resumeAgent(getAgentIdForApi(item));
            showSnackbar(`Agent "${item.name}" resumed`);
        } else {
            await agentsStore.pauseAgent(getAgentIdForApi(item));
            showSnackbar(`Agent "${item.name}" paused`);
        }
        await adminStore.fetchAgents();
    } catch {
        showSnackbar(`Failed to ${isPaused ? 'resume' : 'pause'} agent`, 'error');
    }
};

const openConfirmDialog = (title: string, message: string, action: () => Promise<void>): void => {
    confirmAction.value = { title, message, action };
    confirmDialog.value = true;
};

const executeConfirmAction = async (): Promise<void> => {
    if (!confirmAction.value) return;
    try {
        await confirmAction.value.action();
    } finally {
        confirmDialog.value = false;
        confirmAction.value = null;
    }
};

const handleShutdown = (item: any): void => {
    openConfirmDialog(
        'Confirm Shutdown',
        `Are you sure you want to shutdown agent "${item.name}"?`,
        async () => {
            try {
                await agentsStore.shutdownAgent(getAgentIdForApi(item));
                showSnackbar(`Agent "${item.name}" shutdown requested`);
                await adminStore.fetchAgents();
            } catch {
                showSnackbar('Failed to shutdown agent', 'error');
            }
        }
    );
};

const handleClearMemory = (item: any): void => {
    openConfirmDialog(
        'Confirm Clear Memory',
        `Are you sure you want to clear all memory for agent "${item.name}"? This action cannot be undone.`,
        async () => {
            try {
                await agentsStore.deleteAgentMemory(getAgentIdForApi(item));
                showSnackbar(`Memory cleared for agent "${item.name}"`);
            } catch {
                showSnackbar('Failed to clear agent memory', 'error');
            }
        }
    );
};

// Format uptime from milliseconds to human-readable string
const formatUptime = (ms: number): string => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    if (days > 0) return `${days}d ${hours % 24}h`;
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m`;
    return `${seconds}s`;
};
</script>

<template>
    <div class="admin-agents">
        <!-- Header Section -->
        <div class="d-flex align-center justify-space-between mb-6">
            <div>
                <h2 class="text-h4 mb-2">
                    <v-icon class="mr-3" size="32">mdi-robot</v-icon>
                    Agents Management
                </h2>
                <p class="text-subtitle-1 text-medium-emphasis">
                    View and manage all agents in the system
                </p>
            </div>
            <v-btn
                color="primary"
                prepend-icon="mdi-refresh"
                variant="elevated"
                @click="refreshAgents"
                :loading="loading"
            >
                Refresh
            </v-btn>
        </div>

        <!-- Stats Cards -->
        <div class="d-flex gap-4 mb-6">
            <v-card class="flex-1" elevation="2">
                <v-card-text class="text-center">
                    <v-icon color="primary" size="32" class="mb-2">mdi-robot-outline</v-icon>
                    <div class="text-h5">{{ agents.length }}</div>
                    <div class="text-subtitle-2 text-medium-emphasis">Total Agents</div>
                </v-card-text>
            </v-card>
            <v-card class="flex-1" elevation="2">
                <v-card-text class="text-center">
                    <v-icon color="success" size="32" class="mb-2">mdi-check-circle</v-icon>
                    <div class="text-h5">{{ agents.filter(a => ['active', 'online', 'running'].includes(a.status.toLowerCase())).length }}</div>
                    <div class="text-subtitle-2 text-medium-emphasis">Active Agents</div>
                </v-card-text>
            </v-card>
            <v-card class="flex-1" elevation="2">
                <v-card-text class="text-center">
                    <v-icon color="warning" size="32" class="mb-2">mdi-pause-circle</v-icon>
                    <div class="text-h5">{{ agents.filter(a => ['idle', 'waiting'].includes(a.status.toLowerCase())).length }}</div>
                    <div class="text-subtitle-2 text-medium-emphasis">Idle Agents</div>
                </v-card-text>
            </v-card>
            <v-card class="flex-1" elevation="2">
                <v-card-text class="text-center">
                    <v-icon color="error" size="32" class="mb-2">mdi-close-circle</v-icon>
                    <div class="text-h5">{{ agents.filter(a => ['inactive', 'offline', 'stopped'].includes(a.status.toLowerCase())).length }}</div>
                    <div class="text-subtitle-2 text-medium-emphasis">Inactive Agents</div>
                </v-card-text>
            </v-card>
        </div>

        <!-- Search and Filters -->
        <v-card class="mb-6" elevation="2">
            <v-card-text>
                <div class="d-flex gap-4 align-center">
                    <v-text-field
                        v-model="search"
                        placeholder="Search agents..."
                        prepend-inner-icon="mdi-magnify"
                        variant="outlined"
                        density="compact"
                        hide-details
                        clearable
                        class="flex-1"
                    />
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

        <!-- Agents Table -->
        <v-card elevation="2">
            <v-data-table
                :headers="headers"
                :items="filteredAgents"
                :loading="loading"
                :items-per-page="itemsPerPage"
                :page="page"
                @update:page="page = $event"
                class="agents-table"
                item-value="id"
                show-current-page
            >
                <!-- Agent ID column -->
                <template #item.id="{ item }">
                    <div class="text-body-2 font-weight-medium">
                        {{ item.id }}
                    </div>
                </template>

                <!-- Name column -->
                <template #item.name="{ item }">
                    <div class="text-body-2 font-weight-medium">
                        {{ item.name }}
                    </div>
                </template>

                <!-- Type column -->
                <template #item.type="{ item }">
                    <v-chip
                        :color="getTypeColor(item.type)"
                        size="small"
                        variant="flat"
                    >
                        <v-icon start size="16">mdi-cog</v-icon>
                        {{ item.type.toUpperCase() }}
                    </v-chip>
                </template>

                <!-- Status column -->
                <template #item.status="{ item }">
                    <v-chip
                        :color="getStatusColor(item.status)"
                        size="small"
                        variant="flat"
                    >
                        <v-icon
                            start
                            size="12"
                            :icon="getStatusColor(item.status) === 'success' ? 'mdi-circle' : 
                                   getStatusColor(item.status) === 'warning' ? 'mdi-pause' : 
                                   'mdi-circle-outline'"
                        />
                        {{ item.status.toUpperCase() }}
                    </v-chip>
                </template>

                <!-- Channel ID column -->
                <template #item.channelId="{ item }">
                    <div class="text-body-2">
                        {{ item.channelId || 'N/A' }}
                    </div>
                </template>

                <!-- Created By column -->
                <template #item.createdBy="{ item }">
                    <div class="text-body-2">
                        {{ item.createdBy }}
                    </div>
                </template>

                <!-- Last Activity column -->
                <template #item.lastActivity="{ item }">
                    <div class="text-body-2">
                        {{ formatDate(item.lastActivity) }}
                    </div>
                </template>

                <!-- Created At column -->
                <template #item.createdAt="{ item }">
                    <div class="text-body-2">
                        {{ formatDate(item.createdAt) }}
                    </div>
                </template>

                <!-- Actions column -->
                <template #item.actions="{ item }">
                    <div class="d-flex gap-2">
                        <v-btn
                            icon="mdi-chart-box"
                            variant="text"
                            size="small"
                            color="info"
                            title="View Metrics"
                            @click="handleViewMetrics(item)"
                        />
                        <v-menu>
                            <template #activator="{ props: menuProps }">
                                <v-btn
                                    icon="mdi-dots-vertical"
                                    variant="text"
                                    size="small"
                                    v-bind="menuProps"
                                />
                            </template>
                            <v-list density="compact">
                                <v-list-item
                                    @click="handleRestart(item)"
                                    :disabled="lifecycleLoading === getAgentIdForApi(item)"
                                >
                                    <template #prepend>
                                        <v-icon color="primary" size="20">mdi-restart</v-icon>
                                    </template>
                                    <v-list-item-title>Restart</v-list-item-title>
                                </v-list-item>
                                <v-list-item
                                    @click="handlePauseResume(item)"
                                    :disabled="lifecycleLoading === getAgentIdForApi(item)"
                                >
                                    <template #prepend>
                                        <v-icon color="warning" size="20">
                                            {{ item.status?.toLowerCase() === 'paused' ? 'mdi-play' : 'mdi-pause' }}
                                        </v-icon>
                                    </template>
                                    <v-list-item-title>
                                        {{ item.status?.toLowerCase() === 'paused' ? 'Resume' : 'Pause' }}
                                    </v-list-item-title>
                                </v-list-item>
                                <v-list-item
                                    @click="handleShutdown(item)"
                                    :disabled="lifecycleLoading === getAgentIdForApi(item)"
                                >
                                    <template #prepend>
                                        <v-icon color="error" size="20">mdi-power</v-icon>
                                    </template>
                                    <v-list-item-title>Shutdown</v-list-item-title>
                                </v-list-item>
                                <v-divider class="my-1" />
                                <v-list-item
                                    @click="handleClearMemory(item)"
                                    :disabled="lifecycleLoading === getAgentIdForApi(item)"
                                >
                                    <template #prepend>
                                        <v-icon color="warning" size="20">mdi-broom</v-icon>
                                    </template>
                                    <v-list-item-title>Clear Memory</v-list-item-title>
                                </v-list-item>
                            </v-list>
                        </v-menu>
                    </div>
                </template>

                <!-- Loading slot -->
                <template #loading>
                    <v-skeleton-loader type="table-row@10" />
                </template>

                <!-- No data slot -->
                <template #no-data>
                    <div class="text-center py-8">
                        <v-icon size="64" color="grey-lighten-1" class="mb-4">
                            mdi-robot-outline
                        </v-icon>
                        <div class="text-h6 text-medium-emphasis">No agents found</div>
                        <div class="text-body-2 text-medium-emphasis">
                            {{ search ? 'Try adjusting your search criteria' : 'No agents have been created yet' }}
                        </div>
                    </div>
                </template>
            </v-data-table>
        </v-card>

        <!-- Agent Metrics Dialog -->
        <v-dialog v-model="metricsDialog" max-width="500px">
            <v-card>
                <v-card-title class="d-flex align-center">
                    <v-icon class="mr-2" color="info">mdi-chart-box</v-icon>
                    Agent Metrics
                </v-card-title>
                <v-card-subtitle v-if="metricsAgent" class="pb-0">
                    {{ metricsAgent.name }}
                </v-card-subtitle>
                <v-card-text>
                    <div v-if="metricsLoading" class="text-center pa-4">
                        <v-progress-circular indeterminate color="primary" />
                    </div>
                    <div v-else-if="metricsData">
                        <v-list density="compact">
                            <v-list-item>
                                <template #prepend>
                                    <v-icon color="primary">mdi-circle-outline</v-icon>
                                </template>
                                <v-list-item-title>Status</v-list-item-title>
                                <template #append>
                                    <v-chip
                                        :color="getStatusColor(metricsData.status)"
                                        size="small"
                                        variant="tonal"
                                    >
                                        {{ metricsData.status }}
                                    </v-chip>
                                </template>
                            </v-list-item>
                            <v-list-item>
                                <template #prepend>
                                    <v-icon color="success">mdi-clock-outline</v-icon>
                                </template>
                                <v-list-item-title>Uptime</v-list-item-title>
                                <template #append>
                                    <span class="text-body-2">{{ formatUptime(metricsData.uptime) }}</span>
                                </template>
                            </v-list-item>
                            <v-list-item>
                                <template #prepend>
                                    <v-icon color="info">mdi-checkbox-marked-circle-outline</v-icon>
                                </template>
                                <v-list-item-title>Total Tasks</v-list-item-title>
                                <template #append>
                                    <span class="text-body-2">{{ metricsData.totalTasks }}</span>
                                </template>
                            </v-list-item>
                            <v-list-item>
                                <template #prepend>
                                    <v-icon color="success">mdi-check-circle</v-icon>
                                </template>
                                <v-list-item-title>Completed Tasks</v-list-item-title>
                                <template #append>
                                    <span class="text-body-2">{{ metricsData.completedTasks }}</span>
                                </template>
                            </v-list-item>
                            <v-list-item>
                                <template #prepend>
                                    <v-icon color="error">mdi-alert-circle</v-icon>
                                </template>
                                <v-list-item-title>Failed Tasks</v-list-item-title>
                                <template #append>
                                    <span class="text-body-2">{{ metricsData.failedTasks }}</span>
                                </template>
                            </v-list-item>
                            <v-list-item>
                                <template #prepend>
                                    <v-icon color="warning">mdi-speedometer</v-icon>
                                </template>
                                <v-list-item-title>Avg Response Time</v-list-item-title>
                                <template #append>
                                    <span class="text-body-2">{{ metricsData.avgResponseTime }}ms</span>
                                </template>
                            </v-list-item>
                            <v-list-item>
                                <template #prepend>
                                    <v-icon color="primary">mdi-percent</v-icon>
                                </template>
                                <v-list-item-title>Success Rate</v-list-item-title>
                                <template #append>
                                    <span class="text-body-2">{{ metricsData.successRate }}%</span>
                                </template>
                            </v-list-item>
                        </v-list>
                    </div>
                </v-card-text>
                <v-card-actions>
                    <v-spacer />
                    <v-btn variant="text" @click="metricsDialog = false">Close</v-btn>
                </v-card-actions>
            </v-card>
        </v-dialog>

        <!-- Confirm Action Dialog -->
        <v-dialog v-model="confirmDialog" max-width="400px">
            <v-card v-if="confirmAction">
                <v-card-title class="d-flex align-center">
                    <v-icon class="mr-2" color="warning">mdi-alert</v-icon>
                    {{ confirmAction.title }}
                </v-card-title>
                <v-card-text>{{ confirmAction.message }}</v-card-text>
                <v-card-actions>
                    <v-spacer />
                    <v-btn
                        variant="text"
                        @click="confirmDialog = false; confirmAction = null"
                    >
                        Cancel
                    </v-btn>
                    <v-btn
                        color="error"
                        variant="elevated"
                        @click="executeConfirmAction"
                    >
                        Confirm
                    </v-btn>
                </v-card-actions>
            </v-card>
        </v-dialog>

        <!-- Snackbar for notifications -->
        <v-snackbar
            v-model="snackbar"
            :color="snackbarColor"
            timeout="5000"
            location="top"
        >
            {{ snackbarMessage }}
            <template #actions>
                <v-btn
                    variant="text"
                    @click="snackbar = false"
                >
                    Close
                </v-btn>
            </template>
        </v-snackbar>
    </div>
</template>

<style scoped>
.admin-agents {
    max-width: 1400px;
    margin: 0 auto;
    padding: 1rem;
}

.agents-table :deep(.v-data-table__wrapper) {
    border-radius: 8px;
}

.gap-4 {
    gap: 1rem;
}
</style>
