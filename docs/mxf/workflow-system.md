# Workflow Contracts

MXF currently provides declarative workflow **types** in
`@mxf-dev/core/types/WorkflowTypes`. It does not ship
`SequentialWorkflowAgent`, `ParallelWorkflowAgent`, `LoopWorkflowAgent`, or a public
`WorkflowExecutionEngine`. Setting `WORKFLOW_SYSTEM_ENABLED` does not create those
missing runtime classes.

Use these interfaces when an application owns the executor or persists workflow
definitions for another service:

```typescript
import type {
    WorkflowDefinition,
    WorkflowState,
    WorkflowStep
} from '@mxf-dev/core/types/WorkflowTypes';

const steps: WorkflowStep[] = [
    {
        id: 'collect-evidence',
        name: 'Collect evidence',
        type: 'tool_execution',
        config: {
            tool: 'run_full_test_suite',
            parameters: {}
        },
        dependencies: []
    },
    {
        id: 'review-evidence',
        name: 'Review evidence',
        type: 'validation',
        config: {},
        dependencies: ['collect-evidence']
    }
];

const workflow: WorkflowDefinition = {
    id: 'release-proof',
    name: 'Release proof',
    version: '1.0.0',
    steps,
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: 'release-coordinator'
};
```

This constructs data only; it does not execute the steps.

## Executable orchestration in MXF

For workflows that MXF should execute today, use the implemented task, plan, and DAG
surfaces:

- `agent.mxfService.createTask()` for acknowledged participant-bound work;
- planning MCP tools for ordered plan items and progress;
- task DAG tools for dependency validation and topological readiness;
- public task events for assignment and terminal outcomes.

```typescript
const taskId = await coordinator.mxfService.createTask({
    title: 'Collect release evidence',
    description: 'Run the build and test proof requested by the release coordinator',
    assignedAgentIds: ['verification-agent'],
    assignmentScope: 'single',
    assignmentStrategy: 'manual'
});
```

Do not import `@mxf-dev/sdk/agents`: that subpath is intentionally absent from the
published SDK. A future workflow runtime should receive its own implementation,
lifecycle tests, and explicit root export before documentation presents it as
executable.
