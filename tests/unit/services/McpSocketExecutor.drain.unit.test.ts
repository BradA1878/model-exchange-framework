import { from } from 'rxjs';

jest.mock('@mxf-dev/core/services/AutoCorrectionService', () => ({
    AutoCorrectionService: {
        getInstance: (): { attemptCorrection: jest.Mock } => ({
            attemptCorrection: jest.fn(),
        }),
    },
}));

import { EventBus } from '@mxf-dev/core/events/EventBus';
import { Events } from '@mxf-dev/core/events/EventNames';
import {
    createMcpToolCallPayload,
} from '@mxf-dev/core/schemas/EventPayloadSchema';
import { McpSocketExecutor } from '../../../src/server/socket/services/McpSocketExecutor';

describe('McpSocketExecutor shutdown drain', () => {
    let executor: McpSocketExecutor;

    beforeEach(() => {
        EventBus.reset();
        (McpSocketExecutor as unknown as {
            instance: McpSocketExecutor | null;
        }).instance = null;
        executor = McpSocketExecutor.getInstance();
    });

    afterEach(() => {
        jest.restoreAllMocks();
        EventBus.reset();
        (McpSocketExecutor as unknown as {
            instance: McpSocketExecutor | null;
        }).instance = null;
    });

    const emitToolCall = (): void => {
        EventBus.server.emit(
            Events.Mcp.TOOL_CALL,
            createMcpToolCallPayload(
                Events.Mcp.TOOL_CALL,
                'agent-a',
                'channel-a',
                {
                    toolName: 'deferred_tool',
                    callId: 'call-a',
                    arguments: {},
                }
            )
        );
    };

    it('keeps a deferred successful tool call inside the accepted-work drain', async () => {
        let releaseTool!: () => void;
        const deferredTool = new Promise<{ content: { type: string; data: string } }>(resolve => {
            releaseTool = (): void => resolve({
                content: { type: 'text', data: 'complete' },
            });
        });
        jest.spyOn(executor, 'executeTool').mockReturnValue(from(deferredTool));
        const resultHandler = jest.fn();
        EventBus.server.on(Events.Mcp.TOOL_RESULT, resultHandler);

        emitToolCall();
        expect(EventBus.server.pendingHandlerCount()).toBe(1);

        let drainSettled = false;
        const drain = EventBus.drain().then((): void => {
            drainSettled = true;
        });
        await Promise.resolve();

        expect(drainSettled).toBe(false);
        releaseTool();
        await drain;

        expect(resultHandler).toHaveBeenCalledTimes(1);
        expect(resultHandler.mock.calls[0][0].data).toMatchObject({
            callId: 'call-a',
            result: { type: 'text', data: 'complete' },
        });
        expect(EventBus.server.pendingHandlerCount()).toBe(0);
    });

    it('keeps a deferred failed tool call inside the drain through error emission', async () => {
        let rejectTool!: () => void;
        const deferredTool = new Promise<never>((_resolve, reject) => {
            rejectTool = (): void => reject(new Error('tool process stopped'));
        });
        jest.spyOn(executor, 'executeTool').mockReturnValue(from(deferredTool));
        const errorHandler = jest.fn();
        EventBus.server.on(Events.Mcp.TOOL_ERROR, errorHandler);

        emitToolCall();
        const drain = EventBus.drain();
        await Promise.resolve();
        expect(EventBus.server.pendingHandlerCount()).toBe(1);

        rejectTool();
        await expect(drain).resolves.toBeUndefined();

        expect(errorHandler).toHaveBeenCalledTimes(1);
        expect(errorHandler.mock.calls[0][0].data).toMatchObject({
            callId: 'call-a',
            error: 'tool process stopped',
        });
        expect(EventBus.server.pendingHandlerCount()).toBe(0);
    });
});
