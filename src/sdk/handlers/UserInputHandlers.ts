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
 * UserInputHandlers
 *
 * SDK handler for user input events. Follows the TaskHandlers pattern:
 * - initialize() subscribes to UserInputEvents.REQUEST on EventBus.client
 * - cleanup() unsubscribes all listeners
 * - setUserInputHandler() registers a callback for processing user input requests
 *
 * When a REQUEST event arrives, the registered handler callback is called.
 * The callback is responsible for rendering the prompt (terminal, UI dialog, etc.)
 * and returning the user's response. The response is then emitted back to the
 * server via UserInputEvents.RESPONSE.
 */

import { Subscription } from 'rxjs';
import { Handler } from './Handler';
import { EventBus } from '../../shared/events/EventBus';
import {
    UserInputEvents,
    UserInputRequestData,
    UserInputResponseValue,
} from '../../shared/events/event-definitions/UserInputEvents';
import { createUserInputResponsePayload } from '../../shared/schemas/EventPayloadSchema';
import { AgentId, ChannelId } from '../../shared/types/ChannelContext';

/**
 * Callback signature for handling user input requests.
 * Implementations should render the prompt to the user and return their response.
 *
 * @param request - The full request definition (title, type, options, etc.)
 * @returns Promise resolving to the user's response value
 */
export type UserInputHandler = (request: UserInputRequestData) => Promise<UserInputResponseValue>;

/**
 * SDK handler for user input events.
 * Listens for user input requests from the server and delegates to the registered handler.
 */
export class UserInputHandlers extends Handler {
    private agentId: string;
    private channelId: string;

    /** Registered callback for processing user input requests */
    private userInputHandler: UserInputHandler | null = null;

    /** RxJS subscriptions for cleanup */
    private subscriptions: Subscription[] = [];

    /**
     * Track processed request IDs to prevent duplicate handling.
     * The server broadcasts user_input:request to all sockets in the channel room,
     * so the same request arrives once per socket. Only the first arrival is processed.
     */
    private processedRequestIds: Set<string> = new Set();

    /** Eviction timers for processedRequestIds — tracked so cleanup() can cancel them */
    private evictionTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

    /**
     * Create new user input event handlers
     *
     * @param channelId - Channel ID the agent belongs to
     * @param agentId - Agent ID that owns this handler
     */
    constructor(channelId: string, agentId: string) {
        super(`UserInputHandlers:${agentId}`);

        // Validate before assignment — fail fast on invalid inputs
        this.validator.assertIsNonEmptyString(channelId, 'channelId is required');
        this.validator.assertIsNonEmptyString(agentId, 'agentId is required');

        this.agentId = agentId;
        this.channelId = channelId;
    }

    /**
     * Initialize user input event handlers by subscribing to request events.
     * @internal Called by MxfClient during initialization
     */
    public initialize(): void {
        this.setupUserInputRequestHandler();
    }

    /**
     * Clean up event handlers when shutting down.
     * @internal Called by MxfClient during disconnect
     */
    public cleanup(): void {
        this.subscriptions.forEach(sub => sub.unsubscribe());
        this.subscriptions = [];
        this.evictionTimers.forEach(timer => clearTimeout(timer));
        this.evictionTimers.clear();
        this.processedRequestIds.clear();
    }

    /**
     * Register a callback function to handle user input requests.
     * The callback receives the full request definition and should return
     * the user's response value.
     *
     * @param handler - Callback that renders the prompt and returns the response
     */
    public setUserInputHandler(handler: UserInputHandler): void {
        this.validator.assertIsFunction(handler);
        this.userInputHandler = handler;
    }

    /**
     * Subscribe to UserInputEvents.REQUEST and delegate to the registered handler.
     * When the handler returns a response, emit it back as UserInputEvents.RESPONSE.
     */
    private setupUserInputRequestHandler(): void {
        const subscription = EventBus.client.on(UserInputEvents.REQUEST, async (payload: any) => {
            try {
                // Extract request data from the payload.
                // All events use BaseEventPayload<T> wrapping — .data is always the source of truth.
                if (!payload.data) {
                    this.logger.error(`[UserInputHandlers:${this.agentId}] Received user input request with missing payload.data — event payload is malformed`);
                    return;
                }

                const requestData: UserInputRequestData = payload.data;

                if (!requestData.requestId) {
                    this.logger.warn(`[UserInputHandlers:${this.agentId}] Received user input request with missing requestId`);
                    return;
                }

                // Deduplicate: the server broadcasts to all sockets in the channel room,
                // so the same request arrives once per socket. Only process the first arrival.
                if (this.processedRequestIds.has(requestData.requestId)) {
                    return;
                }
                this.processedRequestIds.add(requestData.requestId);
                // Evict after 30s to prevent unbounded growth in long-running agents.
                // Timer ID is tracked so cleanup() can cancel pending callbacks.
                const evictionTimer = setTimeout(() => {
                    this.processedRequestIds.delete(requestData.requestId);
                    this.evictionTimers.delete(requestData.requestId);
                }, 30_000);
                this.evictionTimers.set(requestData.requestId, evictionTimer);

                // Only process requests targeted at this agent's channel
                // (requests are broadcast to the channel, any client can respond)
                if (requestData.channelId && requestData.channelId !== this.channelId) {
                    return;
                }

                if (!this.userInputHandler) {
                    this.logger.warn(
                        `[UserInputHandlers:${this.agentId}] No user input handler registered. ` +
                        `Cannot process request "${requestData.title}" (${requestData.requestId}). ` +
                        `Call setUserInputHandler() to register a handler.`
                    );
                    return;
                }

                this.logger.debug(
                    `[UserInputHandlers:${this.agentId}] Processing user input request: ` +
                    `"${requestData.title}" (${requestData.inputType}, ${requestData.requestId})`
                );

                // Call the registered handler — this is where the UI prompt is rendered
                const responseValue = await this.userInputHandler(requestData);

                // Emit the response back to the server using the typed payload helper
                const responsePayload = createUserInputResponsePayload(
                    this.agentId as AgentId,
                    this.channelId as ChannelId,
                    {
                        requestId: requestData.requestId,
                        value: responseValue,
                        respondedBy: this.agentId,
                        timestamp: Date.now(),
                    }
                );

                EventBus.client.emitOn(this.agentId, UserInputEvents.RESPONSE, responsePayload);

                this.logger.debug(
                    `[UserInputHandlers:${this.agentId}] Sent response for request ${requestData.requestId}`
                );
            } catch (error) {
                this.logger.error(`Error handling user input request: ${error}`);
            }
        });

        this.subscriptions.push(subscription);
    }
}
