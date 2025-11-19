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
 * ServerReflectionService.ts
 * 
 * Server-side implementation of the reflection service that handles
 * reflection events, persistence, and provides additional server-specific functionality.
 */

import { v4 as uuidv4 } from 'uuid';
import { Logger } from '../../../shared/utils/Logger';
import { EventBus } from '../../../shared/events/EventBus';
import { Events } from '../../../shared/events/EventNames';
import { Plan, Reflection } from '../../../shared/types/ControlLoopTypes';
import { reflectionService } from '../../../shared/services/ReflectionService';
import { createStrictValidator } from '../../../shared/utils/validation';
import { createControlLoopEventPayload, ControlLoopSpecificData, ControlLoopEventPayload } from '../../../shared/schemas/EventPayloadSchema';
import { EnhancedReflection } from '../../../shared/types/ReflectionTypes';

export class ServerReflectionService {
    private logger: Logger;
    private validator = createStrictValidator('ServerReflectionService');
    
    // Keep a cache of recent reflections for quick reference
    private reflectionCache = new Map<string, Reflection & EnhancedReflection>();
    
    // Maximum size of the reflection cache
    private readonly MAX_CACHE_SIZE = 100;
    
    constructor() {
        this.logger = new Logger('info', 'ServerReflectionService', 'server');
        this.setupEventHandlers();
    }
    
    /**
     * Set up event handlers for reflection-related events
     */
    private setupEventHandlers = (): void => {
        // Handle reflection events from clients
        EventBus.server.on(Events.ControlLoop.REFLECTION, this.handleReflectionEvent);
        
        // Handle plan completion events to potentially trigger reflections
        EventBus.server.on(Events.ControlLoop.PLAN, this.handlePlanEvent);
        
    };
    
    /**
     * Handle incoming reflection events
     */
    private handleReflectionEvent = (payload: ControlLoopEventPayload): void => {
        try {
            this.validator.assertIsObject(payload, 'Invalid reflection event payload');
            
            // Defensive check for payload structure
            if (!payload.data) {
                this.logger.warn('Reflection event received with missing data field');
                return;
            }
            
            this.validator.assertIsObject(payload.data, 'Missing data in reflection event');
            
            // Check for reflection data with better error messages
            if (!payload.data.reflection) {
                this.logger.warn(`Reflection event received without reflection data. Event data: ${JSON.stringify(payload.data, null, 2)}`);
                return;
            }
            
            this.validator.assertIsObject(payload.data.reflection, 'Missing reflection in event data');
            
            const { agentId, channelId } = payload;
            const loopId = payload.data.loopId;
            const reflection = payload.data.reflection;
            
            // Log the reflection event
            
            // Store in cache
            this.cacheReflection(reflection);
            
            // Store in database (would be implemented in a real system)
            // this.persistReflection(reflection);
            
            // Process reflection for learning (optional)
            this.processReflectionForLearning(reflection);
            
            // No need to re-emit the event as it's already on the event bus
        } catch (error) {
            this.logger.error(`Error handling reflection event: ${error instanceof Error ? error.message : String(error)}`);
        }
    };
    
    /**
     * Handle plan events to potentially trigger reflections if needed
     */
    private handlePlanEvent = (payload: ControlLoopEventPayload): void => {
        try {
            // Only handle completed plans
            if (payload.data?.status !== 'completed') {
                return;
            }
            
            const { agentId, channelId } = payload;
            const loopId = payload.data.loopId;
            const plan = payload.data.plan;
            
            if (!plan) {
                return;
            }
            
            // Check if all actions are in terminal states
            const allActionsCompleted = plan.actions.every((action: any) => 
                ['completed', 'failed', 'skipped'].includes(action.status)
            );
            
            if (allActionsCompleted) {
                
                // Check if reflection already exists
                const reflectionExists = Array.from(this.reflectionCache.values())
                    .some(r => r.planId === plan.id);
                
                if (!reflectionExists) {
                    this.generateReflection(loopId, agentId, channelId, plan);
                }
            }
        } catch (error) {
            this.logger.error(`Error handling plan event: ${error instanceof Error ? error.message : String(error)}`);
        }
    };
    
    /**
     * Generate a reflection for a completed plan
     */
    private generateReflection = (loopId: string, agentId: string, channelId: string, plan: Plan): void => {
        try {
            // Use the shared reflection service to generate a structured reflection
            const reflection = reflectionService.generateReflection(plan);
            
            // Cache the reflection
            this.cacheReflection(reflection);
            
            // Emit the reflection event
            const reflectionEventData: ControlLoopSpecificData = {
                loopId, // loopId is context for the reflection
                reflection, // The generated reflection object
                // status: 'reflecting' // Status might be implicit in the event type
            };
            
            const payload = createControlLoopEventPayload(
                Events.ControlLoop.REFLECTION, // Correct: eventType
                agentId,                       // agentId
                channelId,                     // channelId
                reflectionEventData,           // Correct: controlLoopData
                {                              // options
                    timestamp: Date.now(),     // Optional: override default timestamp
                    source: 'server'           // Optional: specify the source
                }
            );
            
            EventBus.server.emit(Events.ControlLoop.REFLECTION, payload);
        } catch (error) {
            this.logger.error(`Error generating reflection: ${error instanceof Error ? error.message : String(error)}`);
        }
    };
    
    /**
     * Store reflection in the cache
     */
    private cacheReflection = (reflection: Reflection & EnhancedReflection): void => {
        // Limit cache size with LRU-like behavior (remove oldest entries)
        if (this.reflectionCache.size >= this.MAX_CACHE_SIZE) {
            // Get the oldest entry
            const oldestKey = this.reflectionCache.keys().next().value;
            if (oldestKey) {
                this.reflectionCache.delete(oldestKey);
            }
        }
        
        // Add to cache
        this.reflectionCache.set(reflection.id, reflection);
    };
    
    /**
     * Process reflection for machine learning (placeholder for future extension)
     */
    private processReflectionForLearning = (reflection: Reflection & EnhancedReflection): void => {
        // This would be implemented in a full RL system
        // For now, we'll just log the learning signal as an example
        if (reflection.learningSignals) {
        }
    };
    
    /**
     * Get a reflection by ID
     */
    public getReflection = (reflectionId: string): (Reflection & EnhancedReflection) | null => {
        return this.reflectionCache.get(reflectionId) || null;
    };
    
    /**
     * Get all reflections for a specific plan
     */
    public getReflectionsForPlan = (planId: string): Array<Reflection & EnhancedReflection> => {
        return Array.from(this.reflectionCache.values())
            .filter(reflection => reflection.planId === planId);
    };
    
    /**
     * Get all reflections for a specific agent
     */
    public getReflectionsForAgent = (agentId: string): Array<Reflection & EnhancedReflection> => {
        return Array.from(this.reflectionCache.values())
            .filter(reflection => reflection.agentId === agentId);
    };
}
