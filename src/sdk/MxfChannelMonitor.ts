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
 * MxfChannelMonitor
 * 
 * Lightweight event monitor for a specific channel.
 * Returned by sdk.createChannel() to enable channel-level event monitoring
 * without requiring an agent instance.
 * 
 * This provides a clean developer experience where channel creation
 * immediately returns a monitoring interface.
 */

import { EventBus } from '../shared/events/EventBus';
import { PublicEventName, isPublicEvent } from '../shared/events/PublicEvents';

/**
 * Lightweight channel event monitor
 * 
 * Monitors all public events in a specific channel by automatically
 * filtering events based on channelId.
 * 
 * @example
 * ```typescript
 * const channel = await sdk.createChannel('my-channel', 'My Channel');
 * 
 * // Monitor messages in this channel
 * channel.on(Events.Message.AGENT_MESSAGE, (payload) => {
 *     console.log('Message:', payload.data.content);
 * });
 * 
 * // Monitor task completions
 * channel.on(Events.Task.COMPLETED, (payload) => {
 *     console.log('Task done:', payload.data.taskId);
 * });
 * ```
 */
export class MxfChannelMonitor {
    private channelId: string;
    private eventListeners: Map<string, any[]> = new Map();

    /**
     * Create a channel monitor
     * 
     * @param channelId - Channel ID to monitor
     */
    constructor(channelId: string) {
        this.channelId = channelId;
    }

    /**
     * Listen to channel events
     * 
     * Automatically filters events to only those for this channel.
     * Only public events from the whitelist can be monitored.
     * 
     * @param eventName - Public event name from Events namespace
     * @param handler - Event handler function
     * @returns This monitor instance for method chaining
     * @throws Error if event is not in public whitelist
     * 
     * @example
     * ```typescript
     * channel.on(Events.Message.AGENT_MESSAGE, (payload) => {
     *     console.log('Message from:', payload.data.senderId);
     * });
     * 
     * channel.on(Events.Task.COMPLETED, (payload) => {
     *     console.log('Task completed:', payload.data.taskId);
     * });
     * ```
     */
    public on(eventName: PublicEventName, handler: (data: any) => void): this {
        // Validate event is in public whitelist
        if (!isPublicEvent(eventName)) {
            console.warn(
                `[MxfChannelMonitor] Event '${eventName}' is not in the public whitelist. ` +
                `Only events from PUBLIC_EVENTS can be monitored. Ignoring listener.`
            );
            return this;
        }

        // Wrap handler to filter by channelId
        const channelFilteredHandler = (data: any): void => {
            // Only process events for this channel
            if (data.channelId === this.channelId) {
                handler(data);
            }
        };

        // Subscribe to event through EventBus
        const subscription = EventBus.client.on(eventName, channelFilteredHandler);

        // Track subscription for cleanup
        if (!this.eventListeners.has(eventName)) {
            this.eventListeners.set(eventName, []);
        }
        this.eventListeners.get(eventName)!.push(subscription);

        return this; // Allow chaining
    }

    /**
     * Remove a channel event listener
     * 
     * Removes all handlers for the specified event on this channel.
     * 
     * @param eventName - Public event name
     * @returns This monitor instance for method chaining
     * 
     * @example
     * ```typescript
     * // Remove all message handlers
     * channel.off(Events.Message.AGENT_MESSAGE);
     * ```
     */
    public off(eventName: PublicEventName): this {
        const subscriptions = this.eventListeners.get(eventName);
        
        if (subscriptions) {
            // Unsubscribe all handlers for this event
            subscriptions.forEach(sub => sub.unsubscribe());
            this.eventListeners.delete(eventName);
        }

        return this;
    }

    /**
     * Remove all event listeners
     * 
     * Cleans up all event listeners for this channel monitor.
     * Call this when you're done monitoring the channel.
     * 
     * @example
     * ```typescript
     * // Clean up all listeners when done
     * channel.removeAllListeners();
     * ```
     */
    public removeAllListeners(): void {
        this.eventListeners.forEach(subscriptions => {
            subscriptions.forEach(sub => sub.unsubscribe());
        });
        this.eventListeners.clear();
    }

    /**
     * Get the channel ID being monitored
     * 
     * @returns Channel ID
     */
    public getChannelId(): string {
        return this.channelId;
    }
}
