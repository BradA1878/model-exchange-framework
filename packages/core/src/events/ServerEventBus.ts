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
 * ServerEventBus
 * 
 * Provides server-side event bus implementation for the MXF.
 * Handles server-specific event operations, socket.io server management,
 * and event routing to agents and channels.
 */

import { Subject } from 'rxjs';
import type { Server as SocketIOServer } from 'socket.io';
import { ControlLoopEvents } from './event-definitions/ControlLoopEvents.js';
import { OrparEvents } from './event-definitions/OrparEvents.js';
import { McpEvents } from './event-definitions/McpEvents.js';
import { TaskEvents } from './event-definitions/TaskEvents.js';
import {
    AnyEventName,
    BaseEventBusImplementation,
    EventMessage,
    isReservedEvent,
    PayloadOf
} from './EventBusBase.js';
import { createStrictValidator } from '../utils/validation.js';
import { Logger } from '../utils/Logger.js';

// Create a logger instance for ServerEventBus
const logger = new Logger('info', 'ServerEventBus', 'server');

// Create a strict validator for server-side operations
const validator = createStrictValidator('ServerEventBus');

/**
 * Server-side event bus interface
 */
export interface IServerEventBus extends BaseEventBusImplementation {
    /**
     * Set the Socket.IO server instance
     * @param io Socket.IO server instance
     * @returns this (for chaining)
     */
    setSocketServer(io: SocketIOServer): this;
    
    /**
     * Clear the Socket.IO server instance
     * @returns this (for chaining)
     */
    clearSocketServer(): this;
    
    /**
     * Remove all server event listeners
     * @returns this (for chaining)
     */
    removeAllSocketListeners(): this;

    /**
     * Clean up all subscriptions and listeners
     * @returns this (for chaining)
     */
    cleanup(): this;
}

/**
 * Server-side event bus implementation
 */
export class ServerEventBus extends BaseEventBusImplementation implements IServerEventBus {
    /**
     * Events delivered to specific agents/channels by eventForwardingHandlers.
     * Broadcasting these over io.emit() would deliver them twice.
     */
    private static readonly AGENT_SPECIFIC_EVENTS: ReadonlySet<string> = new Set<string>([
        ...Object.values(ControlLoopEvents),
        ...Object.values(OrparEvents),
        // MCP response events
        McpEvents.TOOL_RESULT,
        McpEvents.TOOL_ERROR,
        McpEvents.TOOL_REGISTERED,
        McpEvents.TOOL_UNREGISTERED,
        McpEvents.MXF_TOOL_LIST_RESULT,
        McpEvents.MXF_TOOL_LIST_ERROR,
        McpEvents.RESOURCE_RESULT,
        McpEvents.RESOURCE_ERROR,
        McpEvents.EXTERNAL_SERVER_REGISTERED,
        McpEvents.EXTERNAL_SERVER_UNREGISTERED,
        McpEvents.EXTERNAL_SERVER_REGISTRATION_FAILED,
        McpEvents.CHANNEL_SERVER_REGISTERED,
        McpEvents.CHANNEL_SERVER_UNREGISTERED,
        McpEvents.CHANNEL_SERVER_REGISTRATION_FAILED,
        // Task lifecycle events
        TaskEvents.CREATED,
        TaskEvents.ASSIGNED,
        TaskEvents.STARTED,
        TaskEvents.PROGRESS_UPDATED,
        TaskEvents.COMPLETED,
        TaskEvents.FAILED,
        TaskEvents.ERROR,
        TaskEvents.CANCELLED,
    ]);

    private ioInstance: SocketIOServer | null = null;

    /**
     * Create a new ServerEventBus
     * @param eventSubject Subject to use for events
     */
    constructor(eventSubject: Subject<EventMessage>) {
        super(eventSubject, logger);
    }
    
    /**
     * Set the Socket.IO server instance
     * @param io Socket.IO server instance
     * @returns this (for chaining)
     */
    public setSocketServer(io: SocketIOServer): this {
        try {
            validator.assertIsObject(io);
            validator.assertHasFunction(io, 'emit');
            validator.assertHasFunction(io, 'to');
            
            this.ioInstance = io;
            
        } catch (error) {
            logger.error('[ServerEventBus] Error setting Socket.IO server:', error instanceof Error ? error.message : String(error));
            throw new Error(`Error setting Socket.IO server: ${error instanceof Error ? error.message : 'Invalid server instance'}`);
        }
        
        return this;
    }
    
    /**
     * Clear the Socket.IO server instance
     * @returns this (for chaining)
     */
    public clearSocketServer(): this {
        this.ioInstance = null;
        
        
        return this;
    }
    
    /**
     * Forward an emitted event to the Socket.IO server.
     *
     * Called by BaseEventBusImplementation.emit() after validation and local
     * delivery.
     *
     * Agent-specific events are NOT broadcast with io.emit(). They are routed
     * to individual agents/channels by eventForwardingHandlers. Broadcasting
     * them would duplicate delivery: the SDK's ClientEventBus.setupClientSocketForwarding()
     * re-injects everything the socket receives back into the shared RxJS Subject,
     * so a broadcast event would be seen twice (once from the Subject push, once
     * from the socket re-injection).
     */
    protected override forwardToTransport<K extends AnyEventName>(event: K, payload: PayloadOf<K>): void {
        if (!this.ioInstance) {
            return;
        }

        const eventName = String(event);
        if (isReservedEvent(eventName) || ServerEventBus.AGENT_SPECIFIC_EVENTS.has(eventName)) {
            return;
        }

        this.ioInstance.emit(eventName, payload);
    }

    /**
     * Drop the Socket.IO server reference so no further events are broadcast.
     *
     * The bus attaches no listeners to the Socket.IO server — it only calls
     * io.emit() — so there is nothing else to detach here.
     *
     * @returns this (for chaining)
     */
    public removeAllSocketListeners(): this {
        this.ioInstance = null;

        return this;
    }

    /**
     * Dispose every subscription and detach the Socket.IO server.
     *
     * @returns this (for chaining)
     */
    public cleanup(): this {
        this.removeAllListeners();
        this.removeAllSocketListeners();

        return this;
    }
}
