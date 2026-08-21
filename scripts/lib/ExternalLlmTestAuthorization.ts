import { EXTERNAL_LLM_TEST_OPT_IN_ENV } from '../../packages/core/src/protocols/mcp/LlmTestEnvironmentGuard';

/** Require an exact caller-supplied authorization before a live-provider test loads `.env`. */
export const assertExternalLlmTestAuthorized = (
    environment: NodeJS.ProcessEnv,
    testName: string
): void => {
    if (environment[EXTERNAL_LLM_TEST_OPT_IN_ENV] === 'true') {
        return;
    }

    throw new Error(
        `${testName} makes live provider calls. Set ` +
        `${EXTERNAL_LLM_TEST_OPT_IN_ENV}=true explicitly when invoking it.`
    );
};
