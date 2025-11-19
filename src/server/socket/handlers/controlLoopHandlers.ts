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
 * Control Loop Handlers
 * 
 * This module provides EventBus handlers for control loop operations.
 * Control loop events are forwarded from socket to EventBus by eventForwardingHandlers,
 * then processed here and responses sent back through EventBus.
 */

import { Socket } from 'socket.io';
import { EventBus } from '../../../shared/events/EventBus';
import { Events } from '../../../shared/events/EventNames';
import { ControlLoopEvents } from '../../../shared/events/event-definitions/ControlLoopEvents';
import { createStrictValidator } from '../../../shared/utils/validation';
import { Logger } from '../../../shared/utils/Logger';
import { ControlLoopEventPayload } from '../../../shared/schemas/EventPayloadSchema';

// Create module logger
const moduleLogger = new Logger('info', 'ControlLoopHandlers', 'server');

// Track registered handlers for cleanup
const eventHandlers = new Map<string, (() => void)[]>();

/**
 * Register control loop event handlers for EventBus
 * These handlers listen to control loop events forwarded from sockets via EventBus
 * 
 * @param socket Socket connection (used for cleanup on disconnect)
 * @param agentId Agent ID associated with the socket
 * @param channelId Channel ID for the connection context
 */
export const setupControlLoopHandlers = (socket: Socket, agentId: string, channelId: string): void => {
    const validator = createStrictValidator('ControlLoopHandlers.setupControlLoopHandlers');
    
    // Validate required parameters
    validator.assertIsNonEmptyString(agentId);
    
    // Store cleanup functions for this socket
    const cleanupFunctions: (() => void)[] = [];
    
    // Handler functions for each control loop event type
    const handleControlLoopInitialize = async (payload: ControlLoopEventPayload): Promise<void> => {
        try {
            validator.assertIsObject(payload, 'payload');
            validator.assertIsObject(payload.data, 'payload.data');
            
            // Process control loop initialization
            const loopId = payload.data.loopId;
            validator.assertIsNonEmptyString(loopId, 'loopId is required');
            
            
            // Emit response back through EventBus
            const responsePayload = {
                ...payload,
                eventType: ControlLoopEvents.INITIALIZED,
                timestamp: Date.now()
            };
            
            EventBus.server.emit(ControlLoopEvents.INITIALIZED, responsePayload);
            
        } catch (error: any) {
            moduleLogger.error(`Error handling control loop initialization for agent ${agentId}: ${error.message}`);
            
            // Emit error event
            const errorPayload = {
                ...payload,
                eventType: ControlLoopEvents.ERROR,
                timestamp: Date.now(),
                data: {
                    ...payload.data,
                    error: `Initialization failed: ${error.message}`
                }
            };
            
            EventBus.server.emit(ControlLoopEvents.ERROR, errorPayload);
        }
    };
    
    const handleControlLoopObservation = async (payload: ControlLoopEventPayload): Promise<void> => {
        try {
            validator.assertIsObject(payload, 'payload');
            validator.assertIsObject(payload.data, 'payload.data');
            
            const loopId = payload.data.loopId;
            validator.assertIsNonEmptyString(loopId, 'loopId is required');
            
            // Process observation event - check both possible locations for observation data
            const observationData = payload.data.observation || payload.data.config?.observations;
            if (!observationData) {
                throw new Error('Observation data is required');
            }
            
            
            // Forward observation to any interested services
            // The observation is already on EventBus, so other services can listen to it
            
        } catch (error: any) {
            moduleLogger.error(`Error handling control loop observation for agent ${agentId}: ${error.message}`);
            
            // Emit error event
            const errorPayload = {
                ...payload,
                eventType: ControlLoopEvents.ERROR,
                timestamp: Date.now(),
                data: {
                    ...payload.data,
                    error: `Observation processing failed: ${error.message}`
                }
            };
            
            EventBus.server.emit(ControlLoopEvents.ERROR, errorPayload);
        }
    };
    
    const handleControlLoopAction = async (payload: ControlLoopEventPayload): Promise<void> => {
        try {
            validator.assertIsObject(payload, 'payload');
            validator.assertIsObject(payload.data, 'payload.data');
            
            const loopId = payload.data.loopId;
            validator.assertIsNonEmptyString(loopId, 'loopId is required');
            
            // Process action event
            const actionData = payload.data.action;
            if (!actionData) {
                throw new Error('Action data is required');
            }
            
            
            // Action processing happens here
            // The action is already on EventBus for other services to handle
            
        } catch (error: any) {
            moduleLogger.error(`Error handling control loop action for agent ${agentId}: ${error.message}`);
            
            // Emit error event
            const errorPayload = {
                ...payload,
                eventType: ControlLoopEvents.ERROR,
                timestamp: Date.now(),
                data: {
                    ...payload.data,
                    error: `Action processing failed: ${error.message}`
                }
            };
            
            EventBus.server.emit(ControlLoopEvents.ERROR, errorPayload);
        }
    };
    
    const handleGenericControlLoopEvent = (eventType: string) => {
        return async (payload: ControlLoopEventPayload): Promise<void> => {
            try {
                validator.assertIsObject(payload, 'payload');
                
                const loopId = payload.data?.loopId;
                if (loopId) {
                }
                
                // Generic processing - most control loop events just need to be forwarded
                // They're already on EventBus for other services to consume
                
            } catch (error: any) {
                moduleLogger.error(`Error handling control loop event ${eventType} for agent ${agentId}: ${error.message}`);
                
                // Emit error event
                const errorPayload = {
                    ...payload,
                    eventType: ControlLoopEvents.ERROR,
                    timestamp: Date.now(),
                    data: {
                        ...payload.data,
                        error: `${eventType} processing failed: ${error.message}`
                    }
                };
                
                EventBus.server.emit(ControlLoopEvents.ERROR, errorPayload);
            }
        };
    };
    
    // Register EventBus listeners for all control loop events
    const eventHandlerMap = new Map([
        [ControlLoopEvents.INITIALIZE, handleControlLoopInitialize],
        [ControlLoopEvents.OBSERVATION, handleControlLoopObservation],
        [ControlLoopEvents.ACTION, handleControlLoopAction],
        [ControlLoopEvents.INITIALIZED, handleGenericControlLoopEvent(ControlLoopEvents.INITIALIZED)],
        [ControlLoopEvents.STARTED, handleGenericControlLoopEvent(ControlLoopEvents.STARTED)],
        [ControlLoopEvents.STOPPED, handleGenericControlLoopEvent(ControlLoopEvents.STOPPED)],
        [ControlLoopEvents.REASONING, handleGenericControlLoopEvent(ControlLoopEvents.REASONING)],
        [ControlLoopEvents.PLAN, handleGenericControlLoopEvent(ControlLoopEvents.PLAN)],
        [ControlLoopEvents.EXECUTION, handleGenericControlLoopEvent(ControlLoopEvents.EXECUTION)],
        [ControlLoopEvents.REFLECTION, handleGenericControlLoopEvent(ControlLoopEvents.REFLECTION)],
        [ControlLoopEvents.ERROR, handleGenericControlLoopEvent(ControlLoopEvents.ERROR)]
    ]);
    
    // Register all event handlers
    eventHandlerMap.forEach((handler, eventType) => {
        
        EventBus.server.on(eventType, handler);
        
        // Store cleanup function
        const cleanup = () => {
            EventBus.server.off(eventType, handler);
        };
        cleanupFunctions.push(cleanup);
    });
    
    // Store cleanup functions for this socket
    eventHandlers.set(socket.id, cleanupFunctions);
    
    // Handle socket disconnection cleanup
    socket.on('disconnect', () => {
        
        // Clean up EventBus listeners
        const socketCleanupFunctions = eventHandlers.get(socket.id);
        if (socketCleanupFunctions) {
            socketCleanupFunctions.forEach(cleanup => cleanup());
            eventHandlers.delete(socket.id);
        }
    });
    
};