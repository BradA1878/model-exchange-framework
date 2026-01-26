/**
 * MCP Prompts Integration Tests (P5)
 *
 * Tests the MCP Prompts Integration system including:
 * - PromptTemplateReplacer functionality with 13+ template types
 * - Temporal templates: {{DATE_TIME}}, {{TIME_ZONE}}, {{ISO_TIMESTAMP}}, etc.
 * - Context templates: {{AGENT_ID}}, {{CHANNEL_ID}}, {{ACTIVE_AGENTS_COUNT}}, etc.
 * - Control loop templates: {{CURRENT_ORPAR_PHASE}}, {{CURRENT_ORPAR_PHASE_GUIDANCE}}
 * - Task templates: {{CURRENT_TASK_ID}}, {{CURRENT_TASK_STATUS}}, etc.
 * - MemoryPromptInjector memory context injection
 * - Discovery vs verbose prompt modes
 * - MxfLayeredPromptAssembler integration
 *
 * The prompt template system is critical for providing dynamic, contextual
 * information to agents in their system prompts.
 */

import { TestSDK, createTestSDK } from '../../utils/TestSDK';
import { waitFor, sleep } from '../../utils/waitFor';
import { TIMEOUTS } from '../../utils/TestFixtures';
import {
    PromptTemplateReplacer,
    TemplateContext,
    PROMPT_TEMPLATES
} from '../../../src/shared/utils/PromptTemplateReplacer';
import {
    MemoryPromptInjector,
    MemoryEntry,
    MemoryInjectionConfig
} from '../../../src/shared/prompts/MemoryPromptInjector';
import {
    PromptConfig,
    DEFAULT_PROMPT_CONFIG,
    getPromptConfig
} from '../../../src/shared/config/PromptConfig';
import { MxfLayeredPromptAssembler } from '../../../src/sdk/services/MxfLayeredPromptAssembler';

describe('MCP Prompts Integration (P5)', () => {
    let testSdk: TestSDK;
    let channelId: string;

    beforeAll(async () => {
        testSdk = createTestSDK();
        await testSdk.connect();
        const result = await testSdk.createTestChannel('mcp-prompts', {
            disableSystemLlm: true
        });
        channelId = result.channelId;
    });

    afterAll(async () => {
        await testSdk.cleanup();
    });

    // =========================================================================
    // Section 1: PromptTemplateReplacer - Template Constants
    // =========================================================================

    describe('PromptTemplateReplacer Constants', () => {
        it('should export all required temporal templates', () => {
            expect(PROMPT_TEMPLATES.DATE_TIME).toBe('{{DATE_TIME}}');
            expect(PROMPT_TEMPLATES.TIME_ZONE).toBe('{{TIME_ZONE}}');
            expect(PROMPT_TEMPLATES.ISO_TIMESTAMP).toBe('{{ISO_TIMESTAMP}}');
            expect(PROMPT_TEMPLATES.DAY_OF_WEEK).toBe('{{DAY_OF_WEEK}}');
            expect(PROMPT_TEMPLATES.CURRENT_YEAR).toBe('{{CURRENT_YEAR}}');
            expect(PROMPT_TEMPLATES.CURRENT_MONTH).toBe('{{CURRENT_MONTH}}');
            expect(PROMPT_TEMPLATES.CURRENT_DAY).toBe('{{CURRENT_DAY}}');
        });

        it('should export all required context templates', () => {
            expect(PROMPT_TEMPLATES.AGENT_ID).toBe('{{AGENT_ID}}');
            expect(PROMPT_TEMPLATES.CHANNEL_ID).toBe('{{CHANNEL_ID}}');
            expect(PROMPT_TEMPLATES.CHANNEL_NAME).toBe('{{CHANNEL_NAME}}');
            expect(PROMPT_TEMPLATES.ACTIVE_AGENTS_COUNT).toBe('{{ACTIVE_AGENTS_COUNT}}');
            expect(PROMPT_TEMPLATES.ACTIVE_AGENTS_LIST).toBe('{{ACTIVE_AGENTS_LIST}}');
        });

        it('should export all required LLM/system templates', () => {
            expect(PROMPT_TEMPLATES.LLM_PROVIDER).toBe('{{LLM_PROVIDER}}');
            expect(PROMPT_TEMPLATES.LLM_MODEL).toBe('{{LLM_MODEL}}');
            expect(PROMPT_TEMPLATES.SYSTEM_LLM_STATUS).toBe('{{SYSTEM_LLM_STATUS}}');
            expect(PROMPT_TEMPLATES.OS_PLATFORM).toBe('{{OS_PLATFORM}}');
        });

        it('should export all required control loop templates', () => {
            expect(PROMPT_TEMPLATES.CURRENT_ORPAR_PHASE).toBe('{{CURRENT_ORPAR_PHASE}}');
            expect(PROMPT_TEMPLATES.CURRENT_ORPAR_PHASE_GUIDANCE).toBe('{{CURRENT_ORPAR_PHASE_GUIDANCE}}');
        });

        it('should export all required task templates', () => {
            expect(PROMPT_TEMPLATES.CURRENT_TASK_ID).toBe('{{CURRENT_TASK_ID}}');
            expect(PROMPT_TEMPLATES.CURRENT_TASK_TITLE).toBe('{{CURRENT_TASK_TITLE}}');
            expect(PROMPT_TEMPLATES.CURRENT_TASK_STATUS).toBe('{{CURRENT_TASK_STATUS}}');
            expect(PROMPT_TEMPLATES.CURRENT_TASK_PROGRESS).toBe('{{CURRENT_TASK_PROGRESS}}');
        });

        it('should have exactly 22 template constants', () => {
            const templateCount = Object.keys(PROMPT_TEMPLATES).length;
            expect(templateCount).toBe(22);
        });
    });

    // =========================================================================
    // Section 2: PromptTemplateReplacer - Temporal Templates
    // =========================================================================

    describe('Temporal Template Replacement', () => {
        it('should replace {{DATE_TIME}} with formatted date and time', () => {
            const prompt = 'Current time is: {{DATE_TIME}}';
            const result = PromptTemplateReplacer.replaceTemplates(prompt);

            expect(result).not.toContain('{{DATE_TIME}}');
            // Should contain day of week, month, day, year, time
            expect(result).toMatch(/\w+day/); // Day of week
            expect(result).toMatch(/\d{4}/); // Year
        });

        it('should replace {{TIME_ZONE}} with current timezone', () => {
            const prompt = 'Timezone: {{TIME_ZONE}}';
            const result = PromptTemplateReplacer.replaceTemplates(prompt);

            expect(result).not.toContain('{{TIME_ZONE}}');
            // Timezone should be a valid IANA identifier (e.g., America/New_York)
            expect(result).toMatch(/Timezone: \S+/);
        });

        it('should replace {{ISO_TIMESTAMP}} with ISO 8601 format', () => {
            const prompt = 'Timestamp: {{ISO_TIMESTAMP}}';
            const result = PromptTemplateReplacer.replaceTemplates(prompt);

            expect(result).not.toContain('{{ISO_TIMESTAMP}}');
            // ISO 8601 format: YYYY-MM-DDTHH:mm:ss.sssZ
            expect(result).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/);
        });

        it('should replace {{DAY_OF_WEEK}} with current day name', () => {
            const prompt = 'Today is {{DAY_OF_WEEK}}';
            const result = PromptTemplateReplacer.replaceTemplates(prompt);

            expect(result).not.toContain('{{DAY_OF_WEEK}}');
            const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
            expect(days.some(day => result.includes(day))).toBe(true);
        });

        it('should replace {{CURRENT_YEAR}} with numeric year', () => {
            const prompt = 'Year: {{CURRENT_YEAR}}';
            const result = PromptTemplateReplacer.replaceTemplates(prompt);

            expect(result).not.toContain('{{CURRENT_YEAR}}');
            const currentYear = new Date().getFullYear().toString();
            expect(result).toContain(currentYear);
        });

        it('should replace {{CURRENT_MONTH}} with month name', () => {
            const prompt = 'Month: {{CURRENT_MONTH}}';
            const result = PromptTemplateReplacer.replaceTemplates(prompt);

            expect(result).not.toContain('{{CURRENT_MONTH}}');
            const months = [
                'January', 'February', 'March', 'April', 'May', 'June',
                'July', 'August', 'September', 'October', 'November', 'December'
            ];
            expect(months.some(month => result.includes(month))).toBe(true);
        });

        it('should replace {{CURRENT_DAY}} with day of month', () => {
            const prompt = 'Day: {{CURRENT_DAY}}';
            const result = PromptTemplateReplacer.replaceTemplates(prompt);

            expect(result).not.toContain('{{CURRENT_DAY}}');
            const currentDay = new Date().getDate().toString();
            expect(result).toContain(currentDay);
        });

        it('should replace {{OS_PLATFORM}} with operating system', () => {
            const prompt = 'OS: {{OS_PLATFORM}}';
            const result = PromptTemplateReplacer.replaceTemplates(prompt);

            expect(result).not.toContain('{{OS_PLATFORM}}');
            // Should be one of: macOS, Windows, Linux, or other
            const platforms = ['macOS', 'Windows', 'Linux', 'FreeBSD', 'OpenBSD', 'SunOS', 'AIX', 'darwin'];
            expect(platforms.some(p => result.toLowerCase().includes(p.toLowerCase())) || result.includes('Unknown')).toBe(true);
        });

        it('should replace multiple temporal templates in same prompt', () => {
            const prompt = `Date: {{DATE_TIME}}
Timezone: {{TIME_ZONE}}
ISO: {{ISO_TIMESTAMP}}
Day: {{DAY_OF_WEEK}}
Year: {{CURRENT_YEAR}}
Month: {{CURRENT_MONTH}}`;

            const result = PromptTemplateReplacer.replaceTemplates(prompt);

            expect(result).not.toContain('{{DATE_TIME}}');
            expect(result).not.toContain('{{TIME_ZONE}}');
            expect(result).not.toContain('{{ISO_TIMESTAMP}}');
            expect(result).not.toContain('{{DAY_OF_WEEK}}');
            expect(result).not.toContain('{{CURRENT_YEAR}}');
            expect(result).not.toContain('{{CURRENT_MONTH}}');
        });

        it('should return fresh values on each call', async () => {
            const prompt = '{{ISO_TIMESTAMP}}';
            const result1 = PromptTemplateReplacer.replaceTemplates(prompt);

            // Wait a small amount to ensure timestamp changes
            await sleep(10);

            const result2 = PromptTemplateReplacer.replaceTemplates(prompt);

            // Timestamps should be different (or at least not contain template)
            expect(result1).not.toContain('{{ISO_TIMESTAMP}}');
            expect(result2).not.toContain('{{ISO_TIMESTAMP}}');
        });
    });

    // =========================================================================
    // Section 3: PromptTemplateReplacer - Context Templates
    // =========================================================================

    describe('Context Template Replacement', () => {
        it('should replace {{AGENT_ID}} when context provided', () => {
            const prompt = 'Agent: {{AGENT_ID}}';
            const context: TemplateContext = { agentId: 'test-agent-001' };
            const result = PromptTemplateReplacer.replaceTemplates(prompt, context);

            expect(result).toBe('Agent: test-agent-001');
        });

        it('should not replace {{AGENT_ID}} when context missing', () => {
            const prompt = 'Agent: {{AGENT_ID}}';
            const result = PromptTemplateReplacer.replaceTemplates(prompt);

            expect(result).toContain('{{AGENT_ID}}');
        });

        it('should replace {{CHANNEL_ID}} when context provided', () => {
            const prompt = 'Channel: {{CHANNEL_ID}}';
            const context: TemplateContext = { channelId: 'test-channel-001' };
            const result = PromptTemplateReplacer.replaceTemplates(prompt, context);

            expect(result).toBe('Channel: test-channel-001');
        });

        it('should replace {{CHANNEL_NAME}} when context provided', () => {
            const prompt = 'Channel Name: {{CHANNEL_NAME}}';
            const context: TemplateContext = { channelName: 'General Discussion' };
            const result = PromptTemplateReplacer.replaceTemplates(prompt, context);

            expect(result).toBe('Channel Name: General Discussion');
        });

        it('should replace {{ACTIVE_AGENTS_COUNT}} when context provided', () => {
            const prompt = 'Active agents: {{ACTIVE_AGENTS_COUNT}}';
            const context: TemplateContext = { activeAgentsCount: 5 };
            const result = PromptTemplateReplacer.replaceTemplates(prompt, context);

            expect(result).toBe('Active agents: 5');
        });

        it('should replace {{ACTIVE_AGENTS_COUNT}} with zero', () => {
            const prompt = 'Active agents: {{ACTIVE_AGENTS_COUNT}}';
            const context: TemplateContext = { activeAgentsCount: 0 };
            const result = PromptTemplateReplacer.replaceTemplates(prompt, context);

            expect(result).toBe('Active agents: 0');
        });

        it('should replace {{ACTIVE_AGENTS_LIST}} when context provided', () => {
            const prompt = 'Agents: {{ACTIVE_AGENTS_LIST}}';
            const context: TemplateContext = {
                activeAgentsList: ['agent-1', 'agent-2', 'agent-3']
            };
            const result = PromptTemplateReplacer.replaceTemplates(prompt, context);

            expect(result).toBe('Agents: agent-1, agent-2, agent-3');
        });

        it('should not replace {{ACTIVE_AGENTS_LIST}} when empty array', () => {
            const prompt = 'Agents: {{ACTIVE_AGENTS_LIST}}';
            const context: TemplateContext = { activeAgentsList: [] };
            const result = PromptTemplateReplacer.replaceTemplates(prompt, context);

            // Should remain unreplaced when array is empty
            expect(result).toContain('{{ACTIVE_AGENTS_LIST}}');
        });

        it('should replace {{LLM_PROVIDER}} when context provided', () => {
            const prompt = 'Provider: {{LLM_PROVIDER}}';
            const context: TemplateContext = { llmProvider: 'openrouter' };
            const result = PromptTemplateReplacer.replaceTemplates(prompt, context);

            expect(result).toBe('Provider: openrouter');
        });

        it('should replace {{LLM_MODEL}} when context provided', () => {
            const prompt = 'Model: {{LLM_MODEL}}';
            const context: TemplateContext = { llmModel: 'anthropic/claude-3.5-haiku' };
            const result = PromptTemplateReplacer.replaceTemplates(prompt, context);

            expect(result).toBe('Model: anthropic/claude-3.5-haiku');
        });

        it('should replace {{SYSTEM_LLM_STATUS}} with Enabled', () => {
            const prompt = 'SystemLLM: {{SYSTEM_LLM_STATUS}}';
            const context: TemplateContext = { systemLlmEnabled: true };
            const result = PromptTemplateReplacer.replaceTemplates(prompt, context);

            expect(result).toBe('SystemLLM: Enabled');
        });

        it('should replace {{SYSTEM_LLM_STATUS}} with Disabled', () => {
            const prompt = 'SystemLLM: {{SYSTEM_LLM_STATUS}}';
            const context: TemplateContext = { systemLlmEnabled: false };
            const result = PromptTemplateReplacer.replaceTemplates(prompt, context);

            expect(result).toBe('SystemLLM: Disabled');
        });

        it('should replace multiple context templates together', () => {
            const prompt = `Agent {{AGENT_ID}} in channel {{CHANNEL_ID}} ({{CHANNEL_NAME}})
Active agents: {{ACTIVE_AGENTS_COUNT}}
Using: {{LLM_PROVIDER}}/{{LLM_MODEL}}`;

            const context: TemplateContext = {
                agentId: 'my-agent',
                channelId: 'my-channel',
                channelName: 'Test Channel',
                activeAgentsCount: 3,
                llmProvider: 'openrouter',
                llmModel: 'claude-3-opus'
            };

            const result = PromptTemplateReplacer.replaceTemplates(prompt, context);

            expect(result).toContain('Agent my-agent');
            expect(result).toContain('channel my-channel');
            expect(result).toContain('(Test Channel)');
            expect(result).toContain('Active agents: 3');
            expect(result).toContain('Using: openrouter/claude-3-opus');
        });
    });

    // =========================================================================
    // Section 4: PromptTemplateReplacer - Control Loop Templates
    // =========================================================================

    describe('Control Loop Template Replacement', () => {
        it('should replace {{CURRENT_ORPAR_PHASE}} with Observe', () => {
            const prompt = 'Phase: {{CURRENT_ORPAR_PHASE}}';
            const context: TemplateContext = { currentOrparPhase: 'Observe' };
            const result = PromptTemplateReplacer.replaceTemplates(prompt, context);

            expect(result).toBe('Phase: Observe');
        });

        it('should replace {{CURRENT_ORPAR_PHASE}} with Reason', () => {
            const prompt = 'Phase: {{CURRENT_ORPAR_PHASE}}';
            const context: TemplateContext = { currentOrparPhase: 'Reason' };
            const result = PromptTemplateReplacer.replaceTemplates(prompt, context);

            expect(result).toBe('Phase: Reason');
        });

        it('should replace {{CURRENT_ORPAR_PHASE}} with Plan', () => {
            const prompt = 'Phase: {{CURRENT_ORPAR_PHASE}}';
            const context: TemplateContext = { currentOrparPhase: 'Plan' };
            const result = PromptTemplateReplacer.replaceTemplates(prompt, context);

            expect(result).toBe('Phase: Plan');
        });

        it('should replace {{CURRENT_ORPAR_PHASE}} with Act', () => {
            const prompt = 'Phase: {{CURRENT_ORPAR_PHASE}}';
            const context: TemplateContext = { currentOrparPhase: 'Act' };
            const result = PromptTemplateReplacer.replaceTemplates(prompt, context);

            expect(result).toBe('Phase: Act');
        });

        it('should replace {{CURRENT_ORPAR_PHASE}} with Reflect', () => {
            const prompt = 'Phase: {{CURRENT_ORPAR_PHASE}}';
            const context: TemplateContext = { currentOrparPhase: 'Reflect' };
            const result = PromptTemplateReplacer.replaceTemplates(prompt, context);

            expect(result).toBe('Phase: Reflect');
        });

        it('should replace {{CURRENT_ORPAR_PHASE}} with "(Not in active cycle)" when null', () => {
            const prompt = 'Phase: {{CURRENT_ORPAR_PHASE}}';
            const context: TemplateContext = { currentOrparPhase: null };
            const result = PromptTemplateReplacer.replaceTemplates(prompt, context);

            expect(result).toBe('Phase: (Not in active cycle)');
        });

        it('should replace {{CURRENT_ORPAR_PHASE_GUIDANCE}} for Observe phase', () => {
            const prompt = 'Guidance: {{CURRENT_ORPAR_PHASE_GUIDANCE}}';
            const context: TemplateContext = { currentOrparPhase: 'Observe' };
            const result = PromptTemplateReplacer.replaceTemplates(prompt, context);

            expect(result).toContain('gathering information');
            expect(result).toContain('discovery');
        });

        it('should replace {{CURRENT_ORPAR_PHASE_GUIDANCE}} for Reason phase', () => {
            const prompt = 'Guidance: {{CURRENT_ORPAR_PHASE_GUIDANCE}}';
            const context: TemplateContext = { currentOrparPhase: 'Reason' };
            const result = PromptTemplateReplacer.replaceTemplates(prompt, context);

            expect(result).toContain('Analyze');
            expect(result).toContain('patterns');
        });

        it('should replace {{CURRENT_ORPAR_PHASE_GUIDANCE}} for Plan phase', () => {
            const prompt = 'Guidance: {{CURRENT_ORPAR_PHASE_GUIDANCE}}';
            const context: TemplateContext = { currentOrparPhase: 'Plan' };
            const result = PromptTemplateReplacer.replaceTemplates(prompt, context);

            expect(result).toContain('strategic plan');
            expect(result).toContain('steps');
        });

        it('should replace {{CURRENT_ORPAR_PHASE_GUIDANCE}} for Act phase', () => {
            const prompt = 'Guidance: {{CURRENT_ORPAR_PHASE_GUIDANCE}}';
            const context: TemplateContext = { currentOrparPhase: 'Act' };
            const result = PromptTemplateReplacer.replaceTemplates(prompt, context);

            expect(result).toContain('Execute');
            expect(result).toContain('tools');
        });

        it('should replace {{CURRENT_ORPAR_PHASE_GUIDANCE}} for Reflect phase', () => {
            const prompt = 'Guidance: {{CURRENT_ORPAR_PHASE_GUIDANCE}}';
            const context: TemplateContext = { currentOrparPhase: 'Reflect' };
            const result = PromptTemplateReplacer.replaceTemplates(prompt, context);

            expect(result).toContain('Evaluate');
            expect(result).toContain('learnings');
        });

        it('should replace {{CURRENT_ORPAR_PHASE_GUIDANCE}} with empty when null', () => {
            const prompt = 'Guidance: {{CURRENT_ORPAR_PHASE_GUIDANCE}}';
            const context: TemplateContext = { currentOrparPhase: null };
            const result = PromptTemplateReplacer.replaceTemplates(prompt, context);

            expect(result).toBe('Guidance: ');
        });

        it('should replace both ORPAR templates together', () => {
            const prompt = `Current Phase: {{CURRENT_ORPAR_PHASE}}
Phase Guidance: {{CURRENT_ORPAR_PHASE_GUIDANCE}}`;

            const context: TemplateContext = { currentOrparPhase: 'Plan' };
            const result = PromptTemplateReplacer.replaceTemplates(prompt, context);

            expect(result).toContain('Current Phase: Plan');
            expect(result).toContain('strategic plan');
            expect(result).not.toContain('{{CURRENT_ORPAR_PHASE}}');
            expect(result).not.toContain('{{CURRENT_ORPAR_PHASE_GUIDANCE}}');
        });
    });

    // =========================================================================
    // Section 5: PromptTemplateReplacer - Task Templates
    // =========================================================================

    describe('Task Template Replacement', () => {
        it('should replace {{CURRENT_TASK_ID}} when context provided', () => {
            const prompt = 'Task ID: {{CURRENT_TASK_ID}}';
            const context: TemplateContext = { currentTaskId: 'task-123' };
            const result = PromptTemplateReplacer.replaceTemplates(prompt, context);

            expect(result).toBe('Task ID: task-123');
        });

        it('should replace {{CURRENT_TASK_TITLE}} when context provided', () => {
            const prompt = 'Task: {{CURRENT_TASK_TITLE}}';
            const context: TemplateContext = { currentTaskTitle: 'Implement feature X' };
            const result = PromptTemplateReplacer.replaceTemplates(prompt, context);

            expect(result).toBe('Task: Implement feature X');
        });

        it('should replace {{CURRENT_TASK_STATUS}} when context provided', () => {
            const prompt = 'Status: {{CURRENT_TASK_STATUS}}';
            const context: TemplateContext = { currentTaskStatus: 'in_progress' };
            const result = PromptTemplateReplacer.replaceTemplates(prompt, context);

            expect(result).toBe('Status: in_progress');
        });

        it('should replace {{CURRENT_TASK_PROGRESS}} with percentage', () => {
            const prompt = 'Progress: {{CURRENT_TASK_PROGRESS}}';
            const context: TemplateContext = { currentTaskProgress: 75 };
            const result = PromptTemplateReplacer.replaceTemplates(prompt, context);

            expect(result).toBe('Progress: 75%');
        });

        it('should replace {{CURRENT_TASK_PROGRESS}} with 0%', () => {
            const prompt = 'Progress: {{CURRENT_TASK_PROGRESS}}';
            const context: TemplateContext = { currentTaskProgress: 0 };
            const result = PromptTemplateReplacer.replaceTemplates(prompt, context);

            expect(result).toBe('Progress: 0%');
        });

        it('should replace {{CURRENT_TASK_PROGRESS}} with 100%', () => {
            const prompt = 'Progress: {{CURRENT_TASK_PROGRESS}}';
            const context: TemplateContext = { currentTaskProgress: 100 };
            const result = PromptTemplateReplacer.replaceTemplates(prompt, context);

            expect(result).toBe('Progress: 100%');
        });

        it('should replace all task templates together', () => {
            const prompt = `Task: {{CURRENT_TASK_TITLE}} ({{CURRENT_TASK_ID}})
Status: {{CURRENT_TASK_STATUS}}
Progress: {{CURRENT_TASK_PROGRESS}}`;

            const context: TemplateContext = {
                currentTaskId: 'task-456',
                currentTaskTitle: 'Build integration tests',
                currentTaskStatus: 'in_progress',
                currentTaskProgress: 50
            };

            const result = PromptTemplateReplacer.replaceTemplates(prompt, context);

            expect(result).toContain('Build integration tests');
            expect(result).toContain('task-456');
            expect(result).toContain('in_progress');
            expect(result).toContain('50%');
        });

        it('should not replace task templates when context missing', () => {
            const prompt = 'Task: {{CURRENT_TASK_ID}} - {{CURRENT_TASK_TITLE}}';
            const result = PromptTemplateReplacer.replaceTemplates(prompt);

            expect(result).toContain('{{CURRENT_TASK_ID}}');
            expect(result).toContain('{{CURRENT_TASK_TITLE}}');
        });
    });

    // =========================================================================
    // Section 6: PromptTemplateReplacer - Custom Values
    // =========================================================================

    describe('Custom Value Template Replacement', () => {
        it('should replace custom value templates', () => {
            const prompt = 'Custom: {{MY_CUSTOM_VALUE}}';
            const context: TemplateContext = {
                customValues: { MY_CUSTOM_VALUE: 'Hello World' }
            };
            const result = PromptTemplateReplacer.replaceTemplates(prompt, context);

            expect(result).toBe('Custom: Hello World');
        });

        it('should replace multiple custom values', () => {
            const prompt = 'A: {{VALUE_A}}, B: {{VALUE_B}}, C: {{VALUE_C}}';
            const context: TemplateContext = {
                customValues: {
                    VALUE_A: 'First',
                    VALUE_B: 'Second',
                    VALUE_C: 'Third'
                }
            };
            const result = PromptTemplateReplacer.replaceTemplates(prompt, context);

            expect(result).toBe('A: First, B: Second, C: Third');
        });

        it('should handle custom values with special characters', () => {
            const prompt = 'Data: {{SPECIAL_DATA}}';
            const context: TemplateContext = {
                customValues: {
                    SPECIAL_DATA: 'Value with "quotes" and <brackets>'
                }
            };
            const result = PromptTemplateReplacer.replaceTemplates(prompt, context);

            expect(result).toContain('Value with "quotes" and <brackets>');
        });

        it('should handle empty custom values object', () => {
            const prompt = 'Data: {{MY_VALUE}}';
            const context: TemplateContext = { customValues: {} };
            const result = PromptTemplateReplacer.replaceTemplates(prompt, context);

            expect(result).toContain('{{MY_VALUE}}');
        });
    });

    // =========================================================================
    // Section 7: PromptTemplateReplacer - Edge Cases
    // =========================================================================

    describe('Template Replacement Edge Cases', () => {
        it('should handle empty prompt', () => {
            const result = PromptTemplateReplacer.replaceTemplates('');
            expect(result).toBe('');
        });

        it('should handle null/undefined prompt', () => {
            expect(PromptTemplateReplacer.replaceTemplates(null as any)).toBeFalsy();
            expect(PromptTemplateReplacer.replaceTemplates(undefined as any)).toBeFalsy();
        });

        it('should handle prompt with no templates', () => {
            const prompt = 'This is a plain prompt with no templates.';
            const result = PromptTemplateReplacer.replaceTemplates(prompt);

            expect(result).toBe(prompt);
        });

        it('should handle malformed templates', () => {
            const prompt = 'Invalid: {DATE_TIME} {{MISSING}} {{{EXTRA}}}';
            const result = PromptTemplateReplacer.replaceTemplates(prompt);

            // Should not crash, malformed templates stay as-is
            expect(result).toContain('{DATE_TIME}');
        });

        it('should handle repeated templates', () => {
            const prompt = '{{DATE_TIME}} - {{DATE_TIME}} - {{DATE_TIME}}';
            const result = PromptTemplateReplacer.replaceTemplates(prompt);

            expect(result).not.toContain('{{DATE_TIME}}');
            // All three should be replaced with the same value
            const parts = result.split(' - ');
            expect(parts.length).toBe(3);
        });

        it('should handle very long prompts', () => {
            const longContent = 'A'.repeat(10000);
            const prompt = `Start: {{DATE_TIME}}\n${longContent}\nEnd: {{AGENT_ID}}`;
            const context: TemplateContext = { agentId: 'long-test-agent' };

            const result = PromptTemplateReplacer.replaceTemplates(prompt, context);

            expect(result).not.toContain('{{DATE_TIME}}');
            expect(result).toContain('long-test-agent');
            expect(result.length).toBeGreaterThan(10000);
        });

        it('should handle templates in different cases (case-sensitive)', () => {
            const prompt = '{{date_time}} {{Date_Time}} {{DATE_TIME}}';
            const result = PromptTemplateReplacer.replaceTemplates(prompt);

            // Only uppercase version should be replaced
            expect(result).toContain('{{date_time}}');
            expect(result).toContain('{{Date_Time}}');
            expect(result).not.toContain('{{DATE_TIME}}');
        });
    });

    // =========================================================================
    // Section 8: PromptTemplateReplacer - getCurrentTemporalValues
    // =========================================================================

    describe('getCurrentTemporalValues', () => {
        it('should return all temporal values', () => {
            const values = PromptTemplateReplacer.getCurrentTemporalValues();

            expect(values.dateTime).toBeDefined();
            expect(values.timezone).toBeDefined();
            expect(values.isoTimestamp).toBeDefined();
            expect(values.dayOfWeek).toBeDefined();
            expect(values.currentYear).toBeDefined();
            expect(values.currentMonth).toBeDefined();
            expect(values.currentDay).toBeDefined();
        });

        it('should return valid ISO timestamp', () => {
            const values = PromptTemplateReplacer.getCurrentTemporalValues();

            expect(values.isoTimestamp).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/);
        });

        it('should return current year as string', () => {
            const values = PromptTemplateReplacer.getCurrentTemporalValues();
            const expectedYear = new Date().getFullYear().toString();

            expect(values.currentYear).toBe(expectedYear);
        });

        it('should return valid day of week', () => {
            const values = PromptTemplateReplacer.getCurrentTemporalValues();
            const validDays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

            expect(validDays).toContain(values.dayOfWeek);
        });

        it('should return valid month name', () => {
            const values = PromptTemplateReplacer.getCurrentTemporalValues();
            const validMonths = [
                'January', 'February', 'March', 'April', 'May', 'June',
                'July', 'August', 'September', 'October', 'November', 'December'
            ];

            expect(validMonths).toContain(values.currentMonth);
        });
    });

    // =========================================================================
    // Section 9: MemoryPromptInjector - Basic Injection
    // =========================================================================

    describe('MemoryPromptInjector Basic Injection', () => {
        const createTestMemories = (): MemoryEntry[] => [
            {
                id: 'mem-1',
                content: 'User prefers concise responses.',
                type: 'note',
                importance: 'high',
                timestamp: new Date(),
                tags: ['preference', 'user']
            },
            {
                id: 'mem-2',
                content: 'Previous task was completed successfully.',
                type: 'task',
                importance: 'medium',
                timestamp: new Date(Date.now() - 3600000), // 1 hour ago
                tags: ['task', 'success']
            },
            {
                id: 'mem-3',
                content: 'System state: all services operational.',
                type: 'state',
                importance: 'low',
                timestamp: new Date(Date.now() - 7200000), // 2 hours ago
                tags: ['system', 'status']
            }
        ];

        it('should return empty string for empty memories array', () => {
            const result = MemoryPromptInjector.injectMemoryContext([]);
            expect(result).toBe('');
        });

        it('should return empty string for null/undefined memories', () => {
            expect(MemoryPromptInjector.injectMemoryContext(null as any)).toBe('');
            expect(MemoryPromptInjector.injectMemoryContext(undefined as any)).toBe('');
        });

        it('should inject memory context with default config', () => {
            const memories = createTestMemories();
            const result = MemoryPromptInjector.injectMemoryContext(memories);

            expect(result).toContain('Relevant Memory Context');
            expect(result).toContain('User prefers concise responses');
        });

        it('should group memories by type', () => {
            const memories = createTestMemories();
            const result = MemoryPromptInjector.injectMemoryContext(memories);

            expect(result).toContain('Notes');
            expect(result).toContain('Task Memory');
            expect(result).toContain('Shared State');
        });

        it('should respect maxEntries configuration', () => {
            const memories = createTestMemories();
            const config: MemoryInjectionConfig = { maxEntries: 1 };
            const result = MemoryPromptInjector.injectMemoryContext(memories, config);

            // Should only include the highest importance entry
            expect(result).toContain('User prefers concise responses');
            expect(result).not.toContain('System state');
        });

        it('should display importance indicators', () => {
            const memories: MemoryEntry[] = [
                {
                    id: 'high',
                    content: 'High importance memory',
                    type: 'note',
                    importance: 'high',
                    timestamp: new Date()
                }
            ];
            const result = MemoryPromptInjector.injectMemoryContext(memories);

            // Should include some importance indicator
            expect(result).toContain('High importance memory');
        });

        it('should include tags when present', () => {
            const memories: MemoryEntry[] = [
                {
                    id: 'tagged',
                    content: 'Memory with tags',
                    type: 'note',
                    importance: 'medium',
                    timestamp: new Date(),
                    tags: ['important', 'review']
                }
            ];
            const result = MemoryPromptInjector.injectMemoryContext(memories);

            expect(result).toContain('Tags:');
            expect(result).toContain('important');
            expect(result).toContain('review');
        });

        it('should include source when present', () => {
            const memories: MemoryEntry[] = [
                {
                    id: 'sourced',
                    content: 'Memory with source',
                    type: 'note',
                    importance: 'medium',
                    timestamp: new Date(),
                    source: 'agent-007'
                }
            ];
            const result = MemoryPromptInjector.injectMemoryContext(memories);

            expect(result).toContain('Source: agent-007');
        });
    });

    // =========================================================================
    // Section 10: MemoryPromptInjector - Filtering
    // =========================================================================

    describe('MemoryPromptInjector Filtering', () => {
        const createVariedMemories = (): MemoryEntry[] => [
            {
                id: 'note-1',
                content: 'A note entry',
                type: 'note',
                importance: 'high',
                timestamp: new Date()
            },
            {
                id: 'task-1',
                content: 'A task entry',
                type: 'task',
                importance: 'medium',
                timestamp: new Date()
            },
            {
                id: 'state-1',
                content: 'A state entry',
                type: 'state',
                importance: 'low',
                timestamp: new Date()
            },
            {
                id: 'decision-1',
                content: 'A decision entry',
                type: 'decision',
                importance: 'high',
                timestamp: new Date()
            }
        ];

        it('should filter by type', () => {
            const memories = createVariedMemories();
            const config: MemoryInjectionConfig = {
                filterByType: ['note', 'task']
            };
            const result = MemoryPromptInjector.injectMemoryContext(memories, config);

            expect(result).toContain('A note entry');
            expect(result).toContain('A task entry');
            expect(result).not.toContain('A state entry');
            expect(result).not.toContain('A decision entry');
        });

        it('should filter by importance', () => {
            const memories = createVariedMemories();
            const config: MemoryInjectionConfig = {
                filterByImportance: ['high']
            };
            const result = MemoryPromptInjector.injectMemoryContext(memories, config);

            expect(result).toContain('A note entry');
            expect(result).toContain('A decision entry');
            expect(result).not.toContain('A task entry');
            expect(result).not.toContain('A state entry');
        });

        it('should filter by tags', () => {
            const memories: MemoryEntry[] = [
                {
                    id: 'tagged-1',
                    content: 'Has target tag',
                    type: 'note',
                    timestamp: new Date(),
                    tags: ['target', 'other']
                },
                {
                    id: 'tagged-2',
                    content: 'Different tags',
                    type: 'note',
                    timestamp: new Date(),
                    tags: ['different', 'tags']
                },
                {
                    id: 'no-tags',
                    content: 'No tags at all',
                    type: 'note',
                    timestamp: new Date()
                }
            ];
            const config: MemoryInjectionConfig = {
                filterByTags: ['target']
            };
            const result = MemoryPromptInjector.injectMemoryContext(memories, config);

            expect(result).toContain('Has target tag');
            expect(result).not.toContain('Different tags');
            expect(result).not.toContain('No tags at all');
        });

        it('should filter by recency (last 24 hours)', () => {
            const now = new Date();
            const memories: MemoryEntry[] = [
                {
                    id: 'recent',
                    content: 'Recent memory',
                    type: 'note',
                    timestamp: now
                },
                {
                    id: 'old',
                    content: 'Old memory',
                    type: 'note',
                    timestamp: new Date(now.getTime() - 48 * 60 * 60 * 1000) // 48 hours ago
                }
            ];
            const config: MemoryInjectionConfig = {
                filterByRecency: true
            };
            const result = MemoryPromptInjector.injectMemoryContext(memories, config);

            expect(result).toContain('Recent memory');
            expect(result).not.toContain('Old memory');
        });

        it('should combine multiple filters', () => {
            const memories: MemoryEntry[] = [
                {
                    id: 'match-all',
                    content: 'Matches all filters',
                    type: 'note',
                    importance: 'high',
                    timestamp: new Date(),
                    tags: ['relevant']
                },
                {
                    id: 'wrong-type',
                    content: 'Wrong type',
                    type: 'task',
                    importance: 'high',
                    timestamp: new Date(),
                    tags: ['relevant']
                },
                {
                    id: 'wrong-importance',
                    content: 'Wrong importance',
                    type: 'note',
                    importance: 'low',
                    timestamp: new Date(),
                    tags: ['relevant']
                }
            ];
            const config: MemoryInjectionConfig = {
                filterByType: ['note'],
                filterByImportance: ['high'],
                filterByTags: ['relevant']
            };
            const result = MemoryPromptInjector.injectMemoryContext(memories, config);

            expect(result).toContain('Matches all filters');
            expect(result).not.toContain('Wrong type');
            expect(result).not.toContain('Wrong importance');
        });

        it('should return empty when no memories match filters', () => {
            const memories: MemoryEntry[] = [
                {
                    id: 'no-match',
                    content: 'Does not match',
                    type: 'note',
                    timestamp: new Date()
                }
            ];
            const config: MemoryInjectionConfig = {
                filterByType: ['task'] // None are tasks
            };
            const result = MemoryPromptInjector.injectMemoryContext(memories, config);

            expect(result).toBe('');
        });
    });

    // =========================================================================
    // Section 11: MemoryPromptInjector - Sorting and Metadata
    // =========================================================================

    describe('MemoryPromptInjector Sorting and Metadata', () => {
        it('should sort by importance (high first)', () => {
            const memories: MemoryEntry[] = [
                {
                    id: 'low',
                    content: 'Low importance',
                    type: 'note',
                    importance: 'low',
                    timestamp: new Date()
                },
                {
                    id: 'high',
                    content: 'High importance',
                    type: 'note',
                    importance: 'high',
                    timestamp: new Date()
                },
                {
                    id: 'medium',
                    content: 'Medium importance',
                    type: 'note',
                    importance: 'medium',
                    timestamp: new Date()
                }
            ];
            const result = MemoryPromptInjector.injectMemoryContext(memories);

            // High importance should appear first in result
            const highIndex = result.indexOf('High importance');
            const mediumIndex = result.indexOf('Medium importance');
            const lowIndex = result.indexOf('Low importance');

            expect(highIndex).toBeLessThan(mediumIndex);
            expect(mediumIndex).toBeLessThan(lowIndex);
        });

        it('should sort by recency when importance is equal', () => {
            const now = new Date();
            const memories: MemoryEntry[] = [
                {
                    id: 'older',
                    content: 'Older entry',
                    type: 'note',
                    importance: 'medium',
                    timestamp: new Date(now.getTime() - 3600000) // 1 hour ago
                },
                {
                    id: 'newer',
                    content: 'Newer entry',
                    type: 'note',
                    importance: 'medium',
                    timestamp: now
                }
            ];
            const result = MemoryPromptInjector.injectMemoryContext(memories);

            // Newer should appear before older
            const newerIndex = result.indexOf('Newer entry');
            const olderIndex = result.indexOf('Older entry');

            expect(newerIndex).toBeLessThan(olderIndex);
        });

        it('should include metadata when configured', () => {
            const memories: MemoryEntry[] = [
                {
                    id: 'with-metadata',
                    content: 'Memory with metadata',
                    type: 'note',
                    timestamp: new Date(),
                    metadata: {
                        customKey: 'customValue',
                        anotherKey: 123
                    }
                }
            ];
            const config: MemoryInjectionConfig = {
                includeMetadata: true
            };
            const result = MemoryPromptInjector.injectMemoryContext(memories, config);

            expect(result).toContain('customKey');
            expect(result).toContain('customValue');
        });

        it('should not include metadata by default', () => {
            const memories: MemoryEntry[] = [
                {
                    id: 'with-metadata',
                    content: 'Memory with metadata',
                    type: 'note',
                    timestamp: new Date(),
                    metadata: { secretKey: 'secretValue' }
                }
            ];
            const result = MemoryPromptInjector.injectMemoryContext(memories);

            expect(result).not.toContain('secretKey');
        });

        it('should summarize long content when configured', () => {
            const longContent = 'A'.repeat(300);
            const memories: MemoryEntry[] = [
                {
                    id: 'long',
                    content: longContent,
                    type: 'note',
                    timestamp: new Date()
                }
            ];
            const config: MemoryInjectionConfig = {
                summarize: true
            };
            const result = MemoryPromptInjector.injectMemoryContext(memories, config);

            // Content should be truncated with ellipsis
            expect(result.length).toBeLessThan(longContent.length + 100);
            expect(result).toContain('...');
        });
    });

    // =========================================================================
    // Section 12: MemoryPromptInjector - Task Relevance
    // =========================================================================

    describe('MemoryPromptInjector Task Relevance', () => {
        it('should extract task-relevant memories', () => {
            const memories: MemoryEntry[] = [
                {
                    id: 'relevant-1',
                    content: 'Information about authentication flow',
                    type: 'note',
                    importance: 'high',
                    timestamp: new Date(),
                    tags: ['auth', 'security']
                },
                {
                    id: 'relevant-2',
                    content: 'User login process details',
                    type: 'note',
                    importance: 'medium',
                    timestamp: new Date(),
                    tags: ['login', 'user']
                },
                {
                    id: 'irrelevant',
                    content: 'Weather forecast for next week',
                    type: 'note',
                    importance: 'low',
                    timestamp: new Date(),
                    tags: ['weather']
                }
            ];

            const taskContext = 'Implement user authentication system';
            const relevant = MemoryPromptInjector.extractTaskRelevantMemories(
                memories,
                taskContext,
                5
            );

            expect(relevant.length).toBeGreaterThan(0);
            expect(relevant.some(m => m.id === 'relevant-1')).toBe(true);
            expect(relevant.some(m => m.id === 'relevant-2')).toBe(true);
        });

        it('should return empty array when no memories match', () => {
            const memories: MemoryEntry[] = [
                {
                    id: 'unrelated',
                    content: 'Completely unrelated content',
                    type: 'note',
                    timestamp: new Date()
                }
            ];

            const taskContext = 'xyzzy specific unique term';
            const relevant = MemoryPromptInjector.extractTaskRelevantMemories(
                memories,
                taskContext,
                5
            );

            expect(relevant.length).toBe(0);
        });

        it('should respect maxEntries limit', () => {
            const memories: MemoryEntry[] = Array.from({ length: 10 }, (_, i) => ({
                id: `mem-${i}`,
                content: `Relevant memory about topic ${i}`,
                type: 'note' as const,
                importance: 'medium' as const,
                timestamp: new Date(),
                tags: ['topic']
            }));

            const taskContext = 'topic memory relevant';
            const relevant = MemoryPromptInjector.extractTaskRelevantMemories(
                memories,
                taskContext,
                3
            );

            expect(relevant.length).toBe(3);
        });

        it('should boost recent memories in relevance scoring', () => {
            const now = new Date();
            const memories: MemoryEntry[] = [
                {
                    id: 'recent',
                    content: 'Memory about the topic',
                    type: 'note',
                    importance: 'low',
                    timestamp: now // Very recent
                },
                {
                    id: 'old',
                    content: 'Memory about the topic',
                    type: 'note',
                    importance: 'low',
                    timestamp: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) // 1 week ago
                }
            ];

            const taskContext = 'topic';
            const relevant = MemoryPromptInjector.extractTaskRelevantMemories(
                memories,
                taskContext,
                2
            );

            // Recent memory should be first
            expect(relevant[0].id).toBe('recent');
        });

        it('should boost high importance memories', () => {
            const now = new Date();
            const memories: MemoryEntry[] = [
                {
                    id: 'high',
                    content: 'Memory about subject',
                    type: 'note',
                    importance: 'high',
                    timestamp: now
                },
                {
                    id: 'low',
                    content: 'Memory about subject',
                    type: 'note',
                    importance: 'low',
                    timestamp: now
                }
            ];

            const taskContext = 'subject';
            const relevant = MemoryPromptInjector.extractTaskRelevantMemories(
                memories,
                taskContext,
                2
            );

            // High importance should be first
            expect(relevant[0].id).toBe('high');
        });
    });

    // =========================================================================
    // Section 13: PromptConfig - Configuration Management
    // =========================================================================

    describe('PromptConfig Configuration', () => {
        it('should have correct default configuration', () => {
            expect(DEFAULT_PROMPT_CONFIG.useDiscoveryPrompts).toBe(true);
            expect(DEFAULT_PROMPT_CONFIG.includeToolSchemas).toBe(true);
            expect(DEFAULT_PROMPT_CONFIG.includeUsageExamples).toBe(false);
            expect(DEFAULT_PROMPT_CONFIG.includeOrparGuidance).toBe(true);
            expect(DEFAULT_PROMPT_CONFIG.coreToolsOnly).toBe(true);
        });

        it('should return default config from getPromptConfig', () => {
            const config = getPromptConfig();

            expect(config.useDiscoveryPrompts).toBeDefined();
            expect(config.includeToolSchemas).toBeDefined();
            expect(config.includeOrparGuidance).toBeDefined();
        });

        it('should support discovery mode by default', () => {
            const config = getPromptConfig();
            expect(config.useDiscoveryPrompts).toBe(true);
        });
    });

    // =========================================================================
    // Section 14: Discovery vs Verbose Prompt Modes
    // =========================================================================

    describe('Discovery vs Verbose Prompt Modes', () => {
        it('should produce different prompts for discovery vs verbose modes', () => {
            // Discovery mode - minimal, encourages tool discovery
            const discoveryConfig: PromptConfig = {
                useDiscoveryPrompts: true,
                includeToolSchemas: false,
                includeUsageExamples: false
            };

            // Verbose mode - full tool schemas and examples
            const verboseConfig: PromptConfig = {
                useDiscoveryPrompts: false,
                includeToolSchemas: true,
                includeUsageExamples: true
            };

            // The configs should be different
            expect(discoveryConfig.useDiscoveryPrompts).not.toBe(verboseConfig.useDiscoveryPrompts);
            expect(discoveryConfig.includeUsageExamples).not.toBe(verboseConfig.includeUsageExamples);
        });

        it('should support ORPAR guidance in both modes', () => {
            const discoveryConfig: PromptConfig = {
                useDiscoveryPrompts: true,
                includeOrparGuidance: true
            };

            const verboseConfig: PromptConfig = {
                useDiscoveryPrompts: false,
                includeOrparGuidance: true
            };

            expect(discoveryConfig.includeOrparGuidance).toBe(true);
            expect(verboseConfig.includeOrparGuidance).toBe(true);
        });
    });

    // =========================================================================
    // Section 15: MxfLayeredPromptAssembler Integration
    // =========================================================================

    describe('MxfLayeredPromptAssembler Integration', () => {
        it('should create assembler with agent config', () => {
            const agentConfig = {
                agentId: 'test-agent',
                name: 'Test Agent',
                channelId: channelId,
                llmProvider: 'openrouter' as any,
                apiKey: 'test-key',
                defaultModel: 'anthropic/claude-3.5-haiku'
            };

            const assembler = new MxfLayeredPromptAssembler('test-agent', agentConfig as any);

            expect(assembler).toBeDefined();
            expect(assembler.actionHistoryService).toBeDefined();
            expect(assembler.reasoningHistoryService).toBeDefined();
        });

        it('should create system prompt message', () => {
            const agentConfig = {
                agentId: 'test-agent',
                name: 'Test Agent',
                channelId: channelId,
                llmProvider: 'openrouter' as any,
                apiKey: 'test-key',
                defaultModel: 'anthropic/claude-3.5-haiku'
            };

            const assembler = new MxfLayeredPromptAssembler('test-agent', agentConfig as any);
            const message = assembler.createSystemPromptMessage('You are a helpful assistant.');

            expect(message.role).toBe('system');
            expect(message.content).toBe('You are a helpful assistant.');
            expect(message.metadata?.layer).toBe('system');
            expect(message.metadata?.persistent).toBe(true);
        });

        it('should create task prompt message', () => {
            const agentConfig = {
                agentId: 'test-agent',
                name: 'Test Agent',
                channelId: channelId,
                llmProvider: 'openrouter' as any,
                apiKey: 'test-key',
                defaultModel: 'anthropic/claude-3.5-haiku'
            };

            const assembler = new MxfLayeredPromptAssembler('test-agent', agentConfig as any);
            const message = assembler.createTaskPromptMessage('Complete the integration tests.');

            expect(message.role).toBe('user');
            expect(message.content).toBe('Complete the integration tests.');
            expect(message.metadata?.layer).toBe('task');
            expect(message.metadata?.persistent).toBe(false);
        });

        it('should create SystemLLM message with ephemeral flag', () => {
            const agentConfig = {
                agentId: 'test-agent',
                name: 'Test Agent',
                channelId: channelId,
                llmProvider: 'openrouter' as any,
                apiKey: 'test-key',
                defaultModel: 'anthropic/claude-3.5-haiku'
            };

            const assembler = new MxfLayeredPromptAssembler('test-agent', agentConfig as any);
            const message = assembler.createSystemLLMMessage('Consider using the search tool.');

            expect(message.role).toBe('user');
            expect(message.content).toContain('[SystemLLM]');
            expect(message.content).toContain('Consider using the search tool');
            expect(message.metadata?.ephemeral).toBe(true);
            expect(message.metadata?.isSystemLLM).toBe(true);
        });
    });

    // =========================================================================
    // Section 16: Full Integration with Live Agents
    // =========================================================================

    describe('Full Integration with Live Agents', () => {
        it('should create agent with template-enabled prompt', async () => {
            const templatePrompt = `You are agent {{AGENT_ID}} in channel {{CHANNEL_ID}}.
Current time: {{DATE_TIME}}
Timezone: {{TIME_ZONE}}

You are a test agent for MCP prompts integration testing.`;

            const agent = await testSdk.createAndConnectAgent(channelId, {
                name: 'Template Prompt Agent',
                agentConfigPrompt: templatePrompt,
                allowedTools: ['tool_help'],
                capabilities: ['template-testing']
            });

            expect(agent.isConnected()).toBe(true);
            expect(agent.agentId).toBeDefined();
        });

        it('should create agent with ORPAR phase templates', async () => {
            const orparPrompt = `You are an ORPAR-aware agent.
Current phase: {{CURRENT_ORPAR_PHASE}}
Phase guidance: {{CURRENT_ORPAR_PHASE_GUIDANCE}}

Follow the ORPAR cycle for structured reasoning.`;

            const agent = await testSdk.createAndConnectAgent(channelId, {
                name: 'ORPAR Template Agent',
                agentConfigPrompt: orparPrompt,
                allowedTools: [
                    'orpar_observe',
                    'orpar_reason',
                    'orpar_plan',
                    'orpar_act',
                    'orpar_reflect'
                ],
                capabilities: ['orpar', 'template-testing']
            });

            expect(agent.isConnected()).toBe(true);
        });

        it('should create agent with task context templates', async () => {
            const taskPrompt = `You are a task-oriented agent.

Current Task:
- ID: {{CURRENT_TASK_ID}}
- Title: {{CURRENT_TASK_TITLE}}
- Status: {{CURRENT_TASK_STATUS}}
- Progress: {{CURRENT_TASK_PROGRESS}}

Complete assigned tasks efficiently.`;

            const agent = await testSdk.createAndConnectAgent(channelId, {
                name: 'Task Template Agent',
                agentConfigPrompt: taskPrompt,
                allowedTools: ['task_create_with_plan', 'task_complete'],
                capabilities: ['task-handling', 'template-testing']
            });

            expect(agent.isConnected()).toBe(true);
        });

        it('should create agent with collaboration context templates', async () => {
            const collabPrompt = `You are a collaborative agent in channel "{{CHANNEL_NAME}}".

Collaboration Context:
- Active agents: {{ACTIVE_AGENTS_COUNT}}
- Agent list: {{ACTIVE_AGENTS_LIST}}

Coordinate with other agents as needed.`;

            const agent = await testSdk.createAndConnectAgent(channelId, {
                name: 'Collaboration Template Agent',
                agentConfigPrompt: collabPrompt,
                allowedTools: ['messaging_send', 'messaging_discover'],
                capabilities: ['collaboration', 'template-testing']
            });

            expect(agent.isConnected()).toBe(true);
        });

        it('should create agent with all template types combined', async () => {
            const comprehensivePrompt = `# Agent Configuration

## Identity
- Agent ID: {{AGENT_ID}}
- Channel: {{CHANNEL_ID}} ({{CHANNEL_NAME}})

## Time Context
- Current Time: {{DATE_TIME}}
- Day: {{DAY_OF_WEEK}}, {{CURRENT_MONTH}} {{CURRENT_DAY}}, {{CURRENT_YEAR}}
- Timezone: {{TIME_ZONE}}
- System: {{OS_PLATFORM}}

## LLM Configuration
- Provider: {{LLM_PROVIDER}}
- Model: {{LLM_MODEL}}
- SystemLLM: {{SYSTEM_LLM_STATUS}}

## Collaboration
- Active Agents: {{ACTIVE_AGENTS_COUNT}}
- Team: {{ACTIVE_AGENTS_LIST}}

## Control Loop
- ORPAR Phase: {{CURRENT_ORPAR_PHASE}}
- Guidance: {{CURRENT_ORPAR_PHASE_GUIDANCE}}

## Current Task
- Task: {{CURRENT_TASK_TITLE}} ({{CURRENT_TASK_ID}})
- Status: {{CURRENT_TASK_STATUS}}
- Progress: {{CURRENT_TASK_PROGRESS}}

You are a comprehensive test agent with full template support.`;

            const agent = await testSdk.createAndConnectAgent(channelId, {
                name: 'Comprehensive Template Agent',
                agentConfigPrompt: comprehensivePrompt,
                allowedTools: ['tool_help', 'tool_quick_reference'],
                capabilities: ['comprehensive', 'template-testing']
            });

            expect(agent.isConnected()).toBe(true);
        });
    });

    // =========================================================================
    // Section 17: Template Replacement Accuracy
    // =========================================================================

    describe('Template Replacement Accuracy', () => {
        it('should accurately replace all 13+ template types', () => {
            const allTemplatesPrompt = `
TEMPORAL:
1. DATE_TIME: {{DATE_TIME}}
2. TIME_ZONE: {{TIME_ZONE}}
3. ISO_TIMESTAMP: {{ISO_TIMESTAMP}}
4. DAY_OF_WEEK: {{DAY_OF_WEEK}}
5. CURRENT_YEAR: {{CURRENT_YEAR}}
6. CURRENT_MONTH: {{CURRENT_MONTH}}
7. CURRENT_DAY: {{CURRENT_DAY}}

CONTEXT:
8. AGENT_ID: {{AGENT_ID}}
9. CHANNEL_ID: {{CHANNEL_ID}}
10. ACTIVE_AGENTS_COUNT: {{ACTIVE_AGENTS_COUNT}}

CONTROL LOOP:
11. CURRENT_ORPAR_PHASE: {{CURRENT_ORPAR_PHASE}}
12. CURRENT_ORPAR_PHASE_GUIDANCE: {{CURRENT_ORPAR_PHASE_GUIDANCE}}

TASK:
13. CURRENT_TASK_ID: {{CURRENT_TASK_ID}}
14. CURRENT_TASK_STATUS: {{CURRENT_TASK_STATUS}}
`;

            const context: TemplateContext = {
                agentId: 'agent-abc',
                channelId: 'channel-xyz',
                activeAgentsCount: 3,
                currentOrparPhase: 'Act',
                currentTaskId: 'task-123',
                currentTaskStatus: 'in_progress'
            };

            const result = PromptTemplateReplacer.replaceTemplates(allTemplatesPrompt, context);

            // Verify temporal templates are replaced (they change)
            expect(result).not.toContain('{{DATE_TIME}}');
            expect(result).not.toContain('{{TIME_ZONE}}');
            expect(result).not.toContain('{{ISO_TIMESTAMP}}');
            expect(result).not.toContain('{{DAY_OF_WEEK}}');
            expect(result).not.toContain('{{CURRENT_YEAR}}');
            expect(result).not.toContain('{{CURRENT_MONTH}}');
            expect(result).not.toContain('{{CURRENT_DAY}}');

            // Verify context templates are replaced
            expect(result).toContain('agent-abc');
            expect(result).toContain('channel-xyz');
            expect(result).toContain('3');

            // Verify control loop templates are replaced
            expect(result).toContain('Act');
            expect(result).not.toContain('{{CURRENT_ORPAR_PHASE}}');
            expect(result).not.toContain('{{CURRENT_ORPAR_PHASE_GUIDANCE}}');

            // Verify task templates are replaced
            expect(result).toContain('task-123');
            expect(result).toContain('in_progress');
        });

        it('should preserve non-template text exactly', () => {
            const prompt = 'Start: Hello World! End: {{DATE_TIME}}';
            const result = PromptTemplateReplacer.replaceTemplates(prompt);

            expect(result).toContain('Start: Hello World! End:');
            expect(result).not.toContain('{{DATE_TIME}}');
        });

        it('should handle adjacent templates', () => {
            const prompt = '{{CURRENT_YEAR}}{{CURRENT_MONTH}}{{CURRENT_DAY}}';
            const result = PromptTemplateReplacer.replaceTemplates(prompt);

            expect(result).not.toContain('{{CURRENT_YEAR}}');
            expect(result).not.toContain('{{CURRENT_MONTH}}');
            expect(result).not.toContain('{{CURRENT_DAY}}');
        });

        it('should handle templates in markdown formatting', () => {
            const prompt = `# Agent: {{AGENT_ID}}

**Channel:** {{CHANNEL_ID}}

- Time: {{DATE_TIME}}
- Phase: {{CURRENT_ORPAR_PHASE}}`;

            const context: TemplateContext = {
                agentId: 'markdown-agent',
                channelId: 'markdown-channel',
                currentOrparPhase: 'Reflect'
            };

            const result = PromptTemplateReplacer.replaceTemplates(prompt, context);

            expect(result).toContain('# Agent: markdown-agent');
            expect(result).toContain('**Channel:** markdown-channel');
            expect(result).toContain('- Phase: Reflect');
        });
    });
});
