/**
 * MxfToolService caches the tool list it loads at connect. The list an agent
 * is allowed to see can change during its own initialization — the server
 * hides memory_search_* until the agent's memory-load backfill has settled —
 * so the agent reloads with force once memory is initialized. These tests
 * pin the two behaviours that reload relies on: a plain load serves the cache
 * without a request, and a forced load asks the server again and replaces
 * the cache with whatever it answers.
 */
import { EventBus } from '@mxf-dev/core/events/EventBus';
import { Events } from '@mxf-dev/core/events/EventNames';
import {
    BaseEventPayload,
    createMxfToolListResultPayload,
    MxfToolListEventData
} from '@mxf-dev/core/schemas/EventPayloadSchema';
import { MxfToolService, type ClientTool } from '@mxf-dev/sdk/services/MxfToolService';
import { Logger } from '@mxf-dev/core/utils/Logger';

const AGENT_ID = 'agent-tool-refresh';
const CHANNEL_ID = 'channel-tool-refresh';

const createTool = (name: string): ClientTool => ({
    name,
    description: `${name} description`,
    inputSchema: { type: 'object', properties: {} },
    enabled: true,
    providerId: 'internal',
    channelId: CHANNEL_ID
});

/** Answer every tool-list request the way the server would, with the given list. */
const answerToolListRequests = (answers: ClientTool[][]): jest.SpyInstance => {
    let call = 0;
    return jest.spyOn(EventBus.client, 'emitOn').mockImplementation((_agentId, eventName, rawPayload) => {
        if (eventName !== Events.Mcp.MXF_TOOL_LIST) {
            return;
        }
        const payload = rawPayload as BaseEventPayload<MxfToolListEventData>;
        const tools = answers[Math.min(call, answers.length - 1)];
        call += 1;
        EventBus.client.emitLocal(
            Events.Mcp.MXF_TOOL_LIST_RESULT,
            createMxfToolListResultPayload(
                Events.Mcp.MXF_TOOL_LIST_RESULT, AGENT_ID, CHANNEL_ID,
                { tools, count: tools.length, requestId: payload.data.requestId }
            )
        );
    });
};

describe('MxfToolService reload', () => {
    beforeEach(() => {
        EventBus.reset();
    });

    afterEach(() => {
        jest.restoreAllMocks();
        EventBus.reset();
    });

    it('serves the cached list without a request once loaded', async () => {
        const emitOn = answerToolListRequests([[createTool('messaging_send')]]);
        const service = new MxfToolService(AGENT_ID, CHANNEL_ID);

        await service.loadTools();
        const again = await service.loadTools();

        expect(again.map(tool => tool.name)).toEqual(['messaging_send']);
        expect(emitOn).toHaveBeenCalledTimes(1);
    });

    it('asks the server again on a forced load and replaces the cache', async () => {
        const emitOn = answerToolListRequests([
            [createTool('messaging_send')],
            [createTool('messaging_send'), createTool('memory_search_conversations')]
        ]);
        const service = new MxfToolService(AGENT_ID, CHANNEL_ID);

        await service.loadTools();
        const refreshed = await service.loadTools(undefined, true);

        expect(emitOn).toHaveBeenCalledTimes(2);
        expect(refreshed.map(tool => tool.name)).toEqual(['messaging_send', 'memory_search_conversations']);
        expect(service.getCachedTools().map(tool => tool.name)).toEqual(['messaging_send', 'memory_search_conversations']);
        expect(EventBus.client.listenerCount(Events.Mcp.MXF_TOOL_LIST_RESULT)).toBe(0);
    });

    it('reloadTools asks the server again and returns the new list', async () => {
        const emitOn = answerToolListRequests([
            [createTool('messaging_send')],
            [createTool('messaging_send'), createTool('memory_search_conversations')]
        ]);
        const service = new MxfToolService(AGENT_ID, CHANNEL_ID);

        await service.loadTools();
        const reloaded = await service.reloadTools();

        expect(emitOn).toHaveBeenCalledTimes(2);
        expect(reloaded.map(tool => tool.name)).toEqual(['messaging_send', 'memory_search_conversations']);
    });

    it('reloadTools keeps the list it has and logs when the server does not answer', async () => {
        // Same policy as the load at connect: a tool-list problem is logged and
        // the agent runs with the list it has, rather than failing connect().
        jest.useFakeTimers();
        const emitOn = answerToolListRequests([[createTool('messaging_send')]]);
        const service = new MxfToolService(AGENT_ID, CHANNEL_ID);
        await service.loadTools();
        emitOn.mockImplementation(() => undefined); // the reload request goes unanswered
        const errorSpy = jest.spyOn(Logger.prototype, 'error');

        const reloading = service.reloadTools();
        await jest.advanceTimersByTimeAsync(10_000);
        const kept = await reloading;

        expect(kept.map(tool => tool.name)).toEqual(['messaging_send']);
        expect(service.getCachedTools().map(tool => tool.name)).toEqual(['messaging_send']);
        expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('timed out'));
        expect(EventBus.client.listenerCount(Events.Mcp.MXF_TOOL_LIST_RESULT)).toBe(0);
        jest.useRealTimers();
    });
});
