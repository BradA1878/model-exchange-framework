const mockSave = jest.fn();
const mockRecall = jest.fn();

jest.mock('@mxf-dev/core/services/UserMemoryService', () => ({
    ...jest.requireActual('@mxf-dev/core/services/UserMemoryService'),
    UserMemoryService: {
        getInstance: jest.fn(() => ({
            save: mockSave,
            recall: mockRecall,
            forget: jest.fn(),
            shake: jest.fn()
        }))
    }
}));

jest.mock('@mxf-dev/core/utils/Logger', () => ({
    Logger: jest.fn().mockImplementation(() => ({
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn()
    }))
}));

import {
    getUserMemoryScopeKey,
    userMemoryRecallTool,
    userMemorySaveTool
} from '@mxf-dev/core/protocols/mcp/tools/UserMemoryTools';
import { escapeUserMemoryFilterLiteral } from '@mxf-dev/core/services/UserMemoryService';
import type { McpToolHandlerContext } from '@mxf-dev/core/protocols/mcp/McpServerTypes';

type UserMemorySaveInput = Parameters<typeof userMemorySaveTool.handler>[0];

const saveInput = {
    type: 'project',
    title: 'Architecture',
    description: 'Tenant design',
    content: 'Use exact composite identities'
};

describe('UserMemoryTools tenant scope', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockSave.mockResolvedValue({ id: 'memory-a' });
        mockRecall.mockResolvedValue([]);
    });

    it('uses a collision-safe exact agent+channel scope', async () => {
        const first = getUserMemoryScopeKey({
            requestId: 'request-a',
            agentId: 'agent-a',
            channelId: 'channel-a'
        });
        const peer = getUserMemoryScopeKey({
            requestId: 'request-b',
            agentId: 'agent-b',
            channelId: 'channel-a'
        });
        const otherChannel = getUserMemoryScopeKey({
            requestId: 'request-c',
            agentId: 'agent-a',
            channelId: 'channel-b'
        });

        expect(first).toBe(JSON.stringify(['agent-a', 'channel-a']));
        expect(new Set([first, peer, otherChannel])).toHaveProperty('size', 3);
    });

    it('persists and recalls only through the authenticated composite scope', async () => {
        const context: McpToolHandlerContext = {
            requestId: 'request-a',
            agentId: 'agent-a',
            channelId: 'channel-a'
        };
        const scope = JSON.stringify(['agent-a', 'channel-a']);

        await userMemorySaveTool.handler(saveInput as UserMemorySaveInput, context);
        await userMemoryRecallTool.handler({ query: 'architecture' }, context);

        expect(mockSave).toHaveBeenCalledWith(scope, saveInput);
        expect(mockRecall).toHaveBeenCalledWith(
            scope,
            'architecture',
            { type: undefined, limit: 5 }
        );
    });

    it('rejects missing identity instead of sharing an anonymous bucket', async () => {
        await expect(userMemorySaveTool.handler(saveInput as UserMemorySaveInput, {
            requestId: 'request-a'
        })).rejects.toThrow(/exact authenticated agent and channel/);
        expect(mockSave).not.toHaveBeenCalled();
    });

    it('propagates storage failures as tool errors', async () => {
        mockSave.mockRejectedValue(new Error('storage unavailable'));
        await expect(userMemorySaveTool.handler(saveInput as UserMemorySaveInput, {
            requestId: 'request-a',
            agentId: 'agent-a',
            channelId: 'channel-a'
        })).rejects.toThrow(/storage unavailable/);
    });

    it('escapes quote and backslash filter injection characters', () => {
        expect(escapeUserMemoryFilterLiteral('tenant\\" OR userId EXISTS'))
            .toBe('tenant\\\\\\" OR userId EXISTS');
    });
});
