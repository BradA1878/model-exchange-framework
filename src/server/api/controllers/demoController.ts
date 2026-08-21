/**
 * Copyright 2024 Brad Anderson
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * @author Brad Anderson <BradA1878@pm.me>
 * @repository https://github.com/BradA1878/model-exchange-framework
 * @documentation https://mxf-dev.github.io/mxf/
 */

import { Request, Response } from 'express';
import { spawn, ChildProcess } from 'child_process';
import { randomUUID } from 'crypto';
import path from 'path';
import fs from 'fs';
import { Logger } from '@mxf-dev/core/utils/Logger';

// Create logger instance for demo controller
const logger = new Logger('info', 'DemoController', 'server');

interface ActiveDemo {
    process: ChildProcess;
    startedAt: number;
    terminationPromise?: Promise<void>;
    forceKillTimer?: ReturnType<typeof setTimeout>;
}

// A demo can make multiple paid LLM calls. Single-flight is intentional: the
// endpoint is for an operator-driven presentation, not a process queue.
export const MAX_ACTIVE_DEMOS = 1;

/**
 * How long a demo gets to exit after SIGTERM before it is sent SIGKILL. The
 * same escalation BackgroundTaskManager uses for shell tasks: without it, a
 * child that traps SIGTERM would block the stop endpoint and every server
 * shutdown step after 'demo-processes'.
 */
export const DEMO_FORCE_KILL_GRACE_MS = 5000;
const activeDemos = new Map<string, ActiveDemo>();

const finalizeActiveDemo = (demoId: string, demo: ActiveDemo): void => {
    if (activeDemos.get(demoId) === demo) {
        activeDemos.delete(demoId);
    }
};

/**
 * Signal one demo exactly once and keep it owned until its child reaches a
 * terminal event. Concurrent stop requests share the same terminal promise.
 */
const terminateActiveDemo = (demoId: string, demo: ActiveDemo): Promise<void> => {
    if (demo.terminationPromise) {
        return demo.terminationPromise;
    }

    let resolveTermination!: () => void;
    let rejectTermination!: (cause: unknown) => void;
    const terminationPromise = new Promise<void>((resolve, reject) => {
        resolveTermination = resolve;
        rejectTermination = reject;
    });
    demo.terminationPromise = terminationPromise;

    const clearForceKill = (): void => {
        if (demo.forceKillTimer) {
            clearTimeout(demo.forceKillTimer);
            demo.forceKillTimer = undefined;
        }
    };

    const handleTerminalEvent = (): void => {
        clearForceKill();
        demo.process.off('close', handleTerminalEvent);
        demo.process.off('error', handleProcessError);
        finalizeActiveDemo(demoId, demo);
        resolveTermination();
    };

    // Node can emit error before close for a process that was spawned. Only a
    // spawn failure (no pid) is terminal without waiting for close.
    const handleProcessError = (): void => {
        if (demo.process.pid === undefined) {
            handleTerminalEvent();
        }
    };

    demo.process.once('close', handleTerminalEvent);
    demo.process.once('error', handleProcessError);

    try {
        demo.process.kill('SIGTERM');
        demo.forceKillTimer = setTimeout(() => {
            demo.forceKillTimer = undefined;
            logger.warn(`Demo ${demoId} did not exit within ${DEMO_FORCE_KILL_GRACE_MS}ms of SIGTERM; sending SIGKILL`);
            demo.process.kill('SIGKILL');
        }, DEMO_FORCE_KILL_GRACE_MS);
        demo.forceKillTimer.unref?.();
    } catch (cause) {
        clearForceKill();
        demo.process.off('close', handleTerminalEvent);
        demo.process.off('error', handleProcessError);
        demo.terminationPromise = undefined;
        rejectTermination(cause);
    }

    return terminationPromise;
};

/**
 * Build the minimal environment the interview demo actually consumes.
 * The child runs with the demo directory as cwd so its dotenv.config() call
 * cannot reload the server's root .env and undo this allowlist.
 */
const buildDemoEnvironment = (): Record<string, string> => {
    const allowedNames = [
        'PATH',
        'HOME',
        'TMPDIR',
        'NODE_ENV',
        'MXF_DOMAIN_KEY',
        'MXF_DEMO_ACCESS_TOKEN',
        'MXF_API_URL',
        'OPENROUTER_API_KEY'
    ];
    const environment: Record<string, string> = {};

    for (const name of allowedNames) {
        const value = process.env[name];
        if (value !== undefined) {
            environment[name] = value;
        }
    }

    return environment;
};

/**
 * Start the real interview scheduling demo
 */
export const startInterviewDemo = async (req: Request, res: Response): Promise<void> => {
    try {
        if (activeDemos.size >= MAX_ACTIVE_DEMOS) {
            res.status(429).json({
                success: false,
                error: 'A demo is already running. Stop it or wait for it to finish before starting another.'
            });
            return;
        }

        const demoId = `demo-${randomUUID()}`;
        
        // Path to the actual interview demo TypeScript file
        // From src/server/api/controllers/ go up 4 levels to project root
        const projectRoot = path.join(__dirname, '../../../..');
        const demoPath = path.join(projectRoot, 'examples/interview-scheduling-demo/interview-scheduling-demo.ts');
        
        // Check if the demo file exists
        if (!fs.existsSync(demoPath)) {
            throw new Error(`Demo file not found at: ${demoPath}`);
        }
        
        
        // Use the framework runtime directly. This avoids `npx` downloading or
        // resolving an unexpected ts-node package at request time.
        const demoProcess = spawn(process.execPath, [demoPath], {
            cwd: path.dirname(demoPath),
            env: buildDemoEnvironment(),
            stdio: ['pipe', 'pipe', 'pipe']
        });
        
        // Store the process for cleanup
        const activeDemo: ActiveDemo = {
            process: demoProcess,
            startedAt: Date.now()
        };
        activeDemos.set(demoId, activeDemo);
        
        // Drain both streams so the child cannot block on full pipe buffers.
        // Output is deliberately not broadcast to the global Socket.IO namespace.
        demoProcess.stdout?.on('data', () => undefined);
        demoProcess.stderr?.on('data', () => undefined);
        
        // Handle process completion
        demoProcess.on('close', (code: number) => {
            finalizeActiveDemo(demoId, activeDemo);
            logger.info(`Demo ${demoId} completed with code ${code}`);
        });
        
        // Handle process errors
        demoProcess.on('error', (error: Error) => {
            if (demoProcess.pid === undefined) {
                finalizeActiveDemo(demoId, activeDemo);
            }
            logger.error(`Demo ${demoId} failed: ${error.message}`);
        });
        
        res.json({
            success: true,
            demoId,
            message: 'Interview demo started successfully'
        });
        
    } catch (error) {
        logger.error('Failed to start interview demo:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to start interview demo',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
};

/**
 * Stop a running demo
 */
export const stopDemo = async (req: Request, res: Response): Promise<void> => {
    try {
        const { demoId } = req.params;
        
        const activeDemo = activeDemos.get(demoId);
        if (!activeDemo) {
            res.status(404).json({
                success: false,
                error: 'Demo not found'
            });
            return;
        }
        
        await terminateActiveDemo(demoId, activeDemo);
        
        res.json({
            success: true,
            message: 'Demo stopped successfully'
        });
        
    } catch (error) {
        logger.error('Failed to stop demo:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to stop demo',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
};

/**
 * Get status of running demos
 */
export const getDemoStatus = async (req: Request, res: Response): Promise<void> => {
    try {
        const runningDemos = Array.from(activeDemos.entries()).map(([demoId, demo]) => ({
            demoId,
            startedAt: demo.startedAt
        }));
        
        res.json({
            success: true,
            data: {
                runningDemos,
                count: runningDemos.length
            }
        });
        
    } catch (error) {
        logger.error('Failed to get demo status:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get demo status',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
};

/**
 * Terminates every demo child process. Wired into server shutdown so demo
 * subprocesses never outlive the server.
 */
export const stopAllActiveDemos = async (): Promise<void> => {
    const demos = Array.from(activeDemos.entries());
    await Promise.all(demos.map(([demoId, demo]) => terminateActiveDemo(demoId, demo)));
};
