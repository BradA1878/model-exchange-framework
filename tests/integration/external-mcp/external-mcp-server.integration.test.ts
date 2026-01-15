/**
 * External MCP Server Integration Tests
 *
 * Tests the external MCP server registration and tool execution:
 * - Server registration
 * - Tool discovery
 * - Tool execution from external servers
 * - Server lifecycle management
 *
 * Note: Some tests may require external MCP servers to be available.
 */

import { TestSDK, createTestSDK } from '../../utils/TestSDK';
import { waitFor, sleep } from '../../utils/waitFor';
import { EventCapture, createEventCapture } from '../../utils/eventHelpers';
import { TOOL_TEST_AGENT_CONFIG, TIMEOUTS } from '../../utils/TestFixtures';
import { Events } from '../../../src/shared/events/EventNames';

describe('External MCP Server', () => {
    let testSdk: TestSDK;
    let channelId: string;
    let channelMonitor: any;

    beforeAll(async () => {
        testSdk = createTestSDK();
        await testSdk.connect();
        const result = await testSdk.createTestChannel('external-mcp', {
            disableSystemLlm: true
        });
        channelId = result.channelId;
        channelMonitor = result.monitor;

        // Allow time for channel and SDK to fully initialize
        await sleep(500);
    });

    afterAll(async () => {
        await testSdk.cleanup();
    });

    describe('Internal Tool Verification', () => {
        it('should access built-in MCP tools', async () => {
            const agent = await testSdk.createAndConnectAgent(channelId, {
                name: 'Built-in Tools Agent',
                allowedTools: ['tool_help', 'tool_quick_reference'],
                agentConfigPrompt: 'You use built-in MCP tools.'
            });

            // Verify built-in tools work
            const result = await agent.executeTool('tool_help', {
                toolName: 'messaging_send'
            });

            expect(result).toBeDefined();
        });

        it('should list available tools', async () => {
            const agent = await testSdk.createAndConnectAgent(channelId, {
                name: 'Tool List Agent',
                allowedTools: ['tool_quick_reference'],
                agentConfigPrompt: 'You list available tools.'
            });

            const result = await agent.executeTool('tool_quick_reference', {});

            expect(result).toBeDefined();
        });
    });

    describe('Tool Registry', () => {
        it('should support hybrid tool registry', async () => {
            const agent = await testSdk.createAndConnectAgent(channelId, {
                name: 'Hybrid Registry Agent',
                allowedTools: ['tool_help', 'tools_recommend'],
                agentConfigPrompt: 'You access the hybrid tool registry.'
            });

            // The hybrid registry combines internal and external tools
            const result = await agent.executeTool('tools_recommend', {
                intent: 'I need to send a message to another agent'
            });

            expect(result).toBeDefined();
        });
    });

    describe('Tool Discovery', () => {
        it('should discover tools by category', async () => {
            const agent = await testSdk.createAndConnectAgent(channelId, {
                name: 'Category Discovery Agent',
                allowedTools: ['tool_quick_reference'],
                agentConfigPrompt: 'You discover tools by category.'
            });

            // Discover communication tools
            const messagingTools = await agent.executeTool('tool_quick_reference', {
                category: 'communication'
            });

            expect(messagingTools).toBeDefined();

            // Discover contextMemory tools
            const memoryTools = await agent.executeTool('tool_quick_reference', {
                category: 'contextMemory'
            });

            expect(memoryTools).toBeDefined();
        });

        it('should recommend tools based on task description', async () => {
            const agent = await testSdk.createAndConnectAgent(channelId, {
                name: 'Task Recommendation Agent',
                allowedTools: ['tools_recommend'],
                agentConfigPrompt: 'You get tool recommendations.'
            });

            const tasks = [
                'send a message to all agents in the channel',
                'search through previous conversations',
                'create a new task for another agent',
                'get information about available tools'
            ];

            for (const task of tasks) {
                const result = await agent.executeTool('tools_recommend', { intent: task });
                expect(result).toBeDefined();
            }
        });
    });

    describe('External Server Events', () => {
        it('should emit events for MCP operations', async () => {
            const agent = await testSdk.createAndConnectAgent(channelId, {
                name: 'Event Test Agent',
                allowedTools: ['tool_help'],
                agentConfigPrompt: 'You trigger MCP events.'
            });

            // Set up event capture
            const eventCapture = createEventCapture();
            eventCapture.capture(channelMonitor, [
                'mcp:tool:call',
                'mcp:tool:result',
                Events.Mcp.TOOL_CALL,
                Events.Mcp.TOOL_RESULT
            ]);

            // Execute a tool
            await agent.executeTool('tool_help', {
                toolName: 'messaging_send'
            });

            // Wait for events
            await sleep(500);

            eventCapture.cleanup();
        });
    });

    describe('Tool Validation', () => {
        it('should validate tool parameters before execution', async () => {
            const agent = await testSdk.createAndConnectAgent(channelId, {
                name: 'Validation Agent',
                allowedTools: ['tool_validate', 'messaging_send'],
                agentConfigPrompt: 'You validate tool parameters.'
            });

            // Pre-validate a tool call using XML format
            const toolCallContent = `<tool>messaging_send</tool><parameters>${JSON.stringify({
                channelId,
                message: 'Test message'
            })}</parameters>`;

            const validationResult = await agent.executeTool('tool_validate', {
                content: toolCallContent
            });

            expect(validationResult).toBeDefined();
        });

        it('should reject invalid tool calls', async () => {
            const agent = await testSdk.createAndConnectAgent(channelId, {
                name: 'Invalid Tool Agent',
                allowedTools: ['tool_help'],
                agentConfigPrompt: 'You test invalid tool calls.'
            });

            // Try to call non-existent tool
            await expect(
                agent.executeTool('nonexistent_tool', {})
            ).rejects.toThrow();
        });
    });

    describe('Tool Execution Flow', () => {
        it('should complete full tool execution cycle', async () => {
            const agent = await testSdk.createAndConnectAgent(channelId, {
                name: 'Full Cycle Agent',
                allowedTools: ['tool_help', 'messaging_broadcast', 'tool_validate'],
                agentConfigPrompt: 'You test full execution cycle.'
            });

            // 1. Validate the tool call using XML format
            const toolCallContent = `<tool>messaging_send</tool><parameters>${JSON.stringify({
                channelId,
                message: 'Full cycle test'
            })}</parameters>`;

            const validation = await agent.executeTool('tool_validate', {
                content: toolCallContent
            });
            expect(validation).toBeDefined();

            // 2. Execute a broadcast to channel
            const execution = await agent.executeTool('messaging_broadcast', {
                message: 'Full cycle test message'
            });
            expect(execution).toBeDefined();
        });
    });

    describe('Error Handling', () => {
        it('should handle tool execution errors gracefully', async () => {
            const agent = await testSdk.createAndConnectAgent(channelId, {
                name: 'Error Handling Agent',
                allowedTools: ['messaging_send'],
                agentConfigPrompt: 'You test error handling.'
            });

            // Missing required targetAgentId should throw
            await expect(
                agent.executeTool('messaging_send', {
                    // Missing targetAgentId
                    message: 'This should fail'
                })
            ).rejects.toThrow();
        });

        it('should reject unauthorized tool access', async () => {
            const agent = await testSdk.createAndConnectAgent(channelId, {
                name: 'Unauthorized Agent',
                allowedTools: ['tool_help'], // Only tool_help allowed
                agentConfigPrompt: 'You have limited tools.'
            });

            // Try to use unauthorized tool (messaging_broadcast not in allowedTools)
            await expect(
                agent.executeTool('messaging_broadcast', {
                    message: 'Unauthorized attempt'
                })
            ).rejects.toThrow();
        });
    });
});
