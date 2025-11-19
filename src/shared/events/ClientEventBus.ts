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
 * ClientEventBus
 * 
 * Provides client-side event bus implementation for the MXF.
 * Handles client-specific event operations, socket connections, and event forwarding.
 */

import { Subject, Subscription, filter, map } from 'rxjs';
import { EventMap, Events } from './EventNames';
import { 
    AnyEventName, 
    BaseEventBusImplementation, 
    EventHandler, 
    EventMessage, 
    SocketLike, 
    validateEventName 
} from './EventBusBase';
import { 
    createAgentEventPayload, 
    createBaseEventPayload, 
} from '../schemas/EventPayloadSchema';
import { createStrictValidator } from '../utils/validation';
import { Logger } from '../utils/Logger';

// Create a logger instance for ClientEventBus (warn level to reduce noise, client target for SDK usage)
const logger = new Logger('warn', 'ClientEventBus', 'client');

// Create a strict validator for client-side operations
const validator = createStrictValidator('ClientEventBus');

/**
 * Interface for client-specific event bus functionality
 */
export interface IClientEventBus extends BaseEventBusImplementation {
    /**
     * Set the socket to use for event forwarding
     * @param socket Socket to use
     * @returns this (for chaining)
     */
    setClientSocket(socket: SocketLike): this;
    
    /**
     * Set up socket event forwarding
     * @param socket Socket to use
     * @returns this (for chaining)
     */
    setupClientSocketForwarding(socket: SocketLike): this;
    
    /**
     * Disconnect the socket
     * @returns this (for chaining)
     */
    disconnect(): this;
    
    /**
     * Remove all socket listeners
     * @returns this (for chaining)
     */
    removeAllListeners(event?: AnyEventName): this;

    /**
     * Emit an event
     * @param event Event name
     * @param payload Event payload
     */
    emit(event: AnyEventName, payload: any): void;
}

/**
 * Client-side event bus implementation
 */
export class ClientEventBus extends BaseEventBusImplementation implements IClientEventBus {
    private socket: SocketLike | null = null;
    private socketListeners: Map<string, (...args: any[]) => void> = new Map();
    private subscriptions: Subscription[] = [];
    private categorySubscriptions: Map<string, Subscription[]> = new Map();
    
    // Track subscriptions by event and handler
    private handlerSubscriptions: Map<string, Map<EventHandler<any>, Subscription>> = new Map();
    private debugMode: boolean = false;
    private debugSubscription: Subscription | null = null;
    
    /**
     * Create a new ClientEventBus
     * @param eventSubject Subject to use for events
     */
    constructor(eventSubject: Subject<EventMessage>) {
        super(eventSubject);
        //// ;
    }
    
    /**
     * Set the socket to use for event forwarding
     * @param socket Socket to use
     * @returns this (for chaining)
     */
    public setClientSocket(socket: SocketLike): this {
        try {
            validator.assertIsObject(socket);
            
            // Check that this is a socket-like object
            validator.assertHasFunction(socket, 'on');
            validator.assertHasFunction(socket, 'emit');
            
            // Store the socket
            this.socket = socket;
            
            // Set up event forwarding
            this.setupClientSocketForwarding(socket);
            
        } catch (error) {
            logger.error('[ClientEventBus] Error setting socket:', error instanceof Error ? error.message : String(error));
            throw new Error(`Error setting socket: ${error instanceof Error ? error.message : 'Invalid socket'}`);
        }
        
        return this;
    }
    
    /**
     * Emit an event
     * This is the core method that handles all event emission
     * @param event Event name
     * @param payload Event payload
     */
    public emit(event: AnyEventName, payload: any): void {
        try {

            // ;

            // Validate event name and payload
            validateEventName(event);
            this.validateEventPayload(String(event), payload);
            
            // Emit to local event bus
            this.eventSubject.next({
                type: event,
                payload,
            });
            
            // Forward to socket.io if connected
            if (this.socket && this.socket.connected) {
                // Direct log for critical events to ensure visibility
                if (typeof event === 'string' && (event.includes('register') || event.includes('connect'))) {
                }
                
                // Add detailed logging for message events
                if (typeof event === 'string' && event.includes('message')) {
                }
                
                // Emit to socket
                this.socket.emit(event, payload);
            } else {
                logger.warn(`[ClientEventBus] WARNING: Socket not connected, could not forward event: ${event}. Socket exists: ${!!this.socket}, Socket connected: ${this.socket?.connected}`);
            }
            
            //// ;
        } catch (error) {
            logger.error(`[ClientEventBus] Error emitting event '${event}':`, error instanceof Error ? error.message : String(error));
            
            // Emit error event
            this.eventSubject.next({
                type: Events.Agent.ERROR,
                payload: {
                    error: error instanceof Error ? error.message : String(error),
                    event,
                    timestamp: Date.now()
                }
            });
        }
    }
    
    /**
     * Set up socket event forwarding from socket to event bus
     * @param socket Socket to use
     * @returns this (for chaining)
     */
    public setupClientSocketForwarding(socket: SocketLike): this {
        try {
            validator.assertIsObject(socket);
            validator.assertHasFunction(socket, 'on');
            validator.assertHasFunction(socket, 'onAny');
            
            // Remove previous listeners if any
            this.removeAllSocketListeners();
            
            // Catch every event with onAny (Socket.IO specific)
            if (socket.onAny) {
                const handleAnyEvent = (event: string, ...args: any[]) => {
                    // Skip processing of some internal socket.io events
                    if (event.startsWith('$') || event === 'ping' || event === 'pong') {
                        return;
                    }
                    
                    // ;
                    
                    const payload = args.length > 0 ? args[0] : {};
                    
                    // Forward to event bus
                    this.eventSubject.next({
                        type: event,
                        payload
                    });
                };
                
                socket.onAny(handleAnyEvent);
                this.socketListeners.set('any', handleAnyEvent);
            }
            
        } catch (error) {
            logger.error('[ClientEventBus] Error setting up socket forwarding:', error instanceof Error ? error.message : String(error));
            throw new Error(`Error setting up socket forwarding: ${error instanceof Error ? error.message : 'Invalid socket'}`);
        }
        
        return this;
    }
    
    /**
     * Disconnect the socket
     * @returns this (for chaining)
     */
    public disconnect(): this {
        if (this.socket) {
            try {
                // Clean up listeners
                this.removeAllSocketListeners();
                
                // Disconnect if connected and has disconnect method
                if (this.socket.connected && typeof this.socket['disconnect'] === 'function') {
                    (this.socket as any).disconnect();
                }
                
                // Clear socket reference
                this.socket = null;
            } catch (error) {
                logger.error('[ClientEventBus] Error disconnecting socket:', error instanceof Error ? error.message : String(error));
            }
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
     * Remove all socket listeners
     * @returns this (for chaining)
     */
    public removeAllSocketListeners(): this {
        if (this.socket) {
            try {
                // Remove "any" listener if registered
                if (this.socket.offAny && this.socketListeners.has('any')) {
                    this.socket.offAny();
                    this.socketListeners.delete('any');
                }
                
                // Remove individual event listeners
                for (const [event, listener] of this.socketListeners.entries()) {
                    if (event !== 'any') {
                        this.socket.off(event, listener);
                    }
                }
                
                // Clear listener map
                this.socketListeners.clear();
                
                // Use Socket.IO's removeAllListeners if available
                if (this.socket.removeAllListeners) {
                    this.socket.removeAllListeners();
                }
                
                // ;
            } catch (error) {
                logger.error('[ClientEventBus] Error removing socket listeners:', error instanceof Error ? error.message : String(error));
            }
        }
        
        return this;
    }
    
    /**
     * Remove all agent event listeners
     * @returns this (for chaining)
     */
    public removeAllAgentListeners(): this {
        // This just delegates to removeAllListeners for consistency
        return this.removeAllListeners();
    }
    
    /**
     * Check if the socket is connected
     * @returns true if socket is connected
     */
    public isSocketConnected(): boolean {
        return !!this.socket && !!this.socket.connected;
    }
    
    /**
     * Subscribe to an event in the client event bus
     * 
     * @param event Event name to subscribe to
     * @param listener Listener function to call when the event is emitted
     * @returns Subscription that can be unsubscribed to stop listening
     */
    public on<T extends AnyEventName>(event: T, listener: (payload: any) => void): Subscription {
        // Create a filtered observable for this specific event
        const observable = this.eventSubject.pipe(
            filter((e: EventMessage) => e.type === event),
            map((e: EventMessage) => e.payload)
        );
        
        // Log subscription to important events
        if (event && typeof event === 'string' && 
            (event.includes('register') || event.includes('connect'))) {
        }
        
        // Subscribe to the observable with the listener
        const subscription = observable.subscribe(listener);
        
        // Store the subscription for cleanup
        this.subscriptions.push(subscription);
        
        // Also store in our handler-based registry for off() support
        if (!this.handlerSubscriptions.has(event)) {
            this.handlerSubscriptions.set(event, new Map());
        }
        
        const eventHandlers = this.handlerSubscriptions.get(event);
        if (eventHandlers) {
            eventHandlers.set(listener, subscription);
        }
        
        return subscription;
    }
    
    /**
     * Subscribe to an event once in the client event bus
     * Once the event is fired, the subscription is automatically removed
     * 
     * @param event Event name to subscribe to
     * @param listener Listener function to call when the event is emitted
     * @returns Subscription that can be unsubscribed to stop listening
     */
    public override once<T extends AnyEventName>(event: T, listener: (payload: any) => void): Subscription {
        // Create a filtered observable for this specific event
        const observable = this.eventSubject.pipe(
            filter((e: EventMessage) => e.type === event),
            map((e: EventMessage) => e.payload)
        );
        
        // Log subscription to important events
        if (event && typeof event === 'string' && 
            (event.includes('register') || event.includes('connect'))) {
        }
        
        // Create a wrapper listener that will unsubscribe after first execution
        const onceListener = (payload: any) => {
            // Call the original listener
            listener(payload);
            
            // Unsubscribe from this event
            this.off(event, onceListener);
            
            // ;
        };
        
        // Subscribe to the observable with the one-time listener
        const subscription = observable.subscribe(onceListener);
        
        // Store the subscription for cleanup
        this.subscriptions.push(subscription);
        
        // Also store in our handler-based registry for off() support
        if (!this.handlerSubscriptions.has(event)) {
            this.handlerSubscriptions.set(event, new Map());
        }
        
        const eventHandlers = this.handlerSubscriptions.get(event);
        if (eventHandlers) {
            eventHandlers.set(listener, subscription);
        }
        
        return subscription;
    }

    /**
     * Subscribe to all events in the client event bus
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
     * Subscribe to an event in the client event bus with category
     * for grouped subscription management
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
        // Get the subscription using the standard on method
        const subscription = this.on(event, listener);
        
        // Store in the category map
        if (!this.categorySubscriptions.has(category)) {
            this.categorySubscriptions.set(category, []);
        }
        
        const categorySubs = this.categorySubscriptions.get(category);
        if (categorySubs) {
            categorySubs.push(subscription);
        }
        
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
}
