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
 * ControlLoopService.ts
 * 
 * This service handles control loop operations for agents.
 * It acts as the message handler for control loop related commands,
 * following the three-service separation of concerns pattern.
 */

import { EventBus } from '../../../shared/events/EventBus';
import { 
    Events, 
    ChannelEvents,
    ControlLoopEvents,
    MessageEvents,
    AgentEvents
} from '../../../shared/events/EventNames';
import { v4 as uuidv4 } from 'uuid';

import { ControlLoop } from '../implementations/ControlLoop';
import { Logger } from '../../../shared/utils/Logger';
import { createStrictValidator } from '../../../shared/utils/validation';
import { 
    ControlLoopEventPayload,
    ControlLoopSpecificData
} from '../../../shared/schemas/EventPayloadSchema';
import { AgentId } from '../../../shared/types/Agent';
import {
    ChannelId
} from '../../../shared/types/ChannelContext';
import {
    ControlLoopConfig,
    Reasoning,
    Plan
} from '../../../shared/models/controlLoop';
import { SystemLlmService } from './SystemLlmService';
import { SystemLlmServiceManager } from './SystemLlmServiceManager';
import { lastValueFrom } from 'rxjs';

// Phase 2: Enhanced Memory Architecture and Agent Performance Tracking
import { PatternMemoryService } from '../../../shared/services/PatternMemoryService';
import { AgentPerformanceService } from '../../../shared/services/AgentPerformanceService';

// Phase 2.5: MongoDB Lens MCP Server Integration
import { McpToolHandlerContext, McpToolHandlerResult } from '../../../shared/protocols/mcp/McpServerTypes';

// Create a validator for the service
const validator = createStrictValidator('ControlLoopService');

// Create a logger for the service
const logger = new Logger('info', 'ControlLoopService', 'server');

// Set of initialized control loops by agent ID
const initializedControlLoops = new Set<string>();

// Map of agent ID to control loop instance
const controlLoopsByAgent = new Map<AgentId, ControlLoop>();

// Map of loop ID to control loop configuration
const controlLoopConfigs = new Map<string, ControlLoopConfig>();

// Max number of logs for duplicate event skipping
const MAX_SKIP_LOGS = 3;

// Counter for duplicate events by agent/event type
const eventCounters: Record<string, number> = {};
const MAX_DUPLICATE_LOGS = 3; // Only log the first 3 of the same event type from the same agent

// Processed events by type
const processedEvents: Record<string, Set<string>> = {};

/**
 * ControlLoopService manages the lifecycle of control loops
 * 
 * The service:
 * 1. Creates and tracks control loops for each agent
 * 2. Handles initialization, starting, stopping of control loops
 * 3. Processes control loop events (observations, actions, etc.)
 */
export class ControlLoopService {
    private initialized = false;
    private handlersSetup = false;

    private patternMemoryService!: PatternMemoryService;
    private agentPerformanceService!: AgentPerformanceService;

    private actionSequences = new Map<string, string[]>(); // Map: agentId -> action sequence

    /**
     * Initialize the ControlLoopService
     */
    constructor() {
        // Initialize only once
        if (this.initialized) {
            return;
        }

        // Set up event handlers
        this.setupEventHandlers();

        // Phase 2: Initialize enhanced memory and performance services
        this.patternMemoryService = PatternMemoryService.getInstance();
        this.agentPerformanceService = AgentPerformanceService.getInstance();

        this.initialized = true;
    }

    /**
     * Set up event handlers for control loop operations
     */
    private setupEventHandlers(): void {
        // Prevent duplicate event handler registration
        if (this.handlersSetup) {
            return;
        }
        
        Object.values(ControlLoopEvents).forEach(eventType => {
            EventBus.server.on(eventType, (payload) => {
                this.handleTypedControlLoopEvent(eventType, payload);
            });
        });
        
        // Set up Phase 2 pattern tracking event listeners
        this.setupPhase2EventListeners();
        
        this.handlersSetup = true;
    }
    
    /**
     * Set up Phase 2 pattern tracking event listeners
     */
    private setupPhase2EventListeners(): void {
        // Listen for all ORPAR lifecycle events to track patterns
        EventBus.server.on(ControlLoopEvents.OBSERVATION, (payload) => {
            this.trackOrparPhase('observation', payload);
        });
        
        EventBus.server.on(ControlLoopEvents.REASONING, (payload) => {
            this.trackOrparPhase('reasoning', payload);
        });
        
        EventBus.server.on(ControlLoopEvents.PLAN, (payload) => {
            this.trackOrparPhase('planning', payload);
        });
        
        EventBus.server.on(ControlLoopEvents.ACTION, (payload) => {
            this.trackOrparPhase('action', payload);
        });
        
        EventBus.server.on(ControlLoopEvents.REFLECTION, (payload) => {
            this.trackOrparPhase('reflection', payload);
        });
        
    }
    
    /**
     * Track ORPAR phase for pattern analysis
     */
    private trackOrparPhase(phase: string, payload: any): void {
        try {
            if (!payload.agentId || !payload.channelId) {
                return; // Skip tracking if missing required fields
            }
            
            const agentId = payload.agentId;
            const channelId = payload.channelId;
            
            // Track phase in action sequence
            const agentSequence = this.actionSequences.get(agentId) || [];
            agentSequence.push(phase);
            this.actionSequences.set(agentId, agentSequence.slice(-10));
            
            // Check for complete ORPAR cycles for pattern analysis
            if (phase === 'reflection' && agentSequence.length >= 5) {
                const recentSequence = agentSequence.slice(-5);
                const hasCompleteOrpar = recentSequence.includes('observation') &&
                                       recentSequence.includes('reasoning') &&
                                       recentSequence.includes('planning') &&
                                       recentSequence.includes('action') &&
                                       recentSequence.includes('reflection');

                if (hasCompleteOrpar) {
                    // Analyze complete ORPAR cycle pattern
                    this.patternMemoryService.analyzeSequenceForPatterns(
                        channelId,
                        agentId,
                        recentSequence,
                        { cycle: 'complete_orpar', timestamp: Date.now() }
                    ).then(analysis => {
                        if (analysis.patternDetected && analysis.confidence > 0.6) {
                            // Store successful ORPAR pattern
                            this.patternMemoryService.storePattern(
                                channelId,
                                agentId,
                                {
                                    channelId,
                                    type: 'orpar_sequence',
                                    pattern: {
                                        sequence: recentSequence.slice(),
                                        conditions: { cycleType: 'complete_orpar' },
                                        outcomes: { success: true, completedCycle: true },
                                        toolsUsed: analysis.metadata.toolsInvolved || [],
                                        executionTime: Date.now(),
                                        complexity: analysis.metadata.complexity
                                    },
                                    effectiveness: analysis.metadata.estimatedEffectiveness,
                                    agentParticipants: [agentId],
                                    similarPatterns: [],
                                    tags: ['orpar', 'complete_cycle'],
                                    metadata: {
                                        channelContext: `Complete ORPAR cycle in channel ${channelId}`,
                                        systemState: { phase, completedCycle: true },
                                        performanceMetrics: {
                                            averageExecutionTime: 0,
                                            minExecutionTime: 0,
                                            maxExecutionTime: 0,
                                            standardDeviation: 0
                                        },
                                        confidence: analysis.confidence
                                    }
                                }
                            ).catch((error: Error) => {
                                logger.warn(`ORPAR pattern storage failed: ${error}`);
                            });
                        }
                    }).catch((error: Error) => {
                        logger.warn(`ORPAR pattern analysis failed: ${error}`);
                    });
                }
            }
            
        } catch (error) {
            logger.warn(`Phase 2 pattern tracking error: ${error}`);
        }
    }
    
    /**
     * Handle typed control loop events
     * @param eventType Event type
     * @param payload Event payload
     */
    private handleTypedControlLoopEvent(eventType: string, payload: ControlLoopEventPayload): void {
        try {
            // Validate the payload
            validator.assertIsObject(payload);
            
            // Verify data field exists
            if (!payload.data || typeof payload.data !== 'object') {
                logger.warn(`Event payload missing data object in ${eventType} event`);
                return;
            }
            
            // Skip server-generated events and internal ControlLoop events to prevent infinite loops
            // Server-generated events have source === 'server' 
            // ControlLoop internal events have source === 'controlLoop'
            // Exception: SYSTEM_LLM_REASONING events should be processed even from controlLoop source
            const shouldSkipRecursionProtection = eventType === ControlLoopEvents.SYSTEM_LLM_REASONING;
            
            if (!shouldSkipRecursionProtection && 
                ((payload.source === 'server' || payload.source === 'controlLoop') ||
                (payload.data.metadata && 
                 (payload.data.metadata.source === 'server' || payload.data.metadata.isRecursionProtection === true)))) {
                return;
            }
            
            // Special debug logging for SYSTEM_LLM_REASONING events
            if (eventType === ControlLoopEvents.SYSTEM_LLM_REASONING) {
            }
            
            // Extract fields according to ControlLoopEventPayload schema
            const { agentId, channelId, loopId, data } = this.extractControlLoopEventFields(eventType, payload);
            
            // Track event counts to prevent log flooding
            const eventKey = `${agentId}:${eventType}`;
            eventCounters[eventKey] = (eventCounters[eventKey] || 0) + 1;
            
            // Only log the first few occurrences of the same event type from the same agent
            if (eventCounters[eventKey] <= MAX_DUPLICATE_LOGS) {
                // Log that we received the event
            } else if (eventCounters[eventKey] === MAX_DUPLICATE_LOGS + 1) {
                // Log once that we're suppressing future logs of this event type
            }
            
            // Only log extracted fields for the first few occurrences
            if (eventCounters[eventKey] <= MAX_DUPLICATE_LOGS) {
            }
            
            if (!agentId) {
                logger.warn(`Missing agentId in ${eventType} event`);
                return;
            }
            
            // Process event based on type
            switch (eventType) {
                case ControlLoopEvents.INITIALIZE:
                    // Initialize control loop
                    
                    // Extract config following the schema definition
                    const config = data.config || {};
                    
                    // Use the client-specified loopId if provided
                    if (loopId) {
                        config.loopId = loopId;
                    }
                    
                    
                    // Initialize the control loop with the extracted config
                    this.initializeControlLoop(agentId, channelId, config);
                    break;
                    
                case ControlLoopEvents.INITIALIZED:
                    // Control loop has been initialized - notification event
                    // This is a notification event, no specific handler needed
                    break;
                    
                case ControlLoopEvents.STARTED:
                    // Start control loop
                    this.handleControlLoopStart(agentId, channelId);
                    break;
                    
                case ControlLoopEvents.STOPPED:
                    // Stop control loop
                    this.handleControlLoopStop(agentId, channelId);
                    break;
                    
                case ControlLoopEvents.OBSERVATION:
                    // Process observation according to schema
                    const observation = data.observation;
                    if (observation) {
                        // Get loopOwnerId from context as per ControlLoopSpecificData schema
                        const loopOwnerId = data.context?.loopOwnerId;
                        if (loopOwnerId) {
                            // Cross-agent observation: Use the control loop owner's ID instead of the observer's ID
                            this.handleControlLoopObserve(loopOwnerId, channelId, loopId, observation);
                        } else {
                            // Self-observation: Agent submitting to its own control loop
                            this.handleControlLoopObserve(agentId, channelId, loopId, observation);
                        }
                    } else {
                        logger.warn(`Missing observation data in ${eventType} event from ${agentId}`);
                    }
                    break;
                    
                case ControlLoopEvents.EXECUTION:
                    // Process execution according to schema
                    const action = data.action;
                    if (action) {
                        this.handleControlLoopExecution(agentId, channelId, loopId, action);
                    } else {
                        logger.warn(`Missing action data in ${eventType} event from ${agentId}`);
                    }
                    break;
                    
                case ControlLoopEvents.REASONING:
                    // Process reasoning according to schema
                    const reasoning = data.reasoning;
                    if (reasoning) {
                        this.handleControlLoopReasoning(loopId, agentId, channelId, reasoning);
                    } else {
                        logger.warn(`Missing reasoning data in ${eventType} event from ${agentId}`);
                    }
                    break;
                    
                case ControlLoopEvents.PLAN:
                    // Process plan according to schema
                    const plan = data.plan;
                    if (plan) {
                        // Plan events are typically just notifications, no specific handler needed
                    } else {
                        logger.warn(`Missing plan data in ${eventType} event from ${agentId}`);
                    }
                    break;
                    
                case ControlLoopEvents.ACTION:
                    // Process action according to schema
                    const actionData = data.action;
                    if (actionData) {
                        // Action events are typically just notifications, no specific handler needed
                    } else {
                        logger.warn(`Missing action data in ${eventType} event from ${agentId}`);
                    }
                    break;
                    
                case ControlLoopEvents.REFLECTION:
                    // Process reflection according to schema
                    const reflection = data.reflection;
                    if (reflection) {
                        // Reflection events are typically just notifications, no specific handler needed
                    } else {
                        logger.warn(`Missing reflection data in ${eventType} event from ${agentId}`);
                    }
                    break;
                    
                case ControlLoopEvents.SYSTEM_LLM_REASONING:
                    // Process system LLM reasoning request
                    this.handleSystemLlmReasoning(agentId, channelId, loopId, data);
                    break;
                    
                default:
                    logger.warn(`Unknown control loop event type: ${eventType}`);
            }
        } catch (error) {
            logger.error(`Error handling ${eventType} event: ${error}`);
        }
    }
    
    /**
     * Extract essential fields from a control loop event payload
     * @param eventType Event type
     * @param payload Event payload
     * @returns Essential fields
     */
    private extractControlLoopEventFields(eventType: string, payload: ControlLoopEventPayload): { agentId: string, channelId: string, loopId: string, data?: any } {
        try {
            // Validate incoming payload
            validator.assertIsObject(payload);
            validator.assertIsString(payload.data.loopId);
            
            // Extract the agent ID from the payload
            validator.assertIsString(payload.agentId);
            const agentId = payload.agentId;
            
            // Extract the loop ID from the payload
            const loopId = payload.data.loopId;
            
            // Extract the channel ID from the payload
            validator.assertIsString(payload.channelId);
            const channelId = payload.channelId;
            
            // Extract any data from the payload
            const data = payload.data || {};
            
            return { agentId, channelId, loopId, data };
        } catch (error) {
            logger.error(`Error extracting fields from control loop event: ${error}`);
            throw error;
        }
    }
    
    /**
     * Initialize a control loop for an agent in a channel
     * This is the SINGLE source of control loop initialization events
     * @param agentId Agent ID
     * @param channelId Channel ID
     * @param config Optional configuration
     */
    private initializeControlLoop(agentId: AgentId, channelId: string, config: any = {}): void {
        try {
            // Basic validation
            validator.assertIsString(agentId);
            validator.assertIsString(channelId);
            
            // Extract client-provided loopId - this is REQUIRED
            const clientProvidedLoopId = config.loopId;
            
            // Validate loopId exists (fail-fast)
            if (!clientProvidedLoopId) {
                logger.error(`[CRITICAL] Client must provide a loop ID for initialization (agentId=${agentId}, channelId=${channelId})`);
                throw new Error(`Client must provide a loop ID for initialization`);
            }
            
            // Complete configuration
            const fullConfig: ControlLoopConfig = {
                ...config,
                agentId, 
                channelId
            };
            
            
            // Check if control loop already exists
            if (controlLoopsByAgent.has(agentId)) {
                
                // Get existing control loop
                const controlLoop = controlLoopsByAgent.get(agentId);
                
                if (controlLoop) {
                    // Get the old loopId for this agent so we can clean up the controlLoopConfigs map
                    const oldLoopId = controlLoop.getLoopId();
                    
                    // Reset control loop immediately - no need for setTimeout delay
                    controlLoop.reset()
                        .then(() => {
                            
                            // If we had an old loopId, remove its config entry to prevent stale configuration
                            if (oldLoopId) {
                                if (controlLoopConfigs.has(oldLoopId)) {
                                    controlLoopConfigs.delete(oldLoopId);
                                }
                            }
                            
                            // Store config with client-provided ID
                            controlLoopConfigs.set(clientProvidedLoopId, fullConfig);
                            
                            // Reinitialize it with config
                            return controlLoop.initialize(fullConfig);
                        })
                        .then(() => {
                            // REMOVED: Callback notifications cause duplicate event processing
                            // Use EventBus as the primary communication mechanism instead
                            // this.setupControlLoopNotifications(controlLoop, agentId, clientProvidedLoopId, channelId);
                            
                            
                            // Add to initialized set
                            initializedControlLoops.add(agentId);
                            
                            // Emit initialized event - this is the ONLY source of initialized events
                            this.emitControlLoopEvent(
                                ControlLoopEvents.INITIALIZED,
                                clientProvidedLoopId,
                                agentId,
                                channelId,
                                'initialized',
                                { config: fullConfig }
                            );
                            
                            // Auto-start the control loop for fully automated operation
                            return controlLoop.start();
                        })
                        .then(() => {
                            
                            // Emit started event to notify clients
                            this.emitControlLoopEvent(
                                ControlLoopEvents.STARTED,
                                clientProvidedLoopId,
                                agentId,
                                channelId,
                                'running',
                                { autoStarted: true }
                            );
                        })
                        .catch((error: Error) => {
                            logger.error(`[CRITICAL] Failed to reset or reinitialize control loop for agent ${agentId}: ${error}`);
                            
                            // Emit error event
                            this.emitControlLoopEvent(
                                ControlLoopEvents.ERROR,
                                clientProvidedLoopId,
                                agentId,
                                channelId,
                                'error',
                                { error: String(error) }
                            );
                        });
                }
                
                return;
            }
            
            // Create new control loop - pass the client loopId directly to constructor
            const controlLoop = new ControlLoop(agentId, clientProvidedLoopId);
            
            // Store it
            controlLoopsByAgent.set(agentId, controlLoop);
            
            // Store the control loop configuration
            controlLoopConfigs.set(clientProvidedLoopId, fullConfig);
            
            // Initialize the control loop
            controlLoop.initialize(fullConfig)
                .then(() => {
                    // REMOVED: Callback notifications cause duplicate event processing
                    // Use EventBus as the primary communication mechanism instead
                    // this.setupControlLoopNotifications(controlLoop, agentId, clientProvidedLoopId, channelId);
                    
                    
                    // Add to initialized set
                    initializedControlLoops.add(agentId);
                    
                    // Emit initialized event - this is the ONLY source of initialized events
                    this.emitControlLoopEvent(
                        ControlLoopEvents.INITIALIZED,
                        clientProvidedLoopId,
                        agentId,
                        channelId,
                        'initialized',
                        { config: fullConfig }
                    );
                    
                    // Auto-start the control loop for fully automated operation
                    return controlLoop.start();
                })
                .then(() => {
                    
                    // Emit started event to notify clients
                    this.emitControlLoopEvent(
                        ControlLoopEvents.STARTED,
                        clientProvidedLoopId,
                        agentId,
                        channelId,
                        'running',
                        { autoStarted: true }
                    );
                })
                .catch((error: Error) => {
                    logger.error(`[CRITICAL] Failed to initialize control loop for agent ${agentId}: ${error}`);
                    
                    // Emit error event
                    this.emitControlLoopEvent(
                        ControlLoopEvents.ERROR,
                        clientProvidedLoopId,
                        agentId,
                        channelId,
                        'error',
                        { error: String(error) }
                    );
                });
            
        } catch (error) {
            logger.error(`Error in initializeControlLoop: ${error}`);
        }
    }
    
    /**
     * Get loop ID for an agent
     * @param agentId Agent ID
     * @returns Loop ID or undefined
     */
    public getLoopIdForAgent(agentId: AgentId): string | undefined {
        for (const [loopId, config] of controlLoopConfigs.entries()) {
            if (config.agentId === agentId) {
                return loopId;
            }
        }
        return undefined;
    }

    /**
     * Helper method to track processed events by type and prevent duplicate processing
     * @param eventType Type of event being processed
     * @param eventKey Unique identifier for the event
     * @returns boolean True if this is the first time we've seen this event
     */
    private isFirstEventOfType(eventType: string, eventKey: string): boolean {
        // Initialize set for this event type if it doesn't exist
        if (!processedEvents[eventType]) {
            processedEvents[eventType] = new Set<string>();
        }
        
        // If we've already seen this event, skip it
        if (processedEvents[eventType].has(eventKey)) {
            return false;
        }
        
        // First time seeing this event, add it to the set
        processedEvents[eventType].add(eventKey);
        return true;
    }

    /**
     * Handle control loop start
     * @param agentId Agent ID
     * @param channelId Channel ID from event
     */
    private handleControlLoopStart(agentId: AgentId, channelId: string): void {
        try {
            
            // Get the control loop for this agent
            const controlLoop = controlLoopsByAgent.get(agentId);
            if (!controlLoop) {
                logger.error(`No control loop found for agent ${agentId}`);
                return;
            }
            
            const loopId = controlLoop.getLoopId();
            
            // Start the control loop
            controlLoop.start()
                .then(() => {
                    // Emit the success event
                    this.emitControlLoopEvent(
                        ControlLoopEvents.STARTED,
                        loopId,
                        agentId,
                        channelId,
                        'started'
                    );
                })
                .catch((error: any) => {
                    logger.error(`Failed to start control loop for agent ${agentId}: ${error}`);
                    
                    // Emit the error event
                    this.emitControlLoopEvent(
                        ControlLoopEvents.ERROR,
                        loopId,
                        agentId,
                        channelId,
                        'error',
                        { error: String(error) }
                    );
                });
        } catch (error) {
            logger.error(`Error in handleControlLoopStart: ${error}`);
        }
    }

    /**
     * Handle control loop stop
     * @param agentId Agent ID
     * @param channelId Channel ID from event
     */
    private handleControlLoopStop(agentId: AgentId, channelId: string): void {
        try {
            
            // Get the control loop for this agent
            const controlLoop = controlLoopsByAgent.get(agentId);
            if (!controlLoop) {
                logger.error(`No control loop found for agent ${agentId}`);
                return;
            }
            
            const loopId = controlLoop.getLoopId();
            
            // Stop the control loop
            controlLoop.stop()
                .then(() => {
                    // Emit the success event
                    this.emitControlLoopEvent(
                        ControlLoopEvents.STOPPED,
                        loopId,
                        agentId,
                        channelId,
                        'stopped'
                    );
                })
                .catch((error: any) => {
                    logger.error(`Failed to stop control loop for agent ${agentId}: ${error}`);
                    
                    // Emit the error event
                    this.emitControlLoopEvent(
                        ControlLoopEvents.ERROR,
                        loopId,
                        agentId,
                        channelId,
                        'error',
                        { error: String(error) }
                    );
                });
        } catch (error) {
            logger.error(`Error in handleControlLoopStop: ${error}`);
        }
    }

    /**
     * Handle control loop observation submission
     * @param agentId Agent ID
     * @param channelId Channel ID from event
     * @param loopId Control loop ID
     * @param observation Observation data
     */
    private handleControlLoopObserve(agentId: AgentId, channelId: string, loopId: string, observation: any): void {
        try {
            
            // Get the control loop for this agent
            const controlLoop = controlLoopsByAgent.get(agentId);
            if (!controlLoop) {
                throw new Error(`No control loop found for agent ${agentId}`);
            }
            
            if (!loopId) {
                throw new Error(`Missing required loopId for agent ${agentId}`);
            }
            
            // NOTE: This method is called when processing observation events from EventBus
            // We should NOT emit new observation events here as that would create recursion
            // Client submissions emit events via socket handlers → EventBus, not directly here
            
            // Phase 2: Track action sequence for pattern analysis
            const agentSequence = this.actionSequences.get(agentId) || [];
            agentSequence.push('observation');
            this.actionSequences.set(agentId, agentSequence.slice(-10));
            
            // Add observation to control loop
            // The control loop will emit reasoning and plan events as needed
            controlLoop.addObservation(observation)
                .then(() => {
                })
                .catch((error: Error) => {
                    // Emit error event for observation processing failure
                    this.emitControlLoopEvent(
                        ControlLoopEvents.ERROR,
                        loopId,
                        agentId,
                        channelId,
                        'error',
                        { error: String(error) }
                    );
                });
            
        } catch (error) {
            logger.error(`Error in handleControlLoopObserve: ${error}`);
        }
    }

    /**
     * Handle server-side processing for control loop observation
     * @param loopId Control loop ID
     * @param agentId Agent ID
     * @param channelId Channel ID
     * @param observation Observation data
     */
    private handleControlLoopObservation(loopId: string, agentId: AgentId, channelId: string, observation: any): void {
        try {
            // Validate inputs
            validator.assertIsString(loopId);
            validator.assertIsString(agentId);
            validator.assertIsString(channelId);
            validator.assertIsObject(observation);
            
            // Get the control loop instance
            const controlLoop = this.getControlLoopById(loopId);
            
            if (!controlLoop) {
                logger.error(`[CRITICAL] No control loop found with ID ${loopId}`);
                return;
            }
            
            // Emit the observation event first
            this.emitControlLoopEvent(
                ControlLoopEvents.OBSERVATION,
                loopId,
                agentId,
                channelId,
                'observing',
                { observation }
            );
            
            // Add the observation to the control loop
            controlLoop.addObservation(observation)
                .catch(error => {
                    logger.error(`Error adding observation to control loop ${loopId}: ${error}`);
                    
                    // Emit error event
                    this.emitControlLoopEvent(
                        ControlLoopEvents.ERROR,
                        loopId,
                        agentId,
                        channelId,
                        'error',
                        { error: String(error), context: 'observation_handling' }
                    );
                });
            
        } catch (error) {
            logger.error(`Error in handleControlLoopObservation: ${error}`);
            
            // Emit error event
            this.emitControlLoopEvent(
                ControlLoopEvents.ERROR,
                loopId,
                agentId,
                channelId,
                'error',
                { error: String(error), context: 'observation_handling' }
            );
        }
    }

    /**
     * Handle control loop execution
     * @param agentId Agent ID
     * @param channelId Channel ID from event
     * @param loopId Control loop ID
     * @param data Execution data
     */
    private handleControlLoopExecution(agentId: AgentId, channelId: string, loopId: string, data: any): void {
        try {
            // Validate inputs with fail-fast
            validator.assertIsNonEmptyString(agentId);
            
            // Custom validation for action ID
            if (!data.id || typeof data.id !== 'string' || data.id.trim() === '') {
                throw new Error('Action must have a non-empty ID');
            }
            
            validator.assertIsObject(data);
            
            // Get the loop ID for this agent
            // const loopId = this.getLoopIdForAgent(agentId);
            // if (!loopId) {
            //     const error = new Error(`No control loop found for agent ${agentId}`);
            //     throw error; // Fail fast
            // }
            
            // Use a composite key to track if we've already processed this action
            const actionKey = `${loopId}_${data.id}`;
            
            // Skip if we've already processed this action
            if (!this.isFirstEventOfType('action', actionKey)) {
                return;
            }
            
            // ;
            
            // First emit an action 'started' event before execution
            this.emitControlLoopEvent(
                ControlLoopEvents.ACTION,
                loopId,
                agentId,
                channelId,
                'started',
                { 
                    action: {
                        ...data,
                        status: 'started'
                    }
                }
            );
            
            // Get the control loop instance
            const controlLoop = controlLoopsByAgent.get(agentId);
            if (!controlLoop) {
                const error = new Error(`Control loop not found for agent ${agentId}`);
                logger.error(`[CRITICAL] ${error.message}`);
                
                // Emit action 'failed' event
                this.emitControlLoopEvent(
                    ControlLoopEvents.ACTION,
                    loopId,
                    agentId,
                    channelId,
                    'failed',
                    { 
                        action: {
                            ...data,
                            status: 'failed',
                            result: {
                                success: false,
                                message: `Control loop not found for agent ${agentId}`
                            }
                        }
                    }
                );
                throw error; // Fail fast
            }
            
            // Execute action in the control loop
            controlLoop.executeAction(data)
                .then(() => {
                    // Phase 2: Track action in sequence and analyze patterns
                    const agentSequence = this.actionSequences.get(agentId) || [];
                    agentSequence.push(`action:${data.type || 'execute'}`);
                    this.actionSequences.set(agentId, agentSequence.slice(-10));
                    
                    // Analyze patterns if we have enough actions
                    if (agentSequence.length >= 3) {
                        this.patternMemoryService.analyzeSequenceForPatterns(
                            channelId,
                            agentId,
                            agentSequence,
                            { loopId, actionData: data }
                        ).then(analysis => {
                            if (analysis.patternDetected && analysis.confidence > 0.7) {
                                this.patternMemoryService.storePattern(
                                    channelId,
                                    agentId,
                                    {
                                        channelId,
                                        type: analysis.patternType || 'orpar_sequence',
                                        pattern: {
                                            sequence: agentSequence.slice(),
                                            conditions: { loopId, actionType: data.type },
                                            outcomes: { success: true },
                                            toolsUsed: analysis.metadata.toolsInvolved || [],
                                            executionTime: Date.now(),
                                            complexity: analysis.metadata.complexity
                                        },
                                        effectiveness: analysis.metadata.estimatedEffectiveness,
                                        agentParticipants: [agentId],
                                        similarPatterns: [],
                                        tags: ['orpar', 'action_sequence'],
                                        metadata: {
                                            channelContext: `Control loop ${loopId} in channel ${channelId}`,
                                            systemState: { loopId, actionData: data },
                                            performanceMetrics: {
                                                averageExecutionTime: 0,
                                                minExecutionTime: 0,
                                                maxExecutionTime: 0,
                                                standardDeviation: 0
                                            },
                                            confidence: analysis.confidence
                                        }
                                    }
                                ).catch((error: Error) => {
                                    logger.warn(`Pattern storage failed: ${error}`);
                                });
                            }
                        }).catch((error: Error) => {
                            logger.warn(`Pattern analysis failed: ${error}`);
                        });
                    }
                    
                    // Emit action 'completed' event
                    this.emitControlLoopEvent(
                        ControlLoopEvents.ACTION,
                        loopId,
                        agentId,
                        channelId,
                        'completed',
                        { 
                            action: {
                                ...data,
                                status: 'completed',
                                result: {
                                    success: true,
                                    message: 'Action executed successfully'
                                }
                            }
                        }
                    );
                })
                .catch((error) => {
                    logger.error(`[CRITICAL] Error executing action: ${error}`);
                    
                    // Emit action 'failed' event
                    this.emitControlLoopEvent(
                        ControlLoopEvents.ACTION,
                        loopId,
                        agentId,
                        channelId,
                        'failed',
                        { 
                            action: {
                                ...data,
                                status: 'failed',
                                result: {
                                    success: false,
                                    message: String(error)
                                }
                            }
                        }
                    );
                });
            
            
        } catch (error) {
            logger.error(`[CRITICAL] Error in handleControlLoopExecution: ${error}`);
            
            // We don't rethrow here since we've already handled the error by emitting an action 'failed' event
        }
    }

    /**
     * Handle control loop reasoning
     * @param loopId Control loop ID
     * @param agentId Agent ID
     * @param channelId Channel ID
     * @param reasoning Reasoning data
     */
    private handleControlLoopReasoning(loopId: string, agentId: AgentId, channelId: string, reasoning: Reasoning): void {
        try {
            // Validate inputs with fail-fast
            validator.assertIsNonEmptyString(loopId);
            validator.assertIsNonEmptyString(agentId);
            validator.assertIsNonEmptyString(channelId);
            validator.assertIsObject(reasoning);
            if (!reasoning.id || typeof reasoning.id !== 'string' || reasoning.id.trim() === '') {
                throw new Error('Reasoning must have a non-empty ID');
            }

            // Create a composite key using loopId and reasoning.id to ensure unique processing
            const reasoningKey = `${loopId}_${reasoning.id}`;
            
            // Skip if we've already processed this reasoning
            if (!this.isFirstEventOfType('reasoning', reasoningKey)) {
                return;
            }

            // Use the provided channel ID directly - this is critical as it comes from a properly
            // configured control loop
            const emitChannelId = channelId;
            
            // Emit reasoning event to the server EventBus
            // ;
            
            this.emitControlLoopEvent(
                ControlLoopEvents.REASONING,
                loopId,
                agentId,
                emitChannelId,
                'reasoning',
                { reasoning }
            );
            
            
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error(`Failed to handle reasoning for agent ${agentId}: ${errorMessage}`);
            throw error;
        }
    }

    /**
     * Handle control loop plan
     * @param loopId Control loop ID
     * @param agentId Agent ID
     * @param channelId Channel ID
     * @param plan Plan data
     */
    private handleControlLoopPlan(loopId: string, agentId: AgentId, channelId: string, plan: Plan): void {
        try {
            // Validate inputs with fail-fast
            validator.assertIsNonEmptyString(loopId);
            validator.assertIsNonEmptyString(agentId);
            validator.assertIsNonEmptyString(channelId);
            validator.assertIsObject(plan);
            if (!plan.id || typeof plan.id !== 'string' || plan.id.trim() === '') {
                throw new Error('Plan must have a non-empty ID');
            }

            // Create a composite key using loopId and plan.id to ensure unique processing
            const planKey = `${loopId}_${plan.id}`;
            
            // Skip if we've already processed this plan
            if (!this.isFirstEventOfType('plan', planKey)) {
                return;
            }

            // Use the provided channel ID directly - this is critical as it comes from a properly
            // configured control loop
            const emitChannelId = channelId;
            
            // Emit plan event to the server EventBus
            
            this.emitControlLoopEvent(
                ControlLoopEvents.PLAN,
                loopId,
                agentId,
                emitChannelId,
                'planning',
                { plan }
            );
            
            
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error(`Failed to handle plan for agent ${agentId}: ${errorMessage}`);
            throw error;
        }
    }
    
    /**
     * Emits a control loop event
     * @param eventType The type of event to emit
     * @param loopId The ID of the control loop
     * @param agentId The ID of the agent
     * @param channelId The ID of the channel
     * @param status The status of the control loop
     * @param additionalData Additional data to include in the event
     */
    private emitControlLoopEvent(
        eventType: string,
        loopId: string,
        agentId: string,
        channelId: string,
        status: string, // This status is for ControlLoopSpecificData
        additionalData: Record<string, any> = {}
    ): void {
        try {
            // Fail-fast with strict validation
            validator.assertIsNonEmptyString(eventType);
            validator.assertIsNonEmptyString(agentId);
            validator.assertIsNonEmptyString(channelId);
            validator.assertIsNonEmptyString(loopId);
            validator.assertIsNonEmptyString(status);

            
            // For reasoning and plan events, we should not re-emit them as that causes duplicate processing
            // These events are typically just notifications that should be sent to clients, not re-processed by the service
            if (eventType === ControlLoopEvents.REASONING || eventType === ControlLoopEvents.PLAN) {
                return;
            }
            
            // Check if this is a recursion protection event to prevent infinite loops
            // This check was originally on payload.metadata.source or payload.metadata.isRecursionProtection
            // The 'options' to createControlLoopEventPayload (6th arg) had isRecursionProtection: true.
            // If additionalData (from the caller of emitControlLoopEvent) contains this, we honor it.
            if (additionalData?.metadata?.isRecursionProtection === true && additionalData?.metadata?.source === 'server') {
                return;
            }
            
            // Construct ControlLoopSpecificData
            // The original 5th argument to createControlLoopEventPayload was an object:
            // { timestamp: Date.now(), status, ...additionalData }
            // This became the 'controlLoopData' (after being merged with the 4th arg 'status' which was incorrect)
            const controlLoopDataInstance: ControlLoopSpecificData = {
                ...additionalData, // Spread additionalData first
                loopId: loopId,    // Then set loopId (will override if additionalData.loopId exists)
                status: status,    // Then set status (will override if additionalData.status exists)
                // Add metadata for server-generated events (source, recursion protection)
                // This replicates what the 6th 'options' arg to createControlLoopEventPayload was doing.
                metadata: {
                    ...(additionalData.metadata || {}), // Preserve existing metadata from additionalData
                    source: 'server',
                    isRecursionProtection: true
                }
            };

            // Create a properly formatted control loop event payload
            // const payload = createControlLoopEventPayload(
            //     loopId, // Incorrect: This was eventType
            //     agentId,
            //     channelId,
            //     status, // Incorrect: This was controlLoopData.status, not the whole object
            //     { // Incorrect: This was merged into controlLoopData
            //         timestamp: Date.now(),
            //         status,
            //         ...additionalData
            //     },
            //     { // Incorrect: These were options for createBaseEventPayload 
            //         timestamp: Date.now(),
            //         source: 'server',
            //         isRecursionProtection: true 
            //     }
            // );

            const payload: ControlLoopEventPayload = {
                eventId: additionalData?.metadata?.eventId || uuidv4(), // Use eventId from additionalData.metadata if provided by caller, else new
                eventType: eventType, // Correct: Use eventType from method signature
                timestamp: Date.now(), // Fresh timestamp for the event itself
                agentId: agentId,
                channelId: channelId,
                data: controlLoopDataInstance
            };
            
            // Additional fail-fast validation of payload
            validator.assertIsObject(payload);
            // validator.assertIsNonEmptyString(payload.channelId); // Already validated channelId parameter
            // validator.assertIsNonEmptyString(payload.data.loopId); // loopId is in data, already validated loopId parameter
            validator.assertIsObject(payload.data);
            
            EventBus.server.emit(eventType, payload);
        } catch (error) {
            logger.error(`Error emitting control loop event: ${error}`);
            throw error; // Fail-fast by throwing the error instead of suppressing it
        }
    }
    
    /**
     * Public method to initialize or reinitialize the service
     * This ensures event handlers are registered
     */
    public initialize(): void {
        // Log that we're manually initializing
        
        // Set up event handlers even if already initialized
        this.setupEventHandlers();
        
        this.initialized = true;
    }
    
    /**
     * Get control loop by ID
     * @param loopId Control loop ID
     * @returns Control loop instance or undefined
     */
    private getControlLoopById(loopId: string): ControlLoop | undefined {
        // Iterate through the control loops by agent to find the one with the matching loop ID
        for (const [agentId, controlLoop] of controlLoopsByAgent) {
            if (controlLoop.getLoopId() === loopId) {
                return controlLoop;
            }
        }
        
        // If no control loop is found, return undefined
        return undefined;
    }

    /**
     * Handle system LLM reasoning requests
     * @param agentId Agent ID
     * @param channelId Channel ID  
     * @param loopId Control loop ID
     * @param data Event data containing prompt
     */
    private async handleSystemLlmReasoning(agentId: string, channelId: string, loopId: string, data: any): Promise<void> {
        
        let promptData: any;
        
        try {
            // Validate input data
            validator.assertIsObject(data);
            
            promptData = data.data || data;
            validator.assertIsNonEmptyString(promptData.prompt, 'prompt');
            
            
            // Get SystemLlmService for this channel
            const systemLlmService = SystemLlmServiceManager.getInstance().getServiceForChannel(channelId);
            if (!systemLlmService) {
                throw new Error(`SystemLLM not available for channel ${channelId}`);
            }
            
            // Process the reasoning prompt 
            const reasoningResponse = await lastValueFrom(systemLlmService.generateReasoningAnalysis(
                promptData.prompt, // context
                [], // observations (empty for now)
                [], // previousActions (empty for now)
                {
                    temperature: 0.7,
                    maxTokens: 1000
                }
            ));
            
            
            // Validate reasoning response
            if (!reasoningResponse) {
                throw new Error(`Reasoning response is null or undefined for loop ${loopId}`);
            }
            
            // Log reasoning response structure for debugging
            
            // Extract operationId from the original request if available
            const operationId = data.operationId || promptData.operationId;
            
            // Ensure we have a valid analysis content
            const analysisContent = reasoningResponse.analysis || reasoningResponse.reasoning || 'Analysis completed successfully';
            
            if (!analysisContent || analysisContent.trim() === '') {
                logger.warn(`Empty analysis content for loop ${loopId}, using fallback`);
            }
            
            // Log response source information for LLM validation
            const responseSource = (reasoningResponse as any)._responseSource || '[NO_SOURCE_TAG]';
            const isRealLlm = responseSource === 'llm';
            const isPartialLlm = responseSource === 'llm-partial';
            const isFallback = responseSource === 'fallback';
            
            if (isRealLlm) {
            } else if (isPartialLlm) {
                logger.warn(`⚠️ PARTIAL LLM: Got LLM response but with fallback fields for loop ${loopId}`);
            } else if (isFallback) {
                logger.error(`❌ FALLBACK USED: No real LLM response, using fallback for loop ${loopId}. Reason: ${(reasoningResponse as any)._fallbackReason || '[NO_FALLBACK_REASON]'}`);
            } else {
                logger.warn(`❓ UNKNOWN SOURCE: Response source unclear for loop ${loopId}. Source: ${responseSource}`);
            }
            
            // Additional logging for debugging fallbacks
            if ((reasoningResponse as any)._instructionId) {
            }
            if ((reasoningResponse as any)._originalError) {
            }
            
            // Emit completion event with structured reasoning response
            this.emitControlLoopEvent(
                ControlLoopEvents.SYSTEM_LLM_REASONING_COMPLETED,
                loopId,
                agentId,
                channelId,
                'completed',
                {
                    operationId: operationId, // Include operationId for proper response matching
                    content: analysisContent, // Extract analysis content from structured result with fallbacks
                    originalPrompt: promptData.prompt,
                    structuredResult: reasoningResponse // Include full structured result for advanced processing
                }
            );
            
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error(`Error processing system LLM reasoning for loop ${loopId}: ${errorMessage}`);
            
            // Emit failure event
            this.emitControlLoopEvent(
                ControlLoopEvents.SYSTEM_LLM_REASONING_FAILED,
                loopId,
                agentId,
                channelId,
                'failed',
                {
                    error: errorMessage,
                    originalPrompt: promptData?.prompt || 'Unknown prompt'
                }
            );
        }
    }

    /**
     * Cache performance metrics for intelligent pattern storage
     * Uses AgentPerformanceService which tracks automatically via events
     */
    private async cachePerformanceMetrics(
        channelId: ChannelId,
        agentId: AgentId,
        metrics: any
    ): Promise<void> {
        try {
            // AgentPerformanceService tracks metrics automatically via EventBus
            // No explicit recording needed - metrics are captured from ORPAR events
        } catch (error) {
            logger.error(`[Phase 2.5] Failed to track performance metrics: ${error}`);
        }
    }

    /**
     * Real-time pattern analysis coordination
     * This method provides intelligent pattern coordination within channel context
     */
    private async coordinateAgentsRealTime(
        channelId: ChannelId,
        coordinationData: any
    ): Promise<void> {
        try {
            // Use PatternMemoryService for pattern analysis
            const patternMemoryService = PatternMemoryService.getInstance();
            // storePattern requires (channelId, agentId, patternData)
            // Using 'system' as agentId for coordination patterns
            await patternMemoryService.storePattern(channelId, 'system' as AgentId, {
                channelId,
                type: 'collaboration_flow' as const,
                pattern: {
                    sequence: ['coordination'],
                    conditions: coordinationData,
                    outcomes: { status: 'pending' },
                    toolsUsed: [],
                    executionTime: 0,
                    complexity: 1
                },
                effectiveness: 0.5,
                agentParticipants: ['system'],
                similarPatterns: [],
                tags: ['coordination', 'system'],
                metadata: {
                    channelContext: 'coordination',
                    systemState: coordinationData || {},
                    performanceMetrics: {
                        averageExecutionTime: 0,
                        minExecutionTime: 0,
                        maxExecutionTime: 0,
                        standardDeviation: 0
                    },
                    confidence: 0.5
                }
            });

        } catch (error) {
            logger.error(`[Phase 2.5] Failed to coordinate agents in real-time: ${error}`);
        }
    }
}
