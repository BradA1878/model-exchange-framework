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
 * Progress Events
 * Events for agent progress reporting during task execution.
 * Agents emit structured progress updates that the UI displays
 * as status indicators rather than conversation messages.
 */

import { AgentId } from '../../types/ChannelContext';

// ============================================================================
// Event Name Constants
// ============================================================================

/**
 * Progress event names for Socket.IO communication
 */
export const ProgressEvents = {
    /** Agent → UI: structured progress update for task execution status */
    PROGRESS_UPDATE: 'progress:update',
} as const;

export type ProgressEventName = typeof ProgressEvents[keyof typeof ProgressEvents];

// ============================================================================
// Data Interfaces
// ============================================================================

/**
 * Progress update data emitted by agents during task execution
 */
export interface ProgressUpdateData {
    /** Event type identifier */
    eventType: typeof ProgressEvents.PROGRESS_UPDATE;
    /** Agent that emitted the progress update */
    agentId: AgentId;
    /** Channel context */
    channelId: string;
    /** Timestamp when the update was emitted */
    timestamp: number;
    /** Progress details */
    data: {
        /** Short status message (e.g., 'Reading log files', 'Analyzing patterns') */
        status: string;
        /** Optional longer detail */
        detail?: string;
        /** Optional completion percentage (0-100) */
        percent?: number;
    };
}

// ============================================================================
// Payload Type Map
// ============================================================================

/**
 * Payload types for all progress events
 */
export interface ProgressPayloads {
    'progress:update': ProgressUpdateData;
}
