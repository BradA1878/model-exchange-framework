const mockFindOne = jest.fn();
const mockHydrateChannelAllowedTools = jest.fn();
const mockClearChannelAllowedTools = jest.fn();
const mockSetChannelSystemLlmEnabled = jest.fn();
const mockSetChannelSystemLlmStance = jest.fn();
const mockClearChannelSystemLlmStance = jest.fn();
const mockGetChannelSystemLlmStance = jest.fn();

jest.mock('@mxf-dev/core/models/channel', () => ({
    Channel: { findOne: mockFindOne }
}));

jest.mock('@mxf-dev/core/config/ConfigManager', () => ({
    ConfigManager: {
        getInstance: (): {
            setChannelSystemLlmEnabled: typeof mockSetChannelSystemLlmEnabled;
            setChannelSystemLlmStance: typeof mockSetChannelSystemLlmStance;
            clearChannelSystemLlmStance: typeof mockClearChannelSystemLlmStance;
            getChannelSystemLlmStance: typeof mockGetChannelSystemLlmStance;
        } => ({
            setChannelSystemLlmEnabled: mockSetChannelSystemLlmEnabled,
            setChannelSystemLlmStance: mockSetChannelSystemLlmStance,
            clearChannelSystemLlmStance: mockClearChannelSystemLlmStance,
            getChannelSystemLlmStance: mockGetChannelSystemLlmStance
        })
    }
}));

jest.mock('../../../src/server/socket/services/McpService', () => ({
    McpService: {
        getInstance: (): {
            hydrateChannelAllowedTools: typeof mockHydrateChannelAllowedTools;
            clearChannelAllowedTools: typeof mockClearChannelAllowedTools;
        } => ({
            hydrateChannelAllowedTools: mockHydrateChannelAllowedTools,
            clearChannelAllowedTools: mockClearChannelAllowedTools
        })
    }
}));

import {
    hydrateChannelRuntimePolicy,
    hydrateChannelSystemLlmStance,
    loadActiveChannelRuntimePolicy
} from '../../../src/server/api/security/ChannelRuntimePolicy';

describe('ChannelRuntimePolicy', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('hydrates restrictive tools and disabled SystemLLM from persistence', async () => {
        const channel = {
            channelId: 'channel-restricted',
            active: true,
            allowedTools: ['memory_get'],
            systemLlmEnabled: false
        };
        mockFindOne.mockResolvedValue(channel);

        await expect(loadActiveChannelRuntimePolicy('channel-restricted'))
            .resolves.toBe(channel);

        expect(mockFindOne).toHaveBeenCalledWith({
            channelId: 'channel-restricted',
            active: true
        });
        expect(mockHydrateChannelAllowedTools).toHaveBeenCalledWith(
            'channel-restricted',
            ['memory_get']
        );
        expect(mockSetChannelSystemLlmEnabled).toHaveBeenCalledWith(
            false,
            'channel-restricted',
            'Channel runtime policy loaded from persistence'
        );
    });

    it('hydrates an enabled channel and preserves empty channel allowlist semantics', () => {
        hydrateChannelRuntimePolicy({
            channelId: 'channel-open',
            allowedTools: [],
            systemLlmEnabled: true
        } as never);

        expect(mockHydrateChannelAllowedTools).toHaveBeenCalledWith('channel-open', []);
        expect(mockSetChannelSystemLlmEnabled).toHaveBeenCalledWith(
            true,
            'channel-open',
            undefined
        );
    });

    it('clears stale policy and disables SystemLLM for a missing or inactive channel', async () => {
        mockFindOne.mockResolvedValue(null);

        await expect(loadActiveChannelRuntimePolicy('channel-gone')).resolves.toBeNull();

        expect(mockClearChannelAllowedTools).toHaveBeenCalledWith('channel-gone');
        expect(mockSetChannelSystemLlmEnabled).toHaveBeenCalledWith(
            false,
            'channel-gone',
            'Channel is missing or inactive'
        );
        expect(mockHydrateChannelAllowedTools).not.toHaveBeenCalled();
    });

    it('hydrates a channel-specific critical stance from persistence', () => {
        hydrateChannelRuntimePolicy({
            channelId: 'channel-critical',
            allowedTools: [],
            systemLlmEnabled: true,
            systemLlmStance: 'critical'
        } as never);

        expect(mockSetChannelSystemLlmStance).toHaveBeenCalledWith('critical', 'channel-critical');
        expect(mockClearChannelSystemLlmStance).not.toHaveBeenCalled();
    });

    it('clears a channel-specific stance when persistence carries none', () => {
        hydrateChannelRuntimePolicy({
            channelId: 'channel-no-stance',
            allowedTools: [],
            systemLlmEnabled: true
        } as never);

        expect(mockClearChannelSystemLlmStance).toHaveBeenCalledWith('channel-no-stance');
        expect(mockSetChannelSystemLlmStance).not.toHaveBeenCalled();
    });

    it('refuses an invalid systemLlmStance value', () => {
        expect(() => hydrateChannelSystemLlmStance('ch', 'bogus'))
            .toThrow(/invalid systemLlmStance/i);
        expect(mockSetChannelSystemLlmStance).not.toHaveBeenCalled();
        expect(mockClearChannelSystemLlmStance).not.toHaveBeenCalled();
    });

    it('loads and hydrates an active channel carrying a hostile stance', async () => {
        const channel = {
            channelId: 'channel-hostile',
            active: true,
            allowedTools: [],
            systemLlmEnabled: true,
            systemLlmStance: 'hostile'
        };
        mockFindOne.mockResolvedValue(channel);

        await expect(loadActiveChannelRuntimePolicy('channel-hostile')).resolves.toBe(channel);

        expect(mockSetChannelSystemLlmStance).toHaveBeenCalledWith('hostile', 'channel-hostile');
    });
});
