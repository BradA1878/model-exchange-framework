import express from 'express';
import request from 'supertest';
import { CreateTaskRequest } from '@mxf-dev/core/types/TaskTypes';

const mockTaskService = {
    createTask: jest.fn(),
    updateTask: jest.fn(),
    assignTaskIntelligently: jest.fn()
};
const mockEmit = jest.fn();

jest.mock('../../../src/server/socket/services/TaskService', () => ({
    TaskService: { getInstance: (): typeof mockTaskService => mockTaskService }
}));
jest.mock('@mxf-dev/core/events/EventBus', () => ({ EventBus: { server: { emit: mockEmit } } }));
// Signing and ingress throttling have dedicated tests. This suite exercises
// the real routes after those middleware checks have accepted the request.
jest.mock('../../../src/server/api/middleware/webhookAuth', () => ({
    requireWebhookSecret: jest.fn(),
    authenticateWebhook: (_req: express.Request, _res: express.Response, next: express.NextFunction): void => next()
}));
jest.mock('../../../src/server/api/middleware/rateLimit', () => ({
    createWebhookRateLimiter: () => (_req: express.Request, _res: express.Response, next: express.NextFunction): void => next()
}));

import webhookRoutes from '../../../src/server/api/routes/n8nWebhooks';

describe('n8n task creation handoff', () => {
    const app = express();
    app.use(express.json());
    app.use(webhookRoutes);

    beforeEach(() => {
        jest.clearAllMocks();
        mockTaskService.createTask.mockImplementation(async (input: CreateTaskRequest) => ({
            ...input,
            id: 'persisted-task',
            status: input.assignedAgentId ? 'assigned' : 'pending'
        }));
    });

    it.each(['/task', '/task/batch'])('creates explicitly assigned %s tasks in one authoritative operation', async endpoint => {
        const response = await request(app).post(endpoint).set('Content-Type', 'application/json').send({
            channelId: 'channel-1', title: 'Process records', description: 'Process these records',
            assignTo: 'agent-1', items: [{ id: 1 }]
        });

        expect(response.status).toBe(201);
        expect(mockTaskService.createTask).toHaveBeenCalledTimes(1);
        expect(mockTaskService.createTask).toHaveBeenCalledWith(expect.objectContaining({
            channelId: 'channel-1', assignedAgentId: 'agent-1', assignmentStrategy: 'manual'
        }), 'n8n-webhook');
        expect(mockTaskService.updateTask).not.toHaveBeenCalled();
        expect(mockTaskService.assignTaskIntelligently).not.toHaveBeenCalled();
        expect(mockEmit).not.toHaveBeenCalled();
        expect(response.body.task).toEqual(expect.objectContaining({
            id: 'persisted-task', status: 'assigned', assignedAgentId: 'agent-1'
        }));
    });

    it.each(['/task', '/task/batch'])('leaves intelligent %s assignment to TaskService creation handling', async endpoint => {
        const response = await request(app).post(endpoint).set('Content-Type', 'application/json').send({
            channelId: 'channel-1', title: 'Process records', description: 'Process these records', items: [{ id: 1 }]
        });
        expect(response.status).toBe(201);
        expect(mockTaskService.createTask).toHaveBeenCalledWith(expect.objectContaining({
            assignmentStrategy: 'intelligent'
        }), 'n8n-webhook');
        expect(mockTaskService.assignTaskIntelligently).not.toHaveBeenCalled();
        expect(mockEmit).not.toHaveBeenCalled();
    });

    it.each(['/task', '/task/batch'])('rejects invalid assignment targets in %s before persistence', async endpoint => {
        const response = await request(app).post(endpoint).set('Content-Type', 'application/json').send({
            channelId: 'channel-1', title: 'Process records', description: 'Process these records',
            assignTo: { agentId: 'agent-1' }, items: [{ id: 1 }]
        });
        expect(response.status).toBe(400);
        expect(mockTaskService.createTask).not.toHaveBeenCalled();
    });
});
