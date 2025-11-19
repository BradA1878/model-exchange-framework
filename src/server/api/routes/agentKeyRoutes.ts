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
 * Agent Key Management API Routes
 * 
 * Provides REST endpoints for managing agent authentication keys.
 * Integrates agent lifecycle with key-based authentication system.
 */

import express from 'express';
import { Agent } from '../../../shared/models/agent';
import channelKeyService from '../../socket/services/ChannelKeyService';
import { createStrictValidator } from '../../../shared/utils/validation';
import { Logger } from '../../../shared/utils/Logger';
import crypto from 'crypto';

// Create validator and logger
const validator = createStrictValidator('AgentKeyRoutes');
const logger = new Logger('info', 'AgentKeyRoutes', 'server');

const router = express.Router();

/**
 * Generate and assign a new key to an agent
 * POST /api/agents/:agentId/keys
 */
router.post('/:agentId/keys', async (req, res) => {
    try {
        const { agentId } = req.params;
        const { channelId, name, expiresAt } = req.body;
        
        // Validate required fields
        validator.assertIsNonEmptyString(agentId, 'agentId is required');
        validator.assertIsNonEmptyString(channelId, 'channelId is required');
        
        // Find the agent
        const agent = await Agent.findOne({ agentId });
        if (!agent) {
            return res.status(404).json({
                success: false,
                error: 'Agent not found'
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
        
        // Get the authenticated user ID
        const userId = (req as any).user?.id;
        if (!userId) {
            return res.status(401).json({
                success: false,
                error: 'Authentication required'
            });
        }
        
        // Create a channel key for this agent
        const keyRecord = await channelKeyService.createChannelKey(
            channelId,
            userId.toString(), // Created by authenticated user
            name || `Key for agent ${agentId}`,
            expirationDate
        );
        
        // Update agent with the keyId
        agent.keyId = keyRecord.keyId;
        await agent.save();
        
        
        res.status(201).json({
            success: true,
            data: {
                agentId,
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
        logger.error(`Error generating key for agent: ${error}`);
        res.status(500).json({
            success: false,
            error: 'Failed to generate agent key'
        });
    }
});

/**
 * Get agent key information
 * GET /api/agents/:agentId/keys
 */
router.get('/:agentId/keys', async (req, res) => {
    try {
        const { agentId } = req.params;
        
        validator.assertIsNonEmptyString(agentId, 'agentId is required');
        
        // Find the agent
        const agent = await Agent.findOne({ agentId });
        if (!agent) {
            return res.status(404).json({
                success: false,
                error: 'Agent not found'
            });
        }
        
        if (!agent.keyId) {
            return res.json({
                success: true,
                data: null,
                message: 'Agent has no assigned key'
            });
        }
        
        // Validate the key and get channel info
        const validation = await channelKeyService.validateKey(agent.keyId, 'dummy');
        
        res.json({
            success: true,
            data: {
                agentId,
                keyId: agent.keyId,
                channelId: validation.channelId,
                hasValidKey: false, // We used dummy secret, so this indicates key exists
                keyExists: true
            }
        });
        
    } catch (error) {
        logger.error(`Error getting agent key info: ${error}`);
        res.status(500).json({
            success: false,
            error: 'Failed to get agent key information'
        });
    }
});

/**
 * Rotate agent's authentication key
 * POST /api/agents/:agentId/keys/rotate
 */
router.post('/:agentId/keys/rotate', async (req, res) => {
    try {
        const { agentId } = req.params;
        const { channelId, name, expiresAt } = req.body;
        
        validator.assertIsNonEmptyString(agentId, 'agentId is required');
        validator.assertIsNonEmptyString(channelId, 'channelId is required');
        
        // Find the agent
        const agent = await Agent.findOne({ agentId });
        if (!agent) {
            return res.status(404).json({
                success: false,
                error: 'Agent not found'
            });
        }
        
        // Deactivate old key if exists
        if (agent.keyId) {
            await channelKeyService.deactivateChannelKey(agent.keyId);
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
        
        // Get the authenticated user ID
        const userId = (req as any).user?.id;
        if (!userId) {
            return res.status(401).json({
                success: false,
                error: 'Authentication required'
            });
        }
        
        // Create new key
        const keyRecord = await channelKeyService.createChannelKey(
            channelId,
            userId.toString(), // Created by authenticated user
            name || `Rotated key for agent ${agentId}`,
            expirationDate
        );
        
        // Update agent with new keyId
        agent.keyId = keyRecord.keyId;
        await agent.save();
        
        
        res.json({
            success: true,
            data: {
                agentId,
                oldKeyDeactivated: true,
                newKey: {
                    keyId: keyRecord.keyId,
                    secretKey: keyRecord.secretKey, // Only returned on creation
                    channelId: keyRecord.channelId,
                    name: keyRecord.name,
                    isActive: keyRecord.isActive,
                    expiresAt: keyRecord.expiresAt,
                    createdAt: keyRecord.createdAt
                }
            }
        });
        
    } catch (error) {
        logger.error(`Error rotating agent key: ${error}`);
        res.status(500).json({
            success: false,
            error: 'Failed to rotate agent key'
        });
    }
});

/**
 * Revoke agent's authentication key
 * DELETE /api/agents/:agentId/keys
 */
router.delete('/:agentId/keys', async (req, res) => {
    try {
        const { agentId } = req.params;
        
        validator.assertIsNonEmptyString(agentId, 'agentId is required');
        
        // Find the agent
        const agent = await Agent.findOne({ agentId });
        if (!agent) {
            return res.status(404).json({
                success: false,
                error: 'Agent not found'
            });
        }
        
        if (!agent.keyId) {
            return res.json({
                success: true,
                message: 'Agent has no key to revoke'
            });
        }
        
        // Deactivate the key
        const success = await channelKeyService.deactivateChannelKey(agent.keyId);
        
        if (success) {
            // Clear keyId from agent
            const oldKeyId = agent.keyId;
            agent.keyId = undefined;
            await agent.save();
            
            
            res.json({
                success: true,
                data: {
                    agentId,
                    revokedKeyId: oldKeyId,
                    message: 'Agent key revoked successfully'
                }
            });
        } else {
            res.status(400).json({
                success: false,
                error: 'Failed to revoke key'
            });
        }
        
    } catch (error) {
        logger.error(`Error revoking agent key: ${error}`);
        res.status(500).json({
            success: false,
            error: 'Failed to revoke agent key'
        });
    }
});

/**
 * Generate agent keys for dialog preview (before agent creation)
 * POST /api/agents/keys/generate
 */
router.post('/keys/generate', async (req, res) => {
    try {
        const { channelId, agentName } = req.body;
        
        // Validate required fields
        validator.assertIsNonEmptyString(channelId, 'channelId is required');
        validator.assertIsNonEmptyString(agentName, 'agentName is required');
        
        // Get the authenticated user ID
        const userId = (req as any).user?.id;
        if (!userId) {
            return res.status(401).json({
                success: false,
                error: 'Authentication required'
            });
        }
        
        // Create a channel key for the future agent
        const keyRecord = await channelKeyService.createChannelKey(
            channelId,
            userId.toString(),
            `Key for agent: ${agentName}`,
            undefined // No expiration for agent keys
        );
        
        
        res.status(201).json({
            success: true,
            data: {
                keyId: keyRecord.keyId,
                secretKey: keyRecord.secretKey,
                channelId: keyRecord.channelId,
                agentName,
                createdAt: keyRecord.createdAt
            }
        });
        
    } catch (error) {
        logger.error(`Error generating agent keys: ${error}`);
        res.status(500).json({
            success: false,
            error: 'Failed to generate agent keys'
        });
    }
});

/**
 * Cleanup unused agent keys (when dialog is cancelled)
 * DELETE /api/agents/keys/cleanup/:keyId
 */
router.delete('/keys/cleanup/:keyId', async (req, res) => {
    try {
        const { keyId } = req.params;
        
        validator.assertIsNonEmptyString(keyId, 'keyId is required');
        
        // Deactivate the unused key
        const success = await channelKeyService.deactivateChannelKey(keyId);
        
        if (success) {
            res.json({
                success: true,
                message: 'Agent key cleaned up successfully'
            });
        } else {
            res.status(404).json({
                success: false,
                error: 'Agent key not found or already inactive'
            });
        }
        
    } catch (error) {
        logger.error(`Error cleaning up agent key: ${error}`);
        res.status(500).json({
            success: false,
            error: 'Failed to cleanup agent key'
        });
    }
});

/**
 * List all agents with their key status
 * GET /api/agents/keys/status
 */
router.get('/keys/status', async (req, res) => {
    try {
        const { channelId } = req.query;
        
        // Build query filter
        const filter: any = {};
        if (channelId) {
            validator.assertIsNonEmptyString(channelId as string, 'channelId must be a non-empty string');
        }
        
        // Get all agents
        const agents = await Agent.find(filter).select('agentId name keyId status lastActive');
        
        // Enhance with key status information
        const agentsWithKeyStatus = await Promise.all(agents.map(async (agent: any): Promise<object> => {
            let keyStatus = 'no_key';
            let channelId: string | undefined;
            
            if (agent.keyId) {
                try {
                    // Check if key is valid (without actually validating secret)
                    const validation = await channelKeyService.validateKey(agent.keyId, 'dummy');
                    keyStatus = 'invalid'; // Default assumption
                    
                    if (validation.channelId) {
                        keyStatus = 'active';
                        channelId = validation.channelId;
                    }
                } catch (error) {
                    keyStatus = 'error';
                }
            }
            
            return {
                agentId: agent.agentId,
                name: agent.name,
                status: agent.status,
                lastActive: agent.lastActive,
                keyStatus,
                keyId: agent.keyId,
                channelId
            };
        }));
        
        res.json({
            success: true,
            data: agentsWithKeyStatus,
            summary: {
                total: agentsWithKeyStatus.length,
                withKeys: agentsWithKeyStatus.filter((a: any): boolean => a.keyStatus !== 'no_key').length,
                activeKeys: agentsWithKeyStatus.filter((a: any): boolean => a.keyStatus === 'active').length
            }
        });
        
    } catch (error) {
        logger.error(`Error listing agent key status: ${error}`);
        res.status(500).json({
            success: false,
            error: 'Failed to get agent key status'
        });
    }
});

export default router;
