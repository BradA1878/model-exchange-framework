<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { useAgentsStore } from '@/stores/agents';
import axios from 'axios';

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
const agentsStore = useAgentsStore();

// Computed properties from store
const agents = computed(() => agentsStore.filteredAgents);
const agentStats = computed(() => agentsStore.agentStats);
const loading = computed(() => agentsStore.isLoading);

// Filters and sorting - connected to store
const searchQuery = computed({
    get: () => agentsStore.filters.search,
    set: (value: string) => agentsStore.setFilters({ search: value })
});

const selectedStatus = computed({
    get: () => agentsStore.filters.status,
    set: (value: string) => agentsStore.setFilters({ status: value })
});

const selectedType = computed({
    get: () => agentsStore.filters.type,
    set: (value: string) => agentsStore.setFilters({ type: value })
});

const sortBy = computed({
    get: () => agentsStore.filters.sortBy,
    set: (value: string) => agentsStore.setFilters({ sortBy: value as any })
});

const sortDesc = computed({
    get: () => agentsStore.filters.sortOrder === 'desc',
    set: (value: boolean) => agentsStore.setFilters({ sortOrder: value ? 'desc' : 'asc' })
});

// Use filtered agents from store
const filteredAgents = computed(() => agents.value);

// Dialog states
const createAgentDialog = ref(false);
const editAgentDialog = ref(false);
const currentTab = ref('basic');
const loadingConfigOptions = ref(false);
const selectedAgent = ref<any>(null);
const snackbar = ref(false);
const snackbarText = ref('');
const snackbarColor = ref('success');

// Agent configuration options from API
const configOptions = ref<any>(null);

// Form data - comprehensive agent configuration
const newAgentForm = ref({
    // Basic Information
    agentId: '',
    name: '',
    description: '',
    type: 'conversation',
    
    // LLM Configuration
    llmProvider: 'openrouter',
    defaultModel: '',
    apiKey: '',
    temperature: 0.7,
    maxTokens: 2048,
    systemPrompt: '',
    
    // Capabilities & Services
    serviceTypes: [] as string[],
    capabilities: [] as string[],
    allowedTools: [] as string[], // Tool access control - allowed MCP tools
    
    // Network Configuration
    host: 'localhost',
    port: 3001,
    secure: false,
    apiUrl: '',
    
    // Authentication
    keyId: '',
    secretKey: '',
    
    // Metadata
    metadata: {} as Record<string, any>
});

// Available models for selected provider
const availableModels = computed(() => {
    if (!newAgentForm.value.llmProvider || !configOptions.value?.defaultModels) return [];
    return configOptions.value.defaultModels[newAgentForm.value.llmProvider] || [];
});

const requiresApiKey = computed(() => {
    const provider = configOptions.value?.llmProviders.find((p: any) => p.value === newAgentForm.value.llmProvider);
    return provider?.requiresApiKey ?? false;
});

// Computed property for preview agent ID (auto-generated from name)
const previewAgentId = computed((): string => {
    if (!newAgentForm.value.name) return '';
    
    return newAgentForm.value.name
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '') // Remove special characters except spaces and hyphens
        .replace(/\s+/g, '-') // Replace spaces with hyphens
        .replace(/-+/g, '-') // Replace multiple hyphens with single hyphen
        .replace(/^-+|-+$/g, '') // Remove leading/trailing hyphens
        .substring(0, 50); // Limit length to max 50 characters
});

// Agent key management state
const agentKeys = ref<{ keyId: string; secretKey: string } | null>(null);
const generatingKeys = ref(false);

// Generate keys from server when dialog opens
const generateAgentKeys = async (): Promise<void> => {
    if (!newAgentForm.value.name || !props.channel?.id) {
        return;
    }
    
    try {
        generatingKeys.value = true;
        const response = await axios.post('/api/agents/keys/generate', {
            channelId: props.channel.id,
            agentName: newAgentForm.value.name
        });
        
        if (response.data.success) {
            agentKeys.value = {
                keyId: response.data.data.keyId,
                secretKey: response.data.data.secretKey
            };
        } else {
            throw new Error(response.data.error || 'Failed to generate keys');
        }
    } catch (error) {
        console.error('Failed to generate agent keys:', error);
        showSnackbar('Failed to generate agent keys', 'error');
    } finally {
        generatingKeys.value = false;
    }
};

// Cleanup unused keys when dialog is cancelled
const cleanupAgentKeys = async (): Promise<void> => {
    if (!agentKeys.value?.keyId) {
        return;
    }
    
    try {
        await axios.delete(`/api/agents/keys/cleanup/${agentKeys.value.keyId}`);
    } catch (error) {
        console.error('Failed to cleanup agent keys:', error);
        // Don't show error to user as this is cleanup
    }
};

// Computed properties for displaying keys
const generatedKeyId = computed((): string => {
    return agentKeys.value?.keyId || 'Generate keys first';
});

const generatedSecretKey = computed((): string => {
    return agentKeys.value?.secretKey || 'Generate keys first';
});

const editAgentForm = ref({
    name: '',
    description: '',
    type: '',
    serviceTypes: [] as string[],
    capabilities: [] as string[],
    allowedTools: [] as string[], // Tool access control - allowed MCP tools
    status: 'ACTIVE' as 'ACTIVE' | 'IDLE' | 'BUSY' | 'OFFLINE' | 'ERROR'
});

// Methods
const loadAgents = async (): Promise<void> => {
    try {
        await agentsStore.fetchAgents();
    } catch (error) {
        console.error('Failed to load agents:', error);
    }
};

const refreshAgents = (): void => {
    agentsStore.refreshAgents();
};

const showSnackbar = (text: string, color: string = 'success'): void => {
    snackbarText.value = text;
    snackbarColor.value = color;
    snackbar.value = true;
};

const copyToClipboard = async (text: string, label: string): Promise<void> => {
    try {
        await navigator.clipboard.writeText(text);
        showSnackbar(`${label} copied to clipboard`, 'success');
    } catch (error) {
        console.error('Failed to copy to clipboard:', error);
        showSnackbar('Failed to copy to clipboard', 'error');
    }
};

const loadConfigOptions = async (): Promise<void> => {
    if (configOptions.value) return; // Already loaded
    
    try {
        loadingConfigOptions.value = true;
        const response = await axios.get('/api/config/agent-options');
        if (response.data.success) {
            configOptions.value = response.data.data;
            // Set default values from config
            const defaults = configOptions.value.defaultSettings;
            newAgentForm.value.host = defaults.host;
            newAgentForm.value.port = defaults.port;
            newAgentForm.value.secure = defaults.secure;
            newAgentForm.value.temperature = defaults.temperature;
            newAgentForm.value.maxTokens = defaults.maxTokens;
        }
    } catch (error) {
        console.error('Failed to load agent config options:', error);
        showSnackbar('Failed to load configuration options', 'error');
    } finally {
        loadingConfigOptions.value = false;
    }
};

const resetNewAgentForm = (): void => {
    const defaults = configOptions.value?.defaultSettings || {
        host: 'localhost',
        port: 3001,
        secure: false,
        temperature: 0.7,
        maxTokens: 2048
    };
    
    newAgentForm.value = {
        // Basic Information
        agentId: '',
        name: '',
        description: '',
        type: 'conversation',
        
        // LLM Configuration
        llmProvider: 'openrouter',
        defaultModel: '',
        apiKey: '',
        temperature: defaults.temperature,
        maxTokens: defaults.maxTokens,
        systemPrompt: '',
        
        // Capabilities & Services
        serviceTypes: [],
        capabilities: [],
        allowedTools: [], // Tool access control - allowed MCP tools
        
        // Network Configuration
        host: defaults.host,
        port: defaults.port,
        secure: defaults.secure,
        apiUrl: '',
        
        // Authentication
        keyId: '',
        secretKey: '',
        
        // Metadata
        metadata: {}
    };
    currentTab.value = 'basic';
};

const openCreateDialog = async (): Promise<void> => {
    await loadConfigOptions();
    resetNewAgentForm();
    createAgentDialog.value = true;
    // Generate agent keys for preview
    await generateAgentKeys();
};

const openEditDialog = (agent: any): void => {
    selectedAgent.value = agent;
    editAgentForm.value = {
        name: agent.name || '',
        description: agent.description || '',
        type: agent.type || 'conversation',
        serviceTypes: [...(agent.serviceTypes || [])],
        capabilities: [...(agent.capabilities || [])],
        allowedTools: [...(agent.allowedTools || [])], // Tool access control
        status: agent.status || 'ACTIVE'
    };
    editAgentDialog.value = true;
};

const updateMetadata = (value: string): void => {
    try {
        newAgentForm.value.metadata = JSON.parse(value || '{}');
    } catch (error) {
        // Keep existing metadata if JSON is invalid
        console.warn('Invalid JSON in metadata field');
    }
};

const createAgent = async (): Promise<void> => {
    const finalAgentId = newAgentForm.value.agentId || previewAgentId.value;
    if (!finalAgentId || !newAgentForm.value.name || !newAgentForm.value.defaultModel) {
        showSnackbar('Agent ID, Name, and Default Model are required', 'error');
        return;
    }
    
    try {
        // Use the custom agent ID if provided, otherwise use the preview
        // Include the authentication key ID from the server-generated keys
        if (!agentKeys.value?.keyId) {
            showSnackbar('Authentication keys not generated. Please try again.', 'error');
            return;
        }
        
        const agentData = {
            ...newAgentForm.value,
            agentId: finalAgentId,
            keyId: agentKeys.value.keyId
        };
        
        await agentsStore.createAgent(agentData);
        // Clear keys after successful creation (they're now associated with the agent)
        agentKeys.value = null;
        createAgentDialog.value = false;
        showSnackbar('Agent created successfully!');
        await loadAgents();
    } catch (error) {
        console.error('Failed to create agent:', error);
        showSnackbar('Failed to create agent', 'error');
    }
};

const updateAgent = async (): Promise<void> => {
    if (!selectedAgent.value) return;
    
    try {
        await agentsStore.updateAgent(selectedAgent.value.agentId, editAgentForm.value);
        editAgentDialog.value = false;
        showSnackbar('Agent updated successfully!');
        await loadAgents();
    } catch (error) {
        console.error('Failed to update agent:', error);
        showSnackbar('Failed to update agent', 'error');
    }
};

const deleteAgent = async (agent: any): Promise<void> => {
    if (!agent || !confirm(`Are you sure you want to delete agent "${agent.name}"?`)) return;
    
    try {
        await agentsStore.deleteAgent(agent.agentId);
        showSnackbar('Agent deleted successfully!');
        await loadAgents();
    } catch (error) {
        console.error('Failed to delete agent:', error);
        showSnackbar('Failed to delete agent', 'error');
    }
};

const getStatusColor = (status: string): string => {
    switch (status.toLowerCase()) {
        case 'active': return 'success';
        case 'idle': return 'warning';
        case 'busy': return 'info';
        case 'offline': return 'error';
        case 'error': return 'error';
        default: return 'default';
    }
};

const getPerformanceColor = (performance: number): string => {
    if (performance >= 90) return 'success';
    if (performance >= 75) return 'warning';
    return 'error';
};

const formatLastActivity = (date: Date): string => {
    const now = new Date();
    const diffMinutes = Math.floor((now.getTime() - date.getTime()) / (1000 * 60));
    
    if (diffMinutes < 1) return 'Just now';
    if (diffMinutes < 60) return `${diffMinutes}m ago`;
    
    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
};

// Watch for channel changes
watch(() => props.channel.id, (newChannelId) => {
    if (newChannelId) {
        loadAgents();
    }
}, { immediate: true });

// Watch for dialog close to cleanup unused keys
watch(createAgentDialog, (isOpen, wasOpen) => {
    // If dialog was closed and we have keys, clean them up
    if (wasOpen && !isOpen && agentKeys.value) {
        cleanupAgentKeys();
        agentKeys.value = null;
    }
});

// Watch for store errors
watch(() => agentsStore.error, (error) => {
    if (error) {
        console.error('Agent store error:', error);
        agentsStore.clearError();
    }
});

onMounted(() => {
    loadAgents();
});
</script>

<template>
    <div class="agents-view">
        <!-- Header with statistics -->
        <v-row class="mb-4">
            <v-col cols="12">
                <v-card class="stats-card">
                    <v-card-text>
                        <v-row>
                            <v-col cols="6" sm="3" md="3">
                                <div class="stat-item">
                                    <div class="stat-value">{{ agentStats.total }}</div>
                                    <div class="stat-label">Total Agents</div>
                                </div>
                            </v-col>
                            <v-col cols="6" sm="3" md="3">
                                <div class="stat-item">
                                    <div class="stat-value">{{ agentStats.active }}</div>
                                    <div class="stat-label">Active</div>
                                </div>
                            </v-col>
                            <v-col cols="6" sm="3" md="3">
                                <div class="stat-item">
                                    <div class="stat-value">{{ agentStats.idle }}</div>
                                    <div class="stat-label">Idle</div>
                                </div>
                            </v-col>
                            <v-col cols="6" sm="3" md="3">
                                <div class="stat-item">
                                    <div class="stat-value">{{ agentStats.offline }}</div>
                                    <div class="stat-label">Offline</div>
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
                                Create Agent
                            </v-btn>
                            <v-spacer />
                            <v-btn
                                variant="outlined"
                                @click="refreshAgents"
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
                                    label="Search agents..."
                                    variant="outlined"
                                    density="compact"
                                    prepend-inner-icon="mdi-magnify"
                                    clearable
                                />
                            </v-col>
                            <v-col cols="6" md="2">
                                <v-select
                                    v-model="selectedStatus"
                                    :items="[
                                        { title: 'All Status', value: 'all' },
                                        { title: 'Active', value: 'ACTIVE' },
                                        { title: 'Idle', value: 'IDLE' },
                                        { title: 'Busy', value: 'BUSY' },
                                        { title: 'Offline', value: 'OFFLINE' },
                                        { title: 'Error', value: 'ERROR' }
                                    ]"
                                    label="Status"
                                    variant="outlined"
                                    density="compact"
                                />
                            </v-col>
                            <v-col cols="6" md="2">
                                <v-select
                                    v-model="selectedType"
                                    :items="[
                                        { title: 'All Types', value: 'all' },
                                        { title: 'Conversation', value: 'conversation' },
                                        { title: 'LLM', value: 'llm' },
                                        { title: 'Search', value: 'search' },
                                        { title: 'Research', value: 'research' },
                                        { title: 'Analysis', value: 'analysis' }
                                    ]"
                                    label="Type"
                                    variant="outlined"
                                    density="compact"
                                />
                            </v-col>
                            <v-col cols="6" md="2">
                                <v-select
                                    v-model="sortBy"
                                    :items="[
                                        { title: 'Performance', value: 'performance' },
                                        { title: 'Last Activity', value: 'lastActive' },
                                        { title: 'Name', value: 'name' },
                                        { title: 'Status', value: 'status' }
                                    ]"
                                    label="Sort By"
                                    variant="outlined"
                                    density="compact"
                                />
                            </v-col>
                        </v-row>
                    </v-card-text>
                </v-card>
            </v-col>
        </v-row>

        <!-- Agents Grid -->
        <div v-if="loading" class="text-center pa-8">
            <v-progress-circular indeterminate color="primary" size="64" />
            <p class="text-body-1 mt-4">Loading agents...</p>
        </div>
        
        <div v-else-if="filteredAgents.length === 0" class="text-center pa-8">
            <v-icon size="64" color="grey">mdi-robot-outline</v-icon>
            <p class="text-h6 mt-4">No agents found</p>
            <p class="text-body-2 text-medium-emphasis">Try adjusting your filters</p>
        </div>
        
        <v-row v-else>
            <v-col
                v-for="agent in filteredAgents"
                :key="agent.id"
                cols="12"
                md="6"
                lg="4"
            >
                <v-card elevation="0" class="agent-card h-100">
                    <v-card-title class="d-flex align-center justify-space-between">
                        <div class="d-flex align-center">
                            <v-avatar
                                :color="getStatusColor(agent.status)"
                                class="mr-3"
                                size="40"
                            >
                                <v-icon color="white">mdi-robot</v-icon>
                            </v-avatar>
                            <div>
                                <div class="text-h6">{{ agent.name }}</div>
                                <v-chip
                                    :color="getStatusColor(agent.status)"
                                    size="small"
                                    variant="tonal"
                                >
                                    {{ agent.status }}
                                </v-chip>
                            </div>
                        </div>
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
                                <v-list-item @click="openEditDialog(agent)">
                                    <template #prepend>
                                        <v-icon>mdi-pencil</v-icon>
                                    </template>
                                    <v-list-item-title>Edit Agent</v-list-item-title>
                                </v-list-item>
                                <v-list-item @click="deleteAgent(agent)">
                                    <template #prepend>
                                        <v-icon color="error">mdi-delete</v-icon>
                                    </template>
                                    <v-list-item-title>Delete Agent</v-list-item-title>
                                </v-list-item>
                            </v-list>
                        </v-menu>
                    </v-card-title>
                    
                    <v-card-text>
                        <div class="agent-details mb-4">
                            <div class="mb-2">
                                <strong>Type:</strong> {{ agent.type }}
                            </div>
                            <div class="mb-2" v-if="agent.description">
                                <strong>Description:</strong> {{ agent.description }}
                            </div>
                            <div class="mb-2">
                                <strong>Version:</strong> {{ agent.version }}
                            </div>
                            <div class="mb-2">
                                <strong>Last Activity:</strong> {{ formatLastActivity(agent.lastActive) }}
                            </div>
                        </div>

                        <div class="agent-metrics mb-4" v-if="agent.performance">
                            <v-row>
                                <v-col cols="6">
                                    <div class="metric-item">
                                        <div class="metric-value">{{ agent.performance.tasksCompleted }}</div>
                                        <div class="metric-label">Tasks Completed</div>
                                    </div>
                                </v-col>
                                <v-col cols="6">
                                    <div class="metric-item">
                                        <div class="metric-value">{{ agent.performance.averageResponseTime.toFixed(1) }}s</div>
                                        <div class="metric-label">Avg Response</div>
                                    </div>
                                </v-col>
                            </v-row>
                        </div>

                        <div class="performance-section mb-4" v-if="agent.performance">
                            <div class="d-flex align-center justify-space-between mb-2">
                                <span class="text-body-2 font-weight-medium">Uptime</span>
                                <span :class="`text-${getPerformanceColor(agent.performance.uptime)}`">
                                    {{ agent.performance.uptime.toFixed(1) }}%
                                </span>
                            </div>
                            <v-progress-linear
                                :model-value="agent.performance.uptime"
                                :color="getPerformanceColor(agent.performance.uptime)"
                                height="8"
                                rounded
                            />
                        </div>

                        <div class="service-types-section mb-4" v-if="agent.serviceTypes?.length">
                            <div class="text-body-2 font-weight-medium mb-2">Service Types</div>
                            <div class="d-flex flex-wrap gap-1">
                                <v-chip
                                    v-for="serviceType in agent.serviceTypes"
                                    :key="serviceType"
                                    size="x-small"
                                    variant="outlined"
                                    color="secondary"
                                >
                                    {{ serviceType.replace('_', ' ') }}
                                </v-chip>
                            </div>
                        </div>

                        <div class="capabilities-section">
                            <div class="text-body-2 font-weight-medium mb-2">Capabilities</div>
                            <div class="d-flex flex-wrap gap-1">
                                <v-chip
                                    v-for="capability in agent.capabilities"
                                    :key="capability"
                                    size="x-small"
                                    variant="outlined"
                                >
                                    {{ capability.replace('_', ' ') }}
                                </v-chip>
                            </div>
                        </div>
                    </v-card-text>
                </v-card>
            </v-col>
        </v-row>

        <!-- Create Agent Dialog -->
        <v-dialog v-model="createAgentDialog" max-width="900px" persistent>
            <v-card>
                <v-card-title class="text-h5">Create New Agent</v-card-title>
                <v-card-subtitle class="text-medium-emphasis mb-3">
                    Creating agent for channel: <strong>{{ props.channel.name }}</strong>
                </v-card-subtitle>
                
                <!-- Loading Config Options -->
                <v-progress-linear v-if="loadingConfigOptions" indeterminate />
                
                <v-card-text v-if="!loadingConfigOptions">
                    <v-tabs v-model="currentTab" bg-color="transparent">
                        <v-tab value="basic">Basic Info</v-tab>
                        <v-tab value="llm">LLM Config</v-tab>
                        <v-tab value="capabilities">Capabilities</v-tab>
                        <v-tab value="network">Network</v-tab>
                        <v-tab value="auth">Authentication</v-tab>
                        <v-tab value="metadata">Metadata</v-tab>
                    </v-tabs>
                    
                    <v-divider class="my-4" />
                    
                    <v-tabs-window v-model="currentTab">
                        <!-- Basic Information Tab -->
                        <v-tabs-window-item value="basic">
                            <v-container>
                                <v-row>
                                    <v-col cols="12">
                                        <v-text-field
                                            v-model="newAgentForm.agentId"
                                            :placeholder="previewAgentId"
                                            label="Agent ID*"
                                            required
                                            variant="outlined"
                                            hint="Auto-generated from name, but you can customize it"
                                            persistent-hint
                                        />
                                    </v-col>
                                    <v-col cols="12">
                                        <v-text-field
                                            v-model="newAgentForm.name"
                                            label="Name*"
                                            required
                                            variant="outlined"
                                        />
                                    </v-col>
                                    <v-col cols="12">
                                        <v-textarea
                                            v-model="newAgentForm.description"
                                            label="Description"
                                            variant="outlined"
                                            rows="3"
                                        />
                                    </v-col>
                                    <v-col cols="12">
                                        <v-select
                                            v-model="newAgentForm.type"
                                            :items="configOptions?.agentTypes || [
                                                { title: 'Conversation', value: 'conversation' },
                                                { title: 'Assistant', value: 'assistant' },
                                                { title: 'Analyzer', value: 'analyzer' },
                                                { title: 'Moderator', value: 'moderator' },
                                                { title: 'Specialist', value: 'specialist' },
                                                { title: 'Custom', value: 'custom' }
                                            ]"
                                            label="Agent Type*"
                                            required
                                            variant="outlined"
                                        />
                                    </v-col>
                                </v-row>
                            </v-container>
                        </v-tabs-window-item>
                        
                        <!-- LLM Configuration Tab -->
                        <v-tabs-window-item value="llm">
                            <v-container>
                                <v-row>
                                    <v-col cols="12" md="6">
                                        <v-select
                                            v-model="newAgentForm.llmProvider"
                                            :items="configOptions?.llmProviders || []"
                                            item-title="label"
                                            item-value="value"
                                            label="LLM Provider*"
                                            required
                                            variant="outlined"
                                        />
                                    </v-col>
                                    <v-col cols="12" md="6">
                                        <v-select
                                            v-model="newAgentForm.defaultModel"
                                            :items="availableModels"
                                            label="Default Model*"
                                            required
                                            variant="outlined"
                                            :disabled="!newAgentForm.llmProvider"
                                        />
                                    </v-col>
                                    <v-col cols="12" v-if="requiresApiKey">
                                        <v-text-field
                                            v-model="newAgentForm.apiKey"
                                            label="API Key*"
                                            type="password"
                                            required
                                            variant="outlined"
                                            hint="This will be stored securely"
                                            persistent-hint
                                        />
                                    </v-col>
                                    <v-col cols="12" md="6">
                                        <v-slider
                                            v-model="newAgentForm.temperature"
                                            label="Temperature"
                                            min="0"
                                            max="2"
                                            step="0.1"
                                            thumb-label
                                            variant="outlined"
                                        />
                                    </v-col>
                                    <v-col cols="12" md="6">
                                        <v-text-field
                                            v-model.number="newAgentForm.maxTokens"
                                            label="Max Tokens"
                                            type="number"
                                            variant="outlined"
                                            min="1"
                                            max="32000"
                                        />
                                    </v-col>
                                    <v-col cols="12">
                                        <v-textarea
                                            v-model="newAgentForm.systemPrompt"
                                            label="System Prompt"
                                            variant="outlined"
                                            rows="4"
                                            hint="Instructions that define the agent's behavior and personality"
                                            persistent-hint
                                        />
                                    </v-col>
                                </v-row>
                            </v-container>
                        </v-tabs-window-item>
                        
                        <!-- Capabilities Tab -->
                        <v-tabs-window-item value="capabilities">
                            <v-container>
                                <v-row>
                                    <v-col cols="12">
                                        <v-combobox
                                            v-model="newAgentForm.serviceTypes"
                                            :items="configOptions?.commonServiceTypes || []"
                                            label="Service Types"
                                            variant="outlined"
                                            multiple
                                            chips
                                            closable-chips
                                            hint="Select or enter custom service types"
                                            persistent-hint
                                        />
                                    </v-col>
                                    <v-col cols="12">
                                        <v-combobox
                                            v-model="newAgentForm.capabilities"
                                            :items="configOptions?.commonCapabilities || []"
                                            label="Capabilities"
                                            variant="outlined"
                                            multiple
                                            chips
                                            closable-chips
                                            hint="Select or enter custom capabilities"
                                            persistent-hint
                                        />
                                    </v-col>
                                    <v-col cols="12">
                                        <v-combobox
                                            v-model="newAgentForm.allowedTools"
                                            :items="configOptions?.availableTools || []"
                                            label="Allowed Tools"
                                            variant="outlined"
                                            multiple
                                            chips
                                            closable-chips
                                            hint="Select specific tools this agent can use. Leave empty for unrestricted access to all tools."
                                            persistent-hint
                                        />
                                    </v-col>
                                </v-row>
                            </v-container>
                        </v-tabs-window-item>
                        
                        <!-- Network Configuration Tab -->
                        <v-tabs-window-item value="network">
                            <v-container>
                                <v-row>
                                    <v-col cols="12" md="6">
                                        <v-text-field
                                            v-model="newAgentForm.host"
                                            label="Host"
                                            variant="outlined"
                                        />
                                    </v-col>
                                    <v-col cols="12" md="6">
                                        <v-text-field
                                            v-model.number="newAgentForm.port"
                                            label="Port"
                                            type="number"
                                            variant="outlined"
                                        />
                                    </v-col>
                                    <v-col cols="12">
                                        <v-switch
                                            v-model="newAgentForm.secure"
                                            label="Use HTTPS"
                                            color="primary"
                                        />
                                    </v-col>
                                    <v-col cols="12">
                                        <v-text-field
                                            v-model="newAgentForm.apiUrl"
                                            label="API URL (optional)"
                                            variant="outlined"
                                            hint="Custom API endpoint if different from host:port"
                                            persistent-hint
                                        />
                                    </v-col>
                                </v-row>
                            </v-container>
                        </v-tabs-window-item>
                        
                        <!-- Authentication Tab -->
                        <v-tabs-window-item value="auth">
                            <v-container>
                                <v-alert
                                    type="info"
                                    variant="tonal"
                                    class="mb-4"
                                >
                                    <strong>Agent Authentication</strong><br>
                                    This agent will use the generated keys to authenticate with the MXF server.
                                    The agent can only connect to its assigned channel using these credentials.
                                </v-alert>
                                
                                <v-row>
                                    <v-col cols="12">
                                        <v-text-field
                                            :value="props.channel.name"
                                            label="Channel"
                                            variant="outlined"
                                            readonly
                                            hint="Channel this agent will be assigned to"
                                            persistent-hint
                                            prepend-inner-icon="mdi-forum"
                                        />
                                    </v-col>
                                    <v-col cols="12">
                                        <v-text-field
                                            :value="generatedKeyId"
                                            label="Agent Key ID"
                                            variant="outlined"
                                            readonly
                                            hint="Auto-generated identifier for this agent"
                                            persistent-hint
                                            prepend-inner-icon="mdi-key-variant"
                                            append-inner-icon="mdi-content-copy"
                                            @click:append-inner="copyToClipboard(generatedKeyId, 'Key ID')"
                                        />
                                    </v-col>
                                    <v-col cols="12">
                                        <v-text-field
                                            :value="generatedSecretKey"
                                            label="Agent Secret Key"
                                            variant="outlined"
                                            readonly
                                            hint="Auto-generated secret for agent authentication"
                                            persistent-hint
                                            prepend-inner-icon="mdi-lock"
                                            append-inner-icon="mdi-content-copy"
                                            @click:append-inner="copyToClipboard(generatedSecretKey, 'Secret Key')"
                                        />
                                    </v-col>
                                </v-row>
                                
                                <v-row class="mt-4">
                                    <v-col cols="12">
                                        <v-btn
                                            color="primary"
                                            variant="outlined"
                                            prepend-icon="mdi-refresh"
                                            :loading="generatingKeys"
                                            @click="generateAgentKeys"
                                        >
                                            Regenerate Keys
                                        </v-btn>
                                    </v-col>
                                </v-row>
                                
                                <v-alert
                                    type="warning"
                                    variant="tonal"
                                    class="mt-4"
                                >
                                    <strong>Developer Note:</strong> These keys are only needed if you're using the MXF SDK to develop custom agents.
                                    Most users won't need to use these keys directly.
                                </v-alert>
                            </v-container>
                        </v-tabs-window-item>
                        
                        <!-- Metadata Tab -->
                        <v-tabs-window-item value="metadata">
                            <v-container>
                                <v-row>
                                    <v-col cols="12">
                                        <v-textarea
                                            :model-value="JSON.stringify(newAgentForm.metadata, null, 2)"
                                            @update:model-value="updateMetadata"
                                            label="Metadata (JSON)"
                                            variant="outlined"
                                            rows="8"
                                            hint="Additional configuration as JSON object"
                                            persistent-hint
                                        />
                                    </v-col>
                                </v-row>
                            </v-container>
                        </v-tabs-window-item>
                    </v-tabs-window>
                </v-card-text>
                
                <v-card-actions>
                    <v-spacer />
                    <v-btn
                        color="grey-darken-1"
                        variant="text"
                        @click="createAgentDialog = false"
                    >
                        Cancel
                    </v-btn>
                    <v-btn
                        color="primary"
                        variant="elevated"
                        @click="createAgent"
                        :disabled="!newAgentForm.agentId || !newAgentForm.name || !newAgentForm.defaultModel"
                    >
                        Create Agent
                    </v-btn>
                </v-card-actions>
            </v-card>
        </v-dialog>

        <!-- Edit Agent Dialog -->
        <v-dialog v-model="editAgentDialog" max-width="600px" persistent>
            <v-card>
                <v-card-title class="text-h5">Edit Agent</v-card-title>
                <v-card-text>
                    <v-container>
                        <v-row>
                            <v-col cols="12">
                                <v-text-field
                                    v-model="editAgentForm.name"
                                    label="Name*"
                                    required
                                    variant="outlined"
                                />
                            </v-col>
                            <v-col cols="12">
                                <v-textarea
                                    v-model="editAgentForm.description"
                                    label="Description"
                                    variant="outlined"
                                    rows="3"
                                />
                            </v-col>
                            <v-col cols="12" md="6">
                                <v-select
                                    v-model="editAgentForm.type"
                                    :items="[
                                        { title: 'Conversation', value: 'conversation' },
                                        { title: 'LLM', value: 'llm' },
                                        { title: 'Search', value: 'search' },
                                        { title: 'Research', value: 'research' },
                                        { title: 'Analysis', value: 'analysis' }
                                    ]"
                                    label="Type*"
                                    required
                                    variant="outlined"
                                />
                            </v-col>
                            <v-col cols="12" md="6">
                                <v-select
                                    v-model="editAgentForm.status"
                                    :items="[
                                        { title: 'Active', value: 'ACTIVE' },
                                        { title: 'Idle', value: 'IDLE' },
                                        { title: 'Busy', value: 'BUSY' },
                                        { title: 'Offline', value: 'OFFLINE' },
                                        { title: 'Error', value: 'ERROR' }
                                    ]"
                                    label="Status*"
                                    required
                                    variant="outlined"
                                />
                            </v-col>
                            <v-col cols="12">
                                <v-combobox
                                    v-model="editAgentForm.serviceTypes"
                                    label="Service Types"
                                    variant="outlined"
                                    multiple
                                    chips
                                    closable-chips
                                    hint="Enter service types and press Enter"
                                    persistent-hint
                                />
                            </v-col>
                            <v-col cols="12">
                                <v-combobox
                                    v-model="editAgentForm.capabilities"
                                    label="Capabilities"
                                    variant="outlined"
                                    multiple
                                    chips
                                    closable-chips
                                    hint="Enter capabilities and press Enter"
                                    persistent-hint
                                />
                            </v-col>
                            <v-col cols="12">
                                <v-combobox
                                    v-model="editAgentForm.allowedTools"
                                    :items="configOptions?.availableTools || []"
                                    label="Allowed Tools"
                                    variant="outlined"
                                    multiple
                                    chips
                                    closable-chips
                                    hint="Select specific tools this agent can use. Leave empty for unrestricted access to all tools."
                                    persistent-hint
                                />
                            </v-col>
                        </v-row>
                    </v-container>
                </v-card-text>
                <v-card-actions>
                    <v-spacer />
                    <v-btn
                        color="grey-darken-1"
                        variant="text"
                        @click="editAgentDialog = false"
                    >
                        Cancel
                    </v-btn>
                    <v-btn
                        color="primary"
                        variant="elevated"
                        @click="updateAgent"
                        :disabled="!editAgentForm.name"
                    >
                        Update Agent
                    </v-btn>
                </v-card-actions>
            </v-card>
        </v-dialog>

        <!-- Snackbar -->
        <v-snackbar
            v-model="snackbar"
            :color="snackbarColor"
            timeout="4000"
            location="top"
        >
            {{ snackbarText }}
            <template #actions>
                <v-btn
                    color="white"
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
.agents-view {
    max-width: 1200px;
    margin: 0 auto;
}

.stats-card,
.filters-card,
.agent-card {
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

.agent-card {
    transition: all 0.2s ease;
}

.agent-card:hover {
    transform: translateY(-2px);
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.1);
}

.mono-font {
    font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
}
</style>
