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
 * ControlLoop.ts
 * 
 * Server-side implementation of the Control Loop cognitive cycle.
 * This follows the Observation-Reasoning-Planning-Action-Reflection (ORPAR) pattern
 * for intelligent agent behavior.
 */

import { v4 as uuidv4 } from 'uuid';
import { Observable, BehaviorSubject, of, throwError, timer, Subscription } from 'rxjs';
import { catchError, map, mergeMap, retry, tap, delay } from 'rxjs/operators';

// Import shared models
import { 
    ControlLoopStateEnum,
    Observation,
    Reasoning,
    ControlLoopConfig,
    ErrorRecoveryConfig,
    IControlLoop,
    Plan,
    PlanAction,
    ActionStatus,
    Reflection
} from '../../../shared/models/controlLoop';
import { AgentId } from '../../../shared/types/Agent';

// Import event utilities
import { EventBus } from '../../../shared/events/EventBus';
import { Events } from '../../../shared/events/EventNames';
import { ControlLoopEvents, ControlLoopPayloads } from '../../../shared/events/event-definitions/ControlLoopEvents';
import { 
    createControlLoopEventPayload,
    createTopicsExtractEventPayload,
    createSummaryGenerateEventPayload,
    TopicsExtractEventData,
    SummaryGenerateEventData
} from '../../../shared/schemas/EventPayloadSchema';
import { createStrictValidator } from '../../../shared/utils/validation';
import { Logger } from '../../../shared/utils/Logger';
import { ControlLoopSpecificData } from '../../../shared/schemas/EventPayloadSchema';
import { SystemLlmService } from '../services/SystemLlmService';
import { SystemLlmServiceManager } from '../services/SystemLlmServiceManager';
import { lastValueFrom } from 'rxjs';
import { OrparMemoryCoordinator } from '../../../shared/services/orpar-memory/OrparMemoryCoordinator';
import { isOrparMemoryIntegrationEnabled } from '../../../shared/config/orpar-memory.config';

// Create validators and loggers
const validator = createStrictValidator('ControlLoop');
const logger = new Logger('info', 'ControlLoop', 'server');

// Track control loop operations by ID to prevent log flooding
const logCounts: Record<string, Record<string, number>> = {};
const MAX_LOG_ENTRIES = 3; // Only log the first 3 identical operations for each loop

/**
 * Server-side implementation of the Control Loop.
 * Provides the cognitive cycle for agents to process information and make decisions.
 */
export class ControlLoop implements IControlLoop {
    // State management
    private state = new BehaviorSubject<ControlLoopStateEnum>(ControlLoopStateEnum.IDLE);
    
    // Observations queue
    private observations: Observation[] = [];
    
    // Error tracking
    private consecutiveErrors = 0;
    private lastError?: Error;
    private degradedMode = false;

    // Configuration
    private config: ControlLoopConfig | null = null;
    private errorRecoveryConfig: ErrorRecoveryConfig = {
        maxConsecutiveErrors: 3,
        enableAutoHealing: true,
        maxRetries: 3,
        retryDelay: 1000
    };

    // Subscriptions for event handling
    private subscriptions: Subscription = new Subscription();

    // Loop identifier
    private loopId: string;

    // Callbacks for reasoning and plan notifications
    private reasoningCallbacks: ((reasoning: Reasoning) => void)[] = [];
    private planCallbacks: ((plan: Plan) => void)[] = [];

    // Cycle control to prevent excessive iterations
    private cycleInProgress = false;
    private cycleScheduled = false;
    private lastCycleTime = 0;
    // Make minCycleInterval configurable: fast for testing (10ms), normal for production (100ms)
    private readonly minCycleInterval = process.env.NODE_ENV === 'test' ? 10 : 100;

    private lastReasoning?: Reasoning;

    // Track previous actions for ORPAR reasoning phase (populated from completed plan actions)
    private previousActionsHistory: string[] = [];
    private readonly maxPreviousActions = 20; // Keep last 20 actions for context

    // Track previous plans for ORPAR planning phase
    private previousPlansHistory: Plan[] = [];
    private readonly maxPreviousPlans = 5; // Keep last 5 plans for context

    // ORPAR-Memory integration cycle tracking
    private orparMemoryCycleId: string | null = null;

    /**
     * Create a new control loop
     * @param agentId Agent ID that owns this control loop
     * @param initialLoopId Optional - use a specific loopId instead of generating a new one
     */
    constructor(private readonly agentId: AgentId, initialLoopId?: string) {
        // Validate constructor parameter
        validator.assertIsNonEmptyString(agentId);
        
        // Use provided loopId or generate a unique ID for this control loop
        this.loopId = initialLoopId || uuidv4();
        
    }
    
    /**
     * Initialize the control loop
     * @param config Control loop configuration
     */
    public initialize(config: ControlLoopConfig): Promise<boolean> {
        return new Promise((resolve, reject) => {
            try {
                this.logWithSuppression('initialize', `Initializing control loop ${this.loopId} for agent ${this.agentId}`);
                
                // Validate config
                this.logWithSuppression('initialize-debug', `[DEBUG] Validating configuration for control loop ${this.loopId}`, 'debug');
                validator.assertIsObject(config);
                validator.assertIsNonEmptyString(config.agentId);
                
                // Update loopId if provided in config - this allows client to specify the loopId
                if (config.loopId) {
                    this.logWithSuppression('initialize-debug', `[DEBUG] Using client-provided loopId ${config.loopId} instead of ${this.loopId}`, 'debug');
                    this.loopId = config.loopId;
                }
                
                // Update state
                this.logWithSuppression('initialize-debug', `[DEBUG] Updating state to INITIALIZING for control loop ${this.loopId}`, 'debug');
                this.updateState(ControlLoopStateEnum.INITIALIZING);
                
                // Store configuration
                this.logWithSuppression('initialize-debug', `[DEBUG] Storing configuration for control loop ${this.loopId}`, 'debug');
                this.config = {
                    ...config,
                    loopId: this.loopId,
                    createdAt: Date.now()
                };
                
                // Apply error recovery config if provided
                if (config.errorRecovery) {
                    this.logWithSuppression('initialize-debug', `[DEBUG] Applying error recovery configuration for control loop ${this.loopId}`, 'debug');
                    this.errorRecoveryConfig = {
                        ...this.errorRecoveryConfig,
                        ...config.errorRecovery
                    };
                }
                
                // Set up event subscriptions
                this.logWithSuppression('initialize-debug', `[DEBUG] Setting up event subscriptions for control loop ${this.loopId}`, 'debug');
                this.setupEventSubscriptions();
                
                // Update state
                this.logWithSuppression('initialize-debug', `[DEBUG] Updating state to READY for control loop ${this.loopId}`, 'debug');
                this.updateState(ControlLoopStateEnum.READY);
                
                // Emit initialized event
                const initializedData: ControlLoopSpecificData = {
                    loopId: this.loopId,
                    status: 'ready' as const
                };
                const initializedPayload = createControlLoopEventPayload(
                    ControlLoopEvents.INITIALIZED,
                    this.agentId,
                    this.getChannelId(),
                    initializedData,
                    { source: 'controlLoop' }
                );
                EventBus.server.emit(ControlLoopEvents.INITIALIZED, initializedPayload);
                
                this.logWithSuppression('initialize', `Control loop ${this.loopId} initialized for agent ${this.agentId}`);
                
                resolve(true);
            } catch (error) {
                logger.error(`Error initializing control loop: ${error}`);
                reject(error);
            }
        });
    }
    
    /**
     * Start the control loop
     */
    public start(): Promise<boolean> {
        return new Promise(async (resolve, reject) => {
            if (this.state.value === ControlLoopStateEnum.RUNNING) {
                this.logWithSuppression('start-warn', `Control loop ${this.loopId} is already running.`, 'warn');
                resolve(false); // Indicate that it was already running
                return;
            }

            if (this.state.value !== ControlLoopStateEnum.READY && 
                this.state.value !== ControlLoopStateEnum.STOPPED) {
                const errMsg = `Control loop ${this.loopId} cannot start from state ${this.state.value}. Must be READY or STOPPED.`;
                logger.error(errMsg);
                this.lastError = new Error(errMsg);
                // No state update to ERROR here, as it's a pre-condition failure, not an operational error during start.
                reject(new Error(errMsg));
                return;
            }

            this.logWithSuppression('start', `Starting control loop ${this.loopId} for agent ${this.agentId}`);

            try {
                // Reset error tracking as we are attempting a fresh start
                this.resetErrorTracking();

                this.updateState(ControlLoopStateEnum.RUNNING);

                // Note: runControlLoopCycle() is automatically triggered by state subscription
                // No need to call it here to avoid duplicate cycles

                this.logWithSuppression('start-success', `Control loop ${this.loopId} started successfully.`);

                // Emit started event
                const startedData: ControlLoopSpecificData = {
                    loopId: this.loopId,
                    status: 'running'
                };
                const startedPayload = createControlLoopEventPayload(
                    ControlLoopEvents.STARTED,
                    this.agentId,
                    this.getChannelId(),
                    startedData,
                    { source: 'controlLoop' }
                );
                EventBus.server.emit(ControlLoopEvents.STARTED, startedPayload);

                resolve(true);
            } catch (error: any) {
                logger.error(`Error starting control loop ${this.loopId}: ${error.message}`);
                this.lastError = error;
                this.updateState(ControlLoopStateEnum.ERROR);

                // Emit error event
                const errorData: ControlLoopSpecificData = {
                    loopId: this.loopId,
                    status: 'error',
                    error: error.message,
                    context: { 
                        operation: 'start' 
                    }
                };
                const errorPayload = createControlLoopEventPayload(
                    ControlLoopEvents.ERROR,
                    this.agentId,
                    this.getChannelId(),
                    errorData,
                    { source: 'controlLoop' }
                );
                EventBus.server.emit(ControlLoopEvents.ERROR, errorPayload);
                
                reject(error);
            }
        });
    }
    
    /**
     * Stop the control loop
     */
    public stop(reason?: string): Promise<boolean> {
        return new Promise((resolve, reject) => {
            this.logWithSuppression('stop', `Stopping control loop ${this.loopId} for agent ${this.agentId}. Reason: ${reason || 'N/A'}`);

            // Corrected: Only allow stopping if in RUNNING state.
            if (this.state.value !== ControlLoopStateEnum.RUNNING) { 
                this.logWithSuppression('stop-warn', `Control loop ${this.loopId} is not running, current state: ${this.state.value}. Cannot stop.`, 'warn');
                resolve(false); // Indicate it wasn't running or couldn't be stopped
                return;
            }

            try {
                // Unsubscribe from all event bus subscriptions to prevent further processing
                this.subscriptions.unsubscribe();
                this.subscriptions = new Subscription(); // Reinitialize for potential restart

                // Fix #4: Clear ORPAR-Memory cycle ID on stop
                if (this.orparMemoryCycleId) {
                    this.logWithSuppression('cleanup-orpar', `Clearing ORPAR-Memory cycle ${this.orparMemoryCycleId}`);
                    this.orparMemoryCycleId = null;
                }

                this.updateState(ControlLoopStateEnum.STOPPED);
                this.logWithSuppression('stop-success', `Control loop ${this.loopId} stopped successfully.`);

                // Emit stopped event
                const stoppedData: ControlLoopSpecificData = {
                    loopId: this.loopId,
                    reason: reason,
                    context: { operation: 'stop' }
                };
                const stoppedPayload = createControlLoopEventPayload(
                    ControlLoopEvents.STOPPED,
                    this.agentId,
                    this.getChannelId(),
                    stoppedData,
                    { source: 'controlLoop' }
                );
                EventBus.server.emit(ControlLoopEvents.STOPPED, stoppedPayload);
                
                resolve(true);
            } catch (error: any) {
                logger.error(`Error stopping control loop ${this.loopId}: ${error.message}`);
                this.lastError = error;
                // Even if stopping fails, try to set state to ERROR if not already STOPPED
                // @ts-ignore
                if (this.state.value !== ControlLoopStateEnum.STOPPED) {
                    this.updateState(ControlLoopStateEnum.ERROR);
                }

                // Emit error event
                const errorData: ControlLoopSpecificData = {
                    loopId: this.loopId,
                    status: 'error',
                    error: error.message,
                    context: { 
                        operation: 'stop',
                        reason
                    }
                };
                const errorPayload = createControlLoopEventPayload(
                    ControlLoopEvents.ERROR,
                    this.agentId,
                    this.getChannelId(),
                    errorData,
                    { source: 'controlLoop' }
                );
                EventBus.server.emit(ControlLoopEvents.ERROR, errorPayload);

                reject(error);
            }
        });
    }
    
    /**
     * Reset the control loop
     */
    public async reset(newConfig?: ControlLoopConfig): Promise<boolean> {
        this.logWithSuppression('reset', `Resetting control loop ${this.loopId}. New config ${newConfig ? 'provided' : 'not provided'}.`);
        try {
            // Stop the loop if it's running.
            if (this.state.value === ControlLoopStateEnum.RUNNING) {
                this.logWithSuppression('reset-stop', `Stopping loop ${this.loopId} before reset.`);
                await this.stop('Resetting loop');
            }

            // Clear essential operational data that should not persist across a reset.
            this.observations = []; // Observations are context for a specific run.
            this.lastError = undefined;  // Reset last error state.
            this.resetErrorTracking(); // Resets consecutiveErrors and errorHandlingState

            // Fix #4: Clear ORPAR-Memory cycle ID on reset
            if (this.orparMemoryCycleId) {
                this.logWithSuppression('cleanup-orpar', `Clearing ORPAR-Memory cycle ${this.orparMemoryCycleId}`);
                this.orparMemoryCycleId = null;
            }

            // Re-initialize the loop.
            // If newConfig is provided, use it. Otherwise, re-use existing config.
            const configToUse = newConfig || this.config;
            if (!configToUse) {
                // This should ideally not happen if the loop was previously initialized.
                const errMsg = `Cannot reset control loop ${this.loopId} without a valid configuration. Loop may not have been initialized.`;
                logger.error(errMsg);
                throw new Error(errMsg);
            }
            
            // The initialize method will set state to INITIALIZED and emit INITIALIZED event (or ERROR).
            await this.initialize(configToUse);

            this.logWithSuppression('reset-success', `Control loop ${this.loopId} reset successfully and is now ${this.state.value}.`);
            return true;

        } catch (error: any) {
            const errMsg = error.message || 'Unknown error during reset.';
            logger.error(`Error resetting control loop ${this.loopId}: ${errMsg}`);
            this.lastError = error instanceof Error ? error : new Error(errMsg);
            this.updateState(ControlLoopStateEnum.ERROR); // Ensure state reflects error after reset attempt fails

            const errorData: ControlLoopSpecificData = {
                loopId: this.loopId,
                status: 'error',
                error: errMsg,
                context: { operation: 'reset', newConfigProvided: !!newConfig }
            };
            const errorPayload = createControlLoopEventPayload(
                ControlLoopEvents.ERROR,
                this.agentId,
                this.getChannelId(),
                errorData,
                { source: 'controlLoop' }
            );
            EventBus.server.emit(ControlLoopEvents.ERROR, errorPayload);
            
            return false; // Indicate reset failure
        }
    }
    
    /**
     * Get the current state of the control loop
     */
    public getCurrentState(): Promise<ControlLoopStateEnum> {
        return Promise.resolve(this.state.value);
    }
    
    /**
     * Get the loop ID
     * @returns The unique ID of this control loop
     */
    public getLoopId(): string {
        return this.loopId;
    }
    
    /**
     * Get the channel ID from the configuration
     * @returns The channel ID
     */
    public getChannelId(): string {
        // Ensure we have a config
        if (!this.config || !this.config.channelId) {
            logger.error(`No channel ID configured for control loop ${this.loopId}`);
            throw new Error(`No channel ID configured for control loop ${this.loopId}`);
        }
        return this.config.channelId;
    }
    
    /**
     * Update the state of the control loop and emit an event if the state changes.
     * @param newState The new state of the control loop.
     */
    private updateState(newState: ControlLoopStateEnum): void {
        if (this.state.value === newState) {
            // No change, do nothing
            return;
        }

        const oldState = this.state.value;
        this.state.next(newState);
        this.logWithSuppression('updateState', `Control loop ${this.loopId} state changed from ${oldState} to ${newState}`);

        // Emit state changed event
        // NOTE: ControlLoopPayloads does not have an explicit 'controlLoop:stateChanged' or similar event.
        // This custom event payload structure needs to be considered for standardization if this event is widely used or public.
        // For now, using a structure that includes old and new state.
        // Let's check if there's a generic event or if we should define one in ControlLoopEvents.
        // Looking at ControlLoopEvents, there isn't one. This event might be internal or for specific listeners.
        // Given its absence in ControlLoopEvents, I will *not* emit an event here for now,
        // as per the goal of adhering to defined event schemas.
        // If a state change event is required, it should be formally defined in ControlLoopEvents.ts and ControlLoopPayloads.
        /* 
        const stateChangedPayload = {
            loopId: this.loopId,
            timestamp: Date.now(),
            oldState: oldState,
            newState: newState,
            agentId: this.agentId, // Often useful context
            channelId: this.getChannelId() // Also useful context
        };
        EventBus.server.emit('controlLoop:stateChanged', stateChangedPayload); // Custom event name
        */
    }
    
    /**
     * Add an observation to the control loop
     * @param observation Observation to add
     */
    public addObservation(observation: any): Promise<boolean> { // Assuming observation: Observation type from shared models
        const obsTimestamp = Date.now(); // Timestamp for when this method was called / event emitted
        this.logWithSuppression('addObservation', `Adding observation to control loop ${this.loopId}`);
        
        return new Promise((resolve, reject) => {
            try {
                // Basic validation for the observation object itself
                if (!observation) {
                    throw new Error('Observation cannot be null or undefined.');
                }
                // Further validation would depend on the actual 'Observation' type structure
                // For example, if 'observation' is expected to have a 'content' field:
                // if (!observation.content) {
                //     throw new Error('Observation content cannot be empty.');
                // }

                // Add to observations queue. Assuming this.observations is Observation[]
                // And the 'observation' parameter is of type Observation which includes its own timestamp.
                this.observations.push(observation);
                this.logWithSuppression('addObservation-debug', `[DEBUG] Observation added to queue for ${this.loopId}. Queue size: ${this.observations.length}`, 'debug');

                // NOTE: We do NOT emit observation events here to prevent recursive loops
                // Observation events should only be emitted when clients first submit observations
                // This method is called during event processing, so emitting here would cause recursion

                // If the loop is running, trigger a cycle to process the new observation.
                if (this.state.value === ControlLoopStateEnum.RUNNING) {
                    this.logWithSuppression('addObservation-trigger', `Loop ${this.loopId} is RUNNING, scheduling cycle for new observation.`);
                    // Use debounced cycle scheduling to prevent excessive iterations
                    this.scheduleCycleIfNeeded();
                }
                
                resolve(true);
            } catch (error: any) {
                logger.error(`Error adding observation to control loop ${this.loopId}: ${error.message}`);
                this.lastError = error;

                const errorData: ControlLoopSpecificData = {
                    loopId: this.loopId,
                    status: 'error',
                    error: error.message,
                    context: {
                        operation: 'addObservation',
                        // Avoid sending potentially very large observation data in error context if not strictly needed
                        // observationId: observation?.id // If observation has an ID
                    }
                };
                const errorPayload = createControlLoopEventPayload(
                    ControlLoopEvents.ERROR,
                    this.agentId,
                    this.getChannelId(),
                    errorData,
                    { source: 'controlLoop' }
                );
                EventBus.server.emit(ControlLoopEvents.ERROR, errorPayload);
                
                reject(error); 
            }
        });
    }
    
    /**
     * Execute an action
     * @param action Action to execute
     */
    public executeAction(action: any): Promise<any> {
        this.logWithSuppression('executeAction', `Executing action for control loop ${this.loopId}`);
        
        // This is a placeholder implementation. 
        // Actual implementation would involve invoking a tool or service.
        return new Promise((resolve, reject) => {
            try {
                // Emit action started event
                const actionStartedData: ControlLoopSpecificData = {
                    loopId: this.loopId,
                    action: action,
                    context: { operation: 'executeAction' }
                };
                const actionStartedPayload = createControlLoopEventPayload(
                    ControlLoopEvents.ACTION,
                    this.agentId,
                    this.getChannelId(),
                    actionStartedData,
                    { source: 'controlLoop' }
                );
                EventBus.server.emit(ControlLoopEvents.ACTION, actionStartedPayload);

                // Simulate action execution
                const actionTimestamp = Date.now();
                const result = { success: true, message: 'Action executed placeholder' };
                this.logWithSuppression('executeAction-debug', `[DEBUG] Simulated action execution for ${this.loopId}. Action: ${JSON.stringify(action)}, Result: ${JSON.stringify(result)}`, 'debug');

                // Emit action completed event
                const actionCompletedData: ControlLoopSpecificData = {
                    loopId: this.loopId,
                    action: action,
                    result: result,
                    context: { operation: 'executeAction' }
                };
                const actionCompletedPayload = createControlLoopEventPayload(
                    ControlLoopEvents.ACTION,
                    this.agentId,
                    this.getChannelId(),
                    actionCompletedData,
                    { source: 'controlLoop' }
                );
                EventBus.server.emit(ControlLoopEvents.ACTION, actionCompletedPayload);

                resolve(result);
            } catch (error: any) {
                logger.error(`Error executing action for control loop ${this.loopId}: ${error.message}`);
                this.lastError = error;
                // Not necessarily setting loop state to ERROR here, depends on action's criticality and recovery.
                // The ORPAR cycle might handle this based on reflection.

                // Emit error event
                const errorData: ControlLoopSpecificData = {
                    loopId: this.loopId,
                    status: 'error',
                    error: error.message,
                    context: { 
                        operation: 'executeAction',
                        action: action // Include the action that failed
                    }
                };
                const errorPayload = createControlLoopEventPayload(
                    ControlLoopEvents.ERROR,
                    this.agentId,
                    this.getChannelId(),
                    errorData,
                    { source: 'controlLoop' }
                );
                EventBus.server.emit(ControlLoopEvents.ERROR, errorPayload);
                
                reject(error);
            }
        });
    }
    
    /**
     * Attempt to recover from an error state
     * @param error Error that triggered recovery
     */
    public recover(error: any): Promise<boolean> {
        return new Promise((resolve, reject) => {
            try {
                
                // Check if auto-healing is enabled
                if (!this.errorRecoveryConfig.enableAutoHealing) {
                    logger.error(`Auto-healing is disabled for control loop ${this.loopId}`);
                    reject(new Error('Auto-healing is disabled'));
                    return;
                }
                
                // If consecutive errors exceeds threshold, reject recovery
                if (this.consecutiveErrors >= (this.errorRecoveryConfig.maxConsecutiveErrors || 3)) {
                    logger.error(`Too many consecutive errors (${this.consecutiveErrors}) for control loop ${this.loopId}`);
                    reject(new Error(`Too many consecutive errors: ${this.consecutiveErrors}`));
                    return;
                }
                
                // Reset error tracking
                this.resetErrorTracking();
                
                // Update state
                this.updateState(ControlLoopStateEnum.READY);
                
                // Restart if needed
                if (this.config?.autoStart) {
                    this.start()
                        .then(() => resolve(true))
                        .catch(reject);
                } else {
                    resolve(true);
                }
            } catch (error) {
                logger.error(`Error recovering control loop: ${error}`);
                reject(error);
            }
        });
    }
    
    /**
     * Set up event subscriptions
     */
    private setupEventSubscriptions(): void {
        // Clean up existing subscriptions
        this.subscriptions.unsubscribe();
        this.subscriptions = new Subscription();
        
        // Subscribe to state changes
        const stateSubscription = this.state.subscribe(newState => {
            
            // Handle state transitions
            if (newState === ControlLoopStateEnum.RUNNING) {
                // Start processing cycle when entering RUNNING state (debounced)
                this.scheduleCycleIfNeeded();
            }
        });
        
        // Add to subscriptions
        this.subscriptions.add(stateSubscription);
    }
    
    /**
     * Run the control loop cycle
     */
    private runControlLoopCycle(): void {
        // Prevent overlapping cycles
        if (this.cycleInProgress) {
            return;
        }

        // Enforce minimum interval between cycles
        const now = Date.now();
        if (now - this.lastCycleTime < this.minCycleInterval) {
            setTimeout(() => this.runControlLoopCycle(), this.minCycleInterval - (now - this.lastCycleTime));
            return;
        }

        this.lastCycleTime = now;
        this.cycleInProgress = true;


        // If not in running state, do nothing - add more debug info
        if (this.state.value !== ControlLoopStateEnum.RUNNING) {
            this.cycleInProgress = false;
            return;
        }

        // If no observations, do nothing
        if (this.observations.length === 0) {
            this.cycleInProgress = false;

            // Schedule next cycle if continuous processing is enabled
            if (this.config?.processingInterval && this.config.processingInterval > 0) {
                setTimeout(() => this.runControlLoopCycle(), Math.max(this.config.processingInterval, this.minCycleInterval));
            }

            return;
        }

        // Start ORPAR-Memory cycle if integration is enabled and channel is configured
        if (isOrparMemoryIntegrationEnabled() && this.config?.channelId) {
            try {
                const coordinator = OrparMemoryCoordinator.getInstance();
                this.orparMemoryCycleId = coordinator.startCycle(
                    this.agentId,
                    this.config.channelId
                );
            } catch (error) {
                logger.warn(`Failed to start ORPAR-Memory cycle: ${error instanceof Error ? error.message : String(error)}`);
            }
        }

        const observationCount = this.observations.length;
        
        // Process next batch of observations
        const maxObservations = this.config?.maxObservationsToProcess || 10;
        const batch = this.observations.splice(0, maxObservations);
        
        // Only log once at this level - the detailed processing happens in processObservations
        this.processObservations(batch)
            .then(reasoning => {
                // Generate a plan from the reasoning
                return this.createPlan(reasoning);
            })
            .then(plan => {
                // Execute the plan
                return this.executePlan(plan);
            })
            .then(executionResult => {
                // Reflect on the execution
                return this.reflect(executionResult.plan);
            })
            .then(() => {
                this.cycleInProgress = false;
                
                // Schedule next cycle if there are more observations or continuous processing is enabled
                const shouldContinue = this.observations.length > 0 || 
                                       (this.config?.processingInterval && this.config.processingInterval > 0);
                
                if (shouldContinue && this.state.value === ControlLoopStateEnum.RUNNING) {
                    const delay = this.observations.length > 0 ? 
                                this.minCycleInterval : 
                                Math.max(this.config?.processingInterval || 1000, this.minCycleInterval);
                    setTimeout(() => this.runControlLoopCycle(), delay);
                }
            })
            .catch(error => {
                this.cycleInProgress = false;
                logger.error(`Error in control loop cycle: ${error}`);
                this.trackError(error);
                
                // Update state if too many errors
                if (this.consecutiveErrors >= (this.errorRecoveryConfig.maxConsecutiveErrors || 3)) {
                    this.updateState(ControlLoopStateEnum.ERROR);
                }
            });
    }
    
    /**
     * Process observations and generate reasoning
     * @param observations Observations to process
     * @returns Promise resolving to reasoning object
     */
    private async processObservations(currentObservations: Observation[]): Promise<Reasoning | null> {
        this.logWithSuppression('processObservations', `Processing ${currentObservations.length} observations for control loop ${this.loopId}`);
        const processingTimestamp = Date.now();

        if (currentObservations.length === 0) {
            this.logWithSuppression('processObservations-skip', 'No observations to process.');
            return null;
        }

        try {
            let reasoning;
            
            // Check if SystemLLM capabilities are available and enabled
            const llmCapabilityAvailable = process.env.SYSTEMLLM_ENABLED !== 'false' && (
                !!process.env.OPENROUTER_API_KEY || 
                !!process.env.AZURE_OPENAI_API_KEY || 
                !!process.env.OPENAI_API_KEY || 
                !!process.env.ANTHROPIC_API_KEY
            );
            
            if (llmCapabilityAvailable && this.getChannelId()) {
                try {
                    const systemLlmService = SystemLlmServiceManager.getInstance().getServiceForChannel(this.getChannelId());
                    if (!systemLlmService) {
                        logger.warn('SystemLLM not available, using fallback observation processing');
                        throw new Error('SystemLLM disabled');
                    }
                    
                    // Step 1: Process observations with fast observation model
                    const processedObservations = await lastValueFrom(
                        systemLlmService.processObservationData(currentObservations)
                    );
                    
                    // Step 2: Generate reasoning with advanced thinking model
                    const context = `Control loop ${this.loopId} in channel ${this.getChannelId()}`;
                    const observations = currentObservations.map(obs => obs.content || JSON.stringify(obs));
                    // Use tracked action history from previous cycles for context
                    const previousActions = [...this.previousActionsHistory];
                    
                    // Use SystemLlmService for structured reasoning with fail-fast validation
                    const reasoningResult = await lastValueFrom(
                        systemLlmService.generateReasoningAnalysis(context, observations, previousActions)
                    );
                    
                    // Create reasoning object from structured result
                    reasoning = {
                        id: uuidv4(),
                        agentId: this.agentId,
                        observations: currentObservations.map(obs => obs.id),
                        content: {
                            summary: reasoningResult.analysis,
                            details: reasoningResult.reasoning,
                            goals: reasoningResult.suggestedActions || [],
                            insights: [], // Extract from reasoning text if needed
                            confidence: reasoningResult.confidence,
                            llmCapabilityAvailable: true,
                            enhanced: true,
                            fallbackMode: false,
                            modelUsed: {
                                observation: systemLlmService.getModelForOperation('observation'),
                                reasoning: systemLlmService.getModelForOperation('reasoning')
                            }
                        },
                        timestamp: Date.now()
                    };
                    
                    // Automatically request channel context analysis during reasoning phase
                    const channelId = this.getChannelId();
                    if (channelId) {
                        // Request topic extraction
                        const topicsExtractData: TopicsExtractEventData = {
                            channelId: channelId,
                            timestamp: Date.now(),
                            operationId: uuidv4(),
                            minRelevance: 0.3
                        };
                        
                        const topicsExtractPayload = createTopicsExtractEventPayload(
                            Events.Channel.CONTEXT.TOPICS_EXTRACT,
                            this.agentId,
                            channelId,
                            topicsExtractData,
                            { source: 'controlLoop' }
                        );
                        
                        EventBus.server.emit(Events.Channel.CONTEXT.TOPICS_EXTRACT, topicsExtractPayload);

                        // Request summary generation
                        const summaryGenerateData: SummaryGenerateEventData = {
                            channelId: channelId,
                            timestamp: Date.now(),
                            operationId: uuidv4(),
                            messageCount: 50
                        };
                        
                        const summaryGeneratePayload = createSummaryGenerateEventPayload(
                            Events.Channel.CONTEXT.SUMMARY_GENERATE,
                            this.agentId,
                            channelId,
                            summaryGenerateData,
                            { source: 'controlLoop' }
                        );
                        
                        EventBus.server.emit(Events.Channel.CONTEXT.SUMMARY_GENERATE, summaryGeneratePayload);
                    }
                } catch (llmError) {
                    logger.warn(`SystemLlmService failed, using fallback: ${llmError instanceof Error ? llmError.message : String(llmError)}`);
                    reasoning = this.createFallbackReasoning(currentObservations, true);
                }
            } else {
                // Fallback to basic reasoning when no LLM capability or channel
                reasoning = this.createFallbackReasoning(currentObservations, false);
            }
            
            this.logWithSuppression('processObservations-debug', `[DEBUG] Reasoning generated for ${this.loopId}: ${JSON.stringify(reasoning)}`, 'debug');
            
            const reasoningData: ControlLoopSpecificData = {
                loopId: this.loopId,
                status: 'reasoning',
                reasoning: reasoning,
                context: { 
                    source: 'controlLoop',
                    operation: 'processObservations'
                }
            };

            const reasoningPayload = createControlLoopEventPayload(
                ControlLoopEvents.REASONING,
                this.agentId,
                this.getChannelId(),
                reasoningData,
                { source: 'controlLoop' }
            );

            EventBus.server.emit(ControlLoopEvents.REASONING, reasoningPayload);

            // Store the reasoning for future reference
            this.lastReasoning = reasoning;

            // Log the reasoning

            return reasoning;
        } catch (error) {
            const errorData: ControlLoopSpecificData = {
                loopId: this.loopId,
                status: 'error',
                error: error instanceof Error ? error.message : String(error),
                context: {
                    operation: 'processObservations',
                    observationCount: currentObservations.length
                }
            };

            const errorPayload = createControlLoopEventPayload(
                ControlLoopEvents.ERROR,
                this.agentId,
                this.getChannelId(),
                errorData,
                { source: 'controlLoop' }
            );

            EventBus.server.emit(ControlLoopEvents.ERROR, errorPayload);
            logger.error(`Control loop ${this.loopId} error in processObservations: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    }
    
    /**
     * Create a fallback reasoning object
     * @param observations Observations to process
     * @param llmCapabilityAvailable Whether LLM capability is available
     * @returns Fallback reasoning object
     */
    private createFallbackReasoning(observations: Observation[], llmCapabilityAvailable: boolean): Reasoning {
        const fallbackReasoning: Reasoning = {
            id: uuidv4(),
            agentId: this.agentId,
            observations: observations.map(obs => obs.id),
            content: {
                summary: 'Fallback reasoning due to LLM capability unavailability.',
                details: 'No detailed analysis available.',
                goals: [],
                insights: [],
                confidence: 0,
                llmCapabilityAvailable: llmCapabilityAvailable,
                enhanced: false,
                fallbackMode: true,
                modelUsed: {
                    observation: null,
                    reasoning: null
                }
            },
            timestamp: Date.now()
        };
        return fallbackReasoning;
    }
    
    /**
     * Create a plan based on reasoning
     * @param reasoning Reasoning object
     * @returns Promise resolving to plan object
     */
    private async createPlan(reasoning: Reasoning | null): Promise<Plan> { 
        this.logWithSuppression('createPlan', `Creating plan for control loop ${this.loopId}`);
        const planTimestamp = Date.now();

        if (!reasoning) {
            this.logWithSuppression('createPlan-error', 'No reasoning provided, cannot create plan.');
            const err = new Error('Cannot create plan without reasoning.');
            const errorData: ControlLoopSpecificData = {
                loopId: this.loopId,
                status: 'error',
                error: err.message,
                context: { operation: 'createPlan', reason: 'No reasoning provided' }
            };
            const errorPayload = createControlLoopEventPayload(
                ControlLoopEvents.ERROR,
                this.agentId,
                this.getChannelId(),
                errorData,
                { source: 'controlLoop' }
            );
            EventBus.server.emit(ControlLoopEvents.ERROR, errorPayload);
            throw err;
        }

        try {
            let plan: Plan;
            
            // Check if SystemLLM capabilities are available and enabled
            const llmCapabilityAvailable = process.env.SYSTEMLLM_ENABLED !== 'false' && (
                !!process.env.OPENROUTER_API_KEY || 
                !!process.env.AZURE_OPENAI_API_KEY || 
                !!process.env.OPENAI_API_KEY || 
                !!process.env.ANTHROPIC_API_KEY
            );
            
            if (llmCapabilityAvailable) {
                try {
                    const systemLlmService = SystemLlmServiceManager.getInstance().getServiceForChannel(this.getChannelId());
                    if (!systemLlmService) {
                        logger.warn('SystemLLM not available, using fallback planning');
                        throw new Error('SystemLLM disabled');
                    }
                    
                    // Use SystemLlmService for strategic planning with advanced planning model
                    
                    // Create or get ORPAR context for this cycle
                    const orparContext = systemLlmService.createOrUpdateContext(
                        this.loopId,
                        this.agentId,
                        this.getChannelId(),
                        'planning',
                        reasoning
                    );
                    // Use tracked plan history from previous cycles for context
                    const previousPlans = [...this.previousPlansHistory];

                    plan = await lastValueFrom(
                        systemLlmService.createPlan(reasoning, orparContext, previousPlans)
                    );

                    // Store plan in history for future cycles (keep max 5)
                    this.previousPlansHistory.push(plan);
                    if (this.previousPlansHistory.length > this.maxPreviousPlans) {
                        this.previousPlansHistory.shift();
                    }
                    
                    // Enhance plan with metadata
                    plan.metadata = {
                        ...plan.metadata,
                        modelUsed: systemLlmService.getModelForOperation('planning'),
                        llmGenerated: true,
                        controlLoopId: this.loopId
                    };
                    
                } catch (llmError) {
                    logger.warn(`SystemLlmService planning failed, using fallback: ${llmError instanceof Error ? llmError.message : String(llmError)}`);
                    
                    // Fallback plan creation
                    plan = {
                        id: uuidv4(),
                        agentId: this.agentId,
                        reasoningId: reasoning.id,
                        goal: `Plan based on reasoning: ${reasoning.id}`,
                        description: 'Fallback plan created due to LLM service unavailability',
                        createdAt: new Date(),
                        actions: [
                            {
                                id: uuidv4(),
                                action: 'simulatedAction1',
                                parameters: { detail: 'Based on reasoning' },
                                status: 'pending',
                                description: 'First simulated action based on reasoning.',
                                priority: 1
                            },
                            {
                                id: uuidv4(),
                                action: 'simulatedAction2',
                                parameters: {},
                                status: 'pending',
                                description: 'Second simulated action.',
                                priority: 2
                            }
                        ],
                        timestamp: planTimestamp,
                        status: 'created',
                        metadata: { 
                            llmGenerated: false,
                            fallbackMode: true,
                            controlLoopId: this.loopId
                        }
                    };
                }
            } else {
                // Fallback plan when no LLM capability
                plan = {
                    id: uuidv4(),
                    agentId: this.agentId,
                    reasoningId: reasoning.id,
                    goal: `Plan based on reasoning: ${reasoning.id}`,
                    description: 'Basic plan created without LLM capability',
                    createdAt: new Date(),
                    actions: [
                        {
                            id: uuidv4(),
                            action: 'simulatedAction1',
                            parameters: { detail: 'Based on reasoning' },
                            status: 'pending',
                            description: 'First simulated action based on reasoning.',
                            priority: 1
                        },
                        {
                            id: uuidv4(),
                            action: 'simulatedAction2',
                            parameters: {},
                            status: 'pending',
                            description: 'Second simulated action.',
                            priority: 2
                        }
                    ],
                    timestamp: planTimestamp,
                    status: 'created',
                    metadata: { 
                        llmGenerated: false,
                        fallbackMode: true,
                        controlLoopId: this.loopId,
                        priority: undefined,
                        estimatedDuration: undefined,
                        resources: undefined,
                        successMetrics: undefined,
                        risks: undefined
                    }
                };
            }
            
            this.logWithSuppression('createPlan-debug', `[DEBUG] Plan created for ${this.loopId}: ${JSON.stringify(plan)}`, 'debug');

            const planData: ControlLoopSpecificData = {
                loopId: this.loopId,
                status: 'plan',
                plan: plan,
                context: { operation: 'createPlan' }
            };
            const planPayload = createControlLoopEventPayload(
                ControlLoopEvents.PLAN,
                this.agentId,
                this.getChannelId(),
                planData,
                { source: 'controlLoop' }
            );
            EventBus.server.emit(ControlLoopEvents.PLAN, planPayload);
            
            return plan;
        } catch (error: any) {
            logger.error(`Error creating plan for control loop ${this.loopId}: ${error.message}`);
            this.lastError = error;

            const errorData: ControlLoopSpecificData = {
                loopId: this.loopId,
                status: 'error',
                error: error.message,
                context: { operation: 'createPlan' }
            };
            const errorPayload = createControlLoopEventPayload(
                ControlLoopEvents.ERROR,
                this.agentId,
                this.getChannelId(),
                errorData,
                { source: 'controlLoop' }
            );
            EventBus.server.emit(ControlLoopEvents.ERROR, errorPayload);

            throw error;
        }
    }
    
    /**
     * Execute a plan
     * @param plan Plan to execute
     */
    private async executePlan(plan: Plan | null): Promise<{ executionId: string, plan: Plan }> {
        this.logWithSuppression('executePlan', `Executing plan for control loop ${this.loopId}`);
        const executionTimestamp = Date.now();

        if (!plan) {
            this.logWithSuppression('executePlan-error', 'No plan provided, cannot execute.');
            const err = new Error('Cannot execute null plan.');
            const errorData: ControlLoopSpecificData = {
                loopId: this.loopId,
                status: 'error',
                error: err.message,
                context: { operation: 'executePlan', reason: 'Null plan provided' }
            };
            const errorPayload = createControlLoopEventPayload(
                ControlLoopEvents.ERROR,
                this.agentId,
                this.getChannelId(),
                errorData,
                { source: 'controlLoop' }
            );
            EventBus.server.emit(ControlLoopEvents.ERROR, errorPayload);
            throw err;
        }

        const executionId = uuidv4();

        try {
            // Check if SystemLLM capabilities are available and enabled
            const llmCapabilityAvailable = process.env.SYSTEMLLM_ENABLED !== 'false' && (
                !!process.env.OPENROUTER_API_KEY || 
                !!process.env.AZURE_OPENAI_API_KEY || 
                !!process.env.OPENAI_API_KEY || 
                !!process.env.ANTHROPIC_API_KEY
            );
            
            if (llmCapabilityAvailable) {
                const systemLlmService = SystemLlmServiceManager.getInstance().getServiceForChannel(this.getChannelId());
                if (systemLlmService) {
                    // Process each action with LLM analysis
                    for (const action of plan.actions) {
                    try {
                        
                        // Simulate action execution (placeholder)
                        const executionResult = {
                            actionId: action.id,
                            success: true,
                            result: `Simulated execution of ${action.action}`,
                            timestamp: Date.now()
                        };
                        
                        // Use SystemLlmService to analyze action execution
                        const analysisResult = await lastValueFrom(
                            systemLlmService.analyzeActionExecution(action, executionResult)
                        );
                        
                        // Update action status based on analysis
                        action.status = analysisResult.success ? 'completed' : 'failed';
                        action.metadata = {
                            ...action.metadata,
                            analysisResult,
                            modelUsed: systemLlmService.getModelForOperation('action'),
                            llmAnalyzed: true
                        };
                        
                    } catch (actionError) {
                        logger.warn(`Action analysis failed for ${action.id}: ${actionError instanceof Error ? actionError.message : String(actionError)}`);
                        action.status = 'failed';
                        action.metadata = {
                            ...action.metadata,
                            error: actionError instanceof Error ? actionError.message : String(actionError),
                            llmAnalyzed: false
                        };
                    }
                }
                }
            } else {
                // Fallback execution without LLM analysis
                for (const action of plan.actions) {
                    // Simulate action execution
                    action.status = 'completed';
                    action.metadata = {
                        ...action.metadata,
                        simulatedExecution: true,
                        llmAnalyzed: false
                    };
                }
            }

            // Update plan status
            plan.status = 'completed';
            plan.metadata = {
                ...plan.metadata,
                executionId,
                executionTimestamp,
                allActionsCompleted: plan.actions.every(a => a.status === 'completed')
            };

            this.logWithSuppression('executePlan-debug', `[DEBUG] Plan executed for ${this.loopId}: ${JSON.stringify(plan)}`, 'debug');

            const executionData: ControlLoopSpecificData = {
                loopId: this.loopId,
                status: 'execution',
                plan: plan,
                executionId: executionId,
                context: { operation: 'executePlan' }
            };
            const executionPayload = createControlLoopEventPayload(
                ControlLoopEvents.EXECUTION,
                this.agentId,
                this.getChannelId(),
                executionData,
                { source: 'controlLoop' }
            );
            EventBus.server.emit(ControlLoopEvents.EXECUTION, executionPayload);

            return { executionId, plan };
        } catch (error: any) {
            logger.error(`Error executing plan for control loop ${this.loopId}: ${error.message}`);
            this.lastError = error;

            const errorData: ControlLoopSpecificData = {
                loopId: this.loopId,
                status: 'error',
                error: error.message,
                context: { operation: 'executePlan', planId: plan.id, executionId }
            };
            const errorPayload = createControlLoopEventPayload(
                ControlLoopEvents.ERROR,
                this.agentId,
                this.getChannelId(),
                errorData,
                { source: 'controlLoop' }
            );
            EventBus.server.emit(ControlLoopEvents.ERROR, errorPayload);

            throw error;
        }
    }
    
    /**
     * Reflect on the executed plan
     * @param plan Executed plan
     */
    private async reflect(plan: Plan | null): Promise<Reflection> {
        this.logWithSuppression('reflect', `Reflecting on plan for control loop ${this.loopId}`);
        const reflectionTimestamp = Date.now();

        if (!plan) {
            this.logWithSuppression('reflect-error', 'No plan provided, cannot reflect.');
            const err = new Error('Cannot reflect on null plan.');
            const errorData: ControlLoopSpecificData = {
                loopId: this.loopId,
                status: 'error',
                error: err.message,
                context: { operation: 'reflect', reason: 'No plan provided' }
            };
            const errorPayload = createControlLoopEventPayload(
                ControlLoopEvents.ERROR,
                this.agentId,
                this.getChannelId(),
                errorData,
                { source: 'controlLoop' }
            );
            EventBus.server.emit(ControlLoopEvents.ERROR, errorPayload);
            throw err;
        }

        try {
            let reflection: Reflection;
            
            // Check if SystemLLM capabilities are available and enabled
            const llmCapabilityAvailable = process.env.SYSTEMLLM_ENABLED !== 'false' && (
                !!process.env.OPENROUTER_API_KEY || 
                !!process.env.AZURE_OPENAI_API_KEY || 
                !!process.env.OPENAI_API_KEY || 
                !!process.env.ANTHROPIC_API_KEY
            );
            
            if (llmCapabilityAvailable) {
                try {
                    const systemLlmService = SystemLlmServiceManager.getInstance().getServiceForChannel(this.getChannelId());
                    if (!systemLlmService) {
                        logger.warn('SystemLLM not available, using fallback reflection');
                        throw new Error('SystemLLM disabled');
                    }
                    
                    // Use SystemLlmService for comprehensive reflection with meta-cognitive model
                    
                    const executedActions = plan.actions || [];
                    const results = executedActions.map(action => ({
                        actionId: action.id,
                        status: action.status,
                        metadata: action.metadata
                    }));

                    // Store executed actions in history for future reasoning phases
                    for (const action of executedActions) {
                        const actionDesc = `${action.action}: ${action.description || 'No description'} (status: ${action.status})`;
                        this.previousActionsHistory.push(actionDesc);
                    }
                    // Trim to max size
                    while (this.previousActionsHistory.length > this.maxPreviousActions) {
                        this.previousActionsHistory.shift();
                    }

                    reflection = await lastValueFrom(
                        systemLlmService.generateReflection(plan, executedActions, results)
                    );
                    
                    // Enhance reflection with metadata
                    reflection.metadata = {
                        ...reflection.metadata,
                        modelUsed: systemLlmService.getModelForOperation('reflection'),
                        llmGenerated: true,
                        controlLoopId: this.loopId,
                        planId: plan.id
                    };
                    
                } catch (llmError) {
                    logger.warn(`SystemLlmService reflection failed, using fallback: ${llmError instanceof Error ? llmError.message : String(llmError)}`);
                    
                    // Fallback reflection
                    reflection = {
                        id: uuidv4(),
                        agentId: this.agentId,
                        planId: plan.id,
                        success: false,
                        insights: ['Basic execution completed', 'No detailed insights available'],
                        improvements: ['Enable LLM capabilities for deeper reflection'],
                        timestamp: reflectionTimestamp,
                        metadata: { 
                            llmGenerated: false,
                            fallbackMode: true,
                            controlLoopId: this.loopId
                        }
                    };
                }
            } else {
                // Fallback reflection when no LLM capability
                reflection = {
                    id: uuidv4(),
                    agentId: this.agentId,
                    planId: plan.id,
                    success: plan.metadata?.allActionsCompleted || false,
                    insights: ['Plan executed successfully', 'All actions processed'],
                    improvements: ['Consider enabling LLM capabilities for enhanced reflection'],
                    timestamp: reflectionTimestamp,
                    metadata: { 
                        llmGenerated: false,
                        fallbackMode: true,
                        controlLoopId: this.loopId
                    }
                };
            }

            this.logWithSuppression('reflect-debug', `[DEBUG] Reflection generated for ${this.loopId}: ${JSON.stringify(reflection)}`, 'debug');

            const reflectionData: ControlLoopSpecificData = {
                loopId: this.loopId,
                status: 'reflection',
                reflection: reflection,
                context: { operation: 'reflect' }
            };
            const reflectionPayload = createControlLoopEventPayload(
                ControlLoopEvents.REFLECTION,
                this.agentId,
                this.getChannelId(),
                reflectionData,
                { source: 'controlLoop' }
            );
            EventBus.server.emit(ControlLoopEvents.REFLECTION, reflectionPayload);

            // Complete ORPAR-Memory cycle with outcome
            if (isOrparMemoryIntegrationEnabled() && this.orparMemoryCycleId) {
                try {
                    const coordinator = OrparMemoryCoordinator.getInstance();
                    await coordinator.completeCycle(this.orparMemoryCycleId, {
                        success: reflection.success ?? true,
                        errorCount: 0,
                        toolCallCount: plan?.actions?.length ?? 0,
                        taskCompleted: reflection.success ?? true,
                        qualityScore: reflection.success ? 1.0 : 0.0,
                        metadata: {
                            feedback: reflection.insights?.join('; ')
                        }
                    });
                } catch (error) {
                    logger.warn(`Failed to complete ORPAR-Memory cycle: ${error instanceof Error ? error.message : String(error)}`);
                } finally {
                    this.orparMemoryCycleId = null;
                }
            }

            return reflection;
        } catch (error: any) {
            logger.error(`Error reflecting on plan for control loop ${this.loopId}: ${error.message}`);
            this.lastError = error;

            const errorData: ControlLoopSpecificData = {
                loopId: this.loopId,
                status: 'error',
                error: error.message,
                context: { operation: 'reflect', planId: plan.id }
            };
            const errorPayload = createControlLoopEventPayload(
                ControlLoopEvents.ERROR,
                this.agentId,
                this.getChannelId(),
                errorData,
                { source: 'controlLoop' }
            );
            EventBus.server.emit(ControlLoopEvents.ERROR, errorPayload);

            throw error;
        }
    }
    
    /**
     * Reset error tracking
     */
    private resetErrorTracking(): void {
        this.consecutiveErrors = 0;
        this.lastError = undefined;
        this.degradedMode = false;
    }
    
    /**
     * Track error and update consecutive error count
     * @param error Error to track
     */
    private trackError(error: any): void {
        this.consecutiveErrors++;
        this.lastError = error instanceof Error ? error : new Error(String(error));
        
        // Enter degraded mode if error threshold exceeded
        if (this.consecutiveErrors >= (this.errorRecoveryConfig.maxConsecutiveErrors || 3)) {
            this.degradedMode = true;
            
            // We no longer emit the error event here
            // Control loop service will handle this to ensure single source of truth for events
        }
    }
    
    /**
     * Register a callback to be executed when new reasoning is created
     * @param callback Function to be called with the reasoning object
     * @returns Function to unsubscribe the callback
     */
    public onReasoning(callback: (reasoning: Reasoning) => void): () => void {
        this.reasoningCallbacks.push(callback);
        
        // Return a function to unsubscribe
        return () => {
            this.reasoningCallbacks = this.reasoningCallbacks.filter(cb => cb !== callback);
        };
    }
    
    /**
     * Register a callback to be executed when a new plan is created
     * @param callback Function to be called with the plan object
     * @returns Function to unsubscribe the callback
     */
    public onPlan(callback: (plan: Plan) => void): () => void {
        this.planCallbacks.push(callback);
        
        // Return a function to unsubscribe
        return () => {
            this.planCallbacks = this.planCallbacks.filter(cb => cb !== callback);
        };
    }
    
    /**
     * Notify all registered callbacks about a new reasoning
     * @param reasoning Reasoning object to notify about
     */
    private notifyReasoningCallbacks(reasoning: Reasoning): void {
        
        if (this.reasoningCallbacks.length === 0) {
            logger.warn(`[CRITICAL] No reasoning callbacks registered for control loop ${this.loopId}`);
            return;
        }

        for (const callback of this.reasoningCallbacks) {
            try {
                callback(reasoning);
            } catch (error) {
                logger.error(`[CRITICAL] Error in reasoning callback for loop ${this.loopId}: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
    }
    
    /**
     * Notify all registered callbacks about a new plan
     * @param plan Plan object to notify about
     */
    private notifyPlanCallbacks(plan: Plan): void {
        for (const callback of this.planCallbacks) {
            try {
                callback(plan);
            } catch (error) {
                logger.error(`Error in plan callback: ${error}`);
            }
        }
    }
    
    /**
     * Utility method to log while preventing excessive duplicate logs
     * @param loopId Control loop ID
     * @param operation Operation name (e.g., 'stop', 'start')
     * @param message Message to log
     * @param level Log level ('info', 'debug', 'warn', 'error')
     */
    private logWithSuppression(operation: string, message: string, level: 'info' | 'debug' | 'warn' | 'error' = 'info'): void {
        // Initialize counters if not exists
        if (!logCounts[this.loopId]) {
            logCounts[this.loopId] = {};
        }
        
        // Initialize counter for this operation
        if (!logCounts[this.loopId][operation]) {
            logCounts[this.loopId][operation] = 0;
        }
        
        // Increment counter
        logCounts[this.loopId][operation]++;
        
        // Only log if we haven't hit the max
        if (logCounts[this.loopId][operation] <= MAX_LOG_ENTRIES) {
            logger[level](message);
        } else if (logCounts[this.loopId][operation] === MAX_LOG_ENTRIES + 1) {
            // Log once that we're suppressing
        }
    }
    
    /**
     * Emit an event through the event bus
     * @param eventType Event type
     * @param data Event data
     * @deprecated Use direct EventBus.server.emit with standard payloads.
     */
    private emitEvent(eventType: string, data: any): void {
        logger.warn(`ControlLoop.emitEvent method is deprecated. Use EventBus.server.emit with standard payloads directly.`);
        try {
            const channelId = this.getChannelId(); // Still need channelId if it's part of the generic payload
            
            // Construct a generic payload, as this method is deprecated and its original
            // use of 'createControlLoopEventPayload' with 'event' phase was non-standard.
            const genericPayload = {
                loopId: this.loopId,
                agentId: this.agentId,      // Kept for potential backward compatibility if some listener expects it
                channelId: channelId,       // Kept for potential backward compatibility
                timestamp: Date.now(),
                eventData: data             // Use a more descriptive key for the original 'data'
            };

            EventBus.server.emit(
                eventType,
                genericPayload
            );
        } catch (error) {
            logger.error(`Failed to emit event via deprecated emitEvent method: ${error}`);
        }
    }

    /**
     * Schedule a cycle if one is not already scheduled
     */
    private scheduleCycleIfNeeded(): void {
        if (this.cycleScheduled) {
            return;
        }
        this.cycleScheduled = true;
        setTimeout(() => {
            this.cycleScheduled = false;
            this.runControlLoopCycle();
        }, 100); // 100ms delay to debounce
    }
}
