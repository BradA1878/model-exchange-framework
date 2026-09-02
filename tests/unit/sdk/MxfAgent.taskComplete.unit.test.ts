/**
 * MxfAgent's generation loop against a task_complete the server rejects.
 *
 * The loop ends a task's turn when task_complete succeeds. A task_complete the
 * server rejected — the model filled `details` and `nextSteps` and dropped the
 * summary — is a failed tool call like any other: the model has to see the
 * error and get another turn. Before this, the failure reached the loop as a
 * plain result string, was taken for a completion, and the turn ended with
 * the task still open on the server; the consumer waited out its own timeout
 * (Sentinel, 2026-09-01, two runs).
 *
 * The socket is faked at MxfService.socketEmit and answered through the
 * EventBus mock, so the real McpToolHandlers.callTool is on the path — the
 * layer that turned the server's error envelope into a success.
 */
import { Subscription } from 'rxjs';

const mockLoggerError = jest.fn();

jest.mock('@mxf-dev/core/utils/Logger', () => ({
    Logger: class {
        info = jest.fn(); warn = jest.fn(); error = mockLoggerError; debug = jest.fn();
    }
}));

type Handler = (payload: unknown) => void;

jest.mock('@mxf-dev/core/events/EventBus', () => {
    const handlers: Map<string, Handler[]> = new Map();
    const client = {
        on: jest.fn((event: string, handler: Handler) => {
            if (!handlers.has(event)) handlers.set(event, []);
            handlers.get(event)!.push(handler);
            return {
                unsubscribe: jest.fn(() => {
                    const list = handlers.get(event);
                    if (list) {
                        const index = list.indexOf(handler);
                        if (index > -1) list.splice(index, 1);
                    }
                })
            } as unknown as Subscription;
        }),
        off: jest.fn(),
        emit: jest.fn(),
        emitOn: jest.fn(),
        emitLocal: jest.fn(),
        registerSocket: jest.fn(),
        unregisterSocket: jest.fn(),
        setClientSocket: jest.fn(),
        isRegisteredSocketConnected: jest.fn(() => true),
        /** Deliver a server answer to whoever is listening, the way the socket would. */
        _dispatch: (event: string, payload: unknown): void => {
            [...(handlers.get(event) ?? [])].forEach(handler => handler(payload));
        },
        _reset: (): void => handlers.clear()
    };
    return { EventBus: { client } };
});

const mockSocketEmit = jest.fn();
jest.mock('@mxf-dev/sdk/services/MxfService', () => ({
    MxfService: jest.fn().mockImplementation(() => ({
        connect: jest.fn(),
        disconnect: jest.fn(),
        setAgentId: jest.fn(),
        isConnected: jest.fn(() => true),
        socketEmit: mockSocketEmit,
        getChannelConfig: jest.fn(() => ({})),
        getActiveAgents: jest.fn(() => []),
        onTaskCompleted: jest.fn(),
        onTaskFailed: jest.fn(),
        onTaskCancelled: jest.fn(),
        onTaskAssigned: jest.fn(),
        onTaskStarted: jest.fn(),
        onTaskProgressUpdated: jest.fn(),
        clearTaskEventCallbacks: jest.fn()
    }))
}));
jest.mock('@mxf-dev/sdk/handlers/MessageHandlers', () => ({
    MessageHandlers: jest.fn().mockImplementation(() => ({
        subscribeToChannel: jest.fn().mockResolvedValue(true),
        unsubscribeFromChannel: jest.fn().mockResolvedValue(true),
        sendChannelMessage: jest.fn().mockResolvedValue(true),
        sendDirectMessage: jest.fn(),
        updateMxpConfig: jest.fn(),
        cleanup: jest.fn()
    }))
}));

const cachedTools = [
    { name: 'task_complete', description: 'Finish the task', inputSchema: { type: 'object', properties: {} }, enabled: true, providerId: 'internal', channelId: 'test-channel' }
];
jest.mock('@mxf-dev/sdk/services/MxfToolService', () => ({
    MxfToolService: jest.fn().mockImplementation(() => ({
        loadTools: jest.fn().mockResolvedValue(cachedTools),
        reloadTools: jest.fn().mockResolvedValue(cachedTools),
        getCachedTools: jest.fn(() => cachedTools),
        cleanup: jest.fn()
    }))
}));

const mockSendWithContextStreaming = jest.fn();
jest.mock('@mxf-dev/sdk/managers/MxfMcpClientManager', () => ({
    MxfMcpClientManager: jest.fn().mockImplementation(() => ({
        initializeMcpClient: jest.fn().mockResolvedValue(undefined),
        sendWithContextStreaming: mockSendWithContextStreaming,
        registerTool: jest.fn(),
        unregisterTool: jest.fn(),
        cleanup: jest.fn().mockResolvedValue(undefined)
    }))
}));

const mockAddConversationMessage = jest.fn();
jest.mock('@mxf-dev/sdk/managers/MxfMemoryManager', () => ({
    MxfMemoryManager: jest.fn().mockImplementation(() => ({
        initialize: jest.fn().mockResolvedValue(undefined),
        addConversationMessage: mockAddConversationMessage,
        getConversationHistory: jest.fn(() => []),
        flushPersistence: jest.fn().mockResolvedValue(undefined),
        stopPersistence: jest.fn(),
        flushIndexQueue: jest.fn().mockResolvedValue(undefined),
        stopIndexing: jest.fn(),
        pendingIndexCount: jest.fn(() => 0)
    }))
}));
jest.mock('@mxf-dev/sdk/managers/MxfSystemPromptManager', () => ({
    MxfSystemPromptManager: jest.fn().mockImplementation(() => ({
        generateMinimalPrompt: jest.fn(() => 'system prompt'),
        updatePromptForTask: jest.fn().mockResolvedValue(undefined),
        loadCompleteSystemPrompt: jest.fn().mockResolvedValue(undefined),
        setAgentConfigPrompt: jest.fn().mockResolvedValue(undefined)
    }))
}));
jest.mock('@mxf-dev/sdk/services/MxfContextBuilder', () => ({
    MxfContextBuilder: jest.fn().mockImplementation(() => ({
        buildContext: jest.fn(async () => ({ systemPrompt: 'system prompt', messages: [], tools: [] })),
        actionHistoryService: undefined
    }))
}));
jest.mock('@mxf-dev/sdk/services/MxfEventHandlerService', () => ({
    MxfEventHandlerService: jest.fn().mockImplementation(() => ({
        initializeEventHandlers: jest.fn(),
        cleanup: jest.fn()
    }))
}));

import { EventBus } from '@mxf-dev/core/events/EventBus';
import { Events } from '@mxf-dev/core/events/EventNames';
import type { AgentConfig } from '@mxf-dev/core/interfaces/AgentInterfaces';
import { MxfAgent } from '@mxf-dev/sdk/MxfAgent';
import { MxfMemoryManager } from '@mxf-dev/sdk/managers/MxfMemoryManager';

const CONFIG: AgentConfig = {
    agentId: 'test-agent',
    name: 'Test Agent',
    channelId: 'test-channel',
    keyId: 'key-1',
    secretKey: 'secret-1',
    host: 'localhost',
    port: 3001,
    secure: false,
    apiUrl: 'http://localhost:3001/api',
    apiKey: '',
    agentConfigPrompt: '',
    llmProvider: 'openrouter',
    model: 'test-model'
} as AgentConfig;

interface ToolCallPayload {
    data: { toolName: string; callId: string; arguments: Record<string, unknown> };
}

const REJECTION =
    'Tool execution error: Task completion summary or result is required: pass "summary" ' +
    '(prose, or an object stored as JSON) or "result". Received only: details, nextSteps. ' +
    'Call task_complete again with a summary.';

const taskCompleteCall = (id: string, input: Record<string, unknown>): unknown => ({
    content: [{ type: 'tool_use', id, name: 'task_complete', input }],
    model: 'test-model'
});

const dispatch = (EventBus.client as unknown as { _dispatch: (event: string, payload: unknown) => void })._dispatch;

/**
 * Answer each task_complete the way the server does: rejected without a
 * summary (a 3.2.2 server sends the rejection as an 'error' result),
 * completed with one.
 */
const answerTaskCompleteCalls = (): void => {
    mockSocketEmit.mockImplementation((eventName: string, payload: ToolCallPayload) => {
        if (eventName !== Events.Mcp.TOOL_CALL) {
            return;
        }
        const { callId, arguments: args } = payload.data;
        const result = typeof args.summary === 'string'
            ? {
                type: 'text',
                data: JSON.stringify({ status: 'task_completed', message: `Task completed successfully: ${args.summary}`, taskId: 'task-1' })
            }
            : { type: 'error', data: REJECTION };
        dispatch(Events.Mcp.TOOL_RESULT, {
            type: Events.Mcp.TOOL_RESULT,
            agentId: 'test-agent',
            channelId: 'test-channel',
            timestamp: Date.now(),
            data: { toolName: 'task_complete', callId, result }
        });
    });
};

const runTask = (agent: MxfAgent): Promise<unknown> => (agent as unknown as {
    taskExecutionManager: { executeTask: (request: unknown) => Promise<unknown> };
}).taskExecutionManager.executeTask({
    taskId: 'task-1',
    fromAgentId: 'requester',
    toAgentId: 'test-agent',
    title: 'Evaluate',
    description: 'Evaluate the alert',
    content: 'Evaluate the alert'
});

describe('MxfAgent against a task_complete the server rejects', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (EventBus.client as unknown as { _reset: () => void })._reset();
        mockAddConversationMessage.mockResolvedValue(undefined);
    });

    it('does not end the turn: the model sees the rejection and completes on the next iteration', async () => {
        const agent = new MxfAgent({ ...CONFIG });
        // The harness never connects; the socket is faked below.
        (agent as unknown as { isFullyConnected: boolean }).isFullyConnected = true;
        answerTaskCompleteCalls();
        mockSendWithContextStreaming
            .mockResolvedValueOnce(taskCompleteCall('call-1', {
                details: { alertEvaluated: 'BTC breakout', tradesOpened: 0 },
                nextSteps: 'Hold cash until the next alert'
            }))
            .mockResolvedValueOnce(taskCompleteCall('call-2', {
                summary: 'PASS: no trade taken; hold cash until the next alert'
            }));

        await expect(runTask(agent)).resolves.toBeDefined();

        expect(mockSendWithContextStreaming).toHaveBeenCalledTimes(2);
        const sent = mockSocketEmit.mock.calls
            .filter(call => call[0] === Events.Mcp.TOOL_CALL)
            .map(call => (call[1] as ToolCallPayload).data.arguments);
        expect(sent).toEqual([
            { details: { alertEvaluated: 'BTC breakout', tradesOpened: 0 }, nextSteps: 'Hold cash until the next alert' },
            { summary: 'PASS: no trade taken; hold cash until the next alert' }
        ]);
        // The rejection reached the model as the tool's result.
        const stored = mockAddConversationMessage.mock.calls.map(call => call[0] as { role: string; content: unknown });
        expect(stored.some(message => typeof message.content === 'string' && message.content.includes('Received only: details, nextSteps'))).toBe(true);
        // A failed tool call is logged as one.
        expect(mockLoggerError).toHaveBeenCalledWith(expect.stringContaining('Received only: details, nextSteps'));
    });

    it('still ends the turn on a task_complete the server accepted', async () => {
        const agent = new MxfAgent({ ...CONFIG });
        (agent as unknown as { isFullyConnected: boolean }).isFullyConnected = true;
        answerTaskCompleteCalls();
        mockSendWithContextStreaming.mockResolvedValue(taskCompleteCall('call-1', { summary: 'Classified 12 items' }));

        await expect(runTask(agent)).resolves.toBeDefined();

        expect(mockSendWithContextStreaming).toHaveBeenCalledTimes(1);
        expect(mockLoggerError).not.toHaveBeenCalled();
    });
});

describe('MxfAgent memory manager wiring', () => {
    it('passes backfillSearchIndexOnLoad from the agent config to the memory manager', () => {
        const constructed = MxfMemoryManager as unknown as jest.Mock;
        constructed.mockClear();

        new MxfAgent({ ...CONFIG, backfillSearchIndexOnLoad: false });

        const memoryConfig = constructed.mock.calls[constructed.mock.calls.length - 1][0] as { backfillSearchIndexOnLoad?: boolean };
        expect(memoryConfig.backfillSearchIndexOnLoad).toBe(false);
    });
});
