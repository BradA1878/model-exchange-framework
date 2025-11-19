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
 * Bulk Operations Events
 * 
 * Event definitions for bulk operations on agents, channels, and tasks
 */

export const BulkEvents = {
    // Bulk agent operations
    AGENTS_BULK_CREATE_STARTED: 'bulk:agents:create:started',
    AGENTS_BULK_CREATE_COMPLETED: 'bulk:agents:create:completed',
    AGENTS_BULK_CREATE_FAILED: 'bulk:agents:create:failed',
    AGENTS_BULK_UPDATE_STARTED: 'bulk:agents:update:started',
    AGENTS_BULK_UPDATE_COMPLETED: 'bulk:agents:update:completed',
    AGENTS_BULK_UPDATE_FAILED: 'bulk:agents:update:failed',
    AGENTS_BULK_DELETE_STARTED: 'bulk:agents:delete:started',
    AGENTS_BULK_DELETE_COMPLETED: 'bulk:agents:delete:completed',
    AGENTS_BULK_DELETE_FAILED: 'bulk:agents:delete:failed',
    
    // Bulk channel operations
    CHANNELS_BULK_CREATE_STARTED: 'bulk:channels:create:started',
    CHANNELS_BULK_CREATE_COMPLETED: 'bulk:channels:create:completed',
    CHANNELS_BULK_CREATE_FAILED: 'bulk:channels:create:failed',
    CHANNELS_BULK_UPDATE_STARTED: 'bulk:channels:update:started',
    CHANNELS_BULK_UPDATE_COMPLETED: 'bulk:channels:update:completed',
    CHANNELS_BULK_UPDATE_FAILED: 'bulk:channels:update:failed',
    CHANNELS_BULK_DELETE_STARTED: 'bulk:channels:delete:started',
    CHANNELS_BULK_DELETE_COMPLETED: 'bulk:channels:delete:completed',
    CHANNELS_BULK_DELETE_FAILED: 'bulk:channels:delete:failed',
    
    // Bulk task operations
    TASKS_BULK_CREATE_STARTED: 'bulk:tasks:create:started',
    TASKS_BULK_CREATE_COMPLETED: 'bulk:tasks:create:completed',
    TASKS_BULK_CREATE_FAILED: 'bulk:tasks:create:failed',
    TASKS_BULK_ASSIGN_STARTED: 'bulk:tasks:assign:started',
    TASKS_BULK_ASSIGN_COMPLETED: 'bulk:tasks:assign:completed',
    TASKS_BULK_ASSIGN_FAILED: 'bulk:tasks:assign:failed',
    TASKS_BULK_UPDATE_STARTED: 'bulk:tasks:update:started',
    TASKS_BULK_UPDATE_COMPLETED: 'bulk:tasks:update:completed',
    TASKS_BULK_UPDATE_FAILED: 'bulk:tasks:update:failed',
    
    // Bulk operation progress
    BULK_OPERATION_PROGRESS: 'bulk:operation:progress',
    PROGRESS_UPDATE: 'bulk:operation:progress:update',
    BULK_OPERATION_CANCELLED: 'bulk:operation:cancelled',
} as const;

export type BulkEventName = typeof BulkEvents[keyof typeof BulkEvents];

/**
 * Bulk Operation Status
 */
export type BulkOperationStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

/**
 * Bulk Operation Result
 */
export interface BulkOperationResult<T = any> {
    operationId: string;
    status: BulkOperationStatus;
    totalItems: number;
    processedItems: number;
    successCount: number;
    successfulItems: number;  // Alias for successCount
    failureCount: number;
    failedItems: number;      // Alias for failureCount
    results: T[];
    errors: {
        index: number;
        item: any;
        error: string;
    }[];
    startedAt: Date;
    completedAt?: Date;
    duration?: number;
}

/**
 * Bulk Agent Create Request
 */
export interface BulkAgentCreateRequest {
    operationId: string;
    agents: Array<{
        name: string;
        description: string;
        capabilities: string[];
        serviceTypes: string[];
        role: string;
        instructions: string;
        constraints: string[];
        context?: Record<string, any>;
        memory?: Record<string, any>;
    }>;
    requestedBy: string;
    options?: {
        stopOnFirstError?: boolean;
        batchSize?: number;
    };
}

/**
 * Bulk Agent Update Request
 */
export interface BulkAgentUpdateRequest {
    operationId: string;
    updates: Array<{
        agentId: string;
        data: {
            name?: string;
            description?: string;
            capabilities?: string[];
            serviceTypes?: string[];
            role?: string;
            instructions?: string;
            constraints?: string[];
            status?: string;
            context?: Record<string, any>;
            memory?: Record<string, any>;
        };
    }>;
    requestedBy: string;
    options?: {
        stopOnFirstError?: boolean;
        batchSize?: number;
    };
}

/**
 * Bulk Agent Delete Request
 */
export interface BulkAgentDeleteRequest {
    operationId: string;
    agentIds: string[];
    requestedBy: string;
    options?: {
        stopOnFirstError?: boolean;
        batchSize?: number;
        force?: boolean;
    };
}

/**
 * Bulk Channel Create Request
 */
export interface BulkChannelCreateRequest {
    operationId: string;
    channels: Array<{
        name: string;
        description: string;
        privacy: 'public' | 'private' | 'restricted';
        requiresApproval: boolean;
        maxAgents: number;
        allowedRoles: string[];
        context?: Record<string, any>;
        memory?: Record<string, any>;
    }>;
    requestedBy: string;
    options?: {
        stopOnFirstError?: boolean;
        batchSize?: number;
    };
}

/**
 * Bulk Channel Update Request
 */
export interface BulkChannelUpdateRequest {
    operationId: string;
    updates: Array<{
        channelId: string;
        data: {
            name?: string;
            description?: string;
            privacy?: 'public' | 'private' | 'restricted';
            requiresApproval?: boolean;
            maxAgents?: number;
            allowedRoles?: string[];
            context?: Record<string, any>;
            memory?: Record<string, any>;
        };
    }>;
    requestedBy: string;
    options?: {
        stopOnFirstError?: boolean;
        batchSize?: number;
    };
}

/**
 * Bulk Task Create Request
 */
export interface BulkTaskCreateRequest {
    operationId: string;
    tasks: Array<{
        title: string;
        description: string;
        instructions: string;
        priority: number;
        channelId: string;
        assignmentStrategy: string;
        assignedAgentId?: string;
        coordinationMode?: string;
        maxParticipants?: number;
        metadata?: Record<string, any>;
    }>;
    requestedBy: string;
    options?: {
        stopOnFirstError?: boolean;
        batchSize?: number;
    };
}

/**
 * Bulk Task Assignment Request
 */
export interface BulkTaskAssignRequest {
    operationId: string;
    assignments: Array<{
        taskId: string;
        agentId: string;
        assignmentType: 'manual' | 'intelligent';
    }>;
    requestedBy: string;
    options?: {
        stopOnFirstError?: boolean;
        batchSize?: number;
    };
}

/**
 * Bulk Task Update Request
 */
export interface BulkTaskUpdateRequest {
    operationId: string;
    updates: Array<{
        taskId: string;
        data: {
            title?: string;
            description?: string;
            instructions?: string;
            priority?: number;
            status?: string;
            assignedAgentId?: string;
            metadata?: Record<string, any>;
        };
    }>;
    requestedBy: string;
    options?: {
        stopOnFirstError?: boolean;
        batchSize?: number;
    };
}

/**
 * Bulk Operation Progress
 */
export interface BulkOperationProgress {
    operationId: string;
    operationType: string;
    status: BulkOperationStatus;
    totalItems: number;
    processedItems: number;
    successCount: number;
    failureCount: number;
    currentBatch: number;
    totalBatches: number;
    estimatedTimeRemaining?: number;
    lastProcessedAt: Date;
}

/**
 * Bulk Events Payloads
 */
export interface BulkPayloads {
    // Agent bulk operations
    'bulk:agents:create:started': {
        request: BulkAgentCreateRequest;
        timestamp: Date;
    };
    'bulk:agents:create:completed': {
        operationId: string;
        result: BulkOperationResult;
        timestamp: Date;
    };
    'bulk:agents:create:failed': {
        operationId: string;
        error: string;
        timestamp: Date;
    };
    'bulk:agents:update:started': {
        request: BulkAgentUpdateRequest;
        timestamp: Date;
    };
    'bulk:agents:update:completed': {
        operationId: string;
        result: BulkOperationResult;
        timestamp: Date;
    };
    'bulk:agents:update:failed': {
        operationId: string;
        error: string;
        timestamp: Date;
    };
    'bulk:agents:delete:started': {
        request: BulkAgentDeleteRequest;
        timestamp: Date;
    };
    'bulk:agents:delete:completed': {
        operationId: string;
        result: BulkOperationResult;
        timestamp: Date;
    };
    'bulk:agents:delete:failed': {
        operationId: string;
        error: string;
        timestamp: Date;
    };
    
    // Channel bulk operations
    'bulk:channels:create:started': {
        request: BulkChannelCreateRequest;
        timestamp: Date;
    };
    'bulk:channels:create:completed': {
        operationId: string;
        result: BulkOperationResult;
        timestamp: Date;
    };
    'bulk:channels:create:failed': {
        operationId: string;
        error: string;
        timestamp: Date;
    };
    'bulk:channels:update:started': {
        request: BulkChannelUpdateRequest;
        timestamp: Date;
    };
    'bulk:channels:update:completed': {
        operationId: string;
        result: BulkOperationResult;
        timestamp: Date;
    };
    'bulk:channels:update:failed': {
        operationId: string;
        error: string;
        timestamp: Date;
    };
    'bulk:channels:delete:started': {
        request: BulkChannelDeleteRequest;
        timestamp: Date;
    };
    'bulk:channels:delete:completed': {
        operationId: string;
        result: BulkOperationResult;
        timestamp: Date;
    };
    'bulk:channels:delete:failed': {
        operationId: string;
        error: string;
        timestamp: Date;
    };
    
    // Task bulk operations
    'bulk:tasks:create:started': {
        request: BulkTaskCreateRequest;
        timestamp: Date;
    };
    'bulk:tasks:create:completed': {
        operationId: string;
        result: BulkOperationResult;
        timestamp: Date;
    };
    'bulk:tasks:create:failed': {
        operationId: string;
        error: string;
        timestamp: Date;
    };
    'bulk:tasks:assign:started': {
        request: BulkTaskAssignRequest;
        timestamp: Date;
    };
    'bulk:tasks:assign:completed': {
        operationId: string;
        result: BulkOperationResult;
        timestamp: Date;
    };
    'bulk:tasks:assign:failed': {
        operationId: string;
        error: string;
        timestamp: Date;
    };
    'bulk:tasks:update:started': {
        request: BulkTaskUpdateRequest;
        timestamp: Date;
    };
    'bulk:tasks:update:completed': {
        operationId: string;
        result: BulkOperationResult;
        timestamp: Date;
    };
    'bulk:tasks:update:failed': {
        operationId: string;
        error: string;
        timestamp: Date;
    };
    
    // General bulk operation events
    'bulk:operation:progress': {
        progress: BulkOperationProgress;
        timestamp: Date;
    };
    'bulk:operation:cancelled': {
        operationId: string;
        reason: string;
        timestamp: Date;
    };
}

/**
 * Missing interface for BulkChannelDeleteRequest
 */
export interface BulkChannelDeleteRequest {
    operationId: string;
    channelIds: string[];
    requestedBy: string;
    options?: {
        stopOnFirstError?: boolean;
        batchSize?: number;
        force?: boolean;
    };
}
