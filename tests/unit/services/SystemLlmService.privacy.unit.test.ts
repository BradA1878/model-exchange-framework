import { firstValueFrom, Observable, of } from 'rxjs';

jest.mock('@mxf-dev/core/utils/Logger', () => ({
    Logger: class MockLogger {
        error = jest.fn(); warn = jest.fn(); info = jest.fn(); debug = jest.fn(); trace = jest.fn();
    }
}));
jest.mock('@mxf-dev/core/config/ConfigManager', () => {
    const { ConfigEvents } = jest.requireActual<typeof import('@mxf-dev/core/config/ConfigManager')>('@mxf-dev/core/config/ConfigManager');
    return {
        ConfigEvents,
        ConfigManager: { getInstance: jest.fn(() => ({ isChannelSystemLlmEnabled: jest.fn(() => true) })) }
    };
});
jest.mock('../../../src/server/socket/services/ChannelService', () => ({ ChannelService: { getInstance: jest.fn() } }));
jest.mock('../../../src/server/socket/services/AgentService', () => ({ AgentService: { getInstance: jest.fn() } }));

import { EventBus } from '@mxf-dev/core/events/EventBus';
import { Events } from '@mxf-dev/core/events/EventNames';
import {
    BaseEventPayload, createAgentMessageEventPayload, createBaseEventPayload, createChannelMessageEventPayload
} from '@mxf-dev/core/schemas/EventPayloadSchema';
import { createAgentMessage, createChannelMessage } from '@mxf-dev/core/schemas/MessageSchemas';
import type { PromptInput } from '@mxf-dev/core/types/LlmTypes';
import { normalizeChannelHistoryMessage } from '@mxf-dev/core/utils/ChannelHistoryMessages';
import { SystemLlmService } from '../../../src/server/socket/services/SystemLlmService';

const broadcast = createChannelMessage('channel-a', 'agent-c', 'The public itinerary is ready.', {
    metadata: { messageId: 'public-message', timestamp: 3000 }
});
const direct = createAgentMessage('agent-a', 'agent-b', { secret: 'The private acquisition code is 778899.' }, {
    metadata: { messageId: 'private-message', timestamp: 1000 }, context: { channelId: 'channel-a' }
});
const mirroredDirect = createChannelMessage('channel-a', 'agent-a', direct.content.data, {
    receiverId: 'agent-b', metadata: {
        ...direct.metadata, originalMessageType: 'agent-to-agent', targetAgentId: 'agent-b'
    }
});
const historicalDirect = createChannelMessage('channel-a', 'agent-a', 'The missing-recipient private code is 990011.', {
    metadata: { messageId: 'historical-private', timestamp: 2000, originalMessageType: 'agent-to-agent' }
});
const history = [mirroredDirect, historicalDirect, broadcast].map(message => normalizeChannelHistoryMessage(message, 'channel-a'));

interface ServiceInternals {
    processPrompt: (input: PromptInput) => Observable<string>;
    boundHandleChannelMessageForCoordination?: (payload: unknown) => Promise<void>;
    detectCoordinationTrigger: (channelId: string) => Promise<string | null>;
    generateAndInjectCoordinationSuggestion: (channelId: string, trigger: string, message: unknown) => Promise<void>;
    processedMessages: Set<string>;
    channelActivities: Map<string, {
        messageCount: number; lastMessage: number; activeAgents: Set<string>; recentMessages: unknown[];
    }>;
}

describe('SystemLlmService shared channel privacy', () => {
    const previousVisibility = process.env.MXF_CHANNEL_HISTORY_DM_VISIBILITY;
    let service: SystemLlmService;
    let internals: ServiceInternals;
    let subscribeSpy: jest.SpyInstance;

    beforeEach(() => {
        EventBus.reset();
        process.env.MXF_CHANNEL_HISTORY_DM_VISIBILITY = 'parties';
        subscribeSpy = jest.spyOn(EventBus.server, 'on');
        service = new SystemLlmService('channel-a', { defaultModel: 'test/model', enableRealTimeCoordination: true });
        internals = service as unknown as ServiceInternals;
    });
    afterEach(() => {
        service?.cleanupAll();
        jest.restoreAllMocks();
        EventBus.reset();
        if (previousVisibility === undefined) delete process.env.MXF_CHANNEL_HISTORY_DM_VISIBILITY;
        else process.env.MXF_CHANNEL_HISTORY_DM_VISIBILITY = previousVisibility;
    });

    it.each(['topics', 'summary'])('excludes marked DMs before building the actual public %s prompt', async operation => {
        const provider = jest.spyOn(internals, 'processPrompt').mockReturnValue(of(JSON.stringify(
            operation === 'topics' ? { topics: [] } : { summary: 'Public itinerary only.', keyPoints: [] }
        )));
        const original = JSON.stringify(history);
        if (operation === 'topics') {
            expect(await firstValueFrom(service.extractTopics(history))).toEqual([]);
        } else {
            expect(await firstValueFrom(service.generateConversationSummary(history))).toMatchObject({ summary: 'Public itinerary only.' });
        }
        expect(provider).toHaveBeenCalledTimes(1);
        const input = provider.mock.calls[0][0];
        expect(input.prompt).toContain('The public itinerary is ready.');
        expect(input.prompt).not.toContain('778899');
        expect(input.prompt).not.toContain('990011');
        expect(input.prompt).not.toContain(new Date(1000).toISOString());
        expect(input.prompt).not.toContain(new Date(2000).toISOString());
        expect(JSON.stringify(history)).toBe(original);
    });

    it.each(['topics', 'summary'])('keeps DM input in the existing default-all %s behavior', async operation => {
        delete process.env.MXF_CHANNEL_HISTORY_DM_VISIBILITY;
        const provider = jest.spyOn(internals, 'processPrompt').mockReturnValue(of(JSON.stringify(
            operation === 'topics' ? { topics: [] } : { summary: 'All messages.', keyPoints: [] }
        )));
        if (operation === 'topics') await firstValueFrom(service.extractTopics(history));
        else await firstValueFrom(service.generateConversationSummary(history));
        expect(provider.mock.calls[0][0].prompt).toContain('778899');
        expect(provider.mock.calls[0][0].prompt).toContain('990011');
        expect(provider.mock.calls[0][0].prompt).toContain('The public itinerary is ready.');
    });

    const deliveredPayloads = [
        { shape: 'native agent message', payload: createAgentMessageEventPayload(Events.Message.AGENT_MESSAGE_DELIVERED, 'agent-a', 'channel-a', direct) },
        { shape: 'DM mirrored as a channel message', payload: createChannelMessageEventPayload(Events.Message.AGENT_MESSAGE_DELIVERED, 'agent-a', mirroredDirect) },
        { shape: 'canonical historical DM without a recipient', payload: createBaseEventPayload(Events.Message.AGENT_MESSAGE_DELIVERED, 'agent-a', 'channel-a', history[1]) }
    ];

    // Invoke the exact handler installed on EventBus and await its work. The real activity
    // updates run; only the trigger decision and outgoing suggestion are controlled.
    const deliver = async (payload: BaseEventPayload<unknown>): Promise<void> => {
        expect(subscribeSpy).toHaveBeenCalledWith(Events.Message.AGENT_MESSAGE_DELIVERED, internals.boundHandleChannelMessageForCoordination);
        expect(internals.boundHandleChannelMessageForCoordination).toEqual(expect.any(Function));
        await internals.boundHandleChannelMessageForCoordination!(payload);
    };

    it.each(deliveredPayloads)('excludes $shape before activity, counts, deduplication or coordination', async ({ payload }) => {
        const detect = jest.spyOn(internals, 'detectCoordinationTrigger').mockResolvedValue('message_volume');
        const suggest = jest.spyOn(internals, 'generateAndInjectCoordinationSuggestion').mockResolvedValue(undefined);
        await deliver(payload);
        expect(internals.channelActivities.size).toBe(0);
        expect(internals.processedMessages.size).toBe(0);
        expect(detect).not.toHaveBeenCalled();
        expect(suggest).not.toHaveBeenCalled();

        // A broadcast still reaches the same installed handler and actual activity accounting.
        await deliver(createChannelMessageEventPayload(Events.Message.AGENT_MESSAGE_DELIVERED, 'agent-c', broadcast));
        const activity = internals.channelActivities.get('channel-a');
        expect(activity).toMatchObject({ messageCount: 1, activeAgents: new Set(['agent-c']), recentMessages: [broadcast] });
        expect(detect).toHaveBeenCalledTimes(1);
        expect(suggest).toHaveBeenCalledTimes(1);
        expect(suggest).toHaveBeenCalledWith('channel-a', 'message_volume', broadcast);
        const lastActivity = activity!.lastMessage;
        await deliver(payload);
        expect(activity).toMatchObject({ messageCount: 1, lastMessage: lastActivity, recentMessages: [broadcast] });
        expect(internals.processedMessages.size).toBe(1);
        expect(detect).toHaveBeenCalledTimes(1);
        expect(suggest).toHaveBeenCalledTimes(1);
    });

    it('preserves the existing default-all DM coordination path', async () => {
        delete process.env.MXF_CHANNEL_HISTORY_DM_VISIBILITY;
        const detect = jest.spyOn(internals, 'detectCoordinationTrigger').mockResolvedValue('message_volume');
        const suggest = jest.spyOn(internals, 'generateAndInjectCoordinationSuggestion').mockResolvedValue(undefined);
        await deliver(deliveredPayloads[0].payload);
        expect(internals.channelActivities.get('channel-a')).toMatchObject({
            messageCount: 1, activeAgents: new Set(['agent-a']), recentMessages: [direct]
        });
        expect(detect).toHaveBeenCalledWith('channel-a');
        expect(suggest).toHaveBeenCalledWith('channel-a', 'message_volume', direct);
    });
});
