<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useTasksStore } from '@/stores/tasks';
import { useAgentsStore } from '@/stores/agents';
import HelpTooltip from '@/components/HelpTooltip.vue';
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
const newTask = ref<CreateTaskRequest & { assignedAgentId?: string }>({
    channelId: '',
    title: '',
    description: '',
    priority: 'medium',
    assignmentStrategy: 'intelligent',
    assignedAgentId: undefined, // For manual assignment
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
        assignedAgentId: undefined,
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

/* Map task status to accent stripe color */
const getStatusAccent = (status: TaskStatus): string => {
    const accents: Record<TaskStatus, string> = {
        completed: 'green',
        in_progress: 'blue',
        assigned: 'cyan',
        pending: 'amber',
        failed: 'red',
        cancelled: 'muted'
    };
    return accents[status] || 'muted';
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
        assignedAgentId: undefined,
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
    <div class="ch-tasks">
        <!-- ░░ Header Strip ░░ -->
        <header class="ch-tasks__header">
            <div class="ch-tasks__header-left">
                <h2 class="ch-tasks__header-title">Tasks</h2>
                <span class="ch-tasks__header-divider">/</span>
                <span class="ch-tasks__header-sub">{{ filteredTasks.length }} of {{ tasksStore.tasks.length }} tasks</span>
            </div>
            <div class="ch-tasks__header-actions">
                <button class="ch-tasks__btn ch-tasks__btn--ghost" @click="loadTasks" :disabled="tasksStore.loading">
                    <v-icon size="14">mdi-refresh</v-icon>
                    <span>Refresh</span>
                </button>
                <button class="ch-tasks__btn ch-tasks__btn--primary" @click="openCreateDialog">
                    <v-icon size="14">mdi-plus</v-icon>
                    <span>Create Task</span>
                </button>
            </div>
        </header>

        <!-- ░░ Summary Metrics Strip ░░ -->
        <section class="ch-tasks__metrics">
            <div class="ch-tasks__metric" data-accent="blue">
                <div class="ch-tasks__metric-head">
                    <span class="ch-tasks__metric-label">Total Tasks</span>
                    <v-icon size="13" class="ch-tasks__metric-ico">mdi-clipboard-list-outline</v-icon>
                </div>
                <div class="ch-tasks__metric-number">{{ tasksStore.taskStatistics.total }}</div>
            </div>
            <div class="ch-tasks__metric" data-accent="cyan">
                <div class="ch-tasks__metric-head">
                    <span class="ch-tasks__metric-label">Active</span>
                    <v-icon size="13" class="ch-tasks__metric-ico">mdi-play-circle-outline</v-icon>
                </div>
                <div class="ch-tasks__metric-number">{{ tasksStore.taskStatistics.activeCount }}</div>
            </div>
            <div class="ch-tasks__metric" data-accent="green">
                <div class="ch-tasks__metric-head">
                    <span class="ch-tasks__metric-label">Completed</span>
                    <v-icon size="13" class="ch-tasks__metric-ico">mdi-check-circle-outline</v-icon>
                </div>
                <div class="ch-tasks__metric-number">{{ tasksStore.taskStatistics.completed }}</div>
            </div>
            <div class="ch-tasks__metric" data-accent="green">
                <div class="ch-tasks__metric-head">
                    <span class="ch-tasks__metric-label">Completion Rate</span>
                    <v-icon size="13" class="ch-tasks__metric-ico">mdi-percent-outline</v-icon>
                </div>
                <div class="ch-tasks__metric-number">{{ tasksStore.taskStatistics.completionRate }}<span class="ch-tasks__metric-unit">%</span></div>
            </div>
            <div class="ch-tasks__metric" data-accent="amber">
                <div class="ch-tasks__metric-head">
                    <span class="ch-tasks__metric-label">Overdue</span>
                    <v-icon size="13" class="ch-tasks__metric-ico">mdi-clock-alert-outline</v-icon>
                </div>
                <div class="ch-tasks__metric-number">{{ tasksStore.overdueTasks.length }}</div>
            </div>
            <div class="ch-tasks__metric" data-accent="red">
                <div class="ch-tasks__metric-head">
                    <span class="ch-tasks__metric-label">Urgent</span>
                    <v-icon size="13" class="ch-tasks__metric-ico">mdi-alert-circle-outline</v-icon>
                </div>
                <div class="ch-tasks__metric-number">{{ tasksStore.taskStatistics.urgent }}</div>
            </div>
        </section>

        <!-- ░░ Filters Card ░░ -->
        <div class="ch-tasks__filters">
            <div class="ch-tasks__filters-head">
                <div class="ch-tasks__filters-title">
                    <v-icon size="16">mdi-filter-variant</v-icon>
                    <span>Filters &amp; Sorting</span>
                </div>
            </div>
            <div class="ch-tasks__filters-body">
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
            </div>
        </div>

        <!-- ░░ Tasks List ░░ -->
        <div class="ch-tasks__list">
            <!-- Loading state -->
            <div v-if="tasksStore.loading && filteredTasks.length === 0" class="ch-tasks__empty">
                <v-progress-circular indeterminate size="48" />
                <p class="ch-tasks__empty-title">Loading tasks...</p>
            </div>

            <!-- Empty state -->
            <div v-else-if="filteredTasks.length === 0" class="ch-tasks__empty">
                <v-icon size="48" class="ch-tasks__empty-icon">mdi-clipboard-text-outline</v-icon>
                <p class="ch-tasks__empty-title">No tasks found</p>
                <p class="ch-tasks__empty-sub">
                    {{ tasksStore.tasks.length === 0 ? 'Create your first task to get started' : 'Try adjusting your filters' }}
                </p>
            </div>

            <!-- Task cards -->
            <div
                v-for="task in filteredTasks"
                :key="task.id"
                class="ch-tasks__card"
                :data-status="getStatusAccent(task.status)"
            >
                <div class="ch-tasks__card-body">
                    <div class="ch-tasks__card-top">
                        <div class="ch-tasks__card-head">
                            <div class="ch-tasks__card-title-row">
                                <h3 class="ch-tasks__card-title">{{ task.title }}</h3>
                                <v-chip
                                    :color="getStatusColor(task.status)"
                                    size="small"
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

                            <p class="ch-tasks__card-desc">{{ task.description }}</p>

                            <div class="ch-tasks__card-meta">
                                <span class="ch-tasks__card-meta-item">
                                    <v-icon size="14">mdi-calendar</v-icon>
                                    Created: {{ formatDate(task.createdAt) }}
                                </span>
                                <span v-if="task.dueDate" class="ch-tasks__card-meta-item">
                                    <v-icon size="14">mdi-clock-outline</v-icon>
                                    Due: {{ formatDate(task.dueDate) }}
                                </span>
                                <span v-if="task.assignedAgentId" class="ch-tasks__card-meta-item ch-tasks__card-meta-mono">
                                    <v-icon size="14">mdi-account</v-icon>
                                    {{ task.assignedAgentId }}
                                </span>
                                <span v-if="task.progress !== undefined" class="ch-tasks__card-meta-item ch-tasks__card-meta-mono">
                                    <v-icon size="14">mdi-progress-check</v-icon>
                                    {{ task.progress }}%
                                </span>
                            </div>

                            <div v-if="task.tags && task.tags.length > 0" class="ch-tasks__card-tags">
                                <v-chip
                                    v-for="tag in task.tags"
                                    :key="tag"
                                    size="x-small"
                                    variant="outlined"
                                >
                                    {{ tag }}
                                </v-chip>
                            </div>

                            <v-progress-linear
                                v-if="task.progress !== undefined"
                                :model-value="task.progress"
                                class="ch-tasks__card-progress"
                                height="4"
                                rounded
                            />
                        </div>

                        <div class="ch-tasks__card-actions">
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
                </div>
            </div>
        </div>

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
                                >
                                    <template #append>
                                        <HelpTooltip
                                            text="How the task should be assigned: Intelligent uses AI to find the best agent, Role Based matches by role, Workload Balanced distributes evenly, Expertise Driven matches capabilities, Manual lets you choose."
                                            docLink="http://mxf.dev/mxf/tasks.html#assignment"
                                        />
                                    </template>
                                </v-select>
                            </v-col>
                            <!-- Show agent selection when manual assignment is selected -->
                            <v-col cols="12" v-if="newTask.assignmentStrategy === 'manual'">
                                <v-select
                                    v-model="newTask.assignedAgentId"
                                    :items="assigneeOptions.filter(a => a.value !== 'all')"
                                    label="Assign to Agent*"
                                    variant="outlined"
                                    :rules="[v => !!v || 'Agent is required for manual assignment']"
                                    :loading="agentsStore.loading"
                                    hint="Select the agent to assign this task to"
                                    persistent-hint
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
/* ════════════════════════════════════════════
   MXF Channel Tasks — Design System
   BEM prefix: ch-tasks__
   ════════════════════════════════════════════ */

.ch-tasks {
    --ch-blue: #4A90C2;
    --ch-green: #10B981;
    --ch-amber: #F59E0B;
    --ch-cyan: #22D3EE;
    --ch-red: #EF4444;
    max-width: 1200px;
    margin: 0 auto;
}

/* ── Header Strip ─────────────────────── */
.ch-tasks__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 0 var(--space-4);
    border-bottom: 1px solid var(--border-subtle);
    margin-bottom: var(--space-4);
}

.ch-tasks__header-left {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    flex-wrap: wrap;
}

.ch-tasks__header-title {
    font-size: var(--text-lg);
    font-weight: 600;
    color: var(--text-primary);
    letter-spacing: -0.01em;
    margin: 0;
}

.ch-tasks__header-divider {
    color: var(--text-muted);
    opacity: 0.4;
    font-weight: 300;
}

.ch-tasks__header-sub {
    font-size: var(--text-sm);
    color: var(--text-muted);
}

.ch-tasks__header-actions {
    display: flex;
    align-items: center;
    gap: var(--space-2);
}

/* ── Buttons ──────────────────────────── */
.ch-tasks__btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 14px;
    border-radius: var(--radius-md);
    font-size: var(--text-sm);
    font-weight: 500;
    cursor: pointer;
    transition: all var(--transition-base);
    border: 1px solid transparent;
    white-space: nowrap;
    font-family: var(--font-sans);
}

.ch-tasks__btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}

.ch-tasks__btn--ghost {
    background: transparent;
    border-color: var(--border-default);
    color: var(--text-secondary);
}

.ch-tasks__btn--ghost:hover:not(:disabled) {
    color: var(--text-primary);
    border-color: var(--ch-blue);
    background: rgba(74, 144, 194, 0.08);
}

.ch-tasks__btn--primary {
    background: var(--ch-blue);
    color: #fff;
    border-color: var(--ch-blue);
}

.ch-tasks__btn--primary:hover:not(:disabled) {
    background: #3a7db0;
    box-shadow: 0 2px 8px rgba(74, 144, 194, 0.3);
}

/* ── Metrics Grid ─────────────────────── */
.ch-tasks__metrics {
    display: grid;
    grid-template-columns: repeat(6, 1fr);
    gap: var(--space-3);
    margin-bottom: var(--space-4);
}

.ch-tasks__metric {
    position: relative;
    padding: var(--space-3) var(--space-4);
    background: var(--bg-base);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-lg);
    transition: all var(--transition-base);
    overflow: hidden;
}

.ch-tasks__metric::before {
    content: '';
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 3px;
    border-radius: 3px 0 0 3px;
    opacity: 0.6;
    transition: opacity var(--transition-base);
}

.ch-tasks__metric[data-accent="blue"]::before  { background: var(--ch-blue); }
.ch-tasks__metric[data-accent="green"]::before { background: var(--ch-green); }
.ch-tasks__metric[data-accent="amber"]::before { background: var(--ch-amber); }
.ch-tasks__metric[data-accent="cyan"]::before  { background: var(--ch-cyan); }
.ch-tasks__metric[data-accent="red"]::before   { background: var(--ch-red); }

.ch-tasks__metric:hover {
    border-color: var(--border-default);
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
}

.ch-tasks__metric:hover::before {
    opacity: 1;
}

.ch-tasks__metric-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: var(--space-1);
}

.ch-tasks__metric-label {
    font-size: var(--text-xs);
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
}

.ch-tasks__metric-ico {
    color: var(--text-muted);
    opacity: 0.5;
}

.ch-tasks__metric-number {
    font-family: var(--font-mono);
    font-size: 1.5rem;
    font-weight: 700;
    color: var(--text-primary);
    line-height: 1;
    letter-spacing: -0.02em;
}

.ch-tasks__metric-unit {
    font-size: 0.6em;
    font-weight: 500;
    opacity: 0.7;
}

/* ── Filters Card ─────────────────────── */
.ch-tasks__filters {
    background: var(--bg-base);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-lg);
    overflow: hidden;
    margin-bottom: var(--space-4);
    transition: border-color var(--transition-base);
}

.ch-tasks__filters:hover {
    border-color: var(--border-default);
}

.ch-tasks__filters-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-4) var(--space-5);
    border-bottom: 1px solid var(--border-subtle);
}

.ch-tasks__filters-title {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--text-primary);
}

.ch-tasks__filters-body {
    padding: var(--space-5);
}

/* ── Tasks List ───────────────────────── */
.ch-tasks__list {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
}

/* ── Task Card ────────────────────────── */
.ch-tasks__card {
    position: relative;
    background: var(--bg-base);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-lg);
    overflow: hidden;
    transition: all var(--transition-base);
}

/* Left accent stripe by status */
.ch-tasks__card::before {
    content: '';
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 3px;
    border-radius: 3px 0 0 3px;
    opacity: 0.6;
    transition: opacity var(--transition-base);
}

.ch-tasks__card[data-status="green"]::before  { background: var(--ch-green); }
.ch-tasks__card[data-status="blue"]::before   { background: var(--ch-blue); }
.ch-tasks__card[data-status="cyan"]::before   { background: var(--ch-cyan); }
.ch-tasks__card[data-status="amber"]::before  { background: var(--ch-amber); }
.ch-tasks__card[data-status="red"]::before    { background: var(--ch-red); }
.ch-tasks__card[data-status="muted"]::before  { background: var(--text-muted); }

.ch-tasks__card:hover {
    border-color: var(--border-default);
    transform: translateY(-2px);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
}

.ch-tasks__card:hover::before {
    opacity: 1;
}

.ch-tasks__card-body {
    padding: var(--space-5);
}

.ch-tasks__card-top {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-4);
}

.ch-tasks__card-head {
    flex: 1;
    min-width: 0;
}

.ch-tasks__card-title-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin-bottom: var(--space-2);
    flex-wrap: wrap;
}

.ch-tasks__card-title {
    font-size: var(--text-base);
    font-weight: 600;
    color: var(--text-primary);
    margin: 0;
}

.ch-tasks__card-desc {
    font-size: var(--text-sm);
    color: var(--text-secondary);
    line-height: 1.6;
    margin: 0 0 var(--space-3);
}

.ch-tasks__card-meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-4);
    margin-bottom: var(--space-2);
}

.ch-tasks__card-meta-item {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    font-size: var(--text-xs);
    color: var(--text-muted);
}

.ch-tasks__card-meta-mono {
    font-family: var(--font-mono);
}

.ch-tasks__card-tags {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
    margin-top: var(--space-2);
}

.ch-tasks__card-progress {
    margin-top: var(--space-3);
}

.ch-tasks__card-actions {
    flex-shrink: 0;
}

/* ── Empty State ──────────────────────── */
.ch-tasks__empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: var(--space-12) var(--space-4);
    text-align: center;
}

.ch-tasks__empty-icon {
    color: var(--text-muted);
    opacity: 0.4;
}

.ch-tasks__empty-title {
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--text-secondary);
    margin: var(--space-3) 0 var(--space-1);
}

.ch-tasks__empty-sub {
    font-size: var(--text-xs);
    color: var(--text-muted);
    margin: 0;
    max-width: 300px;
    line-height: 1.5;
}

/* ── Responsive ───────────────────────── */
@media (max-width: 768px) {
    .ch-tasks__header {
        flex-direction: column;
        align-items: flex-start;
        gap: var(--space-2);
    }

    .ch-tasks__header-actions {
        align-self: flex-end;
    }

    .ch-tasks__metrics {
        grid-template-columns: repeat(3, 1fr);
    }

    .ch-tasks__card-top {
        flex-direction: column;
    }

    .ch-tasks__card-actions {
        align-self: flex-end;
    }
}

@media (max-width: 480px) {
    .ch-tasks__metrics {
        grid-template-columns: repeat(2, 1fr);
    }

    .ch-tasks__metric-number {
        font-size: var(--text-xl);
    }

    .ch-tasks__card-title-row {
        flex-direction: column;
        align-items: flex-start;
    }
}
</style>
