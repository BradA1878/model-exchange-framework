import { observeMcpRequest } from '@mxf-dev/core/protocols/mcp/RequestObservation';
import type { McpRequestObservation } from '@mxf-dev/core/protocols/mcp/IMcpClient';

describe('provider transport observation', () => {
    it('captures the serialized body without giving observers the sent object', () => {
        const body = JSON.stringify({ model: 'test', messages: [{ role: 'system', content: 'literal {{prompt}}\n' }] });
        const seen: McpRequestObservation[] = [];
        const attempt = observeMcpRequest('openrouter', 'test', body, {
            activationId: 'activation', captureBody: true,
            onRequest: request => { seen.push(request); request.body!.messages = []; }
        });
        expect(JSON.parse(body).messages).toHaveLength(1);
        const facts = attempt.complete({ costUsd: 0, providerRoute: 'route', finishReason: 'stop' });
        expect(facts.requestId).toBe(seen[0].requestId);
        expect(facts.activationId).toBe('activation');
        expect(facts.latencyMs).toBeGreaterThanOrEqual(0);
        expect(facts.costUsd).toBe(0);
        expect(facts).not.toHaveProperty('nativeFinishReason');
    });

    it('identifies each attempt without capturing bodies or inventing provider facts', () => {
        const seen: McpRequestObservation[] = [];
        const trace = { onRequest: (request: McpRequestObservation): void => { seen.push(request); } };
        const first = observeMcpRequest('test', 'model', '{}', trace).complete();
        const second = observeMcpRequest('test', 'model', '{}', trace).complete();
        expect(first.requestId).not.toBe(second.requestId);
        expect(seen[0]).not.toHaveProperty('body');
        expect(first).not.toHaveProperty('costUsd');
        expect(first).not.toHaveProperty('providerRoute');
        expect(first).not.toHaveProperty('activationId');
    });
});
