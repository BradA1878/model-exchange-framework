<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue';
import { useOrparStore } from '../../stores/orpar';

const orparStore = useOrparStore();

// State
const activeTab = ref('overview');
const selectedAgentId = ref<string | null>(null);
const selectedPhase = ref<string>('observation');

// ORPAR phases for visual display
const phases = [
    { id: 'observation', label: 'Observe', icon: 'mdi-eye', color: '#4A90C2' },
    { id: 'reasoning', label: 'Reason', icon: 'mdi-brain', color: '#FFB347' },
    { id: 'plan', label: 'Plan', icon: 'mdi-clipboard-list', color: '#50C878' },
    { id: 'reflection', label: 'Reflect', icon: 'mdi-mirror', color: '#C9A0DC' }
];

// Agent detail dialog
const agentDetailDialog = ref(false);

// Computed
const currentPhaseIndex = computed(() => {
    if (!orparStore.selectedAgentState?.currentPhase) return -1;
    return phases.findIndex(p => p.id === orparStore.selectedAgentState?.currentPhase);
});

// Methods
const loadData = async () => {
    await orparStore.loadAllData();
};

const viewAgentDetail = async (agentId: string) => {
    selectedAgentId.value = agentId;
    await Promise.all([
        orparStore.fetchAgentState(agentId),
        orparStore.fetchPhaseHistory(agentId, undefined, 30)
    ]);
    agentDetailDialog.value = true;
};

const loadPhaseEntries = async () => {
    await orparStore.fetchPhaseEntries(selectedPhase.value, undefined, undefined, 50);
};

const getPhaseColor = (phase: string) => {
    const phaseObj = phases.find(p => p.id === phase);
    return phaseObj?.color || '#9E9E9E';
};

const getPhaseIcon = (phase: string) => {
    const phaseObj = phases.find(p => p.id === phase);
    return phaseObj?.icon || 'mdi-circle';
};

const getPhaseLabel = (phase: string) => {
    const phaseObj = phases.find(p => p.id === phase);
    return phaseObj?.label || phase;
};

const formatDate = (timestamp: string | number) => {
    if (!timestamp) return 'N/A';
    return new Date(timestamp).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
};

const getTimeAgo = (timestamp: string | number) => {
    if (!timestamp) return 'N/A';
    const diff = Date.now() - new Date(timestamp).getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
};

// Watchers
watch(selectedPhase, () => {
    loadPhaseEntries();
});

// Lifecycle
onMounted(async () => {
    await loadData();
});
</script>

<template>
    <div class="orpar-container">
        <!-- Header -->
        <div class="orpar-header mb-6">
            <div class="d-flex align-center justify-space-between mb-4">
                <div>
                    <h1 class="text-h4 mb-2">ORPAR Control Loop</h1>
                    <p class="text-body-1 text-medium-emphasis">
                        Monitor Observation, Reasoning, Planning, Action, and Reflection cycles
                    </p>
                </div>
                <div class="d-flex align-center gap-3">
                    <v-chip
                        :color="orparStore.status?.enabled ? 'success' : 'warning'"
                        variant="tonal"
                    >
                        ORPAR: {{ orparStore.status?.enabled ? 'Enabled' : 'Disabled' }}
                    </v-chip>
                    <v-btn
                        variant="outlined"
                        prepend-icon="mdi-refresh"
                        :loading="orparStore.loading"
                        @click="loadData"
                    >
                        Refresh
                    </v-btn>
                </div>
            </div>
        </div>

        <!-- Phase Cycle Visualization -->
        <v-card elevation="0" class="cycle-card mb-6">
            <v-card-text>
                <h3 class="text-h6 mb-4 text-center">ORPAR Cycle</h3>
                <div class="cycle-visualization">
                    <div
                        v-for="(phase, index) in phases"
                        :key="phase.id"
                        class="phase-node"
                        :class="{ 'active': index === currentPhaseIndex }"
                    >
                        <div
                            class="phase-circle"
                            :style="{ backgroundColor: phase.color }"
                        >
                            <v-icon color="white">{{ phase.icon }}</v-icon>
                        </div>
                        <span class="phase-label">{{ phase.label }}</span>
                        <span class="phase-count">
                            {{ orparStore.status?.phaseCounts?.[phase.id === 'reflection' ? 'reflections' : phase.id + 's'] || 0 }}
                        </span>
                        <div v-if="index < phases.length - 1" class="phase-arrow">
                            <v-icon>mdi-arrow-right</v-icon>
                        </div>
                    </div>
                    <div class="phase-return-arrow">
                        <v-icon>mdi-arrow-left-bottom</v-icon>
                    </div>
                </div>
            </v-card-text>
        </v-card>

        <!-- Stats Cards -->
        <v-row v-if="orparStore.status" class="mb-6">
            <v-col cols="6" md="3">
                <v-card elevation="0" class="stat-card">
                    <v-card-text class="text-center">
                        <v-icon size="32" color="primary" class="mb-2">mdi-sync</v-icon>
                        <div class="stat-value">{{ orparStore.status.activeLoops }}</div>
                        <div class="stat-label">Active Loops</div>
                    </v-card-text>
                </v-card>
            </v-col>
            <v-col cols="6" md="3">
                <v-card elevation="0" class="stat-card">
                    <v-card-text class="text-center">
                        <v-icon size="32" color="success" class="mb-2">mdi-robot</v-icon>
                        <div class="stat-value">{{ orparStore.status.activeAgents }}</div>
                        <div class="stat-label">Active Agents</div>
                    </v-card-text>
                </v-card>
            </v-col>
            <v-col cols="6" md="3">
                <v-card elevation="0" class="stat-card">
                    <v-card-text class="text-center">
                        <v-icon size="32" color="warning" class="mb-2">mdi-brain</v-icon>
                        <div class="stat-value">{{ orparStore.status.cognitiveMemoryCount }}</div>
                        <div class="stat-label">Cognitive Entries</div>
                    </v-card-text>
                </v-card>
            </v-col>
            <v-col cols="6" md="3">
                <v-card elevation="0" class="stat-card">
                    <v-card-text class="text-center">
                        <v-icon size="32" color="info" class="mb-2">mdi-eye</v-icon>
                        <div class="stat-value">{{ orparStore.status.phaseCounts.observations }}</div>
                        <div class="stat-label">Observations</div>
                    </v-card-text>
                </v-card>
            </v-col>
        </v-row>

        <!-- Main Content -->
        <v-card elevation="0" class="main-card">
            <v-tabs v-model="activeTab" color="primary">
                <v-tab value="overview">
                    <v-icon class="mr-2">mdi-view-dashboard</v-icon>
                    Overview
                </v-tab>
                <v-tab value="active">
                    <v-icon class="mr-2">mdi-sync</v-icon>
                    Active Loops
                </v-tab>
                <v-tab value="agents">
                    <v-icon class="mr-2">mdi-robot</v-icon>
                    Agents
                </v-tab>
                <v-tab value="phases" @click="loadPhaseEntries">
                    <v-icon class="mr-2">mdi-format-list-bulleted</v-icon>
                    Phase Entries
                </v-tab>
            </v-tabs>

            <v-divider />

            <v-card-text>
                <!-- Loading State -->
                <div v-if="orparStore.loading" class="text-center py-8">
                    <v-progress-circular indeterminate color="primary" size="64" />
                    <p class="mt-4 text-body-1">Loading ORPAR data...</p>
                </div>

                <!-- Overview Tab -->
                <div v-else-if="activeTab === 'overview'">
                    <v-row>
                        <v-col cols="12" md="6">
                            <h3 class="text-h6 mb-4">Phase Distribution</h3>
                            <div class="phase-distribution">
                                <div
                                    v-for="phase in phases"
                                    :key="phase.id"
                                    class="phase-bar-item mb-3"
                                >
                                    <div class="d-flex align-center mb-1">
                                        <v-icon :color="phase.color" size="small" class="mr-2">{{ phase.icon }}</v-icon>
                                        <span>{{ phase.label }}</span>
                                        <v-spacer />
                                        <span class="font-weight-bold">
                                            {{ orparStore.status?.phaseCounts?.[phase.id === 'reflection' ? 'reflections' : phase.id + 's'] || 0 }}
                                        </span>
                                    </div>
                                    <v-progress-linear
                                        :model-value="((orparStore.status?.phaseCounts?.[phase.id === 'reflection' ? 'reflections' : phase.id + 's'] || 0) / (orparStore.status?.cognitiveMemoryCount || 1)) * 100"
                                        :color="phase.color"
                                        height="8"
                                        rounded
                                    />
                                </div>
                            </div>
                        </v-col>
                        <v-col cols="12" md="6">
                            <h3 class="text-h6 mb-4">Recent Active Loops</h3>
                            <v-list v-if="orparStore.activeLoops.length > 0">
                                <v-list-item
                                    v-for="loop in orparStore.activeLoops.slice(0, 5)"
                                    :key="`${loop.agentId}-${loop.channelId}`"
                                    class="mb-2 loop-item"
                                    @click="viewAgentDetail(loop.agentId)"
                                >
                                    <template #prepend>
                                        <v-avatar
                                            :color="getPhaseColor(loop.currentPhase || 'observation')"
                                            size="40"
                                        >
                                            <v-icon color="white">{{ getPhaseIcon(loop.currentPhase || 'observation') }}</v-icon>
                                        </v-avatar>
                                    </template>
                                    <v-list-item-title>{{ loop.agentName }}</v-list-item-title>
                                    <v-list-item-subtitle>
                                        <v-chip size="x-small" :color="getPhaseColor(loop.currentPhase || 'observation')">
                                            {{ getPhaseLabel(loop.currentPhase || 'unknown') }}
                                        </v-chip>
                                        <span class="ml-2">{{ getTimeAgo(loop.lastActivity) }}</span>
                                    </v-list-item-subtitle>
                                    <template #append>
                                        <v-chip size="small" variant="tonal">
                                            {{ loop.phaseCount }} phases
                                        </v-chip>
                                    </template>
                                </v-list-item>
                            </v-list>
                            <div v-else class="text-center py-4 text-medium-emphasis">
                                No active loops in the last hour
                            </div>
                        </v-col>
                    </v-row>
                </div>

                <!-- Active Loops Tab -->
                <div v-else-if="activeTab === 'active'">
                    <v-data-table
                        :headers="[
                            { title: 'Agent', key: 'agentName', sortable: true },
                            { title: 'Channel', key: 'channelId', sortable: true },
                            { title: 'Current Phase', key: 'currentPhase', sortable: true },
                            { title: 'Phase Count', key: 'phaseCount', sortable: true },
                            { title: 'Last Activity', key: 'lastActivity', sortable: true },
                            { title: 'Actions', key: 'actions', sortable: false }
                        ]"
                        :items="orparStore.activeLoops"
                        :items-per-page="20"
                        class="elevation-0"
                    >
                        <template #item.agentName="{ item }">
                            <div class="d-flex align-center">
                                <v-icon class="mr-2" size="small">mdi-robot</v-icon>
                                {{ item.agentName }}
                            </div>
                        </template>
                        <template #item.currentPhase="{ item }">
                            <v-chip
                                size="small"
                                :color="getPhaseColor(item.currentPhase)"
                                variant="tonal"
                            >
                                <v-icon :icon="getPhaseIcon(item.currentPhase)" size="small" class="mr-1" />
                                {{ getPhaseLabel(item.currentPhase) }}
                            </v-chip>
                        </template>
                        <template #item.lastActivity="{ item }">
                            {{ getTimeAgo(item.lastActivity) }}
                        </template>
                        <template #item.actions="{ item }">
                            <v-btn icon variant="text" size="small" @click="viewAgentDetail(item.agentId)">
                                <v-icon>mdi-eye</v-icon>
                            </v-btn>
                        </template>
                    </v-data-table>
                </div>

                <!-- Agents Tab -->
                <div v-else-if="activeTab === 'agents'">
                    <v-data-table
                        :headers="[
                            { title: 'Agent', key: 'agentName', sortable: true },
                            { title: 'Status', key: 'status', sortable: true },
                            { title: 'Total Entries', key: 'totalEntries', sortable: true },
                            { title: 'Phases Used', key: 'phasesUsed', sortable: false },
                            { title: 'Last Activity', key: 'lastActivity', sortable: true },
                            { title: 'Actions', key: 'actions', sortable: false }
                        ]"
                        :items="orparStore.orparAgents"
                        :items-per-page="20"
                        class="elevation-0"
                    >
                        <template #item.agentName="{ item }">
                            <div class="d-flex align-center">
                                <v-icon class="mr-2" size="small">mdi-robot</v-icon>
                                {{ item.agentName }}
                            </div>
                        </template>
                        <template #item.status="{ item }">
                            <v-chip
                                size="small"
                                :color="item.status === 'online' ? 'success' : 'warning'"
                                variant="tonal"
                            >
                                {{ item.status }}
                            </v-chip>
                        </template>
                        <template #item.phasesUsed="{ item }">
                            <v-chip
                                v-for="phase in item.phasesUsed"
                                :key="phase"
                                size="x-small"
                                :color="getPhaseColor(phase)"
                                class="mr-1"
                            >
                                {{ getPhaseLabel(phase) }}
                            </v-chip>
                        </template>
                        <template #item.lastActivity="{ item }">
                            {{ getTimeAgo(item.lastActivity) }}
                        </template>
                        <template #item.actions="{ item }">
                            <v-btn icon variant="text" size="small" @click="viewAgentDetail(item.agentId)">
                                <v-icon>mdi-eye</v-icon>
                            </v-btn>
                        </template>
                    </v-data-table>
                </div>

                <!-- Phase Entries Tab -->
                <div v-else-if="activeTab === 'phases'">
                    <v-row class="mb-4">
                        <v-col cols="12" md="4">
                            <v-select
                                v-model="selectedPhase"
                                :items="phases.map(p => ({ title: p.label, value: p.id }))"
                                label="Select Phase"
                                variant="outlined"
                                density="compact"
                            />
                        </v-col>
                    </v-row>

                    <v-list v-if="orparStore.phaseEntries.length > 0">
                        <v-list-item
                            v-for="entry in orparStore.phaseEntries"
                            :key="entry.id"
                            class="mb-2 phase-entry-item"
                        >
                            <template #prepend>
                                <v-avatar
                                    :color="getPhaseColor(selectedPhase)"
                                    size="40"
                                >
                                    <v-icon color="white">{{ getPhaseIcon(selectedPhase) }}</v-icon>
                                </v-avatar>
                            </template>
                            <v-list-item-title>{{ entry.agentName }}</v-list-item-title>
                            <v-list-item-subtitle>
                                {{ entry.content?.summary || JSON.stringify(entry.content).substring(0, 100) }}...
                            </v-list-item-subtitle>
                            <template #append>
                                <span class="text-caption text-medium-emphasis">
                                    {{ formatDate(entry.createdAt) }}
                                </span>
                            </template>
                        </v-list-item>
                    </v-list>
                    <div v-else class="text-center py-8">
                        <v-icon size="64" :color="getPhaseColor(selectedPhase)" class="mb-4">
                            {{ getPhaseIcon(selectedPhase) }}
                        </v-icon>
                        <h3 class="text-h6 mb-2">No {{ getPhaseLabel(selectedPhase) }} Entries</h3>
                        <p class="text-body-2 text-medium-emphasis">
                            No entries found for this phase
                        </p>
                    </div>
                </div>
            </v-card-text>
        </v-card>

        <!-- Agent Detail Dialog -->
        <v-dialog v-model="agentDetailDialog" max-width="900">
            <v-card v-if="orparStore.selectedAgentState">
                <v-card-title class="d-flex align-center">
                    <v-icon class="mr-2">mdi-robot</v-icon>
                    {{ orparStore.selectedAgentState.agentName }}
                    <v-spacer />
                    <v-btn icon variant="text" @click="agentDetailDialog = false">
                        <v-icon>mdi-close</v-icon>
                    </v-btn>
                </v-card-title>

                <v-card-text>
                    <!-- Current Phase Indicator -->
                    <div class="current-phase-indicator mb-6">
                        <h4 class="text-subtitle-2 mb-3">Current Phase</h4>
                        <div class="d-flex justify-center">
                            <v-chip
                                v-if="orparStore.selectedAgentState.currentPhase"
                                :color="getPhaseColor(orparStore.selectedAgentState.currentPhase)"
                                size="large"
                            >
                                <v-icon :icon="getPhaseIcon(orparStore.selectedAgentState.currentPhase)" class="mr-2" />
                                {{ getPhaseLabel(orparStore.selectedAgentState.currentPhase) }}
                            </v-chip>
                            <v-chip v-else color="grey" size="large">
                                <v-icon class="mr-2">mdi-sleep</v-icon>
                                Inactive
                            </v-chip>
                        </div>
                    </div>

                    <!-- Phase Counts -->
                    <v-row class="mb-6">
                        <v-col
                            v-for="phase in phases"
                            :key="phase.id"
                            cols="6"
                            md="3"
                        >
                            <v-card elevation="0" class="text-center pa-3 phase-count-card">
                                <v-icon :color="phase.color" size="32" class="mb-2">{{ phase.icon }}</v-icon>
                                <div class="text-h5 font-weight-bold">
                                    {{ orparStore.selectedAgentState.phaseCounts[phase.id as keyof typeof orparStore.selectedAgentState.phaseCounts] || 0 }}
                                </div>
                                <div class="text-caption">{{ phase.label }}s</div>
                            </v-card>
                        </v-col>
                    </v-row>

                    <!-- Estimated Cycles -->
                    <div class="text-center mb-6">
                        <v-chip color="primary" variant="tonal" size="large">
                            <v-icon class="mr-2">mdi-sync</v-icon>
                            Estimated Cycles: {{ orparStore.selectedAgentState.estimatedCycles }}
                        </v-chip>
                    </div>

                    <!-- Phase History Timeline -->
                    <h4 class="text-subtitle-2 mb-3">Recent Phase Transitions</h4>
                    <v-timeline density="compact" align="start" v-if="orparStore.phaseHistory.length > 0">
                        <v-timeline-item
                            v-for="transition in orparStore.phaseHistory.slice(0, 10)"
                            :key="transition.id"
                            :dot-color="getPhaseColor(transition.phase || 'observation')"
                            size="small"
                        >
                            <template #opposite>
                                <span class="text-caption text-medium-emphasis">
                                    {{ getTimeAgo(transition.timestamp) }}
                                </span>
                            </template>
                            <div class="d-flex align-center">
                                <v-chip
                                    size="small"
                                    :color="getPhaseColor(transition.phase || 'observation')"
                                    class="mr-2"
                                >
                                    {{ getPhaseLabel(transition.phase || 'unknown') }}
                                </v-chip>
                                <span class="text-body-2 text-truncate" style="max-width: 300px;">
                                    {{ transition.summary }}
                                </span>
                            </div>
                        </v-timeline-item>
                    </v-timeline>
                    <div v-else class="text-center py-4 text-medium-emphasis">
                        No phase history available
                    </div>
                </v-card-text>

                <v-card-actions>
                    <v-spacer />
                    <v-btn color="primary" variant="text" @click="agentDetailDialog = false">Close</v-btn>
                </v-card-actions>
            </v-card>
        </v-dialog>
    </div>
</template>

<style scoped>
.orpar-container {
    max-width: 1400px;
    margin: 0 auto;
}

.cycle-card {
    background: var(--bg-base) !important;
    border: 1px solid var(--border-subtle) !important;
    border-radius: var(--radius-lg) !important;
}

.cycle-visualization {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-4);
    padding: var(--space-4);
    position: relative;
    flex-wrap: wrap;
}

.phase-node {
    display: flex;
    flex-direction: column;
    align-items: center;
    position: relative;
    transition: transform var(--transition-base);
}

.phase-node.active {
    transform: scale(1.1);
}

.phase-circle {
    width: 60px;
    height: 60px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: var(--space-2);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
}

.phase-node.active .phase-circle {
    box-shadow: 0 0 20px rgba(74, 144, 194, 0.5);
}

.phase-label {
    font-weight: 600;
    font-size: var(--text-sm);
    color: var(--text-primary);
}

.phase-count {
    font-size: var(--text-xs);
    color: var(--text-muted);
    font-family: var(--font-mono);
}

.phase-arrow {
    position: absolute;
    right: -30px;
    top: 25px;
    color: var(--text-muted);
}

.phase-return-arrow {
    position: absolute;
    bottom: 10px;
    right: 30%;
    color: var(--text-muted);
    transform: rotate(90deg);
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

.loop-item,
.phase-entry-item {
    background: var(--bg-elevated);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
}

.phase-count-card {
    background: var(--bg-elevated) !important;
    border: 1px solid var(--border-subtle) !important;
    border-radius: var(--radius-md) !important;
}

.current-phase-indicator {
    text-align: center;
    padding: var(--space-4);
    background: var(--bg-elevated);
    border-radius: var(--radius-md);
}

.gap-3 {
    gap: var(--space-3);
}

@media (max-width: 768px) {
    .phase-arrow {
        display: none;
    }

    .phase-return-arrow {
        display: none;
    }
}
</style>
