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
 * Personal Access Token Management API Routes
 *
 * Provides REST endpoints for Personal Access Token (PAT) lifecycle management.
 * PATs allow users to authenticate SDK connections without username/password,
 * which is especially useful for magic link users.
 *
 * All endpoints require JWT authentication.
 */

import express from 'express';
import { PersonalAccessTokenService } from '../services/PersonalAccessTokenService';
import { createStrictValidator } from '../../../shared/utils/validation';
import { Logger } from '../../../shared/utils/Logger';

// Create validator and logger
const validator = createStrictValidator('TokenRoutes');
const logger = new Logger('info', 'TokenRoutes', 'server');

const router = express.Router();

/**
 * Create a new personal access token
 * POST /api/tokens
 *
 * Request body:
 *   - name: string (required) - User-friendly name for the token
 *   - description: string (optional) - Description of what the token is used for
 *   - expiresAt: string (optional) - ISO date string for expiration
 *   - maxRequestsPerDay: number (optional) - Daily rate limit
 *   - maxRequestsPerMonth: number (optional) - Monthly rate limit
 *
 * Response:
 *   - tokenId: The public token identifier (pat_xxx)
 *   - secret: The secret (SHOWN ONCE - cannot be retrieved later)
 *   - name: Token name
 *   - expiresAt: Expiration date if set
 *   - createdAt: Creation timestamp
 */
router.post('/', async (req, res) => {
    try {
        const { name, description, expiresAt, maxRequestsPerDay, maxRequestsPerMonth } = req.body;

        // Validate required fields
        validator.assertIsNonEmptyString(name, 'name is required');

        // Extract userId from authenticated user context
        const userId = (req as any).user?.id?.toString();
        if (!userId) {
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

        // Validate rate limits if provided
        if (maxRequestsPerDay !== undefined && (typeof maxRequestsPerDay !== 'number' || maxRequestsPerDay < 0)) {
            return res.status(400).json({
                success: false,
                error: 'maxRequestsPerDay must be a non-negative number'
            });
        }
        if (maxRequestsPerMonth !== undefined && (typeof maxRequestsPerMonth !== 'number' || maxRequestsPerMonth < 0)) {
            return res.status(400).json({
                success: false,
                error: 'maxRequestsPerMonth must be a non-negative number'
            });
        }

        // Create the token
        const tokenService = PersonalAccessTokenService.getInstance();
        const result = await tokenService.createToken(userId, {
            name: name.trim(),
            description: description?.trim(),
            expiresAt: expirationDate,
            maxRequestsPerDay,
            maxRequestsPerMonth,
        });

        logger.info(`Created PAT ${result.tokenId} for user ${userId}`);

        // Return token information (including secret - shown only once)
        res.status(201).json({
            success: true,
            data: {
                tokenId: result.tokenId,
                secret: result.secret, // WARNING: This is shown ONCE and cannot be retrieved later
                name: result.name,
                expiresAt: result.expiresAt,
                createdAt: result.createdAt,
            },
            message: 'Token created successfully. Save the secret now - it cannot be retrieved later.'
        });

    } catch (error) {
        logger.error(`Error creating token: ${error}`);
        res.status(500).json({
            success: false,
            error: 'Failed to create token'
        });
    }
});

/**
 * List all tokens for the authenticated user
 * GET /api/tokens
 *
 * Response:
 *   Array of token info objects (without secrets)
 */
router.get('/', async (req, res) => {
    try {
        // Extract userId from authenticated user context
        const userId = (req as any).user?.id?.toString();
        if (!userId) {
            return res.status(401).json({
                success: false,
                error: 'Authentication required'
            });
        }

        const tokenService = PersonalAccessTokenService.getInstance();
        const tokens = await tokenService.listTokens(userId);

        res.json({
            success: true,
            data: tokens
        });

    } catch (error) {
        logger.error(`Error listing tokens: ${error}`);
        res.status(500).json({
            success: false,
            error: 'Failed to list tokens'
        });
    }
});

/**
 * Get details for a specific token
 * GET /api/tokens/:tokenId
 *
 * Response:
 *   Token info object with usage stats (without secret)
 */
router.get('/:tokenId', async (req, res) => {
    try {
        const { tokenId } = req.params;

        validator.assertIsNonEmptyString(tokenId, 'tokenId is required');

        // Extract userId from authenticated user context
        const userId = (req as any).user?.id?.toString();
        if (!userId) {
            return res.status(401).json({
                success: false,
                error: 'Authentication required'
            });
        }

        const tokenService = PersonalAccessTokenService.getInstance();
        const token = await tokenService.getTokenStats(tokenId, userId);

        if (!token) {
            return res.status(404).json({
                success: false,
                error: 'Token not found or access denied'
            });
        }

        res.json({
            success: true,
            data: token
        });

    } catch (error) {
        logger.error(`Error getting token: ${error}`);
        res.status(500).json({
            success: false,
            error: 'Failed to get token'
        });
    }
});

/**
 * Revoke a personal access token
 * DELETE /api/tokens/:tokenId
 *
 * Request body (optional):
 *   - reason: string - Reason for revocation
 *
 * Response:
 *   Success message
 */
router.delete('/:tokenId', async (req, res) => {
    try {
        const { tokenId } = req.params;
        const { reason } = req.body || {};

        validator.assertIsNonEmptyString(tokenId, 'tokenId is required');

        // Extract userId from authenticated user context
        const userId = (req as any).user?.id?.toString();
        if (!userId) {
            return res.status(401).json({
                success: false,
                error: 'Authentication required'
            });
        }

        const tokenService = PersonalAccessTokenService.getInstance();
        const success = await tokenService.revokeToken(tokenId, userId, reason);

        if (success) {
            logger.info(`Revoked PAT ${tokenId} for user ${userId}`);
            res.json({
                success: true,
                message: 'Token revoked successfully'
            });
        } else {
            res.status(404).json({
                success: false,
                error: 'Token not found or access denied'
            });
        }

    } catch (error) {
        logger.error(`Error revoking token: ${error}`);
        res.status(500).json({
            success: false,
            error: 'Failed to revoke token'
        });
    }
});

/**
 * Validate a token (for testing/debugging)
 * POST /api/tokens/validate
 *
 * Request body:
 *   - accessToken: string - The full token (tokenId:secret format)
 *
 * Response:
 *   Validation result
 */
router.post('/validate', async (req, res) => {
    try {
        const { accessToken } = req.body;

        if (!accessToken || typeof accessToken !== 'string') {
            return res.status(400).json({
                success: false,
                error: 'accessToken is required'
            });
        }

        // Parse token format: pat_xxx:secret
        const parts = accessToken.split(':');
        if (parts.length !== 2) {
            return res.status(400).json({
                success: false,
                error: 'Invalid token format. Expected: tokenId:secret'
            });
        }

        const [tokenId, secret] = parts;

        const tokenService = PersonalAccessTokenService.getInstance();
        const result = await tokenService.validateToken(tokenId, secret);

        res.json({
            success: true,
            data: {
                valid: result.valid,
                userId: result.userId,
                scopes: result.scopes,
                error: result.error
            }
        });

    } catch (error) {
        logger.error(`Error validating token: ${error}`);
        res.status(500).json({
            success: false,
            error: 'Failed to validate token'
        });
    }
});

export default router;
