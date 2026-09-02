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
 * Meilisearch event handlers for server-side indexing with embeddings
 *
 * When semantic search is enabled, the SDK emits indexing requests to the server
 * instead of handling indexing directly. This allows the server to generate embeddings
 * and index documents with vector search support.
 */

import { MeilisearchEvents } from '@mxf-dev/core/events/event-definitions/MeilisearchEvents';
import { Logger } from '@mxf-dev/core/utils/Logger';
import { EventBus } from '@mxf-dev/core/events/EventBus';
import { MxfMeilisearchService } from '@mxf-dev/core/services/MxfMeilisearchService';
import {
    createMeilisearchIndexEventPayload,
    createMeilisearchBackfillEventPayload,
    MeilisearchIndexEventData,
    MeilisearchBackfillEventData
} from '@mxf-dev/core/schemas/EventPayloadSchema';
import { v4 as uuidv4 } from 'uuid';
import { authorizeMeilisearchSocketRequest } from '../security/MeilisearchIngressPolicy';

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
    EventBus.server.on(MeilisearchEvents.INDEX_REQUEST, async (payload) => {
        const operationId = payload.data?.operationId || uuidv4();
        const startTime = Date.now();

        try {
            const { agentId, channelId } = payload;
            const safeData = authorizeMeilisearchSocketRequest(
                MeilisearchEvents.INDEX_REQUEST,
                payload.data,
                agentId,
                channelId,
                false
            );
            const safeMetadata = safeData.metadata as Record<string, unknown>;
            const message = safeMetadata.message as {
                id: string;
                sourceDocumentId: string;
                role: 'user' | 'assistant' | 'system' | 'tool';
                content: string;
                timestamp: number;
            };


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
                    channelId,
                    sourceDocumentId: message.sourceDocumentId
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
                MeilisearchEvents.INDEX,
                agentId,
                channelId,
                eventData,
                { source: 'MeilisearchHandlers' }
            );

            EventBus.server.emit(MeilisearchEvents.INDEX, successPayload);

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
                MeilisearchEvents.INDEX_ERROR,
                payload.agentId,
                payload.channelId,
                eventData,
                { source: 'MeilisearchHandlers' }
            );

            EventBus.server.emit(MeilisearchEvents.INDEX_ERROR, errorPayload);

            logger.error(`Failed to index message: ${error instanceof Error ? error.message : String(error)}`);
        }
    });

    /**
     * Handle batch backfill indexing requests from SDK
     * Event: meilisearch:backfill:request
     */
    EventBus.server.on(MeilisearchEvents.BACKFILL_REQUEST, async (payload) => {
        const operationId = payload.data?.operationId || uuidv4();
        const startTime = Date.now();
        let indexedCount = 0;
        let failedCount = 0;

        try {
            const { agentId, channelId } = payload;
            const safeData = authorizeMeilisearchSocketRequest(
                MeilisearchEvents.BACKFILL_REQUEST,
                payload.data,
                agentId,
                channelId,
                false
            );
            const safeMetadata = safeData.metadata as Record<string, unknown>;
            const messages = safeMetadata.messages as Array<{
                id: string;
                sourceDocumentId: string;
                role: 'user' | 'assistant' | 'system' | 'tool';
                content: string;
                timestamp: number;
            }>;


            // Get Meilisearch service instance (server has embedding generator)
            const meilisearch = MxfMeilisearchService.getInstance();
            // Documents the live path indexed on an earlier connect are still in
            // the index. Asking is one GET each; indexing again is an embedding
            // call and an index task each — paid for the whole history on every
            // connect before this.
            const alreadyIndexed = await meilisearch.findIndexedConversationIds(messages.map(message => message.id));
            let alreadyIndexedCount = 0;

            // Index messages in batches
            const batchSize = Math.min(25, messages.length);
            for (let i = 0; i < messages.length; i += batchSize) {
                const batch = messages.slice(i, i + batchSize);

                for (const message of batch) {
                    if (alreadyIndexed.has(message.id)) {
                        indexedCount++;
                        alreadyIndexedCount++;
                        continue;
                    }
                    const messageStartTime = Date.now();
                    try {
                        await meilisearch.indexConversation({
                            id: message.id,
                            role: message.role,
                            content: message.content,
                            timestamp: message.timestamp,
                            metadata: {
                                agentId,
                                channelId,
                                sourceDocumentId: message.sourceDocumentId
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
                            MeilisearchEvents.INDEX,
                            agentId,
                            channelId,
                            indexEventData,
                            { source: 'MeilisearchHandlers:Backfill' }
                        );

                        EventBus.server.emit(MeilisearchEvents.INDEX, indexPayload);
                    } catch (error) {
                        failedCount++;
                    }
                }

            }

            const duration = Date.now() - startTime;
            if (alreadyIndexedCount > 0) {
                logger.info(
                    `Backfill ${operationId}: ${alreadyIndexedCount} of ${messages.length} documents were already ` +
                    'in the index and were not indexed again'
                );
            }
            const success = failedCount === 0;

            // Emit backfill event back to SDK
            const eventData: MeilisearchBackfillEventData = {
                operationId,
                indexName: 'mxf-conversations',
                totalDocuments: messages.length,
                indexedDocuments: indexedCount,
                alreadyIndexedDocuments: alreadyIndexedCount,
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
                success ? MeilisearchEvents.BACKFILL_COMPLETE : MeilisearchEvents.BACKFILL_PARTIAL,
                agentId,
                channelId,
                eventData,
                { source: 'MeilisearchHandlers' }
            );

            EventBus.server.emit(
                success ? MeilisearchEvents.BACKFILL_COMPLETE : MeilisearchEvents.BACKFILL_PARTIAL,
                backfillPayload
            );

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
                MeilisearchEvents.BACKFILL_ERROR,
                payload.agentId,
                payload.channelId,
                eventData,
                { source: 'MeilisearchHandlers' }
            );

            EventBus.server.emit(MeilisearchEvents.BACKFILL_ERROR, errorPayload);

            logger.error(`Backfill failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    });

};
