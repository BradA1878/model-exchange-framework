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

import { 
    ChannelMessage, 
    AgentMessage 
} from '../../schemas/MessageSchemas';

import type {
    MessageEventData,
    MessagePersistFailedPayload as MessagePersistFailedEventData,
    MessageSendFailedPayload as MessageSendFailedEventData,
    AgentMessageEventPayload,
    ChannelMessageEventPayload,
    BaseEventPayload
} from '../../schemas/EventPayloadSchema';

/**
 * Type definition for agent message events imported from EventPayloadSchema
 * @deprecated BACKWARD-COMPATIBILITY: Import from src/shared/schemas/EventPayloadSchema.ts instead
 * This type alias is maintained for backward compatibility and will be removed in a future release
 */
export type AgentMessageEvent = AgentMessage;

/**
 * Type definition for channel message events imported from EventPayloadSchema
 * @deprecated BACKWARD-COMPATIBILITY: Import from src/shared/schemas/EventPayloadSchema.ts instead
 * This type alias is maintained for backward compatibility and will be removed in a future release
 */
export type ChannelMessageEvent = ChannelMessage;

/**
 * Events for agent messaging
 */
export const MessageEvents = {
    // Agent-to-agent direct messaging
    AGENT_MESSAGE: 'message:agent', // Client event to send a direct message from one agent to another
    AGENT_MESSAGE_DELIVERED: 'message:agent:delivered', // Server event confirming the agent message was successfully delivered to the recipient
    
    // Channel messaging
    CHANNEL_MESSAGE: 'message:channel', // Client event to send a message to an entire channel
    CHANNEL_MESSAGE_DELIVERED: 'message:channel:delivered', // Server event confirming the channel message was successfully delivered
    
    // Message error handling
    MESSAGE_ERROR: 'message:error', // Error event for message handling failures
    
    // System messages
    SYSTEM_MESSAGE: 'message:system', // Message from the system to agents
    SYSTEM_MESSAGE_DELIVERED: 'message:system:delivered', // Server event confirming the system message was successfully delivered
    
    // LLM-specific messages
    LLM_MESSAGE: 'llmMessage', // Message from an LLM agent

    // Message persistence events
    PERSIST_CHANNEL_MESSAGE_REQUEST: 'message:persist:request', // Request to persist a channel message
    MESSAGE_PERSIST_FAILED: 'message:persist:failed', // Event indicating message persistence failed
    MESSAGE_SEND_FAILED: 'message:send:failed', // Event indicating message sending failed (e.g., to a channel)
};

// Using the types imported from EventPayloadSchema.ts
// MessagePersistFailedEventData and MessageSendFailedEventData are aliases for
// MessagePersistFailedPayload and MessageSendFailedPayload from EventPayloadSchema.ts

/**
 * @deprecated BACKWARD-COMPATIBILITY: Import from src/shared/schemas/EventPayloadSchema.ts instead
 * These type aliases are maintained for backward compatibility and will be removed in a future release
 * Used by: src/server/socket/services/ChannelService.ts
 */
export type MessagePersistFailedPayload = MessagePersistFailedEventData;
export type MessageSendFailedPayload = MessageSendFailedEventData;

/**
 * Payload types for Message events
 */
export interface MessagePayloads {
    'message:agent': AgentMessageEvent;
    'message:agent:delivered': AgentMessageEvent;
    'message:channel': ChannelMessageEvent;
    'message:channel:delivered': ChannelMessageEvent;
    'message:error': { channelId?: string, messageId?: string, error: string, timestamp: number, fromAgentId?: string };
    'message:system': { content: string, timestamp: number };
    'message:system:delivered': { content: string, timestamp: number };
    'message': any;
    'llmMessage': any;

    // Payloads for message persistence events
    'message:persist:request': MessageEventData;
    'message:persist:failed': MessagePersistFailedEventData;
    'message:send:failed': MessageSendFailedEventData;
}
