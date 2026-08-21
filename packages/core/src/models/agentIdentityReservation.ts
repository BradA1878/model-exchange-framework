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
 * @documentation https://mxf-dev.github.io/mxf/
 */

import mongoose, { Document, Schema } from 'mongoose';

/**
 * Permanent tenant ownership of a globally keyed agent identity.
 *
 * Reservations are intentionally never removed when an Agent or its channel
 * keys are deleted. Releasing the row would let another tenant take over the
 * same agentId and inherit resources that are keyed only by that identifier.
 */
export interface IAgentIdentityReservation extends Document<string> {
    _id: string;
    agentId: string;
    ownerId: string;
    claimedAt: Date;
    createdAt: Date;
    updatedAt: Date;
}

const AgentIdentityReservationSchema = new Schema<IAgentIdentityReservation>(
    {
        // MongoDB's built-in _id index is the race barrier. It exists before
        // any application-created indexes, including during first startup.
        _id: {
            type: String,
            required: true
        },
        agentId: {
            type: String,
            required: true,
            immutable: true
        },
        ownerId: {
            type: String,
            required: true,
            immutable: true,
            index: true
        },
        claimedAt: {
            type: Date,
            required: true,
            default: Date.now
        }
    },
    {
        collection: 'agent_identity_reservations',
        timestamps: true
    }
);

// The built-in `_id` index is the correctness boundary; no asynchronously
// created application index is required before claims are safe.
const AgentIdentityReservation = mongoose.model<IAgentIdentityReservation>(
    'AgentIdentityReservation',
    AgentIdentityReservationSchema
);

export default AgentIdentityReservation;
