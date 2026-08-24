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
 * Splits persisted conversation history into batches the server's Meilisearch
 * ingress will accept, and reports which messages cannot be sent at all.
 *
 * Pure and synchronous: no logging, no I/O, no event emission. MxfMemoryManager
 * calls this to plan a memory-load backfill, then sends each planned batch
 * itself.
 *
 * Before this module existed, the SDK batched purely by message count (50 per
 * request) while the server also rejects a batch whose summed content bytes,
 * or whose serialized wire size, cross their own limits (see
 * MeilisearchIngressLimits in @mxf-dev/core). An agent whose persisted history
 * was dense enough to cross either limit could never load it again: the same
 * oversized batch was rejected on every connect. Batching by all three
 * measures — and skipping outright a single message too large to ever fit —
 * makes every planned batch one the server can accept.
 */
import { ConversationMessage } from '@mxf-dev/core/interfaces/ConversationMessage';
import {
    MAX_MEILISEARCH_MESSAGE_BYTES,
    MAX_MEILISEARCH_BACKFILL_MESSAGES,
    MAX_MEILISEARCH_BACKFILL_CONTENT_BYTES,
    MAX_MEILISEARCH_BACKFILL_WIRE_BYTES,
    meilisearchContentBytes
} from '@mxf-dev/core/config/MeilisearchIngressLimits';

/** One conversation message as it goes out on the wire in a backfill request. */
export interface BackfillWireMessage {
    id: string;
    role: ConversationMessage['role'];
    content: string;
    timestamp: number;
}

/** The four independent caps a planned batch must stay under. */
export interface BackfillBatchLimits {
    /** Most messages a single batch may carry. */
    maxMessages: number;
    /** Most bytes a batch's message content may sum to. */
    maxContentBytes: number;
    /** Most bytes a batch's request event may occupy once serialized for the socket. */
    maxWireBytes: number;
    /** Largest content a single message may carry; a bigger message is skipped, never sent. */
    maxMessageBytes: number;
}

/** The limits the server currently enforces, read from the shared core config. */
export const DEFAULT_BACKFILL_BATCH_LIMITS: BackfillBatchLimits = {
    maxMessages: MAX_MEILISEARCH_BACKFILL_MESSAGES,
    maxContentBytes: MAX_MEILISEARCH_BACKFILL_CONTENT_BYTES,
    maxWireBytes: MAX_MEILISEARCH_BACKFILL_WIRE_BYTES,
    maxMessageBytes: MAX_MEILISEARCH_MESSAGE_BYTES
};

/** A message no batch could carry, and why. */
export interface SkippedBackfillMessage {
    id: string;
    contentBytes: number;
    reason: string;
}

export interface BackfillBatchPlan {
    /** Batches in send order; each is small enough for the server to accept whole. */
    batches: BackfillWireMessage[][];
    /** Messages no batch could carry, in their original order. */
    skipped: SkippedBackfillMessage[];
}

const assertPositiveSafeInteger = (value: number, name: string): void => {
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new Error(
            `planMeilisearchBackfillBatches: limits.${name} must be a positive safe integer, got ${value}`
        );
    }
};

const validateLimits = (limits: BackfillBatchLimits): void => {
    assertPositiveSafeInteger(limits.maxMessages, 'maxMessages');
    assertPositiveSafeInteger(limits.maxContentBytes, 'maxContentBytes');
    assertPositiveSafeInteger(limits.maxWireBytes, 'maxWireBytes');
    assertPositiveSafeInteger(limits.maxMessageBytes, 'maxMessageBytes');
};

const validateReservedWireBytes = (reservedWireBytes: number, limits: BackfillBatchLimits): void => {
    if (!Number.isSafeInteger(reservedWireBytes) || reservedWireBytes < 0) {
        throw new Error(
            'planMeilisearchBackfillBatches: reservedWireBytes must be a non-negative safe integer, ' +
            `got ${reservedWireBytes}`
        );
    }
    if (reservedWireBytes >= limits.maxWireBytes) {
        throw new Error(
            `planMeilisearchBackfillBatches: reservedWireBytes (${reservedWireBytes}) must be strictly below ` +
            `limits.maxWireBytes (${limits.maxWireBytes})`
        );
    }
};

/** UTF-8 bytes of a message once it is serialized alone on the wire. */
const wireBytesOf = (message: BackfillWireMessage): number =>
    Buffer.byteLength(JSON.stringify(message), 'utf8');

/**
 * Plan how persisted history should be split into backfill requests.
 *
 * Closes the current batch and starts a new one before adding a message that
 * would push the batch's count, content bytes, or wire bytes over the limit
 * (wire bytes include one comma byte for every message after the first, the
 * cost of joining them into a JSON array). A message whose own content
 * exceeds maxMessageBytes is skipped outright — the server refuses it however
 * it is sent, alone or otherwise. A message that clears the per-message limit
 * but still could not fit an otherwise-empty batch is skipped too, with a
 * reason naming the batch-level limit it cannot clear; this is only reachable
 * with limits narrower than the defaults, since a message under
 * maxMessageBytes always fits an empty batch under the default
 * maxContentBytes and maxWireBytes.
 *
 * Every input message ends up in exactly one batch or in `skipped`, and
 * relative order is preserved in both.
 */
export function planMeilisearchBackfillBatches(
    messages: readonly BackfillWireMessage[],
    reservedWireBytes: number,
    limits: BackfillBatchLimits = DEFAULT_BACKFILL_BATCH_LIMITS
): BackfillBatchPlan {
    validateLimits(limits);
    validateReservedWireBytes(reservedWireBytes, limits);

    const batches: BackfillWireMessage[][] = [];
    const skipped: SkippedBackfillMessage[] = [];
    let currentBatch: BackfillWireMessage[] = [];
    let currentContentBytes = 0;
    let currentWireBytes = reservedWireBytes;

    const closeCurrentBatch = (): void => {
        if (currentBatch.length > 0) {
            batches.push(currentBatch);
        }
        currentBatch = [];
        currentContentBytes = 0;
        currentWireBytes = reservedWireBytes;
    };

    for (const message of messages) {
        const contentBytes = meilisearchContentBytes(message.content);

        if (contentBytes > limits.maxMessageBytes) {
            skipped.push({
                id: message.id,
                contentBytes,
                reason: `content is ${contentBytes} bytes, exceeding the ${limits.maxMessageBytes}-byte per-message limit`
            });
            continue;
        }

        if (contentBytes > limits.maxContentBytes) {
            skipped.push({
                id: message.id,
                contentBytes,
                reason: `content is ${contentBytes} bytes, exceeding the ${limits.maxContentBytes}-byte ` +
                    'batch content limit even alone in a batch'
            });
            continue;
        }

        const messageWireBytes = wireBytesOf(message);
        if (reservedWireBytes + messageWireBytes > limits.maxWireBytes) {
            skipped.push({
                id: message.id,
                contentBytes,
                reason: `serialized message is ${reservedWireBytes + messageWireBytes} bytes, exceeding the ` +
                    `${limits.maxWireBytes}-byte batch wire limit even alone in a batch`
            });
            continue;
        }

        if (currentBatch.length > 0) {
            const projectedCount = currentBatch.length + 1;
            const projectedContentBytes = currentContentBytes + contentBytes;
            const projectedWireBytes = currentWireBytes + 1 + messageWireBytes; // +1 for the joining comma
            if (
                projectedCount > limits.maxMessages ||
                projectedContentBytes > limits.maxContentBytes ||
                projectedWireBytes > limits.maxWireBytes
            ) {
                closeCurrentBatch();
            }
        }

        const commaBytes = currentBatch.length > 0 ? 1 : 0;
        currentBatch.push(message);
        currentContentBytes += contentBytes;
        currentWireBytes += messageWireBytes + commaBytes;
    }
    closeCurrentBatch();

    return { batches, skipped };
}
