/**
 * The manager is created lazily by the first agent connection that forwards a
 * user-input request. Its cleanup interval must not keep the server process
 * alive on its own, and shutdown must be reachable without constructing a
 * manager that was never needed.
 *
 * Found with the first-contact demo: after one demo run, SIGTERM ran every
 * coordinator step ("Server shutdown completed") and the process stayed alive
 * — this interval was the one referenced timer left.
 */

import { UserInputRequestManager } from '@mxf-dev/core/services/UserInputRequestManager';

interface IntervalHandle {
    hasRef?: () => boolean;
}

describe('UserInputRequestManager lifecycle', () => {
    beforeEach(() => {
        jest.useFakeTimers();
        UserInputRequestManager.shutdownExisting();
    });

    afterEach(() => {
        UserInputRequestManager.shutdownExisting();
        jest.clearAllTimers();
        jest.useRealTimers();
    });

    it('does not let its cleanup interval keep the process alive', () => {
        const manager = UserInputRequestManager.getInstance();
        const interval = (manager as unknown as { cleanupInterval: IntervalHandle | null }).cleanupInterval;

        expect(jest.getTimerCount()).toBe(1);
        expect(interval?.hasRef?.()).toBe(false);
    });

    it('shutdownExisting stops the live manager without constructing one', () => {
        expect(UserInputRequestManager.shutdownExisting()).toBe(false);
        expect(jest.getTimerCount()).toBe(0);

        UserInputRequestManager.getInstance();
        expect(jest.getTimerCount()).toBe(1);

        expect(UserInputRequestManager.shutdownExisting()).toBe(true);
        expect(jest.getTimerCount()).toBe(0);
        expect(UserInputRequestManager.shutdownExisting()).toBe(false);
    });
});
