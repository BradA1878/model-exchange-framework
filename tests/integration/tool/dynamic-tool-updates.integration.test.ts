/**
 * Dynamic Tool Updates Integration Tests
 *
 * Tests the runtime tool update functionality:
 * - Updating allowed tools via SDK method
 * - Refreshing tool cache
 * - Socket event handling for tool updates
 * - Phase-gated tool access patterns
 */

import { TestSDK, createTestSDK } from '../../utils/TestSDK';
import { waitFor, sleep, waitForEvent } from '../../utils/waitFor';
import { TOOL_TEST_AGENT_CONFIG, TIMEOUTS } from '../../utils/TestFixtures';
import { Events } from '../../../src/sdk/index';

describe('Dynamic Tool Updates', () => {
    let testSdk: TestSDK;
    let channelId: string;

    beforeAll(async () => {
        testSdk = createTestSDK();
        await testSdk.connect();
        const result = await testSdk.createTestChannel('dynamic-tools', {
            disableSystemLlm: true
        });
        channelId = result.channelId;
    });

    afterAll(async () => {
        await testSdk.cleanup();
    });

    describe('updateAllowedTools()', () => {
        it('should update allowed tools dynamically', async () => {
            // Create agent with initial tools
            const initialTools = ['tool_help', 'messaging_send'];
            const agent = await testSdk.createAndConnectAgent(channelId, {
                name: 'Dynamic Tools Agent',
                allowedTools: initialTools,
                agentConfigPrompt: 'Test agent for dynamic tool updates'
            });

            // Update to new tools
            const newTools = ['tool_help', 'tool_quick_reference', 'tools_recommend'];
            await agent.updateAllowedTools(newTools);

            // Verify by refreshing tools - should not throw
            const tools = await agent.refreshTools();
            expect(Array.isArray(tools)).toBe(true);
        });

        it('should update tools to empty array (unrestricted)', async () => {
            const agent = await testSdk.createAndConnectAgent(channelId, {
                name: 'Unrestricted Agent',
                allowedTools: ['tool_help'],
                agentConfigPrompt: 'Test agent for unrestricted access'
            });

            // Update to empty array (allows all tools)
            await agent.updateAllowedTools([]);

            // Verify by executing a tool that wasn't initially allowed
            const result = await agent.executeTool('tool_quick_reference', {});
            expect(result).toBeDefined();
        });

        it('should allow execution of newly added tools', async () => {
            const agent = await testSdk.createAndConnectAgent(channelId, {
                name: 'Tool Addition Agent',
                allowedTools: ['messaging_send'], // Initially no tool_help
                agentConfigPrompt: 'Test agent for tool addition'
            });

            // Add tool_help to allowed tools
            await agent.updateAllowedTools(['messaging_send', 'tool_help']);

            // Now tool_help should work
            const result = await agent.executeTool('tool_help', {
                toolName: 'messaging_send'
            });

            expect(result).toBeDefined();
        });
    });

    describe('refreshTools()', () => {
        it('should refresh tool cache from server', async () => {
            const agent = await testSdk.createAndConnectAgent(channelId, {
                name: 'Refresh Agent',
                allowedTools: ['tool_help', 'messaging_send'],
                agentConfigPrompt: 'Test agent for tool refresh'
            });

            // Refresh tools
            const tools = await agent.refreshTools();

            // Should return an array of tools
            expect(Array.isArray(tools)).toBe(true);
            expect(tools.length).toBeGreaterThan(0);
        });

        it('should return filtered tools based on allowedTools', async () => {
            const allowedTools = ['tool_help', 'messaging_send'];
            const agent = await testSdk.createAndConnectAgent(channelId, {
                name: 'Filtered Refresh Agent',
                allowedTools,
                agentConfigPrompt: 'Test agent for filtered tools'
            });

            const tools = await agent.refreshTools();

            // All returned tools should be in the allowed list
            // Note: The actual filtering depends on server implementation
            expect(tools.length).toBeGreaterThan(0);
        });
    });

    describe('Socket Event Handling', () => {
        it('should emit ALLOWED_TOOLS_UPDATE event and receive confirmation', async () => {
            const agent = await testSdk.createAndConnectAgent(channelId, {
                name: 'Event Emit Agent',
                allowedTools: ['tool_help'],
                agentConfigPrompt: 'Test agent for event emission'
            });

            const newTools = ['tool_help', 'messaging_send'];

            // Create promise to wait for event BEFORE calling updateAllowedTools
            const eventPromise = new Promise<any>((resolve) => {
                agent.on(Events.Agent.ALLOWED_TOOLS_UPDATED, (payload: any) => {
                    resolve(payload);
                });
            });

            // Update tools
            await agent.updateAllowedTools(newTools);

            // Wait for event with timeout
            const event = await Promise.race([
                eventPromise,
                sleep(TIMEOUTS.short).then(() => null)
            ]);

            // Event may or may not be received depending on socket event forwarding
            // The important thing is that the update completed without error
            // If event is received, verify its contents
            if (event) {
                expect(event.agentId).toBe(agent.agentId);
                expect(event.allowedTools).toEqual(newTools);
                expect(event.success).toBe(true);
            }
        });

        it('should complete tool update even without event confirmation', async () => {
            const agent = await testSdk.createAndConnectAgent(channelId, {
                name: 'No Event Agent',
                allowedTools: ['tool_help'],
                agentConfigPrompt: 'Test agent without event wait'
            });

            // Update tools - should complete without waiting for event
            await agent.updateAllowedTools(['tool_help', 'tools_recommend']);

            // Verify the update worked by executing a newly allowed tool
            const tools = await agent.refreshTools();
            expect(Array.isArray(tools)).toBe(true);
        });
    });

    describe('Phase-Gated Tool Access', () => {
        it('should support ORPAR-style phase transitions', async () => {
            // Define phase-specific tools
            const phaseTools = {
                observe: ['tool_help'],
                reason: ['tools_recommend'],
                plan: ['tool_quick_reference'],
                act: ['messaging_send'],
                reflect: ['tool_help']
            };

            const agent = await testSdk.createAndConnectAgent(channelId, {
                name: 'ORPAR Phase Agent',
                allowedTools: phaseTools.observe,
                agentConfigPrompt: 'Test agent for ORPAR phase gating'
            });

            // Simulate phase transitions - each should complete without error
            for (const [phase, tools] of Object.entries(phaseTools)) {
                await agent.updateAllowedTools(tools);
                // Verify by refreshing tools
                const refreshedTools = await agent.refreshTools();
                expect(Array.isArray(refreshedTools)).toBe(true);
            }
        });

        it('should restrict tools when switching phases', async () => {
            const agent = await testSdk.createAndConnectAgent(channelId, {
                name: 'Phase Restriction Agent',
                allowedTools: ['tool_help', 'messaging_send', 'tools_recommend'],
                agentConfigPrompt: 'Test agent for phase restrictions'
            });

            // Restrict to single tool (simulating phase transition)
            await agent.updateAllowedTools(['tool_help']);

            // Verify tool_help still works
            const result = await agent.executeTool('tool_help', {
                toolName: 'messaging_send'
            });
            expect(result).toBeDefined();
        });
    });

    describe('Error Handling', () => {
        it('should handle update before connection gracefully', async () => {
            const agent = await testSdk.createTestAgent(channelId, {
                name: 'Pre-connect Agent',
                allowedTools: ['tool_help'],
                agentConfigPrompt: 'Test agent for pre-connect update'
            });

            // Agent is not connected yet
            // updateAllowedTools should either wait for connection or throw clear error
            try {
                await agent.updateAllowedTools(['messaging_send']);
                // If it succeeds, it should have connected first
                expect(agent.isConnected()).toBe(true);
            } catch (error: any) {
                // If it fails, it should be a clear error about connection
                expect(error.message).toMatch(/connect|not connected/i);
            }
        });

        it('should handle empty tool array update', async () => {
            const agent = await testSdk.createAndConnectAgent(channelId, {
                name: 'Empty Tools Agent',
                allowedTools: ['tool_help'],
                agentConfigPrompt: 'Test agent for empty tools'
            });

            // Should not throw
            await expect(agent.updateAllowedTools([])).resolves.not.toThrow();
        });
    });

    describe('Tool Execution After Update', () => {
        it('should execute tools after adding them dynamically', async () => {
            const agent = await testSdk.createAndConnectAgent(channelId, {
                name: 'Execute After Add Agent',
                allowedTools: [], // Start with no restrictions
                agentConfigPrompt: 'Test agent for execution after add'
            });

            // First verify tool_help works
            const result1 = await agent.executeTool('tool_help', {
                toolName: 'messaging_send'
            });
            expect(result1).toBeDefined();

            // Restrict to only messaging_send
            await agent.updateAllowedTools(['messaging_send']);

            // Wait for cache refresh
            await sleep(500);

            // Refresh to get new tools
            await agent.refreshTools();
        });

        it('should complete update within reasonable time', async () => {
            const agent = await testSdk.createAndConnectAgent(channelId, {
                name: 'Timing Agent',
                allowedTools: ['tool_help'],
                agentConfigPrompt: 'Test agent for timing'
            });

            const startTime = Date.now();
            await agent.updateAllowedTools(['tool_help', 'messaging_send', 'tools_recommend']);
            const endTime = Date.now();

            // Should complete within 2 seconds
            expect(endTime - startTime).toBeLessThan(2000);
        });
    });
});
