import { EventEmitter } from 'events';

const emitted: Array<{ eventType: string; payload: unknown }> = [];

jest.mock('@mxf-dev/core/events/EventBus', () => ({
    EventBus: {
        server: {
            emit: jest.fn((eventType: string, payload: unknown) => {
                emitted.push({ eventType, payload });
            })
        }
    }
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
import { setupControlLoopHandlers } from '../../../src/server/socket/handlers/controlLoopHandlers';

class FakeSocket extends EventEmitter {
    public id = 'socket-control';
}

const AGENT = 'agent-real';
const CHANNEL = 'channel-real';

const requestEnvelope = (
    eventType: string,
    data: Record<string, unknown>
): Record<string, unknown> => ({
    eventId: 'client-event',
    eventType,
    timestamp: 1,
    agentId: AGENT,
    channelId: CHANNEL,
    data
});

describe('control loop socket direction policy', () => {
    let socket: FakeSocket;

    beforeEach(() => {
        emitted.length = 0;
        socket = new FakeSocket();
        setupControlLoopHandlers(socket as never, AGENT, CHANNEL);
    });

    it('installs only reviewed client request listeners', () => {
        expect(socket.listenerCount(ControlLoopEvents.INITIALIZE)).toBe(1);
        expect(socket.listenerCount(ControlLoopEvents.START_REQUEST)).toBe(1);
        expect(socket.listenerCount(ControlLoopEvents.STOP_REQUEST)).toBe(1);
        expect(socket.listenerCount(ControlLoopEvents.OBSERVATION_SUBMIT)).toBe(1);
        expect(socket.listenerCount(ControlLoopEvents.EXECUTION_REQUEST)).toBe(1);
        expect(socket.listenerCount(ControlLoopEvents.PLAN_SUBMIT)).toBe(1);
        expect(socket.listenerCount(ControlLoopEvents.REFLECTION_SUBMIT)).toBe(1);

        [
            ControlLoopEvents.INITIALIZED,
            ControlLoopEvents.STARTED,
            ControlLoopEvents.STOPPED,
            ControlLoopEvents.REASONING,
            ControlLoopEvents.PLAN,
            ControlLoopEvents.EXECUTION,
            ControlLoopEvents.OBSERVATION,
            ControlLoopEvents.ACTION,
            ControlLoopEvents.REFLECTION,
            ControlLoopEvents.ERROR,
            ControlLoopEvents.SYSTEM_LLM_REASONING,
            ControlLoopEvents.SYSTEM_LLM_REASONING_COMPLETED,
            ControlLoopEvents.SYSTEM_LLM_REASONING_FAILED
        ].forEach(eventType => {
            expect(socket.listenerCount(eventType)).toBe(0);
        });
    });

    it('rebuilds a valid request with authenticated socket identity', () => {
        const request = requestEnvelope(ControlLoopEvents.OBSERVATION_SUBMIT, {
            loopId: 'loop-1',
            observation: { text: 'observed' },
            context: { loopOwnerId: 'victim-agent', note: 'preserved' }
        });

        socket.emit(ControlLoopEvents.OBSERVATION_SUBMIT, request);

        const forwarded = emitted.find(entry => (
            entry.eventType === ControlLoopEvents.OBSERVATION_SUBMIT
        ));
        expect(forwarded).toBeDefined();
        expect(forwarded!.payload).not.toBe(request);
        expect(forwarded!.payload).toEqual(expect.objectContaining({
            eventType: ControlLoopEvents.OBSERVATION_SUBMIT,
            agentId: AGENT,
            channelId: CHANNEL,
            data: expect.objectContaining({
                loopId: 'loop-1',
                observation: { text: 'observed' },
                context: {
                    loopOwnerId: AGENT,
                    note: 'preserved'
                }
            })
        }));
        expect(emitted.find(entry => entry.eventType === ControlLoopEvents.OBSERVATION))
            .toBeUndefined();
    });

    it('rejects a forged identity or mismatched event type', () => {
        socket.emit(ControlLoopEvents.EXECUTION_REQUEST, {
            ...requestEnvelope(ControlLoopEvents.EXECUTION_REQUEST, {
                loopId: 'loop-1',
                action: { name: 'execute' }
            }),
            agentId: 'victim-agent'
        });
        socket.emit(
            ControlLoopEvents.EXECUTION_REQUEST,
            requestEnvelope(ControlLoopEvents.INITIALIZED, { loopId: 'loop-1' })
        );

        expect(emitted).toHaveLength(0);
    });
});
