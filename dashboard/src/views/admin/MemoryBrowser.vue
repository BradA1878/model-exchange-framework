<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { useMemoryBrowserStore } from '../../stores/memoryBrowser';

const memoryStore = useMemoryBrowserStore();

// State
const activeTab = ref('overview');
const searchQuery = ref('');
const searchScope = ref('all');

// Agent detail dialog
const agentDetailDialog = ref(false);
// Channel detail dialog
const channelDetailDialog = ref(false);

// Methods
const loadData = async () => {
    await Promise.all([
        memoryStore.fetchOverview(),
        memoryStore.fetchHighUtility('all', 10)
    ]);
};

const loadAgentMemories = async () => {
    await memoryStore.fetchAgentMemories(50);
};

const loadChannelMemories = async () => {
    await memoryStore.fetchChannelMemories(50);
};

const loadRelationshipMemories = async () => {
    await memoryStore.fetchRelationshipMemories(50);
};

const viewAgentDetail = async (agentId: string) => {
    await memoryStore.fetchAgentMemoryDetail(agentId);
    await memoryStore.fetchCognitiveMemory(agentId);
    agentDetailDialog.value = true;
};

const viewChannelDetail = async (channelId: string) => {
    await memoryStore.fetchChannelMemoryDetail(channelId);
    channelDetailDialog.value = true;
};

const doSearch = async () => {
    if (!searchQuery.value.trim()) return;
    await memoryStore.searchMemories(searchQuery.value, searchScope.value, 20);
};

const getQValueColor = (qValue: number) => {
    if (qValue >= 0.8) return 'success';
    if (qValue >= 0.6) return 'info';
    if (qValue >= 0.4) return 'warning';
    return 'error';
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

const getScopeIcon = (scope: string) => {
    const icons: Record<string, string> = {
        agent: 'mdi-robot',
        channel: 'mdi-forum',
        relationship: 'mdi-account-multiple'
    };
    return icons[scope] || 'mdi-memory';
};

// Lifecycle
onMounted(async () => {
    await loadData();
});
</script>

<template>
    <div class="memory-container">
        <!-- Header -->
        <div class="memory-header mb-6">
            <div class="d-flex align-center justify-space-between mb-4">
                <div>
                    <h1 class="text-h4 mb-2">Memory Browser</h1>
                    <p class="text-body-1 text-medium-emphasis">
                        Browse agent, channel, and relationship memories with Q-value utility data
                    </p>
                </div>
                <v-btn
                    variant="outlined"
                    prepend-icon="mdi-refresh"
                    :loading="memoryStore.loading"
                    @click="loadData"
                >
                    Refresh
                </v-btn>
            </div>

            <!-- Search Bar -->
            <v-row>
                <v-col cols="12" md="6">
                    <v-text-field
                        v-model="searchQuery"
                        label="Search memories"
                        prepend-inner-icon="mdi-magnify"
                        variant="outlined"
                        density="compact"
                        clearable
                        @keyup.enter="doSearch"
                    />
                </v-col>
                <v-col cols="12" md="3">
                    <v-select
                        v-model="searchScope"
                        :items="[
                            { title: 'All Scopes', value: 'all' },
                            { title: 'Agent', value: 'agent' },
                            { title: 'Channel', value: 'channel' },
                            { title: 'Relationship', value: 'relationship' }
                        ]"
                        label="Scope"
                        variant="outlined"
                        density="compact"
                    />
                </v-col>
                <v-col cols="12" md="3">
                    <v-btn
                        color="primary"
                        block
                        @click="doSearch"
                        :loading="memoryStore.loading"
                    >
                        Search
                    </v-btn>
                </v-col>
            </v-row>
        </div>

        <!-- Stats Cards -->
        <v-row v-if="memoryStore.overview" class="mb-6">
            <v-col cols="6" md="3">
                <v-card elevation="0" class="stat-card">
                    <v-card-text class="text-center">
                        <v-icon size="32" color="primary" class="mb-2">mdi-robot</v-icon>
                        <div class="stat-value">{{ memoryStore.overview.counts.agentMemories }}</div>
                        <div class="stat-label">Agent Memories</div>
                    </v-card-text>
                </v-card>
            </v-col>
            <v-col cols="6" md="3">
                <v-card elevation="0" class="stat-card">
                    <v-card-text class="text-center">
                        <v-icon size="32" color="success" class="mb-2">mdi-forum</v-icon>
                        <div class="stat-value">{{ memoryStore.overview.counts.channelMemories }}</div>
                        <div class="stat-label">Channel Memories</div>
                    </v-card-text>
                </v-card>
            </v-col>
            <v-col cols="6" md="3">
                <v-card elevation="0" class="stat-card">
                    <v-card-text class="text-center">
                        <v-icon size="32" color="warning" class="mb-2">mdi-account-multiple</v-icon>
                        <div class="stat-value">{{ memoryStore.overview.counts.relationshipMemories }}</div>
                        <div class="stat-label">Relationships</div>
                    </v-card-text>
                </v-card>
            </v-col>
            <v-col cols="6" md="3">
                <v-card elevation="0" class="stat-card">
                    <v-card-text class="text-center">
                        <v-icon size="32" color="info" class="mb-2">mdi-chart-line</v-icon>
                        <div class="stat-value">{{ (memoryStore.overview.qValueStats.agent.avgQValue || 0.5).toFixed(2) }}</div>
                        <div class="stat-label">Avg Q-Value</div>
                    </v-card-text>
                </v-card>
            </v-col>
        </v-row>

        <!-- Main Content -->
        <v-card elevation="0" class="main-card">
            <v-tabs v-model="activeTab" color="primary">
                <v-tab value="overview" @click="loadData">
                    <v-icon class="mr-2">mdi-view-dashboard</v-icon>
                    Overview
                </v-tab>
                <v-tab value="agents" @click="loadAgentMemories">
                    <v-icon class="mr-2">mdi-robot</v-icon>
                    Agents
                </v-tab>
                <v-tab value="channels" @click="loadChannelMemories">
                    <v-icon class="mr-2">mdi-forum</v-icon>
                    Channels
                </v-tab>
                <v-tab value="relationships" @click="loadRelationshipMemories">
                    <v-icon class="mr-2">mdi-account-multiple</v-icon>
                    Relationships
                </v-tab>
                <v-tab value="high-utility">
                    <v-icon class="mr-2">mdi-star</v-icon>
                    High Utility
                </v-tab>
            </v-tabs>

            <v-divider />

            <v-card-text>
                <!-- Loading State -->
                <div v-if="memoryStore.loading" class="text-center py-8">
                    <v-progress-circular indeterminate color="primary" size="64" />
                    <p class="mt-4 text-body-1">Loading memories...</p>
                </div>

                <!-- Search Results -->
                <div v-else-if="memoryStore.searchResults" class="search-results">
                    <div class="d-flex align-center justify-space-between mb-4">
                        <h3 class="text-h6">
                            Search Results for "{{ memoryStore.searchResults.query }}"
                            <v-chip size="small" class="ml-2">{{ memoryStore.searchResults.total }} found</v-chip>
                        </h3>
                        <v-btn variant="text" @click="memoryStore.searchResults = null">
                            Clear Search
                        </v-btn>
                    </div>

                    <v-list v-if="memoryStore.searchResults.total > 0">
                        <v-list-item
                            v-for="item in [
                                ...memoryStore.searchResults.results.agentMemories,
                                ...memoryStore.searchResults.results.channelMemories,
                                ...memoryStore.searchResults.results.relationshipMemories
                            ]"
                            :key="item.id"
                            class="mb-2"
                        >
                            <template #prepend>
                                <v-avatar :color="item.scope === 'agent' ? 'primary' : item.scope === 'channel' ? 'success' : 'warning'">
                                    <v-icon>{{ getScopeIcon(item.scope) }}</v-icon>
                                </v-avatar>
                            </template>
                            <v-list-item-title>
                                {{ item.agentId || item.channelId || `${item.agentId1} - ${item.agentId2}` }}
                            </v-list-item-title>
                            <v-list-item-subtitle>
                                Scope: {{ item.scope }} | Updated: {{ formatDate(item.updatedAt) }}
                            </v-list-item-subtitle>
                            <template #append>
                                <v-chip v-if="item.qValue" size="small" :color="getQValueColor(item.qValue)">
                                    Q: {{ item.qValue.toFixed(2) }}
                                </v-chip>
                            </template>
                        </v-list-item>
                    </v-list>
                    <div v-else class="text-center py-8">
                        <v-icon size="64" color="warning" class="mb-4">mdi-magnify-close</v-icon>
                        <h3 class="text-h6">No results found</h3>
                    </div>
                </div>

                <!-- Overview Tab -->
                <div v-else-if="activeTab === 'overview'">
                    <v-row>
                        <v-col cols="12" md="6">
                            <h3 class="text-h6 mb-4">High Utility Memories</h3>
                            <v-list>
                                <v-list-item
                                    v-for="(mem, index) in memoryStore.highUtilityMemories.slice(0, 5)"
                                    :key="mem.id"
                                    class="mb-2"
                                >
                                    <template #prepend>
                                        <v-avatar :color="mem.scope === 'agent' ? 'primary' : 'success'" size="40">
                                            {{ index + 1 }}
                                        </v-avatar>
                                    </template>
                                    <v-list-item-title>
                                        <v-icon :icon="getScopeIcon(mem.scope)" size="small" class="mr-2" />
                                        {{ mem.identifier }}
                                    </v-list-item-title>
                                    <v-list-item-subtitle>
                                        {{ mem.scope }} | Retrievals: {{ mem.retrievalCount }} | Successes: {{ mem.successCount }}
                                    </v-list-item-subtitle>
                                    <template #append>
                                        <v-chip :color="getQValueColor(mem.qValue)" variant="tonal">
                                            Q: {{ mem.qValue.toFixed(2) }}
                                        </v-chip>
                                    </template>
                                </v-list-item>
                            </v-list>
                        </v-col>
                        <v-col cols="12" md="6">
                            <h3 class="text-h6 mb-4">Recent Activity</h3>
                            <v-timeline density="compact" align="start">
                                <v-timeline-item
                                    v-for="activity in (memoryStore.overview?.recentActivity.agentMemories || []).slice(0, 5)"
                                    :key="activity.agentId"
                                    dot-color="primary"
                                    size="small"
                                >
                                    <div class="d-flex align-center">
                                        <v-icon size="small" class="mr-2">mdi-robot</v-icon>
                                        <span>Agent: {{ activity.agentId }}</span>
                                    </div>
                                    <div class="text-caption text-medium-emphasis">
                                        {{ formatDate(activity.updatedAt) }}
                                    </div>
                                </v-timeline-item>
                            </v-timeline>
                        </v-col>
                    </v-row>
                </div>

                <!-- Agents Tab -->
                <div v-else-if="activeTab === 'agents'">
                    <v-data-table
                        :headers="[
                            { title: 'Agent', key: 'agentName', sortable: true },
                            { title: 'Q-Value', key: 'qValue', sortable: true },
                            { title: 'Retrievals', key: 'retrievalCount', sortable: true },
                            { title: 'Persistence', key: 'persistenceLevel', sortable: true },
                            { title: 'Updated', key: 'updatedAt', sortable: true },
                            { title: 'Actions', key: 'actions', sortable: false }
                        ]"
                        :items="memoryStore.agentMemories"
                        :items-per-page="20"
                        class="elevation-0"
                    >
                        <template #item.agentName="{ item }">
                            <div class="d-flex align-center">
                                <v-icon class="mr-2" size="small">mdi-robot</v-icon>
                                {{ item.agentName }}
                            </div>
                        </template>
                        <template #item.qValue="{ item }">
                            <v-chip size="small" :color="getQValueColor(item.qValue)" variant="tonal">
                                {{ item.qValue.toFixed(2) }}
                            </v-chip>
                        </template>
                        <template #item.updatedAt="{ item }">
                            {{ formatDate(item.updatedAt) }}
                        </template>
                        <template #item.actions="{ item }">
                            <v-btn icon variant="text" size="small" @click="viewAgentDetail(item.agentId)">
                                <v-icon>mdi-eye</v-icon>
                            </v-btn>
                        </template>
                    </v-data-table>
                </div>

                <!-- Channels Tab -->
                <div v-else-if="activeTab === 'channels'">
                    <v-data-table
                        :headers="[
                            { title: 'Channel', key: 'channelName', sortable: true },
                            { title: 'Q-Value', key: 'qValue', sortable: true },
                            { title: 'Retrievals', key: 'retrievalCount', sortable: true },
                            { title: 'Shared State', key: 'sharedStateKeys', sortable: false },
                            { title: 'Updated', key: 'updatedAt', sortable: true },
                            { title: 'Actions', key: 'actions', sortable: false }
                        ]"
                        :items="memoryStore.channelMemories"
                        :items-per-page="20"
                        class="elevation-0"
                    >
                        <template #item.channelName="{ item }">
                            <div class="d-flex align-center">
                                <v-icon class="mr-2" size="small">mdi-forum</v-icon>
                                {{ item.channelName }}
                            </div>
                        </template>
                        <template #item.qValue="{ item }">
                            <v-chip size="small" :color="getQValueColor(item.qValue)" variant="tonal">
                                {{ item.qValue.toFixed(2) }}
                            </v-chip>
                        </template>
                        <template #item.sharedStateKeys="{ item }">
                            <v-chip v-if="item.sharedStateKeys.length > 0" size="x-small">
                                {{ item.sharedStateKeys.length }} keys
                            </v-chip>
                            <span v-else class="text-medium-emphasis">None</span>
                        </template>
                        <template #item.updatedAt="{ item }">
                            {{ formatDate(item.updatedAt) }}
                        </template>
                        <template #item.actions="{ item }">
                            <v-btn icon variant="text" size="small" @click="viewChannelDetail(item.channelId)">
                                <v-icon>mdi-eye</v-icon>
                            </v-btn>
                        </template>
                    </v-data-table>
                </div>

                <!-- Relationships Tab -->
                <div v-else-if="activeTab === 'relationships'">
                    <v-data-table
                        :headers="[
                            { title: 'Agent 1', key: 'agent1Name', sortable: true },
                            { title: 'Agent 2', key: 'agent2Name', sortable: true },
                            { title: 'Channel', key: 'channelId', sortable: true },
                            { title: 'Interactions', key: 'interactionCount', sortable: true },
                            { title: 'Updated', key: 'updatedAt', sortable: true }
                        ]"
                        :items="memoryStore.relationshipMemories"
                        :items-per-page="20"
                        class="elevation-0"
                    >
                        <template #item.agent1Name="{ item }">
                            <div class="d-flex align-center">
                                <v-icon class="mr-2" size="small">mdi-account</v-icon>
                                {{ item.agent1Name }}
                            </div>
                        </template>
                        <template #item.agent2Name="{ item }">
                            <div class="d-flex align-center">
                                <v-icon class="mr-2" size="small">mdi-account</v-icon>
                                {{ item.agent2Name }}
                            </div>
                        </template>
                        <template #item.channelId="{ item }">
                            {{ item.channelId || 'N/A' }}
                        </template>
                        <template #item.updatedAt="{ item }">
                            {{ formatDate(item.updatedAt) }}
                        </template>
                    </v-data-table>
                </div>

                <!-- High Utility Tab -->
                <div v-else-if="activeTab === 'high-utility'">
                    <v-list>
                        <v-list-item
                            v-for="(mem, index) in memoryStore.highUtilityMemories"
                            :key="mem.id"
                            class="mb-2 high-utility-item"
                        >
                            <template #prepend>
                                <v-avatar :color="mem.scope === 'agent' ? 'primary' : 'success'" size="48">
                                    <span class="text-h6">{{ index + 1 }}</span>
                                </v-avatar>
                            </template>

                            <v-list-item-title class="font-weight-medium">
                                <v-icon :icon="getScopeIcon(mem.scope)" size="small" class="mr-2" />
                                {{ mem.identifier }}
                            </v-list-item-title>
                            <v-list-item-subtitle>
                                <v-chip size="x-small" class="mr-2">{{ mem.scope }}</v-chip>
                                Retrievals: {{ mem.retrievalCount }} |
                                Successes: {{ mem.successCount }} |
                                Updated: {{ formatDate(mem.updatedAt) }}
                            </v-list-item-subtitle>

                            <template #append>
                                <v-chip :color="getQValueColor(mem.qValue)" size="large">
                                    Q: {{ mem.qValue.toFixed(3) }}
                                </v-chip>
                            </template>
                        </v-list-item>
                    </v-list>
                </div>
            </v-card-text>
        </v-card>

        <!-- Agent Detail Dialog -->
        <v-dialog v-model="agentDetailDialog" max-width="900">
            <v-card v-if="memoryStore.selectedAgentMemory">
                <v-card-title class="d-flex align-center">
                    <v-icon class="mr-2">mdi-robot</v-icon>
                    {{ memoryStore.selectedAgentMemory.agentName }}
                    <v-spacer />
                    <v-btn icon variant="text" @click="agentDetailDialog = false">
                        <v-icon>mdi-close</v-icon>
                    </v-btn>
                </v-card-title>

                <v-card-text>
                    <v-tabs v-model="activeTab" color="primary">
                        <v-tab value="info">Info</v-tab>
                        <v-tab value="cognitive">Cognitive</v-tab>
                        <v-tab value="history">History</v-tab>
                    </v-tabs>

                    <v-divider class="my-4" />

                    <div v-if="activeTab === 'info'">
                        <v-row>
                            <v-col cols="6">
                                <h4 class="text-subtitle-2 mb-2">Utility Metrics</h4>
                                <v-list density="compact">
                                    <v-list-item>
                                        <v-list-item-title>Q-Value</v-list-item-title>
                                        <template #append>
                                            <v-chip :color="getQValueColor(memoryStore.selectedAgentMemory.utility.qValue)">
                                                {{ memoryStore.selectedAgentMemory.utility.qValue.toFixed(3) }}
                                            </v-chip>
                                        </template>
                                    </v-list-item>
                                    <v-list-item>
                                        <v-list-item-title>Retrievals</v-list-item-title>
                                        <template #append>
                                            {{ memoryStore.selectedAgentMemory.utility.retrievalCount }}
                                        </template>
                                    </v-list-item>
                                    <v-list-item>
                                        <v-list-item-title>Successes</v-list-item-title>
                                        <template #append>
                                            {{ memoryStore.selectedAgentMemory.utility.successCount }}
                                        </template>
                                    </v-list-item>
                                    <v-list-item>
                                        <v-list-item-title>Failures</v-list-item-title>
                                        <template #append>
                                            {{ memoryStore.selectedAgentMemory.utility.failureCount }}
                                        </template>
                                    </v-list-item>
                                </v-list>
                            </v-col>
                            <v-col cols="6">
                                <h4 class="text-subtitle-2 mb-2">Custom Data Keys</h4>
                                <v-chip
                                    v-for="key in Object.keys(memoryStore.selectedAgentMemory.customData || {})"
                                    :key="key"
                                    size="small"
                                    class="ma-1"
                                >
                                    {{ key }}
                                </v-chip>
                                <p v-if="!Object.keys(memoryStore.selectedAgentMemory.customData || {}).length" class="text-medium-emphasis">
                                    No custom data
                                </p>
                            </v-col>
                        </v-row>
                    </div>

                    <div v-else-if="activeTab === 'cognitive' && memoryStore.cognitiveMemory">
                        <v-row>
                            <v-col cols="6" md="3">
                                <v-card elevation="0" class="text-center pa-3">
                                    <v-icon size="32" color="info">mdi-eye</v-icon>
                                    <div class="text-h6">{{ memoryStore.cognitiveMemory.summary.observationCount }}</div>
                                    <div class="text-caption">Observations</div>
                                </v-card>
                            </v-col>
                            <v-col cols="6" md="3">
                                <v-card elevation="0" class="text-center pa-3">
                                    <v-icon size="32" color="warning">mdi-brain</v-icon>
                                    <div class="text-h6">{{ memoryStore.cognitiveMemory.summary.reasoningCount }}</div>
                                    <div class="text-caption">Reasonings</div>
                                </v-card>
                            </v-col>
                            <v-col cols="6" md="3">
                                <v-card elevation="0" class="text-center pa-3">
                                    <v-icon size="32" color="success">mdi-clipboard-list</v-icon>
                                    <div class="text-h6">{{ memoryStore.cognitiveMemory.summary.planCount }}</div>
                                    <div class="text-caption">Plans</div>
                                </v-card>
                            </v-col>
                            <v-col cols="6" md="3">
                                <v-card elevation="0" class="text-center pa-3">
                                    <v-icon size="32" color="primary">mdi-mirror</v-icon>
                                    <div class="text-h6">{{ memoryStore.cognitiveMemory.summary.reflectionCount }}</div>
                                    <div class="text-caption">Reflections</div>
                                </v-card>
                            </v-col>
                        </v-row>
                    </div>

                    <div v-else-if="activeTab === 'history'">
                        <v-list max-height="400" class="overflow-y-auto">
                            <v-list-item
                                v-for="(msg, idx) in memoryStore.selectedAgentMemory.conversationHistory.slice(-20)"
                                :key="idx"
                            >
                                <v-list-item-title class="text-wrap">
                                    {{ typeof msg.content === 'string' ? msg.content.substring(0, 200) : JSON.stringify(msg.content).substring(0, 200) }}...
                                </v-list-item-title>
                                <v-list-item-subtitle>
                                    {{ formatDate(msg.timestamp) }}
                                </v-list-item-subtitle>
                            </v-list-item>
                            <v-list-item v-if="!memoryStore.selectedAgentMemory.conversationHistory.length">
                                <v-list-item-title class="text-medium-emphasis">No conversation history</v-list-item-title>
                            </v-list-item>
                        </v-list>
                    </div>
                </v-card-text>

                <v-card-actions>
                    <v-spacer />
                    <v-btn color="primary" variant="text" @click="agentDetailDialog = false">Close</v-btn>
                </v-card-actions>
            </v-card>
        </v-dialog>

        <!-- Channel Detail Dialog -->
        <v-dialog v-model="channelDetailDialog" max-width="900">
            <v-card v-if="memoryStore.selectedChannelMemory">
                <v-card-title class="d-flex align-center">
                    <v-icon class="mr-2">mdi-forum</v-icon>
                    {{ memoryStore.selectedChannelMemory.channelName }}
                    <v-spacer />
                    <v-btn icon variant="text" @click="channelDetailDialog = false">
                        <v-icon>mdi-close</v-icon>
                    </v-btn>
                </v-card-title>

                <v-card-text>
                    <v-row>
                        <v-col cols="6">
                            <h4 class="text-subtitle-2 mb-2">Utility Metrics</h4>
                            <v-list density="compact">
                                <v-list-item>
                                    <v-list-item-title>Q-Value</v-list-item-title>
                                    <template #append>
                                        <v-chip :color="getQValueColor(memoryStore.selectedChannelMemory.utility.qValue)">
                                            {{ memoryStore.selectedChannelMemory.utility.qValue.toFixed(3) }}
                                        </v-chip>
                                    </template>
                                </v-list-item>
                                <v-list-item>
                                    <v-list-item-title>Retrievals</v-list-item-title>
                                    <template #append>
                                        {{ memoryStore.selectedChannelMemory.utility.retrievalCount }}
                                    </template>
                                </v-list-item>
                            </v-list>
                        </v-col>
                        <v-col cols="6">
                            <h4 class="text-subtitle-2 mb-2">Shared State</h4>
                            <v-chip
                                v-for="key in Object.keys(memoryStore.selectedChannelMemory.sharedState || {})"
                                :key="key"
                                size="small"
                                class="ma-1"
                            >
                                {{ key }}
                            </v-chip>
                            <p v-if="!Object.keys(memoryStore.selectedChannelMemory.sharedState || {}).length" class="text-medium-emphasis">
                                No shared state
                            </p>
                        </v-col>
                    </v-row>
                </v-card-text>

                <v-card-actions>
                    <v-spacer />
                    <v-btn color="primary" variant="text" @click="channelDetailDialog = false">Close</v-btn>
                </v-card-actions>
            </v-card>
        </v-dialog>
    </div>
</template>

<style scoped>
.memory-container {
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

.high-utility-item {
    background: var(--bg-elevated);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
}
</style>
