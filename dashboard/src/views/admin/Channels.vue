<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useAdminStore } from '../../stores/admin';

const adminStore = useAdminStore();

// Local state for snackbar
const snackbar = ref(false);
const snackbarMessage = ref('');
const snackbarColor = ref('success');

// Computed properties
const channels = computed(() => adminStore.channels);
const loading = computed(() => adminStore.loading);
const error = computed(() => adminStore.error);

// Search and pagination
const search = ref('');
const itemsPerPage = ref(25);
const page = ref(1);

// Table headers
const headers = [
    { title: 'Channel ID', key: 'id', sortable: true },
    { title: 'Name', key: 'name', sortable: true },
    { title: 'Description', key: 'description', sortable: false },
    { title: 'Created By', key: 'createdBy', sortable: true },
    { title: 'Agents', key: 'participantCount', sortable: true },
    { title: 'Status', key: 'status', sortable: true },
    { title: 'Created', key: 'createdAt', sortable: true },
    { title: 'Actions', key: 'actions', sortable: false }
];

// Filtered and searched channels
const filteredChannels = computed(() => {
    let filtered = [...channels.value];
    
    if (search.value) {
        const searchLower = search.value.toLowerCase();
        filtered = filtered.filter(channel => 
            channel.name.toLowerCase().includes(searchLower) ||
            channel.description.toLowerCase().includes(searchLower) ||
            channel.id.toLowerCase().includes(searchLower) ||
            channel.createdBy.toLowerCase().includes(searchLower)
        );
    }
    
    return filtered;
});

// Status color mapping
const getStatusColor = (status: string): string => {
    switch (status) {
        case 'active':
            return 'success';
        case 'inactive':
            return 'error';
        default:
            return 'grey';
    }
};

// Format date function
const formatDate = (date: Date): string => {
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
        await adminStore.fetchChannels();
    } catch (error) {
        console.error('Error initializing channels:', error);
        snackbarMessage.value = 'Failed to load channels data';
        snackbarColor.value = 'error';
        snackbar.value = true;
    }
});

// Refresh function
const refreshChannels = async (): Promise<void> => {
    try {
        await adminStore.fetchChannels();
        snackbarMessage.value = 'Channels refreshed successfully';
        snackbarColor.value = 'success';
        snackbar.value = true;
    } catch (error) {
        console.error('Error refreshing channels:', error);
        snackbarMessage.value = 'Failed to refresh channels';
        snackbarColor.value = 'error';
        snackbar.value = true;
    }
};
</script>

<template>
    <div class="admin-channels">
        <!-- Header Section -->
        <div class="d-flex align-center justify-space-between mb-6">
            <div>
                <h2 class="text-h4 mb-2">
                    <v-icon class="mr-3" size="32">mdi-forum</v-icon>
                    Channels Management
                </h2>
                <p class="text-subtitle-1 text-medium-emphasis">
                    View and manage all channels in the system
                </p>
            </div>
            <v-btn
                color="primary"
                prepend-icon="mdi-refresh"
                variant="elevated"
                @click="refreshChannels"
                :loading="loading"
            >
                Refresh
            </v-btn>
        </div>

        <!-- Stats Cards -->
        <div class="d-flex gap-4 mb-6">
            <v-card class="flex-1" elevation="2">
                <v-card-text class="text-center">
                    <v-icon color="primary" size="32" class="mb-2">mdi-forum-outline</v-icon>
                    <div class="text-h5">{{ channels.length }}</div>
                    <div class="text-subtitle-2 text-medium-emphasis">Total Channels</div>
                </v-card-text>
            </v-card>
            <v-card class="flex-1" elevation="2">
                <v-card-text class="text-center">
                    <v-icon color="success" size="32" class="mb-2">mdi-check-circle</v-icon>
                    <div class="text-h5">{{ channels.filter(c => c.status === 'active').length }}</div>
                    <div class="text-subtitle-2 text-medium-emphasis">Active Channels</div>
                </v-card-text>
            </v-card>
            <v-card class="flex-1" elevation="2">
                <v-card-text class="text-center">
                    <v-icon color="error" size="32" class="mb-2">mdi-close-circle</v-icon>
                    <div class="text-h5">{{ channels.filter(c => c.status === 'inactive').length }}</div>
                    <div class="text-subtitle-2 text-medium-emphasis">Inactive Channels</div>
                </v-card-text>
            </v-card>
            <v-card class="flex-1" elevation="2">
                <v-card-text class="text-center">
                    <v-icon color="info" size="32" class="mb-2">mdi-robot</v-icon>
                    <div class="text-h5">{{ channels.reduce((sum, c) => sum + c.participantCount, 0) }}</div>
                    <div class="text-subtitle-2 text-medium-emphasis">Total Agents</div>
                </v-card-text>
            </v-card>
        </div>

        <!-- Search and Filters -->
        <v-card class="mb-6" elevation="2">
            <v-card-text>
                <div class="d-flex gap-4 align-center">
                    <v-text-field
                        v-model="search"
                        placeholder="Search channels..."
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

        <!-- Channels Table -->
        <v-card elevation="2">
            <v-data-table
                :headers="headers"
                :items="filteredChannels"
                :loading="loading"
                :items-per-page="itemsPerPage"
                :page="page"
                @update:page="page = $event"
                class="channels-table"
                item-value="id"
                show-current-page
            >
                <!-- Channel ID column -->
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

                <!-- Description column -->
                <template #item.description="{ item }">
                    <div class="text-body-2" style="max-width: 300px;">
                        {{ item.description }}
                    </div>
                </template>

                <!-- Created By column -->
                <template #item.createdBy="{ item }">
                    <div class="text-body-2">
                        {{ item.createdBy }}
                    </div>
                </template>

                <!-- Participant Count column -->
                <template #item.participantCount="{ item }">
                    <v-chip
                        :color="item.participantCount > 0 ? 'primary' : 'grey'"
                        size="small"
                        variant="flat"
                    >
                        {{ item.participantCount }}
                    </v-chip>
                </template>

                <!-- Status column -->
                <template #item.status="{ item }">
                    <v-chip
                        :color="getStatusColor(item.status)"
                        size="small"
                        variant="flat"
                    >
                        {{ item.status.toUpperCase() }}
                    </v-chip>
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
                            icon="mdi-pencil"
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
                            mdi-forum-outline
                        </v-icon>
                        <div class="text-h6 text-medium-emphasis">No channels found</div>
                        <div class="text-body-2 text-medium-emphasis">
                            {{ search ? 'Try adjusting your search criteria' : 'No channels have been created yet' }}
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
.admin-channels {
    max-width: 1400px;
    margin: 0 auto;
    padding: 1rem;
}

.channels-table :deep(.v-data-table__wrapper) {
    border-radius: 8px;
}

.gap-4 {
    gap: 1rem;
}
</style>
