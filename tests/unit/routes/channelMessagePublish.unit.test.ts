import express, { Request, Response, NextFunction } from 'express';
import supertest from 'supertest';
import { defer, firstValueFrom } from 'rxjs';

const mockAddMessage = jest.fn();
jest.mock('../../../src/server/services/ChannelContextService', () => ({
    ChannelContextService: { getInstance: jest.fn(() => ({ addMessage: mockAddMessage })) }
}));
jest.mock('@mxf-dev/core/models/channel', () => ({ Channel: { findOne: jest.fn() } }));
jest.mock('@mxf-dev/core/models/user', () => ({ User: { findById: jest.fn() }, UserRole: { ADMIN: 'admin' } }));
jest.mock('../../../src/server/api/security/ChannelRuntimePolicy', () => ({ hydrateChannelRuntimePolicy: jest.fn() }));
jest.mock('@mxf-dev/core/utils/Logger', () => ({
    Logger: jest.fn(() => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() })),
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
}));

import { EventBus } from '@mxf-dev/core/events/EventBus';
import { Events } from '@mxf-dev/core/events/EventNames';
import { Channel } from '@mxf-dev/core/models/channel';
import { User } from '@mxf-dev/core/models/user';
import { MemoryService } from '@mxf-dev/core/services/MemoryService';
import { ChannelContextMessageOperations } from '@mxf-dev/core/services/ChannelContextMessageOperations';
import type { ChannelMessage } from '@mxf-dev/core/types/ChannelContext';
import type { BaseEventPayload } from '@mxf-dev/core/schemas/EventPayloadSchema';
import type { ChannelMessage as WireChannelMessage } from '@mxf-dev/core/schemas/MessageSchemas';
import { EventQueueControl, setupEventBusToSocketForwarding } from '../../../src/server/socket/handlers/eventForwardingHandlers';
import channelContextRoutes from '../../../src/server/api/routes/channelContextRoutes';

const app = express();
app.use(express.json());
app.use((req: Request, _res: Response, next: NextFunction): void => {
    const principal = req.get('x-test-principal') ?? 'owner';
    if (principal === 'agent') {
        Object.assign(req, { authType: 'key', agent: { agentId: 'agent-a', channelId: 'channel-a', keyId: 'agent-key' } });
    } else if (principal !== 'anonymous') {
        Object.assign(req, {
            authType: 'jwt', user: {
                id: principal === 'owner' || principal === 'lookup' ? 'owner-id' : principal,
                role: principal === 'admin' ? 'admin' : 'consumer',
                ...(principal !== 'lookup' ? { username: 'experimenter' } : {})
            }
        });
    }
    next();
});
app.use('/api', channelContextRoutes);

describe('owner/admin channel message publication', () => {
    let operations: ChannelContextMessageOperations;
    let emitted: BaseEventPayload<WireChannelMessage>[];

    beforeEach(() => {
        jest.clearAllMocks();
        EventBus.reset();
        Reflect.set(MemoryService, 'instance', undefined);
        MemoryService.getInstance();
        operations = new ChannelContextMessageOperations();
        mockAddMessage.mockImplementation((channelId: string, message: ChannelMessage) => operations.addMessage(channelId, message));
        (Channel.findOne as jest.Mock).mockResolvedValue({ channelId: 'channel-a', active: true, createdBy: 'owner-id' });
        emitted = [];
        EventBus.server.on(Events.Message.CHANNEL_MESSAGE, payload => emitted.push(payload as BaseEventPayload<WireChannelMessage>));
    });
    afterEach(() => {
        EventBus.reset();
        Reflect.set(MemoryService, 'instance', undefined);
    });

    it('awaits persistence and delivers one ordinary owner message to each channel socket', async () => {
        const agents = [jest.fn(), jest.fn()];
        const roomEmit = jest.fn((event: string, payload: unknown): void => { agents.forEach(agent => agent(event, payload)); });
        EventQueueControl.setEnabled(false);
        setupEventBusToSocketForwarding({
            getNormalizedChannelName: (channelId: string): string => `channel:${channelId}`,
            getSocketServer: (): unknown => ({ to: (): unknown => ({ emit: roomEmit }) }),
            getSocketByAgentId: (): null => null
        } as never);
        let release!: () => void;
        let started!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        const entered = new Promise<void>(resolve => { started = resolve; });
        mockAddMessage.mockImplementation((channelId: string, message: ChannelMessage) => defer(async () => {
            started();
            await gate;
            return firstValueFrom(operations.addMessage(channelId, message));
        }));
        const response = supertest(app).post('/api/channels/channel-a/messages').send({
            content: { greeting: 'Hello.' }, senderId: 'forged', messageId: 'forged-id', timestamp: 1
        }).then(value => value);
        try {
            await entered;
            expect(emitted).toHaveLength(0);
            expect(roomEmit).not.toHaveBeenCalled();
            release();
            const result = await response;
            expect(result.status).toBe(200);
            expect(result.body).toEqual({ messageId: expect.any(String), timestamp: expect.any(Number) });
            expect(result.body.messageId).not.toBe('forged-id');
            expect(emitted).toHaveLength(1);
            expect(emitted[0].data).toMatchObject({
                senderId: 'experimenter', content: { data: { greeting: 'Hello.' } },
                metadata: result.body, context: { channelId: 'channel-a', messageType: 'user', userId: 'owner-id' }
            });
            for (const agent of agents) expect(agent).toHaveBeenCalledWith(Events.Message.CHANNEL_MESSAGE, emitted[0]);
            expect(agents.map(agent => agent.mock.calls.length)).toEqual([1, 1]);
            expect(await firstValueFrom(operations.getMessages('channel-a'))).toEqual([
                expect.objectContaining({ messageId: result.body.messageId, timestamp: result.body.timestamp, senderId: 'experimenter', content: { greeting: 'Hello.' } })
            ]);
        } finally {
            release();
            await response;
        }
    });

    it('allows an administrator and preserves an explicit message type', async () => {
        const result = await supertest(app).post('/api/channels/channel-a/messages').set('x-test-principal', 'admin')
            .send({ content: 'Seed', messageType: 'experiment' });
        expect(result.status).toBe(200);
        expect(emitted[0].data.context.messageType).toBe('experiment');
    });

    it.each([['other-user', 403], ['agent', 403], ['anonymous', 401]])('denies %s before persistence or delivery', async (principal, status) => {
        const result = await supertest(app).post('/api/channels/channel-a/messages').set('x-test-principal', principal as string).send({ content: 'Seed' });
        expect(result.status).toBe(status);
        expect(mockAddMessage).not.toHaveBeenCalled();
        expect(emitted).toHaveLength(0);
    });

    it.each([{ content: null }, { content: [] }, { content: 1 }, { content: 'x', messageType: '' }, { content: 'x', messageType: 1 }])('rejects malformed body %p', async body => {
        const result = await supertest(app).post('/api/channels/channel-a/messages').send(body);
        expect(result.status).toBe(400);
        expect(mockAddMessage).not.toHaveBeenCalled();
        expect(emitted).toHaveLength(0);
    });

    it('resolves a missing authenticated username from the actual user identity', async () => {
        const lean = jest.fn().mockResolvedValue({ username: 'stored-username' });
        (User.findById as jest.Mock).mockReturnValue({ select: jest.fn(() => ({ lean })) });
        const result = await supertest(app).post('/api/channels/channel-a/messages').set('x-test-principal', 'lookup').send({ content: '' });
        expect(result.status).toBe(200);
        expect(User.findById).toHaveBeenCalledWith('owner-id');
        expect(emitted[0].data.senderId).toBe('stored-username');
    });

    it('does not emit or acknowledge success when persistence fails', async () => {
        mockAddMessage.mockImplementation(() => defer(() => Promise.reject(new Error('storage unavailable'))));
        const result = await supertest(app).post('/api/channels/channel-a/messages').send({ content: 'Seed' });
        expect(result.status).toBe(500);
        expect(result.body.message).toBe('storage unavailable');
        expect(emitted).toHaveLength(0);
    });
});
