<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useAdminStore } from '../../stores/admin';

const adminStore = useAdminStore();

// Local state for snackbar
const snackbar = ref(false);
const snackbarMessage = ref('');
const snackbarColor = ref('success');

// Auto-refresh interval
const refreshInterval = ref<number | null>(null);
const autoRefresh = ref(true);

// Computed properties
const toolExecutions = computed(() => adminStore.toolExecutions);
const loading = computed(() => adminStore.loading);
const error = computed(() => adminStore.error);

// Search and pagination
const search = ref('');
const itemsPerPage = ref(25);
const page = ref(1);
const selectedStatus = ref('');

// Table headers
const headers = [
    { title: 'Execution ID', key: 'id', sortable: true },
    { title: 'Tool Name', key: 'toolName', sortable: true },
    { title: 'Agent ID', key: 'agentId', sortable: true },
    { title: 'Channel ID', key: 'channelId', sortable: true },
    { title: 'Status', key: 'status', sortable: true },
    { title: 'Progress', key: 'progress', sortable: true },
    { title: 'Started', key: 'startTime', sortable: true },
    { title: 'Parameters', key: 'parameters', sortable: false },
    { title: 'Actions', key: 'actions', sortable: false }
];

// Status options
const statusOptions = [
    { title: 'All Statuses', value: '' },
    { title: 'Running', value: 'running' },
    { title: 'Pending', value: 'pending' },
    { title: 'Queued', value: 'queued' },
    { title: 'Completed', value: 'completed' },
    { title: 'Failed', value: 'failed' },
    { title: 'Cancelled', value: 'cancelled' }
];

// Filtered and searched executions
const filteredExecutions = computed(() => {
    let filtered = [...toolExecutions.value];
    
    if (search.value) {
        const searchLower = search.value.toLowerCase();
        filtered = filtered.filter(execution => 
            execution.toolName.toLowerCase().includes(searchLower) ||
            execution.id.toLowerCase().includes(searchLower) ||
            execution.agentId.toLowerCase().includes(searchLower) ||
            execution.channelId.toLowerCase().includes(searchLower)
        );
    }
    
    if (selectedStatus.value) {
        filtered = filtered.filter(execution => execution.status === selectedStatus.value);
    }
    
    return filtered;
});

// Status color mapping
const getStatusColor = (status: string): string => {
    switch (status.toLowerCase()) {
        case 'running':
            return 'success';
        case 'pending':
        case 'queued':
            return 'warning';
        case 'completed':
            return 'primary';
        case 'failed':
        case 'error':
            return 'error';
        case 'cancelled':
            return 'grey';
        default:
            return 'grey';
    }
};

// Progress color mapping
const getProgressColor = (progress: number): string => {
    if (progress >= 100) return 'success';
    if (progress >= 75) return 'primary';
    if (progress >= 50) return 'info';
    if (progress >= 25) return 'warning';
    return 'orange';
};

// Format date function
const formatDate = (date: Date | null | undefined): string => {
    if (!date) return 'N/A';
    return new Date(date).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
};

// Format parameters for display
const formatParameters = (params: any): string => {
    if (!params || Object.keys(params).length === 0) return 'None';
    return Object.entries(params)
        .slice(0, 3)
        .map(([key, value]) => `${key}: ${String(value).slice(0, 20)}`)
        .join(', ');
};

// Initialize data
onMounted(async () => {
    try {
        await adminStore.fetchToolExecutions();
        
        // Set up auto-refresh every 10 seconds
        if (autoRefresh.value) {
            refreshInterval.value = setInterval(() => {
                if (!loading.value) {
                    adminStore.fetchToolExecutions();
                }
            }, 10000);
        }
    } catch (error) {
        console.error('Error initializing tool executions:', error);
        snackbarMessage.value = 'Failed to load tool executions data';
        snackbarColor.value = 'error';
        snackbar.value = true;
    }
});

// Cleanup on unmount
onUnmounted(() => {
    if (refreshInterval.value) {
        clearInterval(refreshInterval.value);
        refreshInterval.value = null;
    }
});

// Toggle auto-refresh
const toggleAutoRefresh = (): void => {
    autoRefresh.value = !autoRefresh.value;
    
    if (autoRefresh.value) {
        refreshInterval.value = setInterval(() => {
            if (!loading.value) {
                adminStore.fetchToolExecutions();
            }
        }, 10000);
    } else {
        if (refreshInterval.value) {
            clearInterval(refreshInterval.value);
            refreshInterval.value = null;
        }
    }
};

// Manual refresh function
const refreshExecutions = async (): Promise<void> => {
    try {
        await adminStore.fetchToolExecutions();
        snackbarMessage.value = 'Tool executions refreshed successfully';
        snackbarColor.value = 'success';
        snackbar.value = true;
    } catch (error) {
        console.error('Error refreshing tool executions:', error);
        snackbarMessage.value = 'Failed to refresh tool executions';
        snackbarColor.value = 'error';
        snackbar.value = true;
    }
};
</script>

<template>
    <div class="admin-executions">
        <!-- Header Section -->
        <div class="d-flex align-center justify-space-between mb-6">
            <div>
                <h2 class="text-h4 mb-2">
                    <v-icon class="mr-3" size="32">mdi-play-circle</v-icon>
                    Active Tool Executions
                </h2>
                <p class="text-subtitle-1 text-medium-emphasis">
                    Monitor and manage active tool executions across the system
                </p>
            </div>
            <div class="d-flex gap-2">
                <v-btn
                    :color="autoRefresh ? 'success' : 'grey'"
                    :prepend-icon="autoRefresh ? 'mdi-pause' : 'mdi-play'"
                    variant="elevated"
                    @click="toggleAutoRefresh"
                >
                    {{ autoRefresh ? 'Auto-Refresh ON' : 'Auto-Refresh OFF' }}
                </v-btn>
                <v-btn
                    color="primary"
                    prepend-icon="mdi-refresh"
                    variant="elevated"
                    @click="refreshExecutions"
                    :loading="loading"
                >
                    Refresh
                </v-btn>
            </div>
        </div>

        <!-- Stats Cards -->
        <div class="d-flex gap-4 mb-6">
            <v-card class="flex-1" elevation="2">
                <v-card-text class="text-center">
                    <v-icon color="primary" size="32" class="mb-2">mdi-play-circle-outline</v-icon>
                    <div class="text-h5">{{ toolExecutions.length }}</div>
                    <div class="text-subtitle-2 text-medium-emphasis">Active Executions</div>
                </v-card-text>
            </v-card>
            <v-card class="flex-1" elevation="2">
                <v-card-text class="text-center">
                    <v-icon color="success" size="32" class="mb-2">mdi-play</v-icon>
                    <div class="text-h5">{{ toolExecutions.filter(e => e.status === 'running').length }}</div>
                    <div class="text-subtitle-2 text-medium-emphasis">Running</div>
                </v-card-text>
            </v-card>
            <v-card class="flex-1" elevation="2">
                <v-card-text class="text-center">
                    <v-icon color="warning" size="32" class="mb-2">mdi-clock-outline</v-icon>
                    <div class="text-h5">{{ toolExecutions.filter(e => ['pending', 'queued'].includes(e.status)).length }}</div>
                    <div class="text-subtitle-2 text-medium-emphasis">Pending/Queued</div>
                </v-card-text>
            </v-card>
            <v-card class="flex-1" elevation="2">
                <v-card-text class="text-center">
                    <v-icon color="error" size="32" class="mb-2">mdi-alert-circle</v-icon>
                    <div class="text-h5">{{ toolExecutions.filter(e => e.status === 'failed').length }}</div>
                    <div class="text-subtitle-2 text-medium-emphasis">Failed</div>
                </v-card-text>
            </v-card>
        </div>

        <!-- Search and Filters -->
        <v-card class="mb-6" elevation="2">
            <v-card-text>
                <div class="d-flex gap-4 align-center">
                    <v-text-field
                        v-model="search"
                        placeholder="Search executions..."
                        prepend-inner-icon="mdi-magnify"
                        variant="outlined"
                        density="compact"
                        hide-details
                        clearable
                        class="flex-1"
                    />
                    <v-select
                        v-model="selectedStatus"
                        :items="statusOptions"
                        label="Status"
                        variant="outlined"
                        density="compact"
                        hide-details
                        clearable
                        style="max-width: 180px;"
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

        <!-- Executions Table -->
        <v-card elevation="2">
            <v-data-table
                :headers="headers"
                :items="filteredExecutions"
                :loading="loading"
                :items-per-page="itemsPerPage"
                :page="page"
                @update:page="page = $event"
                class="executions-table"
                item-value="id"
                show-current-page
            >
                <!-- Execution ID column -->
                <template #item.id="{ item }">
                    <div class="text-body-2 font-weight-medium">
                        {{ item.id.substring(0, 8) }}...
                    </div>
                </template>

                <!-- Tool Name column -->
                <template #item.toolName="{ item }">
                    <div class="text-body-2 font-weight-medium">
                        <v-icon class="mr-2" size="16">mdi-tool</v-icon>
                        {{ item.toolName }}
                    </div>
                </template>

                <!-- Agent ID column -->
                <template #item.agentId="{ item }">
                    <div class="text-body-2">
                        {{ item.agentId.substring(0, 8) }}...
                    </div>
                </template>

                <!-- Channel ID column -->
                <template #item.channelId="{ item }">
                    <div class="text-body-2">
                        {{ item.channelId.substring(0, 8) }}...
                    </div>
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
                            :icon="item.status === 'running' ? 'mdi-play' : 
                                   ['pending', 'queued'].includes(item.status) ? 'mdi-clock-outline' : 
                                   item.status === 'completed' ? 'mdi-check' : 
                                   item.status === 'failed' ? 'mdi-close' : 
                                   'mdi-help'"
                        />
                        {{ item.status.toUpperCase() }}
                    </v-chip>
                </template>

                <!-- Progress column -->
                <template #item.progress="{ item }">
                    <div class="d-flex align-center gap-2">
                        <v-progress-linear
                            :model-value="item.progress"
                            :color="getProgressColor(item.progress)"
                            height="6"
                            rounded
                            style="min-width: 60px;"
                        />
                        <span class="text-caption">{{ item.progress }}%</span>
                    </div>
                </template>

                <!-- Start Time column -->
                <template #item.startTime="{ item }">
                    <div class="text-body-2">
                        {{ formatDate(item.startTime) }}
                    </div>
                </template>

                <!-- Parameters column -->
                <template #item.parameters="{ item }">
                    <div class="text-body-2" style="max-width: 250px;">
                        <v-tooltip>
                            <template #activator="{ props }">
                                <span v-bind="props">
                                    {{ formatParameters(item.parameters) }}
                                </span>
                            </template>
                            <pre>{{ JSON.stringify(item.parameters, null, 2) }}</pre>
                        </v-tooltip>
                    </div>
                </template>

                <!-- Actions column -->
                <template #item.actions="{ item }">
                    <div class="d-flex gap-2">
                        <v-btn
                            icon="mdi-information"
                            variant="text"
                            size="small"
                            color="primary"
                            @click="() => {}"
                        />
                        <v-btn
                            v-if="['running', 'pending', 'queued'].includes(item.status)"
                            icon="mdi-stop"
                            variant="text"
                            size="small"
                            color="error"
                            @click="() => {}"
                        />
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
                            mdi-play-circle-outline
                        </v-icon>
                        <div class="text-h6 text-medium-emphasis">No active executions found</div>
                        <div class="text-body-2 text-medium-emphasis">
                            {{ search || selectedStatus ? 'Try adjusting your search criteria' : 'No tool executions are currently active' }}
                        </div>
                    </div>
                </template>
            </v-data-table>
        </v-card>

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
.admin-executions {
    max-width: 1400px;
    margin: 0 auto;
    padding: 1rem;
}

.executions-table :deep(.v-data-table__wrapper) {
    border-radius: 8px;
}

.gap-4 {
    gap: 1rem;
}

.gap-2 {
    gap: 0.5rem;
}
</style>
