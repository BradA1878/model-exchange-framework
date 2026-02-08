<script setup lang="ts">
import { ref, onMounted, computed, watch, onUnmounted } from 'vue';
import { useDagStore } from '../../stores/dag';
import { useChannelsStore } from '../../stores/channels';

const dagStore = useDagStore();
const channelsStore = useChannelsStore();

// State
const selectedChannel = ref<string | null>(null);
const activeTab = ref('graph');

// Canvas for DAG visualization
const canvasRef = ref<HTMLCanvasElement | null>(null);
let canvasContext: CanvasRenderingContext2D | null = null;

// Computed
const channels = computed(() => channelsStore.channels);

const nodesByStatus = computed(() => {
    if (!dagStore.currentDag) return {};
    const nodes = dagStore.currentDag.nodes;
    return {
        pending: nodes.filter(n => n.status === 'pending'),
        in_progress: nodes.filter(n => n.status === 'in_progress'),
        completed: nodes.filter(n => n.status === 'completed'),
        assigned: nodes.filter(n => n.status === 'assigned')
    };
});

// Methods
const loadData = async () => {
    if (!selectedChannel.value) return;
    await dagStore.loadAllData(selectedChannel.value);
    drawGraph();
};

const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
        pending: '#FFB347',
        assigned: '#87CEEB',
        in_progress: '#4A90C2',
        completed: '#50C878',
        failed: '#FF6B6B'
    };
    return colors[status] || '#9E9E9E';
};

const getPriorityColor = (priority: string) => {
    const colors: Record<string, string> = {
        critical: '#FF6B6B',
        high: '#FFB347',
        medium: '#87CEEB',
        low: '#9E9E9E'
    };
    return colors[priority] || '#9E9E9E';
};

const getStatusIcon = (status: string) => {
    const icons: Record<string, string> = {
        pending: 'mdi-clock-outline',
        assigned: 'mdi-account-check',
        in_progress: 'mdi-progress-check',
        completed: 'mdi-check-circle',
        failed: 'mdi-alert-circle'
    };
    return icons[status] || 'mdi-circle';
};

// Simple DAG visualization using canvas
const drawGraph = () => {
    if (!canvasRef.value || !dagStore.currentDag) return;

    const canvas = canvasRef.value;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvasContext = ctx;

    // Get container dimensions
    const container = canvas.parentElement;
    if (!container) return;

    canvas.width = container.clientWidth;
    canvas.height = 500;

    // Clear canvas
    ctx.fillStyle = 'var(--bg-base)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const nodes = dagStore.currentDag.nodes;
    const edges = dagStore.currentDag.edges;

    if (nodes.length === 0) {
        ctx.fillStyle = '#666';
        ctx.font = '16px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('No tasks with dependencies in this channel', canvas.width / 2, canvas.height / 2);
        return;
    }

    // Calculate node positions using levels
    const levels = dagStore.executionLevels;
    const nodePositions = new Map<string, { x: number; y: number }>();

    const levelWidth = canvas.width / (levels.length + 1);
    const nodeRadius = 30;

    levels.forEach((level, levelIndex) => {
        const levelHeight = canvas.height / (level.length + 1);
        level.forEach((task, taskIndex) => {
            nodePositions.set(task.id, {
                x: levelWidth * (levelIndex + 1),
                y: levelHeight * (taskIndex + 1)
            });
        });
    });

    // Position any orphan nodes (not in execution order)
    const orphanNodes = nodes.filter(n => !nodePositions.has(n.id));
    if (orphanNodes.length > 0) {
        const orphanLevelHeight = canvas.height / (orphanNodes.length + 1);
        orphanNodes.forEach((node, index) => {
            nodePositions.set(node.id, {
                x: 50,
                y: orphanLevelHeight * (index + 1)
            });
        });
    }

    // Draw edges first (behind nodes)
    ctx.strokeStyle = '#555';
    ctx.lineWidth = 2;
    edges.forEach(edge => {
        const from = nodePositions.get(edge.source);
        const to = nodePositions.get(edge.target);
        if (from && to) {
            ctx.beginPath();
            ctx.moveTo(from.x + nodeRadius, from.y);
            ctx.lineTo(to.x - nodeRadius, to.y);
            ctx.stroke();

            // Draw arrow head
            const angle = Math.atan2(to.y - from.y, to.x - from.x);
            const arrowLength = 10;
            ctx.beginPath();
            ctx.moveTo(to.x - nodeRadius, to.y);
            ctx.lineTo(
                to.x - nodeRadius - arrowLength * Math.cos(angle - Math.PI / 6),
                to.y - arrowLength * Math.sin(angle - Math.PI / 6)
            );
            ctx.moveTo(to.x - nodeRadius, to.y);
            ctx.lineTo(
                to.x - nodeRadius - arrowLength * Math.cos(angle + Math.PI / 6),
                to.y - arrowLength * Math.sin(angle + Math.PI / 6)
            );
            ctx.stroke();
        }
    });

    // Draw nodes
    nodes.forEach(node => {
        const pos = nodePositions.get(node.id);
        if (!pos) return;

        // Node circle
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, nodeRadius, 0, Math.PI * 2);
        ctx.fillStyle = getStatusColor(node.status);
        ctx.fill();

        // Node border (highlight if ready)
        if (node.isReady) {
            ctx.strokeStyle = '#50C878';
            ctx.lineWidth = 3;
        } else {
            ctx.strokeStyle = '#333';
            ctx.lineWidth = 1;
        }
        ctx.stroke();

        // Node label
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 10px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const shortLabel = node.label.length > 8 ? node.label.substring(0, 8) + '...' : node.label;
        ctx.fillText(shortLabel, pos.x, pos.y);
    });

    // Draw legend
    ctx.fillStyle = '#666';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('Status:', 10, 20);

    const legendItems = [
        { label: 'Pending', color: '#FFB347' },
        { label: 'In Progress', color: '#4A90C2' },
        { label: 'Completed', color: '#50C878' },
        { label: 'Ready', color: '#50C878', border: true }
    ];

    let legendX = 60;
    legendItems.forEach(item => {
        ctx.beginPath();
        ctx.arc(legendX, 17, 8, 0, Math.PI * 2);
        ctx.fillStyle = item.color;
        ctx.fill();
        if (item.border) {
            ctx.strokeStyle = '#50C878';
            ctx.lineWidth = 2;
            ctx.stroke();
        }
        ctx.fillStyle = '#666';
        ctx.fillText(item.label, legendX + 15, 22);
        legendX += ctx.measureText(item.label).width + 40;
    });
};

// Watchers
watch(selectedChannel, () => {
    if (selectedChannel.value) {
        loadData();
    }
});

watch(() => dagStore.currentDag, () => {
    drawGraph();
}, { deep: true });

// Lifecycle
onMounted(async () => {
    await channelsStore.fetchChannels();
    await dagStore.fetchDagChannels();
    await dagStore.checkStatus();

    // Auto-select first channel with DAG data
    if (dagStore.dagChannels.length > 0) {
        const channelWithDag = dagStore.dagChannels.find(c => c.hasDag);
        if (channelWithDag) {
            selectedChannel.value = channelWithDag.channelId;
        } else if (dagStore.dagChannels.length > 0) {
            selectedChannel.value = dagStore.dagChannels[0].channelId;
        }
    } else if (channels.value.length > 0) {
        selectedChannel.value = channels.value[0].id;
    }
});

onUnmounted(() => {
    dagStore.reset();
});
</script>

<template>
    <div class="dag-container">
        <!-- Header -->
        <div class="dag-header mb-6">
            <div class="d-flex align-center justify-space-between mb-4">
                <div>
                    <h1 class="text-h4 mb-2">Task DAG Visualization</h1>
                    <p class="text-body-1 text-medium-emphasis">
                        View task dependency graphs, critical paths, and execution order
                    </p>
                </div>
                <div class="d-flex align-center gap-3">
                    <v-chip
                        :color="dagStore.dagEnabled ? 'success' : 'warning'"
                        variant="tonal"
                    >
                        DAG System: {{ dagStore.dagEnabled ? 'Enabled' : 'Disabled' }}
                    </v-chip>
                    <v-btn
                        variant="outlined"
                        prepend-icon="mdi-refresh"
                        :loading="dagStore.loading"
                        @click="loadData"
                    >
                        Refresh
                    </v-btn>
                </div>
            </div>

            <!-- Channel Selector -->
            <v-row>
                <v-col cols="12" md="4">
                    <v-select
                        v-model="selectedChannel"
                        :items="dagStore.dagChannels.length > 0 ? dagStore.dagChannels : channels"
                        :item-title="dagStore.dagChannels.length > 0 ? 'name' : 'name'"
                        :item-value="dagStore.dagChannels.length > 0 ? 'channelId' : 'id'"
                        label="Select Channel"
                        variant="outlined"
                        density="compact"
                    >
                        <template #item="{ props, item }">
                            <v-list-item v-bind="props">
                                <template #append>
                                    <v-chip v-if="item.raw.hasDag" size="x-small" color="primary">
                                        Has DAG
                                    </v-chip>
                                </template>
                            </v-list-item>
                        </template>
                    </v-select>
                </v-col>
            </v-row>
        </div>

        <!-- Stats Cards -->
        <v-row v-if="dagStore.currentDag" class="mb-6">
            <v-col cols="6" md="2">
                <v-card elevation="0" class="stat-card">
                    <v-card-text class="text-center">
                        <v-icon size="28" color="primary" class="mb-2">mdi-graph</v-icon>
                        <div class="stat-value">{{ dagStore.currentDag.stats.nodeCount }}</div>
                        <div class="stat-label">Tasks</div>
                    </v-card-text>
                </v-card>
            </v-col>
            <v-col cols="6" md="2">
                <v-card elevation="0" class="stat-card">
                    <v-card-text class="text-center">
                        <v-icon size="28" color="info" class="mb-2">mdi-arrow-right-bold</v-icon>
                        <div class="stat-value">{{ dagStore.currentDag.stats.edgeCount }}</div>
                        <div class="stat-label">Dependencies</div>
                    </v-card-text>
                </v-card>
            </v-col>
            <v-col cols="6" md="2">
                <v-card elevation="0" class="stat-card">
                    <v-card-text class="text-center">
                        <v-icon size="28" color="success" class="mb-2">mdi-play-circle</v-icon>
                        <div class="stat-value">{{ dagStore.currentDag.stats.readyTaskCount }}</div>
                        <div class="stat-label">Ready</div>
                    </v-card-text>
                </v-card>
            </v-col>
            <v-col cols="6" md="2">
                <v-card elevation="0" class="stat-card">
                    <v-card-text class="text-center">
                        <v-icon size="28" color="warning" class="mb-2">mdi-pause-circle</v-icon>
                        <div class="stat-value">{{ dagStore.currentDag.stats.blockedTaskCount }}</div>
                        <div class="stat-label">Blocked</div>
                    </v-card-text>
                </v-card>
            </v-col>
            <v-col cols="6" md="2">
                <v-card elevation="0" class="stat-card">
                    <v-card-text class="text-center">
                        <v-icon size="28" color="error" class="mb-2">mdi-arrow-collapse-down</v-icon>
                        <div class="stat-value">{{ dagStore.currentDag.stats.maxDepth }}</div>
                        <div class="stat-label">Max Depth</div>
                    </v-card-text>
                </v-card>
            </v-col>
            <v-col cols="6" md="2">
                <v-card elevation="0" class="stat-card">
                    <v-card-text class="text-center">
                        <v-icon size="28" class="mb-2" color="success">mdi-check-all</v-icon>
                        <div class="stat-value">{{ dagStore.currentDag.stats.completedTaskCount }}</div>
                        <div class="stat-label">Completed</div>
                    </v-card-text>
                </v-card>
            </v-col>
        </v-row>

        <!-- Main Content -->
        <v-card elevation="0" class="main-card">
            <v-tabs v-model="activeTab" color="primary">
                <v-tab value="graph">
                    <v-icon class="mr-2">mdi-graph</v-icon>
                    Graph View
                </v-tab>
                <v-tab value="critical-path">
                    <v-icon class="mr-2">mdi-arrow-right-bold-circle</v-icon>
                    Critical Path
                </v-tab>
                <v-tab value="ready-tasks">
                    <v-icon class="mr-2">mdi-play-box-multiple</v-icon>
                    Ready Tasks
                </v-tab>
                <v-tab value="execution-order">
                    <v-icon class="mr-2">mdi-format-list-numbered</v-icon>
                    Execution Order
                </v-tab>
            </v-tabs>

            <v-divider />

            <v-card-text>
                <!-- Loading State -->
                <div v-if="dagStore.loading" class="text-center py-8">
                    <v-progress-circular indeterminate color="primary" size="64" />
                    <p class="mt-4 text-body-1">Loading DAG data...</p>
                </div>

                <!-- No Channel Selected -->
                <div v-else-if="!selectedChannel" class="text-center py-8">
                    <v-icon size="64" color="primary" class="mb-4">mdi-graph-outline</v-icon>
                    <h3 class="text-h5 mb-2">Select a Channel</h3>
                    <p class="text-body-1 text-medium-emphasis">
                        Choose a channel to view its task dependency graph
                    </p>
                </div>

                <!-- Graph View Tab -->
                <div v-else-if="activeTab === 'graph'" class="graph-container">
                    <canvas ref="canvasRef"></canvas>
                </div>

                <!-- Critical Path Tab -->
                <div v-else-if="activeTab === 'critical-path'">
                    <div v-if="dagStore.criticalPath.length === 0" class="text-center py-8">
                        <v-icon size="64" color="warning" class="mb-4">mdi-arrow-right-bold-circle-outline</v-icon>
                        <h3 class="text-h6 mb-2">No Critical Path</h3>
                        <p class="text-body-2 text-medium-emphasis">
                            No dependencies found to form a critical path
                        </p>
                    </div>
                    <v-timeline v-else align="start" density="compact">
                        <v-timeline-item
                            v-for="(task, index) in dagStore.criticalPath"
                            :key="task.id"
                            :dot-color="getStatusColor(task.status)"
                            size="small"
                        >
                            <template #opposite>
                                <span class="text-body-2 text-medium-emphasis">Step {{ index + 1 }}</span>
                            </template>
                            <v-card elevation="0" class="timeline-card pa-3">
                                <div class="d-flex align-center justify-space-between">
                                    <div>
                                        <v-icon :icon="getStatusIcon(task.status)" size="small" class="mr-2" />
                                        <span class="font-weight-medium">{{ task.title }}</span>
                                    </div>
                                    <div>
                                        <v-chip
                                            size="x-small"
                                            :color="getStatusColor(task.status)"
                                            variant="tonal"
                                            class="mr-1"
                                        >
                                            {{ task.status }}
                                        </v-chip>
                                        <v-chip
                                            size="x-small"
                                            :color="getPriorityColor(task.priority)"
                                            variant="tonal"
                                        >
                                            {{ task.priority }}
                                        </v-chip>
                                    </div>
                                </div>
                            </v-card>
                        </v-timeline-item>
                    </v-timeline>
                    <div v-if="dagStore.criticalPath.length > 0" class="mt-4 text-center">
                        <v-chip color="info" variant="tonal">
                            Critical Path Length: {{ dagStore.criticalPath.length }} tasks
                        </v-chip>
                    </div>
                </div>

                <!-- Ready Tasks Tab -->
                <div v-else-if="activeTab === 'ready-tasks'">
                    <div v-if="dagStore.readyTasks.length === 0" class="text-center py-8">
                        <v-icon size="64" color="success" class="mb-4">mdi-check-all</v-icon>
                        <h3 class="text-h6 mb-2">No Ready Tasks</h3>
                        <p class="text-body-2 text-medium-emphasis">
                            All tasks are either completed or waiting on dependencies
                        </p>
                    </div>
                    <v-list v-else>
                        <v-list-item
                            v-for="task in dagStore.readyTasks"
                            :key="task.id"
                            class="mb-2 ready-task-item"
                        >
                            <template #prepend>
                                <v-avatar color="success" size="40">
                                    <v-icon>mdi-play</v-icon>
                                </v-avatar>
                            </template>

                            <v-list-item-title class="font-weight-medium">
                                {{ task.title }}
                            </v-list-item-title>
                            <v-list-item-subtitle>
                                {{ task.description || 'No description' }}
                            </v-list-item-subtitle>

                            <template #append>
                                <v-chip
                                    size="small"
                                    :color="getPriorityColor(task.priority)"
                                    variant="tonal"
                                    class="mr-2"
                                >
                                    {{ task.priority }}
                                </v-chip>
                                <v-chip
                                    v-if="task.assignedTo"
                                    size="small"
                                    color="info"
                                    variant="tonal"
                                >
                                    {{ task.assignedTo }}
                                </v-chip>
                            </template>
                        </v-list-item>
                    </v-list>
                    <div v-if="dagStore.totalReadyTasks > dagStore.readyTasks.length" class="text-center mt-4">
                        <v-chip color="info" variant="tonal">
                            Showing {{ dagStore.readyTasks.length }} of {{ dagStore.totalReadyTasks }} ready tasks
                        </v-chip>
                    </div>
                </div>

                <!-- Execution Order Tab -->
                <div v-else-if="activeTab === 'execution-order'">
                    <div v-if="dagStore.executionLevels.length === 0" class="text-center py-8">
                        <v-icon size="64" color="info" class="mb-4">mdi-format-list-numbered</v-icon>
                        <h3 class="text-h6 mb-2">No Execution Order</h3>
                        <p class="text-body-2 text-medium-emphasis">
                            No tasks with dependencies to compute execution order
                        </p>
                    </div>
                    <div v-else>
                        <v-alert v-if="dagStore.executionOrder.length < (dagStore.currentDag?.stats.nodeCount || 0)" type="warning" variant="tonal" class="mb-4">
                            <v-alert-title>Cycle Detected</v-alert-title>
                            Some tasks could not be ordered due to circular dependencies.
                        </v-alert>

                        <v-expansion-panels variant="accordion">
                            <v-expansion-panel
                                v-for="(level, levelIndex) in dagStore.executionLevels"
                                :key="levelIndex"
                            >
                                <v-expansion-panel-title>
                                    <div class="d-flex align-center">
                                        <v-avatar color="primary" size="30" class="mr-3">
                                            {{ levelIndex + 1 }}
                                        </v-avatar>
                                        <span>Level {{ levelIndex + 1 }}</span>
                                        <v-chip size="x-small" class="ml-2">{{ level.length }} tasks</v-chip>
                                        <span class="ml-2 text-medium-emphasis text-body-2">
                                            (can run in parallel)
                                        </span>
                                    </div>
                                </v-expansion-panel-title>
                                <v-expansion-panel-text>
                                    <v-chip
                                        v-for="task in level"
                                        :key="task.id"
                                        :color="getStatusColor(task.status)"
                                        variant="tonal"
                                        class="ma-1"
                                    >
                                        <v-icon :icon="getStatusIcon(task.status)" size="small" class="mr-1" />
                                        {{ task.title }}
                                    </v-chip>
                                </v-expansion-panel-text>
                            </v-expansion-panel>
                        </v-expansion-panels>
                    </div>
                </div>
            </v-card-text>
        </v-card>
    </div>
</template>

<style scoped>
.dag-container {
    max-width: 1400px;
    margin: 0 auto;
}

.stat-card {
    background: var(--bg-base) !important;
    border: 1px solid var(--border-subtle) !important;
    border-radius: var(--radius-lg) !important;
}

.stat-value {
    font-size: var(--text-xl);
    font-weight: 700;
    color: var(--text-primary);
    font-family: var(--font-mono);
}

.stat-label {
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-muted);
}

.main-card {
    background: var(--bg-base) !important;
    border: 1px solid var(--border-subtle) !important;
    border-radius: var(--radius-lg) !important;
}

.graph-container {
    width: 100%;
    min-height: 500px;
    background: var(--bg-elevated);
    border-radius: var(--radius-md);
    overflow: hidden;
}

.graph-container canvas {
    width: 100%;
    height: 500px;
}

.timeline-card {
    background: var(--bg-elevated) !important;
    border: 1px solid var(--border-subtle) !important;
    border-radius: var(--radius-md) !important;
}

.ready-task-item {
    background: var(--bg-elevated);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
}

.gap-3 {
    gap: var(--space-3);
}
</style>
