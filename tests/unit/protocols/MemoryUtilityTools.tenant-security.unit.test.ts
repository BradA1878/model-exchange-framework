jest.mock('@mxf-dev/core/utils/Logger', () => ({
    Logger: jest.fn(() => ({
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn()
    }))
}));

import {
    memory_inject_reward,
    memory_qvalue_analytics,
    memory_utility_config
} from '@mxf-dev/core/protocols/mcp/tools/MemoryUtilityTools';
import {
    McpToolHandlerContext,
    McpToolHandlerResult
} from '@mxf-dev/core/protocols/mcp/McpServerTypes';

const resultData = (result: unknown): unknown => (
    (result as McpToolHandlerResult).content.data
);

const agentContext: McpToolHandlerContext = {
    requestId: 'request-a',
    agentId: 'agent-a',
    channelId: 'channel-a'
};

describe('MemoryUtilityTools agent isolation', () => {
    it('denies analytics for an arbitrary agent identity', async () => {
        const result = await memory_qvalue_analytics.handler(
            { agentId: 'victim-agent' },
            agentContext
        );

        expect(resultData(result)).toEqual({
            success: false,
            code: 'MULS_ANALYTICS_SCOPE_DENIED',
            error: expect.stringContaining('authenticated identity')
        });
    });

    it('does not expose process-global analytics as an apparent self view', async () => {
        const omitted = await memory_qvalue_analytics.handler({}, agentContext);
        const assertedSelf = await memory_qvalue_analytics.handler(
            { agentId: 'agent-a' },
            agentContext
        );

        expect(resultData(omitted)).toEqual(expect.objectContaining({
            success: false,
            code: 'MULS_AGENT_ANALYTICS_UNAVAILABLE'
        }));
        expect(resultData(assertedSelf)).toEqual(expect.objectContaining({
            success: false,
            code: 'MULS_AGENT_ANALYTICS_UNAVAILABLE'
        }));
    });

    it('makes global configuration reads and mutations unavailable to agent contexts', async () => {
        const read = await memory_utility_config.handler(
            { action: 'get' },
            agentContext
        );
        const write = await memory_utility_config.handler(
            { action: 'set', lambda: 1 },
            agentContext
        );

        expect(resultData(read)).toEqual(expect.objectContaining({
            success: false,
            code: 'MULS_ADMIN_CONTEXT_REQUIRED'
        }));
        expect(resultData(write)).toEqual(expect.objectContaining({
            success: false,
            code: 'MULS_ADMIN_CONTEXT_REQUIRED'
        }));
    });

    it('denies arbitrary memory reward mutation without authoritative ownership', async () => {
        const result = await memory_inject_reward.handler(
            { memoryId: 'victim-memory', reward: -1, reason: 'poison' },
            agentContext
        );

        expect(resultData(result)).toEqual(expect.objectContaining({
            success: false,
            code: 'MULS_MEMORY_OWNERSHIP_UNAVAILABLE'
        }));
    });

    it('fails closed when authenticated channel context is missing', async () => {
        const result = await memory_qvalue_analytics.handler(
            {},
            { requestId: 'missing-channel', agentId: 'agent-a' }
        );

        expect(resultData(result)).toEqual(expect.objectContaining({
            success: false,
            error: expect.stringContaining('Authenticated agentId and channelId')
        }));
    });
});
