/** Exercise the served registry and real messaging handlers with MXP disabled. */
const mockListAllMcpTools = jest.fn();
const mockEmit = jest.fn();
const mockIsParticipant = jest.fn();

jest.mock('@mxf-dev/core/utils/Logger', () => ({
    Logger: jest.fn().mockImplementation(() => ({
        error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn()
    }))
}));
jest.mock('@mxf-dev/core/events/EventBus', () => ({
    EventBus: { server: { emit: mockEmit, on: jest.fn(() => ({ unsubscribe: jest.fn() })) } }
}));
jest.mock('@mxf-dev/core/models/mcpTool', () => ({
    listAllMcpTools: mockListAllMcpTools,
    createMcpTool: jest.fn(), findMcpToolByName: jest.fn(),
    updateMcpTool: jest.fn(), deleteMcpTool: jest.fn()
}));
jest.mock('@mxf-dev/core/services/McpToolDocumentationService', () => ({
    McpToolDocumentationService: {
        getInstance: jest.fn(() => ({ registerTool: jest.fn(), unregisterTool: jest.fn() }))
    }
}));
jest.mock('../../../src/server/socket/services/AgentService', () => ({
    AgentService: { getInstance: jest.fn() }
}));
jest.mock('../../../src/server/socket/services/ChannelService', () => ({
    ChannelService: { getInstance: jest.fn(() => ({ isParticipant: mockIsParticipant })) }
}));
jest.mock('../../../src/server/mcp/tools/index', () => {
    const { agentMessageTool, agentBroadcastTool } = jest.requireActual<
        typeof import('../../../src/server/mcp/tools/AgentCommunicationTools')
    >('../../../src/server/mcp/tools/AgentCommunicationTools');
    return { mxfMcpToolRegistry: new Map<string, typeof agentMessageTool | typeof agentBroadcastTool>([
        [agentMessageTool.name, agentMessageTool],
        [agentBroadcastTool.name, agentBroadcastTool]
    ]) };
});

import { firstValueFrom, isObservable } from 'rxjs';
import { Events } from '@mxf-dev/core/events/EventNames';
import { MxpMiddleware } from '@mxf-dev/core/middleware/MxpMiddleware';
import * as MxpProtocolSchemas from '@mxf-dev/core/schemas/MxpProtocolSchemas';
import type { McpToolHandlerResult, McpToolResultContent } from '@mxf-dev/core/protocols/mcp/McpServerTypes';
import type { ExtendedMcpToolDefinition } from '../../../src/server/api/services/McpToolRegistry';
import { McpToolRegistry } from '../../../src/server/api/services/McpToolRegistry';

const context = { agentId: 'agent-a', channelId: 'channel-a', requestId: 'request-a' };
const toolNames = ['messaging_send', 'messaging_broadcast'];

const invoke = async (
    tool: ExtendedMcpToolDefinition, input: Record<string, unknown>
): Promise<McpToolHandlerResult & { content: McpToolResultContent }> => {
    const handled = await tool.handler!(input, context);
    const result = isObservable(handled) ? await firstValueFrom(handled) : handled;
    if (Array.isArray(result.content)) throw new Error('Expected messaging tool object content');
    return { ...result, content: result.content };
};

describe('server MXP policy at the served tool boundary', () => {
    let original: string | undefined;
    let originalEncryption: string | undefined;
    let processOutgoing: jest.SpyInstance;
    let detect: jest.SpyInstance;
    let shouldConvert: jest.SpyInstance;

    beforeEach(() => {
        original = process.env.MXP_ENABLED;
        originalEncryption = process.env.MXP_ENCRYPTION_ENABLED;
        delete process.env.MXP_ENABLED;
        jest.clearAllMocks();
        McpToolRegistry.resetInstance();
        mockIsParticipant.mockImplementation((channel: string, agent: string) =>
            channel === 'channel-a' && ['agent-a', 'agent-b'].includes(agent)
        );
        // Stale database prompt surface must not restore the disabled property.
        mockListAllMcpTools.mockResolvedValue(toolNames.map(name => ({
            name, description: 'stale', enabled: true, providerId: 'mxf-server',
            channelId: 'system', parameters: [], metadata: {},
            inputSchema: { properties: { mxpOptions: { type: 'object' } } }
        })));
        processOutgoing = jest.spyOn(MxpMiddleware, 'processOutgoing');
        detect = jest.spyOn(MxpProtocolSchemas, 'isMxpMessage');
        shouldConvert = jest.spyOn(MxpMiddleware, 'shouldConvertToMxp');
    });

    afterEach(() => {
        jest.restoreAllMocks();
        McpToolRegistry.resetInstance();
        if (original === undefined) delete process.env.MXP_ENABLED;
        else process.env.MXP_ENABLED = original;
        if (originalEncryption === undefined) delete process.env.MXP_ENCRYPTION_ENABLED;
        else process.env.MXP_ENCRYPTION_ENABLED = originalEncryption;
    });

    it.each(toolNames)('omits MXP options from served %s and ignores forced encryption', async name => {
        process.env.MXP_ENABLED = 'false';
        process.env.MXP_ENCRYPTION_ENABLED = 'true';
        const tools = await firstValueFrom(
            McpToolRegistry.getInstance().listToolsForChannel(context.channelId, undefined, context.agentId)
        );
        const tool = tools.find(candidate => candidate.name === name)!;
        expect(tool).toBeDefined();
        expect(tool.inputSchema.properties).not.toHaveProperty('mxpOptions');
        expect(tool.inputSchema.properties).toHaveProperty('message');
        expect(tool.inputSchema.required).toEqual(
            name === 'messaging_send' ? ['targetAgentId', 'message'] : ['message']
        );

        const message = 'plain message, untouched';
        const result = await invoke(tool, {
            targetAgentId: 'agent-b', message,
            mxpOptions: { enableMxp: true, forceEncryption: true, preferredFormat: 'mxp' }
        });
        expect(result.content.data).toEqual(expect.objectContaining({ mxpProcessed: false }));
        expect(processOutgoing).not.toHaveBeenCalled();
        expect(detect).not.toHaveBeenCalled();
        expect(shouldConvert).not.toHaveBeenCalled();
        const event = name === 'messaging_send' ? Events.Message.AGENT_MESSAGE : Events.Message.CHANNEL_MESSAGE;
        const emission = mockEmit.mock.calls.find(([eventName]) => eventName === event);
        expect(emission).toBeDefined();
        expect(emission![1].data.content).toEqual({ format: 'text', data: message });
    });

    it.each(toolNames)('advertises the actual opt-in default on served %s when enabled', async name => {
        const tools = await firstValueFrom(McpToolRegistry.getInstance().listTools());
        const tool = tools.find(candidate => candidate.name === name)!;
        expect(tool.inputSchema.properties.mxpOptions.properties.enableMxp.default).toBe(false);
        const result = await invoke(tool, { targetAgentId: 'agent-b', message: 'plain by default' });
        expect(result.content.data).toEqual(expect.objectContaining({ mxpProcessed: false }));
        expect(processOutgoing).not.toHaveBeenCalled();
    });

    it('retains enabled forced-encryption processing', async () => {
        process.env.MXP_ENABLED = 'true';
        processOutgoing.mockRejectedValue(new Error('encryption denied'));
        const tools = await firstValueFrom(McpToolRegistry.getInstance().listTools());
        const tool = tools.find(candidate => candidate.name === 'messaging_send')!;
        const result = await invoke(tool, {
            targetAgentId: 'agent-b', message: 'must encrypt',
            mxpOptions: { enableMxp: false, forceEncryption: true }
        });
        expect(processOutgoing).toHaveBeenCalledTimes(1);
        expect(result.content.data.error).toContain('MXP processing failed: encryption denied');
        expect(mockEmit.mock.calls.some(([event]) => event === Events.Message.AGENT_MESSAGE)).toBe(false);
    });
});
