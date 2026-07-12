/**
 * Unit tests for SessionRunner timer lifecycle.
 *
 * `mxf run` used to stay alive until its full --timeout elapsed even after the
 * task had finished: the timeout was created with a bare setTimeout that was
 * never cleared, so the handle kept the event loop alive. A task that finished
 * in 10s left the process idling for the remaining ~290s.
 *
 * These tests drive a fake SDK and assert no timer survives a completed run.
 *
 * @author Brad Anderson <BradA1878@pm.me>
 */

// chalk 5 is ESM-only; this suite runs under ts-jest's CommonJS transform.
jest.mock('chalk', () => {
    const identity = (value: string): string => value;
    return { __esModule: true, default: new Proxy({}, { get: () => identity }) };
});

/** Event handlers the runner registered on the channel, keyed by event name */
const channelHandlers: Record<string, (payload: any) => void> = {};

/** Captured so a test can trigger completion at the moment the task is created */
let onTaskCreated: (() => void) | undefined;

jest.mock('@mxf-dev/sdk', () => {
    const { Events } = jest.requireActual('@mxf-dev/core/events/EventNames');

    const channel = {
        on: (event: string, handler: (payload: any) => void) => {
            channelHandlers[event] = handler;
        },
        destroy: jest.fn(),
    };

    const agent = {
        connect: jest.fn().mockResolvedValue(undefined),
        disconnect: jest.fn().mockResolvedValue(undefined),
        refreshTools: jest.fn().mockResolvedValue(['task_complete']),
        mxfService: {
            createTask: jest.fn().mockImplementation(async () => {
                onTaskCreated?.();
            }),
        },
    };

    return {
        __esModule: true,
        Events,
        LlmProviderType: { OPENROUTER: 'openrouter' },
        MxfSDK: jest.fn().mockImplementation(() => ({
            connect: jest.fn().mockResolvedValue(undefined),
            disconnect: jest.fn().mockResolvedValue(undefined),
            createChannel: jest.fn().mockResolvedValue(channel),
            generateKey: jest.fn().mockResolvedValue({ keyId: 'k', secretKey: 's' }),
            createAgent: jest.fn().mockResolvedValue(agent),
        })),
    };
});

import { Events } from '@mxf-dev/core/events/EventNames';
import { SessionRunner } from '../../../src/cli/services/SessionRunner';

/** A run configuration with a long timeout — the leak this suite guards against */
const LONG_TIMEOUT_MS = 300_000;

function makeRunner(): SessionRunner {
    return new SessionRunner({
        serverUrl: 'http://localhost:3001',
        domainKey: 'domain-key',
        accessToken: 'token',
        llmProvider: 'openrouter',
        apiKey: 'api-key',
        defaultModel: 'anthropic/claude-sonnet-4.6',
        task: 'do the thing',
        format: 'text',
        timeoutMs: LONG_TIMEOUT_MS,
        isTTY: false,
    });
}

beforeEach(() => {
    jest.useFakeTimers();
    for (const key of Object.keys(channelHandlers)) delete channelHandlers[key];
    onTaskCreated = undefined;
    // cleanup() DELETEs agent memory and the ephemeral channel over HTTP
    global.fetch = jest.fn().mockResolvedValue({ ok: true }) as unknown as typeof fetch;
});

afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
});

describe('SessionRunner — timer cleanup', () => {
    it('leaves no pending timer after a task completes', async () => {
        const runner = makeRunner();

        // Complete the task as soon as it is created
        onTaskCreated = () => {
            channelHandlers[Events.Task.COMPLETED]?.({
                data: { task: { result: { summary: 'done' } } },
            });
        };

        const runPromise = runner.run();
        // The completion handler waits a short grace period for trailing messages
        await jest.advanceTimersByTimeAsync(1000);
        const result = await runPromise;

        expect(result.success).toBe(true);
        expect(result.output).toBe('done');

        // The whole point: the 300s timeout must not still be armed. If it is,
        // the process keeps running long after the task finished.
        expect(jest.getTimerCount()).toBe(0);
    });

    it('leaves no pending timer after a task fails', async () => {
        const runner = makeRunner();

        onTaskCreated = () => {
            channelHandlers[Events.Task.FAILED]?.({ data: { error: 'boom' } });
        };

        const runPromise = runner.run();
        await jest.advanceTimersByTimeAsync(1000);
        const result = await runPromise;

        expect(result.success).toBe(false);
        expect(result.error).toBe('boom');
        expect(jest.getTimerCount()).toBe(0);
    });

    it('still times out when the task never completes', async () => {
        const runner = makeRunner();

        // No completion event is ever emitted
        const runPromise = runner.run();
        await jest.advanceTimersByTimeAsync(LONG_TIMEOUT_MS + 1000);
        const result = await runPromise;

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/timed out after 300 seconds/);
        expect(jest.getTimerCount()).toBe(0);
    });
});
