# Analytics MCP Tools Reference

MXF provides a comprehensive set of MCP (Model Context Protocol) tools that enable agents to directly access analytics, monitor their own performance, and optimize their operations. These tools are designed for agent self-service and autonomous performance improvement.

## Tool Categories

### Task Effectiveness Tools
- [task_effectiveness_start](#task_effectiveness_start)
- [task_effectiveness_event](#task_effectiveness_event)
- [task_effectiveness_quality](#task_effectiveness_quality)
- [task_effectiveness_complete](#task_effectiveness_complete)
- [task_effectiveness_analytics](#task_effectiveness_analytics)
- [task_effectiveness_compare](#task_effectiveness_compare)

### Validation Analytics Tools
- [analytics_aggregate](#analytics_aggregate)
- [analytics_trends](#analytics_trends)
- [analytics_roi](#analytics_roi)

### Performance Tools
- [performance_bottlenecks](#performance_bottlenecks)
- [performance_profile](#performance_profile)
- [optimization_auto_tune](#optimization_auto_tune)

### Predictive Analytics Tools
- [predict_errors](#predict_errors)
- [detect_anomalies](#detect_anomalies)
- [risk_assessment](#risk_assessment)
- [proactive_insights](#proactive_insights)

---

## Task Effectiveness Tools

### task_effectiveness_start

Start tracking effectiveness metrics for a new task.

**Parameters:**
```typescript
{
  taskType: string;              // Type of task (e.g., "research", "analysis", "development")
  description: string;           // Human-readable description of the task
  successCriteria?: {            // Optional success criteria
    required: string[];          // Required outcomes for success
    optional: string[];          // Optional/bonus outcomes  
  };
  baselineMetrics?: {            // Optional baseline for comparison
    completionTime: number;      // Baseline completion time in ms
    humanInterventions: number;  // Expected human interventions
  };
}
```

**Response:**
```typescript
{
  success: true,
  taskId: string;                // Unique task ID for tracking
  message: string;               // Confirmation message
  trackingStarted: number;       // Start timestamp
}
```

**Example Usage:**
```javascript
const result = await agent.executeTool('task_effectiveness_start', {
  taskType: 'data_analysis',
  description: 'Analyze customer churn patterns from Q4 data',
  successCriteria: {
    required: [
      'Identify top 3 churn factors',
      'Calculate churn rate by segment',
      'Generate actionable recommendations'
    ],
    optional: [
      'Predict future churn trends',
      'Customer retention strategies'
    ]
  },
  baselineMetrics: {
    completionTime: 5400000,     // 90 minutes human baseline
    humanInterventions: 2
  }
});

const taskId = result.taskId;    // Use for subsequent tracking
```

### task_effectiveness_event

Record significant events during task execution.

**Parameters:**
```typescript
{
  taskId: string;                // Task ID from task_effectiveness_start
  eventType: 'step' | 'tool_use' | 'milestone' | 'error' | 'human_input' | 'agent_join';
  details?: object;              // Event-specific details
}
```

**Response:**
```typescript
{
  success: true,
  message: string;               // Confirmation message
  eventId: string;               // Unique event ID
}
```

**Example Usage:**
```javascript
// Record tool usage
await agent.executeTool('task_effectiveness_event', {
  taskId: 'task-123',
  eventType: 'tool_use',
  details: {
    toolName: 'data_analyzer',
    success: true,
    duration: 3200,
    recordsProcessed: 15000
  }
});

// Record milestone completion
await agent.executeTool('task_effectiveness_event', {
  taskId: 'task-123',
  eventType: 'milestone',
  details: {
    milestone: 'data_preprocessing_complete',
    completeness: 0.4
  }
});
```

### task_effectiveness_quality

Update quality metrics for the current task.

**Parameters:**
```typescript
{
  taskId: string;                // Task ID to update
  completenessScore?: number;    // How complete is the task (0-1)
  iterationCount?: number;       // Number of iterations/revisions
  customMetrics?: Record<string, number>; // Custom quality metrics
}
```

**Response:**
```typescript
{
  success: true,
  message: string;               // Confirmation message
  updates: object;               // Applied updates
}
```

**Example Usage:**
```javascript
await agent.executeTool('task_effectiveness_quality', {
  taskId: 'task-123',
  completenessScore: 0.75,       // 75% complete
  iterationCount: 2,             // Made 2 revisions
  customMetrics: {
    dataAccuracy: 0.94,          // 94% data accuracy
    insightDepth: 0.82,          // Insight quality score
    visualizationsCreated: 5     // Number of charts/graphs
  }
});
```

### task_effectiveness_complete

Complete task tracking and get effectiveness summary.

**Parameters:**
```typescript
{
  taskId: string;                // Task ID to complete
  success: boolean;              // Was the primary goal achieved?
  customMetrics?: Record<string, number>; // Final custom metrics
}
```

**Response:**
```typescript
{
  success: true,
  message: string;
  metrics: {
    completionTime: number;      // Total task duration
    autonomyScore: number;       // Autonomy score (0-1)
    toolsUsed: number;          // Total tools used
    errorCount: number;         // Errors encountered
    overallScore: number;       // Composite effectiveness score
  };
  comparison?: {                 // Baseline comparison (if available)
    speedImprovement: string;    // "45.2%" improvement
    achievements: string[];      // What went well
    recommendations: string[];   // Suggestions for improvement
  };
}
```

**Example Usage:**
```javascript
const completion = await agent.executeTool('task_effectiveness_complete', {
  taskId: 'task-123',
  success: true,
  customMetrics: {
    finalAccuracy: 0.96,
    recommendationsGenerated: 8,
    stakeholderSatisfaction: 0.89
  }
});

console.log(`Task completed with ${completion.metrics.overallScore}% effectiveness`);
if (completion.comparison) {
  console.log(`${completion.comparison.speedImprovement} faster than baseline`);
}
```

### task_effectiveness_analytics

Get effectiveness analytics for completed tasks in a time period.

**Parameters:**
```typescript
{
  timeRange: 'hour' | 'day' | 'week' | 'month'; // Time range to analyze
  taskType?: string;             // Optional: filter by task type
}
```

**Response:**
```typescript
{
  success: true,
  timeRange: string;
  analytics: {
    taskTypes: Array<{
      type: string;
      count: number;
      avgCompletionTime: string;   // "45.2s"
      successRate: string;         // "91.2%"
      avgAutonomy: string;         // "84.5%"
    }>;
    patterns: {
      highPerformance: string[];   // High-performing task types
      needsImprovement: string[];  // Low-performing task types
    };
  };
}
```

**Example Usage:**
```javascript
const analytics = await agent.executeTool('task_effectiveness_analytics', {
  timeRange: 'week',
  taskType: 'analysis'           // Optional filter
});

console.log('Weekly Performance Summary:');
analytics.analytics.taskTypes.forEach(type => {
  console.log(`${type.type}: ${type.count} tasks, ${type.successRate} success rate`);
});
```

### task_effectiveness_compare

Compare current task performance with previous similar tasks.

**Parameters:**
```typescript
{
  taskId: string;                // Task ID to compare
}
```

**Response:**
```typescript
{
  success: true,
  comparison: {
    currentScore: number;        // Current task score
    improvements: {
      speed: string;             // "23.5%" improvement
      autonomy: string;          // "15.2%" improvement
      quality: string;           // "8.7%" improvement
    };
    achievements: string[];      // What went well
    areasToImprove: string[];   // Areas needing improvement
    recommendations: string[];   // Specific suggestions
  };
}
```

---

## Validation Analytics Tools

### analytics_aggregate

Get aggregated validation metrics and analytics for a time range.

**Parameters:**
```typescript
{
  timeRange?: 'hour' | 'day' | 'week' | 'month' | 'quarter'; // Default: 'day'
  dimensions?: {               // Optional filters
    agentType?: string;
    toolName?: string;
    errorType?: string;
  };
}
```

**Response:**
```typescript
{
  success: true,
  data: {
    validation: {
      totalValidations: number;
      errorRate: number;         // 0-1 error rate
      averageLatency: number;    // ms
    };
    proactive: {
      preventedErrors: number;
      cacheHitRate: number;      // 0-1 cache hit rate
      autoCorrections: number;
    };
    prediction: {
      accuracyRate: number;      // ML model accuracy
      predictionsGenerated: number;
    };
  };
  summary: {
    totalValidations: number;
    errorRate: number;
    preventedErrors: number;
    cacheHitRate: number;
  };
}
```

### analytics_trends

Analyze trends for validation metrics over time with forecasting.

**Parameters:**
```typescript
{
  metric: string;                // Metric to analyze ('error_rate', 'success_rate', etc.)
  timeRange?: 'hour' | 'day' | 'week' | 'month'; // Default: 'day'
  includeForecast?: boolean;     // Include future forecast (default: true)
}
```

**Response:**
```typescript
{
  success: true,
  data: {
    trend: 'increasing' | 'decreasing' | 'stable' | 'volatile';
    changeRate: number;          // % change over period
    confidence: number;          // Statistical confidence
    forecast?: {
      nextPeriods: number[];     // Predicted values
      confidence: number;        // Forecast confidence
    };
    seasonality?: {
      detected: boolean;
      pattern: string;           // 'daily', 'weekly', 'monthly'
    };
  };
  insight: string;               // Human-readable trend insight
}
```

### analytics_roi

Calculate ROI for validation system improvements.

**Parameters:**
```typescript
{
  metric?: string;               // Metric for ROI calculation
  timeRange?: 'week' | 'month' | 'quarter'; // Default: 'month'
  investmentData?: {             // Optional investment data
    development?: number;        // Development hours
    infrastructure?: number;     // Infrastructure hours
    maintenance?: number;        // Maintenance hours
  };
}
```

**Response:**
```typescript
{
  success: true,
  data: {
    roi: number;                 // ROI percentage
    paybackPeriod: number;       // Days to payback
    returns: {
      total: number;             // Total return value
      errorPrevention: number;
      timeSaved: number;
      qualityImprovement: number;
    };
  };
  summary: {
    roi: string;                 // "145.67%"
    paybackPeriod: string;       // "23 days"
    totalReturn: string;         // "$1,245.67"
    recommendation: string;      // ROI interpretation
  };
}
```

---

## Performance Tools

### performance_bottlenecks

Detect performance bottlenecks and get optimization recommendations.

**Parameters:**
```typescript
{
  includeRecommendations?: boolean; // Include optimization recommendations (default: true)
  maxRecommendations?: number;      // Maximum recommendations to return (default: 5)
}
```

**Response:**
```typescript
{
  success: true,
  data: {
    bottlenecks: Array<{
      component: string;
      severity: 'low' | 'medium' | 'high' | 'critical';
      description: string;
      impact: number;            // Performance impact score
      metrics: object;          // Relevant metrics
    }>;
    recommendations: Array<{
      priority: 'low' | 'medium' | 'high' | 'critical';
      title: string;
      description: string;
      estimatedImprovement: number; // % improvement expected
    }>;
  };
  summary: {
    criticalBottlenecks: number;
    highBottlenecks: number;
    topIssue: string;
  };
}
```

### performance_profile

Profile validation performance for optimization insights.

**Parameters:**
```typescript
{
  toolName: string;              // Tool to profile
  parameters: object;            // Sample parameters for profiling
  iterations?: number;           // Number of iterations (default: 10, max: 100)
}
```

**Response:**
```typescript
{
  success: true,
  data: {
    duration: number;            // Total profiling duration (ms)
    iterations: number;          // Number of iterations run
    averageLatency: number;      // Average latency per iteration
    bottlenecks: Array<{         // Identified bottlenecks
      component: string;
      latency: number;
      percentage: number;        // % of total time
    }>;
    recommendations: string[];   // Optimization recommendations
  };
  summary: {
    totalTime: string;           // "1250ms"
    averageTime: string;         // "125.0ms"
    bottlenecks: number;
    recommendations: number;
  };
}
```

### optimization_auto_tune

Enable or configure auto-tuning for performance optimization.

**Parameters:**
```typescript
{
  action: 'enable' | 'disable' | 'status' | 'configure';
  config?: {                     // Configuration for enable/configure actions
    targetLatency?: number;      // Target latency in ms
    targetThroughput?: number;   // Target throughput
    adaptiveThresholds?: boolean; // Enable adaptive thresholds
    tuningInterval?: number;     // Tuning interval in ms
  };
}
```

**Response:**
```typescript
{
  success: true,
  message?: string;              // Action confirmation message
  enabled?: boolean;             // Current enabled status
  config?: {                     // Current configuration
    enabled: boolean;
    targetLatency: number;
    targetThroughput: number;
    adaptiveThresholds: boolean;
    tuningInterval: number;
  };
  metrics?: object;              // Current performance metrics
}
```

---

## Predictive Analytics Tools

### predict_errors

Predict error probability for a tool call using machine learning.

**Parameters:**
```typescript
{
  toolName: string;              // Tool name to predict errors for
  parameters: object;            // Parameters for the tool call
  includeExplanation?: boolean;  // Include explanation (default: true)
}
```

**Response:**
```typescript
{
  success: true,
  data: {
    errorProbability: number;    // 0-1 probability of error
    confidence: number;          // 0-1 confidence in prediction
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
    explanation?: string;        // Human-readable explanation
    model: {
      version: string;
      accuracy: number;          // Model accuracy
      features: string[];        // Features used
    };
  };
  recommendation: string;        // Risk-based recommendation
}
```

**Example Usage:**
```javascript
const prediction = await agent.executeTool('predict_errors', {
  toolName: 'database_query',
  parameters: {
    query: 'SELECT * FROM large_table WHERE complex_condition',
    timeout: 5000
  }
});

if (prediction.data.riskLevel === 'HIGH') {
  console.log(`High risk detected: ${prediction.data.explanation}`);
  console.log(`Recommendation: ${prediction.recommendation}`);
  
  // Take preventive action
  await agent.executeTool('validation_preview', {
    toolName: 'database_query',
    parameters: parameters
  });
}
```

### detect_anomalies

Detect anomalies in tool usage patterns and parameters.

**Parameters:**
```typescript
{
  toolName: string;              // Tool name to check for anomalies
  parameters: object;            // Parameters to analyze
  executionMetrics?: {           // Optional execution metrics
    latency?: number;
    memoryUsage?: number;
    errorType?: string;
  };
}
```

**Response:**
```typescript
{
  success: true,
  data: {
    anomalies: Array<{
      type: 'parameter' | 'usage' | 'performance' | 'pattern';
      severity: 'low' | 'medium' | 'high' | 'critical';
      description: string;
      confidence: number;        // 0-1 confidence in detection
      expectedValue?: any;
      actualValue?: any;
    }>;
    detected: boolean;           // Any anomalies detected
    highSeverity: Array<object>; // High/critical severity anomalies
  };
  summary: string;               // Summary message
}
```

### risk_assessment

Calculate comprehensive risk score for a tool operation.

**Parameters:**
```typescript
{
  toolName: string;              // Tool to assess risk for
  parameters: object;            // Parameters for the operation
  context?: object;              // Additional context
}
```

**Response:**
```typescript
{
  success: true,
  data: {
    overallRisk: number;         // 0-100 risk score
    trend: 'increasing' | 'stable' | 'decreasing';
    riskFactors: Array<{
      factor: string;
      impact: number;            // Impact score
      likelihood: number;        // Likelihood score
    }>;
    mitigation: Array<{          // Risk mitigation strategies
      strategy: string;
      effectiveness: number;     // 0-1 effectiveness
      implementation: string;
    }>;
  };
  summary: {
    overallRisk: string;         // "75%"
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
    trend: string;
    topRiskFactor: string;
  };
  recommendations: string[];     // Top 3 recommendations
}
```

### proactive_insights

Get proactive insights and suggestions based on current context.

**Parameters:**
```typescript
{
  context: {                     // Current context for insights
    currentTool?: string;
    recentTools?: string[];
    currentTask?: string;
    errorHistory?: object[];
  };
  maxSuggestions?: number;       // Maximum suggestions (default: 5)
}
```

**Response:**
```typescript
{
  success: true,
  data: {
    suggestions: Array<{
      type: 'parameter' | 'tool' | 'workflow' | 'optimization';
      confidence: number;        // 0-1 confidence
      title: string;
      description: string;
      impact: 'low' | 'medium' | 'high';
      implementation: string;
    }>;
    totalSuggestions: number;
  };
  insights: string[];            // Key insights summary
}
```

---

## Tool Usage Patterns

### Error Prevention Workflow

```javascript
// 1. Predict errors before execution
const prediction = await agent.executeTool('predict_errors', {
  toolName: 'risky_operation',
  parameters: operationParams
});

// 2. If high risk, use validation preview
if (prediction.data.errorProbability > 0.6) {
  const preview = await agent.executeTool('validation_preview', {
    toolName: 'risky_operation',
    parameters: operationParams
  });
  
  // 3. Apply corrections if needed
  if (!preview.data.valid && preview.data.corrections) {
    operationParams = { ...operationParams, ...preview.data.corrections };
  }
}

// 4. Execute with confidence
const result = await agent.executeTool('risky_operation', operationParams);
```

### Performance Optimization Workflow

```javascript
// 1. Detect bottlenecks
const bottlenecks = await agent.executeTool('performance_bottlenecks', {
  includeRecommendations: true
});

// 2. Profile specific operations
for (const bottleneck of bottlenecks.data.bottlenecks) {
  if (bottleneck.severity === 'high' || bottleneck.severity === 'critical') {
    const profile = await agent.executeTool('performance_profile', {
      toolName: bottleneck.component,
      parameters: sampleParams,
      iterations: 20
    });
    
    console.log(`${bottleneck.component} profile:`, profile.summary);
  }
}

// 3. Enable auto-tuning for optimization
await agent.executeTool('optimization_auto_tune', {
  action: 'enable',
  config: {
    targetLatency: 100,          // 100ms target
    adaptiveThresholds: true
  }
});
```

### Continuous Improvement Workflow

```javascript
// 1. Start task tracking
const task = await agent.executeTool('task_effectiveness_start', {
  taskType: 'optimization',
  description: 'Optimize query performance',
  baselineMetrics: {
    completionTime: 300000,      // 5 minute baseline
    humanInterventions: 1
  }
});

// 2. Get proactive insights during execution
const insights = await agent.executeTool('proactive_insights', {
  context: {
    currentTask: 'optimization',
    recentTools: ['performance_profile', 'database_query'],
    currentTool: 'query_optimizer'
  }
});

// 3. Apply insights and complete task
await agent.executeTool('task_effectiveness_complete', {
  taskId: task.taskId,
  success: true
});

// 4. Analyze results for future improvement
const comparison = await agent.executeTool('task_effectiveness_compare', {
  taskId: task.taskId
});

console.log('Improvement achieved:', comparison.comparison.improvements);
```

These MCP tools provide agents with comprehensive self-service analytics capabilities, enabling autonomous performance monitoring, optimization, and continuous improvement without requiring external oversight or intervention.