import { firstValueFrom, of } from 'rxjs';

const mockHandler = jest.fn();
const mockGetAgent = jest.fn();
const mockGetChannelAllowedTools = jest.fn();
const mockListTools = jest.fn();
const mockEventHandlers = new Map<string, (payload: unknown) => void>();
const mockEventEmit = jest.fn();
let mockHybridRegistry: { resolveToolForChannel: jest.Mock } | null = null;

jest.mock('@mxf-dev/core/utils/Logger', () => ({
    Logger: class MockLogger {
        error = jest.fn();
        warn = jest.fn();
        info = jest.fn();
        debug = jest.fn();
        trace = jest.fn();
        child(): this { return this; }
    }
}));

jest.mock('@mxf-dev/core/utils/validation', (): object => ({
    createStrictValidator: (): {
        assertIsNonEmptyString: jest.Mock;
        assertIsObject: jest.Mock;
        assertIsFunction: jest.Mock;
        assertIsBoolean: jest.Mock;
    } => ({
        assertIsNonEmptyString: jest.fn(),
        assertIsObject: jest.fn(),
        assertIsFunction: jest.fn(),
        assertIsBoolean: jest.fn()
    })
}));

jest.mock('@mxf-dev/core/events/EventBus', () => ({
    EventBus: {
        server: {
            on: jest.fn((eventName: string, handler: (payload: unknown) => void) => {
                mockEventHandlers.set(eventName, handler);
                return { unsubscribe: jest.fn() };
            }),
            emit: mockEventEmit
        }
    }
}));

jest.mock('@mxf-dev/core/schemas/EventPayloadSchema', () => ({
    createBaseEventPayload: jest.fn(),
    createMcpToolCallPayload: jest.fn(),
    createMcpToolErrorPayload: jest.fn(
        (type, agentId, channelId, data) => ({ type, agentId, channelId, data })
    ),
    createMcpToolResultPayload: jest.fn(
        (type, agentId, channelId, data) => ({ type, agentId, channelId, data })
    ),
    createMcpToolRegisterPayload: jest.fn()
}));

jest.mock('@mxf-dev/core/protocols/mcp/McpToolSchema', (): object => ({
    validateToolInput: (_schema: unknown, input: unknown): {
        valid: boolean;
        coercedInput: unknown;
    } => ({
        valid: true,
        coercedInput: input
    }),
    formatValidationError: jest.fn()
}));

jest.mock('@mxf-dev/core/utils/ToolPaginationUtils', (): object => ({
    checkResultSize: (content: unknown): unknown => content
}));

jest.mock('@mxf-dev/core/utils/ParameterNormalizer', (): object => ({
    normalizeOrparParameters: (_toolName: string, input: unknown): unknown => input
}));

jest.mock('@mxf-dev/core/services/AutoCorrectionService', (): object => ({
    AutoCorrectionService: {
        getInstance: (): { attemptCorrection: jest.Mock } => ({
            attemptCorrection: jest.fn()
        })
    }
}));

jest.mock('../../../src/server/socket/services/AgentService', (): object => ({
    AgentService: {
        getInstance: (): { getAgent: typeof mockGetAgent } => ({
            getAgent: mockGetAgent
        })
    }
}));

jest.mock('../../../src/server/socket/services/McpService', (): object => ({
    McpService: {
        getInstance: (): { getChannelAllowedTools: typeof mockGetChannelAllowedTools } => ({
            getChannelAllowedTools: mockGetChannelAllowedTools
        })
    }
}));

jest.mock('../../../src/server/api/services/McpToolRegistry', () => ({
    McpToolRegistry: {
        getInstance: (): {
            listTools: typeof mockListTools;
            listToolsForChannel: typeof mockListTools;
        } => ({
            listTools: mockListTools,
            listToolsForChannel: mockListTools
        })
    }
}));

jest.mock('../../../src/server/mcp/services/HybridMcpRegistryAccess', (): object => ({
    getHybridMcpToolRegistry: (): typeof mockHybridRegistry => mockHybridRegistry
}));

import { McpSocketExecutor } from '../../../src/server/socket/services/McpSocketExecutor';
import { ToolAuthorizationError } from '../../../src/server/socket/services/ToolAuthorizationPolicy';
import { Events } from '@mxf-dev/core/events/EventNames';

const context = {
    requestId: 'request-1',
    agentId: 'agent-1',
    channelId: 'channel-1',
    authorization: {
        keyId: 'key-1',
        allowedTools: ['task_complete'] as string[] | undefined
    },
    data: {}
};

const makeTool = (name: string): {
    name: string;
    description: string;
    inputSchema: { type: string; properties: object };
    enabled: boolean;
    handler: typeof mockHandler;
} => ({
    name,
    description: `${name} description`,
    inputSchema: { type: 'object', properties: {} },
    enabled: true,
    handler: mockHandler
});

describe('McpSocketExecutor execution authorization', () => {
    const executor = McpSocketExecutor.getInstance();

    beforeEach(() => {
        jest.clearAllMocks();
        mockHybridRegistry = null;
        mockHandler.mockResolvedValue({ content: { type: 'text', data: 'ok' } });
        mockGetAgent.mockReturnValue({ agentId: context.agentId, allowedTools: ['task_complete'] });
        context.authorization = { keyId: 'key-1', allowedTools: ['task_complete'] };
        mockGetChannelAllowedTools.mockReturnValue([]);
        mockListTools.mockReturnValue(of([
            makeTool('task_complete'),
            makeTool('dangerous_tool')
        ]));
    });

    it('does not let another agent/channel delete a tool from the executor mirror', async () => {
        const ownedName = 'owned_dynamic_tool';
        await expect(firstValueFrom(executor.registerTool(
            ownedName,
            'Owned dynamic tool',
            { type: 'object', properties: {} },
            mockHandler,
            'owner-agent',
            'owner-channel'
        ))).resolves.toBe(true);

        await expect(firstValueFrom(executor.unregisterTool(
            ownedName,
            'attacker-agent',
            'attacker-channel'
        ))).rejects.toThrow('not owned');

        await expect(firstValueFrom(executor.unregisterTool(
            ownedName,
            'owner-agent',
            'owner-channel'
        ))).resolves.toBe(true);
    });

    it('keeps one authority per request and mirrors only owner-matched unregister success', async () => {
        const ownedName = 'mirrored_dynamic_tool';
        await expect(firstValueFrom(executor.registerTool(
            ownedName,
            'Mirrored dynamic tool',
            { type: 'object', properties: {} },
            mockHandler,
            'owner-agent',
            'owner-channel'
        ))).resolves.toBe(true);

        expect(mockEventHandlers.has(Events.Mcp.TOOL_REGISTER)).toBe(false);
        expect(mockEventHandlers.has(Events.Mcp.TOOL_LIST)).toBe(false);
        expect(mockEventHandlers.has(Events.Mcp.TOOL_UNREGISTER)).toBe(false);
        expect(mockEventHandlers.has(Events.Mcp.TOOL_CALL)).toBe(true);
        const resultHandler = mockEventHandlers.get(Events.Mcp.TOOL_UNREGISTERED);
        expect(resultHandler).toBeDefined();

        resultHandler!({
            agentId: 'attacker-agent',
            channelId: 'attacker-channel',
            data: { toolName: ownedName, success: true }
        });
        await expect(firstValueFrom(executor.registerTool(
            ownedName,
            'Mirrored dynamic tool',
            { type: 'object', properties: {} },
            mockHandler,
            'owner-agent',
            'owner-channel'
        ))).rejects.toThrow('already exists');

        resultHandler!({
            agentId: 'owner-agent',
            channelId: 'owner-channel',
            data: { toolName: ownedName, success: true }
        });
        await expect(firstValueFrom(executor.registerTool(
            ownedName,
            'Mirrored dynamic tool',
            { type: 'object', properties: {} },
            mockHandler,
            'owner-agent',
            'owner-channel'
        ))).resolves.toBe(true);
        await expect(firstValueFrom(executor.unregisterTool(
            ownedName,
            'owner-agent',
            'owner-channel'
        ))).resolves.toBe(true);
    });

    it('executes one EventBus tool call exactly once and emits one result', async () => {
        const callHandler = mockEventHandlers.get(Events.Mcp.TOOL_CALL);
        expect(callHandler).toBeDefined();

        callHandler!({
            agentId: context.agentId,
            channelId: context.channelId,
            authorization: context.authorization,
            data: {
                toolName: 'task_complete',
                callId: 'call-one',
                arguments: {}
            }
        });
        await Promise.resolve();
        await Promise.resolve();

        expect(mockHandler).toHaveBeenCalledTimes(1);
        const results = mockEventEmit.mock.calls.filter(
            ([event, payload]) => event === Events.Mcp.TOOL_RESULT && payload.data.callId === 'call-one'
        );
        expect(results).toHaveLength(1);
    });

    it('rejects a request without exact credential authorization context', async () => {
        const unauthenticatedContext = { ...context, authorization: undefined };

        await expect(firstValueFrom(
            executor.executeTool('task_complete', {}, unauthenticatedContext)
        )).rejects.toThrow('credential-scoped tool policy');
        expect(mockHandler).not.toHaveBeenCalled();
    });

    it('treats an empty credential allowlist as allowing no tools', async () => {
        context.authorization.allowedTools = [];

        await expect(firstValueFrom(
            executor.executeTool('task_complete', {}, context)
        )).rejects.toBeInstanceOf(ToolAuthorizationError);
        expect(mockHandler).not.toHaveBeenCalled();
    });

    it('defaults an undefined credential allowlist to core tools only', async () => {
        context.authorization.allowedTools = undefined;

        await expect(firstValueFrom(
            executor.executeTool('task_complete', {}, context)
        )).resolves.toMatchObject({ content: { data: 'ok' } });

        await expect(firstValueFrom(
            executor.executeTool('dangerous_tool', {}, context)
        )).rejects.toBeInstanceOf(ToolAuthorizationError);
        expect(mockHandler).toHaveBeenCalledTimes(1);
    });

    it('enforces an explicit credential allowlist', async () => {
        context.authorization.allowedTools = ['dangerous_tool'];

        await expect(firstValueFrom(
            executor.executeTool('dangerous_tool', {}, context)
        )).resolves.toMatchObject({ content: { data: 'ok' } });

        await expect(firstValueFrom(
            executor.executeTool('task_complete', {}, context)
        )).rejects.toBeInstanceOf(ToolAuthorizationError);
        expect(mockHandler).toHaveBeenCalledTimes(1);
    });

    it('does not let a higher-grant key in another channel broaden this credential', async () => {
        const lowCredential = {
            ...context,
            channelId: 'channel-1',
            authorization: { keyId: 'key-low', allowedTools: ['task_complete'] }
        };
        const highCredential = {
            ...context,
            channelId: 'channel-2',
            authorization: { keyId: 'key-high', allowedTools: ['dangerous_tool'] }
        };
        mockGetChannelAllowedTools.mockReturnValue([]);

        await expect(firstValueFrom(
            executor.executeTool('dangerous_tool', {}, highCredential)
        )).resolves.toMatchObject({ content: { data: 'ok' } });
        await expect(firstValueFrom(
            executor.executeTool('dangerous_tool', {}, lowCredential)
        )).rejects.toBeInstanceOf(ToolAuthorizationError);
        expect(mockHandler).toHaveBeenCalledTimes(1);
    });

    it('denies self-claimed shell execution before the handler can read server secrets', async () => {
        const previous = process.env.MXF_UNSAFE_HOST_TOOLS_ENABLED;
        delete process.env.MXF_UNSAFE_HOST_TOOLS_ENABLED;
        context.authorization.allowedTools = ['shell_execute'];
        mockListTools.mockReturnValue(of([makeTool('shell_execute')]));

        await expect(firstValueFrom(executor.executeTool(
            'shell_execute',
            { command: 'cat .env' },
            context
        ))).rejects.toThrow('privileged host capability');
        expect(mockHandler).not.toHaveBeenCalled();

        if (previous === undefined) {
            delete process.env.MXF_UNSAFE_HOST_TOOLS_ENABLED;
        } else {
            process.env.MXF_UNSAFE_HOST_TOOLS_ENABLED = previous;
        }
    });

    it('applies a nonempty channel allowlist as an additional restriction', async () => {
        context.authorization.allowedTools = ['task_complete', 'dangerous_tool'];
        mockGetChannelAllowedTools.mockReturnValue(['task_complete']);

        await expect(firstValueFrom(
            executor.executeTool('dangerous_tool', {}, context)
        )).rejects.toThrow("not authorized in channel 'channel-1'");

        await expect(firstValueFrom(
            executor.executeTool('task_complete', {}, context)
        )).resolves.toMatchObject({ content: { data: 'ok' } });
        expect(mockHandler).toHaveBeenCalledTimes(1);
    });

    it('treats an empty channel allowlist as no additional restriction', async () => {
        context.authorization.allowedTools = ['dangerous_tool'];
        mockGetChannelAllowedTools.mockReturnValue([]);

        await expect(firstValueFrom(
            executor.executeTool('dangerous_tool', {}, context)
        )).resolves.toMatchObject({ content: { data: 'ok' } });
    });

    it('fails closed when channel policy has not been hydrated', async () => {
        context.authorization.allowedTools = ['dangerous_tool'];
        mockGetChannelAllowedTools.mockReturnValue(undefined);

        await expect(firstValueFrom(
            executor.executeTool('dangerous_tool', {}, context)
        )).rejects.toThrow("policy for channel 'channel-1' has not been loaded");
        expect(mockHandler).not.toHaveBeenCalled();
    });

    it('authorizes external tools against either raw or canonical names', async () => {
        const canonicalName = 'channel-1:server__fetch_news';
        const externalTool = {
            ...makeTool(canonicalName),
            externalToolName: 'fetch_news'
        };
        mockHybridRegistry = {
            resolveToolForChannel: jest.fn(() => externalTool)
        };
        mockListTools.mockReturnValue(of([externalTool]));
        context.authorization.allowedTools = [canonicalName];
        mockGetChannelAllowedTools.mockReturnValue(['fetch_news']);

        await expect(firstValueFrom(
            executor.executeTool('fetch_news', {}, context)
        )).resolves.toMatchObject({ content: { data: 'ok' } });
        expect(mockHandler).toHaveBeenCalledTimes(1);
    });
});
