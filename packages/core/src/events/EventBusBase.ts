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
 * EventBusBase
 * 
 * Provides base interfaces and functionality for the MXF event system.
 * This file contains common types, interfaces, and validation functions used
 * by both client and server event bus implementations.
 */

import { Subject, Subscription } from 'rxjs';
import { filter, map, take } from 'rxjs/operators';
import { SOCKET_RESERVED_EVENTS, Events } from './EventNames.js';
import type { EventMap } from './EventNames.js';
import type { BaseEventPayload } from '../schemas/EventPayloadSchema.js';
import { createBaseEventPayload } from '../schemas/EventPayloadSchema.js';
import { MessageEvents } from './event-definitions/MessageEvents.js';
import { createStrictValidator } from '../utils/validation.js';
import { Logger } from '../utils/Logger.js';

/**
 * Invokes an event handler so that neither a synchronous throw nor an async
 * rejection can kill the bus subscription or vanish silently. Errors are
 * logged loudly with the event name; the bus stays alive for other handlers.
 */
export const invokeHandlerSafely = (
    busLogger: Logger,
    eventName: unknown,
    handler: (payload: any) => unknown,
    payload: any
): void => {
    try {
        const result = handler(payload);
        if (result && typeof (result as Promise<unknown>).then === 'function') {
            (result as Promise<unknown>).catch((error: unknown) => {
                busLogger.error(
                    `Async handler for '${String(eventName)}' rejected: ${error instanceof Error ? error.stack : String(error)}`
                );
            });
        }
    } catch (error) {
        busLogger.error(
            `Handler for '${String(eventName)}' threw: ${error instanceof Error ? error.stack : String(error)}`
        );
    }
};

// Create a logger instance for EventBus
const logger = new Logger('info', 'EventBus', 'server');

/**
 * Socket interface based on the subset of Socket.IO functionality we use
 */
export interface SocketLike {
    id?: string;
    connected?: boolean;
    on: (event: string, listener: (...args: any[]) => void) => any;
    off: (event: string, listener?: (...args: any[]) => void) => any;
    emit: (event: string, ...args: any[]) => any;
    onAny?: (listener: (event: string, ...args: any[]) => void) => any;
    offAny?: () => any;
    removeAllListeners?: () => any;
    disconnect?: () => void;
    data?: {
        agentId?: string;
        channelId?: string;
        authenticated?: boolean;
        [key: string]: any;
    };
    join?: (room: string) => any;
    leave?: (room: string) => any;
}

/**
 * Type alias for event names
 */
export type EventName = keyof EventMap;

/**
 * Type for any event name (including custom string events)
 */
export type AnyEventName = EventName | string;

/**
 * Payload type for an event. EventMap entries historically declare the raw
 * event DATA type, but the runtime shape on the bus is always the
 * BaseEventPayload envelope produced by the EventPayloadSchema helpers —
 * Normalize wraps data-level entries so the type system matches reality.
 * Arbitrary string events (external MCP, custom) stay open.
 */
type NormalizePayload<P> = P extends BaseEventPayload<any> ? P : BaseEventPayload<P>;
export type PayloadOf<T extends AnyEventName> = T extends keyof EventMap
    ? NormalizePayload<EventMap[T]>
    : any;

/**
 * Export EventMap for use in other files
 */
export { EventMap };

/**
 * Event handler type for event subscriptions
 */
export type EventHandler<T> = (payload: T) => void;

/**
 * Internal event message format used by the event bus
 */
export interface EventMessage {
    type: string;
    payload: any;
}

/**
 * Base interface for event bus functionality shared by both client and server
 */
export interface EventBusBase {
    /**
     * Subscribe to an event
     * @param event Event name
     * @param handler Event handler function
     * @returns Subscription to use for unsubscribing
     */
    on<K extends AnyEventName>(event: K, handler: EventHandler<any>): Subscription;
    
    /**
     * Subscribe to an event once
     * @param event Event name
     * @param handler Event handler function
     * @returns Subscription to use for unsubscribing
     */
    once<K extends AnyEventName>(event: K, handler: EventHandler<any>): Subscription;
    
    /**
     * Unsubscribe from an event
     * @param event Event name
     * @param handler Event handler function (optional - if not provided, all handlers for this event are removed)
     */
    off<K extends AnyEventName>(event: K, handler?: EventHandler<any>): void;
    
    /**
     * Emit an event
     * @param event Event name
     * @param payload Event payload
     */
    emit?(event: AnyEventName, payload: any): void;

    /**
     * Check if an event has subscribers
     * @param event Event name
     * @returns True if the event has subscribers, false otherwise
     */
    hasSubscribers?(event: AnyEventName): boolean;
    
    /**
     * Get number of listeners for an event
     * @param event Event name
     * @returns Number of listeners
     */
    listenerCount(event: AnyEventName): number;
    
    /**
     * Check if event has listeners
     * @param event Event name
     * @returns true if the event has listeners, false otherwise
     */
    hasListeners(event: AnyEventName): boolean;
    
    /**
     * Remove all listeners for a given event or all events if no event is specified
     * @param event Optional event name to remove all listeners for
     * @returns this (for chaining)
     */
    removeAllListeners(event?: AnyEventName): this;
}

/**
 * Helper function to validate an event name
 * @param event Event name to validate
 * @returns true if valid, throws error if invalid
 */
export function validateEventName(event: AnyEventName): boolean {
    const validator = createStrictValidator('EventBus');
    validator.assertIsNonEmptyString(event);
    return true;
}

/**
 * Helper function to check if an event is a reserved Socket.IO event
 * @param event Event name to check
 * @returns true if it's a reserved event
 */
export function isReservedEvent(event: string): boolean {
    return SOCKET_RESERVED_EVENTS.includes(event as any);
}

/**
 * Base event bus implementation with RxJS.
 *
 * Holds everything both buses share: subscription bookkeeping, on/once/off,
 * categories, debug mode, and the emit contract. Subclasses supply only their
 * transport (a client socket, or the Socket.IO server) via forwardToTransport().
 *
 * ## Subscription bookkeeping
 *
 * Three structures are kept in step by registerHandler()/forgetSubscription():
 *   - handlerSubscriptions: event → handler → subscriptions, so off(event, handler)
 *     can find and dispose exactly the right RxJS subscriptions.
 *   - subscriptionCountMap: event → live count, so hasSubscribers()/listenerCount()/
 *     hasListeners() report the truth instead of guessing.
 *   - subscriptions: a flat list of everything this bus owns, for bulk teardown.
 *
 * once() is keyed by the CALLER's handler, not by an internal wrapper. Keying by
 * the wrapper (as an earlier version did) meant off() could never find the entry,
 * so the RxJS subscription was never disposed and the "one-shot" listener kept
 * firing on every later event. take(1) now disposes the subscription itself and
 * the completion callback clears the registry entry.
 *
 * ## Emit contract
 *
 * Both buses behave identically: a bad event name, a null/undefined payload, or
 * a payload that fails schema validation THROWS. Nothing is coerced, defaulted,
 * or swallowed — a malformed event is a programming error and the caller needs
 * to see it.
 */
export abstract class BaseEventBusImplementation implements EventBusBase {
    protected eventSubject: Subject<EventMessage>;

    /** Logger for this bus. Subclasses pass their own so output is tagged correctly. */
    protected readonly busLogger: Logger;

    /** Every subscription this bus owns, so teardown can dispose all of them. */
    protected subscriptions: Subscription[] = [];

    /** Category name → subscriptions, backing unsubscribeCategory(). */
    protected categorySubscriptions: Map<string, Subscription[]> = new Map();

    /**
     * event → (caller's handler → its subscriptions).
     * A handler may be registered more than once for the same event, so the
     * value is a list; off() disposes all of them.
     */
    protected handlerSubscriptions: Map<string, Map<EventHandler<any>, Subscription[]>> = new Map();

    /** event → number of live per-event subscribers. */
    protected subscriptionCountMap: Map<string, number> = new Map();

    /** onAll() subscriptions, which are not tied to any single event name. */
    protected allEventSubscriptions: Set<Subscription> = new Set();

    private debugMode: boolean = false;
    private debugSubscription: Subscription | null = null;

    constructor(eventSubject: Subject<EventMessage>, busLogger: Logger) {
        this.eventSubject = eventSubject;
        this.busLogger = busLogger;
    }

    /**
     * Hand the event to this bus's transport (client socket / Socket.IO server).
     * Called after the event has been validated and pushed to local subscribers.
     */
    protected abstract forwardToTransport<K extends AnyEventName>(event: K, payload: PayloadOf<K>): void;

    // ---------------------------------------------------------------------
    // Emitting
    // ---------------------------------------------------------------------

    /**
     * Emit an event to local subscribers and this bus's transport.
     *
     * Throws if the event name is empty, if the payload is null/undefined, or
     * if the payload does not match the BaseEventPayload schema. Build payloads
     * with the helpers in EventPayloadSchema.
     *
     * @param event Event name
     * @param payload Event payload
     */
    public emit<K extends AnyEventName>(event: K, payload: PayloadOf<K>): void {
        try {
            validateEventName(event);

            if (payload === undefined || payload === null) {
                throw new Error(
                    `Event '${String(event)}' was emitted with a ${payload === null ? 'null' : 'undefined'} payload. ` +
                    `Build the payload with a helper from EventPayloadSchema.`
                );
            }

            this.validateEventPayload(String(event), payload);

            this.eventSubject.next({ type: event, payload });

            this.forwardToTransport(event, payload);
        } catch (error) {
            this.busLogger.error(
                `Error emitting event '${String(event)}': ${error instanceof Error ? error.message : String(error)}`
            );
            this.reportEmitFailure(event, error);
            throw error;
        }
    }

    /**
     * Publish a properly-formed error event describing a failed emit.
     *
     * Pushed straight to the Subject rather than through emit() so a broken
     * error payload cannot recurse. The payload uses createBaseEventPayload —
     * the bus does not get to break the payload rules it enforces on callers.
     */
    private reportEmitFailure(event: AnyEventName, error: unknown): void {
        // Never report a failure to emit the error event with another error event.
        if (event === Events.Agent.ERROR) {
            return;
        }

        try {
            const payload = createBaseEventPayload(
                Events.Agent.ERROR,
                'system',
                'system',
                {
                    error: error instanceof Error ? error.message : String(error),
                    event: String(event),
                    timestamp: Date.now()
                },
                { source: this.constructor.name }
            );
            this.eventSubject.next({ type: Events.Agent.ERROR, payload });
        } catch (reportingError) {
            this.busLogger.error(
                `Failed to publish the error event for '${String(event)}': ` +
                `${reportingError instanceof Error ? reportingError.message : String(reportingError)}`
            );
        }
    }

    // ---------------------------------------------------------------------
    // Subscribing
    // ---------------------------------------------------------------------

    /**
     * Subscribe to an event.
     *
     * @param event Event name
     * @param handler Event handler function
     * @returns Subscription; unsubscribe() disposes it, as does off(event, handler)
     */
    public on<K extends AnyEventName>(event: K, handler: EventHandler<PayloadOf<K>>): Subscription {
        validateEventName(event);

        const subscription = this.eventSubject
            .pipe(
                filter((e: EventMessage) => e.type === event),
                map((e: EventMessage) => e.payload)
            )
            .subscribe({
                // Isolate throws/rejections so one bad handler cannot kill the
                // subscription or fail silently.
                next: (payload) => invokeHandlerSafely(this.busLogger, event, handler, payload),
                complete: () => this.forgetSubscription(event, handler, subscription)
            });

        this.registerHandler(event, handler, subscription);

        return subscription;
    }

    /**
     * Subscribe to an event for exactly one delivery.
     *
     * take(1) disposes the RxJS subscription after the first event, and the
     * completion callback removes it from the registry, so nothing is left
     * behind. off(event, handler) still works before the event arrives.
     *
     * @param event Event name
     * @param handler Event handler function
     * @returns Subscription
     */
    public once<K extends AnyEventName>(event: K, handler: EventHandler<PayloadOf<K>>): Subscription {
        validateEventName(event);

        // The completion callback needs the Subscription, which only exists once
        // subscribe() returns. With a plain Subject the source cannot emit during
        // subscribe(), but this flag keeps the bookkeeping correct even if the
        // Subject were ever swapped for a replaying one.
        let registered = false;
        let completedBeforeRegistration = false;

        const subscription: Subscription = this.eventSubject
            .pipe(
                filter((e: EventMessage) => e.type === event),
                take(1),
                map((e: EventMessage) => e.payload)
            )
            .subscribe({
                next: (payload) => invokeHandlerSafely(this.busLogger, event, handler, payload),
                complete: () => {
                    if (registered) {
                        this.forgetSubscription(event, handler, subscription);
                    } else {
                        completedBeforeRegistration = true;
                    }
                }
            });

        this.registerHandler(event, handler, subscription);
        registered = true;

        if (completedBeforeRegistration) {
            this.forgetSubscription(event, handler, subscription);
        }

        return subscription;
    }

    /**
     * Subscribe to every event on this bus.
     *
     * @param listener Receives the event type and the payload
     * @returns Subscription
     */
    public onAll(listener: (eventType: string, payload: any) => void): Subscription {
        const subscription = this.eventSubject.subscribe({
            next: (e: EventMessage) =>
                invokeHandlerSafely(this.busLogger, e.type, (payload) => listener(e.type, payload), e.payload)
        });

        this.subscriptions.push(subscription);
        this.allEventSubscriptions.add(subscription);

        return subscription;
    }

    /**
     * Subscribe to an event and tag the subscription with a category so a group
     * of related subscriptions can be dropped together.
     *
     * @param category Category name for grouping subscriptions
     * @param event Event name
     * @param listener Event handler function
     * @returns Subscription
     */
    public onWithCategory<T extends AnyEventName>(
        category: string,
        event: T,
        listener: EventHandler<PayloadOf<T>>
    ): Subscription {
        const subscription = this.on(event, listener);

        const categorySubs = this.categorySubscriptions.get(category);
        if (categorySubs) {
            categorySubs.push(subscription);
        } else {
            this.categorySubscriptions.set(category, [subscription]);
        }

        return subscription;
    }

    // ---------------------------------------------------------------------
    // Unsubscribing
    // ---------------------------------------------------------------------

    /**
     * Unsubscribe from an event.
     *
     * @param event Event name
     * @param handler The handler passed to on()/once(). Omit to drop every
     *                handler registered for this event.
     */
    public off<K extends AnyEventName>(event: K, handler?: EventHandler<any>): void {
        validateEventName(event);

        const eventHandlers = this.handlerSubscriptions.get(event);
        if (!eventHandlers) {
            return;
        }

        if (handler) {
            const subs = eventHandlers.get(handler);
            if (!subs) {
                return;
            }
            // Copy: forgetSubscription() mutates the list we are walking.
            for (const subscription of [...subs]) {
                subscription.unsubscribe();
                this.forgetSubscription(event, handler, subscription);
            }
            return;
        }

        for (const [registeredHandler, subs] of Array.from(eventHandlers.entries())) {
            for (const subscription of [...subs]) {
                subscription.unsubscribe();
                this.forgetSubscription(event, registeredHandler, subscription);
            }
        }
    }

    /**
     * Unsubscribe every subscription tagged with a category.
     *
     * @param category Category name
     * @returns this (for chaining)
     */
    public unsubscribeCategory(category: string): this {
        const categorySubs = this.categorySubscriptions.get(category);
        if (!categorySubs) {
            return this;
        }

        for (const subscription of categorySubs) {
            subscription.unsubscribe();
            this.forgetSubscriptionEverywhere(subscription);
        }

        this.categorySubscriptions.delete(category);

        return this;
    }

    /**
     * Remove listeners for one event, or every listener this bus owns.
     *
     * Only subscriptions this bus created are disposed. An earlier version
     * cleared the Subject's observer list directly, which reached across into
     * the other bus's subscribers (both buses share one Subject) and left the
     * Subscription objects stranded.
     *
     * @param event Optional event name; omit to remove everything
     * @returns this (for chaining)
     */
    public removeAllListeners(event?: AnyEventName): this {
        if (event !== undefined) {
            this.off(event);
            return this;
        }

        for (const registeredEvent of Array.from(this.handlerSubscriptions.keys())) {
            this.off(registeredEvent);
        }

        for (const subscription of Array.from(this.allEventSubscriptions)) {
            subscription.unsubscribe();
            this.forgetSubscriptionEverywhere(subscription);
        }
        this.allEventSubscriptions.clear();

        // Anything still tracked (e.g. a subscription pushed by a subclass) is
        // disposed here so nothing outlives the call.
        for (const subscription of [...this.subscriptions]) {
            subscription.unsubscribe();
        }

        this.subscriptions = [];
        this.categorySubscriptions.clear();
        this.handlerSubscriptions.clear();
        this.subscriptionCountMap.clear();
        this.debugSubscription = null;
        this.debugMode = false;

        return this;
    }

    // ---------------------------------------------------------------------
    // Introspection
    // ---------------------------------------------------------------------

    /**
     * Whether any handler is subscribed to this event.
     * onAll() subscribers are not counted — they are not tied to an event name.
     */
    public hasSubscribers(event: AnyEventName): boolean {
        return this.listenerCount(event) > 0;
    }

    /**
     * Number of handlers subscribed to this event.
     */
    public listenerCount(event: AnyEventName): number {
        return this.subscriptionCountMap.get(event) ?? 0;
    }

    /**
     * Whether this event has listeners. Alias of hasSubscribers().
     */
    public hasListeners(event: AnyEventName): boolean {
        return this.hasSubscribers(event);
    }

    /**
     * Number of onAll() subscribers on this bus.
     */
    public allListenerCount(): number {
        return this.allEventSubscriptions.size;
    }

    /**
     * Log every event passing through this bus at debug level.
     *
     * @param enabled Whether debug mode should be on
     * @returns this (for chaining)
     */
    public enableDebugMode(enabled: boolean = true): this {
        if (this.debugMode === enabled) {
            return this;
        }

        this.debugMode = enabled;

        if (enabled) {
            this.debugSubscription = this.onAll((eventType, payload) => {
                this.busLogger.debug(`event '${eventType}': ${JSON.stringify(payload)}`);
            });
            return this;
        }

        if (this.debugSubscription) {
            this.debugSubscription.unsubscribe();
            this.allEventSubscriptions.delete(this.debugSubscription);
            this.forgetSubscriptionEverywhere(this.debugSubscription);
            this.debugSubscription = null;
        }

        return this;
    }

    // ---------------------------------------------------------------------
    // Internal bookkeeping
    // ---------------------------------------------------------------------

    /** Record a new per-event subscription across all three structures. */
    private registerHandler(
        event: AnyEventName,
        handler: EventHandler<any>,
        subscription: Subscription
    ): void {
        this.subscriptions.push(subscription);

        let eventHandlers = this.handlerSubscriptions.get(event);
        if (!eventHandlers) {
            eventHandlers = new Map();
            this.handlerSubscriptions.set(event, eventHandlers);
        }

        const existing = eventHandlers.get(handler);
        if (existing) {
            existing.push(subscription);
        } else {
            eventHandlers.set(handler, [subscription]);
        }

        this.subscriptionCountMap.set(event, this.listenerCount(event) + 1);
    }

    /**
     * Drop a per-event subscription from the registry. Idempotent: the count is
     * only decremented when the entry was actually present, so a subscription
     * that both completes and is off()'d is not counted twice.
     */
    private forgetSubscription(
        event: AnyEventName,
        handler: EventHandler<any>,
        subscription: Subscription
    ): void {
        const eventHandlers = this.handlerSubscriptions.get(event);
        if (eventHandlers) {
            const subs = eventHandlers.get(handler);
            if (subs) {
                const subIndex = subs.indexOf(subscription);
                if (subIndex !== -1) {
                    subs.splice(subIndex, 1);
                    this.subscriptionCountMap.set(event, Math.max(0, this.listenerCount(event) - 1));
                }
                if (subs.length === 0) {
                    eventHandlers.delete(handler);
                }
            }
            if (eventHandlers.size === 0) {
                this.handlerSubscriptions.delete(event);
                this.subscriptionCountMap.delete(event);
            }
        }

        const index = this.subscriptions.indexOf(subscription);
        if (index !== -1) {
            this.subscriptions.splice(index, 1);
        }
    }

    /**
     * Drop a subscription whose event/handler keys are not known to the caller
     * (category and onAll subscriptions).
     */
    private forgetSubscriptionEverywhere(subscription: Subscription): void {
        for (const [event, eventHandlers] of Array.from(this.handlerSubscriptions.entries())) {
            for (const [handler, subs] of Array.from(eventHandlers.entries())) {
                if (subs.includes(subscription)) {
                    this.forgetSubscription(event, handler, subscription);
                }
            }
        }

        this.allEventSubscriptions.delete(subscription);

        const index = this.subscriptions.indexOf(subscription);
        if (index !== -1) {
            this.subscriptions.splice(index, 1);
        }
    }

    // ---------------------------------------------------------------------
    // Validation
    // ---------------------------------------------------------------------

    /**
     * Validate event payload to ensure it follows the expected schema
     * @param event Event name
     * @param payload Event payload
     * @returns true if valid, throws error if invalid
     */
    protected validateEventPayload(event: string, payload: any): boolean {
        // Use validation utility for fail-fast behavior - all events must follow BaseEventPayload structure
        const validator = createStrictValidator('EventBus');

        try {
            // All events must have the standard BaseEventPayload structure
            validator.assertIsEventPayload(payload);

            // Additional validation for eventId and data fields
            validator.assertHasProperty(payload, 'eventId', 'EventPayload must have eventId field');
            validator.assertHasProperty(payload, 'data', 'EventPayload must have data field');

            // Data-specific validation for message events
            // Channel message events (should validate as ChannelMessage)
            const channelMessageEvents = [
                MessageEvents.CHANNEL_MESSAGE_DELIVERED,
                MessageEvents.CHANNEL_MESSAGE,
                MessageEvents.SYSTEM_MESSAGE,
                MessageEvents.SYSTEM_MESSAGE_DELIVERED,
            ];

            // Agent message events (should validate as AgentMessage)
            const agentMessageEvents = [
                MessageEvents.AGENT_MESSAGE_DELIVERED,
                MessageEvents.AGENT_MESSAGE,
                MessageEvents.LLM_MESSAGE
            ];

            if (channelMessageEvents.includes(event)) {
                validator.assertIsChannelMessage(payload.data);
            } else if (agentMessageEvents.includes(event)) {
                validator.assertIsAgentMessage(payload.data);
            }

            return true;
        } catch (error) {
            // Log the rejection and re-throw for fail-fast behavior
            logger.error(`[EventBus] Rejecting non-standard payload for event ${event}: ${error instanceof Error ? error.message : 'Non-standard payload for event ' + event + ' - all events MUST use proper schema'}`);
            throw new Error(`Invalid payload for event ${event}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
}
