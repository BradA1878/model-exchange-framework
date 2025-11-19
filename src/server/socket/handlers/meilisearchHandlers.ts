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
 * Meilisearch event handlers for server-side indexing with embeddings
 *
 * When semantic search is enabled, the SDK emits indexing requests to the server
 * instead of handling indexing directly. This allows the server to generate embeddings
 * and index documents with vector search support.
 */

import { Logger } from '../../../shared/utils/Logger';
import { EventBus } from '../../../shared/events/EventBus';
import { MxfMeilisearchService } from '../../../shared/services/MxfMeilisearchService';
import {
    createMeilisearchIndexEventPayload,
    createMeilisearchBackfillEventPayload,
    MeilisearchIndexEventData,
    MeilisearchBackfillEventData
} from '../../../shared/schemas/EventPayloadSchema';
import { v4 as uuidv4 } from 'uuid';

const logger = new Logger('debug', 'MeilisearchHandlers', 'server');

// Track if handlers are already setup
let handlersSetup = false;

/**
 * Setup server-side Meilisearch event handlers
 * These handlers process indexing requests from the SDK when semantic search is enabled
 */
export const setupMeilisearchHandlers = (): void => {
    if (handlersSetup) {
        logger.warn('Meilisearch handlers already setup, skipping duplicate registration');
        return;
    }

    handlersSetup = true;

    /**
     * Handle single message indexing requests from SDK
     * Event: meilisearch:index:request
     */
    EventBus.server.on('meilisearch:index:request', async (payload) => {
        const operationId = payload.data?.operationId || uuidv4();
        const startTime = Date.now();

        try {
            // Validate payload
            if (!payload || !payload.data || !payload.data.metadata || !payload.data.metadata.message) {
                throw new Error('Invalid indexing request payload - missing message data');
            }

            const { agentId, channelId } = payload;
            const message = payload.data.metadata.message;


            // Get Meilisearch service instance (server has embedding generator)
            const meilisearch = MxfMeilisearchService.getInstance();

            // Index the message with embedding generation
            await meilisearch.indexConversation({
                id: message.id,
                role: message.role,
                content: message.content,
                timestamp: message.timestamp,
                metadata: {
                    agentId,
                    channelId
                }
            });

            const duration = Date.now() - startTime;

            // Emit success event back to SDK
            const eventData: MeilisearchIndexEventData = {
                operationId,
                indexName: 'mxf-conversations',
                documentId: message.id,
                documentType: 'conversation',
                success: true,
                duration,
                metadata: {
                    agentId,
                    channelId,
                    timestamp: message.timestamp
                }
            };

            const successPayload = createMeilisearchIndexEventPayload(
                'meilisearch:index',
                agentId,
                channelId,
                eventData,
                { source: 'MeilisearchHandlers' }
            );

            EventBus.server.emit('meilisearch:index', successPayload);

        } catch (error) {
            const duration = Date.now() - startTime;

            // Emit failure event back to SDK
            const eventData: MeilisearchIndexEventData = {
                operationId,
                indexName: 'mxf-conversations',
                documentId: payload.data?.metadata?.message?.id || 'unknown',
                documentType: 'conversation',
                success: false,
                duration,
                error: error instanceof Error ? error.message : String(error),
                metadata: {
                    agentId: payload.agentId,
                    channelId: payload.channelId,
                    timestamp: payload.data?.metadata?.timestamp || Date.now()
                }
            };

            const errorPayload = createMeilisearchIndexEventPayload(
                'meilisearch:index:error',
                payload.agentId,
                payload.channelId,
                eventData,
                { source: 'MeilisearchHandlers' }
            );

            EventBus.server.emit('meilisearch:index:error', errorPayload);

            logger.error(`Failed to index message: ${error instanceof Error ? error.message : String(error)}`);
        }
    });

    /**
     * Handle batch backfill indexing requests from SDK
     * Event: meilisearch:backfill:request
     */
    EventBus.server.on('meilisearch:backfill:request', async (payload) => {
        const operationId = payload.data?.operationId || uuidv4();
        const startTime = Date.now();
        let indexedCount = 0;
        let failedCount = 0;

        try {
            // Validate payload
            if (!payload || !payload.data || !payload.data.metadata || !payload.data.metadata.messages) {
                throw new Error('Invalid backfill request payload - missing messages data');
            }

            const { agentId, channelId } = payload;
            const messages = payload.data.metadata.messages;


            // Get Meilisearch service instance (server has embedding generator)
            const meilisearch = MxfMeilisearchService.getInstance();

            // Index messages in batches
            const batchSize = 100;
            for (let i = 0; i < messages.length; i += batchSize) {
                const batch = messages.slice(i, i + batchSize);

                for (const message of batch) {
                    const messageStartTime = Date.now();
                    try {
                        await meilisearch.indexConversation({
                            id: message.id,
                            role: message.role,
                            content: message.content,
                            timestamp: message.timestamp,
                            metadata: {
                                agentId,
                                channelId
                            }
                        });
                        indexedCount++;

                        // Emit index event for each message (same as real-time indexing)
                        const messageDuration = Date.now() - messageStartTime;
                        const indexEventData: MeilisearchIndexEventData = {
                            operationId: `backfill-${operationId}-${message.id}`,
                            indexName: 'mxf-conversations',
                            documentId: message.id,
                            documentType: 'conversation',
                            success: true,
                            duration: messageDuration,
                            metadata: {
                                agentId,
                                channelId,
                                timestamp: message.timestamp,
                                isBackfill: true  // Flag to distinguish backfill from real-time
                            } as any  // Extended metadata for backfill tracking
                        };

                        const indexPayload = createMeilisearchIndexEventPayload(
                            'meilisearch:index',
                            agentId,
                            channelId,
                            indexEventData,
                            { source: 'MeilisearchHandlers:Backfill' }
                        );

                        EventBus.server.emit('meilisearch:index', indexPayload);
                    } catch (error) {
                        failedCount++;
                    }
                }

                // Small delay between batches
                if (i + batchSize < messages.length) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
            }

            const duration = Date.now() - startTime;
            const success = failedCount === 0;

            // Emit backfill event back to SDK
            const eventData: MeilisearchBackfillEventData = {
                operationId,
                indexName: 'mxf-conversations',
                totalDocuments: messages.length,
                indexedDocuments: indexedCount,
                failedDocuments: failedCount,
                duration,
                success,
                source: 'mongodb',
                metadata: {
                    agentId,
                    channelId,
                    startTimestamp: messages.length > 0 ? messages[0].timestamp : Date.now(),
                    endTimestamp: messages.length > 0 ? messages[messages.length - 1].timestamp : Date.now(),
                    batchSize
                }
            };

            const backfillPayload = createMeilisearchBackfillEventPayload(
                success ? 'meilisearch:backfill:complete' : 'meilisearch:backfill:partial',
                agentId,
                channelId,
                eventData,
                { source: 'MeilisearchHandlers' }
            );

            EventBus.server.emit(success ? 'meilisearch:backfill:complete' : 'meilisearch:backfill:partial', backfillPayload);

        } catch (error) {
            const duration = Date.now() - startTime;

            // Emit failure event back to SDK
            const eventData: MeilisearchBackfillEventData = {
                operationId,
                indexName: 'mxf-conversations',
                totalDocuments: payload.data?.totalDocuments || 0,
                indexedDocuments: indexedCount,
                failedDocuments: (payload.data?.totalDocuments || 0) - indexedCount,
                duration,
                success: false,
                source: 'mongodb',
                error: error instanceof Error ? error.message : String(error),
                metadata: {
                    agentId: payload.agentId,
                    channelId: payload.channelId,
                    batchSize: 100
                }
            };

            const errorPayload = createMeilisearchBackfillEventPayload(
                'meilisearch:backfill:error',
                payload.agentId,
                payload.channelId,
                eventData,
                { source: 'MeilisearchHandlers' }
            );

            EventBus.server.emit('meilisearch:backfill:error', errorPayload);

            logger.error(`Backfill failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    });

};
