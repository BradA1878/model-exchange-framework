import { WorkflowExecutionEngine } from '../../../src/server/services/WorkflowExecutionEngine';
import { WorkflowDefinition } from '@mxf-dev/core/types/WorkflowTypes';
import { types } from 'node:util';

describe('WorkflowExecutionEngine initial-state isolation', () => {
    it('copies nested state for each execution while preserving Maps and Dates', () => {
        const engine = WorkflowExecutionEngine.getInstance();
        const definition: WorkflowDefinition = {
            id: 'isolated-initial-state',
            name: 'State isolation',
            version: '1',
            steps: [],
            createdAt: new Date(),
            updatedAt: new Date(),
            createdBy: 'test-agent',
            initialState: {
                completedSteps: [],
                failedSteps: [],
                stepOutputs: new Map([['seed', { values: [1] }]]),
                variables: { nested: { values: [1] } },
                status: 'pending',
                startedAt: new Date(123)
            }
        };
        engine.registerWorkflow(definition);
        const first = engine.createExecutionContext(definition.id, 'first')!;
        const second = engine.createExecutionContext(definition.id, 'second')!;

        first.state.completedSteps.push('completed');
        (first.state.stepOutputs.get('seed') as { values: number[] }).values.push(2);
        (first.state.variables.nested as { values: number[] }).values.push(2);
        first.state.startedAt!.setTime(456);

        for (const untouched of [second.state, definition.initialState!]) {
            expect(untouched.completedSteps).toEqual([]);
            // Native structuredClone can return values from another VM realm in Jest.
            expect(types.isMap(untouched.stepOutputs)).toBe(true);
            expect(untouched.stepOutputs.get('seed')).toEqual({ values: [1] });
            expect(untouched.variables.nested).toEqual({ values: [1] });
            expect(types.isDate(untouched.startedAt)).toBe(true);
            expect(untouched.startedAt!.getTime()).toBe(123);
        }
    });
});
