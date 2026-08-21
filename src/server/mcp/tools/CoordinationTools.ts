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
 * @documentation https://mxf-dev.github.io/mxf/
 */

/**
 * CoordinationTools.ts
 * 
 * MCP tools for advanced agent coordination, collaboration, and workflow management.
 * Enables agents to formally request, accept, track, and complete collaborative tasks
 * within the MXF ecosystem.
 */

import { v4 as uuidv4 } from 'uuid';
import { createAgentMessage } from '@mxf-dev/core/schemas/MessageSchemas';
import { Logger } from '@mxf-dev/core/utils/Logger';
import { EventBus } from '@mxf-dev/core/events/EventBus';
import { Events } from '@mxf-dev/core/events/EventNames';
import { createAgentMessageEventPayload } from '@mxf-dev/core/schemas/EventPayloadSchema';
import { McpToolHandlerContext, McpToolHandlerResult, McpToolResultContent } from '@mxf-dev/core/protocols/mcp/McpServerTypes';
import type { FilterQuery } from 'mongoose';
import CoordinationModel, {
    CoordinationState,
    CoordinationType,
    ICoordination
} from '@mxf-dev/core/models/coordination';
import {
    requireChannelParticipants,
    requireCurrentChannelParticipant,
    requireExactToolTenantContext
} from './helpers/toolTenantContext';

const logger = new Logger('info', 'CoordinationTools', 'server');

// MongoDB persistence is now used for all coordination tracking

async function finalizeResponseState(
    coordination: ICoordination,
    channelId: string
): Promise<ICoordination> {
    const totalResponses = coordination.acceptedAgents.length + coordination.rejectedAgents.length;
    if (totalResponses !== coordination.targetAgents.length) {
        return coordination;
    }

    const nextState = coordination.acceptedAgents.length > 0
        ? CoordinationState.ACCEPTED
        : CoordinationState.REJECTED;

    return (await CoordinationModel.findOneAndUpdate(
        {
            _id: coordination._id,
            channelId,
            state: { $in: [CoordinationState.REQUESTED, CoordinationState.ACCEPTED] }
        },
        { $set: { state: nextState } },
        { new: true, runValidators: true }
    )) || coordination;
}

/**
 * MCP Tool: coordination_request
 * Request coordination with other agents for collaborative tasks
 */
export const coordinationRequestTool = {
    name: 'coordination_request',
    description: 'Request coordination with other agents for collaborative tasks with formal tracking',
    inputSchema: {
        type: 'object',
        properties: {
            targetAgents: {
                type: 'array',
                items: { type: 'string' },
                description: 'Array of agent IDs to coordinate with',
                minItems: 1
            },
            coordinationType: {
                type: 'string',
                enum: Object.values(CoordinationType),
                description: 'Type of coordination requested'
            },
            taskDescription: {
                type: 'string',
                description: 'Detailed description of the task requiring coordination'
            },
            requirements: {
                type: 'object',
                description: 'Requirements, constraints, or parameters for the coordination',
                properties: {
                    skills: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Required skills or capabilities'
                    },
                    resources: {
                        type: 'object',
                        description: 'Required resources or tools'
                    },
                    priority: {
                        type: 'string',
                        enum: ['low', 'medium', 'high', 'urgent'],
                        description: 'Task priority level'
                    }
                }
            },
            deadline: {
                type: 'number',
                description: 'Optional deadline timestamp for the coordination'
            },
            metadata: {
                type: 'object',
                description: 'Optional metadata for the coordination request'
            }
        },
        required: ['targetAgents', 'coordinationType', 'taskDescription']
    },

    handler: async (input: {
        targetAgents: string[];
        coordinationType: CoordinationType;
        taskDescription: string;
        requirements?: Record<string, any>;
        deadline?: number;
        metadata?: Record<string, any>;
    }, context: McpToolHandlerContext): Promise<McpToolHandlerResult> => {
        try {
            const { agentId, channelId } = requireExactToolTenantContext(context);
            requireCurrentChannelParticipant(channelId, agentId);
            const targetAgents = requireChannelParticipants(channelId, input.targetAgents);
            const coordinationId = `coord_${input.coordinationType}_${uuidv4()}`;

            // Save coordination request to MongoDB
            const coordinationDoc = new CoordinationModel({
                coordinationId,
                type: input.coordinationType,
                state: CoordinationState.REQUESTED,
                requestingAgent: agentId,
                targetAgents,
                acceptedAgents: [],
                rejectedAgents: [],
                taskDescription: input.taskDescription,
                requirements: input.requirements,
                deadline: input.deadline ? new Date(input.deadline) : undefined,
                channelId
            });

            await coordinationDoc.save();

            // Send coordination requests to target agents
            for (const targetAgentId of targetAgents) {
                const coordinationMessage = {
                    format: 'json',
                    data: {
                        type: 'coordination_request',
                        coordinationId,
                        coordinationType: input.coordinationType,
                        taskDescription: input.taskDescription,
                        requirements: input.requirements,
                        deadline: input.deadline,
                        requestingAgent: agentId,
                        metadata: input.metadata
                    }
                };

                const agentMessage = createAgentMessage(
                    agentId,
                    targetAgentId,
                    coordinationMessage,
                    {
                        metadata: {
                            correlationId: coordinationId,
                            priority: input.requirements?.priority || 'medium'
                        },
                        context: {
                            messageType: 'coordination_request',
                            coordinationId,
                            requestId: context.requestId
                        }
                    }
                );

                const payload = createAgentMessageEventPayload(
                    Events.Message.AGENT_MESSAGE,
                    agentId,
                    channelId,
                    agentMessage
                );

                EventBus.server.emit(Events.Message.AGENT_MESSAGE, payload);
            }


            const content: McpToolResultContent = {
                type: 'application/json',
                data: {
                    coordinationId,
                    status: 'requested',
                    targetAgents,
                    deadline: input.deadline
                }
            };
            return { content };
        } catch (error) {
            logger.error(`Failed to create coordination request: ${error}`);
            const content: McpToolResultContent = {
                type: 'application/json',
                data: {
                    error: `Failed to create coordination request: ${error instanceof Error ? error.message : String(error)}`
                }
            };
            return { content };
        }
    }
};

/**
 * MCP Tool: coordination_accept
 * Accept a coordination request from another agent
 */
export const coordinationAcceptTool = {
    name: 'coordination_accept',
    description: 'Accept a coordination request from another agent',
    inputSchema: {
        type: 'object',
        properties: {
            coordinationId: {
                type: 'string',
                description: 'ID of the coordination request to accept'
            },
            commitments: {
                type: 'object',
                description: 'Optional commitments or constraints from the accepting agent',
                properties: {
                    estimatedTime: {
                        type: 'number',
                        description: 'Estimated time to complete in milliseconds'
                    },
                    resources: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Resources this agent will provide'
                    },
                    constraints: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Any constraints or limitations'
                    }
                }
            },
            metadata: {
                type: 'object',
                description: 'Optional metadata for the acceptance'
            }
        },
        required: ['coordinationId']
    },

    handler: async (input: {
        coordinationId: string;
        commitments?: Record<string, any>;
        metadata?: Record<string, any>;
    }, context: McpToolHandlerContext): Promise<McpToolHandlerResult> => {
        try {
            const { agentId, channelId } = requireExactToolTenantContext(context);
            requireCurrentChannelParticipant(channelId, agentId);

            const existingCoordination = await CoordinationModel.findOne({
                coordinationId: input.coordinationId,
                channelId,
                targetAgents: agentId,
                state: CoordinationState.REQUESTED
            });
            if (!existingCoordination) {
                throw new Error(`Coordination ${input.coordinationId} not found`);
            }

            const acceptedCoordination = await CoordinationModel.findOneAndUpdate(
                {
                    coordinationId: input.coordinationId,
                    channelId,
                    targetAgents: agentId,
                    acceptedAgents: { $ne: agentId },
                    'rejectedAgents.agentId': { $ne: agentId },
                    state: CoordinationState.REQUESTED
                },
                { $addToSet: { acceptedAgents: agentId } },
                { new: true, runValidators: true }
            );
            if (!acceptedCoordination) {
                throw new Error('Coordination response was already recorded or is no longer available');
            }
            const coordinationDoc = await finalizeResponseState(acceptedCoordination, channelId);

            // Notify requesting agent
            const acceptanceMessage = {
                format: 'json',
                data: {
                    type: 'coordination_acceptance',
                    coordinationId: input.coordinationId,
                    acceptingAgent: agentId,
                    commitments: input.commitments,
                    metadata: input.metadata
                }
            };

            const agentMessage = createAgentMessage(
                agentId,
                coordinationDoc.requestingAgent,
                acceptanceMessage,
                {
                    metadata: {
                        correlationId: input.coordinationId
                    },
                    context: {
                        messageType: 'coordination_acceptance',
                        coordinationId: input.coordinationId
                    }
                }
            );

            const payload = createAgentMessageEventPayload(
                Events.Message.AGENT_MESSAGE,
                agentId,
                channelId,
                agentMessage
            );

            EventBus.server.emit(Events.Message.AGENT_MESSAGE, payload);


            const content: McpToolResultContent = {
                type: 'application/json',
                data: {
                    coordinationId: input.coordinationId,
                    status: 'accepted',
                    requestingAgent: coordinationDoc.requestingAgent,
                    commitments: input.commitments
                }
            };
            return { content };
        } catch (error) {
            logger.error(`Failed to accept coordination: ${error}`);
            const content: McpToolResultContent = {
                type: 'application/json',
                data: {
                    error: `Failed to accept coordination: ${error instanceof Error ? error.message : String(error)}`
                }
            };
            return { content };
        }
    }
};

/**
 * MCP Tool: coordination_reject
 * Reject a coordination request from another agent
 */
export const coordinationRejectTool = {
    name: 'coordination_reject',
    description: 'Reject a coordination request from another agent',
    inputSchema: {
        type: 'object',
        properties: {
            coordinationId: {
                type: 'string',
                description: 'ID of the coordination request to reject'
            },
            reason: {
                type: 'string',
                description: 'Reason for rejecting the coordination request'
            },
            alternatives: {
                type: 'array',
                items: { type: 'string' },
                description: 'Optional alternative suggestions'
            }
        },
        required: ['coordinationId', 'reason']
    },

    handler: async (input: {
        coordinationId: string;
        reason: string;
        alternatives?: string[];
    }, context: McpToolHandlerContext): Promise<McpToolHandlerResult> => {
        try {
            const { agentId, channelId } = requireExactToolTenantContext(context);
            requireCurrentChannelParticipant(channelId, agentId);

            const existingCoordination = await CoordinationModel.findOne({
                coordinationId: input.coordinationId,
                channelId,
                targetAgents: agentId,
                state: CoordinationState.REQUESTED
            });
            if (!existingCoordination) {
                throw new Error(`Coordination ${input.coordinationId} not found`);
            }

            const rejectedCoordination = await CoordinationModel.findOneAndUpdate(
                {
                    coordinationId: input.coordinationId,
                    channelId,
                    targetAgents: agentId,
                    acceptedAgents: { $ne: agentId },
                    'rejectedAgents.agentId': { $ne: agentId },
                    state: CoordinationState.REQUESTED
                },
                {
                    $push: {
                        rejectedAgents: {
                            agentId,
                            reason: input.reason
                        }
                    }
                },
                { new: true, runValidators: true }
            );
            if (!rejectedCoordination) {
                throw new Error('Coordination response was already recorded or is no longer available');
            }
            const coordinationDoc = await finalizeResponseState(rejectedCoordination, channelId);

            // Notify requesting agent
            const rejectionMessage = {
                format: 'json',
                data: {
                    type: 'coordination_rejection',
                    coordinationId: input.coordinationId,
                    rejectingAgent: agentId,
                    reason: input.reason,
                    alternatives: input.alternatives
                }
            };

            const agentMessage = createAgentMessage(
                agentId,
                coordinationDoc.requestingAgent,
                rejectionMessage,
                {
                    metadata: {
                        correlationId: input.coordinationId
                    },
                    context: {
                        messageType: 'coordination_rejection',
                        coordinationId: input.coordinationId
                    }
                }
            );

            const payload = createAgentMessageEventPayload(
                Events.Message.AGENT_MESSAGE,
                agentId,
                channelId,
                agentMessage
            );

            EventBus.server.emit(Events.Message.AGENT_MESSAGE, payload);


            const content: McpToolResultContent = {
                type: 'application/json',
                data: {
                    coordinationId: input.coordinationId,
                    status: 'rejected',
                    reason: input.reason
                }
            };
            return { content };
        } catch (error) {
            logger.error(`Failed to reject coordination: ${error}`);
            const content: McpToolResultContent = {
                type: 'application/json',
                data: {
                    error: `Failed to reject coordination: ${error instanceof Error ? error.message : String(error)}`
                }
            };
            return { content };
        }
    }
};

/**
 * MCP Tool: coordination_status
 * Check the status of a coordination request
 */
export const coordinationStatusTool = {
    name: 'coordination_status',
    description: 'Check the status of a coordination request',
    inputSchema: {
        type: 'object',
        properties: {
            coordinationId: {
                type: 'string',
                description: 'ID of the coordination to check'
            }
        },
        required: ['coordinationId']
    },

    handler: async (input: {
        coordinationId: string;
    }, context: McpToolHandlerContext): Promise<McpToolHandlerResult> => {
        try {
            const { agentId, channelId } = requireExactToolTenantContext(context);
            requireCurrentChannelParticipant(channelId, agentId);

            const coordinationDoc = await CoordinationModel.findOne({
                coordinationId: input.coordinationId,
                channelId,
                $or: [
                    { requestingAgent: agentId },
                    { targetAgents: agentId }
                ]
            });
            if (!coordinationDoc) {
                throw new Error(`Coordination ${input.coordinationId} not found`);
            }

            const content: McpToolResultContent = {
                type: 'application/json',
                data: {
                    coordinationId: coordinationDoc.coordinationId,
                    state: coordinationDoc.state,
                    type: coordinationDoc.type,
                    requestingAgent: coordinationDoc.requestingAgent,
                    targetAgents: coordinationDoc.targetAgents,
                    acceptedAgents: coordinationDoc.acceptedAgents,
                    rejectedAgents: coordinationDoc.rejectedAgents,
                    taskDescription: coordinationDoc.taskDescription,
                    createdAt: coordinationDoc.createdAt,
                    updatedAt: coordinationDoc.updatedAt,
                    completedAt: coordinationDoc.completedAt,
                    results: coordinationDoc.results
                }
            };
            return { content };
        } catch (error) {
            logger.error(`Failed to get coordination status: ${error}`);
            const content: McpToolResultContent = {
                type: 'application/json',
                data: {
                    error: `Failed to get coordination status: ${error instanceof Error ? error.message : String(error)}`
                }
            };
            return { content };
        }
    }
};

/**
 * MCP Tool: coordination_update
 * Update the status or progress of an ongoing coordination
 */
export const coordinationUpdateTool = {
    name: 'coordination_update',
    description: 'Update the status or progress of an ongoing coordination',
    inputSchema: {
        type: 'object',
        properties: {
            coordinationId: {
                type: 'string',
                description: 'ID of the coordination to update'
            },
            state: {
                type: 'string',
                enum: Object.values(CoordinationState),
                description: 'New state for the coordination'
            },
            progress: {
                type: 'object',
                description: 'Progress update information',
                properties: {
                    percentage: {
                        type: 'number',
                        minimum: 0,
                        maximum: 100,
                        description: 'Completion percentage'
                    },
                    milestone: {
                        type: 'string',
                        description: 'Current milestone or phase'
                    },
                    blockers: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Any blockers or issues'
                    }
                }
            },
            results: {
                type: 'object',
                description: 'Partial or final results from the coordination'
            }
        },
        required: ['coordinationId']
    },

    handler: async (input: {
        coordinationId: string;
        state?: CoordinationState;
        progress?: Record<string, any>;
        results?: Record<string, any>;
    }, context: McpToolHandlerContext): Promise<McpToolHandlerResult> => {
        try {
            const { agentId, channelId } = requireExactToolTenantContext(context);
            requireCurrentChannelParticipant(channelId, agentId);

            const existingCoordination = await CoordinationModel.findOne({
                coordinationId: input.coordinationId,
                channelId,
                $or: [
                    { requestingAgent: agentId },
                    { acceptedAgents: agentId }
                ]
            });
            if (!existingCoordination) {
                throw new Error(`Coordination ${input.coordinationId} not found`);
            }

            const updateFields: Record<string, unknown> = {};
            if (input.state) {
                updateFields.state = input.state;
                if (input.state === CoordinationState.COMPLETED) {
                    updateFields.completedAt = new Date();
                }
            }

            if (input.results) {
                updateFields.results = {
                    ...(existingCoordination.results || {}),
                    ...input.results
                };
            }

            const coordinationDoc = Object.keys(updateFields).length > 0
                ? await CoordinationModel.findOneAndUpdate(
                    {
                        coordinationId: input.coordinationId,
                        channelId,
                        $or: [
                            { requestingAgent: agentId },
                            { acceptedAgents: agentId }
                        ]
                    },
                    { $set: updateFields },
                    { new: true, runValidators: true }
                )
                : existingCoordination;
            if (!coordinationDoc) {
                throw new Error('Coordination is no longer available in the authenticated channel');
            }

            // Notify all participants of the update
            const participants = [coordinationDoc.requestingAgent, ...coordinationDoc.acceptedAgents]
                .filter(id => id !== agentId);

            for (const participantId of participants) {
                const updateMessage = {
                    format: 'json',
                    data: {
                        type: 'coordination_update',
                        coordinationId: input.coordinationId,
                        updatingAgent: agentId,
                        state: coordinationDoc.state,
                        progress: input.progress,
                        results: input.results
                    }
                };

                const agentMessage = createAgentMessage(
                    agentId,
                    participantId,
                    updateMessage,
                    {
                        metadata: {
                            correlationId: input.coordinationId
                        },
                        context: {
                            messageType: 'coordination_update',
                            coordinationId: input.coordinationId
                        }
                    }
                );

                const payload = createAgentMessageEventPayload(
                    Events.Message.AGENT_MESSAGE,
                    agentId,
                    channelId,
                    agentMessage
                );

                EventBus.server.emit(Events.Message.AGENT_MESSAGE, payload);
            }


            const content: McpToolResultContent = {
                type: 'application/json',
                data: {
                    coordinationId: input.coordinationId,
                    state: coordinationDoc.state,
                    persisted: Object.keys(updateFields).length > 0,
                    notificationsEmitted: participants.length
                }
            };
            return { content };
        } catch (error) {
            logger.error(`Failed to update coordination: ${error}`);
            const content: McpToolResultContent = {
                type: 'application/json',
                data: {
                    error: `Failed to update coordination: ${error instanceof Error ? error.message : String(error)}`
                }
            };
            return { content };
        }
    }
};

/**
 * MCP Tool: coordination_complete
 * Mark a coordination as completed with final results
 */
export const coordinationCompleteTool = {
    name: 'coordination_complete',
    description: 'Mark a coordination as completed with final results',
    inputSchema: {
        type: 'object',
        properties: {
            coordinationId: {
                type: 'string',
                description: 'ID of the coordination to complete'
            },
            results: {
                type: 'object',
                description: 'Final results of the coordination',
                properties: {
                    success: {
                        type: 'boolean',
                        description: 'Whether the coordination was successful'
                    },
                    outputs: {
                        type: 'object',
                        description: 'Any outputs or artifacts produced'
                    },
                    summary: {
                        type: 'string',
                        description: 'Summary of what was accomplished'
                    },
                    metrics: {
                        type: 'object',
                        description: 'Any metrics or measurements'
                    }
                }
            },
            feedback: {
                type: 'string',
                description: 'Optional feedback or lessons learned'
            }
        },
        required: ['coordinationId', 'results']
    },

    handler: async (input: {
        coordinationId: string;
        results: Record<string, any>;
        feedback?: string;
    }, context: McpToolHandlerContext): Promise<McpToolHandlerResult> => {
        try {
            const { agentId, channelId } = requireExactToolTenantContext(context);
            requireCurrentChannelParticipant(channelId, agentId);

            const existingCoordination = await CoordinationModel.findOne({
                coordinationId: input.coordinationId,
                channelId,
                $or: [
                    { requestingAgent: agentId },
                    { acceptedAgents: agentId }
                ]
            });
            if (!existingCoordination) {
                throw new Error(`Coordination ${input.coordinationId} not found`);
            }

            const now = new Date();
            const coordinationDoc = await CoordinationModel.findOneAndUpdate(
                {
                    coordinationId: input.coordinationId,
                    channelId,
                    state: { $ne: CoordinationState.COMPLETED },
                    $or: [
                        { requestingAgent: agentId },
                        { acceptedAgents: agentId }
                    ]
                },
                {
                    $set: {
                        state: CoordinationState.COMPLETED,
                        completedAt: now,
                        results: input.results
                    }
                },
                { new: true, runValidators: true }
            );
            if (!coordinationDoc) {
                throw new Error('Coordination is already complete or no longer available');
            }

            const duration = now.getTime() - coordinationDoc.createdAt.getTime();

            // Notify all participants
            const participants = [coordinationDoc.requestingAgent, ...coordinationDoc.acceptedAgents]
                .filter(id => id !== agentId);

            for (const participantId of participants) {
                const completionMessage = {
                    format: 'json',
                    data: {
                        type: 'coordination_complete',
                        coordinationId: input.coordinationId,
                        completingAgent: agentId,
                        results: input.results,
                        feedback: input.feedback,
                        duration
                    }
                };

                const agentMessage = createAgentMessage(
                    agentId,
                    participantId,
                    completionMessage,
                    {
                        metadata: {
                            correlationId: input.coordinationId
                        },
                        context: {
                            messageType: 'coordination_complete',
                            coordinationId: input.coordinationId
                        }
                    }
                );

                const payload = createAgentMessageEventPayload(
                    Events.Message.AGENT_MESSAGE,
                    agentId,
                    channelId,
                    agentMessage
                );

                EventBus.server.emit(Events.Message.AGENT_MESSAGE, payload);
            }


            const content: McpToolResultContent = {
                type: 'application/json',
                data: {
                    coordinationId: input.coordinationId,
                    status: 'completed',
                    duration,
                    results: input.results,
                    notificationsEmitted: participants.length
                }
            };
            return { content };
        } catch (error) {
            logger.error(`Failed to complete coordination: ${error}`);
            const content: McpToolResultContent = {
                type: 'application/json',
                data: {
                    error: `Failed to complete coordination: ${error instanceof Error ? error.message : String(error)}`
                }
            };
            return { content };
        }
    }
};

/**
 * MCP Tool: coordination_list
 * List active coordinations for the current agent
 */
export const coordinationListTool = {
    name: 'coordination_list',
    description: 'List active coordinations involving the current agent',
    inputSchema: {
        type: 'object',
        properties: {
            role: {
                type: 'string',
                enum: ['requester', 'participant', 'all'],
                description: 'Filter by agent role in coordination',
                default: 'all'
            },
            state: {
                type: 'string',
                enum: Object.values(CoordinationState),
                description: 'Filter by coordination state'
            },
            limit: {
                type: 'number',
                description: 'Maximum number of coordinations to return',
                default: 50
            }
        }
    },

    handler: async (input: {
        role?: 'requester' | 'participant' | 'all';
        state?: CoordinationState;
        limit?: number;
    }, context: McpToolHandlerContext): Promise<McpToolHandlerResult> => {
        try {
            const { agentId, channelId } = requireExactToolTenantContext(context);
            requireCurrentChannelParticipant(channelId, agentId);
            const role = input.role || 'all';
            const limit = Math.max(1, Math.min(input.limit || 50, 100));

            // Build MongoDB query
            const query: FilterQuery<ICoordination> = { channelId };

            // Filter by role
            if (role === 'requester') {
                query.requestingAgent = agentId;
            } else if (role === 'participant') {
                query.$or = [
                    { targetAgents: agentId },
                    { acceptedAgents: agentId }
                ];
            } else { // 'all'
                query.$or = [
                    { requestingAgent: agentId },
                    { targetAgents: agentId },
                    { acceptedAgents: agentId }
                ];
            }

            // Filter by state
            if (input.state) {
                query.state = input.state;
            }

            // Fetch coordinations from MongoDB
            const coordinationDocs = await CoordinationModel.find(query)
                .sort({ createdAt: -1 })
                .limit(limit);

            const coordinations = coordinationDocs.map(coord => {
                const isRequester = coord.requestingAgent === agentId;
                return {
                    coordinationId: coord.coordinationId,
                    type: coord.type,
                    state: coord.state,
                    role: isRequester ? 'requester' : 'participant',
                    taskDescription: coord.taskDescription,
                    createdAt: coord.createdAt.getTime(),
                    participantCount: coord.acceptedAgents.length
                };
            });

            const content: McpToolResultContent = {
                type: 'application/json',
                data: {
                    coordinations,
                    total: coordinations.length
                }
            };
            return { content };
        } catch (error) {
            logger.error(`Failed to list coordinations: ${error}`);
            const content: McpToolResultContent = {
                type: 'application/json',
                data: {
                    error: `Failed to list coordinations: ${error instanceof Error ? error.message : String(error)}`
                }
            };
            return { content };
        }
    }
};

/**
 * Export all coordination MCP tools
 */
export const coordinationTools = [
    coordinationRequestTool,
    coordinationAcceptTool,
    coordinationRejectTool,
    coordinationStatusTool,
    coordinationUpdateTool,
    coordinationCompleteTool,
    coordinationListTool
];
