import { EXTERNAL_LLM_TEST_OPT_IN_ENV } from '@mxf-dev/core/protocols/mcp/LlmTestEnvironmentGuard';
import { assertExternalLlmTestAuthorized } from '../../../scripts/lib/ExternalLlmTestAuthorization';

describe('live-provider integration-test authorization', () => {
    it('accepts only the exact explicit opt-in', () => {
        expect(() => assertExternalLlmTestAuthorized({
            [EXTERNAL_LLM_TEST_OPT_IN_ENV]: 'true'
        }, 'Live integration test')).not.toThrow();

        for (const value of [undefined, '', 'TRUE', '1']) {
            expect(() => assertExternalLlmTestAuthorized({
                [EXTERNAL_LLM_TEST_OPT_IN_ENV]: value
            }, 'Live integration test')).toThrow(
                `${EXTERNAL_LLM_TEST_OPT_IN_ENV}=true explicitly`
            );
        }
    });
});
