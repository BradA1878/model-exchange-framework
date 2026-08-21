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
import {
    AnyEventName,
    BaseEventBusImplementation,
    EventMessage,
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
     * Create a new ServerEventBus
     * @param eventSubject Subject to use for events
     */
    constructor(eventSubject: Subject<EventMessage>) {
        super(eventSubject, logger);
    }
    
    /**
     * Called by BaseEventBusImplementation.emit() after validation and local
     * delivery. The server bus has no transport: EventBus events often contain
     * private memory, prompts, tool results, or channel data, and a partial
     * denylist would turn every newly added event into an unauthenticated
     * global broadcast. Reviewed routing belongs to eventForwardingHandlers,
     * which selects an authenticated agent or Socket.IO room explicitly, so
     * this bus holds no Socket.IO server reference at all.
     */
    protected override forwardToTransport<K extends AnyEventName>(event: K, payload: PayloadOf<K>): void {
        void event;
        void payload;
    }

    /**
     * Dispose every subscription.
     *
     * @returns this (for chaining)
     */
    public cleanup(): this {
        this.removeAllListeners();

        return this;
    }
}
