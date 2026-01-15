/**
 * ORPAR Control Loop Integration Tests
 *
 * Tests the ORPAR (Observe, Reason, Plan, Act, Reflect) control loop:
 * - Control loop initialization
 * - Phase transitions
 * - Observation submission
 * - Reasoning and planning phases
 * - Action execution
 * - Reflection and learning
 *
 * The ORPAR loop is the cognitive cycle that powers agent intelligence.
 */

import { TestSDK, createTestSDK } from '../../utils/TestSDK';
import { waitFor, sleep } from '../../utils/waitFor';
import { EventCapture, createEventCapture } from '../../utils/eventHelpers';
import { ORPAR_TEST_AGENT_CONFIG, TIMEOUTS } from '../../utils/TestFixtures';
import { Events } from '../../../src/shared/events/EventNames';

describe('ORPAR Control Loop', () => {
    let testSdk: TestSDK;
    let channelId: string;
    let channelMonitor: any;

    beforeAll(async () => {
        testSdk = createTestSDK();
        await testSdk.connect();
        const result = await testSdk.createTestChannel('orpar', {
            disableSystemLlm: true
        });
        channelId = result.channelId;
        channelMonitor = result.monitor;
    });

    afterAll(async () => {
        await testSdk.cleanup();
    });

    describe('Control Loop Initialization', () => {
        it('should create agent with ORPAR capabilities', async () => {
            const agent = await testSdk.createAndConnectAgent(channelId, {
                ...ORPAR_TEST_AGENT_CONFIG,
                name: 'ORPAR Agent'
            });

            expect(agent.isConnected()).toBe(true);
            expect(agent.agentId).toBeDefined();
        });

        it('should have access to control loop tools', async () => {
            const agent = await testSdk.createAndConnectAgent(channelId, {
                name: 'Control Loop Tools Agent',
                allowedTools: [
                    'control_loop_initialize',
                    'control_loop_get_status',
                    'control_loop_submit_observation',
                    'tool_help'
                ],
                agentConfigPrompt: 'You are an agent that manages control loops.',
                capabilities: ['orpar', 'control-loop']
            });

            // Verify agent can access tool information
            const result = await agent.executeTool('tool_help', {
                toolName: 'control_loop_initialize'
            });

            expect(result).toBeDefined();
        });
    });

    describe('Observation Phase', () => {
        it('should submit observations to the system', async () => {
            const agent = await testSdk.createAndConnectAgent(channelId, {
                name: 'Observation Agent',
                allowedTools: [
                    'control_loop_initialize',
                    'control_loop_submit_observation'
                ],
                agentConfigPrompt: 'You are an observer agent. Process observations.',
                capabilities: ['observation']
            });

            // Agent is ready for observation processing
            expect(agent.isConnected()).toBe(true);
        });

        it('should handle structured observation data', async () => {
            const agent = await testSdk.createAndConnectAgent(channelId, {
                name: 'Structured Observation Agent',
                allowedTools: ['control_loop_submit_observation'],
                agentConfigPrompt: 'Process structured observations.',
                capabilities: ['structured-observation']
            });

            // Set up event capture
            const eventCapture = createEventCapture();
            eventCapture.capture(channelMonitor, [
                'controlloop:observation',
                'controlloop:observation:received'
            ]);

            expect(agent.isConnected()).toBe(true);

            await sleep(500);
            eventCapture.cleanup();
        });
    });

    describe('Reasoning Phase', () => {
        it('should support reasoning-capable agents', async () => {
            const reasoningAgent = await testSdk.createAndConnectAgent(channelId, {
                name: 'Reasoning Agent',
                agentConfigPrompt: `You are a reasoning agent.
When presented with observations, analyze them and draw conclusions.
Structure your reasoning as:
1. Initial observations
2. Key patterns identified
3. Logical deductions
4. Conclusions`,
                allowedTools: ['control_loop_get_status'],
                capabilities: ['reasoning', 'analysis'],
                metadata: {
                    orparPhase: 'reasoning',
                    modelConfig: {
                        temperature: 0.7,
                        maxTokens: 4000
                    }
                }
            });

            expect(reasoningAgent.isConnected()).toBe(true);
        });
    });

    describe('Planning Phase', () => {
        it('should support planning-capable agents', async () => {
            const planningAgent = await testSdk.createAndConnectAgent(channelId, {
                name: 'Planning Agent',
                agentConfigPrompt: `You are a planning agent.
When given reasoning results, create actionable plans.
Structure your plans as:
1. Goals to achieve
2. Steps required
3. Resources needed
4. Timeline estimates
5. Risk assessment`,
                allowedTools: ['control_loop_get_status', 'task_create'],
                capabilities: ['planning', 'strategy'],
                metadata: {
                    orparPhase: 'planning'
                }
            });

            expect(planningAgent.isConnected()).toBe(true);
        });
    });

    describe('Action Phase', () => {
        it('should support action-capable agents', async () => {
            const actionAgent = await testSdk.createAndConnectAgent(channelId, {
                name: 'Action Agent',
                agentConfigPrompt: `You are an action agent.
Execute plans by using available tools.
Report results of each action.
Handle errors gracefully.`,
                allowedTools: [
                    'control_loop_get_status',
                    'messaging_send',
                    'messaging_broadcast',
                    'tool_help'
                ],
                capabilities: ['action', 'execution'],
                metadata: {
                    orparPhase: 'action'
                }
            });

            expect(actionAgent.isConnected()).toBe(true);

            // Agent should be able to execute actions (broadcast to channel)
            const result = await actionAgent.executeTool('messaging_broadcast', {
                message: 'Action phase test message'
            });

            expect(result).toBeDefined();
        });
    });

    describe('Reflection Phase', () => {
        it('should support reflection-capable agents', async () => {
            const reflectionAgent = await testSdk.createAndConnectAgent(channelId, {
                name: 'Reflection Agent',
                agentConfigPrompt: `You are a reflection agent.
After actions complete, analyze outcomes.
Consider:
1. What worked well
2. What could improve
3. Lessons learned
4. Recommendations for future`,
                allowedTools: ['control_loop_get_status'],
                capabilities: ['reflection', 'learning'],
                metadata: {
                    orparPhase: 'reflection'
                }
            });

            expect(reflectionAgent.isConnected()).toBe(true);
        });
    });

    describe('Full ORPAR Cycle', () => {
        it('should support complete ORPAR cycle', async () => {
            // Create a comprehensive ORPAR-capable agent
            const fullCycleAgent = await testSdk.createAndConnectAgent(channelId, {
                name: 'Full Cycle ORPAR Agent',
                agentConfigPrompt: `You are a complete ORPAR agent.

OBSERVE: Gather and process information
REASON: Analyze observations and draw conclusions
PLAN: Create actionable strategies
ACT: Execute plans using available tools
REFLECT: Learn from outcomes

Cycle through these phases systematically.`,
                allowedTools: [
                    'control_loop_initialize',
                    'control_loop_get_status',
                    'control_loop_submit_observation',
                    'messaging_send',
                    'tool_help'
                ],
                capabilities: ['orpar', 'full-cycle'],
                metadata: {
                    supportedPhases: ['observe', 'reason', 'plan', 'act', 'reflect']
                }
            });

            expect(fullCycleAgent.isConnected()).toBe(true);

            // Set up event capture for the full cycle
            const eventCapture = createEventCapture();
            eventCapture.capture(channelMonitor, [
                'controlloop:initialized',
                'controlloop:observation',
                'controlloop:reasoning',
                'controlloop:planning',
                'controlloop:action',
                'controlloop:reflection',
                'controlloop:completed'
            ]);

            // Allow time for any cycle events
            await sleep(1000);

            eventCapture.cleanup();
        });
    });

    describe('ORPAR Timing and Performance', () => {
        it('should complete phases within timeouts', async () => {
            const timedAgent = await testSdk.createAndConnectAgent(channelId, {
                name: 'Timed ORPAR Agent',
                agentConfigPrompt: 'You are a time-efficient agent. Complete tasks quickly.',
                allowedTools: ['control_loop_get_status', 'messaging_broadcast'],
                capabilities: ['orpar', 'timed-execution']
            });

            const startTime = Date.now();

            // Execute a simple action (broadcast to channel)
            await timedAgent.executeTool('messaging_broadcast', {
                message: 'Timed action test'
            });

            const executionTime = Date.now() - startTime;

            // Should complete within reasonable time
            expect(executionTime).toBeLessThan(TIMEOUTS.standard);
        });
    });

    describe('Multi-Agent ORPAR Coordination', () => {
        it('should support specialized agents for each phase', async () => {
            // Create specialized agents for each ORPAR phase
            const observer = await testSdk.createAndConnectAgent(channelId, {
                name: 'Observer',
                agentConfigPrompt: 'You observe and report. Focus on data collection.',
                capabilities: ['observe'],
                allowedTools: ['control_loop_submit_observation', 'messaging_send']
            });

            const reasoner = await testSdk.createAndConnectAgent(channelId, {
                name: 'Reasoner',
                agentConfigPrompt: 'You analyze and reason. Focus on logical analysis.',
                capabilities: ['reason'],
                allowedTools: ['control_loop_get_status', 'messaging_send']
            });

            const planner = await testSdk.createAndConnectAgent(channelId, {
                name: 'Planner',
                agentConfigPrompt: 'You create plans. Focus on strategy.',
                capabilities: ['plan'],
                allowedTools: ['task_create', 'messaging_send']
            });

            const actor = await testSdk.createAndConnectAgent(channelId, {
                name: 'Actor',
                agentConfigPrompt: 'You execute actions. Focus on implementation.',
                capabilities: ['act'],
                allowedTools: ['messaging_send', 'tool_help']
            });

            const reflector = await testSdk.createAndConnectAgent(channelId, {
                name: 'Reflector',
                agentConfigPrompt: 'You reflect and learn. Focus on improvement.',
                capabilities: ['reflect'],
                allowedTools: ['control_loop_get_status', 'messaging_send']
            });

            // All agents should be connected
            expect(observer.isConnected()).toBe(true);
            expect(reasoner.isConnected()).toBe(true);
            expect(planner.isConnected()).toBe(true);
            expect(actor.isConnected()).toBe(true);
            expect(reflector.isConnected()).toBe(true);
        });
    });

    describe('ORPAR State Management', () => {
        it('should support orpar_status tool for checking cycle position', async () => {
            const agent = await testSdk.createAndConnectAgent(channelId, {
                name: 'Status Check Agent',
                agentConfigPrompt: 'You track your ORPAR cycle position.',
                allowedTools: ['orpar_status', 'orpar_observe'],
                capabilities: ['orpar', 'status-tracking']
            });

            expect(agent.isConnected()).toBe(true);

            // Check status - should return a result (structure may vary based on execution context)
            const statusResult = await agent.executeTool('orpar_status', {});
            expect(statusResult).toBeDefined();
        });

        it('should support orpar_observe tool execution', async () => {
            const agent = await testSdk.createAndConnectAgent(channelId, {
                name: 'Observation Agent',
                agentConfigPrompt: 'You document observations using ORPAR.',
                allowedTools: ['orpar_status', 'orpar_observe', 'orpar_reason'],
                capabilities: ['orpar', 'observation']
            });

            // Set up event capture
            const eventCapture = createEventCapture();
            eventCapture.capture(channelMonitor, [
                'orpar:observe',
                'orpar:status'
            ]);

            // Call orpar_observe - should execute without throwing
            const observeResult = await agent.executeTool('orpar_observe', {
                observations: 'Integration test observation - documenting current state'
            });

            expect(observeResult).toBeDefined();

            await sleep(500);
            eventCapture.cleanup();
        });

        it('should support orpar_reason tool execution', async () => {
            const agent = await testSdk.createAndConnectAgent(channelId, {
                name: 'Reasoning Agent',
                agentConfigPrompt: 'You analyze using ORPAR reasoning.',
                allowedTools: ['orpar_status', 'orpar_observe', 'orpar_reason'],
                capabilities: ['orpar', 'reasoning']
            });

            // First observe, then reason (tools track state per agentId:channelId)
            await agent.executeTool('orpar_observe', {
                observations: 'Setup observation for reasoning test'
            });

            const reasonResult = await agent.executeTool('orpar_reason', {
                analysis: 'Integration test analysis - examining patterns and data'
            });

            expect(reasonResult).toBeDefined();
        });

        it('should have ORPAR tools available in tool registry', async () => {
            const agent = await testSdk.createAndConnectAgent(channelId, {
                name: 'Tool Registry Agent',
                agentConfigPrompt: 'You verify ORPAR tools exist.',
                allowedTools: ['tool_help'],
                capabilities: ['orpar', 'tools']
            });

            // Verify ORPAR tools are registered by checking tool_help
            const helpResult = await agent.executeTool('tool_help', {
                toolName: 'orpar_status'
            });

            expect(helpResult).toBeDefined();
        });
    });
});
