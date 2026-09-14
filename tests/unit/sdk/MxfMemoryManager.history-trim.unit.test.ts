import { EventBus } from '@mxf-dev/core/events/EventBus';
import { Events } from '@mxf-dev/core/events/EventNames';
import type { ConversationMessage } from '@mxf-dev/core/interfaces/ConversationMessage';
import type { AgentHistoryTrimmedEventData } from '@mxf-dev/core/schemas/EventPayloadSchema';
import { MxfMemoryManager } from '@mxf-dev/sdk/managers/MxfMemoryManager';

const message = (id: string, role: ConversationMessage['role'], timestamp: number): ConversationMessage => ({
    id, role, timestamp, content: id
});
const manager = (maxHistory: number): MxfMemoryManager => new MxfMemoryManager({
    agentId: 'trim-agent', channelId: 'trim-channel', maxHistory,
    maxObservations: 5, enablePersistence: false, memoryMode: 'session'
});

describe('observable automatic history trimming', () => {
    let trims: AgentHistoryTrimmedEventData[];
    beforeEach(() => {
        EventBus.reset();
        trims = [];
        EventBus.client.on(Events.Agent.HISTORY_TRIMMED, payload => {
            expect(payload.agentId).toBe('trim-agent');
            expect(payload.channelId).toBe('trim-channel');
            trims.push(payload.data);
        });
    });
    afterEach(() => { EventBus.reset(); });

    it('reports the actual dropped message when an append crosses the limit', async () => {
        const memory = manager(3);
        await memory.addConversationMessage({ role: 'system', content: 'operator' });
        await memory.addConversationMessage({ role: 'user', content: 'old' });
        await memory.addConversationMessage({ role: 'assistant', content: 'answer' });
        const before = memory.getConversationHistory();
        expect(trims).toEqual([]);
        await memory.addConversationMessage({ role: 'user', content: 'new' });
        const after = memory.getConversationHistory();
        expect(trims).toEqual([{ maxHistory: 3, droppedCount: 1, droppedMessageIds: [before[1].id], keptCount: 3 }]);
        expect(after.map(item => item.content)).toEqual(['operator', 'answer', 'new']);
    });

    it('reports the entire removed tool block without mutating the imported messages', async () => {
        const memory = manager(3);
        const history: ConversationMessage[] = [
            message('system', 'system', 1),
            { ...message('call', 'assistant', 2), tool_calls: [{ id: 'tool-1', type: 'function', function: { name: 'read', arguments: '{}' } }] },
            { ...message('result', 'tool', 3), metadata: { tool_call_id: 'tool-1' } },
            message('answer', 'assistant', 4),
            message('new', 'user', 5)
        ];
        await memory.importMemory({ conversationHistory: history });
        expect(memory.getConversationHistory().map(item => item.id)).toEqual(['system', 'new']);
        expect(trims).toEqual([{ maxHistory: 3, droppedCount: 3, droppedMessageIds: ['call', 'result', 'answer'], keptCount: 2 }]);
        expect(history.map(item => item.id)).toEqual(['system', 'call', 'result', 'answer', 'new']);
    });

    it('reports a removed occurrence even if a retained imported message has the same ID', async () => {
        const memory = manager(1);
        await memory.importMemory({ conversationHistory: [message('duplicate', 'user', 1), message('duplicate', 'user', 2)] });
        expect(memory.getConversationHistory()[0].timestamp).toBe(2);
        expect(trims).toEqual([{ maxHistory: 1, droppedCount: 1, droppedMessageIds: ['duplicate'], keptCount: 1 }]);
    });

    it('leaves explicit compaction on its existing separate event contract', async () => {
        const memory = manager(10);
        await memory.importMemory({ conversationHistory: [message('old', 'user', 1), message('new', 'user', 2)] });
        const compacted: unknown[] = [];
        EventBus.client.on(Events.Agent.CONTEXT_COMPACTED, payload => { compacted.push(payload.data); });
        await memory.compactConversation(1);
        expect(trims).toEqual([]);
        expect(compacted).toHaveLength(1);
    });
});
