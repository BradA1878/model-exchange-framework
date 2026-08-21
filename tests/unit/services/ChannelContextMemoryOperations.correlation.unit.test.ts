import { firstValueFrom } from 'rxjs';

import { EventBus } from '@mxf-dev/core/events/EventBus';
import { Events } from '@mxf-dev/core/events/EventNames';
import { ChannelContextMemoryOperations } from '@mxf-dev/core/services/ChannelContextMemoryOperations';
import { ChannelContextMessageOperations } from '@mxf-dev/core/services/ChannelContextMessageOperations';
import { MemoryService } from '@mxf-dev/core/services/MemoryService';
import {
    ChannelContextHistoryEntry,
    ChannelContextType,
    ChannelMessage
} from '@mxf-dev/core/types/ChannelContext';

const CHANNEL_ID = 'context-channel';

describe('channel context memory correlation', () => {
    beforeEach(() => {
        EventBus.reset();
        (MemoryService as unknown as { instance?: MemoryService }).instance = undefined;
        MemoryService.getInstance();
    });

    afterEach(() => {
        EventBus.reset();
        (MemoryService as unknown as { instance?: MemoryService }).instance = undefined;
    });

    it('round-trips context and history through standardized memory result data', async () => {
        const operations = new ChannelContextMemoryOperations(false);
        const context: ChannelContextType = {
            id: CHANNEL_ID,
            channelId: CHANNEL_ID,
            name: 'Correlation channel',
            description: 'A durable channel context',
            createdAt: 1,
            createdBy: 'agent-a',
            lastActivity: 2,
            participants: ['agent-a'],
            metadata: {},
            status: 'active',
            messageCount: 0,
            conversationSummary: 'Real summary',
            updatedAt: 2
        };
        const historyEntry: ChannelContextHistoryEntry = {
            type: 'update',
            timestamp: 2,
            agentId: 'agent-a',
            data: { conversationSummary: 'Real summary' }
        };

        await firstValueFrom(
            operations.saveContextToMemory(CHANNEL_ID, context, historyEntry)
        );
        await expect(firstValueFrom(operations.getContextFromMemory(CHANNEL_ID)))
            .resolves.toEqual(context);
        await expect(firstValueFrom(operations.getContextHistory(CHANNEL_ID, 10)))
            .resolves.toEqual([historyEntry]);
        await expect(firstValueFrom(operations.deleteContextFromMemory(CHANNEL_ID)))
            .resolves.toBe(true);
        await expect(firstValueFrom(operations.getContextFromMemory(CHANNEL_ID)))
            .resolves.toBeNull();
        await expect(firstValueFrom(operations.getContextHistory(CHANNEL_ID, 10)))
            .resolves.toEqual([historyEntry]);
    });

    it('awaits each write acknowledgement and retains both message batches', async () => {
        const operations = new ChannelContextMessageOperations(false);
        const first: ChannelMessage = {
            messageId: 'message-1',
            content: 'first',
            senderId: 'agent-a',
            timestamp: 1,
            type: 'text'
        };
        const second: ChannelMessage = {
            messageId: 'message-2',
            content: 'second',
            senderId: 'agent-b',
            timestamp: 2,
            type: 'text'
        };

        const firstWrite = firstValueFrom(operations.addMessages(CHANNEL_ID, [first]));
        const secondWrite = firstValueFrom(operations.addMessages(CHANNEL_ID, [second]));
        await expect(Promise.all([firstWrite, secondWrite]))
            .resolves.toEqual([true, true]);
        await expect(firstValueFrom(operations.getMessages(CHANNEL_ID)))
            .resolves.toEqual([first, second]);
    });

    it('rejects a stale concurrent context writer instead of losing an update', async () => {
        const operations = new ChannelContextMemoryOperations(false);
        const original: ChannelContextType = {
            id: CHANNEL_ID,
            channelId: CHANNEL_ID,
            name: 'Original',
            description: 'CAS context',
            createdAt: 1,
            createdBy: 'agent-a',
            lastActivity: 1,
            participants: ['agent-a'],
            metadata: {},
            status: 'active',
            messageCount: 0,
            updatedAt: 1
        };
        await firstValueFrom(operations.saveContextToMemory(CHANNEL_ID, original));

        const first = {
            ...original,
            name: 'First writer',
            updatedAt: 2,
            lastActivity: 2
        };
        const stale = {
            ...original,
            name: 'Stale writer',
            updatedAt: 3,
            lastActivity: 3
        };
        const results = await Promise.allSettled([
            firstValueFrom(
                operations.saveContextToMemory(CHANNEL_ID, first, undefined, original.updatedAt)
            ),
            firstValueFrom(
                operations.saveContextToMemory(CHANNEL_ID, stale, undefined, original.updatedAt)
            )
        ]);

        expect(results[0]).toEqual(expect.objectContaining({ status: 'fulfilled' }));
        expect(results[1]).toEqual(expect.objectContaining({
            status: 'rejected',
            reason: expect.objectContaining({
                message: expect.stringContaining('changed concurrently')
            })
        }));
        await expect(firstValueFrom(operations.getContextFromMemory(CHANNEL_ID)))
            .resolves.toEqual(first);
    });

    it('removes a pending result listener when its caller unsubscribes', () => {
        EventBus.server.removeAllListeners(Events.Memory.GET);
        const operations = new ChannelContextMessageOperations(false);
        const subscription = operations.getMessages(CHANNEL_ID).subscribe();

        expect(EventBus.server.listenerCount(Events.Memory.GET_RESULT)).toBe(1);
        subscription.unsubscribe();
        expect(EventBus.server.listenerCount(Events.Memory.GET_RESULT)).toBe(0);
    });
});
