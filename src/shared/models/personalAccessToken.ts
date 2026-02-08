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
 * Personal Access Token Model
 *
 * Defines the data schema for Personal Access Tokens (PATs), which are used
 * to authenticate SDK connections for users who signed up via magic link
 * and don't know their auto-generated password.
 *
 * PATs provide a secure way to:
 * - Authenticate SDK connections without username/password
 * - Set optional expiration dates
 * - Track usage statistics
 * - Apply rate limits (daily/monthly)
 * - Revoke access immediately
 */

import mongoose, { Schema, Document } from 'mongoose';
import crypto from 'crypto';

/**
 * Interface representing a Personal Access Token document in MongoDB
 */
export interface IPersonalAccessToken extends Document {
    // The unique token identifier (public) - format: mxf_<random>
    tokenId: string;

    // Bcrypt hash of the secret (never store plaintext)
    tokenHash: string;

    // Reference to the user who owns this token
    userId: Schema.Types.ObjectId;

    // User-provided name for the token (e.g., "My SDK Token")
    name: string;

    // Optional description of what this token is used for
    description?: string;

    // Optional scopes for fine-grained permissions (future use)
    scopes: string[];

    // Usage tracking
    lastUsed?: Date;
    usageCount: number;

    // Rate limiting
    expiresAt?: Date;
    maxRequestsPerDay?: number;
    maxRequestsPerMonth?: number;
    dailyUsageCount: number;
    monthlyUsageCount: number;
    lastDailyReset?: Date;
    lastMonthlyReset?: Date;

    // Status
    isActive: boolean;
    revokedAt?: Date;
    revokedReason?: string;

    // Timestamps
    createdAt: Date;
    updatedAt: Date;
}

/**
 * MongoDB schema for PersonalAccessToken
 */
const PersonalAccessTokenSchema: Schema = new Schema({
    tokenId: {
        type: String,
        required: true,
        unique: true,
        index: true,
    },
    tokenHash: {
        type: String,
        required: true,
    },
    userId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true,
    },
    name: {
        type: String,
        required: true,
        trim: true,
        maxlength: 100,
    },
    description: {
        type: String,
        required: false,
        trim: true,
        maxlength: 500,
    },
    scopes: {
        type: [String],
        default: [],
    },
    lastUsed: {
        type: Date,
        required: false,
    },
    usageCount: {
        type: Number,
        default: 0,
    },
    expiresAt: {
        type: Date,
        required: false,
    },
    maxRequestsPerDay: {
        type: Number,
        required: false,
    },
    maxRequestsPerMonth: {
        type: Number,
        required: false,
    },
    dailyUsageCount: {
        type: Number,
        default: 0,
    },
    monthlyUsageCount: {
        type: Number,
        default: 0,
    },
    lastDailyReset: {
        type: Date,
        required: false,
    },
    lastMonthlyReset: {
        type: Date,
        required: false,
    },
    isActive: {
        type: Boolean,
        default: true,
    },
    revokedAt: {
        type: Date,
        required: false,
    },
    revokedReason: {
        type: String,
        required: false,
        maxlength: 500,
    },
    createdAt: {
        type: Date,
        default: Date.now,
    },
    updatedAt: {
        type: Date,
        default: Date.now,
    },
});

// Compound index for efficient queries
PersonalAccessTokenSchema.index({ userId: 1, isActive: 1 });
PersonalAccessTokenSchema.index({ tokenId: 1, isActive: 1 });

// Pre-save middleware to update timestamps
PersonalAccessTokenSchema.pre('save', function(next) {
    this.updatedAt = new Date();
    next();
});

/**
 * Generate a new random personal access token
 * Returns tokenId (public identifier) and secret (shown once to user)
 *
 * Token format: mxf_<32 hex characters>
 *
 * @returns Object containing tokenId and secret
 */
export const generatePersonalAccessToken = (): { tokenId: string; secret: string } => {
    return {
        tokenId: 'mxf_' + crypto.randomBytes(16).toString('hex'),
        secret: crypto.randomBytes(32).toString('base64url'),
    };
};

// Create and export the PersonalAccessToken model
const PersonalAccessToken = mongoose.model<IPersonalAccessToken>('PersonalAccessToken', PersonalAccessTokenSchema);
export default PersonalAccessToken;
