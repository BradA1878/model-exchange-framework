import { codeAnalysisTools } from '@mxf-dev/core/protocols/mcp/tools/CodeAnalysisTools';
import { gitTools } from '@mxf-dev/core/protocols/mcp/tools/GitTools';
import {
    codeExecuteTool,
    shellExecTool,
    shellTaskStatusTool
} from '@mxf-dev/core/protocols/mcp/tools/InfrastructureTools';
import { JsonTools } from '@mxf-dev/core/protocols/mcp/tools/JsonTools';
import { projectContextTools } from '@mxf-dev/core/protocols/mcp/tools/ProjectContextTools';
import { safetyTools } from '@mxf-dev/core/protocols/mcp/tools/SafetyTools';
import { searchProjectTools } from '@mxf-dev/core/protocols/mcp/tools/SearchProjectTools';
import { testTools } from '@mxf-dev/core/protocols/mcp/tools/TestTools';
import { typescriptTools } from '@mxf-dev/core/protocols/mcp/tools/TypeScriptTools';
import {
    getToolAuthorizationNames,
    isPrivilegedHostToolEnabled,
    UNSAFE_HOST_TOOLS_ENV
} from '../../../src/server/socket/services/ToolAuthorizationPolicy';

describe('privileged host tool classification', () => {
    let originalValue: string | undefined;

    beforeEach(() => {
        originalValue = process.env[UNSAFE_HOST_TOOLS_ENV];
        delete process.env[UNSAFE_HOST_TOOLS_ENV];
    });

    afterEach(() => {
        if (originalValue === undefined) {
            delete process.env[UNSAFE_HOST_TOOLS_ENV];
        } else {
            process.env[UNSAFE_HOST_TOOLS_ENV] = originalValue;
        }
    });

    it('fails closed for every exported tool in each host-capability family', () => {
        const exportedHostTools = [
            ...codeAnalysisTools,
            ...gitTools,
            ...Object.values(JsonTools),
            ...projectContextTools,
            ...safetyTools,
            ...searchProjectTools,
            ...testTools,
            ...typescriptTools,
            shellExecTool,
            shellTaskStatusTool,
            codeExecuteTool
        ];

        const unexpectedlyEnabled = exportedHostTools
            .map(tool => tool.name)
            .filter(name => isPrivilegedHostToolEnabled(new Set([name])));

        expect(unexpectedlyEnabled).toEqual([]);
    });

    it('enables classified host tools only on the exact true value', () => {
        expect(isPrivilegedHostToolEnabled(new Set(['search_project']))).toBe(false);

        process.env[UNSAFE_HOST_TOOLS_ENV] = 'true';
        expect(isPrivilegedHostToolEnabled(new Set(['search_project']))).toBe(true);

        process.env[UNSAFE_HOST_TOOLS_ENV] = 'TRUE';
        expect(() => isPrivilegedHostToolEnabled(new Set(['search_project']))).toThrow(/exactly/);
    });

    it('fails closed for current filesystem MCP raw and namespaced tool names', () => {
        const filesystemTools = [
            'read_text_file',
            'read_media_file',
            'read_multiple_files',
            'write_file',
            'edit_file',
            'create_directory',
            'list_directory',
            'list_directory_with_sizes',
            'directory_tree',
            'move_file',
            'search_files',
            'get_file_info',
            'list_allowed_directories'
        ];

        for (const toolName of filesystemTools) {
            expect(isPrivilegedHostToolEnabled(new Set([toolName]))).toBe(false);
            expect(isPrivilegedHostToolEnabled(new Set([`filesystem__${toolName}`]))).toBe(false);
        }

        expect(getToolAuthorizationNames({
            name: 'read_text_file',
            canonicalName: 'filesystem__read_text_file',
            externalToolName: 'read_text_file'
        })).toEqual(new Set(['filesystem__read_text_file', 'read_text_file']));
    });

    it('rejects a caller-supplied agentId on background task queries', async () => {
        await expect(shellTaskStatusTool.handler(
            { action: 'list', agentId: 'spoofed-agent' } as never,
            { agentId: 'real-agent', channelId: 'channel', requestId: 'request' }
        )).rejects.toThrow(/derived from the authenticated tool context/);
    });
});
