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
 * UserMemory Model
 *
 * Mongoose schema and model for persistent cross-session user memory.
 * Stores structured memory entries associated with a user, categorized
 * by type (user, feedback, project, reference) for contextual recall.
 */

import mongoose, { Schema, Document, Model } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';

// ─── Types ───────────────────────────────────────────────────────────────────

/** Memory entry type — controls retrieval context and staleness thresholds */
export type UserMemoryType = 'user' | 'feedback' | 'project' | 'reference';

// ─── Staleness Thresholds (days) ─────────────────────────────────────────────

/**
 * Number of days before a memory entry of a given type is considered stale.
 * Used by retrieval services to deprioritize or expire old entries.
 */
export const STALENESS_THRESHOLDS: Record<UserMemoryType, number> = {
    project:   30,
    reference: 60,
    feedback:  90,
    user:      180
};

// ─── Interfaces ──────────────────────────────────────────────────────────────

/** Plain fields for a user memory entry */
export interface IUserMemory {
    id:          string;
    userId:      string;
    type:        UserMemoryType;
    title:       string;
    description: string;
    content:     string;
    createdAt:   Date;
    updatedAt:   Date;
}

/** Mongoose document interface — merges Document with plain fields */
export interface UserMemoryDocument extends Omit<Document, 'id'>, IUserMemory {}

/** Input shape for creating or updating a user memory entry */
export interface UserMemorySaveInput {
    type:        UserMemoryType;
    title:       string;
    description: string;
    content:     string;
}

// ─── Schema ──────────────────────────────────────────────────────────────────

const UserMemorySchema = new Schema<UserMemoryDocument>({
    // Unique application-level identifier (UUID v4)
    id: {
        type:     String,
        required: true,
        unique:   true,
        default:  () => uuidv4()
    },

    // Owner of this memory entry
    userId: {
        type:     String,
        required: true,
        index:    true
    },

    // Category of memory entry
    type: {
        type:     String,
        required: true,
        enum:     ['user', 'feedback', 'project', 'reference'] as UserMemoryType[]
    },

    // Short human-readable label
    title: {
        type:     String,
        required: true
    },

    // Brief summary or context for the memory
    description: {
        type:     String,
        required: true
    },

    // Full memory content
    content: {
        type:     String,
        required: true
    },

    // Creation timestamp
    createdAt: {
        type:    Date,
        default: Date.now
    },

    // Last update timestamp — refreshed on every save via pre-save hook
    updatedAt: {
        type:    Date,
        default: Date.now
    }
}, {
    id: false, // Do not create default MongoDB _id field
    toJSON: {
        transform: (_doc, ret) => {
            delete ret._id; // Remove MongoDB _id when converting to JSON
            return ret;
        }
    }
});

// ─── Indexes ─────────────────────────────────────────────────────────────────

// Filtered queries by user and type
UserMemorySchema.index({ userId: 1, type: 1 });

// Recent-first listing per user
UserMemorySchema.index({ userId: 1, updatedAt: -1 });

// Prevent duplicate titles per user
UserMemorySchema.index({ userId: 1, title: 1 }, { unique: true });

// MongoDB text search fallback across title, description, and content
UserMemorySchema.index({ title: 'text', description: 'text', content: 'text' });

// ─── Hooks ───────────────────────────────────────────────────────────────────

// Refresh updatedAt on every save
UserMemorySchema.pre('save', function(this: UserMemoryDocument, next) {
    this.updatedAt = new Date();
    next();
});

// ─── Model ───────────────────────────────────────────────────────────────────

// Singleton guard prevents model re-registration in hot-reload environments
export const UserMemory: Model<UserMemoryDocument> =
    mongoose.models.UserMemory || mongoose.model<UserMemoryDocument>('UserMemory', UserMemorySchema);
