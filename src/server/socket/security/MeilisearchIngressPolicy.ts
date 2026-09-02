import { createHash } from 'crypto';
import { randomUUID } from 'crypto';
import { MeilisearchEvents } from '@mxf-dev/core/events/event-definitions/MeilisearchEvents';
import type {
    MeilisearchBackfillEventData,
    MeilisearchIndexEventData
} from '@mxf-dev/core/schemas/EventPayloadSchema';
import {
    MAX_MEILISEARCH_BACKFILL_CONTENT_BYTES,
    MAX_MEILISEARCH_BACKFILL_MESSAGES,
    MAX_MEILISEARCH_MESSAGE_BYTES,
    meilisearchContentBytes
} from '@mxf-dev/core/config/MeilisearchIngressLimits';
import { BoundedFixedWindowRateLimiter } from '../../security/BoundedFixedWindowRateLimiter';
import {
    getMeilisearchSocketRateLimitConfig,
    MEILISEARCH_SOCKET_RATE_LIMIT_MAX_ENV
} from '../../config/IngressSecurityConfig';

const INDEX_NAME = 'mxf-conversations';
const ROLES = new Set(['user', 'assistant', 'system', 'tool']);

let requestLimiter: BoundedFixedWindowRateLimiter | undefined;
/**
 * The configured window maximum, set alongside `requestLimiter` the first
 * time `getLimiter()` builds it. `chargeRateLimit` reads this to refuse a
 * request whose cost could never fit the window, without reconstructing the
 * limiter's config on every call.
 */
let configuredMaximum: number | undefined;

const getLimiter = (): BoundedFixedWindowRateLimiter => {
    if (!requestLimiter) {
        const config = getMeilisearchSocketRateLimitConfig();
        requestLimiter = new BoundedFixedWindowRateLimiter(
            config.maximum,
            config.windowMs,
            config.maximumKeys
        );
        configuredMaximum = config.maximum;
    }
    return requestLimiter;
};

const isRecord = (value: unknown): value is Record<string, unknown> => (
    value !== null && typeof value === 'object' && !Array.isArray(value)
);

const readBoundedString = (value: unknown, name: string, maximum: number): string => {
    if (typeof value !== 'string' || value.trim().length === 0 || value.length > maximum) {
        throw new Error(`${name} must be a non-empty string of at most ${maximum} characters`);
    }
    return value.trim();
};

export const namespaceMeilisearchDocumentId = (
    channelId: string,
    agentId: string,
    sourceDocumentId: string
): string => `mxf_${createHash('sha256')
    .update(channelId)
    .update('\0')
    .update(agentId)
    .update('\0')
    .update(sourceDocumentId)
    .digest('hex')}`;

interface SafeMessage {
    id: string;
    sourceDocumentId: string;
    role: 'user' | 'assistant' | 'system' | 'tool';
    content: string;
    timestamp: number;
}

const parseMessage = (value: unknown, channelId: string, agentId: string): SafeMessage => {
    if (!isRecord(value)) {
        throw new Error('message must be an object');
    }
    const sourceDocumentId = readBoundedString(
        value.sourceDocumentId ?? value.id,
        'message.id',
        256
    );
    const role = readBoundedString(value.role, 'message.role', 16);
    if (!ROLES.has(role)) {
        throw new Error('message.role is invalid');
    }
    if (typeof value.content !== 'string' || value.content.length === 0) {
        throw new Error('message.content must be a non-empty string');
    }
    const contentBytes = meilisearchContentBytes(value.content);
    if (contentBytes > MAX_MEILISEARCH_MESSAGE_BYTES) {
        throw new Error(`message.content exceeds ${MAX_MEILISEARCH_MESSAGE_BYTES} bytes`);
    }
    if (typeof value.timestamp !== 'number' ||
        !Number.isSafeInteger(value.timestamp) || value.timestamp < 0) {
        throw new Error('message.timestamp must be a non-negative safe integer');
    }

    return {
        id: namespaceMeilisearchDocumentId(channelId, agentId, sourceDocumentId),
        sourceDocumentId,
        role: role as SafeMessage['role'],
        content: value.content,
        timestamp: value.timestamp
    };
};

/**
 * Charge the ingress rate limiter for one request. A request whose cost is
 * larger than the window's configured maximum can never be admitted no
 * matter how long the caller waits: `BoundedFixedWindowRateLimiter.consumeMany`
 * reports that shape as `{ allowed: false, retryAfterMs: windowMs }` every
 * time, which would put the SDK in a permanent resend loop instead of telling
 * it the batch does not fit this server's setting. Refuse it here, before
 * consuming, with a plain `Error` — `buildMeilisearchIngressFailure` reports
 * a plain `Error` without a retry hint, since only `MeilisearchRateLimitError`
 * carries one.
 */
const chargeRateLimit = (
    channelId: string,
    agentId: string,
    workUnits: number
): void => {
    const limiter = getLimiter();
    const maximum = configuredMaximum;
    if (maximum !== undefined && workUnits > maximum) {
        throw new Error(
            `Meilisearch request needs ${workUnits} work units, which exceeds the ` +
            `${MEILISEARCH_SOCKET_RATE_LIMIT_MAX_ENV} maximum of ${maximum}; this ` +
            'request can never be admitted at this setting'
        );
    }
    const decision = limiter.consumeMany(
        [`channel\0${channelId}`, `agent\0${channelId}\0${agentId}`],
        workUnits
    );
    if (!decision.allowed) {
        throw new MeilisearchRateLimitError(decision.retryAfterMs);
    }
};

/**
 * A request refused by the ingress rate limiter. The SDK's indexing queue
 * waits `retryAfterMs` and sends the same request again; it reads the delay
 * from the failure payload, never from this message.
 */
export class MeilisearchRateLimitError extends Error {
    public readonly retryAfterMs: number;

    constructor(retryAfterMs: number) {
        super(`Meilisearch request rate limit exceeded; retry after ${retryAfterMs}ms`);
        this.name = 'MeilisearchRateLimitError';
        this.retryAfterMs = retryAfterMs;
    }
}

export type MeilisearchIngressFailure =
    | { event: typeof MeilisearchEvents.INDEX_ERROR; data: MeilisearchIndexEventData }
    | { event: typeof MeilisearchEvents.BACKFILL_ERROR; data: MeilisearchBackfillEventData };

/**
 * Build the correlated failure event for a socket indexing request the
 * ingress refused. The request may be malformed, so every field is read
 * defensively; a throttled request carries `retryAfterMs` as a field.
 */
export const buildMeilisearchIngressFailure = (
    eventName: string,
    rawData: unknown,
    agentId: string,
    channelId: string,
    error: unknown
): MeilisearchIngressFailure => {
    const data = isRecord(rawData) ? rawData : {};
    const operationId = typeof data.operationId === 'string' && data.operationId.trim().length > 0
        ? data.operationId.slice(0, 128)
        : randomUUID();
    const errorMessage = error instanceof Error ? error.message : String(error);
    const retryAfterMs = error instanceof MeilisearchRateLimitError ? error.retryAfterMs : undefined;

    if (eventName === MeilisearchEvents.INDEX_REQUEST) {
        const metadata = isRecord(data.metadata) ? data.metadata : {};
        const message = isRecord(metadata.message) ? metadata.message : {};
        return {
            event: MeilisearchEvents.INDEX_ERROR,
            data: {
                operationId,
                indexName: INDEX_NAME,
                documentId: typeof message.id === 'string' && message.id.trim().length > 0
                    ? message.id.slice(0, 256)
                    : 'unknown',
                documentType: 'conversation',
                success: false,
                duration: 0,
                error: errorMessage,
                ...(retryAfterMs !== undefined && { retryAfterMs }),
                metadata: { agentId, channelId, timestamp: Date.now() }
            }
        };
    }
    return {
        event: MeilisearchEvents.BACKFILL_ERROR,
        data: {
            operationId,
            indexName: INDEX_NAME,
            totalDocuments: 0,
            indexedDocuments: 0,
            failedDocuments: 0,
            duration: 0,
            success: false,
            source: 'memory',
            error: errorMessage,
            ...(retryAfterMs !== undefined && { retryAfterMs }),
            metadata: { agentId, channelId, batchSize: 0 }
        }
    };
};

export type SafeMeilisearchRequestData = Record<string, unknown>;

const SETTLED_SOURCES = new Set(['mongodb', 'memory', 'other']);
const MAX_SETTLED_ERROR_CHARS = 1024;

/**
 * Validate the SDK's settled memory-load report: every count a non-negative
 * safe integer, the counts adding up, a boolean outcome, a bounded error text,
 * and a known source. Nothing in it is indexed, so it costs one work unit.
 * AgentService marks the agent ready for the memory_search_* tools from it.
 */
const authorizeSettledReport = (
    rawData: Record<string, unknown>,
    operationId: string,
    agentId: string,
    channelId: string,
    enforceRateLimit: boolean
): SafeMeilisearchRequestData => {
    const readCount = (name: string, fallback?: number): number => {
        const value = rawData[name] ?? fallback;
        if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
            throw new Error('settled counts must be non-negative safe integers');
        }
        return value;
    };
    const totalDocuments = readCount('totalDocuments');
    const indexedDocuments = readCount('indexedDocuments');
    const failedDocuments = readCount('failedDocuments');
    const skippedDocuments = readCount('skippedDocuments', 0);
    const alreadyIndexedDocuments = readCount('alreadyIndexedDocuments', 0);
    if (indexedDocuments + failedDocuments + skippedDocuments !== totalDocuments) {
        throw new Error('settled counts must add up: indexed + failed + skipped = total');
    }
    // Documents the index already had are a subset of the indexed ones.
    if (alreadyIndexedDocuments > indexedDocuments) {
        throw new Error('settled counts must add up: already indexed cannot exceed indexed');
    }
    if (typeof rawData.success !== 'boolean') {
        throw new Error('settled success must be a boolean');
    }
    if (rawData.error !== undefined &&
        (typeof rawData.error !== 'string' || rawData.error.length > MAX_SETTLED_ERROR_CHARS)) {
        throw new Error(`settled error must be a string of at most ${MAX_SETTLED_ERROR_CHARS} characters`);
    }
    if (typeof rawData.source !== 'string' || !SETTLED_SOURCES.has(rawData.source)) {
        throw new Error('settled source is invalid');
    }
    if (enforceRateLimit) {
        chargeRateLimit(channelId, agentId, 1);
    }

    return {
        operationId,
        indexName: INDEX_NAME,
        documentType: 'conversation',
        totalDocuments,
        indexedDocuments,
        failedDocuments,
        skippedDocuments,
        alreadyIndexedDocuments,
        duration: 0,
        success: rawData.success,
        source: rawData.source,
        ...(rawData.error !== undefined && { error: rawData.error }),
        metadata: { agentId, channelId }
    };
};

/** Validate, bound, and canonicalize a socket indexing request. */
export const authorizeMeilisearchSocketRequest = (
    eventName: string,
    rawData: unknown,
    agentId: string,
    channelId: string,
    enforceRateLimit: boolean = true
): SafeMeilisearchRequestData => {
    if (!isRecord(rawData)) {
        throw new Error('Meilisearch request data must be an object');
    }
    const operationId = readBoundedString(rawData.operationId, 'operationId', 128);
    if (rawData.indexName !== INDEX_NAME || rawData.documentType !== 'conversation') {
        throw new Error('Only the mxf-conversations conversation index is accepted');
    }
    if (!isRecord(rawData.metadata)) {
        throw new Error('metadata must be an object');
    }

    if (eventName === MeilisearchEvents.INDEX_REQUEST) {
        const message = parseMessage(rawData.metadata.message, channelId, agentId);
        if (enforceRateLimit) {
            chargeRateLimit(
                channelId,
                agentId,
                Math.max(1, Math.ceil(meilisearchContentBytes(message.content) / 4096))
            );
        }
        return {
            operationId,
            indexName: INDEX_NAME,
            documentId: message.id,
            documentType: 'conversation',
            success: true,
            duration: 0,
            metadata: {
                agentId,
                channelId,
                timestamp: message.timestamp,
                message
            }
        };
    }

    if (eventName === MeilisearchEvents.BACKFILL_SETTLED) {
        return authorizeSettledReport(rawData, operationId, agentId, channelId, enforceRateLimit);
    }

    if (eventName !== MeilisearchEvents.BACKFILL_REQUEST) {
        throw new Error('Unsupported Meilisearch socket request event');
    }

    const rawMessages = rawData.metadata.messages;
    if (!Array.isArray(rawMessages) || rawMessages.length === 0 ||
        rawMessages.length > MAX_MEILISEARCH_BACKFILL_MESSAGES) {
        throw new Error(
            `metadata.messages must contain 1-${MAX_MEILISEARCH_BACKFILL_MESSAGES} messages`
        );
    }
    const messages = rawMessages.map(message => parseMessage(message, channelId, agentId));
    const totalBytes = messages.reduce(
        (total, message) => total + meilisearchContentBytes(message.content),
        0
    );
    if (totalBytes > MAX_MEILISEARCH_BACKFILL_CONTENT_BYTES) {
        throw new Error(
            `backfill content exceeds ${MAX_MEILISEARCH_BACKFILL_CONTENT_BYTES} bytes`
        );
    }
    if (enforceRateLimit) {
        const workUnits = messages.reduce(
            (total, message) => total + Math.max(
                1,
                Math.ceil(meilisearchContentBytes(message.content) / 4096)
            ),
            0
        );
        chargeRateLimit(channelId, agentId, workUnits);
    }

    return {
        operationId,
        indexName: INDEX_NAME,
        totalDocuments: messages.length,
        indexedDocuments: 0,
        failedDocuments: 0,
        duration: 0,
        success: true,
        source: 'memory',
        documentType: 'conversation',
        metadata: {
            agentId,
            channelId,
            startTimestamp: messages[0].timestamp,
            endTimestamp: messages[messages.length - 1].timestamp,
            batchSize: Math.min(25, messages.length),
            messages
        }
    };
};

export const resetMeilisearchIngressRateLimiterForTests = (): void => {
    requestLimiter?.reset();
    requestLimiter = undefined;
    configuredMaximum = undefined;
};
