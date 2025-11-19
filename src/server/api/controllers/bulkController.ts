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
 * Bulk Operations Controller
 * 
 * Handles bulk operations for agents, channels, and tasks
 */

import { Request, Response } from 'express';
import { Logger } from '../../../shared/utils/Logger';
import { createStrictValidator } from '../../../shared/utils/validation';
import { BulkEvents } from '../../../shared/events/event-definitions/BulkEvents';
import { EventBus } from '../../../shared/events/EventBus';
import {
    BulkAgentCreateRequest,
    BulkChannelCreateRequest,
    BulkTaskCreateRequest,
    BulkAgentUpdateRequest,
    BulkTaskUpdateRequest,
    BulkAgentDeleteRequest,
    BulkChannelDeleteRequest,
    BulkOperationResult,
    BulkOperationProgress,
    BulkOperationStatus
} from '../../../shared/events/event-definitions/BulkEvents';
import { ChannelService } from '../../socket/services/ChannelService';
import { TaskService } from '../../socket/services/TaskService';

const logger = new Logger('debug', 'BulkController', 'server');

// Create validator instances
const validator = createStrictValidator();

// Define bulk request types based on entity type
interface BulkCreateRequest {
    entityType: 'agent' | 'channel' | 'task';
    items: any[];
    options?: {
        stopOnFirstError?: boolean;
        batchSize?: number;
    };
}

interface BulkUpdateRequest {
    entityType: 'agent' | 'task';
    items: any[];
    options?: {
        stopOnFirstError?: boolean;
        batchSize?: number;
    };
}

interface BulkDeleteRequest {
    entityType: 'agent' | 'channel' | 'task';
    ids: string[];
    options?: {
        stopOnFirstError?: boolean;
        batchSize?: number;
    };
}

/**
 * Bulk Operations Service for handling bulk operations
 */
class BulkOperationsService {
    private static instance: BulkOperationsService;
    private activeOperations: Map<string, BulkOperationResult> = new Map();

    private constructor() {}

    public static getInstance(): BulkOperationsService {
        if (!BulkOperationsService.instance) {
            BulkOperationsService.instance = new BulkOperationsService();
        }
        return BulkOperationsService.instance;
    }

    /**
     * Execute bulk create operation
     */
    public async executeBulkCreate(request: BulkCreateRequest, requestedBy: string): Promise<BulkOperationResult> {
        const operationId = `bulk_create_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        const result: BulkOperationResult = {
            operationId,
            status: 'running' as BulkOperationStatus,
            totalItems: request.items.length,
            processedItems: 0,
            successCount: 0,
            failureCount: 0,
            // Alias properties for backwards compatibility
            successfulItems: 0,
            failedItems: 0,
            results: [],
            errors: [],
            startedAt: new Date()
        };

        this.activeOperations.set(operationId, result);

        // Emit operation started event based on entity type
        const startEventName = request.entityType === 'agent' ? BulkEvents.AGENTS_BULK_CREATE_STARTED :
                              request.entityType === 'channel' ? BulkEvents.CHANNELS_BULK_CREATE_STARTED :
                              BulkEvents.TASKS_BULK_CREATE_STARTED;
        
        EventBus.server.emit(startEventName, {
            operationId,
            entityType: request.entityType,
            totalItems: request.items.length,
            requestedBy,
            timestamp: new Date()
        });


        try {
            await this.processBulkCreate(operationId, request);
            result.status = 'completed';
            result.completedAt = new Date();
            result.duration = result.completedAt.getTime() - result.startedAt.getTime();
            
            // Emit operation completed event based on entity type
            const completeEventName = request.entityType === 'agent' ? BulkEvents.AGENTS_BULK_CREATE_COMPLETED :
                                     request.entityType === 'channel' ? BulkEvents.CHANNELS_BULK_CREATE_COMPLETED :
                                     BulkEvents.TASKS_BULK_CREATE_COMPLETED;
            
            EventBus.server.emit(completeEventName, {
                operationId,
                result,
                timestamp: new Date()
            });

        } catch (error) {
            result.status = 'failed';
            result.completedAt = new Date();
            result.duration = result.completedAt.getTime() - result.startedAt.getTime();
            
            // Add error to errors array instead of single error property
            result.errors.push({
                index: -1,
                item: 'bulk_operation',
                error: error instanceof Error ? error.message : 'Unknown error'
            });
            
            // Emit operation failed event based on entity type
            const failEventName = request.entityType === 'agent' ? BulkEvents.AGENTS_BULK_CREATE_FAILED :
                                 request.entityType === 'channel' ? BulkEvents.CHANNELS_BULK_CREATE_FAILED :
                                 BulkEvents.TASKS_BULK_CREATE_FAILED;
            
            EventBus.server.emit(failEventName, {
                operationId,
                error: error instanceof Error ? error.message : 'Unknown error',
                timestamp: new Date()
            });

            logger.error(`Bulk create operation failed`, { operationId, error });
        }

        return result;
    }

    /**
     * Execute bulk update operation
     */
    public async executeBulkUpdate(request: BulkUpdateRequest, requestedBy: string): Promise<BulkOperationResult> {
        const operationId = `bulk_update_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        const result: BulkOperationResult = {
            operationId,
            status: 'running' as BulkOperationStatus,
            totalItems: request.items.length,
            processedItems: 0,
            successCount: 0,
            failureCount: 0,
            // Alias properties for backwards compatibility
            successfulItems: 0,
            failedItems: 0,
            results: [],
            errors: [],
            startedAt: new Date()
        };

        this.activeOperations.set(operationId, result);

        // Emit operation started event based on entity type
        const startEventName = request.entityType === 'agent' ? BulkEvents.AGENTS_BULK_UPDATE_STARTED :
                              BulkEvents.TASKS_BULK_UPDATE_STARTED;
        
        EventBus.server.emit(startEventName, {
            operationId,
            entityType: request.entityType,
            totalItems: request.items.length,
            requestedBy,
            timestamp: new Date()
        });


        try {
            await this.processBulkUpdate(operationId, request);
            result.status = 'completed';
            result.completedAt = new Date();
            result.duration = result.completedAt.getTime() - result.startedAt.getTime();
            
            // Emit operation completed event based on entity type
            const completeEventName = request.entityType === 'agent' ? BulkEvents.AGENTS_BULK_UPDATE_COMPLETED :
                                     BulkEvents.TASKS_BULK_UPDATE_COMPLETED;
            
            EventBus.server.emit(completeEventName, {
                operationId,
                result,
                timestamp: new Date()
            });

        } catch (error) {
            result.status = 'failed';
            result.completedAt = new Date();
            result.duration = result.completedAt.getTime() - result.startedAt.getTime();
            
            // Add error to errors array instead of single error property
            result.errors.push({
                index: -1,
                item: 'bulk_operation',
                error: error instanceof Error ? error.message : 'Unknown error'
            });
            
            // Emit operation failed event based on entity type
            const failEventName = request.entityType === 'agent' ? BulkEvents.AGENTS_BULK_UPDATE_FAILED :
                                 BulkEvents.TASKS_BULK_UPDATE_FAILED;
            
            EventBus.server.emit(failEventName, {
                operationId,
                error: error instanceof Error ? error.message : 'Unknown error',
                timestamp: new Date()
            });

            logger.error(`Bulk update operation failed`, { operationId, error });
        }

        return result;
    }

    /**
     * Execute bulk delete operation
     */
    public async executeBulkDelete(request: BulkDeleteRequest, requestedBy: string): Promise<BulkOperationResult> {
        const operationId = `bulk_delete_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        const result: BulkOperationResult = {
            operationId,
            status: 'running' as BulkOperationStatus,
            totalItems: request.ids.length,
            processedItems: 0,
            successCount: 0,
            failureCount: 0,
            // Alias properties for backwards compatibility
            successfulItems: 0,
            failedItems: 0,
            results: [],
            errors: [],
            startedAt: new Date()
        };

        this.activeOperations.set(operationId, result);

        // Emit operation started event based on entity type
        const startEventName = request.entityType === 'agent' ? BulkEvents.AGENTS_BULK_DELETE_STARTED :
                              request.entityType === 'channel' ? BulkEvents.CHANNELS_BULK_DELETE_STARTED :
                              'bulk:tasks:delete:started'; // No bulk task delete event defined
        
        EventBus.server.emit(startEventName, {
            operationId,
            entityType: request.entityType,
            totalItems: request.ids.length,
            requestedBy,
            timestamp: new Date()
        });


        try {
            await this.processBulkDelete(operationId, request);
            result.status = 'completed';
            result.completedAt = new Date();
            result.duration = result.completedAt.getTime() - result.startedAt.getTime();
            
            // Emit operation completed event based on entity type
            const completeEventName = request.entityType === 'agent' ? BulkEvents.AGENTS_BULK_DELETE_COMPLETED :
                                     request.entityType === 'channel' ? BulkEvents.CHANNELS_BULK_DELETE_COMPLETED :
                                     'bulk:tasks:delete:completed'; // No bulk task delete event defined
            
            EventBus.server.emit(completeEventName, {
                operationId,
                result,
                timestamp: new Date()
            });

        } catch (error) {
            result.status = 'failed';
            result.completedAt = new Date();
            result.duration = result.completedAt.getTime() - result.startedAt.getTime();
            
            // Add error to errors array instead of single error property
            result.errors.push({
                index: -1,
                item: 'bulk_operation',
                error: error instanceof Error ? error.message : 'Unknown error'
            });
            
            // Emit operation failed event based on entity type
            const failEventName = request.entityType === 'agent' ? BulkEvents.AGENTS_BULK_DELETE_FAILED :
                                 request.entityType === 'channel' ? BulkEvents.CHANNELS_BULK_DELETE_FAILED :
                                 'bulk:tasks:delete:failed'; // No bulk task delete event defined
            
            EventBus.server.emit(failEventName, {
                operationId,
                error: error instanceof Error ? error.message : 'Unknown error',
                timestamp: new Date()
            });

            logger.error(`Bulk delete operation failed`, { operationId, error });
        }

        return result;
    }

    /**
     * Get operation status
     */
    public getOperationStatus(operationId: string): BulkOperationResult | null {
        return this.activeOperations.get(operationId) || null;
    }

    /**
     * Process bulk create operation
     */
    private async processBulkCreate(operationId: string, request: BulkCreateRequest): Promise<void> {
        const result = this.activeOperations.get(operationId)!;
        const channelService = ChannelService.getInstance();
        const taskService = TaskService.getInstance();

        for (let i = 0; i < request.items.length; i++) {
            const item = request.items[i];
            
            try {
                let createdItem: any;
                
                switch (request.entityType) {
                    case 'agent':
                        // AgentService doesn't support create operations
                        // Agents are created through socket connections, not CRUD operations
                        throw new Error('Agent creation not supported through bulk operations. Agents connect through socket authentication.');
                    case 'channel':
                        // Extract channel details from item
                        const channelId = item.id || `channel_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                        const channelName = item.name || 'Bulk Created Channel';
                        const channelCreatedBy = item.createdBy || 'system';
                        createdItem = await channelService.createChannel(channelId, channelName, channelCreatedBy, item.metadata);
                        break;
                    case 'task':
                        // TaskService.createTask requires createdBy parameter
                        const taskCreatedBy = item.createdBy || 'system';
                        createdItem = await taskService.createTask(item, taskCreatedBy);
                        break;
                    default:
                        throw new Error(`Unsupported entity type: ${request.entityType}`);
                }
                
                result.results.push({
                    index: i,
                    id: createdItem.id,
                    success: true,
                    data: createdItem
                });
                result.successCount++;
                
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                result.errors.push({
                    index: i,
                    error: errorMessage,
                    item
                });
                result.failureCount++;
            }
            
            result.processedItems++;
            
            // Emit progress update every 10 items or on completion
            if (result.processedItems % 10 === 0 || result.processedItems === result.totalItems) {
                const progressUpdate: BulkOperationProgress = {
                    operationId,
                    processedItems: result.processedItems,
                    totalItems: result.totalItems,
                    successCount: result.successCount,
                    failureCount: result.failureCount,
                    operationType: 'create',
                    status: result.status,
                    currentBatch: 1,
                    totalBatches: 1,
                    lastProcessedAt: new Date()
                };
                
                EventBus.server.emit(BulkEvents.PROGRESS_UPDATE, progressUpdate);
            }
        }
    }

    /**
     * Process bulk update operation
     */
    private async processBulkUpdate(operationId: string, request: BulkUpdateRequest): Promise<void> {
        const result = this.activeOperations.get(operationId)!;
        const taskService = TaskService.getInstance();

        for (let i = 0; i < request.items.length; i++) {
            const item = request.items[i];
            
            try {
                let updatedItem: any;
                
                switch (request.entityType) {
                    case 'agent':
                        // AgentService doesn't support update operations
                        // Agent properties are managed through status and capabilities methods
                        throw new Error('Agent updates not supported through bulk operations. Use individual agent management methods.');
                    case 'task':
                        // TaskService has updateTask method available
                        updatedItem = await taskService.updateTask(item.id, item.updates);
                        break;
                    default:
                        throw new Error(`Unsupported entity type: ${request.entityType}`);
                }
                
                result.results.push({
                    index: i,
                    id: item.id,
                    success: true,
                    data: updatedItem
                });
                result.successCount++;
                
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                result.errors.push({
                    index: i,
                    error: errorMessage,
                    item
                });
                result.failureCount++;
            }
            
            result.processedItems++;
            
            // Emit progress update every 10 items or on completion
            if (result.processedItems % 10 === 0 || result.processedItems === result.totalItems) {
                const progressUpdate: BulkOperationProgress = {
                    operationId,
                    processedItems: result.processedItems,
                    totalItems: result.totalItems,
                    successCount: result.successCount,
                    failureCount: result.failureCount,
                    operationType: 'create',
                    status: result.status,
                    currentBatch: 1,
                    totalBatches: 1,
                    lastProcessedAt: new Date()
                };
                
                EventBus.server.emit(BulkEvents.PROGRESS_UPDATE, progressUpdate);
            }
        }
    }

    /**
     * Process bulk delete operation
     */
    private async processBulkDelete(operationId: string, request: BulkDeleteRequest): Promise<void> {
        const result = this.activeOperations.get(operationId)!;
        const channelService = ChannelService.getInstance();

        for (let i = 0; i < request.ids.length; i++) {
            const id = request.ids[i];
            
            try {
                switch (request.entityType) {
                    case 'agent':
                        // AgentService doesn't support delete operations
                        // Agents disconnect through socket disconnection, not deletion
                        throw new Error('Agent deletion not supported through bulk operations. Agents disconnect through socket disconnection.');
                    case 'channel':
                        // ChannelService.deleteChannel requires agentId parameter
                        const agentId = 'system'; // Use system as the agent performing bulk delete
                        channelService.deleteChannel(id, agentId);
                        break;
                    case 'task':
                        // TaskService doesn't have cancelTask method
                        // Tasks are managed through completion/status updates
                        throw new Error('Task deletion not supported through bulk operations. Use task completion or status update methods.');
                    default:
                        throw new Error(`Unsupported entity type: ${request.entityType}`);
                }
                
                result.results.push({
                    index: i,
                    id,
                    success: true,
                    data: { deleted: true }
                });
                result.successCount++;
                
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                result.errors.push({
                    index: i,
                    error: errorMessage,
                    item: { id }
                });
                result.failureCount++;
            }
            
            result.processedItems++;
            
            // Emit progress update every 10 items or on completion
            if (result.processedItems % 10 === 0 || result.processedItems === result.totalItems) {
                const progressUpdate: BulkOperationProgress = {
                    operationId,
                    processedItems: result.processedItems,
                    totalItems: result.totalItems,
                    successCount: result.successCount,
                    failureCount: result.failureCount,
                    operationType: 'create',
                    status: result.status,
                    currentBatch: 1,
                    totalBatches: 1,
                    lastProcessedAt: new Date()
                };
                
                EventBus.server.emit(BulkEvents.PROGRESS_UPDATE, progressUpdate);
            }
        }
    }
}

/**
 * Bulk create entities
 */
export const bulkCreate = async (req: Request, res: Response): Promise<void> => {
    try {
        const { entityType, items, options } = req.body;
        const requestedBy = (req as any).user?.id || 'system';
        
        // Validation
        validator.assertIsString(entityType, 'entityType');
        validator.assertIsArray(items, 'items');
        
        const validTypes = ['agent', 'channel', 'task'];
        if (!validTypes.includes(entityType)) {
            res.status(400).json({
                success: false,
                error: `Invalid entity type. Must be one of: ${validTypes.join(', ')}`
            });
            return;
        }
        
        const request: BulkCreateRequest = {
            entityType,
            items,
            options: options || {}
        };
        
        
        const bulkService = BulkOperationsService.getInstance();
        const result = await bulkService.executeBulkCreate(request, requestedBy);
        
        res.json({
            success: true,
            data: result
        });
        
    } catch (error) {
        logger.error('Failed to execute bulk create', error);
        res.status(500).json({
            success: false,
            error: 'Failed to execute bulk create operation'
        });
    }
};

/**
 * Bulk update entities
 */
export const bulkUpdate = async (req: Request, res: Response): Promise<void> => {
    try {
        const { entityType, items, options } = req.body;
        const requestedBy = (req as any).user?.id || 'system';
        
        // Validation
        validator.assertIsString(entityType, 'entityType');
        validator.assertIsArray(items, 'items');
        
        const validTypes = ['task']; // Only task updates supported
        if (!validTypes.includes(entityType)) {
            res.status(400).json({
                success: false,
                error: `Invalid entity type. Must be one of: ${validTypes.join(', ')}`
            });
            return;
        }
        
        const request: BulkUpdateRequest = {
            entityType,
            items,
            options: options || {}
        };
        
        
        const bulkService = BulkOperationsService.getInstance();
        const result = await bulkService.executeBulkUpdate(request, requestedBy);
        
        res.json({
            success: true,
            data: result
        });
        
    } catch (error) {
        logger.error('Failed to execute bulk update', error);
        res.status(500).json({
            success: false,
            error: 'Failed to execute bulk update operation'
        });
    }
};

/**
 * Bulk delete entities
 */
export const bulkDelete = async (req: Request, res: Response): Promise<void> => {
    try {
        const { entityType, ids, options } = req.body;
        const requestedBy = (req as any).user?.id || 'system';
        
        // Validation
        validator.assertIsString(entityType, 'entityType');
        validator.assertIsArray(ids, 'ids');
        
        const validTypes = ['agent', 'channel', 'task'];
        if (!validTypes.includes(entityType)) {
            res.status(400).json({
                success: false,
                error: `Invalid entity type. Must be one of: ${validTypes.join(', ')}`
            });
            return;
        }
        
        const request: BulkDeleteRequest = {
            entityType,
            ids,
            options: options || {}
        };
        
        
        const bulkService = BulkOperationsService.getInstance();
        const result = await bulkService.executeBulkDelete(request, requestedBy);
        
        res.json({
            success: true,
            data: result
        });
        
    } catch (error) {
        logger.error('Failed to execute bulk delete', error);
        res.status(500).json({
            success: false,
            error: 'Failed to execute bulk delete operation'
        });
    }
};

/**
 * Get bulk operation status
 */
export const getBulkOperationStatus = async (req: Request, res: Response): Promise<void> => {
    try {
        const { operationId } = req.params;
        
        
        const bulkService = BulkOperationsService.getInstance();
        const result = bulkService.getOperationStatus(operationId);
        
        if (!result) {
            res.status(404).json({
                success: false,
                error: 'Operation not found'
            });
            return;
        }
        
        res.json({
            success: true,
            data: result
        });
        
    } catch (error) {
        logger.error('Failed to get bulk operation status', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get bulk operation status'
        });
    }
};
