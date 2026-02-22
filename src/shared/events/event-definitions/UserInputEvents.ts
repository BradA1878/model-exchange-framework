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
 * User Input Events for MXF Framework
 *
 * Event definitions for the user input tool system. Enables agents to prompt
 * users for input during execution and receive responses via Socket.IO events.
 *
 * Flow:
 * 1. Agent calls user_input tool → server emits REQUEST to channel
 * 2. SDK/client renders prompt → user responds → client emits RESPONSE
 * 3. Server routes RESPONSE to UserInputRequestManager → tool resolves
 */

import { AgentId } from '../../types/ChannelContext';

// ============================================================================
// Input Type Definitions
// ============================================================================

/**
 * Configuration for text input type
 */
export interface TextInputConfig {
    multiline?: boolean;
    placeholder?: string;
    minLength?: number;
    maxLength?: number;
}

/**
 * A single option for select/multi_select input types
 */
export interface SelectOption {
    value: string;
    label: string;
    description?: string;
}

/**
 * Configuration for select input type (pick one)
 */
export interface SelectInputConfig {
    options: SelectOption[];
}

/**
 * Configuration for multi_select input type (pick multiple)
 */
export interface MultiSelectInputConfig {
    options: SelectOption[];
    minSelections?: number;
    maxSelections?: number;
}

/**
 * Configuration for confirm input type (yes/no)
 */
export interface ConfirmInputConfig {
    confirmLabel?: string;
    denyLabel?: string;
}

/**
 * Union of all input configurations keyed by input type
 */
export type InputConfig = TextInputConfig | SelectInputConfig | MultiSelectInputConfig | ConfirmInputConfig;

/**
 * Supported input types for user prompts
 */
export type UserInputType = 'text' | 'select' | 'multi_select' | 'confirm';

/**
 * Urgency level for styling (ignored by terminal clients)
 */
export type UserInputUrgency = 'low' | 'normal' | 'high' | 'critical';

/**
 * Theme for styling (ignored by terminal clients)
 */
export type UserInputTheme = 'default' | 'warning' | 'info' | 'success' | 'error';

// ============================================================================
// Request / Response Data Interfaces
// ============================================================================

/**
 * Full user input request definition sent from server to clients
 */
export interface UserInputRequestData {
    /** Unique identifier for this request */
    requestId: string;
    /** Agent that initiated the request */
    agentId: AgentId;
    /** Channel context */
    channelId: string;
    /** Short heading for the prompt */
    title: string;
    /** Longer explanation (optional) */
    description?: string;
    /** Input type */
    inputType: UserInputType;
    /** Type-specific configuration */
    inputConfig: InputConfig;
    /** Optional timeout in milliseconds */
    timeoutMs?: number;
    /** Urgency level for visual emphasis (optional, ignored by terminal clients) */
    urgency?: UserInputUrgency;
    /** Icon identifier (optional, ignored by terminal clients) */
    icon?: string;
    /** Visual theme (optional, ignored by terminal clients) */
    theme?: UserInputTheme;
    /** Timestamp when request was created */
    timestamp: number;
}

/**
 * Response value types matching input types
 */
export type UserInputResponseValue = string | string[] | boolean;

/**
 * Response data sent from client back to server
 */
export interface UserInputResponseData {
    /** Request ID this response corresponds to */
    requestId: string;
    /** The user's answer */
    value: UserInputResponseValue;
    /** Agent ID of the responder (for multi-client scenarios) */
    respondedBy?: string;
    /** Timestamp when user responded */
    timestamp: number;
}

/**
 * Cancellation data sent from server to clients
 */
export interface UserInputCancelledData {
    /** Request ID that was cancelled */
    requestId: string;
    /** Reason for cancellation */
    reason: string;
    /** Timestamp of cancellation */
    timestamp: number;
}

/**
 * Timeout data sent from server to clients
 */
export interface UserInputTimeoutData {
    /** Request ID that timed out */
    requestId: string;
    /** Configured timeout in milliseconds */
    timeoutMs: number;
    /** Timestamp of timeout */
    timestamp: number;
}

// ============================================================================
// Status Types
// ============================================================================

/**
 * Status of a user input request
 */
export type UserInputRequestStatus = 'pending' | 'responded' | 'cancelled' | 'timeout';

// ============================================================================
// Event Name Constants
// ============================================================================

/**
 * User Input event names for Socket.IO communication
 */
export const UserInputEvents = {
    /** Server → Client: prompt the user for input */
    REQUEST: 'user_input:request',
    /** Client → Server: user responded to a prompt */
    RESPONSE: 'user_input:response',
    /** Server → Client: request was cancelled (agent or server cancelled) */
    CANCELLED: 'user_input:cancelled',
    /** Server → Client: request timed out */
    TIMEOUT: 'user_input:timeout',
} as const;

// ============================================================================
// Payload Type Map
// ============================================================================

/**
 * Payload types for all user input events
 */
export interface UserInputPayloads {
    'user_input:request': UserInputRequestData;
    'user_input:response': UserInputResponseData;
    'user_input:cancelled': UserInputCancelledData;
    'user_input:timeout': UserInputTimeoutData;
}
