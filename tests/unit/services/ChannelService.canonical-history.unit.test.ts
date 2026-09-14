import { firstValueFrom } from 'rxjs';

jest.mock('@mxf-dev/core/models/channel', () => ({
    Channel: { updateOne: jest.fn().mockResolvedValue({ matchedCount: 1 }), findOneAndUpdate: jest.fn(), bulkWrite: jest.fn() }
}));
jest.mock('@mxf-dev/core/config/ConfigManager', () => ({ ConfigManager: { getInstance: jest.fn(() => ({})) } }));
jest.mock('../../../src/server/socket/services/McpService', () => ({ McpService: { getInstance: jest.fn(() => ({})) } }));
jest.mock('@mxf-dev/core/utils/Logger', () => ({ Logger: jest.fn(() => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() })) }));

import { EventBus } from '@mxf-dev/core/events/EventBus';
import { Events } from '@mxf-dev/core/events/EventNames';
import { Channel } from '@mxf-dev/core/models/channel';
import { MemoryService } from '@mxf-dev/core/services/MemoryService';
import { ChannelContextMessageOperations } from '@mxf-dev/core/services/ChannelContextMessageOperations';
import { createAgentMessage, createChannelMessage } from '@mxf-dev/core/schemas/MessageSchemas';
import { createAgentMessageEventPayload, createChannelMessageEventPayload } from '@mxf-dev/core/schemas/EventPayloadSchema';
import { ChannelService } from '../../../src/server/socket/services/ChannelService';

describe('ChannelService canonical history writes', () => {
    let service: ChannelService;
    let operations: ChannelContextMessageOperations;
    const directSocketEmit = jest.fn();

    beforeEach(() => {
        jest.clearAllMocks();
        EventBus.reset();
        Reflect.set(MemoryService, 'instance', undefined);
        Reflect.set(ChannelService, 'instance', undefined);
        MemoryService.getInstance();
        service = ChannelService.getInstance({ to: jest.fn(() => ({ emit: directSocketEmit })) } as never);
        operations = new ChannelContextMessageOperations();
    });
    afterEach(() => {
        EventBus.reset();
        Reflect.set(MemoryService, 'instance', undefined);
        Reflect.set(ChannelService, 'instance', undefined);
    });

    const acknowledgements = (count: number): Promise<void> => new Promise(resolve => {
        let received = 0;
        const subscription = EventBus.server.on(Events.Memory.UPDATE_RESULT, () => {
            if (++received === count) { subscription.unsubscribe(); resolve(); }
        });
    });

    it('persists repeated ordinary broadcasts once with their original objects and timestamps', async () => {
        const message = createChannelMessage('canonical', 'agent-a', { value: ['one', 'two'] }, {
            metadata: { messageId: 'broadcast', timestamp: 0 }, context: { messageType: 'broadcast' }
        });
        const completed = acknowledgements(2);
        for (let index = 0; index < 2; index++) {
            EventBus.server.emit(Events.Message.CHANNEL_MESSAGE, createChannelMessageEventPayload(
                Events.Message.CHANNEL_MESSAGE, 'agent-a', message
            ));
        }
        await completed;
        expect(await firstValueFrom(operations.getMessages('canonical'))).toEqual([
            expect.objectContaining({ messageId: 'broadcast', content: { value: ['one', 'two'] }, timestamp: 0, metadata: expect.objectContaining({ messageType: 'broadcast' }) })
        ]);
        expect(Channel.findOneAndUpdate).not.toHaveBeenCalled();
        expect(Channel.bulkWrite).not.toHaveBeenCalled();
    });

    it('converts the real DM builder once and retains both parties, original ID, and raw content', async () => {
        const message = createAgentMessage('agent-a', 'agent-b', { question: 'Hello?' }, {
            metadata: { messageId: 'dm', timestamp: 7, custom: 'retained' }, context: { channelId: 'canonical', messageType: 'direct' }
        });
        const completed = acknowledgements(1);
        EventBus.server.emit(Events.Message.AGENT_MESSAGE, createAgentMessageEventPayload(
            Events.Message.AGENT_MESSAGE, 'agent-a', 'canonical', message
        ));
        await completed;
        expect(await firstValueFrom(operations.getMessages('canonical'))).toEqual([
            expect.objectContaining({
                messageId: 'dm', timestamp: 7, senderId: 'agent-a', receiverId: 'agent-b', content: { question: 'Hello?' },
                metadata: expect.objectContaining({ originalMessageType: 'agent-to-agent', targetAgentId: 'agent-b', custom: 'retained' })
            })
        ]);
    });

    it('uses the same canonical append for bulk and sendMessage without direct socket emission', async () => {
        const message = createChannelMessage('canonical', 'agent-a', { raw: true }, { metadata: { messageId: 'bulk', timestamp: 1 } });
        await service.persistChannelMessagesBulk('canonical', [message, message]);
        const delivered: unknown[] = [];
        const subscription = EventBus.server.on(Events.Message.CHANNEL_MESSAGE, payload => delivered.push(payload));
        const completed = acknowledgements(2);
        await service.sendMessage('canonical', 'sent', 'agent-a', '', 'text', 0);
        await completed;
        subscription.unsubscribe();
        expect(delivered).toHaveLength(1);
        expect(directSocketEmit).not.toHaveBeenCalled();
        const history = await firstValueFrom(operations.getMessages('canonical'));
        expect(history).toHaveLength(2);
        expect(history.find(message => message.messageId === 'bulk')?.content).toEqual({ raw: true });
        expect(history.find(message => message.messageId === 'sent')).toMatchObject({ timestamp: 0, content: '' });
    });
});
