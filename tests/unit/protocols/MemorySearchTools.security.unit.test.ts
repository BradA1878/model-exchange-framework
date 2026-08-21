const mockSearchConversations = jest.fn();
const mockSearchActions = jest.fn();
const mockSearchPatterns = jest.fn();

jest.mock('@mxf-dev/core/services/MxfMeilisearchService', () => ({
    MxfMeilisearchService: {
        getInstance: jest.fn(() => ({
            searchConversations: mockSearchConversations,
            searchActions: mockSearchActions,
            searchPatterns: mockSearchPatterns
        }))
    }
}));

jest.mock('@mxf-dev/core/services/QValueManager', () => ({
    QValueManager: {
        getInstance: jest.fn(() => ({ isEnabled: jest.fn(() => false) }))
    }
}));

jest.mock('@mxf-dev/core/utils/Logger', () => ({
    Logger: jest.fn(() => ({
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn()
    }))
}));

import {
    memory_search_actions,
    memory_search_conversations,
    memory_search_patterns
} from '@mxf-dev/core/protocols/mcp/tools/MemorySearchTools';
import { McpToolHandlerContext } from '@mxf-dev/core/protocols/mcp/McpServerTypes';

const context: McpToolHandlerContext = {
    requestId: 'request-1',
    agentId: 'agent-1',
    channelId: 'channel-a'
};

const emptySearchResult = {
    hits: [],
    estimatedTotalHits: 0,
    processingTimeMs: 1
};

const escapeFilterLiteral = (value: string): string => (
    value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
);

describe('MemorySearchTools tenant and filter security', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockSearchConversations.mockResolvedValue(emptySearchResult);
        mockSearchActions.mockResolvedValue(emptySearchResult);
        mockSearchPatterns.mockResolvedValue(emptySearchResult);
    });

    it('always binds conversation search to the authenticated agent and channel', async () => {
        const hostileContext: McpToolHandlerContext = {
            requestId: 'request-1',
            agentId: 'agent-1" OR agentId = "victim\\peer',
            channelId: 'channel-a" OR channelId = "channel-b\\peer'
        };

        await memory_search_conversations.handler(
            { query: 'authentication', limit: 10 },
            hostileContext
        );

        expect(mockSearchConversations).toHaveBeenCalledWith(expect.objectContaining({
            filter: `agentId = "${escapeFilterLiteral(hostileContext.agentId!)}"` +
                ` AND channelId = "${escapeFilterLiteral(hostileContext.channelId!)}"`
        }));
    });

    it('rejects foreign channel assertions and filter-expression timestamps before search', async () => {
        const foreign = await memory_search_conversations.handler(
            { query: 'secret', channelId: 'channel-b' },
            context
        );
        const injected = await memory_search_conversations.handler(
            { query: 'secret', timeRange: { after: '0 OR channelId = "channel-b"' } },
            context
        );

        expect(foreign.content.data).toEqual(expect.objectContaining({ success: false }));
        expect(injected.content.data).toEqual(expect.objectContaining({ success: false }));
        expect(mockSearchConversations).not.toHaveBeenCalled();
    });

    it('escapes action filters and includes the exact authenticated channel', async () => {
        await memory_search_actions.handler(
            { query: 'deploy', toolName: 'git_push" OR success = true\\tail' },
            context
        );

        expect(mockSearchActions).toHaveBeenCalledWith(expect.objectContaining({
            filter: `agentId = "agent-1" AND channelId = "channel-a"` +
                ` AND toolName = "${escapeFilterLiteral('git_push" OR success = true\\tail')}"`
        }));
    });

    it('denies cross-channel patterns and enforces bounded numeric inputs', async () => {
        const crossChannel = await memory_search_patterns.handler(
            { intent: 'coordinate', crossChannel: true },
            context
        );
        const invalidLimit = await memory_search_patterns.handler(
            { intent: 'coordinate', limit: 21 },
            context
        );
        const injectedEffectiveness = await memory_search_patterns.handler(
            { intent: 'coordinate', minEffectiveness: '0 OR channelId = "channel-b"' },
            context
        );

        expect(crossChannel.content.data).toEqual(expect.objectContaining({ success: false }));
        expect(invalidLimit.content.data).toEqual(expect.objectContaining({ success: false }));
        expect(injectedEffectiveness.content.data).toEqual(expect.objectContaining({ success: false }));
        expect(mockSearchPatterns).not.toHaveBeenCalled();
    });
});
