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
 * Connection Handlers
 * 
 * This module provides socket connection handling for the MXF.
 * It handles connection, disconnection, and error events.
 */

import { Server as SocketServer, Socket } from 'socket.io';
import { EventBus } from '../../../shared/events/EventBus';
import {
    AgentEvents,
    CoreSocketEvents,
    Events,
    ChannelEvents,
    ChannelActionTypes,
    AuthEvents
} from '../../../shared/events/EventNames';
import { ControlLoopEvents } from '../../../shared/events/event-definitions/ControlLoopEvents';
import { OrparEvents } from '../../../shared/events/event-definitions/OrparEvents';
import { AgentConnectionStatus } from '../../../shared/types/AgentTypes';
import { createStrictValidator } from '../../../shared/utils/validation';
import logger from '../../../shared/utils/Logger';
import { handleSocketAuthentication, sendAuthResponse } from './authenticationHandlers';
import { setupControlLoopHandlers } from './controlLoopHandlers';
import { setupMcpEventHandlers } from './mcpEventHandlers';
import { setupSocketToEventBusForwarding } from './eventForwardingHandlers';
import { setupMcpSocketToEventBusForwarding } from './eventForwardingHandlers';
import { 
    createBaseEventPayload 
} from '../../../shared/schemas/EventPayloadSchema';
import { registerTaskHandlers } from './taskHandlers';
import { 
    getNormalizedChannelName 
} from './utilityHandlers';
import { ISocketService } from '../../../shared/interfaces/SocketServiceInterface';
import { AgentService } from '../services/AgentService';
import { setupChannelContextEventBusHandlers } from './channelContextHandlers';
import { setupAdminEventHandlers } from './adminHandlers';
import { ChannelService } from '../services/ChannelService';
import { SystemLlmServiceManager } from '../services/SystemLlmServiceManager';

// Global Services - lazy initialization to avoid early singleton creation
let agentService: AgentService;

// Helper function to get AgentService instance lazily
const getAgentService = (): AgentService => {
    if (!agentService) {
        agentService = AgentService.getInstance();
    }
    return agentService;
};

// Create a logger instance for this module
const moduleLogger = logger.child('ConnectionHandlers');

// Initialize EventBus handlers once (not per socket)
let eventBusHandlersInitialized = false;

const initializeEventBusHandlers = (): void => {
    if (!eventBusHandlersInitialized) {
        setupChannelContextEventBusHandlers();
        setupAdminEventHandlers();
        eventBusHandlersInitialized = true;
    }
};

/**
 * Setup admin event forwarding for password/JWT/PAT authenticated users
 *
 * Handles bidirectional forwarding between admin socket and EventBus:
 * - Outbound: admin socket → EventBus.server (requests: channel:create, key:generate, MCP register)
 * - Inbound: EventBus.server → admin socket (responses: key:generated, MCP registered, etc.)
 *
 * The inbound path is required because the SDK listens via EventBus.client, which receives
 * events through the socket's onAny handler. Without this forwarding, response events emitted
 * to EventBus.server are only routed through forwardEventToAgent(), which fails for admin
 * sockets since they are not registered in the agent socket map.
 */
const setupAdminSocketForwarding = (socket: Socket, userId: string): void => {

    // ── Outbound: admin socket → EventBus.server (requests) ──

    // Forward channel:create events to EventBus
    socket.on(Events.Channel.CREATE, (payload: any) => {
        try {
            EventBus.server.emit(Events.Channel.CREATE, payload);
        } catch (error) {
            moduleLogger.error(`Error forwarding channel:create event: ${error}`);
        }
    });

    // Forward key:generate events to EventBus
    socket.on(Events.Key.GENERATE, (payload: any) => {
        try {
            EventBus.server.emit(Events.Key.GENERATE, payload);
        } catch (error) {
            moduleLogger.error(`Error forwarding key:generate event: ${error}`);
        }
    });

    // Forward MCP channel server events to EventBus (for SDK-level MCP server registration)
    const mcpChannelServerEvents = [
        Events.Mcp.CHANNEL_SERVER_REGISTER,
        Events.Mcp.CHANNEL_SERVER_UNREGISTER
    ];

    mcpChannelServerEvents.forEach(eventName => {
        socket.on(eventName, (payload: any) => {
            try {
                moduleLogger.info(`[ADMIN-MCP] Forwarding ${eventName} from admin socket to EventBus.server`);
                EventBus.server.emit(eventName, payload);
            } catch (error) {
                moduleLogger.error(`Error forwarding ${eventName} event: ${error}`);
            }
        });
    });

    // ── Inbound: EventBus.server → admin socket (responses) ──
    // The SDK's onAny handler picks these up and routes them to EventBus.client,
    // where registerChannelMcpServer() and generateKey() are listening.

    const adminResponseEvents = [
        // Key responses
        Events.Key.GENERATED,
        Events.Key.GENERATION_FAILED,
        // MCP channel server responses
        Events.Mcp.CHANNEL_SERVER_REGISTERED,
        Events.Mcp.CHANNEL_SERVER_REGISTRATION_FAILED,
        Events.Mcp.CHANNEL_SERVER_UNREGISTERED,
    ];

    const responseSubscriptions: any[] = [];

    adminResponseEvents.forEach(eventName => {
        const sub = EventBus.server.on(eventName, (payload: any) => {
            // Only forward events that originated from this admin user
            if (payload.agentId === userId) {
                socket.emit(eventName, payload);
            }
        });
        responseSubscriptions.push(sub);
    });

    // Clean up subscriptions when admin socket disconnects
    socket.on('disconnect', () => {
        responseSubscriptions.forEach(sub => sub.unsubscribe());
    });
};

/**
 * Handle a new socket connection
 * @param socket - New socket connection
 * @param socketService - Reference to the socket service
 */
export const handleConnection = (socket: Socket, socketService: ISocketService): void => {
    const validator = createStrictValidator('ConnectionHandlers.handleConnection');
    
    
    // Initialize EventBus handlers (once, for all connections)
    initializeEventBusHandlers();
    
    // Handle authentication data if provided with connection
    const auth = socket.handshake.auth;
    if (auth) {
        // Authenticate socket (now async)
        handleSocketAuthentication(socket, auth).then(async authenticatedId => {
            // Send authentication response to client
            await sendAuthResponse(socket, authenticatedId, auth);
            
            if (authenticatedId && socket.data?.authType === 'key') {
                const agentId = socket.data.agentId;
                const channelId = socket.data.channelId;
                
                
                // Complete socket connection with agent ID and channelId from validation
                completeSocketConnection(socket, agentId, channelId, socketService).catch(error => {
                    moduleLogger.error(`Error completing socket connection for ${agentId}: ${error}`);
                });
            } else if (authenticatedId && (socket.data?.authType === 'jwt' || socket.data?.authType === 'password' || socket.data?.authType === 'pat')) {
                // JWT, password, and PAT users don't need full agent setup, but they need admin event forwarding
                setupAdminSocketForwarding(socket, authenticatedId);
            } else {
                moduleLogger.error(`Socket authentication failed on connection: ${socket.id}`);
            }
        }).catch(error => {
            moduleLogger.error(`Socket authentication error on connection: ${socket.id} - ${error}`);
        });
    }
    
    // Handle authentication requests after connection
    socket.on('auth', (authData) => {
        const authValidator = createStrictValidator('ConnectionHandlers.auth');
        
        try {
            
            // Validate authData
            authValidator.assertIsObject(authData);
            
            // Authenticate socket (now async)
            handleSocketAuthentication(socket, authData).then(authenticatedId => {
                if (authenticatedId && socket.data?.authType === 'key') {
                    const agentId = socket.data.agentId;
                    const channelId = socket.data.channelId;
                    
                    
                    // Complete socket connection with agent ID and channelId from validation
                    completeSocketConnection(socket, agentId, channelId, socketService).catch(error => {
                        moduleLogger.error(`Error completing socket connection for ${agentId}: ${error}`);
                    });
                    
                    // Emit success event for key-based auth
                    socket.emit(AuthEvents.SUCCESS, { 
                        agentId, 
                        channelId
                    });
                } else if (authenticatedId && (socket.data?.authType === 'jwt' || socket.data?.authType === 'password' || socket.data?.authType === 'pat')) {

                    // Setup admin event forwarding
                    setupAdminSocketForwarding(socket, authenticatedId);

                    // Emit success event for JWT/password/PAT auth
                    socket.emit(AuthEvents.SUCCESS, {
                        userId: socket.data.userId,
                        username: socket.data.username
                    });
                } else {
                    moduleLogger.warn(`Socket authentication failed: ${socket.id}`);
                    socket.emit(AuthEvents.ERROR, { error: 'Authentication failed' });
                }
            }).catch(error => {
                moduleLogger.error(`Socket authentication error: ${socket.id} - ${error}`);
                socket.emit(AuthEvents.ERROR, { error: 'Authentication failed' });
            });
        } catch (error) {
            moduleLogger.error(`Auth event error: ${error}`);
            socket.emit(AuthEvents.ERROR, { error: 'Authentication failed' });
        }
    });
    
    // Handle socket error
    socket.on('error', (error) => {
        moduleLogger.error(`Socket error for ${socket.id}: ${error}`);
        handleSocketError(socket.id, socket.data?.agentId, error, socketService);
    });
    
    // Handle socket disconnect
    socket.on('disconnect', (reason) => {
        
        // Get agent ID and channel ID from socket data
        const agentId = socket.data?.agentId;
        const channelId = socket.data?.channelId;
        
        if (agentId) {
            // channelId is required for proper disconnect handling
            if (!channelId) {
                moduleLogger.warn(`Socket ${socket.id} disconnected without channelId - socket was never properly connected (Agent: ${agentId})`);
                // Unregister the socket without full disconnect processing
                socketService.unregisterSocket(socket.id, agentId);
                // Still update agent status even without channelId (e.g., admin socket reconnects as agent socket)
                const agentSvc = getAgentService();
                agentSvc.removeSocketFromAgent(agentId, socket.id);
                if (!agentSvc.hasActiveSockets(agentId)) {
                    agentSvc.updateAgentStatus(agentId, AgentConnectionStatus.DISCONNECTED);
                }
                return;
            }
            
            // Handle socket disconnection with valid channelId
            handleSocketDisconnect(socket.id, channelId, agentId, reason, socketService);
        }
    });
};

/**
 * Complete the socket connection process
 * This ensures everything is properly set up and the client is notified
 * 
 * @param socket The socket to complete connection for
 * @param agentId The agent ID associated with the socket
 * @param channelId The channel ID for the connection
 * @param socketService Reference to the socket service
 */
export const completeSocketConnection = async (
    socket: Socket, 
    agentId: string, 
    channelId: string,
    socketService: ISocketService
): Promise<void> => {
    const moduleValidator = createStrictValidator('ConnectionHandlers.completeSocketConnection');
    
    try {
        moduleValidator.assertIsNonEmptyString(agentId);
        
        // Register socket with socket service
        socketService.registerSocket(socket, agentId, channelId);
        
        // Extract capabilities and allowedTools from socket auth data
        const capabilities = socket.handshake.auth?.capabilities || [];
        const allowedTools = socket.handshake.auth?.allowedTools || [];
        
        // Register agent in agent service if not already registered
        if (!getAgentService().agentExists(agentId)) {
            // Register agent with capabilities and allowedTools from socket auth
            getAgentService().registerAgent(agentId, capabilities, allowedTools);
        } else {
            // Update existing agent with capabilities and allowedTools if provided
            if (capabilities.length > 0) {
                try {
                    getAgentService().updateAgentCapabilities(agentId, capabilities);
                } catch (error) {
                    moduleLogger.error(`Failed to update agent capabilities for ${agentId}: ${error}`);
                }
            }
            
            // Update allowedTools if provided
            if (allowedTools.length > 0) {
                try {
                    getAgentService().updateAgentAllowedTools(agentId, allowedTools);
                } catch (error) {
                    moduleLogger.error(`Failed to update agent allowed tools for ${agentId}: ${error}`);
                }
            }
        }
        
        // Add socket to agent in AgentService for proper tracking (AFTER agent exists)
        getAgentService().addSocketToAgent(agentId, socket.id);
        
        // Mark agent as connected in agent service
        getAgentService().updateAgentStatus(agentId, AgentConnectionStatus.CONNECTED);
        
        // Note: Agent registration with capabilities is now handled via socket auth data
        // This ensures capabilities are available immediately when agents connect
        
        // Add socket to channel if a channelId was provided
        if (channelId) {
            try {
                // Format channel name correctly
                const roomName = getNormalizedChannelName(channelId);
                
                // Join socket to room
                socket.join(roomName);
                //;
                
                // Add participant to ChannelService for proper tracking
                // Note: addParticipant internally emits AGENT_JOINED event via notifyChannelEvent
                const channelService = ChannelService.getInstance();
                await channelService.addParticipant(channelId, agentId, agentId);
                
                // Emit the channel:joined event needed by the SDK
                const channelJoinedPayload = createBaseEventPayload(
                    Events.Agent.JOIN_CHANNEL,
                    agentId,
                    channelId,
                    {
                        status: 'joined',
                        success: true,
                        timestamp: Date.now()
                    }
                );
                
                EventBus.server.emit(Events.Agent.JOIN_CHANNEL, channelJoinedPayload);
                
                // Initialize SystemLlmService for this channel to enable real-time monitoring
                try {
                    const systemLlmServiceManager = SystemLlmServiceManager.getInstance();
                    const systemLlmService = systemLlmServiceManager.getServiceForChannel(channelId);
                } catch (error) {
                    moduleLogger.error(`Failed to initialize SystemLlmService for channel ${channelId}: ${error}`);
                }
                
            } catch (error) {
                moduleLogger.error(`Error adding socket ${socket.id} to channel ${channelId}: ${error}`);
                // Continue with connection despite channel join error
            }
        }
        
        // Set up event handlers for this socket
        
        // 1. Set up socket event forwarding to EventBus
        setupSocketToEventBusForwarding(socket, agentId, channelId);
        
        // 2. Set up MCP socket-to-EventBus forwarding
        setupMcpSocketToEventBusForwarding(socket, agentId, channelId);
        
        // 3. Set up control loop event handlers
        setupControlLoopHandlers(socket, agentId, channelId);
        
        // 4. Set up MCP event handlers
        setupMcpEventHandlers(socket, agentId, channelId);
        
        // 5. Set up task event handlers
        try {
            registerTaskHandlers(socket, agentId, channelId);
        } catch (error) {
            moduleLogger.error(`[ERROR] Failed to register task handlers for socket ${socket.id}:`, error);
        }

        // 6. Set up heartbeat handler to keep connection alive
        socket.on('heartbeat', (payload: any) => {
            try {
                // Update the agent's heartbeat timestamp
                socketService.updateHeartbeat(agentId);
                //;
            } catch (error) {
                moduleLogger.error(`Error handling heartbeat from agent ${agentId}: ${error}`);
            }
        });

        // 7. Set up allowed tools update handler for dynamic tool changes
        socket.on(Events.Agent.ALLOWED_TOOLS_UPDATE, (payload: { agentId: string; allowedTools: string[] }) => {
            try {
                const updated = getAgentService().updateAgentAllowedTools(payload.agentId, payload.allowedTools);

                if (updated) {
                    moduleLogger.info(`Updated allowedTools for ${payload.agentId}: ${payload.allowedTools.length} tools`);
                    socket.emit(Events.Agent.ALLOWED_TOOLS_UPDATED, {
                        agentId: payload.agentId,
                        allowedTools: payload.allowedTools,
                        success: true
                    });
                } else {
                    moduleLogger.warn(`Failed to update allowedTools for ${payload.agentId}: agent not found`);
                    socket.emit(Events.Agent.ALLOWED_TOOLS_UPDATED, {
                        agentId: payload.agentId,
                        allowedTools: payload.allowedTools,
                        success: false
                    });
                }
            } catch (error) {
                moduleLogger.error(`Error updating allowedTools for ${payload.agentId}: ${error}`);
                socket.emit(Events.Agent.ALLOWED_TOOLS_UPDATED, {
                    agentId: payload.agentId,
                    allowedTools: payload.allowedTools || [],
                    success: false
                });
            }
        });

        // Get current agent to include actual capabilities in registration payload
        const currentAgent = getAgentService().getAgent(agentId);
        const agentCapabilities = currentAgent?.capabilities || [];
        
        // Emit agent registered event with proper event payload structure
        const registrationPayload = createBaseEventPayload(
            AgentEvents.REGISTERED,
            agentId,
            channelId,
            {
                socketId: socket.id,
                timestamp: Date.now(),
                status: AgentConnectionStatus.REGISTERED,
                capabilities: agentCapabilities
            }
        );
        
        // Log that we're emitting this critical event
        EventBus.server.emit(AgentEvents.REGISTERED, registrationPayload);
        
        // Emit agent connected event with proper event payload structure
        const connectionPayload = createBaseEventPayload(
            AgentEvents.CONNECTED,
            agentId,
            channelId,
            {
                socketId: socket.id,
                timestamp: Date.now()
            }
        );
        
        // Log that we're emitting this critical event
        EventBus.server.emit(AgentEvents.CONNECTED, connectionPayload);
        
    } catch (error) {
        moduleLogger.error(`Error completing socket connection: ${error}`);
        throw error;
    }
};

/**
 * Setup socket event handlers and forward events
 * @param socket Socket instance
 * @param agentId Agent ID
 * @param channelId Channel ID
 * @param socketService Reference to the socket service
 */
export const setupSocketEventHandling = (
    socket: Socket, 
    agentId: string, 
    channelId: string,
    socketService: ISocketService
): void => {
    const validator = createStrictValidator('ConnectionHandlers.setupSocketEventHandling');
    
    try {
        
        // Validate parameters
        validator.assertIsNonEmptyString(agentId);
        
        // Setup MCP socket-to-EventBus forwarding
        setupMcpSocketToEventBusForwarding(socket, agentId, channelId);
        
        // Setup MCP event handlers if present
        setupMcpEventHandlers(socket, agentId, channelId);
        
        // Build a set of server-originated events that should NOT be routed back to EventBus.server
        // These events are emitted by the server (OrparTools, ControlLoop) and forwarded to clients.
        // If clients re-emit them back, we must NOT re-forward to EventBus.server to prevent loops.
        const serverOriginatedEvents = new Set([
            // ControlLoop events (server-orchestrated)
            ...Object.values(ControlLoopEvents),
            // ORPAR events (agent-driven cognitive documentation via server-side OrparTools)
            ...Object.values(OrparEvents)
        ]);

        // Use event bus to route client events to server
        socket.onAny((eventName, payload) => {
            // Skip internal events
            if (eventName.startsWith('connection:') ||
                eventName === AuthEvents.SUCCESS ||
                eventName === AuthEvents.ERROR ||
                eventName === 'disconnect' ||
                eventName === 'error') {
                return;
            }

            // Skip server-originated events to prevent client → server → client loops
            // These events originate from OrparTools/ControlLoop, are forwarded to clients,
            // and should NOT be re-emitted to EventBus.server when clients echo them back
            if (serverOriginatedEvents.has(eventName)) {
                return;
            }

            // Route event to server
            routeClientEventToServer(socket, eventName, payload, socketService);
        });
        
    } catch (error) {
        moduleLogger.error(`Error setting up socket event handlers: ${error}`);
        socket.emit('connection:error', { error: 'Event handler setup failed' });
    }
};

/**
 * Receive an event from a client and route it to the server-side event bus
 * @param socket - Socket.io socket
 * @param eventName - Name of the event
 * @param payload - Event payload
 * @param socketService Reference to the socket service
 */
export const routeClientEventToServer = (
    socket: Socket, 
    eventName: string, 
    payload: any,
    socketService: ISocketService
): void => {
    try {
        // Get socket metadata
        const agentId = socket.data?.agentId;
        const channelId = socket.data?.channelId;
        
        if (!agentId) {
            moduleLogger.warn(`Unauthorized event from socket ${socket.id}: ${eventName}`);
            return;
        }
        
        // Update agent heartbeat on activity
        socketService.updateHeartbeat(agentId);
        
        // Create full payload with socket metadata using our utility function
        // Use 'system' as default channel for agents not yet in a specific channel
        const effectiveChannelId = channelId || 'system';
        const fullPayload = createBaseEventPayload(
            eventName, 
            agentId, 
            effectiveChannelId, 
            payload
        );
        
        // Emit event on EventBus
        EventBus.server.emit(eventName, fullPayload);
    } catch (error) {
        moduleLogger.error(`Error routing client event to server: ${error}`);
    }
};

/**
 * Handle a socket disconnection
 * @param socketId - Socket ID that disconnected
 * @param agentId - Agent ID
 * @param reason - Reason for disconnection
 * @param socketService Reference to the socket service
 * @param channelId Channel ID
 */
export const handleSocketDisconnect = async (
    socketId: string, 
    channelId: string,
    agentId: string, 
    reason: string,
    socketService: ISocketService,
): Promise<void> => {
    try {
        const validator = createStrictValidator('handleSocketDisconnect');
        
        // Validate parameters
        validator.assertIsNonEmptyString(socketId);
        validator.assertIsNonEmptyString(agentId);
        
        
        // Create properly structured disconnection event payload using the helper function
        const disconnectPayload = createBaseEventPayload(
            Events.Agent.DISCONNECTED,
            agentId,
            channelId,
            {
                status: 'disconnected',
                reason: reason,
                socketId: socketId,
                timestamp: Date.now()
            }
        );
        
        // Use a direct event emission without going through our forwarders
        // This prevents potential recursion and "Socket not found" warnings
        // when the socket is already gone
        EventBus.server.emit(Events.Agent.DISCONNECTED, disconnectPayload);
        
        // Unregister the socket - this will also clear associated data
        socketService.unregisterSocket(socketId, agentId);
        
        // Update agent status in AgentService for proper tracking
        // Use AgentService.getInstance() directly — the old (socketService as any).agentService
        // pattern was always null because SocketService's lazy getter was never called
        const agentSvc = getAgentService();
        agentSvc.removeSocketFromAgent(agentId, socketId);

        // Check if the agent has any remaining sockets before updating status
        if (!agentSvc.hasActiveSockets(agentId)) {
            agentSvc.updateAgentStatus(agentId, AgentConnectionStatus.DISCONNECTED);
        }
        
        // Remove agent from channel to trigger SystemLLM cleanup
        // This is required for proper cleanup of SystemLlmService when all agents disconnect
        if (channelId) {
            try {
                const channelService = ChannelService.getInstance();
                await channelService.removeParticipant(channelId, agentId, agentId);
            } catch (error) {
                logger.error(`Failed to remove agent ${agentId} from channel ${channelId}: ${error}`);
            }
        }
        
    } catch (error) {
        logger.error(`Error handling socket disconnect: ${error}`);
    }
};

/**
 * Handle a socket error
 * @param socketId - Socket ID with the error
 * @param agentId - Agent ID
 * @param error - Error object
 * @param socketService Reference to the socket service
 */
export const handleSocketError = (
    socketId: string, 
    agentId: string | undefined, 
    error: Error,
    socketService: ISocketService
): void => {
    try {
        moduleLogger.error(`Socket error: ${socketId}, error: ${error.message}`);
        
        if (!agentId) {
            moduleLogger.warn(`Socket error occurred on unauthenticated socket: ${socketId}`);
            return;
        }
        
        // Get the channel ID if available
        const socketInfo = socketService.getAgentSocketInfo(agentId);
        
        // Only emit error event if we have valid socket info with channelId
        if (!socketInfo?.channelId) {
            moduleLogger.error(`Cannot emit agent error event - socket info missing or invalid channelId for agent ${agentId}`);
            return;
        }
        
        // Emit error event via EventBus, conforming to 'agent:error' schema
        EventBus.server.emit(AgentEvents.ERROR, {
            agentId,
            channelId: socketInfo.channelId,
            error: error.message
        });
        
        // Update agent status in AgentService
        getAgentService().updateAgentStatus(agentId, AgentConnectionStatus.ERROR);
        
    } catch (innerError) {
        moduleLogger.error(`Error handling socket error: ${innerError}`);
    }
};