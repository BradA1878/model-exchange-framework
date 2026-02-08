/**
 * Configuration Management Store
 *
 * Pinia store for managing configuration templates, deployments, and environments
 * Integrates with /api/config/* endpoints
 */

import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import axios from '../plugins/axios';

// Template Types
interface TemplateMetadata {
    createdBy: string;
    createdAt: Date;
    updatedBy: string;
    updatedAt: Date;
    tags: string[];
    category: string;
}

interface AgentTemplateConfiguration {
    name: string;
    description: string;
    capabilities: string[];
    serviceTypes: string[];
    role: string;
    instructions: string;
    constraints: string[];
    context: Record<string, any>;
    memory: Record<string, any>;
}

interface ChannelTemplateConfiguration {
    name: string;
    description: string;
    privacy: 'public' | 'private' | 'restricted';
    requiresApproval: boolean;
    maxAgents: number;
    allowedRoles: string[];
    restrictions: string[];
    context: Record<string, any>;
    memory: Record<string, any>;
}

interface AgentTemplate {
    templateId: string;
    name: string;
    description: string;
    type: 'agent';
    version: string;
    configuration: AgentTemplateConfiguration;
    deployment: {
        environment: string;
        resources: Record<string, any>;
        scaling: {
            minInstances: number;
            maxInstances: number;
        };
    };
    metadata: TemplateMetadata;
}

interface ChannelTemplate {
    templateId: string;
    name: string;
    description: string;
    type: 'channel';
    version: string;
    configuration: ChannelTemplateConfiguration;
    verification: {
        method: 'token' | 'oauth' | 'custom';
        required: boolean;
        settings: Record<string, any>;
    };
    metadata: TemplateMetadata;
}

type ConfigTemplate = AgentTemplate | ChannelTemplate;

// Deployment Types
interface DeploymentConfiguration {
    configId: string;
    environment: string;
    version: string;
    settings: {
        database: {
            host: string;
            port: number;
            name: string;
            ssl: boolean;
        };
        redis: {
            host: string;
            port: number;
            ssl: boolean;
        };
        authentication: {
            jwtSecret: string;
            keyValidation: boolean;
            sessionTimeout: number;
        };
        performance: {
            maxConnections: number;
            taskTimeout: number;
            memoryLimit: string;
        };
        features: {
            intelligentAssignment: boolean;
            analytics: boolean;
            monitoring: boolean;
        };
    };
    resources: {
        instances: number;
        memory: string;
        cpu: string;
        storage: string;
    };
    monitoring: {
        enabled: boolean;
        alerting: boolean;
        metricsRetention: string;
    };
    metadata: {
        deployedBy: string;
        deployedAt: Date;
        updatedBy: string;
        updatedAt: Date;
        notes: string;
    };
}

// Environment Types
interface EnvironmentConfiguration {
    environment: string;
    variables: Record<string, string>;
    secrets: string[];
    endpoints: {
        api: string;
        websocket: string;
        health: string;
    };
    validation: {
        validated: boolean;
    };
}

// Agent Config Options
interface AgentConfigOptions {
    llmProviders: Array<{
        value: string;
        label: string;
        requiresApiKey: boolean;
    }>;
    defaultModels: Record<string, string[]>;
    agentTypes: Array<{
        value: string;
        label: string;
    }>;
    commonCapabilities: string[];
    commonServiceTypes: string[];
    defaultSettings: {
        temperature: number;
        maxTokens: number;
        host: string;
        port: number;
        secure: boolean;
    };
}

export const useConfigStore = defineStore('config', () => {
    // State
    const templates = ref<ConfigTemplate[]>([]);
    const selectedTemplate = ref<ConfigTemplate | null>(null);
    const deployments = ref<DeploymentConfiguration[]>([]);
    const selectedDeployment = ref<DeploymentConfiguration | null>(null);
    const environments = ref<EnvironmentConfiguration[]>([]);
    const selectedEnvironment = ref<EnvironmentConfiguration | null>(null);
    const agentOptions = ref<AgentConfigOptions | null>(null);

    const loading = ref(false);
    const error = ref<string | null>(null);
    const syncStatus = ref<{ syncId: string; status: string; message: string } | null>(null);

    // Computed properties
    const templateStats = computed(() => {
        const total = templates.value.length;
        const agentTemplates = templates.value.filter(t => t.type === 'agent').length;
        const channelTemplates = templates.value.filter(t => t.type === 'channel').length;
        const customTemplates = templates.value.filter(t => t.metadata.category === 'custom').length;

        return {
            total,
            agentTemplates,
            channelTemplates,
            customTemplates
        };
    });

    const deploymentStats = computed(() => {
        const total = deployments.value.length;
        const production = deployments.value.filter(d => d.environment === 'production').length;
        const development = deployments.value.filter(d => d.environment === 'development').length;
        const other = total - production - development;

        return {
            total,
            production,
            development,
            other
        };
    });

    const environmentStats = computed(() => {
        const total = environments.value.length;
        const validated = environments.value.filter(e => e.validation?.validated).length;
        const withSecrets = environments.value.filter(e => e.secrets?.length > 0).length;

        return {
            total,
            validated,
            withSecrets
        };
    });

    // Template Actions
    const fetchTemplates = async (type?: string): Promise<void> => {
        loading.value = true;
        error.value = null;

        try {
            const params = type ? { type } : {};
            const response = await axios.get<{ success: boolean; data: ConfigTemplate[]; count: number }>(
                '/api/config/templates',
                { params }
            );

            if (response.data.success) {
                templates.value = response.data.data || [];
            } else {
                throw new Error('Failed to fetch templates');
            }
        } catch (err: any) {
            console.error('Error fetching templates:', err);
            error.value = err.response?.data?.error || err.message || 'Failed to fetch templates';
            templates.value = [];
        } finally {
            loading.value = false;
        }
    };

    const fetchTemplate = async (templateId: string): Promise<ConfigTemplate | null> => {
        loading.value = true;
        error.value = null;

        try {
            const response = await axios.get<{ success: boolean; data: ConfigTemplate }>(
                `/api/config/templates/${templateId}`
            );

            if (response.data.success) {
                selectedTemplate.value = response.data.data;
                return response.data.data;
            } else {
                throw new Error('Template not found');
            }
        } catch (err: any) {
            console.error('Error fetching template:', err);
            error.value = err.response?.data?.error || err.message || 'Failed to fetch template';
            return null;
        } finally {
            loading.value = false;
        }
    };

    const createTemplate = async (templateData: Partial<ConfigTemplate>): Promise<ConfigTemplate | null> => {
        loading.value = true;
        error.value = null;

        try {
            const response = await axios.post<{ success: boolean; data: ConfigTemplate }>(
                '/api/config/templates',
                templateData
            );

            if (response.data.success) {
                const newTemplate = response.data.data;
                templates.value.push(newTemplate);
                return newTemplate;
            } else {
                throw new Error('Failed to create template');
            }
        } catch (err: any) {
            console.error('Error creating template:', err);
            error.value = err.response?.data?.error || err.message || 'Failed to create template';
            return null;
        } finally {
            loading.value = false;
        }
    };

    const updateTemplate = async (templateId: string, updates: Partial<ConfigTemplate>): Promise<ConfigTemplate | null> => {
        loading.value = true;
        error.value = null;

        try {
            const response = await axios.put<{ success: boolean; data: ConfigTemplate }>(
                `/api/config/templates/${templateId}`,
                updates
            );

            if (response.data.success) {
                const updatedTemplate = response.data.data;
                const index = templates.value.findIndex(t => t.templateId === templateId);
                if (index !== -1) {
                    templates.value[index] = updatedTemplate;
                }
                if (selectedTemplate.value?.templateId === templateId) {
                    selectedTemplate.value = updatedTemplate;
                }
                return updatedTemplate;
            } else {
                throw new Error('Failed to update template');
            }
        } catch (err: any) {
            console.error('Error updating template:', err);
            error.value = err.response?.data?.error || err.message || 'Failed to update template';
            return null;
        } finally {
            loading.value = false;
        }
    };

    const deleteTemplate = async (templateId: string): Promise<boolean> => {
        loading.value = true;
        error.value = null;

        try {
            const response = await axios.delete<{ success: boolean; message: string }>(
                `/api/config/templates/${templateId}`
            );

            if (response.data.success) {
                templates.value = templates.value.filter(t => t.templateId !== templateId);
                if (selectedTemplate.value?.templateId === templateId) {
                    selectedTemplate.value = null;
                }
                return true;
            } else {
                throw new Error('Failed to delete template');
            }
        } catch (err: any) {
            console.error('Error deleting template:', err);
            error.value = err.response?.data?.error || err.message || 'Failed to delete template';
            return false;
        } finally {
            loading.value = false;
        }
    };

    // Deployment Actions
    const fetchDeployments = async (): Promise<void> => {
        loading.value = true;
        error.value = null;

        try {
            const response = await axios.get<{ success: boolean; data: DeploymentConfiguration[]; count: number }>(
                '/api/config/deployments'
            );

            if (response.data.success) {
                deployments.value = response.data.data || [];
            } else {
                throw new Error('Failed to fetch deployments');
            }
        } catch (err: any) {
            console.error('Error fetching deployments:', err);
            error.value = err.response?.data?.error || err.message || 'Failed to fetch deployments';
            deployments.value = [];
        } finally {
            loading.value = false;
        }
    };

    const createDeployment = async (deploymentData: Partial<DeploymentConfiguration>): Promise<DeploymentConfiguration | null> => {
        loading.value = true;
        error.value = null;

        try {
            const response = await axios.post<{ success: boolean; data: DeploymentConfiguration }>(
                '/api/config/deployments',
                deploymentData
            );

            if (response.data.success) {
                const newDeployment = response.data.data;
                deployments.value.push(newDeployment);
                return newDeployment;
            } else {
                throw new Error('Failed to create deployment');
            }
        } catch (err: any) {
            console.error('Error creating deployment:', err);
            error.value = err.response?.data?.error || err.message || 'Failed to create deployment';
            return null;
        } finally {
            loading.value = false;
        }
    };

    // Environment Actions
    const fetchEnvironments = async (): Promise<void> => {
        loading.value = true;
        error.value = null;

        try {
            const response = await axios.get<{ success: boolean; data: EnvironmentConfiguration[]; count: number }>(
                '/api/config/environments'
            );

            if (response.data.success) {
                environments.value = response.data.data || [];
            } else {
                throw new Error('Failed to fetch environments');
            }
        } catch (err: any) {
            console.error('Error fetching environments:', err);
            error.value = err.response?.data?.error || err.message || 'Failed to fetch environments';
            environments.value = [];
        } finally {
            loading.value = false;
        }
    };

    const updateEnvironment = async (envId: string, updates: Partial<EnvironmentConfiguration>): Promise<EnvironmentConfiguration | null> => {
        loading.value = true;
        error.value = null;

        try {
            const response = await axios.put<{ success: boolean; data: EnvironmentConfiguration }>(
                `/api/config/environments/${envId}`,
                updates
            );

            if (response.data.success) {
                const updatedEnv = response.data.data;
                const index = environments.value.findIndex(e => e.environment === envId);
                if (index !== -1) {
                    environments.value[index] = updatedEnv;
                }
                if (selectedEnvironment.value?.environment === envId) {
                    selectedEnvironment.value = updatedEnv;
                }
                return updatedEnv;
            } else {
                throw new Error('Failed to update environment');
            }
        } catch (err: any) {
            console.error('Error updating environment:', err);
            error.value = err.response?.data?.error || err.message || 'Failed to update environment';
            return null;
        } finally {
            loading.value = false;
        }
    };

    // Agent Options Actions
    const fetchAgentOptions = async (): Promise<void> => {
        loading.value = true;
        error.value = null;

        try {
            const response = await axios.get<{ success: boolean; data: AgentConfigOptions }>(
                '/api/config/agent-options'
            );

            if (response.data.success) {
                agentOptions.value = response.data.data;
            } else {
                throw new Error('Failed to fetch agent options');
            }
        } catch (err: any) {
            console.error('Error fetching agent options:', err);
            error.value = err.response?.data?.error || err.message || 'Failed to fetch agent options';
        } finally {
            loading.value = false;
        }
    };

    // Sync Actions
    const syncConfiguration = async (source: string, target: string, parameters?: Record<string, any>): Promise<boolean> => {
        loading.value = true;
        error.value = null;
        syncStatus.value = null;

        try {
            const response = await axios.post<{ success: boolean; data: { syncId: string; status: string; message: string } }>(
                '/api/config/sync',
                { source, target, parameters }
            );

            if (response.data.success) {
                syncStatus.value = response.data.data;
                return true;
            } else {
                throw new Error('Failed to start sync');
            }
        } catch (err: any) {
            console.error('Error syncing configuration:', err);
            error.value = err.response?.data?.error || err.message || 'Failed to sync configuration';
            return false;
        } finally {
            loading.value = false;
        }
    };

    // Selection helpers
    const setSelectedTemplate = (template: ConfigTemplate | null): void => {
        selectedTemplate.value = template;
    };

    const setSelectedDeployment = (deployment: DeploymentConfiguration | null): void => {
        selectedDeployment.value = deployment;
    };

    const setSelectedEnvironment = (environment: EnvironmentConfiguration | null): void => {
        selectedEnvironment.value = environment;
    };

    const clearError = (): void => {
        error.value = null;
    };

    const clearSyncStatus = (): void => {
        syncStatus.value = null;
    };

    return {
        // State
        templates,
        selectedTemplate,
        deployments,
        selectedDeployment,
        environments,
        selectedEnvironment,
        agentOptions,
        loading,
        error,
        syncStatus,
        // Computed
        templateStats,
        deploymentStats,
        environmentStats,
        // Actions
        fetchTemplates,
        fetchTemplate,
        createTemplate,
        updateTemplate,
        deleteTemplate,
        fetchDeployments,
        createDeployment,
        fetchEnvironments,
        updateEnvironment,
        fetchAgentOptions,
        syncConfiguration,
        setSelectedTemplate,
        setSelectedDeployment,
        setSelectedEnvironment,
        clearError,
        clearSyncStatus
    };
});
