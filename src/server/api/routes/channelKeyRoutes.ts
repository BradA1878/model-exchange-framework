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
 * Channel Key Management API Routes
 * 
 * Provides REST endpoints for channel key lifecycle management.
 * Supports creation, listing, rotation, and revocation of channel keys.
 */

import express from 'express';
import channelKeyService from '../../socket/services/ChannelKeyService';
import { createStrictValidator } from '../../../shared/utils/validation';
import { Logger } from '../../../shared/utils/Logger';

// Create validator and logger
const validator = createStrictValidator('ChannelKeyRoutes');
const logger = new Logger('info', 'ChannelKeyRoutes', 'server');

const router = express.Router();

/**
 * Create a new channel key
 * POST /api/channel-keys
 */
router.post('/', async (req, res) => {
    try {
        const { channelId, name, expiresAt } = req.body;
        
        // Validate required fields
        validator.assertIsNonEmptyString(channelId, 'channelId is required');
        
        // Extract createdBy from authenticated user context
        const createdBy = (req as any).user?.id?.toString();
        if (!createdBy) {
            return res.status(401).json({
                success: false,
                error: 'Authentication required'
            });
        }
        
        // Parse expiration date if provided
        let expirationDate: Date | undefined;
        if (expiresAt) {
            expirationDate = new Date(expiresAt);
            if (isNaN(expirationDate.getTime())) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid expiresAt date format'
                });
            }
        }
        
        // Create the key
        const keyRecord = await channelKeyService.createChannelKey(
            channelId,
            createdBy,
            name,
            expirationDate
        );
        
        
        // Return key information (including secret for initial creation)
        res.status(201).json({
            success: true,
            data: {
                keyId: keyRecord.keyId,
                secretKey: keyRecord.secretKey, // Only returned on creation
                channelId: keyRecord.channelId,
                name: keyRecord.name,
                isActive: keyRecord.isActive,
                expiresAt: keyRecord.expiresAt,
                createdAt: keyRecord.createdAt
            }
        });
        
    } catch (error) {
        logger.error(`Error creating channel key: ${error}`);
        res.status(500).json({
            success: false,
            error: 'Failed to create channel key'
        });
    }
});

/**
 * List channel keys for a specific channel
 * GET /api/channel-keys/:channelId
 */
router.get('/:channelId', async (req, res) => {
    try {
        const { channelId } = req.params;
        const { activeOnly = 'true' } = req.query;
        
        validator.assertIsNonEmptyString(channelId, 'channelId is required');
        
        const keys = await channelKeyService.listChannelKeys(
            channelId,
            activeOnly === 'true'
        );
        
        
        res.json({
            success: true,
            data: keys.map((key: any): object => ({
                keyId: key.keyId,
                channelId: key.channelId,
                name: key.name,
                isActive: key.isActive,
                expiresAt: key.expiresAt,
                createdAt: key.createdAt,
                lastUsed: key.lastUsed
                // Note: secretKey intentionally excluded for security
            }))
        });
        
    } catch (error) {
        logger.error(`Error listing channel keys: ${error}`);
        res.status(500).json({
            success: false,
            error: 'Failed to list channel keys'
        });
    }
});

/**
 * Deactivate a channel key
 * DELETE /api/channel-keys/:keyId
 */
router.delete('/:keyId', async (req, res) => {
    try {
        const { keyId } = req.params;
        
        validator.assertIsNonEmptyString(keyId, 'keyId is required');
        
        const success = await channelKeyService.deactivateChannelKey(keyId);
        
        if (success) {
            res.json({
                success: true,
                message: 'Channel key deactivated successfully'
            });
        } else {
            res.status(404).json({
                success: false,
                error: 'Channel key not found'
            });
        }
        
    } catch (error) {
        logger.error(`Error deactivating channel key: ${error}`);
        res.status(500).json({
            success: false,
            error: 'Failed to deactivate channel key'
        });
    }
});

/**
 * Validate a channel key (for testing purposes)
 * POST /api/channel-keys/validate
 */
router.post('/validate', async (req, res) => {
    try {
        const { keyId, secretKey } = req.body;
        
        validator.assertIsNonEmptyString(keyId, 'keyId is required');
        validator.assertIsNonEmptyString(secretKey, 'secretKey is required');
        
        const result = await channelKeyService.validateKey(keyId, secretKey);
        
        if (result.valid) {
        } else {
            logger.warn(`Key validation failed via API: ${keyId}`);
        }
        
        res.json({
            success: true,
            data: {
                valid: result.valid,
                channelId: result.channelId,
                agentId: result.agentId
            }
        });
        
    } catch (error) {
        logger.error(`Error validating channel key: ${error}`);
        res.status(500).json({
            success: false,
            error: 'Failed to validate channel key'
        });
    }
});

/**
 * Get key usage analytics for a channel
 * GET /api/channel-keys/:channelId/analytics
 */
router.get('/:channelId/analytics', async (req, res) => {
    try {
        const { channelId } = req.params;
        
        validator.assertIsNonEmptyString(channelId, 'channelId is required');
        
        const keys = await channelKeyService.listChannelKeys(channelId, false); // Include inactive keys
        
        // Calculate analytics
        const analytics = {
            totalKeys: keys.length,
            activeKeys: keys.filter((key: any): boolean => key.isActive === true).length,
            expiredKeys: keys.filter((key: any): boolean => !!(key.expiresAt && key.expiresAt < new Date())).length,
            keysWithUsage: keys.filter((key: any): boolean => !!key.lastUsed).length,
            oldestKey: keys.reduce((oldest: any, key: any) => {
                return !oldest || key.createdAt < oldest.createdAt ? key : oldest;
            }, null as any)?.createdAt,
            newestKey: keys.reduce((newest: any, key: any) => {
                return !newest || key.createdAt > newest.createdAt ? key : newest;
            }, null as any)?.createdAt,
            lastUsed: keys.reduce((latest: any, key: any) => {
                if (!key.lastUsed) return latest;
                return !latest || key.lastUsed > latest ? key.lastUsed : latest;
            }, null as Date | null)
        };
        
        
        res.json({
            success: true,
            data: {
                channelId,
                analytics,
                generatedAt: new Date()
            }
        });
        
    } catch (error) {
        logger.error(`Error generating channel key analytics: ${error}`);
        res.status(500).json({
            success: false,
            error: 'Failed to generate key analytics'
        });
    }
});

/**
 * Bulk rotate all keys for a channel
 * POST /api/channel-keys/:channelId/rotate-all
 */
router.post('/:channelId/rotate-all', async (req, res) => {
    try {
        const { channelId } = req.params;
        const { expiresAt } = req.body;
        
        validator.assertIsNonEmptyString(channelId, 'channelId is required');
        
        // Extract createdBy from authenticated user context
        const createdBy = (req as any).user?.id?.toString();
        if (!createdBy) {
            return res.status(401).json({
                success: false,
                error: 'Authentication required'
            });
        }
        
        // Get all active keys for the channel
        const activeKeys = await channelKeyService.listChannelKeys(channelId, true);
        
        if (activeKeys.length === 0) {
            return res.json({
                success: true,
                data: {
                    channelId,
                    rotatedCount: 0,
                    message: 'No active keys found to rotate'
                }
            });
        }
        
        // Parse expiration date if provided
        let expirationDate: Date | undefined;
        if (expiresAt) {
            expirationDate = new Date(expiresAt);
            if (isNaN(expirationDate.getTime())) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid expiresAt date format'
                });
            }
        }
        
        const rotationResults = [];
        
        // Rotate each key
        for (const oldKey of activeKeys) {
            try {
                // Deactivate old key
                await channelKeyService.deactivateChannelKey(oldKey.keyId);
                
                // Create new key
                const newKey = await channelKeyService.createChannelKey(
                    channelId,
                    createdBy,
                    `Rotated: ${oldKey.name || 'Unnamed key'}`,
                    expirationDate
                );
                
                rotationResults.push({
                    oldKeyId: oldKey.keyId,
                    newKeyId: newKey.keyId,
                    newSecretKey: newKey.secretKey,
                    status: 'success'
                });
                
            } catch (error) {
                rotationResults.push({
                    oldKeyId: oldKey.keyId,
                    status: 'error',
                    error: error instanceof Error ? error.message : String(error)
                });
            }
        }
        
        const successCount = rotationResults.filter((result): boolean => result.status === 'success').length;
        
        
        res.json({
            success: true,
            data: {
                channelId,
                totalKeys: activeKeys.length,
                rotatedCount: successCount,
                results: rotationResults
            }
        });
        
    } catch (error) {
        logger.error(`Error bulk rotating channel keys: ${error}`);
        res.status(500).json({
            success: false,
            error: 'Failed to bulk rotate keys'
        });
    }
});

/**
 * Bulk deactivate all keys for a channel
 * DELETE /api/channel-keys/:channelId/all
 */
router.delete('/:channelId/all', async (req, res) => {
    try {
        const { channelId } = req.params;
        
        validator.assertIsNonEmptyString(channelId, 'channelId is required');
        
        // Get all active keys for the channel
        const activeKeys = await channelKeyService.listChannelKeys(channelId, true);
        
        if (activeKeys.length === 0) {
            return res.json({
                success: true,
                data: {
                    channelId,
                    deactivatedCount: 0,
                    message: 'No active keys found to deactivate'
                }
            });
        }
        
        const deactivationResults = [];
        
        // Deactivate each key
        for (const key of activeKeys) {
            try {
                const success = await channelKeyService.deactivateChannelKey(key.keyId);
                deactivationResults.push({
                    keyId: key.keyId,
                    status: success ? 'success' : 'failed'
                });
            } catch (error) {
                deactivationResults.push({
                    keyId: key.keyId,
                    status: 'error',
                    error: error instanceof Error ? error.message : String(error)
                });
            }
        }
        
        const successCount = deactivationResults.filter((result): boolean => result.status === 'success').length;
        
        
        res.json({
            success: true,
            data: {
                channelId,
                totalKeys: activeKeys.length,
                deactivatedCount: successCount,
                results: deactivationResults
            }
        });
        
    } catch (error) {
        logger.error(`Error bulk deactivating channel keys: ${error}`);
        res.status(500).json({
            success: false,
            error: 'Failed to bulk deactivate keys'
        });
    }
});

/**
 * Generate channel key for dialog preview (before channel creation)
 * POST /api/channel-keys/generate
 */
router.post('/generate', async (req, res) => {
    try {
        const { channelName } = req.body;
        
        // Validate required fields
        validator.assertIsNonEmptyString(channelName, 'channelName is required');
        
        // Get the authenticated user ID
        const userId = (req as any).user?.id;
        if (!userId) {
            return res.status(401).json({
                success: false,
                error: 'Authentication required'
            });
        }
        
        // Generate a temporary channelId for key preview (will be replaced when channel is actually created)
        const tempChannelId = `temp_${channelName.toLowerCase().replace(/[^a-z0-9]/g, '_')}_${Date.now()}`;
        
        // Create a channel key for the future channel
        const keyRecord = await channelKeyService.createChannelKey(
            tempChannelId,
            userId.toString(),
            `Key for channel: ${channelName}`,
            undefined // No expiration for channel keys
        );
        
        
        res.status(201).json({
            success: true,
            data: {
                keyId: keyRecord.keyId,
                secretKey: keyRecord.secretKey,
                channelName,
                tempChannelId,
                createdAt: keyRecord.createdAt
            }
        });
        
    } catch (error) {
        logger.error(`Error generating channel key: ${error}`);
        res.status(500).json({
            success: false,
            error: 'Failed to generate channel key'
        });
    }
});

/**
 * Cleanup unused channel key (when dialog is cancelled)
 * DELETE /api/channel-keys/cleanup/:keyId
 */
router.delete('/cleanup/:keyId', async (req, res) => {
    try {
        const { keyId } = req.params;
        
        validator.assertIsNonEmptyString(keyId, 'keyId is required');
        
        // Deactivate the unused key
        const success = await channelKeyService.deactivateChannelKey(keyId);
        
        if (success) {
            res.json({
                success: true,
                message: 'Channel key cleaned up successfully'
            });
        } else {
            res.status(404).json({
                success: false,
                error: 'Channel key not found or already inactive'
            });
        }
        
    } catch (error) {
        logger.error(`Error cleaning up channel key: ${error}`);
        res.status(500).json({
            success: false,
            error: 'Failed to cleanup channel key'
        });
    }
});

/**
 * Update channel key association (when channel is actually created)
 * PUT /api/channel-keys/:keyId/associate
 */
router.put('/:keyId/associate', async (req, res) => {
    try {
        const { keyId } = req.params;
        const { channelId } = req.body;
        
        validator.assertIsNonEmptyString(keyId, 'keyId is required');
        validator.assertIsNonEmptyString(channelId, 'channelId is required');
        
        // Update the key record with the actual channelId
        const success = await channelKeyService.updateChannelKeyAssociation(keyId, channelId);
        
        if (success) {
            res.json({
                success: true,
                message: 'Channel key associated successfully',
                data: {
                    keyId,
                    channelId
                }
            });
        } else {
            res.status(404).json({
                success: false,
                error: 'Channel key not found or could not be updated'
            });
        }
        
    } catch (error) {
        logger.error(`Error associating channel key: ${error}`);
        res.status(500).json({
            success: false,
            error: 'Failed to associate channel key'
        });
    }
});

export default router;
