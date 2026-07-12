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
 * ClientEventBus
 * 
 * Provides client-side event bus implementation for the MXF.
 * Handles client-specific event operations, socket connections, and event forwarding.
 */

import { Subject, Subscription } from 'rxjs';
import { ControlLoopEvents } from './event-definitions/ControlLoopEvents.js';
import { OrparEvents } from './event-definitions/OrparEvents.js';
import {
    AnyEventName,
    BaseEventBusImplementation,
    EventMessage,
    SocketLike,
    validateEventName,
    PayloadOf
} from './EventBusBase.js';
import { createStrictValidator } from '../utils/validation.js';
import { Logger } from '../utils/Logger.js';

// Create a logger instance for ClientEventBus (warn level to reduce noise, client target for SDK usage)
const logger = new Logger('warn', 'ClientEventBus', 'client');

// Create a strict validator for client-side operations
const validator = createStrictValidator('ClientEventBus');

/**
 * Interface for client-specific event bus functionality
 */
export interface IClientEventBus extends BaseEventBusImplementation {
    /**
     * Set the primary socket to use for event forwarding (used by admin/SDK socket)
     * @param socket Socket to use
     * @returns this (for chaining)
     */
    setClientSocket(socket: SocketLike): this;

    /**
     * Set up socket event forwarding
     * @param socket Socket to use
     * @returns this (for chaining)
     */
    setupClientSocketForwarding(socket: SocketLike): this;

    /**
     * Register a named socket in the registry (used by agent sockets)
     * Does not overwrite the primary socket set by setClientSocket().
     * Sets up onAny forwarding into the shared eventSubject.
     * @param socketId Unique identifier for this socket (typically agentId)
     * @param socket Socket to register
     * @returns this (for chaining)
     */
    registerSocket(socketId: string, socket: SocketLike): this;

    /**
     * Unregister a named socket from the registry
     * Removes onAny listener and cleans up tracked listeners.
     * @param socketId Identifier of the socket to unregister
     * @returns this (for chaining)
     */
    unregisterSocket(socketId: string): this;

    /**
     * Emit an event through a specific registered socket.
     * Uses the primary socket when socketId is not in the registry.
     * @param socketId Identifier of the socket to emit through
     * @param event Event name
     * @param payload Event payload
     */
    emitOn<K extends AnyEventName>(socketId: string, event: K, payload: PayloadOf<K>): void;

    /**
     * Disconnect the primary socket and unregister all sockets
     * @returns this (for chaining)
     */
    disconnect(): this;

    /**
     * Remove listeners the sockets registered on this bus
     * @returns this (for chaining)
     */
    removeAllSocketListeners(): this;
}

/**
 * Client-side event bus implementation.
 *
 * Subscription handling (on/once/off/onAll/categories/debug) lives in
 * BaseEventBusImplementation. This class owns only the socket transport.
 */
export class ClientEventBus extends BaseEventBusImplementation implements IClientEventBus {
    // Primary socket (set by setClientSocket, used by admin/SDK emit())
    private socket: SocketLike | null = null;
    // Listeners tracked for the primary socket's onAny handler
    private socketListeners: Map<string, (...args: any[]) => void> = new Map();

    // Socket registry: maps socketId (typically agentId) → socket instance
    // Agent sockets register here so they don't overwrite the primary admin socket
    private socketRegistry: Map<string, SocketLike> = new Map();
    // Listeners tracked for each registered socket's onAny handler
    private socketListenersRegistry: Map<string, Map<string, (...args: any[]) => void>> = new Map();


    /**
     * Create a new ClientEventBus
     * @param eventSubject Subject to use for events
     */
    constructor(eventSubject: Subject<EventMessage>) {
        super(eventSubject, logger);
    }

    /**
     * Set the socket to use for event forwarding
     * @param socket Socket to use
     * @returns this (for chaining)
     */
    public setClientSocket(socket: SocketLike): this {
        try {
            validator.assertIsObject(socket);

            // Check that this is a socket-like object
            validator.assertHasFunction(socket, 'on');
            validator.assertHasFunction(socket, 'emit');

            // Store the socket
            this.socket = socket;

            // Set up event forwarding
            this.setupClientSocketForwarding(socket);

        } catch (error) {
            logger.error('[ClientEventBus] Error setting socket:', error instanceof Error ? error.message : String(error));
            throw new Error(`Error setting socket: ${error instanceof Error ? error.message : 'Invalid socket'}`);
        }

        return this;
    }

    /**
     * Forward an emitted event to the primary socket.
     *
     * Called by BaseEventBusImplementation.emit() after validation and local
     * delivery. A disconnected socket is a warning, not an error: local
     * subscribers still received the event.
     */
    protected override forwardToTransport<K extends AnyEventName>(event: K, payload: PayloadOf<K>): void {
        if (this.socket && this.socket.connected) {
            this.socket.emit(String(event), payload);
            return;
        }

        logger.warn(
            `[ClientEventBus] Socket not connected, could not forward event: ${String(event)}. ` +
            `Socket exists: ${!!this.socket}, Socket connected: ${this.socket?.connected}`
        );
    }

    /**
     * Set up socket event forwarding from socket to event bus
     * @param socket Socket to use
     * @returns this (for chaining)
     */
    public setupClientSocketForwarding(socket: SocketLike): this {
        try {
            validator.assertIsObject(socket);
            validator.assertHasFunction(socket, 'on');
            validator.assertHasFunction(socket, 'onAny');
            
            // Remove previous listeners if any
            this.removeAllSocketListeners();
            
            // Catch every event with onAny (Socket.IO specific)
            if (socket.onAny) {
                // Build a set of events that are handled specifically by MxfService.setupControlLoopSocketListeners()
                // These events should NOT be forwarded by onAny to avoid double-forwarding
                const specificlyHandledEvents = new Set([
                    // ControlLoop events (server-orchestrated)
                    ...Object.values(ControlLoopEvents),
                    // ORPAR events (agent-driven cognitive documentation)
                    ...Object.values(OrparEvents)
                ]);

                const handleAnyEvent = (event: string, ...args: any[]) => {
                    // Skip processing of some internal socket.io events
                    if (event.startsWith('$') || event === 'ping' || event === 'pong') {
                        return;
                    }

                    // Skip events that are specifically handled by MxfService.setupControlLoopSocketListeners()
                    // to prevent double-forwarding (these events have specific socket.on() handlers)
                    if (specificlyHandledEvents.has(event)) {
                        return;
                    }

                    const payload = args.length > 0 ? args[0] : {};

                    // Forward to event bus
                    this.eventSubject.next({
                        type: event,
                        payload
                    });
                };

                socket.onAny(handleAnyEvent);
                this.socketListeners.set('any', handleAnyEvent);
            }
            
        } catch (error) {
            logger.error('[ClientEventBus] Error setting up socket forwarding:', error instanceof Error ? error.message : String(error));
            throw new Error(`Error setting up socket forwarding: ${error instanceof Error ? error.message : 'Invalid socket'}`);
        }
        
        return this;
    }
    
    /**
     * Register a named socket in the registry (used by agent sockets).
     * Does not overwrite the primary socket set by setClientSocket().
     * Sets up onAny forwarding into the shared eventSubject so all
     * on()/once() subscribers receive events from this socket.
     *
     * @param socketId Unique identifier for this socket (typically agentId)
     * @param socket Socket to register
     * @returns this (for chaining)
     */
    public registerSocket(socketId: string, socket: SocketLike): this {
        try {
            validator.assertIsNonEmptyString(socketId);
            validator.assertIsObject(socket);
            validator.assertHasFunction(socket, 'on');
            validator.assertHasFunction(socket, 'emit');

            // Clean up any previous registration under this id
            if (this.socketRegistry.has(socketId)) {
                this.unregisterSocket(socketId);
            }

            // Store socket in registry
            this.socketRegistry.set(socketId, socket);

            // Set up onAny forwarding into the shared eventSubject
            if (socket.onAny) {
                const specificlyHandledEvents = new Set([
                    ...Object.values(ControlLoopEvents),
                    ...Object.values(OrparEvents)
                ]);

                const handleAnyEvent = (event: string, ...args: any[]) => {
                    // Skip internal socket.io events
                    if (event.startsWith('$') || event === 'ping' || event === 'pong') {
                        return;
                    }
                    // Skip events handled by specific socket.on() listeners in MxfService
                    if (specificlyHandledEvents.has(event)) {
                        return;
                    }
                    const payload = args.length > 0 ? args[0] : {};
                    this.eventSubject.next({ type: event, payload });
                };

                socket.onAny(handleAnyEvent);

                // Track the listener for cleanup
                if (!this.socketListenersRegistry.has(socketId)) {
                    this.socketListenersRegistry.set(socketId, new Map());
                }
                this.socketListenersRegistry.get(socketId)!.set('any', handleAnyEvent);
            }

        } catch (error) {
            logger.error('[ClientEventBus] Error registering socket:', error instanceof Error ? error.message : String(error));
            throw new Error(`Error registering socket: ${error instanceof Error ? error.message : 'Invalid socket'}`);
        }

        return this;
    }

    /**
     * Unregister a named socket from the registry.
     * Removes onAny listener and cleans up tracked listeners.
     *
     * @param socketId Identifier of the socket to unregister
     * @returns this (for chaining)
     */
    public unregisterSocket(socketId: string): this {
        const socket = this.socketRegistry.get(socketId);
        if (!socket) {
            return this;
        }

        try {
            // Remove onAny listener
            if (socket.offAny) {
                socket.offAny();
            }

            // Remove individually tracked listeners
            const listeners = this.socketListenersRegistry.get(socketId);
            if (listeners) {
                for (const [event, listener] of listeners.entries()) {
                    if (event !== 'any') {
                        socket.off(event, listener);
                    }
                }
                listeners.clear();
            }

            // Remove from registries
            this.socketListenersRegistry.delete(socketId);
            this.socketRegistry.delete(socketId);

        } catch (error) {
            logger.error('[ClientEventBus] Error unregistering socket:', error instanceof Error ? error.message : String(error));
        }

        return this;
    }

    /**
     * Emit an event through a specific registered socket.
     * Also pushes the event into the local eventSubject for on()/once() subscribers.
     * Falls back to the primary socket with a warning if socketId not found.
     *
     * @param socketId Identifier of the socket to emit through
     * @param event Event name
     * @param payload Event payload
     */
    public emitOn(socketId: string, event: AnyEventName, payload: any): void {
        // Same validation contract as emit(): a bad event name or payload throws.
        validateEventName(event);

        if (payload === undefined || payload === null) {
            throw new Error(
                `Event '${String(event)}' was emitted with a ${payload === null ? 'null' : 'undefined'} payload. ` +
                `Build the payload with a helper from EventPayloadSchema.`
            );
        }

        this.validateEventPayload(String(event), payload);

        // Push to local event bus so on()/once() subscribers receive it
        this.eventSubject.next({ type: event, payload });

        // Look up the registered socket
        const registeredSocket = this.socketRegistry.get(socketId);
        if (registeredSocket && registeredSocket.connected) {
            registeredSocket.emit(String(event), payload);
            return;
        }

        if (registeredSocket && !registeredSocket.connected) {
            logger.warn(`[ClientEventBus] Registered socket '${socketId}' not connected, using primary socket for event: ${String(event)}`);
        } else {
            // Debug level: this is expected during early agent startup before the socket is registered
            logger.debug(`[ClientEventBus] Socket '${socketId}' not found in registry, using primary socket for event: ${String(event)}`);
        }

        this.forwardToTransport(event, payload as PayloadOf<AnyEventName>);
    }

    /**
     * Disconnect the primary socket and unregister all sockets in the registry
     * @returns this (for chaining)
     */
    public disconnect(): this {
        // Unregister all sockets in the registry
        for (const socketId of Array.from(this.socketRegistry.keys())) {
            this.unregisterSocket(socketId);
        }

        if (this.socket) {
            try {
                // Clean up primary socket listeners
                this.removeAllSocketListeners();

                // Disconnect if connected and has disconnect method
                if (this.socket.connected && typeof this.socket['disconnect'] === 'function') {
                    (this.socket as any).disconnect();
                }

                // Clear socket reference
                this.socket = null;
            } catch (error) {
                logger.error('[ClientEventBus] Error disconnecting socket:', error instanceof Error ? error.message : String(error));
            }
        }

        return this;
    }
    
    /**
     * Remove all socket listeners (primary socket and all registered sockets)
     * @returns this (for chaining)
     */
    public removeAllSocketListeners(): this {
        // Clean up primary socket listeners
        if (this.socket) {
            try {
                // Remove "any" listener if registered
                if (this.socket.offAny && this.socketListeners.has('any')) {
                    this.socket.offAny();
                    this.socketListeners.delete('any');
                }

                // Remove individual event listeners
                for (const [event, listener] of this.socketListeners.entries()) {
                    if (event !== 'any') {
                        this.socket.off(event, listener);
                    }
                }

                // Clear listener map
                this.socketListeners.clear();

                // Use Socket.IO's removeAllListeners if available
                if (this.socket.removeAllListeners) {
                    this.socket.removeAllListeners();
                }
            } catch (error) {
                logger.error('[ClientEventBus] Error removing primary socket listeners:', error instanceof Error ? error.message : String(error));
            }
        }

        // Clean up registered sockets' listeners
        for (const [socketId, socket] of this.socketRegistry.entries()) {
            try {
                if (socket.offAny) {
                    socket.offAny();
                }
                const listeners = this.socketListenersRegistry.get(socketId);
                if (listeners) {
                    for (const [event, listener] of listeners.entries()) {
                        if (event !== 'any') {
                            socket.off(event, listener);
                        }
                    }
                    listeners.clear();
                }
            } catch (error) {
                logger.error(`[ClientEventBus] Error removing listeners for socket '${socketId}':`, error instanceof Error ? error.message : String(error));
            }
        }
        this.socketListenersRegistry.clear();

        return this;
    }
    
    /**
     * Remove all agent event listeners
     * @returns this (for chaining)
     */
    public removeAllAgentListeners(): this {
        // This just delegates to removeAllListeners for consistency
        return this.removeAllListeners();
    }
    
    /**
     * Check if the socket is connected
     * @returns true if socket is connected
     */
    public isSocketConnected(): boolean {
        return !!this.socket && !!this.socket.connected;
    }
    
}
