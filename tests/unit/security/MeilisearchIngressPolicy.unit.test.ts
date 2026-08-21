import { MeilisearchEvents } from '@mxf-dev/core/events/event-definitions/MeilisearchEvents';
import {
    authorizeMeilisearchSocketRequest,
    buildMeilisearchIngressFailure,
    MeilisearchRateLimitError,
    MAX_MEILISEARCH_BACKFILL_CONTENT_BYTES,
    MAX_MEILISEARCH_BACKFILL_MESSAGES,
    MAX_MEILISEARCH_MESSAGE_BYTES,
    namespaceMeilisearchDocumentId,
    resetMeilisearchIngressRateLimiterForTests
} from '../../../src/server/socket/security/MeilisearchIngressPolicy';
import { MEILISEARCH_SOCKET_RATE_LIMIT_MAX_ENV } from '../../../src/server/config/IngressSecurityConfig';

const message = (id: string, content: string = 'hello'): {
    id: string;
    role: string;
    content: string;
    timestamp: number;
} => ({
    id,
    role: 'assistant',
    content,
    timestamp: 1234
});

const indexRequest = (id: string, content?: string): Record<string, unknown> => ({
    operationId: `operation-${id}`,
    indexName: 'mxf-conversations',
    documentId: id,
    documentType: 'conversation',
    metadata: { message: message(id, content) }
});

const backfillRequest = (messages: ReturnType<typeof message>[]): Record<string, unknown> => ({
    operationId: 'backfill-1',
    indexName: 'mxf-conversations',
    documentType: 'conversation',
    metadata: { messages }
});

describe('Meilisearch socket ingress policy', () => {
    const previousMaximum = process.env[MEILISEARCH_SOCKET_RATE_LIMIT_MAX_ENV];

    beforeEach(() => {
        process.env[MEILISEARCH_SOCKET_RATE_LIMIT_MAX_ENV] = '100';
        resetMeilisearchIngressRateLimiterForTests();
    });

    afterAll(() => {
        if (previousMaximum === undefined) {
            delete process.env[MEILISEARCH_SOCKET_RATE_LIMIT_MAX_ENV];
        } else {
            process.env[MEILISEARCH_SOCKET_RATE_LIMIT_MAX_ENV] = previousMaximum;
        }
        resetMeilisearchIngressRateLimiterForTests();
    });

    it('canonicalizes identity and namespaces ids by exact channel and agent', () => {
        const safe = authorizeMeilisearchSocketRequest(
            MeilisearchEvents.INDEX_REQUEST,
            {
                ...indexRequest('shared-id'),
                metadata: {
                    agentId: 'forged-agent',
                    channelId: 'forged-channel',
                    message: message('shared-id')
                }
            },
            'agent-a',
            'channel-a'
        );
        const metadata = safe.metadata as Record<string, unknown>;
        const safeMessage = metadata.message as Record<string, unknown>;

        expect(metadata.agentId).toBe('agent-a');
        expect(metadata.channelId).toBe('channel-a');
        expect(safeMessage.id).toBe(
            namespaceMeilisearchDocumentId('channel-a', 'agent-a', 'shared-id')
        );
        expect(namespaceMeilisearchDocumentId('channel-a', 'agent-a', 'shared-id'))
            .not.toBe(namespaceMeilisearchDocumentId('channel-b', 'agent-a', 'shared-id'));
        expect(namespaceMeilisearchDocumentId('channel-a', 'agent-a', 'shared-id'))
            .not.toBe(namespaceMeilisearchDocumentId('channel-a', 'agent-b', 'shared-id'));
    });

    it('rejects oversized messages, oversized batches, and aggregate content', () => {
        expect(() => authorizeMeilisearchSocketRequest(
            MeilisearchEvents.INDEX_REQUEST,
            indexRequest('large', 'x'.repeat(MAX_MEILISEARCH_MESSAGE_BYTES + 1)),
            'agent-a',
            'channel-a'
        )).toThrow('exceeds');

        expect(() => authorizeMeilisearchSocketRequest(
            MeilisearchEvents.BACKFILL_REQUEST,
            backfillRequest(Array.from(
                { length: MAX_MEILISEARCH_BACKFILL_MESSAGES + 1 },
                (_, index) => message(String(index))
            )),
            'agent-a',
            'channel-a'
        )).toThrow(`1-${MAX_MEILISEARCH_BACKFILL_MESSAGES}`);

        const contentPerMessage = Math.floor(MAX_MEILISEARCH_BACKFILL_CONTENT_BYTES / 5) + 1;
        expect(() => authorizeMeilisearchSocketRequest(
            MeilisearchEvents.BACKFILL_REQUEST,
            backfillRequest(Array.from(
                { length: 5 },
                (_, index) => message(String(index), 'x'.repeat(contentPerMessage))
            )),
            'agent-a',
            'channel-a'
        )).toThrow('backfill content exceeds');
    });

    it('charges a batch proportionally against a channel-wide reconnect-safe budget', () => {
        process.env[MEILISEARCH_SOCKET_RATE_LIMIT_MAX_ENV] = '50';
        resetMeilisearchIngressRateLimiterForTests();

        expect(() => authorizeMeilisearchSocketRequest(
            MeilisearchEvents.BACKFILL_REQUEST,
            backfillRequest(Array.from(
                { length: 50 },
                (_, index) => message(String(index))
            )),
            'agent-a',
            'channel-a'
        )).not.toThrow();

        // A fresh agent/socket in the same channel cannot multiply embedding spend.
        expect(() => authorizeMeilisearchSocketRequest(
            MeilisearchEvents.INDEX_REQUEST,
            indexRequest('next'),
            'agent-b',
            'channel-a'
        )).toThrow('rate limit exceeded');
    });

    it('reports a throttled request with a typed retry hint the SDK can act on', () => {
        process.env[MEILISEARCH_SOCKET_RATE_LIMIT_MAX_ENV] = '1';
        resetMeilisearchIngressRateLimiterForTests();

        authorizeMeilisearchSocketRequest(
            MeilisearchEvents.INDEX_REQUEST, indexRequest('first'), 'agent-a', 'channel-a'
        );

        let thrown: unknown;
        try {
            authorizeMeilisearchSocketRequest(
                MeilisearchEvents.INDEX_REQUEST, indexRequest('second'), 'agent-a', 'channel-a'
            );
        } catch (error) {
            thrown = error;
        }

        expect(thrown).toBeInstanceOf(MeilisearchRateLimitError);
        const rateLimitError = thrown as MeilisearchRateLimitError;
        expect(Number.isInteger(rateLimitError.retryAfterMs)).toBe(true);
        expect(rateLimitError.retryAfterMs).toBeGreaterThan(0);
        expect(rateLimitError.message).toContain('rate limit exceeded');

        // The failure payload carries the hint as a field; the SDK must not
        // parse it out of the message text.
        const failure = buildMeilisearchIngressFailure(
            MeilisearchEvents.INDEX_REQUEST,
            indexRequest('second'),
            'agent-a',
            'channel-a',
            rateLimitError
        );
        expect(failure.event).toBe(MeilisearchEvents.INDEX_ERROR);
        expect(failure.data).toMatchObject({
            success: false,
            documentId: 'second',
            error: rateLimitError.message,
            retryAfterMs: rateLimitError.retryAfterMs
        });

        const plain = buildMeilisearchIngressFailure(
            MeilisearchEvents.INDEX_REQUEST,
            indexRequest('third'),
            'agent-a',
            'channel-a',
            new Error('message.content must be a non-empty string')
        );
        expect(plain.data.retryAfterMs).toBeUndefined();

        const backfill = buildMeilisearchIngressFailure(
            MeilisearchEvents.BACKFILL_REQUEST,
            backfillRequest([message('x')]),
            'agent-a',
            'channel-a',
            rateLimitError
        );
        expect(backfill.event).toBe(MeilisearchEvents.BACKFILL_ERROR);
        expect(backfill.data).toMatchObject({ success: false, retryAfterMs: rateLimitError.retryAfterMs });
    });

    it('fails closed on invalid limiter configuration before accepting work', () => {
        process.env[MEILISEARCH_SOCKET_RATE_LIMIT_MAX_ENV] = 'unbounded';
        resetMeilisearchIngressRateLimiterForTests();

        expect(() => authorizeMeilisearchSocketRequest(
            MeilisearchEvents.INDEX_REQUEST,
            indexRequest('valid-shape'),
            'agent-a',
            'channel-a'
        )).toThrow(MEILISEARCH_SOCKET_RATE_LIMIT_MAX_ENV);
    });
});
