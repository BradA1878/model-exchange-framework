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
 * CoordinationTools.ts
 * 
 * MCP tools for advanced agent coordination, collaboration, and workflow management.
 * Enables agents to formally request, accept, track, and complete collaborative tasks
 * within the MXF ecosystem.
 */

import { createAgentMessage } from '../../../schemas/MessageSchemas';
import { AgentId, ChannelId } from '../../../types/ChannelContext';
import { Logger } from '../../../utils/Logger';
import { EventBus } from '../../../events/EventBus';
import { Events } from '../../../events/EventNames';
import { createAgentMessageEventPayload } from '../../../schemas/EventPayloadSchema';
import { AgentService } from '../../../../server/socket/services/AgentService';
import { McpToolHandlerContext, McpToolHandlerResult, McpToolResultContent } from '../McpServerTypes';
import CoordinationModel, { CoordinationState, CoordinationType } from '../../../models/coordination';

const logger = new Logger('info', 'CoordinationTools', 'server');

// MongoDB persistence is now used for all coordination tracking

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
            const coordinationId = `coord_${input.coordinationType}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

            // Save coordination request to MongoDB
            const coordinationDoc = new CoordinationModel({
                coordinationId,
                type: input.coordinationType,
                state: CoordinationState.REQUESTED,
                requestingAgent: context.agentId!,
                targetAgents: input.targetAgents,
                acceptedAgents: [],
                rejectedAgents: [],
                taskDescription: input.taskDescription,
                requirements: input.requirements,
                deadline: input.deadline ? new Date(input.deadline) : undefined,
                channelId: context.channelId
            });

            await coordinationDoc.save();

            // Send coordination requests to target agents
            for (const targetAgentId of input.targetAgents) {
                const coordinationMessage = {
                    format: 'json',
                    data: {
                        type: 'coordination_request',
                        coordinationId,
                        coordinationType: input.coordinationType,
                        taskDescription: input.taskDescription,
                        requirements: input.requirements,
                        deadline: input.deadline,
                        requestingAgent: context.agentId,
                        metadata: input.metadata
                    }
                };

                const agentMessage = createAgentMessage(
                    context.agentId!,
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
                    context.agentId!,
                    context.channelId!,
                    agentMessage
                );

                EventBus.server.emit(Events.Message.AGENT_MESSAGE, payload);
            }


            const content: McpToolResultContent = {
                type: 'application/json',
                data: {
                    coordinationId,
                    status: 'created',
                    targetAgents: input.targetAgents,
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
            // Fetch coordination from MongoDB
            const coordinationDoc = await CoordinationModel.findOne({ coordinationId: input.coordinationId });
            if (!coordinationDoc) {
                throw new Error(`Coordination ${input.coordinationId} not found`);
            }

            if (!coordinationDoc.targetAgents.includes(context.agentId!)) {
                throw new Error(`Agent ${context.agentId} is not a target of this coordination`);
            }

            if (coordinationDoc.acceptedAgents.includes(context.agentId!)) {
                throw new Error(`Agent ${context.agentId} has already accepted this coordination`);
            }

            // Update coordination state
            coordinationDoc.acceptedAgents.push(context.agentId!);

            // If all agents have responded, update state
            const totalResponses = coordinationDoc.acceptedAgents.length + coordinationDoc.rejectedAgents.length;
            if (totalResponses === coordinationDoc.targetAgents.length) {
                coordinationDoc.state = coordinationDoc.acceptedAgents.length > 0
                    ? CoordinationState.ACCEPTED
                    : CoordinationState.REJECTED;
            }

            await coordinationDoc.save();

            // Notify requesting agent
            const acceptanceMessage = {
                format: 'json',
                data: {
                    type: 'coordination_acceptance',
                    coordinationId: input.coordinationId,
                    acceptingAgent: context.agentId,
                    commitments: input.commitments,
                    metadata: input.metadata
                }
            };

            const agentMessage = createAgentMessage(
                context.agentId!,
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
                context.agentId!,
                context.channelId!,
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
            // Fetch coordination from MongoDB
            const coordinationDoc = await CoordinationModel.findOne({ coordinationId: input.coordinationId });
            if (!coordinationDoc) {
                throw new Error(`Coordination ${input.coordinationId} not found`);
            }

            if (!coordinationDoc.targetAgents.includes(context.agentId!)) {
                throw new Error(`Agent ${context.agentId} is not a target of this coordination`);
            }

            // Update coordination state
            coordinationDoc.rejectedAgents.push({
                agentId: context.agentId!,
                reason: input.reason
            });

            // If all agents have responded, update state
            const totalResponses = coordinationDoc.acceptedAgents.length + coordinationDoc.rejectedAgents.length;
            if (totalResponses === coordinationDoc.targetAgents.length) {
                coordinationDoc.state = coordinationDoc.acceptedAgents.length > 0
                    ? CoordinationState.ACCEPTED
                    : CoordinationState.REJECTED;
            }

            await coordinationDoc.save();

            // Notify requesting agent
            const rejectionMessage = {
                format: 'json',
                data: {
                    type: 'coordination_rejection',
                    coordinationId: input.coordinationId,
                    rejectingAgent: context.agentId,
                    reason: input.reason,
                    alternatives: input.alternatives
                }
            };

            const agentMessage = createAgentMessage(
                context.agentId!,
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
                context.agentId!,
                context.channelId!,
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
            // Fetch coordination from MongoDB
            const coordinationDoc = await CoordinationModel.findOne({ coordinationId: input.coordinationId });
            if (!coordinationDoc) {
                throw new Error(`Coordination ${input.coordinationId} not found`);
            }

            // Check if agent has permission to view this coordination
            const isParticipant = coordinationDoc.requestingAgent === context.agentId ||
                                 coordinationDoc.targetAgents.includes(context.agentId!);
            
            if (!isParticipant) {
                throw new Error(`Agent ${context.agentId} is not a participant in coordination ${input.coordinationId}`);
            }

            const content: McpToolResultContent = {
                type: 'application/json',
                data: {
                    coordinationId: coordinationDoc.id,
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
            // Fetch coordination from MongoDB
            const coordinationDoc = await CoordinationModel.findOne({ coordinationId: input.coordinationId });
            if (!coordinationDoc) {
                throw new Error(`Coordination ${input.coordinationId} not found`);
            }

            // Check if agent has permission to update this coordination
            const isParticipant = coordinationDoc.requestingAgent === context.agentId ||
                                 coordinationDoc.acceptedAgents.includes(context.agentId!);
            
            if (!isParticipant) {
                throw new Error(`Agent ${context.agentId} is not an active participant in coordination ${input.coordinationId}`);
            }

            // Update coordination
            if (input.state) {
                coordinationDoc.state = input.state;
                if (input.state === CoordinationState.COMPLETED) {
                    coordinationDoc.completedAt = new Date();
                }
            }

            if (input.results) {
                coordinationDoc.results = {
                    ...coordinationDoc.results,
                    ...input.results
                };
            }

            await coordinationDoc.save();

            // Notify all participants of the update
            const participants = [coordinationDoc.requestingAgent, ...coordinationDoc.acceptedAgents]
                .filter(id => id !== context.agentId);

            for (const participantId of participants) {
                const updateMessage = {
                    format: 'json',
                    data: {
                        type: 'coordination_update',
                        coordinationId: input.coordinationId,
                        updatingAgent: context.agentId,
                        state: coordinationDoc.state,
                        progress: input.progress,
                        results: input.results
                    }
                };

                const agentMessage = createAgentMessage(
                    context.agentId!,
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
                    context.agentId!,
                    context.channelId!,
                    agentMessage
                );

                EventBus.server.emit(Events.Message.AGENT_MESSAGE, payload);
            }


            const content: McpToolResultContent = {
                type: 'application/json',
                data: {
                    coordinationId: input.coordinationId,
                    state: coordinationDoc.state,
                    updated: true
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
            // Fetch coordination from MongoDB
            const coordinationDoc = await CoordinationModel.findOne({ coordinationId: input.coordinationId });
            if (!coordinationDoc) {
                throw new Error(`Coordination ${input.coordinationId} not found`);
            }

            // Only requesting agent or accepted agents can complete
            const canComplete = coordinationDoc.requestingAgent === context.agentId ||
                               coordinationDoc.acceptedAgents.includes(context.agentId!);
            
            if (!canComplete) {
                throw new Error(`Agent ${context.agentId} cannot complete coordination ${input.coordinationId}`);
            }

            const now = new Date();
            coordinationDoc.state = CoordinationState.COMPLETED;
            coordinationDoc.completedAt = now;
            coordinationDoc.results = input.results;

            await coordinationDoc.save();

            const duration = now.getTime() - coordinationDoc.createdAt.getTime();

            // Notify all participants
            const participants = [coordinationDoc.requestingAgent, ...coordinationDoc.acceptedAgents]
                .filter(id => id !== context.agentId);

            for (const participantId of participants) {
                const completionMessage = {
                    format: 'json',
                    data: {
                        type: 'coordination_complete',
                        coordinationId: input.coordinationId,
                        completingAgent: context.agentId,
                        results: input.results,
                        feedback: input.feedback,
                        duration
                    }
                };

                const agentMessage = createAgentMessage(
                    context.agentId!,
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
                    context.agentId!,
                    context.channelId!,
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
                    results: input.results
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
            const role = input.role || 'all';
            const limit = input.limit || 50;

            // Build MongoDB query
            const query: any = {};

            // Filter by role
            if (role === 'requester') {
                query.requestingAgent = context.agentId;
            } else if (role === 'participant') {
                query.$or = [
                    { targetAgents: context.agentId },
                    { acceptedAgents: context.agentId }
                ];
            } else { // 'all'
                query.$or = [
                    { requestingAgent: context.agentId },
                    { targetAgents: context.agentId },
                    { acceptedAgents: context.agentId }
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
                const isRequester = coord.requestingAgent === context.agentId;
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
