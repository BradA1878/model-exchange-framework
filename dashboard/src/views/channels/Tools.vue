<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';

// Props
interface Props {
    channel?: {
        id: string;
        name: string;
        participants: number;
        status: string;
    };
}

const props = withDefaults(defineProps<Props>(), {
    channel: () => ({ id: 'default', name: 'Default Channel', participants: 0, status: 'active' })
});

// Tools data
const tools = ref([
    {
        id: 'tool-1',
        name: 'messaging_send',
        category: 'communication',
        type: 'mcp',
        status: 'active',
        description: 'Send messages to other agents in the channel',
        usage: 45,
        successRate: 98.2,
        averageLatency: 1.2,
        lastUsed: new Date('2024-01-15T14:30:00'),
        permissions: ['agent_messaging', 'channel_access'],
        schema: {
            type: 'object',
            properties: {
                targetAgentId: { type: 'string' },
                message: { type: 'string' },
                priority: { type: 'string', enum: ['low', 'normal', 'high'] }
            }
        }
    },
    {
        id: 'tool-2',
        name: 'task_complete',
        category: 'task_management',
        type: 'mcp',
        status: 'active',
        description: 'Mark tasks as completed with summary',
        usage: 32,
        successRate: 100.0,
        averageLatency: 0.8,
        lastUsed: new Date('2024-01-15T14:25:00'),
        permissions: ['task_management'],
        schema: {
            type: 'object',
            properties: {
                summary: { type: 'string' },
                outcome: { type: 'string' }
            }
        }
    },
    {
        id: 'tool-3',
        name: 'agent_discover',
        category: 'discovery',
        type: 'mcp',
        status: 'active',
        description: 'Discover other agents in the channel',
        usage: 18,
        successRate: 95.5,
        averageLatency: 2.1,
        lastUsed: new Date('2024-01-15T13:45:00'),
        permissions: ['agent_discovery', 'channel_access'],
        schema: {
            type: 'object',
            properties: {
                capabilities: { type: 'array', items: { type: 'string' } }
            }
        }
    },
    {
        id: 'tool-4',
        name: 'memory_store',
        category: 'memory',
        type: 'internal',
        status: 'active',
        description: 'Store information in agent memory',
        usage: 67,
        successRate: 99.1,
        averageLatency: 0.5,
        lastUsed: new Date('2024-01-15T14:20:00'),
        permissions: ['memory_write'],
        schema: {
            type: 'object',
            properties: {
                key: { type: 'string' },
                value: { type: 'any' },
                importance: { type: 'number' }
            }
        }
    },
    {
        id: 'tool-5',
        name: 'context_analyze',
        category: 'analysis',
        type: 'internal',
        status: 'disabled',
        description: 'Analyze channel context and patterns',
        usage: 8,
        successRate: 87.5,
        averageLatency: 3.4,
        lastUsed: new Date('2024-01-14T16:30:00'),
        permissions: ['context_read', 'analysis'],
        schema: {
            type: 'object',
            properties: {
                scope: { type: 'string', enum: ['channel', 'agent', 'global'] },
                depth: { type: 'number' }
            }
        }
    }
]);

// Filters and sorting
const searchQuery = ref('');
const selectedCategory = ref('all');
const selectedType = ref('all');
const selectedStatus = ref('all');
const sortBy = ref('usage');
const sortDesc = ref(true);

// Loading states
const loading = ref(false);

// Statistics
const toolStats = computed(() => ({
    total: tools.value.length,
    active: tools.value.filter(t => t.status === 'active').length,
    disabled: tools.value.filter(t => t.status === 'disabled').length,
    averageSuccessRate: Math.round(tools.value.reduce((sum, t) => sum + t.successRate, 0) / tools.value.length),
    totalUsage: tools.value.reduce((sum, t) => sum + t.usage, 0)
}));

// Computed filtered tools
const filteredTools = computed(() => {
    let filtered = tools.value.filter(tool => {
        const matchesSearch = !searchQuery.value || 
            tool.name.toLowerCase().includes(searchQuery.value.toLowerCase()) ||
            tool.description.toLowerCase().includes(searchQuery.value.toLowerCase());
        
        const matchesCategory = selectedCategory.value === 'all' || tool.category === selectedCategory.value;
        const matchesType = selectedType.value === 'all' || tool.type === selectedType.value;
        const matchesStatus = selectedStatus.value === 'all' || tool.status === selectedStatus.value;
        
        return matchesSearch && matchesCategory && matchesType && matchesStatus;
    });

    // Sort tools
    if (sortBy.value) {
        filtered.sort((a: any, b: any) => {
            let aVal = a[sortBy.value];
            let bVal = b[sortBy.value];
            
            if (sortBy.value === 'lastUsed') {
                aVal = new Date(aVal).getTime();
                bVal = new Date(bVal).getTime();
            }
            
            const result = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
            return sortDesc.value ? -result : result;
        });
    }

    return filtered;
});

// Methods
const loadTools = async (): Promise<void> => {
    loading.value = true;
    try {
        // TODO: Implement API call to fetch channel tools
        await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (error) {
        console.error('Failed to load tools:', error);
    } finally {
        loading.value = false;
    }
};

const refreshTools = (): void => {
    loadTools();
};

const toggleToolStatus = (toolId: string): void => {
    const tool = tools.value.find(t => t.id === toolId);
    if (tool) {
        tool.status = tool.status === 'active' ? 'disabled' : 'active';
    }
};

const getStatusColor = (status: string): string => {
    switch (status) {
        case 'active': return 'success';
        case 'disabled': return 'error';
        default: return 'default';
    }
};

const getCategoryColor = (category: string): string => {
    switch (category) {
        case 'communication': return 'primary';
        case 'task_management': return 'success';
        case 'discovery': return 'info';
        case 'memory': return 'warning';
        case 'analysis': return 'purple';
        default: return 'default';
    }
};

const getTypeIcon = (type: string): string => {
    switch (type) {
        case 'mcp': return 'mdi-api';
        case 'internal': return 'mdi-cog';
        default: return 'mdi-tool';
    }
};

const formatLastUsed = (date: Date): string => {
    const now = new Date();
    const diffMinutes = Math.floor((now.getTime() - date.getTime()) / (1000 * 60));
    
    if (diffMinutes < 1) return 'Just now';
    if (diffMinutes < 60) return `${diffMinutes}m ago`;
    
    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
};

onMounted(() => {
    loadTools();
});
</script>

<template>
    <div class="tools-view">
        <!-- Header with statistics -->
        <v-row class="mb-4">
            <v-col cols="12">
                <v-card class="stats-card">
                    <v-card-text>
                        <v-row>
                            <v-col cols="6" sm="3" md="2">
                                <div class="stat-item">
                                    <div class="stat-value">{{ toolStats.total }}</div>
                                    <div class="stat-label">Total</div>
                                </div>
                            </v-col>
                            <v-col cols="6" sm="3" md="2">
                                <div class="stat-item">
                                    <div class="stat-value">{{ toolStats.active }}</div>
                                    <div class="stat-label">Active</div>
                                </div>
                            </v-col>
                            <v-col cols="6" sm="3" md="2">
                                <div class="stat-item">
                                    <div class="stat-value">{{ toolStats.disabled }}</div>
                                    <div class="stat-label">Disabled</div>
                                </div>
                            </v-col>
                            <v-col cols="6" sm="3" md="3">
                                <div class="stat-item">
                                    <div class="stat-value">{{ toolStats.averageSuccessRate }}%</div>
                                    <div class="stat-label">Success Rate</div>
                                </div>
                            </v-col>
                            <v-col cols="12" sm="12" md="3">
                                <div class="stat-item">
                                    <div class="stat-value">{{ toolStats.totalUsage }}</div>
                                    <div class="stat-label">Total Usage</div>
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
                                prepend-icon="mdi-plus"
                            >
                                Add Tool
                            </v-btn>
                            <v-spacer />
                            <v-btn
                                variant="outlined"
                                @click="refreshTools"
                                :loading="loading"
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
                                    label="Search tools..."
                                    variant="outlined"
                                    density="compact"
                                    prepend-inner-icon="mdi-magnify"
                                    clearable
                                />
                            </v-col>
                            <v-col cols="4" md="2">
                                <v-select
                                    v-model="selectedCategory"
                                    :items="[
                                        { title: 'All Categories', value: 'all' },
                                        { title: 'Communication', value: 'communication' },
                                        { title: 'Task Management', value: 'task_management' },
                                        { title: 'Discovery', value: 'discovery' },
                                        { title: 'Memory', value: 'memory' },
                                        { title: 'Analysis', value: 'analysis' }
                                    ]"
                                    label="Category"
                                    variant="outlined"
                                    density="compact"
                                />
                            </v-col>
                            <v-col cols="4" md="2">
                                <v-select
                                    v-model="selectedType"
                                    :items="[
                                        { title: 'All Types', value: 'all' },
                                        { title: 'MCP Tools', value: 'mcp' },
                                        { title: 'Internal', value: 'internal' }
                                    ]"
                                    label="Type"
                                    variant="outlined"
                                    density="compact"
                                />
                            </v-col>
                            <v-col cols="4" md="2">
                                <v-select
                                    v-model="selectedStatus"
                                    :items="[
                                        { title: 'All Status', value: 'all' },
                                        { title: 'Active', value: 'active' },
                                        { title: 'Disabled', value: 'disabled' }
                                    ]"
                                    label="Status"
                                    variant="outlined"
                                    density="compact"
                                />
                            </v-col>
                        </v-row>
                    </v-card-text>
                </v-card>
            </v-col>
        </v-row>

        <!-- Tools List -->
        <div v-if="loading" class="text-center pa-8">
            <v-progress-circular indeterminate color="primary" size="64" />
            <p class="text-body-1 mt-4">Loading tools...</p>
        </div>
        
        <div v-else-if="filteredTools.length === 0" class="text-center pa-8">
            <v-icon size="64" color="grey">mdi-wrench-outline</v-icon>
            <p class="text-h6 mt-4">No tools found</p>
            <p class="text-body-2 text-medium-emphasis">Try adjusting your filters</p>
        </div>
        
        <v-card
            v-for="tool in filteredTools"
            :key="tool.id"
            elevation="0"
            class="tool-card mb-4"
        >
            <v-card-text>
                <div class="d-flex align-start justify-space-between">
                    <div class="tool-header flex-grow-1">
                        <div class="d-flex align-center mb-3">
                            <v-icon :color="getCategoryColor(tool.category)" class="mr-3" size="32">
                                {{ getTypeIcon(tool.type) }}
                            </v-icon>
                            <div>
                                <h3 class="text-h6 mb-1">{{ tool.name }}</h3>
                                <div class="d-flex align-center gap-2">
                                    <v-chip
                                        :color="getCategoryColor(tool.category)"
                                        size="small"
                                        variant="tonal"
                                    >
                                        {{ tool.category.replace('_', ' ') }}
                                    </v-chip>
                                    <v-chip
                                        :color="getStatusColor(tool.status)"
                                        size="small"
                                        variant="tonal"
                                    >
                                        {{ tool.status }}
                                    </v-chip>
                                    <v-chip
                                        size="small"
                                        variant="outlined"
                                    >
                                        {{ tool.type }}
                                    </v-chip>
                                </div>
                            </div>
                        </div>
                        
                        <p class="text-body-2 text-medium-emphasis mb-4">{{ tool.description }}</p>
                        
                        <v-row class="tool-metrics mb-4">
                            <v-col cols="6" sm="3">
                                <div class="metric-item">
                                    <div class="metric-value">{{ tool.usage }}</div>
                                    <div class="metric-label">Usage Count</div>
                                </div>
                            </v-col>
                            <v-col cols="6" sm="3">
                                <div class="metric-item">
                                    <div class="metric-value text-success">{{ tool.successRate }}%</div>
                                    <div class="metric-label">Success Rate</div>
                                </div>
                            </v-col>
                            <v-col cols="6" sm="3">
                                <div class="metric-item">
                                    <div class="metric-value">{{ tool.averageLatency }}s</div>
                                    <div class="metric-label">Avg Latency</div>
                                </div>
                            </v-col>
                            <v-col cols="6" sm="3">
                                <div class="metric-item">
                                    <div class="metric-value">{{ formatLastUsed(tool.lastUsed) }}</div>
                                    <div class="metric-label">Last Used</div>
                                </div>
                            </v-col>
                        </v-row>
                        
                        <div class="permissions-section">
                            <div class="text-body-2 font-weight-medium mb-2">Permissions</div>
                            <div class="d-flex flex-wrap gap-1">
                                <v-chip
                                    v-for="permission in tool.permissions"
                                    :key="permission"
                                    size="x-small"
                                    variant="outlined"
                                >
                                    {{ permission.replace('_', ' ') }}
                                </v-chip>
                            </div>
                        </div>
                    </div>
                    
                    <div class="tool-actions ml-4">
                        <div class="d-flex flex-column gap-2">
                            <v-btn
                                size="small"
                                variant="tonal"
                                prepend-icon="mdi-eye"
                            >
                                View Schema
                            </v-btn>
                            <v-btn
                                size="small"
                                variant="tonal"
                                prepend-icon="mdi-chart-line"
                            >
                                Analytics
                            </v-btn>
                            <v-btn
                                size="small"
                                :color="tool.status === 'active' ? 'error' : 'success'"
                                :prepend-icon="tool.status === 'active' ? 'mdi-pause' : 'mdi-play'"
                                @click="toggleToolStatus(tool.id)"
                            >
                                {{ tool.status === 'active' ? 'Disable' : 'Enable' }}
                            </v-btn>
                            <v-menu>
                                <template #activator="{ props: menuProps }">
                                    <v-btn
                                        icon="mdi-dots-vertical"
                                        size="small"
                                        variant="text"
                                        v-bind="menuProps"
                                    />
                                </template>
                                <v-list>
                                    <v-list-item>
                                        <template #prepend>
                                            <v-icon>mdi-cog</v-icon>
                                        </template>
                                        <v-list-item-title>Configure</v-list-item-title>
                                    </v-list-item>
                                    <v-list-item>
                                        <template #prepend>
                                            <v-icon>mdi-content-duplicate</v-icon>
                                        </template>
                                        <v-list-item-title>Duplicate</v-list-item-title>
                                    </v-list-item>
                                    <v-list-item>
                                        <template #prepend>
                                            <v-icon color="error">mdi-delete</v-icon>
                                        </template>
                                        <v-list-item-title>Remove</v-list-item-title>
                                    </v-list-item>
                                </v-list>
                            </v-menu>
                        </div>
                    </div>
                </div>
            </v-card-text>
        </v-card>
    </div>
</template>

<style scoped>
.tools-view {
    max-width: 1200px;
    margin: 0 auto;
}

.stats-card,
.filters-card,
.tool-card {
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

.metric-item {
    text-align: center;
}

.metric-value {
    font-size: 1rem;
    font-weight: 600;
    color: var(--v-theme-primary);
}

.metric-label {
    font-size: 0.75rem;
    opacity: 0.7;
    margin-top: 0.25rem;
}

.tool-actions {
    min-width: 120px;
}

.gap-1 {
    gap: 0.25rem;
}

.gap-2 {
    gap: 0.5rem;
}

/* Responsive adjustments */
@media (max-width: 768px) {
    .tool-actions {
        min-width: unset;
        margin-left: 0;
        margin-top: 1rem;
    }
    
    .stat-value {
        font-size: 1.25rem;
    }
    
    .metric-value {
        font-size: 0.9rem;
    }
}
</style>
