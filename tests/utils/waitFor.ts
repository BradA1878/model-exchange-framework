/**
 * Async Utilities for Testing
 *
 * Provides polling and waiting utilities for async operations in tests.
 */

export interface WaitForOptions {
    /** Maximum time to wait in milliseconds (default: 10000) */
    timeout?: number;
    /** Interval between checks in milliseconds (default: 100) */
    interval?: number;
    /** Custom error message on timeout */
    message?: string;
}

/**
 * Wait for a condition to become true
 *
 * @example
 * // Wait for agent to connect
 * await waitFor(() => agent.isConnected());
 *
 * @example
 * // Wait for events with custom timeout
 * const result = await waitFor(
 *   () => events.find(e => e.type === 'registered'),
 *   { timeout: 15000, message: 'Agent registration timeout' }
 * );
 */
export async function waitFor<T>(
    condition: () => T | Promise<T>,
    options: WaitForOptions = {}
): Promise<T> {
    const {
        timeout = 10000,
        interval = 100,
        message = 'Condition not met within timeout'
    } = options;

    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
        try {
            const result = await condition();
            if (result) {
                return result;
            }
        } catch (error) {
            // Condition threw an error, keep trying
        }

        await sleep(interval);
    }

    throw new Error(`Timeout (${timeout}ms): ${message}`);
}

/**
 * Wait for a specific event from an event emitter
 *
 * @example
 * const event = await waitForEvent(agent, 'registered', 5000);
 */
export async function waitForEvent<T = any>(
    emitter: EventEmitterLike,
    eventName: string,
    timeout: number = 10000
): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error(`Timeout (${timeout}ms) waiting for event: ${eventName}`));
        }, timeout);

        const handler = (data: T): void => {
            clearTimeout(timer);
            // Remove listener if possible
            if (typeof emitter.off === 'function') {
                emitter.off(eventName, handler);
            } else if (typeof emitter.removeListener === 'function') {
                emitter.removeListener(eventName, handler);
            }
            resolve(data);
        };

        // Support different event emitter interfaces
        if (typeof emitter.once === 'function') {
            emitter.once(eventName, handler);
        } else if (typeof emitter.on === 'function') {
            emitter.on(eventName, handler);
        } else {
            clearTimeout(timer);
            reject(new Error('Object does not have event emitter methods'));
        }
    });
}

/**
 * Wait for multiple events to occur
 *
 * @example
 * const events = await waitForEvents(agent, ['registered', 'connected'], 10000);
 */
export async function waitForEvents<T = any>(
    emitter: EventEmitterLike,
    eventNames: string[],
    timeout: number = 10000
): Promise<Record<string, T>> {
    const results: Record<string, T> = {};
    const remaining = new Set(eventNames);

    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error(
                `Timeout (${timeout}ms) waiting for events: ${Array.from(remaining).join(', ')}`
            ));
        }, timeout);

        const checkComplete = (): void => {
            if (remaining.size === 0) {
                clearTimeout(timer);
                resolve(results);
            }
        };

        for (const eventName of eventNames) {
            const handler = (data: T): void => {
                results[eventName] = data;
                remaining.delete(eventName);
                checkComplete();
            };

            if (typeof emitter.once === 'function') {
                emitter.once(eventName, handler);
            } else if (typeof emitter.on === 'function') {
                emitter.on(eventName, handler);
            }
        }
    });
}

/**
 * Sleep for a specified duration
 *
 * @example
 * await sleep(1000); // Wait 1 second
 */
export function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry a function until it succeeds or max attempts reached
 *
 * @example
 * const result = await retry(
 *   () => agent.executeTool('some_tool', { param: 'value' }),
 *   { maxAttempts: 3, delay: 1000 }
 * );
 */
export async function retry<T>(
    fn: () => T | Promise<T>,
    options: {
        maxAttempts?: number;
        delay?: number;
        backoff?: number;
        shouldRetry?: (error: any) => boolean;
    } = {}
): Promise<T> {
    const {
        maxAttempts = 3,
        delay = 1000,
        backoff = 2,
        shouldRetry = () => true
    } = options;

    let lastError: any;
    let currentDelay = delay;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;

            if (attempt === maxAttempts || !shouldRetry(error)) {
                throw error;
            }

            await sleep(currentDelay);
            currentDelay *= backoff;
        }
    }

    throw lastError;
}

/**
 * Execute a function with a timeout
 *
 * @example
 * const result = await withTimeout(
 *   () => agent.executeTool('slow_tool', {}),
 *   5000,
 *   'Tool execution timeout'
 * );
 */
export async function withTimeout<T>(
    fn: () => Promise<T>,
    timeout: number,
    message: string = 'Operation timed out'
): Promise<T> {
    return Promise.race([
        fn(),
        new Promise<T>((_, reject) => {
            setTimeout(() => reject(new Error(`Timeout (${timeout}ms): ${message}`)), timeout);
        })
    ]);
}

/**
 * Poll until a value changes
 *
 * @example
 * const newValue = await pollUntilChanged(
 *   () => agent.getStatus(),
 *   'connecting',
 *   { timeout: 10000 }
 * );
 */
export async function pollUntilChanged<T>(
    getValue: () => T | Promise<T>,
    initialValue: T,
    options: WaitForOptions = {}
): Promise<T> {
    return waitFor(async () => {
        const current = await getValue();
        if (current !== initialValue) {
            return current;
        }
        return false as unknown as T;
    }, {
        ...options,
        message: options.message || `Value did not change from ${String(initialValue)}`
    });
}

// Type for objects with event emitter methods
interface EventEmitterLike {
    on?: (event: string, handler: (...args: any[]) => void) => any;
    once?: (event: string, handler: (...args: any[]) => void) => any;
    off?: (event: string, handler: (...args: any[]) => void) => any;
    removeListener?: (event: string, handler: (...args: any[]) => void) => any;
}
