import type { AgentConfig } from '@mxf-dev/core/interfaces/AgentInterfaces';
import type { ConversationMessage } from '@mxf-dev/core/interfaces/ConversationMessage';
import { MxfAgentSystemPrompt } from '@mxf-dev/core/prompts/MxfAgentSystemPrompt';
import { PromptTemplateReplacer } from '@mxf-dev/core/utils/PromptTemplateReplacer';
import * as CompactionConfig from '@mxf-dev/core/config/PromptCompactionConfig';
import { MxfSystemPromptManager, type PromptManagerCallbacks } from '@mxf-dev/sdk/managers/MxfSystemPromptManager';
import { MxfContextBuilder } from '@mxf-dev/sdk/services/MxfContextBuilder';
import { ToolResultMicrocompactor } from '@mxf-dev/sdk/services/ToolResultMicrocompactor';
import { PostCompactionRestorer } from '@mxf-dev/sdk/services/PostCompactionRestorer';
import { SystemReminderService } from '@mxf-dev/sdk/services/SystemReminderService';

const EXACT_PROMPT = '\n  Observe {{agentId}} literally.\r\n\tKeep all whitespace.  ';
const config = (overrides: Partial<AgentConfig> = {}): AgentConfig => ({
    agentId: 'bare-agent', channelId: 'bare-channel', name: 'Bare Agent',
    host: 'localhost', port: 3001, secure: false,
    keyId: 'key', secretKey: 'secret', apiUrl: 'http://localhost:3001', apiKey: 'test',
    agentConfigPrompt: EXACT_PROMPT, promptMode: 'bare', ...overrides
});
const systemMessage = (): ConversationMessage => ({ id: 'system', role: 'system', content: 'old system text', timestamp: 1 });

describe('bare prompt manager boundaries', () => {
    afterEach(() => { jest.restoreAllMocks(); });

    it('preserves operator bytes across initial, complete, task and replacement prompt entry points', async () => {
        const history = [systemMessage()];
        const update = jest.fn(async (index: number, message: ConversationMessage): Promise<void> => { history[index] = message; });
        const getTools = jest.fn((): never => { throw new Error('framework tool text must not be read'); });
        const getChannelContext = jest.fn((): never => { throw new Error('channel text must not be read'); });
        const getMemoryEntries = jest.fn((): never => { throw new Error('memory text must not be read'); });
        const callbacks: PromptManagerCallbacks = {
            getConversationHistory: (): ConversationMessage[] => history,
            updateConversationMessage: update, getCachedTools: getTools, getChannelContext, getMemoryEntries
        };
        const framework = jest.spyOn(MxfAgentSystemPrompt, 'buildFrameworkSystemPrompt');
        const minimal = jest.spyOn(MxfAgentSystemPrompt, 'buildMinimalPrompt');
        const manager = new MxfSystemPromptManager('bare-agent', config(), callbacks);

        expect(manager.generateMinimalPrompt()).toBe(EXACT_PROMPT);
        await manager.loadCompleteSystemPrompt();
        expect(history[0].content).toBe(EXACT_PROMPT);
        await manager.updatePromptForTask({ taskId: 'task-A', title: 'Framework task', description: 'Injected guidance' });
        expect(history[0].content).toBe(EXACT_PROMPT);
        expect(manager.generateContextualPrompt(history, { processForMemory: true })).toBe('');
        expect(manager.buildCollaborativeContext(['peer'])).toBe('');
        const replacement = '\tNew {{date}} prompt\n ';
        await manager.setAgentConfigPrompt(replacement);
        await manager.loadCompleteSystemPrompt();
        expect(history[0].content).toBe(replacement);
        expect(manager.generateMinimalPrompt()).toBe(replacement);
        await expect(manager.setAgentConfigPrompt(' \t\r\n')).rejects.toThrow('Bare prompt mode requires a non-empty agentConfigPrompt');
        expect(history[0].content).toBe(replacement);
        expect(manager.generateMinimalPrompt()).toBe(replacement);
        expect(framework).not.toHaveBeenCalled();
        expect(minimal).not.toHaveBeenCalled();
        expect(getTools).not.toHaveBeenCalled();
        expect(getChannelContext).not.toHaveBeenCalled();
        expect(getMemoryEntries).not.toHaveBeenCalled();
    });

    it('does not change its configured prompt if replacing the system message fails', async () => {
        const manager = new MxfSystemPromptManager('bare-agent', config(), {
            getConversationHistory: (): ConversationMessage[] => [systemMessage()],
            updateConversationMessage: jest.fn().mockRejectedValue(new Error('persistence failed')),
            getCachedTools: (): [] => []
        });
        await expect(manager.setAgentConfigPrompt('replacement')).rejects.toThrow('persistence failed');
        expect(manager.generateMinimalPrompt()).toBe(EXACT_PROMPT);
    });

    it('continues using the framework generator when prompt mode is omitted', () => {
        const minimal = jest.spyOn(MxfAgentSystemPrompt, 'buildMinimalPrompt').mockReturnValue('framework prompt');
        const agentConfig = config({ promptMode: undefined });
        const manager = new MxfSystemPromptManager('bare-agent', agentConfig, {
            getConversationHistory: (): ConversationMessage[] => [systemMessage()],
            updateConversationMessage: jest.fn().mockResolvedValue(undefined), getCachedTools: (): [] => []
        });
        expect(manager.generateMinimalPrompt()).toBe('framework prompt');
        expect(minimal).toHaveBeenCalledWith(agentConfig);
    });
});

describe('bare context construction', () => {
    afterEach(() => { jest.restoreAllMocks(); });

    it('bypasses every optional transform while keeping raw history and registry tool descriptions', async () => {
        // All framework transforms are enabled. Bare must return before consulting
        // them, regardless of environment configuration.
        const compaction = jest.spyOn(CompactionConfig, 'loadPromptCompactionConfig').mockReturnValue({
            ...CompactionConfig.loadPromptCompactionConfig(), microcompactionEnabled: true,
            postCompactionRestorationEnabled: true, systemRemindersEnabled: true
        });
        compaction.mockClear();
        const replace = jest.spyOn(PromptTemplateReplacer, 'replaceTemplates');
        const compact = jest.spyOn(ToolResultMicrocompactor, 'getInstance');
        const restore = jest.spyOn(PostCompactionRestorer, 'getInstance');
        const reminders = jest.spyOn(SystemReminderService, 'getInstance');
        const builder = new MxfContextBuilder('bare-agent');
        const actions = jest.spyOn(builder.actionHistoryService, 'getFormattedHistory').mockRejectedValue(new Error('must not read actions'));
        const history: ConversationMessage[] = [
            { ...systemMessage(), content: EXACT_PROMPT },
            { id: 'user', role: 'user', content: '  Original message  ', timestamp: 2, metadata: { fromAgentId: 'peer' } },
            { id: 'call', role: 'assistant', content: '', timestamp: 3, tool_calls: [{ id: 'tool-1', type: 'function', function: { name: 'read', arguments: '{}' } }] },
            { id: 'result', role: 'tool', content: 'raw result', timestamp: 4, metadata: { tool_call_id: 'tool-1' } }
        ];
        const tools = [{ name: 'read', description: 'Registry description {{date}}', inputSchema: { type: 'object' } }];
        const before = structuredClone({ history, tools });
        const result = await builder.buildContext(EXACT_PROMPT, config(), history,
            { taskId: 'task-A', description: 'framework task', title: 'Task A' }, tools, 'bare-channel',
            { showActiveAgents: true, systemLlmEnabled: true }, ['peer'], 'Reflect');

        expect(result.systemPrompt).toBe(EXACT_PROMPT);
        expect(result.promptMode).toBe('bare');
        expect(result.currentTask).toBeNull();
        expect(result.recentActions).toEqual([]);
        expect(result.conversationHistory).toBe(history);
        expect(result.availableTools).toBe(tools);
        expect({ history, tools }).toEqual(before);
        for (const callback of [replace, compact, restore, reminders, actions, compaction]) {
            expect(callback).not.toHaveBeenCalled();
        }
    });

    it('still expands templates and includes task context under default framework behavior', async () => {
        jest.spyOn(CompactionConfig, 'loadPromptCompactionConfig').mockReturnValue({
            ...CompactionConfig.loadPromptCompactionConfig(), microcompactionEnabled: false,
            postCompactionRestorationEnabled: false, systemRemindersEnabled: false
        });
        const replace = jest.spyOn(PromptTemplateReplacer, 'replaceTemplates').mockReturnValue('expanded framework prompt');
        const builder = new MxfContextBuilder('bare-agent');
        jest.spyOn(builder.actionHistoryService, 'getFormattedHistory').mockResolvedValue('(No recent actions)');
        const task = { taskId: 'task-A', description: 'real task' };
        const result = await builder.buildContext(EXACT_PROMPT, config({ promptMode: undefined }), [], task, [], 'bare-channel');
        expect(result.systemPrompt).toBe('expanded framework prompt');
        expect(result.currentTask).toEqual(expect.objectContaining(task));
        expect(replace).toHaveBeenCalledTimes(1);
    });
});
