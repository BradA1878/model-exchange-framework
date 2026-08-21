import {
    isPrivilegedHostToolEnabled,
    isPrivilegedNetworkToolEnabled,
    resolveCredentialBoundAgentPolicy,
    ToolAuthorizationError,
    UNSAFE_HOST_TOOLS_ENV,
    UNSAFE_NETWORK_TOOLS_ENV
} from '../../../src/server/socket/services/ToolAuthorizationPolicy';

describe('credential-bound and host tool policy', () => {
    const previous = process.env[UNSAFE_HOST_TOOLS_ENV];
    const previousNetwork = process.env[UNSAFE_NETWORK_TOOLS_ENV];

    afterEach(() => {
        if (previous === undefined) {
            delete process.env[UNSAFE_HOST_TOOLS_ENV];
        } else {
            process.env[UNSAFE_HOST_TOOLS_ENV] = previous;
        }
        if (previousNetwork === undefined) {
            delete process.env[UNSAFE_NETWORK_TOOLS_ENV];
        } else {
            process.env[UNSAFE_NETWORK_TOOLS_ENV] = previousNetwork;
        }
    });

    it('uses a credential maximum and permits only requested subsets', () => {
        expect(resolveCredentialBoundAgentPolicy(
            ['task_complete', 'messaging_send'],
            ['messaging_send']
        )).toEqual(['messaging_send']);
        expect(resolveCredentialBoundAgentPolicy(
            ['task_complete'],
            []
        )).toEqual([]);
        expect(() => resolveCredentialBoundAgentPolicy(
            ['task_complete'],
            ['shell_execute']
        )).toThrow(ToolAuthorizationError);
    });

    it('caps legacy omitted grants at curated core tools', () => {
        expect(resolveCredentialBoundAgentPolicy(undefined, undefined)).toBeUndefined();
        expect(() => resolveCredentialBoundAgentPolicy(
            undefined,
            ['shell_execute']
        )).toThrow('outside the authenticated credential grant');
    });

    it('default-disables representative host read, mutation, network, and compiler tools', () => {
        delete process.env[UNSAFE_HOST_TOOLS_ENV];
        for (const toolName of [
            'search_project',
            'json_append',
            'git_push',
            'typescript_build',
            'shell_execute'
        ]) {
            expect(isPrivilegedHostToolEnabled(new Set([toolName]))).toBe(false);
        }
        expect(isPrivilegedHostToolEnabled(new Set(['task_complete']))).toBe(true);

        process.env[UNSAFE_HOST_TOOLS_ENV] = 'true';
        expect(isPrivilegedHostToolEnabled(new Set(['git_push']))).toBe(true);
    });

    it('rejects ambiguous boolean configuration', () => {
        process.env[UNSAFE_HOST_TOOLS_ENV] = 'yes';
        expect(() => isPrivilegedHostToolEnabled(new Set(['shell_execute'])))
            .toThrow(`must be exactly 'true' or 'false'`);
    });

    it('default-disables server-originated browser and HTTP tools', () => {
        delete process.env[UNSAFE_NETWORK_TOOLS_ENV];
        for (const toolName of [
            'web_search',
            'web_navigate',
            'web_bulk_extract',
            'web_screenshot',
            'api_fetch'
        ]) {
            expect(isPrivilegedNetworkToolEnabled(new Set([toolName]))).toBe(false);
        }
        expect(isPrivilegedNetworkToolEnabled(new Set(['task_complete']))).toBe(true);

        process.env[UNSAFE_NETWORK_TOOLS_ENV] = 'true';
        expect(isPrivilegedNetworkToolEnabled(new Set(['web_navigate']))).toBe(true);
    });

    it('rejects ambiguous outbound-network configuration', () => {
        process.env[UNSAFE_NETWORK_TOOLS_ENV] = '1';
        expect(() => isPrivilegedNetworkToolEnabled(new Set(['api_fetch'])))
            .toThrow(`must be exactly 'true' or 'false'`);
    });
});
