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
import { Channel } from '@mxf-dev/core/models/channel';
import { Types } from 'mongoose';
import { User, UserRole } from '@mxf-dev/core/models/user';
import { createStrictValidator } from '@mxf-dev/core/utils/validation';
import { Logger } from '@mxf-dev/core/utils/Logger';
import {
    isReservedAgentId,
    isReservedChannelId
} from '@mxf-dev/core/constants/ReservedIdentities';
import agentIdentityOwnershipService, {
    AgentIdentityOwnershipError
} from '../../security/AgentIdentityOwnershipService';

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
    /** Immutable maximum tool grant carried by this credential. */
    allowedTools?: string[];
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
    /** Immutable maximum tool grant. Omitted means curated core tools. */
    allowedTools?: string[];
    /** Credential expiry used to terminate already-authenticated sockets. */
    expiresAt?: Date;
}

/** Socket cleanup installed by SocketService once the realtime server exists. */
export interface ChannelKeySocketLifecycle {
    disconnectKeySockets(keyId: string): number | Promise<number>;
    disconnectChannelSockets(channelId: string): number | Promise<number>;
}

/**
 * Channel Key Service Implementation
 */
class ChannelKeyService {
    private socketLifecycle: ChannelKeySocketLifecycle | null = null;

    /** Install the sole realtime credential cleanup bridge. */
    public setSocketLifecycle(lifecycle: ChannelKeySocketLifecycle): void {
        this.socketLifecycle = lifecycle;
    }

    /** Remove a bridge only when it is still the registered instance. */
    public clearSocketLifecycle(lifecycle: ChannelKeySocketLifecycle): void {
        if (this.socketLifecycle === lifecycle) {
            this.socketLifecycle = null;
        }
    }

    private getSocketLifecycle(): ChannelKeySocketLifecycle {
        if (!this.socketLifecycle) {
            throw new Error('Socket credential lifecycle is not initialized');
        }
        return this.socketLifecycle;
    }
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

            // Legacy or manually inserted keys must not make an internal routing
            // sentinel externally claimable, even when their secret is valid.
            if (isReservedChannelId(keyRecord.channelId) ||
                isReservedAgentId((keyRecord as BoundChannelKey).agentId)) {
                logger.error(`Key ${keyId} references an MXF-reserved agent or channel identity`);
                return { valid: false };
            }

            // Check if key has expired
            if (keyRecord.expiresAt && keyRecord.expiresAt <= new Date()) {
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

            // A valid secret is not enough to establish an agent principal.
            // The key owner must also be the permanent owner of this globally
            // keyed agentId. Re-check legacy evidence on every authentication
            // so a stale or manually inserted conflicting key fails before it
            // can reach socket registration, memory, or default core tools.
            await agentIdentityOwnershipService.claimOrValidate(
                agentId,
                String(keyRecord.createdBy)
            );

            // A credential cannot outlive its authorization resource. Channel
            // deletion used to leave active keys behind, allowing stale keys to
            // authenticate sockets even though joining the channel had failed.
            const channelExists = await Channel.exists({
                channelId: keyRecord.channelId,
                active: true,
                // Channel ids are globally reserved, but this additional owner
                // binding prevents a stale or corrupted key row from crossing
                // ownership boundaries if persistence is ever repaired or
                // imported incorrectly.
                createdBy: String(keyRecord.createdBy)
            });
            if (!channelExists) {
                logger.warn(`Key ${keyId} references a missing or inactive channel`);
                return { valid: false };
            }

            // Finish validation with an atomic active/expiry check. A revocation
            // that wins while bcrypt or the channel lookup is in flight must
            // make this update return null, rather than allowing a stale read to
            // authenticate a new socket after the credential became inactive.
            const validatedAt = new Date();
            const validatedKey = await ChannelKey.findOneAndUpdate(
                {
                    keyId,
                    secretKey: storedSecret,
                    channelId: keyRecord.channelId,
                    agentId,
                    createdBy: keyRecord.createdBy,
                    isActive: true,
                    $or: [
                        { expiresAt: { $exists: false } },
                        { expiresAt: null },
                        { expiresAt: { $gt: validatedAt } }
                    ]
                },
                {
                    $set: {
                        lastUsed: validatedAt,
                        updatedAt: validatedAt
                    }
                },
                { new: true }
            );

            if (!validatedKey) {
                logger.warn(`Key was revoked or expired during validation: ${keyId}`);
                return { valid: false };
            }

            return {
                valid: true,
                channelId: validatedKey.channelId,
                agentId,
                allowedTools: Array.isArray(validatedKey.allowedTools)
                    ? [...validatedKey.allowedTools]
                    : undefined,
                expiresAt: validatedKey.expiresAt
                    ? new Date(validatedKey.expiresAt)
                    : undefined
            };

        } catch (error) {
            logger.error(`Error validating key ${keyId}: ${error}`);
            return { valid: false };
        }
    }

    /**
     * A key for an existing channel may only be issued by the channel's creator
     * or by an administrator. The REST and socket entry points already check
     * this before calling in; the service checks again so a new caller cannot
     * mint keys into another tenant's channel by skipping the middleware.
     *
     * A channel that does not exist yet is allowed through: the REST key-first
     * flow derives a temporary channel id before the channel is created.
     */
    private async assertMayIssueKeysForChannel(channelId: string, createdBy: string): Promise<void> {
        const channel = await Channel.findOne({ channelId })
            .select('createdBy active')
            .lean<{ createdBy?: unknown; active?: boolean } | null>();
        if (!channel) {
            return;
        }
        if (channel.active === false) {
            throw new Error(`Channel ${channelId} is not active`);
        }
        if (String(channel.createdBy) === createdBy) {
            return;
        }

        const requester = Types.ObjectId.isValid(createdBy)
            ? await User.findById(createdBy).select('role').lean<{ role?: string } | null>()
            : null;
        if (requester?.role === UserRole.ADMIN) {
            return;
        }
        throw new Error(`User ${createdBy} does not own channel ${channelId}`);
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
        expiresAt?: Date,
        allowedTools?: string[]
    ): Promise<CreatedChannelKey> {
        validator.assertIsNonEmptyString(channelId, 'channelId is required');
        validator.assertIsNonEmptyString(createdBy, 'createdBy is required');
        validator.assertIsNonEmptyString(agentId, 'agentId is required — a key names the agent it authenticates');

        if (isReservedChannelId(channelId)) {
            throw new AgentIdentityOwnershipError(
                'INVALID_IDENTITY',
                `Channel identity "${channelId}" is reserved for internal MXF routing; choose a different channelId.`,
                400
            );
        }

        if (allowedTools !== undefined && (
            !Array.isArray(allowedTools) ||
            allowedTools.some(toolName => (
                typeof toolName !== 'string' || toolName.trim().length === 0
            ))
        )) {
            throw new Error('allowedTools must be an array of non-empty strings when provided');
        }
        const credentialAllowedTools = allowedTools === undefined
            ? undefined
            : [...new Set(allowedTools.map(toolName => toolName.trim()))];

        if (!this.schemaSupportsAgentBinding()) {
            throw new Error(
                'The ChannelKey model has no `agentId` field, so a key cannot record which agent it ' +
                'authenticates. Add `agentId: { type: String, required: true, index: true }` to ' +
                'packages/core/src/models/channelKey.ts. Without it, socket authentication has no ' +
                'trustworthy identity to bind a connection to.'
            );
        }

        await this.assertMayIssueKeysForChannel(channelId, createdBy);

        try {
            // Claim before a key exists. This preserves the key-first SDK flow:
            // the same owner can create the Agent later, while another tenant
            // cannot reserve that globally keyed identity in the meantime.
            await agentIdentityOwnershipService.claimOrValidate(agentId, createdBy);

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
                allowedTools: credentialAllowedTools,
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
                allowedTools: credentialAllowedTools,
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
                { keyId, isActive: true },
                { $set: { isActive: false, updatedAt: new Date() } }
            );

            const matchedCount = result.matchedCount ?? result.modifiedCount;
            // Mongo is inactive before runtime eviction. Validation performs a
            // final atomic active check, so no process-local credential cache or
            // tombstone is required to close the validate/revoke race.
            await this.getSocketLifecycle().disconnectKeySockets(keyId);

            return matchedCount > 0;

        } catch (error) {
            logger.error(`Error deactivating channel key ${keyId}: ${error}`);
            return false;
        }
    }

    /**
     * Revoke every live credential for a channel.
     *
     * This deliberately does not filter by owner: deletion is the terminal
     * lifecycle boundary for the channel, so even malformed or legacy rows
     * with the wrong owner must be made unusable.
     */
    async deactivateChannelKeys(channelId: string): Promise<number> {
        validator.assertIsNonEmptyString(channelId, 'channelId is required');

        const result = await ChannelKey.updateMany(
            { channelId, isActive: true },
            { $set: { isActive: false, updatedAt: new Date() } }
        );

        await this.getSocketLifecycle().disconnectChannelSockets(channelId);

        return result.modifiedCount;
    }

    /**
     * Revoke credentials bound to one exact persisted agent/owner pair.
     * The owner predicate prevents an agent-id collision from revoking another
     * tenant's credentials.
     */
    async deactivateAgentKeys(agentId: string, createdBy: string): Promise<number> {
        validator.assertIsNonEmptyString(agentId, 'agentId is required');
        validator.assertIsNonEmptyString(createdBy, 'createdBy is required');

        // Resolve the exact credential ids for this owner before changing
        // persistence. We include already-inactive rows so a cleanup retry can
        // still evict a socket after an earlier post-revocation eviction failed.
        const keyRecords = await ChannelKey.find({ agentId, createdBy })
            .select('keyId');
        const keyIds = [...new Set(keyRecords.map(record => record.keyId))];

        const result = await ChannelKey.updateMany(
            { agentId, createdBy, isActive: true },
            { $set: { isActive: false, updatedAt: new Date() } }
        );

        await Promise.all(
            keyIds.map(keyId => this.getSocketLifecycle().disconnectKeySockets(keyId))
        );

        return result.modifiedCount;
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

            const query: { channelId: string; isActive?: boolean } = { channelId };
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
    async describeKey(keyId: string): Promise<{
        channelId: string;
        agentId?: string;
        allowedTools?: string[];
    } | null> {
        try {
            validator.assertIsNonEmptyString(keyId, 'keyId is required');

            const keyRecord = await ChannelKey.findOne({ keyId, isActive: true }).select('-secretKey');

            if (!keyRecord) {
                return null;
            }

            return {
                channelId: keyRecord.channelId,
                agentId: (keyRecord as BoundChannelKey).agentId,
                allowedTools: Array.isArray(keyRecord.allowedTools)
                    ? [...keyRecord.allowedTools]
                    : undefined
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

            if (isReservedChannelId(newChannelId)) {
                logger.warn(`Refused to associate key ${keyId} with reserved channel ${newChannelId}`);
                return false;
            }

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
