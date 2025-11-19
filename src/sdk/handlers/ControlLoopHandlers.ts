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
 * MCP Resource Handlers
 * Handles resource-related MCP events
 */
import { v4 as uuidv4 } from 'uuid';
import { createControlLoopEventPayload, ControlLoopSpecificData, BaseEventPayload } from '../../shared/schemas/EventPayloadSchema';
import { EventBus } from '../../shared/events/EventBus';
import { Events } from '../../shared/events/EventNames';
import { createStrictValidator } from '../../shared/utils/validation';
import { Handler } from './Handler';
import {
    createTopicsExtractEventPayload,
    createSummaryGenerateEventPayload,
    TopicsExtractEventData,
    SummaryGenerateEventData
} from '../../shared/schemas/EventPayloadSchema';

/**
 * Handles MCP resource events for provider and consumer agents
 */
export class ControlLoopHandlers extends Handler {
    private agentId: string;
    private channelId: string;
    protected validator = createStrictValidator('ControlLoopHandlers');

    // Control loop properties
    protected activeControlLoopId: string | null = null;
    protected observations: any[] = [];
    protected currentReasoning: any = null;
    protected currentPlan: any = null;
    protected maxObservations: number = 10;
    
    // Store subscriptions for proper cleanup
    private subscriptions: { unsubscribe: () => void }[] = [];
    
    /**
     * Create a new MCP resource handler
     * @param agentId Agent ID that owns this handler
     */
    constructor(channelId: string, agentId: string) {
        super(`ControlLoopHandlers:${agentId}`);
        this.agentId = agentId;
        this.channelId = channelId;
    }

    /**
     * @internal - This method is called internally by MxfClient
     */
    public initialize(): void {
        this.subscriptions.push(EventBus.client.on(Events.ControlLoop.OBSERVATION, this.handleObservationEvent.bind(this)));
        this.subscriptions.push(EventBus.client.on(Events.ControlLoop.REASONING, this.handleReasoningEvent.bind(this)));
        this.subscriptions.push(EventBus.client.on(Events.ControlLoop.PLAN, this.handlePlanEvent.bind(this)));
        this.subscriptions.push(EventBus.client.on(Events.ControlLoop.ACTION, this.handleActionEvent.bind(this)));
    }
    
    /**
     * @internal - This method is called internally by MxfClient
     */
    public cleanup(): void {
        this.subscriptions.forEach(sub => sub.unsubscribe());
    }

    /**
     * Initialize a control loop
     * 
     * @param config Configuration for the control loop
     * @returns Promise that resolves to the loop ID when the loop is initialized
     */
    public async initializeControlLoop(config: any): Promise<string> {

        this.validator.assertIsNonEmptyString(this.channelId);
        this.validator.assertIsObject(config);

        const loopId = uuidv4(); // Create temporary ID - server will assign real one
        
        // Store this as our active control loop ID
        this.activeControlLoopId = loopId;
        
        // Reset control loop state
        this.observations = [];
        this.currentReasoning = null;
        this.currentPlan = null;
        
        // Emit the initialization event using proper payload structure
        const controlLoopDataForInit: ControlLoopSpecificData = {
            loopId: loopId,
            status: 'initializing',
            config: config
        };
        const payload = createControlLoopEventPayload(
            Events.ControlLoop.INITIALIZE,
            this.agentId,
            this.channelId,
            controlLoopDataForInit
        );
        
        // Validate control loop payload before sending
        this.validator.assertIsControlLoopPayload(payload);
        
        // Log before emitting to help debug the event flow
        
        // Emit through EventBus following the architecture
        EventBus.client.emit(Events.ControlLoop.INITIALIZE, payload);
        
        return loopId;
    }
    
    /**
     * Start a control loop
     * 
     * @param loopId ID of the control loop to start
     * @returns Promise that resolves when the start request is sent
     */
    public async startControlLoop(loopId: string): Promise<void> {
        this.validator.assertIsNonEmptyString(loopId);
        
        // Emit the start event using proper payload structure
        const controlLoopDataForStart: ControlLoopSpecificData = {
            loopId: loopId,
            status: 'starting'
        };
        const payload = createControlLoopEventPayload(
            Events.ControlLoop.STARTED,
            this.agentId,
            this.channelId,
            controlLoopDataForStart
        );
        
        // Validate control loop payload before sending
        this.validator.assertIsControlLoopPayload(payload);
        
        EventBus.client.emit(Events.ControlLoop.STARTED, payload);
    }

    /**
     * Stop a control loop
     * 
     * @param loopId ID of the control loop to stop
     * @param reason Optional reason for stopping
     * @returns Promise that resolves when the stop request is sent
     */
    public async stopControlLoop(loopId: string, reason?: string): Promise<void> {
        this.validator.assertIsNonEmptyString(loopId);
        
        // Emit the stop event using proper payload structure
        const controlLoopDataForStop: ControlLoopSpecificData = {
            loopId: loopId,
            status: 'stopping',
            context: { reason: reason || 'Stopped by agent' }
        };
        const payload = createControlLoopEventPayload(
            Events.ControlLoop.STOPPED,
            this.agentId,
            this.channelId,
            controlLoopDataForStop
        );
        
        // Validate control loop payload before sending
        this.validator.assertIsControlLoopPayload(payload);
        
        EventBus.client.emit(Events.ControlLoop.STOPPED, payload);
    }
    
    /**
     * Submit an observation to a control loop
     * 
     * @param loopId ID of the control loop
     * @param observation The observation data
     * @param loopOwnerId Optional ID of the agent that owns the control loop. Required when submitting
     *                     to a control loop this agent doesn't own.
     * @returns Promise that resolves when the observation is submitted
     */
    public async submitObservation(loopId: string, observation: any, loopOwnerId?: string): Promise<boolean> {
        this.validator.assertIsNonEmptyString(loopId);
        this.validator.assertIsObject(observation);
        
        // Determine effective loopOwnerId with better logic
        let effectiveLoopOwnerId: string | null;
        
        if (loopOwnerId) {
            // Explicitly provided loopOwnerId - use it
            effectiveLoopOwnerId = loopOwnerId;
        } else if (this.activeControlLoopId === loopId) {
            // This agent owns the control loop - use this agent's ID
            effectiveLoopOwnerId = this.agentId;
        } else {
            // This agent doesn't own the loop and no loopOwnerId provided
            // This should be an error for proper routing
            throw new Error(`loopOwnerId must be provided when submitting observations to a control loop this agent doesn't own (loopId: ${loopId})`);
        }
        
        // Emit the observation event using proper payload structure
        const controlLoopDataForObservation: ControlLoopSpecificData = {
            loopId: loopId,
            observation: observation,
            context: { loopOwnerId: effectiveLoopOwnerId } 
        };
        const payload = createControlLoopEventPayload(
            Events.ControlLoop.OBSERVATION,
            this.agentId,
            this.channelId,
            controlLoopDataForObservation
        );
        
        // Log for debugging
        
        // Validate control loop payload before sending
        this.validator.assertIsControlLoopPayload(payload);
        
        EventBus.client.emit(Events.ControlLoop.OBSERVATION, payload);

        return Promise.resolve(true);
    }
    
    /**
     * Execute an action in a control loop
     * 
     * @param loopId ID of the control loop
     * @param action The action to execute
     * @returns Promise that resolves when the execution request is sent
     */
    public async executeControlLoopAction(loopId: string, action: any): Promise<boolean> {
        this.validator.assertIsNonEmptyString(loopId);
        this.validator.assertIsObject(action);
        
        // Emit the execution event using proper payload structure
        const controlLoopDataForExecution: ControlLoopSpecificData = {
            loopId: loopId,
            action: action
        };
        const payload = createControlLoopEventPayload(
            Events.ControlLoop.EXECUTION,
            this.agentId,
            this.channelId,
            controlLoopDataForExecution
        );
        
        // Validate control loop payload before sending
        this.validator.assertIsControlLoopPayload(payload);
        
        EventBus.client.emit(Events.ControlLoop.EXECUTION, payload);

        return Promise.resolve(true);
    }

    /**
     * Get the active control loop ID for this agent
     * @returns The active control loop ID or null if none is active
     * @internal - This method is called internally by MxfClient
     */
    public getActiveControlLoopId(): string | null {
        return this.activeControlLoopId;
    }

    /**
     * Handle observation events from the control loop
     * 
     * @param payload Event payload
     * @protected
     */
    protected handleObservationEvent(payload: BaseEventPayload<ControlLoopSpecificData>): void {
        const observation = payload.data.observation;
        const loopId = payload.data.loopId
        
        // Only process events for our active control loop
        if (this.activeControlLoopId !== loopId) {
            return;
        }
        
        if (observation) {
            // Add to observations array with max length enforcement
            this.observations.push(observation);
            if (this.observations.length > this.maxObservations) {
                this.observations.shift();
            }
            
            
            // Generate reasoning based on observations (can be overridden by subclasses)
            this.generateReasoning(loopId, this.observations).catch(error => {
                this.logger.error(`Error generating reasoning: ${error instanceof Error ? error.message : String(error)}`);
            });
        }
    }

    /**
     * Handle reasoning events from the control loop
     * 
     * @param payload Event payload
     * @protected
     */
    protected handleReasoningEvent(payload: BaseEventPayload<ControlLoopSpecificData>): void {
        const reasoning = payload.data.reasoning;
        const loopId = payload.data.loopId
        
        // Only process events for our active control loop
        if (this.activeControlLoopId !== loopId) {
            return;
        }
        
        if (reasoning) {
            this.currentReasoning = reasoning;
            // Server-side already logs reasoning events, avoid duplicate client logging
        }
    }
    
    /**
     * Handle plan events from the control loop
     * 
     * @param payload Event payload
     * @protected
     */
    protected handlePlanEvent(payload: BaseEventPayload<ControlLoopSpecificData>): void {
        const plan = payload.data.plan;
        const loopId = payload.data.loopId
        
        // Only process events for our active control loop
        if (this.activeControlLoopId !== loopId) {
            return;
        }
        
        if (plan) {
            this.currentPlan = plan;
            // Server-side already logs plan events, avoid duplicate client logging
        }
    }
    
    /**
     * Handle action events from the control loop
     * 
     * @param payload Event payload
     * @protected
     */
    protected handleActionEvent(payload: BaseEventPayload<ControlLoopSpecificData>): void {
        const action = payload.data.action;
        const status = payload.data.status;
        const loopId = payload.data.loopId;
        
        // Only process events for our active control loop
        if (this.activeControlLoopId !== loopId || !this.currentPlan) {
            return;
        }
        
        if (action && status && this.currentPlan.actions) {
            // Update action status in the current plan
            const actionIndex = this.currentPlan.actions.findIndex((a: any) => a.id === action.id);
            
            if (actionIndex >= 0) {
                this.currentPlan.actions[actionIndex].status = status;
                
                if (status === 'completed' && action.result) {
                    this.currentPlan.actions[actionIndex].result = action.result;
                    
                    // Create observation from action result
                    const observation = {
                        id: uuidv4(),
                        agentId: this.agentId,
                        source: 'action_result',
                        content: {
                            actionId: action.id,
                            result: action.result
                        },
                        timestamp: Date.now()
                    };
                    
                    // Add to observations
                    this.observations.push(observation);
                    if (this.observations.length > this.maxObservations) {
                        this.observations.shift();
                    }
                }
                
                if (status === 'failed' && action.error) {
                    this.currentPlan.actions[actionIndex].error = action.error;
                }
                
                
                // Check if all actions are completed (either completed, failed, or skipped)
                const allActionsCompleted = this.currentPlan.actions.every((a: any) => 
                    a.status === 'completed' || a.status === 'failed' || a.status === 'skipped'
                );
                
                if (allActionsCompleted) {
                    // Trigger reflection for the completed plan
                    this.generateReflection(loopId, this.currentPlan).catch(error => {
                        this.logger.error(`Failed to generate reflection: ${error instanceof Error ? error.message : String(error)}`);
                    });
                }
            }
        }
    }

    /**
     * Generate reasoning based on observations
     * 
     * @param loopId Control loop ID
     * @param observations Array of observations
     * @protected
     */
    protected async generateReasoning(loopId: string, observations: any[]): Promise<void> {
        try {
            
            // Log observation details for debugging
            observations.forEach((obs, index) => {
            });
            
            let reasoning: any = {
                id: uuidv4(),
                agentId: this.agentId,
                content: `Analyzed ${observations.length} observations from control loop ${loopId}`,
                timestamp: Date.now(),
                enhanced: false
            };
            
            // Always attempt LLM integration if we have a channel
            // The server will decide whether to use LLM or fallback based on its configuration
            if (this.channelId) {
                
                // NOTE: LLM operations are now handled by server-side ControlLoop.ts 
                // to prevent duplicate event emissions. The server-side control loop
                // will automatically emit TOPICS_EXTRACT and SUMMARY_GENERATE events.
                
                // Enhanced reasoning content - always enhanced when we have a channel
                reasoning = {
                    ...reasoning,
                    content: `Enhanced ORPAR reasoning: Analyzed ${observations.length} observations. Server-side control loop will handle LLM context analysis for channel ${this.channelId}.`,
                    enhanced: true,
                    llmIntegration: {
                        topicExtraction: true,
                        summaryGeneration: true,
                        channelId: this.channelId,
                        timestamp: Date.now(),
                        source: 'server_side_control_loop'
                    }
                };
                
                
            } else {
                reasoning.content += '. No channel context available for analysis.';
            }
            
            // Store current reasoning
            this.currentReasoning = reasoning;
            
            // NOTE: Reasoning event emission removed - server control loop is now authoritative
            // This method only requests LLM context analysis and prepares reasoning data
            // The server-side ControlLoop.processObservations() will emit the authoritative reasoning event
            
        } catch (error) {
            this.logger.error(`Error in generateReasoning: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Generate a plan based on reasoning
     * 
     * @param loopId Control loop ID
     * @param reasoning Reasoning to base the plan on
     * @protected
     */
    protected async generatePlan(loopId: string, reasoning: any): Promise<void> {
        try {
            // Basic implementation for the Agent class to support testing
            // For advanced plan generation using LLMs, see ModelAgent implementation
            
            // Create simple plan with a couple of actions
            const actions = [
                {
                    id: uuidv4(),
                    description: 'Analyze observations',
                    action: 'analyze',
                    parameters: { type: 'basic' },
                    priority: 1,
                    status: 'pending'
                },
                {
                    id: uuidv4(),
                    description: 'Generate response',
                    action: 'generate',
                    parameters: { format: 'json' },
                    priority: 2,
                    status: 'pending'
                }
            ];
            
            // Create plan object
            const plan = {
                id: uuidv4(),
                agentId: this.agentId,
                reasoningId: reasoning.id,
                actions: actions,
                timestamp: Date.now(),
                goal: 'Process observations and generate appropriate responses',
                description: 'Basic plan for control loop testing',
                createdAt: new Date()
            };
            
            // Store current plan
            this.currentPlan = plan;
            
            // Emit plan event
            const controlLoopDataForPlan: ControlLoopSpecificData = {
                loopId: loopId,
                plan: plan
            };
            const payload = createControlLoopEventPayload(
                Events.ControlLoop.PLAN,
                this.agentId,
                this.channelId,
                controlLoopDataForPlan
            );
            
            EventBus.client.emit(Events.ControlLoop.PLAN, payload);
        } catch (error) {
            this.logger.error(`Error generating plan: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Generate a self-reflection based on plan execution
     * 
     * @param loopId Control loop ID
     * @param plan Executed plan to reflect on
     */
    public async generateReflection(loopId: string, plan: any): Promise<void> {
        try {
            // Basic implementation for the Agent class to support testing
            // For advanced reflection using LLMs, see ModelAgent implementation
            
            // Count completed vs. failed actions
            const totalActions = plan.actions.length;
            const completedActions = plan.actions.filter((a: any) => a.status === 'completed').length;
            const failedActions = plan.actions.filter((a: any) => a.status === 'failed').length;
            const skippedActions = plan.actions.filter((a: any) => a.status === 'skipped').length;
            const pendingActions = plan.actions.filter((a: any) => a.status === 'pending' || a.status === 'in_progress').length;
            
            // Determine overall success
            const success = failedActions === 0 && completedActions + skippedActions === totalActions;
            
            // Generate simple insights
            const insights = [
                `Completed ${completedActions} of ${totalActions} actions`,
                `Failed actions: ${failedActions}`,
                `Success rate: ${Math.round((completedActions / totalActions) * 100)}%`
            ];
            
            // Generate simple improvements
            const improvements = [];
            if (failedActions > 0) {
                improvements.push('Improve error handling for failed actions');
            }
            if (pendingActions > 0) {
                improvements.push('Ensure all actions are properly executed or skipped');
            }
            improvements.push('Continue to enhance observation processing');
            
            // Create enhanced metrics object
            const metrics = {
                successRate: totalActions > 0 ? completedActions / totalActions : 0,
                completionRate: totalActions > 0 ? (completedActions + failedActions) / totalActions : 0,
                executionTime: Date.now() - plan.timestamp,
                complexity: totalActions,
                errorRate: totalActions > 0 ? failedActions / totalActions : 0
            };
            
            // Create structured insights array
            const structuredInsights = [
                {
                    type: 'success',
                    category: 'performance',
                    description: `Successfully completed ${completedActions} of ${totalActions} actions`,
                    explanation: `The plan successfully executed ${completedActions} of ${totalActions} actions without errors.`,
                    confidence: 1.0,
                    relatedActionIds: plan.actions.filter((a: any) => a.status === 'completed').map((a: any) => a.id)
                }
            ];
            
            if (failedActions > 0) {
                structuredInsights.push({
                    type: 'error',
                    category: 'error',
                    description: `Failed to complete ${failedActions} of ${totalActions} actions`,
                    explanation: `${failedActions} actions failed to execute properly and should be investigated.`,
                    confidence: 1.0,
                    relatedActionIds: plan.actions.filter((a: any) => a.status === 'failed').map((a: any) => a.id)
                });
            }
            
            structuredInsights.push({
                type: 'improvement',
                category: 'enhancement',
                description: 'Continue to enhance observation processing',
                explanation: 'Better observation processing would lead to more accurate planning and execution.',
                confidence: 0.8,
                relatedActionIds: [] // Add empty array for relatedActionIds
            });
            
            // Create learning signals with required properties for validation
            const learningSignals = {
                reward: success ? 1 : -1,
                actionRewards: {},
                confidenceScore: 0.9,
                // Add required properties for test validation
                reinforcement: {
                    type: success ? 'positive' : 'negative',
                    strength: success ? 0.8 : -0.5,
                    reason: success ? 'Successful plan execution' : 'Plan execution failed'
                },
                adjustment: {
                    type: 'learning_rate',
                    value: 0.05,
                    target: 'observation_processing'
                }
            };
            
            // Create reflection object with enhanced properties
            const reflection = {
                id: uuidv4(),
                agentId: this.agentId,
                planId: plan.id,
                success,
                insights,
                improvements,
                timestamp: Date.now(),
                // Add enhanced properties
                metrics,
                structuredInsights,
                learningSignals
            };
            
            // Emit reflection event
            const controlLoopDataForReflection: ControlLoopSpecificData = {
                loopId: loopId,
                context: { reflection: reflection }
            };
            const payload = createControlLoopEventPayload(
                Events.ControlLoop.REFLECTION,
                this.agentId,
                this.channelId,
                controlLoopDataForReflection
            );
            
            EventBus.client.emit(Events.ControlLoop.REFLECTION, payload);
        } catch (error) {
            this.logger.error(`Error generating reflection: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    
}
