/**
 * The /effectiveness router is mounted behind requireAdmin, but the
 * controllers read agent and channel ids straight from the query string. They
 * must refuse any principal that is not an administrator on their own, so a
 * different mount or a reused export cannot expose cross-tenant metrics.
 */

import type { Request, Response } from 'express';

const getTaskMetrics = jest.fn();
const compareWithBaseline = jest.fn();
const getChannelAnalytics = jest.fn();
const getAgentMetrics = jest.fn();
const getAgentAnalytics = jest.fn();
const compareTasks = jest.fn();
const getTrends = jest.fn();

jest.mock('@mxf-dev/core/services/TaskEffectivenessService', () => ({
    TaskEffectivenessService: {
        getInstance: jest.fn(() => ({
            getTaskMetrics,
            compareWithBaseline,
            getChannelAnalytics,
            getAgentMetrics,
            getAgentAnalytics,
            compareTasks,
            getTrends
        }))
    }
}));

jest.mock('@mxf-dev/core/utils/Logger', () => ({
    Logger: jest.fn().mockImplementation(() => ({
        info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn()
    }))
}));

import { UserRole } from '@mxf-dev/core/models/user';
import {
    compareTaskEffectiveness,
    getAgentEffectiveness,
    getChannelEffectivenessAnalytics,
    getEffectivenessTrends,
    getTaskEffectiveness
} from '../../../src/server/api/controllers/taskEffectivenessController';

const makeResponse = (): Response => {
    const response = { status: jest.fn(), json: jest.fn() } as unknown as Response;
    (response.status as jest.Mock).mockReturnValue(response);
    return response;
};

const request = (auth: Record<string, unknown>): Request => ({
    ...auth,
    params: { taskId: 'task-1', channelId: 'channel-b', agentId: 'agent-b' },
    query: { agentId: 'agent-b', channelId: 'channel-b', taskIds: 'task-1,task-2' },
    body: {}
}) as unknown as Request;

const handlers = [
    ['getTaskEffectiveness', getTaskEffectiveness],
    ['getChannelEffectivenessAnalytics', getChannelEffectivenessAnalytics],
    ['getAgentEffectiveness', getAgentEffectiveness],
    ['compareTaskEffectiveness', compareTaskEffectiveness],
    ['getEffectivenessTrends', getEffectivenessTrends]
] as const;

const serviceCalls = (): number =>
    [getTaskMetrics, compareWithBaseline, getChannelAnalytics, getAgentMetrics,
        getAgentAnalytics, compareTasks, getTrends]
        .reduce((count, mock) => count + mock.mock.calls.length, 0);

describe('taskEffectivenessController authorization', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it.each(handlers)('%s refuses an agent key with 403 before reading any metrics', async (_name, handler) => {
        const response = makeResponse();

        await handler(request({
            authType: 'key',
            agent: { agentId: 'agent-a', channelId: 'channel-a', keyId: 'key-a' }
        }), response);

        expect(response.status).toHaveBeenCalledWith(403);
        expect(serviceCalls()).toBe(0);
    });

    it.each(handlers)('%s refuses a non-administrator user with 403', async (_name, handler) => {
        const response = makeResponse();

        await handler(request({
            authType: 'jwt',
            user: { id: 'user-a', role: UserRole.CONSUMER }
        }), response);

        expect(response.status).toHaveBeenCalledWith(403);
        expect(serviceCalls()).toBe(0);
    });

    it('answers 401 to an unauthenticated request', async () => {
        const response = makeResponse();

        await getTaskEffectiveness(request({}), response);

        expect(response.status).toHaveBeenCalledWith(401);
        expect(serviceCalls()).toBe(0);
    });

    it('serves an administrator', async () => {
        getTaskMetrics.mockResolvedValue({ taskId: 'task-1' });
        compareWithBaseline.mockResolvedValue({ delta: 0 });
        const response = makeResponse();

        await getTaskEffectiveness(request({
            authType: 'jwt',
            user: { id: 'admin-1', role: UserRole.ADMIN }
        }), response);

        expect(response.status).not.toHaveBeenCalledWith(401);
        expect(response.status).not.toHaveBeenCalledWith(403);
        expect(getTaskMetrics).toHaveBeenCalledWith('task-1', 'agent-b', 'channel-b');
    });
});
