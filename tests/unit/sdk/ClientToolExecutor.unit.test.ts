/**
 * Unit tests for ClientToolExecutor
 * Tests the client-side tool execution gate logic, execution paths,
 * tool loading, external tool registration, and cleanup behavior.
 */

import { Subscription } from 'rxjs';
import { EventBus } from '@mxf/shared/events/EventBus';
import { Events } from '@mxf/shared/events/EventNames';

// ── Mock: EventBus.client ──
// Follow the pattern from MxfChannelMonitor.unit.test.ts — track emitted events
// so tests can verify observability events are fired correctly.
const emittedEvents: Array<{ event: string; payload: any }> = [];

jest.mock('@mxf/shared/events/EventBus', () => {
    return {
        EventBus: {
            client: {
                emit: jest.fn((event: string, payload: any) => {
                    emittedEvents.push({ event, payload });
                }),
                on: jest.fn(() => ({ unsubscribe: jest.fn() } as unknown as Subscription)),
            },
        },
    };
});

// ── Mock: ClientExecutableManifest ──
// Control the allowlist gate per-test via mockIsClientExecutable.
const mockIsClientExecutable = jest.fn<boolean, [string]>();
jest.mock('@mxf/shared/protocols/mcp/ClientExecutableManifest', () => ({
    isClientExecutable: (name: string) => mockIsClientExecutable(name),
}));

// ── Mock: DateTimeTools ──
// Provide a minimal mock set of datetime tools for loadInternalTools tests.
const mockDateTimeHandler = jest.fn().mockResolvedValue({ iso: '2026-01-01T00:00:00Z' });
jest.mock('@mxf/shared/protocols/mcp/tools/DateTimeTools', () => ({
    dateTimeTools: [
        {
            name: 'datetime_now',
            description: 'Get current datetime',
            inputSchema: { type: 'object', properties: {} },
            handler: mockDateTimeHandler,
        },
        {
            name: 'datetime_convert',
            description: 'Convert datetime',
            inputSchema: { type: 'object', properties: {} },
            handler: mockDateTimeHandler,
        },
        {
            name: 'datetime_arithmetic',
            description: 'Datetime arithmetic',
            inputSchema: { type: 'object', properties: {} },
            handler: mockDateTimeHandler,
        },
        {
            name: 'datetime_format',
            description: 'Format datetime',
            inputSchema: { type: 'object', properties: {} },
            handler: mockDateTimeHandler,
        },
        {
            name: 'datetime_not_in_manifest',
            description: 'This tool is NOT in the manifest',
            inputSchema: { type: 'object', properties: {} },
            handler: mockDateTimeHandler,
        },
    ],
}));

// ── Mock: Logger ──
jest.mock('@mxf/shared/utils/Logger', () => ({
    Logger: jest.fn().mockImplementation(() => ({
        info: jest.fn(),
        debug: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
    })),
}));

// Import after mocks are set up
import { ClientToolExecutor } from '@mxf/sdk/services/ClientToolExecutor';

// ── Test Helpers ──

/** Create a minimal mock MxfService */
function createMockMxfService() {
    return {
        socketEmit: jest.fn(),
    } as any;
}

/** Default test IDs */
const AGENT_ID = 'agent-test-001';
const CHANNEL_ID = 'channel-test-001';

describe('ClientToolExecutor Unit Tests', () => {

    let executor: ClientToolExecutor;
    let mockMxfService: ReturnType<typeof createMockMxfService>;

    beforeEach(() => {
        jest.clearAllMocks();
        emittedEvents.length = 0;
        mockIsClientExecutable.mockReturnValue(false);
        mockMxfService = createMockMxfService();
    });

    // ─── canExecuteLocally ───────────────────────────────────────────

    describe('canExecuteLocally', () => {
        it('should return false when executor is disabled', () => {
            executor = new ClientToolExecutor(AGENT_ID, CHANNEL_ID, mockMxfService, false);

            // Register a tool and allow it in the manifest
            executor.registerExternalTool('my_tool', jest.fn(), {}, 'desc');
            mockIsClientExecutable.mockReturnValue(true);

            expect(executor.canExecuteLocally('my_tool')).toBe(false);
        });

        it('should return false when tool is not in the registry', () => {
            executor = new ClientToolExecutor(AGENT_ID, CHANNEL_ID, mockMxfService, true);
            mockIsClientExecutable.mockReturnValue(true);

            // No tools registered, so 'unknown_tool' is not in registry
            expect(executor.canExecuteLocally('unknown_tool')).toBe(false);
        });

        it('should return false when tool is in registry but not in the manifest', () => {
            executor = new ClientToolExecutor(AGENT_ID, CHANNEL_ID, mockMxfService, true);
            executor.registerExternalTool('my_tool', jest.fn(), {}, 'desc');
            mockIsClientExecutable.mockReturnValue(false);

            expect(executor.canExecuteLocally('my_tool')).toBe(false);
        });

        it('should return true when enabled, tool is in registry, and tool is in manifest', () => {
            executor = new ClientToolExecutor(AGENT_ID, CHANNEL_ID, mockMxfService, true);
            executor.registerExternalTool('my_tool', jest.fn(), {}, 'desc');
            mockIsClientExecutable.mockReturnValue(true);

            expect(executor.canExecuteLocally('my_tool')).toBe(true);
        });

        it('should check gates in order: enabled -> registry -> manifest', () => {
            // Disabled — should not even check registry or manifest
            executor = new ClientToolExecutor(AGENT_ID, CHANNEL_ID, mockMxfService, false);
            expect(executor.canExecuteLocally('any')).toBe(false);
            // isClientExecutable should not have been called because the first gate failed
            expect(mockIsClientExecutable).not.toHaveBeenCalled();
        });
    });

    // ─── executeLocally ──────────────────────────────────────────────

    describe('executeLocally', () => {
        it('should call the handler, emit events, and return the result (happy path)', async () => {
            executor = new ClientToolExecutor(AGENT_ID, CHANNEL_ID, mockMxfService, true);

            const handlerResult = { answer: 42 };
            const mockHandler = jest.fn().mockResolvedValue(handlerResult);
            executor.registerExternalTool('calc_add', mockHandler, { type: 'object' }, 'Add numbers');

            const input = { a: 1, b: 2 };
            const result = await executor.executeLocally('calc_add', input, CHANNEL_ID);

            expect(result).toEqual(handlerResult);
            expect(mockHandler).toHaveBeenCalledTimes(1);
            // Verify handler received the input and a context with agentId/channelId
            expect(mockHandler).toHaveBeenCalledWith(
                input,
                expect.objectContaining({
                    agentId: AGENT_ID,
                    channelId: CHANNEL_ID,
                })
            );
        });

        it('should emit TOOL_CALL_LOCAL event before execution', async () => {
            executor = new ClientToolExecutor(AGENT_ID, CHANNEL_ID, mockMxfService, true);
            const mockHandler = jest.fn().mockResolvedValue('ok');
            executor.registerExternalTool('my_tool', mockHandler, {}, 'desc');

            await executor.executeLocally('my_tool', { x: 1 }, CHANNEL_ID);

            const callEvent = emittedEvents.find(e => e.event === Events.Mcp.TOOL_CALL_LOCAL);
            expect(callEvent).toBeDefined();
            expect(callEvent!.payload).toMatchObject({
                agentId: AGENT_ID,
                channelId: CHANNEL_ID,
            });
        });

        it('should emit TOOL_RESULT_LOCAL event after successful execution', async () => {
            executor = new ClientToolExecutor(AGENT_ID, CHANNEL_ID, mockMxfService, true);
            const mockHandler = jest.fn().mockResolvedValue({ value: 'done' });
            executor.registerExternalTool('my_tool', mockHandler, {}, 'desc');

            await executor.executeLocally('my_tool', {}, CHANNEL_ID);

            const resultEvent = emittedEvents.find(e => e.event === Events.Mcp.TOOL_RESULT_LOCAL);
            expect(resultEvent).toBeDefined();
            expect(resultEvent!.payload).toMatchObject({
                agentId: AGENT_ID,
                channelId: CHANNEL_ID,
            });
        });

        it('should emit TOOL_ERROR_LOCAL event on handler error and rethrow', async () => {
            executor = new ClientToolExecutor(AGENT_ID, CHANNEL_ID, mockMxfService, true);
            const testError = new Error('handler exploded');
            const mockHandler = jest.fn().mockRejectedValue(testError);
            executor.registerExternalTool('bad_tool', mockHandler, {}, 'desc');

            await expect(executor.executeLocally('bad_tool', {}, CHANNEL_ID))
                .rejects.toThrow('handler exploded');

            const errorEvent = emittedEvents.find(e => e.event === Events.Mcp.TOOL_ERROR_LOCAL);
            expect(errorEvent).toBeDefined();
        });

        it('should throw if toolName is not in registry', async () => {
            executor = new ClientToolExecutor(AGENT_ID, CHANNEL_ID, mockMxfService, true);

            await expect(executor.executeLocally('nonexistent', {}, CHANNEL_ID))
                .rejects.toThrow("Tool 'nonexistent' not found in client tool registry");
        });

        it('should throw if toolName is empty string', async () => {
            executor = new ClientToolExecutor(AGENT_ID, CHANNEL_ID, mockMxfService, true);

            await expect(executor.executeLocally('', {}, CHANNEL_ID))
                .rejects.toThrow('toolName is required');
        });

        it('should extract result from MCP content format ({ content: { type, data } })', async () => {
            executor = new ClientToolExecutor(AGENT_ID, CHANNEL_ID, mockMxfService, true);
            const mcpResult = { content: { type: 'text', data: 'extracted value' } };
            const mockHandler = jest.fn().mockResolvedValue(mcpResult);
            executor.registerExternalTool('mcp_tool', mockHandler, {}, 'desc');

            const result = await executor.executeLocally('mcp_tool', {}, CHANNEL_ID);
            expect(result).toBe('extracted value');
        });

        it('should extract content when content lacks type/data structure', async () => {
            executor = new ClientToolExecutor(AGENT_ID, CHANNEL_ID, mockMxfService, true);
            const mcpResult = { content: 'simple content string' };
            const mockHandler = jest.fn().mockResolvedValue(mcpResult);
            executor.registerExternalTool('mcp_tool', mockHandler, {}, 'desc');

            const result = await executor.executeLocally('mcp_tool', {}, CHANNEL_ID);
            expect(result).toBe('simple content string');
        });

        it('should pass null/undefined input as empty object to handler', async () => {
            executor = new ClientToolExecutor(AGENT_ID, CHANNEL_ID, mockMxfService, true);
            const mockHandler = jest.fn().mockResolvedValue('ok');
            executor.registerExternalTool('my_tool', mockHandler, {}, 'desc');

            await executor.executeLocally('my_tool', null, CHANNEL_ID);
            expect(mockHandler).toHaveBeenCalledWith(
                {},
                expect.any(Object)
            );
        });
    });

    // ─── notifyServerOfCompletion (source field) ─────────────────────

    describe('notifyServerOfCompletion (source field via socketEmit)', () => {
        it('should pass source "internal" for internal tools', async () => {
            executor = new ClientToolExecutor(AGENT_ID, CHANNEL_ID, mockMxfService, true);

            // loadInternalTools registers tools with source 'internal'
            // Allow all datetime tools through the manifest mock
            mockIsClientExecutable.mockImplementation((name: string) =>
                ['datetime_now', 'datetime_convert', 'datetime_arithmetic', 'datetime_format'].includes(name)
            );
            executor.loadInternalTools();

            await executor.executeLocally('datetime_now', {}, CHANNEL_ID);

            expect(mockMxfService.socketEmit).toHaveBeenCalledTimes(1);
            const [eventName, payload] = mockMxfService.socketEmit.mock.calls[0];
            expect(eventName).toBe(Events.Mcp.TOOL_CALL_COMPLETED_LOCAL);
            expect(payload).toMatchObject({
                data: expect.objectContaining({
                    source: 'internal',
                    executedOn: 'client',
                    toolName: 'datetime_now',
                }),
            });
        });

        it('should pass source "external-mcp" for external tools', async () => {
            executor = new ClientToolExecutor(AGENT_ID, CHANNEL_ID, mockMxfService, true);
            const mockHandler = jest.fn().mockResolvedValue({ result: 'calc' });
            executor.registerExternalTool('calc_add', mockHandler, {}, 'Add');

            await executor.executeLocally('calc_add', { a: 1 }, CHANNEL_ID);

            expect(mockMxfService.socketEmit).toHaveBeenCalledTimes(1);
            const [eventName, payload] = mockMxfService.socketEmit.mock.calls[0];
            expect(eventName).toBe(Events.Mcp.TOOL_CALL_COMPLETED_LOCAL);
            expect(payload).toMatchObject({
                data: expect.objectContaining({
                    source: 'external-mcp',
                    executedOn: 'client',
                    toolName: 'calc_add',
                }),
            });
        });

        it('should not throw if socketEmit fails (fire-and-forget)', async () => {
            executor = new ClientToolExecutor(AGENT_ID, CHANNEL_ID, mockMxfService, true);
            mockMxfService.socketEmit.mockImplementation(() => {
                throw new Error('socket disconnected');
            });
            const mockHandler = jest.fn().mockResolvedValue('ok');
            executor.registerExternalTool('my_tool', mockHandler, {}, 'desc');

            // Should not throw despite socketEmit failure
            const result = await executor.executeLocally('my_tool', {}, CHANNEL_ID);
            expect(result).toBe('ok');
        });
    });

    // ─── loadInternalTools ───────────────────────────────────────────

    describe('loadInternalTools', () => {
        it('should load only tools that are in the manifest', () => {
            executor = new ClientToolExecutor(AGENT_ID, CHANNEL_ID, mockMxfService, true);

            // Only allow datetime_now and datetime_format through the manifest
            mockIsClientExecutable.mockImplementation((name: string) =>
                name === 'datetime_now' || name === 'datetime_format'
            );

            executor.loadInternalTools();

            // 2 of the 5 mock tools should be loaded
            expect(executor.getLocalToolCount()).toBe(2);
            const names = executor.getLocalToolNames();
            expect(names).toContain('datetime_now');
            expect(names).toContain('datetime_format');
            expect(names).not.toContain('datetime_not_in_manifest');
        });

        it('should load all datetime tools when all are in manifest', () => {
            executor = new ClientToolExecutor(AGENT_ID, CHANNEL_ID, mockMxfService, true);
            mockIsClientExecutable.mockImplementation((name: string) =>
                ['datetime_now', 'datetime_convert', 'datetime_arithmetic', 'datetime_format'].includes(name)
            );

            executor.loadInternalTools();

            expect(executor.getLocalToolCount()).toBe(4);
        });

        it('should load zero tools when none are in manifest', () => {
            executor = new ClientToolExecutor(AGENT_ID, CHANNEL_ID, mockMxfService, true);
            mockIsClientExecutable.mockReturnValue(false);

            executor.loadInternalTools();

            expect(executor.getLocalToolCount()).toBe(0);
        });
    });

    // ─── registerExternalTool ────────────────────────────────────────

    describe('registerExternalTool', () => {
        it('should register a tool with source "external-mcp"', async () => {
            executor = new ClientToolExecutor(AGENT_ID, CHANNEL_ID, mockMxfService, true);
            const mockHandler = jest.fn().mockResolvedValue('result');
            executor.registerExternalTool('ext_tool', mockHandler, { type: 'object' }, 'External tool');

            expect(executor.getLocalToolCount()).toBe(1);
            expect(executor.getLocalToolNames()).toContain('ext_tool');

            // Execute to verify source is set to 'external-mcp' in the notification
            await executor.executeLocally('ext_tool', {}, CHANNEL_ID);
            const [, payload] = mockMxfService.socketEmit.mock.calls[0];
            expect(payload.data.source).toBe('external-mcp');
        });

        it('should throw for empty tool name', () => {
            executor = new ClientToolExecutor(AGENT_ID, CHANNEL_ID, mockMxfService, true);
            expect(() => {
                executor.registerExternalTool('', jest.fn(), {}, 'desc');
            }).toThrow('tool name is required');
        });

        it('should overwrite existing tool with same name', () => {
            executor = new ClientToolExecutor(AGENT_ID, CHANNEL_ID, mockMxfService, true);
            executor.registerExternalTool('tool_a', jest.fn(), {}, 'first');
            executor.registerExternalTool('tool_a', jest.fn(), {}, 'second');

            expect(executor.getLocalToolCount()).toBe(1);
        });
    });

    // ─── cleanup ─────────────────────────────────────────────────────

    describe('cleanup', () => {
        it('should clear all registered tools', () => {
            executor = new ClientToolExecutor(AGENT_ID, CHANNEL_ID, mockMxfService, true);
            executor.registerExternalTool('tool_a', jest.fn(), {}, 'A');
            executor.registerExternalTool('tool_b', jest.fn(), {}, 'B');
            expect(executor.getLocalToolCount()).toBe(2);

            executor.cleanup();

            expect(executor.getLocalToolCount()).toBe(0);
            expect(executor.getLocalToolNames()).toEqual([]);
        });

        it('should be safe to call cleanup on an already empty registry', () => {
            executor = new ClientToolExecutor(AGENT_ID, CHANNEL_ID, mockMxfService, true);
            expect(() => executor.cleanup()).not.toThrow();
            expect(executor.getLocalToolCount()).toBe(0);
        });
    });

    // ─── Constructor validation ──────────────────────────────────────

    describe('Constructor', () => {
        it('should throw for empty agentId', () => {
            expect(() => new ClientToolExecutor('', CHANNEL_ID, mockMxfService, true))
                .toThrow('agentId is required');
        });

        it('should throw for empty channelId', () => {
            expect(() => new ClientToolExecutor(AGENT_ID, '', mockMxfService, true))
                .toThrow('channelId is required');
        });

        it('should create successfully with valid arguments', () => {
            const exec = new ClientToolExecutor(AGENT_ID, CHANNEL_ID, mockMxfService, true);
            expect(exec.getLocalToolCount()).toBe(0);
        });
    });
});
