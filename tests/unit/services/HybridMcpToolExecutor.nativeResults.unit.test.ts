/** Real hybrid resolution and executor terminal handling, with only service boundaries stubbed. */
const mockEventHandlers = new Map<string, (payload: unknown) => void | Promise<void>>();
const mockEventEmit = jest.fn();
const mockListTools = jest.fn();
const mockRecordComplete = jest.fn(async (): Promise<void> => {});
const mockRecordError = jest.fn(async (): Promise<void> => {});
const mockExecuteExternal = jest.fn();

jest.mock('@mxf-dev/core/events/EventBus', () => ({
    EventBus: { server: {
        on: jest.fn((name: string, handler: (payload: unknown) => void | Promise<void>) => {
            mockEventHandlers.set(name, handler);
            return { unsubscribe: jest.fn() };
        }),
        emit: mockEventEmit
    } }
}));
jest.mock('@mxf-dev/core/utils/Logger', () => ({
    Logger: class {
        error = jest.fn();
        warn = jest.fn();
        info = jest.fn();
        debug = jest.fn();
        trace = jest.fn();
    }
}));
jest.mock('@mxf-dev/core/services/AutoCorrectionService', () => ({
    AutoCorrectionService: { getInstance: (): object => ({
        getConfig: (): object => ({ enabled: false }), attemptCorrection: jest.fn()
    }) }
}));
jest.mock('../../../src/server/socket/services/McpService', () => ({
    McpService: { getInstance: (): object => ({ getChannelAllowedTools: (): string[] => ['read_file'] }) }
}));
jest.mock('../../../src/server/api/services/McpToolRegistry', () => ({
    McpToolRegistry: { getInstance: (): object => ({ listToolsForChannel: mockListTools }) }
}));
jest.mock('../../../src/server/services/ToolExecutionPersistenceService', () => ({
    ToolExecutionPersistenceService: { getInstance: (): object => ({
        recordToolCallStart: async (): Promise<void> => {},
        recordToolCallComplete: mockRecordComplete,
        recordToolCallError: mockRecordError
    }) }
}));

import { of, type Observable } from 'rxjs';
import { Events } from '@mxf-dev/core/events/EventNames';
import { createMcpToolCallPayload } from '@mxf-dev/core/schemas/EventPayloadSchema';
import type { ExternalMcpServerManager, ExternalMcpTool } from '@mxf-dev/core/protocols/mcp/services/ExternalMcpServerManager';
import type { ExtendedMcpToolDefinition, McpToolRegistry } from '../../../src/server/api/services/McpToolRegistry';
import { HybridMcpToolRegistry, namespaceExternalTool } from '../../../src/server/mcp/services/HybridMcpToolRegistry';
import { clearHybridMcpToolRegistry, setHybridMcpToolRegistry } from '../../../src/server/mcp/services/HybridMcpRegistryAccess';
import { McpSocketExecutor } from '../../../src/server/socket/services/McpSocketExecutor';

const serverId = 'filesystem';
const channelId = 'channel-a';
const agentId = 'agent-a';
const canonical = namespaceExternalTool(serverId, 'read_file');
const tools: ExternalMcpTool[] = [{
    name: 'read_file', description: 'Read an allowed file', serverId,
    inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    scope: 'channel', scopeId: channelId
}];

const runCall = async (toolName: string): Promise<void> => {
    const payload = createMcpToolCallPayload(Events.Mcp.TOOL_CALL, agentId, channelId, {
        toolName, callId: 'tool-call-1', arguments: { path: '/private/a.txt' }
    }, { requestId: 'llm-attempt-1', activationId: 'activation-1' });
    const authorizedPayload = {
        ...payload,
        authorization: { keyId: 'key-a', allowedTools: ['read_file'] }
    };
    const onCall = mockEventHandlers.get(Events.Mcp.TOOL_CALL);
    expect(onCall).toBeDefined();
    await onCall!(authorizedPayload);
};

const terminalEmissions = (): unknown[][] => mockEventEmit.mock.calls.filter(
    ([event]) => event === Events.Mcp.TOOL_ERROR || event === Events.Mcp.TOOL_RESULT
);

describe('native external results through the hybrid executor', () => {
    let registry: HybridMcpToolRegistry;
    let originalHostTools: string | undefined;
    const singleton = McpSocketExecutor as unknown as { instance: McpSocketExecutor | null };
    let priorExecutor: McpSocketExecutor | null;

    beforeEach(() => {
        jest.clearAllMocks();
        mockEventHandlers.clear();
        originalHostTools = process.env.MXF_UNSAFE_HOST_TOOLS_ENABLED;
        process.env.MXF_UNSAFE_HOST_TOOLS_ENABLED = 'true';
        priorExecutor = singleton.instance;
        singleton.instance = null;
        mockListTools.mockReturnValue(of([]));
        const internal = { listInternalTools: (): Observable<ExtendedMcpToolDefinition[]> => of([]) } as unknown as McpToolRegistry;
        const manager = {
            getAllExternalTools: (): ExternalMcpTool[] => tools,
            executeToolOnServer: mockExecuteExternal
        } as unknown as ExternalMcpServerManager;
        registry = new HybridMcpToolRegistry(internal, manager);
        setHybridMcpToolRegistry(registry);
        McpSocketExecutor.getInstance();
    });

    afterEach(async () => {
        await registry.shutdown();
        clearHybridMcpToolRegistry();
        singleton.instance = priorExecutor;
        if (originalHostTools === undefined) delete process.env.MXF_UNSAFE_HOST_TOOLS_ENABLED;
        else process.env.MXF_UNSAFE_HOST_TOOLS_ENABLED = originalHostTools;
    });

    it.each(['read_file', canonical])('emits exactly one raw denial for %s', async toolName => {
        const native = {
            content: [
                { type: 'text', text: 'Access denied: /private/a.txt' },
                { type: 'text', text: 'Allowed roots:\n/shared' }
            ],
            isError: true,
            structuredContent: { denied: '/private/a.txt' }
        };
        mockExecuteExternal.mockResolvedValue(native);
        await runCall(toolName);

        const error = 'Access denied: /private/a.txt\nAllowed roots:\n/shared';
        expect(terminalEmissions()).toEqual([[Events.Mcp.TOOL_ERROR, expect.objectContaining({
            agentId, channelId, requestId: 'llm-attempt-1', activationId: 'activation-1',
            data: { toolName, callId: 'tool-call-1', error }
        })]]);
        expect(mockExecuteExternal).toHaveBeenCalledTimes(1);
        expect(mockExecuteExternal).toHaveBeenCalledWith(
            serverId, 'read_file', { path: '/private/a.txt' }, agentId, channelId
        );
        expect(mockRecordError).toHaveBeenCalledTimes(1);
        expect(mockRecordError).toHaveBeenCalledWith('tool-call-1', error);
        expect(mockRecordComplete).not.toHaveBeenCalled();
    });

    it('preserves an entire large successful native envelope in the result event and audit', async () => {
        const native = {
            content: [
                { type: 'text', text: 'x'.repeat(9000), extension: 'preserve me' },
                { type: 'image', data: 'YWJj', mimeType: 'image/webp' },
                { type: 'resource_link', name: 'document', uri: 'file:///shared/a.txt' },
                { type: 'text', text: 'last block' }
            ],
            isError: false,
            structuredContent: { read: true, count: 2 },
            _meta: { trace: 'external-provider' }
        };
        mockExecuteExternal.mockResolvedValue(native);
        await runCall('read_file');

        expect(terminalEmissions()).toEqual([[Events.Mcp.TOOL_RESULT, expect.objectContaining({
            requestId: 'llm-attempt-1', activationId: 'activation-1',
            data: { toolName: 'read_file', callId: 'tool-call-1', result: native }
        })]]);
        expect(mockRecordComplete).toHaveBeenCalledWith('tool-call-1', native, undefined);
        expect(mockRecordError).not.toHaveBeenCalled();
        expect(Array.isArray(native.content)).toBe(true);
        expect(native.content).not.toHaveProperty('_paginationHint');
        expect(native.content[2]).not.toHaveProperty('mimeType');
    });

    it.each([false, undefined])('uses native isError=%s without interpreting metadata extension fields', async isError => {
        const native = {
            content: [{ type: 'text', text: 'successful native output' }],
            ...(isError === undefined ? {} : { isError }),
            metadata: { error: true, meaning: 'provider-owned extension' }
        };
        mockExecuteExternal.mockResolvedValue(native);
        await runCall('read_file');
        expect(terminalEmissions()).toEqual([[Events.Mcp.TOOL_RESULT, expect.objectContaining({
            data: { toolName: 'read_file', callId: 'tool-call-1', result: native }
        })]]);
        expect(mockRecordComplete).toHaveBeenCalledWith('tool-call-1', native, native.metadata);
        expect(mockRecordError).not.toHaveBeenCalled();
    });

    it('turns a malformed external envelope into one execution error without a success result', async () => {
        mockExecuteExternal.mockResolvedValue({ unexpected: 'plain text' });
        await runCall('read_file');
        expect(terminalEmissions()).toEqual([[Events.Mcp.TOOL_ERROR, expect.objectContaining({
            data: {
                toolName: 'read_file', callId: 'tool-call-1',
                error: 'External tool read_file must return an MCP result with a content array'
            }
        })]]);
        expect(mockRecordError).toHaveBeenCalledTimes(1);
        expect(mockRecordComplete).not.toHaveBeenCalled();
    });
});
