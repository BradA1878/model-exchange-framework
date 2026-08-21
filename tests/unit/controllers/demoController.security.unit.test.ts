import { EventEmitter } from 'events';
import { Request, Response } from 'express';
import { spawn } from 'child_process';

jest.mock('child_process', () => ({
    spawn: jest.fn()
}));

jest.mock('@mxf-dev/core/utils/Logger', () => ({
    Logger: jest.fn().mockImplementation(() => ({
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn()
    }))
}));

import {
    DEMO_FORCE_KILL_GRACE_MS,
    MAX_ACTIVE_DEMOS,
    getDemoStatus,
    startInterviewDemo,
    stopAllActiveDemos
} from '../../../src/server/api/controllers/demoController';

class FakeChildProcess extends EventEmitter {
    public pid: number | undefined = 1234;
    public stdout = new EventEmitter();
    public stderr = new EventEmitter();
    public kill = jest.fn(() => true);
}

const makeResponse = (): Response => {
    const response = {
        status: jest.fn(),
        json: jest.fn()
    } as unknown as Response;
    (response.status as jest.Mock).mockReturnValue(response);
    return response;
};

describe('demoController security containment', () => {
    const originalEnv = { ...process.env };
    const mockedSpawn = spawn as jest.MockedFunction<typeof spawn>;
    let child: FakeChildProcess;
    let globalSocketEmit: jest.Mock;
    let request: Request;

    beforeEach(() => {
        child = new FakeChildProcess();
        mockedSpawn.mockReturnValue(child as unknown as ReturnType<typeof spawn>);
        globalSocketEmit = jest.fn();
        request = {
            app: {
                locals: {
                    io: { emit: globalSocketEmit }
                }
            }
        } as unknown as Request;
    });

    afterEach(async () => {
        const shutdown = stopAllActiveDemos();
        child.emit('close', 0);
        await shutdown;
        mockedSpawn.mockReset();
        process.env = { ...originalEnv };
    });

    it('uses Bun directly, an isolated cwd, and a narrow environment', async () => {
        process.env.MXF_DOMAIN_KEY = 'domain-key';
        process.env.MXF_DEMO_ACCESS_TOKEN = 'demo-token';
        process.env.OPENROUTER_API_KEY = 'openrouter-key';
        process.env.JWT_SECRET = 'must-not-reach-child';
        process.env.MONGODB_URI = 'must-not-reach-child';
        process.env.MXF_WEBHOOK_SECRET = 'must-not-reach-child';

        const response = makeResponse();
        await startInterviewDemo(request, response);

        expect(mockedSpawn).toHaveBeenCalledTimes(1);
        const [command, args, options] = mockedSpawn.mock.calls[0];
        expect(command).toBe(process.execPath);
        expect(args).toHaveLength(1);
        expect(String(args[0])).toContain('interview-scheduling-demo.ts');
        expect(options?.cwd).toMatch(/examples\/interview-scheduling-demo$/);
        expect(options?.env).toEqual(expect.objectContaining({
            MXF_DOMAIN_KEY: 'domain-key',
            MXF_DEMO_ACCESS_TOKEN: 'demo-token',
            OPENROUTER_API_KEY: 'openrouter-key'
        }));
        expect(options?.env).not.toHaveProperty('JWT_SECRET');
        expect(options?.env).not.toHaveProperty('MONGODB_URI');
        expect(options?.env).not.toHaveProperty('MXF_WEBHOOK_SECRET');
    });

    it('is globally single-flight and rejects a second paid demo', async () => {
        expect(MAX_ACTIVE_DEMOS).toBe(1);
        const firstResponse = makeResponse();
        const secondResponse = makeResponse();

        await startInterviewDemo(request, firstResponse);
        await startInterviewDemo(request, secondResponse);

        expect(mockedSpawn).toHaveBeenCalledTimes(1);
        expect(secondResponse.status).toHaveBeenCalledWith(429);
    });

    it('never broadcasts process output on the global Socket.IO namespace', async () => {
        await startInterviewDemo(request, makeResponse());

        child.stdout.emit('data', Buffer.from('sensitive stdout'));
        child.stderr.emit('data', Buffer.from('sensitive stderr'));
        child.emit('close', 0);

        expect(globalSocketEmit).not.toHaveBeenCalled();
    });

    it('retains demo ownership until the child close event settles shutdown', async () => {
        await startInterviewDemo(request, makeResponse());

        let shutdownSettled = false;
        const shutdown = stopAllActiveDemos().then(() => {
            shutdownSettled = true;
        });
        await Promise.resolve();

        const pendingStatus = makeResponse();
        await getDemoStatus(request, pendingStatus);
        expect(child.kill).toHaveBeenCalledWith('SIGTERM');
        expect(shutdownSettled).toBe(false);
        expect(pendingStatus.json).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ count: 1 })
        }));

        child.emit('close', 0);
        await shutdown;

        const settledStatus = makeResponse();
        await getDemoStatus(request, settledStatus);
        expect(settledStatus.json).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ count: 0 })
        }));
    });

    it('escalates to SIGKILL when a demo ignores SIGTERM past the grace period', async () => {
        jest.useFakeTimers();
        try {
            await startInterviewDemo(request, makeResponse());

            let shutdownSettled = false;
            const shutdown = stopAllActiveDemos().then(() => {
                shutdownSettled = true;
            });
            expect(child.kill).toHaveBeenCalledWith('SIGTERM');
            expect(child.kill).toHaveBeenCalledTimes(1);

            jest.advanceTimersByTime(DEMO_FORCE_KILL_GRACE_MS - 1);
            expect(child.kill).toHaveBeenCalledTimes(1);
            jest.advanceTimersByTime(1);
            expect(child.kill).toHaveBeenCalledTimes(2);
            expect(child.kill).toHaveBeenLastCalledWith('SIGKILL');
            expect(shutdownSettled).toBe(false);

            child.emit('close', 137);
            await shutdown;
            expect(jest.getTimerCount()).toBe(0);
        } finally {
            jest.useRealTimers();
        }
    });

    it('does not force-kill or leave a timer behind when the demo exits on SIGTERM', async () => {
        jest.useFakeTimers();
        try {
            await startInterviewDemo(request, makeResponse());

            const shutdown = stopAllActiveDemos();
            child.emit('close', 0);
            await shutdown;

            expect(jest.getTimerCount()).toBe(0);
            jest.advanceTimersByTime(DEMO_FORCE_KILL_GRACE_MS * 2);
            expect(child.kill).toHaveBeenCalledTimes(1);
            expect(child.kill).toHaveBeenCalledWith('SIGTERM');
        } finally {
            jest.useRealTimers();
        }
    });

    it('shares one termination owner and waits for close after a process error', async () => {
        await startInterviewDemo(request, makeResponse());

        let firstSettled = false;
        const firstShutdown = stopAllActiveDemos();
        void firstShutdown.then(() => {
            firstSettled = true;
        });
        const secondShutdown = stopAllActiveDemos();

        expect(child.kill).toHaveBeenCalledTimes(1);

        child.emit('error', new Error('demo process stopped'));
        await Promise.resolve();

        const errorStatus = makeResponse();
        await getDemoStatus(request, errorStatus);
        expect(firstSettled).toBe(false);
        expect(errorStatus.json).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ count: 1 })
        }));

        child.emit('close', 1);
        await Promise.all([firstShutdown, secondShutdown]);

        expect(child.kill).toHaveBeenCalledTimes(1);
    });
});
