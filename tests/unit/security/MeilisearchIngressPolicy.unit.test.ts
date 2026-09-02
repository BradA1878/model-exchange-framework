import { MeilisearchEvents } from '@mxf-dev/core/events/event-definitions/MeilisearchEvents';
import {
    MAX_MEILISEARCH_BACKFILL_CONTENT_BYTES,
    MAX_MEILISEARCH_BACKFILL_MESSAGES,
    MAX_MEILISEARCH_MESSAGE_BYTES
} from '@mxf-dev/core/config/MeilisearchIngressLimits';
import {
    authorizeMeilisearchSocketRequest,
    buildMeilisearchIngressFailure,
    MeilisearchRateLimitError,
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

const settledRequest = (fields: Record<string, unknown>): Record<string, unknown> => ({
    operationId: 'settled-1',
    indexName: 'mxf-conversations',
    documentType: 'conversation',
    metadata: {},
    source: 'mongodb',
    duration: 0,
    ...fields
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

        // Split across 10 messages, not 5: the shared content limit is 512 KiB,
        // and a 5-way split would put ~104 KiB on each message, which trips the
        // 64 KiB per-message limit before the aggregate check ever runs. A
        // 10-way split keeps each message under the per-message limit so only
        // their sum trips the aggregate one.
        const contentPerMessage = Math.floor(MAX_MEILISEARCH_BACKFILL_CONTENT_BYTES / 10) + 1;
        expect(() => authorizeMeilisearchSocketRequest(
            MeilisearchEvents.BACKFILL_REQUEST,
            backfillRequest(Array.from(
                { length: 10 },
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

    it('refuses a request whose cost can never fit the window as final, not throttled', () => {
        process.env[MEILISEARCH_SOCKET_RATE_LIMIT_MAX_ENV] = '5';
        resetMeilisearchIngressRateLimiterForTests();

        const request = backfillRequest(Array.from(
            { length: 50 },
            (_, index) => message(String(index), 'x'.repeat(1024))
        ));

        let thrown: unknown;
        try {
            authorizeMeilisearchSocketRequest(
                MeilisearchEvents.BACKFILL_REQUEST, request, 'agent-a', 'channel-a'
            );
        } catch (error) {
            thrown = error;
        }

        // Fifty messages at one work unit each need 50 units against a
        // configured maximum of 5 — that batch can never fit the window no
        // matter how long the SDK waits, so it must fail as final rather than
        // as a throttled MeilisearchRateLimitError with a retry hint.
        expect(thrown).not.toBeInstanceOf(MeilisearchRateLimitError);
        expect((thrown as Error).message).toContain(MEILISEARCH_SOCKET_RATE_LIMIT_MAX_ENV);

        const failure = buildMeilisearchIngressFailure(
            MeilisearchEvents.BACKFILL_REQUEST, request, 'agent-a', 'channel-a', thrown
        );
        expect(failure.data.retryAfterMs).toBeUndefined();
    });

    it('accepts a backfill up to the shared content limit and refuses one past it', () => {
        process.env[MEILISEARCH_SOCKET_RATE_LIMIT_MAX_ENV] = '1000';
        resetMeilisearchIngressRateLimiterForTests();

        // 10 messages x 51 KiB = 510 KiB: under the shared 512 KiB content
        // limit, and over the old 256 KiB policy-local limit this replaces,
        // which would have refused it.
        const withinLimit = backfillRequest(Array.from(
            { length: 10 },
            (_, index) => message(String(index), 'x'.repeat(51 * 1024))
        ));
        let accepted: ReturnType<typeof authorizeMeilisearchSocketRequest> | undefined;
        expect(() => {
            accepted = authorizeMeilisearchSocketRequest(
                MeilisearchEvents.BACKFILL_REQUEST, withinLimit, 'agent-a', 'channel-a'
            );
        }).not.toThrow();
        expect(accepted?.totalDocuments).toBe(10);

        // 10 messages x 52 KiB = 520 KiB: each message is still under the
        // per-message limit, but the aggregate now exceeds 512 KiB.
        const overLimit = backfillRequest(Array.from(
            { length: 10 },
            (_, index) => message(String(index), 'x'.repeat(52 * 1024))
        ));
        expect(() => authorizeMeilisearchSocketRequest(
            MeilisearchEvents.BACKFILL_REQUEST, overLimit, 'agent-a', 'channel-a'
        )).toThrow('backfill content exceeds');
    });
    it('accepts a settled backfill report and canonicalizes it', () => {
        const safe = authorizeMeilisearchSocketRequest(
            MeilisearchEvents.BACKFILL_SETTLED,
            settledRequest({
                totalDocuments: 51,
                indexedDocuments: 1,
                failedDocuments: 50,
                skippedDocuments: 0,
                alreadyIndexedDocuments: 1,
                success: false,
                error: 'backfill content exceeds 262144 bytes'
            }),
            'agent-a',
            'channel-a'
        );

        expect(safe).toMatchObject({
            operationId: 'settled-1',
            indexName: 'mxf-conversations',
            documentType: 'conversation',
            totalDocuments: 51,
            indexedDocuments: 1,
            failedDocuments: 50,
            skippedDocuments: 0,
            alreadyIndexedDocuments: 1,
            success: false,
            source: 'mongodb',
            error: 'backfill content exceeds 262144 bytes',
            metadata: { agentId: 'agent-a', channelId: 'channel-a' }
        });
    });

    it('refuses a settled report whose counts do not add up or whose fields are the wrong type', () => {
        const base = { totalDocuments: 3, indexedDocuments: 1, failedDocuments: 1, skippedDocuments: 1, success: false };
        const authorize = (fields: Record<string, unknown>): unknown => authorizeMeilisearchSocketRequest(
            MeilisearchEvents.BACKFILL_SETTLED, settledRequest(fields), 'agent-a', 'channel-a'
        );

        expect(() => authorize({ ...base, indexedDocuments: 2 })).toThrow('counts');
        expect(() => authorize({ ...base, failedDocuments: -1 })).toThrow('counts');
        expect(() => authorize({ ...base, totalDocuments: 1.5 })).toThrow('counts');
        // Already-indexed documents are a subset of the indexed ones.
        expect(() => authorize({ ...base, alreadyIndexedDocuments: 2 })).toThrow('already indexed');
        expect(() => authorize({ ...base, alreadyIndexedDocuments: -1 })).toThrow('counts');
        expect(() => authorize({ ...base, success: 'yes' })).toThrow('success');
        expect(() => authorize({ ...base, error: 'x'.repeat(1025) })).toThrow('error');
        expect(() => authorize({ ...base, source: 'disk' })).toThrow('source');
    });
});
