<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useMemoryStore, type MemoryEntry } from '@/stores/memory';

const route = useRoute();
const memoryStore = useMemoryStore();

// Get channelId from route params
const channelId = computed(() => route.params.channelId as string);

// Use store data
const memories = computed(() => memoryStore.memories);
const isLoading = computed(() => memoryStore.isLoading);
const error = computed(() => memoryStore.error);

// Loading states
const loading = ref(false);
const deleteLoading = ref<string>('');

// Memory statistics (computed from memories array)
const memoryStats = computed(() => ({
    total: memories.value.length,
    highImportance: memories.value.filter(m => m.importance === 'high').length,
    mediumImportance: memories.value.filter(m => m.importance === 'medium').length,
    lowImportance: memories.value.filter(m => m.importance === 'low').length,
    byType: {
        preference: memories.value.filter(m => m.type === 'preference').length,
        achievement: memories.value.filter(m => m.type === 'achievement').length,
        learning: memories.value.filter(m => m.type === 'learning').length,
        context: memories.value.filter(m => m.type === 'context').length,
        note: memories.value.filter(m => m.type === 'note').length,
        conversation: memories.value.filter(m => m.type === 'conversation').length,
        general: memories.value.filter(m => m.type === 'general').length
    }
}));

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

// Filter arrays
const memoryTypes = ref([
    { title: 'All Types', value: 'all' },
    { title: 'General', value: 'general' },
    { title: 'Note', value: 'note' },
    { title: 'Conversation', value: 'conversation' },
    { title: 'Preference', value: 'preference' },
    { title: 'Achievement', value: 'achievement' },
    { title: 'Learning', value: 'learning' },
    { title: 'Context', value: 'context' }
]);

const importanceFilters = ref([
    { title: 'All', value: 'all' },
    { title: 'High', value: 'high' },
    { title: 'Medium', value: 'medium' },
    { title: 'Low', value: 'low' }
]);

// Filters
const searchQuery = ref('');
const selectedType = ref('all');
const selectedImportance = ref('all');
const selectedAgent = ref('all');

// Computed
const filteredMemories = computed(() => {
    return memories.value.filter(memory => {
        const matchesSearch = !searchQuery.value || 
            memory.content.toLowerCase().includes(searchQuery.value.toLowerCase()) ||
            memory.tags.some(tag => tag.toLowerCase().includes(searchQuery.value.toLowerCase()));
        
        const matchesType = selectedType.value === 'all' || memory.type === selectedType.value;
        const matchesImportance = selectedImportance.value === 'all' || memory.importance === selectedImportance.value;
        const matchesAgent = selectedAgent.value === 'all' || memory.source.toLowerCase().includes(selectedAgent.value.toLowerCase());
        
        return matchesSearch && matchesType && matchesImportance && matchesAgent;
    });
});

const uniqueAgents = computed(() => {
    const sources = new Set<string>();
    memories.value.forEach(memory => {
        if (memory.source) {
            sources.add(memory.source);
        }
    });
    return [{ title: 'All Sources', value: 'all' }, ...Array.from(sources).map(source => ({ title: source, value: source }))];
});

// Methods
const loadMemories = async (): Promise<void> => {
    if (!channelId.value) return;
    
    try {
        await memoryStore.fetchChannelMemory(channelId.value);
    } catch (error) {
        console.error('Error loading memories:', error);
    }
};

const deleteMemory = async (memoryId: string): Promise<void> => {
    if (!channelId.value) return;
    
    try {
        await memoryStore.deleteMemoryEntry(channelId.value, memoryId);
    } catch (error) {
        console.error('Error deleting memory:', error);
    }
};

const exportMemory = (): void => {
    const dataStr = JSON.stringify(memories.value, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    
    const link = document.createElement('a');
    link.href = url;
    link.download = `channel-${channelId.value}-memories.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
};

const clearFilters = (): void => {
    searchQuery.value = '';
    selectedType.value = 'all';
    selectedImportance.value = 'all';
    selectedAgent.value = 'all';
};

const getImportanceColor = (importance: string): string => {
    switch (importance) {
        case 'high': return 'error';
        case 'medium': return 'warning';
        case 'low': return 'success';
        default: return 'default';
    }
};

const formatDate = (date: Date): string => {
    return new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    }).format(date);
};

// Create memory dialog
const showCreateDialog = ref(false);
const newMemory = ref({
    content: '',
    type: 'general',
    importance: 'medium',
    tags: [] as string[],
    source: 'manual'
});
const newMemoryTag = ref('');

// Add memory methods
const addTag = (): void => {
    if (newMemoryTag.value.trim() && !newMemory.value.tags.includes(newMemoryTag.value.trim())) {
        newMemory.value.tags.push(newMemoryTag.value.trim());
        newMemoryTag.value = '';
    }
};

const removeTag = (tag: string): void => {
    const index = newMemory.value.tags.indexOf(tag);
    if (index > -1) {
        newMemory.value.tags.splice(index, 1);
    }
};

const createMemory = async (): Promise<void> => {
    if (!channelId.value || !newMemory.value.content.trim()) return;
    
    try {
        await memoryStore.addMemoryEntry(channelId.value, {
            content: newMemory.value.content,
            type: newMemory.value.type,
            importance: newMemory.value.importance,
            tags: newMemory.value.tags,
            source: newMemory.value.source
        });
        
        // Reset form
        newMemory.value = {
            content: '',
            type: 'general',
            importance: 'medium',
            tags: [],
            source: 'manual'
        };
        showCreateDialog.value = false;
    } catch (error) {
        console.error('Error creating memory:', error);
    }
};

// Load memories when component mounts or channel changes
onMounted(() => {
    loadMemories();
});

watch(channelId, (newChannelId) => {
    if (newChannelId) {
        memoryStore.clearMemory();
        loadMemories();
    }
});
</script>

<template>
    <div class="memory-view">
        <!-- Memory Statistics -->
        <v-row class="mb-6">
            <v-col cols="12">
                <v-card elevation="0" class="stats-card">
                    <v-card-title>
                        <v-icon class="mr-2">mdi-brain</v-icon>
                        Memory Statistics - {{ props.channel.name }}
                    </v-card-title>
                    <v-card-text>
                        <v-row>
                            <v-col cols="6" sm="3" md="2">
                                <div class="stat-item">
                                    <div class="stat-value text-primary">{{ memoryStats.total }}</div>
                                    <div class="stat-label">Total</div>
                                </div>
                            </v-col>
                            <v-col cols="6" sm="3" md="2">
                                <div class="stat-item">
                                    <div class="stat-value text-info">{{ memoryStats.byType.conversation }}</div>
                                    <div class="stat-label">Conversations</div>
                                </div>
                            </v-col>
                            <v-col cols="6" sm="3" md="2">
                                <div class="stat-item">
                                    <div class="stat-value text-success">{{ memoryStats.byType.note }}</div>
                                    <div class="stat-label">Notes</div>
                                </div>
                            </v-col>
                            <v-col cols="6" sm="3" md="2">
                                <div class="stat-item">
                                    <div class="stat-value text-warning">{{ memoryStats.byType.context }}</div>
                                    <div class="stat-label">Context</div>
                                </div>
                            </v-col>
                            <v-col cols="12" sm="12" md="4">
                                <div class="stat-item">
                                    <div class="stat-value text-secondary">{{ memoryStats.highImportance }}</div>
                                    <div class="stat-label">High Priority</div>
                                </div>
                            </v-col>
                        </v-row>
                    </v-card-text>
                </v-card>
            </v-col>
        </v-row>

        <!-- Filters Section -->
        <v-card elevation="0" class="filters-card mb-6">
            <v-card-text>
                <v-row align="center">
                    <v-col cols="12" sm="6" md="3">
                        <v-text-field
                            v-model="searchQuery"
                            variant="outlined"
                            density="comfortable"
                            prepend-inner-icon="mdi-magnify"
                            placeholder="Search memories..."
                            clearable
                        />
                    </v-col>
                    <v-col cols="6" sm="3" md="2">
                        <v-select
                            v-model="selectedType"
                            :items="memoryTypes"
                            variant="outlined"
                            density="comfortable"
                            label="Type"
                        />
                    </v-col>
                    <v-col cols="6" sm="3" md="2">
                        <v-select
                            v-model="selectedImportance"
                            :items="importanceFilters"
                            variant="outlined"
                            density="comfortable"
                            label="Importance"
                        />
                    </v-col>
                    <v-col cols="12" sm="6" md="3">
                        <v-select
                            v-model="selectedAgent"
                            :items="uniqueAgents"
                            variant="outlined"
                            density="comfortable"
                            label="Source"
                        />
                    </v-col>
                    <v-col cols="12" sm="6" md="2">
                        <v-btn
                            variant="outlined"
                            block
                            @click="clearFilters"
                        >
                            Clear Filters
                        </v-btn>
                    </v-col>
                </v-row>
            </v-card-text>
        </v-card>

        <!-- Memory List -->
        <div class="memory-list">
            <div v-if="loading" class="text-center pa-8">
                <v-progress-circular indeterminate color="primary" size="64" />
                <p class="text-body-1 mt-4">Loading memories...</p>
            </div>
            
            <div v-else-if="filteredMemories.length === 0" class="text-center pa-8">
                <v-icon size="64" color="grey">mdi-brain-outline</v-icon>
                <p class="text-h6 mt-4">No memories found</p>
                <p class="text-body-2 text-medium-emphasis">Try adjusting your filters or search query</p>
            </div>
            
            <v-card
                v-for="memory in filteredMemories"
                :key="memory.id"
                elevation="0"
                class="memory-card mb-4"
            >
                <v-card-text>
                    <div class="d-flex align-start justify-space-between mb-3">
                        <div class="memory-header flex-grow-1">
                            <div class="d-flex align-center mb-2">
                                <v-chip
                                    :color="memory.type === 'conversation' ? 'primary' : memory.type === 'knowledge' ? 'success' : 'info'"
                                    size="small"
                                    variant="tonal"
                                    class="mr-2"
                                >
                                    {{ memory.type }}
                                </v-chip>
                                <v-chip
                                    :color="getImportanceColor(memory.importance)"
                                    size="small"
                                    variant="tonal"
                                    class="mr-2"
                                >
                                    {{ memory.importance }}
                                </v-chip>
                                <span class="text-body-2 text-medium-emphasis">{{ memory.source }}</span>
                            </div>
                            <h3 class="text-h6 mb-2">{{ memory.type }} - {{ memory.importance }}</h3>
                            <p class="text-body-2 text-medium-emphasis mb-3">{{ memory.content }}</p>
                            
                            <div class="memory-metadata">
                                <div class="d-flex align-center flex-wrap gap-2 mb-2">
                                    <div class="d-flex align-center">
                                        <v-icon size="16" class="mr-1">mdi-clock-outline</v-icon>
                                        <span class="text-body-2">{{ formatDate(memory.updatedAt) }}</span>
                                    </div>
                                    <v-divider vertical />
                                    <div class="d-flex align-center">
                                        <v-icon size="16" class="mr-1">mdi-robot</v-icon>
                                        <span class="text-body-2">{{ memory.source }}</span>
                                    </div>
                                </div>
                                
                                <div class="d-flex align-center flex-wrap gap-1">
                                    <v-chip
                                        v-for="tag in memory.tags"
                                        :key="tag"
                                        size="x-small"
                                        variant="outlined"
                                    >
                                        {{ tag }}
                                    </v-chip>
                                </div>
                            </div>
                        </div>
                        
                        <div class="memory-actions ml-4">
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
                                    <v-list-item @click="exportMemory()">
                                        <template #prepend>
                                            <v-icon>mdi-download</v-icon>
                                        </template>
                                        <v-list-item-title>Export</v-list-item-title>
                                    </v-list-item>
                                    <v-list-item
                                        @click="deleteMemory(memory.id)"
                                        :loading="deleteLoading === memory.id"
                                    >
                                        <template #prepend>
                                            <v-icon color="error">mdi-delete</v-icon>
                                        </template>
                                        <v-list-item-title>Delete</v-list-item-title>
                                    </v-list-item>
                                </v-list>
                            </v-menu>
                        </div>
                    </div>
                </v-card-text>
            </v-card>
        </div>
    </div>
</template>

<style scoped>
.memory-view {
    max-width: 1200px;
    margin: 0 auto;
}

.stats-card,
.filters-card,
.memory-card {
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
    letter-spacing: 0.05em;
    opacity: 0.7;
    margin-top: 0.25rem;
}

.memory-header {
    min-width: 0; /* Allow text truncation */
}

.memory-metadata {
    border-top: 1px solid rgba(255, 255, 255, 0.1);
    padding-top: 0.75rem;
    margin-top: 0.75rem;
}

.gap-1 {
    gap: 0.25rem;
}

.gap-2 {
    gap: 0.5rem;
}

/* Responsive adjustments */
@media (max-width: 768px) {
    .memory-header,
    .memory-actions {
        margin-left: 0;
    }
    
    .stat-value {
        font-size: 1.25rem;
    }
}
</style>
