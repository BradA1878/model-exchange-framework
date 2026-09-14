import { validateAgentExecutionConfig, type AgentExecutionConfig } from '@mxf-dev/core/config/AgentExecutionConfig';

describe('agent execution configuration validation', () => {
    it('accepts omitted controls without filling defaults or altering the caller', () => {
        const config = Object.freeze({});
        expect(() => validateAgentExecutionConfig(config)).not.toThrow();
        expect(config).toEqual({});
    });

    it('preserves every byte of a nonblank bare operator prompt', () => {
        const prompt = '\n  Observe.\r\nRespond when addressed.\n  ';
        const config = Object.freeze({
            promptMode: 'bare' as const, agentConfigPrompt: prompt,
            activation: 'message' as const, mxpEnabled: false, useMessageAggregate: false,
            circuitBreakerEnabled: false, captureLlmRequests: true, maxIterations: 1
        });
        validateAgentExecutionConfig(config);
        expect(config.agentConfigPrompt).toBe(prompt);
    });

    it.each([undefined, '', ' \t\r\n', null, 42])('rejects a missing or blank bare prompt: %p', prompt => {
        expect(() => validateAgentExecutionConfig({ promptMode: 'bare', agentConfigPrompt: prompt } as AgentExecutionConfig))
            .toThrow('Bare prompt mode requires a non-empty agentConfigPrompt');
    });

    it.each([
        [{ promptMode: 'bare', agentConfigPrompt: 'Observe', mxpEnabled: true }, 'Bare prompt mode cannot enable MXP'],
        [{ promptMode: 'bare', agentConfigPrompt: 'Observe', useMessageAggregate: true }, 'Bare prompt mode cannot enable message aggregation'],
        [{ activation: 'message', useMessageAggregate: true }, 'Message activation cannot enable message aggregation']
    ])('rejects incompatible controls %p', (config, error) => {
        expect(() => validateAgentExecutionConfig(config as AgentExecutionConfig)).toThrow(error as string);
    });

    it.each(['promptMode', 'activation'])('rejects an unknown %s', field => {
        expect(() => validateAgentExecutionConfig({ [field]: 'unknown' })).toThrow(field);
    });

    it.each(['circuitBreakerEnabled', 'captureLlmRequests', 'mxpEnabled', 'useMessageAggregate'])('does not coerce %s into a boolean', field => {
        for (const invalid of ['false', 0, null]) {
            expect(() => validateAgentExecutionConfig({ [field]: invalid })).toThrow(`${field} must be a boolean`);
        }
    });

    it.each([0, -1, 1.5, NaN, Infinity, '2'])('rejects an invalid message iteration bound: %p', maxIterations => {
        expect(() => validateAgentExecutionConfig({ activation: 'message', maxIterations } as AgentExecutionConfig))
            .toThrow('Message activation maxIterations must be a positive integer');
    });

    it('leaves task-mode iteration policy and framework prompt defaults unchanged', () => {
        expect(() => validateAgentExecutionConfig({ promptMode: 'framework', activation: 'task', maxIterations: 0 })).not.toThrow();
        expect(() => validateAgentExecutionConfig({ activation: 'message' })).not.toThrow();
    });
});
