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
 * Personal Access Token Service
 *
 * Handles creation, validation, and management of Personal Access Tokens (PATs).
 * PATs allow users to authenticate SDK connections without username/password,
 * which is especially useful for magic link users who don't know their password.
 *
 * Security features:
 * - Token secrets are hashed with bcrypt (never stored in plaintext)
 * - Optional expiration dates
 * - Rate limiting (daily/monthly)
 * - Usage tracking for audit
 * - Immediate revocation capability
 */

import bcrypt from 'bcrypt';
import { Logger } from '../../../shared/utils/Logger';
import PersonalAccessToken, {
    IPersonalAccessToken,
    generatePersonalAccessToken
} from '../../../shared/models/personalAccessToken';

// Create module logger
const logger = new Logger('debug', 'PersonalAccessTokenService', 'server');

/**
 * Options for creating a new token
 */
export interface CreateTokenOptions {
    name: string;
    description?: string;
    expiresAt?: Date;
    maxRequestsPerDay?: number;
    maxRequestsPerMonth?: number;
    scopes?: string[];
}

/**
 * Result of token creation (includes secret shown once)
 */
export interface CreateTokenResult {
    tokenId: string;
    secret: string;
    name: string;
    expiresAt?: Date;
    createdAt: Date;
}

/**
 * Result of token validation
 */
export interface ValidateTokenResult {
    valid: boolean;
    userId?: string;
    scopes?: string[];
    tokenId?: string;
    error?: string;
}

/**
 * Token info for listing (without secret)
 */
export interface TokenInfo {
    tokenId: string;
    name: string;
    description?: string;
    scopes: string[];
    lastUsed?: Date;
    usageCount: number;
    expiresAt?: Date;
    maxRequestsPerDay?: number;
    maxRequestsPerMonth?: number;
    dailyUsageCount: number;
    monthlyUsageCount: number;
    isActive: boolean;
    revokedAt?: Date;
    createdAt: Date;
}

/**
 * Personal Access Token Service
 * Singleton service for managing PATs
 */
export class PersonalAccessTokenService {
    private static instance: PersonalAccessTokenService;

    private constructor() {
        logger.info('PersonalAccessTokenService initialized');
    }

    /**
     * Get the singleton instance
     */
    public static getInstance(): PersonalAccessTokenService {
        if (!PersonalAccessTokenService.instance) {
            PersonalAccessTokenService.instance = new PersonalAccessTokenService();
        }
        return PersonalAccessTokenService.instance;
    }

    /**
     * Create a new personal access token for a user
     * Returns the secret ONCE - it cannot be retrieved later
     *
     * @param userId - The user ID who owns this token
     * @param options - Token creation options
     * @returns Token ID and secret (secret shown once)
     */
    public async createToken(userId: string, options: CreateTokenOptions): Promise<CreateTokenResult> {
        if (!userId) {
            throw new Error('userId is required');
        }
        if (!options.name || !options.name.trim()) {
            throw new Error('Token name is required');
        }

        // Generate token ID and secret
        const { tokenId, secret } = generatePersonalAccessToken();

        // Hash the secret with bcrypt (10 rounds)
        const tokenHash = await bcrypt.hash(secret, 10);

        // Create token document
        const token = new PersonalAccessToken({
            tokenId,
            tokenHash,
            userId,
            name: options.name.trim(),
            description: options.description?.trim(),
            scopes: options.scopes || [],
            expiresAt: options.expiresAt,
            maxRequestsPerDay: options.maxRequestsPerDay,
            maxRequestsPerMonth: options.maxRequestsPerMonth,
            usageCount: 0,
            dailyUsageCount: 0,
            monthlyUsageCount: 0,
            isActive: true,
            createdAt: new Date(),
            updatedAt: new Date(),
        });

        await token.save();

        logger.info(`Created PAT ${tokenId} for user ${userId}`);

        return {
            tokenId,
            secret, // Shown once, never stored
            name: options.name.trim(),
            expiresAt: options.expiresAt,
            createdAt: token.createdAt,
        };
    }

    /**
     * Validate a personal access token
     * Checks: active, not expired, within rate limits
     * Updates: lastUsed, usageCount, daily/monthly counters
     *
     * @param tokenId - The token ID (pat_xxx)
     * @param secret - The secret to validate
     * @returns Validation result with userId if valid
     */
    public async validateToken(tokenId: string, secret: string): Promise<ValidateTokenResult> {
        if (!tokenId || !secret) {
            return { valid: false, error: 'Token ID and secret are required' };
        }

        // Find token by ID
        const token = await PersonalAccessToken.findOne({ tokenId });

        if (!token) {
            logger.warn(`PAT validation failed: token ${tokenId} not found`);
            return { valid: false, error: 'Token not found' };
        }

        // Check if active
        if (!token.isActive) {
            logger.warn(`PAT validation failed: token ${tokenId} is not active`);
            return { valid: false, error: 'Token is not active' };
        }

        // Check if revoked
        if (token.revokedAt) {
            logger.warn(`PAT validation failed: token ${tokenId} was revoked`);
            return { valid: false, error: 'Token has been revoked' };
        }

        // Check expiration
        if (token.expiresAt && new Date() > token.expiresAt) {
            logger.warn(`PAT validation failed: token ${tokenId} has expired`);
            return { valid: false, error: 'Token has expired' };
        }

        // Verify secret using bcrypt
        const isValidSecret = await bcrypt.compare(secret, token.tokenHash);
        if (!isValidSecret) {
            logger.warn(`PAT validation failed: invalid secret for token ${tokenId}`);
            return { valid: false, error: 'Invalid token secret' };
        }

        // Reset rate limit counters if needed
        const now = new Date();
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

        // Reset daily counter if it's a new day
        if (!token.lastDailyReset || token.lastDailyReset < todayStart) {
            token.dailyUsageCount = 0;
            token.lastDailyReset = todayStart;
        }

        // Reset monthly counter if it's a new month
        if (!token.lastMonthlyReset || token.lastMonthlyReset < monthStart) {
            token.monthlyUsageCount = 0;
            token.lastMonthlyReset = monthStart;
        }

        // Check daily rate limit
        if (token.maxRequestsPerDay !== undefined && token.maxRequestsPerDay !== null) {
            if (token.dailyUsageCount >= token.maxRequestsPerDay) {
                logger.warn(`PAT validation failed: token ${tokenId} exceeded daily limit`);
                return { valid: false, error: 'Daily rate limit exceeded' };
            }
        }

        // Check monthly rate limit
        if (token.maxRequestsPerMonth !== undefined && token.maxRequestsPerMonth !== null) {
            if (token.monthlyUsageCount >= token.maxRequestsPerMonth) {
                logger.warn(`PAT validation failed: token ${tokenId} exceeded monthly limit`);
                return { valid: false, error: 'Monthly rate limit exceeded' };
            }
        }

        // Update usage statistics
        token.lastUsed = now;
        token.usageCount += 1;
        token.dailyUsageCount += 1;
        token.monthlyUsageCount += 1;
        token.updatedAt = now;

        await token.save();

        logger.debug(`PAT ${tokenId} validated successfully for user ${token.userId}`);

        return {
            valid: true,
            userId: token.userId.toString(),
            scopes: token.scopes,
            tokenId: token.tokenId,
        };
    }

    /**
     * Revoke a personal access token
     *
     * @param tokenId - The token ID to revoke
     * @param userId - The user ID (for authorization check)
     * @param reason - Optional reason for revocation
     * @returns True if revoked, false if not found or unauthorized
     */
    public async revokeToken(tokenId: string, userId: string, reason?: string): Promise<boolean> {
        if (!tokenId || !userId) {
            throw new Error('Token ID and user ID are required');
        }

        const token = await PersonalAccessToken.findOne({ tokenId });

        if (!token) {
            logger.warn(`Cannot revoke PAT ${tokenId}: not found`);
            return false;
        }

        // Verify ownership
        if (token.userId.toString() !== userId) {
            logger.warn(`Cannot revoke PAT ${tokenId}: user ${userId} is not the owner`);
            return false;
        }

        // Revoke the token
        token.isActive = false;
        token.revokedAt = new Date();
        token.revokedReason = reason?.trim();
        token.updatedAt = new Date();

        await token.save();

        logger.info(`PAT ${tokenId} revoked by user ${userId}`);

        return true;
    }

    /**
     * List all tokens for a user (without secrets)
     *
     * @param userId - The user ID
     * @returns Array of token info objects
     */
    public async listTokens(userId: string): Promise<TokenInfo[]> {
        if (!userId) {
            throw new Error('User ID is required');
        }

        const tokens = await PersonalAccessToken.find({ userId }).sort({ createdAt: -1 });

        return tokens.map(token => ({
            tokenId: token.tokenId,
            name: token.name,
            description: token.description,
            scopes: token.scopes,
            lastUsed: token.lastUsed,
            usageCount: token.usageCount,
            expiresAt: token.expiresAt,
            maxRequestsPerDay: token.maxRequestsPerDay,
            maxRequestsPerMonth: token.maxRequestsPerMonth,
            dailyUsageCount: token.dailyUsageCount,
            monthlyUsageCount: token.monthlyUsageCount,
            isActive: token.isActive,
            revokedAt: token.revokedAt,
            createdAt: token.createdAt,
        }));
    }

    /**
     * Get detailed stats for a single token
     *
     * @param tokenId - The token ID
     * @param userId - The user ID (for authorization check)
     * @returns Token info or null if not found/unauthorized
     */
    public async getTokenStats(tokenId: string, userId: string): Promise<TokenInfo | null> {
        if (!tokenId || !userId) {
            throw new Error('Token ID and user ID are required');
        }

        const token = await PersonalAccessToken.findOne({ tokenId });

        if (!token) {
            return null;
        }

        // Verify ownership
        if (token.userId.toString() !== userId) {
            logger.warn(`Cannot get stats for PAT ${tokenId}: user ${userId} is not the owner`);
            return null;
        }

        return {
            tokenId: token.tokenId,
            name: token.name,
            description: token.description,
            scopes: token.scopes,
            lastUsed: token.lastUsed,
            usageCount: token.usageCount,
            expiresAt: token.expiresAt,
            maxRequestsPerDay: token.maxRequestsPerDay,
            maxRequestsPerMonth: token.maxRequestsPerMonth,
            dailyUsageCount: token.dailyUsageCount,
            monthlyUsageCount: token.monthlyUsageCount,
            isActive: token.isActive,
            revokedAt: token.revokedAt,
            createdAt: token.createdAt,
        };
    }

    /**
     * Find a token by ID (internal use only)
     * Used by demo:setup CLI to check if token already exists
     *
     * @param tokenId - The token ID
     * @returns Token document or null
     */
    public async findByTokenId(tokenId: string): Promise<IPersonalAccessToken | null> {
        return PersonalAccessToken.findOne({ tokenId });
    }

    /**
     * Find active tokens for a user by name pattern (for demo setup)
     *
     * @param userId - The user ID
     * @param namePattern - Name pattern to match
     * @returns Token document or null
     */
    public async findActiveTokenByName(userId: string, namePattern: string): Promise<IPersonalAccessToken | null> {
        return PersonalAccessToken.findOne({
            userId,
            name: { $regex: namePattern, $options: 'i' },
            isActive: true,
        });
    }

    /**
     * Create or get existing demo token for a user
     * Used by demo:setup CLI command
     *
     * @param userId - The user ID
     * @returns Token ID and secret (secret only if newly created)
     */
    public async getOrCreateDemoToken(userId: string): Promise<{ tokenId: string; secret?: string; isNew: boolean }> {
        // Check if demo token already exists
        const existingToken = await this.findActiveTokenByName(userId, 'Demo SDK Token');

        if (existingToken) {
            logger.info(`Found existing demo token ${existingToken.tokenId} for user ${userId}`);
            return {
                tokenId: existingToken.tokenId,
                isNew: false,
            };
        }

        // Create new demo token
        const result = await this.createToken(userId, {
            name: 'Demo SDK Token',
            description: 'Auto-generated token for running MXF demos',
        });

        return {
            tokenId: result.tokenId,
            secret: result.secret,
            isNew: true,
        };
    }
}
