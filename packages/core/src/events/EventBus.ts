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
 * EventBus
 * 
 * Provides a type-safe event bus implementation for the MXF.
 * This implementation is designed to be used with socket.io and other event-based systems.
 * 
 * The EventBus serves as a unified facade over both local events and socket.io events:
 * - When a socket is set, events are forwarded to the socket when emitted
 * - For server-side usage, the socket.io server instance can be set for broadcasting
 * - All events are processed through RxJS for local subscriptions
 */

import { Subject } from 'rxjs';
import { EventMessage } from './EventBusBase.js';
import { ClientEventBus, IClientEventBus } from './ClientEventBus.js';
import { ServerEventBus, IServerEventBus } from './ServerEventBus.js';
import { Logger } from '../utils/Logger.js';

// Create a logger instance for EventBus
const logger = new Logger('info', 'EventBus', 'server');

/**
 * EventBus Implementation
 * 
 * This implementation uses rxjs for event handling and integrates directly with socket.io
 */
export class EventBusImplementation {
    private eventSubject: Subject<EventMessage>;
    private clientEventBus: IClientEventBus | null = null;
    private serverEventBus: IServerEventBus | null = null;
    
    /**
     * Constructor for EventBusImplementation
     */
    public constructor() {
        this.eventSubject = new Subject<EventMessage>();
    }
    
    /**
     * Get or create the client EventBus instance
     * 
     * @returns The client EventBus instance
     */
    public get client(): IClientEventBus {
        if (!this.clientEventBus) {
            this.clientEventBus = new ClientEventBus(this.eventSubject);
        }
        return this.clientEventBus;
    }
    
    /**
     * Get or create the server EventBus instance
     * 
     * @returns The server EventBus instance
     */
    public get server(): IServerEventBus {
        if (!this.serverEventBus) {
            this.serverEventBus = new ServerEventBus(this.eventSubject);
        }
        return this.serverEventBus;
    }
    
    /**
     * Reset the EventBus to its initial state.
     * This is primarily used for testing.
     */
    public reset(): void {
        // Completing the Subject disposes every subscription both buses hold,
        // and their completion callbacks clear their registries.
        this.eventSubject.complete();
        this.eventSubject = new Subject<EventMessage>();

        // Reset client and server instances so they bind to the new Subject
        this.clientEventBus = null;
        this.serverEventBus = null;
    }

    /**
     * Log every event passing through the bus.
     * @returns A subscription that can be unsubscribed to stop debugging
     */
    public debug() {
        return this.eventSubject.subscribe(event => {
            logger.debug(`event '${event.type}': ${JSON.stringify(event.payload)}`);
        });
    }
}

// Export the EventBus singleton
export const EventBus = new EventBusImplementation();
