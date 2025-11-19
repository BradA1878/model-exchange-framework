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
 * controlLoop.ts
 * 
 * Shared model definitions for the Control Loop architecture.
 * Includes interfaces and types used by both server and client components.
 */

import { AgentId } from '../types/Agent';
import { Plan, PlanAction, ActionStatus, Reflection } from '../types/ControlLoopTypes';

// Re-export consolidated types for backward compatibility
export { Plan, PlanAction, ActionStatus, Reflection };

/**
 * Enum for control loop state
 */
export enum ControlLoopStateEnum {
    IDLE = 'idle',
    INITIALIZING = 'initializing',
    READY = 'ready',
    RUNNING = 'running',
    OBSERVING = 'observing',
    REASONING = 'reasoning',
    PLANNING = 'planning',
    EXECUTING = 'executing',
    REFLECTING = 'reflecting',
    STOPPING = 'stopping',
    STOPPED = 'stopped',
    ERROR = 'error'
}

/**
 * Interface for control loop configuration
 */
export interface ControlLoopConfig {
    // Core configuration
    loopId?: string;          // Unique ID for this control loop, generated if not provided
    agentId: AgentId;         // ID of the agent this control loop belongs to
    channelId?: string;       // Channel to receive observations and emit events
    autoStart?: boolean;      // Whether to start the control loop automatically after initialization
    
    // Performance configuration
    maxObservationsToProcess?: number;  // Maximum number of observations to process in one cycle
    processingInterval?: number;        // Interval in ms between processing cycles
    
    // Error handling configuration
    errorRecovery?: ErrorRecoveryConfig; // Error recovery configuration
    
    // Extension points
    plugins?: any[];           // Plugins to extend control loop functionality
    customHandlers?: Record<string, Function>; // Custom handlers for specific events
    
    // Operational constraints
    timeout?: number;         // Timeout in ms for various operations
    maxRetries?: number;      // Maximum number of retries for failing operations
    
    // Created timestamp
    createdAt?: number;       // Timestamp when this config was created
}

/**
 * Interface for error recovery configuration
 */
export interface ErrorRecoveryConfig {
    maxConsecutiveErrors?: number; // Maximum consecutive errors before entering degraded mode
    enableAutoHealing?: boolean;   // Whether to enable automatic recovery from errors
    maxRetries?: number;           // Maximum retries for failed operations
    retryDelay?: number;           // Delay in ms between retries
}

/**
 * Interface for observations fed into the control loop
 */
export interface Observation {
    id: string;                 // Unique ID for this observation
    agentId: AgentId;           // ID of the agent this observation is for or from
    source: string;             // Source of the observation (e.g., "user", "sensor", "agent")
    content: any;               // Content of the observation
    timestamp: number;          // When the observation was created
    priority?: number;          // Priority of the observation (higher values = higher priority)
    metadata?: Record<string, any>; // Additional metadata
    processed?: boolean;        // Whether this observation has been processed
}

/**
 * Interface for reasoning generated from observations
 */
export interface Reasoning {
    id: string;                 // Unique ID for this reasoning
    agentId: AgentId;           // ID of the agent that generated this reasoning
    observations: string[];     // IDs of observations this reasoning is based on
    content: any;               // Content of the reasoning
    timestamp: number;          // When the reasoning was generated
    confidence?: number;        // Confidence in the reasoning (0-1)
    metadata?: Record<string, any>; // Additional metadata
}

/**
 * Interface for a complete control loop implementation
 */
export interface IControlLoop {
    /**
     * Initialize the control loop
     * @param config Control loop configuration
     */
    initialize(config: ControlLoopConfig): Promise<boolean>;
    
    /**
     * Start the control loop
     */
    start(): Promise<boolean>;
    
    /**
     * Stop the control loop
     */
    stop(): Promise<boolean>;
    
    /**
     * Reset the control loop
     */
    reset(): Promise<boolean>;
    
    /**
     * Get the current state of the control loop
     */
    getCurrentState(): Promise<ControlLoopStateEnum>;
    
    /**
     * Add an observation to the control loop
     * @param observation Observation to add
     */
    addObservation(observation: Observation): Promise<boolean>;
    
    /**
     * Execute an action
     * @param action Action to execute
     */
    executeAction(action: PlanAction): Promise<any>;
    
    /**
     * Attempt to recover from an error state
     * @param error Error that triggered recovery
     */
    recover(error: any): Promise<boolean>;
}
