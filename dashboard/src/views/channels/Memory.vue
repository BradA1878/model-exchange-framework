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
    <div class="ch-mem">
        <!-- ░░ Header Strip ░░ -->
        <header class="ch-mem__header">
            <div class="ch-mem__header-left">
                <h2 class="ch-mem__header-title">Memory</h2>
                <span class="ch-mem__header-divider">/</span>
                <span class="ch-mem__header-sub">{{ props.channel.name }}</span>
            </div>
            <div class="ch-mem__header-actions">
                <button class="ch-mem__btn ch-mem__btn--ghost" @click="exportMemory">
                    <v-icon size="14">mdi-download</v-icon>
                    <span>Export</span>
                </button>
                <button class="ch-mem__btn ch-mem__btn--primary" @click="showCreateDialog = true">
                    <v-icon size="14">mdi-plus</v-icon>
                    <span>Add Memory</span>
                </button>
            </div>
        </header>

        <!-- ░░ Summary Metrics Strip ░░ -->
        <section class="ch-mem__metrics">
            <div class="ch-mem__metric" data-accent="blue">
                <div class="ch-mem__metric-head">
                    <span class="ch-mem__metric-label">Total</span>
                    <v-icon size="13" class="ch-mem__metric-ico">mdi-brain</v-icon>
                </div>
                <div class="ch-mem__metric-number">{{ memoryStats.total }}</div>
            </div>
            <div class="ch-mem__metric" data-accent="cyan">
                <div class="ch-mem__metric-head">
                    <span class="ch-mem__metric-label">Conversations</span>
                    <v-icon size="13" class="ch-mem__metric-ico">mdi-message-text-outline</v-icon>
                </div>
                <div class="ch-mem__metric-number">{{ memoryStats.byType.conversation }}</div>
            </div>
            <div class="ch-mem__metric" data-accent="green">
                <div class="ch-mem__metric-head">
                    <span class="ch-mem__metric-label">Notes</span>
                    <v-icon size="13" class="ch-mem__metric-ico">mdi-note-outline</v-icon>
                </div>
                <div class="ch-mem__metric-number">{{ memoryStats.byType.note }}</div>
            </div>
            <div class="ch-mem__metric" data-accent="amber">
                <div class="ch-mem__metric-head">
                    <span class="ch-mem__metric-label">Context</span>
                    <v-icon size="13" class="ch-mem__metric-ico">mdi-information-outline</v-icon>
                </div>
                <div class="ch-mem__metric-number">{{ memoryStats.byType.context }}</div>
            </div>
            <div class="ch-mem__metric" data-accent="red">
                <div class="ch-mem__metric-head">
                    <span class="ch-mem__metric-label">High Priority</span>
                    <v-icon size="13" class="ch-mem__metric-ico">mdi-alert-circle-outline</v-icon>
                </div>
                <div class="ch-mem__metric-number">{{ memoryStats.highImportance }}</div>
            </div>
        </section>

        <!-- ░░ Filters Card ░░ -->
        <div class="ch-mem__filters">
            <div class="ch-mem__filters-head">
                <div class="ch-mem__filters-title">
                    <v-icon size="16">mdi-filter-variant</v-icon>
                    <span>Filters</span>
                </div>
                <button class="ch-mem__btn ch-mem__btn--ghost" @click="clearFilters">
                    Clear
                </button>
            </div>
            <div class="ch-mem__filters-body">
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
                    <v-col cols="6" sm="3" md="3">
                        <v-select
                            v-model="selectedType"
                            :items="memoryTypes"
                            variant="outlined"
                            density="comfortable"
                            label="Type"
                        />
                    </v-col>
                    <v-col cols="6" sm="3" md="3">
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
                </v-row>
            </div>
        </div>

        <!-- ░░ Memory List ░░ -->
        <div class="ch-mem__list">
            <!-- Loading state -->
            <div v-if="loading" class="ch-mem__empty">
                <v-progress-circular indeterminate color="primary" size="48" />
                <p class="ch-mem__empty-title">Loading memories...</p>
            </div>

            <!-- Empty state -->
            <div v-else-if="filteredMemories.length === 0" class="ch-mem__empty">
                <v-icon size="48" class="ch-mem__empty-icon">mdi-brain-outline</v-icon>
                <p class="ch-mem__empty-title">No memories found</p>
                <p class="ch-mem__empty-sub">Try adjusting your filters or search query</p>
            </div>

            <!-- Memory cards -->
            <div
                v-for="memory in filteredMemories"
                :key="memory.id"
                class="ch-mem__card"
                :data-importance="memory.importance"
            >
                <div class="ch-mem__card-body">
                    <div class="ch-mem__card-top">
                        <div class="ch-mem__card-head">
                            <div class="ch-mem__card-chips">
                                <v-chip
                                    :color="memory.type === 'conversation' ? 'primary' : memory.type === 'knowledge' ? 'success' : 'info'"
                                    size="small"
                                    variant="tonal"
                                >
                                    {{ memory.type }}
                                </v-chip>
                                <v-chip
                                    :color="getImportanceColor(memory.importance)"
                                    size="small"
                                    variant="tonal"
                                >
                                    {{ memory.importance }}
                                </v-chip>
                                <span class="ch-mem__card-source">{{ memory.source }}</span>
                            </div>
                            <h3 class="ch-mem__card-title">{{ memory.type }} - {{ memory.importance }}</h3>
                            <p class="ch-mem__card-content">{{ memory.content }}</p>
                        </div>

                        <div class="ch-mem__card-actions">
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

                    <div class="ch-mem__card-meta">
                        <div class="ch-mem__card-meta-row">
                            <div class="ch-mem__card-meta-item">
                                <v-icon size="14">mdi-clock-outline</v-icon>
                                <span>{{ formatDate(memory.updatedAt) }}</span>
                            </div>
                            <div class="ch-mem__card-meta-item">
                                <v-icon size="14">mdi-robot</v-icon>
                                <span>{{ memory.source }}</span>
                            </div>
                        </div>

                        <div v-if="memory.tags.length" class="ch-mem__card-tags">
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
            </div>
        </div>

        <!-- Create Memory Dialog -->
        <v-dialog v-model="showCreateDialog" max-width="500">
            <v-card>
                <v-card-title>
                    <span class="text-h5">Add Memory Entry</span>
                </v-card-title>
                <v-card-text>
                    <v-container>
                        <v-row>
                            <v-col cols="12">
                                <v-textarea
                                    v-model="newMemory.content"
                                    label="Content*"
                                    variant="outlined"
                                    rows="3"
                                    required
                                />
                            </v-col>
                            <v-col cols="6">
                                <v-select
                                    v-model="newMemory.type"
                                    :items="memoryTypes.filter(t => t.value !== 'all')"
                                    variant="outlined"
                                    density="comfortable"
                                    label="Type"
                                />
                            </v-col>
                            <v-col cols="6">
                                <v-select
                                    v-model="newMemory.importance"
                                    :items="importanceFilters.filter(i => i.value !== 'all')"
                                    variant="outlined"
                                    density="comfortable"
                                    label="Importance"
                                />
                            </v-col>
                            <v-col cols="12">
                                <v-text-field
                                    v-model="newMemoryTag"
                                    label="Tags"
                                    variant="outlined"
                                    density="comfortable"
                                    hint="Press Enter to add a tag"
                                    persistent-hint
                                    @keyup.enter="addTag"
                                >
                                    <template #append-inner>
                                        <v-btn
                                            icon="mdi-plus"
                                            size="small"
                                            variant="text"
                                            :disabled="!newMemoryTag.trim()"
                                            @click="addTag"
                                        />
                                    </template>
                                </v-text-field>
                                <div v-if="newMemory.tags.length" class="d-flex flex-wrap gap-1 mt-2">
                                    <v-chip
                                        v-for="tag in newMemory.tags"
                                        :key="tag"
                                        closable
                                        size="small"
                                        @click:close="removeTag(tag)"
                                    >
                                        {{ tag }}
                                    </v-chip>
                                </div>
                            </v-col>
                        </v-row>
                    </v-container>
                </v-card-text>
                <v-card-actions>
                    <v-spacer />
                    <v-btn
                        color="grey"
                        variant="text"
                        @click="showCreateDialog = false"
                    >
                        Cancel
                    </v-btn>
                    <v-btn
                        color="primary"
                        variant="flat"
                        :disabled="!newMemory.content.trim()"
                        :loading="isLoading"
                        @click="createMemory"
                    >
                        Add Memory
                    </v-btn>
                </v-card-actions>
            </v-card>
        </v-dialog>
    </div>
</template>

<style scoped>
/* ════════════════════════════════════════════
   MXF Channel Memory — Design System
   BEM prefix: ch-mem__
   ════════════════════════════════════════════ */

.ch-mem {
    --ch-blue: #4A90C2;
    --ch-green: #10B981;
    --ch-amber: #F59E0B;
    --ch-cyan: #22D3EE;
    --ch-red: #EF4444;
    max-width: 1200px;
    margin: 0 auto;
}

/* ── Header Strip ─────────────────────── */
.ch-mem__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 0 var(--space-4);
    border-bottom: 1px solid var(--border-subtle);
    margin-bottom: var(--space-4);
}

.ch-mem__header-left {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    flex-wrap: wrap;
}

.ch-mem__header-title {
    font-size: var(--text-lg);
    font-weight: 600;
    color: var(--text-primary);
    letter-spacing: -0.01em;
    margin: 0;
}

.ch-mem__header-divider {
    color: var(--text-muted);
    opacity: 0.4;
    font-weight: 300;
}

.ch-mem__header-sub {
    font-size: var(--text-sm);
    color: var(--text-muted);
}

.ch-mem__header-actions {
    display: flex;
    align-items: center;
    gap: var(--space-2);
}

/* ── Buttons ──────────────────────────── */
.ch-mem__btn {
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

.ch-mem__btn--ghost {
    background: transparent;
    border-color: var(--border-default);
    color: var(--text-secondary);
}

.ch-mem__btn--ghost:hover {
    color: var(--text-primary);
    border-color: var(--ch-blue);
    background: rgba(74, 144, 194, 0.08);
}

.ch-mem__btn--primary {
    background: var(--ch-blue);
    color: #fff;
    border-color: var(--ch-blue);
}

.ch-mem__btn--primary:hover {
    background: #3a7db0;
    box-shadow: 0 2px 8px rgba(74, 144, 194, 0.3);
}

/* ── Metrics Grid ─────────────────────── */
.ch-mem__metrics {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: var(--space-3);
    margin-bottom: var(--space-4);
}

.ch-mem__metric {
    position: relative;
    padding: var(--space-3) var(--space-4);
    background: var(--bg-base);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-lg);
    transition: all var(--transition-base);
    overflow: hidden;
}

.ch-mem__metric::before {
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

.ch-mem__metric[data-accent="blue"]::before  { background: var(--ch-blue); }
.ch-mem__metric[data-accent="green"]::before { background: var(--ch-green); }
.ch-mem__metric[data-accent="amber"]::before { background: var(--ch-amber); }
.ch-mem__metric[data-accent="cyan"]::before  { background: var(--ch-cyan); }
.ch-mem__metric[data-accent="red"]::before   { background: var(--ch-red); }

.ch-mem__metric:hover {
    border-color: var(--border-default);
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
}

.ch-mem__metric:hover::before {
    opacity: 1;
}

.ch-mem__metric-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: var(--space-1);
}

.ch-mem__metric-label {
    font-size: var(--text-xs);
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
}

.ch-mem__metric-ico {
    color: var(--text-muted);
    opacity: 0.5;
}

.ch-mem__metric-number {
    font-family: var(--font-mono);
    font-size: 1.5rem;
    font-weight: 700;
    color: var(--text-primary);
    line-height: 1;
    letter-spacing: -0.02em;
}

/* ── Filters Card ─────────────────────── */
.ch-mem__filters {
    background: var(--bg-base);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-lg);
    overflow: hidden;
    margin-bottom: var(--space-4);
    transition: border-color var(--transition-base);
}

.ch-mem__filters:hover {
    border-color: var(--border-default);
}

.ch-mem__filters-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-4) var(--space-5);
    border-bottom: 1px solid var(--border-subtle);
}

.ch-mem__filters-title {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--text-primary);
}

.ch-mem__filters-body {
    padding: var(--space-5);
}

/* ── Memory List ──────────────────────── */
.ch-mem__list {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
}

/* ── Memory Card ──────────────────────── */
.ch-mem__card {
    position: relative;
    background: var(--bg-base);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-lg);
    overflow: hidden;
    transition: all var(--transition-base);
}

/* Left accent stripe by importance */
.ch-mem__card::before {
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

.ch-mem__card[data-importance="high"]::before   { background: var(--ch-red); }
.ch-mem__card[data-importance="medium"]::before  { background: var(--ch-amber); }
.ch-mem__card[data-importance="low"]::before     { background: var(--ch-green); }

.ch-mem__card:hover {
    border-color: var(--border-default);
    transform: translateY(-2px);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
}

.ch-mem__card:hover::before {
    opacity: 1;
}

.ch-mem__card-body {
    padding: var(--space-5);
}

.ch-mem__card-top {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-4);
}

.ch-mem__card-head {
    flex: 1;
    min-width: 0;
}

.ch-mem__card-chips {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin-bottom: var(--space-2);
}

.ch-mem__card-source {
    font-size: var(--text-sm);
    color: var(--text-muted);
}

.ch-mem__card-title {
    font-size: var(--text-base);
    font-weight: 600;
    color: var(--text-primary);
    margin: 0 0 var(--space-2);
}

.ch-mem__card-content {
    font-size: var(--text-sm);
    color: var(--text-secondary);
    line-height: 1.6;
    margin: 0;
}

.ch-mem__card-actions {
    flex-shrink: 0;
}

/* ── Card Metadata ────────────────────── */
.ch-mem__card-meta {
    border-top: 1px solid var(--border-subtle);
    padding-top: var(--space-3);
    margin-top: var(--space-4);
}

.ch-mem__card-meta-row {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--space-4);
    margin-bottom: var(--space-2);
}

.ch-mem__card-meta-item {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    font-size: var(--text-xs);
    color: var(--text-muted);
}

.ch-mem__card-tags {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--space-1);
}

/* ── Empty State ──────────────────────── */
.ch-mem__empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: var(--space-12) var(--space-4);
    text-align: center;
}

.ch-mem__empty-icon {
    color: var(--text-muted);
    opacity: 0.4;
}

.ch-mem__empty-title {
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--text-secondary);
    margin: var(--space-3) 0 var(--space-1);
}

.ch-mem__empty-sub {
    font-size: var(--text-xs);
    color: var(--text-muted);
    margin: 0;
    max-width: 300px;
    line-height: 1.5;
}

/* ── Responsive ───────────────────────── */
@media (max-width: 768px) {
    .ch-mem__header {
        flex-direction: column;
        align-items: flex-start;
        gap: var(--space-2);
    }

    .ch-mem__header-actions {
        align-self: flex-end;
    }

    .ch-mem__metrics {
        grid-template-columns: repeat(2, 1fr);
    }

    .ch-mem__card-top {
        flex-direction: column;
    }

    .ch-mem__card-actions {
        align-self: flex-end;
    }
}

@media (max-width: 480px) {
    .ch-mem__metrics {
        grid-template-columns: 1fr;
    }

    .ch-mem__metric-number {
        font-size: var(--text-xl);
    }
}
</style>
