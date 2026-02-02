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
 * Provides channel event monitoring capabilities for SDK users.
 * This class allows subscribing to events that occur in a specific channel
 * without needing to create a full agent.
 *
 * Subscribes directly to EventBus.client and filters events by channelId.
 */

import { Subscription } from 'rxjs';
import { EventBus } from '../shared/events/EventBus';
import { AnyEventName, EventHandler } from '../shared/events/EventBusBase';
import { Logger } from '../shared/utils/Logger';

const logger = new Logger('warn', 'MxfChannelMonitor', 'client');

/**
 * MxfChannelMonitor - Channel event monitoring for SDK users
 *
 * Returned by MxfSDK.createChannel() to allow monitoring channel events
 * without creating a full agent.
 *
 * @example
 * ```typescript
 * const channelMonitor = await sdk.createChannel('my-channel', { name: 'My Channel' });
 *
 * // Listen to messages in the channel
 * channelMonitor.on(Events.Message.AGENT_MESSAGE, (payload) => {
 *     console.log('Message:', payload.data.content);
 * });
 *
 * // Clean up when done
 * channelMonitor.destroy();
 * ```
 */
export class MxfChannelMonitor {
    private channelId: string;
    private subscriptions: Map<string, Subscription[]> = new Map();
    private isDestroyed: boolean = false;
    // Dedup set: when the SDK and agent run in the same process, both sockets
    // share a single EventBus.client Subject (singleton). The same event may be
    // injected multiple times from different socket connections. We track recent
    // eventIds to deliver each event exactly once.
    private recentEventIds = new Set<string>();

    /**
     * Create a new channel monitor
     *
     * @param channelId The ID of the channel to monitor
     */
    constructor(channelId: string) {
        if (!channelId) {
            throw new Error('channelId is required for MxfChannelMonitor');
        }

        this.channelId = channelId;
        logger.info(`[MxfChannelMonitor] Created monitor for channel: ${channelId}`);
    }

    /**
     * Get the channel ID being monitored
     */
    public getChannelId(): string {
        return this.channelId;
    }

    /**
     * Subscribe to an event in this channel
     * Events are filtered to only include those for this channel
     *
     * @param event Event name to subscribe to
     * @param handler Event handler function
     * @returns Subscription that can be unsubscribed
     */
    public on<T extends AnyEventName>(event: T, handler: EventHandler<any>): Subscription {
        if (this.isDestroyed) {
            throw new Error(`Cannot subscribe to event '${event}' on destroyed monitor for channel: ${this.channelId}`);
        }

        // Subscribe to EventBus.client and filter by channelId
        // Strict filtering: only allow events that explicitly belong to this channel
        const subscription = EventBus.client.on(event, (payload: any) => {
            // Only process events that have a matching channelId
            // Events without channelId are filtered out to prevent cross-channel noise
            if (payload && typeof payload === 'object' && payload.channelId === this.channelId) {
                // Deduplicate by eventId — multiple sockets in the same process share
                // a single EventBus.client Subject, so the same event may be injected
                // multiple times from different socket connections
                const eventId = payload.eventId;
                if (eventId) {
                    if (this.recentEventIds.has(eventId)) return;
                    this.recentEventIds.add(eventId);
                    setTimeout(() => this.recentEventIds.delete(eventId), 5000);
                }
                handler(payload);
            }
            // Non-object payloads and events without channelId are ignored
        });

        // Track subscription by event
        if (!this.subscriptions.has(event)) {
            this.subscriptions.set(event, []);
        }
        this.subscriptions.get(event)!.push(subscription);

        return subscription;
    }

    /**
     * Unsubscribe from an event
     *
     * @param event Event name to unsubscribe from
     */
    public off(event: AnyEventName): void {
        const subs = this.subscriptions.get(event);
        if (subs) {
            subs.forEach(sub => sub.unsubscribe());
            this.subscriptions.delete(event);
        }
    }

    /**
     * Remove all event listeners (alias for compatibility)
     */
    public removeAllListeners(): void {
        this.subscriptions.forEach((subs) => {
            subs.forEach(sub => sub.unsubscribe());
        });
        this.subscriptions.clear();
        this.recentEventIds.clear();
    }

    /**
     * Clean up all subscriptions and destroy the monitor
     */
    public destroy(): void {
        if (this.isDestroyed) {
            return;
        }

        logger.info(`[MxfChannelMonitor] Destroying monitor for channel: ${this.channelId}`);

        // Unsubscribe from all events
        this.removeAllListeners();

        this.isDestroyed = true;
    }

    /**
     * Check if the monitor has been destroyed
     */
    public isActive(): boolean {
        return !this.isDestroyed;
    }

    /**
     * Get the number of active subscriptions
     */
    public getSubscriptionCount(): number {
        let count = 0;
        this.subscriptions.forEach((subs) => {
            count += subs.length;
        });
        return count;
    }
}
