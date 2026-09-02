/**
 * MxfMeilisearchService indexing and search failure handling.
 *
 * Before these tests, generateEmbedding() caught a failing embedding provider
 * and returned undefined (with its log line commented out), and the index
 * methods caught every error without rethrowing. A document was therefore
 * indexed without the vector the caller expected, and the caller counted it
 * as indexed. waitTask() resolves even when Meilisearch marks the task
 * failed, so a failed task was also counted as success.
 *
 * The `meilisearch` client is mocked here; every other test in the repo mocks
 * this service at its own boundary, so this is the one place its own error
 * handling is exercised.
 */

const mockWaitTask = jest.fn();
const mockAddDocuments = jest.fn();
const mockSearch = jest.fn();
const mockGetDocument = jest.fn();
const mockIndex = jest.fn(() => ({
    addDocuments: mockAddDocuments,
    search: mockSearch,
    getDocument: mockGetDocument
}));

jest.mock('meilisearch', () => ({
    MeiliSearch: jest.fn().mockImplementation(() => ({ index: mockIndex }))
}));
jest.mock('@mxf-dev/core/utils/Logger', () => ({
    Logger: class {
        info = jest.fn(); warn = jest.fn(); error = jest.fn(); debug = jest.fn();
    }
}));

import { MxfMeilisearchService, MeilisearchIndex } from '@mxf-dev/core/services/MxfMeilisearchService';
import type { EmbeddingGenerator } from '@mxf-dev/core/services/MxfMeilisearchService';
import type { PatternMemoryEntry } from '@mxf-dev/core/types/PatternMemoryTypes';

const resetSingleton = (): void => {
    (MxfMeilisearchService as unknown as { instance: MxfMeilisearchService | undefined }).instance = undefined;
};

const makeService = (generator?: EmbeddingGenerator, enableEmbeddings = true): MxfMeilisearchService => {
    resetSingleton();
    return MxfMeilisearchService.getInstance({
        host: 'http://meilisearch.test',
        apiKey: 'test-key',
        enableEmbeddings,
        embeddingGenerator: generator
    });
};

const message = {
    id: 'message-1',
    role: 'user' as const,
    content: 'hello',
    timestamp: 1,
    metadata: { agentId: 'agent-a', channelId: 'channel-a' }
};

const succeededTask = { uid: 7, status: 'succeeded', error: null };

describe('MxfMeilisearchService', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockAddDocuments.mockImplementation(() => ({ waitTask: mockWaitTask }));
        mockWaitTask.mockResolvedValue(succeededTask);
        mockSearch.mockResolvedValue({
            hits: [], query: 'q', processingTimeMs: 1, limit: 20, offset: 0, estimatedTotalHits: 0
        });
    });

    afterAll(resetSingleton);

    describe('findIndexedConversationIds', () => {
        // The on-load backfill re-sent every persisted message on every
        // connect, paying an embedding call and an index task again for
        // documents the live path had indexed earlier. One GET by primary
        // key per document tells the caller which ones to skip.
        const notFound = (): Error => Object.assign(new Error('Document `x` not found.'), {
            cause: { message: 'Document `x` not found.', code: 'document_not_found', type: 'invalid_request', link: '' }
        });

        it('returns the ids the index has and leaves out the ones it reports as not found', async () => {
            const service = makeService();
            mockGetDocument.mockImplementation(async (id: string) => {
                if (id === 'message-2') {
                    throw notFound();
                }
                return { id };
            });

            await expect(service.findIndexedConversationIds(['message-1', 'message-2', 'message-3']))
                .resolves.toEqual(new Set(['message-1', 'message-3']));

            expect(mockIndex).toHaveBeenCalledWith(MeilisearchIndex.CONVERSATIONS);
            expect(mockGetDocument).toHaveBeenCalledTimes(3);
            expect(mockGetDocument).toHaveBeenCalledWith('message-2', { fields: ['id'] });
        });

        it('throws any error other than a missing document, so an unreachable index fails the caller loudly', async () => {
            const service = makeService();
            mockGetDocument.mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:7700'));

            await expect(service.findIndexedConversationIds(['message-1'])).rejects.toThrow('ECONNREFUSED');
        });

        it('asks nothing for an empty list', async () => {
            const service = makeService();

            await expect(service.findIndexedConversationIds([])).resolves.toEqual(new Set());
            expect(mockGetDocument).not.toHaveBeenCalled();
        });
    });

    describe('indexConversation', () => {
        it('indexes a conversation with the vector the generator returned', async () => {
            const generator = jest.fn().mockResolvedValue([0.1, 0.2]);
            const service = makeService(generator);

            await expect(service.indexConversation(message)).resolves.toBeUndefined();

            expect(generator).toHaveBeenCalledWith('hello', expect.any(Object));
            expect(mockIndex).toHaveBeenCalledWith(MeilisearchIndex.CONVERSATIONS);
            expect(mockAddDocuments).toHaveBeenCalledWith([
                expect.objectContaining({ id: 'message-1', _vectors: { default: [0.1, 0.2] } })
            ]);
        });

        it('indexes without a vector when embeddings are disabled, and never calls the generator', async () => {
            const generator = jest.fn();
            const service = makeService(generator, false);

            await expect(service.indexConversation(message)).resolves.toBeUndefined();

            expect(generator).not.toHaveBeenCalled();
            expect(mockAddDocuments).toHaveBeenCalledWith([
                expect.objectContaining({ id: 'message-1', _vectors: undefined })
            ]);
        });

        it('rejects when the embedding generator fails, and enqueues nothing', async () => {
            const service = makeService(jest.fn().mockRejectedValue(new Error('401 unauthorized')));

            await expect(service.indexConversation(message)).rejects.toThrow('401 unauthorized');

            expect(mockAddDocuments).not.toHaveBeenCalled();
        });

        it('rejects when Meilisearch reports the indexing task failed', async () => {
            // waitTask() resolves for a failed task; the outcome is on the task itself.
            mockWaitTask.mockResolvedValue({
                uid: 9,
                status: 'failed',
                error: { message: 'vector dimension mismatch', code: 'invalid_vector_dimensions' }
            });
            const service = makeService(jest.fn().mockResolvedValue([0.1]));

            await expect(service.indexConversation(message)).rejects.toThrow('vector dimension mismatch');
            await expect(service.indexConversation(message)).rejects.toThrow(/failed/);
        });

        it('rejects when the document cannot be enqueued', async () => {
            mockAddDocuments.mockImplementation(() => {
                throw new Error('MeiliSearchRequestError: connection refused');
            });
            const service = makeService(jest.fn().mockResolvedValue([0.1]));

            await expect(service.indexConversation(message)).rejects.toThrow('connection refused');
        });
    });

    describe('indexAction and indexPattern', () => {
        const action = {
            id: 'action-1',
            agentId: 'agent-a',
            channelId: 'channel-a',
            toolName: 'messaging_send',
            description: 'sent a message',
            timestamp: 1,
            success: true
        };
        const pattern = {
            patternId: 'pattern-1',
            channelId: 'channel-a',
            type: 'sequence',
            pattern: { sequence: ['a', 'b'], toolsUsed: ['a'] },
            effectiveness: 1,
            usageCount: 1,
            agentParticipants: ['agent-a'],
            firstDiscovered: 1
        } as unknown as PatternMemoryEntry;

        it('reject when the embedding generator fails', async () => {
            const service = makeService(jest.fn().mockRejectedValue(new Error('provider down')));

            await expect(service.indexAction(action)).rejects.toThrow('provider down');
            await expect(service.indexPattern(pattern)).rejects.toThrow('provider down');
            expect(mockAddDocuments).not.toHaveBeenCalled();
        });

        it('reject when Meilisearch reports the indexing task failed', async () => {
            mockWaitTask.mockResolvedValue({ uid: 3, status: 'failed', error: { message: 'index is full' } });
            const service = makeService(jest.fn().mockResolvedValue([0.1]));

            await expect(service.indexAction(action)).rejects.toThrow('index is full');
            await expect(service.indexPattern(pattern)).rejects.toThrow('index is full');
        });
    });

    describe('search', () => {
        it('rejects when the query embedding fails instead of quietly searching by keyword', async () => {
            const service = makeService(jest.fn().mockRejectedValue(new Error('provider down')));

            await expect(service.searchConversations({ query: 'release', hybridRatio: 0.7 }))
                .rejects.toThrow('provider down');

            expect(mockSearch).not.toHaveBeenCalled();
        });

        it('searches by keyword, without the generator, when no hybrid ratio is requested', async () => {
            const generator = jest.fn();
            const service = makeService(generator);

            await expect(service.searchConversations({ query: 'release' })).resolves.toMatchObject({ hits: [] });

            expect(generator).not.toHaveBeenCalled();
            expect(mockSearch).toHaveBeenCalledWith('release', expect.not.objectContaining({ hybrid: expect.anything() }));
        });

        it('passes the query vector to a hybrid search when the generator succeeds', async () => {
            const service = makeService(jest.fn().mockResolvedValue([0.3, 0.4]));

            await service.searchConversations({ query: 'release', hybridRatio: 0.7 });

            expect(mockSearch).toHaveBeenCalledWith('release', expect.objectContaining({
                hybrid: { semanticRatio: 0.7, embedder: 'default' },
                vector: [0.3, 0.4]
            }));
        });
    });
});
