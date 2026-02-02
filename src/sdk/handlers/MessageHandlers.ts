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
 * Handlers for Message-related events
 */

import { Events, ChannelActionTypes, AgentMessageEvent } from '../../shared/events/EventNames'; 
import { EventBus } from '../../shared/events/EventBus';
import { Handler } from './Handler';
import { Subscription } from 'rxjs';
import { 
    AgentMessage, 
    createAgentMessage, 
    ContentFormat 
} from '../../shared/schemas/MessageSchemas';
import { 
    AgentMessageEventPayload,
    createAgentMessageEventPayload 
} from '../../shared/schemas/EventPayloadSchema';
import { AgentEvents } from '../../shared/events/event-definitions/AgentEvents';
import { v4 as uuidv4 } from 'uuid';
import { MxpMiddleware } from '../../shared/middleware/MxpMiddleware';
import { isMxpMessage } from '../../shared/schemas/MxpProtocolSchemas';
import { IInternalChannelService } from '../services/MxfService';

export class MessageHandlers extends Handler {
    private agentId: string;
    private channelId: string; // channelId is required and validated in constructor
    
    // Track subscribed channels
    private subscribedChannels: Map<string, boolean> = new Map();
    
    // Store subscriptions for proper cleanup
    private subscriptions: Subscription[] = [];
    
    // MXP Configuration
    private mxpConfig = {
        enabled: process.env.MXP_ENABLED === 'true', // Default to false - MXP must be explicitly enabled
        preferredFormat: 'auto' as 'auto' | 'mxp' | 'natural-language',
        forceEncryption: false
    };
    
    /**
     * Create new message event handlers
     * 
     * @param channelId Channel ID the agent belongs to
     * @param agentId Agent ID that owns this handler
     */
    constructor(channelId: string, agentId: string) {
        super(`MessageHandlers:${agentId}`);
        this.channelId = channelId;
        this.agentId = agentId;
        
        // Validate constructor parameters
        this.validator.assertIsNonEmptyString(channelId);
        this.validator.assertIsNonEmptyString(agentId);
        
        this.setupAgentMessageHandler();
    }
    
    /**
     * Initialize message event handlers
     */
    private initialize(): void {
    }
    
    /**
     * Update MXP configuration
     * 
     * @param config MXP configuration options
     */
    public updateMxpConfig(config: {
        enabled?: boolean;
        preferredFormat?: 'auto' | 'mxp' | 'natural-language';
        forceEncryption?: boolean;
    }): void {
        if (config.enabled !== undefined) {
            this.mxpConfig.enabled = config.enabled;
        }
        if (config.preferredFormat !== undefined) {
            this.mxpConfig.preferredFormat = config.preferredFormat;
        }
        if (config.forceEncryption !== undefined) {
            this.mxpConfig.forceEncryption = config.forceEncryption;
        }
        
    }
    
    /**
     * Clean up event handlers when shutting down
     */
    public cleanup(): void {
        this.subscriptions.forEach(sub => sub.unsubscribe());
        this.subscriptions = [];
    }
    
    /**
     * Mark a channel as subscribed
     * 
     * @param channelId Channel ID that was subscribed to
     */
    private addSubscribedChannel(channelId: string): void {
        this.validator.assertIsNonEmptyString(channelId);
        this.subscribedChannels.set(channelId, true);
    }
    
    /**
     * Mark a channel as unsubscribed
     * 
     * @param channelId Channel ID that was unsubscribed from
     */
    private removeSubscribedChannel(channelId: string): void {
        this.validator.assertIsNonEmptyString(channelId);
        this.subscribedChannels.delete(channelId);
    }
    
    /**
     * Check if a channel is subscribed
     * 
     * @param channelId Channel ID to check
     * @returns true if the channel is subscribed
     */
    private isChannelSubscribed(channelId: string): boolean {
        this.validator.assertIsNonEmptyString(channelId);
        return this.subscribedChannels.has(channelId);
    }
    
    /**
     * Get all subscribed channel IDs
     * 
     * @returns Array of subscribed channel IDs
     */
    private getSubscribedChannels(): string[] {
        return Array.from(this.subscribedChannels.keys());
    }
    
    /**
     * Send a channel message
     * 
     * @param channelId The channel ID to send the message to
     * @param type The type of message to send
     * @param content The message content
     * @param channelService The channel service to use for sending the message
     * @returns Promise that resolves to true if the message was sent successfully
     */
    public async sendChannelMessage(
        channelId: string, 
        type: string, 
        content: any,
        channelService: IInternalChannelService & { sendMessage: Function }
    ): Promise<boolean> {
        this.validator.assertIsNonEmptyString(channelId);
        this.validator.assertIsNonEmptyString(type);
        this.validator.assertIsObject(channelService);
        this.validator.assertIsFunction(channelService.sendMessage);
        
        // Ensure we have the proper context structure for the message schema
        const messageContext = {
            channelId: channelId,
        };
        
        // Check if we're subscribed to the channel
        if (!this.isChannelSubscribed(channelId)) {
            throw new Error(`Cannot send message: Not subscribed to channel ${channelId}`);
        }
        
        // Process through MXP middleware if enabled
        let processedContent = content;
        if (this.mxpConfig.enabled) {
            try {
                // Check if we should convert to MXP
                const shouldConvert = this.mxpConfig.preferredFormat === 'mxp' || 
                    (this.mxpConfig.preferredFormat === 'auto' && 
                     typeof content === 'string' && 
                     MxpMiddleware.shouldConvertToMxp(content));
                
                if (shouldConvert || isMxpMessage(content)) {
                    // Process through MXP middleware
                    const processed = await MxpMiddleware.processOutgoing(
                        content,
                        this.agentId,
                        {
                            enableMxp: true,
                            forceEncryption: this.mxpConfig.forceEncryption,
                            preferredFormat: shouldConvert ? 'mxp' : undefined
                        }
                    );
                    processedContent = processed;
                    
                    // Log MXP processing
                    if (isMxpMessage(processed)) {
                    }
                }
            } catch (error) {
                this.logger.warn(`MXP processing failed, sending original: ${error}`);
                // Fall back to original content
            }
        }
        
        // Use the main channelService for sending messages
        await channelService.sendMessage(processedContent, this.agentId, { type, context: messageContext });
        return true;
    }
    
    /**
     * Send a direct message to another agent
     * 
     * @param recipientAgentId The ID of the agent to send the message to
     * @param content The message content
     * @param format The format of the message content
     * @returns Promise resolving when the message is sent
     */
    public async sendDirectMessage(
        recipientAgentId: string, 
        content: string, 
        format: ContentFormat = ContentFormat.TEXT
    ): Promise<void> {
        this.validator.assertIsNonEmptyString(recipientAgentId);
        this.validator.assertIsNonEmptyString(content);
        
        // 1. Construct the AgentMessage object using the helper
        const agentMessageObject: AgentMessage = createAgentMessage(
            this.agentId,       
            recipientAgentId,   
            content,            
            {
                format: format,
                context: this.channelId ? { channelId: this.channelId } : undefined
            }
        );

        // 2. Create the agent message event payload using the schema function
        const payload = createAgentMessageEventPayload(
            Events.Message.AGENT_MESSAGE, // Event type
            this.agentId,             // Agent ID for the BaseEventPayload (sender of the event)
            this.channelId,           // Channel ID for the BaseEventPayload (sender's context for the event)
            agentMessageObject        // The AgentMessage data itself
        );
        
        // 3. Emit the agent message event
        EventBus.client.emitOn(this.agentId,Events.Message.AGENT_MESSAGE, payload);
    }

    /**
     * Subscribe to a channel to receive updates
     * 
     * @param channelId Channel ID to subscribe to
     * @param channelService Service to use for channel operations
     * @returns Promise that resolves to true if subscription was successful
     */
    public async subscribeToChannel(channelId: string, channelService: IInternalChannelService): Promise<boolean> {
        try {
            // Validate parameters with fail-fast approach
            this.validator.assertIsNonEmptyString(channelId);
            this.validator.assertIsObject(channelService);
            
            // Check if already subscribed
            if (this.isChannelSubscribed(channelId)) {
                return true;
            }
            
            // Use proper event payload schema for the join request
            const channelJoinData = {
                action: ChannelActionTypes.JOIN
            };
            const joinPayload = {
                eventId: this.generateEventId(),
                eventType: AgentEvents.JOIN_CHANNEL, // eventType
                timestamp: Date.now(),
                agentId: this.agentId,
                channelId: channelId,
                data: {
                    agentId: this.agentId,
                    channelId: channelId
                }
            };
            
            // Check if socketEmit function exists on channel service
            if (typeof channelService.socketEmit !== 'function') {
                throw new Error('Socket emit function must be available');
            }
            
            // Send the join request using the socket directly
            channelService.socketEmit(AgentEvents.JOIN_CHANNEL, joinPayload);
            
            // Mark as subscribed
            this.addSubscribedChannel(channelId);
            
            return true;
        } catch (error) {
            this.logger.error(`Error subscribing to channel ${channelId}:`, error);
            throw error;
        }
    }
    
    /**
     * Unsubscribe from a channel
     * 
     * @param channelId Channel ID to unsubscribe from
     * @param channelService Service to use for channel operations
     * @returns Promise that resolves to true if unsubscription was successful
     */
    public async unsubscribeFromChannel(channelId: string, channelService: IInternalChannelService): Promise<boolean> {
        try {
            // Validate parameters
            this.validator.assertIsNonEmptyString(channelId);
            this.validator.assertIsObject(channelService);
            
            // Check if not subscribed
            if (!this.isChannelSubscribed(channelId)) {
                return true;
            }
            
            // Use proper event payload schema for the leave request
            const channelLeaveData = {
                action: ChannelActionTypes.LEAVE
            };
            const leavePayload = {
                eventId: this.generateEventId(),
                eventType: AgentEvents.LEAVE_CHANNEL, // eventType
                timestamp: Date.now(),
                agentId: this.agentId,
                channelId: channelId,
                data: {
                    agentId: this.agentId,
                    channelId: channelId
                }
            };
            
            // Check if socketEmit function exists on channel service
            if (typeof channelService.socketEmit !== 'function') {
                throw new Error('Socket emit function must be available');
            }
            
            // Send the leave request using the socket directly
            channelService.socketEmit(AgentEvents.LEAVE_CHANNEL, leavePayload);
            
            // Mark as unsubscribed
            this.removeSubscribedChannel(channelId);
            
            return true;
        } catch (error) {
            this.logger.error(`Error unsubscribing from channel ${channelId}:`, error);
            throw error;
        }
    }
    
    /**
     * Set a listener for messages directed to this agent
     * 
     * @param listener Function to call when a message is received
     */
    private onMessage(listener: (message: any) => void): void {
        // Add the listener to the event bus - use the server-emitted event name
        const subscription = EventBus.client.on(Events.Message.AGENT_MESSAGE, listener);
        
        // Store the subscription for cleanup
        this.subscriptions.push(subscription);
    }

    /**
     * Set a listener for channel messages
     * 
     * @param listener Function to call when a channel message is received
     */
    private onChannelMessage(listener: (message: any) => void): void {
        // Add the listener to the event bus
        const subscription = EventBus.client.on(Events.Message.CHANNEL_MESSAGE, listener);
        
        // Store the subscription for cleanup
        this.subscriptions.push(subscription);
    }
    
    /**
     * Set up handler for agent messages
     * @private
     * 
     * DISABLED: MxfEventHandlerService already handles agent messages with immediate feedback.
     * This prevents duplicate event processing that causes multiple LLM calls for the same message.
     */
    private setupAgentMessageHandler(): void {
        // Handler disabled to prevent duplication - MxfEventHandlerService handles agent messages
    }
    
    /**
     * Generate a unique event ID
     */
    private generateEventId(): string {
        return uuidv4();
    }
}
