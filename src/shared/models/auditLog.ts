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

import mongoose, { Document, Schema } from 'mongoose';

/**
 * Interface for Audit Log document
 */
export interface IAuditLog extends Document {
    eventType: string;
    agentId: string;
    timestamp: Date;
    targetAgentId?: string;
    messageId?: string;
    messageType?: string;
    serviceTypes?: string[];
    capabilities?: string[];
    encrypted?: boolean;
    compressed?: boolean;
    summary?: string;
    taskType?: string;
    error?: string;
    metadata?: Record<string, any>;
    userId?: string; // Reference to the user associated with this log
}

/**
 * Schema for Audit Log
 */
const AuditLogSchema: Schema = new Schema(
    {
        eventType: {
            type: String,
            required: true,
            index: true
        },
        agentId: {
            type: String,
            required: true,
            index: true
        },
        timestamp: {
            type: Date,
            required: true,
            index: true
        },
        targetAgentId: {
            type: String,
            required: false,
            index: true
        },
        messageId: {
            type: String,
            required: false,
            index: true
        },
        messageType: {
            type: String,
            required: false
        },
        serviceTypes: {
            type: [String],
            required: false
        },
        capabilities: {
            type: [String],
            required: false
        },
        encrypted: {
            type: Boolean,
            required: false
        },
        compressed: {
            type: Boolean,
            required: false
        },
        summary: {
            type: String,
            required: false
        },
        taskType: {
            type: String,
            required: false,
            index: true
        },
        error: {
            type: String,
            required: false
        },
        metadata: {
            type: Schema.Types.Mixed,
            required: false
        },
        userId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: false,
            index: true
        }
    },
    {
        timestamps: true
    }
);

// Create indexes for common queries
AuditLogSchema.index({ timestamp: -1 });
AuditLogSchema.index({ eventType: 1, timestamp: -1 });
AuditLogSchema.index({ agentId: 1, timestamp: -1 });
AuditLogSchema.index({ targetAgentId: 1, timestamp: -1 });
AuditLogSchema.index({ messageId: 1 });
AuditLogSchema.index({ taskType: 1, timestamp: -1 });
AuditLogSchema.index({ userId: 1, timestamp: -1 }); // Index for user-based queries

// Export the model
export const AuditLog = mongoose.model<IAuditLog>('AuditLog', AuditLogSchema);
