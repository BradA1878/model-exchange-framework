import express, { NextFunction, Request, Response } from 'express';
import supertest from 'supertest';

const mockHydrateChannelRuntimePolicy = jest.fn();

const mockTaskService = {
    createTask: jest.fn(),
    getTasks: jest.fn(),
    getTasksInChannels: jest.fn(),
    getTaskChannelId: jest.fn(),
    getTaskInChannel: jest.fn(),
    updateTaskInChannel: jest.fn(),
    assignTaskInChannel: jest.fn(),
    transitionTaskAsOwnerInChannel: jest.fn(),
    assignTaskIntelligentlyInChannel: jest.fn()
};

jest.mock('../../../src/server/socket/services/TaskService', () => ({
    TaskService: { getInstance: jest.fn(() => mockTaskService) }
}));

jest.mock('@mxf-dev/core/models/channel', () => ({
    Channel: { find: jest.fn(), findOne: jest.fn() }
}));

jest.mock('@mxf-dev/core/models/agent', () => ({
    Agent: { findOne: jest.fn() }
}));

jest.mock('@mxf-dev/core/models/channelKey', () => ({
    __esModule: true,
    default: { findOne: jest.fn() }
}));

jest.mock('@mxf-dev/core/events/EventBus', () => ({
    EventBus: { server: { emit: jest.fn() } }
}));

jest.mock('@mxf-dev/core/utils/Logger', () => ({
    Logger: jest.fn().mockImplementation(() => ({
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn()
    }))
}));

jest.mock('../../../src/server/api/security/ChannelRuntimePolicy', () => ({
    hydrateChannelRuntimePolicy: mockHydrateChannelRuntimePolicy
}));

import { Channel } from '@mxf-dev/core/models/channel';
import { EventBus } from '@mxf-dev/core/events/EventBus';
import taskRoutes from '../../../src/server/api/routes/tasks';

type PrincipalName = 'agent-a' | 'user-a' | 'user-b' | 'admin';

const channelDocuments: Record<string, {
    channelId: string;
    createdBy: string;
    allowedTools: string[];
    systemLlmEnabled: boolean;
}> = {
    'channel-a': {
        channelId: 'channel-a',
        createdBy: 'user-a',
        allowedTools: ['task_complete'],
        systemLlmEnabled: false
    },
    'channel-b': {
        channelId: 'channel-b',
        createdBy: 'user-b',
        allowedTools: [],
        systemLlmEnabled: true
    }
};

const attachTestPrincipal = (req: Request, _res: Response, next: NextFunction): void => {
    const principal = req.header('x-test-principal') as PrincipalName | undefined;

    if (principal === 'agent-a') {
        Object.assign(req, {
            authType: 'key',
            agent: { agentId: 'agent-a', channelId: 'channel-a', keyId: 'key-a' }
        });
    } else if (principal === 'admin') {
        Object.assign(req, {
            authType: 'jwt',
            user: { id: 'admin', role: 'admin' }
        });
    } else if (principal === 'user-a' || principal === 'user-b') {
        Object.assign(req, {
            authType: 'jwt',
            user: { id: principal, role: 'consumer' }
        });
    }

    next();
};

const buildApp = (): express.Express => {
    const app = express();
    app.use(express.json());
    app.use(attachTestPrincipal);
    app.use('/tasks', taskRoutes);
    return app;
};

describe('task REST tenant authorization', () => {
    beforeEach(() => {
        jest.clearAllMocks();

        (Channel.findOne as jest.Mock).mockImplementation(
            ({ channelId }: { channelId: string }) => Promise.resolve(channelDocuments[channelId] ?? null)
        );
        (Channel.find as jest.Mock).mockImplementation(({ createdBy }: { createdBy: string }) => {
            const lean = jest.fn().mockResolvedValue(
                Object.values(channelDocuments).filter(channel => channel.createdBy === createdBy)
            );
            return { select: jest.fn().mockReturnValue({ lean }) };
        });

        mockTaskService.createTask.mockResolvedValue({ id: 'task-a', channelId: 'channel-a' });
        mockTaskService.getTasks.mockResolvedValue([]);
        mockTaskService.getTasksInChannels.mockResolvedValue([]);
        mockTaskService.getTaskChannelId.mockImplementation(async (taskId: string) => {
            if (taskId === 'task-a') return 'channel-a';
            if (taskId === 'task-b') return 'channel-b';
            return null;
        });
        mockTaskService.getTaskInChannel.mockImplementation(async (taskId: string, channelId: string) => ({
            id: taskId,
            channelId,
            title: 'Scoped task'
        }));
        mockTaskService.updateTaskInChannel.mockResolvedValue({ id: 'task-a', channelId: 'channel-a' });
        mockTaskService.assignTaskInChannel.mockResolvedValue({
            id: 'task-a', channelId: 'channel-a', assignedAgentId: 'agent-a', status: 'assigned'
        });
        mockTaskService.transitionTaskAsOwnerInChannel.mockResolvedValue({
            id: 'task-a', channelId: 'channel-a', status: 'cancelled'
        });
        mockTaskService.assignTaskIntelligentlyInChannel.mockResolvedValue({
            taskId: 'task-a',
            assignedAgentId: 'agent-a',
            strategy: 'intelligent',
            confidence: 1,
            reasoning: 'test',
            assignedAt: Date.now()
        });
    });

    it('rejects a key creating a task in a different channel before mutation', async () => {
        const response = await supertest(buildApp())
            .post('/tasks')
            .set('x-test-principal', 'agent-a')
            .set('Content-Type', 'application/json')
            .send({
                channelId: 'channel-b',
                title: 'Foreign task',
                description: 'Must not be created'
            });

        expect(response.status).toBe(403);
        expect(mockTaskService.createTask).not.toHaveBeenCalled();
    });

    it('derives a key-authenticated creator only from req.agent', async () => {
        const response = await supertest(buildApp())
            .post('/tasks')
            .set('x-test-principal', 'agent-a')
            .set('x-agent-id', 'victim-agent')
            .set('Content-Type', 'application/json')
            .send({
                channelId: 'channel-a',
                title: 'Owned task',
                description: 'Allowed'
            });

        expect(response.status).toBe(201);
        expect(mockTaskService.createTask).toHaveBeenCalledWith(
            {
                channelId: 'channel-a',
                title: 'Owned task',
                description: 'Allowed'
            },
            'agent-a'
        );
        expect(mockHydrateChannelRuntimePolicy).toHaveBeenCalledWith(channelDocuments['channel-a']);
        expect(mockHydrateChannelRuntimePolicy.mock.invocationCallOrder[0])
            .toBeLessThan(mockTaskService.createTask.mock.invocationCallOrder[0]);
    });

    it('preserves designated completion authority through the create parser', async () => {
        const response = await supertest(buildApp())
            .post('/tasks')
            .set('x-test-principal', 'agent-a')
            .set('Content-Type', 'application/json')
            .send({
                channelId: 'channel-a',
                title: 'Reviewed task',
                description: 'A designated assignee reports the outcome',
                assignedAgentIds: ['agent-a'],
                completionAgentId: 'agent-a'
            });

        expect(response.status).toBe(201);
        expect(mockTaskService.createTask).toHaveBeenCalledWith(
            expect.objectContaining({
                assignedAgentIds: ['agent-a'],
                completionAgentId: 'agent-a'
            }),
            'agent-a'
        );
    });

    it.each([
        ['createdBy', 'victim-user'],
        ['status', 'completed'],
        ['result', { success: true }]
    ])('rejects model-only create field %s before authorization or mutation', async (field, value) => {
        const response = await supertest(buildApp())
            .post('/tasks')
            .set('x-test-principal', 'agent-a')
            .set('Content-Type', 'application/json')
            .send({
                channelId: 'channel-a',
                title: 'Smuggled task',
                description: 'Must be rejected',
                [field]: value
            });

        expect(response.status).toBe(400);
        expect(response.body.error).toMatch(new RegExp(`unsupported field.*${field}`, 'i'));
        expect(Channel.findOne).not.toHaveBeenCalled();
        expect(mockTaskService.createTask).not.toHaveBeenCalled();
    });

    it('applies an agent key channel predicate to an unfiltered collection query', async () => {
        const response = await supertest(buildApp())
            .get('/tasks')
            .set('x-test-principal', 'agent-a');

        expect(response.status).toBe(200);
        expect(mockTaskService.getTasksInChannels).toHaveBeenCalledWith({}, ['channel-a']);
        expect(mockTaskService.getTasks).not.toHaveBeenCalled();
    });

    it('rejects a foreign collection filter before querying tasks', async () => {
        const response = await supertest(buildApp())
            .get('/tasks?channelId=channel-b')
            .set('x-test-principal', 'agent-a');

        expect(response.status).toBe(403);
        expect(mockTaskService.getTasksInChannels).not.toHaveBeenCalled();
        expect(mockTaskService.getTasks).not.toHaveBeenCalled();
    });

    it('applies a normal user owned-channel predicate to an unfiltered collection query', async () => {
        const response = await supertest(buildApp())
            .get('/tasks')
            .set('x-test-principal', 'user-a');

        expect(response.status).toBe(200);
        expect(Channel.find).toHaveBeenCalledWith({ createdBy: 'user-a', active: true });
        expect(mockTaskService.getTasksInChannels).toHaveBeenCalledWith({}, ['channel-a']);
        expect(mockTaskService.getTasks).not.toHaveBeenCalled();
    });

    it('allows only an administrator to issue an unrestricted collection query', async () => {
        const response = await supertest(buildApp())
            .get('/tasks')
            .set('x-test-principal', 'admin');

        expect(response.status).toBe(200);
        expect(mockTaskService.getTasks).toHaveBeenCalledWith({});
        expect(mockTaskService.getTasksInChannels).not.toHaveBeenCalled();
    });

    it.each<PrincipalName>(['agent-a', 'user-a'])(
        'conceals a foreign task from %s and performs zero mutation',
        async (principal) => {
            const response = await supertest(buildApp())
                .patch('/tasks/task-b')
                .set('x-test-principal', principal)
                .set('Content-Type', 'application/json')
                .send({ priority: 'high' });

            expect(response.status).toBe(404);
            expect(mockTaskService.getTaskChannelId).toHaveBeenCalledWith('task-b');
            expect(mockTaskService.updateTaskInChannel).not.toHaveBeenCalled();
        }
    );

    it('blocks foreign intelligent assignment before LLM-backed assignment work', async () => {
        const response = await supertest(buildApp())
            .post('/tasks/task-b/assign-intelligent')
            .set('x-test-principal', 'agent-a')
            .set('Content-Type', 'application/json');

        expect(response.status).toBe(404);
        expect(mockTaskService.assignTaskIntelligentlyInChannel).not.toHaveBeenCalled();
    });

    it('hydrates a cold disabled task channel before intelligent assignment work', async () => {
        const response = await supertest(buildApp())
            .post('/tasks/task-a/assign-intelligent')
            .set('x-test-principal', 'user-a')
            .set('Content-Type', 'application/json');

        expect(response.status).toBe(200);
        expect(mockHydrateChannelRuntimePolicy).toHaveBeenCalledWith(channelDocuments['channel-a']);
        expect(mockHydrateChannelRuntimePolicy.mock.invocationCallOrder[0])
            .toBeLessThan(
                mockTaskService.assignTaskIntelligentlyInChannel.mock.invocationCallOrder[0]
            );
        expect(EventBus.server.emit).not.toHaveBeenCalled();
    });

    it('passes an authorized mutation through a channel-scoped service method', async () => {
        const response = await supertest(buildApp())
            .patch('/tasks/task-a')
            .set('x-test-principal', 'user-a')
            .set('Content-Type', 'application/json')
            .send({ priority: 'high' });

        expect(response.status).toBe(200);
        expect(mockTaskService.updateTaskInChannel).toHaveBeenCalledWith(
            'task-a',
            'channel-a',
            { priority: 'high' }
        );
    });

    it('rejects a channelId smuggled into PATCH before lookup and performs zero mutation', async () => {
        const response = await supertest(buildApp())
            .patch('/tasks/task-a')
            .set('x-test-principal', 'user-a')
            .set('Content-Type', 'application/json')
            .send({ priority: 'high', channelId: 'channel-b' });

        expect(response.status).toBe(400);
        expect(response.body.error).toMatch(/unsupported field.*channelId/i);
        expect(mockTaskService.getTaskChannelId).not.toHaveBeenCalled();
        expect(mockTaskService.updateTaskInChannel).not.toHaveBeenCalled();
    });

    it.each([
        [{ status: 'made_up' }, /dedicated lifecycle operation/i],
        [{ status: 'completed' }, /dedicated lifecycle operation/i],
        [{ assignedAgentId: 'agent-a' }, /dedicated assignment operation/i],
        [{ progress: 101 }, /progress must be at most 100/i]
    ])('rejects lifecycle or invalid PATCH values before lookup', async (body, expectedError) => {
        const response = await supertest(buildApp())
            .patch('/tasks/task-a')
            .set('x-test-principal', 'user-a')
            .set('Content-Type', 'application/json')
            .send(body);

        expect(response.status).toBe(400);
        expect(response.body.error).toMatch(expectedError);
        expect(mockTaskService.getTaskChannelId).not.toHaveBeenCalled();
        expect(mockTaskService.updateTaskInChannel).not.toHaveBeenCalled();
    });

    it('rejects channel-key lifecycle PATCH before task lookup or mutation', async () => {
        const response = await supertest(buildApp())
            .patch('/tasks/task-a')
            .set('x-test-principal', 'agent-a')
            .set('Content-Type', 'application/json')
            .send({ status: 'cancelled' });

        expect(response.status).toBe(400);
        expect(response.body.error).toMatch(/dedicated lifecycle operation/i);
        expect(mockTaskService.getTaskChannelId).not.toHaveBeenCalled();
        expect(mockTaskService.updateTaskInChannel).not.toHaveBeenCalled();
    });

    it('allows an owning user through the explicit lifecycle transition route', async () => {
        const response = await supertest(buildApp())
            .post('/tasks/task-a/transition')
            .set('x-test-principal', 'user-a')
            .set('Content-Type', 'application/json')
            .send({ action: 'cancel', reason: 'no longer needed' });

        expect(response.status).toBe(200);
        expect(mockTaskService.transitionTaskAsOwnerInChannel).toHaveBeenCalledWith(
            'task-a',
            'channel-a',
            'user-a',
            { kind: 'cancel', reason: 'no longer needed' }
        );
    });

    it('denies a channel-key agent the owner/admin transition route', async () => {
        const response = await supertest(buildApp())
            .post('/tasks/task-a/transition')
            .set('x-test-principal', 'agent-a')
            .set('Content-Type', 'application/json')
            .send({ action: 'complete', result: { answer: 42 } });

        expect(response.status).toBe(404);
        expect(mockTaskService.transitionTaskAsOwnerInChannel).not.toHaveBeenCalled();
    });

    it('uses the dedicated atomic assignment operation', async () => {
        const response = await supertest(buildApp())
            .post('/tasks/task-a/assign')
            .set('x-test-principal', 'user-a')
            .set('Content-Type', 'application/json')
            .send({ agentId: 'agent-a' });

        expect(response.status).toBe(200);
        expect(mockTaskService.assignTaskInChannel).toHaveBeenCalledWith(
            'task-a', 'channel-a', 'agent-a', 'user-a'
        );
        expect(mockTaskService.updateTaskInChannel).not.toHaveBeenCalled();
    });
});
