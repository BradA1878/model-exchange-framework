# Code Execution in SDK

## Overview

The `code_execute` tool enables agents to run JavaScript and TypeScript code in secure sandboxes, optimizing multi-step workflows by eliminating model round-trips.

## Basic Usage

### Simple Execution

```typescript
import { MxfSDK } from '@mxf/sdk';

// Initialize SDK
const sdk = new MxfSDK({
    serverUrl: 'http://localhost:3001',
    domainKey: process.env.MXF_DOMAIN_KEY!,
    username: process.env.MXF_USERNAME!,
    password: process.env.MXF_PASSWORD!
});
await sdk.connect();

// Create agent through SDK
const agent = await sdk.createAgent({
    agentId: 'MyAgent',
    channelId: 'my-channel',
    keyId: process.env.AGENT_KEY_ID!,
    secretKey: process.env.AGENT_SECRET_KEY!,
    llmProvider: 'openrouter',
    defaultModel: 'anthropic/claude-3.5-sonnet',
    apiKey: process.env.OPENROUTER_API_KEY!
});
await agent.connect();

// Execute simple code
const result = await agent.callTool('code_execute', {
    code: 'return 1 + 1;'
});

console.log(result.output);  // 2
```

### With Context Data

Pass data to your code via the `context` parameter:

```typescript
const result = await agent.callTool('code_execute', {
    code: `
        const total = context.numbers.reduce((a, b) => a + b, 0);
        return total / context.numbers.length;
    `,
    context: {
        numbers: [10, 20, 30, 40, 50]
    }
});

console.log(result.output);  // 30 (average)
```

### TypeScript Execution

```typescript
const result = await agent.callTool('code_execute', {
    language: 'typescript',
    code: `
        interface Result {
            total: number;
            average: number;
        }

        const numbers = [1, 2, 3, 4, 5];
        const total = numbers.reduce((a, b) => a + b, 0);

        const result: Result = {
            total,
            average: total / numbers.length
        };

        return result;
    `
});

console.log(result.output);
// { total: 15, average: 3 }
```

## Input Parameters

```typescript
interface CodeExecuteInput {
    language?: 'javascript' | 'typescript';  // Default: 'javascript'
    code: string;                            // Required
    timeout?: number;                        // Default: 5000ms, max: 30000ms
    context?: Record<string, any>;           // Optional data for code
    captureConsole?: boolean;                // Default: true
}
```

## Output Structure

```typescript
interface CodeExecuteOutput {
    success: boolean;              // Execution succeeded
    output: any;                   // Return value
    logs?: string[];               // Console output (if captured)
    executionTime: number;         // Milliseconds
    codeHash: string;              // SHA-256 hash
    error?: string;                // Error message (if failed)
    resourceUsage: {
        memory: number;            // MB
        timeout: boolean;          // Timeout occurred
    };
}
```

## Common Patterns

### Data Filtering

```typescript
// Instead of multiple tool calls with model round-trips
const result = await agent.callTool('code_execute', {
    code: `
        const filtered = context.data
            .filter(item => item.score > 0.8)
            .sort((a, b) => b.score - a.score)
            .slice(0, 5);

        return {
            total: context.data.length,
            filtered: filtered.length,
            items: filtered
        };
    `,
    context: {
        data: searchResults  // Large array from previous search
    }
});
```

**Benefits:**
- No tokens for intermediate data
- Fast local processing
- Only final results to model

### Multi-Step Calculations

```typescript
const result = await agent.callTool('code_execute', {
    code: `
        // Step 1: Calculate metrics
        const total = context.values.reduce((a, b) => a + b, 0);
        const avg = total / context.values.length;
        const variance = context.values
            .map(v => Math.pow(v - avg, 2))
            .reduce((a, b) => a + b, 0) / context.values.length;
        const stdDev = Math.sqrt(variance);

        // Step 2: Classify
        const classification = avg > 75 ? 'high' :
                             avg > 50 ? 'medium' : 'low';

        // Step 3: Generate report
        return {
            total,
            average: avg,
            stdDev: stdDev,
            classification,
            timestamp: new Date().toISOString()
        };
    `,
    context: {
        values: [45, 67, 89, 72, 91, 58, 82]
    }
});
```

### Conditional Logic

```typescript
const result = await agent.callTool('code_execute', {
    code: `
        let action = 'none';
        let priority = 0;

        if (context.errorCount > 10) {
            action = 'immediate_alert';
            priority = 10;
            console.error('Critical: Error threshold exceeded');
        } else if (context.errorCount > 5) {
            action = 'monitor';
            priority = 5;
            console.warn('Warning: Elevated error rate');
        } else {
            action = 'normal';
            priority = 1;
            console.log('Status: Normal operation');
        }

        return { action, priority, errorCount: context.errorCount };
    `,
    context: {
        errorCount: 7
    }
});
```

### Iterative Operations

```typescript
const result = await agent.callTool('code_execute', {
    code: `
        const processed = [];
        let skipped = 0;

        for (const item of context.items) {
            if (item.value > context.threshold) {
                processed.push({
                    id: item.id,
                    value: item.value * 2,
                    category: item.value > 50 ? 'high' : 'medium'
                });
                console.log(\`Processed: \${item.id}\`);
            } else {
                skipped++;
                console.log(\`Skipped: \${item.id} (below threshold)\`);
            }
        }

        return {
            processed: processed.length,
            skipped,
            items: processed
        };
    `,
    context: {
        items: [
            { id: 'A', value: 25 },
            { id: 'B', value: 75 },
            { id: 'C', value: 5 }
        ],
        threshold: 20
    }
});
```

## Error Handling

### Catching Execution Errors

```typescript
try {
    const result = await agent.callTool('code_execute', {
        code: yourCode
    });

    if (result.success) {
        console.log('Output:', result.output);
    } else {
        console.error('Execution failed:', result.error);

        // Check error type
        if (result.resourceUsage.timeout) {
            console.log('Timeout occurred - code took too long');
        }
    }
} catch (error) {
    // Validation or security error
    console.error('Pre-execution failed:', error.message);
}
```

### Handling Security Validation

```typescript
// This will throw before execution
try {
    await agent.callTool('code_execute', {
        code: 'eval("dangerous")'  // ❌ Blocked by pattern detection
    });
} catch (error) {
    console.error(error.message);
    // "Code validation failed: eval() is not allowed"
}
```

### Timeout Handling

```typescript
const result = await agent.callTool('code_execute', {
    code: 'while(true) {}',
    timeout: 2000
});

console.log(result.success);               // false
console.log(result.resourceUsage.timeout); // true
console.log(result.error);                 // "Script execution timed out"
```

## Console Output

Capture console.log for debugging:

```typescript
const result = await agent.callTool('code_execute', {
    code: `
        console.log('Starting process...');
        const result = Math.sqrt(144);
        console.log('Calculation complete:', result);
        return result;
    `,
    captureConsole: true  // Default
});

console.log(result.logs);
// ['Starting process...', 'Calculation complete: 12']

console.log(result.output);
// 12
```

Disable console capture for better performance:

```typescript
const result = await agent.callTool('code_execute', {
    code: 'return expensive_calculation();',
    captureConsole: false  // logs will be undefined
});
```

## Performance Optimization

### When to Use Code Execution

**✅ Good Use Cases:**
- Data transformation (filter, map, reduce)
- Multi-step calculations
- Conditional logic trees
- Iterative operations (loops)
- Complex algorithms
- Data aggregation

**❌ Poor Use Cases:**
- Single tool calls (use direct tool execution)
- File operations (use filesystem tools)
- Network requests (use API tools)
- Database queries (use memory tools)
- External integrations (use MCP servers)

### Performance Tips

```typescript
// ✅ GOOD: Process data locally
const result = await agent.callTool('code_execute', {
    code: 'return context.data.filter(d => d.score > 0.8);',
    context: { data: largeArray }
});

// ❌ BAD: Multiple tool calls through model
const search = await agent.callTool('memory_search', { query: '...' });
// ... wait for model response ...
const filtered = await agent.callTool('filter_data', { data: search.results });
// ... wait for model response ...
const sorted = await agent.callTool('sort_data', { data: filtered });
```

### Latency Comparison

**Traditional Approach** (3 tool calls):
```
Agent → Model → Tool 1 (search) → Model → Tool 2 (filter) → Model → Tool 3 (sort)
Time: 5-10s per step = 15-30s total
```

**Code Execution Approach**:
```
Agent → Model → code_execute (search + filter + sort)
Time: 5-10s model + <2s execution = 7-12s total
```

**Benefit: Significant latency reduction**

## Advanced Usage

### Code Validation

Check code safety before execution:

```typescript
import { CodeExecutionSandboxService } from 'mxf';

const sandbox = CodeExecutionSandboxService.getInstance();
const validation = sandbox.validateCode(yourCode);

if (validation.safe) {
    console.log('✅ Code is safe to execute');
} else {
    console.log('❌ Security issues found:');
    validation.issues.forEach(issue => {
        console.log(`${issue.type}: ${issue.message}`);
    });
}
```

### Custom Sandbox Configuration

```typescript
const sandbox = CodeExecutionSandboxService.getInstance();

// Update defaults
sandbox.updateConfig({
    timeout: 15000,        // 15 second timeout
    captureConsole: true   // Always capture logs
});

// All executions use new config
const result = await sandbox.executeJavaScript(code, context);
```

### Programmatic Execution

Bypass tool system for direct execution:

```typescript
import { CodeExecutionSandboxService } from 'mxf';

const sandbox = CodeExecutionSandboxService.getInstance();

const result = await sandbox.executeJavaScript(
    'return context.value * 2;',
    {
        agentId: 'MyAgent',
        channelId: 'my-channel',
        requestId: 'req-123',
        value: 42
    },
    {
        timeout: 10000,
        captureConsole: true
    }
);

console.log(result);
```

## Troubleshooting

### Issue: Docker Not Available

**Problem:** Error "Code execution is not available - Docker is not running"

**Solution:**
```bash
# 1. Ensure Docker daemon is running
docker info

# 2. Restart MXF server - it will auto-build the image
bun run start:dev

# Note: The server automatically builds the mxf/code-executor:latest
# image on startup if it doesn't exist.
```

**Manual build (if auto-build fails):**
```bash
docker build -t mxf/code-executor:latest ./docker/code-executor
```

### Issue: Timeout Errors

**Problem:** Code exceeds timeout limit

**Solution:**
```typescript
// Increase timeout
await agent.callTool('code_execute', {
    code: complexOperation,
    timeout: 15000  // 15 seconds
});

// Or optimize code
// ❌ Slow
for (let i = 0; i < 1000000; i++) { ... }

// ✅ Faster
const result = data.filter(condition);
```

### Issue: Validation Failures

**Problem:** Code contains dangerous patterns

**Solution:**
```typescript
// ❌ This fails
code = 'const fs = require("fs"); fs.readFile(...);'

// ✅ This works
code = 'const data = context.fileData; return process(data);'
// Pass file data via context instead
```

### Issue: TypeScript Not Working

**Problem:** Complex TypeScript features fail

**Solution:**
Bun handles TypeScript natively but some advanced features may not work:
```typescript
// ❌ May not work
code = `
    type Complex<T> = T extends Array<infer U> ? U : never;
    // Advanced decorators, complex generics
    ...
`;

// ✅ Use simpler TypeScript (Bun supports well)
code = `
    interface Simple { name: string; }
    const obj: Simple = { name: 'test' };
    return obj.name;
`;

// ✅ Or use JavaScript for maximum compatibility
code = `
    const obj = { name: 'test' };
    return obj.name;
`;
```

## Security Considerations

### Context Data

Pass sensitive data via context (never hardcode):

```typescript
// ❌ BAD: Hardcoded secret
await agent.callTool('code_execute', {
    code: 'const apiKey = "sk-123456"; return callApi(apiKey);'
});

// ✅ GOOD: Pass via context
await agent.callTool('code_execute', {
    code: 'return callApi(context.apiKey);',
    context: {
        apiKey: process.env.API_KEY
    }
});
```

### Validation Checks

Code execution uses **BLOCKING** validation:
- Execution waits for security approval
- Pattern detection runs before sandbox
- High security impact rating (0.9/1.0)
- All executions audited in MongoDB

### Audit Trail

Every execution is logged:

```typescript
// Query execution history
import { CodeExecution } from 'mxf';

const recent = await CodeExecution.find({
    agentId: 'MyAgent',
    executedAt: { $gte: new Date(Date.now() - 86400000) }  // Last 24 hours
});

recent.forEach(exec => {
    console.log(`${exec.executedAt}: ${exec.success ? '✅' : '❌'} ${exec.codeHash}`);
});
```

## Complete Example

Comprehensive code execution with error handling:

```typescript
async function processData(agent: MxfClient, rawData: any[]) {
    try {
        const result = await agent.callTool('code_execute', {
            language: 'javascript',
            code: `
                console.log('Processing', context.data.length, 'items');

                // Filter
                const filtered = context.data.filter(item => {
                    return item.score > 0.75 && item.valid === true;
                });

                console.log('Filtered to', filtered.length, 'items');

                // Transform
                const transformed = filtered.map(item => ({
                    id: item.id,
                    score: item.score,
                    category: item.score > 0.9 ? 'excellent' : 'good',
                    processedAt: new Date().toISOString()
                }));

                // Sort
                const sorted = transformed.sort((a, b) => b.score - a.score);

                console.log('Processing complete');

                return {
                    original: context.data.length,
                    filtered: filtered.length,
                    top5: sorted.slice(0, 5),
                    summary: {
                        avgScore: sorted.reduce((a, b) => a + b.score, 0) / sorted.length,
                        categories: {
                            excellent: sorted.filter(i => i.category === 'excellent').length,
                            good: sorted.filter(i => i.category === 'good').length
                        }
                    }
                };
            `,
            context: {
                data: rawData
            },
            timeout: 10000,
            captureConsole: true
        });

        if (result.success) {
            console.log('✅ Processing successful');
            console.log('Execution time:', result.executionTime, 'ms');
            console.log('Logs:', result.logs);
            console.log('Result:', result.output);
            return result.output;
        } else {
            console.error('❌ Execution failed:', result.error);

            if (result.resourceUsage.timeout) {
                console.log('⏱️  Timeout occurred - increase timeout or optimize code');
            }

            return null;
        }

    } catch (error) {
        console.error('❌ Pre-execution error:', error.message);
        // Security validation or parameter error
        return null;
    }
}
```

## See Also

- [Code Execution Service](../mxf/code-execution.md) - Architecture and security
- [Code Examples](./examples-code-execution.md) - More usage patterns
- [API Reference](../api/mcp.md#code_execute) - Complete API documentation
