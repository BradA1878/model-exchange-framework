const mockAddParticipant = jest.fn<Promise<boolean>, [string, string, string]>();
const mockRemoveParticipant = jest.fn<Promise<void>, [string, string, string]>();
jest.mock('../../../src/server/socket/services/ChannelService', () => ({
    ChannelService: { getInstance: (): object => ({
        addParticipant: mockAddParticipant,
        removeParticipant: mockRemoveParticipant
    }) }
}));

import { AgentChannelMembershipService } from '../../../src/server/socket/services/AgentChannelMembershipService';

const deferred = <T>(): { promise: Promise<T>; resolve: (value: T) => void } => {
    let resolve!: (value: T) => void;
    return { promise: new Promise<T>(complete => { resolve = complete; }), resolve };
};

describe('AgentChannelMembershipService socket membership', () => {
    beforeEach(() => {
        mockAddParticipant.mockReset().mockResolvedValue(true);
        mockRemoveParticipant.mockReset().mockResolvedValue(undefined);
    });

    it('last leave waits for an in-flight add before removing the participant', async () => {
        const service = new AgentChannelMembershipService();
        const entered = deferred<void>();
        const added = deferred<boolean>();
        mockAddParticipant.mockImplementationOnce((): Promise<boolean> => {
            entered.resolve();
            return added.promise;
        });
        const joining = service.acquire('agent-a', 'channel-a', 'socket-a').catch((error: unknown) => error);
        await entered.promise;
        const leaving = service.release('socket-a');
        await Promise.resolve();
        expect(mockRemoveParticipant).not.toHaveBeenCalled();
        added.resolve(true);
        await leaving;
        expect(await joining).toEqual(expect.objectContaining({ message: 'Socket disconnected during channel admission' }));
        expect(mockRemoveParticipant).toHaveBeenCalledTimes(1);
        expect(mockRemoveParticipant).toHaveBeenCalledWith('channel-a', 'agent-a', 'agent-a');
    });

    it('a new join waits for the old remove before adding the participant again', async () => {
        const service = new AgentChannelMembershipService();
        await service.acquire('agent-a', 'channel-a', 'old-socket');
        const entered = deferred<void>();
        const removed = deferred<void>();
        mockRemoveParticipant.mockImplementationOnce((): Promise<void> => {
            entered.resolve();
            return removed.promise;
        });
        const leaving = service.release('old-socket');
        await entered.promise;
        const joining = service.acquire('agent-a', 'channel-a', 'new-socket');
        await Promise.resolve();
        expect(mockAddParticipant).toHaveBeenCalledTimes(1);
        removed.resolve();
        await Promise.all([leaving, joining]);
        expect(mockAddParticipant).toHaveBeenCalledTimes(2);
        await service.release('new-socket');
        expect(mockRemoveParticipant).toHaveBeenCalledTimes(2);
    });

    it('two sockets keep the participant until the last socket leaves', async () => {
        const service = new AgentChannelMembershipService();
        await Promise.all([
            service.acquire('agent-a', 'channel-a', 'socket-a'),
            service.acquire('agent-a', 'channel-a', 'socket-b')
        ]);
        await service.release('socket-a');
        expect(mockRemoveParticipant).not.toHaveBeenCalled();
        await service.release('socket-b');
        await service.release('socket-b');
        expect(mockRemoveParticipant).toHaveBeenCalledTimes(1);
        expect(mockRemoveParticipant).toHaveBeenCalledWith('channel-a', 'agent-a', 'agent-a');
    });

    it('channel identity is retained across independent agent memberships', async () => {
        const service = new AgentChannelMembershipService();
        await Promise.all([
            service.acquire('agent-a', 'channel-a', 'socket-a'),
            service.acquire('agent-a', 'channel-b', 'socket-b'),
            service.acquire('agent-b', 'channel-a', 'socket-c')
        ]);
        await service.release('socket-a');
        expect(mockRemoveParticipant.mock.calls).toEqual([['channel-a', 'agent-a', 'agent-a']]);
        await service.release('socket-c');
        expect(mockRemoveParticipant.mock.calls[1]).toEqual(['channel-a', 'agent-b', 'agent-b']);
        await service.release('socket-b');
        expect(mockRemoveParticipant.mock.calls[2]).toEqual(['channel-b', 'agent-a', 'agent-a']);
    });

    it.each(['false', 'reject'])('cleanup runs after an add fails by %s and later admission can succeed', async mode => {
        const service = new AgentChannelMembershipService();
        if (mode === 'false') mockAddParticipant.mockResolvedValueOnce(false);
        else mockAddParticipant.mockRejectedValueOnce(new Error('Channel persistence failed'));
        await expect(service.acquire('agent-a', 'channel-a', 'bad-socket')).rejects.toThrow();
        await service.release('bad-socket');
        expect(mockRemoveParticipant).toHaveBeenCalledWith('channel-a', 'agent-a', 'agent-a');
        await service.acquire('agent-a', 'channel-a', 'good-socket');
        await service.release('good-socket');
        expect(mockAddParticipant).toHaveBeenCalledTimes(2);
        expect(mockRemoveParticipant).toHaveBeenCalledTimes(2);
    });

    it('a socket removed before its queued admission never calls addParticipant', async () => {
        const service = new AgentChannelMembershipService();
        const joining = service.acquire('agent-a', 'channel-a', 'socket-a').catch((error: unknown) => error);
        await service.release('socket-a');
        expect(await joining).toEqual(expect.objectContaining({ message: 'Socket disconnected before channel admission' }));
        expect(mockAddParticipant).not.toHaveBeenCalled();
        expect(mockRemoveParticipant).toHaveBeenCalledTimes(1);
    });
});
