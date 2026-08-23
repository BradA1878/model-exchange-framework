/**
 * SystemLLM stance prompts.
 *
 * Every function under test is pure, so these are plain input/output checks
 * with no mocks: build a prompt or parse a response, and check the exact
 * text a stance depends on.
 */

import {
    buildChallengePrompt,
    buildCompletionJudgePrompt,
    buildCoordinationHintPrompt,
    CHALLENGE_MAX_POINTS,
    COORDINATION_HINT_NONE,
    formatChallengeForAgent,
    HOSTILE_BOUNDS,
    parseChallengeResponse,
    type ChallengeEvidence,
    type CoordinationHintInput,
    type JudgeEvidence
} from '../../../src/server/socket/services/SystemLlmStancePrompts';

const baseHintInput: CoordinationHintInput = {
    triggerType: 'message_volume',
    channelId: 'channel-1',
    activeAgents: ['agent-a', 'agent-b'],
    messageCount: 12,
    recentContext: '[agent-a] did X\n[agent-b] did Y',
    opportunities: [{ description: 'agents could share results', confidence: 0.8 }]
};

const baseEvidence: ChallengeEvidence = {
    task: {
        id: 'task-1',
        title: 'Ship the widget',
        description: 'Build and ship the new widget',
        objectives: ['Widget builds', 'Widget ships to prod']
    },
    agentId: 'agent-a',
    claim: 'I finished the widget and shipped it.',
    orparHistory: [{ phase: 'Act', content: 'ran build' }],
    messages: [{ agentId: 'agent-a', content: 'build complete' }],
    toolCalls: [{ agentId: 'agent-a', toolName: 'shell_execute', result: 'build ok' }]
};

describe('buildCoordinationHintPrompt', () => {
    it('supportive prompt starts with the helpful-suggestion instruction and asks for the emoji lead-in', () => {
        const prompt = buildCoordinationHintPrompt('supportive', baseHintInput);
        expect(prompt.startsWith('Generate a brief, helpful coordination suggestion')).toBe(true);
        expect(prompt).toContain('Start with "💡 System coordination insight:"');
    });

    it('supportive prompt is the pre-stance template byte for byte', () => {
        // This is the template SystemLlmService carried inline before the stance
        // existed, with the same values substituted — trailing spaces included.
        const activeAgents = new Set(baseHintInput.activeAgents);
        const expected = `Generate a brief, helpful coordination suggestion for the following situation:

TRIGGER: ${baseHintInput.triggerType}
CHANNEL: ${baseHintInput.channelId || 'unknown'}
ACTIVE AGENTS: ${Array.from(activeAgents).join(', ')} (${activeAgents.size} agents)
RECENT ACTIVITY: ${baseHintInput.messageCount} messages

RECENT CONVERSATION CONTEXT:
${baseHintInput.recentContext}

COORDINATION OPPORTUNITIES:
${baseHintInput.opportunities.map(op => `- ${op.description} (confidence: ${op.confidence})`).join('\n')}

Generate a concise, actionable coordination suggestion (max 80 words) that:
1. Addresses the specific trigger (${baseHintInput.triggerType})
2. Provides value without being intrusive  
3. Suggests specific actions agents can take
4. Uses a helpful, system-intelligence tone

Start with "💡 System coordination insight:" followed by your suggestion.`;

        expect(buildCoordinationHintPrompt('supportive', baseHintInput)).toBe(expected);
    });

    it('critical prompt allows silence via COORDINATION_HINT_NONE and skips the emoji instruction', () => {
        const prompt = buildCoordinationHintPrompt('critical', baseHintInput);
        expect(prompt).toContain(COORDINATION_HINT_NONE);
        expect(prompt).not.toContain('💡');
    });

    it('hostile prompt includes the hostile bounds verbatim', () => {
        const prompt = buildCoordinationHintPrompt('hostile', baseHintInput);
        expect(prompt).toContain(HOSTILE_BOUNDS);
    });
});

describe('buildChallengePrompt', () => {
    it('critical completion-claim prompt contains the task, claim, and evidence lines', () => {
        const prompt = buildChallengePrompt('critical', 'completion_claim', baseEvidence);
        expect(prompt).toContain('Ship the widget');
        expect(prompt).toContain('Widget builds');
        expect(prompt).toContain('Widget ships to prod');
        expect(prompt).toContain('I finished the widget and shipped it.');
        expect(prompt).toContain('[agent-a] shell_execute -> build ok');
        expect(prompt).toContain('[agent-a] build complete');
        expect(prompt).toContain('set "challenge" to false');
    });

    it('hostile prompt includes the hostile bounds and forces challenge to true', () => {
        const prompt = buildChallengePrompt('hostile', 'completion_claim', baseEvidence);
        expect(prompt).toContain(HOSTILE_BOUNDS);
        expect(prompt).toContain('Set "challenge" to true');
    });
});

describe('parseChallengeResponse', () => {
    it('parses a valid challenge response', () => {
        const json = JSON.stringify({
            challenge: true,
            summary: 'Found a gap',
            points: [{ claim: 'done', problem: 'no evidence', evidenceNeeded: 'a tool result' }]
        });

        expect(parseChallengeResponse(json)).toEqual({
            challenge: true,
            summary: 'Found a gap',
            points: [{ claim: 'done', problem: 'no evidence', evidenceNeeded: 'a tool result' }]
        });
    });

    it('rejects challenge:true with no points', () => {
        const json = JSON.stringify({ challenge: true, summary: 'oops', points: [] });
        expect(() => parseChallengeResponse(json)).toThrow('challenge=true with no points');
    });

    it('rejects a degraded fallback response', () => {
        const json = JSON.stringify({ fallback: true });
        expect(() => parseChallengeResponse(json)).toThrow('degraded fallback');
    });

    it('rejects a non-JSON response', () => {
        expect(() => parseChallengeResponse('not json')).toThrow('not JSON');
    });

    it('trims points beyond CHALLENGE_MAX_POINTS', () => {
        const points = Array.from({ length: CHALLENGE_MAX_POINTS + 3 }, (_unused, index) => ({
            claim: `claim-${index}`,
            problem: `problem-${index}`,
            evidenceNeeded: `evidence-${index}`
        }));
        const json = JSON.stringify({ challenge: true, summary: 'many points', points });

        const parsed = parseChallengeResponse(json);
        expect(parsed.points).toHaveLength(CHALLENGE_MAX_POINTS);
        expect(parsed.points[0].claim).toBe('claim-0');
    });
});

describe('formatChallengeForAgent', () => {
    it('starts with the tagged header and asks for task_complete again on a completion claim', () => {
        const formatted = formatChallengeForAgent({
            stance: 'critical',
            trigger: 'completion_claim',
            taskId: 'task-42',
            summary: 'Found a gap',
            points: [{ claim: 'done', problem: 'no evidence', evidenceNeeded: 'a tool result' }]
        });

        expect(formatted.startsWith(
            'SYSTEM CHALLENGE (stance: critical, trigger: completion claim, task: task-42)'
        )).toBe(true);
        expect(formatted).toContain('call task_complete again');
        expect(formatted).toContain('completion_challenged');
    });

    it('tells the agent to continue its task for a plan_posted trigger', () => {
        const formatted = formatChallengeForAgent({
            stance: 'critical',
            trigger: 'plan_posted',
            taskId: 'task-42',
            summary: 'Found a gap',
            points: [{ claim: 'done', problem: 'no evidence', evidenceNeeded: 'a tool result' }]
        });

        expect(formatted).toContain('continue your task');
    });
});

describe('buildCompletionJudgePrompt', () => {
    const judgeTask = { title: 'Ship the widget', description: 'Build and ship the new widget' };
    const objectives = ['Widget builds', 'Widget ships to prod'];
    const judgeEvidence: JudgeEvidence = {
        messages: [{ agentId: 'agent-a', content: 'build complete' }],
        toolCalls: [{ agentId: 'agent-a', toolName: 'shell_execute', result: 'build ok' }]
    };

    it('critical prompt demands evidence and asks to answer NO on gaps', () => {
        const prompt = buildCompletionJudgePrompt('critical', judgeTask, objectives, judgeEvidence);
        expect(prompt).toContain('demand evidence');
        expect(prompt).toContain('answer NO');
    });

    it('supportive and hostile prompts are identical and match the original text', () => {
        const supportivePrompt = buildCompletionJudgePrompt('supportive', judgeTask, objectives, judgeEvidence);
        const hostilePrompt = buildCompletionJudgePrompt('hostile', judgeTask, objectives, judgeEvidence);

        expect(supportivePrompt).toBe(hostilePrompt);
        expect(supportivePrompt.startsWith('Evaluate whether every objective for this task is complete.')).toBe(true);
        expect(supportivePrompt).toContain('[agent-a] shell_execute -> build ok');
        expect(supportivePrompt).toContain('[agent-a] build complete');
    });
});
