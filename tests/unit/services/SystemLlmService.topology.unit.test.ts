type EventHandler = (payload: unknown) => unknown;

const mockListeners = new Map<string, Set<EventHandler>>();
const mockIsChannelSystemLlmEnabled = jest.fn();

const mockServerEventBus = {
    on: jest.fn((event: string, handler: EventHandler) => {
        const handlers = mockListeners.get(event) ?? new Set<EventHandler>();
        handlers.add(handler);
        mockListeners.set(event, handlers);

        let closed = false;
        return {
            get closed(): boolean {
                return closed;
            },
            unsubscribe: jest.fn(() => {
                if (closed) return;
                closed = true;
                handlers.delete(handler);
                if (handlers.size === 0) {
                    mockListeners.delete(event);
                }
            })
        };
    }),
    off: jest.fn((event: string, handler?: EventHandler) => {
        if (!handler) {
            mockListeners.delete(event);
            return;
        }

        const handlers = mockListeners.get(event);
        handlers?.delete(handler);
        if (handlers?.size === 0) {
            mockListeners.delete(event);
        }
    }),
    emit: jest.fn()
};

jest.mock('@mxf-dev/core/events/EventBus', () => ({
    EventBus: { server: mockServerEventBus }
}));

jest.mock('@mxf-dev/core/config/ConfigManager', () => ({
    ConfigEvents: {
        CHANNEL_SYSTEM_LLM_CHANGED: 'config:channel_system_llm_changed'
    },
    ConfigManager: {
        getInstance: (): { isChannelSystemLlmEnabled: typeof mockIsChannelSystemLlmEnabled } => ({
            isChannelSystemLlmEnabled: mockIsChannelSystemLlmEnabled
        })
    }
}));

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

jest.mock('../../../src/server/socket/services/SystemLlmBudgetService', () => ({
    SystemLlmBudgetService: {
        getInstance: (): {
            isExhausted: () => boolean;
            getStatus: () => { spentUsd: number; limitUsd: null; exhausted: boolean };
            assertWithinBudget: (model: string) => void;
            recordUsage: (
                model: string,
                usage: { inputTokens: number; outputTokens: number }
            ) => void;
        } => ({
            isExhausted: (): boolean => false,
            getStatus: (): { spentUsd: number; limitUsd: null; exhausted: boolean } => ({
                spentUsd: 0,
                limitUsd: null,
                exhausted: false
            }),
            assertWithinBudget: jest.fn(),
            recordUsage: jest.fn()
        })
    }
}));

jest.mock('../../../src/server/socket/services/ChannelService', () => ({
    ChannelService: { getInstance: jest.fn() }
}));

jest.mock('../../../src/server/socket/services/AgentService', () => ({
    AgentService: { getInstance: jest.fn() }
}));

import { Events } from '@mxf-dev/core/events/EventNames';
import { ConfigEvents } from '@mxf-dev/core/config/ConfigManager';
import { LlmProviderType } from '@mxf-dev/core/protocols/mcp/LlmProviders';
import { SystemLlmService } from '../../../src/server/socket/services/SystemLlmService';
import { SystemLlmServiceManager } from '../../../src/server/socket/services/SystemLlmServiceManager';

interface SystemLlmServiceInternals {
    updateChannelActivity: (channelId: string, message: unknown) => Promise<void>;
    detectCoordinationTrigger: (channelId: string) => Promise<string | null>;
    generateAndInjectCoordinationSuggestion: (
        channelId: string,
        triggerType: string,
        message: unknown,
        agentId?: string
    ) => Promise<void>;
    analyzeChannelForCoordination: (channelId: string) => Promise<unknown>;
    generateCoordinationSuggestionContent: (
        triggerType: string,
        analysis: unknown,
        activity: unknown,
        message: unknown,
        lifecycleGeneration: number
    ) => Promise<string | null>;
    initClient: () => Promise<{ sendMessage: jest.Mock }>;
    sendLlmRequestInternal: (...args: unknown[]) => Promise<string>;
    sendLlmRequestWithRecovery: (...args: unknown[]) => Promise<string>;
    lifecycleGeneration: number;
    channelActivities: Map<string, unknown>;
    channelCoordinationLocks: Map<string, number>;
    coordinationInProgress: Set<string>;
    activeContexts: Map<string, unknown>;
}

/** Explicit config must name its model: the service has no built-in one. */
const TEST_MODEL = '~anthropic/claude-haiku-latest';

const CHANNEL_A = 'channel-a';
const CHANNEL_B = 'channel-b';
const CHANNEL_WITHOUT_SERVICE = 'channel-c';

const serviceInternals = (service: SystemLlmService): SystemLlmServiceInternals =>
    service as unknown as SystemLlmServiceInternals;

const resetManagerSingleton = (): void => {
    (SystemLlmServiceManager as unknown as { instance?: SystemLlmServiceManager }).instance = undefined;
};

const listenerCount = (event: string): number => mockListeners.get(event)?.size ?? 0;

const dispatch = async (event: string, payload: unknown): Promise<void> => {
    const handlers = Array.from(mockListeners.get(event) ?? []);
    await Promise.all(handlers.map(handler => Promise.resolve(handler(payload))));
};

const deferred = <T>(): {
    promise: Promise<T>;
    resolve: (value: T) => void;
    reject: (reason?: unknown) => void;
} => {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
};

const messagePayload = (channelId: string, senderId: string): Record<string, unknown> => ({
    channelId,
    agentId: senderId,
    data: {
        message: {
            senderId,
            content: `message in ${channelId}`,
            timestamp: Date.now()
        }
    }
});

const orparPayload = (channelId: string): Record<string, unknown> => ({
    channelId,
    agentId: `agent-${channelId}`,
    data: {}
});

const configPayload = (channelId: string, enabled: boolean): Record<string, unknown> => ({
    channelId,
    agentId: 'config-manager',
    data: {
        channelId,
        enabled,
        timestamp: Date.now()
    }
});

describe('SystemLlmService per-channel topology and lifecycle', () => {
    let manager: SystemLlmServiceManager;
    let channelEnabled: Map<string, boolean>;
    const previousSystemLlmEnabled = process.env.SYSTEMLLM_ENABLED;

    beforeAll(() => {
        jest.useFakeTimers();
    });

    beforeEach(() => {
        mockListeners.clear();
        jest.clearAllMocks();
        channelEnabled = new Map<string, boolean>();
        mockIsChannelSystemLlmEnabled.mockImplementation((channelId?: string) =>
            channelId ? (channelEnabled.get(channelId) ?? true) : true
        );
        process.env.SYSTEMLLM_ENABLED = 'true';
        resetManagerSingleton();
        manager = SystemLlmServiceManager.getInstance({
            defaultModel: TEST_MODEL,
            enableRealTimeCoordination: true
        });
    });

    afterEach(() => {
        manager.shutdown();
        resetManagerSingleton();
        mockListeners.clear();
        jest.clearAllTimers();
    });

    afterAll(() => {
        jest.useRealTimers();
        if (previousSystemLlmEnabled === undefined) {
            delete process.env.SYSTEMLLM_ENABLED;
        } else {
            process.env.SYSTEMLLM_ENABLED = previousSystemLlmEnabled;
        }
    });

    const createServices = (): [SystemLlmService, SystemLlmService] => {
        const serviceA = manager.getServiceForChannel(CHANNEL_A);
        const serviceB = manager.getServiceForChannel(CHANNEL_B);
        expect(serviceA).not.toBeNull();
        expect(serviceB).not.toBeNull();
        return [serviceA!, serviceB!];
    };

    it('binds each managed service to one owner and processes each channel message exactly once', async () => {
        const [serviceA, serviceB] = createServices();
        expect(serviceA.ownerChannelId).toBe(CHANNEL_A);
        expect(serviceB.ownerChannelId).toBe(CHANNEL_B);

        const updateA = jest.spyOn(serviceInternals(serviceA), 'updateChannelActivity').mockResolvedValue(undefined);
        const updateB = jest.spyOn(serviceInternals(serviceB), 'updateChannelActivity').mockResolvedValue(undefined);
        jest.spyOn(serviceInternals(serviceA), 'detectCoordinationTrigger').mockResolvedValue(null);
        jest.spyOn(serviceInternals(serviceB), 'detectCoordinationTrigger').mockResolvedValue(null);

        await dispatch(
            Events.Message.AGENT_MESSAGE_DELIVERED,
            messagePayload(CHANNEL_A, 'agent-a')
        );
        await dispatch(
            Events.Message.AGENT_MESSAGE_DELIVERED,
            messagePayload(CHANNEL_B, 'agent-b')
        );

        expect(updateA).toHaveBeenCalledTimes(1);
        expect(updateA).toHaveBeenCalledWith(CHANNEL_A, expect.objectContaining({ senderId: 'agent-a' }));
        expect(updateB).toHaveBeenCalledTimes(1);
        expect(updateB).toHaveBeenCalledWith(CHANNEL_B, expect.objectContaining({ senderId: 'agent-b' }));
    });

    it('refuses direct provider requests after the owner channel is disabled', async () => {
        const service = manager.getServiceForChannel(CHANNEL_A);
        expect(service).not.toBeNull();
        const recovery = jest.spyOn(
            serviceInternals(service!),
            'sendLlmRequestWithRecovery'
        ).mockResolvedValue('must not be returned');

        channelEnabled.set(CHANNEL_A, false);

        await expect(service!.sendLlmRequest('must not reach the provider'))
            .rejects.toThrow(`SystemLLM is disabled for channel ${CHANNEL_A}`);
        expect(recovery).not.toHaveBeenCalled();
    });

    it('routes ORPAR coordination only to the service that owns the event channel', async () => {
        const [serviceA, serviceB] = createServices();
        const injectA = jest.spyOn(
            serviceInternals(serviceA),
            'generateAndInjectCoordinationSuggestion'
        ).mockResolvedValue(undefined);
        const injectB = jest.spyOn(
            serviceInternals(serviceB),
            'generateAndInjectCoordinationSuggestion'
        ).mockResolvedValue(undefined);

        await dispatch(Events.ControlLoop.REASONING, orparPayload(CHANNEL_A));
        await dispatch(Events.ControlLoop.PLAN, orparPayload(CHANNEL_B));

        expect(injectA).toHaveBeenCalledTimes(1);
        expect(injectA).toHaveBeenCalledWith(
            CHANNEL_A,
            'orpar_context',
            null,
            `agent-${CHANNEL_A}`
        );
        expect(injectB).toHaveBeenCalledTimes(1);
        expect(injectB).toHaveBeenCalledWith(
            CHANNEL_B,
            'orpar_context',
            null,
            `agent-${CHANNEL_B}`
        );
    });

    it('does no state or LLM work for a channel with no owning service', async () => {
        const [serviceA, serviceB] = createServices();
        const updateA = jest.spyOn(serviceInternals(serviceA), 'updateChannelActivity');
        const updateB = jest.spyOn(serviceInternals(serviceB), 'updateChannelActivity');
        const injectA = jest.spyOn(serviceInternals(serviceA), 'generateAndInjectCoordinationSuggestion');
        const injectB = jest.spyOn(serviceInternals(serviceB), 'generateAndInjectCoordinationSuggestion');
        mockIsChannelSystemLlmEnabled.mockClear();

        await dispatch(
            Events.Message.AGENT_MESSAGE_DELIVERED,
            messagePayload(CHANNEL_WITHOUT_SERVICE, 'agent-c')
        );
        await dispatch(
            Events.ControlLoop.ACTION,
            orparPayload(CHANNEL_WITHOUT_SERVICE)
        );

        expect(updateA).not.toHaveBeenCalled();
        expect(updateB).not.toHaveBeenCalled();
        expect(injectA).not.toHaveBeenCalled();
        expect(injectB).not.toHaveBeenCalled();
        expect(mockIsChannelSystemLlmEnabled).not.toHaveBeenCalled();
    });

    it('rejects a direct call for a channel the service does not own', async () => {
        const service = manager.getServiceForChannel(CHANNEL_A)!;
        const internals = serviceInternals(service);
        mockIsChannelSystemLlmEnabled.mockClear();

        expect(() => service.createOrUpdateContext(
            'cycle-b',
            'agent-b',
            CHANNEL_B,
            'observation'
        )).toThrow(`cannot operate on channel ${CHANNEL_B}`);
        await expect(service.analyzeChannelForCoordination(CHANNEL_B)).rejects.toThrow(
            `cannot operate on channel ${CHANNEL_B}`
        );

        expect(internals.activeContexts.size).toBe(0);
        expect(mockIsChannelSystemLlmEnabled).not.toHaveBeenCalled();
    });

    it('applies a channel config change only to that channel without duplicate listeners', async () => {
        const [serviceA, serviceB] = createServices();
        expect(serviceA.getCoordinationStats().initialized).toBe(true);
        expect(serviceB.getCoordinationStats().initialized).toBe(true);

        channelEnabled.set(CHANNEL_A, false);
        mockIsChannelSystemLlmEnabled.mockClear();
        await dispatch(
            ConfigEvents.CHANNEL_SYSTEM_LLM_CHANGED,
            configPayload(CHANNEL_A, false)
        );

        expect(serviceA.getCoordinationStats().initialized).toBe(false);
        expect(serviceB.getCoordinationStats().initialized).toBe(true);
        expect(mockIsChannelSystemLlmEnabled).toHaveBeenCalledTimes(1);
        expect(mockIsChannelSystemLlmEnabled).toHaveBeenCalledWith(CHANNEL_A, 'coordination');
        expect(listenerCount(Events.Message.AGENT_MESSAGE_DELIVERED)).toBe(1);

        channelEnabled.set(CHANNEL_A, true);
        await dispatch(
            ConfigEvents.CHANNEL_SYSTEM_LLM_CHANGED,
            configPayload(CHANNEL_A, true)
        );

        expect(serviceA.getCoordinationStats().initialized).toBe(true);
        expect(serviceB.getCoordinationStats().initialized).toBe(true);
        expect(listenerCount(Events.Message.AGENT_MESSAGE_DELIVERED)).toBe(2);
        expect(listenerCount(Events.ControlLoop.REASONING)).toBe(2);

        const updateA = jest.spyOn(serviceInternals(serviceA), 'updateChannelActivity').mockResolvedValue(undefined);
        const updateB = jest.spyOn(serviceInternals(serviceB), 'updateChannelActivity').mockResolvedValue(undefined);
        jest.spyOn(serviceInternals(serviceA), 'detectCoordinationTrigger').mockResolvedValue(null);
        jest.spyOn(serviceInternals(serviceB), 'detectCoordinationTrigger').mockResolvedValue(null);

        await dispatch(
            Events.Message.AGENT_MESSAGE_DELIVERED,
            messagePayload(CHANNEL_A, 'agent-a')
        );

        expect(updateA).toHaveBeenCalledTimes(1);
        expect(updateB).not.toHaveBeenCalled();
    });

    it('remove and clear call cleanup and release every service-owned listener', async () => {
        const [serviceA, serviceB] = createServices();
        const cleanupA = jest.spyOn(serviceA, 'cleanupAll');
        const cleanupB = jest.spyOn(serviceB, 'cleanupAll');
        const updateA = jest.spyOn(serviceInternals(serviceA), 'updateChannelActivity');
        const updateB = jest.spyOn(serviceInternals(serviceB), 'updateChannelActivity');

        expect(listenerCount(ConfigEvents.CHANNEL_SYSTEM_LLM_CHANGED)).toBe(2);
        expect(listenerCount(Events.Message.AGENT_MESSAGE_DELIVERED)).toBe(2);

        manager.removeServiceForChannel(CHANNEL_A);

        expect(cleanupA).toHaveBeenCalledTimes(1);
        expect(manager.hasService(CHANNEL_A)).toBe(false);
        expect(listenerCount(ConfigEvents.CHANNEL_SYSTEM_LLM_CHANGED)).toBe(1);
        expect(listenerCount(Events.Message.AGENT_MESSAGE_DELIVERED)).toBe(1);
        expect(listenerCount(Events.ControlLoop.REASONING)).toBe(1);

        await dispatch(
            Events.Message.AGENT_MESSAGE_DELIVERED,
            messagePayload(CHANNEL_A, 'agent-a')
        );
        expect(updateA).not.toHaveBeenCalled();

        manager.clearAll();

        expect(cleanupB).toHaveBeenCalledTimes(1);
        expect(manager.getStats().totalInstances).toBe(0);
        expect(listenerCount(ConfigEvents.CHANNEL_SYSTEM_LLM_CHANGED)).toBe(0);
        expect(listenerCount(Events.Message.AGENT_MESSAGE_DELIVERED)).toBe(0);
        expect(listenerCount(Events.ControlLoop.REASONING)).toBe(0);
        expect(listenerCount(Events.ControlLoop.PLAN)).toBe(0);
        expect(listenerCount(Events.ControlLoop.ACTION)).toBe(0);

        await dispatch(
            Events.Message.AGENT_MESSAGE_DELIVERED,
            messagePayload(CHANNEL_B, 'agent-b')
        );
        expect(updateB).not.toHaveBeenCalled();

        // Lifecycle teardown is idempotent.
        expect(() => manager.clearAll()).not.toThrow();
    });

    it('owns manager subscriptions and delayed cleanup timers across shutdown and reinitialization', async () => {
        manager.getServiceForChannel(CHANNEL_A);
        expect(listenerCount(Events.Channel.DELETED)).toBe(1);
        expect(listenerCount(Events.Channel.ARCHIVED)).toBe(1);
        expect(listenerCount(Events.Channel.AGENT_LEFT)).toBe(1);

        const timersBeforeAgentLeft = jest.getTimerCount();
        await dispatch(Events.Channel.AGENT_LEFT, {
            channelId: CHANNEL_A,
            data: { metadata: { remainingAgents: 0 } }
        });
        expect(jest.getTimerCount()).toBe(timersBeforeAgentLeft + 1);

        manager.shutdown();
        manager.shutdown();

        expect(jest.getTimerCount()).toBe(0);
        expect(listenerCount(Events.Channel.DELETED)).toBe(0);
        expect(listenerCount(Events.Channel.ARCHIVED)).toBe(0);
        expect(listenerCount(Events.Channel.AGENT_LEFT)).toBe(0);
        expect(() => manager.getServiceForChannel(CHANNEL_A)).toThrow('is shut down');

        const nextManager = SystemLlmServiceManager.getInstance({
            defaultModel: TEST_MODEL,
            enableRealTimeCoordination: true
        });
        expect(nextManager).not.toBe(manager);
        expect(listenerCount(Events.Channel.DELETED)).toBe(1);
        expect(listenerCount(Events.Channel.ARCHIVED)).toBe(1);
        expect(listenerCount(Events.Channel.AGENT_LEFT)).toBe(1);
        nextManager.shutdown();
    });

    it('fails startup configuration instead of silently changing an unknown provider to OpenRouter', () => {
        const previousProvider = process.env.SYSTEMLLM_PROVIDER;
        manager.shutdown();
        process.env.SYSTEMLLM_PROVIDER = 'misspelled-provider';

        try {
            expect(() => SystemLlmServiceManager.getInstance()).toThrow(
                "Unsupported SYSTEMLLM_PROVIDER 'misspelled-provider'"
            );
        } finally {
            if (previousProvider === undefined) {
                delete process.env.SYSTEMLLM_PROVIDER;
            } else {
                process.env.SYSTEMLLM_PROVIDER = previousProvider;
            }
            manager = SystemLlmServiceManager.getInstance({
                defaultModel: TEST_MODEL,
                enableRealTimeCoordination: true
            });
        }
    });

    it('fails startup before channel work when the selected provider credential is absent', () => {
        const previousProvider = process.env.SYSTEMLLM_PROVIDER;
        const previousXaiKey = process.env.XAI_API_KEY;
        const previousEnabled = process.env.SYSTEMLLM_ENABLED;
        manager.shutdown();
        process.env.SYSTEMLLM_ENABLED = 'true';
        process.env.SYSTEMLLM_PROVIDER = 'xai';
        delete process.env.XAI_API_KEY;

        try {
            expect(() => SystemLlmServiceManager.getInstance()).toThrow(
                'Missing required environment variable XAI_API_KEY'
            );
        } finally {
            if (previousProvider === undefined) {
                delete process.env.SYSTEMLLM_PROVIDER;
            } else {
                process.env.SYSTEMLLM_PROVIDER = previousProvider;
            }
            if (previousXaiKey === undefined) {
                delete process.env.XAI_API_KEY;
            } else {
                process.env.XAI_API_KEY = previousXaiKey;
            }
            if (previousEnabled === undefined) {
                delete process.env.SYSTEMLLM_ENABLED;
            } else {
                process.env.SYSTEMLLM_ENABLED = previousEnabled;
            }
            manager = SystemLlmServiceManager.getInstance({
                defaultModel: TEST_MODEL,
                enableRealTimeCoordination: true
            });
        }
    });

    it('rejects embedding work through a stale service reference after removal', async () => {
        const service = manager.getServiceForChannel(CHANNEL_A)!;

        manager.removeServiceForChannel(CHANNEL_A);

        await expect(service.generateEmbedding('must not reach a provider')).rejects.toThrow(
            'SystemLlmService is shutting down'
        );
    });

    it('does not start a provider request when cleanup wins a deferred client initialization race', async () => {
        const service = manager.getServiceForChannel(CHANNEL_A)!;
        const internals = serviceInternals(service);
        const clientInitialization = deferred<{ sendMessage: jest.Mock }>();
        const sendMessage = jest.fn();
        const initialize = jest.spyOn(internals, 'initClient').mockReturnValue(
            clientInitialization.promise
        );

        const request = internals.sendLlmRequestInternal('must not reach the provider');
        await Promise.resolve();
        expect(initialize).toHaveBeenCalledTimes(1);

        service.cleanupAll();
        clientInitialization.resolve({ sendMessage });

        await expect(request).rejects.toThrow('SystemLlmService is shutting down');
        expect(sendMessage).not.toHaveBeenCalled();
    });

    it('cancels an active provider subscription during cleanup', async () => {
        const service = manager.getServiceForChannel(CHANNEL_A)!;
        const internals = serviceInternals(service);
        const unsubscribe = jest.fn();
        const sendMessage = jest.fn(() => ({
            subscribe: jest.fn(() => ({ unsubscribe }))
        }));
        jest.spyOn(internals, 'initClient').mockResolvedValue({ sendMessage });

        const request = internals.sendLlmRequestInternal('cancel the active provider request');
        await Promise.resolve();
        await Promise.resolve();
        expect(sendMessage).toHaveBeenCalledTimes(1);

        service.cleanupAll();

        await expect(request).rejects.toThrow('SystemLlmService is shutting down');
        expect(unsubscribe).toHaveBeenCalledTimes(1);
    });

    it('detaches every service before clearAll invokes re-entrant cleanup code', () => {
        const [serviceA, serviceB] = createServices();
        const originalCleanupA = serviceA.cleanupAll.bind(serviceA);
        const originalCleanupB = serviceB.cleanupAll.bind(serviceB);
        const visibleDuringCleanup: Array<SystemLlmService | undefined> = [];

        jest.spyOn(serviceA, 'cleanupAll').mockImplementation(() => {
            visibleDuringCleanup.push(manager.getService(CHANNEL_A));
            originalCleanupA();
        });
        jest.spyOn(serviceB, 'cleanupAll').mockImplementation(() => {
            visibleDuringCleanup.push(manager.getService(CHANNEL_B));
            originalCleanupB();
        });

        manager.clearAll();

        expect(visibleDuringCleanup).toEqual([undefined, undefined]);
        expect(manager.getStats().totalInstances).toBe(0);
    });

    it('does not reacquire coordination state after cleanup resolves an in-flight trigger check', async () => {
        const service = manager.getServiceForChannel(CHANNEL_A)!;
        const internals = serviceInternals(service);
        const trigger = deferred<string | null>();
        jest.spyOn(internals, 'updateChannelActivity').mockResolvedValue(undefined);
        const detect = jest.spyOn(internals, 'detectCoordinationTrigger').mockReturnValue(trigger.promise);
        const generate = jest.spyOn(internals, 'generateAndInjectCoordinationSuggestion').mockResolvedValue(undefined);

        const dispatched = dispatch(
            Events.Message.AGENT_MESSAGE_DELIVERED,
            messagePayload(CHANNEL_A, 'agent-a')
        );
        await Promise.resolve();
        expect(detect).toHaveBeenCalledTimes(1);

        manager.clearAll();
        trigger.resolve('high_activity');
        await dispatched;

        expect(generate).not.toHaveBeenCalled();
        expect(internals.channelCoordinationLocks.size).toBe(0);
        expect(internals.channelActivities.size).toBe(0);
    });

    it('abandons a deferred coordination analysis without post-cleanup state or timers', async () => {
        const service = manager.getServiceForChannel(CHANNEL_A)!;
        const internals = serviceInternals(service);
        const analysis = deferred<unknown>();
        jest.spyOn(internals, 'detectCoordinationTrigger').mockResolvedValue('high_activity');
        const analyze = jest.spyOn(internals, 'analyzeChannelForCoordination').mockReturnValue(analysis.promise);
        const generateContent = jest.spyOn(internals, 'generateCoordinationSuggestionContent');

        const dispatched = dispatch(
            Events.Message.AGENT_MESSAGE_DELIVERED,
            messagePayload(CHANNEL_A, 'agent-a')
        );
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        expect(analyze).toHaveBeenCalledTimes(1);

        manager.clearAll();
        analysis.resolve({ opportunities: [] });
        await dispatched;

        expect(generateContent).not.toHaveBeenCalled();
        expect(internals.coordinationInProgress.size).toBe(0);
        expect(internals.channelCoordinationLocks.size).toBe(0);
        expect(internals.channelActivities.size).toBe(0);
        expect(jest.getTimerCount()).toBe(0);
    });

    it('cancels a pending coordination timeout during cleanup', async () => {
        const service = manager.getServiceForChannel(CHANNEL_A)!;
        const internals = serviceInternals(service);
        const llmResponse = deferred<string>();
        jest.spyOn(internals, 'sendLlmRequestWithRecovery').mockReturnValue(llmResponse.promise);

        const content = internals.generateCoordinationSuggestionContent(
            'high_activity',
            { opportunities: [] },
            {
                channelId: CHANNEL_A,
                activeAgents: new Set(['agent-a']),
                recentMessages: [],
                messageCount: 1
            },
            null,
            internals.lifecycleGeneration
        );
        await Promise.resolve();

        service.cleanupAll();

        await expect(content).resolves.toBeNull();
        expect(jest.getTimerCount()).toBe(0);

        // Settle the mocked provider work so the test does not retain it. Its
        // result must have no continuation after service cleanup.
        llmResponse.resolve('late response');
        await Promise.resolve();
        expect(mockServerEventBus.emit).not.toHaveBeenCalled();
    });
});

describe('SystemLlmService complexity upgrades', () => {
    const previousSystemLlmEnabled = process.env.SYSTEMLLM_ENABLED;

    beforeEach(() => {
        mockListeners.clear();
        jest.clearAllMocks();
        mockIsChannelSystemLlmEnabled.mockImplementation(() => true);
        process.env.SYSTEMLLM_ENABLED = 'true';
        resetManagerSingleton();
    });

    afterEach(() => {
        SystemLlmServiceManager.getInstance().shutdown();
        resetManagerSingleton();
        if (previousSystemLlmEnabled === undefined) {
            delete process.env.SYSTEMLLM_ENABLED;
        } else {
            process.env.SYSTEMLLM_ENABLED = previousSystemLlmEnabled;
        }
    });

    const serviceWithReasoningModel = (model: string): SystemLlmService => {
        const manager = SystemLlmServiceManager.getInstance({
            defaultModel: TEST_MODEL,
            providerType: LlmProviderType.OPENROUTER,
            enableDynamicModelSelection: true,
            orparModels: { reasoning: model }
        });
        const service = manager.getServiceForChannel(CHANNEL_A);
        expect(service).not.toBeNull();
        return service!;
    };

    it('bases the complexity upgrade on the configured operation model, not the built-in default', () => {
        const service = serviceWithReasoningModel('anthropic/claude-sonnet-4');

        // A pinned release upgrades into the alias families, so a newer release
        // is picked up without editing the table.
        expect(service.getModelForOperationWithComplexity('reasoning', undefined, 'simple')).toBe('anthropic/claude-sonnet-4');
        expect(service.getModelForOperationWithComplexity('reasoning', undefined, 'moderate')).toBe('~anthropic/claude-sonnet-latest');
        expect(service.getModelForOperationWithComplexity('reasoning', undefined, 'complex')).toBe('~anthropic/claude-opus-latest');
    });

    it.each([
        ['~anthropic/claude-haiku-latest', '~anthropic/claude-sonnet-latest', '~anthropic/claude-opus-latest'],
        ['~anthropic/claude-sonnet-latest', '~anthropic/claude-opus-latest', '~anthropic/claude-opus-latest'],
        ['~anthropic/claude-opus-latest', '~anthropic/claude-opus-latest', '~anthropic/claude-opus-latest']
    ])('upgrades %s by complexity within the alias family', (base, moderate, complex) => {
        const service = serviceWithReasoningModel(base);

        expect(service.getModelForOperationWithComplexity('reasoning', undefined, 'simple')).toBe(base);
        expect(service.getModelForOperationWithComplexity('reasoning', undefined, 'moderate')).toBe(moderate);
        expect(service.getModelForOperationWithComplexity('reasoning', undefined, 'complex')).toBe(complex);
    });

});
