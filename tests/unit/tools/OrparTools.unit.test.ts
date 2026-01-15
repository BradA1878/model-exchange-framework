/**
 * Unit tests for OrparTools state management
 * Tests ORPAR state tracking, stale state detection, and state clearing
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

describe('OrparTools State Management', () => {
    const testAgentId = 'test-agent-123';
    const testChannelId = 'test-channel-456';

    // Clean up state before each test
    beforeEach(() => {
        clearAgentOrparState(testAgentId, testChannelId);
    });

    describe('clearAgentOrparState', () => {
        it('should clear state for a specific agent and channel', async () => {
            // First, create some state by calling orpar_observe
            const context = {
                agentId: testAgentId,
                channelId: testChannelId,
                allowedTools: ['orpar_observe', 'orpar_reason']
            };

            await orparObserveTool.handler({ observations: 'Test observation' }, context);

            // Verify state exists
            const statesBefore = getAllOrparStates();
            const key = `${testAgentId}:${testChannelId}`;
            expect(statesBefore.has(key)).toBe(true);

            // Clear state
            clearAgentOrparState(testAgentId, testChannelId);

            // Verify state is gone
            const statesAfter = getAllOrparStates();
            expect(statesAfter.has(key)).toBe(false);
        });

        it('should not throw when clearing non-existent state', () => {
            expect(() => {
                clearAgentOrparState('non-existent-agent', 'non-existent-channel');
            }).not.toThrow();
        });

        it('should only clear state for the specified agent/channel combo', async () => {
            const agent1 = 'agent-1';
            const agent2 = 'agent-2';
            const channel = 'shared-channel';

            // Create state for both agents
            await orparObserveTool.handler(
                { observations: 'Agent 1 observation' },
                { agentId: agent1, channelId: channel, allowedTools: ['orpar_observe'] }
            );
            await orparObserveTool.handler(
                { observations: 'Agent 2 observation' },
                { agentId: agent2, channelId: channel, allowedTools: ['orpar_observe'] }
            );

            // Clear only agent1's state
            clearAgentOrparState(agent1, channel);

            // Verify agent1's state is gone but agent2's remains
            const states = getAllOrparStates();
            expect(states.has(`${agent1}:${channel}`)).toBe(false);
            expect(states.has(`${agent2}:${channel}`)).toBe(true);

            // Clean up
            clearAgentOrparState(agent2, channel);
        });
    });

    describe('orpar_status stale state detection', () => {
        it('should detect stale state when orpar_observe is allowed but current phase tool is not', async () => {
            // Create state at 'plan' phase
            const context = {
                agentId: testAgentId,
                channelId: testChannelId,
                allowedTools: ['orpar_observe', 'orpar_reason', 'orpar_plan', 'orpar_act']
            };

            await orparObserveTool.handler({ observations: 'Test observation' }, context);
            await orparReasonTool.handler({ analysis: 'Test analysis' }, context);
            await orparPlanTool.handler({ plan: 'Test plan' }, context);

            // Now check status with phase-gated tools (orpar_observe allowed, but orpar_act not)
            const staleContext = {
                agentId: testAgentId,
                channelId: testChannelId,
                allowedTools: ['orpar_observe', 'orpar_status']  // orpar_plan (current phase tool) not allowed
            };

            const statusResult = await orparStatusTool.handler({}, staleContext);

            // Should detect stale state and reset
            expect(statusResult.currentPhase).toBe('none');
            expect(statusResult.nextTool).toBe('orpar_observe');
            expect(statusResult.note).toContain('Previous cycle state cleared');
        });

        it('should NOT reset state when current phase tool IS allowed', async () => {
            const context = {
                agentId: testAgentId,
                channelId: testChannelId,
                allowedTools: ['orpar_observe', 'orpar_reason']
            };

            await orparObserveTool.handler({ observations: 'Test observation' }, context);

            // Check status with orpar_reason still allowed (the next tool after observe)
            const statusResult = await orparStatusTool.handler({}, context);

            // Should NOT reset - state is valid
            expect(statusResult.currentPhase).toBe('observe');
            expect(statusResult.nextTool).toBe('orpar_reason');
            expect(statusResult.note).toBeUndefined();
        });

        it('should return fresh state when no prior state exists', async () => {
            const context = {
                agentId: 'fresh-agent',
                channelId: 'fresh-channel',
                allowedTools: ['orpar_observe', 'orpar_status']
            };

            const statusResult = await orparStatusTool.handler({}, context);

            expect(statusResult.currentPhase).toBe('none');
            expect(statusResult.nextTool).toBe('orpar_observe');
            expect(statusResult.guidance).toContain('not started');

            // Clean up
            clearAgentOrparState('fresh-agent', 'fresh-channel');
        });
    });

    describe('getAllOrparStates', () => {
        it('should return a copy of the state map', async () => {
            const context = {
                agentId: testAgentId,
                channelId: testChannelId,
                allowedTools: ['orpar_observe']
            };

            await orparObserveTool.handler({ observations: 'Test' }, context);

            const states1 = getAllOrparStates();
            const states2 = getAllOrparStates();

            // Should be different Map instances
            expect(states1).not.toBe(states2);

            // But should have same content
            expect(states1.size).toBe(states2.size);
        });
    });

    describe('ORPAR phase transitions', () => {
        it('should track phase progression through complete cycle', async () => {
            const context = {
                agentId: testAgentId,
                channelId: testChannelId,
                allowedTools: Object.values(ORPAR_TOOL_NAMES)
            };

            // Complete full ORPAR cycle
            await orparObserveTool.handler({ observations: 'Test observation' }, context);
            let status = await orparStatusTool.handler({}, context);
            expect(status.currentPhase).toBe('observe');

            await orparReasonTool.handler({ analysis: 'Test reasoning' }, context);
            status = await orparStatusTool.handler({}, context);
            expect(status.currentPhase).toBe('reason');

            await orparPlanTool.handler({ plan: 'Test plan' }, context);
            status = await orparStatusTool.handler({}, context);
            expect(status.currentPhase).toBe('plan');

            await orparActTool.handler({ action: 'Test action' }, context);
            status = await orparStatusTool.handler({}, context);
            expect(status.currentPhase).toBe('act');

            await orparReflectTool.handler({ reflection: 'Test reflection' }, context);
            status = await orparStatusTool.handler({}, context);
            expect(status.currentPhase).toBe('reflect');
            expect(status.nextTool).toBe('task_complete');
        });

        it('should reject invalid phase transitions', async () => {
            const context = {
                agentId: testAgentId,
                channelId: testChannelId,
                allowedTools: Object.values(ORPAR_TOOL_NAMES)
            };

            // Try to act without observing first
            const result = await orparActTool.handler({ action: 'Premature action' }, context);

            expect(result.success).toBe(false);
            expect(result.error).toContain('Invalid ORPAR transition');
        });

        it('should track cycle count across multiple cycles', async () => {
            const context = {
                agentId: testAgentId,
                channelId: testChannelId,
                allowedTools: Object.values(ORPAR_TOOL_NAMES)
            };

            // First cycle - cycle count starts at 0 and stays 0 until second observe
            await orparObserveTool.handler({ observations: 'Cycle 1 observation' }, context);
            await orparReasonTool.handler({ analysis: 'Cycle 1 reasoning' }, context);
            await orparPlanTool.handler({ plan: 'Cycle 1 plan' }, context);
            await orparActTool.handler({ action: 'Cycle 1 action' }, context);
            await orparReflectTool.handler({ reflection: 'Cycle 1 reflection' }, context);

            let status = await orparStatusTool.handler({}, context);
            // After first complete cycle, cycleCount is still 0 (increments on NEXT observe)
            expect(status.cycleCount).toBe(0);

            // Start second cycle - this increments the cycle count
            await orparObserveTool.handler({ observations: 'Cycle 2 observation' }, context);

            status = await orparStatusTool.handler({}, context);
            // Now cycleCount should be 1 (incremented when second observe was called)
            expect(status.cycleCount).toBe(1);

            // Complete second cycle
            await orparReasonTool.handler({ analysis: 'Cycle 2 reasoning' }, context);
            await orparPlanTool.handler({ plan: 'Cycle 2 plan' }, context);
            await orparActTool.handler({ action: 'Cycle 2 action' }, context);
            await orparReflectTool.handler({ reflection: 'Cycle 2 reflection' }, context);

            // Start third cycle
            await orparObserveTool.handler({ observations: 'Cycle 3 observation' }, context);

            status = await orparStatusTool.handler({}, context);
            expect(status.cycleCount).toBe(2);
        });
    });

    describe('context handling', () => {
        it('should handle context with _agentId prefix', async () => {
            const context = {
                _agentId: testAgentId,
                _channelId: testChannelId,
                allowedTools: ['orpar_observe', 'orpar_status']
            };

            await orparObserveTool.handler({ observations: 'Test' }, context);
            const status = await orparStatusTool.handler({}, context);

            expect(status.currentPhase).toBe('observe');
        });

        it('should handle missing context gracefully', async () => {
            // orpar_status should still work with minimal context
            const result = await orparStatusTool.handler({}, {});

            expect(result).toBeDefined();
            expect(result.currentPhase).toBe('none');
        });

        it('should handle empty allowedTools array', async () => {
            const context = {
                agentId: testAgentId,
                channelId: testChannelId,
                allowedTools: []
            };

            // Create state first
            await orparObserveTool.handler(
                { observations: 'Test' },
                { ...context, allowedTools: ['orpar_observe'] }
            );

            // Check status with empty allowedTools - should NOT trigger stale detection
            // because we can't determine if orpar_observe is allowed
            const result = await orparStatusTool.handler({}, context);

            // With empty allowedTools, stale detection doesn't trigger
            expect(result.currentPhase).toBe('observe');
        });
    });
});
