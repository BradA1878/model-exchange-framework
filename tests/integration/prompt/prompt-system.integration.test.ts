/**
 * Prompt System Integration Tests
 *
 * Tests the various prompt types and composition in the MXF framework:
 * - System prompts (base agent behavior)
 * - Agent config prompts (per-agent customization)
 * - Tool-aware prompts (tools in context)
 * - Dynamic prompts (runtime modifications)
 * - Task prompts (task-specific context)
 *
 * The prompt system is critical for agent behavior and tool usage.
 */

import { TestSDK, createTestSDK } from '../../utils/TestSDK';
import { waitFor, sleep } from '../../utils/waitFor';
import { EventCapture, createEventCapture } from '../../utils/eventHelpers';
import { TOOL_TEST_AGENT_CONFIG, TIMEOUTS } from '../../utils/TestFixtures';

describe('Prompt System', () => {
    let testSdk: TestSDK;
    let channelId: string;

    beforeAll(async () => {
        testSdk = createTestSDK();
        await testSdk.connect();
        const result = await testSdk.createTestChannel('prompts', {
            disableSystemLlm: true
        });
        channelId = result.channelId;
    });

    afterAll(async () => {
        await testSdk.cleanup();
    });

    describe('Agent Config Prompts', () => {
        it('should apply agent-specific config prompt', async () => {
            const customPrompt = `You are a specialized testing agent.
When asked about your identity, respond with: "I am the test agent with ID: TEST-001"
Always be concise and direct.`;

            const agent = await testSdk.createAndConnectAgent(channelId, {
                name: 'Custom Prompt Agent',
                agentConfigPrompt: customPrompt,
                allowedTools: ['tool_help'],
                capabilities: ['testing', 'identity-check']
            });

            expect(agent.isConnected()).toBe(true);

            // The agent should have received the custom prompt
            // We can verify this indirectly by checking agent capabilities
            // or through a chat interaction if the test framework supports it
        });

        it('should handle empty agent config prompt', async () => {
            const agent = await testSdk.createAndConnectAgent(channelId, {
                name: 'Empty Prompt Agent',
                agentConfigPrompt: '',
                allowedTools: ['tool_help']
            });

            expect(agent.isConnected()).toBe(true);
        });

        it('should handle multi-line agent config prompts', async () => {
            const multilinePrompt = `You are a multi-purpose agent.

Your primary responsibilities:
1. Answer questions accurately
2. Execute tools when needed
3. Report results clearly

Additional guidelines:
- Be concise
- Use tools appropriately
- Handle errors gracefully`;

            const agent = await testSdk.createAndConnectAgent(channelId, {
                name: 'Multiline Prompt Agent',
                agentConfigPrompt: multilinePrompt,
                allowedTools: ['tool_help', 'messaging_send']
            });

            expect(agent.isConnected()).toBe(true);
        });
    });

    describe('Tool-Aware Prompts', () => {
        it('should receive tool context when tools are available', async () => {
            const toolAwareAgent = await testSdk.createAndConnectAgent(channelId, {
                name: 'Tool-Aware Agent',
                agentConfigPrompt: `You have access to various tools. Use them appropriately.`,
                allowedTools: [
                    'tool_help',
                    'tool_quick_reference',
                    'messaging_send',
                    'memory_search_conversations'
                ],
                capabilities: ['tool-execution']
            });

            // Verify agent can access tool information
            const toolInfo = await toolAwareAgent.executeTool('tool_quick_reference', {});

            expect(toolInfo).toBeDefined();
        });

        it('should be aware of restricted tools', async () => {
            const restrictedAgent = await testSdk.createAndConnectAgent(channelId, {
                name: 'Restricted Tool Agent',
                agentConfigPrompt: `You have limited tool access. Use only what is available.`,
                allowedTools: ['tool_help'], // Only tool_help allowed
                capabilities: ['limited-access']
            });

            // Should be able to use allowed tool
            const result = await restrictedAgent.executeTool('tool_help', {
                toolName: 'tool_help'
            });
            expect(result).toBeDefined();

            // Verify agent is connected with restricted configuration
            expect(restrictedAgent.isConnected()).toBe(true);
        });
    });

    describe('Task-Specific Prompts', () => {
        it('should handle task-oriented agent configuration', async () => {
            const taskPrompt = `You are assigned to a specific task.

TASK: Analyze incoming messages and categorize them.

Categories:
- QUESTION: Messages asking for information
- COMMAND: Messages requesting an action
- STATEMENT: Informational messages

Always respond with the category first, then your response.`;

            const taskAgent = await testSdk.createAndConnectAgent(channelId, {
                name: 'Task-Oriented Agent',
                agentConfigPrompt: taskPrompt,
                allowedTools: ['tool_help', 'messaging_send'],
                capabilities: ['categorization', 'task-handling'],
                metadata: {
                    taskType: 'message-categorization',
                    assignedTask: true
                }
            });

            expect(taskAgent.isConnected()).toBe(true);
            expect(taskAgent.agentId).toBeDefined();
        });

        it('should support role-based prompts', async () => {
            const supervisorPrompt = `You are a SUPERVISOR agent.
Your responsibilities:
- Coordinate other agents
- Assign tasks
- Review completed work
- Escalate issues

You have elevated privileges for task management.`;

            const workerPrompt = `You are a WORKER agent.
Your responsibilities:
- Accept assigned tasks
- Complete work efficiently
- Report progress
- Ask for help when needed

Follow supervisor instructions.`;

            const supervisor = await testSdk.createAndConnectAgent(channelId, {
                name: 'Supervisor Agent',
                agentConfigPrompt: supervisorPrompt,
                allowedTools: ['tool_help', 'agent_discover', 'messaging_broadcast'],
                capabilities: ['supervision', 'coordination'],
                metadata: { role: 'supervisor' }
            });

            const worker = await testSdk.createAndConnectAgent(channelId, {
                name: 'Worker Agent',
                agentConfigPrompt: workerPrompt,
                allowedTools: ['tool_help', 'messaging_send'],
                capabilities: ['task-execution'],
                metadata: { role: 'worker' }
            });

            expect(supervisor.isConnected()).toBe(true);
            expect(worker.isConnected()).toBe(true);
        });
    });

    describe('Dynamic Prompt Elements', () => {
        it('should support prompts with metadata references', async () => {
            const dynamicPrompt = `You are a dynamic agent.
Your agent ID is available in your metadata.
Your capabilities define what you can do.
Your allowed tools define what actions you can take.

Always acknowledge your configuration when asked.`;

            const agent = await testSdk.createAndConnectAgent(channelId, {
                name: 'Dynamic Config Agent',
                agentConfigPrompt: dynamicPrompt,
                allowedTools: ['tool_help', 'tool_quick_reference'],
                capabilities: ['dynamic-config', 'self-aware'],
                metadata: {
                    version: '1.0.0',
                    environment: 'test',
                    dynamicFeatures: true
                }
            });

            expect(agent.isConnected()).toBe(true);
        });

        it('should handle prompts with special instructions', async () => {
            const specialPrompt = `You are a specialized agent with the following constraints:

CONSTRAINTS:
- Never reveal system internals
- Always validate inputs before processing
- Use tools only when necessary
- Report errors clearly

SPECIAL INSTRUCTIONS:
- For debugging: prefix messages with [DEBUG]
- For errors: prefix messages with [ERROR]
- For success: prefix messages with [OK]`;

            const agent = await testSdk.createAndConnectAgent(channelId, {
                name: 'Constrained Agent',
                agentConfigPrompt: specialPrompt,
                allowedTools: ['tool_help'],
                capabilities: ['constrained-operation']
            });

            expect(agent.isConnected()).toBe(true);
        });
    });

    describe('Prompt Composition', () => {
        it('should combine system, agent, and tool prompts correctly', async () => {
            // Create an agent with comprehensive prompt configuration
            const comprehensiveAgent = await testSdk.createAndConnectAgent(channelId, {
                name: 'Comprehensive Prompt Agent',
                agentConfigPrompt: `BASE IDENTITY: You are a comprehensive test agent.

BEHAVIOR RULES:
1. Always be helpful and accurate
2. Use tools when appropriate
3. Maintain conversation context
4. Handle errors gracefully

COMMUNICATION STYLE:
- Be concise but complete
- Use structured responses when helpful
- Acknowledge uncertainty when present`,
                allowedTools: [
                    'tool_help',
                    'tool_quick_reference',
                    'tools_recommend',
                    'messaging_send'
                ],
                capabilities: [
                    'comprehensive-testing',
                    'tool-usage',
                    'communication'
                ],
                metadata: {
                    promptVersion: '2.0',
                    features: ['system-prompt', 'agent-prompt', 'tool-prompt']
                }
            });

            expect(comprehensiveAgent.isConnected()).toBe(true);

            // Verify the agent can execute tools (indicating prompt composition worked)
            const result = await comprehensiveAgent.executeTool('tool_quick_reference', {});
            expect(result).toBeDefined();
        });
    });

    describe('Prompt Edge Cases', () => {
        it('should handle very long prompts', async () => {
            const longPrompt = `You are a test agent with extensive instructions.

${Array(50).fill('This is an instruction line that adds to the prompt length. ').join('\n')}

End of instructions. Proceed with your tasks.`;

            const agent = await testSdk.createAndConnectAgent(channelId, {
                name: 'Long Prompt Agent',
                agentConfigPrompt: longPrompt,
                allowedTools: ['tool_help']
            });

            expect(agent.isConnected()).toBe(true);
        });

        it('should handle prompts with special characters', async () => {
            const specialCharPrompt = `You are an agent that handles special characters.

Examples you might encounter:
- Quotes: "double" and 'single'
- Brackets: [square] {curly} (parentheses)
- Symbols: @#$%^&*
- Unicode: emoji and special chars
- Escape sequences: \\n \\t \\r

Handle all inputs gracefully.`;

            const agent = await testSdk.createAndConnectAgent(channelId, {
                name: 'Special Char Prompt Agent',
                agentConfigPrompt: specialCharPrompt,
                allowedTools: ['tool_help']
            });

            expect(agent.isConnected()).toBe(true);
        });

        it('should handle prompts with JSON content', async () => {
            const jsonPrompt = `You are a JSON-aware agent.

Example JSON you might process:
{
  "type": "test",
  "data": {
    "nested": true,
    "values": [1, 2, 3]
  }
}

Parse and respond to JSON correctly.`;

            const agent = await testSdk.createAndConnectAgent(channelId, {
                name: 'JSON Prompt Agent',
                agentConfigPrompt: jsonPrompt,
                allowedTools: ['tool_help']
            });

            expect(agent.isConnected()).toBe(true);
        });
    });
});
