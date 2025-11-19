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
 * EventBusBase
 * 
 * Provides base interfaces and functionality for the MXF event system.
 * This file contains common types, interfaces, and validation functions used
 * by both client and server event bus implementations.
 */

import { Subject, Observable, Subscription } from 'rxjs';
import { filter, map } from 'rxjs/operators';
import { EventMap, SOCKET_RESERVED_EVENTS, Events } from './EventNames';
import { MessageEvents } from './event-definitions/MessageEvents';
import { createStrictValidator, assertIsEventPayload, assertIsChannelMessage, assertIsAgentMessage } from '../utils/validation';
import { Logger } from '../utils/Logger';

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
 * Helper function to check if an event is a critical event that must always be processed
 * @param event Event name to check
 * @returns true if it's a critical event
 */
export function isCriticalEvent(event: string): boolean {
    const criticalEvents = [
        // Message events
        MessageEvents.CHANNEL_MESSAGE_DELIVERED,
        MessageEvents.AGENT_MESSAGE_DELIVERED,
        MessageEvents.MESSAGE_ERROR,
        Events.Agent.CONNECTION_ERROR
    ];
    
    return criticalEvents.includes(event as any);
}

/**
 * Base event bus implementation with RxJS
 */
export abstract class BaseEventBusImplementation implements EventBusBase {
    protected eventSubject: Subject<EventMessage>;
    
    // Track event subscription counts
    protected subscriptionCountMap: Map<string, number> = new Map();
    
    constructor(eventSubject: Subject<EventMessage>) {
        this.eventSubject = eventSubject;
    }
    
    /**
     * Emit an event with validation
     * @param event Event name
     * @param payload Event payload
     */
    public emit<K extends AnyEventName>(event: K, payload: any): void {
        try {
            // Validate event name
            validateEventName(event);
            
            // Validate payload is not null or undefined, which can cause client errors
            if (payload === undefined || payload === null) {
                logger.warn(`[EventBus] Warning: Emitting event '${event}' with ${payload === null ? 'null' : 'undefined'} payload. This may cause errors for subscribers.`);
                
                // Create a safe default payload if none provided
                payload = {};
            }
            
            if (isCriticalEvent(event)) {
            } else {
            }
            
            // Only emit if we have subscribers to avoid wasted processing
            if (this.hasSubscribers(event)) {
                this.eventSubject.next({ type: event, payload });
            }
        } catch (error) {
            logger.error(`[EventBus] Error emitting event '${event}': ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    
    /**
     * Check if an event has subscribers
     * @param event Event name  
     * @returns True if the event has subscribers, false otherwise
     */
    public hasSubscribers(event: AnyEventName): boolean {
        // In base implementation, we assume there might be subscribers if we don't have tracking
        // Derived classes should override this for more accurate tracking
        return true;
    }
    
    /**
     * Subscribe to an event
     * @param event Event name
     * @param handler Event handler function
     * @returns Subscription to use for unsubscribing
     */
    public on<K extends AnyEventName>(event: K, handler: EventHandler<any>): Subscription {
        // In base implementation, we can only log the request
        // Derived classes should override this method to provide actual subscription functionality
        return undefined as any;
    }
    
    /**
     * Subscribe to an event once
     * @param event Event name
     * @param handler Event handler function
     * @returns Subscription to use for unsubscribing
     */
    public once<K extends AnyEventName>(event: K, handler: EventHandler<any>): Subscription {
        // In base implementation, we can only log the request
        // Derived classes should override this method to provide actual subscription functionality
        return undefined as any;
    }
    
    /**
     * Unsubscribe from an event
     * @param event Event name
     * @param handler Event handler function (optional)
     * 
     * Note: For best results in RxJS-based EventBus, it's preferable to keep
     * the Subscription object returned by on() and call subscription.unsubscribe() directly.
     * This method is provided for compatibility with traditional event emitter patterns.
     */
    public off<K extends AnyEventName>(event: K, handler?: EventHandler<any>): void {
        // In base implementation, we can only log the request
        // Derived classes should override this method to provide actual unsubscription functionality
    }
    
    /**
     * Get number of listeners for an event (approximate)
     * Note: This is an approximation as RxJS doesn't expose subscriber counts directly
     * @param event Event name
     * @returns Number of listeners
     */
    public listenerCount(event: AnyEventName): number {
        // RxJS doesn't provide a way to count subscribers directly
        // This is a limitation of our current implementation
        logger.warn('[EventBus] listenerCount is not fully supported with RxJS');
        return this.hasListeners(event) ? 1 : 0;
    }
    
    /**
     * Check if an event has listeners
     * Note: This is an approximation as RxJS doesn't expose subscriber counts directly
     * @param event Event name
     * @returns true if the event has listeners
     */
    public hasListeners(event: AnyEventName): boolean {
        // RxJS doesn't provide a way to check if there are subscribers
        // This is a limitation of our current implementation
        logger.warn('[EventBus] hasListeners is not fully supported with RxJS');
        return true; // We don't know for sure, so assume there might be listeners
    }
    
    /**
     * Remove all listeners for a given event or all events if no event is specified
     * Note: With RxJS, we can't selectively unsubscribe other subscribers
     * @param event Optional event name to remove all listeners for
     * @returns this (for chaining)
     */
    public removeAllListeners(event?: AnyEventName): this {
        logger.warn('[EventBus] removeAllListeners is not fully supported with RxJS');
        return this;
    }
    
    /**
     * Validate event payload to ensure it follows the expected schema
     * @param event Event name
     * @param payload Event payload
     * @returns true if valid, throws error if invalid
     */
    protected validateEventPayload(event: string, payload: any): boolean {
        // Log event details to help track events without proper schemas
        //     eventName: event, 
        //     payloadType: typeof payload,
        //     hasAgentId: typeof payload === 'object' && payload !== null && 'agentId' in payload,
        //     hasChannelId: typeof payload === 'object' && payload !== null && 'channelId' in payload,
        //     hasEventId: typeof payload === 'object' && payload !== null && 'eventId' in payload,
        //     hasData: typeof payload === 'object' && payload !== null && 'data' in payload
        // });

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
            // For rejected events, log detailed payload information
            
            // Log the rejection and re-throw for fail-fast behavior
            logger.error(`[EventBus] Rejecting non-standard payload for event ${event}: ${error instanceof Error ? error.message : 'Non-standard payload for event ' + event + ' - all events MUST use proper schema'}`);
            throw new Error(`Invalid payload for event ${event}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
}
