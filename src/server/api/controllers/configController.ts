/**
 * Copyright 2024 Brad Anderson
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * @author Brad Anderson <BradA1878@pm.me>
 * @repository https://github.com/BradA1878/model-exchange-framework
 * @documentation https://brada1878.github.io/model-exchange-framework/
 */

/**
 * Configuration Controller
 * 
 * Handles configuration management operations
 */

import { Request, Response } from 'express';
import { Logger } from '../../../shared/utils/Logger';
import { createStrictValidator } from '../../../shared/utils/validation';
import { EventBus } from '../../../shared/events/EventBus';
import { ConfigEvents, type AgentTemplate, type ChannelTemplate, type DeploymentConfiguration, type EnvironmentConfiguration, type TemplateType, type ConfigSyncRequest } from '../../../shared/events/event-definitions/ConfigEvents';
import { LlmProviderType } from '../../../shared/protocols/mcp/LlmProviders';
import { createBaseEventPayload } from '../../../shared/schemas/EventPayloadSchema';

const logger = new Logger('debug', 'ConfigController', 'server');
const validator = createStrictValidator('ConfigController');

// Validation helper functions
const validateString = (value: any, fieldName: string): void => {
    if (typeof value !== 'string' || value.trim() === '') {
        throw new Error(`${fieldName} must be a non-empty string`);
    }
};

const validateObject = (value: any, fieldName: string): void => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`${fieldName} must be a valid object`);
    }
};

// Type aliases for compatibility
type ConfigTemplate = AgentTemplate | ChannelTemplate;
type DeploymentConfig = DeploymentConfiguration;
type EnvironmentConfig = EnvironmentConfiguration;

/**
 * Configuration Service for managing agent options
 */
class ConfigService {
    private agentOptions: any;
    private static instance: ConfigService;
    private templates: Map<string, ConfigTemplate> = new Map();
    private deploymentConfigs: Map<string, DeploymentConfig> = new Map();
    private environmentConfigs: Map<string, EnvironmentConfig> = new Map();

    private constructor() {
        this.initializeDefaultConfigs();
    }

    public static getInstance(): ConfigService {
        if (!ConfigService.instance) {
            ConfigService.instance = new ConfigService();
        }
        return ConfigService.instance;
    }

    /**
     * Initialize default configurations
     */
    private initializeDefaultConfigs(): void {
        // Default environment configurations
        const defaultEnvironments: EnvironmentConfig[] = [
            {
                environment: 'development',
                variables: {
                    NODE_ENV: 'development',
                    LOG_LEVEL: 'debug',
                    ENABLE_DEBUGGING: 'true'
                },
                secrets: [],
                endpoints: {
                    api: `http://localhost:${process.env.MXF_PORT || 3001}/api`,
                    websocket: `ws://localhost:${process.env.MXF_PORT || 3001}`,
                    health: `http://localhost:${process.env.MXF_PORT || 3001}/health`
                },
                validation: {
                    validated: true
                }
            },
            {
                environment: 'production',
                variables: {
                    NODE_ENV: 'production',
                    LOG_LEVEL: 'info',
                    ENABLE_DEBUGGING: 'false'
                },
                secrets: [],
                endpoints: {
                    api: 'https://api.production.com/api',
                    websocket: 'wss://api.production.com',
                    health: 'https://api.production.com/health'
                },
                validation: {
                    validated: false
                }
            }
        ];

        defaultEnvironments.forEach(env => {
            this.environmentConfigs.set(env.environment, env);
        });

        // Default agent template
        const defaultAgentTemplate: AgentTemplate = {
            templateId: 'default-agent',
            name: 'Default Agent Template',
            description: 'Standard configuration template for MXF agents',
            type: 'agent',
            version: '1.0.0',
            configuration: {
                name: 'Default Agent',
                description: 'Standard MXF agent configuration',
                capabilities: ['reasoning', 'analysis'],
                serviceTypes: ['chat', 'analysis'],
                role: 'assistant',
                instructions: 'Provide helpful assistance and analysis',
                constraints: ['no_harmful_content', 'accurate_information'],
                context: {},
                memory: {}
            },
            deployment: {
                environment: 'development',
                resources: {
                    memory: '512MB',
                    cpu: '0.5'
                },
                scaling: {
                    minInstances: 1,
                    maxInstances: 5
                }
            },
            metadata: {
                createdBy: 'system',
                createdAt: new Date(),
                updatedBy: 'system',
                updatedAt: new Date(),
                tags: ['default', 'agent'],
                category: 'standard'
            }
        };

        this.templates.set(defaultAgentTemplate.templateId, defaultAgentTemplate);

        // Default channel template
        const defaultChannelTemplate: ChannelTemplate = {
            templateId: 'default-channel',
            name: 'Default Channel Template',
            description: 'Standard configuration template for MXF channels',
            type: 'channel',
            version: '1.0.0',
            configuration: {
                name: 'Default Channel',
                description: 'Standard MXF channel configuration',
                privacy: 'public' as const,
                requiresApproval: false,
                maxAgents: 50,
                allowedRoles: ['user', 'admin'],
                restrictions: [],
                context: {},
                memory: {}
            },
            verification: {
                method: 'token' as const,
                required: false,
                settings: {}
            },
            metadata: {
                createdBy: 'system',
                createdAt: new Date(),
                updatedBy: 'system',
                updatedAt: new Date(),
                tags: ['default', 'channel'],
                category: 'standard'
            }
        };

        this.templates.set(defaultChannelTemplate.templateId, defaultChannelTemplate);
    }

    /**
     * Get all configuration templates
     */
    public async getAllTemplates(type?: string): Promise<ConfigTemplate[]> {
        const templates = Array.from(this.templates.values());
        return type ? templates.filter(template => template.type === type) : templates;
    }

    /**
     * Get configuration template by ID
     */
    public async getTemplate(templateId: string): Promise<ConfigTemplate | null> {
        return this.templates.get(templateId) || null;
    }

    /**
     * Create new configuration template
     */
    public async createTemplate(templateData: Partial<ConfigTemplate>, createdBy: string): Promise<ConfigTemplate> {
        const templateId = `template_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        let template: ConfigTemplate;
        
        if (templateData.type === 'agent') {
            template = {
                templateId,
                name: templateData.name!,
                description: templateData.description || '',
                type: 'agent',
                version: templateData.version || '1.0.0',
                configuration: {
                    name: templateData.name!,
                    description: templateData.description || '',
                    capabilities: [],
                    serviceTypes: [],
                    role: 'assistant',
                    instructions: '',
                    constraints: [],
                    context: {},
                    memory: {}
                },
                deployment: {
                    environment: 'development',
                    resources: {},
                    scaling: {
                        minInstances: 1,
                        maxInstances: 5
                    }
                },
                metadata: {
                    createdBy,
                    createdAt: new Date(),
                    updatedBy: createdBy,
                    updatedAt: new Date(),
                    tags: [],
                    category: 'custom'
                }
            } as AgentTemplate;
        } else {
            template = {
                templateId,
                name: templateData.name!,
                description: templateData.description || '',
                type: 'channel',
                version: templateData.version || '1.0.0',
                configuration: {
                    name: templateData.name!,
                    description: templateData.description || '',
                    privacy: 'public',
                    requiresApproval: false,
                    maxAgents: 50,
                    allowedRoles: ['user'],
                    restrictions: [],
                    context: {},
                    memory: {}
                },
                verification: {
                    method: 'token',
                    required: false,
                    settings: {}
                },
                metadata: {
                    createdBy,
                    createdAt: new Date(),
                    updatedBy: createdBy,
                    updatedAt: new Date(),
                    tags: [],
                    category: 'custom'
                }
            } as ChannelTemplate;
        }

        this.templates.set(templateId, template);

        // Emit template created event
        EventBus.server.emit(ConfigEvents.TEMPLATE_CREATED, createBaseEventPayload(
            ConfigEvents.TEMPLATE_CREATED,
            'SYSTEM',
            'CONFIG',
            {
                template,
                timestamp: new Date()
            },
            { source: 'ConfigService' }
        ));

        return template;
    }

    /**
     * Update configuration template
     */
    public async updateTemplate(templateId: string, updates: Partial<ConfigTemplate>, updatedBy: string): Promise<ConfigTemplate> {
        const existing = this.templates.get(templateId);
        if (!existing) {
            throw new Error(`Template not found: ${templateId}`);
        }

        let updated: ConfigTemplate;
        if (existing.type === 'agent') {
            updated = {
                ...existing,
                ...updates,
                templateId,
                type: 'agent',
                metadata: {
                    ...existing.metadata,
                    updatedBy,
                    updatedAt: new Date()
                }
            } as AgentTemplate;
        } else {
            updated = {
                ...existing,
                ...updates,
                templateId,
                type: 'channel',
                metadata: {
                    ...existing.metadata,
                    updatedBy,
                    updatedAt: new Date()
                }
            } as ChannelTemplate;
        }

        this.templates.set(templateId, updated);

        // Emit template updated event
        EventBus.server.emit(ConfigEvents.TEMPLATE_UPDATED, createBaseEventPayload(
            ConfigEvents.TEMPLATE_UPDATED,
            'SYSTEM',
            'CONFIG',
            {
                templateId,
                template: updated,
                updatedBy,
                timestamp: new Date()
            },
            { source: 'ConfigService' }
        ));

        return updated;
    }

    /**
     * Delete configuration template
     */
    public async deleteTemplate(templateId: string, deletedBy: string): Promise<void> {
        const template = this.templates.get(templateId);
        if (!template) {
            throw new Error(`Template not found: ${templateId}`);
        }

        this.templates.delete(templateId);

        // Emit template deleted event
        EventBus.server.emit(ConfigEvents.TEMPLATE_DELETED, createBaseEventPayload(
            ConfigEvents.TEMPLATE_DELETED,
            'SYSTEM',
            'CONFIG',
            {
                templateId,
                deletedBy,
                timestamp: new Date()
            },
            { source: 'ConfigService' }
        ));

    }

    /**
     * Get all deployment configurations
     */
    public async getAllDeploymentConfigs(): Promise<DeploymentConfig[]> {
        return Array.from(this.deploymentConfigs.values());
    }

    /**
     * Get deployment configuration by ID
     */
    public async getDeploymentConfig(configId: string): Promise<DeploymentConfig | null> {
        return this.deploymentConfigs.get(configId) || null;
    }

    /**
     * Create deployment configuration
     */
    public async createDeploymentConfig(configData: Partial<DeploymentConfiguration>, createdBy: string): Promise<DeploymentConfiguration> {
        const configId = `deploy_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        const config: DeploymentConfiguration = {
            configId,
            environment: configData.environment || 'development',
            version: configData.version || '1.0.0',
            settings: {
                database: {
                    host: 'localhost',
                    port: 27017,
                    name: 'mxf',
                    ssl: false
                },
                redis: {
                    host: 'localhost',
                    port: 6379,
                    ssl: false
                },
                authentication: {
                    jwtSecret: 'default-secret',
                    keyValidation: true,
                    sessionTimeout: 3600
                },
                performance: {
                    maxConnections: 100,
                    taskTimeout: 30000,
                    memoryLimit: '512MB'
                },
                features: {
                    intelligentAssignment: true,
                    analytics: true,
                    monitoring: true
                }
            },
            resources: {
                instances: 1,
                memory: '512MB',
                cpu: '500m',
                storage: '1GB'
            },
            monitoring: {
                enabled: true,
                alerting: true,
                metricsRetention: '7d'
            },
            metadata: {
                deployedBy: createdBy,
                deployedAt: new Date(),
                updatedBy: createdBy,
                updatedAt: new Date(),
                notes: 'Default deployment configuration'
            }
        };

        this.deploymentConfigs.set(configId, config);

        // Emit deployment config created event
        EventBus.server.emit(ConfigEvents.DEPLOYMENT_CONFIG_UPDATED, createBaseEventPayload(
            ConfigEvents.DEPLOYMENT_CONFIG_UPDATED,
            'SYSTEM',
            'CONFIG',
            {
                config,
                timestamp: new Date()
            },
            { source: 'ConfigService' }
        ));

        return config;
    }

    /**
     * Update deployment configuration
     */
    public async updateDeploymentConfig(configId: string, updates: Partial<DeploymentConfiguration>, updatedBy: string): Promise<DeploymentConfiguration> {
        const existing = this.deploymentConfigs.get(configId);
        if (!existing) {
            throw new Error(`Deployment configuration not found: ${configId}`);
        }

        const updated: DeploymentConfiguration = {
            ...existing,
            ...updates,
            metadata: {
                ...existing.metadata,
                updatedBy,
                updatedAt: new Date()
            }
        };

        this.deploymentConfigs.set(configId, updated);

        // Emit deployment config updated event
        EventBus.server.emit(ConfigEvents.DEPLOYMENT_CONFIG_UPDATED, createBaseEventPayload(
            ConfigEvents.DEPLOYMENT_CONFIG_UPDATED,
            'SYSTEM',
            'CONFIG',
            {
                configId,
                config: updated,
                updatedBy,
                timestamp: new Date()
            },
            { source: 'ConfigService' }
        ));

        return updated;
    }

    /**
     * Get all environment configurations
     */
    public async getAllEnvironmentConfigs(): Promise<EnvironmentConfig[]> {
        return Array.from(this.environmentConfigs.values());
    }

    /**
     * Get environment configuration by ID
     */
    public async getEnvironmentConfig(envId: string): Promise<EnvironmentConfig | null> {
        return this.environmentConfigs.get(envId) || null;
    }

    /**
     * Update environment configuration
     */
    public async updateEnvironmentConfig(envId: string, updates: Partial<EnvironmentConfig>, updatedBy: string): Promise<EnvironmentConfig> {
        const existing = this.environmentConfigs.get(envId);
        if (!existing) {
            throw new Error(`Environment configuration not found: ${envId}`);
        }

        const updated: EnvironmentConfig = {
            ...existing,
            ...updates
            // No id property - EnvironmentConfiguration uses environment as key
        };

        this.environmentConfigs.set(envId, updated);

        // Emit environment updated event
        EventBus.server.emit(ConfigEvents.ENVIRONMENT_UPDATED, createBaseEventPayload(
            ConfigEvents.ENVIRONMENT_UPDATED,
            'SYSTEM',
            'CONFIG',
            {
                environmentId: envId,
                config: updated,
                updatedBy,
                timestamp: new Date()
            },
            { source: 'ConfigService' }
        ));

        return updated;
    }

    /**
     * Sync configuration from external source
     */
    public async syncConfiguration(request: ConfigSyncRequest): Promise<void> {

        // Emit sync started event
        EventBus.server.emit(ConfigEvents.CONFIG_SYNC_REQUESTED, createBaseEventPayload(
            ConfigEvents.CONFIG_SYNC_REQUESTED,
            'SYSTEM',
            'CONFIG',
            {
                request,
                timestamp: new Date()
            },
            { source: 'ConfigService' }
        ));

        try {
            // TODO: Implement actual sync logic based on source
            // For now, just simulate success
            await new Promise(resolve => setTimeout(resolve, 1000));

            // Emit sync completed event
            EventBus.server.emit(ConfigEvents.CONFIG_SYNC_COMPLETED, createBaseEventPayload(
                ConfigEvents.CONFIG_SYNC_COMPLETED,
                'SYSTEM',
                'CONFIG',
                {
                    syncId: request.syncId,
                    source: request.source,
                    timestamp: new Date()
                },
                { source: 'ConfigService' }
            ));

        } catch (error) {
            // Emit sync failed event
            EventBus.server.emit(ConfigEvents.CONFIG_SYNC_FAILED, createBaseEventPayload(
                ConfigEvents.CONFIG_SYNC_FAILED,
                'SYSTEM',
                'CONFIG',
                {
                    syncId: request.syncId,
                    source: request.source,
                    error: error instanceof Error ? error.message : 'Unknown error',
                    timestamp: new Date()
                },
                { source: 'ConfigService' }
            ));

            logger.error(`Configuration sync failed: ${request.syncId}`, error);
            throw error;
        }
    }
}

/**
 * Get all configuration templates
 */
export const getTemplates = async (req: Request, res: Response): Promise<void> => {
    try {
        const { type } = req.query;
        const configService = ConfigService.getInstance();
        
        
        const templates = await configService.getAllTemplates(type as string);
        
        res.json({
            success: true,
            data: templates,
            count: templates.length
        });
        
    } catch (error) {
        logger.error('Failed to get configuration templates', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get configuration templates'
        });
    }
};

/**
 * Get specific configuration template
 */
export const getTemplate = async (req: Request, res: Response): Promise<void> => {
    try {
        const { templateId } = req.params;
        const configService = ConfigService.getInstance();
        
        
        const template = await configService.getTemplate(templateId);
        
        if (!template) {
            res.status(404).json({
                success: false,
                error: 'Template not found'
            });
            return;
        }
        
        res.json({
            success: true,
            data: template
        });
        
    } catch (error) {
        logger.error('Failed to get configuration template', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get configuration template'
        });
    }
};

/**
 * Create new configuration template
 */
export const createTemplate = async (req: Request, res: Response): Promise<void> => {
    try {
        const templateData = req.body;
        const createdBy = (req as any).user?.id || 'system';
        const configService = ConfigService.getInstance();
        
        // Validation
        validateString(templateData.name, 'name');
        validateString(templateData.type, 'type');
        validateObject(templateData.content, 'content');
        
        
        const template = await configService.createTemplate(templateData, createdBy);
        
        res.status(201).json({
            success: true,
            data: template
        });
        
    } catch (error) {
        logger.error('Failed to create configuration template', error);
        res.status(500).json({
            success: false,
            error: 'Failed to create configuration template'
        });
    }
};

/**
 * Update configuration template
 */
export const updateTemplate = async (req: Request, res: Response): Promise<void> => {
    try {
        const { templateId } = req.params;
        const updates = req.body;
        const updatedBy = (req as any).user?.id || 'system';
        const configService = ConfigService.getInstance();
        
        
        const template = await configService.updateTemplate(templateId, updates, updatedBy);
        
        res.json({
            success: true,
            data: template
        });
        
    } catch (error) {
        logger.error('Failed to update configuration template', error);
        const status = error instanceof Error && error.message.includes('not found') ? 404 : 500;
        res.status(status).json({
            success: false,
            error: error instanceof Error ? error.message : 'Failed to update configuration template'
        });
    }
};

/**
 * Delete configuration template
 */
export const deleteTemplate = async (req: Request, res: Response): Promise<void> => {
    try {
        const { templateId } = req.params;
        const deletedBy = (req as any).user?.id || 'system';
        const configService = ConfigService.getInstance();
        
        
        await configService.deleteTemplate(templateId, deletedBy);
        
        res.json({
            success: true,
            message: 'Template deleted successfully'
        });
        
    } catch (error) {
        logger.error('Failed to delete configuration template', error);
        const status = error instanceof Error && error.message.includes('not found') ? 404 : 500;
        res.status(status).json({
            success: false,
            error: error instanceof Error ? error.message : 'Failed to delete configuration template'
        });
    }
};

/**
 * Get all deployment configurations
 */
export const getDeploymentConfigs = async (req: Request, res: Response): Promise<void> => {
    try {
        const configService = ConfigService.getInstance();
        
        
        const configs = await configService.getAllDeploymentConfigs();
        
        res.json({
            success: true,
            data: configs,
            count: configs.length
        });
        
    } catch (error) {
        logger.error('Failed to get deployment configurations', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get deployment configurations'
        });
    }
};

/**
 * Create deployment configuration
 */
export const createDeploymentConfig = async (req: Request, res: Response): Promise<void> => {
    try {
        const configData = req.body;
        const createdBy = (req as any).user?.id || 'system';
        const configService = ConfigService.getInstance();
        
        // Validation
        validateString(configData.name, 'name');
        validateString(configData.environment, 'environment');
        validateString(configData.templateId, 'templateId');
        validateObject(configData.configuration, 'configuration');
        
        
        const config = await configService.createDeploymentConfig(configData, createdBy);
        
        res.status(201).json({
            success: true,
            data: config
        });
        
    } catch (error) {
        logger.error('Failed to create deployment configuration', error);
        res.status(500).json({
            success: false,
            error: 'Failed to create deployment configuration'
        });
    }
};

/**
 * Get all environment configurations
 */
export const getEnvironmentConfigs = async (req: Request, res: Response): Promise<void> => {
    try {
        const configService = ConfigService.getInstance();
        
        
        const configs = await configService.getAllEnvironmentConfigs();
        
        res.json({
            success: true,
            data: configs,
            count: configs.length
        });
        
    } catch (error) {
        logger.error('Failed to get environment configurations', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get environment configurations'
        });
    }
};

/**
 * Update environment configuration
 */
export const updateEnvironmentConfig = async (req: Request, res: Response): Promise<void> => {
    try {
        const { envId } = req.params;
        const updates = req.body;
        const updatedBy = (req as any).user?.id || 'system';
        const configService = ConfigService.getInstance();
        
        
        const config = await configService.updateEnvironmentConfig(envId, updates, updatedBy);
        
        res.json({
            success: true,
            data: config
        });
        
    } catch (error) {
        logger.error('Failed to update environment configuration', error);
        const status = error instanceof Error && error.message.includes('not found') ? 404 : 500;
        res.status(status).json({
            success: false,
            error: error instanceof Error ? error.message : 'Failed to update environment configuration'
        });
    }
};

/**
 * Get agent configuration options for frontend forms
 */
export const getAgentConfigOptions = async (req: Request, res: Response): Promise<void> => {
    try {
        const configService = ConfigService.getInstance();
        
        
        // LLM Provider options
        const llmProviders = [
            { value: 'openai', label: 'OpenAI', requiresApiKey: true },
            { value: 'anthropic', label: 'Anthropic (Claude)', requiresApiKey: true },
            { value: 'openrouter', label: 'OpenRouter', requiresApiKey: true },
            { value: 'xai', label: 'xAI (Grok)', requiresApiKey: true },
            { value: 'gemini', label: 'Google Gemini', requiresApiKey: true },
            { value: 'ollama', label: 'Ollama (Local)', requiresApiKey: false },
            { value: 'custom', label: 'Custom Provider', requiresApiKey: true }
        ];
        
        // Default models for each provider
        const defaultModels = {
            openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],
            anthropic: ['claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022', 'claude-3-opus-20240229'],
            openrouter: ['google/gemini-2.0-flash-lite-001', 'x-ai/grok-3', 'anthropic/claude-3.5-sonnet'],
            xai: ['grok-2-1212', 'grok-beta'],
            gemini: ['gemini-1.5-pro', 'gemini-1.5-flash', 'gemini-2.0-flash-exp'],
            ollama: ['llama3.2:3b', 'llama3.1:8b', 'codellama:7b', 'mistral:7b'],
            custom: ['custom-model']
        };
        
        // Agent types
        const agentTypes = [
            { value: 'conversation', label: 'Conversation Agent' },
            { value: 'assistant', label: 'Task Assistant' },
            { value: 'analyzer', label: 'Data Analyzer' },
            { value: 'moderator', label: 'Content Moderator' },
            { value: 'specialist', label: 'Domain Specialist' },
            { value: 'custom', label: 'Custom Agent' }
        ];
        
        // Common capabilities
        const commonCapabilities = [
            'reasoning', 'analysis', 'conversation', 'code_generation', 'data_processing',
            'content_creation', 'translation', 'summarization', 'question_answering',
            'creative_writing', 'problem_solving', 'research', 'planning', 'moderation'
        ];
        
        // Common service types
        const commonServiceTypes = [
            'chat', 'completion', 'analysis', 'generation', 'translation',
            'summarization', 'qa', 'research', 'planning', 'coding'
        ];
        
        res.json({
            success: true,
            data: {
                llmProviders,
                defaultModels,
                agentTypes,
                commonCapabilities,
                commonServiceTypes,
                defaultSettings: {
                    temperature: 0.7,
                    maxTokens: 2048,
                    host: 'localhost',
                    port: parseInt(process.env.MXF_PORT || '3001'),
                    secure: false
                }
            }
        });
        
    } catch (error) {
        logger.error('Failed to get agent configuration options', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get agent configuration options'
        });
    }
};

/**
 * Sync configuration
 */
export const syncConfiguration = async (req: Request, res: Response): Promise<void> => {
    try {
        const { source, target, parameters } = req.body;
        const requestedBy = (req as any).user?.id || 'system';
        const configService = ConfigService.getInstance();
        
        // Validation
        validateString(source, 'source');
        validateString(target, 'target');
        
        const syncId = `sync_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        const request: ConfigSyncRequest = {
            syncId,
            source: source as 'template' | 'deployment' | 'environment',
            target,
            parameters: parameters || {},
            requestedBy,
            requestedAt: new Date()
        };
        
        
        // Start sync asynchronously
        configService.syncConfiguration(request).catch(error => {
            logger.error(`Configuration sync failed: ${syncId}`, error);
        });
        
        res.json({
            success: true,
            data: {
                syncId,
                status: 'started',
                message: 'Configuration sync initiated'
            }
        });
        
    } catch (error) {
        logger.error('Failed to start configuration sync', error);
        res.status(500).json({
            success: false,
            error: 'Failed to start configuration sync'
        });
    }
};
