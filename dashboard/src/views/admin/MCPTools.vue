<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useAdminStore } from '../../stores/admin';

const adminStore = useAdminStore();

// Local state for snackbar
const snackbar = ref(false);
const snackbarMessage = ref('');
const snackbarColor = ref('success');

// Computed properties
const mcpTools = computed(() => adminStore.mcpTools);
const loading = computed(() => adminStore.loading);
const error = computed(() => adminStore.error);

// Search and pagination
const search = ref('');
const itemsPerPage = ref(25);
const page = ref(1);
const selectedCategory = ref('');

// Table headers
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

// Status color mapping
const getStatusColor = (status: string): string => {
    switch (status.toLowerCase()) {
        case 'active':
        case 'enabled':
            return 'success';
        case 'inactive':
        case 'disabled':
            return 'error';
        case 'deprecated':
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
const formatDate = (date: Date | null | undefined): string => {
    if (!date) return 'Never';
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
        await adminStore.fetchMCPTools();
    } catch (error) {
        console.error('Error initializing MCP tools:', error);
        snackbarMessage.value = 'Failed to load MCP tools data';
        snackbarColor.value = 'error';
        snackbar.value = true;
    }
});

// Refresh function
const refreshTools = async (): Promise<void> => {
    try {
        await adminStore.fetchMCPTools();
        snackbarMessage.value = 'MCP Tools refreshed successfully';
        snackbarColor.value = 'success';
        snackbar.value = true;
    } catch (error) {
        console.error('Error refreshing MCP tools:', error);
        snackbarMessage.value = 'Failed to refresh MCP tools';
        snackbarColor.value = 'error';
        snackbar.value = true;
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
                    MCP Tools Registry
                </h2>
                <p class="text-subtitle-1 text-medium-emphasis">
                    View and manage all Model Context Protocol tools in the system
                </p>
            </div>
            <v-btn
                color="primary"
                prepend-icon="mdi-refresh"
                variant="elevated"
                @click="refreshTools"
                :loading="loading"
            >
                Refresh
            </v-btn>
        </div>

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
                <!-- Tool Name column -->
                <template #item.name="{ item }">
                    <div class="text-body-2 font-weight-medium">
                        <v-icon class="mr-2" size="16">mdi-tool</v-icon>
                        {{ item.name }}
                    </div>
                </template>

                <!-- Description column -->
                <template #item.description="{ item }">
                    <div class="text-body-2" style="max-width: 300px;">
                        {{ item.description }}
                    </div>
                </template>

                <!-- Category column -->
                <template #item.category="{ item }">
                    <v-chip
                        :color="getCategoryColor(item.category)"
                        size="small"
                        variant="flat"
                    >
                        {{ item.category.toUpperCase() }}
                    </v-chip>
                </template>

                <!-- Server column -->
                <template #item.server="{ item }">
                    <div class="text-body-2">
                        {{ item.server }}
                    </div>
                </template>

                <!-- Version column -->
                <template #item.version="{ item }">
                    <v-chip
                        color="grey"
                        size="small"
                        variant="outlined"
                    >
                        v{{ item.version }}
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
                            :icon="getStatusColor(item.status) === 'success' ? 'mdi-check-circle' : 
                                   getStatusColor(item.status) === 'warning' ? 'mdi-alert-circle' : 
                                   'mdi-close-circle'"
                        />
                        {{ item.status.toUpperCase() }}
                    </v-chip>
                </template>

                <!-- Executions column -->
                <template #item.executions="{ item }">
                    <v-chip
                        :color="item.executions > 0 ? 'primary' : 'grey'"
                        size="small"
                        variant="flat"
                    >
                        {{ item.executions.toLocaleString() }}
                    </v-chip>
                </template>

                <!-- Last Used column -->
                <template #item.lastUsed="{ item }">
                    <div class="text-body-2">
                        {{ formatDate(item.lastUsed) }}
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
                            icon="mdi-play"
                            variant="text"
                            size="small"
                            color="success"
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
                            mdi-tools
                        </v-icon>
                        <div class="text-h6 text-medium-emphasis">No MCP tools found</div>
                        <div class="text-body-2 text-medium-emphasis">
                            {{ search || selectedCategory ? 'Try adjusting your search criteria' : 'No MCP tools have been registered yet' }}
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
</style>
