/**
 * McpSocketExecutor: a tool that failed is answered with TOOL_ERROR.
 *
 * A tool handler reports failure two ways: a defineTool envelope with
 * `isError: true`, or — for the older hand-rolled tools — the registry's
 * wrapper, which turns a throw into `{ content: { type: 'error', data },
 * metadata: { error: true } }`. Both are results as far as the Observable is
 * concerned, so the TOOL_CALL handler answered them with TOOL_RESULT carrying
 * only `result.content` — the error flag never left the server, and the SDK
 * took the answer for a success. A rejected task_complete ended the agent's
 * turn as if the task had completed (Sentinel, 2026-09-01).
 */
import { of } from 'rxjs';

const mockHandler = jest.fn();
const mockGetAgent = jest.fn();
const mockGetChannelAllowedTools = jest.fn();
const mockListTools = jest.fn();
const mockEventHandlers = new Map<string, (payload: unknown) => void>();
const mockEventEmit = jest.fn();

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
    createMcpToolRegisterPayload: jest.fn(),
    validateMcpEventPayload: jest.fn()
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
    getHybridMcpToolRegistry: (): null => null
}));

import { McpSocketExecutor } from '../../../src/server/socket/services/McpSocketExecutor';
import { Events } from '@mxf-dev/core/events/EventNames';

const toolCall = {
    agentId: 'agent-1',
    channelId: 'channel-1',
    authorization: { keyId: 'key-1', allowedTools: ['task_complete'] },
    data: { toolName: 'task_complete', callId: 'call-1', arguments: { details: { tradesOpened: 0 } } }
};

interface EmittedEvent {
    type: string;
    data: { toolName: string; callId: string; result?: unknown; error?: string };
}

const emitted = (): EmittedEvent[] => mockEventEmit.mock.calls.map(call => call[1] as EmittedEvent);

const runToolCall = async (): Promise<void> => {
    const handler = mockEventHandlers.get(Events.Mcp.TOOL_CALL) as ((payload: unknown) => Promise<void>) | undefined;
    expect(handler).toBeDefined();
    await handler!(toolCall);
};

describe('McpSocketExecutor answers a failed tool with TOOL_ERROR', () => {
    McpSocketExecutor.getInstance();

    beforeEach(() => {
        jest.clearAllMocks();
        mockGetAgent.mockReturnValue({ agentId: 'agent-1', allowedTools: ['task_complete'] });
        mockGetChannelAllowedTools.mockReturnValue([]);
        mockListTools.mockReturnValue(of([{
            name: 'task_complete',
            description: 'Finish the task',
            inputSchema: { type: 'object', properties: {} },
            enabled: true,
            handler: mockHandler
        }]));
    });

    it("answers the registry's wrapped throw (content type 'error') with TOOL_ERROR carrying the message", async () => {
        mockHandler.mockResolvedValue({
            content: { type: 'error', data: 'Tool execution error: Task completion summary or result is required' },
            metadata: { error: true, executedAt: Date.now(), toolName: 'task_complete' }
        });

        await runToolCall();

        expect(emitted().map(event => event.type)).toEqual([Events.Mcp.TOOL_ERROR]);
        expect(emitted()[0].data).toEqual({
            toolName: 'task_complete',
            callId: 'call-1',
            error: 'Tool execution error: Task completion summary or result is required'
        });
    });

    it('answers a defineTool failure envelope (isError) with TOOL_ERROR naming the code and message', async () => {
        mockHandler.mockResolvedValue({
            content: {
                type: 'application/json',
                data: { error: true, code: 'INVALID_INPUT', message: 'summary is required', tool: 'task_complete' }
            },
            isError: true,
            metadata: { toolName: 'task_complete', executedAt: Date.now(), durationMs: 3, errorCode: 'INVALID_INPUT' }
        });

        await runToolCall();

        expect(emitted().map(event => event.type)).toEqual([Events.Mcp.TOOL_ERROR]);
        expect(emitted()[0].data).toEqual({
            toolName: 'task_complete',
            callId: 'call-1',
            error: 'INVALID_INPUT: summary is required'
        });
    });

    it('still answers a result with TOOL_RESULT carrying its content', async () => {
        mockHandler.mockResolvedValue({
            content: { type: 'text', data: '{"status":"task_completed"}' },
            isError: false,
            metadata: { toolName: 'task_complete', executedAt: Date.now(), durationMs: 3 }
        });

        await runToolCall();

        expect(emitted().map(event => event.type)).toEqual([Events.Mcp.TOOL_RESULT]);
        expect(emitted()[0].data).toEqual({
            toolName: 'task_complete',
            callId: 'call-1',
            result: { type: 'text', data: '{"status":"task_completed"}' }
        });
    });
});
