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
 * Channel Key Service
 * 
 * Provides real cryptographic key validation for channel-based authentication.
 * Integrates with the ChannelKey model for secure key management.
 */

import crypto from 'crypto';
import ChannelKey, { IChannelKey, generateChannelKey } from '../../../shared/models/channelKey';
import { createStrictValidator } from '../../../shared/utils/validation';
import { Logger } from '../../../shared/utils/Logger';

// Create validator and logger
const validator = createStrictValidator('ChannelKeyService');
const logger = new Logger('info', 'ChannelKeyService', 'server');

/**
 * Channel Key Service Implementation
 * 
 * Provides secure key-based authentication for agents connecting to channels.
 * Validates keys against the database and maintains security best practices.
 */
class ChannelKeyService {
    /**
     * Validate a channel authentication key
     * 
     * @param keyId - The unique key identifier
     * @param secretKey - The secret key to validate
     * @returns Validation result with channel ID and agent ID if valid
     */
    async validateKey(
        keyId: string, 
        secretKey: string
    ): Promise<{ valid: boolean; channelId?: string; agentId?: string }> {
        try {
            // Validate input parameters
            validator.assertIsNonEmptyString(keyId, 'keyId is required');
            validator.assertIsNonEmptyString(secretKey, 'secretKey is required');
            
            // Find the key in the database
            const keyRecord = await ChannelKey.findOne({ 
                keyId,
                isActive: true 
            });
            
            if (!keyRecord) {
                logger.warn(`Key not found or inactive: ${keyId}`);
                return { valid: false };
            }
            
            // Check if key has expired
            if (keyRecord.expiresAt && keyRecord.expiresAt < new Date()) {
                logger.warn(`Key expired: ${keyId}`);
                return { valid: false };
            }
            
            // Validate the secret key using secure comparison
            const isValid = this.secureCompare(keyRecord.secretKey, secretKey);
            
            if (!isValid) {
                logger.warn(`Invalid secret key for: ${keyId}`);
                return { valid: false };
            }
            
            // Update last used timestamp
            await ChannelKey.updateOne(
                { keyId },
                { 
                    lastUsed: new Date(),
                    updatedAt: new Date()
                }
            );
            
            
            // For channel keys, we derive agentId from the keyId pattern
            // This maintains compatibility with existing authentication flows
            const agentId = this.deriveAgentIdFromKey(keyId, keyRecord.channelId);
            
            return { 
                valid: true, 
                channelId: keyRecord.channelId,
                agentId
            };
            
        } catch (error) {
            logger.error(`Error validating key ${keyId}: ${error}`);
            return { valid: false };
        }
    }
    
    /**
     * Verify a channel key with cryptographic signature
     * 
     * @param channelId - Channel ID to verify
     * @param keyId - Key identifier
     * @param signature - Cryptographic signature to verify
     * @returns Boolean indicating if verification succeeded
     */
    async verifyChannelKey(
        channelId: string, 
        keyId: string, 
        signature: string
    ): Promise<boolean> {
        try {
            validator.assertIsNonEmptyString(channelId, 'channelId is required');
            validator.assertIsNonEmptyString(keyId, 'keyId is required');
            validator.assertIsNonEmptyString(signature, 'signature is required');
            
            // Find the key record
            const keyRecord = await ChannelKey.findOne({ 
                keyId,
                channelId,
                isActive: true 
            });
            
            if (!keyRecord) {
                return false;
            }
            
            // Create verification payload
            const payload = `${channelId}:${keyId}:${Date.now()}`;
            
            // Verify signature using the secret key
            const expectedSignature = crypto
                .createHmac('sha256', keyRecord.secretKey)
                .update(payload)
                .digest('hex');
            
            const isValid = this.secureCompare(expectedSignature, signature);
            
            if (isValid) {
            } else {
                logger.warn(`Channel key signature verification failed: ${keyId}`);
            }
            
            return isValid;
            
        } catch (error) {
            logger.error(`Error verifying channel key: ${error}`);
            return false;
        }
    }
    
    /**
     * Get channel key information
     * 
     * @param channelId - Channel ID to get key for
     * @returns Key information if found
     */
    async getChannelKey(
        channelId: string
    ): Promise<{ id: string; key: string } | null> {
        try {
            validator.assertIsNonEmptyString(channelId, 'channelId is required');
            
            // Find an active key for the channel
            const keyRecord = await ChannelKey.findOne({ 
                channelId,
                isActive: true 
            }).sort({ createdAt: -1 }); // Get most recent key
            
            if (!keyRecord) {
                logger.warn(`No active channel key found for channel: ${channelId}`);
                return null;
            }
            
            return {
                id: keyRecord.keyId,
                key: keyRecord.secretKey
            };
            
        } catch (error) {
            logger.error(`Error getting channel key for ${channelId}: ${error}`);
            return null;
        }
    }
    
    /**
     * Create a new channel key
     * 
     * @param channelId - Channel ID to create key for
     * @param createdBy - User ID who created the key
     * @param name - Optional name for the key
     * @param expiresAt - Optional expiration date
     * @returns Created key data
     */
    async createChannelKey(
        channelId: string,
        createdBy: string,
        name?: string,
        expiresAt?: Date
    ): Promise<IChannelKey> {
        try {
            validator.assertIsNonEmptyString(channelId, 'channelId is required');
            validator.assertIsNonEmptyString(createdBy, 'createdBy is required');
            
            // Generate new key credentials
            const { keyId, secretKey } = generateChannelKey();
            
            // Create new key record
            const keyRecord = new ChannelKey({
                keyId,
                secretKey,
                channelId,
                name,
                createdBy,
                expiresAt,
                isActive: true,
                createdAt: new Date(),
                updatedAt: new Date()
            });
            
            const savedKey = await keyRecord.save();
            
            return savedKey;
            
        } catch (error) {
            logger.error(`Error creating channel key: ${error}`);
            throw error;
        }
    }
    
    /**
     * Deactivate a channel key
     * 
     * @param keyId - Key ID to deactivate
     * @returns Success boolean
     */
    async deactivateChannelKey(keyId: string): Promise<boolean> {
        try {
            validator.assertIsNonEmptyString(keyId, 'keyId is required');
            
            const result = await ChannelKey.updateOne(
                { keyId },
                { 
                    isActive: false,
                    updatedAt: new Date()
                }
            );
            
            if (result.modifiedCount > 0) {
                return true;
            }
            
            return false;
            
        } catch (error) {
            logger.error(`Error deactivating channel key ${keyId}: ${error}`);
            return false;
        }
    }
    
    /**
     * List channel keys for a specific channel
     * 
     * @param channelId - Channel ID to list keys for
     * @param activeOnly - Whether to return only active keys
     * @returns Array of channel keys
     */
    async listChannelKeys(
        channelId: string,
        activeOnly: boolean = true
    ): Promise<IChannelKey[]> {
        try {
            validator.assertIsNonEmptyString(channelId, 'channelId is required');
            
            const query: any = { channelId };
            if (activeOnly) {
                query.isActive = true;
            }
            
            const keys = await ChannelKey.find(query)
                .sort({ createdAt: -1 })
                .select('-secretKey'); // Don't return secret keys in list
            
            return keys;
            
        } catch (error) {
            logger.error(`Error listing channel keys for ${channelId}: ${error}`);
            return [];
        }
    }
    
    /**
     * Update channel key association with actual channelId
     * 
     * @param keyId - Key ID to update
     * @param newChannelId - New channel ID to associate with
     * @returns Success boolean
     */
    async updateChannelKeyAssociation(keyId: string, newChannelId: string): Promise<boolean> {
        try {
            validator.assertIsNonEmptyString(keyId, 'keyId is required');
            validator.assertIsNonEmptyString(newChannelId, 'newChannelId is required');
            
            const result = await ChannelKey.updateOne(
                { keyId, isActive: true },
                { 
                    channelId: newChannelId,
                    updatedAt: new Date()
                }
            );
            
            if (result.modifiedCount > 0) {
                return true;
            }
            
            return false;
            
        } catch (error) {
            logger.error(`Error updating channel key association ${keyId}: ${error}`);
            return false;
        }
    }
    
    /**
     * Derive agent ID from key ID and channel ID
     * This maintains compatibility with existing socket authentication
     * 
     * @param keyId - The key identifier
     * @param channelId - The channel identifier
     * @returns Derived agent ID
     */
    private deriveAgentIdFromKey(keyId: string, channelId: string): string {
        // Create a consistent agent ID based on key and channel
        // This ensures the same key always gets the same agent ID
        const hash = crypto
            .createHash('sha256')
            .update(`${keyId}:${channelId}`)
            .digest('hex');
        
        return `agent-${hash.substring(0, 12)}`;
    }
    
    /**
     * Secure string comparison to prevent timing attacks
     * 
     * @param a - First string
     * @param b - Second string
     * @returns Boolean indicating if strings match
     */
    private secureCompare(a: string, b: string): boolean {
        if (a.length !== b.length) {
            return false;
        }
        
        let result = 0;
        for (let i = 0; i < a.length; i++) {
            result |= a.charCodeAt(i) ^ b.charCodeAt(i);
        }
        
        return result === 0;
    }
}

// Create and export singleton instance
const channelKeyService = new ChannelKeyService();
export default channelKeyService;
