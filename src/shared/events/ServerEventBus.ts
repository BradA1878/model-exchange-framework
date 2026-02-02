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
 * ServerEventBus
 * 
 * Provides server-side event bus implementation for the MXF.
 * Handles server-specific event operations, socket.io server management,
 * and event routing to agents and channels.
 */

import { Subject, Subscription } from 'rxjs';
import { filter, map } from 'rxjs/operators';
import { Server as SocketIOServer, Socket } from 'socket.io';
import { Events, ChannelActionTypes, MessageEvents } from './EventNames';
import type { EventMap } from './EventNames';
import { ControlLoopEvents } from './event-definitions/ControlLoopEvents';
import { OrparEvents } from './event-definitions/OrparEvents';
import { McpEvents } from './event-definitions/McpEvents';
import { TaskEvents } from './event-definitions/TaskEvents';
import { 
    AnyEventName, 
    BaseEventBusImplementation, 
    EventHandler,
    EventMessage, 
    SocketLike, 
    validateEventName,
    isReservedEvent
} from './EventBusBase';
import { 
    createAgentEventPayload,
    createChannelEventPayload,
    createBaseEventPayload
} from '../schemas/EventPayloadSchema';
import { createStrictValidator } from '../utils/validation';
import { Logger } from '../utils/Logger';

// Create a logger instance for ServerEventBus
const logger = new Logger('info', 'ServerEventBus', 'server');

// Create a strict validator for server-side operations
const validator = createStrictValidator('ServerEventBus');

/**
 * Server-side event bus interface
 */
export interface IServerEventBus extends BaseEventBusImplementation {
    /**
     * Set the Socket.IO server instance
     * @param io Socket.IO server instance
     * @returns this (for chaining)
     */
    setSocketServer(io: SocketIOServer): this;
    
    /**
     * Clear the Socket.IO server instance
     * @returns this (for chaining)
     */
    clearSocketServer(): this;
    
    /**
     * Emit an event
     * @param event Event name
     * @param payload Event payload
     */
    emit(event: AnyEventName, payload: any): void;

    /**
     * Subscribe to all events in the server event bus
     * 
     * @param listener Listener function that receives both event type and payload
     * @returns Subscription that can be unsubscribed to stop listening
     */
    onAll(listener: (eventType: string, payload: any) => void): Subscription;
    
    /**
     * Remove all server event listeners
     * @returns this (for chaining)
     */
    removeAllSocketListeners(): this;
    
    /**
     * Clean up all subscriptions and listeners
     * @returns this (for chaining)
     */
    cleanup(): this;
    
    /**
     * Enable or disable debug mode to log all events
     * 
     * @param enabled Whether debug mode should be enabled
     * @returns this (for chaining)
     */
    enableDebugMode(enabled?: boolean): this;
    
    /**
     * Subscribe to an event with category for grouped subscription management
     * 
     * @param category Category name for grouping subscriptions
     * @param event Event name to subscribe to
     * @param listener Listener function to call when the event is emitted
     * @returns Subscription that can be unsubscribed to stop listening
     */
    onWithCategory<T extends AnyEventName>(
        category: string,
        event: T, 
        listener: (payload: any) => void
    ): Subscription;
    
    /**
     * Unsubscribe from all events in a specific category
     * 
     * @param category Category name to unsubscribe from
     * @returns this (for chaining)
     */
    unsubscribeCategory(category: string): this;
    
    /**
     * Remove all event listeners for a specific event or all events
     * @param event Optional specific event name to remove listeners for
     * @returns this (for chaining)
     */
    removeAllListeners(event?: AnyEventName): this;
}

/**
 * Server-side event bus implementation
 */
export class ServerEventBus extends BaseEventBusImplementation implements IServerEventBus {
    private ioInstance: SocketIOServer | null = null;
    private subscriptions: Subscription[] = [];
    private categorySubscriptions: Map<string, Subscription[]> = new Map();
    
    // Track subscriptions by event and handler for proper off() support
    private handlerSubscriptions: Map<string, Map<EventHandler<any>, Subscription>> = new Map();
    private debugMode: boolean = false;
    private debugSubscription: Subscription | null = null;
    
    /**
     * Create a new ServerEventBus
     * @param eventSubject Subject to use for events
     */
    constructor(eventSubject: Subject<EventMessage>) {
        super(eventSubject);
        //;
    }
    
    /**
     * Set the Socket.IO server instance
     * @param io Socket.IO server instance
     * @returns this (for chaining)
     */
    public setSocketServer(io: SocketIOServer): this {
        try {
            validator.assertIsObject(io);
            validator.assertHasFunction(io, 'emit');
            validator.assertHasFunction(io, 'to');
            
            this.ioInstance = io;
            
        } catch (error) {
            logger.error('[ServerEventBus] Error setting Socket.IO server:', error instanceof Error ? error.message : String(error));
            throw new Error(`Error setting Socket.IO server: ${error instanceof Error ? error.message : 'Invalid server instance'}`);
        }
        
        return this;
    }
    
    /**
     * Clear the Socket.IO server instance
     * @returns this (for chaining)
     */
    public clearSocketServer(): this {
        this.ioInstance = null;
        
        
        return this;
    }
    
    /**
     * Emit an event to the server event bus
     * All components listen to this event bus
     * 
     * @param event Event name
     * @param payload Event payload
     */
    public emit(event: AnyEventName, payload: any): void {
        try {
            // Validate event name and payload
            validateEventName(event);
            this.validateEventPayload(event, payload);
            
            // Handle null/undefined payload
            if (payload === undefined || payload === null) {
                logger.warn(`[ServerEventBus] Warning: Emitting event '${event}' with ${payload === null ? 'null' : 'undefined'} payload.`);
                payload = {};
            }
            
            // Special logging for critical events like agent registration
            if (event.startsWith('agent:')) {
            }

            // Emit to local event bus first
            this.eventSubject.next({
                type: event,
                payload,
            });
            
            // Also emit to the Socket.IO server if available
            // IMPORTANT: Do NOT broadcast agent-specific events via io.emit().
            // These events are forwarded to specific agents/channels via
            // eventForwardingHandlers.forwardEventToAgent()/forwardEventToChannel().
            // Broadcasting them causes duplicates: the SDK's ClientEventBus.setupClientSocketForwarding()
            // has socket.onAny() that re-injects received socket events back into the RxJS Subject,
            // so MxfChannelMonitor sees each broadcast event twice (once from Subject push, once from
            // socket re-injection).
            const agentSpecificEvents = new Set([
                ...Object.values(ControlLoopEvents),
                ...Object.values(OrparEvents),
                // MCP response events — already forwarded to specific agents via eventForwardingHandlers
                McpEvents.TOOL_RESULT,
                McpEvents.TOOL_ERROR,
                McpEvents.TOOL_REGISTERED,
                McpEvents.TOOL_UNREGISTERED,
                McpEvents.MXF_TOOL_LIST_RESULT,
                McpEvents.MXF_TOOL_LIST_ERROR,
                McpEvents.RESOURCE_RESULT,
                McpEvents.RESOURCE_ERROR,
                McpEvents.EXTERNAL_SERVER_REGISTERED,
                McpEvents.EXTERNAL_SERVER_UNREGISTERED,
                McpEvents.EXTERNAL_SERVER_REGISTRATION_FAILED,
                McpEvents.CHANNEL_SERVER_REGISTERED,
                McpEvents.CHANNEL_SERVER_UNREGISTERED,
                McpEvents.CHANNEL_SERVER_REGISTRATION_FAILED,
                // Task lifecycle events — already forwarded to specific agents/channels
                TaskEvents.CREATED,
                TaskEvents.ASSIGNED,
                TaskEvents.STARTED,
                TaskEvents.PROGRESS_UPDATED,
                TaskEvents.COMPLETED,
                TaskEvents.FAILED,
                TaskEvents.ERROR,
                TaskEvents.CANCELLED,
            ]);

            if (this.ioInstance && !isReservedEvent(event) && !agentSpecificEvents.has(event)) {
                //;
                this.ioInstance.emit(event, payload);
            }
            
            //;
        } catch (error) {
            logger.error(`[ServerEventBus] Error emitting event '${event}':`, error instanceof Error ? error.message : String(error));
            
            // Re-throw the error for the caller to handle
            throw error;
        }
    }
    
    /**
     * Override the base on method to track handlers and subscriptions
     * @param event Event name
     * @param handler Event handler function
     * @returns Subscription to use for unsubscribing
     */
    public override on<K extends AnyEventName>(event: K, handler: EventHandler<any>): Subscription {
        // Create a filtered observable for this event
        const observable = this.eventSubject.pipe(
            filter((e: EventMessage) => e.type === event),
            map((e: EventMessage) => e.payload)
        );
        
        // Subscribe to the observable with the handler
        const subscription = observable.subscribe(handler);
        
        // Store the subscription for cleanup
        this.subscriptions.push(subscription);
        
        // Track handlers for off() support
        if (!this.handlerSubscriptions.has(event)) {
            this.handlerSubscriptions.set(event, new Map());
        }
        
        const eventHandlers = this.handlerSubscriptions.get(event);
        if (eventHandlers) {
            eventHandlers.set(handler, subscription);
        }
        
        return subscription;
    }
    
    /**
     * Override the base once method to track handlers and subscriptions
     * Once the event is fired, the subscription is automatically removed
     * 
     * @param event Event name
     * @param handler Event handler function
     * @returns Subscription to use for unsubscribing
     */
    public override once<K extends AnyEventName>(event: K, handler: EventHandler<any>): Subscription {
        // Create a filtered observable for this event
        const observable = this.eventSubject.pipe(
            filter((e: EventMessage) => e.type === event),
            map((e: EventMessage) => e.payload)
        );
        
        // Create a wrapper handler that will unsubscribe after first execution
        const onceHandler = (payload: any) => {
            // Call the original handler
            handler(payload);
            
            // Unsubscribe from this event
            this.off(event, onceHandler);
            
            //;
        };
        
        // Subscribe to the observable with the one-time handler
        const subscription = observable.subscribe(onceHandler);
        
        // Store the subscription for cleanup
        this.subscriptions.push(subscription);
        
        // Track handlers for off() support
        if (!this.handlerSubscriptions.has(event)) {
            this.handlerSubscriptions.set(event, new Map());
        }
        
        const eventHandlers = this.handlerSubscriptions.get(event);
        if (eventHandlers) {
            eventHandlers.set(handler, subscription);
        }
        
        return subscription;
    }

    /**
     * Subscribe to all events in the server event bus
     * 
     * @param listener Listener function that receives both event type and payload
     * @returns Subscription that can be unsubscribed to stop listening
     */
    public onAll(listener: (eventType: string, payload: any) => void): Subscription {
        // Create an observable that passes both event type and payload
        const observable = this.eventSubject.pipe(
            map((e: EventMessage) => ({ type: e.type, payload: e.payload }))
        );
        
        
        // Subscribe to the observable with the listener
        const subscription = observable.subscribe(event => {
            listener(event.type, event.payload);
        });
        
        // Store the subscription for cleanup
        this.subscriptions.push(subscription);
        
        return subscription;
    }
    
    /**
     * Remove all server event listeners
     * @returns this (for chaining)
     */
    public removeAllSocketListeners(): this {
        if (this.ioInstance) {
            try {
                // Since Socket.IO Server doesn't have a direct equivalent to removeAllListeners(),
                // we would need to track all listeners separately if we want to remove them.
                // For now, we log that this operation is not fully implemented.
            } catch (error) {
                logger.error('[ServerEventBus] Error removing socket listeners:', error instanceof Error ? error.message : String(error));
            }
        }
        
        return this;
    }
    
    /**
     * Clean up all subscriptions and listeners
     * @returns this (for chaining)
     */
    public cleanup(): this {
        // Clean up all subscriptions
        this.subscriptions.forEach(subscription => subscription.unsubscribe());
        this.subscriptions = [];
        
        // Clear category subscriptions
        this.categorySubscriptions.clear();
        
        // Remove socket listeners
        this.removeAllSocketListeners();
        
        // Reset debug mode
        this.debugMode = false;
        this.debugSubscription = null;
        
        
        return this;
    }
    
    /**
     * Enable or disable debug mode to log all events
     * 
     * @param enabled Whether debug mode should be enabled
     * @returns this (for chaining)
     */
    public enableDebugMode(enabled: boolean = true): this {
        // If already in the requested mode, do nothing
        if (this.debugMode === enabled) {
            return this;
        }
        
        this.debugMode = enabled;
        
        // If enabling debug mode
        if (enabled) {
            
            // Create a subscription to all events
            this.debugSubscription = this.onAll((eventType, payload) => {
                // ;
            });
            
            // Make sure it's tracked for cleanup
            if (this.debugSubscription) {
                this.subscriptions.push(this.debugSubscription);
            }
        } 
        // If disabling debug mode
        else if (this.debugSubscription) {
            
            // Unsubscribe from the debug subscription
            this.debugSubscription.unsubscribe();
            
            // Remove from subscriptions array
            const index = this.subscriptions.indexOf(this.debugSubscription);
            if (index !== -1) {
                this.subscriptions.splice(index, 1);
            }
            
            this.debugSubscription = null;
        }
        
        return this;
    }
    
    /**
     * Subscribe to an event with category for grouped subscription management
     * 
     * @param category Category name for grouping subscriptions
     * @param event Event name to subscribe to
     * @param listener Listener function to call when the event is emitted
     * @returns Subscription that can be unsubscribed to stop listening
     */
    public onWithCategory<T extends AnyEventName>(
        category: string,
        event: T, 
        listener: (payload: any) => void
    ): Subscription {
        // Create a subscription using the standard on method
        const subscription = this.on(event, listener);
        
        // Store in the category map
        if (!this.categorySubscriptions.has(category)) {
            this.categorySubscriptions.set(category, []);
        }
        
        const categorySubs = this.categorySubscriptions.get(category);
        if (categorySubs) {
            categorySubs.push(subscription);
        }
        
        // ;
        
        return subscription;
    }
    
    /**
     * Unsubscribe from all events in a specific category
     * 
     * @param category Category name to unsubscribe from
     * @returns this (for chaining)
     */
    public unsubscribeCategory(category: string): this {
        const subscriptions = this.categorySubscriptions.get(category) || [];
        
        if (subscriptions.length > 0) {
            
            // Unsubscribe from each subscription in the category
            subscriptions.forEach(subscription => {
                subscription.unsubscribe();
                
                // Also remove from the main subscriptions array
                const index = this.subscriptions.indexOf(subscription);
                if (index !== -1) {
                    this.subscriptions.splice(index, 1);
                }
            });
            
            // Clear the category
            this.categorySubscriptions.delete(category);
        } else {
            // ;
        }
        
        return this;
    }
    
    /**
     * Unsubscribe from an event
     * @param event Event name
     * @param handler Event handler function (optional)
     */
    public override off<K extends AnyEventName>(event: K, handler?: EventHandler<any>): void {
        validateEventName(event);
        
        const eventHandlers = this.handlerSubscriptions.get(event);
        if (!eventHandlers) {
            // No handlers for this event found
            // ;
            return;
        }
        
        if (handler) {
            // If specific handler provided, just unsubscribe that one
            const subscription = eventHandlers.get(handler);
            if (subscription) {
                // Unsubscribe from the RxJS subscription
                subscription.unsubscribe();
                
                // Remove from our handler registry
                eventHandlers.delete(handler);
                
                // Remove from the array if present
                const index = this.subscriptions.indexOf(subscription);
                if (index !== -1) {
                    this.subscriptions.splice(index, 1);
                }
                
                // ;
            } else {
                // ;
            }
        } else {
            // If no specific handler, unsubscribe all handlers for this event
            let unsubscribedCount = 0;
            
            eventHandlers.forEach((subscription) => {
                // Unsubscribe from the RxJS subscription
                subscription.unsubscribe();
                
                // Remove from the array if present
                const index = this.subscriptions.indexOf(subscription);
                if (index !== -1) {
                    this.subscriptions.splice(index, 1);
                }
                
                unsubscribedCount++;
            });
            
            // Clear all handlers for this event
            eventHandlers.clear();
            
            // ;
        }
    }
    
    /**
     * Remove all event listeners for a specific event or all events
     * @param event Optional specific event name to remove listeners for
     * @returns this (for chaining)
     */
    public removeAllListeners(event?: AnyEventName): this {
        // Remove all event listeners
        this.eventSubject.observers = [];
        
        // Also clear our handler registries if appropriate
        if (event) {
            this.handlerSubscriptions.delete(event);
        } else {
            this.handlerSubscriptions.clear();
        }
        
        
        return this;
    }
}
