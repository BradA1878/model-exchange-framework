/**
 * Property-based tests for ORPAR state management
 * Tests invariants that should hold for any valid ORPAR state transitions
 */

import {
    clearAgentOrparState,
    getAllOrparStates,
    orparStatusTool,
    orparObserveTool,
    orparReasonTool,
    orparPlanTool,
    orparActTool,
    orparReflectTool,
    ORPAR_TOOL_NAMES
} from '@mxf/shared/protocols/mcp/tools/OrparTools';
import { OrparEvents } from '@mxf/shared/events/event-definitions/OrparEvents';

describe('ORPAR Property Tests', () => {
    // Clean state between tests
    afterEach(() => {
        // Clear all states
        const states = getAllOrparStates();
        for (const key of states.keys()) {
            const [agentId, channelId] = key.split(':');
            clearAgentOrparState(agentId, channelId);
        }
    });

    describe('State Isolation Invariants', () => {
        it('state operations on agent A should never affect agent B', async () => {
            const agentIds = ['agent-1', 'agent-2', 'agent-3', 'agent-4', 'agent-5'];
            const channelId = 'shared-channel';
            const allTools = Object.values(ORPAR_TOOL_NAMES);

            // Create state for all agents at different phases
            for (let i = 0; i < agentIds.length; i++) {
                const context = { agentId: agentIds[i], channelId, allowedTools: allTools };
                await orparObserveTool.handler({ observations: `Observation ${i}` }, context);

                // Progress some agents further
                if (i >= 2) {
                    await orparReasonTool.handler({ analysis: `Analysis ${i}` }, context);
                }
                if (i >= 4) {
                    await orparPlanTool.handler({ plan: `Plan ${i}` }, context);
                }
            }

            // Clear state for agent-3
            clearAgentOrparState('agent-3', channelId);

            // Verify other agents' states are unaffected
            for (let i = 0; i < agentIds.length; i++) {
                if (agentIds[i] === 'agent-3') continue;

                const context = { agentId: agentIds[i], channelId, allowedTools: allTools };
                const status = await orparStatusTool.handler({}, context);

                if (i < 2) {
                    expect(status.currentPhase).toBe('observe');
                } else if (i < 4) {
                    expect(status.currentPhase).toBe('reason');
                } else {
                    expect(status.currentPhase).toBe('plan');
                }
            }
        });

        it('different channels should maintain independent state for same agent', async () => {
            const agentId = 'multi-channel-agent';
            const channels = ['channel-a', 'channel-b', 'channel-c'];
            const allTools = Object.values(ORPAR_TOOL_NAMES);

            // Create different states per channel
            for (let i = 0; i < channels.length; i++) {
                const context = { agentId, channelId: channels[i], allowedTools: allTools };
                await orparObserveTool.handler({ observations: `Channel ${i} observation` }, context);

                // Progress differently per channel
                if (i >= 1) {
                    await orparReasonTool.handler({ analysis: `Channel ${i} analysis` }, context);
                }
            }

            // Verify independent states
            for (let i = 0; i < channels.length; i++) {
                const context = { agentId, channelId: channels[i], allowedTools: allTools };
                const status = await orparStatusTool.handler({}, context);

                if (i === 0) {
                    expect(status.currentPhase).toBe('observe');
                } else {
                    expect(status.currentPhase).toBe('reason');
                }
            }

            // Clean up
            for (const channel of channels) {
                clearAgentOrparState(agentId, channel);
            }
        });
    });

    describe('Stale State Detection Invariants', () => {
        it('stale detection should trigger when current phase tool is not allowed but orpar_observe is', async () => {
            const agentId = 'stale-test-agent';
            const channelId = 'stale-test-channel';
            const allTools = Object.values(ORPAR_TOOL_NAMES);
            const context = { agentId, channelId, allowedTools: allTools };

            // Test reason phase
            await orparObserveTool.handler({ observations: 'Test' }, context);
            await orparReasonTool.handler({ analysis: 'Test' }, context);

            let status = await orparStatusTool.handler({}, context);
            expect(status.currentPhase).toBe('reason');

            // Check with restricted tools - should trigger stale detection
            const staleContext = {
                agentId,
                channelId,
                allowedTools: ['orpar_observe', 'orpar_status']
            };

            status = await orparStatusTool.handler({}, staleContext);
            expect(status.note).toContain('Previous cycle state cleared');
            expect(status.currentPhase).toBe('none');

            // Clean up
            clearAgentOrparState(agentId, channelId);

            // Test plan phase
            await orparObserveTool.handler({ observations: 'Test' }, context);
            await orparReasonTool.handler({ analysis: 'Test' }, context);
            await orparPlanTool.handler({ plan: 'Test' }, context);

            status = await orparStatusTool.handler({}, context);
            expect(status.currentPhase).toBe('plan');

            status = await orparStatusTool.handler({}, staleContext);
            expect(status.note).toContain('Previous cycle state cleared');
            expect(status.currentPhase).toBe('none');
            expect(status.nextTool).toBe('orpar_observe');

            clearAgentOrparState(agentId, channelId);
        });

        it('stale detection should NOT trigger for observe phase since orpar_observe IS the phase tool', async () => {
            const agentId = 'observe-phase-agent';
            const channelId = 'observe-phase-channel';
            const allTools = Object.values(ORPAR_TOOL_NAMES);

            // Create state at observe phase
            const context = { agentId, channelId, allowedTools: allTools };
            await orparObserveTool.handler({ observations: 'Test observation' }, context);

            // Verify we're at observe phase
            let status = await orparStatusTool.handler({}, context);
            expect(status.currentPhase).toBe('observe');

            // Check with orpar_observe allowed - this should NOT trigger stale detection
            // because the current phase (observe) tool (orpar_observe) IS in allowedTools
            const observeAllowedContext = {
                agentId,
                channelId,
                allowedTools: ['orpar_observe', 'orpar_status']
            };

            status = await orparStatusTool.handler({}, observeAllowedContext);

            // Should NOT reset since orpar_observe matches current phase
            expect(status.currentPhase).toBe('observe');
            expect(status.note).toBeUndefined();

            clearAgentOrparState(agentId, channelId);
        });

        it('stale detection should NOT trigger when current phase tool IS allowed', async () => {
            const agentId = 'no-stale-agent';
            const channelId = 'no-stale-channel';
            const allTools = Object.values(ORPAR_TOOL_NAMES);

            const context = { agentId, channelId, allowedTools: allTools };

            // Progress to reason phase
            await orparObserveTool.handler({ observations: 'Test' }, context);
            await orparReasonTool.handler({ analysis: 'Test' }, context);

            // Check status with both orpar_observe AND orpar_reason allowed
            const validContext = {
                agentId,
                channelId,
                allowedTools: ['orpar_observe', 'orpar_reason', 'orpar_status']
            };

            const status = await orparStatusTool.handler({}, validContext);

            // Should NOT trigger stale detection
            expect(status.currentPhase).toBe('reason');
            expect(status.note).toBeUndefined();
        });
    });

    describe('Phase Transition Invariants', () => {
        it('phase should always be one of the valid ORPAR phases or none', async () => {
            const agentId = 'phase-invariant-agent';
            const channelId = 'phase-invariant-channel';
            const allTools = Object.values(ORPAR_TOOL_NAMES);
            const validPhases = ['none', 'observe', 'reason', 'plan', 'act', 'reflect'];

            const context = { agentId, channelId, allowedTools: allTools };

            // Check initial phase
            let status = await orparStatusTool.handler({}, context);
            expect(validPhases).toContain(status.currentPhase);

            // Progress through phases and verify each is valid
            await orparObserveTool.handler({ observations: 'Test' }, context);
            status = await orparStatusTool.handler({}, context);
            expect(validPhases).toContain(status.currentPhase);

            await orparReasonTool.handler({ analysis: 'Test' }, context);
            status = await orparStatusTool.handler({}, context);
            expect(validPhases).toContain(status.currentPhase);

            await orparPlanTool.handler({ plan: 'Test' }, context);
            status = await orparStatusTool.handler({}, context);
            expect(validPhases).toContain(status.currentPhase);

            await orparActTool.handler({ action: 'Test' }, context);
            status = await orparStatusTool.handler({}, context);
            expect(validPhases).toContain(status.currentPhase);

            await orparReflectTool.handler({ reflection: 'Test' }, context);
            status = await orparStatusTool.handler({}, context);
            expect(validPhases).toContain(status.currentPhase);
        });

        it('cycle count should monotonically increase', async () => {
            const agentId = 'cycle-count-agent';
            const channelId = 'cycle-count-channel';
            const allTools = Object.values(ORPAR_TOOL_NAMES);
            const context = { agentId, channelId, allowedTools: allTools };

            let previousCycleCount = -1;

            // Run multiple cycles
            for (let cycle = 0; cycle < 3; cycle++) {
                await orparObserveTool.handler({ observations: `Cycle ${cycle}` }, context);
                await orparReasonTool.handler({ analysis: `Cycle ${cycle}` }, context);
                await orparPlanTool.handler({ plan: `Cycle ${cycle}` }, context);
                await orparActTool.handler({ action: `Cycle ${cycle}` }, context);
                await orparReflectTool.handler({ reflection: `Cycle ${cycle}` }, context);

                const status = await orparStatusTool.handler({}, context);

                // Cycle count should always increase or stay same (after completing a cycle)
                expect(status.cycleCount).toBeGreaterThan(previousCycleCount);
                previousCycleCount = status.cycleCount;
            }
        });
    });

    describe('OrparEvents Constants Invariants', () => {
        it('all OrparEvents values should be strings starting with "orpar:"', () => {
            const eventValues = Object.values(OrparEvents);

            for (const value of eventValues) {
                expect(typeof value).toBe('string');
                expect(value).toMatch(/^orpar:/);
            }
        });

        it('OrparEvents should include CLEAR_STATE', () => {
            expect(OrparEvents.CLEAR_STATE).toBe('orpar:clearState');
        });

        it('all OrparEvents keys should have corresponding values', () => {
            const keys = Object.keys(OrparEvents);
            const values = Object.values(OrparEvents);

            expect(keys.length).toBe(values.length);
            expect(keys.length).toBeGreaterThan(0);

            // Each key should map to a unique value
            const uniqueValues = new Set(values);
            expect(uniqueValues.size).toBe(values.length);
        });
    });

    describe('Status Response Invariants', () => {
        it('status response should always have required fields', async () => {
            const agentId = 'status-fields-agent';
            const channelId = 'status-fields-channel';
            const allTools = Object.values(ORPAR_TOOL_NAMES);

            const testCases = [
                // Fresh state
                { context: { agentId: 'fresh', channelId: 'fresh', allowedTools: allTools } },
                // After observe
                { context: { agentId, channelId, allowedTools: allTools }, setup: async (ctx: any) => {
                    await orparObserveTool.handler({ observations: 'Test' }, ctx);
                }},
                // Stale state scenario
                { context: { agentId: 'stale', channelId: 'stale', allowedTools: ['orpar_observe', 'orpar_status'] }, setup: async (ctx: any) => {
                    // Create stale state
                    const fullContext = { ...ctx, allowedTools: allTools };
                    await orparObserveTool.handler({ observations: 'Test' }, fullContext);
                    await orparReasonTool.handler({ analysis: 'Test' }, fullContext);
                }},
            ];

            for (const { context, setup } of testCases) {
                if (setup) await setup(context);

                const status = await orparStatusTool.handler({}, context);

                // Required fields
                expect(status).toHaveProperty('currentPhase');
                expect(status).toHaveProperty('nextTool');
                expect(status).toHaveProperty('timestamp');
                expect(status).toHaveProperty('guidance');

                // Types
                expect(typeof status.timestamp).toBe('number');
                expect(typeof status.nextTool).toBe('string');
                expect(typeof status.guidance).toBe('string');
            }

            // Clean up
            for (const { context } of testCases) {
                clearAgentOrparState(context.agentId, context.channelId);
            }
        });
    });

    describe('Edge Case Handling', () => {
        it('should handle concurrent ORPAR cycles from multiple agents', async () => {
            const agentIds = Array.from({ length: 10 }, (_, i) => `concurrent-agent-${i}`);
            const channelId = 'concurrent-channel';
            const allTools = Object.values(ORPAR_TOOL_NAMES);

            // Simulate concurrent operations by not awaiting each one
            const operations = agentIds.map(async (agentId) => {
                const context = { agentId, channelId, allowedTools: allTools };

                // Each agent runs through a complete cycle
                await orparObserveTool.handler({ observations: `Observation from ${agentId}` }, context);
                await orparReasonTool.handler({ analysis: `Analysis from ${agentId}` }, context);
                await orparPlanTool.handler({ plan: `Plan from ${agentId}` }, context);
                await orparActTool.handler({ action: `Action from ${agentId}` }, context);
                await orparReflectTool.handler({ reflection: `Reflection from ${agentId}` }, context);

                const status = await orparStatusTool.handler({}, context);
                return { agentId, status };
            });

            // Run all operations concurrently
            const results = await Promise.all(operations);

            // Verify each agent has independent state
            for (const { agentId, status } of results) {
                expect(status.currentPhase).toBe('reflect');
                expect(status.cycleCount).toBe(0); // First complete cycle
            }

            // Verify state isolation - each agent has separate state
            const states = getAllOrparStates();
            expect(states.size).toBe(agentIds.length);

            // Clean up
            for (const agentId of agentIds) {
                clearAgentOrparState(agentId, channelId);
            }
        });

        it('should handle undefined agentId gracefully', async () => {
            const context = {
                agentId: undefined,
                channelId: 'test-channel',
                allowedTools: Object.values(ORPAR_TOOL_NAMES)
            };

            // Should not throw - uses 'unknown' as fallback
            const status = await orparStatusTool.handler({}, context);
            expect(status).toBeDefined();
            expect(status.currentPhase).toBe('none');

            // Clean up any state created with 'unknown' agent
            clearAgentOrparState('unknown', 'test-channel');
        });

        it('should handle null context gracefully', async () => {
            // Should not throw with null context
            const status = await orparStatusTool.handler({}, null);
            expect(status).toBeDefined();
            expect(status.currentPhase).toBe('none');
        });

        it('should handle non-array allowedTools gracefully', async () => {
            const context = {
                agentId: 'array-test-agent',
                channelId: 'array-test-channel',
                allowedTools: 'not-an-array' as any // Invalid type
            };

            // Should not throw - Array.isArray check handles this
            const status = await orparStatusTool.handler({}, context);
            expect(status).toBeDefined();

            // Clean up
            clearAgentOrparState('array-test-agent', 'array-test-channel');
        });

        it('should handle rapid phase transitions without state corruption', async () => {
            const agentId = 'rapid-transition-agent';
            const channelId = 'rapid-transition-channel';
            const allTools = Object.values(ORPAR_TOOL_NAMES);
            const context = { agentId, channelId, allowedTools: allTools };

            // Run 5 complete cycles rapidly
            for (let cycle = 0; cycle < 5; cycle++) {
                await orparObserveTool.handler({ observations: `Cycle ${cycle}` }, context);
                await orparReasonTool.handler({ analysis: `Cycle ${cycle}` }, context);
                await orparPlanTool.handler({ plan: `Cycle ${cycle}` }, context);
                await orparActTool.handler({ action: `Cycle ${cycle}` }, context);
                await orparReflectTool.handler({ reflection: `Cycle ${cycle}` }, context);
            }

            const status = await orparStatusTool.handler({}, context);

            // Should have completed 4 full cycles (cycleCount increments on second observe)
            expect(status.cycleCount).toBe(4);
            expect(status.currentPhase).toBe('reflect');

            // Clean up
            clearAgentOrparState(agentId, channelId);
        });
    });

    describe('Memory Leak Prevention', () => {
        it('clearAllAgentOrparStates should remove all states for an agent', async () => {
            const { clearAllAgentOrparStates } = await import('@mxf/shared/protocols/mcp/tools/OrparTools');

            const agentId = 'multi-channel-agent';
            const channels = ['channel-1', 'channel-2', 'channel-3'];
            const allTools = Object.values(ORPAR_TOOL_NAMES);

            // Create state in multiple channels
            for (const channelId of channels) {
                const context = { agentId, channelId, allowedTools: allTools };
                await orparObserveTool.handler({ observations: 'Test' }, context);
            }

            // Verify state exists
            let states = getAllOrparStates();
            const agentStates = Array.from(states.keys()).filter(k => k.startsWith(agentId));
            expect(agentStates.length).toBe(3);

            // Clear all states for this agent
            const clearedCount = clearAllAgentOrparStates(agentId);
            expect(clearedCount).toBe(3);

            // Verify all states are gone
            states = getAllOrparStates();
            const remainingStates = Array.from(states.keys()).filter(k => k.startsWith(agentId));
            expect(remainingStates.length).toBe(0);
        });
    });
});
