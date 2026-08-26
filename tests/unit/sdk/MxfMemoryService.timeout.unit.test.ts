/**
 * Unit tests for the time bound on memory requests.
 *
 * A memory request settles when the server answers it, when this agent's
 * socket drops, or when the SDK cancels it. While the socket stayed up and
 * the server stayed silent, nothing settled it — so disconnect(), which waits
 * for queued saves before closing the socket, waited forever on a server that
 * had stopped answering. MXF_MEMORY_REQUEST_TIMEOUT_MS caps that wait and ends
 * the request with a loud, non-retryable error.
 */
import { firstValueFrom } from 'rxjs';

import { EventBus } from '@mxf-dev/core/events/EventBus';
import { Events } from '@mxf-dev/core/events/EventNames';
import {
    BaseEventPayload,
    BaseMemoryOperationData,
    createMemoryUpdateResultEventPayload
} from '@mxf-dev/core/schemas/EventPayloadSchema';
import { IAgentMemory, MemoryPersistenceLevel } from '@mxf-dev/core/types/MemoryTypes';
import { MxfMemoryService } from '@mxf-dev/sdk/services/MxfMemoryService';

const AGENT_ID = 'timeout-agent';
const CHANNEL_ID = 'timeout-channel';

const agentMemory: IAgentMemory = {
    id: 'agent-memory',
    agentId: AGENT_ID,
    createdAt: new Date(1),
    updatedAt: new Date(1),
    persistenceLevel: MemoryPersistenceLevel.PERSISTENT,
    notes: {},
    conversationHistory: [],
    customData: {}
};

/** The request goes out and the server never answers it. */
const neverAnswer = (): jest.SpyInstance =>
    jest.spyOn(EventBus.client, 'emitOn').mockImplementation(() => undefined);

/** The server answers the update at once, the way the correlation tests do. */
const answerAtOnce = (): jest.SpyInstance =>
    jest.spyOn(EventBus.client, 'emitOn').mockImplementation((_agentId, _event, rawPayload) => {
        const payload = rawPayload as BaseEventPayload<BaseMemoryOperationData>;
        EventBus.client.emitLocal(
            Events.Memory.UPDATE_RESULT,
            createMemoryUpdateResultEventPayload(
                Events.Memory.UPDATE_RESULT,
                AGENT_ID,
                CHANNEL_ID,
                { ...payload.data, memory: agentMemory }
            )
        );
    });

const resetService = (): MxfMemoryService => {
    (MxfMemoryService as unknown as { instance?: MxfMemoryService }).instance = undefined;
    return MxfMemoryService.getInstance();
};

describe('MxfMemoryService request time bound', () => {
    let service: MxfMemoryService;

    beforeEach(() => {
        EventBus.reset();
        service = resetService();
        jest.spyOn(EventBus.client, 'isRegisteredSocketConnected').mockReturnValue(true);
        delete process.env.MXF_MEMORY_REQUEST_TIMEOUT_MS;
    });

    afterEach(() => {
        jest.useRealTimers();
        jest.restoreAllMocks();
        EventBus.reset();
        delete process.env.MXF_MEMORY_REQUEST_TIMEOUT_MS;
        resetService();
    });

    it('ends an update the server never answers once MXF_MEMORY_REQUEST_TIMEOUT_MS elapses, leaving no listener or timer behind', async () => {
        jest.useFakeTimers();
        process.env.MXF_MEMORY_REQUEST_TIMEOUT_MS = '5000';
        const emitOn = neverAnswer();

        let settled = false;
        const request = firstValueFrom(service.updateAgentMemory(AGENT_ID, CHANNEL_ID, agentMemory));
        request.catch(() => { settled = true; });
        expect(emitOn).toHaveBeenCalledTimes(1);
        expect(jest.getTimerCount()).toBe(1);

        await jest.advanceTimersByTimeAsync(4999);
        expect(settled).toBe(false);
        await jest.advanceTimersByTimeAsync(1);

        await expect(request).rejects.toThrow(
            /Memory operation .+ timed out after 5000ms waiting for the server's answer/
        );
        expect(EventBus.client.listenerCount(Events.Memory.UPDATE_RESULT)).toBe(0);
        expect(EventBus.client.listenerCount(Events.Memory.UPDATE_ERROR)).toBe(0);
        expect(EventBus.client.listenerCount(Events.Agent.DISCONNECT)).toBe(0);
        expect(jest.getTimerCount()).toBe(0);
    });

    it('clears the bound when the server answers, so a settled request leaves nothing running', async () => {
        jest.useFakeTimers();
        process.env.MXF_MEMORY_REQUEST_TIMEOUT_MS = '5000';
        answerAtOnce();

        await expect(firstValueFrom(service.updateAgentMemory(AGENT_ID, CHANNEL_ID, agentMemory)))
            .resolves.toBe(agentMemory);

        expect(jest.getTimerCount()).toBe(0);
    });

    it('waits 60 seconds when MXF_MEMORY_REQUEST_TIMEOUT_MS is not set', async () => {
        jest.useFakeTimers();
        neverAnswer();

        let settled = false;
        const request = firstValueFrom(service.updateAgentMemory(AGENT_ID, CHANNEL_ID, agentMemory));
        request.catch(() => { settled = true; });

        await jest.advanceTimersByTimeAsync(59_999);
        expect(settled).toBe(false);
        await jest.advanceTimersByTimeAsync(1);

        await expect(request).rejects.toThrow(/timed out after 60000ms/);
    });

    it.each(['0', '-1', 'soon'])(
        'refuses MXF_MEMORY_REQUEST_TIMEOUT_MS=%s before sending, instead of running without a bound',
        (value) => {
            process.env.MXF_MEMORY_REQUEST_TIMEOUT_MS = value;
            const emitOn = neverAnswer();

            expect(() => service.updateAgentMemory(AGENT_ID, CHANNEL_ID, agentMemory))
                .toThrow(/MXF_MEMORY_REQUEST_TIMEOUT_MS must be a positive integer/);
            expect(emitOn).not.toHaveBeenCalled();
        }
    );
});
