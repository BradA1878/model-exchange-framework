<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue';
import { useKnowledgeGraphStore } from '../../stores/knowledgeGraph';
import { useChannelsStore } from '../../stores/channels';
import { Chart, registerables } from 'chart.js';

// Register Chart.js components
Chart.register(...registerables);

const kgStore = useKnowledgeGraphStore();
const channelsStore = useChannelsStore();

// Tab state
const activeTab = ref('entities');

// Filters
const selectedChannel = ref<string | null>(null);
const searchQuery = ref('');
const selectedEntityType = ref<string | null>(null);
const selectedRelationshipType = ref<string | null>(null);
const minQValue = ref<number>(0);

// Chart refs
const entityTypeChartRef = ref<HTMLCanvasElement | null>(null);
const relationshipTypeChartRef = ref<HTMLCanvasElement | null>(null);
let entityTypeChart: Chart | null = null;
let relationshipTypeChart: Chart | null = null;

// Entity detail dialog
const entityDetailDialog = ref(false);

// Computed
const filteredEntities = computed(() => {
    return kgStore.entities;
});

const channels = computed(() => channelsStore.channels);

// Methods
const loadData = async () => {
    await Promise.all([
        kgStore.fetchStats(selectedChannel.value || undefined),
        kgStore.fetchTypes(),
        kgStore.fetchEntities({
            channelId: selectedChannel.value || undefined,
            type: selectedEntityType.value || undefined,
            search: searchQuery.value || undefined,
            minQValue: minQValue.value > 0 ? minQValue.value : undefined,
            limit: 100
        }),
        kgStore.fetchHighUtility({
            channelId: selectedChannel.value || undefined,
            limit: 10
        })
    ]);
    updateCharts();
};

const loadRelationships = async () => {
    await kgStore.fetchRelationships({
        channelId: selectedChannel.value || undefined,
        type: selectedRelationshipType.value || undefined,
        limit: 100
    });
};

const viewEntityDetail = async (entityId: string) => {
    await kgStore.fetchEntityById(entityId);
    entityDetailDialog.value = true;
};

const updateCharts = () => {
    if (!kgStore.stats) return;

    // Entity Type Distribution Chart
    if (entityTypeChartRef.value) {
        if (entityTypeChart) {
            entityTypeChart.destroy();
        }

        const labels = kgStore.stats.entityTypes.map(t => t._id || 'Unknown');
        const data = kgStore.stats.entityTypes.map(t => t.count);

        entityTypeChart = new Chart(entityTypeChartRef.value, {
            type: 'doughnut',
            data: {
                labels,
                datasets: [{
                    data,
                    backgroundColor: [
                        '#4A90C2', '#50C878', '#FFB347', '#FF6B6B',
                        '#C9A0DC', '#87CEEB', '#F0E68C', '#DDA0DD',
                        '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9'
                    ]
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'right',
                        labels: {
                            color: 'var(--text-secondary)'
                        }
                    }
                }
            }
        });
    }

    // Relationship Type Distribution Chart
    if (relationshipTypeChartRef.value) {
        if (relationshipTypeChart) {
            relationshipTypeChart.destroy();
        }

        const labels = kgStore.stats.relationshipTypes.map(t => t._id || 'Unknown');
        const data = kgStore.stats.relationshipTypes.map(t => t.count);

        relationshipTypeChart = new Chart(relationshipTypeChartRef.value, {
            type: 'bar',
            data: {
                labels,
                datasets: [{
                    label: 'Count',
                    data,
                    backgroundColor: '#4A90C2'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                indexAxis: 'y',
                plugins: {
                    legend: {
                        display: false
                    }
                },
                scales: {
                    x: {
                        ticks: { color: 'var(--text-secondary)' },
                        grid: { color: 'var(--border-subtle)' }
                    },
                    y: {
                        ticks: { color: 'var(--text-secondary)' },
                        grid: { color: 'var(--border-subtle)' }
                    }
                }
            }
        });
    }
};

const formatDate = (timestamp: number) => {
    if (!timestamp) return 'N/A';
    return new Date(timestamp).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
};

const getQValueColor = (qValue: number) => {
    if (qValue >= 0.8) return 'success';
    if (qValue >= 0.6) return 'info';
    if (qValue >= 0.4) return 'warning';
    return 'error';
};

const getEntityTypeIcon = (type: string) => {
    const icons: Record<string, string> = {
        person: 'mdi-account',
        organization: 'mdi-domain',
        project: 'mdi-folder-open',
        system: 'mdi-server',
        technology: 'mdi-code-braces',
        concept: 'mdi-lightbulb',
        location: 'mdi-map-marker',
        document: 'mdi-file-document',
        task: 'mdi-checkbox-marked',
        goal: 'mdi-flag',
        resource: 'mdi-package',
        custom: 'mdi-star'
    };
    return icons[type] || 'mdi-circle';
};

// Watchers
watch([selectedChannel, selectedEntityType, searchQuery], () => {
    loadData();
});

watch(selectedRelationshipType, () => {
    loadRelationships();
});

watch(activeTab, (tab) => {
    if (tab === 'relationships') {
        loadRelationships();
    }
});

// Lifecycle
onMounted(async () => {
    await channelsStore.fetchChannels();
    await loadData();
});
</script>

<template>
    <div class="kg-container">
        <!-- Header -->
        <div class="kg-header mb-6">
            <div class="d-flex align-center justify-space-between mb-4">
                <div>
                    <h1 class="text-h4 mb-2">Knowledge Graph</h1>
                    <p class="text-body-1 text-medium-emphasis">
                        Browse entities, relationships, and Q-value utility data
                    </p>
                </div>
                <v-btn
                    variant="outlined"
                    prepend-icon="mdi-refresh"
                    :loading="kgStore.loading"
                    @click="loadData"
                >
                    Refresh
                </v-btn>
            </div>

            <!-- Filters -->
            <v-row>
                <v-col cols="12" md="3">
                    <v-select
                        v-model="selectedChannel"
                        :items="[{ id: null, name: 'All Channels' }, ...channels]"
                        item-title="name"
                        item-value="id"
                        label="Channel"
                        variant="outlined"
                        density="compact"
                        clearable
                    />
                </v-col>
                <v-col cols="12" md="3">
                    <v-select
                        v-model="selectedEntityType"
                        :items="['', ...kgStore.entityTypes]"
                        label="Entity Type"
                        variant="outlined"
                        density="compact"
                        clearable
                    />
                </v-col>
                <v-col cols="12" md="4">
                    <v-text-field
                        v-model="searchQuery"
                        label="Search entities"
                        prepend-inner-icon="mdi-magnify"
                        variant="outlined"
                        density="compact"
                        clearable
                    />
                </v-col>
                <v-col cols="12" md="2">
                    <v-slider
                        v-model="minQValue"
                        :min="0"
                        :max="1"
                        :step="0.1"
                        label="Min Q-Value"
                        thumb-label
                    />
                </v-col>
            </v-row>
        </div>

        <!-- Stats Cards -->
        <v-row class="mb-6">
            <v-col cols="6" md="3">
                <v-card elevation="0" class="stat-card">
                    <v-card-text class="text-center">
                        <v-icon size="32" color="primary" class="mb-2">mdi-graph</v-icon>
                        <div class="stat-value">{{ kgStore.stats?.entityCount || 0 }}</div>
                        <div class="stat-label">Entities</div>
                    </v-card-text>
                </v-card>
            </v-col>
            <v-col cols="6" md="3">
                <v-card elevation="0" class="stat-card">
                    <v-card-text class="text-center">
                        <v-icon size="32" color="success" class="mb-2">mdi-arrow-right-bold</v-icon>
                        <div class="stat-value">{{ kgStore.stats?.relationshipCount || 0 }}</div>
                        <div class="stat-label">Relationships</div>
                    </v-card-text>
                </v-card>
            </v-col>
            <v-col cols="6" md="3">
                <v-card elevation="0" class="stat-card">
                    <v-card-text class="text-center">
                        <v-icon size="32" color="warning" class="mb-2">mdi-chart-line</v-icon>
                        <div class="stat-value">{{ (kgStore.stats?.qValueStats?.avgQValue || 0.5).toFixed(2) }}</div>
                        <div class="stat-label">Avg Q-Value</div>
                    </v-card-text>
                </v-card>
            </v-col>
            <v-col cols="6" md="3">
                <v-card elevation="0" class="stat-card">
                    <v-card-text class="text-center">
                        <v-icon size="32" color="info" class="mb-2">mdi-check-circle</v-icon>
                        <div class="stat-value">{{ ((kgStore.stats?.qValueStats?.avgConfidence || 1) * 100).toFixed(0) }}%</div>
                        <div class="stat-label">Avg Confidence</div>
                    </v-card-text>
                </v-card>
            </v-col>
        </v-row>

        <!-- Main Content Tabs -->
        <v-card elevation="0" class="main-card">
            <v-tabs v-model="activeTab" color="primary">
                <v-tab value="entities">
                    <v-icon class="mr-2">mdi-circle-multiple</v-icon>
                    Entities
                </v-tab>
                <v-tab value="relationships">
                    <v-icon class="mr-2">mdi-arrow-right-bold</v-icon>
                    Relationships
                </v-tab>
                <v-tab value="high-utility">
                    <v-icon class="mr-2">mdi-star</v-icon>
                    High Utility
                </v-tab>
                <v-tab value="charts">
                    <v-icon class="mr-2">mdi-chart-pie</v-icon>
                    Charts
                </v-tab>
            </v-tabs>

            <v-divider />

            <v-card-text>
                <!-- Loading State -->
                <div v-if="kgStore.loading" class="text-center py-8">
                    <v-progress-circular indeterminate color="primary" size="64" />
                    <p class="mt-4 text-body-1">Loading data...</p>
                </div>

                <!-- Entities Tab -->
                <div v-else-if="activeTab === 'entities'">
                    <v-data-table
                        :headers="[
                            { title: 'Name', key: 'name', sortable: true },
                            { title: 'Type', key: 'type', sortable: true },
                            { title: 'Q-Value', key: 'utility.qValue', sortable: true },
                            { title: 'Confidence', key: 'confidence', sortable: true },
                            { title: 'Source', key: 'source', sortable: true },
                            { title: 'Updated', key: 'updatedAt', sortable: true },
                            { title: 'Actions', key: 'actions', sortable: false }
                        ]"
                        :items="filteredEntities"
                        :items-per-page="20"
                        class="elevation-0"
                    >
                        <template #item.name="{ item }">
                            <div class="d-flex align-center">
                                <v-icon :icon="getEntityTypeIcon(item.type)" class="mr-2" size="small" />
                                <span class="font-weight-medium">{{ item.name }}</span>
                            </div>
                        </template>
                        <template #item.type="{ item }">
                            <v-chip size="small" variant="tonal">{{ item.type }}</v-chip>
                        </template>
                        <template #item.utility.qValue="{ item }">
                            <v-chip
                                size="small"
                                :color="getQValueColor(item.utility?.qValue || 0.5)"
                                variant="tonal"
                            >
                                {{ (item.utility?.qValue || 0.5).toFixed(2) }}
                            </v-chip>
                        </template>
                        <template #item.confidence="{ item }">
                            {{ ((item.confidence || 1) * 100).toFixed(0) }}%
                        </template>
                        <template #item.updatedAt="{ item }">
                            {{ formatDate(item.updatedAt) }}
                        </template>
                        <template #item.actions="{ item }">
                            <v-btn
                                icon
                                variant="text"
                                size="small"
                                @click="viewEntityDetail(item.id)"
                            >
                                <v-icon>mdi-eye</v-icon>
                            </v-btn>
                        </template>
                    </v-data-table>
                </div>

                <!-- Relationships Tab -->
                <div v-else-if="activeTab === 'relationships'">
                    <v-row class="mb-4">
                        <v-col cols="12" md="4">
                            <v-select
                                v-model="selectedRelationshipType"
                                :items="['', ...kgStore.relationshipTypes]"
                                label="Relationship Type"
                                variant="outlined"
                                density="compact"
                                clearable
                            />
                        </v-col>
                    </v-row>

                    <v-data-table
                        :headers="[
                            { title: 'From', key: 'fromEntityId' },
                            { title: 'Type', key: 'type', sortable: true },
                            { title: 'To', key: 'toEntityId' },
                            { title: 'Weight', key: 'weight', sortable: true },
                            { title: 'Confidence', key: 'confidence', sortable: true },
                            { title: 'Surprise', key: 'surpriseScore', sortable: true }
                        ]"
                        :items="kgStore.relationships"
                        :items-per-page="20"
                        class="elevation-0"
                    >
                        <template #item.type="{ item }">
                            <v-chip size="small" color="primary" variant="tonal">{{ item.type }}</v-chip>
                        </template>
                        <template #item.weight="{ item }">
                            {{ (item.weight || 1).toFixed(2) }}
                        </template>
                        <template #item.confidence="{ item }">
                            {{ ((item.confidence || 1) * 100).toFixed(0) }}%
                        </template>
                        <template #item.surpriseScore="{ item }">
                            <v-chip
                                v-if="item.surpriseScore > 0.5"
                                size="small"
                                color="warning"
                                variant="tonal"
                            >
                                {{ (item.surpriseScore || 0).toFixed(2) }}
                            </v-chip>
                            <span v-else>{{ (item.surpriseScore || 0).toFixed(2) }}</span>
                        </template>
                    </v-data-table>
                </div>

                <!-- High Utility Tab -->
                <div v-else-if="activeTab === 'high-utility'">
                    <v-row>
                        <v-col cols="12" md="8">
                            <h3 class="text-h6 mb-4">Top Entities by Q-Value</h3>
                            <v-list>
                                <v-list-item
                                    v-for="(entity, index) in kgStore.highUtilityEntities"
                                    :key="entity.id"
                                    class="mb-2"
                                    @click="viewEntityDetail(entity.id)"
                                >
                                    <template #prepend>
                                        <v-avatar color="primary" size="40">
                                            <span class="text-h6">{{ index + 1 }}</span>
                                        </v-avatar>
                                    </template>

                                    <v-list-item-title>
                                        <v-icon :icon="getEntityTypeIcon(entity.type)" size="small" class="mr-2" />
                                        {{ entity.name }}
                                    </v-list-item-title>
                                    <v-list-item-subtitle>
                                        {{ entity.type }} | Retrievals: {{ entity.utility?.retrievalCount || 0 }} |
                                        Successes: {{ entity.utility?.successCount || 0 }}
                                    </v-list-item-subtitle>

                                    <template #append>
                                        <v-chip
                                            :color="getQValueColor(entity.utility?.qValue || 0.5)"
                                            variant="tonal"
                                        >
                                            Q: {{ (entity.utility?.qValue || 0.5).toFixed(2) }}
                                        </v-chip>
                                    </template>
                                </v-list-item>
                            </v-list>
                        </v-col>
                        <v-col cols="12" md="4">
                            <v-card elevation="0" class="pa-4 stats-summary">
                                <h4 class="text-subtitle-1 mb-3">Q-Value Statistics</h4>
                                <div class="stat-row">
                                    <span>Average:</span>
                                    <strong>{{ (kgStore.stats?.qValueStats?.avgQValue || 0.5).toFixed(3) }}</strong>
                                </div>
                                <div class="stat-row">
                                    <span>Maximum:</span>
                                    <strong>{{ (kgStore.stats?.qValueStats?.maxQValue || 0.5).toFixed(3) }}</strong>
                                </div>
                                <div class="stat-row">
                                    <span>Minimum:</span>
                                    <strong>{{ (kgStore.stats?.qValueStats?.minQValue || 0.5).toFixed(3) }}</strong>
                                </div>
                            </v-card>
                        </v-col>
                    </v-row>
                </div>

                <!-- Charts Tab -->
                <div v-else-if="activeTab === 'charts'">
                    <v-row>
                        <v-col cols="12" md="6">
                            <v-card elevation="0" class="chart-card pa-4">
                                <h4 class="text-subtitle-1 mb-4">Entity Type Distribution</h4>
                                <div class="chart-container">
                                    <canvas ref="entityTypeChartRef"></canvas>
                                </div>
                            </v-card>
                        </v-col>
                        <v-col cols="12" md="6">
                            <v-card elevation="0" class="chart-card pa-4">
                                <h4 class="text-subtitle-1 mb-4">Relationship Type Distribution</h4>
                                <div class="chart-container">
                                    <canvas ref="relationshipTypeChartRef"></canvas>
                                </div>
                            </v-card>
                        </v-col>
                    </v-row>
                </div>
            </v-card-text>
        </v-card>

        <!-- Entity Detail Dialog -->
        <v-dialog v-model="entityDetailDialog" max-width="800">
            <v-card v-if="kgStore.selectedEntity">
                <v-card-title class="d-flex align-center">
                    <v-icon :icon="getEntityTypeIcon(kgStore.selectedEntity.type)" class="mr-2" />
                    {{ kgStore.selectedEntity.name }}
                    <v-spacer />
                    <v-btn icon variant="text" @click="entityDetailDialog = false">
                        <v-icon>mdi-close</v-icon>
                    </v-btn>
                </v-card-title>

                <v-card-text>
                    <v-row>
                        <v-col cols="12" md="6">
                            <h4 class="text-subtitle-2 mb-2">Details</h4>
                            <v-list density="compact">
                                <v-list-item>
                                    <template #prepend>
                                        <v-icon size="small">mdi-tag</v-icon>
                                    </template>
                                    <v-list-item-title>Type</v-list-item-title>
                                    <template #append>
                                        <v-chip size="small">{{ kgStore.selectedEntity.type }}</v-chip>
                                    </template>
                                </v-list-item>
                                <v-list-item>
                                    <template #prepend>
                                        <v-icon size="small">mdi-chart-line</v-icon>
                                    </template>
                                    <v-list-item-title>Q-Value</v-list-item-title>
                                    <template #append>
                                        <v-chip
                                            size="small"
                                            :color="getQValueColor(kgStore.selectedEntity.utility?.qValue || 0.5)"
                                        >
                                            {{ (kgStore.selectedEntity.utility?.qValue || 0.5).toFixed(3) }}
                                        </v-chip>
                                    </template>
                                </v-list-item>
                                <v-list-item>
                                    <template #prepend>
                                        <v-icon size="small">mdi-check-circle</v-icon>
                                    </template>
                                    <v-list-item-title>Confidence</v-list-item-title>
                                    <template #append>
                                        {{ ((kgStore.selectedEntity.confidence || 1) * 100).toFixed(0) }}%
                                    </template>
                                </v-list-item>
                                <v-list-item>
                                    <template #prepend>
                                        <v-icon size="small">mdi-database</v-icon>
                                    </template>
                                    <v-list-item-title>Source</v-list-item-title>
                                    <template #append>
                                        {{ kgStore.selectedEntity.source || 'Unknown' }}
                                    </template>
                                </v-list-item>
                            </v-list>

                            <h4 class="text-subtitle-2 mt-4 mb-2">Utility Metrics</h4>
                            <v-list density="compact">
                                <v-list-item>
                                    <v-list-item-title>Retrievals</v-list-item-title>
                                    <template #append>
                                        {{ kgStore.selectedEntity.utility?.retrievalCount || 0 }}
                                    </template>
                                </v-list-item>
                                <v-list-item>
                                    <v-list-item-title>Successes</v-list-item-title>
                                    <template #append>
                                        {{ kgStore.selectedEntity.utility?.successCount || 0 }}
                                    </template>
                                </v-list-item>
                                <v-list-item>
                                    <v-list-item-title>Failures</v-list-item-title>
                                    <template #append>
                                        {{ kgStore.selectedEntity.utility?.failureCount || 0 }}
                                    </template>
                                </v-list-item>
                            </v-list>
                        </v-col>

                        <v-col cols="12" md="6">
                            <h4 class="text-subtitle-2 mb-2">Description</h4>
                            <p class="text-body-2 mb-4">
                                {{ kgStore.selectedEntity.description || 'No description available' }}
                            </p>

                            <h4 class="text-subtitle-2 mb-2">Aliases</h4>
                            <div class="mb-4">
                                <v-chip
                                    v-for="alias in kgStore.selectedEntity.aliases"
                                    :key="alias"
                                    size="small"
                                    class="mr-1 mb-1"
                                >
                                    {{ alias }}
                                </v-chip>
                                <span v-if="!kgStore.selectedEntity.aliases?.length" class="text-body-2 text-medium-emphasis">
                                    No aliases
                                </span>
                            </div>

                            <h4 class="text-subtitle-2 mb-2">Relationships ({{ kgStore.selectedEntityRelationships.length }})</h4>
                            <v-list density="compact" max-height="200" class="overflow-y-auto">
                                <v-list-item
                                    v-for="rel in kgStore.selectedEntityRelationships"
                                    :key="rel.id"
                                >
                                    <v-list-item-title>
                                        <v-chip size="x-small" color="primary" class="mr-1">{{ rel.type }}</v-chip>
                                        {{ rel.fromEntityId === kgStore.selectedEntity?.id ? '\u2192' : '\u2190' }}
                                        {{ rel.fromEntityId === kgStore.selectedEntity?.id ? rel.toEntityId : rel.fromEntityId }}
                                    </v-list-item-title>
                                </v-list-item>
                                <v-list-item v-if="!kgStore.selectedEntityRelationships.length">
                                    <v-list-item-title class="text-medium-emphasis">No relationships</v-list-item-title>
                                </v-list-item>
                            </v-list>
                        </v-col>
                    </v-row>
                </v-card-text>

                <v-card-actions>
                    <v-spacer />
                    <v-btn color="primary" variant="text" @click="entityDetailDialog = false">Close</v-btn>
                </v-card-actions>
            </v-card>
        </v-dialog>
    </div>
</template>

<style scoped>
.kg-container {
    max-width: 1400px;
    margin: 0 auto;
}

.stat-card {
    background: var(--bg-base) !important;
    border: 1px solid var(--border-subtle) !important;
    border-radius: var(--radius-lg) !important;
}

.stat-value {
    font-size: var(--text-2xl);
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

.chart-card {
    background: var(--bg-elevated) !important;
    border: 1px solid var(--border-subtle) !important;
    border-radius: var(--radius-md) !important;
}

.chart-container {
    height: 300px;
    position: relative;
}

.stats-summary {
    background: var(--bg-elevated) !important;
    border: 1px solid var(--border-subtle) !important;
    border-radius: var(--radius-md) !important;
}

.stat-row {
    display: flex;
    justify-content: space-between;
    padding: var(--space-2) 0;
    border-bottom: 1px solid var(--border-subtle);
}

.stat-row:last-child {
    border-bottom: none;
}
</style>
