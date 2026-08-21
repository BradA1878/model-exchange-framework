const mockLean = jest.fn();
const mockSelect = jest.fn(() => ({ lean: mockLean }));
const mockFindOne = jest.fn(() => ({ select: mockSelect }));
const mockTaskLean = jest.fn();
const mockTaskSelect = jest.fn(() => ({ lean: mockTaskLean }));
const mockTaskFind = jest.fn(() => ({ select: mockTaskSelect }));

jest.mock('@mxf-dev/core/models/channel', () => ({
    Channel: { findOne: mockFindOne }
}));
jest.mock('@mxf-dev/core/models/task', () => ({
    Task: { find: mockTaskFind }
}));

import {
    assertTaskAgentsBelongToChannel,
    assertTaskDependenciesBelongToChannel
} from '../../../src/server/socket/services/TaskParticipantPolicy';

describe('TaskParticipantPolicy', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockLean.mockResolvedValue({ participants: ['agent-a', 'agent-b'] });
        mockTaskLean.mockResolvedValue([{ _id: 'task-a' }, { _id: 'task-b' }]);
    });

    it('allows explicit offline agents that are persisted channel participants', async () => {
        await expect(assertTaskAgentsBelongToChannel(
            'channel-a',
            ['agent-a', 'agent-b', 'agent-a']
        )).resolves.toBeUndefined();

        expect(mockFindOne).toHaveBeenCalledWith({ channelId: 'channel-a', active: true });
        expect(mockSelect).toHaveBeenCalledWith('participants');
    });

    it('rejects every foreign assignment before task persistence', async () => {
        await expect(assertTaskAgentsBelongToChannel(
            'channel-a',
            ['foreign-agent', 'agent-a']
        )).rejects.toThrow(/not participants.*foreign-agent/i);
    });

    it('fails closed when the active channel cannot be loaded', async () => {
        mockLean.mockResolvedValueOnce(null);

        await expect(assertTaskAgentsBelongToChannel(
            'channel-a',
            ['agent-a']
        )).rejects.toThrow(/active channel channel-a was not found/i);
    });

    it('does not query Mongo when no explicit agent was requested', async () => {
        await expect(assertTaskAgentsBelongToChannel(
            'channel-a',
            [undefined]
        )).resolves.toBeUndefined();

        expect(mockFindOne).not.toHaveBeenCalled();
    });

    it('requires every dependency to resolve inside the exact channel', async () => {
        await expect(assertTaskDependenciesBelongToChannel(
            'channel-a',
            ['task-a', 'task-b']
        )).resolves.toBeUndefined();

        expect(mockTaskFind).toHaveBeenCalledWith({
            _id: { $in: ['task-a', 'task-b'] },
            channelId: 'channel-a'
        });
    });

    it('conceals a missing or foreign dependency as not found in the channel', async () => {
        mockTaskLean.mockResolvedValueOnce([{ _id: 'task-a' }]);

        await expect(assertTaskDependenciesBelongToChannel(
            'channel-a',
            ['task-a', 'foreign-task']
        )).rejects.toThrow(/not found in channel channel-a.*foreign-task/i);
    });
});
