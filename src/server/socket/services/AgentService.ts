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

import { EventBus } from '../../../shared/events/EventBus';
import { Events, AgentEvents } from '../../../shared/events/EventNames';
import { AgentEventData, AgentEventPayload, createAgentMessageDeliveredPayload, AgentMessageDeliveredEventData } from '../../../shared/schemas/EventPayloadSchema';
import { createStrictValidator } from '../../../shared/utils/validation';
import { Logger } from '../../../shared/utils/Logger';
import { AgentConnectionStatus } from '../../../shared/types/AgentTypes';
import { v4 as uuidv4 } from 'uuid';
import { ChannelService } from './ChannelService';

/**
 * Interface for agent data
 */
export interface IAgent {
    id: string;
    capabilities?: string[];
    allowedTools?: string[]; // Tools the agent is allowed to use
    status: AgentConnectionStatus;
    lastActivity: number;
    socketIds: string[];
    metadata?: Record<string, any>;
    meilisearchReady?: boolean; // Whether Meilisearch backfill is complete for this agent
}

/**
 * AgentService handles agent registration, capabilities, and status
 * This service is responsible for:
 * 1. Agent registration and authentication
 * 2. Tracking agent capabilities and status
 * 3. Managing agent session data
 * 4. Processing agent-to-agent communication
 */
export class AgentService {
    private static instance: AgentService;
    
    // Agent tracking
    private agents: Map<string, IAgent> = new Map();
    private logger = new Logger('debug', 'AgentService', 'server');

    private constructor() {
        this.setupEventListeners();
    }
    
    /**
     * Get the singleton instance of AgentService
     */
    public static getInstance(): AgentService {
        if (!AgentService.instance) {
            AgentService.instance = new AgentService();
        }
        return AgentService.instance;
    }

    /**
     * Set up event listeners for agent-related events
     */
    private setupEventListeners(): void {
        // Registration events
        EventBus.server.on(Events.Agent.REGISTER, (payload: AgentEventPayload) => this.handleAgentRegistration(payload));

        // Connection events
        EventBus.server.on(Events.Agent.CONNECT, (payload: AgentEventPayload) => this.handleAgentConnection(payload));
        EventBus.server.on(Events.Agent.DISCONNECT, (payload: AgentEventPayload) => this.handleAgentDisconnection(payload));
        EventBus.server.on(Events.Agent.STATUS_CHANGE, (payload: AgentEventPayload) => this.handleAgentStatusChange(payload));

        // Agent message events
        EventBus.server.on(Events.Message.AGENT_MESSAGE, (payload: AgentEventPayload) => this.handleAgentMessage(payload));

        // Meilisearch backfill events - mark agent as ready when backfill completes
        EventBus.server.on(Events.Meilisearch.BACKFILL_COMPLETE, (payload: any) => this.handleBackfillComplete(payload));
        EventBus.server.on(Events.Meilisearch.BACKFILL_PARTIAL, (payload: any) => this.handleBackfillComplete(payload));
    }

    /**
     * Handle agent registration event
     * @param payload - Registration payload
     */
    private handleAgentRegistration(payload: AgentEventPayload): void {
        try {
            // Validate payload
            const validator = createStrictValidator();
            validator.assertIsObject(payload, 'payload');
            
            // Extract agentId from top level of payload (where MxfClient puts it)
            const agentId = payload.agentId;
            // Extract capabilities and allowedTools from data object
            const data = payload?.data || {};
            
            
            const capabilities = data.capabilities || [];
            // CRITICAL: Don't default to empty array - keep undefined as undefined
            // Empty array means "no tools allowed", undefined means "use defaults"
            const allowedTools = data.allowedTools; // Extract allowedTools from registration data without defaulting
            
            
            // Basic validation
            validator.assertIsNonEmptyString(agentId, 'agentId from payload');
            
            
            // Register the agent with allowedTools
            this.registerAgent(agentId, capabilities, allowedTools);

            // Use channelId from top level of payload
            const channelId = payload?.channelId || 'agent-events';
            
            // Create registration response payload directly
            const agentRegisteredData: AgentEventData = {
                status: AgentConnectionStatus.REGISTERED,
                capabilities
            };
            const registrationResponse: AgentEventPayload = {
                eventId: uuidv4(),
                eventType: Events.Agent.REGISTERED, // Actual event type
                timestamp: Date.now(),
                agentId: agentId, // Agent being registered
                channelId: channelId, 
                data: agentRegisteredData
            };
            
            // Emit agent registered event
            EventBus.server.emit(Events.Agent.REGISTERED, registrationResponse);
            
        } catch (error: any) {
            this.logger.error(`Error handling agent registration: ${error.message}`);
            
            // Extract info from correct locations in payload
            const agentIdForError = payload?.agentId;
            const channelIdForError = payload?.channelId;

            // Only emit registration failed event if we have valid agentId and channelId
            if (!agentIdForError || typeof agentIdForError !== 'string' || 
                !channelIdForError || typeof channelIdForError !== 'string') {
                this.logger.error(`Cannot emit REGISTRATION_FAILED event - invalid or missing agentId/channelId in payload. AgentId: ${agentIdForError || '[MISSING]'}, ChannelId: ${channelIdForError || '[MISSING]'}`);
                return;
            }

            // Create error payload directly
            const registrationFailedData: AgentEventData = {
                status: AgentConnectionStatus.ERROR,
                error: `Registration failed: ${error.message}`
            };
            const errorPayload: AgentEventPayload = {
                eventId: uuidv4(),
                eventType: Events.Agent.REGISTRATION_FAILED, // Actual event type
                timestamp: Date.now(),
                agentId: agentIdForError,
                channelId: channelIdForError,
                data: registrationFailedData
            };
            
            // Emit registration failed event
            EventBus.server.emit(Events.Agent.REGISTRATION_FAILED, errorPayload);
        }
    }

    /**
     * Handle agent connection event
     * @param payload - Connection payload
     */
    private handleAgentConnection(payload: AgentEventPayload): void {
        try {
            const validator = createStrictValidator();
            validator.assertIsObject(payload, 'payload');
            
            const agentId = payload.agentId;
            const data = payload.data || {};
            const socketId = data.socketId;
            
            validator.assertIsNonEmptyString(agentId, 'agentId from payload');
            validator.assertIsNonEmptyString(socketId, 'socketId from payload');
            
            
            let finalStatus = AgentConnectionStatus.DISCONNECTED;
            
            // Update agent status (create if not exists)
            if (!this.agentExists(agentId)) {
                // Only create with empty data if agent doesn't exist
                // This preserves any previously registered capabilities and allowedTools
                this.registerAgent(agentId, [], []); // Create with empty capabilities and tools initially
            }
            
            // Update the agent status to connected
            this.updateAgentStatus(agentId, AgentConnectionStatus.CONNECTED);
            
            // Determine channelId for the outgoing event
            const channelId = payload.channelId;
            
            // Create connection response payload directly
            const agentConnectedData: AgentEventData = {
                status: AgentConnectionStatus.CONNECTED,
                socketId
            };
            const connectionResponse: AgentEventPayload = {
                eventId: uuidv4(),
                eventType: Events.Agent.CONNECTED,
                timestamp: Date.now(),
                agentId: agentId,
                channelId: channelId,
                data: agentConnectedData
            };
            
            // Emit agent connected event
            EventBus.server.emit(Events.Agent.CONNECTED, connectionResponse);
            
        } catch (error: any) {
            this.logger.error(`Error handling agent connection: ${error.message}`);
            
            const agentIdForError = payload.agentId;
            const data = payload.data || {};
            const socketIdForError = data.socketId;
            const channelIdForError = payload.channelId;

            // Only emit connection failed event if we have valid agentId and channelId
            if (!agentIdForError || typeof agentIdForError !== 'string' || 
                !channelIdForError || typeof channelIdForError !== 'string') {
                this.logger.error(`Cannot emit CONNECTION_ERROR event - invalid or missing agentId/channelId in payload. AgentId: ${agentIdForError || '[MISSING]'}, ChannelId: ${channelIdForError || '[MISSING]'}`);
                return;
            }

            // Create error payload directly
            const connectionErrorData: AgentEventData = {
                status: AgentConnectionStatus.ERROR,
                error: `Connection failed: ${error.message}`,
                socketId: socketIdForError
            };
            const errorPayload: AgentEventPayload = {
                eventId: uuidv4(),
                eventType: Events.Agent.CONNECTION_ERROR,
                timestamp: Date.now(),
                agentId: agentIdForError,
                channelId: channelIdForError,
                data: connectionErrorData
            };
            
            // Emit connection error event
            EventBus.server.emit(Events.Agent.CONNECTION_ERROR, errorPayload);
        }
    }

    /**
     * Handle agent disconnection event
     * @param payload - Disconnection payload
     */
    private handleAgentDisconnection(payload: AgentEventPayload): void {
        try {
            const validator = createStrictValidator();
            validator.assertIsObject(payload, 'payload');
            
            const agentId = payload.agentId;
            const data = payload.data || {};
            const socketId = data.socketId;
            
            validator.assertIsNonEmptyString(agentId, 'agentId from payload');
            validator.assertIsNonEmptyString(socketId, 'socketId from payload');
            
            
            let finalStatus = AgentConnectionStatus.DISCONNECTED;
            
            // Update the agent status to disconnected if it exists
            if (this.agentExists(agentId)) {
                this.updateAgentStatus(agentId, AgentConnectionStatus.DISCONNECTED);
                finalStatus = this.getAgentStatus(agentId) || AgentConnectionStatus.DISCONNECTED;
            } else {
                this.logger.warn(`Agent ${agentId} not found during disconnection`);
            }
            
            // Determine channelId for the outgoing event
            const channelId = payload?.channelId || 'agent-events';
            
            // Create disconnection response payload directly
            const agentDisconnectedData: AgentEventData = {
                status: finalStatus,
                socketId
            };
            const disconnectionResponse: AgentEventPayload = {
                eventId: uuidv4(),
                eventType: Events.Agent.DISCONNECTED,
                timestamp: Date.now(),
                agentId: agentId,
                channelId: channelId,
                data: agentDisconnectedData
            };
            
            // Emit agent disconnected event
            EventBus.server.emit(Events.Agent.DISCONNECTED, disconnectionResponse);
            
        } catch (error: any) {
            // Log error, but no specific error event is defined for disconnection failures in original code
            const agentIdForLog = payload?.agentId;
            this.logger.error(`Error handling agent disconnection for agent ${agentIdForLog || '[UNKNOWN_AGENT]'}: ${error.message}`);
            // Original code did not emit a specific 'DISCONNECTION_FAILED' event.
            // If necessary, an error event could be defined and emitted here.
        }
    }

    /**
     * Handle agent status change event
     * @param payload - Status change payload
     */
    private handleAgentStatusChange(payload: AgentEventPayload): void {
        try {
            const validator = createStrictValidator();
            validator.assertIsObject(payload, 'payload');

            const agentId = payload.agentId;
            const data = payload.data || {};
            const status = data.status as AgentConnectionStatus; // Assuming status is of this type
            const metadata = data.metadata; // Optional

            validator.assertIsNonEmptyString(agentId, 'agentId from payload');
            if (!Object.values(AgentConnectionStatus).includes(status)) {
                throw new Error(`Invalid status: ${status}. Must be one of: ${Object.values(AgentConnectionStatus).join(', ')}`);
            }

            // Update the agent status if it exists
            if (this.agentExists(agentId)) {
                this.updateAgentStatus(agentId, status);
                const updatedAgent = this.getAgent(agentId);
                
                if (!updatedAgent) {
                    this.logger.error(`Failed to retrieve updated agent data for ${agentId}`);
                    return;
                }
                
            } else {
                this.logger.warn(`Agent ${agentId} not found for status update`);
                return;
            }

            // Note: Do not emit another STATUS_CHANGE event here as it would cause infinite loop
            // This handler responds to status change events, it should not trigger new ones
            
        } catch (error: any) {
            const agentIdForLog = payload?.agentId || '[UNKNOWN_AGENT]';
            this.logger.error(`Error handling agent status change for agent ${agentIdForLog}: ${error.message}`);
            
            const agentIdForError = payload?.agentId;
            const channelIdForError = payload?.channelId;

            // Only emit agent error event if we have valid agentId and channelId
            if (!agentIdForError || typeof agentIdForError !== 'string' || 
                !channelIdForError || typeof channelIdForError !== 'string') {
                this.logger.error(`Cannot emit ERROR event - invalid or missing agentId/channelId in payload. AgentId: ${agentIdForError || '[MISSING]'}, ChannelId: ${channelIdForError || '[MISSING]'}`);
                return;
            }

            // Create error payload directly
            const agentErrorData: AgentEventData = {
                status: AgentConnectionStatus.ERROR,
                error: `Status change failed: ${error.message}`
            };
            const errorPayload: AgentEventPayload = {
                eventId: uuidv4(),
                eventType: Events.Agent.ERROR,
                timestamp: Date.now(),
                agentId: agentIdForError,
                channelId: channelIdForError,
                data: agentErrorData
            };
            
            // Emit agent error event (this is different from STATUS_CHANGE so no loop)
            EventBus.server.emit(Events.Agent.ERROR, errorPayload);
        }
    }

    /**
     * Handle agent-to-agent message event. Listens to Events.Agent.MESSAGE.
     * @param payload - Message payload, expected to contain agentId, channelId, and data (with fromAgentId, toAgentId, content).
     */
    private handleAgentMessage(payload: AgentEventPayload): void {
        // incoming payload is for Events.Agent.MESSAGE
        // We need to extract fromAgentId, toAgentId, content for new events.
        const validator = createStrictValidator();
        let fromAgentId: string;
        let toAgentId: string;
        let content: any = null;
        let channelId: string;
        let agentId: string;

        try {
            // Attempt to parse the incoming payload structure
            validator.assertIsObject(payload, 'payload for agent message');

            // Extract message data from the payload data object (where MxfClient puts it)
            const messageData = payload.data || {};
            fromAgentId = messageData.senderId;
            toAgentId = messageData.receiverId;
            content = messageData.content.data;

           channelId = payload.channelId;
           agentId = payload.agentId;

            validator.assertIsNonEmptyString(fromAgentId, 'fromAgentId from payload');
            validator.assertIsNonEmptyString(agentId, 'agentId from payload');
            validator.assertIsNonEmptyString(channelId, 'channelId from payload');
            // content can be any, no specific validation here unless required by schema
            if (content === undefined || content === null) {
                throw new Error('Content is missing in agent message payload');
            }

            // Check if recipient agent exists
            if (!this.agentExists(toAgentId)) {
                throw new Error(`Recipient agent ${toAgentId} not found`);
            }

            // 2. Emit Events.Message.AGENT_MESSAGE_DELIVERED
            const deliveredData: AgentMessageDeliveredEventData = {
                fromAgentId: fromAgentId,
                toAgentId: toAgentId,
                content: content,
                timestamp: Date.now(),
                toolType: 'agentMessage'
            };

            deliveredData.receiverId = toAgentId;
            deliveredData.senderId = fromAgentId;
            
            // Use the schema helper for standardized payload creation
            const deliveredPayload = createAgentMessageDeliveredPayload(
                Events.Message.AGENT_MESSAGE_DELIVERED,
                fromAgentId, // Agent who sent the message
                channelId,
                deliveredData
            );


            EventBus.server.emit(Events.Message.AGENT_MESSAGE_DELIVERED, deliveredPayload);

        } catch (error: any) {
            // Extract what we can from payload for error logging, but don't create fake values
            const messageData = payload?.data || {};
            const fromAgentIdForLog = messageData.fromAgentId || payload?.agentId;
            const toAgentIdForLog = payload?.agentId;
            const channelIdForLog = payload?.channelId;
            
            this.logger.error(`Error handling agent message from ${fromAgentIdForLog || '[UNKNOWN_FROM]'} to ${toAgentIdForLog || '[UNKNOWN_TO]'}: ${error.message}`);
            
            // Only emit error event if we have valid identifiers - don't create events with fake values
            if (fromAgentIdForLog && typeof fromAgentIdForLog === 'string' && 
                toAgentIdForLog && typeof toAgentIdForLog === 'string' &&
                channelIdForLog && typeof channelIdForLog === 'string') {
                
                // Emit Events.Message.MESSAGE_ERROR with valid identifiers
                const errorData = {
                    fromAgentId: fromAgentIdForLog,
                    toAgentId: toAgentIdForLog,
                    error: `Message delivery failed: ${error.message}`,
                    timestamp: Date.now()
                    // content: content, // Optionally include content in error if safe
                };
                const messageErrorPayload: AgentEventPayload = { // Assuming this fits AgentEventData or specific error data structure
                    eventId: uuidv4(),
                    eventType: Events.Message.MESSAGE_ERROR,
                    timestamp: Date.now(),
                    agentId: fromAgentIdForLog, // Agent who attempted to send
                    channelId: channelIdForLog, // Channel of the attempted message
                    data: errorData
                };
                
                EventBus.server.emit(Events.Message.MESSAGE_ERROR, messageErrorPayload);
            } else {
                this.logger.warn(`Cannot emit MESSAGE_ERROR event - invalid or missing agent/channel identifiers in payload`);
            }
        }
    }

    /**
     * Handle Meilisearch backfill completion
     * Marks the agent as ready for memory search tools
     */
    private handleBackfillComplete(payload: any): void {
        try {
            const agentId = payload.agentId;
            if (!agentId) {
                this.logger.warn('Backfill complete event missing agentId');
                return;
            }

            const agent = this.agents.get(agentId);
            if (!agent) {
                this.logger.warn(`Backfill complete for unknown agent ${agentId}`);
                return;
            }

            // Mark agent as Meilisearch ready
            agent.meilisearchReady = true;
            this.agents.set(agentId, agent);


            // Emit tools refresh event to notify agent
            EventBus.server.emit(Events.Mcp.MXF_TOOL_LIST, {
                eventId: uuidv4(),
                eventType: Events.Mcp.MXF_TOOL_LIST,
                timestamp: Date.now(),
                agentId: agentId,
                channelId: payload.channelId || 'system',
                data: {
                    requestId: `meilisearch-ready-${Date.now()}`
                }
            });

        } catch (error) {
            this.logger.error(`Error handling backfill complete: ${error}`);
        }
    }

    /**
     * Register a new agent
     * @param agentId - Agent ID
     * @param capabilities - Agent capabilities
     * @param allowedTools - Tools the agent is allowed to use (undefined means use defaults)
     * @returns The registered agent
     */
    public registerAgent(agentId: string, capabilities: string[] = [], allowedTools?: string[]): IAgent {
        const validator = createStrictValidator();
        validator.assertIsNonEmptyString(agentId);
        
        
        // Check if agent already exists to preserve existing data
        const existingAgent = this.agents.get(agentId);
        
        // Create or update agent data
        const agent: IAgent = {
            id: agentId,
            // Preserve existing capabilities and tools if not provided
            capabilities: capabilities.length > 0 ? capabilities : (existingAgent?.capabilities || []),
            // CRITICAL: Keep allowedTools as undefined if not specified (don't default to empty array)
            // undefined = use defaults, [] = no tools, ['tool1', 'tool2'] = specific tools
            allowedTools: allowedTools !== undefined ? allowedTools : existingAgent?.allowedTools,
            status: AgentConnectionStatus.REGISTERED,
            lastActivity: Date.now(),
            socketIds: existingAgent?.socketIds || [],
            metadata: existingAgent?.metadata || {},
            // Meilisearch starts as not ready - will be set to true when backfill completes
            meilisearchReady: existingAgent?.meilisearchReady || false
        };
        
        // Store agent data
        this.agents.set(agentId, agent);
        
        
        return agent;
    }

    /**
     * Update an agent's status
     * @param agentId - Agent ID
     * @param status - New status
     * @returns Updated agent data
     */
    public updateAgentStatus(agentId: string, status: AgentConnectionStatus): IAgent | null {
        const validator = createStrictValidator();
        validator.assertIsNonEmptyString(agentId);
        validator.assertIsNonEmptyString(status);
        
        // Get agent data
        const agent = this.agents.get(agentId);
        if (!agent) {
            this.logger.warn(`Attempted to update status for non-existent agent ${agentId}`);
            return null;
        }
        
        // Update status and activity timestamp
        agent.status = status;
        agent.lastActivity = Date.now();
        
        // Store updated agent data
        this.agents.set(agentId, agent);
        
        
        return agent;
    }

    /**
     * Add a socket ID to an agent
     * @param agentId - Agent ID
     * @param socketId - Socket ID to add
     * @returns True if socket was added, false otherwise
     */
    public addSocketToAgent(agentId: string, socketId: string): boolean {
        const validator = createStrictValidator();
        validator.assertIsNonEmptyString(agentId);
        validator.assertIsNonEmptyString(socketId);
        
        // Get agent data
        const agent = this.agents.get(agentId);
        if (!agent) {
            this.logger.warn(`Attempted to add socket to non-existent agent ${agentId}`);
            return false;
        }
        
        // Check if socket is already associated with agent
        if (agent.socketIds.includes(socketId)) {
            this.logger.warn(`Socket ${socketId} already associated with agent ${agentId}`);
            return false;
        }
        
        // Add socket ID to agent's sockets
        agent.socketIds.push(socketId);
        
        // Update activity timestamp
        agent.lastActivity = Date.now();
        
        // Store updated agent data
        this.agents.set(agentId, agent);
        
        
        return true;
    }

    /**
     * Remove a socket ID from an agent
     * @param agentId - Agent ID
     * @param socketId - Socket ID to remove
     * @returns True if socket was removed, false otherwise
     */
    public removeSocketFromAgent(agentId: string, socketId: string): boolean {
        const validator = createStrictValidator();
        validator.assertIsNonEmptyString(agentId);
        validator.assertIsNonEmptyString(socketId);
        
        // Get agent data
        const agent = this.agents.get(agentId);
        if (!agent) {
            this.logger.warn(`Attempted to remove socket from non-existent agent ${agentId}`);
            return false;
        }
        
        // Check if socket is associated with agent
        const socketIndex = agent.socketIds.indexOf(socketId);
        if (socketIndex === -1) {
            this.logger.warn(`Socket ${socketId} not associated with agent ${agentId}`);
            return false;
        }
        
        // Remove socket ID from agent's sockets
        agent.socketIds.splice(socketIndex, 1);
        
        // Update activity timestamp
        agent.lastActivity = Date.now();
        
        // Store updated agent data
        this.agents.set(agentId, agent);
        
        
        return true;
    }

    /**
     * Check if an agent has any active sockets
     * @param agentId - Agent ID
     * @returns True if agent has active sockets, false otherwise
     */
    public hasActiveSockets(agentId: string): boolean {
        const validator = createStrictValidator();
        validator.assertIsNonEmptyString(agentId);
        
        // Get agent data
        const agent = this.agents.get(agentId);
        if (!agent) {
            this.logger.warn(`Attempted to check sockets for non-existent agent ${agentId}`);
            return false;
        }
        
        return agent.socketIds.length > 0;
    }

    /**
     * Check if an agent exists
     * @param agentId - Agent ID
     * @returns True if agent exists, false otherwise
     */
    public agentExists(agentId: string): boolean {
        const validator = createStrictValidator();
        validator.assertIsNonEmptyString(agentId);
        
        return this.agents.has(agentId);
    }

    /**
     * Get agent data
     * @param agentId - Agent ID
     * @returns Agent data if found, null otherwise
     */
    public getAgent(agentId: string): IAgent | null {
        const validator = createStrictValidator();
        validator.assertIsNonEmptyString(agentId);
        
        return this.agents.get(agentId) || null;
    }

    /**
     * Get all registered agents
     * @returns Map of agent IDs to agent data
     */
    public getAllAgents(): Map<string, IAgent> {
        return new Map(this.agents);
    }

    /**
     * Get agent connection status
     * @param agentId - Agent ID
     * @returns Agent status if found, null otherwise
     */
    public getAgentStatus(agentId: string): AgentConnectionStatus | null {
        const validator = createStrictValidator();
        validator.assertIsNonEmptyString(agentId);
        
        const agent = this.agents.get(agentId);
        return agent ? agent.status : null;
    }

    /**
     * Update agent capabilities
     * @param agentId - Agent ID
     * @param capabilities - New capabilities
     * @returns Updated agent data
     */
    public updateAgentCapabilities(agentId: string, capabilities: string[]): IAgent | null {
        const validator = createStrictValidator();
        validator.assertIsNonEmptyString(agentId);
        
        // Get agent data
        const agent = this.agents.get(agentId);
        if (!agent) {
            this.logger.warn(`Attempted to update capabilities for non-existent agent ${agentId}`);
            return null;
        }
        
        // Update capabilities
        agent.capabilities = capabilities;
        
        // Store updated agent data
        this.agents.set(agentId, agent);
        
        
        return agent;
    }

    /**
     * Update agent metadata
     * @param agentId - Agent ID
     * @param metadata - Metadata to update
     * @returns Updated agent data
     */
    public updateAgentMetadata(agentId: string, metadata: Record<string, any>): IAgent | null {
        const validator = createStrictValidator();
        validator.assertIsNonEmptyString(agentId);
        validator.assertIsObject(metadata);
        
        // Get agent data
        const agent = this.agents.get(agentId);
        if (!agent) {
            this.logger.warn(`Attempted to update metadata for non-existent agent ${agentId}`);
            return null;
        }
        
        // Update metadata
        agent.metadata = {
            ...agent.metadata,
            ...metadata
        };
        
        // Store updated agent data
        this.agents.set(agentId, agent);
        
        
        return agent;
    }

    /**
     * Get active agents in a specific channel
     * @param channelId - Channel ID to filter by
     * @returns Array of active agents in the channel
     */
    public async getActiveAgentsInChannel(channelId: string): Promise<IAgent[]> {
        const validator = createStrictValidator();
        validator.assertIsNonEmptyString(channelId);
        
        try {
            // Get participants from ChannelService
            const channelService = ChannelService.getInstance();
            const participantIds = channelService.getChannelParticipants(channelId);
            
            
            if (participantIds.length === 0) {
                this.logger.warn(`No participants found for channel ${channelId}`);
                return [];
            }
            
            const activeAgents: IAgent[] = [];
            
            // Get agents that are both channel participants and connected
            for (const participantId of participantIds) {
                const agent = this.agents.get(participantId);
                
                if (agent && agent.status === AgentConnectionStatus.CONNECTED && agent.socketIds.length > 0) {
                    activeAgents.push(agent);
                } else {
                }
            }
            
            return activeAgents;
            
        } catch (error) {
            this.logger.error(`Error getting active agents for channel ${channelId}: ${error}`);
            return [];
        }
    }

    /**
     * Get all connected agents with capabilities
     * @returns Array of connected agents
     */
    public getConnectedAgents(): IAgent[] {
        const connectedAgents: IAgent[] = [];
        
        for (const agent of this.agents.values()) {
            if (agent.status === AgentConnectionStatus.CONNECTED && agent.socketIds.length > 0) {
                connectedAgents.push(agent);
            }
        }
        
        return connectedAgents;
    }

    /**
     * Get agents by capability
     * @param capability - Capability to filter by
     * @returns Array of agents with the specified capability
     */
    public getAgentsByCapability(capability: string): IAgent[] {
        const validator = createStrictValidator();
        validator.assertIsNonEmptyString(capability);
        
        const capableAgents: IAgent[] = [];
        
        for (const agent of this.agents.values()) {
            if (agent.status === AgentConnectionStatus.CONNECTED && 
                agent.capabilities && 
                agent.capabilities.includes(capability)) {
                capableAgents.push(agent);
            }
        }
        
        return capableAgents;
    }
}
