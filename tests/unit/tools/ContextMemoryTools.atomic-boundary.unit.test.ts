import { firstValueFrom, of } from 'rxjs';

jest.mock('../../../src/server/services/ChannelContextService', () => ({
    ChannelContextService: {
        getInstance: jest.fn(),
        setClientContext: jest.fn()
    }
}));

import { EventBus } from '@mxf-dev/core/events/EventBus';
import type { McpToolHandlerContext } from '@mxf-dev/core/protocols/mcp/McpServerTypes';
import { MemoryService } from '@mxf-dev/core/services/MemoryService';
import { Logger } from '@mxf-dev/core/utils/Logger';
import {
    agentMemoryWriteTool,
    channelMemoryWriteTool
} from '../../../src/server/mcp/tools/ContextMemoryTools';

const CHANNEL_ID = 'tool-atomic-channel';
const context: McpToolHandlerContext = {
    requestId: 'tool-request',
    agentId: 'tool-agent',
    channelId: CHANNEL_ID
};

describe('ContextMemoryTools atomic field boundary', () => {
    beforeEach(() => {
        EventBus.reset();
        (MemoryService as unknown as { instance?: MemoryService }).instance = undefined;
        jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => {
        jest.restoreAllMocks();
        EventBus.reset();
        (MemoryService as unknown as { instance?: MemoryService }).instance = undefined;
    });

    it.each([
        { memorySection: 'sharedState' as const, key: 'context' },
        { memorySection: 'sharedState' as const, key: 'context.updatedAt' },
        { memorySection: 'customData' as const, key: 'contextHistory' },
        { memorySection: 'customData' as const, key: 'contextHistory.0' }
    ])('surfaces an honest error for reserved $memorySection.$key', async input => {
        await expect(channelMemoryWriteTool.handler(
            { ...input, value: { forbidden: true } },
            context
        )).rejects.toThrow(`Key '${input.key}' is reserved for atomic keyed-memory operations`);
    });

    it('writes only its own key so a concurrent write to another key survives', async () => {
        const memoryService = MemoryService.getInstance();
        const agentId = 'tool-agent';
        await firstValueFrom(memoryService.updateAgentMemory(agentId, {
            notes: { B: { value: 'old' } }
        }));
        const staleSnapshot = await firstValueFrom(memoryService.getAgentMemory(agentId));
        // A second writer lands B = 'new' after this tool call has already read
        // its snapshot but before its own update runs.
        await firstValueFrom(memoryService.updateAgentMemory(agentId, {
            notes: { B: { value: 'new' } }
        }));
        jest.spyOn(MemoryService.prototype, 'getAgentMemory')
            .mockImplementationOnce(() => of(staleSnapshot));

        await expect(agentMemoryWriteTool.handler(
            { key: 'A', value: 1, memorySection: 'notes' },
            { ...context, agentId }
        )).resolves.toEqual(expect.objectContaining({
            content: expect.objectContaining({
                data: expect.objectContaining({ stored: true, key: 'A' })
            })
        }));

        const memory = await firstValueFrom(memoryService.getAgentMemory(agentId));
        expect(memory.notes).toEqual({
            A: expect.objectContaining({ value: 1, createdBy: agentId }),
            B: { value: 'new' }
        });
    });

    it('writes an ordinary key without echoing reserved section state', async () => {
        await expect(channelMemoryWriteTool.handler(
            { key: 'theme', value: 'dark', memorySection: 'sharedState' },
            context
        )).resolves.toEqual(expect.objectContaining({
            content: expect.objectContaining({
                data: expect.objectContaining({ stored: true, key: 'theme' })
            })
        }));

        const memory = await firstValueFrom(
            MemoryService.getInstance().getChannelMemory(CHANNEL_ID)
        );
        expect(memory.sharedState).toEqual({ theme: 'dark' });
    });
});
