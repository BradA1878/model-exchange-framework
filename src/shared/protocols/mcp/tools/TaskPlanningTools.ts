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
 * Task Planning Tools
 * 
 * Enhanced task creation tools that integrate with planning and completion monitoring
 */

import { McpToolDefinition, McpToolHandlerContext, McpToolHandlerResult, McpToolResultContent } from '../McpServerTypes';
import { McpToolInput } from '../IMcpClient';
import { Logger } from '../../../utils/Logger';
import { EventBus } from '../../../events/EventBus';
import { Events } from '../../../events/EventNames';
import { TaskEvents } from '../../../events/event-definitions/TaskEvents';
import { createTaskEventPayload } from '../../../schemas/EventPayloadSchema';
import { TaskCompletionConfig } from '../../../types/TaskCompletionTypes';
import { MemoryService } from '../../../services/MemoryService';
import { firstValueFrom } from 'rxjs';
import { v4 as uuidv4 } from 'uuid';

const logger = new Logger('debug', 'TaskPlanningTools', 'server');

// Serialization locks to prevent parallel plan updates
const planUpdateLocks = new Map<string, boolean>();

/**
 * Create a task with a completion plan
 */
export const task_create_with_plan: McpToolDefinition = {
    name: 'task_create_with_plan',
    description: 'Create a task with built-in completion criteria based on a plan. The task will automatically complete when plan steps are done.',
    inputSchema: {
        type: 'object',
        properties: {
            title: {
                type: 'string',
                description: 'Title of the task'
            },
            description: {
                type: 'string',
                description: 'Detailed description of what needs to be done'
            },
            completionPlan: {
                type: 'object',
                description: 'Plan-based completion criteria',
                properties: {
                    steps: {
                        type: 'array',
                        description: 'Steps that need to be completed',
                        items: {
                            type: 'object',
                            properties: {
                                title: {
                                    type: 'string',
                                    description: 'Step title'
                                },
                                description: {
                                    type: 'string',
                                    description: 'Step description'
                                },
                                critical: {
                                    type: 'boolean',
                                    description: 'Is this step critical for completion?',
                                    default: false
                                }
                            },
                            required: ['title']
                        }
                    },
                    completionType: {
                        type: 'string',
                        enum: ['all_steps', 'critical_steps', 'percentage'],
                        description: 'How to determine completion',
                        default: 'all_steps'
                    },
                    percentage: {
                        type: 'number',
                        description: 'Required percentage for percentage type (0-100)',
                        minimum: 0,
                        maximum: 100
                    }
                }
            },
            assignTo: {
                type: 'array',
                items: { type: 'string' },
                description: 'Agent IDs to assign this task to'
            },
            priority: {
                type: 'string',
                enum: ['low', 'medium', 'high'],
                default: 'medium'
            },
            absoluteTimeout: {
                type: 'number',
                description: 'Maximum time in milliseconds before task times out'
            }
        },
        required: ['title', 'description', 'completionPlan']
    },
    enabled: true,
    handler: async (input: McpToolInput, context: McpToolHandlerContext): Promise<McpToolHandlerResult> => {
        try {
            const startTime = Date.now();
            
            // First create the plan
            const planId = uuidv4();
            const plan = {
                id: planId,
                title: `${input.title} - Completion Plan`,
                createdBy: context.agentId,
                createdAt: Date.now(),
                items: input.completionPlan.steps.map((step: any, index: number) => ({
                    id: uuidv4(),
                    title: step.title,
                    description: step.description,
                    status: 'pending',
                    priority: step.critical ? 'high' : 'medium',
                    critical: step.critical || false,
                    order: index
                }))
            };
            
            // Store plan in channel memory using MemoryService
            const memoryService = MemoryService.getInstance();
            const channelMemory = await firstValueFrom(memoryService.getChannelMemory(context.channelId!));
            const currentSharedState = channelMemory.sharedState || {};
            await firstValueFrom(memoryService.updateChannelMemory(context.channelId!, {
                sharedState: {
                    ...currentSharedState,
                    [`plan:${planId}`]: {
                        ...plan,
                        metadata: {
                            type: 'task_completion_plan',
                            taskTitle: input.title
                        }
                    }
                }
            }));
            
            // Also store in planning tool's active plans for compatibility
            const activePlans = (global as any).activePlans || new Map();
            activePlans.set(planId, plan);
            (global as any).activePlans = activePlans;
            
            // Create completion config
            const completionConfig: TaskCompletionConfig = {
                primary: {
                    type: 'plan-based',
                    planId: planId,
                    completionType: input.completionPlan.completionType || 'all_steps',
                    percentage: input.completionPlan.percentage
                },
                absoluteTimeout: input.absoluteTimeout,
                timeoutBehavior: 'complete',
                allowManualCompletion: true
            };
            
            // Create the task with monitoring config
            const taskId = uuidv4();
            const taskPayload = createTaskEventPayload(
                TaskEvents.CREATE_REQUEST,
                context.agentId || 'system',
                context.channelId || 'default',
                {
                    taskId: taskId,
                    fromAgentId: context.agentId || 'system',
                    toAgentId: input.assignTo?.[0] || context.agentId || 'system',
                    task: {
                        channelId: context.channelId,
                        title: input.title,
                        description: `${input.description}\n\nThis task will automatically complete when the plan steps are finished.`,
                        assignmentScope: input.assignTo && input.assignTo.length > 1 ? 'multiple' : 'single',
                        assignmentStrategy: 'manual',
                        assignedAgentIds: input.assignTo || [context.agentId || 'system'],
                        coordinationMode: 'collaborative',
                        priority: input.priority || 'medium',
                        metadata: {
                            completionConfig: completionConfig,
                            planId: planId,
                            enableMonitoring: true
                        }
                    }
                }
            );
            
            EventBus.server.emit(TaskEvents.CREATE_REQUEST, taskPayload);
            
            
            const content: McpToolResultContent = {
                type: 'text',
                data: `Task created successfully with automatic completion monitoring.
                    
Task ID: ${taskId}
Plan ID: ${planId}
Total Steps: ${plan.items.length}
Critical Steps: ${plan.items.filter((s: any) => s.critical).length}
Completion Type: ${input.completionPlan.completionType || 'all_steps'}

The task will automatically complete when the plan criteria are met.`
            };
            
            return {
                content,
                metadata: {
                    processingTime: Date.now() - startTime,
                    taskId: taskId,
                    planId: planId
                }
            } as McpToolHandlerResult;
            
        } catch (error) {
            logger.error(`Failed to create task with plan: ${error}`);
            throw error;
        }
    }
};

/**
 * Create a task with custom completion criteria
 */
export const task_create_custom_completion: McpToolDefinition = {
    name: 'task_create_custom_completion',
    description: 'Create a task with custom completion criteria (SystemLLM evaluation, output-based, time-based, etc.)',
    inputSchema: {
        type: 'object',
        properties: {
            title: {
                type: 'string',
                description: 'Title of the task'
            },
            description: {
                type: 'string',
                description: 'Detailed description'
            },
            completionStrategy: {
                type: 'string',
                enum: ['systemllm-eval', 'output-based', 'time-based', 'event-based'],
                description: 'Type of completion strategy'
            },
            completionCriteria: {
                type: 'object',
                description: 'Strategy-specific criteria',
                properties: {
                    // For systemllm-eval
                    objectives: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Objectives that must be met (for systemllm-eval)'
                    },
                    evaluationInterval: {
                        type: 'number',
                        description: 'How often to evaluate in ms (for systemllm-eval)',
                        default: 30000
                    },
                    confidenceThreshold: {
                        type: 'number',
                        description: 'Required confidence 0-1 (for systemllm-eval)',
                        default: 0.8
                    },
                    // For output-based
                    requiredOutputs: {
                        type: 'array',
                        description: 'Required outputs (for output-based)',
                        items: {
                            type: 'object',
                            properties: {
                                type: {
                                    type: 'string',
                                    enum: ['message', 'tool_call', 'file', 'memory_entry']
                                },
                                pattern: {
                                    type: 'string',
                                    description: 'Regex pattern to match'
                                },
                                count: {
                                    type: 'number',
                                    description: 'Required count',
                                    default: 1
                                }
                            }
                        }
                    },
                    // For time-based
                    minimumDuration: {
                        type: 'number',
                        description: 'Minimum duration in ms (for time-based)'
                    },
                    maximumDuration: {
                        type: 'number',
                        description: 'Maximum duration in ms (for time-based)'
                    },
                    requireActivity: {
                        type: 'boolean',
                        description: 'Require some activity (for time-based)',
                        default: true
                    },
                    // For event-based
                    eventName: {
                        type: 'string',
                        description: 'Event name to watch for (for event-based)'
                    }
                }
            },
            assignTo: {
                type: 'array',
                items: { type: 'string' },
                description: 'Agent IDs to assign to'
            }
        },
        required: ['title', 'description', 'completionStrategy', 'completionCriteria']
    },
    enabled: true,
    handler: async (input: McpToolInput, context: McpToolHandlerContext): Promise<McpToolHandlerResult> => {
        try {
            const startTime = Date.now();
            
            // Build completion config based on strategy
            let primaryCriteria: any;
            
            switch (input.completionStrategy) {
                case 'systemllm-eval':
                    primaryCriteria = {
                        type: 'systemllm-eval',
                        objectives: input.completionCriteria.objectives || [],
                        evaluationInterval: input.completionCriteria.evaluationInterval || 30000,
                        confidenceThreshold: input.completionCriteria.confidenceThreshold || 0.8
                    };
                    break;
                    
                case 'output-based':
                    primaryCriteria = {
                        type: 'output-based',
                        requiredOutputs: input.completionCriteria.requiredOutputs || []
                    };
                    break;
                    
                case 'time-based':
                    primaryCriteria = {
                        type: 'time-based',
                        minimumDuration: input.completionCriteria.minimumDuration,
                        maximumDuration: input.completionCriteria.maximumDuration || 300000, // 5 min default
                        requireActivity: input.completionCriteria.requireActivity !== false
                    };
                    break;
                    
                case 'event-based':
                    primaryCriteria = {
                        type: 'event-based',
                        eventName: input.completionCriteria.eventName
                    };
                    break;
            }
            
            const completionConfig: TaskCompletionConfig = {
                primary: primaryCriteria,
                allowManualCompletion: true
            };
            
            // Create the task
            const taskId = uuidv4();
            const taskPayload = createTaskEventPayload(
                TaskEvents.CREATE_REQUEST,
                context.agentId || 'system',
                context.channelId || 'default',
                {
                    taskId: taskId,
                    fromAgentId: context.agentId || 'system',
                    toAgentId: input.assignTo?.[0] || context.agentId || 'system',
                    task: {
                        channelId: context.channelId,
                        title: input.title,
                        description: input.description,
                        assignmentScope: input.assignTo && input.assignTo.length > 1 ? 'multiple' : 'single',
                        assignmentStrategy: 'manual',
                        assignedAgentIds: input.assignTo || [context.agentId || 'system'],
                        coordinationMode: 'collaborative',
                        metadata: {
                            completionConfig: completionConfig,
                            enableMonitoring: true
                        }
                    }
                }
            );
            
            EventBus.server.emit(TaskEvents.CREATE_REQUEST, taskPayload);
            
            
            const content: McpToolResultContent = {
                type: 'text',
                data: `Task created with ${input.completionStrategy} completion monitoring.
                    
Task ID: ${taskId}
Strategy: ${input.completionStrategy}
${input.completionStrategy === 'systemllm-eval' ? `Objectives: ${input.completionCriteria.objectives?.length || 0}` : ''}
${input.completionStrategy === 'time-based' ? `Duration: ${input.completionCriteria.minimumDuration || 0}-${input.completionCriteria.maximumDuration}ms` : ''}

The task will be monitored and automatically completed when criteria are met.`
            };
            
            return {
                content,
                metadata: {
                    processingTime: Date.now() - startTime,
                    taskId: taskId
                }
            } as McpToolHandlerResult;
            
        } catch (error) {
            logger.error(`Failed to create task with custom completion: ${error}`);
            throw error;
        }
    }
};

/**
 * Link an existing task to a plan
 */
export const task_link_to_plan: McpToolDefinition = {
    name: 'task_link_to_plan',
    description: 'Link an existing task to a plan for automatic completion monitoring',
    inputSchema: {
        type: 'object',
        properties: {
            taskId: {
                type: 'string',
                description: 'ID of the existing task'
            },
            planId: {
                type: 'string',
                description: 'ID of the plan to link to'
            },
            completionType: {
                type: 'string',
                enum: ['all_steps', 'critical_steps', 'percentage'],
                default: 'all_steps'
            },
            percentage: {
                type: 'number',
                description: 'Required percentage (if using percentage type)',
                minimum: 0,
                maximum: 100
            }
        },
        required: ['taskId', 'planId']
    },
    enabled: true,
    handler: async (input: McpToolInput, context: McpToolHandlerContext): Promise<McpToolHandlerResult> => {
        try {
            const startTime = Date.now();
            
            // Check for serialization lock
            if (planUpdateLocks.get(input.planId)) {
                const content: McpToolResultContent = {
                    type: 'text',
                    data: `Plan ${input.planId} is currently being updated. Please try again.`
                };
                return { content };
            }
            
            // Acquire lock
            planUpdateLocks.set(input.planId, true);
            
            try {
                // Update task metadata to enable monitoring
            const updatePayload = {
                taskId: input.taskId,
                updates: {
                    metadata: {
                        completionConfig: {
                            primary: {
                                type: 'plan-based',
                                planId: input.planId,
                                completionType: input.completionType || 'all_steps',
                                percentage: input.percentage
                            },
                            allowManualCompletion: true
                        },
                        enableMonitoring: true
                    }
                }
            };
            
            EventBus.server.emit('task:update_metadata', updatePayload);
            
            
            const content: McpToolResultContent = {
                type: 'text',
                data: `Task successfully linked to plan for automatic completion monitoring.
                    
Task ID: ${input.taskId}
Plan ID: ${input.planId}
Completion Type: ${input.completionType || 'all_steps'}

The task will now automatically complete when plan criteria are met.`
            };
            
            return {
                content,
                metadata: {
                    processingTime: Date.now() - startTime
                }
            } as McpToolHandlerResult;
            } finally {
                // Always release lock
                planUpdateLocks.delete(input.planId);
            }
            
        } catch (error) {
            logger.error(`Failed to link task to plan: ${error}`);
            throw error;
        }
    }
};

/**
 * Get task monitoring status
 */
export const task_monitoring_status: McpToolDefinition = {
    name: 'task_monitoring_status',
    description: 'Get the current monitoring status and progress of a task',
    inputSchema: {
        type: 'object',
        properties: {
            taskId: {
                type: 'string',
                description: 'ID of the task to check'
            }
        },
        required: ['taskId']
    },
    enabled: true,
    handler: async (input: McpToolInput, context: McpToolHandlerContext): Promise<McpToolHandlerResult> => {
        try {
            const startTime = Date.now();
            
            // Request monitoring status
            const statusRequest = {
                taskId: input.taskId,
                requestId: uuidv4()
            };
            
            // This would be handled by the monitoring service
            EventBus.server.emit('monitoring:status_request', statusRequest);
            
            // For now, return a simple acknowledgment
            const content: McpToolResultContent = {
                type: 'text',
                data: `Monitoring status requested for task ${input.taskId}.
                    
Check the task events for completion notifications.`
            };
            
            return {
                content,
                metadata: {
                    processingTime: Date.now() - startTime
                }
            } as McpToolHandlerResult;
            
        } catch (error) {
            logger.error(`Failed to get monitoring status: ${error}`);
            throw error;
        }
    }
};

// Export all task planning tools
export const taskPlanningTools = [
    task_create_with_plan,
    task_create_custom_completion,
    task_link_to_plan,
    task_monitoring_status
];