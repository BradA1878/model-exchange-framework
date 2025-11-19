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
 * AgentCommunicationTools.ts
 * 
 * MCP tools for inter-agent communication, messaging, and coordination.
 * Enables agents to send messages, broadcast announcements, discover other agents,
 * and coordinate complex workflows within the MXF ecosystem.
 * 
 * Supports MXP (Model Exchange Protocol) for efficient, structured agent-to-agent communication.
 */

import { createAgentMessage, createChannelMessage } from '../../../schemas/MessageSchemas';
import { AgentId, ChannelId } from '../../../types/ChannelContext';
import { Logger } from '../../../utils/Logger';
import { COMMUNICATION_TOOLS } from '../../../constants/ToolNames';
import { AgentService } from '../../../../server/socket/services/AgentService';
import { EventBus } from '../../../events/EventBus';
import { Events } from '../../../events/EventNames';
import { createAgentMessageEventPayload, createChannelMessageEventPayload, createBaseEventPayload } from '../../../schemas/EventPayloadSchema';
import { MxpMiddleware } from '../../../middleware/MxpMiddleware';
import { isMxpMessage } from '../../../schemas/MxpProtocolSchemas';
import { McpToolHandlerContext, McpToolHandlerResult, McpToolResultContent } from '../McpServerTypes';

const logger = new Logger('info', 'AgentCommunicationTools', 'server');

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
        message: any;
        messageType?: string;
        priority?: number;
        metadata?: Record<string, any>;
        mxpOptions?: {
            enableMxp?: boolean;
            preferredFormat?: 'mxp' | 'natural-language' | 'auto';
            forceEncryption?: boolean;
        };
    }, context: McpToolHandlerContext): Promise<McpToolHandlerResult> => {
        try {
            // CRITICAL VALIDATION: Check if target agent exists before processing
            const agentService = AgentService.getInstance();
            if (!agentService.agentExists(input.targetAgentId)) {
                // Get list of available agents dynamically
                const availableAgents = Array.from(agentService.getAllAgents().keys());
                const agentList = availableAgents.length > 0 
                    ? availableAgents.join(', ') 
                    : 'No agents currently connected';
                throw new Error(`Agent '${input.targetAgentId}' does not exist. Available agents: ${agentList}`);
            }

            // MESSAGE CONTENT: Allow any format (natural language, JSON, structured data, etc.)
            // LLM agents can handle and understand various message formats effectively
            // Process message through MXP middleware if enabled
            let processedMessage = input.message;
            let mxpProcessed = false;
            
            const mxpOptions = {
                enableMxp: input.mxpOptions?.enableMxp ?? false,
                preferredFormat: input.mxpOptions?.preferredFormat ?? 'auto',
                forceEncryption: input.mxpOptions?.forceEncryption ?? false
            };
            
            // Check if MXP processing should be applied
            if (mxpOptions.enableMxp) {
                try {
                    // If message is already MXP or should be converted
                    if (isMxpMessage(input.message) || 
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
                            input.message,
                            context.agentId!,
                            middlewareOptions
                        );
                        
                        mxpProcessed = isMxpMessage(processedMessage);
                        
                        if (mxpProcessed) {
                        }
                    }
                } catch (mxpError) {
                    logger.warn(`MXP processing failed, using original message: ${mxpError}`);
                    // Continue with original message
                }
            }
            
            // Create standardized agent message using existing schema
            const agentMessage = createAgentMessage(
                context.agentId!,
                input.targetAgentId,
                processedMessage,
                {
                    metadata: {
                        ...input.metadata,
                        priority: input.priority || 5,
                        correlationId: context.requestId
                    },
                    context: {
                        messageType: input.messageType || 'direct',
                        requestId: context.requestId,
                        ...input.metadata
                    }
                }
            );

            // Emit agent message event using existing infrastructure
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
                    messageId: agentMessage.metadata.messageId,
                    sent: true,
                    timestamp: agentMessage.metadata.timestamp,
                    targetAgent: input.targetAgentId,
                    guidance: `Message successfully sent to ${input.targetAgentId}. They will receive it and respond if needed. If you expect a reply, wait for their response.`,
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
        message: any;
        messageType?: string;
        excludeSelf?: boolean;
        metadata?: Record<string, any>;
        mxpOptions?: {
            enableMxp?: boolean;
            preferredFormat?: 'mxp' | 'natural-language' | 'auto';
            forceEncryption?: boolean;
        };
    }, context: McpToolHandlerContext): Promise<McpToolHandlerResult> => {
        try {
            const deliveredTo: string[] = [];
            let messageId: string;
            const timestamp = Date.now();
            let mxpProcessed = false;
            
            // If no targetChannelId or targetAgentIds specified, default to broadcasting to current channel
            if (!input.targetChannelId && (!input.targetAgentIds || input.targetAgentIds.length === 0)) {
                input.targetChannelId = context.channelId;
            }
            
            // Process message through MXP middleware if enabled
            let processedMessage = input.message;
            
            const mxpOptions = {
                enableMxp: input.mxpOptions?.enableMxp ?? false,
                preferredFormat: input.mxpOptions?.preferredFormat ?? 'auto',
                forceEncryption: input.mxpOptions?.forceEncryption ?? false
            };
            
            // Check if MXP processing should be applied
            if (mxpOptions.enableMxp) {
                try {
                    // If message is already MXP or should be converted
                    if (isMxpMessage(input.message) || 
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
                            input.message,
                            context.agentId!,
                            middlewareOptions
                        );
                        
                        mxpProcessed = isMxpMessage(processedMessage);
                        
                        if (mxpProcessed) {
                        }
                    }
                } catch (mxpError) {
                    logger.warn(`MXP processing failed for broadcast, using original message: ${mxpError}`);
                    // Continue with original message
                }
            }

            if (input.targetChannelId) {
                // Channel broadcast using existing channel message infrastructure
                const channelMessage = createChannelMessage(
                    input.targetChannelId,
                    context.agentId!,
                    processedMessage,
                    {
                        metadata: {
                            correlationId: context.requestId,
                            ...input.metadata
                        },
                        context: {
                            messageType: input.messageType || 'broadcast',
                            requestId: context.requestId,
                            excludeSelf: input.excludeSelf,
                            ...input.metadata
                        }
                    }
                );

                // Import EventBus and EventNames dynamically to avoid circular dependencies and ensure server-side access
                // Use imported modules

                const payload = createChannelMessageEventPayload(
                    Events.Message.CHANNEL_MESSAGE,
                    context.agentId!,
                    channelMessage
                );

                EventBus.server.emit(Events.Message.CHANNEL_MESSAGE, payload);

                messageId = channelMessage.metadata.messageId;
                deliveredTo.push(input.targetChannelId); // Channel ID as recipient

            } else if (input.targetAgentIds && input.targetAgentIds.length > 0) {
                // Multi-agent broadcast using multiple agent messages
                const filteredTargets = input.excludeSelf 
                    ? input.targetAgentIds.filter(id => id !== context.agentId)
                    : input.targetAgentIds;

                // Use the first message ID for all (they'll have same timestamp)
                messageId = `broadcast_${context.requestId}_${timestamp}`;

                for (const targetAgentId of filteredTargets) {
                    const agentMessage = createAgentMessage(
                        context.agentId!,
                        targetAgentId,
                        processedMessage,
                        {
                            metadata: {
                                correlationId: context.requestId,
                                ...input.metadata
                            },
                            context: {
                                messageType: input.messageType || 'broadcast',
                                requestId: context.requestId,
                                broadcastId: messageId,
                                ...input.metadata
                            }
                        }
                    );

                    // Import EventBus and EventNames dynamically to avoid circular dependencies and ensure server-side access
                    // Use imported modules

                    const payload = createAgentMessageEventPayload(
                        Events.Message.AGENT_MESSAGE,
                        context.agentId!,
                        context.channelId!,
                        agentMessage
                    );

                    EventBus.server.emit(Events.Message.AGENT_MESSAGE, payload);
                    deliveredTo.push(targetAgentId);
                }

            } else {
                throw new Error('Must specify either targetChannelId or targetAgentIds');
            }

            const content: McpToolResultContent = {
                type: 'application/json',
                data: {
                    messageId,
                    deliveredTo,
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
 * MCP Tool: agent_discover
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
        filters?: Record<string, any>;
    }, context: McpToolHandlerContext): Promise<McpToolHandlerResult> => {
        try {
            const targetChannelId = input.channelId || context.channelId;

            // Import EventBus and EventNames dynamically to avoid circular dependencies and ensure server-side access
            // Use imported modules

            // Create event payload for agent discovery
            const discoveryPayload = createBaseEventPayload(
                Events.Agent.DISCOVERY_REQUEST, 
                context.agentId!,
                context.channelId!,
                {
                    channelId: targetChannelId,
                    capabilities: input.capabilities,
                    filters: input.filters,
                    requestId: context.requestId
                }
            );

            EventBus.server.emit(Events.Agent.DISCOVERY_REQUEST, discoveryPayload);

            // Get all agents in the channel
            const channelAgents = await AgentService.getInstance().getActiveAgentsInChannel(targetChannelId!);
            
            // Filter out the requesting agent and apply capability filters
            const discoveredAgents = channelAgents
                .filter((agent: any) => agent.id !== context.agentId) // Exclude self
                .filter((agent: any) => {
                    // Apply capability filters if specified
                    if (input.capabilities && input.capabilities.length > 0) {
                        return input.capabilities.some(cap => agent.capabilities?.includes(cap));
                    }
                    return true;
                })
                .map((agent: any) => ({
                    agentId: agent.id,
                    name: agent.id.replace(/-/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase()),
                    type: 'mxf-agent',
                    capabilities: agent.capabilities || [],
                    status: agent.status || 'unknown',
                    metadata: { 
                        lastSeen: Date.now(),
                        socketConnections: agent.socketIds?.length || 0,
                        channelId: targetChannelId
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
        requirements?: Record<string, any>;
        deadline?: number;
        metadata?: Record<string, any>;
    }, context: McpToolHandlerContext): Promise<McpToolHandlerResult> => {
        try {
            const coordinationId = `coord_${context.requestId}_${Date.now()}`;
            
            // Send coordination requests to target agents using existing message infrastructure
            const acceptedAgents: string[] = [];
            const rejectedAgents: Array<{ agentId: string; reason: string }> = [];

            for (const targetAgentId of input.targetAgentIds) {
                const coordinationMessage = {
                    type: 'coordination_request',
                    coordinationId,
                    coordinationType: input.coordinationType,
                    taskDescription: input.taskDescription,
                    requirements: input.requirements,
                    deadline: input.deadline,
                    requestingAgent: context.agentId
                };

                const agentMessage = createAgentMessage(
                    context.agentId!,
                    targetAgentId,
                    coordinationMessage,
                    {
                        metadata: {
                            correlationId: context.requestId,
                            ...input.metadata
                        },
                        context: {
                            messageType: 'coordination_request',
                            requestId: context.requestId,
                            coordinationId,
                            ...input.metadata
                        }
                    }
                );

                // Import EventBus and EventNames dynamically to avoid circular dependencies and ensure server-side access
                // Use imported modules

                const payload = createAgentMessageEventPayload(
                    Events.Message.AGENT_MESSAGE,
                    context.agentId!,
                    context.channelId!,
                    agentMessage
                );

                EventBus.server.emit(Events.Message.AGENT_MESSAGE, payload);
                
                // For now, assume acceptance (real implementation would wait for responses)
                acceptedAgents.push(targetAgentId);
            }


            const content: McpToolResultContent = {
                type: 'application/json',
                data: {
                    coordinationId,
                    acceptedAgents,
                    rejectedAgents,
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
