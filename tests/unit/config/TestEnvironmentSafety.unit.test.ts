import { EXTERNAL_LLM_TEST_OPT_IN_ENV } from '@mxf-dev/core/protocols/mcp/LlmTestEnvironmentGuard';
import { configureTestEnvironment } from '../../setup/testEnvironment';

describe('test environment safety bootstrap', () => {
    it('forces ordinary test processes into paid-provider-safe mode', () => {
        const environment: NodeJS.ProcessEnv = {
            NODE_ENV: 'production',
            SYSTEMLLM_ENABLED: 'true',
            [EXTERNAL_LLM_TEST_OPT_IN_ENV]: 'TRUE'
        };

        configureTestEnvironment(environment);

        expect(environment).toEqual({
            NODE_ENV: 'test',
            SYSTEMLLM_ENABLED: 'false',
            [EXTERNAL_LLM_TEST_OPT_IN_ENV]: 'false'
        });
    });

    it('preserves only the exact explicit live-provider opt-in', () => {
        const environment: NodeJS.ProcessEnv = {
            SYSTEMLLM_ENABLED: 'true',
            [EXTERNAL_LLM_TEST_OPT_IN_ENV]: 'true'
        };

        configureTestEnvironment(environment);

        expect(environment.NODE_ENV).toBe('test');
        expect(environment.SYSTEMLLM_ENABLED).toBe('true');
        expect(environment[EXTERNAL_LLM_TEST_OPT_IN_ENV]).toBe('true');
    });

    it('has configured this Jest process before test modules execute', () => {
        expect(process.env.NODE_ENV).toBe('test');
        expect(process.env.SYSTEMLLM_ENABLED).toBe('false');
        expect(process.env[EXTERNAL_LLM_TEST_OPT_IN_ENV]).toBe('false');
    });
});
