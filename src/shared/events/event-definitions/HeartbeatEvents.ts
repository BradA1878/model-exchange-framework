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
 * Events related to heartbeats and system health
 */
export const HeartbeatEvents = {
    HEARTBEAT: 'heartbeat', // Regular heartbeat to check system health
    HEARTBEAT_RESPONSE: 'heartbeat:response', // Response to heartbeat check
    HEARTBEAT_TIMEOUT: 'heartbeat:timeout', // Heartbeat check timed out
};

/**
 * Payload types for Heartbeat events
 */
export interface HeartbeatPayloads {
    'heartbeat': { clientTimestamp: number };
    'heartbeat:response': { 
        clientTimestamp: number, 
        serverTimestamp: number,
        receivedAt?: number,
        calculatedLatency?: number
    };
    'heartbeat:timeout': { reason: string };
}
