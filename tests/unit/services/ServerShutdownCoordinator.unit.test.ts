jest.mock('@mxf-dev/core/utils/Logger', () => ({
    Logger: class MockLogger {
        public info = jest.fn();
        public error = jest.fn();
    }
}));

import {
    ServerShutdownCoordinator,
    ServerShutdownError
} from '../../../src/server/services/ServerShutdownCoordinator';

describe('ServerShutdownCoordinator', () => {
    it('runs every step once in declaration order', async () => {
        const order: string[] = [];
        const coordinator = new ServerShutdownCoordinator([
            { name: 'ingress', run: (): void => { order.push('ingress'); } },
            { name: 'services', run: async (): Promise<void> => { order.push('services'); } },
            { name: 'database', run: (): void => { order.push('database'); } }
        ]);

        await coordinator.shutdown('SIGTERM');

        expect(order).toEqual(['ingress', 'services', 'database']);
    });

    it('shares one shutdown across concurrent and repeated callers', async () => {
        let releaseStep: (() => void) | undefined;
        const step = jest.fn(() => new Promise<void>(resolve => {
            releaseStep = resolve;
        }));
        const coordinator = new ServerShutdownCoordinator([{ name: 'deferred', run: step }]);

        const first = coordinator.shutdown('SIGINT');
        const second = coordinator.shutdown('SIGTERM');

        expect(second).toBe(first);
        expect(step).toHaveBeenCalledTimes(1);
        releaseStep?.();
        await first;
        await expect(coordinator.shutdown('repeat')).resolves.toBeUndefined();
        expect(step).toHaveBeenCalledTimes(1);
    });

    it('attempts independent cleanup after a failure and reports every failed step', async () => {
        const finalStep = jest.fn();
        const coordinator = new ServerShutdownCoordinator([
            { name: 'first', run: (): never => { throw new Error('first failure'); } },
            {
                name: 'second',
                run: async (): Promise<never> => { throw new Error('second failure'); }
            },
            { name: 'final', run: finalStep }
        ]);

        const rejection = coordinator.shutdown('test');
        await expect(rejection).rejects.toBeInstanceOf(ServerShutdownError);
        await expect(rejection).rejects.toMatchObject({
            failures: [
                { step: 'first' },
                { step: 'second' }
            ]
        });
        expect(finalStep).toHaveBeenCalledTimes(1);
    });

    it('rejects ambiguous step configuration before shutdown begins', () => {
        expect(() => new ServerShutdownCoordinator([])).toThrow(/at least one/);
        expect(() => new ServerShutdownCoordinator([
            { name: 'same', run: jest.fn() },
            { name: 'same', run: jest.fn() }
        ])).toThrow(/Duplicate/);
    });

    it('rejects a shutdown plan that tears down dependencies before accepted work drains', () => {
        expect(() => new ServerShutdownCoordinator([
            { name: 'ingress', run: jest.fn() },
            { name: 'services', run: jest.fn() },
            { name: 'accepted-work', run: jest.fn() }
        ], [
            { before: 'ingress', after: 'accepted-work' },
            { before: 'accepted-work', after: 'services' }
        ])).toThrow("'accepted-work' must run before 'services'");

        expect(() => new ServerShutdownCoordinator([
            { name: 'ingress', run: jest.fn() }
        ], [
            { before: 'ingress', after: 'missing-drain' }
        ])).toThrow('unknown step');
    });

    it('requires HTTP ingress to close before paid demo processes are stopped', async () => {
        const order: string[] = [];
        const steps = [
            { name: 'http-ingress', run: (): void => { order.push('http-ingress'); } },
            { name: 'demo-processes', run: (): void => { order.push('demo-processes'); } }
        ];
        const constraint = [{ before: 'http-ingress', after: 'demo-processes' }];

        const coordinator = new ServerShutdownCoordinator(steps, constraint);
        await coordinator.shutdown('test');
        expect(order).toEqual(['http-ingress', 'demo-processes']);

        expect(() => new ServerShutdownCoordinator([...steps].reverse(), constraint))
            .toThrow("'http-ingress' must run before 'demo-processes'");
    });
});
