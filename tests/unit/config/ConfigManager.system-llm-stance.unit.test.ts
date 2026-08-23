/**
 * SystemLLM stance storage on ConfigManager.
 *
 * Uses the real ConfigManager (not mocked) so the tests exercise the actual
 * get/set/clear logic and inheritance rules. Only EventBus is mocked, since
 * ConfigManager reaches it directly (EventBus.client.on/off/emit) to
 * subscribe to and publish configuration events.
 */

const mockClientEmit = jest.fn();
const mockClientOn = jest.fn();
const mockClientOff = jest.fn();

jest.mock('@mxf-dev/core/events/EventBus', () => ({
    EventBus: {
        client: {
            emit: mockClientEmit,
            on: mockClientOn,
            off: mockClientOff
        },
        server: {
            on: jest.fn(),
            emit: jest.fn(),
            off: jest.fn()
        }
    }
}));

import { ConfigManager, ConfigEvents, type ChannelSystemLlmChangeEvent } from '@mxf-dev/core/config/ConfigManager';

const resetConfigManagerSingleton = (): void => {
    (ConfigManager as unknown as { instance?: ConfigManager }).instance = undefined;
};

describe('ConfigManager SystemLLM stance', () => {
    beforeEach(() => {
        resetConfigManagerSingleton();
        mockClientEmit.mockClear();
        mockClientOn.mockClear();
        mockClientOff.mockClear();
    });

    afterEach(() => {
        resetConfigManagerSingleton();
    });

    it('defaults the stance to supportive', () => {
        const manager = ConfigManager.getInstance();
        expect(manager.getChannelSystemLlmStance()).toBe('supportive');
    });

    it('a global stance change applies to channels that have no stance of their own', () => {
        const manager = ConfigManager.getInstance();
        manager.setChannelSystemLlmStance('critical');

        expect(manager.getChannelSystemLlmStance()).toBe('critical');
        expect(manager.getChannelSystemLlmStance('ch-1')).toBe('critical');
    });

    it('a channel-specific stance overrides the global stance for that channel only', () => {
        const manager = ConfigManager.getInstance();
        manager.setChannelSystemLlmStance('critical');
        manager.setChannelSystemLlmStance('hostile', 'ch-1');

        expect(manager.getChannelSystemLlmStance('ch-1')).toBe('hostile');
        expect(manager.getChannelSystemLlmStance('ch-2')).toBe('critical');
        expect(manager.getChannelSystemLlmStance()).toBe('critical');
    });

    it('clearing a channel stance makes it inherit the global stance again', () => {
        const manager = ConfigManager.getInstance();
        manager.setChannelSystemLlmStance('critical');
        manager.setChannelSystemLlmStance('hostile', 'ch-1');
        expect(manager.getChannelSystemLlmStance('ch-1')).toBe('hostile');

        manager.clearChannelSystemLlmStance('ch-1');
        expect(manager.getChannelSystemLlmStance('ch-1')).toBe('critical');
    });

    it('a channel entry created only by setChannelSystemLlmEnabled does not shadow the global stance', () => {
        const manager = ConfigManager.getInstance();
        manager.setChannelSystemLlmStance('critical');
        manager.setChannelSystemLlmEnabled(false, 'ch-2');

        expect(manager.getChannelSystemLlmStance('ch-2')).toBe('critical');
    });

    it('setChannelSystemLlmStance emits a change event carrying the stance and channelId', () => {
        const manager = ConfigManager.getInstance();
        mockClientEmit.mockClear();

        manager.setChannelSystemLlmStance('hostile', 'ch-3');

        const changeEventCall = mockClientEmit.mock.calls.find(
            call => call[0] === ConfigEvents.CHANNEL_SYSTEM_LLM_CHANGED
        );
        expect(changeEventCall).toBeDefined();
        const payload = changeEventCall?.[1] as { data: ChannelSystemLlmChangeEvent };
        expect(payload.data.stance).toBe('hostile');
        expect(payload.data.channelId).toBe('ch-3');
    });

    it('setChannelSystemLlmEnabled preserves a previously set channel stance', () => {
        const manager = ConfigManager.getInstance();
        manager.setChannelSystemLlmStance('hostile', 'ch-4');

        manager.setChannelSystemLlmEnabled(false, 'ch-4', 'testing');

        expect(manager.getChannelSystemLlmStance('ch-4')).toBe('hostile');
    });

    it('caps every channel at the server-wide ceiling, whatever its own stance says', () => {
        const manager = ConfigManager.getInstance();
        manager.setChannelSystemLlmStance('hostile', 'ch-test');
        manager.setChannelSystemLlmStance('critical');

        expect(manager.getChannelSystemLlmStance('ch-test')).toBe('hostile');

        manager.setChannelSystemLlmStanceCeiling('critical');
        expect(manager.getChannelSystemLlmStance('ch-test')).toBe('critical');
        expect(manager.getChannelSystemLlmStance('ch-other')).toBe('critical');

        // A supportive ceiling turns challenges off everywhere without touching channels.
        manager.setChannelSystemLlmStanceCeiling('supportive');
        expect(manager.getChannelSystemLlmStance('ch-test')).toBe('supportive');
        expect(manager.getChannelSystemLlmStance()).toBe('supportive');

        // Raising it back restores the stored stances untouched.
        manager.setChannelSystemLlmStanceCeiling('hostile');
        expect(manager.getChannelSystemLlmStance('ch-test')).toBe('hostile');
        expect(manager.getChannelSystemLlmStance()).toBe('critical');
    });
});
