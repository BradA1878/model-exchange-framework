type Deferred<T> = {
    promise: Promise<T>;
    resolve: (value: T) => void;
    reject: (reason: Error) => void;
};

const mockDeferred = <T>(): Deferred<T> => {
    let resolve!: (value: T) => void;
    let reject!: (reason: Error) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
};

const mockListeners = new Map<string, Array<(payload: Record<string, unknown>) => void>>();
const mockEmitted: Array<{ eventType: string; payload: Record<string, unknown> }> = [];
const mockInitializeOperations: Array<Deferred<boolean>> = [];
const mockStartOperations: Array<Deferred<boolean>> = [];
const mockStopOperations: Array<Deferred<boolean>> = [];
const mockObservationsByAgent = new Map<string, unknown[]>();

jest.mock('@mxf-dev/core/events/EventBus', () => ({
    EventBus: {
        server: {
            on: jest.fn((
                eventType: string,
                handler: (payload: Record<string, unknown>) => void
            ) => {
                const handlers = mockListeners.get(eventType) ?? [];
                handlers.push(handler);
                mockListeners.set(eventType, handlers);
                return { unsubscribe: jest.fn() };
            }),
            emit: jest.fn((eventType: string, payload: Record<string, unknown>) => {
                mockEmitted.push({ eventType, payload });
            })
        }
    }
}));

jest.mock('../../../src/server/socket/implementations/ControlLoop', () => {
    const { ControlLoopEvents } = jest.requireActual(
        '@mxf-dev/core/events/event-definitions/ControlLoopEvents'
    );

    class MockControlLoop {
        private channelId = '';

        public constructor(
            private readonly agentId: string,
            private readonly loopId: string
        ) {
            mockObservationsByAgent.set(agentId, []);
        }

        public initialize(config: { channelId: string }): Promise<boolean> {
            this.channelId = config.channelId;
            const operation = mockDeferred<boolean>();
            mockInitializeOperations.push(operation);
            return operation.promise.then(
                result => {
                    mockEmitted.push({
                        eventType: ControlLoopEvents.INITIALIZED,
                        payload: { agentId: this.agentId, channelId: this.channelId }
                    });
                    return result;
                },
                error => {
                    mockEmitted.push({
                        eventType: ControlLoopEvents.ERROR,
                        payload: { agentId: this.agentId, channelId: this.channelId }
                    });
                    throw error;
                }
            );
        }

        public start(): Promise<boolean> {
            const operation = mockDeferred<boolean>();
            mockStartOperations.push(operation);
            return operation.promise.then(
                result => {
                    mockEmitted.push({
                        eventType: ControlLoopEvents.STARTED,
                        payload: { agentId: this.agentId, channelId: this.channelId }
                    });
                    return result;
                },
                error => {
                    mockEmitted.push({
                        eventType: ControlLoopEvents.ERROR,
                        payload: { agentId: this.agentId, channelId: this.channelId }
                    });
                    throw error;
                }
            );
        }

        public stop(): Promise<boolean> {
            const operation = mockDeferred<boolean>();
            mockStopOperations.push(operation);
            return operation.promise.then(
                result => {
                    mockEmitted.push({
                        eventType: ControlLoopEvents.STOPPED,
                        payload: { agentId: this.agentId, channelId: this.channelId }
                    });
                    return result;
                },
                error => {
                    mockEmitted.push({
                        eventType: ControlLoopEvents.ERROR,
                        payload: { agentId: this.agentId, channelId: this.channelId }
                    });
                    throw error;
                }
            );
        }

        public reset(config: { channelId: string }): Promise<boolean> {
            return this.initialize(config);
        }

        public getLoopId(): string {
            return this.loopId;
        }

        public addObservation(observation: unknown): Promise<boolean> {
            mockObservationsByAgent.get(this.agentId)?.push(observation);
            return Promise.resolve(true);
        }
    }

    return { ControlLoop: MockControlLoop };
});

jest.mock('../../../src/server/services/PatternMemoryService', () => ({
    PatternMemoryService: {
        getInstance: jest.fn(() => ({
            analyzeSequenceForPatterns: jest.fn(),
            storePattern: jest.fn()
        }))
    }
}));

jest.mock('@mxf-dev/core/services/AgentPerformanceService', () => ({
    AgentPerformanceService: {
        getInstance: jest.fn(() => ({}))
    }
}));

jest.mock('../../../src/server/socket/services/SystemLlmService', () => ({
    SystemLlmService: jest.fn()
}));

jest.mock('../../../src/server/socket/services/SystemLlmServiceManager', () => ({
    SystemLlmServiceManager: jest.fn()
}));

jest.mock('@mxf-dev/core/utils/Logger', () => ({
    Logger: jest.fn(() => ({
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn()
    }))
}));

import { ControlLoopEvents } from '@mxf-dev/core/events/event-definitions/ControlLoopEvents';
import { ControlLoopService } from '../../../src/server/socket/services/ControlLoopService';

const flushPromises = async (): Promise<void> => {
    await Promise.resolve();
    await Promise.resolve();
};

const request = (
    eventType: string,
    agentId: string,
    channelId: string,
    loopId: string,
    data: Record<string, unknown> = {}
): Record<string, unknown> => ({
    eventId: `${eventType}-${agentId}`,
    eventType,
    timestamp: Date.now(),
    agentId,
    channelId,
    source: 'client',
    data: { loopId, ...data }
});

const deliver = (eventType: string, payload: Record<string, unknown>): void => {
    const handler = mockListeners.get(eventType)?.[0];
    expect(handler).toBeDefined();
    handler!(payload);
};

describe('ControlLoopService lifecycle event ownership', () => {
    beforeEach(() => {
        mockListeners.clear();
        mockEmitted.length = 0;
        mockInitializeOperations.length = 0;
        mockStartOperations.length = 0;
        mockStopOperations.length = 0;
        mockObservationsByAgent.clear();
        new ControlLoopService();
    });

    it('emits exactly one INITIALIZED and STARTED after each operation succeeds', async () => {
        const agentId = 'lifecycle-success-agent';
        const channelId = 'lifecycle-channel';
        const loopId = 'lifecycle-loop';

        deliver(
            ControlLoopEvents.INITIALIZE,
            request(ControlLoopEvents.INITIALIZE, agentId, channelId, loopId, {
                config: { loopId }
            })
        );

        expect(mockEmitted).toHaveLength(0);
        mockInitializeOperations[0].resolve(true);
        await flushPromises();

        expect(mockEmitted.filter(event => (
            event.eventType === ControlLoopEvents.INITIALIZED
        ))).toHaveLength(1);
        expect(mockEmitted.filter(event => (
            event.eventType === ControlLoopEvents.STARTED
        ))).toHaveLength(0);

        mockStartOperations[0].resolve(true);
        await flushPromises();

        expect(mockEmitted.filter(event => (
            event.eventType === ControlLoopEvents.INITIALIZED
        ))).toHaveLength(1);
        expect(mockEmitted.filter(event => (
            event.eventType === ControlLoopEvents.STARTED
        ))).toHaveLength(1);
    });

    it('does not manufacture explicit STARTED or STOPPED outcomes before completion', async () => {
        const agentId = 'lifecycle-command-agent';
        const channelId = 'lifecycle-channel';
        const loopId = 'lifecycle-command-loop';

        deliver(
            ControlLoopEvents.INITIALIZE,
            request(ControlLoopEvents.INITIALIZE, agentId, channelId, loopId, {
                config: { loopId }
            })
        );
        mockInitializeOperations[0].resolve(true);
        await flushPromises();
        mockStartOperations[0].resolve(true);
        await flushPromises();
        mockEmitted.length = 0;

        deliver(
            ControlLoopEvents.START_REQUEST,
            request(ControlLoopEvents.START_REQUEST, agentId, channelId, loopId)
        );
        expect(mockEmitted).toHaveLength(0);
        mockStartOperations[1].resolve(true);
        await flushPromises();
        expect(mockEmitted.map(event => event.eventType)).toEqual([
            ControlLoopEvents.STARTED
        ]);

        mockEmitted.length = 0;
        deliver(
            ControlLoopEvents.STOP_REQUEST,
            request(ControlLoopEvents.STOP_REQUEST, agentId, channelId, loopId)
        );
        expect(mockEmitted).toHaveLength(0);
        mockStopOperations[0].resolve(true);
        await flushPromises();
        expect(mockEmitted.map(event => event.eventType)).toEqual([
            ControlLoopEvents.STOPPED
        ]);
    });

    it('accepts only the exact owner/channel/loop observation tuple', async () => {
        const owner = 'observation-owner';
        const ownerChannel = 'observation-channel';
        const loopId = 'observation-loop';
        deliver(
            ControlLoopEvents.INITIALIZE,
            request(ControlLoopEvents.INITIALIZE, owner, ownerChannel, loopId, {
                config: { loopId }
            })
        );

        deliver(
            ControlLoopEvents.OBSERVATION_SUBMIT,
            request(
                ControlLoopEvents.OBSERVATION_SUBMIT,
                'attacker-agent',
                'attacker-channel',
                loopId,
                {
                    observation: { value: 'cross-tenant' },
                    context: { loopOwnerId: owner }
                }
            )
        );
        deliver(
            ControlLoopEvents.OBSERVATION_SUBMIT,
            request(
                ControlLoopEvents.OBSERVATION_SUBMIT,
                owner,
                ownerChannel,
                'wrong-loop',
                { observation: { value: 'wrong-loop' } }
            )
        );
        deliver(
            ControlLoopEvents.OBSERVATION_SUBMIT,
            request(
                ControlLoopEvents.OBSERVATION_SUBMIT,
                owner,
                ownerChannel,
                loopId,
                { observation: { value: 'accepted' } }
            )
        );
        await flushPromises();

        expect(mockObservationsByAgent.get(owner)).toEqual([{ value: 'accepted' }]);
        expect(mockObservationsByAgent.get('attacker-agent')).toBeUndefined();
    });

    it('does not duplicate the implementation-owned ERROR on failure', async () => {
        const agentId = 'lifecycle-failure-agent';
        const channelId = 'lifecycle-channel';
        const loopId = 'lifecycle-failure-loop';

        deliver(
            ControlLoopEvents.INITIALIZE,
            request(ControlLoopEvents.INITIALIZE, agentId, channelId, loopId, {
                config: { loopId }
            })
        );
        mockInitializeOperations[0].reject(new Error('initialization failed'));
        await flushPromises();

        expect(mockEmitted.filter(event => (
            event.eventType === ControlLoopEvents.ERROR
        ))).toHaveLength(1);
    });
});
