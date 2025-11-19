<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useTasksStore } from '@/stores/tasks';
import { useAgentsStore } from '@/stores/agents';
import type { 
    ChannelTask, 
    CreateTaskRequest, 
    TaskStatus, 
    TaskPriority 
} from '../../../../src/shared/types/TaskTypes';

// Stores
const tasksStore = useTasksStore();
const agentsStore = useAgentsStore();
const route = useRoute();

// State
const searchQuery = ref('');
const statusFilter = ref<TaskStatus | 'all'>('all');
const priorityFilter = ref<TaskPriority | 'all'>('all');
const assigneeFilter = ref<string | 'all'>('all');
const sortBy = ref('updatedAt');
const sortOrder = ref<'asc' | 'desc'>('desc');
const createDialog = ref(false);
const editDialog = ref(false);
const editingTask = ref<ChannelTask | null>(null);

// Create task form
const newTask = ref<CreateTaskRequest>({
    channelId: '',
    title: '',
    description: '',
    priority: 'medium',
    assignmentStrategy: 'intelligent',
    dueDate: undefined,
    estimatedDuration: undefined,
    requiredRoles: [],
    requiredCapabilities: [],
    tags: []
});

// Form helpers
const dueDateInput = ref('');

// Snackbar
const snackbar = ref(false);
const snackbarMessage = ref('');
const snackbarColor = ref('success');

// Computed properties
const channelId = computed(() => route.params.channelId as string);

const filteredTasks = computed(() => {
    let filtered = [...tasksStore.tasks];

    // Search filter
    if (searchQuery.value) {
        const query = searchQuery.value.toLowerCase();
        filtered = filtered.filter((task: ChannelTask) =>
            task.title.toLowerCase().includes(query) ||
            task.description.toLowerCase().includes(query) ||
            task.tags?.some((tag: string) => tag.toLowerCase().includes(query))
        );
    }

    // Status filter
    if (statusFilter.value !== 'all') {
        filtered = filtered.filter((task: ChannelTask) => task.status === statusFilter.value);
    }

    // Priority filter
    if (priorityFilter.value !== 'all') {
        filtered = filtered.filter((task: ChannelTask) => task.priority === priorityFilter.value);
    }

    // Assignee filter
    if (assigneeFilter.value !== 'all') {
        filtered = filtered.filter((task: ChannelTask) => task.assignedAgentId === assigneeFilter.value);
    }

    // Sort tasks - manual sorting since store method signature differs
    return [...filtered].sort((a, b) => {
        const aVal = a[sortBy.value as keyof ChannelTask];
        const bVal = b[sortBy.value as keyof ChannelTask];
        
        if (typeof aVal === 'string' && typeof bVal === 'string') {
            const comparison = aVal.localeCompare(bVal);
            return sortOrder.value === 'asc' ? comparison : -comparison;
        }
        
        if (typeof aVal === 'number' && typeof bVal === 'number') {
            const comparison = aVal - bVal;
            return sortOrder.value === 'asc' ? comparison : -comparison;
        }
        
        return 0;
    });
});

const statusOptions = [
    { title: 'All', value: 'all' },
    { title: 'Pending', value: 'pending' },
    { title: 'Assigned', value: 'assigned' },
    { title: 'In Progress', value: 'in_progress' },
    { title: 'Completed', value: 'completed' },
    { title: 'Failed', value: 'failed' },
    { title: 'Cancelled', value: 'cancelled' }
];

const priorityOptions = [
    { title: 'All', value: 'all' },
    { title: 'Low', value: 'low' },
    { title: 'Medium', value: 'medium' },
    { title: 'High', value: 'high' },
    { title: 'Urgent', value: 'urgent' }
];

const sortOptions = [
    { title: 'Updated', value: 'updatedAt' },
    { title: 'Created', value: 'createdAt' },
    { title: 'Priority', value: 'priority' },
    { title: 'Due Date', value: 'dueDate' },
    { title: 'Title', value: 'title' },
    { title: 'Status', value: 'status' },
    { title: 'Progress', value: 'progress' }
];

const assigneeOptions = computed(() => {
    const options = [{ title: 'All Assignees', value: 'all' }];
    
    // Add available agents as assignee options
    agentsStore.agents.forEach((agent) => {
        options.push({
            title: agent.name || agent.id,
            value: agent.id
        });
    });

    return options;
});

// Methods
const loadTasks = async (): Promise<void> => {
    if (channelId.value) {
        await tasksStore.fetchTasks(channelId.value);
        await agentsStore.fetchAgents(channelId.value);
    }
};

const openCreateDialog = (): void => {
    newTask.value = {
        channelId: channelId.value,
        title: '',
        description: '',
        priority: 'medium',
        assignmentStrategy: 'intelligent',
        dueDate: undefined,
        estimatedDuration: undefined,
        requiredRoles: [],
        requiredCapabilities: [],
        tags: []
    };
    createDialog.value = true;
};

const createTask = async (): Promise<void> => {
    try {
        if (!newTask.value.title.trim()) {
            showSnackbar('Task title is required', 'error');
            return;
        }

        if (!newTask.value.description.trim()) {
            showSnackbar('Task description is required', 'error');
            return;
        }

        const result = await tasksStore.createTask(newTask.value);
        if (result) {
            createDialog.value = false;
            showSnackbar('Task created successfully', 'success');
            await loadTasks();
        } else {
            showSnackbar(tasksStore.error || 'Failed to create task', 'error');
        }
    } catch (error) {
        console.error('Error creating task:', error);
        showSnackbar('Failed to create task', 'error');
    }
};

const openEditDialog = (task: ChannelTask): void => {
    editingTask.value = { ...task };
    editDialog.value = true;
};

const updateTask = async (): Promise<void> => {
    if (!editingTask.value) return;

    try {
        const updates = {
            status: editingTask.value.status,
            priority: editingTask.value.priority,
            progress: editingTask.value.progress,
            dueDate: editingTask.value.dueDate,
            metadata: editingTask.value.metadata,
            tags: editingTask.value.tags
        };

        const result = await tasksStore.updateTask(editingTask.value.id, updates);
        if (result) {
            editDialog.value = false;
            editingTask.value = null;
            showSnackbar('Task updated successfully', 'success');
        } else {
            showSnackbar(tasksStore.error || 'Failed to update task', 'error');
        }
    } catch (error) {
        console.error('Error updating task:', error);
        showSnackbar('Failed to update task', 'error');
    }
};

const assignTaskIntelligently = async (taskId: string): Promise<void> => {
    try {
        const success = await tasksStore.assignTaskIntelligently(taskId);
        if (success) {
            showSnackbar('Task assigned intelligently', 'success');
        } else {
            showSnackbar(tasksStore.error || 'Failed to assign task', 'error');
        }
    } catch (error) {
        console.error('Error assigning task:', error);
        showSnackbar('Failed to assign task', 'error');
    }
};

const getStatusColor = (status: TaskStatus): string => {
    const colors: Record<TaskStatus, string> = {
        pending: 'orange',
        assigned: 'blue',
        in_progress: 'purple',
        completed: 'green',
        failed: 'red',
        cancelled: 'grey'
    };
    return colors[status] || 'grey';
};

const getPriorityColor = (priority: TaskPriority): string => {
    const colors: Record<TaskPriority, string> = {
        low: 'green',
        medium: 'orange',
        high: 'red',
        urgent: 'deep-purple'
    };
    return colors[priority] || 'grey';
};

const formatDate = (timestamp: number): string => {
    return new Date(timestamp).toLocaleDateString();
};

const showSnackbar = (message: string, color: string): void => {
    snackbarMessage.value = message;
    snackbarColor.value = color;
    snackbar.value = true;
};

const cancelCreate = (): void => {
    createDialog.value = false;
    newTask.value = {
        channelId: channelId.value,
        title: '',
        description: '',
        priority: 'medium',
        assignmentStrategy: 'intelligent',
        dueDate: undefined,
        estimatedDuration: undefined,
        requiredRoles: [],
        requiredCapabilities: [],
        tags: []
    };
};

const cancelEdit = (): void => {
    editDialog.value = false;
    editingTask.value = null;
};

// Watchers
watch(
    () => route.params.channelId,
    (newChannelId) => {
        if (newChannelId) {
            loadTasks();
        }
    },
    { immediate: true }
);

watch(
    () => tasksStore.error,
    (error) => {
        if (error) {
            showSnackbar(error, 'error');
            tasksStore.clearError();
        }
    }
);

// Lifecycle
onMounted(() => {
    loadTasks();
});
</script>

<template>
    <div class="tasks-view">
        <!-- Header with statistics -->
        <v-row class="mb-4">
            <v-col cols="12">
                <v-card class="stats-card">
                    <v-card-text>
                        <v-row>
                            <v-col cols="6" sm="3" md="2">
                                <div class="stat-item">
                                    <div class="stat-value">{{ tasksStore.taskStatistics.total }}</div>
                                    <div class="stat-label">Total Tasks</div>
                                </div>
                            </v-col>
                            <v-col cols="6" sm="3" md="2">
                                <div class="stat-item">
                                    <div class="stat-value">{{ tasksStore.taskStatistics.activeCount }}</div>
                                    <div class="stat-label">Active</div>
                                </div>
                            </v-col>
                            <v-col cols="6" sm="3" md="2">
                                <div class="stat-item">
                                    <div class="stat-value">{{ tasksStore.taskStatistics.completed }}</div>
                                    <div class="stat-label">Completed</div>
                                </div>
                            </v-col>
                            <v-col cols="6" sm="3" md="2">
                                <div class="stat-item">
                                    <div class="stat-value">{{ tasksStore.taskStatistics.completionRate }}%</div>
                                    <div class="stat-label">Completion Rate</div>
                                </div>
                            </v-col>
                            <v-col cols="6" sm="3" md="2">
                                <div class="stat-item">
                                    <div class="stat-value">{{ tasksStore.overdueTasks.length }}</div>
                                    <div class="stat-label">Overdue</div>
                                </div>
                            </v-col>
                            <v-col cols="6" sm="3" md="2">
                                <div class="stat-item">
                                    <div class="stat-value">{{ tasksStore.taskStatistics.urgent }}</div>
                                    <div class="stat-label">Urgent</div>
                                </div>
                            </v-col>
                        </v-row>
                    </v-card-text>
                </v-card>
            </v-col>
        </v-row>

        <!-- Controls and filters -->
        <v-row class="mb-4">
            <v-col cols="12">
                <v-card class="filters-card">
                    <v-card-text>
                        <!-- Action buttons -->
                        <div class="d-flex align-center mb-4">
                            <v-btn
                                color="primary"
                                @click="openCreateDialog"
                                prepend-icon="mdi-plus"
                            >
                                Create Task
                            </v-btn>
                            <v-spacer />
                            <v-btn
                                variant="outlined"
                                @click="loadTasks"
                                :loading="tasksStore.loading"
                                prepend-icon="mdi-refresh"
                            >
                                Refresh
                            </v-btn>
                        </div>

                        <!-- Filters row -->
                        <v-row>
                            <v-col cols="12" md="3">
                                <v-text-field
                                    v-model="searchQuery"
                                    label="Search tasks..."
                                    variant="outlined"
                                    density="compact"
                                    prepend-inner-icon="mdi-magnify"
                                    clearable
                                />
                            </v-col>
                            <v-col cols="6" md="2">
                                <v-select
                                    v-model="statusFilter"
                                    :items="statusOptions"
                                    label="Status"
                                    variant="outlined"
                                    density="compact"
                                />
                            </v-col>
                            <v-col cols="6" md="2">
                                <v-select
                                    v-model="priorityFilter"
                                    :items="priorityOptions"
                                    label="Priority"
                                    variant="outlined"
                                    density="compact"
                                />
                            </v-col>
                            <v-col cols="6" md="2">
                                <v-select
                                    v-model="assigneeFilter"
                                    :items="assigneeOptions"
                                    label="Assignee"
                                    variant="outlined"
                                    density="compact"
                                />
                            </v-col>
                            <v-col cols="6" md="2">
                                <v-select
                                    v-model="sortBy"
                                    :items="sortOptions"
                                    label="Sort By"
                                    variant="outlined"
                                    density="compact"
                                />
                            </v-col>
                            <v-col cols="12" md="1">
                                <v-btn
                                    :icon="sortOrder === 'asc' ? 'mdi-sort-ascending' : 'mdi-sort-descending'"
                                    variant="outlined"
                                    @click="sortOrder = sortOrder === 'asc' ? 'desc' : 'asc'"
                                />
                            </v-col>
                        </v-row>
                    </v-card-text>
                </v-card>
            </v-col>
        </v-row>

        <!-- Tasks list -->
        <v-row>
            <v-col cols="12">
                <v-card v-if="tasksStore.loading && filteredTasks.length === 0">
                    <v-card-text class="text-center py-8">
                        <v-progress-circular indeterminate size="64" />
                        <div class="mt-4">Loading tasks...</div>
                    </v-card-text>
                </v-card>

                <v-card v-else-if="filteredTasks.length === 0">
                    <v-card-text class="text-center py-8">
                        <v-icon size="64" color="grey-lighten-1">mdi-clipboard-text-outline</v-icon>
                        <div class="text-h6 mt-4 mb-2">No tasks found</div>
                        <div class="text-body-2 text-medium-emphasis">
                            {{ tasksStore.tasks.length === 0 ? 'Create your first task to get started' : 'Try adjusting your filters' }}
                        </div>
                    </v-card-text>
                </v-card>

                <div v-else>
                    <v-card
                        v-for="task in filteredTasks" 
                        :key="task.id"
                        class="task-card mb-3"
                    >
                        <v-card-text>
                            <div class="d-flex align-start">
                                <div class="flex-grow-1">
                                    <div class="d-flex align-center mb-2">
                                        <h3 class="text-h6 me-3">{{ task.title }}</h3>
                                        <v-chip
                                            :color="getStatusColor(task.status)"
                                            size="small"
                                            class="me-2"
                                        >
                                            {{ task.status.replace('_', ' ').toUpperCase() }}
                                        </v-chip>
                                        <v-chip
                                            :color="getPriorityColor(task.priority)"
                                            size="small"
                                            variant="outlined"
                                        >
                                            {{ task.priority.toUpperCase() }}
                                        </v-chip>
                                    </div>
                                    
                                    <p class="text-body-2 mb-3">{{ task.description }}</p>
                                    
                                    <div class="d-flex flex-wrap align-center text-caption text-medium-emphasis">
                                        <span class="me-4">
                                            <v-icon size="small" class="me-1">mdi-calendar</v-icon>
                                            Created: {{ formatDate(task.createdAt) }}
                                        </span>
                                        <span v-if="task.dueDate" class="me-4">
                                            <v-icon size="small" class="me-1">mdi-clock-outline</v-icon>
                                            Due: {{ formatDate(task.dueDate) }}
                                        </span>
                                        <span v-if="task.assignedAgentId" class="me-4">
                                            <v-icon size="small" class="me-1">mdi-account</v-icon>
                                            {{ task.assignedAgentId }}
                                        </span>
                                        <span v-if="task.progress !== undefined" class="me-4">
                                            <v-icon size="small" class="me-1">mdi-progress-check</v-icon>
                                            {{ task.progress }}%
                                        </span>
                                    </div>

                                    <div v-if="task.tags && task.tags.length > 0" class="mt-2">
                                        <v-chip
                                            v-for="tag in task.tags"
                                            :key="tag"
                                            size="x-small"
                                            class="me-1"
                                            variant="outlined"
                                        >
                                            {{ tag }}
                                        </v-chip>
                                    </div>

                                    <v-progress-linear
                                        v-if="task.progress !== undefined"
                                        :model-value="task.progress"
                                        class="mt-3"
                                        height="4"
                                        rounded
                                    />
                                </div>

                                <div class="ms-4">
                                    <v-menu>
                                        <template #activator="{ props }">
                                            <v-btn
                                                icon="mdi-dots-vertical"
                                                variant="text"
                                                size="small"
                                                v-bind="props"
                                            />
                                        </template>
                                        <v-list>
                                            <v-list-item @click="openEditDialog(task)">
                                                <template #prepend>
                                                    <v-icon>mdi-pencil</v-icon>
                                                </template>
                                                <v-list-item-title>Edit Task</v-list-item-title>
                                            </v-list-item>
                                            <v-list-item 
                                                v-if="task.status === 'pending'"
                                                @click="assignTaskIntelligently(task.id)"
                                            >
                                                <template #prepend>
                                                    <v-icon>mdi-robot</v-icon>
                                                </template>
                                                <v-list-item-title>Assign Intelligently</v-list-item-title>
                                            </v-list-item>
                                        </v-list>
                                    </v-menu>
                                </div>
                            </div>
                        </v-card-text>
                    </v-card>
                </div>
            </v-col>
        </v-row>

        <!-- Create Task Dialog -->
        <v-dialog v-model="createDialog" max-width="700px">
            <v-card>
                <v-card-title>
                    <span class="text-h5">Create New Task</span>
                </v-card-title>
                <v-card-text>
                    <v-container>
                        <v-row>
                            <v-col cols="12">
                                <v-text-field
                                    v-model="newTask.title"
                                    label="Task Title*"
                                    variant="outlined"
                                    required
                                />
                            </v-col>
                            <v-col cols="12">
                                <v-textarea
                                    v-model="newTask.description"
                                    label="Description*"
                                    variant="outlined"
                                    rows="3"
                                    required
                                />
                            </v-col>
                            <v-col cols="6">
                                <v-select
                                    v-model="newTask.priority"
                                    :items="[
                                        { title: 'Low', value: 'low' },
                                        { title: 'Medium', value: 'medium' },
                                        { title: 'High', value: 'high' },
                                        { title: 'Urgent', value: 'urgent' }
                                    ]"
                                    label="Priority"
                                    variant="outlined"
                                />
                            </v-col>
                            <v-col cols="6">
                                <v-select
                                    v-model="newTask.assignmentStrategy"
                                    :items="[
                                        { title: 'Intelligent', value: 'intelligent' },
                                        { title: 'Role Based', value: 'role_based' },
                                        { title: 'Workload Balanced', value: 'workload_balanced' },
                                        { title: 'Expertise Driven', value: 'expertise_driven' },
                                        { title: 'Manual', value: 'manual' }
                                    ]"
                                    label="Assignment Strategy"
                                    variant="outlined"
                                />
                            </v-col>
                            <v-col cols="6">
                                <v-text-field
                                    v-model="newTask.estimatedDuration"
                                    label="Estimated Duration (minutes)"
                                    variant="outlined"
                                    type="number"
                                />
                            </v-col>
                            <v-col cols="6">
                                <v-text-field
                                    v-model="dueDateInput"
                                    label="Due Date"
                                    variant="outlined"
                                    type="datetime-local"
                                />
                            </v-col>
                            <v-col cols="12">
                                <v-combobox
                                    v-model="newTask.requiredRoles"
                                    label="Required Roles"
                                    variant="outlined"
                                    multiple
                                    chips
                                    clearable
                                />
                            </v-col>
                            <v-col cols="12">
                                <v-combobox
                                    v-model="newTask.requiredCapabilities"
                                    label="Required Capabilities"
                                    variant="outlined"
                                    multiple
                                    chips
                                    clearable
                                />
                            </v-col>
                            <v-col cols="12">
                                <v-combobox
                                    v-model="newTask.tags"
                                    label="Tags"
                                    variant="outlined"
                                    multiple
                                    chips
                                    clearable
                                />
                            </v-col>
                        </v-row>
                    </v-container>
                </v-card-text>
                <v-card-actions>
                    <v-spacer />
                    <v-btn @click="cancelCreate">Cancel</v-btn>
                    <v-btn
                        color="primary"
                        :loading="tasksStore.loading"
                        @click="createTask"
                    >
                        Create Task
                    </v-btn>
                </v-card-actions>
            </v-card>
        </v-dialog>

        <!-- Edit Task Dialog -->
        <v-dialog v-model="editDialog" max-width="600px">
            <v-card v-if="editingTask">
                <v-card-title>
                    <span class="text-h5">Edit Task</span>
                </v-card-title>
                <v-card-text>
                    <v-container>
                        <v-row>
                            <v-col cols="12">
                                <v-text-field
                                    v-model="editingTask.title"
                                    label="Task Title"
                                    variant="outlined"
                                    readonly
                                />
                            </v-col>
                            <v-col cols="6">
                                <v-select
                                    v-model="editingTask.status"
                                    :items="[
                                        { title: 'Pending', value: 'pending' },
                                        { title: 'Assigned', value: 'assigned' },
                                        { title: 'In Progress', value: 'in_progress' },
                                        { title: 'Completed', value: 'completed' },
                                        { title: 'Failed', value: 'failed' },
                                        { title: 'Cancelled', value: 'cancelled' }
                                    ]"
                                    label="Status"
                                    variant="outlined"
                                />
                            </v-col>
                            <v-col cols="6">
                                <v-select
                                    v-model="editingTask.priority"
                                    :items="[
                                        { title: 'Low', value: 'low' },
                                        { title: 'Medium', value: 'medium' },
                                        { title: 'High', value: 'high' },
                                        { title: 'Urgent', value: 'urgent' }
                                    ]"
                                    label="Priority"
                                    variant="outlined"
                                />
                            </v-col>
                            <v-col cols="12">
                                <v-slider
                                    v-model="editingTask.progress"
                                    label="Progress"
                                    min="0"
                                    max="100"
                                    step="5"
                                    thumb-label
                                    :thumb-size="24"
                                />
                            </v-col>
                            <v-col cols="12">
                                <v-combobox
                                    v-model="editingTask.tags"
                                    label="Tags"
                                    variant="outlined"
                                    multiple
                                    chips
                                    clearable
                                />
                            </v-col>
                        </v-row>
                    </v-container>
                </v-card-text>
                <v-card-actions>
                    <v-spacer />
                    <v-btn @click="cancelEdit">Cancel</v-btn>
                    <v-btn
                        color="primary"
                        :loading="tasksStore.loading"
                        @click="updateTask"
                    >
                        Update Task
                    </v-btn>
                </v-card-actions>
            </v-card>
        </v-dialog>

        <!-- Snackbar for notifications -->
        <v-snackbar
            v-model="snackbar"
            :color="snackbarColor"
            timeout="4000"
            top
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
.tasks-view {
    max-width: 1200px;
    margin: 0 auto;
}

.stats-card,
.filters-card,
.task-card {
    background: var(--v-theme-card-bg);
    border: 1px solid rgba(255, 255, 255, 0.1);
}

.stat-item {
    text-align: center;
}

.stat-value {
    font-size: 1.5rem;
    font-weight: 600;
    line-height: 1.2;
}

.stat-label {
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    opacity: 0.7;
    margin-top: 4px;
}

.task-card {
    transition: all 0.2s ease;
}

.task-card:hover {
    transform: translateY(-2px);
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.1);
}

.mono-font {
    font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
}
</style>
