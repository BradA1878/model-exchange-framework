import { firstValueFrom } from 'rxjs';

import { EventBus } from '@mxf-dev/core/events/EventBus';
import { Events } from '@mxf-dev/core/events/EventNames';
import {
    BaseEventPayload,
    createMemoryUpdateResultEventPayload,
    MemoryUpdateEventData,
    MemoryUpdateResultEventData
} from '@mxf-dev/core/schemas/EventPayloadSchema';
import { MemoryScope } from '@mxf-dev/core/types/MemoryTypes';
import { MxfMemoryService } from '@mxf-dev/sdk/services/MxfMemoryService';

const AGENT_ID = 'append-agent';
const CHANNEL_ID = 'append-channel';
const MESSAGES_KEY = `channel:messages:${CHANNEL_ID}`;

const resetMemoryService = (): void => {
    (MxfMemoryService as unknown as { instance?: MxfMemoryService }).instance = undefined;
};

const asResultMemory = (value: unknown): MemoryUpdateResultEventData['memory'] =>
    value as MemoryUpdateResultEventData['memory'];

describe('MxfMemoryService atomic channel append boundary', () => {
    let service: MxfMemoryService;

    beforeEach(() => {
        EventBus.reset();
        resetMemoryService();
        service = MxfMemoryService.getInstance();
        jest.spyOn(EventBus.client, 'isRegisteredSocketConnected').mockReturnValue(true);
    });

    afterEach(() => {
        jest.restoreAllMocks();
        EventBus.reset();
        resetMemoryService();
    });

    it('emits only the new keyed batch and resolves the exact correlated authoritative history', async () => {
        const newMessage = { messageId: 'new-message', content: 'new' };
        const authoritativeHistory = [
            { messageId: 'existing-message', content: 'existing' },
            newMessage
        ];
        let emittedPayload: BaseEventPayload<MemoryUpdateEventData> | undefined;
        const emitSpy = jest.spyOn(EventBus.client, 'emitOn').mockImplementation((
            _agentId,
            _event,
            rawPayload
        ) => {
            emittedPayload = rawPayload as BaseEventPayload<MemoryUpdateEventData>;
        });

        const resultPromise = firstValueFrom(
            service.appendChannelMessages(AGENT_ID, CHANNEL_ID, [newMessage])
        );
        expect(emittedPayload).toBeDefined();
        const requestPayload = emittedPayload as BaseEventPayload<MemoryUpdateEventData>;

        expect(emitSpy).toHaveBeenCalledTimes(1);
        expect(emitSpy).toHaveBeenCalledWith(
            AGENT_ID,
            Events.Memory.UPDATE,
            requestPayload
        );
        expect(requestPayload.agentId).toBe(AGENT_ID);
        expect(requestPayload.channelId).toBe(CHANNEL_ID);
        expect(requestPayload.data).toEqual({
            operationId: expect.any(String),
            scope: MemoryScope.CHANNEL,
            id: MESSAGES_KEY,
            data: { [MESSAGES_KEY]: [newMessage] }
        });

        let settled = false;
        void resultPromise.then(
            () => { settled = true; },
            () => { settled = true; }
        );
        EventBus.client.emitLocal(
            Events.Memory.UPDATE_RESULT,
            createMemoryUpdateResultEventPayload(
                Events.Memory.UPDATE_RESULT,
                AGENT_ID,
                CHANNEL_ID,
                {
                    operationId: 'unrelated-operation',
                    scope: MemoryScope.CHANNEL,
                    id: MESSAGES_KEY,
                    memory: asResultMemory([{ messageId: 'unrelated' }])
                }
            )
        );
        await Promise.resolve();
        expect(settled).toBe(false);

        EventBus.client.emitLocal(
            Events.Memory.UPDATE_RESULT,
            createMemoryUpdateResultEventPayload(
                Events.Memory.UPDATE_RESULT,
                AGENT_ID,
                CHANNEL_ID,
                {
                    operationId: requestPayload.data.operationId,
                    scope: MemoryScope.CHANNEL,
                    id: MESSAGES_KEY,
                    memory: asResultMemory(authoritativeHistory)
                }
            )
        );

        await expect(resultPromise).resolves.toBe(authoritativeHistory);
        expect(EventBus.client.listenerCount(Events.Memory.UPDATE_RESULT)).toBe(0);
        expect(EventBus.client.listenerCount(Events.Memory.UPDATE_ERROR)).toBe(0);
        expect(EventBus.client.listenerCount(Events.Agent.DISCONNECT)).toBe(0);
    });

    it('surfaces an exact correlated append failure and removes every request listener', async () => {
        const failure = 'atomic append rejected';
        jest.spyOn(EventBus.client, 'emitOn').mockImplementation((
            _agentId,
            _event,
            rawPayload
        ) => {
            const requestPayload = rawPayload as BaseEventPayload<MemoryUpdateEventData>;
            EventBus.client.emitLocal(
                Events.Memory.UPDATE_RESULT,
                createMemoryUpdateResultEventPayload(
                    Events.Memory.UPDATE_RESULT,
                    AGENT_ID,
                    CHANNEL_ID,
                    {
                        operationId: requestPayload.data.operationId,
                        scope: MemoryScope.CHANNEL,
                        id: MESSAGES_KEY,
                        memory: null,
                        error: failure
                    }
                )
            );
        });

        await expect(firstValueFrom(
            service.appendChannelMessages(AGENT_ID, CHANNEL_ID, [{ messageId: 'new' }])
        )).rejects.toThrow(failure);
        expect(EventBus.client.listenerCount(Events.Memory.UPDATE_RESULT)).toBe(0);
        expect(EventBus.client.listenerCount(Events.Memory.UPDATE_ERROR)).toBe(0);
        expect(EventBus.client.listenerCount(Events.Agent.DISCONNECT)).toBe(0);
    });

    it('rejects empty batches before emitting a memory operation', () => {
        const emitSpy = jest.spyOn(EventBus.client, 'emitOn');

        expect(() => service.appendChannelMessages(AGENT_ID, CHANNEL_ID, []))
            .toThrow('Messages must be a non-empty array');
        expect(emitSpy).not.toHaveBeenCalled();
    });
});
