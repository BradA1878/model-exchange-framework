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

/**
 * Channel Key Service
 *
 * Issues and validates the keys agents use to connect to a channel.
 *
 * Two properties this service is responsible for:
 *
 * 1. Secrets are hashed at rest. The `secretKey` column holds a bcrypt hash, not
 *    the secret. The plaintext is returned exactly once, at creation, and is
 *    never recoverable afterwards — the same shape PersonalAccessTokenService
 *    already uses for PATs. Read access to the database is no longer read access
 *    to every agent's credentials.
 *
 * 2. A key names its agent. `validateKey` returns the agentId recorded on the key
 *    record, so the identity of a socket is a property of the credential rather
 *    than something the client announces about itself. Socket auth used to take
 *    the agentId straight from the handshake, which meant any holder of any valid
 *    channel key could speak as any agent in that channel.
 *
 * Migration: keys created before hashing hold a plaintext secret. validateKey
 * refuses them rather than comparing in the clear — run
 * `bun run src/migrations/2026.07.channel-key-hashing.ts` to hash them in place.
 */

import crypto from 'crypto';
import bcrypt from 'bcrypt';
import ChannelKey, { IChannelKey, generateChannelKey } from '@mxf-dev/core/models/channelKey';
import { createStrictValidator } from '@mxf-dev/core/utils/validation';
import { Logger } from '@mxf-dev/core/utils/Logger';

// Create validator and logger
const validator = createStrictValidator('ChannelKeyService');
const logger = new Logger('info', 'ChannelKeyService', 'server');

/** bcrypt cost factor. Matches PersonalAccessTokenService. */
const BCRYPT_ROUNDS = 10;

/**
 * A stored bcrypt hash: `$2a$`, `$2b$`, or `$2y$` followed by cost and salt+digest.
 * Used to tell a hashed secret from a legacy plaintext one, which is base64 and
 * never starts with `$2`.
 */
const BCRYPT_HASH_PATTERN = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;

/**
 * The agentId a key is bound to.
 *
 * `agentId` is not yet declared on IChannelKey — see the model change requested
 * alongside this service. Reading it through this type keeps the access checked
 * rather than reaching for `any`, and needs no edit when the field lands.
 */
type BoundChannelKey = IChannelKey & { agentId?: string };

/**
 * Result of creating a key.
 *
 * The plaintext secret is separate from the stored record because the record
 * only ever holds its hash. This is the one moment the secret exists outside the
 * caller's hands.
 */
export interface CreatedChannelKey {
    /** Key identifier. */
    keyId: string;
    /** Plaintext secret. Shown once; the database keeps only a bcrypt hash. */
    secretKey: string;
    /** Channel the key grants access to. */
    channelId: string;
    /** Agent this key authenticates as. */
    agentId: string;
    /** Optional human-readable label. */
    name?: string;
    /** Whether the key is usable. */
    isActive: boolean;
    /** Optional expiry. */
    expiresAt?: Date;
    /** Creation time. */
    createdAt: Date;
}

/**
 * Result of validating a key.
 */
export interface ChannelKeyValidation {
    /** Whether the credential is good. */
    valid: boolean;
    /** Channel the key is bound to. */
    channelId?: string;
    /** Agent the key is bound to. Authoritative — never taken from the client. */
    agentId?: string;
}

/**
 * Channel Key Service Implementation
 */
class ChannelKeyService {
    /**
     * Whether the ChannelKey schema can store an agent binding.
     *
     * Checked at creation time so a key that cannot name its agent is never
     * handed out. Without the binding, socket authentication has nothing to
     * derive an identity from and the client would be back to naming itself.
     *
     * @returns True when the model declares an `agentId` path
     */
    private schemaSupportsAgentBinding(): boolean {
        return ChannelKey.schema.path('agentId') !== undefined;
    }

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
    ): Promise<ChannelKeyValidation> {
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

            const storedSecret = keyRecord.secretKey;

            // A stored secret that is not a bcrypt hash means this row predates
            // hashing. Comparing it in the clear would keep the plaintext-at-rest
            // problem alive, so the key is refused until it has been migrated.
            if (!BCRYPT_HASH_PATTERN.test(storedSecret)) {
                logger.error(
                    `Key ${keyId} still stores a plaintext secret. Run ` +
                    '`bun run src/migrations/2026.07.channel-key-hashing.ts` to hash existing keys. ' +
                    'Refusing to authenticate against an unhashed secret.'
                );
                return { valid: false };
            }

            const isValid = await bcrypt.compare(secretKey, storedSecret);

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

            const agentId = (keyRecord as BoundChannelKey).agentId;

            if (!agentId) {
                logger.error(
                    `Key ${keyId} is not bound to an agent. Generate keys with an agentId — ` +
                    'sdk.generateKey(channelId, agentId, name) — so the server can bind the connection ' +
                    'identity to the credential instead of trusting whatever the client claims. ' +
                    'Existing keys can be bound with ' +
                    '`bun run src/migrations/2026.07.channel-key-hashing.ts --bind-derived-agent-ids`.'
                );
                return { valid: false };
            }

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
     * Create a new channel key
     *
     * The plaintext secret is returned here and nowhere else — the record keeps
     * only a bcrypt hash of it.
     *
     * @param channelId - Channel ID to create key for
     * @param createdBy - User ID who created the key
     * @param agentId - Agent this key authenticates as
     * @param name - Optional name for the key
     * @param expiresAt - Optional expiration date
     * @returns The created key, including its plaintext secret
     */
    async createChannelKey(
        channelId: string,
        createdBy: string,
        agentId: string,
        name?: string,
        expiresAt?: Date
    ): Promise<CreatedChannelKey> {
        validator.assertIsNonEmptyString(channelId, 'channelId is required');
        validator.assertIsNonEmptyString(createdBy, 'createdBy is required');
        validator.assertIsNonEmptyString(agentId, 'agentId is required — a key names the agent it authenticates');

        if (!this.schemaSupportsAgentBinding()) {
            throw new Error(
                'The ChannelKey model has no `agentId` field, so a key cannot record which agent it ' +
                'authenticates. Add `agentId: { type: String, required: true, index: true }` to ' +
                'packages/core/src/models/channelKey.ts. Without it, socket authentication has no ' +
                'trustworthy identity to bind a connection to.'
            );
        }

        try {
            // Generate new key credentials
            const { keyId, secretKey } = generateChannelKey();

            // Hash before storing. The plaintext leaves this method in the return
            // value and is never written down.
            const secretKeyHash = await bcrypt.hash(secretKey, BCRYPT_ROUNDS);

            const keyRecord = new ChannelKey({
                keyId,
                secretKey: secretKeyHash,
                channelId,
                agentId,
                name,
                createdBy,
                expiresAt,
                isActive: true,
                createdAt: new Date(),
                updatedAt: new Date()
            });

            const savedKey = await keyRecord.save();

            logger.info(`Created channel key ${keyId} for agent ${agentId} on channel ${channelId}`);

            return {
                keyId: savedKey.keyId,
                secretKey,
                channelId: savedKey.channelId,
                agentId,
                name: savedKey.name,
                isActive: savedKey.isActive,
                expiresAt: savedKey.expiresAt,
                createdAt: savedKey.createdAt
            };

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

            return result.modifiedCount > 0;

        } catch (error) {
            logger.error(`Error deactivating channel key ${keyId}: ${error}`);
            return false;
        }
    }

    /**
     * List channel keys for a specific channel
     *
     * Secrets are excluded — there is nothing to show but a hash.
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
                .select('-secretKey');

            return keys;

        } catch (error) {
            logger.error(`Error listing channel keys for ${channelId}: ${error}`);
            return [];
        }
    }

    /**
     * Look up which channel a key belongs to, without validating its secret.
     *
     * Used by the key-status endpoints, which report whether an agent has a key
     * and where it points. It deliberately cannot confirm the secret — that is
     * what validateKey is for.
     *
     * @param keyId - Key ID to look up
     * @returns The key's channel and agent, or null when no active key matches
     */
    async describeKey(keyId: string): Promise<{ channelId: string; agentId?: string } | null> {
        try {
            validator.assertIsNonEmptyString(keyId, 'keyId is required');

            const keyRecord = await ChannelKey.findOne({ keyId, isActive: true }).select('-secretKey');

            if (!keyRecord) {
                return null;
            }

            return {
                channelId: keyRecord.channelId,
                agentId: (keyRecord as BoundChannelKey).agentId
            };

        } catch (error) {
            logger.error(`Error describing channel key ${keyId}: ${error}`);
            return null;
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

            return result.modifiedCount > 0;

        } catch (error) {
            logger.error(`Error updating channel key association ${keyId}: ${error}`);
            return false;
        }
    }

    /**
     * Derive a stable agent id from a key and channel.
     *
     * Used for keys minted before agent binding existed, so that a legacy key
     * keeps resolving to the same agent it always did. New keys carry an explicit
     * agentId instead — see createChannelKey.
     *
     * @param keyId - The key identifier
     * @param channelId - The channel identifier
     * @returns Derived agent ID
     */
    public deriveAgentIdFromKey(keyId: string, channelId: string): string {
        const hash = crypto
            .createHash('sha256')
            .update(`${keyId}:${channelId}`)
            .digest('hex');

        return `agent-${hash.substring(0, 12)}`;
    }
}

// Create and export singleton instance
const channelKeyService = new ChannelKeyService();
export default channelKeyService;
