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

import { BaseEventPayload } from '../../schemas/EventPayloadSchema.js';

/**
 * SDK connection lifecycle events.
 *
 * These describe the SDK's own user connection, not an agent. They are
 * delivered to local subscribers only (EventBus.client.emitLocal) and never
 * sent over the socket.
 */
export const SdkEvents = {
    /**
     * The socket manager re-established the user connection and the server
     * re-authenticated it, without a connect() call waiting on the result.
     * Anything the server forgot while the connection was down — registered
     * channel MCP server processes, for example — may need to be set up again.
     */
    RECONNECTED: 'sdk:reconnected',
} as const;

/**
 * Data carried by SdkEvents.RECONNECTED.
 */
export interface SdkReconnectedEventData {
    /** Server-confirmed user id of the re-authenticated connection. */
    userId: string;
    /**
     * Transport reconnect attempts reported by the socket manager, or null
     * when the manager did not report one before authentication succeeded.
     */
    attempt: number | null;
}

/**
 * SDK event payload types
 */
export interface SdkPayloads {
    'sdk:reconnected': BaseEventPayload<SdkReconnectedEventData>;
}
