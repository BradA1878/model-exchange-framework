import { QValueManager } from '@mxf-dev/core/services/QValueManager';
import { DEFAULT_MEMORY_UTILITY_CONFIG } from '@mxf-dev/core/types/MemoryUtilityTypes';

describe('QValueManager cache capacity and persistence ordering', () => {
    const manager = QValueManager.getInstance();

    beforeEach(() => {
        manager.clearCache();
        manager.initialize({
            ...DEFAULT_MEMORY_UTILITY_CONFIG,
            enabled: true,
            cache: { enabled: true, maxSize: 2, ttlMs: 60_000 }
        });
        manager.setPersistenceCallback(async () => undefined, async () => undefined);
    });

    it('bounds reward-only insertions and evicts the least recently used persisted value', async () => {
        await manager.updateQValue('first', 1);
        await manager.updateQValue('second', 1);
        manager.getQValue('first');
        await manager.updateQValue('third', 1);

        expect(manager.getCacheStats().size).toBe(2);
        expect(manager.isCached('first')).toBe(true);
        expect(manager.isCached('second')).toBe(false);
        expect(manager.isCached('third')).toBe(true);
    });

    it('refuses a new value rather than discarding rewards whose persistence failed', async () => {
        manager.setPersistenceCallback(async () => { throw new Error('storage unavailable'); }, async () => undefined);
        await manager.updateQValue('first', 1);
        await manager.updateQValue('second', 1);

        await expect(manager.updateQValue('third', 1)).rejects.toThrow(/capacity.*unpersisted/i);
        expect(manager.getCacheStats().size).toBe(2);
        expect(manager.getQValue('first')).toBeCloseTo(0.55);
        expect(manager.getQValue('second')).toBeCloseTo(0.55);
        expect(manager.isCached('third')).toBe(false);

        // Persisting an existing dirty value makes capacity available again.
        manager.setPersistenceCallback(async () => undefined, async () => undefined);
        await manager.updateQValue('first', 1);
        await manager.updateQValue('third', 1);
        expect(manager.isCached('second')).toBe(true);
        expect(manager.isCached('third')).toBe(true);
    });

    it('serializes same-memory persistence so an older write cannot replace a newer reward', async () => {
        let releaseFirst!: () => void;
        const firstWrite = new Promise<void>(resolve => { releaseFirst = resolve; });
        let startedFirst!: () => void;
        const firstStarted = new Promise<void>(resolve => { startedFirst = resolve; });
        const persisted: number[] = [];
        const persist = jest.fn(async (_id, utility) => {
            if (persist.mock.calls.length === 1) {
                startedFirst();
                await firstWrite;
            }
            persisted.push(utility.qValue);
        });
        manager.setPersistenceCallback(persist, async () => undefined);

        const first = manager.updateQValue('shared', 1);
        const second = manager.updateQValue('shared', 0);
        // Observe rejections immediately, including mutations that reject before
        // the pending-write assertion, and always release the transport stub.
        const completed = Promise.allSettled([first, second]);
        try {
            await firstStarted;
            expect(persist).toHaveBeenCalledTimes(1);
        } finally {
            releaseFirst();
            await completed;
        }
        const results = await completed;
        expect(results).toEqual([
            { status: 'fulfilled', value: expect.closeTo(0.55) },
            { status: 'fulfilled', value: expect.closeTo(0.495) }
        ]);

        expect(persisted[0]).toBeCloseTo(0.55);
        expect(persisted[1]).toBeCloseTo(0.495);
        expect(manager.getQValue('shared')).toBeCloseTo(persisted[1]);
    });

    it('continues from the persisted Q-value after eviction instead of resetting to the default', async () => {
        const stored = new Map<string, number>([['learned', 0.8]]);
        const read = jest.fn(async (id: string) => stored.get(id));
        manager.setPersistenceCallback(async (id, utility) => {
            stored.set(id, utility.qValue!);
        }, read);
        manager.updateConfig({ cache: { enabled: true, maxSize: 1, ttlMs: 60_000 } });

        expect(await manager.updateQValue('learned', 1)).toBeCloseTo(0.82);
        await manager.updateQValue('other', 1);
        expect(manager.isCached('learned')).toBe(false);
        expect(await manager.updateQValue('learned', 0)).toBeCloseTo(0.738);
        expect(stored.get('learned')).toBeCloseTo(0.738);
        expect(read.mock.calls.filter(([id]) => id === 'learned')).toHaveLength(2);
        expect(manager.getCacheStats().size).toBe(1);
    });

    it('requires both persistence callbacks before replacing the configured pair', () => {
        const callback = async (): Promise<undefined> => undefined;
        // JavaScript consumers can omit a parameter even though TypeScript requires it.
        expect(() => Reflect.apply(manager.setPersistenceCallback, manager, [callback]))
            .toThrow('both write and read callbacks');
        expect(() => Reflect.apply(manager.setPersistenceCallback, manager, [undefined, callback]))
            .toThrow('both write and read callbacks');
    });

    it('preserves the cache and does not write when reloading a persisted Q-value fails', async () => {
        manager.setQValueInCache('first', 0.8);
        manager.setQValueInCache('second', 0.7);
        const write = jest.fn(async () => undefined);
        manager.setPersistenceCallback(write, async () => { throw new Error('read unavailable'); });

        await expect(manager.updateQValue('uncached', 1)).rejects.toThrow('read unavailable');
        expect(write).not.toHaveBeenCalled();
        expect(manager.getQValue('first')).toBe(0.8);
        expect(manager.getQValue('second')).toBe(0.7);
        expect(manager.isCached('uncached')).toBe(false);
        expect(manager.getCacheStats().size).toBe(2);
    });

    it.each([NaN, Infinity, -Infinity, -0.1, 1.1])('rejects invalid persisted Q-value %s before mutation', async value => {
        const write = jest.fn(async () => undefined);
        manager.setPersistenceCallback(write, async () => value);

        await expect(manager.updateQValue('invalid', 1)).rejects.toThrow(/finite number in \[0, 1\]/);
        expect(write).not.toHaveBeenCalled();
        expect(manager.isCached('invalid')).toBe(false);
    });

    it('reserves capacity after an asynchronous reload so concurrent admission cannot exceed the bound', async () => {
        manager.updateConfig({ cache: { enabled: true, maxSize: 1, ttlMs: 60_000 } });
        let finishRead!: (value: number) => void;
        const readResult = new Promise<number>(resolve => { finishRead = resolve; });
        let notifyRead!: () => void;
        const reading = new Promise<void>(resolve => { notifyRead = resolve; });
        manager.setPersistenceCallback(async () => undefined, async () => { notifyRead(); return readResult; });

        const update = manager.updateQValue('reloaded', 1);
        await reading;
        manager.setQValueInCache('admitted-during-read', 0.6);
        finishRead(0.8);
        expect(await update).toBeCloseTo(0.82);
        expect(manager.getCacheStats().size).toBe(1);
        expect(manager.isCached('admitted-during-read')).toBe(false);
        expect(manager.isCached('reloaded')).toBe(true);
    });

    it('keeps an in-flight read paired with its original writer when the callbacks change', async () => {
        let finishRead!: (value: number) => void;
        const readResult = new Promise<number>(resolve => { finishRead = resolve; });
        let notifyRead!: () => void;
        const reading = new Promise<void>(resolve => { notifyRead = resolve; });
        const originalWrite = jest.fn(async () => undefined);
        const replacementWrite = jest.fn(async () => undefined);
        manager.setPersistenceCallback(originalWrite, async () => { notifyRead(); return readResult; });

        const update = manager.updateQValue('reloaded', 1);
        await reading;
        manager.setPersistenceCallback(replacementWrite, async () => 0.2);
        finishRead(0.8);
        expect(await update).toBeCloseTo(0.82);
        expect(originalWrite).toHaveBeenCalledTimes(1);
        expect(replacementWrite).not.toHaveBeenCalled();
    });

    it('does not overwrite unpersisted rewards with stale hydration', async () => {
        manager.setPersistenceCallback(async () => { throw new Error('storage unavailable'); }, async () => undefined);
        await manager.updateQValue('dirty', 1);
        manager.setQValueInCache('dirty', 0.2);
        expect(manager.getQValue('dirty')).toBeCloseTo(0.55);
    });

    it('serializes reversed overlapping hydration batches and reads duplicate IDs only once', async () => {
        let releaseRead!: (values: Map<string, number>) => void;
        const pendingRead = new Promise<Map<string, number>>(resolve => { releaseRead = resolve; });
        let notifyRead!: () => void;
        const reading = new Promise<void>(resolve => { notifyRead = resolve; });
        const firstRead = jest.fn(async () => { notifyRead(); return pendingRead; });
        const secondRead = jest.fn(async () => new Map([['second', 0.1], ['first', 0.2]]));

        const first = manager.hydrateQValues(['first', 'second', 'first'], firstRead);
        await reading;
        const second = manager.hydrateQValues(['second', 'first'], secondRead);
        const completed = Promise.allSettled([first, second]);
        releaseRead(new Map([['first', 0.8], ['second', 0.9]]));

        expect(await completed).toEqual([
            { status: 'fulfilled', value: undefined },
            { status: 'fulfilled', value: undefined }
        ]);
        expect(firstRead).toHaveBeenCalledWith(['first', 'second']);
        expect(secondRead).not.toHaveBeenCalled();
        expect(manager.getQValue('first')).toBe(0.8);
        expect(manager.getQValue('second')).toBe(0.9);

        // Finished reservations must not pin either value against later eviction.
        manager.setQValueInCache('third', 0.7);
        expect(manager.getCacheStats().size).toBe(2);
    });

    it('admits a hydration batch larger than the cache one entry at a time', async () => {
        const read = jest.fn(async () => new Map([
            ['first', 0.1], ['second', 0.2], ['third', 0.3], ['fourth', 0.4], ['unrequested', 0.9]
        ]));
        await manager.hydrateQValues(['first', 'second', 'third', 'fourth'], read);

        expect(read).toHaveBeenCalledTimes(1);
        expect(manager.getCacheStats().size).toBe(2);
        expect(manager.isCached('first')).toBe(false);
        expect(manager.isCached('second')).toBe(false);
        expect(manager.getQValue('third')).toBe(0.3);
        expect(manager.getQValue('fourth')).toBe(0.4);
        expect(manager.isCached('unrequested')).toBe(false);
    });

    it('releases all hydration reservations when the batch read rejects', async () => {
        const hydration = manager.hydrateQValues(['first', 'second'], async () => {
            throw new Error('batch read unavailable');
        });
        const rewards = [manager.updateQValue('first', 1), manager.updateQValue('second', 0)];
        const completed = Promise.allSettled([hydration, ...rewards]);

        expect(await completed).toEqual([
            { status: 'rejected', reason: expect.objectContaining({ message: 'batch read unavailable' }) },
            { status: 'fulfilled', value: expect.closeTo(0.55) },
            { status: 'fulfilled', value: expect.closeTo(0.45) }
        ]);
        manager.setQValueInCache('third', 0.7);
        expect(manager.getCacheStats().size).toBe(2);
    });

    it.each([NaN, Infinity, -Infinity, -0.1, 1.1])(
        'validates the entire hydration batch before mutation and releases reservations for invalid value %s',
        async value => {
            await expect(manager.hydrateQValues(['valid', 'invalid'], async () =>
                new Map([['valid', 0.8], ['invalid', value]])
            )).rejects.toThrow(/finite number in \[0, 1\]/);

            expect(manager.getCacheStats().size).toBe(0);
            expect(await manager.updateQValue('valid', 1)).toBeCloseTo(0.55);
            expect(await manager.updateQValue('invalid', 0)).toBeCloseTo(0.45);
        }
    );

    it('preserves pending rewards when hydration cannot reserve capacity and releases failed batch keys', async () => {
        manager.updateConfig({ cache: { enabled: true, maxSize: 1, ttlMs: 60_000 } });
        let releaseWrite!: () => void;
        const pendingWrite = new Promise<void>(resolve => { releaseWrite = resolve; });
        let notifyWrite!: () => void;
        const writing = new Promise<void>(resolve => { notifyWrite = resolve; });
        manager.setPersistenceCallback(async () => { notifyWrite(); await pendingWrite; }, async () => undefined);

        const reward = manager.updateQValue('rewarded', 1);
        const rewardCompleted = Promise.allSettled([reward]);
        try {
            await writing;
            await expect(manager.hydrateQValues(['blocked'], async () => new Map([['blocked', 0.8]])))
                .rejects.toThrow(/capacity.*unpersisted/i);
            expect(manager.getQValue('rewarded')).toBeCloseTo(0.55);
            expect(manager.isCached('blocked')).toBe(false);
        } finally {
            releaseWrite();
            await rewardCompleted;
        }
        expect(await manager.updateQValue('blocked', 0)).toBeCloseTo(0.45);
        expect(manager.getCacheStats().size).toBe(1);
    });

    it('applies a smaller limit immediately when entries have persisted', async () => {
        await manager.updateQValue('first', 1);
        await manager.updateQValue('second', 1);
        manager.updateConfig({ cache: { enabled: true, maxSize: 1, ttlMs: 60_000 } });
        expect(manager.getCacheStats()).toEqual(expect.objectContaining({ size: 1, maxSize: 1 }));
        expect(manager.isCached('second')).toBe(true);
    });

    it('rejects a shrink that would discard dirty entries without changing configuration', async () => {
        manager.setPersistenceCallback(async () => { throw new Error('storage unavailable'); }, async () => undefined);
        await manager.updateQValue('first', 1);
        await manager.updateQValue('second', 1);
        expect(() => manager.updateConfig({ cache: { enabled: true, maxSize: 1, ttlMs: 60_000 } }))
            .toThrow(/capacity.*unpersisted/i);
        expect(manager.getCacheStats()).toEqual(expect.objectContaining({ size: 2, maxSize: 2 }));
    });

    it.each([0, -1, 1.5, NaN, Infinity])('rejects invalid cache capacity %s before configuration changes', maxSize => {
        expect(() => manager.updateConfig({ cache: { enabled: true, maxSize, ttlMs: 60_000 } }))
            .toThrow(/positive integer/);
        expect(manager.getCacheStats().maxSize).toBe(2);
    });
});
