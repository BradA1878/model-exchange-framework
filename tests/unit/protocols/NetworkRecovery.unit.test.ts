/**
 * Unit tests for NetworkRecoveryManager request-time bounding.
 *
 * These exist because of a production stall: an LLM request that never settled
 * was invisible to executeWithRetry — it only ever observed operations that
 * rejected, so a hung fetch held the retry loop (and everything queued behind
 * it) open forever with nothing logged. The consumer's own task backstop was
 * what eventually killed the agent.
 *
 * The contract pinned here:
 * - an operation that never settles fails after requestTimeoutMs, not never
 * - that failure is REQUEST_TIMEOUT and is NOT retried (a request that just
 *   consumed the whole timeout budget must fail fast, not silently retry)
 * - ordinary retryable failures (5xx and friends) still retry as before
 * - an operation that settles after losing to the timeout does not crash the
 *   process with an unhandled rejection
 */

import { NetworkRecoveryManager } from '@mxf-dev/core/protocols/mcp/utils/NetworkRecovery';
import {
    DEFAULT_NETWORK_RECOVERY_CONFIG,
    NetworkErrorType,
    NetworkRecoveryConfig,
    classifyNetworkError,
    isRetryableError
} from '@mxf-dev/core/types/NetworkRecoveryTypes';

function buildConfig(overrides: Partial<NetworkRecoveryConfig>): NetworkRecoveryConfig {
    return {
        ...DEFAULT_NETWORK_RECOVERY_CONFIG,
        // Keep retries fast so tests stay well under the jest timeout
        baseDelayMs: 1,
        maxDelayMs: 5,
        ...overrides
    };
}

describe('request timeout classification', () => {
    it('classifies an AbortSignal.timeout rejection (name TimeoutError) as REQUEST_TIMEOUT', () => {
        const error = new Error('The operation was aborted due to timeout');
        error.name = 'TimeoutError';
        expect(classifyNetworkError(error)).toBe(NetworkErrorType.REQUEST_TIMEOUT);
    });

    it('classifies an isRequestTimeout-flagged error as REQUEST_TIMEOUT', () => {
        const error = new Error('request abandoned');
        (error as any).isRequestTimeout = true;
        expect(classifyNetworkError(error)).toBe(NetworkErrorType.REQUEST_TIMEOUT);
    });

    it('keeps message-based timeouts as retryable NETWORK_TIMEOUT', () => {
        // Connection-level timeouts are transient and cheap to retry — only the
        // hard per-request bound is terminal. The classifier matches these by the
        // 'timeout' substring, as before.
        const error = new Error('connection timeout while connecting to host');
        expect(classifyNetworkError(error)).toBe(NetworkErrorType.NETWORK_TIMEOUT);
        expect(isRetryableError(NetworkErrorType.NETWORK_TIMEOUT)).toBe(true);
    });

    it('marks REQUEST_TIMEOUT as non-retryable', () => {
        expect(isRetryableError(NetworkErrorType.REQUEST_TIMEOUT)).toBe(false);
    });
});

describe('NetworkRecoveryManager constructor validation', () => {
    it('rejects a non-positive requestTimeoutMs', () => {
        expect(() => new NetworkRecoveryManager(buildConfig({ requestTimeoutMs: 0 }), 'test'))
            .toThrow(/requestTimeoutMs must be a positive number/);
    });

    it('rejects a NaN requestTimeoutMs (e.g. from a typo\'d env var)', () => {
        expect(() => new NetworkRecoveryManager(buildConfig({ requestTimeoutMs: NaN }), 'test'))
            .toThrow(/requestTimeoutMs must be a positive number/);
    });
});

describe('executeWithRetry request bounding', () => {
    it('fails a never-settling operation after requestTimeoutMs plus the net grace instead of hanging', async () => {
        const manager = new NetworkRecoveryManager(buildConfig({ requestTimeoutMs: 60, maxRetries: 3 }), 'test');
        const operation = jest.fn(() => new Promise<never>(() => undefined));

        const startedAt = Date.now();
        const result = await manager.executeWithRetry(operation);
        const elapsed = Date.now() - startedAt;

        expect(result.success).toBe(false);
        expect(result.error?.type).toBe(NetworkErrorType.REQUEST_TIMEOUT);
        expect(result.error?.message).toMatch(/60ms request timeout/);
        // Bounded promptly: one timeout window plus the 1s net grace that lets an
        // operation's own abort win the race — no retry windows stacked on top.
        expect(elapsed).toBeGreaterThanOrEqual(60);
        expect(elapsed).toBeLessThan(3000);
    });

    it('does not retry a timed-out operation', async () => {
        const manager = new NetworkRecoveryManager(buildConfig({ requestTimeoutMs: 40, maxRetries: 3 }), 'test');
        const operation = jest.fn(() => new Promise<never>(() => undefined));

        const result = await manager.executeWithRetry(operation);

        expect(result.success).toBe(false);
        expect(operation).toHaveBeenCalledTimes(1);
    });

    it('returns the operation result untouched when it settles inside the bound', async () => {
        const manager = new NetworkRecoveryManager(buildConfig({ requestTimeoutMs: 500 }), 'test');

        const result = await manager.executeWithRetry(async () => 'payload');

        expect(result.success).toBe(true);
        expect(result.data).toBe('payload');
    });

    it('still retries ordinary retryable failures', async () => {
        const manager = new NetworkRecoveryManager(buildConfig({ requestTimeoutMs: 500, maxRetries: 3 }), 'test');
        let attempts = 0;
        const operation = jest.fn(async () => {
            attempts++;
            if (attempts < 3) {
                const error = new Error(`OpenRouter API error [502]: bad gateway`);
                (error as any).status = 502;
                throw error;
            }
            return 'recovered';
        });

        const result = await manager.executeWithRetry(operation, (error: any) => error?.status);

        expect(result.success).toBe(true);
        expect(result.data).toBe('recovered');
        expect(operation).toHaveBeenCalledTimes(3);
    });

    it('surfaces a synchronous throw from the operation without waiting for the timer', async () => {
        const manager = new NetworkRecoveryManager(buildConfig({ requestTimeoutMs: 5000, maxRetries: 1 }), 'test');

        const startedAt = Date.now();
        const result = await manager.executeWithRetry(() => {
            throw new Error('sync failure');
        });

        expect(result.success).toBe(false);
        expect(result.error?.message).toBe('sync failure');
        expect(Date.now() - startedAt).toBeLessThan(1000);
    });

    it('surfaces the operation\'s own rejection when it arrives inside the net grace window', async () => {
        // The operation's own abort (e.g. AbortSignal.timeout on the fetch) fires
        // at requestTimeoutMs; the manager's net waits an extra grace so the
        // operation's richer error wins. An op that rejects shortly after its
        // nominal timeout therefore surfaces its own error, not the net's.
        const manager = new NetworkRecoveryManager(buildConfig({ requestTimeoutMs: 30, maxRetries: 1 }), 'test');
        const operation = () => new Promise<never>((_, reject) => {
            setTimeout(() => {
                const error = new Error('own abort: request timed out after 31ms');
                error.name = 'TimeoutError';
                (error as any).isRequestTimeout = true;
                reject(error);
            }, 60);
        });

        const result = await manager.executeWithRetry(operation);
        expect(result.success).toBe(false);
        expect(result.error?.type).toBe(NetworkErrorType.REQUEST_TIMEOUT);
        expect(result.error?.message).toMatch(/own abort/);
    });

    it('tolerates an operation that settles after the net already fired', async () => {
        const manager = new NetworkRecoveryManager(buildConfig({ requestTimeoutMs: 30, maxRetries: 1 }), 'test');
        // Rejects well past requestTimeoutMs + the 1s net grace
        const operation = () => new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error('late network error')), 1300);
        });

        const result = await manager.executeWithRetry(operation);
        expect(result.error?.type).toBe(NetworkErrorType.REQUEST_TIMEOUT);

        // Let the abandoned operation reject; an unhandled rejection here would
        // fail the run. The two-argument then() inside withRequestTimeout is what
        // keeps the late rejection observed.
        await new Promise(resolve => setTimeout(resolve, 400));
    });
});
