import { Events, type MxfAgent } from '@mxf-dev/sdk';

export interface TaskOutcome {
    taskId: string;
    status: 'completed' | 'failed' | 'cancelled';
    data: Record<string, unknown>;
}

/** Subscribe before creation; only the acknowledged task ID may settle this wait. */
export function createAndWait(
    agent: Pick<MxfAgent, 'on' | 'off'>,
    createTask: () => Promise<string>,
    signal: AbortSignal
): Promise<TaskOutcome> {
    return new Promise((resolve, reject) => {
        let taskId: string | undefined;
        let settled = false;
        const early = new Map<string, TaskOutcome>();
        const removeListeners: Array<() => void> = [];
        const finish = (outcome?: TaskOutcome, error?: Error): void => {
            if (settled) return;
            settled = true;
            for (const remove of removeListeners) remove();
            signal.removeEventListener('abort', abort);
            early.clear();
            if (error) reject(error);
            else if (outcome) resolve(outcome);
        };
        const abort = (): void => finish(undefined, new Error('Task outcome wait cancelled by the application'));
        if (signal.aborted) {
            abort();
            return;
        }
        const outcomes = [
            [Events.Task.COMPLETED, 'completed'],
            [Events.Task.FAILED, 'failed'],
            [Events.Task.CANCELLED, 'cancelled']
        ] as const;
        for (const [event, status] of outcomes) {
            const handler = (payload: unknown): void => {
                if (!payload || typeof payload !== 'object' || !('data' in payload)) return;
                const data = payload.data;
                if (!data || typeof data !== 'object' || !('taskId' in data) || typeof data.taskId !== 'string') return;
                const outcome = { taskId: data.taskId, status, data: data as Record<string, unknown> };
                if (taskId === undefined) early.set(outcome.taskId, outcome);
                else if (outcome.taskId === taskId) finish(outcome);
            };
            agent.on(event, handler);
            removeListeners.push(() => { agent.off(event, handler); });
        }
        signal.addEventListener('abort', abort, { once: true });
        // A rejected creation also disposes listeners. The application cancellation
        // releases this wait; it does not claim to reverse work already on the server.
        void Promise.resolve().then(() => settled ? undefined : createTask()).then(id => {
            if (settled) return;
            if (typeof id !== 'string' || !id.trim()) throw new Error('Task creation returned an empty task ID');
            taskId = id;
            const outcome = early.get(id);
            early.clear();
            if (outcome) finish(outcome);
        }).catch((error: unknown) => finish(undefined,
            error instanceof Error ? error : new Error(String(error))));
    });
}
