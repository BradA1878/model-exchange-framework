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
 * Connection Handlers
 * 
 * This module provides socket connection handling for the MXF.
 * It handles connection, disconnection, and error events.
 */

import { Server as SocketServer, Socket } from 'socket.io';
import { EventBus } from '@mxf-dev/core/events/EventBus';
import {
    AgentEvents,
    CoreSocketEvents,
    Events,
    ChannelEvents,
    ChannelActionTypes,
    AuthEvents
} from '@mxf-dev/core/events/EventNames';
import { AgentConnectionStatus } from '@mxf-dev/core/types/AgentTypes';
import { createStrictValidator } from '@mxf-dev/core/utils/validation';
import logger from '@mxf-dev/core/utils/Logger';
import { handleSocketAuthentication, sendAuthResponse } from './authenticationHandlers';
import { setupControlLoopHandlers } from './controlLoopHandlers';
import { setupMcpEventHandlers } from './mcpEventHandlers';
import { setupSocketToEventBusForwarding } from './eventForwardingHandlers';
import { setupMcpSocketToEventBusForwarding } from './eventForwardingHandlers';
import { 
    createBaseEventPayload 
} from '@mxf-dev/core/schemas/EventPayloadSchema';
import { registerTaskHandlers } from './taskHandlers';
import { 
    getNormalizedChannelName 
} from './utilityHandlers';
import { ISocketService } from '@mxf-dev/core/interfaces/SocketServiceInterface';
import { AgentService } from '../services/AgentService';
import { setupChannelContextEventBusHandlers } from './channelContextHandlers';
import { setupAdminEventHandlers } from './adminHandlers';
import { ChannelService } from '../services/ChannelService';
import { SystemLlmServiceManager } from '../services/SystemLlmServiceManager';
import { UserRole } from '@mxf-dev/core/models/user';
import {
    isStdioMcpTransport,
    isUnsafeStdioMcpEnabled
} from '@mxf-dev/core/protocols/mcp/security/ExternalMcpRegistrationPolicy';
import { authorizationService } from '../../api/services/AuthorizationService';
import { resolveCredentialBoundAgentPolicy } from '../services/ToolAuthorizationPolicy';
import { userSessionLifecycle } from '../services/UserSessionLifecycle';

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

/** The failure event that answers each MCP server management request. */
const MCP_REQUEST_FAILURE_EVENTS: ReadonlyMap<string, string> = new Map([
    [Events.Mcp.CHANNEL_SERVER_REGISTER, Events.Mcp.CHANNEL_SERVER_REGISTRATION_FAILED],
    [Events.Mcp.CHANNEL_SERVER_UNREGISTER, Events.Mcp.CHANNEL_SERVER_UNREGISTERED],
    [Events.Mcp.EXTERNAL_SERVER_REGISTER, Events.Mcp.EXTERNAL_SERVER_REGISTRATION_FAILED],
    [Events.Mcp.EXTERNAL_SERVER_UNREGISTER, Events.Mcp.EXTERNAL_SERVER_UNREGISTERED]
]);

/**
 * Answer an MCP server management request on the socket that sent it with the
 * failure event the SDK is waiting for.
 *
 * The SDK correlates these responses on data.serverId and, for channel
 * servers, data.scopeId. Every refusal — including a denial for a user
 * without administrator rights — must carry both, or the client never sees
 * the answer and waits out its request timeout instead.
 */
const emitMcpRequestFailure = (
    socket: Socket,
    userId: string,
    requestEvent: string,
    payload: unknown,
    error: string
): void => {
    const failureEvent = MCP_REQUEST_FAILURE_EVENTS.get(requestEvent);
    if (!failureEvent) {
        throw new Error(`No failure event is defined for MCP request ${requestEvent}`);
    }
    const envelope = payload !== null && typeof payload === 'object'
        ? payload as Record<string, unknown>
        : {};
    const data = envelope.data !== null && typeof envelope.data === 'object'
        ? envelope.data as Record<string, unknown>
        : {};
    const channelId = typeof envelope.channelId === 'string' &&
        envelope.channelId.trim().length > 0
        ? envelope.channelId
        : 'system';
    const isChannelScoped = requestEvent.startsWith('mcp:channel:');

    socket.emit(
        failureEvent,
        createBaseEventPayload(failureEvent, userId, channelId, {
            ...(isChannelScoped ? { channelId } : {}),
            serverId: data.id || data.serverId,
            scopeId: isChannelScoped ? channelId : undefined,
            success: false,
            error
        })
    );
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
    if (socket.data?.role !== UserRole.ADMIN) {
        moduleLogger.warn(`Installing user-scoped administrative handlers for non-admin user ${userId}`);

        // These public SDK operations are asynchronous. Track the exact
        // user/channel requests this socket forwarded so success (including a
        // one-time plaintext key secret) returns only to its requester and only
        // once. The event contract has no request id in responses, so enforce a
        // single in-flight request of each kind per channel.
        const pendingChannelCreations = new Set<string>();
        const pendingKeyGenerations = new Set<string>();
        const userResponseSubscriptions: Array<{ unsubscribe?: () => void }> = [];

        [
            Events.Channel.CREATED,
            Events.Channel.CREATION_FAILED,
            Events.Key.GENERATED,
            Events.Key.GENERATION_FAILED
        ].forEach(eventName => {
            const subscription = EventBus.server.on(eventName, (payload: unknown) => {
                if (payload === null || typeof payload !== 'object') {
                    return;
                }
                const response = payload as Record<string, unknown>;
                if (response.agentId !== userId ||
                    typeof response.channelId !== 'string' ||
                    response.channelId.trim().length === 0) {
                    return;
                }

                const responseData = response.data !== null &&
                    typeof response.data === 'object'
                    ? response.data as Record<string, unknown>
                    : undefined;

                const responseChannelId = response.channelId;
                if (responseData?.channelId !== undefined &&
                    responseData.channelId !== responseChannelId) {
                    return;
                }

                const pendingRequests = eventName === Events.Channel.CREATED ||
                    eventName === Events.Channel.CREATION_FAILED
                    ? pendingChannelCreations
                    : pendingKeyGenerations;
                if (!pendingRequests.delete(responseChannelId)) {
                    return;
                }

                socket.emit(eventName, payload);
            });
            userResponseSubscriptions.push(subscription);
        });

        socket.on(CoreSocketEvents.DISCONNECT, () => {
            userResponseSubscriptions.forEach(subscription => subscription.unsubscribe?.());
            pendingChannelCreations.clear();
            pendingKeyGenerations.clear();
        });

        const readUserRequest = (
            eventName: string,
            payload: unknown
        ): { channelId: string; data: Record<string, unknown> } | null => {
            if (payload === null || typeof payload !== 'object') {
                return null;
            }
            const envelope = payload as Record<string, unknown>;
            if (envelope.eventType !== eventName ||
                envelope.agentId !== userId ||
                typeof envelope.channelId !== 'string' ||
                envelope.channelId.trim().length === 0 ||
                envelope.data === null ||
                typeof envelope.data !== 'object') {
                return null;
            }
            const data = envelope.data as Record<string, unknown>;
            if (data.channelId !== undefined && data.channelId !== envelope.channelId) {
                return null;
            }
            return { channelId: envelope.channelId, data };
        };

        socket.on(Events.Channel.CREATE, (payload: unknown) => {
            let pendingChannelId: string | undefined;
            void (async (): Promise<void> => {
                const request = readUserRequest(Events.Channel.CREATE, payload);
                if (!request) {
                    socket.emit(
                        Events.Channel.CREATION_FAILED,
                        createBaseEventPayload(
                            Events.Channel.CREATION_FAILED,
                            userId,
                            'system',
                            { error: 'Invalid channel creation request' }
                        )
                    );
                    return;
                }

                pendingChannelId = request.channelId;
                if (pendingChannelCreations.has(request.channelId)) {
                    socket.emit(
                        Events.Channel.CREATION_FAILED,
                        createBaseEventPayload(
                            Events.Channel.CREATION_FAILED,
                            userId,
                            request.channelId,
                            {
                                channelId: request.channelId,
                                error: 'Channel creation is already in progress'
                            }
                        )
                    );
                    return;
                }
                pendingChannelCreations.add(request.channelId);

                // Creation is idempotent only for the existing owner. Without
                // this preflight, ChannelService returns any existing channel
                // and the global admin handler emits CREATED to the attacker.
                const decision = await authorizationService.authorize(
                    'manage',
                    'channel',
                    request.channelId,
                    { kind: 'user', userId, role: String(socket.data?.role ?? '') }
                );
                if (!decision.allowed && decision.status !== 404) {
                    pendingChannelCreations.delete(request.channelId);
                    socket.emit(
                        Events.Channel.CREATION_FAILED,
                        createBaseEventPayload(
                            Events.Channel.CREATION_FAILED,
                            userId,
                            request.channelId,
                            {
                                channelId: request.channelId,
                                error: 'An existing channel can only be opened by its owner'
                            }
                        )
                    );
                    return;
                }

                EventBus.server.emit(
                    Events.Channel.CREATE,
                    createBaseEventPayload(
                        Events.Channel.CREATE,
                        userId,
                        request.channelId,
                        request.data
                    )
                );
            })().catch(error => {
                if (pendingChannelId) {
                    pendingChannelCreations.delete(pendingChannelId);
                }
                moduleLogger.error(`Failed to authorize channel creation for ${userId}: ${error}`);
                socket.emit(
                    Events.Channel.CREATION_FAILED,
                    createBaseEventPayload(
                        Events.Channel.CREATION_FAILED,
                        userId,
                        'system',
                        { error: 'Channel creation authorization failed' }
                    )
                );
            });
        });

        socket.on(Events.Key.GENERATE, (payload: unknown) => {
            let pendingChannelId: string | undefined;
            void (async (): Promise<void> => {
                const request = readUserRequest(Events.Key.GENERATE, payload);
                if (request) {
                    pendingChannelId = request.channelId;
                    if (pendingKeyGenerations.has(request.channelId)) {
                        socket.emit(
                            Events.Key.GENERATION_FAILED,
                            createBaseEventPayload(
                                Events.Key.GENERATION_FAILED,
                                userId,
                                request.channelId,
                                {
                                    channelId: request.channelId,
                                    success: false,
                                    error: 'Key generation is already in progress'
                                }
                            )
                        );
                        return;
                    }
                    pendingKeyGenerations.add(request.channelId);

                    const decision = await authorizationService.authorize(
                        'manage',
                        'channel',
                        request.channelId,
                        { kind: 'user', userId, role: String(socket.data?.role ?? '') }
                    );
                    if (decision.allowed) {
                        EventBus.server.emit(
                            Events.Key.GENERATE,
                            createBaseEventPayload(
                                Events.Key.GENERATE,
                                userId,
                                request.channelId,
                                { ...request.data, channelId: request.channelId }
                            )
                        );
                        return;
                    }

                    pendingKeyGenerations.delete(request.channelId);
                }

                const envelope = payload !== null && typeof payload === 'object'
                    ? payload as Record<string, unknown>
                    : {};
                const channelId = typeof envelope.channelId === 'string'
                    ? envelope.channelId
                    : 'system';
                socket.emit(
                    Events.Key.GENERATION_FAILED,
                    createBaseEventPayload(
                        Events.Key.GENERATION_FAILED,
                        userId,
                        channelId,
                        {
                            channelId,
                            success: false,
                            error: 'Channel ownership is required to generate a key'
                        }
                    )
                );
            })().catch(error => {
                if (pendingChannelId) {
                    pendingKeyGenerations.delete(pendingChannelId);
                }
                moduleLogger.error(`Failed to authorize key generation for ${userId}: ${error}`);
                const channelId = pendingChannelId ?? 'system';
                socket.emit(
                    Events.Key.GENERATION_FAILED,
                    createBaseEventPayload(
                        Events.Key.GENERATION_FAILED,
                        userId,
                        channelId,
                        {
                            channelId,
                            success: false,
                            error: 'Key generation authorization failed'
                        }
                    )
                );
            });
        });

        // MCP server management needs an administrator. A denial still answers
        // the request: before this, the reply lacked the scopeId the SDK
        // correlates on, so a non-admin registration waited out the SDK's
        // timeout (twice, for a caller that unregisters and retries).
        MCP_REQUEST_FAILURE_EVENTS.forEach((_failureEvent, requestEvent) => {
            socket.on(requestEvent, (payload: unknown) => {
                emitMcpRequestFailure(
                    socket,
                    userId,
                    requestEvent,
                    payload,
                    'Administrator privileges are required for this operation'
                );
            });
        });
        return;
    }

    const requestedExternalServerIds = new Set<string>();

    const readAdminRequest = (
        eventName: string,
        payload: unknown
    ): { channelId: string; data: Record<string, unknown> } | null => {
        if (payload === null || typeof payload !== 'object') {
            moduleLogger.warn(`Denied malformed ${eventName} request from admin socket ${socket.id}`);
            return null;
        }

        const envelope = payload as Record<string, unknown>;
        if (typeof envelope.eventId !== 'string' ||
            envelope.eventType !== eventName ||
            envelope.agentId !== userId ||
            typeof envelope.channelId !== 'string' ||
            envelope.channelId.trim().length === 0 ||
            envelope.data === null ||
            typeof envelope.data !== 'object') {
            moduleLogger.warn(`Denied untrusted ${eventName} envelope from admin socket ${socket.id}`);
            return null;
        }

        const data = envelope.data as Record<string, unknown>;
        const dataChannelId = data.channelId;
        if (dataChannelId !== undefined && dataChannelId !== envelope.channelId) {
            moduleLogger.warn(`Denied channel mismatch in ${eventName} from admin socket ${socket.id}`);
            return null;
        }

        return { channelId: envelope.channelId, data };
    };

    const forwardAdminRequest = (eventName: string, payload: unknown): void => {
        const request = readAdminRequest(eventName, payload);
        if (!request) {
            return;
        }

        EventBus.server.emit(
            eventName,
            createBaseEventPayload(eventName, userId, request.channelId, {
                ...request.data,
                ...(request.data.channelId === undefined ? {} : { channelId: request.channelId })
            })
        );
    };

    const emitAdminMcpFailure = (requestEvent: string, payload: unknown, error: string): void => {
        emitMcpRequestFailure(socket, userId, requestEvent, payload, error);
    };

    // ── Outbound: admin socket → EventBus.server (requests) ──

    // Forward channel:create events to EventBus
    socket.on(Events.Channel.CREATE, (payload: unknown) => {
        try {
            forwardAdminRequest(Events.Channel.CREATE, payload);
        } catch (error) {
            moduleLogger.error(`Error forwarding channel:create event: ${error}`);
        }
    });

    // Forward key:generate events to EventBus
    socket.on(Events.Key.GENERATE, (payload: unknown) => {
        try {
            forwardAdminRequest(Events.Key.GENERATE, payload);
        } catch (error) {
            moduleLogger.error(`Error forwarding key:generate event: ${error}`);
        }
    });

    // Forward MCP channel server events to EventBus (for SDK-level MCP server registration)
    const adminMcpServerEvents = [
        Events.Mcp.CHANNEL_SERVER_REGISTER,
        Events.Mcp.CHANNEL_SERVER_UNREGISTER,
        Events.Mcp.EXTERNAL_SERVER_REGISTER,
        Events.Mcp.EXTERNAL_SERVER_UNREGISTER
    ];

    adminMcpServerEvents.forEach(eventName => {
        socket.on(eventName, (payload: unknown) => {
            let correlatedExternalServerId: string | undefined;
            try {
                const request = readAdminRequest(eventName, payload);
                if (!request) {
                    emitAdminMcpFailure(eventName, payload, 'Invalid administrative MCP request envelope');
                    return;
                }

                const isRegistration = eventName === Events.Mcp.CHANNEL_SERVER_REGISTER ||
                    eventName === Events.Mcp.EXTERNAL_SERVER_REGISTER;
                const registrationDenied = isRegistration &&
                    isStdioMcpTransport(request.data.transport) &&
                    !isUnsafeStdioMcpEnabled();
                if (registrationDenied) {
                    moduleLogger.warn(
                        `Denied ${eventName} from socket user ${userId}: ` +
                        'registration requires the explicit unsafe capability'
                    );

                    emitAdminMcpFailure(
                        eventName,
                        payload,
                        'MCP server registration is disabled or not authorized'
                    );
                    return;
                }

                if (eventName === Events.Mcp.EXTERNAL_SERVER_REGISTER) {
                    const serverId = request.data.id;
                    if (typeof serverId !== 'string' || serverId.trim().length === 0) {
                        moduleLogger.warn(`Denied external MCP registration without a server id from ${userId}`);
                        emitAdminMcpFailure(eventName, payload, 'External MCP server id is required');
                        return;
                    }
                    correlatedExternalServerId = serverId;
                    requestedExternalServerIds.add(serverId);
                } else if (eventName === Events.Mcp.EXTERNAL_SERVER_UNREGISTER) {
                    const serverId = request.data.serverId;
                    if (typeof serverId !== 'string' || serverId.trim().length === 0) {
                        moduleLogger.warn(`Denied external MCP unregistration without a server id from ${userId}`);
                        emitAdminMcpFailure(eventName, payload, 'External MCP server id is required');
                        return;
                    }
                }

                moduleLogger.info(`[ADMIN-MCP] Forwarding ${eventName} from admin socket to EventBus.server`);
                EventBus.server.emit(
                    eventName,
                    createBaseEventPayload(eventName, userId, request.channelId, {
                        ...request.data,
                        ...(eventName === Events.Mcp.CHANNEL_SERVER_REGISTER ||
                            eventName === Events.Mcp.CHANNEL_SERVER_UNREGISTER
                            ? { channelId: request.channelId }
                            : {})
                    })
                );
            } catch (error) {
                if (correlatedExternalServerId) {
                    requestedExternalServerIds.delete(correlatedExternalServerId);
                }
                moduleLogger.error(`Error forwarding ${eventName} event: ${error}`);
                emitAdminMcpFailure(
                    eventName,
                    payload,
                    error instanceof Error ? error.message : 'Administrative MCP request failed'
                );
            }
        });
    });

    // ── Inbound: EventBus.server → admin socket (responses) ──
    // The SDK's onAny handler picks these up and routes them to EventBus.client,
    // where registerChannelMcpServer() and generateKey() are listening.

    const adminResponseEvents = [
        // Channel responses
        Events.Channel.CREATED,
        Events.Channel.CREATION_FAILED,
        // Key responses
        Events.Key.GENERATED,
        Events.Key.GENERATION_FAILED,
        // MCP channel server responses
        Events.Mcp.CHANNEL_SERVER_REGISTERED,
        Events.Mcp.CHANNEL_SERVER_REGISTRATION_FAILED,
        Events.Mcp.CHANNEL_SERVER_UNREGISTERED,
        // Global MCP server responses
        Events.Mcp.EXTERNAL_SERVER_REGISTERED,
        Events.Mcp.EXTERNAL_SERVER_REGISTRATION_FAILED,
        Events.Mcp.EXTERNAL_SERVER_UNREGISTERED,
        Events.Mcp.EXTERNAL_SERVER_TOOLS_DISCOVERED,
    ];

    const responseSubscriptions: any[] = [];

    adminResponseEvents.forEach(eventName => {
        const sub = EventBus.server.on(eventName, (payload: any) => {
            const serverId = payload?.data?.serverId;
            const isCorrelatedToolsDiscovery = eventName === Events.Mcp.EXTERNAL_SERVER_TOOLS_DISCOVERED &&
                typeof serverId === 'string' &&
                requestedExternalServerIds.has(serverId);

            // Most responses retain the requester identity. Tool discovery is
            // emitted by the global manager as SYSTEM, so correlate it to a
            // server id this exact admin socket requested rather than exposing
            // every global discovery event to every administrator.
            if (payload.agentId === userId || isCorrelatedToolsDiscovery) {
                socket.emit(eventName, payload);

                if (typeof serverId === 'string' &&
                    (eventName === Events.Mcp.EXTERNAL_SERVER_TOOLS_DISCOVERED ||
                        eventName === Events.Mcp.EXTERNAL_SERVER_REGISTRATION_FAILED ||
                        eventName === Events.Mcp.EXTERNAL_SERVER_UNREGISTERED)) {
                    requestedExternalServerIds.delete(serverId);
                }
            }
        });
        responseSubscriptions.push(sub);
    });

    // Clean up subscriptions when admin socket disconnects
    socket.on(CoreSocketEvents.DISCONNECT, () => {
        responseSubscriptions.forEach(sub => sub?.unsubscribe());
        requestedExternalServerIds.clear();
    });
};

/**
 * Handle a new socket connection
 * @param socket - New socket connection
 * @param socketService - Reference to the socket service
 */
export const handleConnection = (socket: Socket, socketService: ISocketService): void => {
    const validator = createStrictValidator('ConnectionHandlers.handleConnection');
    let authenticationInFlight = false;
    let authenticationCompleted = false;
    let authenticationTerminal = false;

    const rejectDuplicateAuthentication = (): void => {
        moduleLogger.warn(`Rejected repeated authentication attempt for socket ${socket.id}`);
        socket.emit(AuthEvents.ERROR, {
            error: 'Socket authentication is already in progress or complete'
        });
    };

    const authenticateAndComplete = async (
        authData: unknown,
        responseMode: 'handshake' | 'event'
    ): Promise<void> => {
        if (authenticationInFlight || authenticationCompleted || authenticationTerminal) {
            rejectDuplicateAuthentication();
            return;
        }

        authenticationInFlight = true;
        // A socket gets one credential attempt, whether it arrives in the
        // handshake or through the post-connect auth event. Failed attempts are
        // terminal so this endpoint cannot become an unlimited password/PAT/JWT
        // oracle, and a handshake/auth race cannot start a second validator.
        authenticationTerminal = true;

        try {
            validator.assertIsObject(authData);

            const authenticatedId = await handleSocketAuthentication(socket, authData);
            if (!authenticatedId) {
                moduleLogger.warn(`Socket authentication failed: ${socket.id}`);
                if (responseMode === 'handshake') {
                    await sendAuthResponse(socket, null, authData);
                } else {
                    socket.emit(AuthEvents.ERROR, { error: 'Authentication failed' });
                }
                socket.data.authenticated = false;
                if (socket.connected !== false) {
                    socket.disconnect(true);
                }
                return;
            }

            if (socket.data?.authType === 'key') {
                const agentId = socket.data.agentId;
                const channelId = socket.data.channelId;

                // Completion is part of authentication. In particular, a key
                // whose persisted channel no longer exists must not leave an
                // authenticated socket with request handlers installed.
                await completeSocketConnection(socket, agentId, channelId, socketService);
            } else if (socket.data?.authType === 'jwt' ||
                socket.data?.authType === 'password' ||
                socket.data?.authType === 'pat') {
                // Registration validates the immutable user/token identity and
                // installs JWT/PAT hard-expiry before privileged forwarding.
                // If lifecycle is unavailable, authentication fails closed.
                await userSessionLifecycle.registerUserSession(
                    socket,
                    () => setupAdminSocketForwarding(socket, authenticatedId)
                );
            } else {
                throw new Error('Unsupported authenticated socket type');
            }

            // Set the guard before emitting a response. A response callback can
            // synchronously cause another client auth event in tests and in some
            // Socket.IO adapters; it must observe the completed state.
            authenticationCompleted = true;

            if (responseMode === 'handshake') {
                await sendAuthResponse(socket, authenticatedId, authData);
            } else if (socket.data?.authType === 'key') {
                socket.emit(AuthEvents.SUCCESS, {
                    agentId: socket.data.agentId,
                    channelId: socket.data.channelId
                });
            } else {
                socket.emit(AuthEvents.SUCCESS, {
                    userId: socket.data.userId,
                    username: socket.data.username
                });
            }
        } catch (error) {
            moduleLogger.error(`Socket authentication error for ${socket.id}: ${error}`);
            if (socket.connected !== false) {
                socket.emit(AuthEvents.ERROR, { error: 'Authentication failed' });
            }
            if (authenticationTerminal && !authenticationCompleted) {
                socket.data.authenticated = false;
                socket.disconnect(true);
            }
        } finally {
            authenticationInFlight = false;
        }
    };
    
    // Initialize EventBus handlers (once, for all connections)
    initializeEventBusHandlers();
    
    // Handle authentication data if provided with connection
    const auth = socket.handshake.auth;
    if (auth) {
        void authenticateAndComplete(auth, 'handshake');
    }
    
    // Handle authentication requests after connection
    socket.on('auth', (authData) => {
        void authenticateAndComplete(authData, 'event');
    });
    
    // Handle socket error
    socket.on('error', (error) => {
        moduleLogger.error(`Socket error for ${socket.id}: ${error}`);
        handleSocketError(socket.id, socket.data?.agentId, error, socketService);
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
        moduleValidator.assertIsNonEmptyString(channelId);
        
        // Extract capabilities and allowedTools from socket auth data
        const capabilities = socket.handshake.auth?.capabilities || [];
        const rawAllowedTools = socket.handshake.auth?.allowedTools;
        if (rawAllowedTools !== undefined &&
            (!Array.isArray(rawAllowedTools) ||
                rawAllowedTools.some(toolName => (
                    typeof toolName !== 'string' || toolName.trim().length === 0
                )))) {
            throw new Error('allowedTools must be an array of non-empty strings when provided');
        }
        const credentialAllowedTools = socket.data?.credentialAllowedTools;
        if (credentialAllowedTools !== undefined && !Array.isArray(credentialAllowedTools)) {
            throw new Error('Authenticated credential contains an invalid allowedTools grant');
        }
        const allowedTools = resolveCredentialBoundAgentPolicy(
            credentialAllowedTools as string[] | undefined,
            rawAllowedTools as string[] | undefined
        );
        socket.data.effectiveAllowedTools = allowedTools === undefined
            ? undefined
            : [...allowedTools];

        // Register only after authentication options have passed validation.
        socketService.registerSocket(socket, agentId, channelId);
        
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
            
            // Omitted means preserve the core default/current policy. An
            // explicit [] is intentional deny-all and must still be applied.
            if (allowedTools !== undefined) {
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
                const participantAdded = await channelService.addParticipant(channelId, agentId, agentId);
                if (!participantAdded) {
                    throw new Error(`Authenticated channel ${channelId} is unavailable`);
                }
                
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

                // A key is bound to a persisted channel. If that channel was
                // deleted or became inactive after key issuance, authentication
                // must fail closed before any request handlers are installed.
                try {
                    socketService.unregisterSocket(socket.id, agentId);
                    const agentSvc = getAgentService();
                    agentSvc.removeSocketFromAgent(agentId, socket.id);
                    if (!agentSvc.hasActiveSockets(agentId)) {
                        agentSvc.updateAgentStatus(agentId, AgentConnectionStatus.DISCONNECTED);
                    }
                } catch (cleanupError) {
                    moduleLogger.error(`Failed to roll back rejected socket ${socket.id}: ${cleanupError}`);
                }

                socket.emit(AuthEvents.ERROR, {
                    error: 'Authenticated channel is unavailable',
                    channelId
                });
                socket.data.agentId = undefined;
                socket.data.authenticated = false;
                socket.disconnect(true);
                throw error;
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
        socket.on(Events.Agent.ALLOWED_TOOLS_UPDATE, (envelope: { agentId: string; data?: { allowedTools?: string[] } }) => {
            const allowedTools = envelope.data?.allowedTools;

            try {
                if (envelope.agentId !== agentId ||
                    !Array.isArray(allowedTools) ||
                    allowedTools.some((toolName) => (
                        typeof toolName !== 'string' || toolName.trim().length === 0
                    ))) {
                    moduleLogger.warn(
                        `Rejected allowedTools update from ${agentId}: ` +
                        `envelope claimed agent ${String(envelope.agentId)}`
                    );
                    socket.emit(Events.Agent.ALLOWED_TOOLS_UPDATED, {
                        agentId,
                        allowedTools: [],
                        success: false
                    });
                    return;
                }

                const credentialAllowedTools = socket.data?.credentialAllowedTools;
                const effectiveAllowedTools = resolveCredentialBoundAgentPolicy(
                    Array.isArray(credentialAllowedTools)
                        ? credentialAllowedTools as string[]
                        : undefined,
                    allowedTools
                );
                const updated = getAgentService().updateAgentAllowedTools(
                    agentId,
                    effectiveAllowedTools ?? []
                );

                if (updated) {
                    socket.data.effectiveAllowedTools = effectiveAllowedTools === undefined
                        ? undefined
                        : [...effectiveAllowedTools];
                    moduleLogger.info(`Updated allowedTools for ${agentId}: ${effectiveAllowedTools?.length ?? 0} tools`);
                    socket.emit(Events.Agent.ALLOWED_TOOLS_UPDATED, {
                        agentId,
                        allowedTools: effectiveAllowedTools ?? [],
                        success: true
                    });
                } else {
                    moduleLogger.warn(`Failed to update allowedTools for ${agentId}: agent not found`);
                    socket.emit(Events.Agent.ALLOWED_TOOLS_UPDATED, {
                        agentId,
                        allowedTools,
                        success: false
                    });
                }
            } catch (error) {
                moduleLogger.error(`Error updating allowedTools for ${agentId}: ${error}`);
                socket.emit(Events.Agent.ALLOWED_TOOLS_UPDATED, {
                    agentId,
                    allowedTools: Array.isArray(allowedTools) ? allowedTools : [],
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
