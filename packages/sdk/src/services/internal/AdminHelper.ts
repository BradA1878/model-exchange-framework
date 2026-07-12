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
 * Admin Helper
 *
 * INTERNAL USE ONLY - NOT EXPORTED FROM SDK
 *
 * Event-driven admin operations (channel/key management). Every flow goes through
 * the shared awaitEventResponse helper, so each one clears its own timer,
 * unsubscribes on every exit path, and rejects on failure. These were four
 * hand-rolled copies of the same request/response dance.
 */

import { Events } from '@mxf-dev/core/events/EventNames';
import { createBaseEventPayload } from '@mxf-dev/core/schemas/EventPayloadSchema';
import { Logger } from '@mxf-dev/core/utils/Logger';
import { awaitEventResponse } from './EventRequest.js';

const logger = new Logger('info', 'AdminHelper', 'client');

/** How long to wait for an admin operation to come back. */
const ADMIN_TIMEOUT_MS = 30_000;

/**
 * Channel creation configuration
 */
export interface ChannelCreateConfig {
    channelId: string;
    name: string;
    metadata?: Record<string, any>;
}

/**
 * Channel creation result
 */
export interface ChannelCreateResult {
    channelId: string;
    name: string;
}

/**
 * Key generation configuration
 */
export interface KeyGenerateConfig {
    channelId: string;
    agentId?: string;
    name?: string;
    expiresAt?: Date;
}

/**
 * Key generation result
 */
export interface KeyGenerateResult {
    keyId: string;
    secretKey: string;
    channelId: string;
    agentId?: string;
    expiresAt?: string;
}

/**
 * Key information
 */
export interface KeyInfo {
    keyId: string;
    name?: string;
    isActive: boolean;
    expiresAt?: string;
    createdAt: string;
    lastUsed?: string;
}

/**
 * Admin Helper - event-driven admin operations for the SDK
 */
export class AdminHelper {
    /**
     * Create a channel.
     *
     * @param config - Channel creation configuration
     * @param createdBy - Agent ID creating the channel
     * @returns Promise resolving to channel creation result
     * @throws EventRequestError if the server rejects the request
     * @throws EventRequestTimeoutError if the server does not answer
     *
     * @example
     * ```typescript
     * const result = await AdminHelper.createChannel({
     *     channelId: 'my-channel',
     *     name: 'My Channel',
     *     metadata: { purpose: 'Demo' }
     * }, 'admin-agent');
     * ```
     */
    static async createChannel(
        config: ChannelCreateConfig,
        createdBy: string
    ): Promise<ChannelCreateResult> {
        return awaitEventResponse<ChannelCreateResult>({
            emitEvent: Events.Channel.CREATE,
            payload: createBaseEventPayload(
                Events.Channel.CREATE,
                createdBy,
                config.channelId,
                {
                    name: config.name,
                    metadata: config.metadata
                }
            ),
            route: { via: 'agent', agentId: createdBy },
            successEvent: Events.Channel.CREATED,
            failureEvent: Events.Channel.CREATION_FAILED,
            correlate: (payload: any) => payload?.channelId === config.channelId,
            mapResult: (payload: any) => ({
                channelId: payload.data.channelId,
                name: payload.data.name
            }),
            timeoutMs: ADMIN_TIMEOUT_MS,
            description: `Channel creation for '${config.channelId}'`,
            logger,
        });
    }

    /**
     * Generate a channel key.
     *
     * @param config - Key generation configuration
     * @param requestedBy - Agent ID requesting the key
     * @returns Promise resolving to key generation result
     * @throws EventRequestError if the server rejects the request
     * @throws EventRequestTimeoutError if the server does not answer
     *
     * @example
     * ```typescript
     * const key = await AdminHelper.generateKey({
     *     channelId: 'my-channel',
     *     agentId: 'new-agent',
     *     name: 'Agent Key',
     *     expiresAt: new Date(Date.now() + 86400000) // 24 hours
     * }, 'admin-agent');
     * ```
     */
    static async generateKey(
        config: KeyGenerateConfig,
        requestedBy: string
    ): Promise<KeyGenerateResult> {
        return awaitEventResponse<KeyGenerateResult>({
            emitEvent: Events.Key.GENERATE,
            payload: createBaseEventPayload(
                Events.Key.GENERATE,
                requestedBy,
                config.channelId,
                {
                    channelId: config.channelId,
                    agentId: config.agentId,
                    name: config.name,
                    expiresAt: config.expiresAt?.toISOString()
                }
            ),
            route: { via: 'agent', agentId: requestedBy },
            successEvent: Events.Key.GENERATED,
            failureEvent: Events.Key.GENERATION_FAILED,
            correlate: (payload: any) => payload?.data?.channelId === config.channelId,
            mapResult: (payload: any) => ({
                keyId: payload.data.keyId,
                secretKey: payload.data.secretKey,
                channelId: payload.data.channelId,
                agentId: payload.data.agentId,
                expiresAt: payload.data.expiresAt
            }),
            timeoutMs: ADMIN_TIMEOUT_MS,
            description: `Key generation for channel '${config.channelId}'`,
            logger,
        });
    }

    /**
     * Deactivate a channel key.
     *
     * @param keyId - Key ID to deactivate
     * @param channelId - Channel ID the key belongs to
     * @param requestedBy - Agent ID requesting deactivation
     * @returns Promise that resolves when the key is deactivated
     * @throws EventRequestError if the server rejects the request
     * @throws EventRequestTimeoutError if the server does not answer
     *
     * @example
     * ```typescript
     * await AdminHelper.deactivateKey('key_123', 'my-channel', 'admin-agent');
     * ```
     */
    static async deactivateKey(
        keyId: string,
        channelId: string,
        requestedBy: string
    ): Promise<void> {
        await awaitEventResponse<void>({
            emitEvent: Events.Key.DEACTIVATE,
            payload: createBaseEventPayload(
                Events.Key.DEACTIVATE,
                requestedBy,
                channelId,
                { keyId }
            ),
            route: { via: 'agent', agentId: requestedBy },
            successEvent: Events.Key.DEACTIVATED,
            failureEvent: Events.Key.DEACTIVATION_FAILED,
            correlate: (payload: any) => payload?.data?.keyId === keyId,
            mapResult: () => undefined,
            timeoutMs: ADMIN_TIMEOUT_MS,
            description: `Key deactivation for '${keyId}'`,
            logger,
        });
    }

    /**
     * List channel keys.
     *
     * @param channelId - Channel ID to list keys for
     * @param requestedBy - Agent ID requesting the list
     * @param activeOnly - Whether to list only active keys (default: true)
     * @returns Promise resolving to array of key information
     * @throws EventRequestError if the server rejects the request
     * @throws EventRequestTimeoutError if the server does not answer
     *
     * @example
     * ```typescript
     * const keys = await AdminHelper.listKeys('my-channel', 'admin-agent', true);
     * console.log(`Found ${keys.length} active keys`);
     * ```
     */
    static async listKeys(
        channelId: string,
        requestedBy: string,
        activeOnly: boolean = true
    ): Promise<KeyInfo[]> {
        return awaitEventResponse<KeyInfo[]>({
            emitEvent: Events.Key.LIST,
            payload: createBaseEventPayload(
                Events.Key.LIST,
                requestedBy,
                channelId,
                { channelId, activeOnly }
            ),
            route: { via: 'agent', agentId: requestedBy },
            successEvent: Events.Key.LISTED,
            failureEvent: Events.Key.LIST_FAILED,
            correlate: (payload: any) => payload?.data?.channelId === channelId,
            mapResult: (payload: any) => payload.data.keys,
            timeoutMs: ADMIN_TIMEOUT_MS,
            description: `Key listing for channel '${channelId}'`,
            logger,
        });
    }
}
