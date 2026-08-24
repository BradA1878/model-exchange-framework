/**
 * `task_complete` writes its payload into `ChannelTask.result.output` as
 * `TaskCompletionOutput`. Before commit aebedb96 (2026-08-18) the summary lived
 * at `result.summary`; several readers still read that field, which is now
 * always undefined, and silently fall back to an empty string. These tests
 * cover the guard and lookup helper that let readers get the summary back out
 * of `result.output` without assuming its shape.
 *
 * `result.output` is not always a `TaskCompletionOutput` — a caller can also
 * set it directly via `completeTask()` or the REST route — so the guard must
 * reject anything that does not match the envelope, not just narrow `any`.
 */

import {
    isTaskCompletionOutput,
    getTaskCompletionOutput,
    type TaskCompletionOutput
} from '@mxf-dev/core/types/TaskTypes';
import type { ChannelTask } from '@mxf-dev/core/types/TaskTypes';

const fullEnvelope: TaskCompletionOutput = {
    agentId: 'worker-1',
    summary: 'Completed the report',
    details: { filesChanged: 3 },
    nextSteps: 'Await review',
    reportedSuccess: true,
    requestId: 'req-1'
};

const minimalEnvelope: TaskCompletionOutput = {
    agentId: 'worker-1',
    summary: 'Completed the report',
    reportedSuccess: true,
    requestId: 'req-1'
};

describe('isTaskCompletionOutput', () => {
    it('accepts a full envelope with details and nextSteps', () => {
        expect(isTaskCompletionOutput(fullEnvelope)).toBe(true);
    });

    it('accepts an envelope without the optional details/nextSteps fields', () => {
        expect(isTaskCompletionOutput(minimalEnvelope)).toBe(true);
    });

    it('rejects an unrelated object shape (e.g. a challenge verdict)', () => {
        expect(isTaskCompletionOutput({ verdict: 'passed' })).toBe(false);
    });

    it('rejects null', () => {
        expect(isTaskCompletionOutput(null)).toBe(false);
    });

    it('rejects a string', () => {
        expect(isTaskCompletionOutput('done')).toBe(false);
    });

    it('rejects an envelope whose summary is not a string', () => {
        expect(isTaskCompletionOutput({ ...minimalEnvelope, summary: 42 })).toBe(false);
    });
});

describe('getTaskCompletionOutput', () => {
    it('returns the envelope when result.output matches TaskCompletionOutput', () => {
        const task: Pick<ChannelTask, 'result'> = {
            result: { success: true, output: fullEnvelope }
        };
        expect(getTaskCompletionOutput(task)).toEqual(fullEnvelope);
    });

    it('returns undefined when result.output is some other shape', () => {
        const task: Pick<ChannelTask, 'result'> = {
            result: { success: true, output: { verdict: 'passed' } }
        };
        expect(getTaskCompletionOutput(task)).toBeUndefined();
    });

    it('returns undefined when result is undefined', () => {
        const task: Pick<ChannelTask, 'result'> = { result: undefined };
        expect(getTaskCompletionOutput(task)).toBeUndefined();
    });

    it('returns undefined when the task itself is null', () => {
        expect(getTaskCompletionOutput(null)).toBeUndefined();
    });
});
