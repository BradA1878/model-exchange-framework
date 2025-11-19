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
 * Planning Tools for MXF Agents
 * 
 * Provides structured planning and task breakdown capabilities
 * that agents can use to organize complex work.
 */

import { McpToolDefinition, McpToolHandlerContext, McpToolHandlerResult, McpToolResultContent } from '../McpServerTypes';
import { McpToolInput } from '../IMcpClient';
import { Logger } from '../../../utils/Logger';
import { v4 as uuidv4 } from 'uuid';
import { EventBus } from '../../../events/EventBus';
import { Events } from '../../../events/EventNames';
import { createChannelMessageEventPayload } from '../../../schemas/EventPayloadSchema';
import { createChannelMessage } from '../../../schemas/MessageSchemas';
import PlanModel from '../../../models/plan';

const logger = new Logger('debug', 'PlanningTools', 'server');

export interface PlanItem {
    id: string;
    title: string;
    description?: string;
    status: 'pending' | 'in_progress' | 'completed' | 'blocked';
    assignee?: string;
    dependencies?: string[];
    estimatedTime?: string;
    priority?: 'low' | 'medium' | 'high';
}

export interface Plan {
    id: string;
    title: string;
    createdBy: string;
    createdAt: number;
    items: PlanItem[];
    metadata?: Record<string, any>;
}

// Serialization locks to prevent parallel plan updates (like Cascade)
const planUpdateLocks = new Map<string, boolean>();

/**
 * Create a new plan with structured items
 */
export const planning_create: McpToolDefinition = {
    name: 'planning_create',
    description: 'Create a structured plan with multiple items/steps for organizing complex work',
    inputSchema: {
        type: 'object',
        properties: {
            title: {
                type: 'string',
                description: 'Title of the plan'
            },
            items: {
                type: 'array',
                description: 'List of plan items/steps',
                items: {
                    type: 'object',
                    properties: {
                        title: {
                            type: 'string',
                            description: 'Title of this plan item'
                        },
                        description: {
                            type: 'string',
                            description: 'Detailed description of what needs to be done'
                        },
                        assignee: {
                            type: 'string',
                            description: 'Agent ID responsible for this item (optional)'
                        },
                        dependencies: {
                            type: 'array',
                            items: { type: 'string' },
                            description: 'IDs of other items this depends on'
                        },
                        estimatedTime: {
                            type: 'string',
                            description: 'Estimated time to complete (e.g., "30 minutes", "2 hours")'
                        },
                        priority: {
                            type: 'string',
                            enum: ['low', 'medium', 'high'],
                            description: 'Priority level of this item'
                        }
                    },
                    required: ['title']
                }
            },
            metadata: {
                type: 'object',
                description: 'Additional metadata for the plan'
            }
        },
        required: ['title', 'items']
    },
    enabled: true,
    handler: async (input: McpToolInput, context: McpToolHandlerContext): Promise<McpToolHandlerResult> => {
        try {
            const planId = uuidv4();
            const planItems = (input.items || []).map((item: any, index: number) => ({
                id: `item-${index + 1}`,
                title: item.title || 'Untitled Item',
                description: item.description,
                status: 'pending',
                assignee: item.assignee,
                dependencies: item.dependencies,
                estimatedTime: item.estimatedTime,
                priority: item.priority || 'medium'
            }));

            // Save to MongoDB
            const planDoc = new PlanModel({
                planId,
                title: input.title,
                createdBy: context.agentId || 'system',
                channelId: context.channelId,
                items: planItems,
                metadata: input.metadata
            });

            await planDoc.save();

            const plan: Plan = {
                id: planId,
                title: input.title,
                createdBy: context.agentId || 'system',
                createdAt: planDoc.createdAt.getTime(),
                items: planItems,
                metadata: input.metadata
            };
            
            // Emit planning event
            if (context.channelId && context.agentId) {
                const channelMessage = createChannelMessage(
                    context.channelId,
                    context.agentId,
                    `📋 Created plan: ${plan.title} with ${plan.items.length} items`,
                    {
                        context: { 
                            planId: plan.id, 
                            planTitle: plan.title,
                            toolName: 'planning_create'
                        }
                    }
                );

                EventBus.server.emit(Events.Message.CHANNEL_MESSAGE, 
                    createChannelMessageEventPayload(
                        Events.Message.CHANNEL_MESSAGE,
                        context.agentId,
                        channelMessage
                    )
                );
            }


            const content: McpToolResultContent = {
                type: 'application/json',
                data: {
                    success: true,
                    planId: plan.id,
                    plan: plan,
                    message: `Created plan "${plan.title}" with ${plan.items.length} items`
                }
            };
            return { content };
        } catch (error) {
            logger.error(`Error creating plan: ${error}`);
            const content: McpToolResultContent = {
                type: 'application/json',
                data: {
                    error: `Failed to create plan: ${error instanceof Error ? error.message : String(error)}`
                }
            };
            return { content };
        }
    }
};

/**
 * Update the status of a plan item
 */
export const planning_update_item: McpToolDefinition = {
    name: 'planning_update_item',
    description: 'Update the status or details of a specific plan item',
    inputSchema: {
        type: 'object',
        properties: {
            planId: {
                type: 'string',
                description: 'ID of the plan containing the item'
            },
            itemId: {
                type: 'string',
                description: 'ID of the item to update'
            },
            status: {
                type: 'string',
                enum: ['pending', 'in_progress', 'completed', 'blocked'],
                description: 'New status for the item'
            },
            notes: {
                type: 'string',
                description: 'Additional notes about the update'
            }
        },
        required: ['planId', 'itemId']
    },
    enabled: true,
    handler: async (input: McpToolInput, context: McpToolHandlerContext): Promise<McpToolHandlerResult> => {
        try {
            // Check for serialization lock
            if (planUpdateLocks.get(input.planId)) {
                const content: McpToolResultContent = {
                    type: 'application/json',
                    data: {
                        error: `Plan ${input.planId} is currently being updated by another operation. Please try again.`
                    }
                };
                return { content };
            }
            
            // Acquire lock
            planUpdateLocks.set(input.planId, true);
            
            try {
                // Fetch plan from MongoDB
                const planDoc = await PlanModel.findOne({ planId: input.planId });
                if (!planDoc) {
                    const content: McpToolResultContent = {
                        type: 'application/json',
                        data: {
                            error: `Plan not found: ${input.planId}`
                        }
                    };
                    return { content };
                }

            const item = planDoc.items.find((i: any) => i.id === input.itemId);
            if (!item) {
                const content: McpToolResultContent = {
                    type: 'application/json',
                    data: {
                        error: `Item not found: ${input.itemId} in plan ${input.planId}`
                    }
                };
                return { content };
            }

            if (input.status) {
                item.status = input.status;
            }

            // Save updated plan to MongoDB
            await planDoc.save();

            // Emit update event
            EventBus.server.emit(Events.Message.CHANNEL_MESSAGE, {
                channelId: context.channelId,
                agentId: context.agentId,
                content: `✅ Updated plan item: ${item.title} → ${input.status || 'updated'}${input.notes ? ` (${input.notes})` : ''}`,
                metadata: { planId: input.planId, itemId: input.itemId, status: input.status }
            });
            
            // Emit plan step completion event for monitoring service
            if (input.status === 'completed') {
                EventBus.server.emit('plan:step_completed', {
                    data: {
                        planId: input.planId,
                        stepId: input.itemId,
                        completedBy: context.agentId
                    }
                });
            }


            const content: McpToolResultContent = {
                type: 'application/json',
                data: {
                    success: true,
                    planId: planDoc.planId,
                    updatedItem: item,
                    message: `Updated item "${item.title}" to ${input.status || 'updated'}`
                }
            };
            return { content };
            } finally {
                // Always release lock
                planUpdateLocks.delete(input.planId);
            }
        } catch (error) {
            logger.error(`Error updating plan item: ${error}`);
            const content: McpToolResultContent = {
                type: 'application/json',
                data: {
                    error: `Failed to update plan item: ${error instanceof Error ? error.message : String(error)}`
                }
            };
            return { content };
        }
    }
};

/**
 * View a plan and its current status
 */
export const planning_view: McpToolDefinition = {
    name: 'planning_view',
    description: 'View a plan and the current status of all its items',
    inputSchema: {
        type: 'object',
        properties: {
            planId: {
                type: 'string',
                description: 'ID of the plan to view (optional - shows all if not provided)'
            }
        }
    },
    enabled: true,
    handler: async (input: McpToolInput, context: McpToolHandlerContext): Promise<McpToolHandlerResult> => {
        try {
            if (input.planId) {
                // Fetch specific plan from MongoDB
                const planDoc = await PlanModel.findOne({ planId: input.planId });
                if (!planDoc) {
                    const content: McpToolResultContent = {
                        type: 'application/json',
                        data: {
                            error: `Plan not found: ${input.planId}`
                        }
                    };
                    return { content };
                }

                const plan = {
                    id: planDoc.planId,
                    title: planDoc.title,
                    createdBy: planDoc.createdBy,
                    createdAt: planDoc.createdAt.getTime(),
                    items: planDoc.items,
                    metadata: planDoc.metadata
                };

                const summary = {
                    total: plan.items.length,
                    pending: plan.items.filter((i: any) => i.status === 'pending').length,
                    inProgress: plan.items.filter((i: any) => i.status === 'in_progress').length,
                    completed: plan.items.filter((i: any) => i.status === 'completed').length,
                    blocked: plan.items.filter((i: any) => i.status === 'blocked').length
                };

                const content: McpToolResultContent = {
                    type: 'application/json',
                    data: {
                        success: true,
                        plan: plan,
                        summary: summary,
                        progress: Math.round((summary.completed / summary.total) * 100) + '%'
                    }
                };
                return { content };
            } else {
                // Return all plans for this channel from MongoDB
                const planDocs = context.channelId
                    ? await PlanModel.find({ channelId: context.channelId }).sort({ createdAt: -1 })
                    : await PlanModel.find({ createdBy: context.agentId }).sort({ createdAt: -1 });

                const channelPlans = planDocs.map(doc => ({
                    id: doc.planId,
                    title: doc.title,
                    createdBy: doc.createdBy,
                    createdAt: doc.createdAt.getTime(),
                    items: doc.items,
                    metadata: doc.metadata
                }));

                const allPlansFiltered = channelPlans.filter(
                    p => !context.channelId || p.metadata?.channelId === context.channelId
                );

                const content: McpToolResultContent = {
                    type: 'application/json',
                    data: {
                        success: true,
                        plans: channelPlans.map(p => ({
                            id: p.id,
                            title: p.title,
                            createdBy: p.createdBy,
                            itemCount: p.items.length,
                            completedCount: p.items.filter(i => i.status === 'completed').length
                        })),
                        count: channelPlans.length
                    }
                };
                return { content };
            }
        } catch (error) {
            logger.error(`Error viewing plan: ${error}`);
            const content: McpToolResultContent = {
                type: 'application/json',
                data: {
                    error: `Failed to view plan: ${error instanceof Error ? error.message : String(error)}`
                }
            };
            return { content };
        }
    }
};

/**
 * Share a plan with other agents
 */
export const planning_share: McpToolDefinition = {
    name: 'planning_share',
    description: 'Share a plan with specific agents or broadcast to all agents in the channel',
    inputSchema: {
        type: 'object',
        properties: {
            planId: {
                type: 'string',
                description: 'ID of the plan to share'
            },
            agentIds: {
                type: 'array',
                items: { type: 'string' },
                description: 'List of agent IDs to share with (optional - broadcasts if not provided)'
            },
            message: {
                type: 'string',
                description: 'Message to include when sharing the plan'
            }
        },
        required: ['planId']
    },
    enabled: true,
    handler: async (input: McpToolInput, context: McpToolHandlerContext): Promise<McpToolHandlerResult> => {
        try {
            // Fetch plan from MongoDB
            const planDoc = await PlanModel.findOne({ planId: input.planId });
            if (!planDoc) {
                const content: McpToolResultContent = {
                    type: 'application/json',
                    data: {
                        error: `Plan not found: ${input.planId}`
                    }
                };
                return { content };
            }

            const planSummary = `📋 **${planDoc.title}**\n` +
                planDoc.items.map((item: any, idx: number) =>
                    `${idx + 1}. ${item.title} [${item.status}]${item.assignee ? ` - @${item.assignee}` : ''}`
                ).join('\n');

            const fullMessage = input.message 
                ? `${input.message}\n\n${planSummary}`
                : planSummary;

            if (input.agentIds && input.agentIds.length > 0) {
                // Send to specific agents
                for (const agentId of input.agentIds) {
                    EventBus.server.emit(Events.Message.AGENT_MESSAGE, {
                        channelId: context.channelId,
                        senderId: context.agentId,
                        receiverId: agentId,
                        content: fullMessage,
                        metadata: { planId: input.planId, planShared: true }
                    });
                }
                
                const content: McpToolResultContent = {
                    type: 'application/json',
                    data: {
                        success: true,
                        message: `Shared plan with ${input.agentIds.length} agents`,
                        sharedWith: input.agentIds
                    }
                };
                return { content };
            } else {
                // Broadcast to channel
                EventBus.server.emit(Events.Message.CHANNEL_MESSAGE, {
                    channelId: context.channelId,
                    agentId: context.agentId,
                    content: fullMessage,
                    metadata: { planId: input.planId, planShared: true }
                });

                const content: McpToolResultContent = {
                    type: 'application/json',
                    data: {
                        success: true,
                        message: 'Broadcast plan to all agents in channel'
                    }
                };
                return { content };
            }
        } catch (error) {
            logger.error(`Error sharing plan: ${error}`);
            const content: McpToolResultContent = {
                type: 'application/json',
                data: {
                    error: `Failed to share plan: ${error instanceof Error ? error.message : String(error)}`
                }
            };
            return { content };
        }
    }
};

// Export all planning tools
export const PLANNING_TOOLS = [
    planning_create,
    planning_update_item,
    planning_view,
    planning_share
];

// Export tool names for easy reference
export const PLANNING_TOOL_NAMES = PLANNING_TOOLS.map(tool => tool.name);