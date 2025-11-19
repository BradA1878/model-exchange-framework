<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { useContextStore } from '@/stores/context';

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

// Store
const contextStore = useContextStore();

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
    metadata: {}
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

const openCreateDialog = (): void => {
    // Reset form
    newContext.value = {
        name: '',
        description: '',
        type: 'system',
        scope: 'channel',
        value: '',
        metadata: {}
    };
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
            name: newContext.value.name.trim(),
            description: newContext.value.description.trim(),
            type: newContext.value.type,
            scope: newContext.value.scope,
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

// Watch for channel changes
watch(() => props.channel.id, (newChannelId) => {
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
    <div class="context-view">
        <!-- Header with statistics -->
        <v-row class="mb-4">
            <v-col cols="12">
                <v-card class="stats-card">
                    <v-card-text>
                        <v-row>
                            <v-col cols="6" sm="3" md="2">
                                <div class="stat-item">
                                    <div class="stat-value">{{ contextStats.total }}</div>
                                    <div class="stat-label">Total</div>
                                </div>
                            </v-col>
                            <v-col cols="6" sm="3" md="2">
                                <div class="stat-item">
                                    <div class="stat-value">{{ contextStats.system }}</div>
                                    <div class="stat-label">System</div>
                                </div>
                            </v-col>
                            <v-col cols="6" sm="3" md="2">
                                <div class="stat-item">
                                    <div class="stat-value">{{ contextStats.task }}</div>
                                    <div class="stat-label">Task</div>
                                </div>
                            </v-col>
                            <v-col cols="6" sm="3" md="2">
                                <div class="stat-item">
                                    <div class="stat-value">{{ contextStats.agent }}</div>
                                    <div class="stat-label">Agent</div>
                                </div>
                            </v-col>
                            <v-col cols="12" sm="12" md="4">
                                <div class="stat-item">
                                    <div class="stat-value">{{ contextStats.user }}</div>
                                    <div class="stat-label">User</div>
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
                                @click="openCreateDialog"
                                prepend-icon="mdi-plus"
                            >
                                Create Context
                            </v-btn>
                            <v-spacer />
                            <v-btn
                                color="secondary"
                                variant="outlined"
                                @click="exportAllContexts"
                                prepend-icon="mdi-download"
                                class="mr-2"
                            >
                                Export All
                            </v-btn>
                            <v-btn
                                variant="outlined"
                                @click="refreshContext"
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
                                    label="Search context..."
                                    variant="outlined"
                                    density="compact"
                                    prepend-inner-icon="mdi-magnify"
                                    clearable
                                />
                            </v-col>
                            <v-col cols="6" md="2">
                                <v-select
                                    v-model="selectedType"
                                    :items="contextTypes"
                                    label="Type"
                                    variant="outlined"
                                    density="compact"
                                />
                            </v-col>
                            <v-col cols="6" md="2">
                                <v-select
                                    v-model="selectedScope"
                                    :items="contextScopes"
                                    label="Scope"
                                    variant="outlined"
                                    density="compact"
                                />
                            </v-col>
                        </v-row>
                    </v-card-text>
                </v-card>
            </v-col>
        </v-row>

        <!-- Context List -->
        <div class="context-list">
            <div v-if="loading" class="text-center pa-8">
                <v-progress-circular indeterminate color="primary" size="64" />
                <p class="text-body-1 mt-4">Loading context data...</p>
            </div>
            
            <div v-else-if="filteredContextEntries.length === 0" class="text-center pa-8">
                <v-icon size="64" color="grey">mdi-text-box-multiple-outline</v-icon>
                <p class="text-h6 mt-4">No context entries found</p>
                <p class="text-body-2 text-medium-emphasis">Try adjusting your filters or search query</p>
            </div>
            
            <v-card
                v-for="context in filteredContextEntries"
                :key="context.id"
                elevation="0"
                class="context-card mb-4"
            >
                <v-card-text>
                    <div class="d-flex align-start justify-space-between">
                        <div class="context-header flex-grow-1">
                            <div class="d-flex align-center mb-2">
                                <v-chip
                                    :color="getTypeColor(context.type)"
                                    size="small"
                                    variant="tonal"
                                    class="mr-2"
                                >
                                    {{ context.type }}
                                </v-chip>
                                <v-icon size="16" class="mr-1">{{ getScopeIcon(context.scope) }}</v-icon>
                                <span class="text-body-2 text-medium-emphasis">{{ context.scope }}</span>
                            </div>
                            
                            <h3 class="text-h6 mb-1">{{ context.title }}</h3>
                            <p class="text-body-2 text-medium-emphasis mb-2">{{ context.key }}</p>
                            
                            <div class="context-value mb-3">
                                <v-code class="context-preview">
                                    {{ formatValue(context.value) }}
                                </v-code>
                            </div>
                            
                            <div class="context-metadata">
                                <div class="d-flex align-center text-body-2 text-medium-emphasis">
                                    <v-icon size="16" class="mr-1">mdi-clock-outline</v-icon>
                                    <span class="mr-3">{{ formatDate(context.lastUpdated) }}</span>
                                    <v-icon size="16" class="mr-1">mdi-account</v-icon>
                                    <span>{{ context.updatedBy }}</span>
                                </div>
                            </div>
                        </div>
                        
                        <div class="context-actions ml-4">
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
                </v-card-text>
            </v-card>
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
                        class="mono-font"
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
                                    class="mono-font"
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
.context-view {
    max-width: 1200px;
    margin: 0 auto;
}

.stats-card,
.filters-card,
.context-card {
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

.context-header {
    min-width: 0; /* Allow text truncation */
}

.context-preview {
    background: rgba(255, 255, 255, 0.05) !important;
    padding: 0.5rem !important;
    border-radius: 4px !important;
    font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace !important;
    font-size: 0.875rem !important;
    white-space: pre-wrap;
    word-break: break-word;
}

.context-metadata {
    border-top: 1px solid rgba(255, 255, 255, 0.1);
    padding-top: 0.75rem;
    margin-top: 0.75rem;
}

.mono-font {
    font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
}

.gap-2 {
    gap: 0.5rem;
}

/* Responsive adjustments */
@media (max-width: 768px) {
    .context-header,
    .context-actions {
        margin-left: 0;
    }
    
    .stat-value {
        font-size: 1.25rem;
    }
}
</style>
