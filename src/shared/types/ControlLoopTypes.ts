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
 * ControlLoopTypes.ts
 * 
 * Defines all types and interfaces used by the Control Loop component.
 * This file centralizes the type definitions to ensure consistency across
 * the Control Loop implementation.
 */

import { AgentId } from './Agent';

/**
 * Enum representing the possible states of the control loop
 */
export enum ControlLoopStateEnum {
    IDLE = 'idle',                 // Control loop is initialized but not running
    INITIALIZING = 'initializing', // Control loop is initializing
    RUNNING = 'running',           // Control loop is actively running
    OBSERVING = 'observing',       // Currently processing observations
    REASONING = 'reasoning',       // Currently generating reasoning
    PLANNING = 'planning',         // Currently creating a plan
    EXECUTING = 'executing',       // Currently executing a plan
    REFLECTING = 'reflecting',     // Currently reflecting on execution
    PAUSED = 'paused',             // Control loop is paused
    ERROR = 'error',               // Control loop encountered an error
    DEGRADED = 'degraded'          // Control loop is in degraded mode
}

/**
 * Configuration options for the control loop
 */
export interface ControlLoopConfig {
    // Basic configuration
    maxObservations?: number;        // Maximum number of observations to keep
    cycleInterval?: number;          // Milliseconds between cycles
    
    // Error recovery configuration
    errorRecovery?: ErrorRecoveryConfig;
    
    // Reinforcement learning configuration
    reinforcement?: ReinforcementConfig;
}

/**
 * Error recovery configuration
 */
export interface ErrorRecoveryConfig {
    maxConsecutiveErrors?: number;   // Maximum number of consecutive errors before entering degraded mode
    maxRetries?: number;             // Maximum number of retries for failed operations
    retryDelay?: number;             // Base delay in ms between retries (exponential backoff applied)
    enableAutoHealing?: boolean;     // Whether to attempt auto-recovery from errors
}

/**
 * Reinforcement learning configuration
 */
export interface ReinforcementConfig {
    enabled: boolean;                // Whether reinforcement learning is enabled
    learningRate?: number;           // Learning rate for the RL algorithm
    maxEpisodes?: number;            // Maximum number of training episodes
    networkType?: string;            // Type of neural network to use
    hiddenLayers?: number[];         // Structure of hidden layers
    activationFunction?: string;     // Activation function to use
    batchSize?: number;              // Batch size for training
}

/**
 * Training instance for reinforcement learning
 */
export interface TrainingInstance {
    id: string;
    agentId: AgentId;
    state: any;
    action: any;
    reward: number;
    nextState: any;
    timestamp: number;
}

/**
 * Represents an observation from the environment
 */
export interface Observation {
    id: string;
    agentId: AgentId;
    source: string;          // Source of the observation (e.g., 'user', 'system', 'agent')
    content: any;            // Content of the observation
    timestamp: number;
    metadata?: Record<string, any>;
}

/**
 * Represents reasoning based on observations
 */
export interface Reasoning {
    id: string;
    agentId: AgentId;
    content: string;         // Reasoning content
    timestamp: number;
    metadata?: Record<string, any>;
}

/**
 * Status of a plan action
 */
export type ActionStatus = 'pending' | 'executing' | 'completed' | 'failed' | 'aborted' | 'skipped';

/**
 * Represents an action in a plan
 */
export interface PlanAction {
    id: string;
    description: string;     // Human-readable description of the action
    action: string;          // Action identifier
    parameters: any;         // Action parameters
    priority: number;        // Execution priority (lower numbers execute first)
    dependencies?: string[]; // IDs of actions that must be completed before this one
    timestamp?: number;      // When the action was created
    status: ActionStatus;    // Current status of the action
    result?: any;            // Result of the action (if completed)
    error?: string;          // Error message (if failed)
    metadata?: Record<string, any>; // Additional metadata
}

/**
 * Represents a plan to achieve a goal
 */
export interface Plan {
    id: string;
    agentId: AgentId;
    reasoningId: string;     // ID of the reasoning that generated this plan
    actions: PlanAction[];   // Actions to take
    timestamp: number;       // When the plan was created (Unix timestamp)
    goal: string;            // Goal to achieve
    description: string;     // Human-readable description of the plan
    createdAt: Date;         // When the plan was created (Date object)
    completedAt?: Date;      // When the plan was completed (if applicable)
    status: 'created' | 'executing' | 'completed' | 'failed' | 'aborted'; // Status of the plan
    metadata?: Record<string, any>; // Additional metadata
}

/**
 * Represents reflection on a plan execution
 */
export interface Reflection {
    id: string;
    agentId: AgentId;
    planId: string;          // ID of the plan that was executed
    success: boolean;        // Whether the plan was successful
    insights: string[];      // Insights gained from execution
    improvements: string[];  // Potential improvements for future plans
    metadata?: Record<string, any>;
    timestamp: number;
}

/**
 * Represents a control loop event
 */
export interface ControlLoopEvent {
    type: string;            // Event type
    data: any;               // Event data
    timestamp: number;       // Event timestamp
}
