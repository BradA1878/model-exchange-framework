/**
 * Test-environment containment for external LLM calls.
 *
 * Unit and integration test processes must not spend money merely because a
 * real API key is present in the developer's environment. Tests that
 * intentionally exercise a live provider have to opt in explicitly.
 */

export const EXTERNAL_LLM_TEST_OPT_IN_ENV = 'MXF_TEST_ALLOW_EXTERNAL_LLM_CALLS';

/**
 * Fail before an external provider request can leave a test process.
 *
 * Only the exact value `true` enables live calls. This keeps misspellings and
 * inherited non-empty values from weakening the safety boundary.
 */
export function assertExternalLlmCallAllowed(providerName: string): void {
    if (process.env.NODE_ENV !== 'test') {
        return;
    }

    if (process.env[EXTERNAL_LLM_TEST_OPT_IN_ENV] === 'true') {
        return;
    }

    throw new Error(
        `External LLM call blocked for ${providerName} because NODE_ENV=test. ` +
        `Set ${EXTERNAL_LLM_TEST_OPT_IN_ENV}=true only for an explicitly authorized live-provider test.`
    );
}
