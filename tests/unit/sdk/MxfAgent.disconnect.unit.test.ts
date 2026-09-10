/**
 * agent.disconnect() against a turn that is still finishing.
 *
 * A consumer that disconnects an ephemeral agent as soon as it sees
 * task:completed races the task's final turn: addConversationMessage()
 * awaits the persist of the task_complete tool result, and disconnect()
 * closed the socket under that save. The turn then failed with
 * "Cannot start memory operation … not connected" (or "cancelled: channel
 * service disconnected explicitly"), the execution loop treated that as a
 * task failure, and TaskHandlers tried to report the already-completed task
 * as failed into the closed socket — six error lines per agent per task.
 *
 * Nothing exercised MxfAgent itself before; the base-client mocks are the
 * ones MxfClientPublicApi.unit.test.ts uses, plus fakes for the managers
 * MxfAgent adds.
 */
import { Subscription } from 'rxjs';

const mockLoggerError = jest.fn();
const calls: string[] = [];

jest.mock('@mxf-dev/core/utils/Logger', () => ({
    Logger: class {
        info = jest.fn(); warn = jest.fn(); error = mockLoggerError; debug = jest.fn();
    }
}));

jest.mock('@mxf-dev/core/events/EventBus', () => {
    const handlers: Map<string, ((payload: unknown) => void)[]> = new Map();
    const client = {
        on: jest.fn((event: string, handler: (payload: unknown) => void) => {
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
        _reset: (): void => handlers.clear()
    };
    return { EventBus: { client } };
});

jest.mock('@mxf-dev/sdk/services/MxfService', () => ({
    MxfService: jest.fn().mockImplementation(() => ({
        connect: jest.fn(),
        disconnect: jest.fn(async () => { calls.push('service.disconnect'); }),
        setAgentId: jest.fn(),
        isConnected: jest.fn(() => true),
        socketEmit: jest.fn(),
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
    { name: 'task_complete', description: 'Finish the task', inputSchema: { type: 'object', properties: {} }, enabled: true, providerId: 'internal', channelId: 'test-channel' },
    { name: 'fetch_feed', description: 'Fetch a feed', inputSchema: { type: 'object', properties: {} }, enabled: true, providerId: 'internal', channelId: 'test-channel' }
];
jest.mock('@mxf-dev/sdk/services/MxfToolService', () => ({
    MxfToolService: jest.fn().mockImplementation(() => ({
        loadTools: jest.fn().mockResolvedValue(cachedTools),
        reloadTools: jest.fn().mockResolvedValue(cachedTools),
        getCachedTools: jest.fn(() => cachedTools),
        isLoaded: jest.fn(() => true),
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
const mockFlushPersistence = jest.fn(async () => { calls.push('flushPersistence'); });
jest.mock('@mxf-dev/sdk/managers/MxfMemoryManager', () => ({
    MxfMemoryManager: jest.fn().mockImplementation(() => ({
        initialize: jest.fn().mockResolvedValue(undefined),
        addConversationMessage: mockAddConversationMessage,
        getConversationHistory: jest.fn(() => []),
        flushPersistence: mockFlushPersistence,
        stopPersistence: jest.fn(() => { calls.push('stopPersistence'); }),
        flushIndexQueue: jest.fn(async () => { calls.push('flushIndexQueue'); }),
        stopIndexing: jest.fn(() => { calls.push('stopIndexing'); }),
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
import { MxfAgentSystemPrompt } from '@mxf-dev/core/prompts/MxfAgentSystemPrompt';
import { MxfTaskExecutionManager } from '@mxf-dev/sdk/managers/MxfTaskExecutionManager';

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

const textResponse = {
    content: [{ type: 'text', text: 'Working on it.' }],
    model: 'test-model'
};

describe('MxfAgent.disconnect() against a finishing turn', () => {
    beforeEach(() => {
        calls.length = 0;
        jest.clearAllMocks();
        (EventBus.client as unknown as { _reset: () => void })._reset();
        (EventBus.client.isRegisteredSocketConnected as jest.Mock).mockReturnValue(true);
        mockAddConversationMessage.mockResolvedValue(undefined);
    });

    it('persists queued memory before closing the socket', async () => {
        const agent = new MxfAgent({ ...CONFIG });

        await agent.disconnect();

        expect(calls).toEqual(['flushPersistence', 'stopPersistence', 'flushIndexQueue', 'stopIndexing', 'service.disconnect']);
    });

    it('still closes the socket when the memory flush fails, logging that failure once', async () => {
        // A save the server never answers now ends with a time-out error from
        // flushPersistence(); disconnect() reports it and goes on to stop
        // persistence, drain the index queue, and close the socket.
        const agent = new MxfAgent({ ...CONFIG });
        mockFlushPersistence.mockRejectedValueOnce(
            new Error("Memory operation op-1 timed out after 60000ms waiting for the server's answer")
        );

        await expect(agent.disconnect()).resolves.toBeUndefined();

        expect(calls).toEqual(['stopPersistence', 'flushIndexQueue', 'stopIndexing', 'service.disconnect']);
        expect(mockLoggerError).toHaveBeenCalledTimes(1);
        expect(mockLoggerError).toHaveBeenCalledWith(expect.stringContaining(
            "Could not persist queued memory before disconnect: Memory operation op-1 timed out after 60000ms"
        ));
    });

    it('ends a turn that finishes after disconnect() began, without reporting a task failure', async () => {
        const agent = new MxfAgent({ ...CONFIG });
        mockSendWithContextStreaming.mockResolvedValue(textResponse);
        // The consumer disconnected while the model was answering: the turn's next save cannot start.
        await agent.disconnect();
        mockAddConversationMessage.mockImplementation(async () => {
            (EventBus.client.isRegisteredSocketConnected as jest.Mock).mockReturnValue(false);
            throw new Error("Cannot start memory operation op-1: agent socket 'test-agent' is not connected");
        });
        const taskExecutionManager = (agent as unknown as {
            taskExecutionManager: { executeTask: (request: unknown) => Promise<unknown> };
        }).taskExecutionManager;

        await expect(taskExecutionManager.executeTask({
            taskId: 'task-1',
            fromAgentId: 'requester',
            toAgentId: 'test-agent',
            title: 'Classify',
            description: 'Classify the feed',
            content: 'Classify the feed'
        })).resolves.toBeDefined();

        const agentErrors = (EventBus.client.emitOn as jest.Mock).mock.calls.filter(call => call[1] === Events.Agent.ERROR);
        expect(agentErrors).toHaveLength(0);
        expect(mockLoggerError).not.toHaveBeenCalled();
    });
    it('discards tool results when the task is cancelled while a tool runs', async () => {
        // disconnect() cancels the current task; a tool call in flight at that
        // moment still returns, and its result used to be persisted into the
        // closing socket. A task_complete that succeeded is different: it clears
        // the task itself and its result is stored like any other.
        const agent = new MxfAgent({ ...CONFIG });
        mockSendWithContextStreaming.mockResolvedValue({
            content: [{ type: 'tool_use', id: 'call-1', name: 'fetch_feed', input: { url: 'https://example.com/rss' } }],
            model: 'test-model'
        });
        const taskExecutionManager = (agent as unknown as {
            taskExecutionManager: { executeTask: (request: unknown) => Promise<unknown>; cancelCurrentTask: (reason: string) => void };
        }).taskExecutionManager;
        jest.spyOn(agent, 'executeTool').mockImplementation(async () => {
            taskExecutionManager.cancelCurrentTask('consumer disconnected');
            return { content: { type: 'text', text: '<rss/>' } };
        });

        await expect(taskExecutionManager.executeTask({
            taskId: 'task-2',
            fromAgentId: 'requester',
            toAgentId: 'test-agent',
            title: 'Fetch',
            description: 'Fetch the feed',
            content: 'Fetch the feed'
        })).resolves.toBeDefined();

        const storedRoles = mockAddConversationMessage.mock.calls.map(call => (call[0] as { role: string }).role);
        expect(storedRoles).toContain('assistant');
        expect(storedRoles).not.toContain('tool');
        expect((EventBus.client.emitOn as jest.Mock).mock.calls.filter(call => call[1] === Events.Agent.ERROR)).toHaveLength(0);
        expect(mockLoggerError).not.toHaveBeenCalled();
    });
    it('keeps a genuine socket drop mid-task loud: the failure is reported, not ended quietly', async () => {
        // Only an explicit disconnect() is quiet. A transient drop (auto-reconnect
        // follows) must still surface, or an unfinished task sits in_progress with
        // no signal to anyone — the bug TaskHandlers already fixed once.
        const agent = new MxfAgent({ ...CONFIG });
        mockSendWithContextStreaming.mockResolvedValue(textResponse);
        mockAddConversationMessage.mockImplementation(async () => {
            (EventBus.client.isRegisteredSocketConnected as jest.Mock).mockReturnValue(false);
            throw new Error("Cannot start memory operation op-2: agent socket 'test-agent' is not connected");
        });
        const taskExecutionManager = (agent as unknown as {
            taskExecutionManager: { executeTask: (request: unknown) => Promise<unknown> };
        }).taskExecutionManager;

        await expect(taskExecutionManager.executeTask({
            taskId: 'task-3',
            fromAgentId: 'requester',
            toAgentId: 'test-agent',
            title: 'Classify',
            description: 'Classify the feed',
            content: 'Classify the feed'
        })).rejects.toThrow('not connected');

        const agentErrors = (EventBus.client.emitOn as jest.Mock).mock.calls.filter(call => call[1] === Events.Agent.ERROR);
        expect(agentErrors).toHaveLength(1);
        expect(mockLoggerError).toHaveBeenCalled();
    });

    it('stores the real task_complete result when disconnect() cancelled the task during the call', async () => {
        // The consumer's task:completed listener fires while task_complete's own
        // round trip is still outstanding; disconnect() cancels the task before
        // the result returns. That result is the genuine, first completion —
        // not a duplicate — and must be stored as such.
        const agent = new MxfAgent({ ...CONFIG });
        mockSendWithContextStreaming.mockResolvedValue({
            content: [{ type: 'tool_use', id: 'call-2', name: 'task_complete', input: { summary: 'Classified 12 items' } }],
            model: 'test-model'
        });
        jest.spyOn(agent, 'executeTool').mockImplementation(async () => {
            await agent.disconnect();
            return { status: 'task_completed', message: 'Task completed successfully: Classified 12 items', taskId: 'task-4' };
        });
        const taskExecutionManager = (agent as unknown as {
            taskExecutionManager: { executeTask: (request: unknown) => Promise<unknown> };
        }).taskExecutionManager;

        await expect(taskExecutionManager.executeTask({
            taskId: 'task-4',
            fromAgentId: 'requester',
            toAgentId: 'test-agent',
            title: 'Classify',
            description: 'Classify the feed',
            content: 'Classify the feed'
        })).resolves.toBeDefined();

        const toolMessages = mockAddConversationMessage.mock.calls
            .map(call => call[0] as { role: string; content: string })
            .filter(message => message.role === 'tool');
        expect(toolMessages).toHaveLength(1);
        expect(toolMessages[0].content).not.toContain('Duplicate task_complete');
        expect(toolMessages[0].content).toContain('Classified 12 items');
        expect(mockLoggerError).not.toHaveBeenCalled();
    });

    it('rejects overlapping admission before adding its prompt or changing task identity', async () => {
        const agent = new MxfAgent({ ...CONFIG });
        const manager = (agent as unknown as { taskExecutionManager: MxfTaskExecutionManager }).taskExecutionManager;
        let releasePreparation!: () => void;
        mockAddConversationMessage.mockImplementationOnce(() => new Promise<void>(resolve => { releasePreparation = resolve; }));
        const first = manager.executeTask({ taskId: 'task-A', content: 'First task' });
        await expect(manager.executeTask({ taskId: 'task-B', content: 'Second task' })).rejects.toThrow('already executing task task-A');
        expect(manager.getCurrentTask()?.taskId).toBe('task-A');
        expect(mockAddConversationMessage).toHaveBeenCalledTimes(1);
        expect(mockAddConversationMessage.mock.calls[0][0].content).toContain('First task');
        manager.cancelCurrentTask('test finished');
        releasePreparation();
        await first;
        expect(mockSendWithContextStreaming).not.toHaveBeenCalled();
    });

    it('discards a stopped task response and drains it before preparing the next task', async () => {
        const agent = new MxfAgent({ ...CONFIG });
        const manager = (agent as unknown as { taskExecutionManager: MxfTaskExecutionManager }).taskExecutionManager;
        let releaseFirst!: (response: unknown) => void;
        let reachedProvider!: () => void;
        const providerStarted = new Promise<void>(resolve => { reachedProvider = resolve; });
        mockSendWithContextStreaming.mockImplementationOnce(() => {
            reachedProvider();
            return new Promise(resolve => { releaseFirst = resolve; });
        }).mockResolvedValueOnce({
            content: [{ type: 'tool_use', id: 'call-B', name: 'task_complete', input: { summary: 'Second finished' } }],
            model: 'test-model'
        });
        const execute = jest.spyOn(agent, 'executeTool').mockImplementation(async () => {
            manager.clearCurrentTask('completed');
            return { status: 'task_completed', taskId: 'task-B', message: 'Second finished' };
        });
        const first = manager.executeTask({ taskId: 'task-A', content: 'First task' });
        await providerStarted;
        manager.cancelCurrentTask('cancelled by consumer');
        const second = manager.executeTask({ taskId: 'task-B', content: 'Second task' });
        expect(manager.getCurrentTask()?.taskId).toBe('task-B');
        expect(mockAddConversationMessage).toHaveBeenCalledTimes(1);
        releaseFirst({
            content: [{ type: 'tool_use', id: 'stale-call', name: 'fetch_feed', input: { url: 'https://example.com/stale' } }],
            model: 'test-model'
        });
        await Promise.all([first, second]);
        expect(execute.mock.calls.map(call => call[0])).toEqual(['task_complete']);
        expect(mockSendWithContextStreaming).toHaveBeenCalledTimes(2);
        const history = JSON.stringify(mockAddConversationMessage.mock.calls);
        expect(history).not.toContain('stale-call');
        expect(history).toContain('Second task');
        expect(history).toContain('Second finished');
        expect(manager.getCurrentTask()).toBeNull();
    });

    it('drains an event-triggered contributor turn before preparing the next task', async () => {
        const agent = new MxfAgent({ ...CONFIG, maxIterations: 1 });
        const manager = agent.getTaskExecutionManager();
        const internal = agent as unknown as {
            provideImmediateToolFeedback(from: string, tool: string, data: string, type: string): Promise<string>;
        };
        let releaseFeedback!: (response: unknown) => void;
        let reachedFeedbackProvider!: () => void;
        const feedbackProviderStarted = new Promise<void>(resolve => { reachedFeedbackProvider = resolve; });
        mockSendWithContextStreaming.mockReset()
            .mockResolvedValueOnce(textResponse)
            .mockImplementationOnce(() => {
                reachedFeedbackProvider();
                return new Promise(resolve => { releaseFeedback = resolve; });
            })
            .mockResolvedValueOnce({
                content: [{ type: 'tool_use', id: 'call-B', name: 'task_complete', input: { summary: 'Second finished' } }],
                model: 'test-model'
            });
        const execute = jest.spyOn(agent, 'executeTool').mockImplementation(async () => {
            manager.clearCurrentTask('completed');
            return { status: 'task_completed', taskId: 'task-B', message: 'Second finished' };
        });

        // A contributor stays available for messages after its assigned loop ends.
        await manager.executeTask({ taskId: 'task-A', content: 'First task', completionAgentId: 'peer' });
        expect(manager.getCurrentTask()?.taskId).toBe('task-A');
        expect(mockSendWithContextStreaming).toHaveBeenCalledTimes(1);
        const feedback = internal.provideImmediateToolFeedback('peer', 'messaging_send', 'Continue task A', 'agent message');
        const feedbackOutcome = Promise.allSettled([feedback]);
        await Promise.race([
            feedbackProviderStarted,
            feedback.then(() => { throw new Error('Feedback returned before reaching its provider'); })
        ]);

        manager.clearCurrentTask('completed by peer');
        const second = manager.executeTask({ taskId: 'task-B', content: 'Second task' });
        const secondOutcome = Promise.allSettled([second]);
        let historyBeforeRelease: string;
        try {
            // Let B reach preparation while A's message-triggered provider stays pending.
            await new Promise<void>(resolve => { setImmediate(resolve); });
            historyBeforeRelease = JSON.stringify(mockAddConversationMessage.mock.calls);
            expect(manager.getCurrentTask()?.taskId).toBe('task-B');
        } finally {
            releaseFeedback({
                content: [{ type: 'tool_use', id: 'stale-feedback-call', name: 'fetch_feed', input: {} }],
                model: 'test-model'
            });
            await Promise.all([feedbackOutcome, secondOutcome]);
        }

        expect(historyBeforeRelease).not.toContain('Second task');
        expect((await feedbackOutcome)[0].status).toBe('fulfilled');
        expect((await secondOutcome)[0].status).toBe('fulfilled');
        expect(mockSendWithContextStreaming).toHaveBeenCalledTimes(3);
        expect(execute.mock.calls.map(call => call[0])).toEqual(['task_complete']);
        const history = JSON.stringify(mockAddConversationMessage.mock.calls);
        expect(history).not.toContain('stale-feedback-call');
        expect(history).toContain('Second task');
        expect(history).toContain('Second finished');
        expect(manager.getCurrentTask()).toBeNull();
    });

    it('keeps feedback from starting the first turn while assigned task preparation is pending', async () => {
        const agent = new MxfAgent({ ...CONFIG, maxIterations: 1 });
        const manager = agent.getTaskExecutionManager();
        const internal = agent as unknown as {
            provideImmediateToolFeedback(from: string, tool: string, data: string, type: string): Promise<string>;
        };
        let releasePreparation!: () => void;
        mockAddConversationMessage.mockImplementationOnce(() => new Promise<void>(resolve => { releasePreparation = resolve; }));
        mockSendWithContextStreaming.mockReset().mockResolvedValue({
            content: [{ type: 'tool_use', id: 'prepared-call', name: 'task_complete', input: { summary: 'Prepared task finished' } }],
            model: 'test-model'
        });
        const execute = jest.spyOn(agent, 'executeTool').mockImplementation(async () => {
            manager.clearCurrentTask('completed');
            return { status: 'task_completed', taskId: 'task-B', message: 'Prepared task finished' };
        });
        const assigned = manager.executeTask({ taskId: 'task-B', content: 'Second task' });
        const assignedOutcome = Promise.allSettled([assigned]);
        const feedback = internal.provideImmediateToolFeedback('peer', 'messaging_send', 'Message during preparation', 'agent message');
        const feedbackOutcome = Promise.allSettled([feedback]);
        let providerCallsBeforePreparation: number;
        try {
            await feedback;
            providerCallsBeforePreparation = mockSendWithContextStreaming.mock.calls.length;
        } finally {
            releasePreparation();
            await Promise.all([assignedOutcome, feedbackOutcome]);
        }

        expect(providerCallsBeforePreparation).toBe(0);
        expect((await assignedOutcome)[0].status).toBe('fulfilled');
        expect(mockSendWithContextStreaming).toHaveBeenCalledTimes(1);
        expect(agent.getSystemPromptManager().updatePromptForTask).toHaveBeenCalledWith(expect.objectContaining({ id: 'task-B' }));
        expect(execute.mock.calls.map(call => call[0])).toEqual(['task_complete']);
        expect(JSON.stringify(mockAddConversationMessage.mock.calls)).toContain('Prepared task finished');
        expect(manager.getCurrentTask()).toBeNull();
    });

    it('does not let a late completion result clear or append to a newer task', async () => {
        const agent = new MxfAgent({ ...CONFIG });
        const manager = (agent as unknown as { taskExecutionManager: MxfTaskExecutionManager }).taskExecutionManager;
        mockSendWithContextStreaming.mockResolvedValue({
            content: [{ type: 'tool_use', id: 'completion-call', name: 'task_complete', input: { summary: 'Done' } }],
            model: 'test-model'
        });
        let second!: Promise<unknown>;
        let callsToComplete = 0;
        jest.spyOn(agent, 'executeTool').mockImplementation(async () => {
            callsToComplete++;
            if (callsToComplete === 1) {
                manager.clearCurrentTask('completed');
                second = manager.executeTask({ taskId: 'task-B', content: 'Second task' });
                return { status: 'task_completed', taskId: 'task-A', message: 'Old completion' };
            }
            expect(manager.getCurrentTask()?.taskId).toBe('task-B');
            manager.clearCurrentTask('completed');
            return { status: 'task_completed', taskId: 'task-B', message: 'New completion' };
        });
        await manager.executeTask({ taskId: 'task-A', content: 'First task' });
        await second;
        expect(callsToComplete).toBe(2);
        const toolMessages = mockAddConversationMessage.mock.calls.map(call => call[0]).filter(message => message.role === 'tool');
        expect(toolMessages).toHaveLength(1);
        expect(toolMessages[0].content).toContain('New completion');
        expect(toolMessages[0].content).not.toContain('Old completion');
    });


    it('refreshes the real prompt manager when the accepted request uses taskId', async () => {
        const agent = new MxfAgent({ ...CONFIG });
        const { MxfSystemPromptManager: RealPromptManager } = jest.requireActual<typeof import('@mxf-dev/sdk/managers/MxfSystemPromptManager')>('@mxf-dev/sdk/managers/MxfSystemPromptManager');
        const update = jest.fn().mockResolvedValue(undefined);
        const framework = jest.spyOn(MxfAgentSystemPrompt, 'buildFrameworkSystemPrompt')
            .mockResolvedValue('Framework prompt for current tools');
        const real = new RealPromptManager(CONFIG.agentId, CONFIG, {
            getConversationHistory: (): Array<{ id: string; role: 'system'; content: string; timestamp: number }> => [{ id: 'system', role: 'system', content: 'old prompt', timestamp: 1 }],
            updateConversationMessage: update,
            getCachedTools: (): typeof cachedTools => cachedTools
        });
        jest.spyOn(agent.getSystemPromptManager(), 'updatePromptForTask').mockImplementation(task => real.updatePromptForTask(task));
        const manager = agent.getTaskExecutionManager();
        mockSendWithContextStreaming.mockImplementation(async () => {
            manager.cancelCurrentTask('finished checking prompt');
            return textResponse;
        });
        try {
            await manager.executeTask({ taskId: 'accepted-task', title: 'Current review', content: 'Review the evidence' });
            expect(update).toHaveBeenCalledWith(0, expect.objectContaining({
                role: 'system', content: expect.stringContaining('Framework prompt for current tools')
            }));
        } finally {
            framework.mockRestore();
        }
    });

    it('retains task context without accumulating system messages across session reconnects', async () => {
        const agent = new MxfAgent({ ...CONFIG, memoryMode: 'session' });
        const { MxfMemoryManager: RealMemoryManager } = jest.requireActual<typeof import('@mxf-dev/sdk/managers/MxfMemoryManager')>('@mxf-dev/sdk/managers/MxfMemoryManager');
        const memory = new RealMemoryManager({
            agentId: CONFIG.agentId, channelId: CONFIG.channelId,
            maxHistory: 5, maxObservations: 5, enablePersistence: false, memoryMode: 'session'
        });
        const internal = agent as unknown as {
            memoryManager: typeof memory;
            performAgentInitialization(): Promise<void>;
        };
        internal.memoryManager = memory;
        await internal.performAgentInitialization();
        await memory.addConversationMessage({ role: 'user', content: 'Keep this session context' });
        for (let reconnect = 0; reconnect < 12; reconnect++) {
            await internal.performAgentInitialization();
        }
        const history = memory.getConversationHistory();
        expect(history.filter(message => message.role === 'system')).toHaveLength(1);
        expect(history.some(message => message.content === 'Keep this session context')).toBe(true);
        expect(history.length).toBeLessThanOrEqual(5);
        await agent.disconnect();
    });

    it('does not resume an aggregated response against a newer task', async () => {
        const agent = new MxfAgent({ ...CONFIG });
        const manager = agent.getTaskExecutionManager();
        // Keep both task executions in preparation so this exercises the separate
        // aggregation entry path without a provider response taking ownership.
        let releaseFirst!: () => void;
        let releaseBatch!: () => void;
        mockAddConversationMessage
            .mockImplementationOnce(() => new Promise<void>(resolve => { releaseFirst = resolve; }))
            .mockImplementationOnce(() => new Promise<void>(resolve => { releaseBatch = resolve; }));
        const first = manager.executeTask({ taskId: 'task-A', title: 'First', content: 'First task' });
        const internal = agent as unknown as { handleAggregatedMessage(from: string[], content: string): Promise<void> };
        const batch = internal.handleAggregatedMessage(['peer'], 'Old task message');
        manager.cancelCurrentTask('cancelled');
        const second = manager.executeTask({ taskId: 'task-B', title: 'Second', content: 'Second task' });
        releaseBatch();
        await batch;
        expect(mockSendWithContextStreaming).not.toHaveBeenCalled();
        manager.cancelCurrentTask('test done');
        releaseFirst();
        await Promise.all([first, second]);
    });

});
