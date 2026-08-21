import { Logger } from '@mxf-dev/core/utils/Logger';

export interface ServerShutdownStep {
    name: string;
    run: () => void | Promise<void>;
}

export interface ServerShutdownFailure {
    step: string;
    cause: unknown;
}

export interface ServerShutdownOrderConstraint {
    before: string;
    after: string;
}

/**
 * Raised after every shutdown step has been attempted and one or more failed.
 */
export class ServerShutdownError extends Error {
    public readonly failures: readonly ServerShutdownFailure[];

    public constructor(failures: readonly ServerShutdownFailure[]) {
        super(`Server shutdown failed in ${failures.length} step(s): ${failures
            .map(failure => failure.step)
            .join(', ')}`);
        this.name = 'ServerShutdownError';
        this.failures = failures;
    }
}

/**
 * Runs one ordered, idempotent shutdown for every caller and signal.
 *
 * Cleanup continues after an individual step fails so independent resources
 * are not abandoned. The aggregate failure is returned only after every step
 * has had one opportunity to release its resource.
 */
export class ServerShutdownCoordinator {
    private readonly logger = new Logger('info', 'ServerShutdownCoordinator', 'server');
    private readonly steps: readonly ServerShutdownStep[];
    private shutdownPromise: Promise<void> | undefined;

    public constructor(
        steps: readonly ServerShutdownStep[],
        orderConstraints: readonly ServerShutdownOrderConstraint[] = []
    ) {
        if (steps.length === 0) {
            throw new Error('Server shutdown requires at least one cleanup step');
        }

        const names = new Set<string>();
        for (const step of steps) {
            if (typeof step.name !== 'string' || step.name.trim().length === 0) {
                throw new Error('Every server shutdown step requires a non-empty name');
            }
            if (names.has(step.name)) {
                throw new Error(`Duplicate server shutdown step '${step.name}'`);
            }
            names.add(step.name);
        }

        const stepIndexes = new Map(steps.map((step, index) => [step.name, index]));
        for (const constraint of orderConstraints) {
            const beforeIndex = stepIndexes.get(constraint.before);
            const afterIndex = stepIndexes.get(constraint.after);
            if (beforeIndex === undefined || afterIndex === undefined) {
                throw new Error(
                    `Shutdown order constraint references an unknown step: ` +
                    `'${constraint.before}' before '${constraint.after}'`
                );
            }
            if (beforeIndex >= afterIndex) {
                throw new Error(
                    `Shutdown step '${constraint.before}' must run before '${constraint.after}'`
                );
            }
        }

        this.steps = [...steps];
    }

    /** Return the same in-flight or settled promise to every shutdown caller. */
    public shutdown(reason: string): Promise<void> {
        if (this.shutdownPromise) {
            return this.shutdownPromise;
        }

        this.shutdownPromise = this.runShutdown(reason);
        return this.shutdownPromise;
    }

    private async runShutdown(reason: string): Promise<void> {
        this.logger.info(`Server shutdown started (${reason})`);
        const failures: ServerShutdownFailure[] = [];

        for (const step of this.steps) {
            try {
                await step.run();
            } catch (cause) {
                failures.push({ step: step.name, cause });
                this.logger.error(`Server shutdown step '${step.name}' failed`, cause);
            }
        }

        if (failures.length > 0) {
            throw new ServerShutdownError(failures);
        }

        this.logger.info('Server shutdown completed');
    }
}
