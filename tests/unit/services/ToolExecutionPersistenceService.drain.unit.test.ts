const createExecution = jest.fn();

jest.mock('@mxf-dev/core/models/mcpToolExecution', () => ({
    McpToolExecution: {
        create: createExecution,
    },
}));

import { EventBus } from '@mxf-dev/core/events/EventBus';
import { McpEvents } from '@mxf-dev/core/events/event-definitions/McpEvents';
import { createBaseEventPayload } from '@mxf-dev/core/schemas/EventPayloadSchema';
import { ToolExecutionPersistenceService } from '../../../src/server/services/ToolExecutionPersistenceService';

describe('ToolExecutionPersistenceService shutdown drain', () => {
    beforeEach(async () => {
        EventBus.reset();
        createExecution.mockReset();
        (ToolExecutionPersistenceService as unknown as {
            instance: ToolExecutionPersistenceService | null;
        }).instance = null;
        await ToolExecutionPersistenceService.getInstance().initialize();
    });

    afterEach(() => {
        EventBus.reset();
        (ToolExecutionPersistenceService as unknown as {
            instance: ToolExecutionPersistenceService | null;
        }).instance = null;
    });

    it('keeps a deferred audit write inside the EventBus shutdown drain', async () => {
        let releaseWrite!: () => void;
        const deferredWrite = new Promise<void>(resolve => {
            releaseWrite = resolve;
        });
        createExecution.mockReturnValueOnce(deferredWrite);

        EventBus.server.emit(
            McpEvents.TOOL_CALL,
            createBaseEventPayload(
                McpEvents.TOOL_CALL,
                'audit-agent',
                'audit-channel',
                {
                    callId: 'audit-request',
                    toolName: 'audit_tool',
                    arguments: { verified: true },
                }
            )
        );
        expect(createExecution).toHaveBeenCalledTimes(1);

        let drainSettled = false;
        const drain = EventBus.drain().then((): void => {
            drainSettled = true;
        });
        await Promise.resolve();
        expect(drainSettled).toBe(false);
        expect(EventBus.server.pendingHandlerCount()).toBe(1);

        releaseWrite();
        await drain;
        expect(EventBus.server.pendingHandlerCount()).toBe(0);
    });
});
