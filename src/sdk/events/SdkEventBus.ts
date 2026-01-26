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
 * SdkEventBus
 *
 * Wrapper around ClientEventBus for SDK-specific operations.
 * This provides a clean interface for the MxfSDK to emit and subscribe to events
 * via the EventBus pattern rather than using direct socket.on/emit calls.
 *
 * This is separate from the agent's EventBus.client to avoid cross-contamination
 * between SDK-level operations and agent-level operations.
 */

import { Subject, Subscription } from 'rxjs';
import { ClientEventBus } from '../../shared/events/ClientEventBus';
import { SocketLike, AnyEventName, EventHandler, EventMessage } from '../../shared/events/EventBusBase';
import { Logger } from '../../shared/utils/Logger';

const logger = new Logger('info', 'SdkEventBus', 'client');

/**
 * SdkEventBus - Event bus wrapper for SDK operations
 *
 * Provides a clean interface for SDK-level event operations that is
 * separate from agent-level EventBus usage.
 */
export class SdkEventBus {
    private eventSubject: Subject<EventMessage>;
    private clientEventBus: ClientEventBus;
    private socket: SocketLike | null = null;
    private isInitialized: boolean = false;

    constructor() {
        this.eventSubject = new Subject<EventMessage>();
        this.clientEventBus = new ClientEventBus(this.eventSubject);
    }

    /**
     * Set the socket to use for event operations
     * Call this after successful authentication
     *
     * @param socket Socket.IO client socket
     * @returns this (for chaining)
     */
    public setSocket(socket: SocketLike): this {
        if (!socket) {
            throw new Error('Socket is required for SdkEventBus initialization');
        }

        this.socket = socket;
        this.clientEventBus.setClientSocket(socket);
        this.isInitialized = true;
        logger.info('[SdkEventBus] Socket initialized');

        return this;
    }

    /**
     * Check if the EventBus is initialized with a socket
     */
    public isReady(): boolean {
        return this.isInitialized && this.socket !== null && this.socket.connected === true;
    }

    /**
     * Subscribe to an event
     *
     * @param event Event name to subscribe to
     * @param handler Event handler function
     * @returns Subscription that can be unsubscribed
     */
    public on<T extends AnyEventName>(event: T, handler: EventHandler<any>): Subscription {
        if (!this.isInitialized) {
            logger.warn(`[SdkEventBus] Attempting to subscribe to '${event}' before socket initialization`);
        }
        return this.clientEventBus.on(event, handler);
    }

    /**
     * Subscribe to an event once (auto-unsubscribes after first event)
     *
     * @param event Event name to subscribe to
     * @param handler Event handler function
     * @returns Subscription that can be unsubscribed
     */
    public once<T extends AnyEventName>(event: T, handler: EventHandler<any>): Subscription {
        if (!this.isInitialized) {
            logger.warn(`[SdkEventBus] Attempting to subscribe once to '${event}' before socket initialization`);
        }
        return this.clientEventBus.once(event, handler);
    }

    /**
     * Unsubscribe from an event
     *
     * @param event Event name
     * @param handler Specific handler to remove (optional - removes all if not provided)
     */
    public off<T extends AnyEventName>(event: T, handler?: EventHandler<any>): void {
        this.clientEventBus.off(event, handler);
    }

    /**
     * Emit an event
     *
     * @param event Event name
     * @param payload Event payload (must follow BaseEventPayload structure)
     */
    public emit(event: AnyEventName, payload: any): void {
        if (!this.isInitialized || !this.socket) {
            throw new Error(`[SdkEventBus] Cannot emit event '${event}' - socket not initialized. Call setSocket() first.`);
        }

        if (!this.socket.connected) {
            logger.warn(`[SdkEventBus] Socket not connected when emitting '${event}'`);
        }

        this.clientEventBus.emit(event, payload);
    }

    /**
     * Clean up all subscriptions and disconnect
     */
    public cleanup(): void {
        logger.info('[SdkEventBus] Cleaning up');

        // Remove all socket listeners
        this.clientEventBus.removeAllSocketListeners();

        // Disconnect the client event bus
        this.clientEventBus.disconnect();

        // Reset state
        this.socket = null;
        this.isInitialized = false;
    }

    /**
     * Subscribe to all events
     * Used for forwarding events to channel monitors
     *
     * @param handler Handler receiving event type and payload
     * @returns Subscription that can be unsubscribed
     */
    public onAll(handler: (eventType: string, payload: any) => void): Subscription {
        return this.clientEventBus.onAll(handler);
    }

    /**
     * Get the underlying ClientEventBus (for advanced use cases)
     */
    public getClientEventBus(): ClientEventBus {
        return this.clientEventBus;
    }
}
