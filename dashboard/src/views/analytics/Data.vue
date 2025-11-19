<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { useAnalyticsStore } from '@/stores/analytics';

// Store
const analyticsStore = useAnalyticsStore();

// Data table configuration
const headers = ref([
    { title: 'Timestamp', key: 'timestamp', sortable: true },
    { title: 'Event Type', key: 'eventType', sortable: true },
    { title: 'Channel', key: 'channel', sortable: true },
    { title: 'Agent', key: 'agent', sortable: true },
    { title: 'Status', key: 'status', sortable: true },
    { title: 'Duration (ms)', key: 'duration', sortable: true },
    { title: 'Actions', key: 'actions', sortable: false }
]);

// Events data from store
const events = computed(() => analyticsStore.events);
const loading = computed(() => analyticsStore.loadingEvents);
const hasError = computed(() => !!analyticsStore.error);
const totalItems = computed(() => analyticsStore.totalEventsDisplayed || events.value.length || 0);

// Filtering and search
const search = ref('');
const selectedEventType = ref('');
const selectedStatus = ref('');
const dateRange = ref(['', '']);

// Filter options
const eventTypes = ref(['task_execution', 'message_sent', 'channel_join', 'task_creation', 'agent_response']);
const statusOptions = ref(['completed', 'pending', 'delivered', 'success', 'failed']);

// Pagination
const itemsPerPage = ref(10);
const currentPage = ref(1);

// Error handling
const showErrorSnackbar = ref(false);
const errorMessage = computed(() => analyticsStore.error);

// Methods
const loadData = async (): Promise<void> => {
    try {
        // Build filter object
        const filters = {
            search: search.value || undefined,
            eventType: selectedEventType.value || undefined,
            status: selectedStatus.value || undefined,
            dateRange: dateRange.value.filter(Boolean).length > 0 ? dateRange.value : undefined,
            limit: itemsPerPage.value,
            offset: (currentPage.value - 1) * itemsPerPage.value
        };
        
        await analyticsStore.fetchEvents(filters);
    } catch (error) {
        console.error('Failed to load data:', error);
        showErrorSnackbar.value = true;
    }
};

const exportData = async (): Promise<void> => {
    try {
        await analyticsStore.exportData('events');
    } catch (error) {
        console.error('Failed to export data:', error);
        showErrorSnackbar.value = true;
    }
};

const refreshData = async (): Promise<void> => {
    await loadData();
};

const viewEventDetails = (event: any): void => {
    // TODO: Open event details dialog
    console.log('View event details:', event);
};

const clearError = (): void => {
    analyticsStore.clearError();
    showErrorSnackbar.value = false;
};

const getStatusColor = (status: string): string => {
    switch (status) {
        case 'completed':
        case 'success':
        case 'delivered':
            return 'success';
        case 'pending':
            return 'warning';
        case 'failed':
        case 'error':
            return 'error';
        default:
            return 'info';
    }
};

// Watch for filter changes to reload data
watch([search, selectedEventType, selectedStatus, dateRange], async () => {
    // Reset to first page when filters change
    currentPage.value = 1;
    await loadData();
}, { deep: true });

// Watch for page changes
watch(currentPage, async () => {
    await loadData();
});

// Watch for error changes
watch(errorMessage, (newError) => {
    if (newError) {
        showErrorSnackbar.value = true;
    }
});

onMounted(async () => {
    // Load initial data
    await loadData();
});
</script>

<template>
    <div class="data-analytics">
        <!-- Filters Section -->
        <v-card class="filters-card mb-6" elevation="0">
            <v-card-title>
                <div class="d-flex align-center">
                    <v-icon class="mr-2">mdi-filter</v-icon>
                    Filters & Search
                </div>
            </v-card-title>
            <v-card-text>
                <v-row>
                    <v-col cols="12" md="4">
                        <v-text-field
                            v-model="search"
                            label="Search events..."
                            variant="outlined"
                            density="compact"
                            prepend-inner-icon="mdi-magnify"
                            clearable
                        />
                    </v-col>
                    <v-col cols="12" md="2">
                        <v-select
                            v-model="selectedEventType"
                            :items="eventTypes"
                            label="Event Type"
                            variant="outlined"
                            density="compact"
                            clearable
                        />
                    </v-col>
                    <v-col cols="12" md="2">
                        <v-select
                            v-model="selectedStatus"
                            :items="statusOptions"
                            label="Status"
                            variant="outlined"
                            density="compact"
                            clearable
                        />
                    </v-col>
                    <v-col cols="12" md="4">
                        <v-row>
                            <v-col cols="6">
                                <v-text-field
                                    v-model="dateRange[0]"
                                    label="From Date"
                                    type="date"
                                    variant="outlined"
                                    density="compact"
                                />
                            </v-col>
                            <v-col cols="6">
                                <v-text-field
                                    v-model="dateRange[1]"
                                    label="To Date"
                                    type="date"
                                    variant="outlined"
                                    density="compact"
                                />
                            </v-col>
                        </v-row>
                    </v-col>
                </v-row>
            </v-card-text>
        </v-card>

        <!-- Data Table -->
        <v-card class="data-table-card" elevation="0">
            <v-card-title>
                <div class="d-flex align-center justify-space-between w-100">
                    <div class="d-flex align-center">
                        <v-icon class="mr-2">mdi-table</v-icon>
                        Event Data
                    </div>
                    <div class="d-flex align-center gap-2">
                        <v-btn
                            variant="outlined"
                            size="small"
                            prepend-icon="mdi-refresh"
                            @click="refreshData"
                            :loading="loading"
                        >
                            Refresh
                        </v-btn>
                        <v-btn
                            variant="outlined"
                            size="small"
                            prepend-icon="mdi-download"
                            @click="exportData"
                        >
                            Export
                        </v-btn>
                    </div>
                </div>
            </v-card-title>

            <v-data-table-server
                :headers="headers"
                :items="events"
                :loading="loading"
                :items-per-page="itemsPerPage"
                :items-length="totalItems"
                item-value="id"
                class="elevation-1"
                v-model:page="currentPage"
                @update:options="loadData"
            >
                <!-- Status column with chip -->
                <template #item.status="{ item }">
                    <v-chip
                        :color="getStatusColor(item.status)"
                        size="small"
                        variant="tonal"
                    >
                        {{ item.status }}
                    </v-chip>
                </template>

                <!-- Event type column with icon -->
                <template #item.eventType="{ item }">
                    <div class="d-flex align-center">
                        <v-icon 
                            size="16" 
                            class="mr-2"
                            :color="getStatusColor(item.status)"
                        >
                            {{ item.eventType === 'task_execution' ? 'mdi-cog' :
                               item.eventType === 'message_sent' ? 'mdi-message' :
                               item.eventType === 'channel_join' ? 'mdi-account-plus' :
                               item.eventType === 'task_creation' ? 'mdi-plus' :
                               'mdi-reply' }}
                        </v-icon>
                        {{ item.eventType }}
                    </div>
                </template>

                <!-- Duration column with formatting -->
                <template #item.duration="{ item }">
                    <span class="text-mono">{{ item.duration }}ms</span>
                </template>

                <!-- Actions column -->
                <template #item.actions="{ item }">
                    <v-btn
                        icon="mdi-eye"
                        size="small"
                        variant="text"
                        @click="viewEventDetails(item)"
                    />
                </template>

                <!-- Loading skeleton -->
                <template v-slot:loading>
                    <v-skeleton-loader
                        v-for="n in itemsPerPage"
                        :key="n"
                        type="table-row"
                        class="ma-1"
                    />
                </template>

                <!-- No data message -->
                <template v-slot:no-data>
                    <div class="text-center pa-8">
                        <v-icon size="64" color="grey-lighten-1" class="mb-4">mdi-database-search</v-icon>
                        <h3 class="text-h6 text-grey-darken-1 mb-2">No events found</h3>
                        <p class="text-body-2 text-grey">Try adjusting your filters or check back later</p>
                        <v-btn 
                            color="primary" 
                            variant="outlined" 
                            @click="refreshData" 
                            :loading="loading"
                            class="mt-4"
                        >
                            <v-icon start>mdi-refresh</v-icon>
                            Refresh Data
                        </v-btn>
                    </div>
                </template>
            </v-data-table-server>
        </v-card>
    </div>

    <!-- Error Snackbar -->
    <v-snackbar
        v-model="showErrorSnackbar"
        color="error"
        timeout="6000"
        multi-line
    >
        <v-icon start>mdi-alert-circle</v-icon>
        {{ errorMessage }}
        <template v-slot:actions>
            <v-btn
                color="white"
                variant="text"
                @click="clearError"
            >
                Close
            </v-btn>
        </template>
    </v-snackbar>
</template>

<style scoped>
.data-analytics {
    max-width: 1400px;
    margin: 0 auto;
}

.filters-card,
.data-table-card {
    background: var(--v-theme-card-bg);
    border: 1px solid rgba(255, 255, 255, 0.1);
}

:deep(.data-table) {
    background: transparent;
}

:deep(.v-data-table__wrapper) {
    background: transparent;
}

.text-mono {
    font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
    font-size: 0.875rem;
}

.gap-2 {
    gap: 0.5rem;
}
</style>
