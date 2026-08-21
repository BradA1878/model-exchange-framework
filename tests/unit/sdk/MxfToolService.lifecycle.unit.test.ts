import { EventBus } from '@mxf-dev/core/events/EventBus';
import { Events } from '@mxf-dev/core/events/EventNames';
import { createMxfToolListResultPayload } from '@mxf-dev/core/schemas/EventPayloadSchema';
import { MxfToolService, type ClientTool } from '@mxf-dev/sdk/services/MxfToolService';

const AGENT_ID = 'agent-tool-lifecycle';
const CHANNEL_ID = 'channel-tool-lifecycle';

const createTool = (name: string): ClientTool => ({
    name,
    description: `${name} description`,
    inputSchema: { type: 'object', properties: {} },
    enabled: true,
    providerId: 'internal',
    channelId: CHANNEL_ID,
});

const deliverToolUpdate = (requestId: string, tools: ClientTool[]): void => {
    EventBus.client.emitLocal(
        Events.Mcp.MXF_TOOL_LIST_RESULT,
        createMxfToolListResultPayload(
            Events.Mcp.MXF_TOOL_LIST_RESULT,
            AGENT_ID,
            CHANNEL_ID,
            { tools, count: tools.length, requestId }
        )
    );
};

const flushAsyncHandler = async (): Promise<void> => {
    await new Promise<void>(resolve => setImmediate(resolve));
};

describe('MxfToolService persistent listener lifecycle', () => {
    beforeEach(() => {
        EventBus.reset();
    });

    afterEach(() => {
        EventBus.reset();
    });

    it('delivers once and owns exactly one subscription across cleanup and reconnect', async () => {
        const service = new MxfToolService(AGENT_ID, CHANNEL_ID);
        const firstCallback = jest.fn<Promise<void>, [ClientTool[]]>().mockResolvedValue(undefined);
        service.onToolsUpdated(firstCallback);

        service.setupPersistentToolListener();
        service.setupPersistentToolListener();

        expect(EventBus.client.listenerCount(Events.Mcp.MXF_TOOL_LIST_RESULT)).toBe(1);

        deliverToolUpdate('meilisearch-ready-first', [createTool('first_tool')]);
        await flushAsyncHandler();
        expect(firstCallback).toHaveBeenCalledTimes(1);

        service.cleanup();
        service.cleanup();

        expect(EventBus.client.listenerCount(Events.Mcp.MXF_TOOL_LIST_RESULT)).toBe(0);
        deliverToolUpdate('meilisearch-ready-while-disconnected', [createTool('ignored_tool')]);
        await flushAsyncHandler();
        expect(firstCallback).toHaveBeenCalledTimes(1);

        const reconnectCallback = jest.fn<Promise<void>, [ClientTool[]]>().mockResolvedValue(undefined);
        service.onToolsUpdated(reconnectCallback);
        service.setupPersistentToolListener();
        service.setupPersistentToolListener();

        expect(EventBus.client.listenerCount(Events.Mcp.MXF_TOOL_LIST_RESULT)).toBe(1);

        deliverToolUpdate('meilisearch-ready-reconnected', [createTool('reconnected_tool')]);
        await flushAsyncHandler();

        expect(firstCallback).toHaveBeenCalledTimes(1);
        expect(reconnectCallback).toHaveBeenCalledTimes(1);

        service.cleanup();
        expect(EventBus.client.listenerCount(Events.Mcp.MXF_TOOL_LIST_RESULT)).toBe(0);
    });
});
