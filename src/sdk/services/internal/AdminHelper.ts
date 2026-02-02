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
 * Admin Helper
 * 
 * Internal helper for admin operations (channel/key management).
 * Provides event-driven alternatives to HTTP API calls.
 * Hides EventBus complexity from SDK users.
 */

import { EventBus } from '../../../shared/events/EventBus';
import { Events } from '../../../shared/events/EventNames';
import { createBaseEventPayload } from '../../../shared/schemas/EventPayloadSchema';
import { v4 as uuidv4 } from 'uuid';

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
 * Admin Helper - provides clean SDK interface for admin operations
 */
export class AdminHelper {
    /**
     * Create a channel via event-driven architecture
     * 
     * @param config - Channel creation configuration
     * @param createdBy - Agent ID creating the channel
     * @returns Promise resolving to channel creation result
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
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                EventBus.client.off(Events.Channel.CREATED, successHandler);
                EventBus.client.off(Events.Channel.CREATION_FAILED, failureHandler);
                reject(new Error('Channel creation timeout'));
            }, 30000); // 30 second timeout

            const successHandler = (payload: any): void => {
                if (payload.channelId === config.channelId) {
                    clearTimeout(timeout);
                    EventBus.client.off(Events.Channel.CREATED, successHandler);
                    EventBus.client.off(Events.Channel.CREATION_FAILED, failureHandler);
                    resolve({
                        channelId: payload.data.channelId,
                        name: payload.data.name
                    });
                }
            };

            const failureHandler = (payload: any): void => {
                if (payload.channelId === config.channelId) {
                    clearTimeout(timeout);
                    EventBus.client.off(Events.Channel.CREATED, successHandler);
                    EventBus.client.off(Events.Channel.CREATION_FAILED, failureHandler);
                    reject(new Error(payload.data.error || 'Channel creation failed'));
                }
            };

            EventBus.client.on(Events.Channel.CREATED, successHandler);
            EventBus.client.on(Events.Channel.CREATION_FAILED, failureHandler);

            // Emit create channel event
            const createPayload = createBaseEventPayload(
                Events.Channel.CREATE,
                createdBy,
                config.channelId,
                {
                    name: config.name,
                    metadata: config.metadata
                }
            );

            EventBus.client.emitOn(createdBy, Events.Channel.CREATE, createPayload);
        });
    }

    /**
     * Generate a channel key via event-driven architecture
     * 
     * @param config - Key generation configuration
     * @param requestedBy - Agent ID requesting the key
     * @returns Promise resolving to key generation result
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
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                EventBus.client.off(Events.Key.GENERATED, successHandler);
                EventBus.client.off(Events.Key.GENERATION_FAILED, failureHandler);
                reject(new Error('Key generation timeout'));
            }, 30000); // 30 second timeout

            const successHandler = (payload: any): void => {
                if (payload.channelId === config.channelId) {
                    clearTimeout(timeout);
                    EventBus.client.off(Events.Key.GENERATED, successHandler);
                    EventBus.client.off(Events.Key.GENERATION_FAILED, failureHandler);
                    resolve({
                        keyId: payload.data.keyId,
                        secretKey: payload.data.secretKey,
                        channelId: payload.data.channelId,
                        agentId: payload.data.agentId,
                        expiresAt: payload.data.expiresAt
                    });
                }
            };

            const failureHandler = (payload: any): void => {
                if (payload.data?.channelId === config.channelId) {
                    clearTimeout(timeout);
                    EventBus.client.off(Events.Key.GENERATED, successHandler);
                    EventBus.client.off(Events.Key.GENERATION_FAILED, failureHandler);
                    reject(new Error(payload.data.error || 'Key generation failed'));
                }
            };

            EventBus.client.on(Events.Key.GENERATED, successHandler);
            EventBus.client.on(Events.Key.GENERATION_FAILED, failureHandler);

            // Emit generate key event
            const generatePayload = createBaseEventPayload(
                Events.Key.GENERATE,
                requestedBy,
                config.channelId,
                {
                    channelId: config.channelId,
                    agentId: config.agentId,
                    name: config.name,
                    expiresAt: config.expiresAt?.toISOString()
                }
            );

            EventBus.client.emitOn(requestedBy, Events.Key.GENERATE, generatePayload);
        });
    }

    /**
     * Deactivate a channel key via event-driven architecture
     * 
     * @param keyId - Key ID to deactivate
     * @param channelId - Channel ID the key belongs to
     * @param requestedBy - Agent ID requesting deactivation
     * @returns Promise resolving when key is deactivated
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
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                EventBus.client.off(Events.Key.DEACTIVATED, successHandler);
                EventBus.client.off(Events.Key.DEACTIVATION_FAILED, failureHandler);
                reject(new Error('Key deactivation timeout'));
            }, 30000); // 30 second timeout

            const successHandler = (payload: any): void => {
                if (payload.data.keyId === keyId) {
                    clearTimeout(timeout);
                    EventBus.client.off(Events.Key.DEACTIVATED, successHandler);
                    EventBus.client.off(Events.Key.DEACTIVATION_FAILED, failureHandler);
                    resolve();
                }
            };

            const failureHandler = (payload: any): void => {
                if (payload.data?.keyId === keyId) {
                    clearTimeout(timeout);
                    EventBus.client.off(Events.Key.DEACTIVATED, successHandler);
                    EventBus.client.off(Events.Key.DEACTIVATION_FAILED, failureHandler);
                    reject(new Error(payload.data.error || 'Key deactivation failed'));
                }
            };

            EventBus.client.on(Events.Key.DEACTIVATED, successHandler);
            EventBus.client.on(Events.Key.DEACTIVATION_FAILED, failureHandler);

            // Emit deactivate key event
            const deactivatePayload = createBaseEventPayload(
                Events.Key.DEACTIVATE,
                requestedBy,
                channelId,
                {
                    keyId
                }
            );

            EventBus.client.emitOn(requestedBy, Events.Key.DEACTIVATE, deactivatePayload);
        });
    }

    /**
     * List channel keys via event-driven architecture
     * 
     * @param channelId - Channel ID to list keys for
     * @param requestedBy - Agent ID requesting the list
     * @param activeOnly - Whether to list only active keys (default: true)
     * @returns Promise resolving to array of key information
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
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                EventBus.client.off(Events.Key.LISTED, successHandler);
                EventBus.client.off(Events.Key.LIST_FAILED, failureHandler);
                reject(new Error('Key listing timeout'));
            }, 30000); // 30 second timeout

            const successHandler = (payload: any): void => {
                if (payload.data.channelId === channelId) {
                    clearTimeout(timeout);
                    EventBus.client.off(Events.Key.LISTED, successHandler);
                    EventBus.client.off(Events.Key.LIST_FAILED, failureHandler);
                    resolve(payload.data.keys);
                }
            };

            const failureHandler = (payload: any): void => {
                if (payload.data?.channelId === channelId) {
                    clearTimeout(timeout);
                    EventBus.client.off(Events.Key.LISTED, successHandler);
                    EventBus.client.off(Events.Key.LIST_FAILED, failureHandler);
                    reject(new Error(payload.data.error || 'Key listing failed'));
                }
            };

            EventBus.client.on(Events.Key.LISTED, successHandler);
            EventBus.client.on(Events.Key.LIST_FAILED, failureHandler);

            // Emit list keys event
            const listPayload = createBaseEventPayload(
                Events.Key.LIST,
                requestedBy,
                channelId,
                {
                    channelId,
                    activeOnly
                }
            );

            EventBus.client.emitOn(requestedBy, Events.Key.LIST, listPayload);
        });
    }
}
