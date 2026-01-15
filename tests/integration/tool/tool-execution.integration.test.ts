/**
 * Tool Execution Integration Tests
 *
 * Tests the MCP tool execution system:
 * - Executing tools successfully
 * - Tool result handling
 * - Tool authorization
 * - Tool validation
 */

import { TestSDK, createTestSDK } from '../../utils/TestSDK';
import { waitFor, sleep } from '../../utils/waitFor';
import { TOOL_TEST_AGENT_CONFIG, MINIMAL_AGENT_CONFIG, TIMEOUTS } from '../../utils/TestFixtures';

describe('Tool Execution', () => {
    let testSdk: TestSDK;
    let channelId: string;

    beforeAll(async () => {
        testSdk = createTestSDK();
        await testSdk.connect();
        const result = await testSdk.createTestChannel('tools', {
            disableSystemLlm: true
        });
        channelId = result.channelId;
    });

    afterAll(async () => {
        await testSdk.cleanup();
    });

    describe('Built-in Tools', () => {
        it('should execute tool_help successfully', async () => {
            const agent = await testSdk.createAndConnectAgent(channelId, {
                ...TOOL_TEST_AGENT_CONFIG,
                name: 'Tool Help Agent'
            });

            const result = await agent.executeTool('tool_help', {
                toolName: 'messaging_send'
            });

            expect(result).toBeDefined();
        });

        it('should execute tool_quick_reference', async () => {
            const agent = await testSdk.createAndConnectAgent(channelId, {
                ...TOOL_TEST_AGENT_CONFIG,
                name: 'Quick Reference Agent'
            });

            const result = await agent.executeTool('tool_quick_reference', {});

            expect(result).toBeDefined();
        });

        it('should execute tools_recommend', async () => {
            const agent = await testSdk.createAndConnectAgent(channelId, {
                ...TOOL_TEST_AGENT_CONFIG,
                name: 'Recommend Agent'
            });

            const result = await agent.executeTool('tools_recommend', {
                intent: 'send a message to another agent'
            });

            expect(result).toBeDefined();
        });
    });

    describe('Tool Authorization', () => {
        it('should allow execution of authorized tools', async () => {
            const agent = await testSdk.createAndConnectAgent(channelId, {
                name: 'Authorized Agent',
                allowedTools: ['tool_help', 'messaging_send'],
                agentConfigPrompt: 'Test agent with limited tools'
            });

            // This should work - tool_help is in allowedTools
            const result = await agent.executeTool('tool_help', {
                toolName: 'messaging_send'
            });

            expect(result).toBeDefined();
        });

        it('should allow all tools when allowedTools is empty array', async () => {
            const agent = await testSdk.createAndConnectAgent(channelId, {
                name: 'Unrestricted Agent',
                allowedTools: [], // Empty array = allow all tools
                agentConfigPrompt: 'Test agent with all tools allowed'
            });

            // Empty allowedTools means all tools are available
            const result = await agent.executeTool('tool_help', {
                toolName: 'messaging_send'
            });

            expect(result).toBeDefined();
        });
    });

    describe('Tool Validation', () => {
        it('should validate required parameters', async () => {
            const agent = await testSdk.createAndConnectAgent(channelId, {
                ...TOOL_TEST_AGENT_CONFIG,
                name: 'Validation Test Agent'
            });

            // Missing required toolName parameter
            await expect(
                agent.executeTool('tool_help', {})
            ).rejects.toThrow();
        });

        it('should execute tool_validate for pre-execution checking', async () => {
            const agent = await testSdk.createAndConnectAgent(channelId, {
                ...TOOL_TEST_AGENT_CONFIG,
                name: 'Pre-validate Agent',
                allowedTools: ['tool_validate', 'tool_help', 'messaging_send']
            });

            // Pre-validate a tool call using XML format
            const toolCallContent = `<tool>messaging_send</tool><parameters>${JSON.stringify({
                channelId,
                message: 'Test message'
            })}</parameters>`;

            const result = await agent.executeTool('tool_validate', {
                content: toolCallContent
            });

            expect(result).toBeDefined();
        });
    });

    describe('Tool Results', () => {
        it('should return structured results', async () => {
            const agent = await testSdk.createAndConnectAgent(channelId, {
                ...TOOL_TEST_AGENT_CONFIG,
                name: 'Structured Result Agent'
            });

            const result = await agent.executeTool('tool_help', {
                toolName: 'messaging_send'
            });

            // Result should contain tool information
            expect(result).toBeDefined();

            // Check if result is string or object
            if (typeof result === 'string') {
                expect(result.length).toBeGreaterThan(0);
            } else {
                expect(result).not.toBeNull();
            }
        });

        it('should handle tool execution within timeout', async () => {
            const agent = await testSdk.createAndConnectAgent(channelId, {
                ...TOOL_TEST_AGENT_CONFIG,
                name: 'Timeout Agent'
            });

            const startTime = Date.now();
            await agent.executeTool('tool_help', {
                toolName: 'messaging_send'
            });
            const executionTime = Date.now() - startTime;

            // Should complete within standard timeout
            expect(executionTime).toBeLessThan(TIMEOUTS.standard);
        });
    });

    describe('Tool Discovery', () => {
        it('should list available tools via tool_quick_reference', async () => {
            const agent = await testSdk.createAndConnectAgent(channelId, {
                ...TOOL_TEST_AGENT_CONFIG,
                name: 'Discovery Agent'
            });

            const result = await agent.executeTool('tool_quick_reference', {
                category: 'communication'
            });

            expect(result).toBeDefined();
        });

        it('should get recommendations based on task description', async () => {
            const agent = await testSdk.createAndConnectAgent(channelId, {
                ...TOOL_TEST_AGENT_CONFIG,
                name: 'Task Recommendation Agent'
            });

            const result = await agent.executeTool('tools_recommend', {
                intent: 'I need to search through past conversations'
            });

            expect(result).toBeDefined();
        });
    });
});
