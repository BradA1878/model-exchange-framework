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
 * This is a lightweight wrapper that receives forwarded events from SdkEventBus
 * and filters them to only events for this channel.
 */

import { Subject, Subscription, filter, map } from 'rxjs';
import { AnyEventName, EventHandler, EventMessage } from '../shared/events/EventBusBase';
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
    private eventSubject: Subject<EventMessage>;
    private subscriptions: Map<string, Subscription[]> = new Map();
    private isDestroyed: boolean = false;

    /**
     * Create a new channel monitor
     *
     * @param channelId The ID of the channel to monitor
     * @param eventSubject Optional event subject (for testing or custom event sources)
     */
    constructor(channelId: string, eventSubject?: Subject<EventMessage>) {
        if (!channelId) {
            throw new Error('channelId is required for MxfChannelMonitor');
        }

        this.channelId = channelId;
        this.eventSubject = eventSubject || new Subject<EventMessage>();
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

        // Create a filtered observable for this specific event in this channel
        const observable = this.eventSubject.pipe(
            filter((e: EventMessage) => {
                // Match event type
                if (e.type !== event) return false;

                // Filter to only events for this channel
                const payload = e.payload;
                if (payload && typeof payload === 'object') {
                    return payload.channelId === this.channelId;
                }
                return true; // If no channelId in payload, let it through
            }),
            map((e: EventMessage) => e.payload)
        );

        const subscription = observable.subscribe(handler);

        // Track subscriptions by event
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
    }

    /**
     * Emit an event to this monitor's subscribers
     * This is used internally to forward events from the SDK's EventBus
     *
     * @param eventType Event type
     * @param payload Event payload
     */
    public emit(eventType: string, payload: any): void {
        if (this.isDestroyed) {
            return;
        }

        this.eventSubject.next({
            type: eventType,
            payload
        });
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

        // Complete the subject
        this.eventSubject.complete();

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
