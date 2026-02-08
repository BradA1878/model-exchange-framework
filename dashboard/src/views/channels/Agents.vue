<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { useAgentsStore } from '@/stores/agents';
import axios from '@/plugins/axios';
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

    // Agent Context (identity, instructions, constraints, examples)
    context: {
        identity: '',
        instructions: '',
        constraints: [] as string[],
        examples: [] as string[]
    },

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

// Agent ID validation state
const agentIdValidating = ref(false);
const agentIdError = ref<string | null>(null);
const agentIdValid = ref(true);

// Validate agent ID uniqueness
const validateAgentId = async (agentId: string): Promise<void> => {
    if (!agentId.trim()) {
        agentIdError.value = null;
        agentIdValid.value = true;
        return;
    }

    agentIdValidating.value = true;
    agentIdError.value = null;

    try {
        // Check if agent ID already exists by looking through existing agents
        const existingAgent = agents.value.find(
            agent => agent.agentId.toLowerCase() === agentId.toLowerCase()
        );

        if (existingAgent) {
            agentIdError.value = `Agent ID "${agentId}" is already in use`;
            agentIdValid.value = false;
        } else {
            agentIdValid.value = true;
        }
    } catch (error) {
        console.error('Error validating agent ID:', error);
        agentIdError.value = 'Error validating agent ID';
        agentIdValid.value = false;
    } finally {
        agentIdValidating.value = false;
    }
};

// Debounced agent ID validation
let agentIdValidationTimeout: ReturnType<typeof setTimeout> | null = null;
const debouncedValidateAgentId = (agentId: string): void => {
    if (agentIdValidationTimeout) {
        clearTimeout(agentIdValidationTimeout);
    }
    agentIdValidationTimeout = setTimeout(() => {
        validateAgentId(agentId);
    }, 300);
};

// Agent key management state
const agentKeys = ref<{ keyId: string; secretKey: string } | null>(null);
const generatingKeys = ref(false);

// Tool categories for better UX
const coreTools = [
    'send_message',
    'task_create',
    'task_update',
    'task_list',
    'memory_store',
    'memory_retrieve'
];

const communicationTools = [
    'send_message',
    'broadcast_message',
    'request_assistance',
    'report_status'
];

const taskTools = [
    'task_create',
    'task_update',
    'task_list',
    'task_assign',
    'task_complete',
    'task_delegate'
];

const memoryTools = [
    'memory_store',
    'memory_retrieve',
    'memory_search',
    'memory_delete',
    'memory_list'
];

// Tool descriptions for better understanding
const toolDescriptions: Record<string, string> = {
    'send_message': 'Send messages to other agents in the channel',
    'broadcast_message': 'Send messages to all agents in the channel',
    'request_assistance': 'Request help from other agents',
    'report_status': 'Report agent status to the channel',
    'task_create': 'Create new tasks for agents to work on',
    'task_update': 'Update existing task status and details',
    'task_list': 'List and query tasks in the channel',
    'task_assign': 'Assign tasks to specific agents',
    'task_complete': 'Mark tasks as completed',
    'task_delegate': 'Delegate tasks to other agents',
    'memory_store': 'Store information in agent memory',
    'memory_retrieve': 'Retrieve stored information from memory',
    'memory_search': 'Search through stored memories',
    'memory_delete': 'Delete stored memories',
    'memory_list': 'List all stored memories'
};

// Get all available tools from config
const allAvailableTools = computed(() => configOptions.value?.availableTools || []);

// Other tools that don't fit in predefined categories
const otherTools = computed(() => {
    const predefinedTools = [...new Set([...coreTools, ...communicationTools, ...taskTools, ...memoryTools])];
    return allAvailableTools.value.filter((t: string) => !predefinedTools.includes(t));
});

// Count selected tools in each category
const coreToolsSelected = computed(() =>
    newAgentForm.value.allowedTools.filter(t => coreTools.includes(t)).length
);
const communicationToolsSelected = computed(() =>
    newAgentForm.value.allowedTools.filter(t => communicationTools.includes(t)).length
);
const taskToolsSelected = computed(() =>
    newAgentForm.value.allowedTools.filter(t => taskTools.includes(t)).length
);
const memoryToolsSelected = computed(() =>
    newAgentForm.value.allowedTools.filter(t => memoryTools.includes(t)).length
);
const otherToolsSelected = computed(() =>
    newAgentForm.value.allowedTools.filter(t => otherTools.value.includes(t)).length
);

// Tool selection methods
const getToolDescription = (tool: string): string => {
    return toolDescriptions[tool] || 'MCP tool';
};

const selectAllCoreTools = (): void => {
    const currentTools = new Set(newAgentForm.value.allowedTools);
    coreTools.forEach(t => currentTools.add(t));
    newAgentForm.value.allowedTools = Array.from(currentTools);
};

const selectAllTools = (): void => {
    newAgentForm.value.allowedTools = [...allAvailableTools.value];
};

const clearAllTools = (): void => {
    newAgentForm.value.allowedTools = [];
};

const removeSelectedTool = (tool: string): void => {
    newAgentForm.value.allowedTools = newAgentForm.value.allowedTools.filter(t => t !== tool);
};

// Edit form tool selection computed properties
const editCoreToolsSelected = computed(() =>
    editAgentForm.value.allowedTools.filter(t => coreTools.includes(t)).length
);
const editCommunicationToolsSelected = computed(() =>
    editAgentForm.value.allowedTools.filter(t => communicationTools.includes(t)).length
);
const editTaskToolsSelected = computed(() =>
    editAgentForm.value.allowedTools.filter(t => taskTools.includes(t)).length
);
const editMemoryToolsSelected = computed(() =>
    editAgentForm.value.allowedTools.filter(t => memoryTools.includes(t)).length
);

// Edit form tool selection methods
const selectAllCoreToolsEdit = (): void => {
    const currentTools = new Set(editAgentForm.value.allowedTools);
    coreTools.forEach(t => currentTools.add(t));
    editAgentForm.value.allowedTools = Array.from(currentTools);
};

const selectAllToolsEdit = (): void => {
    editAgentForm.value.allowedTools = [...allAvailableTools.value];
};

const clearAllToolsEdit = (): void => {
    editAgentForm.value.allowedTools = [];
};

const removeSelectedToolEdit = (tool: string): void => {
    editAgentForm.value.allowedTools = editAgentForm.value.allowedTools.filter(t => t !== tool);
};

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
    status: 'ACTIVE' as 'ACTIVE' | 'IDLE' | 'BUSY' | 'OFFLINE' | 'ERROR',
    // Agent Context (identity, instructions, constraints, examples)
    context: {
        identity: '',
        instructions: '',
        constraints: [] as string[],
        examples: [] as string[]
    }
});

// Edit dialog tab state
const editCurrentTab = ref('basic');

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

// Lifecycle control state
const metricsDialog = ref(false);
const metricsData = ref<any>(null);
const metricsLoading = ref(false);
const metricsAgent = ref<any>(null);
const confirmDialog = ref(false);
const confirmAction = ref<{ title: string; message: string; action: () => Promise<void> } | null>(null);
const lifecycleLoading = computed(() => agentsStore.lifecycleLoading);

// Lifecycle action handlers
const handleViewMetrics = async (agent: any): Promise<void> => {
    metricsAgent.value = agent;
    metricsLoading.value = true;
    metricsDialog.value = true;
    try {
        metricsData.value = await agentsStore.getAgentMetrics(agent.agentId);
    } catch {
        showSnackbar('Failed to load agent metrics', 'error');
        metricsDialog.value = false;
    } finally {
        metricsLoading.value = false;
    }
};

const handleRestart = async (agent: any): Promise<void> => {
    try {
        await agentsStore.restartAgent(agent.agentId);
        showSnackbar(`Agent "${agent.name}" restart requested`);
    } catch {
        showSnackbar('Failed to restart agent', 'error');
    }
};

const handlePauseResume = async (agent: any): Promise<void> => {
    const isPaused = agent.status === 'PAUSED';
    try {
        if (isPaused) {
            await agentsStore.resumeAgent(agent.agentId);
            showSnackbar(`Agent "${agent.name}" resumed`);
        } else {
            await agentsStore.pauseAgent(agent.agentId);
            showSnackbar(`Agent "${agent.name}" paused`);
        }
    } catch {
        showSnackbar(`Failed to ${isPaused ? 'resume' : 'pause'} agent`, 'error');
    }
};

const openConfirmDialog = (title: string, message: string, action: () => Promise<void>): void => {
    confirmAction.value = { title, message, action };
    confirmDialog.value = true;
};

const executeConfirmAction = async (): Promise<void> => {
    if (!confirmAction.value) return;
    try {
        await confirmAction.value.action();
    } finally {
        confirmDialog.value = false;
        confirmAction.value = null;
    }
};

const handleShutdown = (agent: any): void => {
    openConfirmDialog(
        'Confirm Shutdown',
        `Are you sure you want to shutdown agent "${agent.name}"? This will stop the agent from processing any tasks.`,
        async () => {
            try {
                await agentsStore.shutdownAgent(agent.agentId);
                showSnackbar(`Agent "${agent.name}" shutdown requested`);
            } catch {
                showSnackbar('Failed to shutdown agent', 'error');
            }
        }
    );
};

const handleClearMemory = (agent: any): void => {
    openConfirmDialog(
        'Confirm Clear Memory',
        `Are you sure you want to clear all memory for agent "${agent.name}"? This action cannot be undone.`,
        async () => {
            try {
                await agentsStore.deleteAgentMemory(agent.agentId);
                showSnackbar(`Memory cleared for agent "${agent.name}"`);
            } catch {
                showSnackbar('Failed to clear agent memory', 'error');
            }
        }
    );
};

// Format uptime from milliseconds to human-readable string
const formatUptime = (ms: number): string => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    if (days > 0) return `${days}d ${hours % 24}h`;
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m`;
    return `${seconds}s`;
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

        // Agent Context
        context: {
            identity: '',
            instructions: '',
            constraints: [],
            examples: []
        },

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
        status: agent.status || 'ACTIVE',
        context: {
            identity: agent.context?.identity || '',
            instructions: agent.context?.instructions || '',
            constraints: [...(agent.context?.constraints || [])],
            examples: [...(agent.context?.examples || [])]
        }
    };
    editCurrentTab.value = 'basic';
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

// Watch for channel changes - use optional chaining since channel can be null
watch(() => props.channel?.id, (newChannelId) => {
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
    <div class="ch-agents">
        <!-- Header Strip -->
        <header class="ch-agents__header">
            <div class="ch-agents__header-left">
                <h2 class="ch-agents__header-title">Agents</h2>
                <span class="ch-agents__header-divider">/</span>
                <span class="ch-agents__header-sub">{{ channel.name }}</span>
            </div>
            <div class="ch-agents__header-actions">
                <button class="ch-agents__btn ch-agents__btn--ghost" @click="refreshAgents" :disabled="loading">
                    <v-icon size="14">mdi-refresh</v-icon>
                    <span>Refresh</span>
                </button>
                <button class="ch-agents__btn ch-agents__btn--primary" @click="openCreateDialog">
                    <v-icon size="14">mdi-plus</v-icon>
                    <span>Create Agent</span>
                </button>
            </div>
        </header>

        <!-- Summary Metrics Strip -->
        <section class="ch-agents__metrics">
            <div class="ch-agents__metric" data-accent="blue">
                <div class="ch-agents__metric-head">
                    <span class="ch-agents__metric-label">Total Agents</span>
                    <v-icon size="13" class="ch-agents__metric-ico">mdi-robot-outline</v-icon>
                </div>
                <div class="ch-agents__metric-number">{{ agentStats.total }}</div>
            </div>
            <div class="ch-agents__metric" data-accent="green">
                <div class="ch-agents__metric-head">
                    <span class="ch-agents__metric-label">Active</span>
                    <v-icon size="13" class="ch-agents__metric-ico">mdi-check-network</v-icon>
                </div>
                <div class="ch-agents__metric-number">{{ agentStats.active }}</div>
            </div>
            <div class="ch-agents__metric" data-accent="amber">
                <div class="ch-agents__metric-head">
                    <span class="ch-agents__metric-label">Idle</span>
                    <v-icon size="13" class="ch-agents__metric-ico">mdi-sleep</v-icon>
                </div>
                <div class="ch-agents__metric-number">{{ agentStats.idle }}</div>
            </div>
            <div class="ch-agents__metric" data-accent="red">
                <div class="ch-agents__metric-head">
                    <span class="ch-agents__metric-label">Offline</span>
                    <v-icon size="13" class="ch-agents__metric-ico">mdi-power-off</v-icon>
                </div>
                <div class="ch-agents__metric-number">{{ agentStats.offline }}</div>
            </div>
        </section>

        <!-- Filters Card -->
        <div class="ch-agents__filters">
            <div class="ch-agents__filters-head">
                <div class="ch-agents__filters-title">
                    <v-icon size="16">mdi-filter-variant</v-icon>
                    <span>Filters</span>
                </div>
            </div>
            <div class="ch-agents__filters-body">
                <v-row>
                    <v-col cols="12" md="3">
                        <v-text-field
                            v-model="searchQuery"
                            label="Search agents..."
                            variant="outlined"
                            density="comfortable"
                            prepend-inner-icon="mdi-magnify"
                            clearable
                        />
                    </v-col>
                    <v-col cols="6" md="3">
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
                            density="comfortable"
                        />
                    </v-col>
                    <v-col cols="6" md="3">
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
                            density="comfortable"
                        />
                    </v-col>
                    <v-col cols="6" md="3">
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
                            density="comfortable"
                        />
                    </v-col>
                </v-row>
            </div>
        </div>

        <!-- Loading State -->
        <div v-if="loading" class="ch-agents__empty">
            <v-progress-circular indeterminate color="primary" size="48" />
            <p class="ch-agents__empty-title">Loading agents...</p>
        </div>

        <!-- Empty State -->
        <div v-else-if="filteredAgents.length === 0" class="ch-agents__empty">
            <v-icon size="48" class="ch-agents__empty-icon">mdi-robot-confused-outline</v-icon>
            <p class="ch-agents__empty-title">No agents found</p>
            <p class="ch-agents__empty-sub">Try adjusting your filters, or create a new agent to get started.</p>
            <button class="ch-agents__btn ch-agents__btn--primary" @click="openCreateDialog">
                <v-icon size="14">mdi-plus</v-icon>
                <span>Create Agent</span>
            </button>
        </div>

        <!-- Agents Grid -->
        <div v-else class="ch-agents__grid">
            <div
                v-for="agent in filteredAgents"
                :key="agent.id"
                class="ch-agents__card"
            >
                <!-- Card header with avatar, name, status, and menu -->
                <div class="ch-agents__card-header">
                    <div class="ch-agents__card-identity">
                        <v-avatar
                            :color="getStatusColor(agent.status)"
                            class="ch-agents__card-avatar"
                            size="40"
                        >
                            <v-icon color="white">mdi-robot</v-icon>
                        </v-avatar>
                        <div>
                            <div class="ch-agents__card-name">{{ agent.name }}</div>
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
                            <v-list-item @click="handleViewMetrics(agent)">
                                <template #prepend>
                                    <v-icon color="info">mdi-chart-box</v-icon>
                                </template>
                                <v-list-item-title>View Metrics</v-list-item-title>
                            </v-list-item>
                            <v-divider class="my-1" />
                            <v-list-item
                                @click="handleRestart(agent)"
                                :disabled="lifecycleLoading === agent.agentId"
                            >
                                <template #prepend>
                                    <v-icon color="primary">mdi-restart</v-icon>
                                </template>
                                <v-list-item-title>Restart</v-list-item-title>
                            </v-list-item>
                            <v-list-item
                                @click="handlePauseResume(agent)"
                                :disabled="lifecycleLoading === agent.agentId"
                            >
                                <template #prepend>
                                    <v-icon color="warning">
                                        {{ agent.status === 'PAUSED' ? 'mdi-play' : 'mdi-pause' }}
                                    </v-icon>
                                </template>
                                <v-list-item-title>
                                    {{ agent.status === 'PAUSED' ? 'Resume' : 'Pause' }}
                                </v-list-item-title>
                            </v-list-item>
                            <v-list-item
                                @click="handleShutdown(agent)"
                                :disabled="lifecycleLoading === agent.agentId"
                            >
                                <template #prepend>
                                    <v-icon color="error">mdi-power</v-icon>
                                </template>
                                <v-list-item-title>Shutdown</v-list-item-title>
                            </v-list-item>
                            <v-list-item
                                @click="handleClearMemory(agent)"
                                :disabled="lifecycleLoading === agent.agentId"
                            >
                                <template #prepend>
                                    <v-icon color="warning">mdi-broom</v-icon>
                                </template>
                                <v-list-item-title>Clear Memory</v-list-item-title>
                            </v-list-item>
                            <v-divider class="my-1" />
                            <v-list-item @click="deleteAgent(agent)">
                                <template #prepend>
                                    <v-icon color="error">mdi-delete</v-icon>
                                </template>
                                <v-list-item-title>Delete Agent</v-list-item-title>
                            </v-list-item>
                        </v-list>
                    </v-menu>
                </div>

                <!-- Card body with details -->
                <div class="ch-agents__card-body">
                    <div class="ch-agents__card-details">
                        <div class="ch-agents__card-detail">
                            <span class="ch-agents__card-detail-label">Type</span>
                            <span>{{ agent.type }}</span>
                        </div>
                        <div class="ch-agents__card-detail" v-if="agent.description">
                            <span class="ch-agents__card-detail-label">Description</span>
                            <span>{{ agent.description }}</span>
                        </div>
                        <div class="ch-agents__card-detail">
                            <span class="ch-agents__card-detail-label">Version</span>
                            <span class="ch-agents__card-detail-mono">{{ agent.version }}</span>
                        </div>
                        <div class="ch-agents__card-detail">
                            <span class="ch-agents__card-detail-label">Last Activity</span>
                            <span>{{ formatLastActivity(agent.lastActive) }}</span>
                        </div>
                    </div>

                    <!-- Mini metrics row -->
                    <div class="ch-agents__mini-metrics" v-if="agent.performance">
                        <div class="ch-agents__mini-metric">
                            <div class="ch-agents__mini-metric-val">{{ agent.performance.tasksCompleted }}</div>
                            <div class="ch-agents__mini-metric-label">Tasks Completed</div>
                        </div>
                        <div class="ch-agents__mini-metric">
                            <div class="ch-agents__mini-metric-val">{{ agent.performance.averageResponseTime.toFixed(1) }}s</div>
                            <div class="ch-agents__mini-metric-label">Avg Response</div>
                        </div>
                    </div>

                    <!-- Performance bar -->
                    <div class="ch-agents__card-perf" v-if="agent.performance">
                        <div class="ch-agents__card-perf-row">
                            <span class="ch-agents__card-perf-label">Uptime</span>
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

                    <!-- Service types -->
                    <div class="ch-agents__card-services" v-if="agent.serviceTypes?.length">
                        <div class="ch-agents__section-label">Service Types</div>
                        <div class="ch-agents__chip-wrap">
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

                    <!-- Capabilities -->
                    <div class="ch-agents__card-caps">
                        <div class="ch-agents__section-label">Capabilities</div>
                        <div class="ch-agents__chip-wrap">
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
                </div>
            </div>
        </div>

        <!-- Create Agent Dialog (kept as v-card for dialog overlay) -->
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
                        <v-tab value="tools">Tools</v-tab>
                        <v-tab value="context">Context</v-tab>
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
                                            :hint="agentIdError || 'Auto-generated from name, but you can customize it'"
                                            persistent-hint
                                            :error="!!agentIdError"
                                            :loading="agentIdValidating"
                                            :append-inner-icon="agentIdValid && !agentIdValidating && (newAgentForm.agentId || previewAgentId) ? 'mdi-check-circle' : undefined"
                                            @update:model-value="debouncedValidateAgentId($event || previewAgentId)"
                                        >
                                            <template #append>
                                                <HelpTooltip
                                                    text="A unique identifier for this agent. Used for API calls and SDK integration."
                                                    docLink="http://mxf.dev/sdk/agents.html#agent-id"
                                                />
                                            </template>
                                        </v-text-field>
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
                                                { label: 'Conversation', value: 'conversation' },
                                                { label: 'Assistant', value: 'assistant' },
                                                { label: 'Analyzer', value: 'analyzer' },
                                                { label: 'Moderator', value: 'moderator' },
                                                { label: 'Specialist', value: 'specialist' },
                                                { label: 'Custom', value: 'custom' }
                                            ]"
                                            item-title="label"
                                            item-value="value"
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
                                        >
                                            <template #append>
                                                <HelpTooltip
                                                    text="The system prompt defines the agent's base behavior and personality. It's sent at the start of every conversation."
                                                    docLink="http://mxf.dev/sdk/agents.html#system-prompt"
                                                />
                                            </template>
                                        </v-textarea>
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
                                </v-row>
                            </v-container>
                        </v-tabs-window-item>

                        <!-- Tools Tab -->
                        <v-tabs-window-item value="tools">
                            <v-container>
                                <v-alert
                                    type="info"
                                    variant="tonal"
                                    density="compact"
                                    class="mb-4"
                                >
                                    <template #text>
                                        Select which MCP tools this agent can use. Leave all unchecked for unrestricted access.
                                    </template>
                                </v-alert>

                                <!-- Quick Actions -->
                                <div class="d-flex gap-2 mb-4">
                                    <v-btn
                                        size="small"
                                        variant="tonal"
                                        prepend-icon="mdi-check-all"
                                        @click="selectAllCoreTools"
                                    >
                                        Select Core Tools
                                    </v-btn>
                                    <v-btn
                                        size="small"
                                        variant="tonal"
                                        prepend-icon="mdi-select-all"
                                        @click="selectAllTools"
                                    >
                                        Select All
                                    </v-btn>
                                    <v-btn
                                        size="small"
                                        variant="outlined"
                                        prepend-icon="mdi-close-circle-outline"
                                        @click="clearAllTools"
                                    >
                                        Clear All
                                    </v-btn>
                                </div>

                                <!-- Tools by Category -->
                                <v-expansion-panels variant="accordion" multiple>
                                    <!-- Core MXF Tools -->
                                    <v-expansion-panel>
                                        <v-expansion-panel-title>
                                            <div class="d-flex align-center">
                                                <v-icon class="mr-2" color="primary">mdi-star</v-icon>
                                                <span class="font-weight-medium">Core MXF Tools</span>
                                                <v-chip size="x-small" class="ml-2">{{ coreToolsSelected }}/{{ coreTools.length }}</v-chip>
                                            </div>
                                        </v-expansion-panel-title>
                                        <v-expansion-panel-text>
                                            <v-row dense>
                                                <v-col v-for="tool in coreTools" :key="tool" cols="12" sm="6">
                                                    <v-checkbox
                                                        v-model="newAgentForm.allowedTools"
                                                        :label="tool"
                                                        :value="tool"
                                                        density="compact"
                                                        hide-details
                                                    >
                                                        <template #label>
                                                            <div>
                                                                <span class="text-body-2">{{ tool }}</span>
                                                                <div class="text-caption text-medium-emphasis">{{ getToolDescription(tool) }}</div>
                                                            </div>
                                                        </template>
                                                    </v-checkbox>
                                                </v-col>
                                            </v-row>
                                        </v-expansion-panel-text>
                                    </v-expansion-panel>

                                    <!-- Communication Tools -->
                                    <v-expansion-panel>
                                        <v-expansion-panel-title>
                                            <div class="d-flex align-center">
                                                <v-icon class="mr-2" color="success">mdi-message</v-icon>
                                                <span class="font-weight-medium">Communication</span>
                                                <v-chip size="x-small" class="ml-2">{{ communicationToolsSelected }}/{{ communicationTools.length }}</v-chip>
                                            </div>
                                        </v-expansion-panel-title>
                                        <v-expansion-panel-text>
                                            <v-row dense>
                                                <v-col v-for="tool in communicationTools" :key="tool" cols="12" sm="6">
                                                    <v-checkbox
                                                        v-model="newAgentForm.allowedTools"
                                                        :label="tool"
                                                        :value="tool"
                                                        density="compact"
                                                        hide-details
                                                    >
                                                        <template #label>
                                                            <div>
                                                                <span class="text-body-2">{{ tool }}</span>
                                                                <div class="text-caption text-medium-emphasis">{{ getToolDescription(tool) }}</div>
                                                            </div>
                                                        </template>
                                                    </v-checkbox>
                                                </v-col>
                                            </v-row>
                                        </v-expansion-panel-text>
                                    </v-expansion-panel>

                                    <!-- Task Tools -->
                                    <v-expansion-panel>
                                        <v-expansion-panel-title>
                                            <div class="d-flex align-center">
                                                <v-icon class="mr-2" color="warning">mdi-checkbox-marked-circle</v-icon>
                                                <span class="font-weight-medium">Task Management</span>
                                                <v-chip size="x-small" class="ml-2">{{ taskToolsSelected }}/{{ taskTools.length }}</v-chip>
                                            </div>
                                        </v-expansion-panel-title>
                                        <v-expansion-panel-text>
                                            <v-row dense>
                                                <v-col v-for="tool in taskTools" :key="tool" cols="12" sm="6">
                                                    <v-checkbox
                                                        v-model="newAgentForm.allowedTools"
                                                        :label="tool"
                                                        :value="tool"
                                                        density="compact"
                                                        hide-details
                                                    >
                                                        <template #label>
                                                            <div>
                                                                <span class="text-body-2">{{ tool }}</span>
                                                                <div class="text-caption text-medium-emphasis">{{ getToolDescription(tool) }}</div>
                                                            </div>
                                                        </template>
                                                    </v-checkbox>
                                                </v-col>
                                            </v-row>
                                        </v-expansion-panel-text>
                                    </v-expansion-panel>

                                    <!-- Memory Tools -->
                                    <v-expansion-panel>
                                        <v-expansion-panel-title>
                                            <div class="d-flex align-center">
                                                <v-icon class="mr-2" color="info">mdi-brain</v-icon>
                                                <span class="font-weight-medium">Memory</span>
                                                <v-chip size="x-small" class="ml-2">{{ memoryToolsSelected }}/{{ memoryTools.length }}</v-chip>
                                            </div>
                                        </v-expansion-panel-title>
                                        <v-expansion-panel-text>
                                            <v-row dense>
                                                <v-col v-for="tool in memoryTools" :key="tool" cols="12" sm="6">
                                                    <v-checkbox
                                                        v-model="newAgentForm.allowedTools"
                                                        :label="tool"
                                                        :value="tool"
                                                        density="compact"
                                                        hide-details
                                                    >
                                                        <template #label>
                                                            <div>
                                                                <span class="text-body-2">{{ tool }}</span>
                                                                <div class="text-caption text-medium-emphasis">{{ getToolDescription(tool) }}</div>
                                                            </div>
                                                        </template>
                                                    </v-checkbox>
                                                </v-col>
                                            </v-row>
                                        </v-expansion-panel-text>
                                    </v-expansion-panel>

                                    <!-- Other Tools -->
                                    <v-expansion-panel v-if="otherTools.length > 0">
                                        <v-expansion-panel-title>
                                            <div class="d-flex align-center">
                                                <v-icon class="mr-2">mdi-tools</v-icon>
                                                <span class="font-weight-medium">Other Tools</span>
                                                <v-chip size="x-small" class="ml-2">{{ otherToolsSelected }}/{{ otherTools.length }}</v-chip>
                                            </div>
                                        </v-expansion-panel-title>
                                        <v-expansion-panel-text>
                                            <v-row dense>
                                                <v-col v-for="tool in otherTools" :key="tool" cols="12" sm="6">
                                                    <v-checkbox
                                                        v-model="newAgentForm.allowedTools"
                                                        :label="tool"
                                                        :value="tool"
                                                        density="compact"
                                                        hide-details
                                                    >
                                                        <template #label>
                                                            <div>
                                                                <span class="text-body-2">{{ tool }}</span>
                                                                <div class="text-caption text-medium-emphasis">{{ getToolDescription(tool) }}</div>
                                                            </div>
                                                        </template>
                                                    </v-checkbox>
                                                </v-col>
                                            </v-row>
                                        </v-expansion-panel-text>
                                    </v-expansion-panel>
                                </v-expansion-panels>

                                <!-- Selected Tools Summary -->
                                <div v-if="newAgentForm.allowedTools.length > 0" class="mt-4">
                                    <v-divider class="mb-3" />
                                    <div class="d-flex align-center mb-2">
                                        <span class="text-body-2 font-weight-medium">Selected Tools ({{ newAgentForm.allowedTools.length }})</span>
                                    </div>
                                    <div class="d-flex flex-wrap gap-1">
                                        <v-chip
                                            v-for="tool in newAgentForm.allowedTools"
                                            :key="tool"
                                            size="small"
                                            closable
                                            @click:close="removeSelectedTool(tool)"
                                        >
                                            {{ tool }}
                                        </v-chip>
                                    </div>
                                </div>
                            </v-container>
                        </v-tabs-window-item>

                        <!-- Context Tab -->
                        <v-tabs-window-item value="context">
                            <v-container>
                                <v-alert
                                    type="info"
                                    variant="tonal"
                                    density="compact"
                                    class="mb-4"
                                >
                                    <template #text>
                                        Define the agent's identity and behavioral context.
                                        This information guides the agent's responses and interactions.
                                    </template>
                                </v-alert>
                                <v-row>
                                    <v-col cols="12">
                                        <v-textarea
                                            v-model="newAgentForm.context.identity"
                                            label="Identity"
                                            variant="outlined"
                                            rows="3"
                                            hint="Describe who the agent is (e.g., 'You are a helpful research assistant specializing in data analysis')"
                                            persistent-hint
                                        />
                                    </v-col>
                                    <v-col cols="12">
                                        <v-textarea
                                            v-model="newAgentForm.context.instructions"
                                            label="Instructions"
                                            variant="outlined"
                                            rows="4"
                                            hint="Detailed instructions for how the agent should behave and respond"
                                            persistent-hint
                                        />
                                    </v-col>
                                    <v-col cols="12">
                                        <v-combobox
                                            v-model="newAgentForm.context.constraints"
                                            label="Constraints"
                                            variant="outlined"
                                            multiple
                                            chips
                                            closable-chips
                                            hint="Rules and limitations the agent must follow (e.g., 'Always cite sources', 'Never share personal data')"
                                            persistent-hint
                                        />
                                    </v-col>
                                    <v-col cols="12">
                                        <v-combobox
                                            v-model="newAgentForm.context.examples"
                                            label="Example Behaviors"
                                            variant="outlined"
                                            multiple
                                            chips
                                            closable-chips
                                            hint="Example interactions or behaviors to guide the agent (e.g., 'When asked about X, respond with Y format')"
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
                        :disabled="!newAgentForm.agentId || !newAgentForm.name || !newAgentForm.defaultModel || !agentIdValid || agentIdValidating"
                    >
                        Create Agent
                    </v-btn>
                </v-card-actions>
            </v-card>
        </v-dialog>

        <!-- Edit Agent Dialog (kept as v-card for dialog overlay) -->
        <v-dialog v-model="editAgentDialog" max-width="800px" persistent>
            <v-card>
                <v-card-title class="text-h5">Edit Agent</v-card-title>
                <v-card-text>
                    <v-tabs v-model="editCurrentTab" bg-color="transparent">
                        <v-tab value="basic">Basic Info</v-tab>
                        <v-tab value="capabilities">Capabilities</v-tab>
                        <v-tab value="tools">Tools</v-tab>
                        <v-tab value="context">Context</v-tab>
                    </v-tabs>

                    <v-divider class="my-4" />

                    <v-tabs-window v-model="editCurrentTab">
                        <!-- Basic Info Tab -->
                        <v-tabs-window-item value="basic">
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
                                </v-row>
                            </v-container>
                        </v-tabs-window-item>

                        <!-- Capabilities Tab -->
                        <v-tabs-window-item value="capabilities">
                            <v-container>
                                <v-row>
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
                                </v-row>
                            </v-container>
                        </v-tabs-window-item>

                        <!-- Tools Tab -->
                        <v-tabs-window-item value="tools">
                            <v-container>
                                <v-alert
                                    type="info"
                                    variant="tonal"
                                    density="compact"
                                    class="mb-4"
                                >
                                    <template #text>
                                        Select which MCP tools this agent can use. Leave all unchecked for unrestricted access.
                                    </template>
                                </v-alert>

                                <!-- Quick Actions -->
                                <div class="d-flex gap-2 mb-4">
                                    <v-btn
                                        size="small"
                                        variant="tonal"
                                        prepend-icon="mdi-check-all"
                                        @click="selectAllCoreToolsEdit"
                                    >
                                        Select Core Tools
                                    </v-btn>
                                    <v-btn
                                        size="small"
                                        variant="tonal"
                                        prepend-icon="mdi-select-all"
                                        @click="selectAllToolsEdit"
                                    >
                                        Select All
                                    </v-btn>
                                    <v-btn
                                        size="small"
                                        variant="outlined"
                                        prepend-icon="mdi-close-circle-outline"
                                        @click="clearAllToolsEdit"
                                    >
                                        Clear All
                                    </v-btn>
                                </div>

                                <!-- Tools by Category -->
                                <v-expansion-panels variant="accordion" multiple>
                                    <!-- Core MXF Tools -->
                                    <v-expansion-panel>
                                        <v-expansion-panel-title>
                                            <div class="d-flex align-center">
                                                <v-icon class="mr-2" color="primary">mdi-star</v-icon>
                                                <span class="font-weight-medium">Core MXF Tools</span>
                                                <v-chip size="x-small" class="ml-2">{{ editCoreToolsSelected }}/{{ coreTools.length }}</v-chip>
                                            </div>
                                        </v-expansion-panel-title>
                                        <v-expansion-panel-text>
                                            <v-row dense>
                                                <v-col v-for="tool in coreTools" :key="tool" cols="12" sm="6">
                                                    <v-checkbox
                                                        v-model="editAgentForm.allowedTools"
                                                        :label="tool"
                                                        :value="tool"
                                                        density="compact"
                                                        hide-details
                                                    >
                                                        <template #label>
                                                            <div>
                                                                <span class="text-body-2">{{ tool }}</span>
                                                                <div class="text-caption text-medium-emphasis">{{ getToolDescription(tool) }}</div>
                                                            </div>
                                                        </template>
                                                    </v-checkbox>
                                                </v-col>
                                            </v-row>
                                        </v-expansion-panel-text>
                                    </v-expansion-panel>

                                    <!-- Communication Tools -->
                                    <v-expansion-panel>
                                        <v-expansion-panel-title>
                                            <div class="d-flex align-center">
                                                <v-icon class="mr-2" color="success">mdi-message</v-icon>
                                                <span class="font-weight-medium">Communication</span>
                                                <v-chip size="x-small" class="ml-2">{{ editCommunicationToolsSelected }}/{{ communicationTools.length }}</v-chip>
                                            </div>
                                        </v-expansion-panel-title>
                                        <v-expansion-panel-text>
                                            <v-row dense>
                                                <v-col v-for="tool in communicationTools" :key="tool" cols="12" sm="6">
                                                    <v-checkbox
                                                        v-model="editAgentForm.allowedTools"
                                                        :label="tool"
                                                        :value="tool"
                                                        density="compact"
                                                        hide-details
                                                    >
                                                        <template #label>
                                                            <div>
                                                                <span class="text-body-2">{{ tool }}</span>
                                                                <div class="text-caption text-medium-emphasis">{{ getToolDescription(tool) }}</div>
                                                            </div>
                                                        </template>
                                                    </v-checkbox>
                                                </v-col>
                                            </v-row>
                                        </v-expansion-panel-text>
                                    </v-expansion-panel>

                                    <!-- Task Tools -->
                                    <v-expansion-panel>
                                        <v-expansion-panel-title>
                                            <div class="d-flex align-center">
                                                <v-icon class="mr-2" color="warning">mdi-checkbox-marked-circle</v-icon>
                                                <span class="font-weight-medium">Task Management</span>
                                                <v-chip size="x-small" class="ml-2">{{ editTaskToolsSelected }}/{{ taskTools.length }}</v-chip>
                                            </div>
                                        </v-expansion-panel-title>
                                        <v-expansion-panel-text>
                                            <v-row dense>
                                                <v-col v-for="tool in taskTools" :key="tool" cols="12" sm="6">
                                                    <v-checkbox
                                                        v-model="editAgentForm.allowedTools"
                                                        :label="tool"
                                                        :value="tool"
                                                        density="compact"
                                                        hide-details
                                                    >
                                                        <template #label>
                                                            <div>
                                                                <span class="text-body-2">{{ tool }}</span>
                                                                <div class="text-caption text-medium-emphasis">{{ getToolDescription(tool) }}</div>
                                                            </div>
                                                        </template>
                                                    </v-checkbox>
                                                </v-col>
                                            </v-row>
                                        </v-expansion-panel-text>
                                    </v-expansion-panel>

                                    <!-- Memory Tools -->
                                    <v-expansion-panel>
                                        <v-expansion-panel-title>
                                            <div class="d-flex align-center">
                                                <v-icon class="mr-2" color="info">mdi-brain</v-icon>
                                                <span class="font-weight-medium">Memory</span>
                                                <v-chip size="x-small" class="ml-2">{{ editMemoryToolsSelected }}/{{ memoryTools.length }}</v-chip>
                                            </div>
                                        </v-expansion-panel-title>
                                        <v-expansion-panel-text>
                                            <v-row dense>
                                                <v-col v-for="tool in memoryTools" :key="tool" cols="12" sm="6">
                                                    <v-checkbox
                                                        v-model="editAgentForm.allowedTools"
                                                        :label="tool"
                                                        :value="tool"
                                                        density="compact"
                                                        hide-details
                                                    >
                                                        <template #label>
                                                            <div>
                                                                <span class="text-body-2">{{ tool }}</span>
                                                                <div class="text-caption text-medium-emphasis">{{ getToolDescription(tool) }}</div>
                                                            </div>
                                                        </template>
                                                    </v-checkbox>
                                                </v-col>
                                            </v-row>
                                        </v-expansion-panel-text>
                                    </v-expansion-panel>
                                </v-expansion-panels>

                                <!-- Selected Tools Summary -->
                                <div v-if="editAgentForm.allowedTools.length > 0" class="mt-4">
                                    <v-divider class="mb-3" />
                                    <div class="d-flex align-center mb-2">
                                        <span class="text-body-2 font-weight-medium">Selected Tools ({{ editAgentForm.allowedTools.length }})</span>
                                    </div>
                                    <div class="d-flex flex-wrap gap-1">
                                        <v-chip
                                            v-for="tool in editAgentForm.allowedTools"
                                            :key="tool"
                                            size="small"
                                            closable
                                            @click:close="removeSelectedToolEdit(tool)"
                                        >
                                            {{ tool }}
                                        </v-chip>
                                    </div>
                                </div>
                            </v-container>
                        </v-tabs-window-item>

                        <!-- Context Tab -->
                        <v-tabs-window-item value="context">
                            <v-container>
                                <v-alert
                                    type="info"
                                    variant="tonal"
                                    density="compact"
                                    class="mb-4"
                                >
                                    <template #text>
                                        Define the agent's identity and behavioral context.
                                        This information guides the agent's responses and interactions.
                                    </template>
                                </v-alert>
                                <v-row>
                                    <v-col cols="12">
                                        <v-textarea
                                            v-model="editAgentForm.context.identity"
                                            label="Identity"
                                            variant="outlined"
                                            rows="3"
                                            hint="Describe who the agent is (e.g., 'You are a helpful research assistant specializing in data analysis')"
                                            persistent-hint
                                        />
                                    </v-col>
                                    <v-col cols="12">
                                        <v-textarea
                                            v-model="editAgentForm.context.instructions"
                                            label="Instructions"
                                            variant="outlined"
                                            rows="4"
                                            hint="Detailed instructions for how the agent should behave and respond"
                                            persistent-hint
                                        />
                                    </v-col>
                                    <v-col cols="12">
                                        <v-combobox
                                            v-model="editAgentForm.context.constraints"
                                            label="Constraints"
                                            variant="outlined"
                                            multiple
                                            chips
                                            closable-chips
                                            hint="Rules and limitations the agent must follow"
                                            persistent-hint
                                        />
                                    </v-col>
                                    <v-col cols="12">
                                        <v-combobox
                                            v-model="editAgentForm.context.examples"
                                            label="Example Behaviors"
                                            variant="outlined"
                                            multiple
                                            chips
                                            closable-chips
                                            hint="Example interactions or behaviors to guide the agent"
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

        <!-- Agent Metrics Dialog (kept as v-card for dialog overlay) -->
        <v-dialog v-model="metricsDialog" max-width="500px">
            <v-card>
                <v-card-title class="d-flex align-center">
                    <v-icon class="mr-2" color="info">mdi-chart-box</v-icon>
                    Agent Metrics
                </v-card-title>
                <v-card-subtitle v-if="metricsAgent" class="pb-0">
                    {{ metricsAgent.name }}
                </v-card-subtitle>
                <v-card-text>
                    <div v-if="metricsLoading" class="text-center pa-4">
                        <v-progress-circular indeterminate color="primary" />
                    </div>
                    <div v-else-if="metricsData">
                        <v-list density="compact">
                            <v-list-item>
                                <template #prepend>
                                    <v-icon color="primary">mdi-circle-outline</v-icon>
                                </template>
                                <v-list-item-title>Status</v-list-item-title>
                                <template #append>
                                    <v-chip
                                        :color="getStatusColor(metricsData.status)"
                                        size="small"
                                        variant="tonal"
                                    >
                                        {{ metricsData.status }}
                                    </v-chip>
                                </template>
                            </v-list-item>
                            <v-list-item>
                                <template #prepend>
                                    <v-icon color="success">mdi-clock-outline</v-icon>
                                </template>
                                <v-list-item-title>Uptime</v-list-item-title>
                                <template #append>
                                    <span class="text-body-2">{{ formatUptime(metricsData.uptime) }}</span>
                                </template>
                            </v-list-item>
                            <v-list-item>
                                <template #prepend>
                                    <v-icon color="info">mdi-checkbox-marked-circle-outline</v-icon>
                                </template>
                                <v-list-item-title>Total Tasks</v-list-item-title>
                                <template #append>
                                    <span class="text-body-2">{{ metricsData.totalTasks }}</span>
                                </template>
                            </v-list-item>
                            <v-list-item>
                                <template #prepend>
                                    <v-icon color="success">mdi-check-circle</v-icon>
                                </template>
                                <v-list-item-title>Completed Tasks</v-list-item-title>
                                <template #append>
                                    <span class="text-body-2">{{ metricsData.completedTasks }}</span>
                                </template>
                            </v-list-item>
                            <v-list-item>
                                <template #prepend>
                                    <v-icon color="error">mdi-alert-circle</v-icon>
                                </template>
                                <v-list-item-title>Failed Tasks</v-list-item-title>
                                <template #append>
                                    <span class="text-body-2">{{ metricsData.failedTasks }}</span>
                                </template>
                            </v-list-item>
                            <v-list-item>
                                <template #prepend>
                                    <v-icon color="warning">mdi-speedometer</v-icon>
                                </template>
                                <v-list-item-title>Avg Response Time</v-list-item-title>
                                <template #append>
                                    <span class="text-body-2">{{ metricsData.avgResponseTime }}ms</span>
                                </template>
                            </v-list-item>
                            <v-list-item>
                                <template #prepend>
                                    <v-icon color="primary">mdi-percent</v-icon>
                                </template>
                                <v-list-item-title>Success Rate</v-list-item-title>
                                <template #append>
                                    <span class="text-body-2">{{ metricsData.successRate }}%</span>
                                </template>
                            </v-list-item>
                        </v-list>
                    </div>
                </v-card-text>
                <v-card-actions>
                    <v-spacer />
                    <v-btn variant="text" @click="metricsDialog = false">Close</v-btn>
                </v-card-actions>
            </v-card>
        </v-dialog>

        <!-- Confirm Action Dialog (kept as v-card for dialog overlay) -->
        <v-dialog v-model="confirmDialog" max-width="400px">
            <v-card v-if="confirmAction">
                <v-card-title class="d-flex align-center">
                    <v-icon class="mr-2" color="warning">mdi-alert</v-icon>
                    {{ confirmAction.title }}
                </v-card-title>
                <v-card-text>{{ confirmAction.message }}</v-card-text>
                <v-card-actions>
                    <v-spacer />
                    <v-btn
                        variant="text"
                        @click="confirmDialog = false; confirmAction = null"
                    >
                        Cancel
                    </v-btn>
                    <v-btn
                        color="error"
                        variant="elevated"
                        @click="executeConfirmAction"
                    >
                        Confirm
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
/* ════════════════════════════════════════════
   MXF Channel Agents — Design System
   BEM prefix: ch-agents__
   ════════════════════════════════════════════ */

.ch-agents {
    --ch-blue: #4A90C2;
    --ch-green: #10B981;
    --ch-amber: #F59E0B;
    --ch-cyan: #22D3EE;
    --ch-red: #EF4444;
    max-width: 1200px;
    margin: 0 auto;
}

/* ── Header Strip ─────────────────────── */
.ch-agents__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 0 var(--space-4);
    border-bottom: 1px solid var(--border-subtle);
    margin-bottom: var(--space-4);
}

.ch-agents__header-left {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    flex-wrap: wrap;
}

.ch-agents__header-title {
    font-size: var(--text-lg);
    font-weight: 600;
    color: var(--text-primary);
    letter-spacing: -0.01em;
    margin: 0;
}

.ch-agents__header-divider {
    color: var(--text-muted);
    opacity: 0.4;
    font-weight: 300;
}

.ch-agents__header-sub {
    font-size: var(--text-sm);
    color: var(--text-muted);
}

.ch-agents__header-actions {
    display: flex;
    align-items: center;
    gap: var(--space-2);
}

/* ── Buttons ──────────────────────────── */
.ch-agents__btn {
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

.ch-agents__btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}

.ch-agents__btn--ghost {
    background: transparent;
    border-color: var(--border-default);
    color: var(--text-secondary);
}

.ch-agents__btn--ghost:hover:not(:disabled) {
    color: var(--text-primary);
    border-color: var(--ch-blue);
    background: rgba(74, 144, 194, 0.08);
}

.ch-agents__btn--primary {
    background: var(--ch-blue);
    color: #fff;
    border-color: var(--ch-blue);
}

.ch-agents__btn--primary:hover:not(:disabled) {
    background: #3a7db0;
    box-shadow: 0 2px 8px rgba(74, 144, 194, 0.3);
}

/* ── Metrics Grid ─────────────────────── */
.ch-agents__metrics {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: var(--space-3);
    margin-bottom: var(--space-4);
}

.ch-agents__metric {
    position: relative;
    padding: var(--space-3) var(--space-4);
    background: var(--bg-base);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-lg);
    transition: all var(--transition-base);
    overflow: hidden;
}

/* Left accent stripe via ::before */
.ch-agents__metric::before {
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

.ch-agents__metric[data-accent="blue"]::before  { background: var(--ch-blue); }
.ch-agents__metric[data-accent="green"]::before { background: var(--ch-green); }
.ch-agents__metric[data-accent="amber"]::before { background: var(--ch-amber); }
.ch-agents__metric[data-accent="red"]::before   { background: var(--ch-red); }

.ch-agents__metric:hover {
    border-color: var(--border-default);
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
}

.ch-agents__metric:hover::before {
    opacity: 1;
}

.ch-agents__metric-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: var(--space-1);
}

.ch-agents__metric-label {
    font-size: var(--text-xs);
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
}

.ch-agents__metric-ico {
    color: var(--text-muted);
    opacity: 0.5;
}

.ch-agents__metric-number {
    font-family: var(--font-mono);
    font-size: 1.5rem;
    font-weight: 700;
    color: var(--text-primary);
    line-height: 1;
    letter-spacing: -0.02em;
}

/* ── Filters Card ─────────────────────── */
.ch-agents__filters {
    background: var(--bg-base);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-lg);
    overflow: hidden;
    margin-bottom: var(--space-4);
    transition: border-color var(--transition-base);
}

.ch-agents__filters:hover {
    border-color: var(--border-default);
}

.ch-agents__filters-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-4) var(--space-5);
    border-bottom: 1px solid var(--border-subtle);
}

.ch-agents__filters-title {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--text-primary);
}

.ch-agents__filters-body {
    padding: var(--space-5);
}

/* ── Agents Grid ─────────────────────── */
.ch-agents__grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: var(--space-4);
}

/* ── Agent Card ──────────────────────── */
.ch-agents__card {
    position: relative;
    background: var(--bg-base);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-lg);
    overflow: hidden;
    transition: all var(--transition-base);
    display: flex;
    flex-direction: column;
}

/* Top accent stripe, visible on hover */
.ch-agents__card::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 3px;
    background: linear-gradient(90deg, var(--primary-500), var(--accent-500));
    opacity: 0;
    transition: opacity var(--transition-base);
}

.ch-agents__card:hover {
    border-color: var(--border-default);
    transform: translateY(-3px);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12), 0 0 30px rgba(74, 144, 194, 0.08);
}

.ch-agents__card:hover::before {
    opacity: 1;
}

/* Card header — avatar, name, status, menu */
.ch-agents__card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-4) var(--space-5);
    border-bottom: 1px solid var(--border-subtle);
}

.ch-agents__card-identity {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-width: 0;
}

.ch-agents__card-avatar {
    flex-shrink: 0;
}

.ch-agents__card-name {
    font-size: var(--text-base);
    font-weight: 600;
    color: var(--text-primary);
    line-height: 1.3;
    margin-bottom: var(--space-1);
}

/* Card body */
.ch-agents__card-body {
    padding: var(--space-4) var(--space-5);
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
}

/* Agent details (type, description, version, activity) */
.ch-agents__card-details {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}

.ch-agents__card-detail {
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-size: var(--text-sm);
    color: var(--text-secondary);
}

.ch-agents__card-detail-label {
    color: var(--text-muted);
    font-weight: 500;
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: 0.04em;
}

.ch-agents__card-detail-mono {
    font-family: var(--font-mono);
}

/* Mini metrics row (tasks completed, avg response) */
.ch-agents__mini-metrics {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-3);
}

.ch-agents__mini-metric {
    text-align: center;
    padding: var(--space-3);
    background: var(--bg-elevated);
    border-radius: var(--radius-md);
    border: 1px solid var(--border-subtle);
}

.ch-agents__mini-metric-val {
    font-size: var(--text-lg);
    font-weight: 700;
    color: var(--text-primary);
    font-family: var(--font-mono);
    line-height: 1.2;
}

.ch-agents__mini-metric-label {
    font-size: var(--text-xs);
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin-top: var(--space-1);
}

/* Performance bar */
.ch-agents__card-perf {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}

.ch-agents__card-perf-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
}

.ch-agents__card-perf-label {
    font-size: var(--text-sm);
    font-weight: 500;
    color: var(--text-secondary);
}

.ch-agents__card-perf :deep(.v-progress-linear) {
    border-radius: var(--radius-full);
    background: var(--bg-elevated);
}

/* Section labels within cards */
.ch-agents__section-label {
    font-size: var(--text-xs);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
    margin-bottom: var(--space-2);
}

/* Chip wrapping container */
.ch-agents__chip-wrap {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
}

/* Service types and capabilities sections */
.ch-agents__card-services,
.ch-agents__card-caps {
    display: flex;
    flex-direction: column;
}

/* ── Empty State ──────────────────────── */
.ch-agents__empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: var(--space-12) var(--space-4);
    text-align: center;
}

.ch-agents__empty-icon {
    color: var(--text-muted);
    opacity: 0.3;
}

.ch-agents__empty-title {
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--text-secondary);
    margin: var(--space-3) 0 var(--space-1);
}

.ch-agents__empty-sub {
    font-size: var(--text-xs);
    color: var(--text-muted);
    margin: 0 0 var(--space-4);
    max-width: 400px;
    line-height: 1.5;
}

/* ── Dialog Tab Styling ───────────────── */
.ch-agents :deep(.v-dialog .v-tabs .v-tab) {
    font-size: var(--text-sm);
    min-width: 100px;
}

.ch-agents :deep(.v-dialog .v-tabs .v-tab--selected) {
    color: var(--primary-500);
    font-weight: 600;
}

/* ── Responsive ───────────────────────── */
@media (max-width: 768px) {
    .ch-agents__header {
        flex-direction: column;
        align-items: flex-start;
        gap: var(--space-2);
    }

    .ch-agents__header-actions {
        align-self: flex-end;
    }

    .ch-agents__metrics {
        grid-template-columns: repeat(2, 1fr);
    }

    .ch-agents__grid {
        grid-template-columns: 1fr;
    }

    .ch-agents__card-header {
        padding: var(--space-3) var(--space-4);
    }

    .ch-agents__card-body {
        padding: var(--space-3) var(--space-4);
    }
}

@media (max-width: 480px) {
    .ch-agents__metrics {
        grid-template-columns: 1fr;
    }

    .ch-agents__metric-number {
        font-size: var(--text-xl);
    }

    .ch-agents__header-actions {
        flex-direction: column;
        width: 100%;
    }

    .ch-agents__btn {
        width: 100%;
        justify-content: center;
    }
}
</style>
