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
 * Meilisearch Event Names and Payloads
 * Events for server-side indexing with embeddings
 */

import { BaseEventPayload } from '../../schemas/EventPayloadSchema';

/**
 * Meilisearch event names
 */
export const MeilisearchEvents = {
    // Indexing requests from SDK
    INDEX_REQUEST: 'meilisearch:index:request',
    BACKFILL_REQUEST: 'meilisearch:backfill:request',

    // Indexing responses to SDK
    INDEX: 'meilisearch:index',
    INDEX_ERROR: 'meilisearch:index:error',
    BACKFILL_COMPLETE: 'meilisearch:backfill:complete',
    BACKFILL_PARTIAL: 'meilisearch:backfill:partial',
    BACKFILL_ERROR: 'meilisearch:backfill:error',
} as const;

/**
 * Meilisearch event payload types
 */
export interface MeilisearchPayloads {
    'meilisearch:index:request': BaseEventPayload<any>;
    'meilisearch:backfill:request': BaseEventPayload<any>;
    'meilisearch:index': BaseEventPayload<any>;
    'meilisearch:index:error': BaseEventPayload<any>;
    'meilisearch:backfill:complete': BaseEventPayload<any>;
    'meilisearch:backfill:partial': BaseEventPayload<any>;
    'meilisearch:backfill:error': BaseEventPayload<any>;
}
