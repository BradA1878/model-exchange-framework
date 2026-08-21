const mockEventEmit = jest.fn();
const mockFindOne = jest.fn();
const mockFindOneAndUpdate = jest.fn();
const mockUpdateOne = jest.fn();
const mockSetChannelSystemLlmEnabled = jest.fn();
const mockClearChannelAllowedTools = jest.fn();
const mockHydrateChannelAllowedTools = jest.fn();
const mockDeactivateChannelKeys = jest.fn();
const mockRemoveServiceForChannel = jest.fn();
const mockRetireMcpChannel = jest.fn();
const mockUserExists = jest.fn();

jest.mock('@mxf-dev/core/events/EventBus', () => ({
    EventBus: {
        server: {
            on: jest.fn(),
            emit: mockEventEmit
        }
    }
}));

jest.mock('@mxf-dev/core/models/channel', () => {
    const Channel = Object.assign(jest.fn(), {
        findOne: mockFindOne,
        findOneAndUpdate: mockFindOneAndUpdate,
        updateOne: mockUpdateOne,
        exists: jest.fn()
    });
    return { Channel };
});

jest.mock('@mxf-dev/core/config/ConfigManager', () => ({
    ConfigManager: {
        getInstance: jest.fn(() => ({
            setChannelSystemLlmEnabled: mockSetChannelSystemLlmEnabled
        }))
    }
}));

jest.mock('@mxf-dev/core/models/user', () => ({
    User: { exists: mockUserExists },
    UserRole: { ADMIN: 'admin' }
}));

jest.mock('@mxf-dev/core/services/ChannelContextMessageOperations', () => ({
    ChannelContextMessageOperations: jest.fn(() => ({}))
}));

jest.mock('@mxf-dev/core/utils/Logger', () => ({
    Logger: jest.fn(() => ({
        info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn()
    }))
}));

jest.mock('@mxf-dev/core/utils/validation', () => ({
    createStrictValidator: jest.fn(() => ({
        assert: jest.fn((condition: unknown, message: string) => {
            if (!condition) throw new Error(message);
        }),
        assertIsNonEmptyString: jest.fn((value: unknown, message: string) => {
            if (typeof value !== 'string' || value.trim().length === 0) {
                throw new Error(message);
            }
        })
    }))
}));

jest.mock('../../../src/server/socket/services/McpService', () => ({
    McpService: {
        getInstance: jest.fn(() => ({
            clearChannelAllowedTools: mockClearChannelAllowedTools,
            hydrateChannelAllowedTools: mockHydrateChannelAllowedTools
        }))
    }
}));

jest.mock('../../../src/server/socket/services/ChannelKeyService', () => ({
    __esModule: true,
    default: { deactivateChannelKeys: mockDeactivateChannelKeys }
}));

jest.mock('../../../src/server/socket/services/SystemLlmServiceManager', () => ({
    SystemLlmServiceManager: {
        getInstance: jest.fn(() => ({
            removeServiceForChannel: mockRemoveServiceForChannel
        }))
    }
}));

jest.mock('../../../src/server/api/services/ServerHybridMcpService', () => ({
    ServerHybridMcpService: {
        getExistingInstance: jest.fn(() => ({
            getExternalServerManager: jest.fn(() => ({
                retireChannel: mockRetireMcpChannel
            }))
        }))
    }
}));

import { Events } from '@mxf-dev/core/events/EventNames';
import {
    ChannelDeletionCleanupError,
    ChannelService
} from '../../../src/server/socket/services/ChannelService';

interface MockSocket {
    id: string;
    data: { agentId: string; channelId: string };
    disconnect: jest.Mock;
}

const makeSocket = (id: string, agentId: string, channelId: string): MockSocket => ({
    id,
    data: { agentId, channelId },
    disconnect: jest.fn()
});

describe('ChannelService terminal deletion lifecycle', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (ChannelService as unknown as { instance?: ChannelService }).instance = undefined;
        mockFindOne.mockReset();
        mockFindOneAndUpdate.mockReset();
        mockFindOne.mockResolvedValue(null);
        mockUpdateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
        mockDeactivateChannelKeys.mockResolvedValue(2);
        mockRetireMcpChannel.mockResolvedValue(undefined);
        mockUserExists.mockResolvedValue({ _id: 'admin-id' });
    });

    it('soft-deactivates a cold channel, revokes runtime state, and emits once', async () => {
        mockFindOneAndUpdate
            .mockResolvedValueOnce({
                channelId: 'channel-a',
                active: false,
                createdBy: 'owner-a'
            })
            .mockResolvedValueOnce({
                channelId: 'channel-a',
                active: false,
                createdBy: 'owner-a',
                metadata: { deletionCleanupStatus: 'completed' }
            });
        const deletedSocket = makeSocket('socket-a', 'agent-a', 'channel-a');
        const otherSocket = makeSocket('socket-b', 'agent-b', 'channel-b');
        const disconnectRoom = jest.fn();
        const io = {
            sockets: {
                sockets: new Map([
                    [deletedSocket.id, deletedSocket],
                    [otherSocket.id, otherSocket]
                ])
            },
            in: jest.fn(() => ({ disconnectSockets: disconnectRoom }))
        };
        const service = ChannelService.getInstance(io as never);

        await expect(service.deleteChannel('channel-a', 'owner-a', 'retired'))
            .resolves.toBe(true);

        expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
            { channelId: 'channel-a', active: true, createdBy: 'owner-a' },
            {
                $set: expect.objectContaining({
                    active: false,
                    systemLlmEnabled: false,
                    participants: [],
                    'metadata.deletedBy': 'owner-a',
                    'metadata.deletionCleanupStatus': 'pending',
                    'metadata.deletionReason': 'retired'
                })
            },
            { new: true }
        );
        expect(mockDeactivateChannelKeys).toHaveBeenCalledWith('channel-a');
        expect(deletedSocket.disconnect).toHaveBeenCalledWith(true);
        expect(otherSocket.disconnect).not.toHaveBeenCalled();
        expect(io.in).toHaveBeenCalledWith('channel:channel-a');
        expect(disconnectRoom).toHaveBeenCalledWith(true);
        expect(mockClearChannelAllowedTools).toHaveBeenCalledWith('channel-a');
        expect(mockSetChannelSystemLlmEnabled).toHaveBeenCalledWith(
            false,
            'channel-a',
            'Channel deleted'
        );
        expect(mockRemoveServiceForChannel).toHaveBeenCalledWith('channel-a');
        expect(mockRetireMcpChannel).toHaveBeenCalledWith('channel-a');
        expect(mockUpdateOne).toHaveBeenCalledWith(
            { channelId: 'channel-a', active: false },
            {
                $set: {
                    'mcpServers.servers': [],
                    'mcpServers.updatedAt': expect.any(Date)
                }
            }
        );

        const deletedEmissions = mockEventEmit.mock.calls.filter(
            ([eventName]) => eventName === Events.Channel.DELETED
        );
        expect(deletedEmissions).toHaveLength(1);
        expect((service as unknown as { channels: Map<string, unknown> }).channels.has('channel-a'))
            .toBe(false);
        expect((service as unknown as { channelParticipants: Map<string, unknown> })
            .channelParticipants.has('channel-a')).toBe(false);
    });

    it('keeps an inactive id reserved and never re-enables its runtime policy', async () => {
        const io = {
            sockets: { sockets: new Map() },
            in: jest.fn(() => ({ disconnectSockets: jest.fn() }))
        };
        const service = ChannelService.getInstance(io as never);
        mockFindOne.mockResolvedValue({
            channelId: 'channel-a',
            active: false,
            createdBy: 'former-owner'
        });

        await expect(
            service.createChannel('channel-a', 'Taken over', 'attacker')
        ).resolves.toBeNull();

        expect(mockSetChannelSystemLlmEnabled).not.toHaveBeenCalledWith(
            true,
            'channel-a',
            expect.anything()
        );
    });

    it('does not emit a second deletion result for an already inactive channel', async () => {
        const io = {
            sockets: { sockets: new Map() },
            in: jest.fn(() => ({ disconnectSockets: jest.fn() }))
        };
        const service = ChannelService.getInstance(io as never);
        mockFindOneAndUpdate
            .mockResolvedValueOnce({ channelId: 'channel-a', active: false })
            .mockResolvedValueOnce({ channelId: 'channel-a', active: false })
            .mockResolvedValueOnce(null);
        mockFindOne.mockResolvedValue(null);

        await expect(service.deleteChannel('channel-a', 'owner-a')).resolves.toBe(true);
        await expect(service.deleteChannel('channel-a', 'owner-a')).resolves.toBe(false);

        expect(mockEventEmit.mock.calls.filter(
            ([eventName]) => eventName === Events.Channel.DELETED
        )).toHaveLength(1);
    });

    it('reports cleanup failure, keeps the tombstone pending, and retries idempotently', async () => {
        const io = {
            sockets: { sockets: new Map() },
            in: jest.fn(() => ({ disconnectSockets: jest.fn() }))
        };
        const service = ChannelService.getInstance(io as never);
        mockFindOneAndUpdate
            .mockResolvedValueOnce({ channelId: 'channel-a', active: false })
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce({
                channelId: 'channel-a',
                active: false,
                metadata: { deletionCleanupStatus: 'completed' }
            });
        mockFindOne.mockResolvedValue({
            channelId: 'channel-a',
            active: false,
            createdBy: 'owner-a',
            metadata: { deletionCleanupStatus: 'pending' }
        });
        mockDeactivateChannelKeys.mockRejectedValueOnce(new Error('key database unavailable'));

        await expect(service.deleteChannel('channel-a', 'owner-a'))
            .rejects.toEqual(expect.objectContaining({
                name: 'ChannelDeletionCleanupError',
                channelId: 'channel-a',
                failures: ['credential revocation']
            } satisfies Partial<ChannelDeletionCleanupError>));

        expect(mockEventEmit.mock.calls.filter(
            ([eventName]) => eventName === Events.Channel.DELETED
        )).toHaveLength(0);
        expect(mockUpdateOne).toHaveBeenCalledWith(
            expect.objectContaining({
                channelId: 'channel-a',
                active: false,
                'metadata.deletionCleanupStatus': 'pending'
            }),
            {
                $set: expect.objectContaining({
                    'metadata.deletionCleanupFailures': ['credential revocation']
                })
            }
        );

        await expect(service.deleteChannel('channel-a', 'owner-a')).resolves.toBe(true);
        expect(mockDeactivateChannelKeys).toHaveBeenCalledTimes(2);
        expect(mockEventEmit.mock.calls.filter(
            ([eventName]) => eventName === Events.Channel.DELETED
        )).toHaveLength(1);
    });

    it('cannot directly delete a channel owned by another principal', async () => {
        const io = {
            sockets: { sockets: new Map() },
            in: jest.fn(() => ({ disconnectSockets: jest.fn() }))
        };
        const service = ChannelService.getInstance(io as never);
        mockFindOneAndUpdate.mockResolvedValue(null);
        mockFindOne.mockResolvedValue(null);

        await expect(service.deleteChannel('victim-channel', 'attacker')).resolves.toBe(false);

        expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
            { channelId: 'victim-channel', active: true, createdBy: 'attacker' },
            expect.anything(),
            { new: true }
        );
        expect(mockDeactivateChannelKeys).not.toHaveBeenCalled();
    });

    it('requires a live persisted administrator for the explicit global path', async () => {
        const io = {
            sockets: { sockets: new Map() },
            in: jest.fn(() => ({ disconnectSockets: jest.fn() }))
        };
        const service = ChannelService.getInstance(io as never);
        mockUserExists.mockResolvedValue(null);

        await expect(
            service.deleteChannelAsAdministrator('victim-channel', 'not-an-admin')
        ).rejects.toThrow(/active administrator/i);

        expect(mockUserExists).toHaveBeenCalledWith({
            _id: 'not-an-admin',
            role: 'admin',
            isActive: true
        });
        expect(mockFindOneAndUpdate).not.toHaveBeenCalled();
    });

});
