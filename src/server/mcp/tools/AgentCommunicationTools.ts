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
 * AgentCommunicationTools.ts
 * 
 * MCP tools for inter-agent communication, messaging, and coordination.
 * Enables agents to send messages, broadcast announcements, discover other agents,
 * and coordinate complex workflows within the MXF ecosystem.
 * 
 * Supports MXP (Model Exchange Protocol) for efficient, structured agent-to-agent communication.
 */

import { createAgentMessage, createChannelMessage } from '@mxf-dev/core/schemas/MessageSchemas';
import { Logger } from '@mxf-dev/core/utils/Logger';
import { COMMUNICATION_TOOLS } from '@mxf-dev/core/constants/ToolNames';
import { AgentService } from '../../socket/services/AgentService';
import { EventBus } from '@mxf-dev/core/events/EventBus';
import { Events } from '@mxf-dev/core/events/EventNames';
import { createAgentMessageEventPayload, createChannelMessageEventPayload, createBaseEventPayload } from '@mxf-dev/core/schemas/EventPayloadSchema';
import { MxpMiddleware } from '@mxf-dev/core/middleware/MxpMiddleware';
import { isMxpMessage } from '@mxf-dev/core/schemas/MxpProtocolSchemas';
import { McpToolHandlerContext, McpToolHandlerResult, McpToolResultContent } from '@mxf-dev/core/protocols/mcp/McpServerTypes';
import {
    requireChannelParticipants,
    requireCurrentChannelParticipant,
    requireExactToolTenantContext
} from './helpers/toolTenantContext';

const logger = new Logger('info', 'AgentCommunicationTools', 'server');

type MxpMessageCandidate = Parameters<typeof MxpMiddleware.processOutgoing>[0];

const hasMxpMessageFormat = (value: unknown): boolean =>
    isMxpMessage(value as MxpMessageCandidate);

/**
 * MCP Tool: messaging_send
 * Send a direct message from one agent to another with MXP support
 */
export const agentMessageTool = {
    name: COMMUNICATION_TOOLS.SEND_MESSAGE,
    description: 'Send a direct message from one agent to another with optional metadata. Supports MXP protocol for structured communication.',
    inputSchema: {
        type: 'object',
        properties: {
            targetAgentId: {
                type: 'string',
                description: 'ID of the target agent to send the message to'
            },
            message: {
                description: 'Message content to send (can be text, JSON, MXP format, or structured data)'
            },
            messageType: {
                type: 'string',
                description: 'Optional message type for categorization',
                default: 'direct'
            },
            priority: {
                type: 'number',
                description: 'Message priority (1=low, 5=normal, 10=high)',
                minimum: 1,
                maximum: 10,
                default: 5
            },
            metadata: {
                type: 'object',
                description: 'Optional metadata to include with the message'
            },
            mxpOptions: {
                type: 'object',
                description: 'MXP protocol options',
                properties: {
                    enableMxp: {
                        type: 'boolean',
                        description: 'Enable MXP protocol processing',
                        default: true
                    },
                    preferredFormat: {
                        type: 'string',
                        enum: ['mxp', 'natural-language', 'auto'],
                        description: 'Preferred message format',
                        default: 'auto'
                    },
                    forceEncryption: {
                        type: 'boolean',
                        description: 'Force message encryption',
                        default: false
                    }
                }
            }
        },
        required: ['targetAgentId', 'message']
    },
    
    handler: async (input: {
        targetAgentId: string;
        message: unknown;
        messageType?: string;
        priority?: number;
        metadata?: Record<string, unknown>;
        mxpOptions?: {
            enableMxp?: boolean;
            preferredFormat?: 'mxp' | 'natural-language' | 'auto';
            forceEncryption?: boolean;
        };
    }, context: McpToolHandlerContext): Promise<McpToolHandlerResult> => {
        try {
            const { agentId, channelId } = requireExactToolTenantContext(context);
            requireCurrentChannelParticipant(channelId, agentId);
            requireChannelParticipants(channelId, [input.targetAgentId]);

            // MESSAGE CONTENT: Allow any format (natural language, JSON, structured data, etc.)
            // LLM agents can handle and understand various message formats effectively
            // Process message through MXP middleware if enabled
            let processedMessage = input.message;
            let mxpProcessed = false;
            const forceEncryption = input.mxpOptions?.forceEncryption ?? false;
            const mxpOptions = {
                enableMxp: forceEncryption || (input.mxpOptions?.enableMxp ?? false),
                preferredFormat: input.mxpOptions?.preferredFormat ?? 'auto',
                forceEncryption
            };
            
            // Check if MXP processing should be applied
            if (mxpOptions.enableMxp) {
                try {
                    // If message is already MXP or should be converted
                    if (mxpOptions.forceEncryption ||
                        hasMxpMessageFormat(input.message) ||
                        mxpOptions.preferredFormat === 'mxp' ||
                        (mxpOptions.preferredFormat === 'auto' && 
                         typeof input.message === 'string' && 
                         MxpMiddleware.shouldConvertToMxp(input.message))) {
                        
                        // Process through MXP middleware - convert 'auto' to undefined for middleware
                        const middlewareOptions = {
                            enableMxp: mxpOptions.enableMxp,
                            forceEncryption: mxpOptions.forceEncryption,
                            preferredFormat: mxpOptions.preferredFormat === 'auto' ? undefined : mxpOptions.preferredFormat as 'mxp' | 'natural-language'
                        };
                        
                        processedMessage = await MxpMiddleware.processOutgoing(
                            input.message as MxpMessageCandidate,
                            agentId,
                            middlewareOptions
                        );
                        
                        mxpProcessed = hasMxpMessageFormat(processedMessage);
                    }
                } catch (mxpError) {
                    throw new Error(
                        `MXP processing failed: ${mxpError instanceof Error ? mxpError.message : String(mxpError)}`
                    );
                }
            }
            
            // Create standardized agent message using existing schema
            const agentMessage = createAgentMessage(
                agentId,
                input.targetAgentId,
                processedMessage,
                {
                    metadata: {
                        ...input.metadata,
                        priority: input.priority || 5,
                        correlationId: context.requestId
                    },
                    context: {
                        ...input.metadata,
                        messageType: input.messageType || 'direct',
                        requestId: context.requestId
                    }
                }
            );

            // Emit agent message event using existing infrastructure
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
                    messageId: agentMessage.metadata.messageId,
                    eventEmitted: true,
                    timestamp: agentMessage.metadata.timestamp,
                    targetAgent: input.targetAgentId,
                    mxpProcessed
                }
            };
            return { content };
        } catch (error) {
            logger.error(`Failed to send agent message: ${error}`);
            const content: McpToolResultContent = {
                type: 'application/json',
                data: {
                    error: `Failed to send agent message: ${error instanceof Error ? error.message : String(error)}`
                }
            };
            return { content };
        }
    }
};

/**
 * MCP Tool: messaging_broadcast  
 * Broadcast a message to multiple agents or an entire channel with MXP support
 */
export const agentBroadcastTool = {
    name: COMMUNICATION_TOOLS.BROADCAST,
    description: 'Broadcast a message to multiple agents or an entire channel. Supports MXP protocol for structured communication.',
    inputSchema: {
        type: 'object',
        properties: {
            targetChannelId: {
                type: 'string',
                description: 'Channel ID to broadcast to (optional - defaults to current channel)'
            },
            targetAgentIds: {
                type: 'array',
                items: { type: 'string' },
                description: 'Array of specific agent IDs to send to (if targeting specific agents)'
            },
            message: {
                description: 'Message content to broadcast (can be text, JSON, MXP format, or structured data)'
            },
            messageType: {
                type: 'string',
                description: 'Optional message type for categorization',
                default: 'broadcast'
            },
            excludeSelf: {
                type: 'boolean',
                description: 'Whether to exclude the sending agent from receiving the broadcast',
                default: true
            },
            metadata: {
                type: 'object',
                description: 'Optional metadata to include with the broadcast'
            },
            mxpOptions: {
                type: 'object',
                description: 'MXP protocol options',
                properties: {
                    enableMxp: {
                        type: 'boolean',
                        description: 'Enable MXP protocol processing',
                        default: true
                    },
                    preferredFormat: {
                        type: 'string',
                        enum: ['mxp', 'natural-language', 'auto'],
                        description: 'Preferred message format',
                        default: 'auto'
                    },
                    forceEncryption: {
                        type: 'boolean',
                        description: 'Force message encryption',
                        default: false
                    }
                }
            }
        },
        required: ['message']
    },

    handler: async (input: {
        targetChannelId?: string;
        targetAgentIds?: string[];
        message: unknown;
        messageType?: string;
        excludeSelf?: boolean;
        metadata?: Record<string, unknown>;
        mxpOptions?: {
            enableMxp?: boolean;
            preferredFormat?: 'mxp' | 'natural-language' | 'auto';
            forceEncryption?: boolean;
        };
    }, context: McpToolHandlerContext): Promise<McpToolHandlerResult> => {
        try {
            const { agentId, channelId } = requireExactToolTenantContext(
                context,
                input.targetChannelId
            );
            requireCurrentChannelParticipant(channelId, agentId);
            const emittedFor: string[] = [];
            let messageId: string;
            const timestamp = Date.now();
            let mxpProcessed = false;

            if (input.targetChannelId !== undefined && input.targetAgentIds?.length) {
                throw new Error('Specify either targetChannelId or targetAgentIds, not both');
            }

            const isChannelBroadcast = input.targetChannelId !== undefined
                || !input.targetAgentIds
                || input.targetAgentIds.length === 0;
            const excludeSelf = input.excludeSelf ?? true;
            const filteredTargets = !isChannelBroadcast
                ? (excludeSelf
                    ? input.targetAgentIds!.filter(id => id !== agentId)
                    : input.targetAgentIds!)
                : [];
            const targetAgentIds = isChannelBroadcast
                ? []
                : requireChannelParticipants(channelId, filteredTargets);
            
            // Process message through MXP middleware if enabled
            let processedMessage = input.message;
            const forceEncryption = input.mxpOptions?.forceEncryption ?? false;
            const mxpOptions = {
                enableMxp: forceEncryption || (input.mxpOptions?.enableMxp ?? false),
                preferredFormat: input.mxpOptions?.preferredFormat ?? 'auto',
                forceEncryption
            };
            
            // Check if MXP processing should be applied
            if (mxpOptions.enableMxp) {
                try {
                    // If message is already MXP or should be converted
                    if (mxpOptions.forceEncryption ||
                        hasMxpMessageFormat(input.message) ||
                        mxpOptions.preferredFormat === 'mxp' ||
                        (mxpOptions.preferredFormat === 'auto' && 
                         typeof input.message === 'string' && 
                         MxpMiddleware.shouldConvertToMxp(input.message))) {
                        
                        // Process through MXP middleware - convert 'auto' to undefined for middleware
                        const middlewareOptions = {
                            enableMxp: mxpOptions.enableMxp,
                            forceEncryption: mxpOptions.forceEncryption,
                            preferredFormat: mxpOptions.preferredFormat === 'auto' ? undefined : mxpOptions.preferredFormat as 'mxp' | 'natural-language'
                        };
                        
                        processedMessage = await MxpMiddleware.processOutgoing(
                            input.message as MxpMessageCandidate,
                            agentId,
                            middlewareOptions
                        );
                        
                        mxpProcessed = hasMxpMessageFormat(processedMessage);
                    }
                } catch (mxpError) {
                    throw new Error(
                        `MXP processing failed: ${mxpError instanceof Error ? mxpError.message : String(mxpError)}`
                    );
                }
            }

            if (isChannelBroadcast) {
                // Channel broadcast using existing channel message infrastructure
                const channelMessage = createChannelMessage(
                    channelId,
                    agentId,
                    processedMessage,
                    {
                        metadata: {
                            ...input.metadata,
                            correlationId: context.requestId
                        },
                        context: {
                            ...input.metadata,
                            messageType: input.messageType || 'broadcast',
                            requestId: context.requestId,
                            excludeSelf
                        }
                    }
                );

                // Import EventBus and EventNames dynamically to avoid circular dependencies and ensure server-side access
                // Use imported modules

                const payload = createChannelMessageEventPayload(
                    Events.Message.CHANNEL_MESSAGE,
                    agentId,
                    channelMessage
                );

                EventBus.server.emit(Events.Message.CHANNEL_MESSAGE, payload);

                messageId = channelMessage.metadata.messageId;
                emittedFor.push(channelId);

            } else {
                // Multi-agent broadcast using multiple agent messages
                // Use the first message ID for all (they'll have same timestamp)
                messageId = `broadcast_${context.requestId}_${timestamp}`;

                for (const targetAgentId of targetAgentIds) {
                    const agentMessage = createAgentMessage(
                        agentId,
                        targetAgentId,
                        processedMessage,
                        {
                            metadata: {
                                ...input.metadata,
                                correlationId: context.requestId
                            },
                            context: {
                                ...input.metadata,
                                messageType: input.messageType || 'broadcast',
                                requestId: context.requestId,
                                broadcastId: messageId
                            }
                        }
                    );

                    // Import EventBus and EventNames dynamically to avoid circular dependencies and ensure server-side access
                    // Use imported modules

                    const payload = createAgentMessageEventPayload(
                        Events.Message.AGENT_MESSAGE,
                        agentId,
                        channelId,
                        agentMessage
                    );

                    EventBus.server.emit(Events.Message.AGENT_MESSAGE, payload);
                    emittedFor.push(targetAgentId);
                }
            }

            const content: McpToolResultContent = {
                type: 'application/json',
                data: {
                    messageId,
                    emittedFor,
                    timestamp,
                    mxpProcessed
                }
            };
            return { content };
        } catch (error) {
            logger.error(`Failed to send broadcast: ${error}`);
            const content: McpToolResultContent = {
                type: 'application/json',
                data: {
                    error: `Failed to send broadcast: ${error instanceof Error ? error.message : String(error)}`
                }
            };
            return { content };
        }
    }
};

/**
 * MCP Tool: messaging_discover
 * Discover available agents and their capabilities in a channel or system
 */
export const agentDiscoverTool = {
    name: COMMUNICATION_TOOLS.DISCOVER_AGENTS,
    description: 'Discover available agents and their capabilities',
    inputSchema: {
        type: 'object',
        properties: {
            channelId: {
                type: 'string',
                description: 'Optional channel ID to discover agents within (defaults to current channel)'
            },
            capabilities: {
                type: 'array',
                items: { type: 'string' },
                description: 'Optional array of capabilities to filter agents by'
            },
            filters: {
                type: 'object',
                description: 'Optional additional filters for agent discovery'
            }
        }
    },

    handler: async (input: {
        channelId?: string;
        capabilities?: string[];
        filters?: Record<string, unknown>;
    }, context: McpToolHandlerContext): Promise<McpToolHandlerResult> => {
        try {
            const { agentId, channelId } = requireExactToolTenantContext(context, input.channelId);
            requireCurrentChannelParticipant(channelId, agentId);

            // Import EventBus and EventNames dynamically to avoid circular dependencies and ensure server-side access
            // Use imported modules

            // Create event payload for agent discovery
            const discoveryPayload = createBaseEventPayload(
                Events.Agent.DISCOVERY_REQUEST, 
                agentId,
                channelId,
                {
                    channelId,
                    capabilities: input.capabilities,
                    filters: input.filters,
                    requestId: context.requestId
                }
            );

            EventBus.server.emit(Events.Agent.DISCOVERY_REQUEST, discoveryPayload);

            // Get all agents in the channel
            const channelAgents = await AgentService.getInstance().getActiveAgentsInChannel(channelId);
            
            // Filter out the requesting agent and apply capability filters
            const discoveredAgents = channelAgents
                .filter((agent) => agent.id !== agentId) // Exclude self
                .filter((agent) => {
                    // Apply capability filters if specified
                    if (input.capabilities && input.capabilities.length > 0) {
                        return input.capabilities.some(cap => agent.capabilities?.includes(cap));
                    }
                    return true;
                })
                .map((agent) => ({
                    agentId: agent.id,
                    name: agent.id.replace(/-/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase()),
                    type: 'mxf-agent',
                    capabilities: agent.capabilities || [],
                    status: agent.status || 'unknown',
                    metadata: { 
                        lastSeen: Date.now(),
                        socketConnections: agent.socketIds?.length || 0,
                        channelId
                    }
                }));

            const content: McpToolResultContent = {
                type: 'application/json',
                data: {
                    agents: discoveredAgents,
                    totalFound: discoveredAgents.length
                }
            };
            return { content };
        } catch (error) {
            logger.error(`Failed to discover agents: ${error}`);
            const content: McpToolResultContent = {
                type: 'application/json',
                data: {
                    error: `Failed to discover agents: ${error instanceof Error ? error.message : String(error)}`
                }
            };
            return { content };
        }
    }
};

/**
 * MCP Tool: agent_coordinate
 * Request coordination with other agents for collaborative tasks
 */
export const agentCoordinateTool = {
    name: COMMUNICATION_TOOLS.COORDINATE,
    description: 'Request coordination with other agents for collaborative tasks',
    inputSchema: {
        type: 'object',
        properties: {
            targetAgentIds: {
                type: 'array',
                items: { type: 'string' },
                description: 'Array of agent IDs to coordinate with'
            },
            coordinationType: {
                type: 'string',
                enum: ['collaborate', 'delegate', 'merge', 'sync'],
                description: 'Type of coordination requested'
            },
            taskDescription: {
                type: 'string',
                description: 'Description of the task requiring coordination'
            },
            requirements: {
                type: 'object',
                description: 'Requirements or constraints for the coordination'
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
        required: ['targetAgentIds', 'coordinationType', 'taskDescription']
    },

    handler: async (input: {
        targetAgentIds: string[];
        coordinationType: 'collaborate' | 'delegate' | 'merge' | 'sync';
        taskDescription: string;
        requirements?: Record<string, unknown>;
        deadline?: number;
        metadata?: Record<string, unknown>;
    }, context: McpToolHandlerContext): Promise<McpToolHandlerResult> => {
        try {
            const { agentId, channelId } = requireExactToolTenantContext(context);
            requireCurrentChannelParticipant(channelId, agentId);
            const targetAgentIds = requireChannelParticipants(channelId, input.targetAgentIds);
            const coordinationId = `coord_${context.requestId}_${Date.now()}`;

            // Send coordination requests to target agents using existing message infrastructure
            for (const targetAgentId of targetAgentIds) {
                const coordinationMessage = {
                    type: 'coordination_request',
                    coordinationId,
                    coordinationType: input.coordinationType,
                    taskDescription: input.taskDescription,
                    requirements: input.requirements,
                    deadline: input.deadline,
                    requestingAgent: agentId
                };

                const agentMessage = createAgentMessage(
                    agentId,
                    targetAgentId,
                    coordinationMessage,
                    {
                        metadata: {
                            ...input.metadata,
                            correlationId: context.requestId
                        },
                        context: {
                            ...input.metadata,
                            messageType: 'coordination_request',
                            requestId: context.requestId,
                            coordinationId
                        }
                    }
                );

                // Import EventBus and EventNames dynamically to avoid circular dependencies and ensure server-side access
                // Use imported modules

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
                    requestedAgents: targetAgentIds,
                    notificationsEmitted: targetAgentIds.length,
                    estimatedCompletion: input.deadline
                }
            };
            return { content };
        } catch (error) {
            logger.error(`Failed to coordinate with agents: ${error}`);
            const content: McpToolResultContent = {
                type: 'application/json',
                data: {
                    error: `Failed to coordinate with agents: ${error instanceof Error ? error.message : String(error)}`
                }
            };
            return { content };
        }
    }
};

/**
 * Export all agent communication MCP tools
 */
export const agentCommunicationTools = [
    agentMessageTool,
    agentBroadcastTool,
    agentDiscoverTool,
    agentCoordinateTool
];
