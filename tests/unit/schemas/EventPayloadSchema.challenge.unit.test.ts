/**
 * Unit tests for createSystemLlmChallengeIssuedEventPayload.
 */

import { createSystemLlmChallengeIssuedEventPayload } from '@mxf-dev/core/schemas/EventPayloadSchema';
import { SystemEvents } from '@mxf-dev/core/events/event-definitions/SystemEvents';
import type { SystemLlmChallengeIssuedEventData } from '@mxf-dev/core/events/event-definitions/SystemEvents';

/**
 * A loosely-typed fixture shape. The real SystemLlmChallengeIssuedEventData
 * narrows `trigger` and `stance` to the values the framework accepts, which
 * is exactly what the runtime checks under test are guarding against callers
 * that bypass the type system (untyped JSON, `as any` at a call site, etc).
 * `asChallengeData` is the one deliberate, contained cast that lets these
 * tests build the invalid values the validator is supposed to catch.
 */
interface ChallengeDataFixture {
    challengeId: string;
    taskId: string;
    trigger: string;
    stance: string;
    delivery: string;
    summary: string;
    points: Array<{ claim: string; problem: string; evidenceNeeded: string }>;
}

const validData: ChallengeDataFixture = {
    challengeId: 'challenge-1',
    taskId: 'task-1',
    trigger: 'completion_claim',
    stance: 'critical',
    delivery: 'channel_message',
    summary: 'The claim is not supported by evidence.',
    points: [
        { claim: 'Report written', problem: 'No tool call wrote report.md', evidenceNeeded: 'A file_write tool result for report.md' }
    ]
};

const asChallengeData = (data: ChallengeDataFixture): SystemLlmChallengeIssuedEventData =>
    data as unknown as SystemLlmChallengeIssuedEventData;

describe('createSystemLlmChallengeIssuedEventPayload', () => {
    it('builds a challenge-issued payload with the data passed through', () => {
        const data = asChallengeData(validData);

        const payload = createSystemLlmChallengeIssuedEventPayload('worker-1', 'channel-1', data);

        expect(payload.eventType).toBe(SystemEvents.SYSTEMLLM_CHALLENGE_ISSUED);
        expect(payload.agentId).toBe('worker-1');
        expect(payload.channelId).toBe('channel-1');
        expect(payload.source).toBe('SystemLlmChallengeService');
        expect(payload.data).toBe(data);
    });

    it('refuses a challenge with no points', () => {
        expect(() => createSystemLlmChallengeIssuedEventPayload(
            'worker-1',
            'channel-1',
            asChallengeData({ ...validData, points: [] })
        )).toThrow(/at least one point/i);
    });

    it('refuses a supportive stance, which issues no challenges', () => {
        expect(() => createSystemLlmChallengeIssuedEventPayload(
            'worker-1',
            'channel-1',
            asChallengeData({ ...validData, stance: 'supportive' })
        )).toThrow(/issues no challenges/i);
    });

    it('refuses an unknown trigger', () => {
        expect(() => createSystemLlmChallengeIssuedEventPayload(
            'worker-1',
            'channel-1',
            asChallengeData({ ...validData, trigger: 'made_up' })
        )).toThrow(/unknown trigger/i);
    });

    it('refuses an empty summary', () => {
        expect(() => createSystemLlmChallengeIssuedEventPayload(
            'worker-1',
            'channel-1',
            asChallengeData({ ...validData, summary: '' })
        )).toThrow();
    });
});
