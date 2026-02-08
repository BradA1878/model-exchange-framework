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

// Event details dialog state
const showEventDialog = ref(false);
const selectedEvent = ref<any>(null);

// Methods
const loadData = async (): Promise<void> => {
    try {
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

/**
 * Open event details dialog showing all event properties.
 */
const viewEventDetails = (event: any): void => {
    selectedEvent.value = event;
    showEventDialog.value = true;
};

const closeEventDialog = (): void => {
    showEventDialog.value = false;
    selectedEvent.value = null;
};

/**
 * Get display-friendly key-value pairs from event data,
 * excluding internal/UI-only fields.
 */
const eventDetailEntries = computed(() => {
    if (!selectedEvent.value) return [];
    return Object.entries(selectedEvent.value)
        .filter(([key]) => key !== 'id' && key !== '__v')
        .map(([key, value]) => ({
            key: formatFieldName(key),
            value: formatFieldValue(key, value)
        }));
});

const formatFieldName = (key: string): string => {
    // Convert camelCase to Title Case
    return key
        .replace(/([A-Z])/g, ' $1')
        .replace(/^./, str => str.toUpperCase())
        .trim();
};

const formatFieldValue = (key: string, value: any): string => {
    if (value === null || value === undefined) return 'N/A';
    if (key === 'timestamp') {
        return new Date(value).toLocaleString();
    }
    if (typeof value === 'object') {
        return JSON.stringify(value, null, 2);
    }
    return String(value);
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
    await loadData();
});
</script>

<template>
    <div class="an-data">
        <!-- ░░ Filters Section ░░ -->
        <section class="an-data__filters">
            <div class="an-data__filters-head">
                <v-icon size="14" class="an-data__filters-ico">mdi-filter</v-icon>
                <span class="an-data__filters-label">Filters & Search</span>
            </div>
            <div class="an-data__filters-grid">
                <div class="an-data__filter-item an-data__filter-item--wide">
                    <v-text-field
                        v-model="search"
                        placeholder="Search events..."
                        variant="outlined"
                        density="compact"
                        prepend-inner-icon="mdi-magnify"
                        clearable
                        hide-details
                    />
                </div>
                <div class="an-data__filter-item">
                    <v-select
                        v-model="selectedEventType"
                        :items="eventTypes"
                        label="Event Type"
                        variant="outlined"
                        density="compact"
                        clearable
                        hide-details
                    />
                </div>
                <div class="an-data__filter-item">
                    <v-select
                        v-model="selectedStatus"
                        :items="statusOptions"
                        label="Status"
                        variant="outlined"
                        density="compact"
                        clearable
                        hide-details
                    />
                </div>
                <div class="an-data__filter-item">
                    <v-text-field
                        v-model="dateRange[0]"
                        label="From Date"
                        type="date"
                        variant="outlined"
                        density="compact"
                        hide-details
                    />
                </div>
                <div class="an-data__filter-item">
                    <v-text-field
                        v-model="dateRange[1]"
                        label="To Date"
                        type="date"
                        variant="outlined"
                        density="compact"
                        hide-details
                    />
                </div>
            </div>
        </section>

        <!-- ░░ Data Table ░░ -->
        <section class="an-data__table-wrap">
            <div class="an-data__table-head">
                <div class="an-data__table-title">
                    <v-icon size="14">mdi-table</v-icon>
                    <span>Event Data</span>
                </div>
                <div class="an-data__table-actions">
                    <button class="an-data__btn" @click="refreshData" :disabled="loading">
                        <v-icon size="14">mdi-refresh</v-icon>
                        <span>Refresh</span>
                    </button>
                    <button class="an-data__btn" @click="exportData">
                        <v-icon size="14">mdi-download</v-icon>
                        <span>Export</span>
                    </button>
                </div>
            </div>

            <v-data-table-server
                :headers="headers"
                :items="events"
                :loading="loading"
                :items-per-page="itemsPerPage"
                :items-length="totalItems"
                item-value="id"
                v-model:page="currentPage"
                @update:options="loadData"
                class="an-data__table"
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
                    <div class="an-data__empty">
                        <div class="an-data__empty-icon">
                            <v-icon size="28" color="primary" style="opacity: 0.4">mdi-database-search</v-icon>
                        </div>
                        <h3 class="an-data__empty-title">No events found</h3>
                        <p class="an-data__empty-sub">Events will appear here once your agents start processing tasks and communicating through channels.</p>
                        <button
                            class="an-data__btn an-data__btn--primary"
                            @click="refreshData"
                            :disabled="loading"
                        >
                            <v-icon size="14">mdi-refresh</v-icon>
                            <span>Refresh Data</span>
                        </button>
                    </div>
                </template>
            </v-data-table-server>
        </section>
    </div>

    <!-- Event Details Dialog -->
    <v-dialog v-model="showEventDialog" max-width="700" content-class="an-event-dialog">
        <div class="an-dialog">
            <header class="an-dialog__header">
                <div class="an-dialog__header-left">
                    <v-icon size="16" style="opacity: 0.5">mdi-information-outline</v-icon>
                    <span class="an-dialog__title">Event Details</span>
                </div>
                <button class="an-dialog__close" @click="closeEventDialog">
                    <v-icon size="18">mdi-close</v-icon>
                </button>
            </header>

            <div class="an-dialog__body" v-if="selectedEvent">
                <div class="an-dialog__event-head">
                    <v-chip
                        :color="getStatusColor(selectedEvent.status)"
                        variant="tonal"
                        size="small"
                    >
                        {{ selectedEvent.status }}
                    </v-chip>
                    <span class="an-dialog__event-type">{{ selectedEvent.eventType }}</span>
                </div>

                <div class="an-dialog__props">
                    <div v-for="entry in eventDetailEntries" :key="entry.key" class="an-dialog__prop">
                        <span class="an-dialog__prop-key">{{ entry.key }}</span>
                        <code v-if="entry.value.includes('\n')" class="an-dialog__prop-code">{{ entry.value }}</code>
                        <span v-else class="an-dialog__prop-val">{{ entry.value }}</span>
                    </div>
                </div>
            </div>

            <footer class="an-dialog__footer">
                <button class="an-data__btn" @click="closeEventDialog">Close</button>
            </footer>
        </div>
    </v-dialog>

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
/* ════════════════════════════════════════════
   Analytics Data View — Polished UI
   ════════════════════════════════════════════ */

.an-data {
    --an-blue: #4A90C2;
}

/* ── Filters ──────────────────────────── */
.an-data__filters {
    background: var(--bg-base);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-lg);
    padding: var(--space-4);
    margin-bottom: var(--space-4);
}

.an-data__filters-head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin-bottom: var(--space-3);
}

.an-data__filters-ico {
    color: var(--text-muted);
    opacity: 0.6;
}

.an-data__filters-label {
    font-size: var(--text-xs);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
}

.an-data__filters-grid {
    display: grid;
    grid-template-columns: 2fr 1fr 1fr 1fr 1fr;
    gap: var(--space-3);
    align-items: start;
}

.an-data__filter-item--wide {
    grid-column: span 1;
}

/* ── Table Wrapper ────────────────────── */
.an-data__table-wrap {
    background: var(--bg-base);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-lg);
    overflow: hidden;
}

.an-data__table-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-4) var(--space-5);
    border-bottom: 1px solid var(--border-subtle);
}

.an-data__table-title {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--text-primary);
}

.an-data__table-actions {
    display: flex;
    align-items: center;
    gap: var(--space-2);
}

/* ── Inline Buttons ───────────────────── */
.an-data__btn {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 5px 12px;
    border-radius: var(--radius-md);
    font-size: var(--text-xs);
    font-weight: 500;
    cursor: pointer;
    transition: all var(--transition-base);
    border: 1px solid var(--border-default);
    background: transparent;
    color: var(--text-secondary);
    font-family: var(--font-sans);
}

.an-data__btn:hover {
    color: var(--text-primary);
    border-color: var(--an-blue);
    background: rgba(74, 144, 194, 0.08);
}

.an-data__btn:disabled {
    opacity: 0.5;
    cursor: default;
}

.an-data__btn--primary {
    background: var(--an-blue);
    border-color: var(--an-blue);
    color: #fff;
    margin-top: var(--space-3);
}

.an-data__btn--primary:hover {
    background: #3a7db0;
}

/* ── Table Overrides ──────────────────── */
.an-data__table {
    background: transparent !important;
}

.an-data__table :deep(.v-data-table__thead th) {
    background: var(--bg-elevated) !important;
    font-size: var(--text-xs) !important;
    font-weight: 600 !important;
    text-transform: uppercase !important;
    letter-spacing: 0.06em !important;
    color: var(--text-muted) !important;
    border-bottom: 1px solid var(--border-default) !important;
    white-space: nowrap;
}

.an-data__table :deep(.v-data-table__tr:hover td) {
    background: var(--bg-hover) !important;
}

.an-data__table :deep(.v-data-table__tr td) {
    border-bottom: 1px solid var(--border-subtle) !important;
    font-size: var(--text-sm) !important;
}

.an-data__table :deep(.v-data-table-footer) {
    border-top: 1px solid var(--border-subtle) !important;
    background: var(--bg-elevated) !important;
}

/* ── Empty State ──────────────────────── */
.an-data__empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: var(--space-12) var(--space-4);
    text-align: center;
}

.an-data__empty-icon {
    width: 72px;
    height: 72px;
    border-radius: 50%;
    background: linear-gradient(135deg, rgba(74, 144, 194, 0.06) 0%, rgba(74, 144, 194, 0.02) 100%);
    border: 1px solid var(--border-subtle);
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: var(--space-4);
}

.an-data__empty-title {
    font-size: var(--text-base);
    font-weight: 600;
    color: var(--text-secondary);
    margin: 0 0 var(--space-2);
}

.an-data__empty-sub {
    font-size: var(--text-sm);
    color: var(--text-muted);
    margin: 0 0 var(--space-4);
    max-width: 320px;
    line-height: 1.6;
}

/* ── Event Dialog (scoped portion) ─────── */
.an-dialog__prop-code {
    display: block;
    white-space: pre-wrap;
    word-break: break-word;
    font-size: var(--text-xs);
    padding: var(--space-3);
    background: var(--bg-hover);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
    max-height: 200px;
    overflow-y: auto;
    font-family: var(--font-mono);
    color: var(--text-secondary);
}

/* ── Utilities ────────────────────────── */
.text-mono {
    font-family: var(--font-mono) !important;
    font-size: var(--text-sm);
}

/* ── Responsive ───────────────────────── */
@media (max-width: 1024px) {
    .an-data__filters-grid {
        grid-template-columns: 1fr 1fr;
    }
}

@media (max-width: 768px) {
    .an-data__filters-grid {
        grid-template-columns: 1fr;
    }

    .an-data__table-head {
        flex-direction: column;
        gap: var(--space-2);
        align-items: flex-start;
    }

    .an-data__table-actions {
        align-self: flex-end;
    }
}
</style>

<!-- Non-scoped styles for teleported event dialog -->
<style>
.an-event-dialog .an-dialog {
    background: var(--bg-elevated);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-xl);
    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
    overflow: hidden;
}

.an-event-dialog .an-dialog__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-4) var(--space-5);
    border-bottom: 1px solid var(--border-subtle);
}

.an-event-dialog .an-dialog__header-left {
    display: flex;
    align-items: center;
    gap: var(--space-2);
}

.an-event-dialog .an-dialog__title {
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--text-primary);
}

.an-event-dialog .an-dialog__close {
    width: 30px;
    height: 30px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    transition: all 200ms ease;
}

.an-event-dialog .an-dialog__close:hover {
    color: var(--text-primary);
    background: var(--bg-hover);
}

.an-event-dialog .an-dialog__body {
    padding: var(--space-5);
}

.an-event-dialog .an-dialog__event-head {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    margin-bottom: var(--space-4);
}

.an-event-dialog .an-dialog__event-type {
    font-size: var(--text-base);
    font-weight: 600;
    color: var(--text-primary);
    font-family: var(--font-mono);
}

.an-event-dialog .an-dialog__props {
    display: flex;
    flex-direction: column;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-lg);
    overflow: hidden;
}

.an-event-dialog .an-dialog__prop {
    display: grid;
    grid-template-columns: 160px 1fr;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    border-bottom: 1px solid var(--border-subtle);
    align-items: start;
}

.an-event-dialog .an-dialog__prop:last-child {
    border-bottom: none;
}

.an-event-dialog .an-dialog__prop:hover {
    background: var(--bg-hover);
}

.an-event-dialog .an-dialog__prop-key {
    font-size: var(--text-xs);
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding-top: 2px;
}

.an-event-dialog .an-dialog__prop-val {
    font-size: var(--text-sm);
    color: var(--text-secondary);
    word-break: break-word;
}

.an-event-dialog .an-dialog__footer {
    display: flex;
    justify-content: flex-end;
    padding: var(--space-4) var(--space-5);
    border-top: 1px solid var(--border-subtle);
}
</style>
