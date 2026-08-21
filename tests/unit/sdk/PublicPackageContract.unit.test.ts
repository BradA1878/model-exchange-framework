import {
    CORE_MXF_TOOLS,
    ContentFormat,
    MemoryPersistenceLevel,
    MemoryScope,
    isCoreToolName,
} from '@mxf-dev/sdk';
import type {
    ChannelMemory,
    ChannelMemoryUpdate,
    CoreMxfTool,
    IAgentMemory,
    McpServerRegistrationResult,
    MxfMessageOptions,
    TaskConfig,
} from '@mxf-dev/sdk';
import {
    CORE_MXF_TOOLS as CORE_TOOLS_FROM_CORE,
    MemoryScope as CoreMemoryScope,
} from '@mxf-dev/core';
import { MemoryPersistenceLevel as CoreMemoryPersistenceLevel } from '@mxf-dev/core';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const taskConfig: TaskConfig = {
    title: 'Compile the public task contract',
    description: 'Keep the SDK root declaration usable by package consumers',
    assignedAgentIds: ['contract-agent'],
};

const registrationResult: McpServerRegistrationResult = {
    toolsDiscovered: ['contract_tool'],
};

const channelMemoryUpdate: ChannelMemoryUpdate = {
    sharedState: { phase: 'verified' },
};

const messageOptions: MxfMessageOptions = {
    receiverId: 'recipient-agent',
    format: ContentFormat.JSON,
};

const consumePublicMemoryTypes = (
    agentMemory: IAgentMemory,
    channelMemory: ChannelMemory
): string => `${agentMemory.agentId}:${channelMemory.channelId}`;

describe('published package root contract', () => {
    it('exports only the curated root and package metadata', () => {
        const manifest = JSON.parse(
            readFileSync(resolve(process.cwd(), 'packages/sdk/package.json'), 'utf8')
        ) as { exports: Record<string, unknown> };

        expect(Object.keys(manifest.exports)).toEqual(['.', './package.json']);
        expect(manifest.exports).not.toHaveProperty('./*');
    });

    it('exports the canonical restrictive tool policy without duplicating it', () => {
        const coreTool: CoreMxfTool = 'task_complete';

        expect(CORE_MXF_TOOLS).toBe(CORE_TOOLS_FROM_CORE);
        expect(isCoreToolName(coreTool)).toBe(true);
        expect(isCoreToolName('shell_execute')).toBe(false);
    });

    it('exports the canonical memory enums and public DTO types', () => {
        expect(MemoryScope).toBe(CoreMemoryScope);
        expect(MemoryPersistenceLevel).toBe(CoreMemoryPersistenceLevel);
        expect(MemoryScope.RELATIONSHIP).toBe('relationship');
        expect(channelMemoryUpdate).toEqual({ sharedState: { phase: 'verified' } });
        expect(messageOptions.format).toBe(ContentFormat.JSON);
        expect(consumePublicMemoryTypes).toEqual(expect.any(Function));
    });

    it('keeps task and MCP registration result contracts available at the SDK root', () => {
        expect(taskConfig.assignedAgentIds).toEqual(['contract-agent']);
        expect(registrationResult).toEqual({ toolsDiscovered: ['contract_tool'] });
        expect('success' in registrationResult).toBe(false);
    });
});
