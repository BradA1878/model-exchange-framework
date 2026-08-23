/**
 * What an agent is told about the channel's SystemLLM stance: the guidance
 * text itself, its delivery through PromptTemplateReplacer, and its place in
 * the agent system prompt.
 */

import {
    SYSTEMLLM_STANCES,
    TASK_COMPLETION_CHALLENGED_STATUS
} from '@mxf-dev/core/types/SystemLlmStanceTypes';
import {
    buildSystemLlmStanceGuidance,
    SYSTEM_CHALLENGE_PREFIX
} from '@mxf-dev/core/prompts/SystemLlmStanceGuidance';
import { PromptTemplateReplacer } from '@mxf-dev/core/utils/PromptTemplateReplacer';
import { MxfAgentSystemPrompt } from '@mxf-dev/core/prompts/MxfAgentSystemPrompt';
import type { AgentConfig } from '@mxf-dev/core/interfaces/AgentInterfaces';

describe('buildSystemLlmStanceGuidance', () => {
    for (const stance of SYSTEMLLM_STANCES) {
        it(`returns non-empty text starting with the stance header for ${stance}`, () => {
            const text = buildSystemLlmStanceGuidance(stance);
            expect(text.length).toBeGreaterThan(0);
            expect(text.startsWith(`**SystemLLM stance: ${stance}`)).toBe(true);
        });
    }

    it('supportive guidance is a single line', () => {
        const text = buildSystemLlmStanceGuidance('supportive');
        expect(text.split('\n')).toHaveLength(1);
    });

    it('critical guidance mentions the challenge prefix and the challenged status', () => {
        const text = buildSystemLlmStanceGuidance('critical');
        expect(text).toContain(SYSTEM_CHALLENGE_PREFIX);
        expect(text).toContain(TASK_COMPLETION_CHALLENGED_STATUS);
    });

    it('hostile guidance warns challenges may be wrong on purpose and forbids destructive action', () => {
        const text = buildSystemLlmStanceGuidance('hostile');
        expect(text).toContain('wrong on purpose');
        expect(text).toContain('Never take a destructive action');
    });
});

describe('PromptTemplateReplacer SystemLLM stance templates', () => {
    const template = '{{SYSTEM_LLM_STANCE}}|{{SYSTEM_LLM_STANCE_GUIDANCE}}';

    it('renders the stance and its guidance from context', () => {
        const result = PromptTemplateReplacer.replaceTemplates(template, { systemLlmStance: 'hostile' });
        const [stancePart, guidancePart] = result.split('|');
        expect(stancePart).toBe('hostile');
        expect(guidancePart).toBe(buildSystemLlmStanceGuidance('hostile'));
    });

    it('defaults to supportive when the context omits systemLlmStance', () => {
        const result = PromptTemplateReplacer.replaceTemplates(template, {});
        const [stancePart, guidancePart] = result.split('|');
        expect(stancePart).toBe('supportive');
        expect(guidancePart).toBe(buildSystemLlmStanceGuidance('supportive'));
    });

    it('renders the guidance text unmangled, so $-style regex replacement patterns in it are inert', () => {
        // The replacement is a function returning the guidance string, not a
        // string passed straight to .replace() — a raw string replacement
        // would let $&, $1, $$, etc. inside the guidance text corrupt the
        // output. Exact equality against the direct function call proves the
        // full, untouched text made it through for the longest guidance
        // (critical), which carries the most punctuation.
        const result = PromptTemplateReplacer.replaceTemplates(
            '{{SYSTEM_LLM_STANCE_GUIDANCE}}',
            { systemLlmStance: 'critical' }
        );
        expect(result).toBe(buildSystemLlmStanceGuidance('critical'));
    });
});

describe('MxfAgentSystemPrompt SystemLLM stance placeholders', () => {
    const minimalAgentConfig: AgentConfig = {
        agentId: 'agent-1',
        channelId: 'channel-1',
        name: 'Test Agent',
        host: 'localhost',
        port: 3001,
        secure: false,
        keyId: 'key-1',
        secretKey: 'secret',
        apiUrl: 'http://localhost:3001',
        apiKey: 'api-key',
        agentConfigPrompt: 'You are a test agent.'
    };

    it('buildFrameworkSystemPrompt includes a Stance section with the guidance placeholder and mentions SYSTEM CHALLENGE', async () => {
        const prompt = await MxfAgentSystemPrompt.buildFrameworkSystemPrompt(minimalAgentConfig);

        expect(prompt).toContain('### Stance');
        const stanceIndex = prompt.indexOf('### Stance');
        const placeholderIndex = prompt.indexOf('{{SYSTEM_LLM_STANCE_GUIDANCE}}', stanceIndex);
        expect(placeholderIndex).toBeGreaterThan(stanceIndex);
        expect(prompt).toContain('SYSTEM CHALLENGE');
    });

    it('buildAgentIdentityPrompt includes the SystemLLM Stance placeholder', () => {
        const identity = MxfAgentSystemPrompt.buildAgentIdentityPrompt(minimalAgentConfig);
        expect(identity).toContain('**SystemLLM Stance**: {{SYSTEM_LLM_STANCE}}');
    });
});
