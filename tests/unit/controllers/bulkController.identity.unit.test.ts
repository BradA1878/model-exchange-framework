/**
 * Bulk operations are administrator-only, but the controller must still derive
 * the acting identity from the authenticated request and never from a literal
 * placeholder or an unauthenticated caller.
 */

import type { Request, Response } from 'express';

const createChannel = jest.fn();
const createTask = jest.fn();

jest.mock('../../../src/server/socket/services/ChannelService', () => ({
    ChannelService: { getInstance: jest.fn(() => ({ createChannel })) }
}));

jest.mock('../../../src/server/socket/services/TaskService', () => ({
    TaskService: { getInstance: jest.fn(() => ({ createTask })) }
}));

jest.mock('@mxf-dev/core/events/EventBus', () => ({
    EventBus: { server: { emit: jest.fn(), on: jest.fn() } }
}));

jest.mock('@mxf-dev/core/utils/Logger', () => ({
    Logger: jest.fn().mockImplementation(() => ({
        info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn()
    }))
}));

import { bulkCreate, bulkUpdate } from '../../../src/server/api/controllers/bulkController';

const makeResponse = (): Response => {
    const response = { status: jest.fn(), json: jest.fn() } as unknown as Response;
    (response.status as jest.Mock).mockReturnValue(response);
    return response;
};

const makeRequest = (body: Record<string, unknown>, user?: { id: string }): Request =>
    ({ body, user }) as unknown as Request;

describe('bulkController identity', () => {
    beforeEach(() => {
        createChannel.mockReset();
        createTask.mockReset();
        createChannel.mockImplementation(async (channelId: string) => ({ channelId }));
        createTask.mockImplementation(async (item: Record<string, unknown>) => ({ id: 'task-1', ...item }));
    });

    it('rejects bulk create without an authenticated requester before touching any service', async () => {
        const response = makeResponse();

        await bulkCreate(makeRequest({ entityType: 'channel', items: [{ id: 'c1', name: 'C1' }] }), response);

        expect(response.status).toHaveBeenCalledWith(401);
        expect(createChannel).not.toHaveBeenCalled();
    });

    it('rejects bulk update without an authenticated requester before touching any service', async () => {
        const response = makeResponse();

        await bulkUpdate(makeRequest({ entityType: 'task', items: [{ id: 't1', status: 'completed' }] }), response);

        expect(response.status).toHaveBeenCalledWith(401);
        expect(createTask).not.toHaveBeenCalled();
    });

    it('attributes bulk-created channels and tasks to the requester when the item names no creator', async () => {
        const response = makeResponse();
        await bulkCreate(
            makeRequest({ entityType: 'channel', items: [{ id: 'c1', name: 'C1' }] }, { id: 'admin-1' }),
            response
        );
        await bulkCreate(
            makeRequest({ entityType: 'task', items: [{ title: 'T1', description: 'd', channelId: 'c1' }] }, { id: 'admin-1' }),
            response
        );

        expect(createChannel).toHaveBeenCalledWith('c1', 'C1', 'admin-1', undefined);
        expect(createTask).toHaveBeenCalledWith(expect.objectContaining({ title: 'T1' }), 'admin-1');
    });
});
