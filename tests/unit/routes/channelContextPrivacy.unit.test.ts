import express, { Request, Response, NextFunction } from 'express';
import supertest from 'supertest';
import { of, throwError } from 'rxjs';

const mockContextService = {
    createContext: jest.fn(), getContext: jest.fn(), updateContext: jest.fn(),
    getMessages: jest.fn(), getContextHistory: jest.fn(),
    extractConversationTopics: jest.fn(), generateConversationSummary: jest.fn()
};
jest.mock('../../../src/server/services/ChannelContextService', () => ({
    ChannelContextService: { getInstance: jest.fn(() => mockContextService) }
}));
jest.mock('@mxf-dev/core/models/channel', () => ({ Channel: { findOne: jest.fn() } }));
jest.mock('@mxf-dev/core/models/user', () => ({ User: { findById: jest.fn() }, UserRole: { ADMIN: 'admin' } }));
jest.mock('../../../src/server/api/security/ChannelRuntimePolicy', () => ({ hydrateChannelRuntimePolicy: jest.fn() }));
jest.mock('@mxf-dev/core/utils/Logger', () => ({
    Logger: jest.fn(() => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() })),
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
}));

import { Channel } from '@mxf-dev/core/models/channel';
import channelContextRoutes from '../../../src/server/api/routes/channelContextRoutes';

const publicContext = {
    id: 'context-a', channelId: 'channel-a', name: 'Shared experiment', description: 'Operator description',
    createdAt: 1, createdBy: 'owner-id', status: 'active', participants: ['agent-a', 'agent-b', 'agent-c']
};
const context = {
    ...publicContext, conversationSummary: 'private acquisition details', topics: [{ topic: 'acquisition' }],
    metadata: { secret: 'private acquisition details' }, messageCount: 9, lastActivity: 123, updatedAt: 123
};
const messages = [
    { messageId: 'public-1', senderId: 'agent-a', content: 'First broadcast', timestamp: 1 },
    { messageId: 'private-1', senderId: 'agent-a', content: { secret: 'first acquisition detail' }, timestamp: 2,
        metadata: { originalMessageType: 'agent-to-agent', targetAgentId: 'agent-b' } },
    { messageId: 'public-2', senderId: 'agent-b', content: 'Second broadcast', timestamp: 3 },
    { messageId: 'private-2', senderId: 'agent-a', content: 'latest acquisition detail', timestamp: 4,
        metadata: { originalMessageType: 'agent-to-agent', targetAgentId: 'agent-b' } },
    { messageId: 'missing-recipient', senderId: 'agent-a', content: 'private historical message', timestamp: 5,
        metadata: { originalMessageType: 'agent-to-agent' } }
];

// Authentication and storage are controlled; routing, authorization and projection are real.
const app = express();
app.use(express.json());
app.use((req: Request, _res: Response, next: NextFunction): void => {
    const principal = req.get('x-test-principal') ?? 'agent-c';
    if (principal === 'owner') {
        Object.assign(req, { authType: 'jwt', user: { id: 'owner-id', role: 'consumer', username: 'owner' } });
    } else if (principal !== 'anonymous') {
        Object.assign(req, { authType: 'key', agent: { agentId: principal, channelId: 'channel-a', keyId: 'key-a' } });
    }
    next();
});
app.use('/api', channelContextRoutes);

type HttpMethod = 'get' | 'post' | 'patch';
const contextOperations: { method: HttpMethod; body?: Record<string, unknown>; status: number }[] = [
    { method: 'get', status: 200 },
    { method: 'post', body: { name: 'Shared experiment', creatorId: 'agent-c' }, status: 201 },
    { method: 'patch', body: { description: 'Changed', updatedBy: 'forged-agent' }, status: 200 }
];
const derivedRoutes: { method: HttpMethod; path: string; field: string; value: unknown }[] = [
    { method: 'get', path: 'metadata', field: 'metadata', value: context.metadata },
    { method: 'get', path: 'metadata/secret', field: 'metadata', value: context.metadata.secret },
    { method: 'get', path: 'history', field: 'history', value: [{ data: context }] },
    { method: 'post', path: 'topics', field: 'topics', value: context.topics },
    { method: 'post', path: 'summary', field: 'summary', value: context.conversationSummary }
];

describe('channel context HTTP privacy boundaries', () => {
    const previousVisibility = process.env.MXF_CHANNEL_HISTORY_DM_VISIBILITY;
    let timerSpy: jest.SpyInstance;
    beforeEach(() => {
        jest.clearAllMocks();
        process.env.MXF_CHANNEL_HISTORY_DM_VISIBILITY = 'parties';
        (Channel.findOne as jest.Mock).mockResolvedValue({ channelId: 'channel-a', active: true, createdBy: 'owner-id' });
        mockContextService.createContext.mockReturnValue(of(context));
        mockContextService.getContext.mockReturnValue(of(context));
        mockContextService.updateContext.mockReturnValue(of(context));
        mockContextService.getMessages.mockImplementation((_channelId: string, limit?: number) =>
            of(limit === undefined ? messages : messages.slice(-limit)));
        mockContextService.getContextHistory.mockReturnValue(of([{ data: context }]));
        mockContextService.extractConversationTopics.mockReturnValue(of(context.topics));
        mockContextService.generateConversationSummary.mockReturnValue(of(context.conversationSummary));
        timerSpy = jest.spyOn(global, 'setTimeout');
    });
    afterEach(() => {
        // The pre-existing topics/summary controller races leave their timeout pending after success.
        // Observe real timers during HTTP handling, then release only timers created by this test.
        for (const result of timerSpy.mock.results) {
            if (result.type === 'return') clearTimeout(result.value as ReturnType<typeof setTimeout>);
        }
        timerSpy.mockRestore();
        if (previousVisibility === undefined) delete process.env.MXF_CHANNEL_HISTORY_DM_VISIBILITY;
        else process.env.MXF_CHANNEL_HISTORY_DM_VISIBILITY = previousVisibility;
    });

    it.each(contextOperations)('projects agent $method context responses without changing canonical context', async ({ method, body, status }) => {
        const original = JSON.stringify(context);
        const response = await supertest(app)[method]('/api/channels/channel-a/context').send(body ?? {});
        expect(response.status).toBe(status);
        expect(response.body).toEqual(publicContext);
        expect(JSON.stringify(context)).toBe(original);
        if (method === 'patch') {
            expect(mockContextService.updateContext).toHaveBeenCalledWith('channel-a', { description: 'Changed' }, 'agent-c');
        }
    });

    describe.each(['owner', 'default-agent'])('%s retains complete context', principal => {
        it.each(contextOperations)('preserves $method behavior', async ({ method, body, status }) => {
            if (principal === 'default-agent') delete process.env.MXF_CHANNEL_HISTORY_DM_VISIBILITY;
            const response = await supertest(app)[method]('/api/channels/channel-a/context')
                .set('x-test-principal', principal === 'owner' ? 'owner' : 'agent-c').send(body ?? {});
            expect(response.status).toBe(status);
            expect(response.body).toEqual(context);
        });
    });

    it('filters the full canonical history before taking the latest visible messages', async () => {
        const original = JSON.stringify(messages);
        const response = await supertest(app).get('/api/channels/channel-a/messages?limit=2');
        expect(response.status).toBe(200);
        expect(response.body).toEqual({ success: true, messages: [messages[0], messages[2]] });
        expect(mockContextService.getMessages).toHaveBeenCalledWith('channel-a');
        expect(JSON.stringify(messages)).toBe(original);
    });

    it.each([
        ['agent-a', messages],
        ['agent-b', messages.slice(0, 4)],
        ['agent-c', [messages[0], messages[2]]]
    ])('returns only recorded DM parties to %s without an unfiltered count', async (principal, visible) => {
        const response = await supertest(app).get('/api/channels/channel-a/messages').set('x-test-principal', principal as string);
        expect(response.status).toBe(200);
        expect(response.body).toEqual({ success: true, messages: visible });
    });

    it.each(['owner', 'default-agent'])('retains canonical messages and latest-limit semantics for %s', async principal => {
        if (principal === 'default-agent') delete process.env.MXF_CHANNEL_HISTORY_DM_VISIBILITY;
        const response = await supertest(app).get('/api/channels/channel-a/messages?limit=2')
            .set('x-test-principal', principal === 'owner' ? 'owner' : 'agent-c');
        expect(response.status).toBe(200);
        expect(response.body).toEqual({ success: true, messages: messages.slice(-2) });
    });

    it.each(derivedRoutes)('denies agent $method $path before reading stored aggregates or invoking SystemLLM', async ({ method, path }) => {
        const response = await supertest(app)[method](`/api/channels/channel-a/${path}`).send({});
        expect(response.status).toBe(403);
        expect(response.body).toEqual({ success: false, message: expect.stringContaining('parties-only DM visibility') });
        for (const operation of Object.values(mockContextService)) expect(operation).not.toHaveBeenCalled();
    });

    describe.each(['owner', 'default-agent'])('%s retains derived-context access', principal => {
        it.each(derivedRoutes)('allows $method $path', async ({ method, path, field, value }) => {
            if (principal === 'default-agent') delete process.env.MXF_CHANNEL_HISTORY_DM_VISIBILITY;
            const response = await supertest(app)[method](`/api/channels/channel-a/${path}`)
                .set('x-test-principal', principal === 'owner' ? 'owner' : 'agent-c').send({});
            expect(response.status).toBe(200);
            expect(response.body).toEqual({ success: true, [field]: value });
        });
    });

    it('rejects a foreign-channel agent before reading canonical history', async () => {
        const response = await supertest(app).get('/api/channels/other-channel/messages');
        expect(response.status).toBe(403);
        expect(mockContextService.getMessages).not.toHaveBeenCalled();
    });

    it.each(['0', '-1', '1.5', 'garbage'])('rejects invalid latest-limit %s before reading memory', async limit => {
        const response = await supertest(app).get(`/api/channels/channel-a/messages?limit=${limit}`);
        expect(response.status).toBe(400);
        expect(mockContextService.getMessages).not.toHaveBeenCalled();
    });

    it('surfaces canonical memory failures without returning fabricated empty history', async () => {
        mockContextService.getMessages.mockReturnValue(throwError(() => new Error('canonical memory unavailable')));
        const response = await supertest(app).get('/api/channels/channel-a/messages');
        expect(response.status).toBe(400);
        expect(response.body).toEqual({ success: false, message: 'canonical memory unavailable' });
    });
});
