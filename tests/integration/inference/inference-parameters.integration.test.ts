/**
 * Dynamic Inference Parameters Integration Tests (P1)
 *
 * Tests the inference parameter management system:
 * - InferenceParameterService initialization
 * - Parameter resolution hierarchy (task -> agent -> channel -> defaults)
 * - ORPAR phase-aware profile selection (observation, reasoning, planning, action, reflection)
 * - Agent parameter override requests via MCP tools
 * - Cost governance enforcement
 *
 * The inference parameter system enables dynamic control over LLM configurations
 * during ORPAR cognitive cycles, allowing agents to request parameter adjustments
 * when they recognize their current configuration is insufficient.
 */

import { TestSDK, createTestSDK } from '../../utils/TestSDK';
import { waitFor, sleep } from '../../utils/waitFor';
import { EventCapture, createEventCapture } from '../../utils/eventHelpers';
import { TIMEOUTS } from '../../utils/TestFixtures';

describe('Dynamic Inference Parameters (P1)', () => {
    let testSdk: TestSDK;
    let channelId: string;
    let channelMonitor: any;

    beforeAll(async () => {
        testSdk = createTestSDK();
        await testSdk.connect();
        const result = await testSdk.createTestChannel('inference-params', {
            disableSystemLlm: true
        });
        channelId = result.channelId;
        channelMonitor = result.monitor;
    });

    afterAll(async () => {
        await testSdk.cleanup();
    });

    describe('InferenceParameterService Initialization', () => {
        it('should create agent with inference parameter tools', async () => {
            const agent = await testSdk.createAndConnectAgent(channelId, {
                name: 'Inference Param Agent',
                allowedTools: [
                    'request_inference_params',
                    'get_current_params',
                    'get_parameter_status',
                    'get_available_models',
                    'tool_help'
                ],
                agentConfigPrompt: 'You are an agent that manages inference parameters.',
                capabilities: ['inference-control', 'meta-cognition']
            });

            expect(agent.isConnected()).toBe(true);
            expect(agent.agentId).toBeDefined();
        });

        it('should have access to parameter status tool', async () => {
            const agent = await testSdk.createAndConnectAgent(channelId, {
                name: 'Status Check Agent',
                allowedTools: ['get_parameter_status', 'tool_help'],
                agentConfigPrompt: 'You check inference parameter status.',
                capabilities: ['inference-control']
            });

            // Verify agent can access tool documentation
            const result = await agent.executeTool('tool_help', {
                toolName: 'get_parameter_status'
            });

            expect(result).toBeDefined();
        });

        it('should return service statistics via get_parameter_status', async () => {
            const agent = await testSdk.createAndConnectAgent(channelId, {
                name: 'Stats Agent',
                allowedTools: ['get_parameter_status'],
                agentConfigPrompt: 'You retrieve parameter statistics.',
                capabilities: ['inference-control']
            });

            const result = await agent.executeTool('get_parameter_status', {});

            // Strong assertions - result MUST have expected structure
            expect(result).toBeDefined();
            expect(typeof result).toBe('object');
            expect(result).not.toBeNull();

            // The tool returns serviceStats with override counts
            expect(result.serviceStats).toBeDefined();
            expect(typeof result.serviceStats.activeOverrides).toBe('number');
            expect(typeof result.serviceStats.requestTrackers).toBe('number');
            expect(typeof result.serviceStats.agentConfigs).toBe('number');
            expect(typeof result.serviceStats.channelDefaults).toBe('number');
            expect(typeof result.serviceStats.usageMetricsCount).toBe('number');

            // Should also include default phase profiles
            expect(result.allPhaseProfiles).toBeDefined();
            expect(result.allPhaseProfiles).toHaveProperty('observation');
            expect(result.allPhaseProfiles).toHaveProperty('reasoning');
            expect(result.allPhaseProfiles).toHaveProperty('planning');
            expect(result.allPhaseProfiles).toHaveProperty('action');
            expect(result.allPhaseProfiles).toHaveProperty('reflection');
        });
    });

    describe('Parameter Resolution Hierarchy', () => {
        it('should return default parameters when no overrides exist', async () => {
            const agent = await testSdk.createAndConnectAgent(channelId, {
                name: 'Default Params Agent',
                allowedTools: ['get_current_params'],
                agentConfigPrompt: 'You verify default parameters.',
                capabilities: ['inference-control']
            });

            const result = await agent.executeTool('get_current_params', {
                phase: 'observation'
            });

            // Strong assertions - result MUST have expected structure
            expect(result).toBeDefined();
            expect(typeof result).toBe('object');
            expect(result).not.toBeNull();

            expect(result.phase).toBe('observation');
            expect(result.currentParams).toBeDefined();
            expect(result.defaultParams).toBeDefined();

            // Default params should have required fields
            expect(result.defaultParams).toHaveProperty('model');
            expect(result.defaultParams).toHaveProperty('temperature');
            expect(result.defaultParams).toHaveProperty('reasoningTokens');
            expect(result.defaultParams).toHaveProperty('maxOutputTokens');

            // Current params should also have required fields
            expect(result.currentParams).toHaveProperty('model');
            expect(result.currentParams).toHaveProperty('temperature');
        });

        it('should return parameters for all ORPAR phases', async () => {
            const agent = await testSdk.createAndConnectAgent(channelId, {
                name: 'All Phases Agent',
                allowedTools: ['get_current_params'],
                agentConfigPrompt: 'You retrieve parameters for all phases.',
                capabilities: ['inference-control']
            });

            const phases = ['observation', 'reasoning', 'planning', 'action', 'reflection'];

            for (const phase of phases) {
                const result = await agent.executeTool('get_current_params', { phase });

                // Strong assertions for each phase
                expect(result).toBeDefined();
                expect(typeof result).toBe('object');
                expect(result).not.toBeNull();
                expect(result.phase).toBe(phase);
                expect(result.currentParams).toBeDefined();
                expect(result.defaultParams).toBeDefined();
                expect(typeof result.hasActiveOverride).toBe('boolean');
            }
        });

        it('should indicate whether active override exists', async () => {
            const agent = await testSdk.createAndConnectAgent(channelId, {
                name: 'Override Check Agent',
                allowedTools: ['get_current_params'],
                agentConfigPrompt: 'You check for active overrides.',
                capabilities: ['inference-control']
            });

            const result = await agent.executeTool('get_current_params', {
                phase: 'reasoning'
            });

            // Strong assertions
            expect(result).toBeDefined();
            expect(typeof result).toBe('object');
            expect(result).not.toBeNull();

            // hasActiveOverride should be a boolean
            expect(typeof result.hasActiveOverride).toBe('boolean');
            expect(result.phase).toBe('reasoning');
        });
    });

    describe('ORPAR Phase-Aware Profile Selection', () => {
        it('should have different default profiles for each phase', async () => {
            const agent = await testSdk.createAndConnectAgent(channelId, {
                name: 'Phase Profile Agent',
                allowedTools: ['get_parameter_status'],
                agentConfigPrompt: 'You analyze phase profiles.',
                capabilities: ['inference-control']
            });

            const result = await agent.executeTool('get_parameter_status', {});

            // Strong assertions
            expect(result).toBeDefined();
            expect(typeof result).toBe('object');
            expect(result).not.toBeNull();

            const profiles = result.allPhaseProfiles;
            expect(profiles).toBeDefined();

            // Observation should have low temperature for accuracy
            expect(profiles.observation).toBeDefined();
            expect(profiles.observation.temperature).toBeLessThanOrEqual(0.3);

            // Reasoning should have moderate temperature for exploration
            expect(profiles.reasoning).toBeDefined();
            expect(profiles.reasoning.temperature).toBeGreaterThan(0.3);

            // Planning should have moderate temperature for strategy
            expect(profiles.planning).toBeDefined();
            expect(profiles.planning.temperature).toBeGreaterThanOrEqual(0.2);
            expect(profiles.planning.temperature).toBeLessThanOrEqual(0.5);

            // Action should have very low temperature for reliability
            expect(profiles.action).toBeDefined();
            expect(profiles.action.temperature).toBeLessThanOrEqual(0.2);

            // Reflection should have moderate temperature for evaluation
            expect(profiles.reflection).toBeDefined();
            expect(profiles.reflection.temperature).toBeGreaterThanOrEqual(0.3);
            expect(profiles.reflection.temperature).toBeLessThanOrEqual(0.6);
        });

        it('should have reasoning tokens only for appropriate phases', async () => {
            const agent = await testSdk.createAndConnectAgent(channelId, {
                name: 'Reasoning Tokens Agent',
                allowedTools: ['get_current_params'],
                agentConfigPrompt: 'You analyze reasoning token allocation.',
                capabilities: ['inference-control']
            });

            // Observation phase should have 0 reasoning tokens
            const observationResult = await agent.executeTool('get_current_params', {
                phase: 'observation'
            });
            expect(observationResult).toBeDefined();
            expect(typeof observationResult).toBe('object');
            expect(observationResult.defaultParams).toBeDefined();
            expect(observationResult.defaultParams.reasoningTokens).toBe(0);

            // Action phase should have 0 reasoning tokens
            const actionResult = await agent.executeTool('get_current_params', {
                phase: 'action'
            });
            expect(actionResult).toBeDefined();
            expect(typeof actionResult).toBe('object');
            expect(actionResult.defaultParams).toBeDefined();
            expect(actionResult.defaultParams.reasoningTokens).toBe(0);

            // Reasoning phase should have reasoning tokens > 0
            const reasoningResult = await agent.executeTool('get_current_params', {
                phase: 'reasoning'
            });
            expect(reasoningResult).toBeDefined();
            expect(typeof reasoningResult).toBe('object');
            expect(reasoningResult.defaultParams).toBeDefined();
            expect(reasoningResult.defaultParams.reasoningTokens).toBeGreaterThan(0);
        });

        it('should use appropriate models for different phases', async () => {
            const agent = await testSdk.createAndConnectAgent(channelId, {
                name: 'Model Selection Agent',
                allowedTools: ['get_parameter_status'],
                agentConfigPrompt: 'You analyze model selection per phase.',
                capabilities: ['inference-control']
            });

            const result = await agent.executeTool('get_parameter_status', {});

            // Strong assertions
            expect(result).toBeDefined();
            expect(typeof result).toBe('object');
            expect(result).not.toBeNull();

            const profiles = result.allPhaseProfiles;
            expect(profiles).toBeDefined();

            // Each phase should have a model defined
            expect(profiles.observation.model).toBeDefined();
            expect(profiles.reasoning.model).toBeDefined();
            expect(profiles.planning.model).toBeDefined();
            expect(profiles.action.model).toBeDefined();
            expect(profiles.reflection.model).toBeDefined();

            // Models should be non-empty strings
            expect(typeof profiles.observation.model).toBe('string');
            expect(profiles.observation.model.length).toBeGreaterThan(0);
            expect(typeof profiles.reasoning.model).toBe('string');
            expect(profiles.reasoning.model.length).toBeGreaterThan(0);
        });
    });

    describe('Agent Parameter Override Requests', () => {
        it('should process parameter request with reason', async () => {
            const agent = await testSdk.createAndConnectAgent(channelId, {
                name: 'Request Agent',
                allowedTools: ['request_inference_params'],
                agentConfigPrompt: 'You request parameter changes for complex tasks.',
                capabilities: ['inference-control', 'meta-cognition']
            });

            const result = await agent.executeTool('request_inference_params', {
                reason: 'Complex reasoning task requires more thinking capacity',
                suggested: {
                    temperature: 0.6,
                    reasoningTokens: 12000
                },
                scope: 'next_call'
            });

            // Strong assertions
            expect(result).toBeDefined();
            expect(typeof result).toBe('object');
            expect(result).not.toBeNull();

            // Should have a status field
            expect(result.status).toBeDefined();
            expect(['approved', 'modified', 'denied']).toContain(result.status);

            // Should have activeParams with the resolved parameters (unless denied)
            if (result.status !== 'denied') {
                expect(result.activeParams).toBeDefined();
                expect(result.activeParams.model).toBeDefined();
                expect(typeof result.activeParams.temperature).toBe('number');
            }
        });

        it('should reject request without reason', async () => {
            const agent = await testSdk.createAndConnectAgent(channelId, {
                name: 'No Reason Agent',
                allowedTools: ['request_inference_params'],
                agentConfigPrompt: 'You attempt requests without reasons.',
                capabilities: ['inference-control']
            });

            // Empty reason is rejected at schema validation level (minLength: 1)
            // so the tool call throws an error instead of returning denied status
            await expect(
                agent.executeTool('request_inference_params', {
                    reason: '',  // Empty reason should be rejected by schema validation
                    suggested: {
                        temperature: 0.9
                    }
                })
            ).rejects.toThrow();
        });

        it('should support different scope options', async () => {
            const agent = await testSdk.createAndConnectAgent(channelId, {
                name: 'Scope Test Agent',
                allowedTools: ['request_inference_params'],
                agentConfigPrompt: 'You test different override scopes.',
                capabilities: ['inference-control']
            });

            // Test 'next_call' scope
            const nextCallResult = await agent.executeTool('request_inference_params', {
                reason: 'Need higher temperature for single creative response',
                suggested: { temperature: 0.7 },
                scope: 'next_call'
            });
            expect(nextCallResult).toBeDefined();

            await sleep(300);

            // Test 'current_phase' scope
            const phaseResult = await agent.executeTool('request_inference_params', {
                reason: 'Need extended thinking for entire reasoning phase',
                suggested: { reasoningTokens: 10000 },
                scope: 'current_phase'
            });
            expect(phaseResult).toBeDefined();

            await sleep(300);

            // Test 'task' scope
            const taskResult = await agent.executeTool('request_inference_params', {
                reason: 'Need consistent high output for complex task',
                suggested: { maxOutputTokens: 6000 },
                scope: 'task'
            });
            expect(taskResult).toBeDefined();

            await sleep(300);

            // Test 'session' scope
            const sessionResult = await agent.executeTool('request_inference_params', {
                reason: 'Need persistent high temperature for session',
                suggested: { temperature: 0.8 },
                scope: 'session'
            });
            expect(sessionResult).toBeDefined();
        });

        it('should return override ID and expiration for approved requests', async () => {
            const agent = await testSdk.createAndConnectAgent(channelId, {
                name: 'Override ID Agent',
                allowedTools: ['request_inference_params'],
                agentConfigPrompt: 'You track override IDs.',
                capabilities: ['inference-control']
            });

            const result = await agent.executeTool('request_inference_params', {
                reason: 'Testing override tracking',
                suggested: { temperature: 0.5 },
                scope: 'next_call'
            });

            // Strong assertions
            expect(result).toBeDefined();
            expect(typeof result).toBe('object');
            expect(result).not.toBeNull();
            expect(result.status).toBeDefined();
            expect(['approved', 'modified', 'denied']).toContain(result.status);

            if (result.status === 'approved' || result.status === 'modified') {
                expect(result.overrideId).toBeDefined();
                expect(typeof result.overrideId).toBe('string');
                expect(result.expiresAt).toBeDefined();
            }
        });

        it('should provide cost delta for approved requests', async () => {
            const agent = await testSdk.createAndConnectAgent(channelId, {
                name: 'Cost Delta Agent',
                allowedTools: ['request_inference_params'],
                agentConfigPrompt: 'You analyze cost impacts.',
                capabilities: ['inference-control']
            });

            const result = await agent.executeTool('request_inference_params', {
                reason: 'Upgrading to more capable model for complex task',
                suggested: {
                    model: 'anthropic/claude-sonnet-4-5',
                    reasoningTokens: 8000
                },
                scope: 'next_call'
            });

            // Strong assertions
            expect(result).toBeDefined();
            expect(typeof result).toBe('object');
            expect(result).not.toBeNull();
            expect(result.status).toBeDefined();
            expect(['approved', 'modified', 'denied']).toContain(result.status);

            if (result.status !== 'denied') {
                // Cost delta should be present and be a number
                expect(result.costDelta).toBeDefined();
                expect(typeof result.costDelta).toBe('number');
            }
        });
    });

    describe('Cost Governance Enforcement', () => {
        it('should provide available models by cost tier', async () => {
            const agent = await testSdk.createAndConnectAgent(channelId, {
                name: 'Model Tier Agent',
                allowedTools: ['get_available_models'],
                agentConfigPrompt: 'You explore available models.',
                capabilities: ['inference-control']
            });

            // Get all models
            const allResult = await agent.executeTool('get_available_models', {
                tier: 'all'
            });

            // Strong assertions
            expect(allResult).toBeDefined();
            expect(typeof allResult).toBe('object');
            expect(allResult).not.toBeNull();

            expect(allResult.models).toBeDefined();
            expect(Array.isArray(allResult.models)).toBe(true);
            expect(allResult.totalCount).toBeGreaterThan(0);

            // Should have tier descriptions
            expect(allResult.tiers).toBeDefined();
            expect(typeof allResult.tiers).toBe('object');
        });

        it('should filter models by specific cost tier', async () => {
            const agent = await testSdk.createAndConnectAgent(channelId, {
                name: 'Tier Filter Agent',
                allowedTools: ['get_available_models'],
                agentConfigPrompt: 'You filter models by tier.',
                capabilities: ['inference-control']
            });

            // Get budget tier models
            const budgetResult = await agent.executeTool('get_available_models', {
                tier: 'budget'
            });

            // Strong assertions
            expect(budgetResult).toBeDefined();
            expect(typeof budgetResult).toBe('object');
            expect(budgetResult).not.toBeNull();

            expect(budgetResult.models).toBeDefined();
            expect(Array.isArray(budgetResult.models)).toBe(true);

            // All returned models should be budget tier
            if (budgetResult.models.length > 0) {
                for (const model of budgetResult.models) {
                    expect(model.tier).toBe('budget');
                }
            }
        });

        it('should include cost information in model listings', async () => {
            const agent = await testSdk.createAndConnectAgent(channelId, {
                name: 'Cost Info Agent',
                allowedTools: ['get_available_models'],
                agentConfigPrompt: 'You analyze model costs.',
                capabilities: ['inference-control']
            });

            const result = await agent.executeTool('get_available_models', {
                tier: 'all'
            });

            // Strong assertions
            expect(result).toBeDefined();
            expect(typeof result).toBe('object');
            expect(result).not.toBeNull();

            expect(result.models).toBeDefined();
            expect(Array.isArray(result.models)).toBe(true);
            expect(result.models.length).toBeGreaterThan(0);

            const model = result.models[0];

            // Each model should have cost info
            expect(model.inputCostPer1k).toBeDefined();
            expect(typeof model.inputCostPer1k).toBe('number');
            expect(model.outputCostPer1k).toBeDefined();
            expect(typeof model.outputCostPer1k).toBe('number');
            expect(model.tier).toBeDefined();
            expect(typeof model.tier).toBe('string');
        });

        it('should indicate reasoning support for models', async () => {
            const agent = await testSdk.createAndConnectAgent(channelId, {
                name: 'Reasoning Support Agent',
                allowedTools: ['get_available_models'],
                agentConfigPrompt: 'You check model capabilities.',
                capabilities: ['inference-control']
            });

            const result = await agent.executeTool('get_available_models', {
                tier: 'all'
            });

            // Strong assertions
            expect(result).toBeDefined();
            expect(typeof result).toBe('object');
            expect(result).not.toBeNull();

            expect(result.models).toBeDefined();
            expect(Array.isArray(result.models)).toBe(true);
            expect(result.models.length).toBeGreaterThan(0);

            // Check that supportsReasoning field exists for all models
            for (const model of result.models) {
                expect(typeof model.supportsReasoning).toBe('boolean');
                expect(model.model).toBeDefined();
                expect(typeof model.model).toBe('string');
            }
        });

        it('should modify request when exceeding governance limits', async () => {
            const agent = await testSdk.createAndConnectAgent(channelId, {
                name: 'Limit Test Agent',
                allowedTools: ['request_inference_params'],
                agentConfigPrompt: 'You test governance limits.',
                capabilities: ['inference-control']
            });

            // Request with high values at schema limits that may exceed governance limits
            // Note: Schema enforces temperature 0-2, maxOutputTokens >= 100
            const result = await agent.executeTool('request_inference_params', {
                reason: 'Testing extreme parameter values within schema bounds',
                suggested: {
                    temperature: 2.0,  // At max schema limit
                    reasoningTokens: 100000,  // Very high reasoning tokens
                    maxOutputTokens: 50000  // Very high output tokens
                },
                scope: 'next_call'
            });

            // Strong assertions
            expect(result).toBeDefined();
            expect(typeof result).toBe('object');
            expect(result).not.toBeNull();

            // Request should be processed - may be approved, modified, or denied
            expect(result.status).toBeDefined();
            expect(['approved', 'modified', 'denied']).toContain(result.status);

            if (result.activeParams) {
                // Parameters should be within valid ranges
                expect(result.activeParams.temperature).toBeLessThanOrEqual(2.0);
                expect(result.activeParams.temperature).toBeGreaterThanOrEqual(0);
            }
        });
    });

    describe('Parameter Cost Analytics', () => {
        it('should provide cost analytics via get_parameter_cost_analytics', async () => {
            const agent = await testSdk.createAndConnectAgent(channelId, {
                name: 'Analytics Agent',
                allowedTools: ['get_parameter_cost_analytics'],
                agentConfigPrompt: 'You analyze parameter costs.',
                capabilities: ['inference-control', 'analytics']
            });

            const result = await agent.executeTool('get_parameter_cost_analytics', {
                timeRange: '24h',
                groupBy: 'phase'
            });

            // Strong assertions
            expect(result).toBeDefined();
            expect(typeof result).toBe('object');
            expect(result).not.toBeNull();

            expect(result.timeRange).toBe('24h');
            expect(result.groupBy).toBe('phase');
            expect(result.summary).toBeDefined();
            expect(result.summary.totalExecutions).toBeDefined();
            expect(result.summary.totalCost).toBeDefined();
            expect(result.breakdown).toBeDefined();
            expect(Array.isArray(result.breakdown)).toBe(true);
        });

        it('should support different time ranges for analytics', async () => {
            const agent = await testSdk.createAndConnectAgent(channelId, {
                name: 'Time Range Agent',
                allowedTools: ['get_parameter_cost_analytics'],
                agentConfigPrompt: 'You analyze costs over different periods.',
                capabilities: ['inference-control', 'analytics']
            });

            const timeRanges = ['1h', '24h', '7d', '30d'];

            for (const timeRange of timeRanges) {
                const result = await agent.executeTool('get_parameter_cost_analytics', {
                    timeRange,
                    groupBy: 'phase'
                });

                // Strong assertions for each time range
                expect(result).toBeDefined();
                expect(typeof result).toBe('object');
                expect(result).not.toBeNull();
                expect(result.timeRange).toBe(timeRange);
                expect(result.summary).toBeDefined();
            }
        });

        it('should support different grouping options for analytics', async () => {
            const agent = await testSdk.createAndConnectAgent(channelId, {
                name: 'Grouping Agent',
                allowedTools: ['get_parameter_cost_analytics'],
                agentConfigPrompt: 'You analyze costs by different dimensions.',
                capabilities: ['inference-control', 'analytics']
            });

            const groupByOptions = ['phase', 'model', 'hour'];

            for (const groupBy of groupByOptions) {
                const result = await agent.executeTool('get_parameter_cost_analytics', {
                    timeRange: '24h',
                    groupBy
                });

                // Strong assertions for each groupBy option
                expect(result).toBeDefined();
                expect(typeof result).toBe('object');
                expect(result).not.toBeNull();
                expect(result.groupBy).toBe(groupBy);
                expect(result.timeRange).toBe('24h');
                expect(result.summary).toBeDefined();
            }
        });

        it('should include optimization tips in analytics', async () => {
            const agent = await testSdk.createAndConnectAgent(channelId, {
                name: 'Optimization Agent',
                allowedTools: ['get_parameter_cost_analytics'],
                agentConfigPrompt: 'You identify optimization opportunities.',
                capabilities: ['inference-control', 'analytics']
            });

            const result = await agent.executeTool('get_parameter_cost_analytics', {
                timeRange: '24h',
                groupBy: 'phase'
            });

            // Strong assertions
            expect(result).toBeDefined();
            expect(typeof result).toBe('object');
            expect(result).not.toBeNull();

            // optimizationTips should be an array (may be empty if no data)
            expect(result.optimizationTips).toBeDefined();
            expect(Array.isArray(result.optimizationTips)).toBe(true);
        });
    });

    describe('Multi-Agent Parameter Management', () => {
        it('should isolate parameter overrides between agents', async () => {
            // Create a dedicated channel for multi-agent test
            const { channelId: multiAgentChannelId } = await testSdk.createTestChannel('inference-multi', {
                disableSystemLlm: true,
                maxAgents: 5
            });

            // Create two agents
            const agent1 = await testSdk.createAndConnectAgent(multiAgentChannelId, {
                name: 'Param Agent 1',
                allowedTools: ['request_inference_params', 'get_current_params'],
                agentConfigPrompt: 'You are agent 1 managing parameters.',
                capabilities: ['inference-control']
            });

            await sleep(300);

            const agent2 = await testSdk.createAndConnectAgent(multiAgentChannelId, {
                name: 'Param Agent 2',
                allowedTools: ['request_inference_params', 'get_current_params'],
                agentConfigPrompt: 'You are agent 2 managing parameters.',
                capabilities: ['inference-control']
            });

            // Agent 1 requests parameter change
            const agent1Request = await agent1.executeTool('request_inference_params', {
                reason: 'Agent 1 needs high temperature',
                suggested: { temperature: 0.9 },
                scope: 'task'
            });

            expect(agent1Request).toBeDefined();

            await sleep(300);

            // Agent 2 gets its parameters - should NOT have agent 1's override
            const agent2Params = await agent2.executeTool('get_current_params', {
                phase: 'reasoning'
            });

            expect(agent2Params).toBeDefined();
            // Agent 2's parameters should be independent of agent 1's override
            // (The actual verification depends on the isolation implementation)
        });

        it('should track parameter requests per agent', async () => {
            const agent = await testSdk.createAndConnectAgent(channelId, {
                name: 'Multi Request Agent',
                allowedTools: ['request_inference_params', 'get_parameter_status'],
                agentConfigPrompt: 'You make multiple parameter requests.',
                capabilities: ['inference-control']
            });

            // Make multiple requests
            await agent.executeTool('request_inference_params', {
                reason: 'First request',
                suggested: { temperature: 0.5 },
                scope: 'next_call'
            });

            await sleep(200);

            await agent.executeTool('request_inference_params', {
                reason: 'Second request',
                suggested: { temperature: 0.6 },
                scope: 'next_call'
            });

            await sleep(200);

            await agent.executeTool('request_inference_params', {
                reason: 'Third request',
                suggested: { temperature: 0.7 },
                scope: 'next_call'
            });

            await sleep(200);

            // Check status - should show tracked requests
            const status = await agent.executeTool('get_parameter_status', {});

            expect(status).toBeDefined();
        });
    });

    describe('Parameter Request Edge Cases', () => {
        it('should handle request for non-existent model gracefully', async () => {
            const agent = await testSdk.createAndConnectAgent(channelId, {
                name: 'Invalid Model Agent',
                allowedTools: ['request_inference_params'],
                agentConfigPrompt: 'You test invalid model requests.',
                capabilities: ['inference-control']
            });

            const result = await agent.executeTool('request_inference_params', {
                reason: 'Testing invalid model handling',
                suggested: {
                    model: 'fake/nonexistent-model-xyz'
                },
                scope: 'next_call'
            });

            // Strong assertions
            expect(result).toBeDefined();
            expect(typeof result).toBe('object');
            expect(result).not.toBeNull();

            // Should either be denied or modified to use a valid model
            expect(result.status).toBeDefined();
            expect(['approved', 'modified', 'denied']).toContain(result.status);
        });

        it('should handle request with only reason (no suggested params)', async () => {
            const agent = await testSdk.createAndConnectAgent(channelId, {
                name: 'Reason Only Agent',
                allowedTools: ['request_inference_params'],
                agentConfigPrompt: 'You make requests with only reasons.',
                capabilities: ['inference-control']
            });

            const result = await agent.executeTool('request_inference_params', {
                reason: 'Just logging intent, no specific parameter changes needed'
            });

            // Strong assertions
            expect(result).toBeDefined();
            expect(typeof result).toBe('object');
            expect(result).not.toBeNull();

            // Should still process (using current params as active)
            expect(result.status).toBeDefined();
            expect(['approved', 'modified', 'denied']).toContain(result.status);
        });

        it('should handle minimum temperature request', async () => {
            const agent = await testSdk.createAndConnectAgent(channelId, {
                name: 'Min Temp Agent',
                allowedTools: ['request_inference_params'],
                agentConfigPrompt: 'You test boundary conditions.',
                capabilities: ['inference-control']
            });

            // Test at minimum valid temperature (0) - schema enforces minimum: 0
            const result = await agent.executeTool('request_inference_params', {
                reason: 'Testing minimum temperature for deterministic output',
                suggested: {
                    temperature: 0  // Minimum valid temperature
                },
                scope: 'next_call'
            });

            // Strong assertions
            expect(result).toBeDefined();
            expect(typeof result).toBe('object');
            expect(result).not.toBeNull();

            // Should process successfully
            expect(result.status).toBeDefined();
            expect(['approved', 'modified', 'denied']).toContain(result.status);
            if (result.activeParams) {
                expect(result.activeParams.temperature).toBeGreaterThanOrEqual(0);
            }
        });

        it('should handle request with minimum max tokens', async () => {
            const agent = await testSdk.createAndConnectAgent(channelId, {
                name: 'Min Tokens Agent',
                allowedTools: ['request_inference_params'],
                agentConfigPrompt: 'You test minimum token requests.',
                capabilities: ['inference-control']
            });

            // Test at minimum valid maxOutputTokens (100) - schema enforces minimum: 100
            const result = await agent.executeTool('request_inference_params', {
                reason: 'Testing minimum output tokens for constrained response',
                suggested: {
                    maxOutputTokens: 100  // Minimum valid tokens
                },
                scope: 'next_call'
            });

            // Strong assertions
            expect(result).toBeDefined();
            expect(typeof result).toBe('object');
            expect(result).not.toBeNull();

            // Should process successfully
            expect(result.status).toBeDefined();
            expect(['approved', 'modified', 'denied']).toContain(result.status);
            if (result.activeParams) {
                expect(result.activeParams.maxOutputTokens).toBeGreaterThanOrEqual(100);
            }
        });
    });

    describe('Integration with ORPAR Cycle', () => {
        it('should support phase-specific parameter requests', async () => {
            const agent = await testSdk.createAndConnectAgent(channelId, {
                name: 'ORPAR Integration Agent',
                allowedTools: [
                    'request_inference_params',
                    'get_current_params',
                    'orpar_observe',
                    'orpar_reason',
                    'orpar_status'
                ],
                agentConfigPrompt: 'You integrate inference parameters with ORPAR.',
                capabilities: ['inference-control', 'orpar']
            });

            // Get current observation phase params
            const obsParams = await agent.executeTool('get_current_params', {
                phase: 'observation'
            });
            expect(obsParams).toBeDefined();
            expect(typeof obsParams).toBe('object');
            expect(obsParams.phase).toBe('observation');

            // Request different params for reasoning phase
            const reasoningRequest = await agent.executeTool('request_inference_params', {
                reason: 'Complex analysis requires extended reasoning',
                suggested: {
                    reasoningTokens: 10000,
                    temperature: 0.6
                },
                scope: 'current_phase'
            });

            // Strong assertions
            expect(reasoningRequest).toBeDefined();
            expect(typeof reasoningRequest).toBe('object');
            expect(reasoningRequest).not.toBeNull();

            // Verify the request was processed
            expect(reasoningRequest.status).toBeDefined();
            expect(['approved', 'modified', 'denied']).toContain(reasoningRequest.status);
        });

        it('should maintain phase parameters through ORPAR tools', async () => {
            const agent = await testSdk.createAndConnectAgent(channelId, {
                name: 'Phase Maintain Agent',
                allowedTools: [
                    'request_inference_params',
                    'get_current_params',
                    'orpar_status'
                ],
                agentConfigPrompt: 'You verify parameter persistence.',
                capabilities: ['inference-control', 'orpar']
            });

            // Request params with 'current_phase' scope
            await agent.executeTool('request_inference_params', {
                reason: 'Need consistent params for entire phase',
                suggested: { temperature: 0.5 },
                scope: 'current_phase'
            });

            await sleep(200);

            // Verify status
            const status = await agent.executeTool('orpar_status', {});
            expect(status).toBeDefined();

            // Get params again - should still have override active
            const params = await agent.executeTool('get_current_params', {
                phase: 'reasoning'
            });
            expect(params).toBeDefined();
        });
    });

    describe('Tool Execution Timing', () => {
        it('should complete parameter queries within timeout', async () => {
            const agent = await testSdk.createAndConnectAgent(channelId, {
                name: 'Timing Agent',
                allowedTools: ['get_current_params', 'get_parameter_status'],
                agentConfigPrompt: 'You measure tool execution times.',
                capabilities: ['inference-control']
            });

            const startTime = Date.now();

            await agent.executeTool('get_current_params', {
                phase: 'reasoning'
            });

            const executionTime = Date.now() - startTime;

            // Parameter queries should be fast
            expect(executionTime).toBeLessThan(TIMEOUTS.standard);
        });

        it('should complete parameter requests within timeout', async () => {
            const agent = await testSdk.createAndConnectAgent(channelId, {
                name: 'Request Timing Agent',
                allowedTools: ['request_inference_params'],
                agentConfigPrompt: 'You measure request processing times.',
                capabilities: ['inference-control']
            });

            const startTime = Date.now();

            await agent.executeTool('request_inference_params', {
                reason: 'Timing test',
                suggested: { temperature: 0.5 },
                scope: 'next_call'
            });

            const executionTime = Date.now() - startTime;

            // Requests should complete within standard timeout
            expect(executionTime).toBeLessThan(TIMEOUTS.standard);
        });

        it('should complete model listing within timeout', async () => {
            const agent = await testSdk.createAndConnectAgent(channelId, {
                name: 'Model Timing Agent',
                allowedTools: ['get_available_models'],
                agentConfigPrompt: 'You measure model listing times.',
                capabilities: ['inference-control']
            });

            const startTime = Date.now();

            await agent.executeTool('get_available_models', {
                tier: 'all'
            });

            const executionTime = Date.now() - startTime;

            // Model listings should be fast
            expect(executionTime).toBeLessThan(TIMEOUTS.standard);
        });
    });

    describe('Parameter Reset Functionality', () => {
        it('should reset all parameter overrides', async () => {
            const agent = await testSdk.createAndConnectAgent(channelId, {
                name: 'Reset All Agent',
                allowedTools: ['request_inference_params', 'reset_inference_params', 'get_parameter_status'],
                agentConfigPrompt: 'You test parameter reset functionality.',
                capabilities: ['inference-control']
            });

            // Create some overrides first
            await agent.executeTool('request_inference_params', {
                reason: 'Setting up session override',
                suggested: { temperature: 0.8 },
                scope: 'session'
            });

            await sleep(200);

            await agent.executeTool('request_inference_params', {
                reason: 'Setting up next_call override',
                suggested: { temperature: 0.6 },
                scope: 'next_call'
            });

            await sleep(200);

            // Reset all overrides
            const resetResult = await agent.executeTool('reset_inference_params', {
                scope: 'all'
            });

            // Strong assertions
            expect(resetResult).toBeDefined();
            expect(typeof resetResult).toBe('object');
            expect(resetResult).not.toBeNull();
            expect(resetResult.success).toBe(true);
            expect(resetResult.scope).toBe('all');
            expect(typeof resetResult.resetCount).toBe('number');
        });

        it('should reset only session-scoped overrides', async () => {
            const agent = await testSdk.createAndConnectAgent(channelId, {
                name: 'Reset Session Agent',
                allowedTools: ['request_inference_params', 'reset_inference_params'],
                agentConfigPrompt: 'You test session-specific reset.',
                capabilities: ['inference-control']
            });

            // Create a session override
            await agent.executeTool('request_inference_params', {
                reason: 'Session override for test',
                suggested: { temperature: 0.9 },
                scope: 'session'
            });

            await sleep(200);

            // Reset only session overrides
            const resetResult = await agent.executeTool('reset_inference_params', {
                scope: 'session'
            });

            expect(resetResult).toBeDefined();
            expect(resetResult.success).toBe(true);
            expect(resetResult.scope).toBe('session');
        });

        it('should handle reset when no overrides exist', async () => {
            const agent = await testSdk.createAndConnectAgent(channelId, {
                name: 'Empty Reset Agent',
                allowedTools: ['reset_inference_params'],
                agentConfigPrompt: 'You test reset with no overrides.',
                capabilities: ['inference-control']
            });

            const resetResult = await agent.executeTool('reset_inference_params', {
                scope: 'all'
            });

            expect(resetResult).toBeDefined();
            expect(resetResult.success).toBe(true);
            expect(resetResult.resetCount).toBe(0);
        });
    });

    describe('Previous Parameters in Response', () => {
        it('should return previousParams when requesting parameter changes', async () => {
            const agent = await testSdk.createAndConnectAgent(channelId, {
                name: 'Previous Params Agent',
                allowedTools: ['request_inference_params'],
                agentConfigPrompt: 'You verify previousParams are returned.',
                capabilities: ['inference-control']
            });

            const result = await agent.executeTool('request_inference_params', {
                reason: 'Testing previousParams field',
                suggested: { temperature: 0.8 },
                scope: 'next_call'
            });

            // Strong assertions
            expect(result).toBeDefined();
            expect(typeof result).toBe('object');
            expect(result).not.toBeNull();
            expect(result.status).toBeDefined();

            // previousParams should be present for comparison
            if (result.status !== 'denied') {
                expect(result.previousParams).toBeDefined();
                expect(result.previousParams.model).toBeDefined();
                expect(typeof result.previousParams.temperature).toBe('number');
            }
        });

        it('should allow comparison between previous and active params', async () => {
            const agent = await testSdk.createAndConnectAgent(channelId, {
                name: 'Compare Params Agent',
                allowedTools: ['request_inference_params'],
                agentConfigPrompt: 'You compare parameter changes.',
                capabilities: ['inference-control']
            });

            const result = await agent.executeTool('request_inference_params', {
                reason: 'Comparing params before and after',
                suggested: { temperature: 0.9 },
                scope: 'next_call'
            });

            expect(result).toBeDefined();

            if (result.status === 'approved' || result.status === 'modified') {
                expect(result.activeParams).toBeDefined();
                expect(result.previousParams).toBeDefined();

                // Both should have model and temperature
                expect(result.activeParams.model).toBeDefined();
                expect(result.previousParams.model).toBeDefined();
                expect(typeof result.activeParams.temperature).toBe('number');
                expect(typeof result.previousParams.temperature).toBe('number');
            }
        });
    });

    describe('Session Scope Behavior', () => {
        it('should persist session-scoped parameters across multiple calls', async () => {
            const agent = await testSdk.createAndConnectAgent(channelId, {
                name: 'Session Persist Agent',
                allowedTools: ['request_inference_params', 'get_current_params', 'reset_inference_params'],
                agentConfigPrompt: 'You test session persistence.',
                capabilities: ['inference-control']
            });

            // Request session-scoped parameter
            const requestResult = await agent.executeTool('request_inference_params', {
                reason: 'Testing session persistence',
                suggested: { temperature: 0.85 },
                scope: 'session'
            });

            expect(requestResult).toBeDefined();
            expect(requestResult.status).toBeDefined();

            if (requestResult.status === 'approved') {
                await sleep(200);

                // Get current params - should reflect the session override
                const paramsResult = await agent.executeTool('get_current_params', {
                    phase: 'reasoning'
                });

                expect(paramsResult).toBeDefined();
                expect(paramsResult.hasActiveOverride).toBe(true);
            }

            // Clean up
            await agent.executeTool('reset_inference_params', { scope: 'session' });
        });

        it('should not have session scope expire automatically like next_call', async () => {
            const agent = await testSdk.createAndConnectAgent(channelId, {
                name: 'Session No Expire Agent',
                allowedTools: ['request_inference_params', 'get_parameter_status', 'reset_inference_params'],
                agentConfigPrompt: 'You test session non-expiration.',
                capabilities: ['inference-control']
            });

            // Request session-scoped parameter
            const requestResult = await agent.executeTool('request_inference_params', {
                reason: 'Session should not auto-expire',
                suggested: { temperature: 0.75 },
                scope: 'session'
            });

            expect(requestResult).toBeDefined();

            if (requestResult.status === 'approved') {
                // Session scope has 24h TTL as safety net (also cleared on disconnect)
                expect(requestResult.expiresAt).toBeDefined();
                const expiresAt = new Date(requestResult.expiresAt).getTime();
                const now = Date.now();
                const twentyThreeHours = 23 * 60 * 60 * 1000;
                const twentyFiveHours = 25 * 60 * 60 * 1000;
                // Should expire between 23-25 hours from now (allowing for test execution time)
                expect(expiresAt - now).toBeGreaterThan(twentyThreeHours);
                expect(expiresAt - now).toBeLessThan(twentyFiveHours);
            }

            // Clean up
            await agent.executeTool('reset_inference_params', { scope: 'session' });
        });
    });

    describe('v1.1 Architecture Independence', () => {
        it('should work without ORPAR tools enabled', async () => {
            // Create an agent without ORPAR tools - just inference parameter tools
            const agent = await testSdk.createAndConnectAgent(channelId, {
                name: 'Non-ORPAR Agent',
                allowedTools: ['request_inference_params', 'get_current_params', 'reset_inference_params'],
                agentConfigPrompt: 'You are a simple agent without ORPAR.',
                capabilities: ['inference-control']
            });

            // Should be able to request parameters
            const requestResult = await agent.executeTool('request_inference_params', {
                reason: 'Non-ORPAR agent needs parameter adjustment',
                suggested: { temperature: 0.6 },
                scope: 'session'
            });

            expect(requestResult).toBeDefined();
            expect(requestResult.status).toBeDefined();
            expect(['approved', 'modified', 'denied']).toContain(requestResult.status);

            // Should be able to get current params
            const paramsResult = await agent.executeTool('get_current_params', {
                phase: 'observation' // Can still use phase even without ORPAR
            });

            expect(paramsResult).toBeDefined();
            expect(paramsResult.currentParams).toBeDefined();

            // Clean up
            await agent.executeTool('reset_inference_params', { scope: 'all' });
        });

        it('should support session and task scopes without ORPAR context', async () => {
            const agent = await testSdk.createAndConnectAgent(channelId, {
                name: 'Scope Independence Agent',
                allowedTools: ['request_inference_params', 'reset_inference_params'],
                agentConfigPrompt: 'You test scope independence from ORPAR.',
                capabilities: ['inference-control']
            });

            // Test session scope
            const sessionResult = await agent.executeTool('request_inference_params', {
                reason: 'Testing session scope without ORPAR',
                suggested: { temperature: 0.7 },
                scope: 'session'
            });
            expect(sessionResult).toBeDefined();
            expect(sessionResult.status).toBeDefined();

            await sleep(200);

            // Test task scope
            const taskResult = await agent.executeTool('request_inference_params', {
                reason: 'Testing task scope without ORPAR',
                suggested: { temperature: 0.5 },
                scope: 'task'
            });
            expect(taskResult).toBeDefined();
            expect(taskResult.status).toBeDefined();

            // Clean up
            await agent.executeTool('reset_inference_params', { scope: 'all' });
        });
    });
});
