<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useAdminStore } from '../../stores/admin';

const adminStore = useAdminStore();

// Local state
const search = ref('');
const itemsPerPage = ref(25);
const selectedStatus = ref('');

// Computed properties
const securityData = computed(() => adminStore.securityData || []);
const securityAnalytics = computed(() => adminStore.securityAnalytics || {});
const loading = computed(() => adminStore.loading);
const error = computed(() => adminStore.error);

// Table headers
const headers = [
    { title: 'Key ID', key: 'keyId', sortable: true },
    { title: 'Name', key: 'name', sortable: true },
    { title: 'Channel ID', key: 'channelId', sortable: true },
    { title: 'Created By', key: 'createdBy', sortable: true },
    { title: 'Status', key: 'isActive', sortable: true },
    { title: 'Last Used', key: 'lastUsed', sortable: true },
    { title: 'Created', key: 'createdAt', sortable: true }
];

// Status options
const statusOptions = [
    { title: 'All Status', value: '' },
    { title: 'Active', value: 'active' },
    { title: 'Inactive', value: 'inactive' }
];

// Filtered security data
const filteredSecurityData = computed(() => {
    let filtered = [...securityData.value];
    
    if (search.value) {
        const searchLower = search.value.toLowerCase();
        filtered = filtered.filter(item => 
            item.keyId?.toLowerCase().includes(searchLower) ||
            item.name?.toLowerCase().includes(searchLower) ||
            item.channelId?.toLowerCase().includes(searchLower) ||
            item.createdBy?.toLowerCase().includes(searchLower)
        );
    }
    
    if (selectedStatus.value) {
        const isActive = selectedStatus.value === 'active';
        filtered = filtered.filter(item => item.isActive === isActive);
    }
    
    return filtered;
});

// Status color mapping
const getStatusColor = (isActive: boolean): string => {
    return isActive ? 'success' : 'grey';
};

// Format date
const formatDate = (date: Date | string | null | undefined): string => {
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
        await adminStore.fetchSecurityAnalytics();
    } catch (error) {
        console.error('Error initializing security analytics:', error);
    }
});
</script>

<template>
    <div class="admin-security">
        <!-- Header -->
        <div class="d-flex align-center justify-space-between mb-6">
            <div>
                <h2 class="text-h4 mb-2">
                    <v-icon class="mr-3" size="32">mdi-security</v-icon>
                    Security Analytics
                </h2>
                <p class="text-subtitle-1 text-medium-emphasis">
                    Access control and authentication monitoring
                </p>
            </div>
        </div>

        <!-- Security Overview -->
        <v-row class="mb-6">
            <v-col cols="12" md="3">
                <v-card elevation="2">
                    <v-card-text class="text-center">
                        <v-icon color="primary" size="32" class="mb-2">mdi-key</v-icon>
                        <div class="text-h5">{{ securityAnalytics.totalKeys || 0 }}</div>
                        <div class="text-subtitle-2 text-medium-emphasis">Total Keys</div>
                    </v-card-text>
                </v-card>
            </v-col>
            <v-col cols="12" md="3">
                <v-card elevation="2">
                    <v-card-text class="text-center">
                        <v-icon color="success" size="32" class="mb-2">mdi-key-variant</v-icon>
                        <div class="text-h5">{{ securityAnalytics.activeKeys || 0 }}</div>
                        <div class="text-subtitle-2 text-medium-emphasis">Active Keys</div>
                    </v-card-text>
                </v-card>
            </v-col>
            <v-col cols="12" md="3">
                <v-card elevation="2">
                    <v-card-text class="text-center">
                        <v-icon color="info" size="32" class="mb-2">mdi-clock-check</v-icon>
                        <div class="text-h5">{{ securityAnalytics.usedKeys || 0 }}</div>
                        <div class="text-subtitle-2 text-medium-emphasis">Used Keys</div>
                    </v-card-text>
                </v-card>
            </v-col>
            <v-col cols="12" md="3">
                <v-card elevation="2">
                    <v-card-text class="text-center">
                        <v-icon color="warning" size="32" class="mb-2">mdi-percent</v-icon>
                        <div class="text-h5">{{ securityAnalytics.usageRate || 0 }}%</div>
                        <div class="text-subtitle-2 text-medium-emphasis">Usage Rate</div>
                    </v-card-text>
                </v-card>
            </v-col>
        </v-row>

        <!-- Analytics Charts Placeholder -->
        <v-row class="mb-6">
            <v-col cols="12" md="6">
                <v-card elevation="2">
                    <v-card-title>
                        <v-icon class="mr-2">mdi-chart-pie</v-icon>
                        Key Status Distribution
                    </v-card-title>
                    <v-card-text>
                        <div class="text-center text-medium-emphasis">
                            <v-icon size="64" class="mb-2">mdi-chart-pie</v-icon>
                            <div>Key status distribution chart will be displayed here</div>
                            <div class="text-caption">
                                Active: {{ securityAnalytics.activeKeys || 0 }} | 
                                Inactive: {{ (securityAnalytics.totalKeys || 0) - (securityAnalytics.activeKeys || 0) }}
                            </div>
                        </div>
                    </v-card-text>
                </v-card>
            </v-col>
            <v-col cols="12" md="6">
                <v-card elevation="2">
                    <v-card-title>
                        <v-icon class="mr-2">mdi-chart-line</v-icon>
                        Key Creation Trends (30 days)
                    </v-card-title>
                    <v-card-text>
                        <div class="text-center text-medium-emphasis">
                            <v-icon size="64" class="mb-2">mdi-chart-line</v-icon>
                            <div>Key creation trend chart will be displayed here</div>
                            <div class="text-caption">
                                Data: {{ securityAnalytics.keyCreationTrends?.length || 0 }} data points
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
                        label="Search keys..."
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
                        style="min-width: 150px;"
                    />
                </div>
            </v-card-text>
        </v-card>

        <!-- Security Data Table -->
        <v-card elevation="2">
            <v-card-title>
                <div class="d-flex align-center justify-space-between w-100">
                    <div class="d-flex align-center">
                        <v-icon class="mr-2" size="24">mdi-key-outline</v-icon>
                        Channel Keys
                    </div>
                    <div class="text-caption text-medium-emphasis">
                        {{ filteredSecurityData.length }} of {{ securityData.length }} keys
                    </div>
                </div>
            </v-card-title>
            <v-data-table
                :headers="headers"
                :items="filteredSecurityData"
                :loading="loading"
                :items-per-page="itemsPerPage"
                class="elevation-0"
                item-key="id"
            >
                <template v-slot:item.keyId="{ item }">
                    <span class="font-mono text-caption">{{ item.keyId }}</span>
                </template>

                <template v-slot:item.name="{ item }">
                    <div class="text-truncate" style="max-width: 200px;" :title="item.name">
                        {{ item.name }}
                    </div>
                </template>

                <template v-slot:item.channelId="{ item }">
                    <span class="font-mono text-caption">{{ item.channelId }}</span>
                </template>

                <template v-slot:item.createdBy="{ item }">
                    <span class="font-mono text-caption">{{ item.createdBy }}</span>
                </template>

                <template v-slot:item.isActive="{ item }">
                    <v-chip
                        :color="getStatusColor(item.isActive)"
                        size="small"
                        variant="flat"
                    >
                        {{ item.isActive ? 'Active' : 'Inactive' }}
                    </v-chip>
                </template>

                <template v-slot:item.lastUsed="{ item }">
                    {{ formatDate(item.lastUsed) }}
                </template>

                <template v-slot:item.createdAt="{ item }">
                    {{ formatDate(item.createdAt) }}
                </template>

                <template v-slot:no-data>
                    <div class="text-center py-4">
                        <v-icon size="48" class="mb-2 text-medium-emphasis">mdi-key-outline</v-icon>
                        <div class="text-medium-emphasis">No security keys found</div>
                    </div>
                </template>
            </v-data-table>
        </v-card>
    </div>
</template>

<style scoped>
.admin-security {
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
    font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
}
</style>
