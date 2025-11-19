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
 * Agent.ts
 * 
 * Defines types and interfaces related to agents in the MXF.
 * This is a central type definition file for agent-related types that can be
 * imported by both server and client components.
 */

/**
 * Agent identifier type
 * This is a string that uniquely identifies an agent in the system
 */
export type AgentId = string;

/**
 * Agent capability type
 * Represents a specific capability that an agent can provide
 */
export type AgentCapability = string;

/**
 * Agent status enum
 * Represents the possible states of an agent
 */
export enum AgentStatusEnum {
    OFFLINE = 'offline',         // Agent is not connected
    CONNECTING = 'connecting',   // Agent is in the process of connecting
    CONNECTED = 'connected',     // Agent is connected but not ready
    READY = 'ready',             // Agent is connected and ready for tasks
    BUSY = 'busy',               // Agent is currently performing a task
    ERROR = 'error',             // Agent encountered an error
    DEGRADED = 'degraded'        // Agent is operating in degraded mode
}

/**
 * Agent information interface
 * Contains basic information about an agent
 */
export interface AgentInfo {
    agentId: AgentId;
    name: string;
    description?: string;
    capabilities: AgentCapability[];
    status: AgentStatusEnum;
    lastActive?: number;
    metadata?: Record<string, any>;
}

/**
 * Agent registration data
 * Data required to register an agent with the system
 */
export interface AgentRegistrationData {
    agentId: AgentId;
    name: string;
    description?: string;
    capabilities?: AgentCapability[];
    metadata?: Record<string, any>;
}

/**
 * Agent connection data
 * Data passed when an agent connects to the system
 */
export interface AgentConnectionData {
    agentId: AgentId;
    socketId: string;
    capabilities?: AgentCapability[];
    channelId?: string;
    metadata?: Record<string, any>;
}

/**
 * Agent update data
 * Data used to update an agent's status or metadata
 */
export interface AgentUpdateData {
    agentId: AgentId;
    status?: AgentStatusEnum;
    capabilities?: AgentCapability[];
    metadata?: Record<string, any>;
}
