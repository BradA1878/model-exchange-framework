/**
 * The tool-outcome learning handlers are asynchronous. They must be returned
 * from the EventBus listener so the shutdown drain waits for them, matching
 * the other validation services.
 */

import { EventBus } from '@mxf-dev/core/events/EventBus';
import { Events } from '@mxf-dev/core/events/EventNames';
import { createBaseEventPayload } from '@mxf-dev/core/schemas/EventPayloadSchema';
import { ProactiveValidationService } from '@mxf-dev/core/services/ProactiveValidationService';

describe('ProactiveValidationService shutdown drain', () => {
    let service: ProactiveValidationService;

    beforeEach(() => {
        EventBus.reset();
        service = ProactiveValidationService.getInstance();
    });

    afterEach(() => {
        service.shutdown();
        EventBus.reset();
    });

    it.each([
        { event: Events.Mcp.TOOL_ERROR, method: 'learnFromValidationFailure' },
        { event: Events.Mcp.TOOL_RESULT, method: 'learnFromValidationSuccess' }
    ])('keeps pending $method work inside the EventBus drain', async ({ event, method }) => {
        let release!: () => void;
        const pending = new Promise<void>(resolve => {
            release = resolve;
        });
        const learn = jest
            .spyOn(service as unknown as Record<string, () => Promise<void>>, method)
            .mockReturnValue(pending);

        EventBus.server.emit(
            event,
            createBaseEventPayload(event, 'learning-agent', 'learning-channel', {
                toolName: 'learning_tool',
                result: {},
                error: 'learning failure'
            })
        );
        expect(learn).toHaveBeenCalledTimes(1);

        // The performance services this singleton constructs also handle the
        // event; their in-memory work settles within a macrotask. After that,
        // only the deferred learning work can be holding the drain open.
        await new Promise<void>(resolve => setImmediate(resolve));
        await new Promise<void>(resolve => setImmediate(resolve));
        expect(EventBus.server.pendingHandlerCount()).toBe(1);

        let drainSettled = false;
        const drain = EventBus.drain().then((): void => {
            drainSettled = true;
        });
        await Promise.resolve();
        await Promise.resolve();
        expect(drainSettled).toBe(false);

        release();
        await drain;
        expect(EventBus.server.pendingHandlerCount()).toBe(0);
    });
});
