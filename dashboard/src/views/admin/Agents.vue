<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useAdminStore } from '../../stores/admin';

const adminStore = useAdminStore();

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
                            icon="mdi-eye"
                            variant="text"
                            size="small"
                            color="primary"
                            @click="() => {}"
                        />
                        <v-btn
                            icon="mdi-stop"
                            variant="text"
                            size="small"
                            color="orange"
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
