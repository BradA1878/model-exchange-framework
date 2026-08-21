import { EventBus } from '@mxf-dev/core/events/EventBus';
import { Events } from '@mxf-dev/core/events/EventNames';
import { InferenceParameterService } from '../../../src/server/socket/services/InferenceParameterService';

describe('InferenceParameterService lifecycle', () => {
    beforeEach(() => {
        jest.useFakeTimers();
        InferenceParameterService.shutdownExisting();
        EventBus.reset();
    });

    afterEach(() => {
        InferenceParameterService.shutdownExisting();
        EventBus.reset();
        jest.clearAllTimers();
        jest.useRealTimers();
    });

    it('owns its cleanup timer and subscriptions across idempotent shutdown and reinitialization', () => {
        const service = InferenceParameterService.getInstance();
        expect(jest.getTimerCount()).toBe(1);
        expect(EventBus.server.listenerCount(Events.Task.COMPLETED)).toBe(1);
        expect(EventBus.server.listenerCount(Events.ControlLoop.REFLECTION)).toBe(1);
        expect(EventBus.server.listenerCount(Events.Agent.DISCONNECTED)).toBe(1);

        service.shutdown();
        service.shutdown();

        expect(jest.getTimerCount()).toBe(0);
        expect(EventBus.server.listenerCount(Events.Task.COMPLETED)).toBe(0);
        expect(EventBus.server.listenerCount(Events.ControlLoop.REFLECTION)).toBe(0);
        expect(EventBus.server.listenerCount(Events.Agent.DISCONNECTED)).toBe(0);
        expect(InferenceParameterService.shutdownExisting()).toBe(false);

        const replacement = InferenceParameterService.getInstance();
        expect(replacement).not.toBe(service);
        expect(jest.getTimerCount()).toBe(1);
        expect(EventBus.server.listenerCount(Events.Task.COMPLETED)).toBe(1);
    });
});
