<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { useContextStore } from '@/stores/context';
import { useAgentsStore } from '@/stores/agents';
import HelpTooltip from '@/components/HelpTooltip.vue';

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

// Stores
const contextStore = useContextStore();
const agentsStore = useAgentsStore();

// Convert store data to match the existing UI expectations
const contextTypes = ref([
    { title: 'All Types', value: 'all' },
    { title: 'System', value: 'system' },
    { title: 'Task', value: 'active' },
    { title: 'Agent', value: 'inactive' },
    { title: 'User', value: 'archived' }
]);

const contextScopes = ref([
    { title: 'All Scopes', value: 'all' },
    { title: 'Global', value: 'global' },
    { title: 'Channel', value: 'channel' },
    { title: 'User', value: 'user' }
]);

// Edit dialog
const editDialog = ref(false);
const editingContext = ref<any>(null);
const editValue = ref('');
const snackbar = ref(false);
const snackbarMessage = ref('');
const snackbarColor = ref('success');

// Create dialog
const createDialog = ref(false);
const newContext = ref({
    name: '',
    description: '',
    type: 'system',
    scope: 'channel',
    value: '',
    agentId: '', // Optional agent to associate context with
    metadata: {}
});

// Available agents for the channel
const availableAgents = computed(() => {
    return agentsStore.agents.map(agent => ({
        title: agent.name || agent.agentId,
        value: agent.agentId
    }));
});

// Computed properties using store data
const contextEntries = computed(() => {
    // Transform store context entries to match existing UI format
    return contextStore.filteredContexts.map(context => ({
        id: context.id,
        type: getContextTypeFromStatus(context.status),
        title: context.name,
        key: `context.${context.id}`,
        value: {
            description: context.description,
            participants: context.participants.length,
            messageCount: context.messageCount,
            lastActivity: new Date(context.lastActivity).toISOString(),
            status: context.status
        },
        lastUpdated: new Date(context.updatedAt),
        updatedBy: context.createdBy,
        scope: context.participants.length > 1 ? 'channel' : 'user'
    }));
});

const contextStats = computed(() => ({
    total: contextStore.stats.totalContexts,
    system: contextStore.stats.activeContexts,
    task: contextStore.stats.inactiveContexts,
    agent: contextStore.stats.archivedContexts,
    user: contextStore.stats.totalParticipants
}));

const filteredContextEntries = computed(() => {
    let filtered = contextEntries.value.filter(entry => {
        const matchesSearch = !contextStore.filters.search || 
            entry.title.toLowerCase().includes(contextStore.filters.search.toLowerCase()) ||
            entry.key.toLowerCase().includes(contextStore.filters.search.toLowerCase());
        
        const matchesType = contextStore.filters.status === 'all' || 
            getContextTypeFromStatus(entry.type) === contextStore.filters.status;
        const matchesScope = contextStore.filters.scope === 'all' || entry.scope === contextStore.filters.scope;
        
        return matchesSearch && matchesType && matchesScope;
    });

    return filtered;
});

// Helper functions
const getContextTypeFromStatus = (status: string): string => {
    switch (status) {
        case 'active': return 'system';
        case 'inactive': return 'task';
        case 'archived': return 'agent';
        default: return 'user';
    }
};

// Reactive search and filters
const searchQuery = computed({
    get: () => contextStore.filters.search,
    set: (value: string) => contextStore.setFilters({ search: value })
});

const selectedType = computed({
    get: () => contextStore.filters.status,
    set: (value: string) => contextStore.setFilters({ status: value })
});

const selectedScope = computed({
    get: () => contextStore.filters.scope,
    set: (value: string) => contextStore.setFilters({ scope: value })
});

const sortBy = computed({
    get: () => contextStore.filters.sortBy,
    set: (value: string) => contextStore.setFilters({ sortBy: value as any })
});

const sortDesc = computed({
    get: () => contextStore.filters.sortOrder === 'desc',
    set: (value: boolean) => contextStore.setFilters({ sortOrder: value ? 'desc' : 'asc' })
});

// Loading states from store
const loading = computed(() => contextStore.isLoading);
const updateLoading = computed(() => contextStore.savingContext ? 'saving' : contextStore.deletingContext ? 'deleting' : '');

// Methods
const loadContext = async (): Promise<void> => {
    try {
        await contextStore.fetchContexts(props.channel.id);
        await contextStore.fetchContextStats();
    } catch (error) {
        console.error('Failed to load context:', error);
        showSnackbar('Failed to load context data', 'error');
    }
};

const showSnackbar = (message: string, color: string = 'success'): void => {
    snackbarMessage.value = message;
    snackbarColor.value = color;
    snackbar.value = true;
};

const openEditDialog = (context: any): void => {
    editingContext.value = { ...context };
    editValue.value = JSON.stringify(context.value, null, 2);
    editDialog.value = true;
};

const openCreateDialog = async (): Promise<void> => {
    // Reset form
    newContext.value = {
        name: '',
        description: '',
        type: 'system',
        scope: 'channel',
        value: '',
        agentId: '',
        metadata: {}
    };
    // Fetch available agents for this channel
    if (props.channel?.id) {
        await agentsStore.fetchAgents(props.channel.id);
    }
    createDialog.value = true;
};

const createContext = async (): Promise<void> => {
    try {
        // Validate required fields
        if (!newContext.value.name.trim()) {
            showSnackbar('Context name is required', 'error');
            return;
        }
        
        if (!newContext.value.value.trim()) {
            showSnackbar('Context value is required', 'error');
            return;
        }
        
        // Parse JSON value if it looks like JSON
        let parsedValue;
        try {
            parsedValue = JSON.parse(newContext.value.value);
        } catch {
            // If not valid JSON, use as string
            parsedValue = newContext.value.value;
        }
        
        // Prepare context data for API
        const contextData = {
            channelId: props.channel.id,
            name: newContext.value.name.trim(),
            description: newContext.value.description.trim(),
            type: newContext.value.type,
            scope: newContext.value.scope,
            agentId: newContext.value.agentId || undefined, // Include agent if selected
            metadata: {
                ...newContext.value.metadata,
                value: parsedValue,
                description: newContext.value.description.trim()
            },
            status: 'active' as const
        };
        
        await contextStore.saveContext(contextData);
        createDialog.value = false;
        showSnackbar('Context created successfully');
        
        // Refresh context list
        await loadContext();
    } catch (error) {
        console.error('Failed to create context:', error);
        showSnackbar('Failed to create context', 'error');
    }
};

const saveContext = async (): Promise<void> => {
    if (!editingContext.value) return;
    
    try {
        // Parse and validate JSON
        const newValue = JSON.parse(editValue.value);
        
        // Prepare context data for API
        const contextData = {
            id: editingContext.value.id,
            name: editingContext.value.title,
            description: newValue.description || editingContext.value.value.description,
            metadata: newValue,
            status: newValue.status || 'active'
        };
        
        await contextStore.saveContext(contextData);
        editDialog.value = false;
        showSnackbar('Context updated successfully');
    } catch (error) {
        console.error('Failed to update context:', error);
        showSnackbar('Failed to update context', 'error');
    }
};

const deleteContext = async (contextId: string): Promise<void> => {
    try {
        await contextStore.deleteContext(contextId);
        showSnackbar('Context archived successfully');
    } catch (error) {
        console.error('Failed to delete context:', error);
        showSnackbar('Failed to archive context', 'error');
    }
};

const cancelCreate = (): void => {
    createDialog.value = false;
    // Reset form
    newContext.value = {
        name: '',
        description: '',
        type: 'system',
        scope: 'channel',
        value: '',
        agentId: '',
        metadata: {}
    };
};

const refreshContext = async (): Promise<void> => {
    await contextStore.refreshContexts();
};

const exportContext = (context: any): void => {
    const dataStr = JSON.stringify(context, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `context-${context.key}.json`;
    link.click();
    URL.revokeObjectURL(url);
};

const exportAllContexts = async (): Promise<void> => {
    try {
        await contextStore.exportContexts();
        showSnackbar('Contexts exported successfully');
    } catch (error) {
        console.error('Failed to export contexts:', error);
        showSnackbar('Failed to export contexts', 'error');
    }
};

const getTypeColor = (type: string): string => {
    switch (type) {
        case 'system': return 'primary';
        case 'task': return 'success';
        case 'agent': return 'info';
        case 'user': return 'warning';
        default: return 'default';
    }
};

const getScopeIcon = (scope: string): string => {
    switch (scope) {
        case 'global': return 'mdi-earth';
        case 'channel': return 'mdi-pound';
        case 'user': return 'mdi-account';
        default: return 'mdi-help-circle';
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

const formatValue = (value: any): string => {
    if (typeof value === 'object') {
        return `${Object.keys(value).length} properties`;
    }
    return String(value);
};

// Watch for channel changes - use optional chaining since channel can be null
watch(() => props.channel?.id, (newChannelId) => {
    if (newChannelId) {
        loadContext();
    }
}, { immediate: true });

// Watch for store errors
watch(() => contextStore.error, (error) => {
    if (error) {
        showSnackbar(error, 'error');
        contextStore.clearError();
    }
});

onMounted(() => {
    loadContext();
});
</script>

<template>
    <div class="ch-ctx">
        <!-- Header strip -->
        <header class="ch-ctx__header">
            <div class="ch-ctx__header-left">
                <h1 class="ch-ctx__header-title">Context</h1>
                <span class="ch-ctx__header-divider">/</span>
                <span class="ch-ctx__header-sub">Manage channel context entries, scopes &amp; metadata</span>
            </div>
            <div class="ch-ctx__header-actions">
                <button class="ch-ctx__btn ch-ctx__btn--ghost" @click="exportAllContexts">
                    <v-icon size="14">mdi-download</v-icon>
                    <span>Export All</span>
                </button>
                <button
                    class="ch-ctx__btn ch-ctx__btn--ghost"
                    :class="{ 'ch-ctx__btn--loading': loading }"
                    :disabled="loading"
                    @click="refreshContext"
                >
                    <v-icon size="14">mdi-refresh</v-icon>
                    <span>Refresh</span>
                </button>
                <button class="ch-ctx__btn ch-ctx__btn--primary" @click="openCreateDialog">
                    <v-icon size="14">mdi-plus</v-icon>
                    <span>Create Context</span>
                </button>
            </div>
        </header>

        <!-- Metrics strip -->
        <section class="ch-ctx__metrics">
            <div class="ch-ctx__metric" data-accent="blue">
                <div class="ch-ctx__metric-head">
                    <span class="ch-ctx__metric-label">Total</span>
                    <v-icon size="13" class="ch-ctx__metric-ico">mdi-text-box-multiple-outline</v-icon>
                </div>
                <div class="ch-ctx__metric-number">{{ contextStats.total }}</div>
            </div>
            <div class="ch-ctx__metric" data-accent="green">
                <div class="ch-ctx__metric-head">
                    <span class="ch-ctx__metric-label">System</span>
                    <v-icon size="13" class="ch-ctx__metric-ico">mdi-cog-outline</v-icon>
                </div>
                <div class="ch-ctx__metric-number">{{ contextStats.system }}</div>
            </div>
            <div class="ch-ctx__metric" data-accent="cyan">
                <div class="ch-ctx__metric-head">
                    <span class="ch-ctx__metric-label">Task</span>
                    <v-icon size="13" class="ch-ctx__metric-ico">mdi-clipboard-list-outline</v-icon>
                </div>
                <div class="ch-ctx__metric-number">{{ contextStats.task }}</div>
            </div>
            <div class="ch-ctx__metric" data-accent="amber">
                <div class="ch-ctx__metric-head">
                    <span class="ch-ctx__metric-label">Agent</span>
                    <v-icon size="13" class="ch-ctx__metric-ico">mdi-robot-outline</v-icon>
                </div>
                <div class="ch-ctx__metric-number">{{ contextStats.agent }}</div>
            </div>
            <div class="ch-ctx__metric" data-accent="green">
                <div class="ch-ctx__metric-head">
                    <span class="ch-ctx__metric-label">User</span>
                    <v-icon size="13" class="ch-ctx__metric-ico">mdi-account-outline</v-icon>
                </div>
                <div class="ch-ctx__metric-number">{{ contextStats.user }}</div>
            </div>
        </section>

        <!-- Filters card -->
        <div class="ch-ctx__filters">
            <div class="ch-ctx__filters-head">
                <span class="ch-ctx__filters-title">Filters</span>
            </div>
            <div class="ch-ctx__filters-body">
                <v-text-field
                    v-model="searchQuery"
                    label="Search context..."
                    variant="outlined"
                    density="compact"
                    prepend-inner-icon="mdi-magnify"
                    clearable
                    hide-details
                />
                <v-select
                    v-model="selectedType"
                    :items="contextTypes"
                    label="Type"
                    variant="outlined"
                    density="compact"
                    hide-details
                />
                <v-select
                    v-model="selectedScope"
                    :items="contextScopes"
                    label="Scope"
                    variant="outlined"
                    density="compact"
                    hide-details
                />
            </div>
        </div>

        <!-- Context list -->
        <div class="ch-ctx__list">
            <!-- Loading state -->
            <div v-if="loading" class="ch-ctx__empty">
                <v-progress-circular indeterminate color="primary" size="40" width="3" />
                <p class="ch-ctx__empty-title">Loading context data...</p>
            </div>

            <!-- Empty state -->
            <div v-else-if="filteredContextEntries.length === 0" class="ch-ctx__empty">
                <div class="ch-ctx__empty-icon">
                    <v-icon size="32" style="opacity: 0.3">mdi-text-box-multiple-outline</v-icon>
                </div>
                <p class="ch-ctx__empty-title">No context entries found</p>
                <p class="ch-ctx__empty-sub">Try adjusting your filters or search query</p>
            </div>

            <!-- Context cards -->
            <div
                v-for="context in filteredContextEntries"
                :key="context.id"
                class="ch-ctx__card"
            >
                <div class="ch-ctx__card-body">
                    <div class="ch-ctx__card-top">
                        <v-chip
                            :color="getTypeColor(context.type)"
                            size="small"
                            variant="tonal"
                        >
                            {{ context.type }}
                        </v-chip>
                        <v-icon size="16">{{ getScopeIcon(context.scope) }}</v-icon>
                        <span class="ch-ctx__card-scope">{{ context.scope }}</span>
                    </div>

                    <h3 class="ch-ctx__card-title">{{ context.title }}</h3>
                    <p class="ch-ctx__card-key">{{ context.key }}</p>

                    <div class="ch-ctx__preview">{{ formatValue(context.value) }}</div>

                    <div class="ch-ctx__card-meta">
                        <div class="ch-ctx__card-meta-row">
                            <v-icon size="14">mdi-clock-outline</v-icon>
                            <span>{{ formatDate(context.lastUpdated) }}</span>
                            <v-icon size="14">mdi-account</v-icon>
                            <span>{{ context.updatedBy }}</span>
                        </div>
                    </div>
                </div>

                <div class="ch-ctx__card-actions">
                    <v-menu>
                        <template #activator="{ props: menuProps }">
                            <button class="ch-ctx__btn ch-ctx__btn--ghost ch-ctx__btn--icon" v-bind="menuProps">
                                <v-icon size="16">mdi-dots-vertical</v-icon>
                            </button>
                        </template>
                        <v-list>
                            <v-list-item @click="openEditDialog(context)">
                                <template #prepend>
                                    <v-icon>mdi-pencil</v-icon>
                                </template>
                                <v-list-item-title>Edit</v-list-item-title>
                            </v-list-item>
                            <v-list-item @click="exportContext(context)">
                                <template #prepend>
                                    <v-icon>mdi-download</v-icon>
                                </template>
                                <v-list-item-title>Export</v-list-item-title>
                            </v-list-item>
                            <v-list-item
                                @click="deleteContext(context.id)"
                                :loading="updateLoading === context.id"
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
        </div>

        <!-- Edit Context Dialog -->
        <v-dialog v-model="editDialog" max-width="800">
            <v-card>
                <v-card-title>
                    <span class="text-h5">Edit Context</span>
                </v-card-title>
                <v-card-text>
                    <div v-if="editingContext" class="mb-4">
                        <v-row>
                            <v-col cols="12" md="6">
                                <v-text-field
                                    v-model="editingContext.title"
                                    label="Title"
                                    variant="outlined"
                                />
                            </v-col>
                            <v-col cols="12" md="6">
                                <v-text-field
                                    v-model="editingContext.key"
                                    label="Key"
                                    variant="outlined"
                                />
                            </v-col>
                        </v-row>
                    </div>
                    <v-textarea
                        v-model="editValue"
                        label="Value (JSON)"
                        variant="outlined"
                        rows="12"
                        class="ch-ctx__mono-textarea"
                    />
                </v-card-text>
                <v-card-actions>
                    <v-spacer />
                    <v-btn @click="editDialog = false">Cancel</v-btn>
                    <v-btn
                        color="primary"
                        :loading="!!updateLoading"
                        @click="saveContext"
                    >
                        Save
                    </v-btn>
                </v-card-actions>
            </v-card>
        </v-dialog>

        <!-- Create Context Dialog -->
        <v-dialog v-model="createDialog" max-width="600px">
            <v-card>
                <v-card-title>
                    <span class="text-h5">Create New Context</span>
                </v-card-title>
                <v-card-text>
                    <v-container>
                        <v-row>
                            <v-col cols="12">
                                <v-text-field
                                    v-model="newContext.name"
                                    label="Context Name*"
                                    variant="outlined"
                                    required
                                />
                            </v-col>
                            <v-col cols="12">
                                <v-textarea
                                    v-model="newContext.description"
                                    label="Description"
                                    variant="outlined"
                                    rows="3"
                                />
                            </v-col>
                            <v-col cols="6">
                                <v-select
                                    v-model="newContext.type"
                                    :items="[
                                        { title: 'System', value: 'system' },
                                        { title: 'Task', value: 'task' },
                                        { title: 'Agent', value: 'agent' },
                                        { title: 'User', value: 'user' }
                                    ]"
                                    label="Type"
                                    variant="outlined"
                                />
                            </v-col>
                            <v-col cols="6">
                                <v-select
                                    v-model="newContext.scope"
                                    :items="[
                                        { title: 'Global', value: 'global' },
                                        { title: 'Channel', value: 'channel' },
                                        { title: 'User', value: 'user' }
                                    ]"
                                    label="Scope"
                                    variant="outlined"
                                >
                                    <template #append>
                                        <HelpTooltip
                                            text="Global scope applies to all channels, Channel scope applies only to this channel, User scope is specific to individual users."
                                            docLink="http://mxf.dev/mxf/context.html"
                                        />
                                    </template>
                                </v-select>
                            </v-col>
                            <v-col cols="12">
                                <v-select
                                    v-model="newContext.agentId"
                                    :items="availableAgents"
                                    label="Agent (optional)"
                                    variant="outlined"
                                    clearable
                                    hint="Leave empty for channel-wide context"
                                    persistent-hint
                                    :loading="agentsStore.isLoading"
                                />
                            </v-col>
                            <v-col cols="12">
                                <v-textarea
                                    v-model="newContext.value"
                                    label="Context Value*"
                                    variant="outlined"
                                    rows="6"
                                    hint="JSON object or plain text"
                                    persistent-hint
                                    class="ch-ctx__mono-textarea"
                                    required
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
                        :loading="!!updateLoading"
                        @click="createContext"
                    >
                        Create
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
   MXF Channel Context — Polished UI
   Matches Channels command-center aesthetic
   ════════════════════════════════════════════ */

.ch-ctx {
    --ch-blue: #4A90C2;
    --ch-green: #10B981;
    --ch-amber: #F59E0B;
    --ch-cyan: #22D3EE;
    --ch-red: #EF4444;
    position: relative;
}

/* ── Header Strip ─────────────────────── */
.ch-ctx__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 0 var(--space-4);
    border-bottom: 1px solid var(--border-subtle);
    margin-bottom: var(--space-4);
}

.ch-ctx__header-left {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    flex-wrap: wrap;
}

.ch-ctx__header-title {
    font-size: var(--text-lg);
    font-weight: 600;
    color: var(--text-primary);
    letter-spacing: -0.01em;
    margin: 0;
}

.ch-ctx__header-divider {
    color: var(--text-muted);
    opacity: 0.4;
    font-weight: 300;
}

.ch-ctx__header-sub {
    font-size: var(--text-sm);
    color: var(--text-muted);
}

.ch-ctx__header-actions {
    display: flex;
    align-items: center;
    gap: var(--space-2);
}

/* ── Buttons ──────────────────────────── */
.ch-ctx__btn {
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

.ch-ctx__btn--ghost {
    background: transparent;
    border-color: var(--border-default);
    color: var(--text-secondary);
}

.ch-ctx__btn--ghost:hover {
    color: var(--text-primary);
    border-color: var(--ch-blue);
    background: rgba(74, 144, 194, 0.08);
}

.ch-ctx__btn--primary {
    background: var(--ch-blue);
    color: #fff;
    border-color: var(--ch-blue);
}

.ch-ctx__btn--primary:hover {
    background: #3a7db0;
    box-shadow: 0 2px 8px rgba(74, 144, 194, 0.3);
}

.ch-ctx__btn--icon {
    padding: var(--space-1);
    border-color: transparent;
}

.ch-ctx__btn--loading .v-icon {
    animation: ch-ctx-spin 1s linear infinite;
}

@keyframes ch-ctx-spin {
    to { transform: rotate(360deg); }
}

/* ── Metrics Grid ─────────────────────── */
.ch-ctx__metrics {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: var(--space-3);
    margin-bottom: var(--space-4);
}

.ch-ctx__metric {
    position: relative;
    padding: var(--space-3) var(--space-4);
    background: var(--bg-base);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-lg);
    transition: all var(--transition-base);
    overflow: hidden;
}

/* Left accent stripe */
.ch-ctx__metric::before {
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

.ch-ctx__metric[data-accent="blue"]::before  { background: var(--ch-blue); }
.ch-ctx__metric[data-accent="green"]::before { background: var(--ch-green); }
.ch-ctx__metric[data-accent="amber"]::before { background: var(--ch-amber); }
.ch-ctx__metric[data-accent="cyan"]::before  { background: var(--ch-cyan); }

.ch-ctx__metric:hover {
    border-color: var(--border-default);
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
}

.ch-ctx__metric:hover::before {
    opacity: 1;
}

.ch-ctx__metric-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: var(--space-1);
}

.ch-ctx__metric-label {
    font-size: var(--text-xs);
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
}

.ch-ctx__metric-ico {
    color: var(--text-muted);
    opacity: 0.5;
}

.ch-ctx__metric-number {
    font-family: var(--font-mono);
    font-size: 1.5rem;
    font-weight: 700;
    color: var(--text-primary);
    line-height: 1;
    letter-spacing: -0.02em;
}

/* ── Filters Card ─────────────────────── */
.ch-ctx__filters {
    background: var(--bg-base);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-lg);
    margin-bottom: var(--space-4);
    overflow: hidden;
}

.ch-ctx__filters-head {
    display: flex;
    align-items: center;
    padding: var(--space-3) var(--space-4);
    border-bottom: 1px solid var(--border-subtle);
}

.ch-ctx__filters-title {
    font-size: var(--text-xs);
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
}

.ch-ctx__filters-body {
    display: grid;
    grid-template-columns: 2fr 1fr 1fr;
    gap: var(--space-3);
    padding: var(--space-4);
}

/* ── Context Cards ────────────────────── */
.ch-ctx__card {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    background: var(--bg-base);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-lg);
    padding: var(--space-4);
    margin-bottom: var(--space-3);
    transition: all var(--transition-base);
}

.ch-ctx__card:hover {
    border-color: var(--border-default);
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
}

.ch-ctx__card-body {
    flex: 1;
    min-width: 0;
}

.ch-ctx__card-top {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin-bottom: var(--space-2);
}

.ch-ctx__card-scope {
    font-size: var(--text-sm);
    color: var(--text-muted);
}

.ch-ctx__card-title {
    font-size: var(--text-base);
    font-weight: 600;
    color: var(--text-primary);
    margin: 0 0 var(--space-1);
}

.ch-ctx__card-key {
    font-size: var(--text-sm);
    color: var(--text-muted);
    margin: 0 0 var(--space-3);
}

.ch-ctx__card-actions {
    flex-shrink: 0;
    margin-left: var(--space-3);
}

/* ── Code Preview ─────────────────────── */
.ch-ctx__preview {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    background: var(--bg-hover);
    border-radius: var(--radius-sm);
    padding: var(--space-2);
    margin-bottom: var(--space-3);
    white-space: pre-wrap;
    word-break: break-word;
    color: var(--text-secondary);
}

/* ── Card Meta ────────────────────────── */
.ch-ctx__card-meta {
    border-top: 1px solid var(--border-subtle);
    padding-top: var(--space-3);
}

.ch-ctx__card-meta-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-sm);
    color: var(--text-muted);
}

/* ── Empty State ──────────────────────── */
.ch-ctx__empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: var(--space-10) var(--space-4);
    text-align: center;
    background: var(--bg-base);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-lg);
    min-height: 300px;
}

.ch-ctx__empty-icon {
    margin-bottom: var(--space-3);
}

.ch-ctx__empty-title {
    font-size: var(--text-sm);
    font-weight: 500;
    color: var(--text-secondary);
    margin: 0 0 var(--space-1);
}

.ch-ctx__empty-sub {
    font-size: var(--text-xs);
    color: var(--text-muted);
    margin: 0;
    max-width: 260px;
    line-height: 1.5;
}

/* ── Mono textarea (applied via :deep) ── */
.ch-ctx__mono-textarea :deep(textarea) {
    font-family: var(--font-mono);
}

/* ── Responsive ───────────────────────── */
@media (max-width: 768px) {
    .ch-ctx__header {
        flex-direction: column;
        align-items: flex-start;
        gap: var(--space-2);
    }

    .ch-ctx__header-actions {
        align-self: flex-end;
    }

    .ch-ctx__metrics {
        grid-template-columns: repeat(2, 1fr);
    }

    .ch-ctx__filters-body {
        grid-template-columns: 1fr;
    }

    .ch-ctx__card {
        flex-direction: column;
    }

    .ch-ctx__card-actions {
        margin-left: 0;
        margin-top: var(--space-2);
        align-self: flex-end;
    }
}

@media (max-width: 480px) {
    .ch-ctx__metrics {
        grid-template-columns: 1fr;
    }

    .ch-ctx__header-actions {
        flex-wrap: wrap;
    }
}
</style>
