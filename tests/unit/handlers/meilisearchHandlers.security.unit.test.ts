type AsyncEventHandler = (payload: unknown) => Promise<void>;

const listeners = new Map<string, AsyncEventHandler>();
const mockEmit = jest.fn();
const mockIndexConversation = jest.fn();

jest.mock('@mxf-dev/core/events/EventBus', () => ({
    EventBus: {
        server: {
            on: jest.fn((event: string, handler: AsyncEventHandler): void => {
                listeners.set(event, handler);
            }),
            emit: mockEmit
        }
    }
}));
jest.mock('@mxf-dev/core/services/MxfMeilisearchService', () => ({
    MxfMeilisearchService: {
        getInstance: (): { indexConversation: typeof mockIndexConversation } => ({
            indexConversation: mockIndexConversation
        })
    }
}));
jest.mock('@mxf-dev/core/utils/Logger', () => ({
    Logger: class {
        info = jest.fn(); warn = jest.fn(); error = jest.fn(); debug = jest.fn();
    }
}));

import { MeilisearchEvents } from '@mxf-dev/core/events/event-definitions/MeilisearchEvents';
import { setupMeilisearchHandlers } from '../../../src/server/socket/handlers/meilisearchHandlers';
import {
    MAX_MEILISEARCH_MESSAGE_BYTES,
    namespaceMeilisearchDocumentId
} from '../../../src/server/socket/security/MeilisearchIngressPolicy';

const request = (content: string = 'hello'): Record<string, unknown> => ({
    agentId: 'agent-a',
    channelId: 'channel-a',
    data: {
        operationId: 'operation-1',
        indexName: 'mxf-conversations',
        documentType: 'conversation',
        metadata: {
            message: {
                id: 'shared-id',
                role: 'assistant',
                content,
                timestamp: 1234
            }
        }
    }
});

describe('Meilisearch server handler defense in depth', () => {
    beforeAll(() => setupMeilisearchHandlers());

    beforeEach(() => {
        jest.clearAllMocks();
        mockIndexConversation.mockResolvedValue(undefined);
    });

    it('indexes only the deterministic authenticated namespace', async () => {
        await listeners.get(MeilisearchEvents.INDEX_REQUEST)!(request());

        expect(mockIndexConversation).toHaveBeenCalledWith(expect.objectContaining({
            id: namespaceMeilisearchDocumentId('channel-a', 'agent-a', 'shared-id'),
            metadata: expect.objectContaining({
                agentId: 'agent-a',
                channelId: 'channel-a',
                sourceDocumentId: 'shared-id'
            })
        }));
        expect(mockEmit).toHaveBeenCalledWith(
            MeilisearchEvents.INDEX,
            expect.objectContaining({ agentId: 'agent-a', channelId: 'channel-a' })
        );
    });

    it('rejects oversized content before embedding/index work and emits a correlated error', async () => {
        await listeners.get(MeilisearchEvents.INDEX_REQUEST)!(
            request('x'.repeat(MAX_MEILISEARCH_MESSAGE_BYTES + 1))
        );

        expect(mockIndexConversation).not.toHaveBeenCalled();
        expect(mockEmit).toHaveBeenCalledWith(
            MeilisearchEvents.INDEX_ERROR,
            expect.objectContaining({
                agentId: 'agent-a',
                channelId: 'channel-a',
                data: expect.objectContaining({
                    operationId: 'operation-1',
                    success: false
                })
            })
        );
    });
});
