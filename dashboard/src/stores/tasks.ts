/**
 * Tasks Pinia Store
 * 
 * Manages task state and API interactions for the dashboard
 */

import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import axios from 'axios';
import type { 
    ChannelTask, 
    CreateTaskRequest, 
    UpdateTaskRequest, 
    TaskQueryFilters,
    TaskStatus,
    TaskPriority 
} from '../../../src/shared/types/TaskTypes';

export const useTasksStore = defineStore('tasks', () => {
    // State
    const tasks = ref<ChannelTask[]>([]);
    const loading = ref(false);
    const error = ref<string | null>(null);
    const currentChannelId = ref<string | null>(null);

    // Computed properties
    const tasksByStatus = computed(() => {
        const grouped: Record<TaskStatus, ChannelTask[]> = {
            pending: [],
            assigned: [],
            in_progress: [],
            completed: [],
            failed: [],
            cancelled: []
        };

        tasks.value.forEach((task: ChannelTask) => {
            grouped[task.status].push(task);
        });

        return grouped;
    });

    const tasksByPriority = computed(() => {
        const grouped: Record<TaskPriority, ChannelTask[]> = {
            low: [],
            medium: [],
            high: [],
            urgent: []
        };

        tasks.value.forEach((task: ChannelTask) => {
            grouped[task.priority].push(task);
        });

        return grouped;
    });

    const taskStatistics = computed(() => {
        const total = tasks.value.length;
        const pending = tasksByStatus.value.pending.length;
        const assigned = tasksByStatus.value.assigned.length;
        const inProgress = tasksByStatus.value.in_progress.length;
        const completed = tasksByStatus.value.completed.length;
        const failed = tasksByStatus.value.failed.length;
        const cancelled = tasksByStatus.value.cancelled.length;

        const urgent = tasksByPriority.value.urgent.length;
        const high = tasksByPriority.value.high.length;
        const medium = tasksByPriority.value.medium.length;
        const low = tasksByPriority.value.low.length;

        const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;
        const activeCount = pending + assigned + inProgress;

        return {
            total,
            pending,
            assigned,
            inProgress,
            completed,
            failed,
            cancelled,
            urgent,
            high,
            medium,
            low,
            completionRate,
            activeCount
        };
    });

    const overdueTasks = computed(() => {
        const now = Date.now();
        return tasks.value.filter((task: ChannelTask) => 
            task.dueDate && 
            task.dueDate < now && 
            !['completed', 'failed', 'cancelled'].includes(task.status)
        );
    });

    // Actions
    const fetchTasks = async (channelId: string, filters: TaskQueryFilters = {}): Promise<void> => {
        try {
            loading.value = true;
            error.value = null;
            currentChannelId.value = channelId;

            const queryParams = new URLSearchParams();
            queryParams.append('channelId', channelId);

            if (filters.status) {
                if (Array.isArray(filters.status)) {
                    filters.status.forEach((status: TaskStatus) => queryParams.append('status', status));
                } else {
                    queryParams.append('status', filters.status);
                }
            }

            if (filters.priority) {
                if (Array.isArray(filters.priority)) {
                    filters.priority.forEach((priority: TaskPriority) => queryParams.append('priority', priority));
                } else {
                    queryParams.append('priority', filters.priority);
                }
            }

            if (filters.assignedAgentId) {
                queryParams.append('assignedAgentId', filters.assignedAgentId);
            }

            if (filters.createdBy) {
                queryParams.append('createdBy', filters.createdBy);
            }

            if (filters.tags) {
                filters.tags.forEach((tag: string) => queryParams.append('tags', tag));
            }

            if (filters.dueBefore) {
                queryParams.append('dueBefore', filters.dueBefore.toString());
            }

            if (filters.dueAfter) {
                queryParams.append('dueAfter', filters.dueAfter.toString());
            }

            const response = await axios.get(`/api/tasks?${queryParams.toString()}`);
            
            if (response.data.success) {
                tasks.value = response.data.data || [];
            } else {
                throw new Error(response.data.error || 'Failed to fetch tasks');
            }
        } catch (err: any) {
            const errorMessage = err.response?.data?.error || err.message || 'Failed to fetch tasks';
            error.value = errorMessage;
            console.error('Failed to fetch tasks:', err);
        } finally {
            loading.value = false;
        }
    };

    const createTask = async (taskData: CreateTaskRequest): Promise<ChannelTask | null> => {
        try {
            loading.value = true;
            error.value = null;

            const response = await axios.post('/api/tasks', taskData);
            
            if (response.data.success) {
                const newTask = response.data.data;
                tasks.value.unshift(newTask);
                return newTask;
            } else {
                throw new Error(response.data.error || 'Failed to create task');
            }
        } catch (err: any) {
            const errorMessage = err.response?.data?.error || err.message || 'Failed to create task';
            error.value = errorMessage;
            console.error('Failed to create task:', err);
            return null;
        } finally {
            loading.value = false;
        }
    };

    const updateTask = async (taskId: string, updates: UpdateTaskRequest): Promise<ChannelTask | null> => {
        try {
            loading.value = true;
            error.value = null;

            const response = await axios.patch(`/api/tasks/${taskId}`, updates);
            
            if (response.data.success) {
                const updatedTask = response.data.data;
                const index = tasks.value.findIndex((task: ChannelTask) => task.id === taskId);
                if (index !== -1) {
                    tasks.value[index] = updatedTask;
                }
                return updatedTask;
            } else {
                throw new Error(response.data.error || 'Failed to update task');
            }
        } catch (err: any) {
            const errorMessage = err.response?.data?.error || err.message || 'Failed to update task';
            error.value = errorMessage;
            console.error('Failed to update task:', err);
            return null;
        } finally {
            loading.value = false;
        }
    };

    const assignTask = async (taskId: string, agentId: string): Promise<boolean> => {
        try {
            loading.value = true;
            error.value = null;

            const response = await axios.post(`/api/tasks/${taskId}/assign`, { agentId });
            
            if (response.data.success) {
                const updatedTask = response.data.data;
                const index = tasks.value.findIndex((task: ChannelTask) => task.id === taskId);
                if (index !== -1) {
                    tasks.value[index] = updatedTask;
                }
                return true;
            } else {
                throw new Error(response.data.error || 'Failed to assign task');
            }
        } catch (err: any) {
            const errorMessage = err.response?.data?.error || err.message || 'Failed to assign task';
            error.value = errorMessage;
            console.error('Failed to assign task:', err);
            return false;
        } finally {
            loading.value = false;
        }
    };

    const assignTaskIntelligently = async (taskId: string): Promise<boolean> => {
        try {
            loading.value = true;
            error.value = null;

            const response = await axios.post(`/api/tasks/${taskId}/assign-intelligent`);
            
            if (response.data.success) {
                // Refresh the specific task
                await fetchTaskById(taskId);
                return true;
            } else {
                throw new Error(response.data.error || 'Failed to assign task intelligently');
            }
        } catch (err: any) {
            const errorMessage = err.response?.data?.error || err.message || 'Failed to assign task intelligently';
            error.value = errorMessage;
            console.error('Failed to assign task intelligently:', err);
            return false;
        } finally {
            loading.value = false;
        }
    };

    const fetchTaskById = async (taskId: string): Promise<ChannelTask | null> => {
        try {
            const response = await axios.get(`/api/tasks/${taskId}`);
            
            if (response.data.success) {
                const task = response.data.data;
                const index = tasks.value.findIndex((t: ChannelTask) => t.id === taskId);
                if (index !== -1) {
                    tasks.value[index] = task;
                } else {
                    tasks.value.push(task);
                }
                return task;
            } else {
                throw new Error(response.data.error || 'Failed to fetch task');
            }
        } catch (err: any) {
            const errorMessage = err.response?.data?.error || err.message || 'Failed to fetch task';
            error.value = errorMessage;
            console.error('Failed to fetch task:', err);
            return null;
        }
    };

    const clearTasks = (): void => {
        tasks.value = [];
        currentChannelId.value = null;
        error.value = null;
    };

    const clearError = (): void => {
        error.value = null;
    };

    // Helper functions for filtering and sorting
    const filterTasks = (filters: TaskQueryFilters): ChannelTask[] => {
        let filtered = [...tasks.value];

        if (filters.status) {
            const statusArray = Array.isArray(filters.status) ? filters.status : [filters.status];
            filtered = filtered.filter((task: ChannelTask) => statusArray.includes(task.status));
        }

        if (filters.priority) {
            const priorityArray = Array.isArray(filters.priority) ? filters.priority : [filters.priority];
            filtered = filtered.filter((task: ChannelTask) => priorityArray.includes(task.priority));
        }

        if (filters.assignedAgentId) {
            filtered = filtered.filter((task: ChannelTask) => task.assignedAgentId === filters.assignedAgentId);
        }

        if (filters.createdBy) {
            filtered = filtered.filter((task: ChannelTask) => task.createdBy === filters.createdBy);
        }

        if (filters.tags && filters.tags.length > 0) {
            filtered = filtered.filter((task: ChannelTask) => {
                return filters.tags!.some((tag: string) => task.tags?.includes(tag));
            });
        }

        if (filters.dueBefore) {
            filtered = filtered.filter((task: ChannelTask) => 
                task.dueDate && task.dueDate <= filters.dueBefore!
            );
        }

        if (filters.dueAfter) {
            filtered = filtered.filter((task: ChannelTask) => 
                task.dueDate && task.dueDate >= filters.dueAfter!
            );
        }

        return filtered;
    };

    const sortTasks = (tasks: ChannelTask[], sortBy: string, sortOrder: 'asc' | 'desc' = 'desc'): ChannelTask[] => {
        const sorted = [...tasks];

        sorted.sort((a: ChannelTask, b: ChannelTask) => {
            let aValue: any;
            let bValue: any;

            switch (sortBy) {
                case 'priority':
                    const priorityOrder = { urgent: 4, high: 3, medium: 2, low: 1 };
                    aValue = priorityOrder[a.priority];
                    bValue = priorityOrder[b.priority];
                    break;
                case 'dueDate':
                    aValue = a.dueDate || Number.MAX_SAFE_INTEGER;
                    bValue = b.dueDate || Number.MAX_SAFE_INTEGER;
                    break;
                case 'createdAt':
                    aValue = a.createdAt;
                    bValue = b.createdAt;
                    break;
                case 'updatedAt':
                    aValue = a.updatedAt;
                    bValue = b.updatedAt;
                    break;
                case 'title':
                    aValue = a.title.toLowerCase();
                    bValue = b.title.toLowerCase();
                    break;
                case 'status':
                    aValue = a.status;
                    bValue = b.status;
                    break;
                case 'progress':
                    aValue = a.progress || 0;
                    bValue = b.progress || 0;
                    break;
                default:
                    aValue = a.updatedAt;
                    bValue = b.updatedAt;
            }

            if (aValue < bValue) return sortOrder === 'asc' ? -1 : 1;
            if (aValue > bValue) return sortOrder === 'asc' ? 1 : -1;
            return 0;
        });

        return sorted;
    };

    return {
        // State
        tasks,
        loading,
        error,
        currentChannelId,
        
        // Computed
        tasksByStatus,
        tasksByPriority,
        taskStatistics,
        overdueTasks,
        
        // Actions
        fetchTasks,
        createTask,
        updateTask,
        assignTask,
        assignTaskIntelligently,
        fetchTaskById,
        clearTasks,
        clearError,
        filterTasks,
        sortTasks
    };
});
