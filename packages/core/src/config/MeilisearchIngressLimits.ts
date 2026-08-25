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
 * Size limits on the conversation search index's socket ingress.
 *
 * The server enforces these in MeilisearchIngressPolicy on every
 * `meilisearch:index:request` and `meilisearch:backfill:request`. The SDK
 * builds its memory-load backfill batches from the same numbers, so a batch
 * it sends is one the server accepts. Before this module existed the SDK
 * batched by count alone while the server rejected by bytes, and an agent
 * whose stored history was dense could never load it again: the same batch
 * was refused on every connect.
 */

/**
 * Largest single message content the index accepts, in UTF-8 bytes. A
 * larger message is not indexed: the live path drops it after the server
 * refuses it, and the backfill skips it without sending.
 *
 * This is larger than what the embedding model accepts in one request (about
 * 8192 tokens, see EmbeddingInputLimits). The server cuts the embedding input
 * to that ceiling; the whole message is still stored and keyword-searchable.
 */
export const MAX_MEILISEARCH_MESSAGE_BYTES = 64 * 1024;

/** Most messages one backfill request may carry. */
export const MAX_MEILISEARCH_BACKFILL_MESSAGES = 50;

/**
 * Most message content one backfill request may carry, as the sum of each
 * message's UTF-8 bytes.
 */
export const MAX_MEILISEARCH_BACKFILL_CONTENT_BYTES = 512 * 1024;

/**
 * Most bytes one backfill request event may occupy once serialized for the
 * socket, envelope included. JSON escaping makes a message's wire size larger
 * than its content bytes (a newline or quote is two bytes on the wire), so
 * the content limit alone does not bound the frame. Engine.IO closes a socket
 * that sends a frame above the server's message limit
 * (MXF_SOCKET_MAX_HTTP_BUFFER_BYTES, default 1 MiB), which would put the
 * agent in a reconnect loop instead of a policy rejection; the server refuses
 * to boot with a message limit this budget does not fit under.
 */
export const MAX_MEILISEARCH_BACKFILL_WIRE_BYTES = 768 * 1024;

/** UTF-8 byte length of message content — the measure every limit above uses. */
export const meilisearchContentBytes = (content: string): number =>
    Buffer.byteLength(content, 'utf8');
