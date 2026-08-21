const mockGetAgentFacingToolsForChannel = jest.fn();
const mockGetChannelAllowedTools = jest.fn();

jest.mock('@mxf-dev/core/utils/Logger', () => ({
    Logger: jest.fn().mockImplementation(() => ({
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn()
    }))
}));

jest.mock('@mxf-dev/core/events/EventBus', () => ({
    EventBus: {
        server: { emit: jest.fn(), on: jest.fn() },
        client: { emit: jest.fn(), on: jest.fn() }
    }
}));

jest.mock('../../../src/server/socket/services/TaskService', () => ({
    TaskService: { getInstance: jest.fn() }
}));

jest.mock('../../../src/server/socket/services/SystemLlmServiceManager', () => ({
    SystemLlmServiceManager: { getInstance: jest.fn() }
}));

jest.mock('../../../src/server/socket/services/McpService', () => ({
    McpService: {
        getInstance: jest.fn(() => ({
            getChannelAllowedTools: mockGetChannelAllowedTools
        }))
    }
}));

jest.mock('../../../src/server/mcp/services/HybridMcpRegistryAccess', () => ({
    getHybridMcpToolRegistry: jest.fn(() => ({
        getAgentFacingToolsForChannel: mockGetAgentFacingToolsForChannel
    }))
}));

import { tools_validate } from '../../../src/server/mcp/tools/MetaTools';
import type { McpToolHandlerContext } from '@mxf-dev/core/protocols/mcp/McpServerTypes';
import {
    UNSAFE_HOST_TOOLS_ENV,
    UNSAFE_NETWORK_TOOLS_ENV
} from '../../../src/server/socket/services/ToolAuthorizationPolicy';

interface TestToolDescriptor {
    name: string;
    description: string;
    inputSchema: { type: string; properties: Record<string, never> };
    enabled: boolean;
    providerId: string;
    channelId: string;
    source: string;
}

const tool = (name: string): TestToolDescriptor => ({
    name,
    description: `${name} description`,
    inputSchema: { type: 'object', properties: {} },
    enabled: true,
    providerId: 'internal',
    channelId: 'channel-a',
    source: 'internal'
});

const context = (allowedTools?: string[]): McpToolHandlerContext => ({
    agentId: 'agent-a',
    channelId: 'channel-a',
    requestId: 'request-a',
    authorization: {
        keyId: 'key-a',
        allowedTools
    }
});

describe('MetaTools credential-scoped discovery', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        delete process.env[UNSAFE_HOST_TOOLS_ENV];
        delete process.env[UNSAFE_NETWORK_TOOLS_ENV];
        mockGetChannelAllowedTools.mockReturnValue([]);
        mockGetAgentFacingToolsForChannel.mockReturnValue([
            tool('task_complete'),
            tool('shell_execute'),
            tool('web_navigate')
        ]);
    });

    it('requires the validated credential policy instead of trusting agent context data', async () => {
        await expect(tools_validate.handler(
            { toolNames: ['task_complete'] },
            {
                agentId: 'agent-a',
                channelId: 'channel-a',
                requestId: 'request-a',
                allowedTools: ['task_complete']
            } as McpToolHandlerContext
        )).rejects.toThrow(/credential-scoped tool policy/);
        expect(mockGetAgentFacingToolsForChannel).not.toHaveBeenCalled();
    });

    it('uses exact agent/channel scope and hides tools outside the credential grant', async () => {
        const result = await tools_validate.handler(
            { toolNames: ['task_complete', 'web_navigate'] },
            context(['task_complete'])
        );

        expect(mockGetAgentFacingToolsForChannel)
            .toHaveBeenCalledWith('channel-a', 'agent-a');
        expect(result).toEqual(expect.objectContaining({
            availableCount: 1,
            unavailableCount: 1,
            results: [
                expect.objectContaining({ toolName: 'task_complete', available: true }),
                expect.objectContaining({ toolName: 'web_navigate', available: false })
            ]
        }));
    });

    it('intersects channel policy and default-off host/network capability gates', async () => {
        mockGetChannelAllowedTools.mockReturnValue([
            'task_complete',
            'shell_execute',
            'web_navigate'
        ]);

        const result = await tools_validate.handler(
            { toolNames: ['task_complete', 'shell_execute', 'web_navigate'] },
            context(['task_complete', 'shell_execute', 'web_navigate'])
        );

        expect(result).toEqual(expect.objectContaining({
            availableCount: 1,
            unavailableCount: 2
        }));
    });

    it('fails closed when the channel runtime policy is not loaded', async () => {
        mockGetChannelAllowedTools.mockReturnValue(undefined);
        await expect(tools_validate.handler(
            { toolNames: ['task_complete'] },
            context(['task_complete'])
        )).rejects.toThrow(/has not been loaded/);
    });
});
