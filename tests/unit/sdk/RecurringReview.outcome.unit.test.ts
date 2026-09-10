import { Events, type MxfAgent } from '@mxf-dev/sdk';
import { createAndWait } from '../../../examples/recurring-review/task-outcome';

const harness = (): {
    agent: Pick<MxfAgent, 'on' | 'off'>;
    emit: (event: string, taskId: string) => void;
    count: () => number;
} => {
    const listeners = new Map<string, (payload: unknown) => void>();
    const agent = {
        on: (event: string, handler: (payload: unknown) => void): void => { listeners.set(event, handler); },
        off: (event: string, handler: (payload: unknown) => void): void => {
            if (listeners.get(event) === handler) listeners.delete(event);
        }
    } as unknown as Pick<MxfAgent, 'on' | 'off'>;
    return {
        agent,
        emit: (event, taskId): void => { listeners.get(event)?.({ data: { taskId } }); },
        count: (): number => listeners.size
    };
};

describe('recurring review task outcome example', () => {
    it.each([
        [Events.Task.COMPLETED, 'completed'],
        [Events.Task.FAILED, 'failed'],
        [Events.Task.CANCELLED, 'cancelled']
    ])('preserves the early authoritative %s outcome and ignores an older task', async (event, status) => {
        const h = harness();
        const outcome = createAndWait(h.agent, async () => {
            expect(h.count()).toBe(3);
            h.emit(Events.Task.COMPLETED, 'old');
            h.emit(event, 'actual');
            return 'actual';
        }, new AbortController().signal);
        await expect(outcome).resolves.toMatchObject({ taskId: 'actual', status });
        expect(h.count()).toBe(0);
    });

    it('ignores late outcomes for another task', async () => {
        const h = harness();
        const controller = new AbortController();
        const pending = createAndWait(h.agent, async () => 'actual', controller.signal);
        await new Promise(resolve => setImmediate(resolve));
        h.emit(Events.Task.FAILED, 'old');
        expect(h.count()).toBe(3);
        h.emit(Events.Task.COMPLETED, 'actual');
        await expect(pending).resolves.toMatchObject({ taskId: 'actual', status: 'completed' });
        expect(h.count()).toBe(0);
    });

    it('cleans up when creation rejects', async () => {
        const h = harness();
        await expect(createAndWait(h.agent, async () => { throw new Error('creation refused'); }, new AbortController().signal))
            .rejects.toThrow('creation refused');
        expect(h.count()).toBe(0);
    });

    it('does not submit work if the application interrupts before creation starts', async () => {
        const h = harness();
        const controller = new AbortController();
        const create = jest.fn().mockResolvedValue('actual');
        const pending = createAndWait(h.agent, create, controller.signal);
        controller.abort();
        await expect(pending).rejects.toThrow('cancelled by the application');
        expect(create).not.toHaveBeenCalled();
        expect(h.count()).toBe(0);
    });
});
