import { Subject } from 'rxjs';
import { ServerEventBus } from '@mxf-dev/core/events/ServerEventBus';
import { Events } from '@mxf-dev/core/events/EventNames';
import { createBaseEventPayload } from '@mxf-dev/core/schemas/EventPayloadSchema';
import type { EventMessage } from '@mxf-dev/core/events/EventBusBase';

describe('ServerEventBus transport privacy', () => {
    it('still delivers emitted events to local server subscribers', () => {
        const bus = new ServerEventBus(new Subject<EventMessage>());
        const localHandler = jest.fn();
        bus.on(Events.Memory.GET_RESULT, localHandler);
        const payload = createBaseEventPayload(
            Events.Memory.GET_RESULT,
            'agent-a',
            'channel-a',
            { operationId: 'op-1', memory: { private: true } }
        );

        bus.emit(Events.Memory.GET_RESULT, payload);

        expect(localHandler).toHaveBeenCalledWith(payload);
    });
});
