/**
 * Unit tests for McpToolHandlers.callTool — the SDK's socket tool call.
 *
 * The server answers a call with Mcp.TOOL_RESULT or Mcp.TOOL_ERROR. A 3.2.2
 * server also answers a tool whose handler threw with a TOOL_RESULT whose
 * content type is 'error' — its registry wraps the throw into a result
 * envelope instead of failing the call. callTool unwrapped that envelope to
 * its bare message and resolved with it, so a failed tool looked like a
 * successful one to the agent loop: a rejected task_complete ended the task's
 * turn as if it had completed (Sentinel, 2026-09-01 — two runs lost to the
 * consumer's 900 s timeout with the task still open on the server).
 */
import { EventBus } from '@mxf-dev/core/events/EventBus';
import { Events } from '@mxf-dev/core/events/EventNames';
import {
    createMcpToolErrorPayload,
    createMcpToolResultPayload,
    McpToolCallEventPayload
} from '@mxf-dev/core/schemas/EventPayloadSchema';
import { McpToolHandlers } from '@mxf-dev/sdk/handlers/McpToolHandlers';
import type { IInternalChannelService } from '@mxf-dev/sdk/services/MxfService';

const AGENT_ID = 'tool-call-agent';
const CHANNEL_ID = 'tool-call-channel';

interface ResultContent {
    type: string;
    data: unknown;
}

/** A socket that answers every TOOL_CALL the way the server would. */
const serviceAnswering = (
    answer: (call: McpToolCallEventPayload) => void
): IInternalChannelService => ({
    isConnected: (): boolean => true,
    socketEmit: (eventName: string, payload: unknown): void => {
        if (eventName === Events.Mcp.TOOL_CALL) {
            answer(payload as McpToolCallEventPayload);
        }
    }
});

const answerWithResult = (result: ResultContent) => (call: McpToolCallEventPayload): void => {
    EventBus.client.emitLocal(Events.Mcp.TOOL_RESULT, createMcpToolResultPayload(
        Events.Mcp.TOOL_RESULT,
        AGENT_ID,
        CHANNEL_ID,
        { toolName: call.data.toolName, callId: call.data.callId, result }
    ));
};

describe('McpToolHandlers.callTool', () => {
    beforeEach(() => {
        EventBus.reset();
    });

    afterEach(() => {
        EventBus.reset();
    });

    it('resolves with the content data of a successful result', async () => {
        const handlers = new McpToolHandlers(CHANNEL_ID, AGENT_ID, serviceAnswering(
            answerWithResult({ type: 'text', data: '{"status":"task_completed"}' })
        ));

        await expect(handlers.callTool('task_complete', { summary: 'done' }, CHANNEL_ID))
            .resolves.toBe('{"status":"task_completed"}');
    });

    it('rejects when the server answers with TOOL_ERROR', async () => {
        const handlers = new McpToolHandlers(CHANNEL_ID, AGENT_ID, serviceAnswering(call => {
            EventBus.client.emitLocal(Events.Mcp.TOOL_ERROR, createMcpToolErrorPayload(
                Events.Mcp.TOOL_ERROR,
                AGENT_ID,
                CHANNEL_ID,
                {
                    toolName: call.data.toolName,
                    callId: call.data.callId,
                    error: `Tool 'task_complete' is not authorized for agent '${AGENT_ID}'`
                }
            ));
        }));

        await expect(handlers.callTool('task_complete', { summary: 'done' }, CHANNEL_ID))
            .rejects.toThrow('not authorized');
    });

    it("rejects a result whose content type is 'error': a 3.2.2 server's answer for a handler that threw", async () => {
        const handlers = new McpToolHandlers(CHANNEL_ID, AGENT_ID, serviceAnswering(
            answerWithResult({
                type: 'error',
                data: 'Tool execution error: Task completion summary or result is required'
            })
        ));

        await expect(handlers.callTool('task_complete', { details: { tradesOpened: 0 } }, CHANNEL_ID))
            .rejects.toThrow('Tool execution error: Task completion summary or result is required');
    });

    it("rejects an 'error' result with structured data, keeping the structure in the message", async () => {
        const handlers = new McpToolHandlers(CHANNEL_ID, AGENT_ID, serviceAnswering(
            answerWithResult({ type: 'error', data: { code: 'INVALID_INPUT', message: 'summary is required' } })
        ));

        await expect(handlers.callTool('task_complete', { details: {} }, CHANNEL_ID))
            .rejects.toThrow('"code":"INVALID_INPUT"');
    });
});
