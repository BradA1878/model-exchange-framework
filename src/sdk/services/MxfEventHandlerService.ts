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
 * Event Handler Service for MxfAgent
 * 
 * Manages all event handling logic for LLM agents, providing immediate
 * tool feedback and contextual responses to various system events.
 */

import { Logger } from '../../shared/utils/Logger';
import { EventBus } from '../../shared/events/EventBus';
import { Events, ControlLoopEvents } from '../../shared/events/EventNames';
import { BaseEventPayload, ControlLoopSpecificData } from '../../shared/schemas/EventPayloadSchema';
import { ConversationHelpers, AgentContext } from '../MxfAgentHelpers';
import { ConversationMessage } from '../../shared/interfaces/ConversationMessage';
import { v4 as uuidv4 } from 'uuid';
import { MxpMiddleware } from '../../shared/middleware/MxpMiddleware';
import { isMxpMessage } from '../../shared/schemas/MxpProtocolSchemas';
// ActionHistoryService removed - action history is now handled at the MxfAgent level
// to maintain proper client/server architectural boundaries

export interface EventHandlerCallbacks {
    addConversationMessage: (message: { role: string; content: string; metadata?: Record<string, any> }) => void;
    provideImmediateToolFeedback: (fromAgentId: string, toolName: string, toolData: any, toolType: string) => Promise<string>;
    generateResponse: (prompt: string, tools?: any[], taskPrompt?: string) => Promise<string>;
    getContextualTools: (conversationHistory: ConversationMessage[], availableTools: any[]) => any[];
    getConversationHistory: () => ConversationMessage[];
    getAvailableTools: () => any[];
    getCurrentTask: () => any;
    isToolGatekeepingDisabled: () => boolean;
    hasActiveTask: () => boolean;
    getAgentCapabilities?: () => string[];
    tryAggregateMessage?: (fromAgent: string, content: string) => boolean;
}

export class MxfEventHandlerService {
    private logger: Logger;
    private agentId: string;
    private callbacks: EventHandlerCallbacks;
    private eventSubscriptions: Array<{ unsubscribe: () => void }> = [];
    private processedMessages: Set<string> = new Set(); // Track processed messages to prevent duplicates
    private recentOutgoingMessages: Map<string, number> = new Map(); // Track recent outgoing messages by target agent
    
    // Event ordering validation for race condition detection
    private eventSequence: Array<{event: string, timestamp: number, agentId: string, eventId: string}> = [];
    private readonly EVENT_SEQUENCE_WINDOW_MS = 5000; // 5 seconds
    private readonly MAX_CONCURRENT_EVENTS = 10; // Max concurrent events to consider a race condition (increased from 3)
    private readonly RACE_DETECTION_WINDOW_MS = 1000; // Detect race conditions within 500ms (reduced from 1000ms)

    constructor(agentId: string, callbacks: EventHandlerCallbacks) {
        this.agentId = agentId;
        this.callbacks = callbacks;
        this.logger = new Logger('debug', `EventHandler:${agentId}`, 'client');
    }



    /**
     * Initialize all event handlers for the agent
     */
    public initializeEventHandlers(): void {

        // Handle control loop events
        this.subscribeToEvent(ControlLoopEvents.OBSERVATION, this.handleObservationEvent.bind(this));
        this.subscribeToEvent(ControlLoopEvents.REASONING, this.handleReasoningEvent.bind(this));
        this.subscribeToEvent(ControlLoopEvents.PLAN, this.handlePlanEvent.bind(this));
        this.subscribeToEvent(ControlLoopEvents.ACTION, this.handleActionEvent.bind(this));

        // Handle message events that should trigger agent responses
        this.subscribeToEvent(Events.Message.AGENT_MESSAGE, this.handleEventRequiringResponse.bind(this));
        this.subscribeToEvent(Events.Message.CHANNEL_MESSAGE, this.handleEventRequiringResponse.bind(this));
        
        // Handle message errors to provide feedback to agents
        this.subscribeToEvent(Events.Message.MESSAGE_ERROR, this.handleMessageError.bind(this));
        
        // Track outgoing messages from this agent for context coordination
        this.subscribeToEvent(Events.Message.AGENT_MESSAGE, this.trackOutgoingMessages.bind(this));

        // Skip task events - they are handled by TaskHandlers and TaskExecutionManager
        // Task events should NOT be added to conversation history

        // Handle agent events that should trigger responses
        this.subscribeToEvent(Events.Agent.JOINED_CHANNEL, this.handleEventRequiringResponse.bind(this));
        this.subscribeToEvent(Events.Agent.LEFT_CHANNEL, this.handleEventRequiringResponse.bind(this));
        this.subscribeToEvent(Events.Agent.ERROR, this.handleEventRequiringResponse.bind(this));
        this.subscribeToEvent(Events.Agent.STATUS_CHANGE, this.handleEventRequiringResponse.bind(this));
        this.subscribeToEvent(Events.Agent.DISCOVERY_RESPONSE, this.handleEventRequiringResponse.bind(this));

        // Handle system events that should trigger responses  
        this.subscribeToEvent(Events.System.COORDINATION_HINT, this.handleEventRequiringResponse.bind(this));
        this.subscribeToEvent(Events.System.ACTIVITY_ALERT, this.handleEventRequiringResponse.bind(this));
        this.subscribeToEvent(Events.System.COORDINATION_OPPORTUNITY, this.handleEventRequiringResponse.bind(this));
        this.subscribeToEvent(Events.System.PATTERN_RECOGNITION, this.handleEventRequiringResponse.bind(this));

        // Handle memory events that might require attention
        this.subscribeToEvent(Events.Memory.UPDATE_RESULT, this.handleEventRequiringResponse.bind(this));
        this.subscribeToEvent(Events.Memory.UPDATE_ERROR, this.handleEventRequiringResponse.bind(this));
        this.subscribeToEvent(Events.Memory.CREATE_ERROR, this.handleEventRequiringResponse.bind(this));

    }

    /**
     * Subscribe to an event and track the subscription for cleanup
     */
    private subscribeToEvent(eventName: string, handler: (payload: any) => void): void {
        const subscription = EventBus.client.on(eventName, handler);
        this.eventSubscriptions.push(subscription);
    }

    /**
     * Handle observation events from the control loop
     */
    private handleObservationEvent(event: any): void {
        if (!event || !event.data) return;
        
        // Note: Observation handling logic would be moved here from MxfAgent
        // For now, this is a placeholder that shows the pattern
    }

    /**
     * Handle reasoning events from the control loop
     */
    private handleReasoningEvent(event: any): void {
        if (!event || !event.data) return;
        
        // Note: Reasoning handling logic would be moved here from MxfAgent
    }

    /**
     * Handle plan events from the control loop
     */
    private handlePlanEvent(event: any): void {
        if (!event || !event.data) return;
        
        // Note: Plan handling logic would be moved here from MxfAgent
    }

    /**
     * Handle action events from the control loop
     */
    private handleActionEvent(payload: BaseEventPayload<ControlLoopSpecificData>): void {
        const action = payload.data?.action;
        const status = payload.data?.status;
        const loopId = payload.data?.loopId;
        
        // Note: Action handling logic would be moved here from MxfAgent
    }

    /**
     * Handle events that should trigger agent responses
     */
    private async handleEventRequiringResponse(payload: BaseEventPayload<any>): Promise<void> {
        try {
            // Validate payload structure
            if (!payload || !payload.data) {
                this.logger.warn('Received event with invalid payload');
                return;
            }

            const eventData = payload.data;
            const eventType = payload.eventType || 'unknown';
            
            // Validate event ordering for race condition detection
            const sourceAgentId = payload.agentId || 'unknown';
            this.validateEventOrdering(eventType, sourceAgentId);
            
            let shouldRespond = false;
            let messageContent = '';
            let messageMetadata: any = {};

            // Handle different event types
            if (eventType === Events.Message.AGENT_MESSAGE) {
                await this.handleAgentMessage(eventData, payload);
                return; // Early return for immediate feedback pattern
                
            } else if (eventType === Events.Message.CHANNEL_MESSAGE) {
                await this.handleChannelMessage(eventData, payload);
                return; // Early return for immediate feedback pattern
                
            } else if (this.isTaskEvent(eventType)) {
                // Handle task events with proper role assignment for conversation context
                await this.handleTaskEvent(eventData, payload, eventType);
                return;
                
            } else if (this.isSystemEvent(eventType)) {
                // Handle system intelligence events
                shouldRespond = true;
                messageContent = `System event (${String(eventType)}): ${eventData.content || JSON.stringify(eventData)}`;
                messageMetadata = {
                    messageType: 'system-event',
                    eventType: String(eventType),
                    timestamp: payload.timestamp || Date.now()
                };
                
            } else {
                // Handle other event types
                if (!String(eventType).includes('memory:update')) {
                    //;
                }
                return; // Don't process other events for now
            }
            
            // If this event requires a response, process it
            if (shouldRespond) {
                await this.processEventResponse(messageContent, messageMetadata, eventType);
            }

        } catch (error) {
            this.logger.error(`Error handling event requiring response: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Handle agent message events with immediate feedback
     */
    private async handleAgentMessage(eventData: any, payload: BaseEventPayload<any>): Promise<void> {
        // Process agent messages targeted to this agent
        if (eventData.receiverId !== this.agentId) {
            return; // Not targeted to this agent
        }
        
        // Create a unique message ID for deduplication
        const messageId = eventData.messageId || `${eventData.senderId}-${eventData.timestamp}-${JSON.stringify(eventData.content).substring(0, 50)}`;
        
        // Check if we've already processed this message
        if (this.processedMessages.has(messageId)) {
            //;
            return;
        }
        
        // Mark this message as processed
        this.processedMessages.add(messageId);
        
        // Clean up old processed messages (keep only last 100)
        if (this.processedMessages.size > 100) {
            const messagesToDelete = Array.from(this.processedMessages).slice(0, this.processedMessages.size - 100);
            messagesToDelete.forEach(id => this.processedMessages.delete(id));
        }
        
        // Check if there's an active task - if not, skip immediate feedback to prevent post-completion loops
        if (!this.callbacks.hasActiveTask()) {
            return;
        }
        
        
        // Check if we recently sent a message to this agent (context coordination)
        const recentMessageTime = this.recentOutgoingMessages.get(eventData.senderId);
        const timeSinceLastMessage = recentMessageTime ? Date.now() - recentMessageTime : Infinity;
        
        // Skip immediate feedback if we just sent a message to this agent (within 5 seconds)
        if (timeSinceLastMessage < 5000) {
            return;
        }
        
        // Process MXP messages if applicable
        let processedEventData = eventData;
        if (isMxpMessage(eventData.content)) {
            try {
                // Process incoming MXP message
                const processed = await MxpMiddleware.processIncoming(eventData.content);
                processedEventData = {
                    ...eventData,
                    content: processed
                };
                
                // For MXP-capable agents, preserve the structured format
                // Only convert to natural language for non-MXP agents
                if (isMxpMessage(processed)) {
                    const agentCapabilities = this.callbacks.getAgentCapabilities?.() || [];
                    const isMxpCapable = agentCapabilities.includes('mxp-protocol') || 
                                        agentCapabilities.includes('calculation');
                    
                    if (!isMxpCapable) {
                        // Convert to natural language for non-MXP agents
                        const naturalLanguage = MxpMiddleware.mxpToNaturalLanguage(processed);
                        processedEventData.content = naturalLanguage;
                        processedEventData.metadata = {
                            ...processedEventData.metadata,
                            mxpOriginal: processed,
                            mxpFormat: true,
                            mxpConverted: true
                        };
                    } else {
                        // Keep structured format for MXP-capable agents
                        processedEventData.metadata = {
                            ...processedEventData.metadata,
                            mxpFormat: true,
                            mxpStructured: true
                        };
                    }
                }
                
            } catch (error) {
                this.logger.warn(`Failed to process MXP message: ${error}`);
                // Continue with original data
            }
        }
        
        // Create immediate feedback prompt
        const toolUsedForMessage = processedEventData.metadata?.toolName || 'messaging_send';
        const senderAgentId = processedEventData.senderId;
        const messageData = typeof processedEventData.content?.data === 'string' 
            ? processedEventData.content.data 
            : typeof processedEventData.content === 'string'
            ? processedEventData.content
            : JSON.stringify(processedEventData.content?.data || processedEventData.content);
        
        // Detect message source type for proper role assignment
        const messageSource = this.detectMessageSource(processedEventData, senderAgentId);
        
        // Use structured message creation
        const { MxfStructuredPromptBuilder } = await import('./MxfStructuredPromptBuilder');
        const dialogueMessage = MxfStructuredPromptBuilder.createDialogueMessage(
            'received',
            senderAgentId,  // Who sent it
            this.agentId,   // Who received it (this agent)
            messageData,    // The actual message content
            messageSource   // Source information for role detection
        );
        
        // Add metadata for tracking
        dialogueMessage.metadata = {
            ...dialogueMessage.metadata,
            receivedAt: Date.now(),
            fromAgentId: senderAgentId
        };
        
        // Check if message should be aggregated instead of processed immediately
        if (this.callbacks.tryAggregateMessage) {
            const wasAggregated = this.callbacks.tryAggregateMessage(senderAgentId, messageData);
            if (wasAggregated) {
                return; // Skip immediate processing
            }
        }
        
        // Add the clean dialogue message to conversation history
        this.callbacks.addConversationMessage(dialogueMessage);
        
        // Skip immediate feedback if agent is messaging itself (tool execution in progress)
        // This prevents race conditions where feedback is triggered before tool results are added
        if (senderAgentId === this.agentId) {
            return;
        }
        
        // Provide immediate feedback
        
        try {
            const response = await this.callbacks.provideImmediateToolFeedback(
                senderAgentId, 
                toolUsedForMessage, 
                messageData, 
                'agent message'
            );
            
        } catch (error) {
            this.logger.error(`❌ IMMEDIATE FEEDBACK ERROR: Failed to process ${toolUsedForMessage} from ${senderAgentId}: ${error}`);
        }
    }
    
    /**
     * Track outgoing messages from this agent for context coordination
     */
    private trackOutgoingMessages(payload: any): void {
        if (!payload || !payload.data) return;
        
        const eventData = payload.data;
        
        // Only track messages sent BY this agent (not TO this agent)
        if (eventData.senderId === this.agentId && eventData.receiverId !== this.agentId) {
            const targetAgentId = eventData.receiverId;
            const timestamp = Date.now();
            
            // Record when we sent a message to this target agent
            this.recentOutgoingMessages.set(targetAgentId, timestamp);
            
            //;
            
            // Clean up old entries (keep only last 10 minutes)
            const cutoffTime = timestamp - (10 * 60 * 1000);
            for (const [agentId, time] of this.recentOutgoingMessages.entries()) {
                if (time < cutoffTime) {
                    this.recentOutgoingMessages.delete(agentId);
                }
            }
        }
    }

    /**
     * Handle channel message events with immediate feedback
     */
    private async handleChannelMessage(eventData: any, payload: BaseEventPayload<any>): Promise<void> {
        // Process channel messages from other agents (not from self)
        if (eventData.senderId === this.agentId) {
            return; // Don't respond to our own messages
        }
        
        // Special handling for SystemLLM messages - add to history but don't trigger immediate response
        if (eventData.senderId === 'system' && eventData.context?.source === 'SystemLlmService') {
            
            // Add SystemLLM message to conversation history with proper prefix
            // It will be included in context for the next real message but won't trigger immediate response
            this.callbacks.addConversationMessage({
                role: 'user',
                content: `SYSTEM: ${eventData.content?.data || eventData.content}\n\n[Note: This is ephemeral coordination metadata from SystemLLM. Do not respond to this directly.]`,
                metadata: {
                    messageType: 'systemllm-coordination',
                    source: 'SystemLlmService',
                    coordinationType: eventData.context?.coordinationType,
                    ephemeral: true,
                    isSystemLLM: true,
                    doNotTriggerResponse: true,
                    timestamp: payload.timestamp || Date.now()
                }
            });
            
            return; // Don't trigger immediate response for SystemLLM messages
        }
        
        // Check if this agent should react to channel messages
        // Agents marked as 'reactive' or 'passive' in task context should not respond to general channel messages
        if (this.shouldIgnoreChannelMessage(eventData, payload)) {
            return;
        }
        
        // Process MXP messages if applicable
        let processedEventData = eventData;
        if (isMxpMessage(eventData.content)) {
            try {
                // Process incoming MXP message
                const processed = await MxpMiddleware.processIncoming(eventData.content);
                processedEventData = {
                    ...eventData,
                    content: processed
                };
                
                // For MXP-capable agents, preserve the structured format
                // Only convert to natural language for non-MXP agents
                if (isMxpMessage(processed)) {
                    const agentCapabilities = this.callbacks.getAgentCapabilities?.() || [];
                    const isMxpCapable = agentCapabilities.includes('mxp-protocol') || 
                                        agentCapabilities.includes('calculation');
                    
                    if (!isMxpCapable) {
                        // Convert to natural language for non-MXP agents
                        const naturalLanguage = MxpMiddleware.mxpToNaturalLanguage(processed);
                        processedEventData.content = naturalLanguage;
                        processedEventData.metadata = {
                            ...processedEventData.metadata,
                            mxpOriginal: processed,
                            mxpFormat: true,
                            mxpConverted: true
                        };
                    } else {
                        // Keep structured format for MXP-capable agents
                        processedEventData.metadata = {
                            ...processedEventData.metadata,
                            mxpFormat: true,
                            mxpStructured: true
                        };
                    }
                }
                
            } catch (error) {
                this.logger.warn(`Failed to process MXP channel message: ${error}`);
                // Continue with original data
            }
        }
        
        // Create immediate feedback prompt
        const toolUsedForMessage = processedEventData.metadata?.toolName || 'messaging_broadcast';
        const senderAgentId = processedEventData.senderId;
        const channelId = payload.channelId || 'unknown-channel';
        const messageData = typeof processedEventData.content?.data === 'string' 
            ? processedEventData.content.data 
            : typeof processedEventData.content === 'string'
            ? processedEventData.content
            : JSON.stringify(processedEventData.content?.data || processedEventData.content);
        
        const immediatePrompt = `🎯 CHANNEL NOTIFICATION: Agent "${senderAgentId}" sent a message to channel "${channelId}" using "${toolUsedForMessage}": "${messageData}". Please review this channel message and decide how to respond or proceed.`;
        
        const messageMetadata = {
            messageType: 'channel-message-immediate',
            fromAgentId: senderAgentId,
            toolUsed: toolUsedForMessage,
            channelId: channelId,
            originalMessageId: eventData.metadata?.messageId,
            timestamp: payload.timestamp || Date.now()
        };
        
        // Check if message should be aggregated instead of processed immediately
        if (this.callbacks.tryAggregateMessage) {
            const wasAggregated = this.callbacks.tryAggregateMessage(senderAgentId, messageData);
            if (wasAggregated) {
                return; // Skip immediate processing
            }
        }
        
        // Add detailed context to conversation
        this.callbacks.addConversationMessage({
            role: 'user',
            content: immediatePrompt,
            metadata: messageMetadata
        });
        
        // Provide immediate feedback
        
        try {
            const response = await this.callbacks.provideImmediateToolFeedback(
                senderAgentId, 
                toolUsedForMessage, 
                messageData, 
                'channel message'
            );
            
        } catch (error) {
            this.logger.error(`❌ CHANNEL FEEDBACK ERROR: Failed to process channel message from ${senderAgentId}: ${error}`);
        }
    }

    /**
     * Process event response using available tools
     */
    private async processEventResponse(messageContent: string, messageMetadata: any, eventType: string): Promise<void> {
        // Add the event to conversation history as a user message
        this.callbacks.addConversationMessage({
            role: 'user',
            content: messageContent,
            metadata: messageMetadata
        });

        // Get available tools for response generation
        const availableTools = this.callbacks.getAvailableTools();
        if (!availableTools || availableTools.length === 0) {
            this.logger.error('No tools available - cannot generate contextual response to event');
            return;
        }

        // Apply MXP context compression for token optimization (if agent supports MXP)
        let conversationHistory = this.callbacks.getConversationHistory();
        const agentCapabilities = this.callbacks.getAgentCapabilities?.() || [];
        const isMxpEnabled = agentCapabilities.includes('mxp-protocol') || 
                           agentCapabilities.includes('mxp-enabled');
        
        if (isMxpEnabled) {
            conversationHistory = this.compressContextForLLM(conversationHistory);
        }

        // Get contextual tools for the response
        const contextualTools = this.callbacks.getContextualTools(
            conversationHistory, 
            availableTools
        );

        // Automatically generate a response to the event
        try {
            const response = await this.callbacks.generateResponse(messageContent, contextualTools);
        } catch (error) {
            this.logger.error(`❌ Error generating response to ${String(eventType)}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Compress conversation context for LLM to reduce token usage via MXP
     * Only applies when agent has MXP enabled - provides significant token savings
     */
    private compressContextForLLM(conversationHistory: ConversationMessage[]): ConversationMessage[] {
        // Import shared state service for state references
        const { sharedStateService } = require('../../shared/services/SharedStateService');
        
        return conversationHistory.map((msg, index) => {
            // Skip recent messages to maintain immediate context
            if (index >= conversationHistory.length - 3) {
                return msg; // Keep last 3 messages uncompressed
            }
            
            // Safely extract content with proper type handling
            const content = typeof msg.content === 'string' ? msg.content : 
                           (msg.content && typeof msg.content === 'object' && 'data' in msg.content) ? 
                           (msg.content as any).data : JSON.stringify(msg.content);
            
            // Try to convert verbose collaboration messages to structured format
            if (this.isCollaborationMessage(content)) {
                try {
                    // Use MXP operation detection for token optimization
                    const { detectOperation } = require('../../shared/schemas/MxpProtocolSchemas');
                    const operation = detectOperation(content);
                    
                    if (operation && operation.confidence > 0.7) {
                        // Create a compressed representation
                        const compressedContent = `[MXP: ${operation.op}] - ${content.substring(0, 50)}${content.length > 50 ? '...' : ''}`;
                        
                        return {
                            ...msg,
                            content: compressedContent,
                            metadata: {
                                ...msg.metadata,
                                mxpCompressed: true,
                                mxpOperation: operation.op,
                                originalLength: content.length,
                                compressedLength: compressedContent.length,
                                tokenSavings: Math.round(((content.length - compressedContent.length) / content.length) * 100)
                            }
                        };
                    }
                } catch (error) {
                }
            }
            
            // Check for state reference opportunities
            if (this.containsStateReference(content)) {
                // Generate a state ID for this context if it doesn't exist
                const stateId = `ctx_${Date.now().toString(36)}_${Math.random().toString(36).substr(2, 6)}`;
                
                // Store the full context in shared state
                sharedStateService.storeState(
                    stateId,
                    { originalContent: content, messageIndex: index },
                    (msg.metadata as any)?.channelId || 'unknown',
                    this.agentId,
                    'Compressed conversation context'
                );
                
                // Replace with state reference
                const referenceContent = `[MXP State Ref: ${stateId}] - Previous context (${content.length} chars compressed)`;
                return {
                    ...msg,
                    content: referenceContent,
                    metadata: {
                        ...msg.metadata,
                        mxpStateReference: stateId,
                        mxpCompressed: true,
                        originalLength: content.length,
                        compressedLength: referenceContent.length,
                        compressionRatio: Math.round(((content.length - referenceContent.length) / content.length) * 100)
                    }
                };
            }
            
            return msg; // Return uncompressed if no optimization possible
        });
    }

    /**
     * Check if message is a collaboration-related message that can be compressed
     */
    private isCollaborationMessage(content: string): boolean {
        const collaborationPatterns = [
            /\b(let's|let us)\b.*\b(work together|collaborate|cooperate)\b/i,
            /\b(we should|we could|we need to)\b/i,
            /\b(based on our discussion|as we discussed|from our conversation)\b/i,
            /\b(I suggest|I propose|I recommend)\b.*\b(we|us)\b/i,
            /\b(delegate|assign|hand off)\b.*\b(task|work|responsibility)\b/i
        ];
        
        return collaborationPatterns.some(pattern => pattern.test(content));
    }

    /**
     * Check if message contains references to previous context that can be state-managed
     */
    private containsStateReference(content: string): boolean {
        const referencePatterns = [
            /\b(based on|referring to|as mentioned|as discussed)\b.*\b(earlier|before|previously|above)\b/i,
            /\b(from our previous|from the earlier|in the last)\b.*\b(conversation|discussion|message)\b/i,
            /\b(as I said|as you said|as we established)\b/i,
            /\b(building on|following up on|continuing from)\b/i
        ];
        
        return content.length > 200 && // Only compress longer messages
               referencePatterns.some(pattern => pattern.test(content));
    }

    /**
     * Check if event type is a task event
     */
    private isTaskEvent(eventType: string): boolean {
        const eventStr = String(eventType);
        return eventStr.startsWith('task:') || 
               eventStr.includes('TASK_') ||
               eventType === Events.Task.REQUEST ||
               eventType === Events.Task.RESPONSE ||
               eventType === Events.Task.STARTED ||
               eventType === Events.Task.COMPLETED ||
               eventType === Events.Task.FAILED ||
               eventType === Events.Task.CANCELLED ||
               eventType === Events.Task.PROGRESS_UPDATED ||
               eventType === Events.Task.REASSIGNED ||
               eventType === Events.Task.DEPENDENCY_RESOLVED ||
               eventType === Events.Task.BLOCKING_CLEARED ||
               eventType === Events.Task.LATE_AGENT_JOINED;
    }

    /**
     * Check if event type is a system event
     */
    private isSystemEvent(eventType: string): boolean {
        return eventType === Events.System.COORDINATION_HINT || 
               eventType === Events.System.ACTIVITY_ALERT ||
               eventType === Events.System.COORDINATION_OPPORTUNITY ||
               eventType === Events.System.PATTERN_RECOGNITION;
    }

    /**
     * Validate event ordering to detect potential race conditions
     */
    private validateEventOrdering(eventType: string, sourceAgentId: string): void {
        const timestamp = Date.now();
        const eventId = uuidv4();
        
        // Add current event to sequence
        this.eventSequence.push({
            event: eventType,
            timestamp,
            agentId: sourceAgentId,
            eventId
        });
        
        // Clean up old events outside the window
        this.eventSequence = this.eventSequence.filter(
            e => timestamp - e.timestamp <= this.EVENT_SEQUENCE_WINDOW_MS
        );
        
        // Check for potential race conditions (excluding expected concurrent operations)
        const recentEvents = this.eventSequence.filter(
            e => timestamp - e.timestamp < this.RACE_DETECTION_WINDOW_MS && e.agentId !== this.agentId
        );
        
        // Filter out expected concurrent events that don't indicate problems
        const concerningEvents = recentEvents.filter(e => 
            !e.event.includes('memory:update:result') &&  // Memory operations are expected to be concurrent
            !e.event.includes('agent:status:change') &&   // Status changes during connection are normal
            !e.event.includes('agent:connect')            // Connection events are expected to overlap
        );
        
        if (concerningEvents.length >= this.MAX_CONCURRENT_EVENTS) {
            //     `🏁 RACE CONDITION DETECTED: ${concerningEvents.length} concerning concurrent events while processing ${eventType} from ${sourceAgentId}. ` +
            //     `Events: ${concerningEvents.map(e => `${e.agentId}:${e.event}`).join(', ')}`
            // );
        } else if (recentEvents.length >= this.MAX_CONCURRENT_EVENTS * 2) {
            // Log high concurrent activity but at debug level for expected events
            // ;
        }
        
        // ;
    }

    /**
     * Get event ordering statistics
     */
    public getEventOrderingStats(): {
        recentEventsCount: number;
        eventFrequencyByAgent: Record<string, number>;
        eventFrequencyByType: Record<string, number>;
        potentialRaceConditions: number;
    } {
        const now = Date.now();
        const recentEvents = this.eventSequence.filter(
            e => now - e.timestamp <= this.EVENT_SEQUENCE_WINDOW_MS
        );
        
        const byAgent = recentEvents.reduce((acc, event) => {
            acc[event.agentId] = (acc[event.agentId] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);
        
        const byType = recentEvents.reduce((acc, event) => {
            acc[event.event] = (acc[event.event] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);
        
        // Count potential race conditions (events within 1 second of each other)
        let raceConditions = 0;
        for (let i = 0; i < recentEvents.length - 1; i++) {
            const current = recentEvents[i];
            const next = recentEvents[i + 1];
            if (Math.abs(current.timestamp - next.timestamp) < 1000 && current.agentId !== next.agentId) {
                raceConditions++;
            }
        }
        
        return {
            recentEventsCount: recentEvents.length,
            eventFrequencyByAgent: byAgent,
            eventFrequencyByType: byType,
            potentialRaceConditions: raceConditions
        };
    }

    /**
     * Cleanup all event subscriptions
     */
    public cleanup(): void {
        
        for (const subscription of this.eventSubscriptions) {
            try {
                subscription.unsubscribe();
            } catch (error) {
                this.logger.warn(`Error unsubscribing from event: ${error}`);
            }
        }
        
        this.eventSubscriptions = [];
    }
    
    /**
     * Determine if agent should ignore channel messages based on task role
     * @private
     */
    private shouldIgnoreChannelMessage(eventData: any, payload: BaseEventPayload<any>): boolean {
        // Check if agent has an active task
        const currentTask = this.callbacks.getCurrentTask?.();
        if (!currentTask) {
            // No active task, process channel messages normally
            return false;
        }
        
        // Check task metadata for agent roles
        const agentRoles = currentTask.metadata?.agentRoles || {};
        const agentRole = agentRoles[this.agentId];
        
        // If agent is marked as reactive/passive, ignore general channel messages
        if (agentRole === 'reactive' || agentRole === 'passive') {
            // Exception: Always process system messages (SystemLLM coordination hints)
            if (eventData.senderId === 'system' || 
                eventData.context?.systemGenerated === true ||
                eventData.context?.source === 'SystemLlmService') {
                // System messages provide coordination context and should always be processed
                return false;
            }
            
            // Exception: Still respond if message mentions this agent specifically
            const messageContent = eventData.content?.toLowerCase() || '';
            const agentIdLower = this.agentId.toLowerCase();
            
            // Check if message is directed at or mentions this agent
            if (messageContent.includes(agentIdLower) || 
                messageContent.includes(`@${agentIdLower}`) ||
                eventData.metadata?.targetAgentId === this.agentId ||
                eventData.metadata?.mentionedAgents?.includes(this.agentId)) {
                // Message is relevant to this agent, don't ignore
                return false;
            }
            
            // Ignore general channel messages when in reactive/passive role
            return true;
        }
        
        // By default, process channel messages
        return false;
    }

    /**
     * Detect message source type for proper conversation role assignment
     * @private
     */
    private detectMessageSource(eventData: any, senderAgentId: string): {
        sourceType: 'agent' | 'system' | 'task' | 'memory' | 'context';
        sourceName?: string;
        taskEvent?: string;
    } {
        // Check for system messages
        if (senderAgentId === 'system' || 
            eventData.context?.systemGenerated === true ||
            eventData.context?.source === 'SystemLlmService') {
            return {
                sourceType: 'system',
                sourceName: eventData.context?.source || 'system'
            };
        }

        // Check for task-related messages by examining metadata or content
        if (eventData.metadata?.taskEvent || 
            eventData.metadata?.source === 'TaskService' ||
            eventData.context?.source === 'TaskService') {
            return {
                sourceType: 'task',
                sourceName: 'TaskService',
                taskEvent: eventData.metadata?.taskEvent || 'unknown'
            };
        }

        // Check for memory/context updates
        if (eventData.metadata?.source === 'MemoryService' ||
            eventData.context?.source === 'MemoryService' ||
            senderAgentId.includes('memory') ||
            senderAgentId.includes('context')) {
            return {
                sourceType: eventData.context?.source?.includes('Memory') ? 'memory' : 'context',
                sourceName: eventData.context?.source || 'MemoryService'
            };
        }

        // Default to agent-to-agent communication
        return {
            sourceType: 'agent',
            sourceName: senderAgentId
        };
    }

    /**
     * Handle task events with proper role assignment
     * @private
     */
    private async handleTaskEvent(eventData: any, payload: BaseEventPayload<any>, eventType: string): Promise<void> {
        // Create message content from task event
        let taskContent = '';
        let shouldTriggerResponse = false;

        // Determine content and response behavior based on task event type
        if (eventType.includes('CREATE_REQUEST') || eventType.includes('STARTED')) {
            // Initial task - should trigger LLM response
            taskContent = `New task assigned: ${eventData.task?.title || eventData.task?.description || 'Task details in description'}`;
            if (eventData.task?.description) {
                taskContent += `\n\nTask Description:\n${eventData.task.description}`;
            }
            shouldTriggerResponse = true;
        } else if (eventType.includes('COMPLETED') || eventType.includes('FAILED')) {
            // Task completion - should trigger final LLM acknowledgment
            taskContent = `Task ${eventType.includes('COMPLETED') ? 'completed' : 'failed'}: ${eventData.summary || eventData.task?.title || 'Task finished'}`;
            shouldTriggerResponse = true;
        } else {
            // Task updates - add to context but don't trigger response
            taskContent = `Task update (${eventType}): ${eventData.summary || eventData.status || JSON.stringify(eventData).substring(0, 200)}`;
            shouldTriggerResponse = false;
        }

        // Create dialogue message with task source
        const { MxfStructuredPromptBuilder } = await import('./MxfStructuredPromptBuilder');
        const dialogueMessage = MxfStructuredPromptBuilder.createDialogueMessage(
            'received',
            'TaskService', // Sender
            this.agentId,  // Receiver
            taskContent,   // Content
            {
                sourceType: 'task',
                sourceName: 'TaskService', 
                taskEvent: eventType
            }
        );

        // Always add to conversation history for context
        this.callbacks.addConversationMessage(dialogueMessage);
        
        // Only trigger LLM response for initial task and completion
        if (shouldTriggerResponse) {
            try {
                const response = await this.callbacks.provideImmediateToolFeedback(
                    'TaskService',
                    'task_event',
                    taskContent,
                    `task event: ${eventType}`
                );
            } catch (error) {
                this.logger.error(`❌ TASK RESPONSE ERROR: Failed to process ${eventType}: ${error}`);
            }
        } else {
        }
    }

    /**
     * Handle message error events - provides feedback to agents for validation failures
     */
    private async handleMessageError(payload: BaseEventPayload): Promise<void> {
        try {
            // Check if this error is for this agent
            if (payload.agentId !== this.agentId) {
                return;
            }

            this.logger.warn(`📨 MESSAGE ERROR: Received validation error: ${payload.data?.error}`);

            // Add error feedback to conversation history with 'system' role
            const errorMessage = {
                role: 'system', 
                content: `❌ Message Error: ${payload.data?.error || 'Unknown message validation error'}${payload.data?.guidance ? `\n\n💡 Guidance: ${payload.data.guidance}` : ''}`,
                metadata: {
                    messageType: 'error_feedback',
                    errorType: payload.data?.errorType || 'validation_error',
                    timestamp: Date.now(),
                    fromAgentId: 'system'
                }
            };

            this.callbacks.addConversationMessage(errorMessage);

            // CRITICAL: Trigger a new response so the agent can see the error and correct its behavior
            // Without this, the error just sits in conversation history but never gets sent to the LLM
            if (this.callbacks.hasActiveTask && this.callbacks.hasActiveTask()) {
                await this.processEventResponse(`Please correct your previous message based on the error feedback above.`, {
                    messageType: 'error_correction_trigger',
                    errorType: payload.data?.errorType || 'validation_error',
                    timestamp: Date.now()
                }, 'message_error_feedback');
            }

        } catch (error) {
            this.logger.error(`Error handling MESSAGE_ERROR event: ${error}`);
        }
    }

}