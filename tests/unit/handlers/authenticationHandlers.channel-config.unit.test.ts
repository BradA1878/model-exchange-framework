/**
 * The key-auth success response is the only way an SDK agent learns its
 * channel's SystemLLM settings: a one-time snapshot at join. The stance has
 * to be in it, resolved the same way the server resolves it (channel override,
 * else the server default), or the agent's system prompt tells it the wrong
 * thing about whether challenges are coming.
 */

const mockFindOne = jest.fn();
const mockIsChannelSystemLlmEnabled = jest.fn();
const mockGetChannelSystemLlmStance = jest.fn();
const mockGetActiveAgentsInChannel = jest.fn();

jest.mock('@mxf-dev/core/utils/Logger', () => {
    const child = (): Record<string, unknown> => ({
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
        child: jest.fn(() => child())
    });
    return {
        Logger: jest.fn().mockImplementation(() => child()),
        logger: child(),
        __esModule: true,
        default: child()
    };
});

jest.mock('@mxf-dev/core/models/channel', () => ({
    Channel: { findOne: mockFindOne }
}));

jest.mock('@mxf-dev/core/models/user', () => ({ User: { findOne: jest.fn() } }));
jest.mock('bcrypt', () => ({ compare: jest.fn() }));
jest.mock('../../../src/server/utils/keyAuthHelper', () => ({ __esModule: true, default: {} }));
jest.mock('../../../src/server/api/services/PersonalAccessTokenService', () => ({
    PersonalAccessTokenService: { getInstance: jest.fn() }
}));
jest.mock('../../../src/server/api/security/jwtTokenPolicy', () => ({ verifySessionToken: jest.fn() }));
jest.mock('../../../src/server/socket/security/SocketPasswordRateLimiter', () => ({
    consumeSocketPasswordAttempt: jest.fn()
}));
jest.mock('../../../src/server/socket/handlers/utilityHandlers', () => ({
    getNormalizedChannelName: jest.fn((channelId: string) => channelId)
}));

jest.mock('@mxf-dev/core/config/ConfigManager', () => ({
    ConfigManager: {
        getInstance: (): {
            isChannelSystemLlmEnabled: typeof mockIsChannelSystemLlmEnabled;
            getChannelSystemLlmStance: typeof mockGetChannelSystemLlmStance;
        } => ({
            isChannelSystemLlmEnabled: mockIsChannelSystemLlmEnabled,
            getChannelSystemLlmStance: mockGetChannelSystemLlmStance
        })
    }
}));

jest.mock('../../../src/server/socket/services/AgentService', () => ({
    AgentService: {
        getInstance: (): { getActiveAgentsInChannel: typeof mockGetActiveAgentsInChannel } => ({
            getActiveAgentsInChannel: mockGetActiveAgentsInChannel
        })
    }
}));

import { AuthEvents } from '@mxf-dev/core/events/EventNames';
import { sendAuthResponse } from '../../../src/server/socket/handlers/authenticationHandlers';

interface EmittedAuthSuccess {
    channelConfig: {
        channelId: string;
        systemLlmEnabled: boolean;
        systemLlmStance: string;
    } | null;
}

const fakeSocket = (channelId: string): { emit: jest.Mock; data: Record<string, unknown> } => ({
    emit: jest.fn(),
    data: { authType: 'key', channelId }
});

describe('authenticationHandlers key-auth channel config', () => {
    beforeEach(() => {
        mockFindOne.mockReset();
        mockIsChannelSystemLlmEnabled.mockReset();
        mockGetChannelSystemLlmStance.mockReset();
        mockGetActiveAgentsInChannel.mockReset();
        mockGetActiveAgentsInChannel.mockResolvedValue([]);
        mockFindOne.mockReturnValue({
            exec: (): Promise<Record<string, unknown>> => Promise.resolve({
                channelId: 'ch-1',
                name: 'Channel One',
                description: 'd',
                showActiveAgents: false
            })
        });
    });

    it('sends the effective SystemLLM stance alongside the enabled flag', async () => {
        mockIsChannelSystemLlmEnabled.mockReturnValue(true);
        mockGetChannelSystemLlmStance.mockReturnValue('critical');
        const socket = fakeSocket('ch-1');

        await sendAuthResponse(socket as never, 'agent-1', {});

        expect(mockGetChannelSystemLlmStance).toHaveBeenCalledWith('ch-1');
        expect(socket.emit).toHaveBeenCalledWith(AuthEvents.SUCCESS, expect.objectContaining({
            agentId: 'agent-1',
            authType: 'key'
        }));
        const emitted = socket.emit.mock.calls[0][1] as EmittedAuthSuccess;
        expect(emitted.channelConfig).toEqual(expect.objectContaining({
            channelId: 'ch-1',
            systemLlmEnabled: true,
            systemLlmStance: 'critical'
        }));
    });

    it('reports the resolved stance even when SystemLLM is off for the channel', async () => {
        // The stance is a property of the channel's configuration; the enabled
        // flag says whether it applies. Both travel so the SDK renders the truth.
        mockIsChannelSystemLlmEnabled.mockReturnValue(false);
        mockGetChannelSystemLlmStance.mockReturnValue('hostile');
        const socket = fakeSocket('ch-1');

        await sendAuthResponse(socket as never, 'agent-1', {});

        const emitted = socket.emit.mock.calls[0][1] as EmittedAuthSuccess;
        expect(emitted.channelConfig).toEqual(expect.objectContaining({
            systemLlmEnabled: false,
            systemLlmStance: 'hostile'
        }));
    });
});
