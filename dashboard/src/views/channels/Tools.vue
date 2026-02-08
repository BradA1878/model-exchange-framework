<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { useToolsStore } from '@/stores/tools';
import { useChannelsStore } from '@/stores/channels';
import HelpTooltip from '@/components/HelpTooltip.vue';
import type { McpTool, McpServerStatus, McpServerRegisterConfig } from '@/stores/tools';

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
const toolsStore = useToolsStore();
const channelsStore = useChannelsStore();

// Computed from store - Tools
const tools = computed(() => toolsStore.tools);
const toolStats = computed(() => toolsStore.toolStats);
const loading = computed(() => toolsStore.loading);
const storeCategories = computed(() => toolsStore.categories);

// Computed from store - MCP Servers
const mcpServers = computed(() => toolsStore.mcpServers);
const serverStats = computed(() => toolsStore.serverStats);
const serversLoading = computed(() => toolsStore.serversLoading);
const serverActionLoading = computed(() => toolsStore.serverActionLoading);

// Filters and sorting
const searchQuery = ref('');
const selectedCategory = ref('all');
const selectedType = ref('all');
const sortBy = ref('name');

// Schema dialog state
const schemaDialog = ref(false);
const schemaToolName = ref('');
const schemaContent = ref('');

// MCP Servers section state
const serversExpanded = ref(true);
const serverDetailsDialog = ref(false);
const selectedServer = ref<McpServerStatus | null>(null);
const registerServerDialog = ref(false);
const confirmUnregisterDialog = ref(false);
const serverToUnregister = ref<McpServerStatus | null>(null);

// Register server form
const newServerForm = ref<McpServerRegisterConfig>({
    id: '',
    name: '',
    transport: 'stdio',
    command: '',
    args: [],
    url: '',
    autoStart: true
});
const argsInput = ref('');

// Snackbar
const snackbar = ref(false);
const snackbarText = ref('');
const snackbarColor = ref('success');

// Channel Tool Permissions state
const toolPermissionsExpanded = ref(true);
const channelAllowedTools = ref<string[]>([]);
const savingToolPermissions = ref(false);
const hasToolPermissionChanges = ref(false);
const enableToolRestrictions = ref(false);

// Dynamic category filter items built from API data
const categoryItems = computed(() => {
    const items = [{ title: 'All Categories', value: 'all' }];
    for (const cat of storeCategories.value) {
        items.push({
            title: cat.charAt(0).toUpperCase() + cat.slice(1).replace(/_/g, ' '),
            value: cat
        });
    }
    return items;
});

// Filtered tools
const filteredTools = computed(() => {
    let filtered = tools.value.filter((tool: McpTool) => {
        const matchesSearch = !searchQuery.value ||
            tool.name.toLowerCase().includes(searchQuery.value.toLowerCase()) ||
            tool.description.toLowerCase().includes(searchQuery.value.toLowerCase());

        const matchesCategory = selectedCategory.value === 'all' || tool.category === selectedCategory.value;
        const matchesType = selectedType.value === 'all' || tool.type === selectedType.value;

        return matchesSearch && matchesCategory && matchesType;
    });

    // Sort tools by name
    if (sortBy.value === 'name') {
        filtered.sort((a, b) => a.name.localeCompare(b.name));
    } else if (sortBy.value === 'category') {
        filtered.sort((a, b) => a.category.localeCompare(b.category));
    }

    return filtered;
});

// Methods
const loadTools = async (): Promise<void> => {
    try {
        await toolsStore.fetchTools();
    } catch (err) {
        console.error('Failed to load tools:', err);
    }
};

const refreshTools = (): void => {
    loadTools();
};

const showSnackbar = (text: string, color: string = 'success'): void => {
    snackbarText.value = text;
    snackbarColor.value = color;
    snackbar.value = true;
};

const openSchemaDialog = (tool: McpTool): void => {
    schemaToolName.value = tool.name;
    schemaContent.value = tool.inputSchema
        ? JSON.stringify(tool.inputSchema, null, 2)
        : 'No input schema defined for this tool.';
    schemaDialog.value = true;
};

const copySchema = async (): Promise<void> => {
    try {
        await navigator.clipboard.writeText(schemaContent.value);
        showSnackbar('Schema copied to clipboard');
    } catch {
        showSnackbar('Failed to copy schema', 'error');
    }
};

const getCategoryColor = (category: string): string => {
    switch (category) {
        case 'communication': return 'primary';
        case 'task_management': return 'success';
        case 'task-management': return 'success';
        case 'discovery': return 'info';
        case 'memory': return 'warning';
        case 'analysis': return 'purple';
        case 'orpar': return 'deep-purple';
        case 'channel': return 'teal';
        case 'agent': return 'indigo';
        case 'development': return 'blue';
        case 'mcp': return 'cyan';
        default: return 'grey';
    }
};

const getTypeIcon = (type: string): string => {
    switch (type) {
        case 'external': return 'mdi-api';
        case 'internal': return 'mdi-cog';
        default: return 'mdi-wrench';
    }
};

// MCP Server methods
const loadServers = async (): Promise<void> => {
    try {
        await toolsStore.fetchMcpServers();
    } catch (err) {
        console.error('Failed to load MCP servers:', err);
    }
};

const refreshServers = (): void => {
    loadServers();
};

const toggleServer = async (server: McpServerStatus): Promise<void> => {
    if (server.status === 'running') {
        const success = await toolsStore.stopServer(server.id);
        if (success) {
            showSnackbar(`Server ${server.name} stopped`);
        } else {
            showSnackbar(`Failed to stop server ${server.name}`, 'error');
        }
    } else {
        const success = await toolsStore.startServer(server.id);
        if (success) {
            showSnackbar(`Server ${server.name} started`);
        } else {
            showSnackbar(`Failed to start server ${server.name}`, 'error');
        }
    }
};

const openServerDetails = (server: McpServerStatus): void => {
    selectedServer.value = server;
    serverDetailsDialog.value = true;
};

const openRegisterDialog = (): void => {
    // Reset form
    newServerForm.value = {
        id: '',
        name: '',
        transport: 'stdio',
        command: '',
        args: [],
        url: '',
        autoStart: true
    };
    argsInput.value = '';
    registerServerDialog.value = true;
};

const submitRegisterServer = async (): Promise<void> => {
    // Parse args from comma-separated input
    if (newServerForm.value.transport === 'stdio' && argsInput.value.trim()) {
        newServerForm.value.args = argsInput.value.split(',').map(s => s.trim()).filter(Boolean);
    }

    const success = await toolsStore.registerServer(newServerForm.value);
    if (success) {
        showSnackbar(`Server ${newServerForm.value.name} registered successfully`);
        registerServerDialog.value = false;
    } else {
        showSnackbar(`Failed to register server: ${toolsStore.serversError}`, 'error');
    }
};

const confirmUnregister = (server: McpServerStatus): void => {
    serverToUnregister.value = server;
    confirmUnregisterDialog.value = true;
};

const executeUnregister = async (): Promise<void> => {
    if (!serverToUnregister.value) return;

    const success = await toolsStore.unregisterServer(serverToUnregister.value.id);
    if (success) {
        showSnackbar(`Server ${serverToUnregister.value.name} unregistered`);
    } else {
        showSnackbar(`Failed to unregister server: ${toolsStore.serversError}`, 'error');
    }
    confirmUnregisterDialog.value = false;
    serverToUnregister.value = null;
};

const getServerStatusColor = (status: string): string => {
    switch (status) {
        case 'running': return 'success';
        case 'stopped': return 'grey';
        case 'starting': return 'info';
        case 'restarting': return 'warning';
        case 'error': return 'error';
        default: return 'grey';
    }
};

const getServerStatusIcon = (status: string): string => {
    switch (status) {
        case 'running': return 'mdi-check-circle';
        case 'stopped': return 'mdi-stop-circle';
        case 'starting': return 'mdi-loading';
        case 'restarting': return 'mdi-restart';
        case 'error': return 'mdi-alert-circle';
        default: return 'mdi-help-circle';
    }
};

const formatUptime = (ms?: number): string => {
    if (!ms) return 'N/A';
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}m`;
};

const isRegisterFormValid = computed(() => {
    if (!newServerForm.value.id || !newServerForm.value.name) return false;
    if (newServerForm.value.transport === 'stdio' && !newServerForm.value.command) return false;
    if (newServerForm.value.transport === 'http' && !newServerForm.value.url) return false;
    return true;
});

// Channel Tool Permissions methods

/**
 * Load channel tool permissions from the current channel
 */
const loadChannelToolPermissions = (): void => {
    const channel = channelsStore.selectedChannel;
    if (channel?.allowedTools && channel.allowedTools.length > 0) {
        channelAllowedTools.value = [...channel.allowedTools];
        enableToolRestrictions.value = true;
    } else {
        channelAllowedTools.value = [];
        enableToolRestrictions.value = false;
    }
    hasToolPermissionChanges.value = false;
};

/**
 * Check if a tool is allowed for the channel
 */
const isToolAllowed = (toolName: string): boolean => {
    // If restrictions not enabled, all tools are allowed
    if (!enableToolRestrictions.value) return true;
    return channelAllowedTools.value.includes(toolName);
};

/**
 * Toggle a tool's permission for the channel
 */
const toggleToolPermission = (toolName: string): void => {
    const index = channelAllowedTools.value.indexOf(toolName);
    if (index === -1) {
        channelAllowedTools.value.push(toolName);
    } else {
        channelAllowedTools.value.splice(index, 1);
    }
    hasToolPermissionChanges.value = true;
};

/**
 * Toggle tool restrictions on/off
 */
const toggleToolRestrictions = (): void => {
    enableToolRestrictions.value = !enableToolRestrictions.value;
    if (!enableToolRestrictions.value) {
        // When disabling, clear the allowed tools list
        channelAllowedTools.value = [];
    } else {
        // When enabling, start with all tools allowed
        channelAllowedTools.value = tools.value.map((t: McpTool) => t.name);
    }
    hasToolPermissionChanges.value = true;
};

/**
 * Select all tools
 */
const selectAllTools = (): void => {
    channelAllowedTools.value = tools.value.map((t: McpTool) => t.name);
    hasToolPermissionChanges.value = true;
};

/**
 * Deselect all tools
 */
const deselectAllTools = (): void => {
    channelAllowedTools.value = [];
    hasToolPermissionChanges.value = true;
};

/**
 * Save channel tool permissions
 */
const saveToolPermissions = async (): Promise<void> => {
    if (!props.channel?.id) {
        showSnackbar('No channel selected', 'error');
        return;
    }

    savingToolPermissions.value = true;
    try {
        // If restrictions are disabled, save empty array (no restrictions)
        const toolsToSave = enableToolRestrictions.value ? channelAllowedTools.value : [];
        const success = await channelsStore.updateChannelTools(props.channel.id, toolsToSave);
        if (success) {
            showSnackbar('Tool permissions saved successfully');
            hasToolPermissionChanges.value = false;
        } else {
            showSnackbar('Failed to save tool permissions', 'error');
        }
    } catch (error) {
        console.error('Failed to save tool permissions:', error);
        showSnackbar('Failed to save tool permissions', 'error');
    } finally {
        savingToolPermissions.value = false;
    }
};

/**
 * Reset tool permissions to last saved state
 */
const resetToolPermissions = (): void => {
    loadChannelToolPermissions();
};

/**
 * Get tools grouped by category for the permissions section
 */
const toolsByCategory = computed(() => {
    const grouped: Record<string, McpTool[]> = {};
    for (const tool of tools.value) {
        const category = tool.category || 'other';
        if (!grouped[category]) {
            grouped[category] = [];
        }
        grouped[category].push(tool);
    }
    // Sort tools within each category
    for (const category in grouped) {
        grouped[category].sort((a, b) => a.name.localeCompare(b.name));
    }
    return grouped;
});

/**
 * Count of allowed tools
 */
const allowedToolsCount = computed(() => {
    if (!enableToolRestrictions.value) return tools.value.length;
    return channelAllowedTools.value.length;
});

// Watch for channel changes — reload tools
watch(() => props.channel.id, () => {
    loadTools();
}, { immediate: false });

onMounted(() => {
    loadTools();
    loadServers();
    loadChannelToolPermissions();
});

// Watch for channel changes to reload tool permissions
watch(() => props.channel?.id, () => {
    loadChannelToolPermissions();
});
</script>

<template>
    <div class="ch-tools">
        <!-- Header Strip -->
        <header class="ch-tools__header">
            <div class="ch-tools__header-left">
                <h2 class="ch-tools__header-title">Tools</h2>
                <span class="ch-tools__header-divider">/</span>
                <span class="ch-tools__header-sub">{{ channel.name }}</span>
            </div>
            <div class="ch-tools__header-actions">
                <button class="ch-tools__btn ch-tools__btn--ghost" @click="refreshTools" :disabled="loading">
                    <v-icon size="14">mdi-refresh</v-icon>
                    <span>Refresh</span>
                </button>
            </div>
        </header>

        <!-- Summary Metrics Strip -->
        <section class="ch-tools__metrics">
            <div class="ch-tools__metric" data-accent="blue">
                <div class="ch-tools__metric-head">
                    <span class="ch-tools__metric-label">Total</span>
                    <v-icon size="13" class="ch-tools__metric-ico">mdi-wrench</v-icon>
                </div>
                <div class="ch-tools__metric-number">{{ toolStats.total }}</div>
            </div>
            <div class="ch-tools__metric" data-accent="green">
                <div class="ch-tools__metric-head">
                    <span class="ch-tools__metric-label">Active</span>
                    <v-icon size="13" class="ch-tools__metric-ico">mdi-check-circle-outline</v-icon>
                </div>
                <div class="ch-tools__metric-number">{{ toolStats.active }}</div>
            </div>
            <div class="ch-tools__metric" data-accent="red">
                <div class="ch-tools__metric-head">
                    <span class="ch-tools__metric-label">Disabled</span>
                    <v-icon size="13" class="ch-tools__metric-ico">mdi-close-circle-outline</v-icon>
                </div>
                <div class="ch-tools__metric-number">{{ toolStats.disabled }}</div>
            </div>
            <div class="ch-tools__metric" data-accent="cyan">
                <div class="ch-tools__metric-head">
                    <span class="ch-tools__metric-label">Internal</span>
                    <v-icon size="13" class="ch-tools__metric-ico">mdi-cog-outline</v-icon>
                </div>
                <div class="ch-tools__metric-number">{{ toolStats.internal }}</div>
            </div>
            <div class="ch-tools__metric" data-accent="amber">
                <div class="ch-tools__metric-head">
                    <span class="ch-tools__metric-label">External</span>
                    <v-icon size="13" class="ch-tools__metric-ico">mdi-api</v-icon>
                </div>
                <div class="ch-tools__metric-number">{{ toolStats.external }}</div>
            </div>
        </section>

        <!-- MCP Servers Section -->
        <div class="ch-tools__servers">
            <div class="ch-tools__servers-head">
                <div class="ch-tools__servers-title">
                    <v-icon size="16" color="primary">mdi-server-network</v-icon>
                    <span>MCP Servers</span>
                    <v-chip class="ml-2" size="small" color="primary" variant="tonal">
                        {{ serverStats.running }} / {{ serverStats.total }}
                    </v-chip>
                </div>
                <div class="ch-tools__servers-actions">
                    <button class="ch-tools__btn ch-tools__btn--primary" @click="openRegisterDialog">
                        <v-icon size="14">mdi-plus</v-icon>
                        <span>Register</span>
                    </button>
                    <button class="ch-tools__btn ch-tools__btn--ghost" @click="refreshServers" :disabled="serversLoading">
                        <v-icon size="14">mdi-refresh</v-icon>
                        <span>Refresh</span>
                    </button>
                    <button
                        class="ch-tools__btn ch-tools__btn--ghost"
                        @click="serversExpanded = !serversExpanded"
                    >
                        <v-icon size="14">{{ serversExpanded ? 'mdi-chevron-up' : 'mdi-chevron-down' }}</v-icon>
                    </button>
                </div>
            </div>

            <v-expand-transition>
                <div v-show="serversExpanded" class="ch-tools__servers-body">
                    <!-- Server stats metrics -->
                    <section class="ch-tools__server-metrics">
                        <div class="ch-tools__metric" data-accent="green">
                            <div class="ch-tools__metric-head">
                                <span class="ch-tools__metric-label">Running</span>
                                <v-icon size="13" class="ch-tools__metric-ico">mdi-check-circle</v-icon>
                            </div>
                            <div class="ch-tools__metric-number">{{ serverStats.running }}</div>
                        </div>
                        <div class="ch-tools__metric" data-accent="blue">
                            <div class="ch-tools__metric-head">
                                <span class="ch-tools__metric-label">Stopped</span>
                                <v-icon size="13" class="ch-tools__metric-ico">mdi-stop-circle</v-icon>
                            </div>
                            <div class="ch-tools__metric-number">{{ serverStats.stopped }}</div>
                        </div>
                        <div class="ch-tools__metric" data-accent="red">
                            <div class="ch-tools__metric-head">
                                <span class="ch-tools__metric-label">Error</span>
                                <v-icon size="13" class="ch-tools__metric-ico">mdi-alert-circle</v-icon>
                            </div>
                            <div class="ch-tools__metric-number">{{ serverStats.error }}</div>
                        </div>
                        <div class="ch-tools__metric" data-accent="cyan">
                            <div class="ch-tools__metric-head">
                                <span class="ch-tools__metric-label">Total Tools</span>
                                <v-icon size="13" class="ch-tools__metric-ico">mdi-wrench</v-icon>
                            </div>
                            <div class="ch-tools__metric-number">{{ serverStats.totalTools }}</div>
                        </div>
                    </section>

                    <!-- Loading state -->
                    <div v-if="serversLoading && mcpServers.length === 0" class="ch-tools__empty">
                        <v-progress-circular indeterminate color="primary" size="48" />
                        <p class="ch-tools__empty-title">Loading servers...</p>
                    </div>

                    <!-- Empty state -->
                    <div v-else-if="mcpServers.length === 0" class="ch-tools__empty">
                        <v-icon size="48" class="ch-tools__empty-icon">mdi-server-off</v-icon>
                        <p class="ch-tools__empty-title">No MCP servers registered</p>
                        <p class="ch-tools__empty-sub">Register a server to provide external tools</p>
                    </div>

                    <!-- Server list -->
                    <v-list v-else density="compact" class="ch-tools__server-list">
                        <v-list-item
                            v-for="server in mcpServers"
                            :key="server.id"
                            class="ch-tools__server-item mb-2"
                        >
                            <template #prepend>
                                <v-icon
                                    :color="getServerStatusColor(server.status)"
                                    :class="{ 'ch-tools__spin': server.status === 'starting' }"
                                >
                                    {{ getServerStatusIcon(server.status) }}
                                </v-icon>
                            </template>

                            <v-list-item-title class="d-flex align-center">
                                <span class="font-weight-medium">{{ server.name }}</span>
                                <v-chip
                                    class="ml-2"
                                    :color="getServerStatusColor(server.status)"
                                    size="x-small"
                                    variant="tonal"
                                >
                                    {{ server.status }}
                                </v-chip>
                                <v-chip
                                    class="ml-1"
                                    size="x-small"
                                    variant="outlined"
                                >
                                    {{ server.tools.length }} tools
                                </v-chip>
                            </v-list-item-title>

                            <v-list-item-subtitle>
                                <span class="ch-tools__mono">{{ server.id }}</span>
                                <span v-if="server.pid" class="ml-2">PID: {{ server.pid }}</span>
                                <span v-if="server.uptime" class="ml-2">Uptime: {{ formatUptime(server.uptime) }}</span>
                                <span v-if="server.lastError" class="ml-2 text-error">{{ server.lastError }}</span>
                            </v-list-item-subtitle>

                            <template #append>
                                <div class="d-flex align-center" style="gap: var(--space-1);">
                                    <v-btn
                                        :icon="server.status === 'running' ? 'mdi-stop' : 'mdi-play'"
                                        size="small"
                                        variant="text"
                                        :color="server.status === 'running' ? 'error' : 'success'"
                                        :loading="serverActionLoading[server.id]"
                                        :disabled="server.status === 'starting' || server.status === 'restarting'"
                                        @click.stop="toggleServer(server)"
                                    />
                                    <v-btn
                                        icon="mdi-information-outline"
                                        size="small"
                                        variant="text"
                                        @click.stop="openServerDetails(server)"
                                    />
                                    <v-btn
                                        icon="mdi-delete-outline"
                                        size="small"
                                        variant="text"
                                        color="error"
                                        :loading="serverActionLoading[server.id]"
                                        @click.stop="confirmUnregister(server)"
                                    />
                                </div>
                            </template>
                        </v-list-item>
                    </v-list>
                </div>
            </v-expand-transition>
        </div>

        <!-- Channel Tool Permissions Section -->
        <div class="ch-tools__permissions">
            <div class="ch-tools__permissions-head">
                <div class="ch-tools__permissions-title">
                    <v-icon size="16" color="warning">mdi-shield-check</v-icon>
                    <span>Channel Tool Permissions</span>
                    <v-chip class="ml-2" size="small" :color="enableToolRestrictions ? 'warning' : 'grey'" variant="tonal">
                        {{ enableToolRestrictions ? `${allowedToolsCount} / ${toolStats.total}` : 'No restrictions' }}
                    </v-chip>
                </div>
                <button
                    class="ch-tools__btn ch-tools__btn--ghost"
                    @click="toolPermissionsExpanded = !toolPermissionsExpanded"
                >
                    <v-icon size="14">{{ toolPermissionsExpanded ? 'mdi-chevron-up' : 'mdi-chevron-down' }}</v-icon>
                </button>
            </div>

            <v-expand-transition>
                <div v-show="toolPermissionsExpanded" class="ch-tools__permissions-body">
                    <!-- Info alert -->
                    <v-alert
                        type="info"
                        variant="tonal"
                        density="compact"
                        class="mb-4"
                    >
                        <template #text>
                            Control which tools agents can use in this channel.
                            When restrictions are enabled, agents can only use tools that appear in both
                            the channel's allowed list AND their own allowed tools list.
                        </template>
                    </v-alert>

                    <!-- Enable/Disable restrictions toggle -->
                    <div class="ch-tools__toggle-row">
                        <div>
                            <div class="text-body-1 font-weight-medium">Enable Tool Restrictions</div>
                            <div class="text-body-2 text-medium-emphasis">
                                {{ enableToolRestrictions ? 'Only selected tools are available to agents' : 'All tools are available to agents' }}
                            </div>
                        </div>
                        <v-switch
                            v-model="enableToolRestrictions"
                            color="warning"
                            hide-details
                            @update:model-value="toggleToolRestrictions"
                        />
                    </div>

                    <!-- Tool selection (only visible when restrictions enabled) -->
                    <v-expand-transition>
                        <div v-show="enableToolRestrictions">
                            <!-- Bulk actions -->
                            <div class="d-flex align-center mb-4" style="gap: var(--space-2);">
                                <button class="ch-tools__btn ch-tools__btn--ghost" @click="selectAllTools">
                                    <v-icon size="14">mdi-checkbox-multiple-marked</v-icon>
                                    <span>Select All</span>
                                </button>
                                <button class="ch-tools__btn ch-tools__btn--ghost" @click="deselectAllTools">
                                    <v-icon size="14">mdi-checkbox-multiple-blank-outline</v-icon>
                                    <span>Deselect All</span>
                                </button>
                                <v-spacer />
                                <span class="text-body-2 text-medium-emphasis">
                                    {{ allowedToolsCount }} of {{ toolStats.total }} tools selected
                                </span>
                            </div>

                            <!-- Tools grouped by category -->
                            <div v-for="(categoryTools, category) in toolsByCategory" :key="category" class="mb-4">
                                <div class="d-flex align-center mb-2">
                                    <v-chip
                                        :color="getCategoryColor(category as string)"
                                        size="small"
                                        variant="tonal"
                                        class="mr-2"
                                    >
                                        {{ (category as string).replace(/_/g, ' ') }}
                                    </v-chip>
                                    <span class="text-caption text-medium-emphasis">
                                        ({{ categoryTools.filter((t: McpTool) => isToolAllowed(t.name)).length }} / {{ categoryTools.length }})
                                    </span>
                                </div>
                                <div class="ch-tools__perm-grid">
                                    <v-checkbox
                                        v-for="tool in categoryTools"
                                        :key="tool.name"
                                        :model-value="isToolAllowed(tool.name)"
                                        :label="tool.name"
                                        density="compact"
                                        hide-details
                                        class="ch-tools__perm-checkbox"
                                        @update:model-value="toggleToolPermission(tool.name)"
                                    >
                                        <template #label>
                                            <div class="d-flex align-center">
                                                <span class="ch-tools__perm-name">{{ tool.name }}</span>
                                                <v-tooltip location="top">
                                                    <template #activator="{ props: tooltipProps }">
                                                        <v-icon
                                                            v-bind="tooltipProps"
                                                            size="14"
                                                            class="ml-1 text-medium-emphasis"
                                                        >
                                                            mdi-information-outline
                                                        </v-icon>
                                                    </template>
                                                    {{ tool.description }}
                                                </v-tooltip>
                                            </div>
                                        </template>
                                    </v-checkbox>
                                </div>
                            </div>
                        </div>
                    </v-expand-transition>

                    <!-- Save/Reset buttons -->
                    <div v-if="hasToolPermissionChanges" class="ch-tools__perm-actions">
                        <v-spacer />
                        <button class="ch-tools__btn ch-tools__btn--ghost" @click="resetToolPermissions">
                            Reset
                        </button>
                        <button
                            class="ch-tools__btn ch-tools__btn--primary"
                            :disabled="savingToolPermissions"
                            @click="saveToolPermissions"
                        >
                            <v-icon size="14">mdi-content-save</v-icon>
                            <span>Save Permissions</span>
                        </button>
                    </div>
                </div>
            </v-expand-transition>
        </div>

        <!-- Filters Card -->
        <div class="ch-tools__filters">
            <div class="ch-tools__filters-head">
                <div class="ch-tools__filters-title">
                    <v-icon size="16">mdi-filter-variant</v-icon>
                    <span>Filters</span>
                </div>
            </div>
            <div class="ch-tools__filters-body">
                <v-row>
                    <v-col cols="12" md="4">
                        <v-text-field
                            v-model="searchQuery"
                            label="Search tools..."
                            variant="outlined"
                            density="compact"
                            prepend-inner-icon="mdi-magnify"
                            clearable
                        />
                    </v-col>
                    <v-col cols="6" md="3">
                        <v-select
                            v-model="selectedCategory"
                            :items="categoryItems"
                            label="Category"
                            variant="outlined"
                            density="compact"
                        />
                    </v-col>
                    <v-col cols="6" md="3">
                        <v-select
                            v-model="selectedType"
                            :items="[
                                { title: 'All Types', value: 'all' },
                                { title: 'Internal', value: 'internal' },
                                { title: 'External', value: 'external' }
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
                                { title: 'Name', value: 'name' },
                                { title: 'Category', value: 'category' }
                            ]"
                            label="Sort By"
                            variant="outlined"
                            density="compact"
                        />
                    </v-col>
                </v-row>
            </div>
        </div>

        <!-- Tools List -->
        <div class="ch-tools__list">
            <!-- Loading state -->
            <div v-if="loading" class="ch-tools__empty">
                <v-progress-circular indeterminate color="primary" size="48" />
                <p class="ch-tools__empty-title">Loading tools...</p>
            </div>

            <!-- Empty state -->
            <div v-else-if="filteredTools.length === 0" class="ch-tools__empty">
                <v-icon size="48" class="ch-tools__empty-icon">mdi-wrench-outline</v-icon>
                <p class="ch-tools__empty-title">No tools found</p>
                <p class="ch-tools__empty-sub">Try adjusting your filters</p>
            </div>

            <!-- Tool cards -->
            <div
                v-for="tool in filteredTools"
                :key="tool.name"
                class="ch-tools__card"
            >
                <div class="ch-tools__card-body">
                    <div class="ch-tools__card-top">
                        <div class="ch-tools__card-head">
                            <div class="d-flex align-center mb-3">
                                <v-icon :color="getCategoryColor(tool.category)" class="mr-3" size="32">
                                    {{ getTypeIcon(tool.type) }}
                                </v-icon>
                                <div>
                                    <h3 class="ch-tools__card-title">{{ tool.name }}</h3>
                                    <div class="ch-tools__card-chips">
                                        <v-chip
                                            :color="getCategoryColor(tool.category)"
                                            size="small"
                                            variant="tonal"
                                        >
                                            {{ tool.category.replace(/_/g, ' ') }}
                                        </v-chip>
                                        <v-chip
                                            :color="tool.enabled ? 'success' : 'error'"
                                            size="small"
                                            variant="tonal"
                                        >
                                            {{ tool.enabled ? 'enabled' : 'disabled' }}
                                        </v-chip>
                                        <v-chip
                                            size="small"
                                            variant="outlined"
                                        >
                                            {{ tool.type }}
                                        </v-chip>
                                        <v-chip
                                            v-if="tool.scope !== 'global'"
                                            size="small"
                                            variant="outlined"
                                            color="info"
                                        >
                                            {{ tool.scope }}
                                        </v-chip>
                                    </div>
                                </div>
                            </div>

                            <p class="ch-tools__card-desc">{{ tool.description }}</p>

                            <div class="d-flex align-center" style="gap: var(--space-2);" v-if="tool.source !== 'internal'">
                                <span class="ch-tools__section-label">Source:</span>
                                <v-chip size="x-small" variant="outlined">{{ tool.source }}</v-chip>
                            </div>
                        </div>

                        <div class="ch-tools__card-actions">
                            <button class="ch-tools__btn ch-tools__btn--ghost" @click="openSchemaDialog(tool)">
                                <v-icon size="14">mdi-eye</v-icon>
                                <span>View Schema</span>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- Schema Dialog -->
        <v-dialog v-model="schemaDialog" max-width="600px">
            <v-card>
                <v-card-title class="d-flex align-center">
                    <v-icon class="mr-2" color="info">mdi-code-json</v-icon>
                    Input Schema
                </v-card-title>
                <v-card-subtitle class="pb-0">{{ schemaToolName }}</v-card-subtitle>
                <v-card-text>
                    <pre class="ch-tools__schema-pre">{{ schemaContent }}</pre>
                </v-card-text>
                <v-card-actions>
                    <v-btn variant="text" prepend-icon="mdi-content-copy" @click="copySchema">
                        Copy
                    </v-btn>
                    <v-spacer />
                    <v-btn variant="text" @click="schemaDialog = false">Close</v-btn>
                </v-card-actions>
            </v-card>
        </v-dialog>

        <!-- Server Details Dialog -->
        <v-dialog v-model="serverDetailsDialog" max-width="600px">
            <v-card v-if="selectedServer">
                <v-card-title class="d-flex align-center">
                    <v-icon
                        class="mr-2"
                        :color="getServerStatusColor(selectedServer.status)"
                    >
                        {{ getServerStatusIcon(selectedServer.status) }}
                    </v-icon>
                    {{ selectedServer.name }}
                </v-card-title>
                <v-card-text>
                    <v-row>
                        <v-col cols="6">
                            <p class="ch-tools__section-label">ID</p>
                            <p class="ch-tools__mono">{{ selectedServer.id }}</p>
                        </v-col>
                        <v-col cols="6">
                            <p class="ch-tools__section-label">Status</p>
                            <v-chip :color="getServerStatusColor(selectedServer.status)" size="small">
                                {{ selectedServer.status }}
                            </v-chip>
                        </v-col>
                        <v-col cols="6">
                            <p class="ch-tools__section-label">PID</p>
                            <p>{{ selectedServer.pid || 'N/A' }}</p>
                        </v-col>
                        <v-col cols="6">
                            <p class="ch-tools__section-label">Uptime</p>
                            <p>{{ formatUptime(selectedServer.uptime) }}</p>
                        </v-col>
                        <v-col cols="6">
                            <p class="ch-tools__section-label">Restart Count</p>
                            <p>{{ selectedServer.restartCount }}</p>
                        </v-col>
                        <v-col cols="6">
                            <p class="ch-tools__section-label">Initialized</p>
                            <v-chip :color="selectedServer.initialized ? 'success' : 'grey'" size="small">
                                {{ selectedServer.initialized ? 'Yes' : 'No' }}
                            </v-chip>
                        </v-col>
                    </v-row>

                    <v-divider class="my-4" />

                    <p class="ch-tools__section-label mb-2">Tools ({{ selectedServer.tools.length }})</p>
                    <div v-if="selectedServer.tools.length === 0" class="text-body-2 text-medium-emphasis">
                        No tools available
                    </div>
                    <v-chip-group v-else column>
                        <v-chip
                            v-for="tool in selectedServer.tools"
                            :key="tool.name"
                            size="small"
                            variant="outlined"
                        >
                            {{ tool.name }}
                        </v-chip>
                    </v-chip-group>

                    <div v-if="selectedServer.lastError" class="mt-4">
                        <p class="ch-tools__section-label text-error mb-1">Last Error</p>
                        <p class="text-body-2">{{ selectedServer.lastError }}</p>
                    </div>
                </v-card-text>
                <v-card-actions>
                    <v-spacer />
                    <v-btn variant="text" @click="serverDetailsDialog = false">Close</v-btn>
                </v-card-actions>
            </v-card>
        </v-dialog>

        <!-- Register Server Dialog -->
        <v-dialog v-model="registerServerDialog" max-width="500px">
            <v-card>
                <v-card-title class="d-flex align-center">
                    <v-icon class="mr-2" color="primary">mdi-server-plus</v-icon>
                    Register MCP Server
                </v-card-title>
                <v-card-text>
                    <v-form>
                        <v-text-field
                            v-model="newServerForm.id"
                            label="Server ID"
                            hint="Unique identifier (e.g., my-mcp-server)"
                            variant="outlined"
                            density="compact"
                            class="mb-4"
                            required
                        />
                        <v-text-field
                            v-model="newServerForm.name"
                            label="Server Name"
                            hint="Display name for the server"
                            variant="outlined"
                            density="compact"
                            class="mb-4"
                            required
                        />
                        <v-select
                            v-model="newServerForm.transport"
                            :items="[
                                { title: 'Standard I/O (stdio)', value: 'stdio' },
                                { title: 'HTTP', value: 'http' }
                            ]"
                            label="Transport"
                            variant="outlined"
                            density="compact"
                            class="mb-4"
                        />

                        <!-- stdio transport fields -->
                        <template v-if="newServerForm.transport === 'stdio'">
                            <v-text-field
                                v-model="newServerForm.command"
                                label="Command"
                                hint="Command to run (e.g., npx, node, python)"
                                variant="outlined"
                                density="compact"
                                class="mb-4"
                                required
                            />
                            <v-text-field
                                v-model="argsInput"
                                label="Arguments"
                                hint="Comma-separated arguments (e.g., -y, @modelcontextprotocol/server-name)"
                                variant="outlined"
                                density="compact"
                                class="mb-4"
                            />
                        </template>

                        <!-- http transport fields -->
                        <template v-if="newServerForm.transport === 'http'">
                            <v-text-field
                                v-model="newServerForm.url"
                                label="URL"
                                hint="HTTP endpoint URL"
                                variant="outlined"
                                density="compact"
                                class="mb-4"
                                required
                            />
                        </template>

                        <v-switch
                            v-model="newServerForm.autoStart"
                            label="Auto-start server"
                            color="primary"
                            hide-details
                        />
                    </v-form>
                </v-card-text>
                <v-card-actions>
                    <v-btn variant="text" @click="registerServerDialog = false">Cancel</v-btn>
                    <v-spacer />
                    <v-btn
                        color="primary"
                        variant="tonal"
                        :disabled="!isRegisterFormValid"
                        :loading="serversLoading"
                        @click="submitRegisterServer"
                    >
                        Register
                    </v-btn>
                </v-card-actions>
            </v-card>
        </v-dialog>

        <!-- Confirm Unregister Dialog -->
        <v-dialog v-model="confirmUnregisterDialog" max-width="400px">
            <v-card v-if="serverToUnregister">
                <v-card-title class="d-flex align-center">
                    <v-icon class="mr-2" color="error">mdi-alert</v-icon>
                    Confirm Unregister
                </v-card-title>
                <v-card-text>
                    <p>Are you sure you want to unregister the server <strong>{{ serverToUnregister.name }}</strong>?</p>
                    <p class="text-body-2 text-medium-emphasis mt-2">
                        This will stop the server and remove it from the registry.
                        Any tools provided by this server will no longer be available.
                    </p>
                </v-card-text>
                <v-card-actions>
                    <v-btn variant="text" @click="confirmUnregisterDialog = false">Cancel</v-btn>
                    <v-spacer />
                    <v-btn
                        color="error"
                        variant="tonal"
                        :loading="serverActionLoading[serverToUnregister.id]"
                        @click="executeUnregister"
                    >
                        Unregister
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
   MXF Channel Tools — Design System
   BEM prefix: ch-tools__
   ════════════════════════════════════════════ */

.ch-tools {
    --ch-blue: #4A90C2;
    --ch-green: #10B981;
    --ch-amber: #F59E0B;
    --ch-cyan: #22D3EE;
    --ch-red: #EF4444;
    max-width: 1200px;
    margin: 0 auto;
}

/* ── Header Strip ─────────────────────── */
.ch-tools__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 0 var(--space-4);
    border-bottom: 1px solid var(--border-subtle);
    margin-bottom: var(--space-4);
}

.ch-tools__header-left {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    flex-wrap: wrap;
}

.ch-tools__header-title {
    font-size: var(--text-lg);
    font-weight: 600;
    color: var(--text-primary);
    letter-spacing: -0.01em;
    margin: 0;
}

.ch-tools__header-divider {
    color: var(--text-muted);
    opacity: 0.4;
    font-weight: 300;
}

.ch-tools__header-sub {
    font-size: var(--text-sm);
    color: var(--text-muted);
}

.ch-tools__header-actions {
    display: flex;
    align-items: center;
    gap: var(--space-2);
}

/* ── Buttons ──────────────────────────── */
.ch-tools__btn {
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

.ch-tools__btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}

.ch-tools__btn--ghost {
    background: transparent;
    border-color: var(--border-default);
    color: var(--text-secondary);
}

.ch-tools__btn--ghost:hover:not(:disabled) {
    color: var(--text-primary);
    border-color: var(--ch-blue);
    background: rgba(74, 144, 194, 0.08);
}

.ch-tools__btn--primary {
    background: var(--ch-blue);
    color: #fff;
    border-color: var(--ch-blue);
}

.ch-tools__btn--primary:hover:not(:disabled) {
    background: #3a7db0;
    box-shadow: 0 2px 8px rgba(74, 144, 194, 0.3);
}

/* ── Metrics Grid ─────────────────────── */
.ch-tools__metrics {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: var(--space-3);
    margin-bottom: var(--space-4);
}

.ch-tools__server-metrics {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: var(--space-3);
    margin-bottom: var(--space-4);
}

.ch-tools__metric {
    position: relative;
    padding: var(--space-3) var(--space-4);
    background: var(--bg-base);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-lg);
    transition: all var(--transition-base);
    overflow: hidden;
}

.ch-tools__metric::before {
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

.ch-tools__metric[data-accent="blue"]::before  { background: var(--ch-blue); }
.ch-tools__metric[data-accent="green"]::before { background: var(--ch-green); }
.ch-tools__metric[data-accent="amber"]::before { background: var(--ch-amber); }
.ch-tools__metric[data-accent="cyan"]::before  { background: var(--ch-cyan); }
.ch-tools__metric[data-accent="red"]::before   { background: var(--ch-red); }

.ch-tools__metric:hover {
    border-color: var(--border-default);
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
}

.ch-tools__metric:hover::before {
    opacity: 1;
}

.ch-tools__metric-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: var(--space-1);
}

.ch-tools__metric-label {
    font-size: var(--text-xs);
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
}

.ch-tools__metric-ico {
    color: var(--text-muted);
    opacity: 0.5;
}

.ch-tools__metric-number {
    font-family: var(--font-mono);
    font-size: 1.5rem;
    font-weight: 700;
    color: var(--text-primary);
    line-height: 1;
    letter-spacing: -0.02em;
}

/* ── Section Label ────────────────────── */
.ch-tools__section-label {
    font-size: var(--text-xs);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
}

/* ── Mono Text ────────────────────────── */
.ch-tools__mono {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    opacity: 0.7;
}

/* ── Servers Card ─────────────────────── */
.ch-tools__servers {
    background: var(--bg-base);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-lg);
    overflow: hidden;
    margin-bottom: var(--space-4);
    transition: border-color var(--transition-base);
}

.ch-tools__servers:hover {
    border-color: var(--border-default);
}

.ch-tools__servers-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-4) var(--space-5);
    border-bottom: 1px solid var(--border-subtle);
}

.ch-tools__servers-title {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--text-primary);
}

.ch-tools__servers-actions {
    display: flex;
    align-items: center;
    gap: var(--space-2);
}

.ch-tools__servers-body {
    padding: var(--space-5);
}

.ch-tools__server-list {
    background: transparent;
}

.ch-tools__server-item {
    background: var(--bg-elevated);
    border-radius: var(--radius-md);
    transition: background var(--transition-base);
}

.ch-tools__server-item:hover {
    background: var(--bg-hover);
}

/* ── Permissions Card ─────────────────── */
.ch-tools__permissions {
    background: var(--bg-base);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-lg);
    overflow: hidden;
    margin-bottom: var(--space-4);
    transition: border-color var(--transition-base);
}

.ch-tools__permissions:hover {
    border-color: var(--border-default);
}

.ch-tools__permissions-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-4) var(--space-5);
    border-bottom: 1px solid var(--border-subtle);
}

.ch-tools__permissions-title {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--text-primary);
}

.ch-tools__permissions-body {
    padding: var(--space-5);
}

.ch-tools__toggle-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: var(--space-4);
    padding: var(--space-3);
    border-radius: var(--radius-md);
    background: var(--bg-elevated);
}

.ch-tools__perm-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: var(--space-2);
    padding: var(--space-2);
    background: var(--bg-base);
    border-radius: var(--radius-md);
}

.ch-tools__perm-checkbox {
    margin: 0;
}

.ch-tools__perm-checkbox :deep(.v-label) {
    font-size: var(--text-sm);
}

.ch-tools__perm-name {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
}

.ch-tools__perm-actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
    margin-top: var(--space-4);
    padding-top: var(--space-4);
    border-top: 1px solid var(--border-subtle);
}

/* ── Filters Card ─────────────────────── */
.ch-tools__filters {
    background: var(--bg-base);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-lg);
    overflow: hidden;
    margin-bottom: var(--space-4);
    transition: border-color var(--transition-base);
}

.ch-tools__filters:hover {
    border-color: var(--border-default);
}

.ch-tools__filters-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-4) var(--space-5);
    border-bottom: 1px solid var(--border-subtle);
}

.ch-tools__filters-title {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--text-primary);
}

.ch-tools__filters-body {
    padding: var(--space-5);
}

/* ── Tool List ────────────────────────── */
.ch-tools__list {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
}

/* ── Tool Card ────────────────────────── */
.ch-tools__card {
    position: relative;
    background: var(--bg-base);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-lg);
    overflow: hidden;
    transition: all var(--transition-base);
}

.ch-tools__card:hover {
    border-color: var(--border-default);
    transform: translateY(-2px);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
}

.ch-tools__card-body {
    padding: var(--space-5);
}

.ch-tools__card-top {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-4);
}

.ch-tools__card-head {
    flex: 1;
    min-width: 0;
}

.ch-tools__card-title {
    font-size: var(--text-base);
    font-weight: 600;
    color: var(--text-primary);
    margin: 0 0 var(--space-2);
}

.ch-tools__card-chips {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-wrap: wrap;
}

.ch-tools__card-desc {
    font-size: var(--text-sm);
    color: var(--text-secondary);
    line-height: 1.6;
    margin: 0 0 var(--space-4);
}

.ch-tools__card-actions {
    flex-shrink: 0;
}

/* ── Schema Pre Block ─────────────────── */
.ch-tools__schema-pre {
    background: var(--bg-elevated);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 400px;
    overflow-y: auto;
    padding: var(--space-4);
    border-radius: var(--radius-md);
}

/* ── Empty State ──────────────────────── */
.ch-tools__empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: var(--space-12) var(--space-4);
    text-align: center;
}

.ch-tools__empty-icon {
    color: var(--text-muted);
    opacity: 0.4;
}

.ch-tools__empty-title {
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--text-secondary);
    margin: var(--space-3) 0 var(--space-1);
}

.ch-tools__empty-sub {
    font-size: var(--text-xs);
    color: var(--text-muted);
    margin: 0;
    max-width: 300px;
    line-height: 1.5;
}

/* ── Spin Animation ───────────────────── */
.ch-tools__spin {
    animation: ch-tools-spin 1s linear infinite;
}

@keyframes ch-tools-spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
}

/* ── Responsive ───────────────────────── */
@media (max-width: 768px) {
    .ch-tools__header {
        flex-direction: column;
        align-items: flex-start;
        gap: var(--space-2);
    }

    .ch-tools__header-actions {
        align-self: flex-end;
    }

    .ch-tools__metrics {
        grid-template-columns: repeat(2, 1fr);
    }

    .ch-tools__server-metrics {
        grid-template-columns: repeat(2, 1fr);
    }

    .ch-tools__card-top {
        flex-direction: column;
    }

    .ch-tools__card-actions {
        align-self: flex-end;
    }

    .ch-tools__servers-head,
    .ch-tools__permissions-head {
        flex-direction: column;
        align-items: flex-start;
        gap: var(--space-2);
    }

    .ch-tools__servers-actions {
        align-self: flex-end;
    }

    .ch-tools__perm-actions {
        flex-direction: column;
    }
}

@media (max-width: 480px) {
    .ch-tools__metrics {
        grid-template-columns: 1fr;
    }

    .ch-tools__server-metrics {
        grid-template-columns: 1fr;
    }

    .ch-tools__metric-number {
        font-size: var(--text-xl);
    }

    .ch-tools__perm-grid {
        grid-template-columns: 1fr;
    }
}
</style>
