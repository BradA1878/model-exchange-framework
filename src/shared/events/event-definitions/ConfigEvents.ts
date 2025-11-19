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
 * Configuration Events
 * 
 * Event definitions for configuration management, templates, and deployment settings
 */

export const ConfigEvents = {
    // Template management events
    TEMPLATE_CREATED: 'config:template:created',
    TEMPLATE_UPDATED: 'config:template:updated',
    TEMPLATE_DELETED: 'config:template:deleted',
    TEMPLATE_DEPLOYED: 'config:template:deployed',
    
    // Deployment configuration events
    DEPLOYMENT_CONFIG_UPDATED: 'config:deployment:updated',
    DEPLOYMENT_CONFIG_VALIDATED: 'config:deployment:validated',
    DEPLOYMENT_CONFIG_FAILED: 'config:deployment:failed',
    
    // Environment configuration events
    ENVIRONMENT_UPDATED: 'config:environment:updated',
    ENVIRONMENT_VALIDATED: 'config:environment:validated',
    
    // Configuration synchronization events
    CONFIG_SYNC_REQUESTED: 'config:sync:requested',
    CONFIG_SYNC_COMPLETED: 'config:sync:completed',
    CONFIG_SYNC_FAILED: 'config:sync:failed',
} as const;

export type ConfigEventName = typeof ConfigEvents[keyof typeof ConfigEvents];

/**
 * Template Types
 */
export type TemplateType = 'agent' | 'channel' | 'task' | 'workflow';

/**
 * Agent Template Interface
 */
export interface AgentTemplate {
    templateId: string;
    name: string;
    description: string;
    type: 'agent';
    version: string;
    configuration: {
        name: string;
        description: string;
        capabilities: string[];
        serviceTypes: string[];
        role: string;
        instructions: string;
        constraints: string[];
        context: Record<string, any>;
        memory: Record<string, any>;
    };
    deployment: {
        environment: string;
        resources: {
            memory?: string;
            cpu?: string;
        };
        scaling: {
            minInstances: number;
            maxInstances: number;
        };
    };
    metadata: {
        createdBy: string;
        createdAt: Date;
        updatedBy: string;
        updatedAt: Date;
        tags: string[];
        category: string;
    };
}

/**
 * Channel Template Interface
 */
export interface ChannelTemplate {
    templateId: string;
    name: string;
    description: string;
    type: 'channel';
    version: string;
    configuration: {
        name: string;
        description: string;
        privacy: 'public' | 'private' | 'restricted';
        requiresApproval: boolean;
        maxAgents: number;
        allowedRoles: string[];
        restrictions: string[];
        context: Record<string, any>;
        memory: Record<string, any>;
    };
    verification: {
        method: 'dns' | 'email' | 'file' | 'token';
        required: boolean;
        settings: Record<string, any>;
    };
    metadata: {
        createdBy: string;
        createdAt: Date;
        updatedBy: string;
        updatedAt: Date;
        tags: string[];
        category: string;
    };
}

/**
 * Deployment Configuration Interface
 */
export interface DeploymentConfiguration {
    configId: string;
    environment: 'development' | 'staging' | 'production';
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

/**
 * Environment Configuration Interface
 */
export interface EnvironmentConfiguration {
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
        validatedAt?: Date;
        validationErrors?: string[];
    };
}

/**
 * Configuration Sync Request Interface
 */
export interface ConfigSyncRequest {
    syncId: string;
    source: 'template' | 'deployment' | 'environment';
    target: string;
    parameters: Record<string, any>;
    requestedBy: string;
    requestedAt: Date;
}

/**
 * Template Deployment Interface
 */
export interface TemplateDeployment {
    deploymentId: string;
    templateId: string;
    templateType: TemplateType;
    targetEnvironment: string;
    instanceId: string;
    configuration: Record<string, any>;
    status: 'pending' | 'deploying' | 'deployed' | 'failed';
    deployedBy: string;
    deployedAt: Date;
    error?: string;
}

/**
 * Configuration Event Payloads
 */
export interface ConfigPayloads {
    'config:template:created': {
        template: AgentTemplate | ChannelTemplate;
        createdBy: string;
        timestamp: Date;
    };
    'config:template:updated': {
        templateId: string;
        template: Partial<AgentTemplate | ChannelTemplate>;
        updatedBy: string;
        timestamp: Date;
    };
    'config:template:deleted': {
        templateId: string;
        templateType: TemplateType;
        deletedBy: string;
        timestamp: Date;
    };
    'config:template:deployed': {
        deployment: TemplateDeployment;
        timestamp: Date;
    };
    'config:deployment:updated': {
        configId: string;
        configuration: DeploymentConfiguration;
        updatedBy: string;
        timestamp: Date;
    };
    'config:deployment:validated': {
        configId: string;
        validationResult: {
            valid: boolean;
            errors?: string[];
            warnings?: string[];
        };
        timestamp: Date;
    };
    'config:deployment:failed': {
        configId: string;
        error: string;
        timestamp: Date;
    };
    'config:environment:updated': {
        environment: string;
        configuration: EnvironmentConfiguration;
        updatedBy: string;
        timestamp: Date;
    };
    'config:environment:validated': {
        environment: string;
        validationResult: {
            valid: boolean;
            errors?: string[];
            warnings?: string[];
        };
        timestamp: Date;
    };
    'config:sync:requested': {
        request: ConfigSyncRequest;
        timestamp: Date;
    };
    'config:sync:completed': {
        syncId: string;
        result: Record<string, any>;
        timestamp: Date;
    };
    'config:sync:failed': {
        syncId: string;
        error: string;
        timestamp: Date;
    };
}
