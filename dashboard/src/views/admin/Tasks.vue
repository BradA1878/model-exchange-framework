<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useAdminStore } from '../../stores/admin';

const adminStore = useAdminStore();

// Local state
const search = ref('');
const itemsPerPage = ref(25);
const page = ref(1);
const selectedStatus = ref('');
const selectedPriority = ref('');

// Computed properties
const tasks = computed(() => adminStore.tasks || []);
const taskAnalytics = computed(() => adminStore.taskAnalytics || {});
const loading = computed(() => adminStore.loading);
const error = computed(() => adminStore.error);

// Table headers
const headers = [
    { title: 'Task ID', key: 'id', sortable: true },
    { title: 'Title', key: 'title', sortable: true },
    { title: 'Channel', key: 'channelId', sortable: true },
    { title: 'Priority', key: 'priority', sortable: true },
    { title: 'Status', key: 'status', sortable: true },
    { title: 'Progress', key: 'progress', sortable: true },
    { title: 'Assigned Agent', key: 'assignedAgentId', sortable: true },
    { title: 'Strategy', key: 'assignmentStrategy', sortable: true },
    { title: 'Created', key: 'createdAt', sortable: true }
];

// Filter options
const statusOptions = [
    { title: 'All Statuses', value: '' },
    { title: 'Pending', value: 'pending' },
    { title: 'Assigned', value: 'assigned' },
    { title: 'In Progress', value: 'in_progress' },
    { title: 'Completed', value: 'completed' },
    { title: 'Failed', value: 'failed' },
    { title: 'Cancelled', value: 'cancelled' }
];

const priorityOptions = [
    { title: 'All Priorities', value: '' },
    { title: 'High', value: 'high' },
    { title: 'Medium', value: 'medium' },
    { title: 'Low', value: 'low' }
];

// Filtered tasks
const filteredTasks = computed(() => {
    let filtered = [...tasks.value];
    
    if (search.value) {
        const searchLower = search.value.toLowerCase();
        filtered = filtered.filter(task => 
            task.title?.toLowerCase().includes(searchLower) ||
            task.description?.toLowerCase().includes(searchLower) ||
            task.channelId?.toLowerCase().includes(searchLower) ||
            task.assignedAgentId?.toLowerCase().includes(searchLower)
        );
    }
    
    if (selectedStatus.value) {
        filtered = filtered.filter(task => task.status === selectedStatus.value);
    }
    
    if (selectedPriority.value) {
        filtered = filtered.filter(task => task.priority === selectedPriority.value);
    }
    
    return filtered;
});

// Status color mapping
const getStatusColor = (status: string): string => {
    switch (status?.toLowerCase()) {
        case 'completed':
            return 'success';
        case 'in_progress':
        case 'assigned':
            return 'primary';
        case 'pending':
            return 'warning';
        case 'failed':
            return 'error';
        case 'cancelled':
            return 'grey';
        default:
            return 'grey';
    }
};

// Priority color mapping
const getPriorityColor = (priority: string): string => {
    switch (priority?.toLowerCase()) {
        case 'high':
            return 'error';
        case 'medium':
            return 'warning';
        case 'low':
            return 'success';
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

// Format date
const formatDate = (date: Date | string | null | undefined): string => {
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
        await adminStore.fetchTasks();
    } catch (error) {
        console.error('Error initializing task analytics:', error);
    }
});
</script>

<template>
    <div class="admin-tasks">
        <!-- Header -->
        <div class="d-flex align-center justify-space-between mb-6">
            <div>
                <h2 class="text-h4 mb-2">
                    <v-icon class="mr-3" size="32">mdi-chart-line</v-icon>
                    Task Analytics
                </h2>
                <p class="text-subtitle-1 text-medium-emphasis">
                    Comprehensive task performance analytics and insights
                </p>
            </div>
        </div>

        <!-- Analytics Overview -->
        <v-row class="mb-6">
            <v-col cols="12" md="3">
                <v-card elevation="2">
                    <v-card-text class="text-center">
                        <v-icon color="primary" size="32" class="mb-2">mdi-file-document-multiple</v-icon>
                        <div class="text-h5">{{ taskAnalytics.totalTasks || 0 }}</div>
                        <div class="text-subtitle-2 text-medium-emphasis">Total Tasks</div>
                    </v-card-text>
                </v-card>
            </v-col>
            <v-col cols="12" md="3">
                <v-card elevation="2">
                    <v-card-text class="text-center">
                        <v-icon color="success" size="32" class="mb-2">mdi-check-circle</v-icon>
                        <div class="text-h5">
                            {{ taskAnalytics.statusDistribution?.find(s => s._id === 'completed')?.count || 0 }}
                        </div>
                        <div class="text-subtitle-2 text-medium-emphasis">Completed</div>
                    </v-card-text>
                </v-card>
            </v-col>
            <v-col cols="12" md="3">
                <v-card elevation="2">
                    <v-card-text class="text-center">
                        <v-icon color="primary" size="32" class="mb-2">mdi-clock-outline</v-icon>
                        <div class="text-h5">
                            {{ taskAnalytics.statusDistribution?.find(s => s._id === 'in_progress')?.count || 0 }}
                        </div>
                        <div class="text-subtitle-2 text-medium-emphasis">In Progress</div>
                    </v-card-text>
                </v-card>
            </v-col>
            <v-col cols="12" md="3">
                <v-card elevation="2">
                    <v-card-text class="text-center">
                        <v-icon color="warning" size="32" class="mb-2">mdi-clock-alert</v-icon>
                        <div class="text-h5">
                            {{ taskAnalytics.statusDistribution?.find(s => s._id === 'pending')?.count || 0 }}
                        </div>
                        <div class="text-subtitle-2 text-medium-emphasis">Pending</div>
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
                        Status Distribution
                    </v-card-title>
                    <v-card-text>
                        <div class="text-center text-medium-emphasis">
                            <v-icon size="64" class="mb-2">mdi-chart-pie</v-icon>
                            <div>Status distribution chart will be displayed here</div>
                            <div class="text-caption">
                                Data: {{ taskAnalytics.statusDistribution?.length || 0 }} status types
                            </div>
                        </div>
                    </v-card-text>
                </v-card>
            </v-col>
            <v-col cols="12" md="6">
                <v-card elevation="2">
                    <v-card-title>
                        <v-icon class="mr-2">mdi-chart-bar</v-icon>
                        Priority Distribution
                    </v-card-title>
                    <v-card-text>
                        <div class="text-center text-medium-emphasis">
                            <v-icon size="64" class="mb-2">mdi-chart-bar</v-icon>
                            <div>Priority distribution chart will be displayed here</div>
                            <div class="text-caption">
                                Data: {{ taskAnalytics.priorityDistribution?.length || 0 }} priority levels
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
                        label="Search tasks..."
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
                    <v-select
                        v-model="selectedPriority"
                        :items="priorityOptions"
                        label="Priority"
                        variant="outlined"
                        density="compact"
                        hide-details
                        style="min-width: 150px;"
                    />
                </div>
            </v-card-text>
        </v-card>

        <!-- Tasks Table -->
        <v-card elevation="2">
            <v-card-title>
                <div class="d-flex align-center justify-space-between w-100">
                    <div class="d-flex align-center">
                        <v-icon class="mr-2" size="24">mdi-file-document-multiple</v-icon>
                        Tasks Data
                    </div>
                    <div class="text-caption text-medium-emphasis">
                        {{ filteredTasks.length }} of {{ tasks.length }} tasks
                    </div>
                </div>
            </v-card-title>
            <v-data-table
                :headers="headers"
                :items="filteredTasks"
                :loading="loading"
                :items-per-page="itemsPerPage"
                class="elevation-0"
                item-key="id"
            >
                <template v-slot:item.priority="{ item }">
                    <v-chip
                        :color="getPriorityColor(item.priority)"
                        size="small"
                        variant="flat"
                    >
                        {{ item.priority?.toUpperCase() }}
                    </v-chip>
                </template>

                <template v-slot:item.status="{ item }">
                    <v-chip
                        :color="getStatusColor(item.status)"
                        size="small"
                        variant="flat"
                    >
                        {{ item.status?.replace('_', ' ').toUpperCase() }}
                    </v-chip>
                </template>

                <template v-slot:item.progress="{ item }">
                    <div class="d-flex align-center">
                        <v-progress-linear
                            :model-value="item.progress || 0"
                            :color="getProgressColor(item.progress || 0)"
                            height="8"
                            rounded
                            class="mr-2"
                            style="min-width: 60px;"
                        />
                        <span class="text-caption">{{ item.progress || 0 }}%</span>
                    </div>
                </template>

                <template v-slot:item.createdAt="{ item }">
                    {{ formatDate(item.createdAt) }}
                </template>

                <template v-slot:item.title="{ item }">
                    <div class="text-truncate" style="max-width: 200px;" :title="item.title">
                        {{ item.title }}
                    </div>
                </template>

                <template v-slot:no-data>
                    <div class="text-center py-4">
                        <v-icon size="48" class="mb-2 text-medium-emphasis">mdi-file-document-outline</v-icon>
                        <div class="text-medium-emphasis">No tasks found</div>
                    </div>
                </template>
            </v-data-table>
        </v-card>
    </div>
</template>

<style scoped>
.admin-tasks {
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
</style>
