# Code Execution Demo

A demonstration of MXF's secure code execution capabilities using Docker containers with the Bun runtime. This demo showcases how agents can safely execute JavaScript and TypeScript code in isolated sandboxes.

## Overview

The demo runs through 9 scenarios demonstrating:

- **JavaScript Execution**: Simple calculations, array operations, context data processing
- **TypeScript Support**: Native TypeScript execution with interfaces and type annotations
- **Console Capture**: Capturing console.log, console.error, and console.warn output
- **Security Validation**: Blocking dangerous patterns like eval(), require(), Bun.spawn
- **Timeout Protection**: Automatic termination of long-running code

## Running the Demo

### Prerequisites

1. Docker daemon running:
   ```bash
   docker info
   ```

2. MXF server running (will auto-build Docker image if needed):
   ```bash
   bun run dev
   ```

3. Environment variables:
   ```bash
   export OPENROUTER_API_KEY=your_key_here
   ```

### Start the Demo

```bash
bun run demo:code-execution
```

## Demo Scenarios

| Demo | Description | Expected Result |
|------|-------------|-----------------|
| 1 | Simple Calculation | `1 + 1 = 2` |
| 2 | Array Operations | Sum, avg, max, min of array |
| 3 | Context Data Processing | Filter and sort with context |
| 4 | Console Output Capture | Captures console.log statements |
| 5 | TypeScript Execution | Interfaces and type annotations |
| 6 | Conditional Logic | Temperature status check |
| 7 | Iterative Operations | Loop processing with logging |
| 8 | Security Validation | eval() blocked |
| 9 | Timeout Protection | Infinite loop terminated |

## Key MXF Features Demonstrated

### 1. Secure Code Execution

```typescript
const result = await agent.executeTool('code_execute', {
    code: 'return 1 + 1;'
});

console.log(result.output);  // 2
console.log(result.success); // true
```

### 2. Context Data

```typescript
const result = await agent.executeTool('code_execute', {
    code: `
        const filtered = context.data.filter(item => item.score > 0.8);
        return { total: context.data.length, filtered: filtered.length };
    `,
    context: {
        data: [
            { name: 'A', score: 0.9 },
            { name: 'B', score: 0.7 },
            { name: 'C', score: 0.85 }
        ]
    }
});
```

### 3. TypeScript Support

```typescript
const result = await agent.executeTool('code_execute', {
    language: 'typescript',
    code: `
        interface Person {
            name: string;
            age: number;
        }
        const person: Person = { name: 'Alice', age: 30 };
        return person.name;
    `
});
```

### 4. Console Output Capture

```typescript
const result = await agent.executeTool('code_execute', {
    code: `
        console.log('Starting analysis...');
        const result = Math.sqrt(144);
        console.log('Result:', result);
        return result;
    `
});

console.log(result.logs);
// ['Starting analysis...', 'Result: 12']
```

### 5. Security Blocking

Dangerous patterns are automatically blocked:

```typescript
// This will fail validation
const result = await agent.executeTool('code_execute', {
    code: 'eval("malicious code")'
});
// Error: Code validation failed: eval() is not allowed
```

## Security Features

The code execution sandbox provides multiple layers of security:

- **Docker Isolation**: Code runs in isolated containers
- **No Network**: NetworkMode set to 'none'
- **Read-only Filesystem**: Root filesystem is read-only
- **Resource Limits**: Memory (128MB), CPU (0.5 cores), PIDs (64)
- **Pattern Detection**: Blocks eval, require, Bun.spawn, etc.
- **Timeout Enforcement**: Automatic termination after timeout

## Learning Points

This demo showcases:

1. **Executing code safely** in isolated Docker containers
2. **Passing context data** to code execution
3. **Capturing console output** from executed code
4. **TypeScript support** with Bun's native transpiler
5. **Security validation** blocking dangerous patterns
6. **Timeout protection** for runaway code

## Source Code

See the full implementation in `examples/code-execution-demo/code-execution-demo.ts`

## Related Documentation

- [Code Execution Integration Guide](../code-execution-integration.md)
- [Code Execution SDK Guide](../sdk/code-execution.md)
- [Code Execution Architecture](../mxf/code-execution.md)
