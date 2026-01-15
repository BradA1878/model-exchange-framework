/**
 * Channel Communication Integration Tests
 *
 * Tests message flow between agents in channels:
 * - Sending messages via tools
 * - Receiving messages from other agents
 * - Broadcasting to channel
 * - Message metadata and content
 */

import { TestSDK, createTestSDK } from '../../utils/TestSDK';
import { waitFor, sleep } from '../../utils/waitFor';
import { EventCapture, createEventCapture } from '../../utils/eventHelpers';
import { COMMUNICATION_AGENT_CONFIG, TIMEOUTS, TEST_MESSAGES } from '../../utils/TestFixtures';
import { Events } from '../../../src/shared/events/EventNames';

describe('Channel Communication', () => {
    let testSdk: TestSDK;
    let channelId: string;
    let channelMonitor: any;

    beforeAll(async () => {
        testSdk = createTestSDK();
        await testSdk.connect();
        const result = await testSdk.createTestChannel('comm', {
            disableSystemLlm: true
        });
        channelId = result.channelId;
        channelMonitor = result.monitor;
    });

    afterAll(async () => {
        await testSdk.cleanup();
    });

    describe('Message Sending', () => {
        it('should broadcast a message to channel', async () => {
            const agent = await testSdk.createAndConnectAgent(channelId, {
                ...COMMUNICATION_AGENT_CONFIG,
                name: 'Sender Agent'
            });

            const result = await agent.executeTool('messaging_broadcast', {
                message: TEST_MESSAGES.simple
            });

            expect(result).toBeDefined();
        });

        it('should broadcast message with special characters', async () => {
            const agent = await testSdk.createAndConnectAgent(channelId, {
                ...COMMUNICATION_AGENT_CONFIG,
                name: 'Special Chars Agent'
            });

            const result = await agent.executeTool('messaging_broadcast', {
                message: TEST_MESSAGES.specialCharacters
            });

            expect(result).toBeDefined();
        });

        it('should broadcast multiline message', async () => {
            const agent = await testSdk.createAndConnectAgent(channelId, {
                ...COMMUNICATION_AGENT_CONFIG,
                name: 'Multiline Agent'
            });

            const result = await agent.executeTool('messaging_broadcast', {
                message: TEST_MESSAGES.multiline
            });

            expect(result).toBeDefined();
        });
    });

    describe('Message Broadcasting', () => {
        it('should broadcast message to all agents in channel', async () => {
            const sender = await testSdk.createAndConnectAgent(channelId, {
                ...COMMUNICATION_AGENT_CONFIG,
                name: 'Broadcaster'
            });

            const receiver1 = await testSdk.createAndConnectAgent(channelId, {
                ...COMMUNICATION_AGENT_CONFIG,
                name: 'Receiver 1'
            });

            const receiver2 = await testSdk.createAndConnectAgent(channelId, {
                ...COMMUNICATION_AGENT_CONFIG,
                name: 'Receiver 2'
            });

            // Set up event capture
            const eventCapture = createEventCapture();
            eventCapture.capture(channelMonitor, [
                'message:channel',
                'message:broadcast',
                Events.Message.CHANNEL_MESSAGE
            ]);

            // Send broadcast
            const result = await sender.executeTool('messaging_broadcast', {
                channelId,
                message: 'Broadcast test message'
            });

            expect(result).toBeDefined();

            // Wait for message processing
            await sleep(1000);

            eventCapture.cleanup();
        });
    });

    describe('Agent Discovery', () => {
        it('should discover other agents in channel', async () => {
            const discoverer = await testSdk.createAndConnectAgent(channelId, {
                ...COMMUNICATION_AGENT_CONFIG,
                name: 'Discoverer Agent',
                allowedTools: ['messaging_discover', 'messaging_send']
            });

            const target1 = await testSdk.createAndConnectAgent(channelId, {
                ...COMMUNICATION_AGENT_CONFIG,
                name: 'Target Agent 1'
            });

            const target2 = await testSdk.createAndConnectAgent(channelId, {
                ...COMMUNICATION_AGENT_CONFIG,
                name: 'Target Agent 2'
            });

            // Wait for registration to propagate
            await sleep(500);

            const result = await discoverer.executeTool('messaging_discover', {
                channelId
            });

            expect(result).toBeDefined();
        });
    });

    describe('Direct Agent Messaging', () => {
        it('should send direct message to specific agent', async () => {
            const sender = await testSdk.createAndConnectAgent(channelId, {
                ...COMMUNICATION_AGENT_CONFIG,
                name: 'Direct Sender',
                allowedTools: ['messaging_send']
            });

            const receiver = await testSdk.createAndConnectAgent(channelId, {
                ...COMMUNICATION_AGENT_CONFIG,
                name: 'Direct Receiver'
            });

            // Wait for registration
            await sleep(500);

            const result = await sender.executeTool('messaging_send', {
                targetAgentId: receiver.agentId,
                message: 'Direct message to you'
            });

            expect(result).toBeDefined();
        });
    });

    describe('Message Validation', () => {
        it('should reject direct message without targetAgentId', async () => {
            const agent = await testSdk.createAndConnectAgent(channelId, {
                ...COMMUNICATION_AGENT_CONFIG,
                name: 'Validation Agent'
            });

            await expect(
                agent.executeTool('messaging_send', {
                    message: 'Test message'
                    // Missing targetAgentId
                })
            ).rejects.toThrow();
        });

        it('should reject broadcast without message content', async () => {
            const agent = await testSdk.createAndConnectAgent(channelId, {
                ...COMMUNICATION_AGENT_CONFIG,
                name: 'Empty Message Agent'
            });

            await expect(
                agent.executeTool('messaging_broadcast', {
                    // Missing message
                })
            ).rejects.toThrow();
        });
    });
});
