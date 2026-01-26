# Agent Dev Kit / Workflow System Documentation

> **Feature Flag:** `WORKFLOW_SYSTEM_ENABLED`

## Overview

The Workflow System provides structured, step-by-step execution patterns for MXF agents. It extends the base `MxfAgent` class with workflow capabilities including sequential, parallel, and loop execution patterns.

## Architecture

### Core Components

1. **WorkflowAgent** - Base class with workflow execution infrastructure
2. **SequentialWorkflowAgent** - Steps execute one at a time in order
3. **ParallelWorkflowAgent** - Steps execute concurrently where dependencies allow
4. **LoopWorkflowAgent** - Steps repeat until a condition is met
5. **WorkflowExecutionEngine** - Server-side orchestration and state management
6. **EvaluationService** - Agent performance metrics and safety validation

### Workflow Types

```typescript
import {
  WorkflowDefinition,
  WorkflowStep,
  WorkflowState
} from '@mxf/shared/types/WorkflowTypes';
```

## Usage Examples

### Sequential Workflow

Perfect for data processing pipelines and multi-step validation:

```typescript
import { SequentialWorkflowAgent } from '@mxf/sdk/agents';
import { WorkflowDefinition } from '@mxf/shared/types/WorkflowTypes';

const workflow: WorkflowDefinition = {
  id: 'data-processing-pipeline',
  name: 'Data Processing Pipeline',
  version: '1.0.0',
  steps: [
    {
      id: 'fetch-data',
      name: 'Fetch Data',
      type: 'tool_execution',
      config: {
        tool: 'web_fetch',
        parameters: { url: 'https://api.example.com/data' }
      },
      dependencies: [],
      timeout: 5000
    },
    {
      id: 'validate-data',
      name: 'Validate Data',
      type: 'validation',
      config: {},
      dependencies: ['fetch-data']
    },
    {
      id: 'process-data',
      name: 'Process Data',
      type: 'tool_execution',
      config: {
        tool: 'data_transform',
        parameters: {}
      },
      dependencies: ['validate-data']
    }
  ],
  createdAt: new Date(),
  updatedAt: new Date(),
  createdBy: 'system'
};

const agent = new SequentialWorkflowAgent({
  id: 'processor-agent',
  name: 'Data Processor',
  workflow,
  apiKey: process.env.AGENT_API_KEY
});

await agent.connect();
const result = await agent.startWorkflow();
console.log('Workflow completed:', result.success);
```

### Parallel Workflow

Optimal for concurrent API calls and multi-source data fetching:

```typescript
import { ParallelWorkflowAgent } from '@mxf/sdk/agents';

const workflow: WorkflowDefinition = {
  id: 'multi-source-fetch',
  name: 'Multi-Source Data Fetch',
  version: '1.0.0',
  steps: [
    {
      id: 'fetch-api-1',
      name: 'Fetch from API 1',
      type: 'tool_execution',
      config: {
        tool: 'web_fetch',
        parameters: { url: 'https://api1.example.com' }
      },
      dependencies: [] // No dependencies - can run in parallel
    },
    {
      id: 'fetch-api-2',
      name: 'Fetch from API 2',
      type: 'tool_execution',
      config: {
        tool: 'web_fetch',
        parameters: { url: 'https://api2.example.com' }
      },
      dependencies: [] // No dependencies - can run in parallel
    },
    {
      id: 'merge-results',
      name: 'Merge Results',
      type: 'tool_execution',
      config: {
        tool: 'data_merge'
      },
      dependencies: ['fetch-api-1', 'fetch-api-2'] // Waits for both fetches
    }
  ],
  createdAt: new Date(),
  updatedAt: new Date(),
  createdBy: 'system'
};

const agent = new ParallelWorkflowAgent({
  id: 'parallel-fetcher',
  name: 'Parallel Data Fetcher',
  workflow
});

await agent.connect();
const result = await agent.startWorkflow();

// Check execution plan
const plan = agent.getExecutionPlan();
console.log('Execution groups:', plan);
// Output: Group 0: [fetch-api-1, fetch-api-2], Group 1: [merge-results]
```

### Loop Workflow

Ideal for batch processing and iterative operations:

```typescript
import { LoopWorkflowAgent } from '@mxf/sdk/agents';

const workflow: WorkflowDefinition = {
  id: 'batch-processor',
  name: 'Batch Data Processor',
  version: '1.0.0',
  steps: [
    {
      id: 'fetch-batch',
      name: 'Fetch Batch',
      type: 'tool_execution',
      config: {
        tool: 'fetch_next_batch'
      },
      dependencies: []
    },
    {
      id: 'process-batch',
      name: 'Process Batch',
      type: 'tool_execution',
      config: {
        tool: 'process_batch'
      },
      dependencies: ['fetch-batch']
    }
  ],
  createdAt: new Date(),
  updatedAt: new Date(),
  createdBy: 'system'
};

const agent = new LoopWorkflowAgent({
  id: 'batch-processor',
  name: 'Batch Processor',
  workflow,
  maxIterations: 10,
  minIterations: 1,
  breakOnFailure: true,
  loopCondition: {
    type: 'expression',
    expression: 'hasMoreBatches',
    variables: {}
  }
});

await agent.connect();
const result = await agent.startWorkflow();

console.log('Processed batches:', result.output.iterations);
```

## Workflow Step Types

### Tool Execution
Execute an MCP tool:
```typescript
{
  type: 'tool_execution',
  config: {
    tool: 'tool_name',
    parameters: { /* tool params */ }
  }
}
```

### LLM Call
Call SystemLLM for reasoning:
```typescript
{
  type: 'llm_call',
  config: {
    prompt: 'Analyze this data...'
  }
}
```

### Decision
Conditional branching:
```typescript
{
  type: 'decision',
  config: {
    branches: [
      {
        condition: { type: 'expression', expression: 'value > 10' },
        steps: ['step-a', 'step-b']
      },
      {
        condition: { type: 'expression', expression: 'value <= 10' },
        steps: ['step-c']
      }
    ]
  }
}
```

### Validation
Validate workflow state:
```typescript
{
  type: 'validation',
  config: {}
}
```

### Wait
Pause execution:
```typescript
{
  type: 'wait',
  config: {
    wait: {
      type: 'duration',
      duration: 1000 // 1 second
    }
  }
}
```

### Custom
Custom handler:
```typescript
{
  type: 'custom',
  config: {
    handler: 'my_custom_handler'
  }
}
```

## Error Handling and Retry

### Retry Policy

```typescript
const step: WorkflowStep = {
  id: 'api-call',
  name: 'API Call',
  type: 'tool_execution',
  config: { /* ... */ },
  dependencies: [],
  retryPolicy: {
    maxAttempts: 3,
    initialDelay: 1000,      // 1 second
    backoffMultiplier: 2,    // Exponential backoff
    maxDelay: 10000,         // Max 10 seconds
    retryOnErrors: ['TIMEOUT', 'NETWORK_ERROR']
  },
  timeout: 5000
};
```

### Condition Evaluation

```typescript
const condition: WorkflowCondition = {
  type: 'expression',
  expression: 'status === "completed"',
  variables: {
    status: 'completed'
  }
};
```

## State Management

### Workflow State

```typescript
interface WorkflowState {
  currentStep?: string;
  completedSteps: string[];
  failedSteps: string[];
  stepOutputs: Map<string, unknown>;
  variables: Record<string, unknown>;
  status: WorkflowStatus;
  error?: WorkflowError;
  startedAt?: Date;
  completedAt?: Date;
}
```

### Pause/Resume

```typescript
// Pause workflow
agent.pauseWorkflow();

// Resume workflow
agent.resumeWorkflow();

// Cancel workflow
agent.cancelWorkflow();

// Get current state
const state = agent.getWorkflowState();
```

## Evaluation and Monitoring

### Performance Evaluation

```typescript
import { EvaluationService } from '@mxf/server/services/EvaluationService';

const evaluationService = EvaluationService.getInstance();

// Evaluate agent performance
const result = await evaluationService.evaluateAgent('agent-id', {
  includePerformance: true,
  includeSafety: true,
  includeBehavior: true,
  timePeriod: {
    start: new Date('2024-01-01'),
    end: new Date()
  }
});

console.log('Overall score:', result.overallScore);
console.log('Task completion rate:', result.metrics?.taskCompletionRate);
console.log('Recommendations:', result.recommendations);
```

### Metrics

```typescript
interface PerformanceMetrics {
  averageResponseTime: number;
  taskCompletionRate: number;
  errorRate: number;
  accuracyScore: number;
  consistencyScore: number;
  totalTasks: number;
  successfulTasks: number;
  failedTasks: number;
}
```

## Workflow Execution Engine

Server-side workflow orchestration:

```typescript
import { WorkflowExecutionEngine } from '@mxf/server/services/WorkflowExecutionEngine';

const engine = WorkflowExecutionEngine.getInstance();

// Register workflow
engine.registerWorkflow(workflowDefinition);

// Create execution context
const context = engine.createExecutionContext(
  'workflow-id',
  'agent-id',
  'channel-id'
);

// Update execution state
engine.updateExecutionState(executionId, state);

// Complete execution
engine.completeExecution(executionId, result);

// Get analytics
const analytics = engine.getAnalytics('workflow-id');
console.log('Success rate:', analytics.successRate);
```

## Workflow Templates

### Register Template

```typescript
const template: WorkflowTemplate = {
  id: 'api-integration-template',
  name: 'API Integration Template',
  description: 'Template for API integration workflows',
  category: 'integration',
  tags: ['api', 'integration'],
  workflow: {
    name: 'API Integration',
    version: '1.0.0',
    steps: [ /* ... */ ]
  },
  parameters: [
    {
      name: 'apiUrl',
      description: 'API endpoint URL',
      type: 'string',
      required: true
    }
  ],
  builtIn: true
};

engine.registerTemplate(template);
```

### Create from Template

```typescript
const workflow = engine.createWorkflowFromTemplate(
  'api-integration-template',
  { apiUrl: 'https://api.example.com' },
  'agent-id'
);
```

## Framework Adapters

Integrate external AI framework tools:

```typescript
import { FrameworkAdapter } from '@mxf/shared/adapters/FrameworkAdapter';

class LangChainAdapter extends FrameworkAdapter {
  readonly frameworkName = 'langchain';
  readonly supportedToolTypes = ['function', 'retrieval', 'search'];

  async discoverTools(): Promise<ExternalTool[]> {
    // Discover tools from LangChain
    return [];
  }

  async adaptTool(externalTool: ExternalTool): Promise<McpTool> {
    // Convert LangChain tool to MCP format
    return {
      name: externalTool.name,
      description: externalTool.description,
      inputSchema: this.convertToJsonSchema(externalTool.inputSchema)
    };
  }

  async executeExternalTool(context: ToolExecutionContext): Promise<ToolExecutionResult> {
    // Execute tool in LangChain
    return {
      success: true,
      data: {},
      duration: 0
    };
  }
}
```

## Events

Workflow system emits events for monitoring:

```typescript
import { Events } from '@mxf/shared/events/EventNames';

eventBus.on(Events.Workflow.WORKFLOW_STARTED, (data) => {
  console.log('Workflow started:', data.workflowId);
});

eventBus.on(Events.Workflow.STEP_COMPLETED, (data) => {
  console.log('Step completed:', data.stepId, data.duration);
});

eventBus.on(Events.Workflow.WORKFLOW_COMPLETED, (data) => {
  console.log('Workflow completed:', data.success, data.duration);
});
```

## Best Practices

1. **Use Sequential for Simple Pipelines**: When steps must run in order
2. **Use Parallel for Independent Operations**: Maximize concurrency
3. **Use Loop for Batch Processing**: Process data in iterations
4. **Set Appropriate Timeouts**: Prevent indefinite waiting
5. **Configure Retry Policies**: Handle transient failures
6. **Monitor Performance**: Use EvaluationService regularly
7. **Validate Dependencies**: Ensure workflow can execute
8. **Handle Errors Gracefully**: Use breakOnFailure appropriately

## Integration with Existing MXF

The workflow system integrates seamlessly with:

- **TaskService**: Workflow-aware task assignment
- **ControlLoopService**: ORPAR workflow execution
- **EventBus**: Real-time workflow monitoring
- **AgentService**: Workflow agent registration
- **Analytics**: Performance tracking

## Future Enhancements

Planned improvements:

1. Visual workflow designer in dashboard
2. More framework adapters (CrewAI, AutoGen)
3. Workflow versioning and rollback
4. A/B testing for workflow variants
5. ML-based workflow optimization
6. Workflow composition and nesting
7. Real-time collaboration on workflows

## Troubleshooting

### Common Issues

**Circular Dependencies**
```
Error: Circular dependency detected involving step: step-id
```
Solution: Review step dependencies and ensure no cycles exist.

**Timeout Errors**
```
Error: Step step-id timed out after 5000ms
```
Solution: Increase timeout or optimize step execution.

**Missing Dependencies**
```
Error: Dependencies not met for step step-id
```
Solution: Ensure all dependent steps are defined and executable.

## API Reference

See full API documentation at:
- `/docs/api/workflow-agent.md`
- `/docs/api/workflow-execution-engine.md`
- `/docs/api/evaluation-service.md`
