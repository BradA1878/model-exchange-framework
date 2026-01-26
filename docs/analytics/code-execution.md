# Code Execution Analytics

## Overview

Track and analyze code execution performance, patterns, and security across your MXF deployment.

## Database Schema

All executions are persisted in MongoDB with comprehensive metrics:

```typescript
interface CodeExecutionRecord {
    // Identification
    agentId: string;
    channelId: string;
    requestId: string;

    // Code information
    language: 'javascript' | 'typescript';
    codeHash: string;         // SHA-256 for deduplication
    codeLength: number;
    codeSnippet: string;      // First 500 chars

    // Execution results
    success: boolean;
    output: any;
    logs: string[];
    error?: string;

    // Performance metrics
    executionTime: number;    // milliseconds
    timeout: number;          // configured timeout

    // Resource usage
    memoryUsage: number;      // MB
    timeoutOccurred: boolean;

    // Context
    contextData?: any;

    // Timestamps
    executedAt: Date;
    createdAt: Date;
}
```

## Analytics Methods

### Get Agent Statistics

Aggregated statistics for a specific agent:

```typescript
import { CodeExecution } from 'mxf';

const stats = await CodeExecution.getAgentStats(agentId);

console.log(stats);
// {
//   totalExecutions: 156,
//   successfulExecutions: 142,
//   failedExecutions: 14,
//   averageExecutionTime: 234,        // ms
//   timeoutCount: 3,
//   languageBreakdown: {
//     javascript: 120,
//     typescript: 36
//   }
// }
```

Calculate success rate:

```typescript
const successRate = (stats.successfulExecutions / stats.totalExecutions) * 100;
console.log(`Success rate: ${successRate.toFixed(1)}%`);
```

Time-filtered statistics:

```typescript
// Last 7 days
const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
const recentStats = await CodeExecution.getAgentStats(agentId, since);
```

### Find Duplicate Executions

Find executions of the same code:

```typescript
const similar = await CodeExecution.findByCodeHash(codeHash);

console.log(`Code executed ${similar.length} times:`);
similar.forEach(exec => {
    console.log(`  ${exec.executedAt}: ${exec.success ? '✅' : '❌'} (${exec.executionTime}ms)`);
});

// Check if code was successful before
const hasSucceeded = similar.some(exec => exec.success);
if (hasSucceeded) {
    console.log('This code has succeeded previously');
}

// Get best execution time
const bestTime = Math.min(...similar.map(e => e.executionTime));
console.log(`Best time: ${bestTime}ms`);
```

### Debug Recent Failures

Get recent failed executions for debugging:

```typescript
const failures = await CodeExecution.getRecentFailures(agentId, 20);

console.log(`Recent failures (${failures.length}):`);
failures.forEach(failure => {
    console.log(`
        Hash: ${failure.codeHash}
        Language: ${failure.language}
        Error: ${failure.error}
        Time: ${failure.executionTime}ms
        When: ${failure.executedAt}
    `);
});

// Find most common error
const errorCounts = {};
failures.forEach(f => {
    const errorKey = f.error?.substring(0, 50) || 'unknown';
    errorCounts[errorKey] = (errorCounts[errorKey] || 0) + 1;
});

const mostCommon = Object.entries(errorCounts)
    .sort((a, b) => b[1] - a[1])[0];

console.log(`Most common error: ${mostCommon[0]} (${mostCommon[1]} times)`);
```

## Custom Queries

### Execution Performance Over Time

```typescript
const executions = await CodeExecution.find({
    agentId: 'MyAgent',
    executedAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
})
.sort({ executedAt: 1 })
.select('executedAt executionTime success')
.lean();

// Group by day
const dailyStats = {};
executions.forEach(exec => {
    const day = exec.executedAt.toISOString().split('T')[0];
    if (!dailyStats[day]) {
        dailyStats[day] = {
            count: 0,
            totalTime: 0,
            successes: 0,
            failures: 0
        };
    }

    dailyStats[day].count++;
    dailyStats[day].totalTime += exec.executionTime;
    if (exec.success) {
        dailyStats[day].successes++;
    } else {
        dailyStats[day].failures++;
    }
});

// Calculate averages
Object.entries(dailyStats).forEach(([day, stats]) => {
    console.log(`${day}:`);
    console.log(`  Executions: ${stats.count}`);
    console.log(`  Avg time: ${(stats.totalTime / stats.count).toFixed(0)}ms`);
    console.log(`  Success rate: ${((stats.successes / stats.count) * 100).toFixed(1)}%`);
});
```

### Language Usage Trends

```typescript
const pipeline = [
    {
        $match: {
            executedAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
        }
    },
    {
        $group: {
            _id: {
                language: '$language',
                date: { $dateToString: { format: '%Y-%m-%d', date: '$executedAt' } }
            },
            count: { $sum: 1 },
            avgTime: { $avg: '$executionTime' },
            successRate: {
                $avg: { $cond: ['$success', 1, 0] }
            }
        }
    },
    {
        $sort: { '_id.date': 1 }
    }
];

const trends = await CodeExecution.aggregate(pipeline);

trends.forEach(trend => {
    console.log(`${trend._id.date} - ${trend._id.language}:`);
    console.log(`  Count: ${trend.count}`);
    console.log(`  Avg time: ${trend.avgTime.toFixed(0)}ms`);
    console.log(`  Success: ${(trend.successRate * 100).toFixed(1)}%`);
});
```

### Resource Usage Analysis

Docker container limits to consider when analyzing resource usage:
- **Memory limit**: 128MB per container (configurable via CODE_EXEC_MEMORY_LIMIT)
- **CPU limit**: 0.5 cores per container (configurable via CODE_EXEC_CPU_LIMIT)
- **PID limit**: 64 processes max
- **Timeout limit**: 30s max (configurable via CODE_EXEC_TIMEOUT_MAX)

```typescript
const resourceStats = await CodeExecution.aggregate([
    {
        $match: {
            agentId: 'MyAgent',
            executedAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
        }
    },
    {
        $group: {
            _id: null,
            avgMemory: { $avg: '$memoryUsage' },
            maxMemory: { $max: '$memoryUsage' },
            avgExecutionTime: { $avg: '$executionTime' },
            maxExecutionTime: { $max: '$executionTime' },
            timeoutCount: {
                $sum: { $cond: ['$timeoutOccurred', 1, 0] }
            }
        }
    }
]);

const stats = resourceStats[0];
console.log('Resource usage (24 hours):');
console.log(`  Avg memory: ${stats.avgMemory.toFixed(1)} MB (limit: 128 MB)`);
console.log(`  Peak memory: ${stats.maxMemory.toFixed(1)} MB`);
console.log(`  Avg time: ${stats.avgExecutionTime.toFixed(0)} ms`);
console.log(`  Max time: ${stats.maxExecutionTime} ms`);
console.log(`  Timeouts: ${stats.timeoutCount}`);
```

### Code Complexity Analysis

```typescript
const complexityAnalysis = await CodeExecution.aggregate([
    {
        $match: {
            executedAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
        }
    },
    {
        $bucket: {
            groupBy: '$codeLength',
            boundaries: [0, 100, 500, 1000, 5000, 100000],
            default: 'too_large',
            output: {
                count: { $sum: 1 },
                avgTime: { $avg: '$executionTime' },
                successRate: { $avg: { $cond: ['$success', 1, 0] } }
            }
        }
    }
]);

complexityAnalysis.forEach(bucket => {
    console.log(`Code length ${bucket._id} chars:`);
    console.log(`  Count: ${bucket.count}`);
    console.log(`  Avg time: ${bucket.avgTime.toFixed(0)}ms`);
    console.log(`  Success: ${(bucket.successRate * 100).toFixed(1)}%`);
});
```

## Real-Time Event Monitoring

### Listen for Execution Events

```typescript
import { EventBus, Events } from 'mxf';

// Monitor all executions
EventBus.server.on(Events.CodeExecution.CODE_EXECUTION_STARTED, (payload) => {
    console.log(`🚀 Execution started: ${payload.agentId}`);
    console.log(`   Language: ${payload.language}`);
    console.log(`   Code length: ${payload.codeLength} chars`);
});

EventBus.server.on(Events.CodeExecution.CODE_EXECUTION_COMPLETED, (payload) => {
    console.log(`✅ Execution completed: ${payload.agentId}`);
    console.log(`   Time: ${payload.executionTime}ms`);
    console.log(`   Memory: ${payload.resourceUsage.memory.toFixed(1)}MB`);
});

EventBus.server.on(Events.CodeExecution.CODE_EXECUTION_FAILED, (payload) => {
    console.error(`❌ Execution failed: ${payload.agentId}`);
    console.error(`   Error: ${payload.error}`);
    console.error(`   Type: ${payload.errorType}`);
});

// Security monitoring
EventBus.server.on(Events.CodeExecution.CODE_SECURITY_ISSUE, (payload) => {
    console.warn(`🛡️  Security issue detected!`);
    console.warn(`   Agent: ${payload.agentId}`);
    console.warn(`   Issue: ${payload.issueType}`);
    console.warn(`   Severity: ${payload.severity}`);
    console.warn(`   Description: ${payload.description}`);

    // Alert security team
    if (payload.severity === 'critical') {
        // Send alert...
    }
});

// Timeout monitoring
EventBus.server.on(Events.CodeExecution.CODE_EXECUTION_TIMEOUT, (payload) => {
    console.warn(`⏱️  Timeout occurred: ${payload.agentId}`);
    console.warn(`   Configured: ${payload.timeout}ms`);
    console.warn(`   Actual: ${payload.actualTime}ms`);
});
```

### Aggregate Event Metrics

```typescript
const eventMetrics = {
    started: 0,
    completed: 0,
    failed: 0,
    securityIssues: 0,
    timeouts: 0
};

EventBus.server.on(Events.CodeExecution.CODE_EXECUTION_STARTED, () => {
    eventMetrics.started++;
});

EventBus.server.on(Events.CodeExecution.CODE_EXECUTION_COMPLETED, () => {
    eventMetrics.completed++;
});

EventBus.server.on(Events.CodeExecution.CODE_EXECUTION_FAILED, () => {
    eventMetrics.failed++;
});

EventBus.server.on(Events.CodeExecution.CODE_SECURITY_ISSUE, () => {
    eventMetrics.securityIssues++;
});

EventBus.server.on(Events.CodeExecution.CODE_EXECUTION_TIMEOUT, () => {
    eventMetrics.timeouts++;
});

// Report every minute
setInterval(() => {
    console.log('Code execution metrics (last minute):');
    console.log(eventMetrics);

    // Reset counters
    Object.keys(eventMetrics).forEach(key => {
        eventMetrics[key] = 0;
    });
}, 60000);
```

## Dashboard Integration

All code execution metrics automatically flow to the MXF dashboard:

### Metrics Available

- **Execution count** - Total, per agent, per channel
- **Success rate** - Percentage of successful executions
- **Performance** - Average and peak execution times
- **Resource usage** - Memory consumption trends
- **Security events** - Blocked code attempts
- **Language breakdown** - JavaScript vs TypeScript usage
- **Error patterns** - Common failure reasons
- **Timeout frequency** - Code optimization opportunities

### Accessing Metrics

Dashboard automatically displays:
- Real-time execution graph
- Agent performance leaderboard
- Security alert feed
- Resource usage trends
- Error analysis charts

No additional configuration needed - all metrics flow automatically through the existing analytics infrastructure.

## Cost Analysis

### Execution Costs

Calculate cost savings from code execution:

```typescript
const stats = await CodeExecution.getAgentStats(agentId, since);

// Traditional approach cost
const traditionalCost = stats.totalExecutions * 3 * 0.006;  // 3 API calls @ $0.006

// Code execution cost
const codeExecCost = stats.totalExecutions * (0.006 + 0.001);  // 1 API call + sandbox

// Savings
const savings = traditionalCost - codeExecCost;
const savingsPercent = (savings / traditionalCost) * 100;

console.log(`Traditional: $${traditionalCost.toFixed(2)}`);
console.log(`Code execution: $${codeExecCost.toFixed(2)}`);
console.log(`Savings: $${savings.toFixed(2)} (${savingsPercent.toFixed(1)}%)`);
```

### Latency Savings

```typescript
// Average model round-trip: 7 seconds
const avgModelLatency = 7000;  // ms

// Code execution average
const codeExecAvg = stats.averageExecutionTime;

// Traditional 3-step workflow
const traditionalLatency = avgModelLatency * 3;

// Code execution 1-step
const codeExecLatency = avgModelLatency + codeExecAvg;

// Savings
const latencySavings = traditionalLatency - codeExecLatency;
const latencySavingsPercent = (latencySavings / traditionalLatency) * 100;

console.log(`Traditional: ${traditionalLatency}ms (${(traditionalLatency/1000).toFixed(1)}s)`);
console.log(`Code execution: ${codeExecLatency}ms (${(codeExecLatency/1000).toFixed(1)}s)`);
console.log(`Savings: ${latencySavings}ms (${latencySavingsPercent.toFixed(1)}%)`);
```

## Pattern Analysis

### Most Executed Code

Find frequently executed code patterns:

```typescript
const topPatterns = await CodeExecution.aggregate([
    {
        $match: {
            executedAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
        }
    },
    {
        $group: {
            _id: '$codeHash',
            count: { $sum: 1 },
            successRate: { $avg: { $cond: ['$success', 1, 0] } },
            avgTime: { $avg: '$executionTime' },
            language: { $first: '$language' },
            snippet: { $first: '$codeSnippet' }
        }
    },
    {
        $sort: { count: -1 }
    },
    {
        $limit: 10
    }
]);

console.log('Top 10 code patterns:');
topPatterns.forEach((pattern, i) => {
    console.log(`\n${i + 1}. Executed ${pattern.count} times`);
    console.log(`   Success rate: ${(pattern.successRate * 100).toFixed(1)}%`);
    console.log(`   Avg time: ${pattern.avgTime.toFixed(0)}ms`);
    console.log(`   Language: ${pattern.language}`);
    console.log(`   Code: ${pattern.snippet.substring(0, 80)}...`);
});
```

### Performance Optimization Candidates

Find slow executions that could be optimized:

```typescript
const slowExecutions = await CodeExecution.find({
    agentId: 'MyAgent',
    executionTime: { $gt: 5000 },  // >5 seconds
    success: true
})
.sort({ executionTime: -1 })
.limit(20)
.select('codeHash codeSnippet executionTime executedAt')
.lean();

console.log('Slow executions to optimize:');
slowExecutions.forEach(exec => {
    console.log(`
        Time: ${exec.executionTime}ms
        Hash: ${exec.codeHash}
        Code: ${exec.codeSnippet.substring(0, 100)}...
        When: ${exec.executedAt}
    `);
});
```

### Timeout Analysis

Identify code frequently hitting timeouts:

```typescript
const timeoutPatterns = await CodeExecution.aggregate([
    {
        $match: {
            timeoutOccurred: true,
            executedAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
        }
    },
    {
        $group: {
            _id: '$codeHash',
            count: { $sum: 1 },
            avgTimeout: { $avg: '$timeout' },
            avgActualTime: { $avg: '$executionTime' },
            snippet: { $first: '$codeSnippet' }
        }
    },
    {
        $sort: { count: -1 }
    }
]);

console.log('Code patterns hitting timeouts:');
timeoutPatterns.forEach(pattern => {
    console.log(`
        Timeouts: ${pattern.count}
        Configured: ${pattern.avgTimeout}ms
        Actual: ${pattern.avgActualTime}ms
        Code: ${pattern.snippet.substring(0, 80)}...
    `);
});
```

## Security Analytics

### Security Issue Tracking

Monitor security validation failures:

```typescript
// Listen for security events
const securityLog = [];

EventBus.server.on(Events.CodeExecution.CODE_SECURITY_ISSUE, (payload) => {
    securityLog.push({
        timestamp: new Date(),
        agentId: payload.agentId,
        issueType: payload.issueType,
        severity: payload.severity,
        description: payload.description
    });
});

// Report security issues
setInterval(() => {
    if (securityLog.length > 0) {
        console.log(`\n🛡️  Security Report (last hour):`);
        console.log(`Total issues: ${securityLog.length}`);

        // Group by severity
        const bySeverity = {
            critical: securityLog.filter(l => l.severity === 'critical').length,
            high: securityLog.filter(l => l.severity === 'high').length,
            medium: securityLog.filter(l => l.severity === 'medium').length,
            low: securityLog.filter(l => l.severity === 'low').length
        };

        console.log('By severity:', bySeverity);

        // Group by agent
        const byAgent = {};
        securityLog.forEach(log => {
            byAgent[log.agentId] = (byAgent[log.agentId] || 0) + 1;
        });

        console.log('Top offenders:',
            Object.entries(byAgent)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 5)
        );

        securityLog.length = 0;  // Clear log
    }
}, 3600000);  // Every hour
```

### Agent Security Profile

Generate security profile for an agent:

```typescript
async function getSecurityProfile(agentId: string) {
    const [executions, securityIssues] = await Promise.all([
        CodeExecution.find({
            agentId,
            executedAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
        }).select('success timeoutOccurred codeHash').lean(),

        // Query security event log (if persisted)
        // For demo, use in-memory tracking
        []
    ]);

    const profile = {
        agentId,
        totalExecutions: executions.length,
        successRate: executions.filter(e => e.success).length / executions.length,
        timeoutRate: executions.filter(e => e.timeoutOccurred).length / executions.length,
        securityIssues: securityIssues.length,
        riskLevel: 'low'
    };

    // Determine risk level
    if (securityIssues.length > 10 || profile.timeoutRate > 0.3) {
        profile.riskLevel = 'high';
    } else if (securityIssues.length > 5 || profile.timeoutRate > 0.1) {
        profile.riskLevel = 'medium';
    }

    return profile;
}

const profile = await getSecurityProfile('MyAgent');
console.log('Security profile:', profile);
```

## Benchmarking

### Compare Execution Performance

```typescript
async function benchmarkCode(agent: MxfClient, code: string, iterations: number = 10) {
    const times = [];

    console.log(`Running ${iterations} iterations...`);

    for (let i = 0; i < iterations; i++) {
        const result = await agent.callTool('code_execute', { code });

        if (result.success) {
            times.push(result.executionTime);
            console.log(`Iteration ${i + 1}: ${result.executionTime}ms`);
        } else {
            console.error(`Iteration ${i + 1}: FAILED`);
        }
    }

    // Calculate statistics
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    const min = Math.min(...times);
    const max = Math.max(...times);
    const sorted = times.sort((a, b) => a - b);
    const p50 = sorted[Math.floor(times.length * 0.5)];
    const p95 = sorted[Math.floor(times.length * 0.95)];
    const p99 = sorted[Math.floor(times.length * 0.99)];

    console.log('\nBenchmark results:');
    console.log(`  Iterations: ${times.length}`);
    console.log(`  Avg: ${avg.toFixed(0)}ms`);
    console.log(`  Min: ${min}ms`);
    console.log(`  Max: ${max}ms`);
    console.log(`  P50: ${p50}ms`);
    console.log(`  P95: ${p95}ms`);
    console.log(`  P99: ${p99}ms`);

    return { avg, min, max, p50, p95, p99 };
}

// Benchmark a specific code pattern
const benchmark = await benchmarkCode(
    agent,
    'return context.data.filter(d => d.score > 0.8);',
    50
);
```

## Data Retention

### TTL Configuration

Records automatically deleted after 30 days:

```typescript
// Check TTL index
db.codeexecutions.getIndexes()
// Should show: { executedAt: 1 }, expireAfterSeconds: 2592000

// Manual cleanup (if needed)
await CodeExecution.deleteMany({
    executedAt: { $lt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
});
```

### Archive Important Executions

Export executions for long-term storage:

```typescript
const important = await CodeExecution.find({
    agentId: 'ProductionAgent',
    success: true,
    executionTime: { $gt: 10000 }  // Long-running successful executions
})
.sort({ executedAt: -1 })
.lean();

// Export to JSON
const archive = {
    exportedAt: new Date(),
    count: important.length,
    executions: important
};

fs.writeFileSync(
    `archive-${Date.now()}.json`,
    JSON.stringify(archive, null, 2)
);
```

## Best Practices

### Performance Monitoring

1. **Track execution times** - Identify slow patterns
2. **Monitor success rates** - Find problematic code
3. **Watch timeout frequency** - Optimize long-running code
4. **Analyze resource usage** - Prevent memory issues
5. **Review security events** - Maintain security posture

### Regular Analysis

```typescript
// Run weekly analysis
async function weeklyReport(agentId: string) {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [stats, failures, slowExecs] = await Promise.all([
        CodeExecution.getAgentStats(agentId, since),
        CodeExecution.getRecentFailures(agentId, 10),
        CodeExecution.find({
            agentId,
            executionTime: { $gt: 5000 },
            executedAt: { $gte: since }
        }).limit(10).lean()
    ]);

    console.log('📊 Weekly Code Execution Report');
    console.log('═'.repeat(60));
    console.log(`Agent: ${agentId}`);
    console.log(`Period: Last 7 days`);
    console.log('');
    console.log(`Total executions: ${stats.totalExecutions}`);
    console.log(`Success rate: ${((stats.successfulExecutions / stats.totalExecutions) * 100).toFixed(1)}%`);
    console.log(`Avg time: ${stats.averageExecutionTime.toFixed(0)}ms`);
    console.log(`Timeouts: ${stats.timeoutCount}`);
    console.log(`Languages:`, stats.languageBreakdown);
    console.log('');
    console.log(`Recent failures: ${failures.length}`);
    console.log(`Slow executions: ${slowExecs.length}`);

    return { stats, failures, slowExecs };
}

// Run weekly
weeklyReport('MyAgent');
```

## See Also

- [Code Execution Service](../mxf/code-execution.md) - Architecture documentation
- [SDK Code Execution](../sdk/code-execution.md) - Usage guide
- [Examples](../sdk/examples-code-execution.md) - Code examples
- [API Reference](../api/mcp.md#code_execute) - Tool specification
