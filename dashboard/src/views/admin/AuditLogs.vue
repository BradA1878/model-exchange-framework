<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useAdminStore } from '../../stores/admin';

const adminStore = useAdminStore();

// Local state
const search = ref('');
const itemsPerPage = ref(25);
const selectedEventType = ref('');

// Computed properties
const auditLogs = computed(() => adminStore.auditLogs || []);
const auditLogAnalytics = computed(() => adminStore.auditLogAnalytics || {});
const loading = computed(() => adminStore.loading);
const error = computed(() => adminStore.error);

// Table headers
const headers = [
    { title: 'Event Type', key: 'eventType', sortable: true },
    { title: 'Agent ID', key: 'agentId', sortable: true },
    { title: 'Target Agent', key: 'targetAgentId', sortable: true },
    { title: 'Message Type', key: 'messageType', sortable: true },
    { title: 'Timestamp', key: 'timestamp', sortable: true },
    { title: 'Error', key: 'error', sortable: true }
];

// Event type options
const eventTypeOptions = computed(() => {
    const types = auditLogAnalytics.value.eventTypeDistribution || [];
    return [
        { title: 'All Event Types', value: '' },
        ...types.map((type: any) => ({
            title: `${type._id} (${type.count})`,
            value: type._id
        }))
    ];
});

// Filtered logs
const filteredLogs = computed(() => {
    let filtered = [...auditLogs.value];
    
    if (search.value) {
        const searchLower = search.value.toLowerCase();
        filtered = filtered.filter(log => 
            log.eventType?.toLowerCase().includes(searchLower) ||
            log.agentId?.toLowerCase().includes(searchLower) ||
            log.targetAgentId?.toLowerCase().includes(searchLower) ||
            log.messageType?.toLowerCase().includes(searchLower)
        );
    }
    
    if (selectedEventType.value) {
        filtered = filtered.filter(log => log.eventType === selectedEventType.value);
    }
    
    return filtered;
});

// Get event type color
const getEventTypeColor = (eventType: string): string => {
    if (eventType?.includes('error') || eventType?.includes('failed')) return 'error';
    if (eventType?.includes('warning')) return 'warning';
    if (eventType?.includes('success') || eventType?.includes('completed')) return 'success';
    if (eventType?.includes('connect')) return 'primary';
    return 'grey';
};

// Format date
const formatDate = (date: Date | string | null | undefined): string => {
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

// Initialize data
onMounted(async () => {
    try {
        await adminStore.fetchAuditLogs();
    } catch (error) {
        console.error('Error initializing audit logs:', error);
    }
});
</script>

<template>
    <div class="admin-audit-logs">
        <!-- Header -->
        <div class="d-flex align-center justify-space-between mb-6">
            <div>
                <h2 class="text-h4 mb-2">
                    <v-icon class="mr-3" size="32">mdi-shield-search</v-icon>
                    Audit Logs
                </h2>
                <p class="text-subtitle-1 text-medium-emphasis">
                    Security and activity monitoring across the system
                </p>
            </div>
        </div>

        <!-- Analytics Overview -->
        <v-row class="mb-6">
            <v-col cols="12" md="3">
                <v-card elevation="2">
                    <v-card-text class="text-center">
                        <v-icon color="primary" size="32" class="mb-2">mdi-file-document-multiple</v-icon>
                        <div class="text-h5">{{ auditLogAnalytics.totalLogs || 0 }}</div>
                        <div class="text-subtitle-2 text-medium-emphasis">Total Logs</div>
                    </v-card-text>
                </v-card>
            </v-col>
            <v-col cols="12" md="3">
                <v-card elevation="2">
                    <v-card-text class="text-center">
                        <v-icon color="error" size="32" class="mb-2">mdi-alert-circle</v-icon>
                        <div class="text-h5">{{ auditLogAnalytics.errorLogs || 0 }}</div>
                        <div class="text-subtitle-2 text-medium-emphasis">Error Logs</div>
                    </v-card-text>
                </v-card>
            </v-col>
            <v-col cols="12" md="3">
                <v-card elevation="2">
                    <v-card-text class="text-center">
                        <v-icon color="warning" size="32" class="mb-2">mdi-percent</v-icon>
                        <div class="text-h5">{{ auditLogAnalytics.errorRate || 0 }}%</div>
                        <div class="text-subtitle-2 text-medium-emphasis">Error Rate</div>
                    </v-card-text>
                </v-card>
            </v-col>
            <v-col cols="12" md="3">
                <v-card elevation="2">
                    <v-card-text class="text-center">
                        <v-icon color="info" size="32" class="mb-2">mdi-format-list-bulleted</v-icon>
                        <div class="text-h5">{{ auditLogAnalytics.eventTypeDistribution?.length || 0 }}</div>
                        <div class="text-subtitle-2 text-medium-emphasis">Event Types</div>
                    </v-card-text>
                </v-card>
            </v-col>
        </v-row>

        <!-- Analytics Charts Placeholder -->
        <v-row class="mb-6">
            <v-col cols="12" md="6">
                <v-card elevation="2">
                    <v-card-title>
                        <v-icon class="mr-2">mdi-chart-bar</v-icon>
                        Event Type Distribution
                    </v-card-title>
                    <v-card-text>
                        <div class="text-center text-medium-emphasis">
                            <v-icon size="64" class="mb-2">mdi-chart-bar</v-icon>
                            <div>Event distribution chart will be displayed here</div>
                            <div class="text-caption">
                                Data: {{ auditLogAnalytics.eventTypeDistribution?.length || 0 }} event types
                            </div>
                        </div>
                    </v-card-text>
                </v-card>
            </v-col>
            <v-col cols="12" md="6">
                <v-card elevation="2">
                    <v-card-title>
                        <v-icon class="mr-2">mdi-chart-line</v-icon>
                        Activity Trends (7 days)
                    </v-card-title>
                    <v-card-text>
                        <div class="text-center text-medium-emphasis">
                            <v-icon size="64" class="mb-2">mdi-chart-line</v-icon>
                            <div>Activity trend chart will be displayed here</div>
                            <div class="text-caption">
                                Data: {{ auditLogAnalytics.activityTrends?.length || 0 }} data points
                            </div>
                        </div>
                    </v-card-text>
                </v-card>
            </v-col>
        </v-row>

        <!-- Search and Filters -->
        <v-card class="mb-6" elevation="2">
            <v-card-text>
                <div class="d-flex gap-4 align-center">
                    <v-text-field
                        v-model="search"
                        prepend-inner-icon="mdi-magnify"
                        label="Search audit logs..."
                        variant="outlined"
                        density="compact"
                        hide-details
                        clearable
                        class="flex-1"
                    />
                    <v-select
                        v-model="selectedEventType"
                        :items="eventTypeOptions"
                        label="Event Type"
                        variant="outlined"
                        density="compact"
                        hide-details
                        style="min-width: 200px;"
                    />
                </div>
            </v-card-text>
        </v-card>

        <!-- Audit Logs Table -->
        <v-card elevation="2">
            <v-card-title>
                <div class="d-flex align-center justify-space-between w-100">
                    <div class="d-flex align-center">
                        <v-icon class="mr-2" size="24">mdi-format-list-bulleted</v-icon>
                        Audit Log Entries
                    </div>
                    <div class="text-caption text-medium-emphasis">
                        {{ filteredLogs.length }} of {{ auditLogs.length }} logs
                    </div>
                </div>
            </v-card-title>
            <v-data-table
                :headers="headers"
                :items="filteredLogs"
                :loading="loading"
                :items-per-page="itemsPerPage"
                class="elevation-0"
                item-key="id"
            >
                <template v-slot:item.eventType="{ item }">
                    <v-chip
                        :color="getEventTypeColor(item.eventType)"
                        size="small"
                        variant="flat"
                    >
                        {{ item.eventType }}
                    </v-chip>
                </template>

                <template v-slot:item.agentId="{ item }">
                    <span class="font-mono text-caption">{{ item.agentId }}</span>
                </template>

                <template v-slot:item.targetAgentId="{ item }">
                    <span v-if="item.targetAgentId" class="font-mono text-caption">
                        {{ item.targetAgentId }}
                    </span>
                    <span v-else class="text-medium-emphasis">-</span>
                </template>

                <template v-slot:item.messageType="{ item }">
                    <span v-if="item.messageType">{{ item.messageType }}</span>
                    <span v-else class="text-medium-emphasis">-</span>
                </template>

                <template v-slot:item.timestamp="{ item }">
                    {{ formatDate(item.timestamp) }}
                </template>

                <template v-slot:item.error="{ item }">
                    <v-chip
                        v-if="item.error"
                        color="error"
                        size="small"
                        variant="flat"
                    >
                        Error
                    </v-chip>
                    <span v-else class="text-medium-emphasis">-</span>
                </template>

                <template v-slot:no-data>
                    <div class="text-center py-4">
                        <v-icon size="48" class="mb-2 text-medium-emphasis">mdi-shield-search</v-icon>
                        <div class="text-medium-emphasis">No audit logs found</div>
                    </div>
                </template>
            </v-data-table>
        </v-card>
    </div>
</template>

<style scoped>
.admin-audit-logs {
    max-width: 1400px;
    margin: 0 auto;
    padding: 1rem;
}

.gap-4 {
    gap: 1rem;
}

.flex-1 {
    flex: 1;
}

.font-mono {
    font-family: var(--font-mono);
}
</style>
