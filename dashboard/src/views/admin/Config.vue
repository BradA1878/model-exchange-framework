<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { useConfigStore } from '../../stores/config';

const configStore = useConfigStore();

// Local state for snackbar
const snackbar = ref(false);
const snackbarMessage = ref('');
const snackbarColor = ref('success');

// Active sub-tab
const activeTab = ref('templates');

// Computed properties from store
const templates = computed(() => configStore.templates);
const deployments = computed(() => configStore.deployments);
const environments = computed(() => configStore.environments);
const templateStats = computed(() => configStore.templateStats);
const deploymentStats = computed(() => configStore.deploymentStats);
const environmentStats = computed(() => configStore.environmentStats);
const loading = computed(() => configStore.loading);
const error = computed(() => configStore.error);

// Search and filters
const templateSearch = ref('');
const templateTypeFilter = ref('');
const deploymentSearch = ref('');
const environmentSearch = ref('');

// Dialogs
const templateDialogOpen = ref(false);
const templateDialogMode = ref<'create' | 'edit' | 'view'>('view');
const editingTemplate = ref<any>(null);
const deleteConfirmOpen = ref(false);
const templateToDelete = ref<string | null>(null);

const deploymentDialogOpen = ref(false);
const deploymentDialogMode = ref<'create' | 'view'>('view');
const viewingDeployment = ref<any>(null);

const environmentDialogOpen = ref(false);
const editingEnvironment = ref<any>(null);

const syncDialogOpen = ref(false);
const syncSource = ref('');
const syncTarget = ref('');

// Template form
const newTemplateForm = ref({
    name: '',
    description: '',
    type: 'agent',
    content: {}
});

// Computed writable properties for template form binding
const templateFormName = computed({
    get: () => templateDialogMode.value === 'create' ? newTemplateForm.value.name : (editingTemplate.value?.name || ''),
    set: (val: string) => {
        if (templateDialogMode.value === 'create') {
            newTemplateForm.value.name = val;
        } else if (editingTemplate.value) {
            editingTemplate.value.name = val;
        }
    }
});

const templateFormType = computed({
    get: () => templateDialogMode.value === 'create' ? newTemplateForm.value.type : (editingTemplate.value?.type || 'agent'),
    set: (val: string) => {
        if (templateDialogMode.value === 'create') {
            newTemplateForm.value.type = val;
        } else if (editingTemplate.value) {
            editingTemplate.value.type = val;
        }
    }
});

const templateFormDescription = computed({
    get: () => templateDialogMode.value === 'create' ? newTemplateForm.value.description : (editingTemplate.value?.description || ''),
    set: (val: string) => {
        if (templateDialogMode.value === 'create') {
            newTemplateForm.value.description = val;
        } else if (editingTemplate.value) {
            editingTemplate.value.description = val;
        }
    }
});

// Table headers for templates
const templateHeaders = [
    { title: 'Name', key: 'name', sortable: true },
    { title: 'Type', key: 'type', sortable: true },
    { title: 'Version', key: 'version', sortable: true },
    { title: 'Category', key: 'metadata.category', sortable: true },
    { title: 'Created By', key: 'metadata.createdBy', sortable: true },
    { title: 'Updated', key: 'metadata.updatedAt', sortable: true },
    { title: 'Actions', key: 'actions', sortable: false }
];

// Table headers for deployments
const deploymentHeaders = [
    { title: 'Config ID', key: 'configId', sortable: true },
    { title: 'Environment', key: 'environment', sortable: true },
    { title: 'Version', key: 'version', sortable: true },
    { title: 'Instances', key: 'resources.instances', sortable: true },
    { title: 'Monitoring', key: 'monitoring.enabled', sortable: true },
    { title: 'Deployed By', key: 'metadata.deployedBy', sortable: true },
    { title: 'Actions', key: 'actions', sortable: false }
];

// Table headers for environments
const environmentHeaders = [
    { title: 'Environment', key: 'environment', sortable: true },
    { title: 'API Endpoint', key: 'endpoints.api', sortable: false },
    { title: 'WebSocket', key: 'endpoints.websocket', sortable: false },
    { title: 'Variables', key: 'variableCount', sortable: true },
    { title: 'Validated', key: 'validation.validated', sortable: true },
    { title: 'Actions', key: 'actions', sortable: false }
];

// Filtered data
const filteredTemplates = computed(() => {
    let filtered = [...templates.value];

    if (templateSearch.value) {
        const searchLower = templateSearch.value.toLowerCase();
        filtered = filtered.filter(t =>
            t.name.toLowerCase().includes(searchLower) ||
            t.description.toLowerCase().includes(searchLower)
        );
    }

    if (templateTypeFilter.value) {
        filtered = filtered.filter(t => t.type === templateTypeFilter.value);
    }

    return filtered;
});

const filteredDeployments = computed(() => {
    if (!deploymentSearch.value) return deployments.value;

    const searchLower = deploymentSearch.value.toLowerCase();
    return deployments.value.filter(d =>
        d.configId.toLowerCase().includes(searchLower) ||
        d.environment.toLowerCase().includes(searchLower)
    );
});

const filteredEnvironments = computed(() => {
    if (!environmentSearch.value) return environments.value;

    const searchLower = environmentSearch.value.toLowerCase();
    return environments.value.filter(e =>
        e.environment.toLowerCase().includes(searchLower)
    );
});

// Format date
const formatDate = (date: Date | string | null | undefined): string => {
    if (!date) return 'N/A';
    return new Date(date).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    });
};

// Type color
const getTypeColor = (type: string): string => {
    return type === 'agent' ? 'primary' : 'success';
};

// Environment color
const getEnvironmentColor = (env: string): string => {
    switch (env.toLowerCase()) {
        case 'production': return 'error';
        case 'development': return 'success';
        case 'staging': return 'warning';
        default: return 'grey';
    }
};

// Category color
const getCategoryColor = (category: string): string => {
    return category === 'custom' ? 'purple' : 'blue-grey';
};

// Template actions
const openCreateTemplate = (): void => {
    templateDialogMode.value = 'create';
    newTemplateForm.value = {
        name: '',
        description: '',
        type: 'agent',
        content: {}
    };
    templateDialogOpen.value = true;
};

const openViewTemplate = (template: any): void => {
    templateDialogMode.value = 'view';
    editingTemplate.value = template;
    templateDialogOpen.value = true;
};

const openEditTemplate = (template: any): void => {
    templateDialogMode.value = 'edit';
    editingTemplate.value = { ...template };
    templateDialogOpen.value = true;
};

const confirmDeleteTemplate = (templateId: string): void => {
    templateToDelete.value = templateId;
    deleteConfirmOpen.value = true;
};

const handleDeleteTemplate = async (): Promise<void> => {
    if (!templateToDelete.value) return;

    const success = await configStore.deleteTemplate(templateToDelete.value);
    deleteConfirmOpen.value = false;

    if (success) {
        showSnackbar('Template deleted successfully', 'success');
    } else {
        showSnackbar(configStore.error || 'Failed to delete template', 'error');
    }

    templateToDelete.value = null;
};

const handleSaveTemplate = async (): Promise<void> => {
    if (templateDialogMode.value === 'create') {
        const result = await configStore.createTemplate(newTemplateForm.value);
        if (result) {
            showSnackbar('Template created successfully', 'success');
            templateDialogOpen.value = false;
        } else {
            showSnackbar(configStore.error || 'Failed to create template', 'error');
        }
    } else if (templateDialogMode.value === 'edit' && editingTemplate.value) {
        const result = await configStore.updateTemplate(
            editingTemplate.value.templateId,
            editingTemplate.value
        );
        if (result) {
            showSnackbar('Template updated successfully', 'success');
            templateDialogOpen.value = false;
        } else {
            showSnackbar(configStore.error || 'Failed to update template', 'error');
        }
    }
};

// Deployment actions
const openViewDeployment = (deployment: any): void => {
    deploymentDialogMode.value = 'view';
    viewingDeployment.value = deployment;
    deploymentDialogOpen.value = true;
};

const openCreateDeployment = (): void => {
    deploymentDialogMode.value = 'create';
    viewingDeployment.value = null;
    deploymentDialogOpen.value = true;
};

// Environment actions
const openEditEnvironment = (env: any): void => {
    editingEnvironment.value = { ...env };
    environmentDialogOpen.value = true;
};

const handleSaveEnvironment = async (): Promise<void> => {
    if (!editingEnvironment.value) return;

    const result = await configStore.updateEnvironment(
        editingEnvironment.value.environment,
        editingEnvironment.value
    );

    if (result) {
        showSnackbar('Environment updated successfully', 'success');
        environmentDialogOpen.value = false;
    } else {
        showSnackbar(configStore.error || 'Failed to update environment', 'error');
    }
};

// Sync actions
const openSyncDialog = (): void => {
    syncSource.value = '';
    syncTarget.value = '';
    syncDialogOpen.value = true;
};

const handleSync = async (): Promise<void> => {
    const success = await configStore.syncConfiguration(syncSource.value, syncTarget.value);

    if (success) {
        showSnackbar(`Sync initiated: ${configStore.syncStatus?.message}`, 'success');
        syncDialogOpen.value = false;
    } else {
        showSnackbar(configStore.error || 'Failed to sync configuration', 'error');
    }
};

// Snackbar helper
const showSnackbar = (message: string, color: string): void => {
    snackbarMessage.value = message;
    snackbarColor.value = color;
    snackbar.value = true;
};

// Refresh data based on active tab
const refreshData = async (): Promise<void> => {
    try {
        switch (activeTab.value) {
            case 'templates':
                await configStore.fetchTemplates();
                break;
            case 'deployments':
                await configStore.fetchDeployments();
                break;
            case 'environments':
                await configStore.fetchEnvironments();
                break;
        }
        showSnackbar('Data refreshed successfully', 'success');
    } catch (err) {
        showSnackbar('Failed to refresh data', 'error');
    }
};

// Initialize data on mount
onMounted(async () => {
    try {
        await Promise.all([
            configStore.fetchTemplates(),
            configStore.fetchDeployments(),
            configStore.fetchEnvironments()
        ]);
    } catch (err) {
        console.error('Error initializing configuration data:', err);
        showSnackbar('Failed to load configuration data', 'error');
    }
});

// Watch tab changes to load data
watch(activeTab, async (newTab) => {
    switch (newTab) {
        case 'templates':
            if (templates.value.length === 0) await configStore.fetchTemplates();
            break;
        case 'deployments':
            if (deployments.value.length === 0) await configStore.fetchDeployments();
            break;
        case 'environments':
            if (environments.value.length === 0) await configStore.fetchEnvironments();
            break;
    }
});
</script>

<template>
    <div class="admin-config">
        <!-- Header Section -->
        <div class="d-flex align-center justify-space-between mb-6">
            <div>
                <h2 class="text-h4 mb-2">
                    <v-icon class="mr-3" size="32">mdi-cog-outline</v-icon>
                    Configuration Management
                </h2>
                <p class="text-subtitle-1 text-medium-emphasis">
                    Manage templates, deployments, and environment configurations
                </p>
            </div>
            <div class="d-flex gap-2">
                <v-btn
                    color="secondary"
                    prepend-icon="mdi-sync"
                    variant="outlined"
                    @click="openSyncDialog"
                >
                    Sync Config
                </v-btn>
                <v-btn
                    color="primary"
                    prepend-icon="mdi-refresh"
                    variant="elevated"
                    @click="refreshData"
                    :loading="loading"
                >
                    Refresh
                </v-btn>
            </div>
        </div>

        <!-- Sub-tab navigation -->
        <v-card elevation="0" class="mb-6">
            <v-tabs v-model="activeTab">
                <v-tab value="templates">
                    <v-icon class="mr-2">mdi-file-document-outline</v-icon>
                    Templates
                    <v-chip size="x-small" class="ml-2" color="primary">{{ templateStats.total }}</v-chip>
                </v-tab>
                <v-tab value="deployments">
                    <v-icon class="mr-2">mdi-rocket-launch-outline</v-icon>
                    Deployments
                    <v-chip size="x-small" class="ml-2" color="success">{{ deploymentStats.total }}</v-chip>
                </v-tab>
                <v-tab value="environments">
                    <v-icon class="mr-2">mdi-earth</v-icon>
                    Environments
                    <v-chip size="x-small" class="ml-2" color="info">{{ environmentStats.total }}</v-chip>
                </v-tab>
            </v-tabs>
        </v-card>

        <!-- Templates Tab -->
        <v-window v-model="activeTab">
            <v-window-item value="templates">
                <!-- Template Stats -->
                <div class="d-flex gap-4 mb-6">
                    <v-card class="flex-1" elevation="2">
                        <v-card-text class="text-center">
                            <v-icon color="primary" size="32" class="mb-2">mdi-file-document-multiple</v-icon>
                            <div class="text-h5">{{ templateStats.total }}</div>
                            <div class="text-subtitle-2 text-medium-emphasis">Total Templates</div>
                        </v-card-text>
                    </v-card>
                    <v-card class="flex-1" elevation="2">
                        <v-card-text class="text-center">
                            <v-icon color="info" size="32" class="mb-2">mdi-robot</v-icon>
                            <div class="text-h5">{{ templateStats.agentTemplates }}</div>
                            <div class="text-subtitle-2 text-medium-emphasis">Agent Templates</div>
                        </v-card-text>
                    </v-card>
                    <v-card class="flex-1" elevation="2">
                        <v-card-text class="text-center">
                            <v-icon color="success" size="32" class="mb-2">mdi-forum</v-icon>
                            <div class="text-h5">{{ templateStats.channelTemplates }}</div>
                            <div class="text-subtitle-2 text-medium-emphasis">Channel Templates</div>
                        </v-card-text>
                    </v-card>
                    <v-card class="flex-1" elevation="2">
                        <v-card-text class="text-center">
                            <v-icon color="purple" size="32" class="mb-2">mdi-puzzle</v-icon>
                            <div class="text-h5">{{ templateStats.customTemplates }}</div>
                            <div class="text-subtitle-2 text-medium-emphasis">Custom Templates</div>
                        </v-card-text>
                    </v-card>
                </div>

                <!-- Templates Search & Actions -->
                <v-card class="mb-6" elevation="2">
                    <v-card-text>
                        <div class="d-flex gap-4 align-center">
                            <v-text-field
                                v-model="templateSearch"
                                placeholder="Search templates..."
                                prepend-inner-icon="mdi-magnify"
                                variant="outlined"
                                density="compact"
                                hide-details
                                clearable
                                class="flex-1"
                            />
                            <v-select
                                v-model="templateTypeFilter"
                                :items="[
                                    { title: 'All Types', value: '' },
                                    { title: 'Agent', value: 'agent' },
                                    { title: 'Channel', value: 'channel' }
                                ]"
                                label="Type"
                                variant="outlined"
                                density="compact"
                                hide-details
                                style="max-width: 160px;"
                            />
                            <v-btn
                                color="primary"
                                prepend-icon="mdi-plus"
                                @click="openCreateTemplate"
                            >
                                New Template
                            </v-btn>
                        </div>
                    </v-card-text>
                </v-card>

                <!-- Templates Table -->
                <v-card elevation="2">
                    <v-data-table
                        :headers="templateHeaders"
                        :items="filteredTemplates"
                        :loading="loading"
                        item-value="templateId"
                    >
                        <template #item.name="{ item }">
                            <div class="text-body-2 font-weight-medium">
                                <v-icon class="mr-2" size="16">mdi-file-document</v-icon>
                                {{ item.name }}
                            </div>
                        </template>

                        <template #item.type="{ item }">
                            <v-chip :color="getTypeColor(item.type)" size="small">
                                {{ item.type.toUpperCase() }}
                            </v-chip>
                        </template>

                        <template #item.version="{ item }">
                            <v-chip color="grey" size="small" variant="outlined">
                                v{{ item.version }}
                            </v-chip>
                        </template>

                        <template #item.metadata.category="{ item }">
                            <v-chip :color="getCategoryColor(item.metadata.category)" size="small">
                                {{ item.metadata.category }}
                            </v-chip>
                        </template>

                        <template #item.metadata.updatedAt="{ item }">
                            {{ formatDate(item.metadata.updatedAt) }}
                        </template>

                        <template #item.actions="{ item }">
                            <div class="d-flex gap-1">
                                <v-btn
                                    icon="mdi-eye"
                                    variant="text"
                                    size="small"
                                    @click="openViewTemplate(item)"
                                />
                                <v-btn
                                    icon="mdi-pencil"
                                    variant="text"
                                    size="small"
                                    color="primary"
                                    @click="openEditTemplate(item)"
                                />
                                <v-btn
                                    icon="mdi-delete"
                                    variant="text"
                                    size="small"
                                    color="error"
                                    @click="confirmDeleteTemplate(item.templateId)"
                                />
                            </div>
                        </template>

                        <template #no-data>
                            <div class="text-center py-8">
                                <v-icon size="64" color="grey-lighten-1" class="mb-4">
                                    mdi-file-document-outline
                                </v-icon>
                                <div class="text-h6 text-medium-emphasis">No templates found</div>
                            </div>
                        </template>
                    </v-data-table>
                </v-card>
            </v-window-item>

            <!-- Deployments Tab -->
            <v-window-item value="deployments">
                <!-- Deployment Stats -->
                <div class="d-flex gap-4 mb-6">
                    <v-card class="flex-1" elevation="2">
                        <v-card-text class="text-center">
                            <v-icon color="primary" size="32" class="mb-2">mdi-rocket-launch</v-icon>
                            <div class="text-h5">{{ deploymentStats.total }}</div>
                            <div class="text-subtitle-2 text-medium-emphasis">Total Deployments</div>
                        </v-card-text>
                    </v-card>
                    <v-card class="flex-1" elevation="2">
                        <v-card-text class="text-center">
                            <v-icon color="error" size="32" class="mb-2">mdi-server</v-icon>
                            <div class="text-h5">{{ deploymentStats.production }}</div>
                            <div class="text-subtitle-2 text-medium-emphasis">Production</div>
                        </v-card-text>
                    </v-card>
                    <v-card class="flex-1" elevation="2">
                        <v-card-text class="text-center">
                            <v-icon color="success" size="32" class="mb-2">mdi-laptop</v-icon>
                            <div class="text-h5">{{ deploymentStats.development }}</div>
                            <div class="text-subtitle-2 text-medium-emphasis">Development</div>
                        </v-card-text>
                    </v-card>
                    <v-card class="flex-1" elevation="2">
                        <v-card-text class="text-center">
                            <v-icon color="grey" size="32" class="mb-2">mdi-dots-horizontal</v-icon>
                            <div class="text-h5">{{ deploymentStats.other }}</div>
                            <div class="text-subtitle-2 text-medium-emphasis">Other</div>
                        </v-card-text>
                    </v-card>
                </div>

                <!-- Deployments Search -->
                <v-card class="mb-6" elevation="2">
                    <v-card-text>
                        <div class="d-flex gap-4 align-center">
                            <v-text-field
                                v-model="deploymentSearch"
                                placeholder="Search deployments..."
                                prepend-inner-icon="mdi-magnify"
                                variant="outlined"
                                density="compact"
                                hide-details
                                clearable
                                class="flex-1"
                            />
                            <v-btn
                                color="primary"
                                prepend-icon="mdi-plus"
                                @click="openCreateDeployment"
                            >
                                New Deployment
                            </v-btn>
                        </div>
                    </v-card-text>
                </v-card>

                <!-- Deployments Table -->
                <v-card elevation="2">
                    <v-data-table
                        :headers="deploymentHeaders"
                        :items="filteredDeployments"
                        :loading="loading"
                        item-value="configId"
                    >
                        <template #item.configId="{ item }">
                            <code class="text-caption">{{ item.configId }}</code>
                        </template>

                        <template #item.environment="{ item }">
                            <v-chip :color="getEnvironmentColor(item.environment)" size="small">
                                {{ item.environment.toUpperCase() }}
                            </v-chip>
                        </template>

                        <template #item.resources.instances="{ item }">
                            <v-chip color="info" size="small" variant="outlined">
                                {{ item.resources?.instances || 1 }} instance(s)
                            </v-chip>
                        </template>

                        <template #item.monitoring.enabled="{ item }">
                            <v-icon
                                :color="item.monitoring?.enabled ? 'success' : 'grey'"
                                size="20"
                            >
                                {{ item.monitoring?.enabled ? 'mdi-check-circle' : 'mdi-close-circle' }}
                            </v-icon>
                        </template>

                        <template #item.actions="{ item }">
                            <v-btn
                                icon="mdi-eye"
                                variant="text"
                                size="small"
                                @click="openViewDeployment(item)"
                            />
                        </template>

                        <template #no-data>
                            <div class="text-center py-8">
                                <v-icon size="64" color="grey-lighten-1" class="mb-4">
                                    mdi-rocket-launch-outline
                                </v-icon>
                                <div class="text-h6 text-medium-emphasis">No deployments found</div>
                                <div class="text-body-2 text-medium-emphasis">
                                    Create your first deployment configuration
                                </div>
                            </div>
                        </template>
                    </v-data-table>
                </v-card>
            </v-window-item>

            <!-- Environments Tab -->
            <v-window-item value="environments">
                <!-- Environment Stats -->
                <div class="d-flex gap-4 mb-6">
                    <v-card class="flex-1" elevation="2">
                        <v-card-text class="text-center">
                            <v-icon color="primary" size="32" class="mb-2">mdi-earth</v-icon>
                            <div class="text-h5">{{ environmentStats.total }}</div>
                            <div class="text-subtitle-2 text-medium-emphasis">Total Environments</div>
                        </v-card-text>
                    </v-card>
                    <v-card class="flex-1" elevation="2">
                        <v-card-text class="text-center">
                            <v-icon color="success" size="32" class="mb-2">mdi-check-decagram</v-icon>
                            <div class="text-h5">{{ environmentStats.validated }}</div>
                            <div class="text-subtitle-2 text-medium-emphasis">Validated</div>
                        </v-card-text>
                    </v-card>
                    <v-card class="flex-1" elevation="2">
                        <v-card-text class="text-center">
                            <v-icon color="warning" size="32" class="mb-2">mdi-key</v-icon>
                            <div class="text-h5">{{ environmentStats.withSecrets }}</div>
                            <div class="text-subtitle-2 text-medium-emphasis">With Secrets</div>
                        </v-card-text>
                    </v-card>
                </div>

                <!-- Environments Search -->
                <v-card class="mb-6" elevation="2">
                    <v-card-text>
                        <v-text-field
                            v-model="environmentSearch"
                            placeholder="Search environments..."
                            prepend-inner-icon="mdi-magnify"
                            variant="outlined"
                            density="compact"
                            hide-details
                            clearable
                        />
                    </v-card-text>
                </v-card>

                <!-- Environments Table -->
                <v-card elevation="2">
                    <v-data-table
                        :headers="environmentHeaders"
                        :items="filteredEnvironments"
                        :loading="loading"
                        item-value="environment"
                    >
                        <template #item.environment="{ item }">
                            <v-chip :color="getEnvironmentColor(item.environment)" size="small">
                                {{ item.environment.toUpperCase() }}
                            </v-chip>
                        </template>

                        <template #item.endpoints.api="{ item }">
                            <code class="text-caption">{{ item.endpoints?.api || 'N/A' }}</code>
                        </template>

                        <template #item.endpoints.websocket="{ item }">
                            <code class="text-caption">{{ item.endpoints?.websocket || 'N/A' }}</code>
                        </template>

                        <template #item.variableCount="{ item }">
                            <v-chip color="info" size="small" variant="outlined">
                                {{ Object.keys(item.variables || {}).length }} vars
                            </v-chip>
                        </template>

                        <template #item.validation.validated="{ item }">
                            <v-icon
                                :color="item.validation?.validated ? 'success' : 'warning'"
                                size="20"
                            >
                                {{ item.validation?.validated ? 'mdi-check-circle' : 'mdi-alert-circle' }}
                            </v-icon>
                        </template>

                        <template #item.actions="{ item }">
                            <v-btn
                                icon="mdi-pencil"
                                variant="text"
                                size="small"
                                color="primary"
                                @click="openEditEnvironment(item)"
                            />
                        </template>

                        <template #no-data>
                            <div class="text-center py-8">
                                <v-icon size="64" color="grey-lighten-1" class="mb-4">
                                    mdi-earth
                                </v-icon>
                                <div class="text-h6 text-medium-emphasis">No environments found</div>
                            </div>
                        </template>
                    </v-data-table>
                </v-card>
            </v-window-item>
        </v-window>

        <!-- Template Dialog -->
        <v-dialog v-model="templateDialogOpen" max-width="700">
            <v-card>
                <v-card-title class="d-flex align-center">
                    <v-icon class="mr-2">
                        {{ templateDialogMode === 'create' ? 'mdi-plus' : templateDialogMode === 'edit' ? 'mdi-pencil' : 'mdi-eye' }}
                    </v-icon>
                    {{ templateDialogMode === 'create' ? 'Create Template' : templateDialogMode === 'edit' ? 'Edit Template' : 'Template Details' }}
                </v-card-title>
                <v-card-text>
                    <template v-if="templateDialogMode === 'view' && editingTemplate">
                        <v-list>
                            <v-list-item>
                                <v-list-item-title>Name</v-list-item-title>
                                <v-list-item-subtitle>{{ editingTemplate.name }}</v-list-item-subtitle>
                            </v-list-item>
                            <v-list-item>
                                <v-list-item-title>Type</v-list-item-title>
                                <v-list-item-subtitle>
                                    <v-chip :color="getTypeColor(editingTemplate.type)" size="small">
                                        {{ editingTemplate.type }}
                                    </v-chip>
                                </v-list-item-subtitle>
                            </v-list-item>
                            <v-list-item>
                                <v-list-item-title>Description</v-list-item-title>
                                <v-list-item-subtitle>{{ editingTemplate.description }}</v-list-item-subtitle>
                            </v-list-item>
                            <v-list-item>
                                <v-list-item-title>Version</v-list-item-title>
                                <v-list-item-subtitle>{{ editingTemplate.version }}</v-list-item-subtitle>
                            </v-list-item>
                            <v-divider class="my-2" />
                            <v-list-item>
                                <v-list-item-title>Configuration</v-list-item-title>
                                <v-list-item-subtitle>
                                    <pre class="text-caption pa-2 bg-grey-darken-3 rounded mt-2">{{ JSON.stringify(editingTemplate.configuration, null, 2) }}</pre>
                                </v-list-item-subtitle>
                            </v-list-item>
                        </v-list>
                    </template>
                    <template v-else>
                        <v-form>
                            <v-text-field
                                v-model="templateFormName"
                                label="Template Name"
                                variant="outlined"
                                class="mb-4"
                                :rules="[v => !!v || 'Name is required']"
                            />
                            <v-select
                                v-model="templateFormType"
                                :items="[{ title: 'Agent', value: 'agent' }, { title: 'Channel', value: 'channel' }]"
                                label="Template Type"
                                variant="outlined"
                                class="mb-4"
                                :disabled="templateDialogMode === 'edit'"
                            />
                            <v-textarea
                                v-model="templateFormDescription"
                                label="Description"
                                variant="outlined"
                                rows="3"
                            />
                        </v-form>
                    </template>
                </v-card-text>
                <v-card-actions>
                    <v-spacer />
                    <v-btn variant="text" @click="templateDialogOpen = false">
                        {{ templateDialogMode === 'view' ? 'Close' : 'Cancel' }}
                    </v-btn>
                    <v-btn
                        v-if="templateDialogMode !== 'view'"
                        color="primary"
                        variant="elevated"
                        @click="handleSaveTemplate"
                        :loading="loading"
                    >
                        {{ templateDialogMode === 'create' ? 'Create' : 'Save' }}
                    </v-btn>
                </v-card-actions>
            </v-card>
        </v-dialog>

        <!-- Delete Confirmation Dialog -->
        <v-dialog v-model="deleteConfirmOpen" max-width="400">
            <v-card>
                <v-card-title class="text-h6">
                    <v-icon color="error" class="mr-2">mdi-alert</v-icon>
                    Confirm Delete
                </v-card-title>
                <v-card-text>
                    Are you sure you want to delete this template? This action cannot be undone.
                </v-card-text>
                <v-card-actions>
                    <v-spacer />
                    <v-btn variant="text" @click="deleteConfirmOpen = false">Cancel</v-btn>
                    <v-btn color="error" variant="elevated" @click="handleDeleteTemplate" :loading="loading">
                        Delete
                    </v-btn>
                </v-card-actions>
            </v-card>
        </v-dialog>

        <!-- Deployment Dialog -->
        <v-dialog v-model="deploymentDialogOpen" max-width="700">
            <v-card>
                <v-card-title class="d-flex align-center">
                    <v-icon class="mr-2">mdi-rocket-launch</v-icon>
                    {{ deploymentDialogMode === 'create' ? 'Create Deployment' : 'Deployment Details' }}
                </v-card-title>
                <v-card-text>
                    <template v-if="viewingDeployment">
                        <v-list>
                            <v-list-item>
                                <v-list-item-title>Config ID</v-list-item-title>
                                <v-list-item-subtitle><code>{{ viewingDeployment.configId }}</code></v-list-item-subtitle>
                            </v-list-item>
                            <v-list-item>
                                <v-list-item-title>Environment</v-list-item-title>
                                <v-list-item-subtitle>
                                    <v-chip :color="getEnvironmentColor(viewingDeployment.environment)" size="small">
                                        {{ viewingDeployment.environment }}
                                    </v-chip>
                                </v-list-item-subtitle>
                            </v-list-item>
                            <v-list-item>
                                <v-list-item-title>Resources</v-list-item-title>
                                <v-list-item-subtitle>
                                    Instances: {{ viewingDeployment.resources?.instances }},
                                    Memory: {{ viewingDeployment.resources?.memory }},
                                    CPU: {{ viewingDeployment.resources?.cpu }}
                                </v-list-item-subtitle>
                            </v-list-item>
                            <v-divider class="my-2" />
                            <v-list-item>
                                <v-list-item-title>Settings</v-list-item-title>
                                <v-list-item-subtitle>
                                    <pre class="text-caption pa-2 bg-grey-darken-3 rounded mt-2">{{ JSON.stringify(viewingDeployment.settings, null, 2) }}</pre>
                                </v-list-item-subtitle>
                            </v-list-item>
                        </v-list>
                    </template>
                    <template v-else>
                        <v-alert type="info" variant="tonal" class="mb-4">
                            Deployment creation form - configure your deployment settings below.
                        </v-alert>
                        <v-select
                            :items="['development', 'staging', 'production']"
                            label="Environment"
                            variant="outlined"
                            class="mb-4"
                        />
                    </template>
                </v-card-text>
                <v-card-actions>
                    <v-spacer />
                    <v-btn variant="text" @click="deploymentDialogOpen = false">Close</v-btn>
                </v-card-actions>
            </v-card>
        </v-dialog>

        <!-- Environment Dialog -->
        <v-dialog v-model="environmentDialogOpen" max-width="600">
            <v-card>
                <v-card-title class="d-flex align-center">
                    <v-icon class="mr-2">mdi-earth</v-icon>
                    Edit Environment
                </v-card-title>
                <v-card-text v-if="editingEnvironment">
                    <v-form>
                        <v-text-field
                            v-model="editingEnvironment.environment"
                            label="Environment Name"
                            variant="outlined"
                            class="mb-4"
                            disabled
                        />
                        <v-text-field
                            v-model="editingEnvironment.endpoints.api"
                            label="API Endpoint"
                            variant="outlined"
                            class="mb-4"
                        />
                        <v-text-field
                            v-model="editingEnvironment.endpoints.websocket"
                            label="WebSocket Endpoint"
                            variant="outlined"
                            class="mb-4"
                        />
                        <v-text-field
                            v-model="editingEnvironment.endpoints.health"
                            label="Health Endpoint"
                            variant="outlined"
                            class="mb-4"
                        />
                        <v-switch
                            v-model="editingEnvironment.validation.validated"
                            label="Validated"
                            color="success"
                        />
                    </v-form>
                </v-card-text>
                <v-card-actions>
                    <v-spacer />
                    <v-btn variant="text" @click="environmentDialogOpen = false">Cancel</v-btn>
                    <v-btn color="primary" variant="elevated" @click="handleSaveEnvironment" :loading="loading">
                        Save
                    </v-btn>
                </v-card-actions>
            </v-card>
        </v-dialog>

        <!-- Sync Dialog -->
        <v-dialog v-model="syncDialogOpen" max-width="500">
            <v-card>
                <v-card-title class="d-flex align-center">
                    <v-icon class="mr-2">mdi-sync</v-icon>
                    Sync Configuration
                </v-card-title>
                <v-card-text>
                    <v-alert type="info" variant="tonal" class="mb-4">
                        Sync configuration from a source to apply settings.
                    </v-alert>
                    <v-select
                        v-model="syncSource"
                        :items="['template', 'deployment', 'environment']"
                        label="Source Type"
                        variant="outlined"
                        class="mb-4"
                    />
                    <v-text-field
                        v-model="syncTarget"
                        label="Target ID"
                        variant="outlined"
                        hint="Enter the template, deployment, or environment ID"
                        persistent-hint
                    />
                </v-card-text>
                <v-card-actions>
                    <v-spacer />
                    <v-btn variant="text" @click="syncDialogOpen = false">Cancel</v-btn>
                    <v-btn
                        color="primary"
                        variant="elevated"
                        @click="handleSync"
                        :loading="loading"
                        :disabled="!syncSource || !syncTarget"
                    >
                        Start Sync
                    </v-btn>
                </v-card-actions>
            </v-card>
        </v-dialog>

        <!-- Snackbar -->
        <v-snackbar
            v-model="snackbar"
            :color="snackbarColor"
            timeout="5000"
            location="top"
        >
            {{ snackbarMessage }}
            <template #actions>
                <v-btn variant="text" @click="snackbar = false">Close</v-btn>
            </template>
        </v-snackbar>
    </div>
</template>

<style scoped>
.admin-config {
    max-width: 1400px;
    margin: 0 auto;
    padding: 1rem;
}

.gap-4 {
    gap: 1rem;
}

.gap-2 {
    gap: 0.5rem;
}

.gap-1 {
    gap: 0.25rem;
}
</style>
