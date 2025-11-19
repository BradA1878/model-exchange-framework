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
 * Channel Authentication Key Model
 * 
 * Defines the data schema for channel authentication keys, which are used
 * to securely connect agents to specific channels. Keys are created by users
 * and distributed to agents that need access to the channel.
 */

import mongoose, { Schema, Document } from 'mongoose';
import crypto from 'crypto';

/**
 * Interface representing a Channel Authentication Key document in MongoDB
 */
export interface IChannelKey extends Document {
    // The unique key identifier
    keyId: string;
    
    // The actual secret key used for authentication
    secretKey: string;
    
    // Reference to the channel this key provides access to
    channelId: string;
    
    // Optional name for the key (for user reference)
    name?: string;
    
    // Reference to the user who created this key
    createdBy: Schema.Types.ObjectId;
    
    // Whether the key is currently active
    isActive: boolean;
    
    // Optional expiration date
    expiresAt?: Date;
    
    // Timestamps
    createdAt: Date;
    updatedAt: Date;
    lastUsed?: Date;
}

/**
 * MongoDB schema for ChannelKey
 */
const ChannelKeySchema: Schema = new Schema({
    keyId: {
        type: String,
        required: true,
        unique: true,
    },
    secretKey: {
        type: String,
        required: true,
    },
    channelId: {
        type: String,
        required: true,
        index: true,
        ref: 'ChannelRegistration',
    },
    name: {
        type: String,
        required: false,
    },
    createdBy: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true,
    },
    isActive: {
        type: Boolean,
        default: true,
    },
    expiresAt: {
        type: Date,
        required: false,
    },
    createdAt: {
        type: Date,
        default: Date.now,
    },
    updatedAt: {
        type: Date,
        default: Date.now,
    },
    lastUsed: {
        type: Date,
        required: false,
    },
});

// Index for efficient queries
ChannelKeySchema.index({ channelId: 1, isActive: 1 });

/**
 * Generate a new random channel key
 * @returns Object containing keyId and secretKey
 */
export const generateChannelKey = (): { keyId: string; secretKey: string } => {
    return {
        keyId: 'key_' + crypto.randomBytes(12).toString('hex'),
        secretKey: crypto.randomBytes(32).toString('base64'),
    };
};

// Create and export the ChannelKey model
const ChannelKey = mongoose.model<IChannelKey>('ChannelKey', ChannelKeySchema);
export default ChannelKey;
