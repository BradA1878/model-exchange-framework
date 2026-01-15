/**
 * Agent Connection Integration Tests
 *
 * Tests the complete agent connection lifecycle including:
 * - Initial connection
 * - Reconnection after disconnect
 * - Multiple agents in same channel
 * - Connection state tracking
 */

import { TestSDK, createTestSDK } from '../../utils/TestSDK';
import { waitFor, sleep } from '../../utils/waitFor';
import { EventCapture, createEventCapture } from '../../utils/eventHelpers';
import { MINIMAL_AGENT_CONFIG, TIMEOUTS } from '../../utils/TestFixtures';

describe('Agent Connection Lifecycle', () => {
    let testSdk: TestSDK;
    let channelId: string;

    beforeAll(async () => {
        testSdk = createTestSDK();
        await testSdk.connect();
        const result = await testSdk.createTestChannel('agent-conn', {
            disableSystemLlm: true
        });
        channelId = result.channelId;
    });

    afterAll(async () => {
        await testSdk.cleanup();
    });

    describe('Basic Connection', () => {
        it('should connect an agent successfully', async () => {
            const agent = await testSdk.createTestAgent(channelId, {
                ...MINIMAL_AGENT_CONFIG,
                name: 'Connection Test Agent'
            });

            expect(agent.isConnected()).toBe(false);

            await agent.connect();

            expect(agent.isConnected()).toBe(true);
        });

        it('should have valid agentId after connection', async () => {
            const agent = await testSdk.createAndConnectAgent(channelId, {
                ...MINIMAL_AGENT_CONFIG,
                name: 'AgentId Test Agent'
            });

            expect(agent.agentId).toBeDefined();
            expect(typeof agent.agentId).toBe('string');
            expect(agent.agentId.length).toBeGreaterThan(0);
        });

        it('should be idempotent on multiple connect calls', async () => {
            const agent = await testSdk.createTestAgent(channelId, {
                ...MINIMAL_AGENT_CONFIG,
                name: 'Idempotent Connect Agent'
            });

            await agent.connect();
            expect(agent.isConnected()).toBe(true);

            // Second connect should not throw
            await agent.connect();
            expect(agent.isConnected()).toBe(true);
        });
    });

    describe('Disconnection', () => {
        it('should disconnect gracefully', async () => {
            const agent = await testSdk.createAndConnectAgent(channelId, {
                ...MINIMAL_AGENT_CONFIG,
                name: 'Disconnect Test Agent'
            });

            expect(agent.isConnected()).toBe(true);

            await agent.disconnect();

            expect(agent.isConnected()).toBe(false);
        });

        it('should handle disconnect when not connected', async () => {
            const agent = await testSdk.createTestAgent(channelId, {
                ...MINIMAL_AGENT_CONFIG,
                name: 'Not Connected Agent'
            });

            // Should not throw when disconnecting an unconnected agent
            await expect(agent.disconnect()).resolves.not.toThrow();
        });
    });

    describe('Reconnection', () => {
        it('should reconnect after disconnect', async () => {
            const agent = await testSdk.createTestAgent(channelId, {
                ...MINIMAL_AGENT_CONFIG,
                name: 'Reconnection Test Agent'
            });

            // First connection
            await agent.connect();
            expect(agent.isConnected()).toBe(true);

            // Disconnect
            await agent.disconnect();
            expect(agent.isConnected()).toBe(false);

            // Wait a bit before reconnecting
            await sleep(500);

            // Reconnect
            await agent.connect();
            expect(agent.isConnected()).toBe(true);
        });

        it('should maintain identity across reconnection', async () => {
            const agent = await testSdk.createTestAgent(channelId, {
                ...MINIMAL_AGENT_CONFIG,
                name: 'Identity Test Agent'
            });

            await agent.connect();
            const firstAgentId = agent.agentId;

            await agent.disconnect();
            await sleep(500);
            await agent.connect();

            expect(agent.agentId).toBe(firstAgentId);
        });
    });

    describe('Multiple Agents', () => {
        it('should support multiple agents in same channel', async () => {
            const agent1 = await testSdk.createTestAgent(channelId, {
                ...MINIMAL_AGENT_CONFIG,
                name: 'Multi Agent 1'
            });
            const agent2 = await testSdk.createTestAgent(channelId, {
                ...MINIMAL_AGENT_CONFIG,
                name: 'Multi Agent 2'
            });
            const agent3 = await testSdk.createTestAgent(channelId, {
                ...MINIMAL_AGENT_CONFIG,
                name: 'Multi Agent 3'
            });

            // Connect all agents concurrently
            await Promise.all([
                agent1.connect(),
                agent2.connect(),
                agent3.connect()
            ]);

            expect(agent1.isConnected()).toBe(true);
            expect(agent2.isConnected()).toBe(true);
            expect(agent3.isConnected()).toBe(true);

            // Each agent should have a unique ID
            const ids = new Set([agent1.agentId, agent2.agentId, agent3.agentId]);
            expect(ids.size).toBe(3);
        });

        it('should allow agents to disconnect independently', async () => {
            const agent1 = await testSdk.createAndConnectAgent(channelId, {
                ...MINIMAL_AGENT_CONFIG,
                name: 'Independent Agent 1'
            });
            const agent2 = await testSdk.createAndConnectAgent(channelId, {
                ...MINIMAL_AGENT_CONFIG,
                name: 'Independent Agent 2'
            });

            // Disconnect one agent
            await agent1.disconnect();

            // Other agent should still be connected
            expect(agent1.isConnected()).toBe(false);
            expect(agent2.isConnected()).toBe(true);
        });
    });

    describe('Connection Timeout', () => {
        it('should connect within reasonable time', async () => {
            const startTime = Date.now();

            const agent = await testSdk.createTestAgent(channelId, {
                ...MINIMAL_AGENT_CONFIG,
                name: 'Timeout Test Agent'
            });
            await agent.connect();

            const connectionTime = Date.now() - startTime;

            // Connection should complete within 15 seconds
            expect(connectionTime).toBeLessThan(TIMEOUTS.connection);
            expect(agent.isConnected()).toBe(true);
        });
    });
});
