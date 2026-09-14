import { MessageActivationQueue, type MessageActivation } from '@mxf-dev/sdk/services/MessageActivationQueue';

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void } {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}

const trigger = (messageId: string): { messageId: string; trigger: 'channel_message' } => ({ messageId, trigger: 'channel_message' });
const message = { role: 'user' as const, content: 'Hello.' };

describe('message activation ownership', () => {
    it('reserves one turn before persistence yields and coalesces its arrivals into one follow-up', async () => {
        const save = deferred<void>();
        const firstTurn = deferred<void>();
        const started = deferred<void>();
        const activations: MessageActivation[] = [];
        const store = jest.fn().mockReturnValueOnce(save.promise).mockResolvedValue(undefined);
        const error = jest.fn();
        const queue = new MessageActivationQueue(store, async activation => {
            activations.push(activation);
            if (activations.length === 1) { started.resolve(); await firstTurn.promise; }
        }, error);
        const firstSave = queue.accept(trigger('first'), message);
        await queue.accept(trigger('second'), message);
        await queue.accept(trigger('third'), message);
        expect(activations).toHaveLength(0);
        save.resolve();
        await firstSave;
        await started.promise;
        expect(activations).toHaveLength(1);
        firstTurn.resolve();
        await queue.waitForIdle();
        expect(activations.map(value => value.messageId)).toEqual(['first', 'second']);
        expect(activations[0].activationId).not.toBe(activations[1].activationId);
        expect(store).toHaveBeenCalledTimes(3);
        expect(error).not.toHaveBeenCalled();
    });

    it('waits for every pending message to persist before starting the follow-up', async () => {
        const firstTurn = deferred<void>();
        const nextSave = deferred<void>();
        const started = deferred<void>();
        const run = jest.fn(async () => { started.resolve(); await firstTurn.promise; });
        const queue = new MessageActivationQueue(
            jest.fn().mockResolvedValueOnce(undefined).mockReturnValueOnce(nextSave.promise), run, jest.fn()
        );
        await queue.accept(trigger('first'), message);
        await started.promise;
        const save = queue.accept(trigger('second'), message);
        firstTurn.resolve();
        await firstTurn.promise;
        expect(run).toHaveBeenCalledTimes(1);
        nextSave.resolve();
        await save;
        await queue.waitForIdle();
        expect(run).toHaveBeenCalledTimes(2);
    });

    it('invalidates old work on stop and lets a new lifecycle own its own pending messages', async () => {
        const oldTurn = deferred<void>();
        const started = deferred<void>();
        const seen: MessageActivation[] = [];
        const queue = new MessageActivationQueue(async () => {}, async activation => {
            seen.push(activation);
            if (seen.length === 1) { started.resolve(); await oldTurn.promise; }
        }, jest.fn());
        await queue.accept(trigger('old'), message);
        await started.promise;
        await queue.accept(trigger('discarded'), message);
        queue.stop();
        expect(queue.isCurrent(seen[0])).toBe(false);
        queue.resume();
        await queue.accept(trigger('new'), message);
        await queue.waitForIdle();
        oldTurn.resolve();
        await oldTurn.promise;
        expect(seen.map(value => value.messageId)).toEqual(['old', 'new']);
    });

    it('reports a failed save without calling the model or losing a later valid activation', async () => {
        const failure = new Error('Persistence failed');
        const run = jest.fn(async () => {});
        const report = jest.fn();
        const queue = new MessageActivationQueue(
            jest.fn().mockRejectedValueOnce(failure).mockResolvedValue(undefined), run, report
        );
        await expect(queue.accept(trigger('failed'), message)).rejects.toThrow('Persistence failed');
        await queue.waitForIdle();
        expect(run).not.toHaveBeenCalled();
        expect(report).toHaveBeenCalledWith(failure, expect.objectContaining({ messageId: 'failed' }));
        await queue.accept(trigger('next'), message);
        await queue.waitForIdle();
        expect(run).toHaveBeenCalledTimes(1);
    });

    it('keeps a successful pending message when another save in its batch fails', async () => {
        const active = deferred<void>();
        const started = deferred<void>();
        const turns: string[] = [];
        const report = jest.fn();
        const queue = new MessageActivationQueue(
            jest.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('B failed')).mockResolvedValue(undefined),
            async activation => {
                turns.push(activation.messageId);
                if (turns.length === 1) { started.resolve(); await active.promise; }
            }, report
        );
        await queue.accept(trigger('A'), message);
        await started.promise;
        await expect(queue.accept(trigger('B'), message)).rejects.toThrow('B failed');
        await queue.accept(trigger('C'), message);
        active.resolve();
        await queue.waitForIdle();
        expect(turns).toEqual(['A', 'C']);
        expect(report).toHaveBeenCalledTimes(1);
    });

    it('does not store a prepared message that finishes after its lifecycle stops', async () => {
        const preparation = deferred<typeof message>();
        const store = jest.fn(async () => {});
        const run = jest.fn(async () => {});
        const queue = new MessageActivationQueue(store, run, jest.fn());
        const accepted = queue.accept(trigger('old'), () => preparation.promise);
        queue.stop();
        preparation.resolve(message);
        await accepted;
        await queue.waitForIdle();
        expect(store).not.toHaveBeenCalled();
        expect(run).not.toHaveBeenCalled();
    });
});
