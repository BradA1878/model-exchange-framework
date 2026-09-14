import { firstValueFrom } from 'rxjs';
import { EventBus } from '@mxf-dev/core/events/EventBus';
import { Events } from '@mxf-dev/core/events/EventNames';
import { MemoryService } from '@mxf-dev/core/services/MemoryService';
import { MemoryScope } from '@mxf-dev/core/types/MemoryTypes';
import {
    BaseEventPayload, createMemoryGetEventPayload, createMemoryUpdateEventPayload,
    createMemoryDeleteEventPayload
} from '@mxf-dev/core/schemas/EventPayloadSchema';

describe('channel memory key isolation', () => {
    let service: MemoryService;
    let operation = 0;
    beforeEach(() => {
        EventBus.reset();
        (MemoryService as unknown as { instance?: MemoryService }).instance = undefined;
        service = MemoryService.getInstance();
    });
    afterEach(() => {
        EventBus.reset();
        (MemoryService as unknown as { instance?: MemoryService }).instance = undefined;
    });

    const request = async (action: 'get' | 'update' | 'delete', channelId: string, id: string, data?: Record<string, unknown>): Promise<Record<string, unknown>> => {
        const operationId = String(++operation);
        const scope = MemoryScope.CHANNEL;
        const requestEvent = action === 'get' ? Events.Memory.GET : action === 'update' ? Events.Memory.UPDATE : Events.Memory.DELETE;
        const responseEvent = action === 'get' ? Events.Memory.GET_RESULT : action === 'update' ? Events.Memory.UPDATE_RESULT : Events.Memory.DELETE_RESULT;
        const payload = action === 'get'
            ? createMemoryGetEventPayload(requestEvent, 'a', channelId, { operationId, scope, id })
            : action === 'update'
                ? createMemoryUpdateEventPayload(requestEvent, 'a', channelId, { operationId, scope, id, data: data! })
                : createMemoryDeleteEventPayload(requestEvent, 'a', channelId, { operationId, scope, id });
        return new Promise(resolve => {
            const subscription = EventBus.server.on(responseEvent, (result: BaseEventPayload<Record<string, unknown>>) => {
                if (result.data.operationId === operationId) {
                    subscription.unsubscribe();
                    resolve(result.data);
                }
            });
            EventBus.server.emit(requestEvent, payload);
        });
    };

    it.each(['history:a', 'channel:messages:a'])('reads, updates and deletes exact whole/sub-resource IDs for %s', async channelId => {
        const key = `channel:context:${channelId}`;
        expect(await request('update', channelId, key, { [key]: { channelId, name: 'Own context', updatedAt: 1 } }))
            .not.toHaveProperty('error');
        expect((await request('get', channelId, key)).memory).toEqual({ channelId, name: 'Own context', updatedAt: 1 });
        expect((await request('get', channelId, channelId)).memory).toEqual(expect.objectContaining({ channelId }));
        expect((await request('delete', channelId, key)).success).toBe(true);
        expect((await request('get', channelId, key)).memory).toBeNull();
        expect((await request('delete', channelId, channelId)).success).toBe(true);
    });

    it('cannot read or overwrite internal history through the general tool KV map', async () => {
        const key = 'channel:messages:room';
        const message = { messageId: 'dm', senderId: 'a', content: 'secret' };
        await request('update', 'room', key, { [key]: [message] });
        expect(service.getGeneralData(key)).toBeUndefined();
        service.setGeneralData(key, { value: 'caller value' });
        expect((await request('get', 'room', key)).memory).toEqual([message]);
        expect(service.getGeneralData(key)).toEqual({ value: 'caller value' });
    });

    it('keeps the first canonical message across repeated local memory appends', async () => {
        const key = 'channel:messages:room';
        const original = { messageId: 'dm', senderId: 'a', content: { text: 'original' }, metadata: { targetAgentId: 'b' } };
        await request('update', 'room', key, { [key]: [original] });
        const later = { ...original, content: { text: 'changed' }, metadata: { targetAgentId: 'c' } };
        await request('update', 'room', key, { [key]: [later, { messageId: 'next', content: '' }] });
        expect((await request('get', 'room', key)).memory).toEqual([original, { messageId: 'next', content: '' }]);
        expect((await firstValueFrom(service.getChannelMemory('room'))).conversationHistory).toEqual([
            original, { messageId: 'next', content: '' }
        ]);
    });

    it('deleting one channel does not evict another channel or general values with the same suffix', async () => {
        const key = 'channel:messages:parent:room';
        await request('update', 'parent:room', key, { [key]: [{ messageId: 'keep', senderId: 'a' }] });
        await firstValueFrom(service.getChannelMemory('room'));
        service.setGeneralData('a:default:room', { value: 'keep general' });
        await firstValueFrom(service.deleteMemory(MemoryScope.CHANNEL, 'room'));
        expect((await request('get', 'parent:room', key)).memory).toEqual([{ messageId: 'keep', senderId: 'a' }]);
        expect(service.getGeneralData('a:default:room')).toEqual({ value: 'keep general' });
    });
});
