import { EXTERNAL_LLM_TEST_OPT_IN_ENV } from '@mxf-dev/core/protocols/mcp/LlmTestEnvironmentGuard';

/**
 * Establish test-process safety before application modules or dotenv load.
 */
export const configureTestEnvironment = (environment: NodeJS.ProcessEnv): void => {
    const externalLlmOptIn = environment[EXTERNAL_LLM_TEST_OPT_IN_ENV] === 'true';

    environment.NODE_ENV = 'test';
    environment[EXTERNAL_LLM_TEST_OPT_IN_ENV] = externalLlmOptIn ? 'true' : 'false';
    if (!externalLlmOptIn) {
        environment.SYSTEMLLM_ENABLED = 'false';
    }
};

configureTestEnvironment(process.env);
