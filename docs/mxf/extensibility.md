# Extensibility

MXF is designed for rapid extension and customization. You can extend the framework in several ways:

1. **Express API**
   - Add new routes in `src/server/api/routes`
   - Implement controllers in `src/server/api/controllers`
   - Use shared validation and schemas (`packages/core/src/utils/validation.ts`, `packages/core/src/schemas/**/*.ts`)

2. **Dashboard**
   - Add new views/components in `dashboard/src/views`
   - Create Pinia stores in `dashboard/src/stores`
   - Update navigation in `dashboard/src/router/index.ts`

3. **SDK**
   - Extend `MXFClient` with custom methods or endpoints
   - Add new TypeScript interfaces in `sdk/src`

4. **LLM Providers**
   - Register new provider configurations in `src/server/api/controllers/configController.ts`
   - Implement network adapters or custom models

5. **Custom Agents/Tasks**
   - Define new agent types or capabilities via configuration
   - Extend task assignment logic in `src/server/services/taskService.ts`

> **Tip:** Follow DRY principles and use shared utilities in `packages/core/src` for consistent behavior and validation.

---

## Writing an MCP Tool

Declare tools with `defineTool` from
`packages/core/src/protocols/mcp/defineTool.ts`. It owns the scaffolding every
tool used to repeat by hand — the try/catch, the
`error instanceof Error ? error.message : String(error)` dance, the logger call,
the result wrapper — and it produces one result shape for every tool.

```typescript
import { defineTool } from '../defineTool.js';
import { ToolError } from '../ToolError.js';
import { TOOL_CATEGORIES } from '../../../constants/ToolNames.js';

export const gitStatusTool = defineTool<
    { workingDirectory?: string },
    { branch: string; files: string[] }
>({
    name: 'git_status',
    category: TOOL_CATEGORIES.VERSION_CONTROL,
    // This is prompt text. Say what the tool does, plainly, and describe only
    // what the implementation actually does.
    description: 'Report the current branch plus staged, modified and untracked files.',
    inputSchema: {
        type: 'object',
        properties: {
            workingDirectory: { type: 'string', description: 'Defaults to the server working directory' }
        }
    },
    run: async (input, context) => {
        const result = await runGit(['status', '--porcelain'], input.workingDirectory, context);
        if (result.exitCode !== 0) {
            throw ToolError.executionFailed(`git status failed: ${result.stderr}`);
        }
        return { branch: parseBranch(result.stdout), files: parseFiles(result.stdout) };
    }
});
```

### What the factory does

1. **Validates the context.** `agentId`, `channelId` and `requestId` are checked
   before `run` is reached, so `run` receives them non-optional and never has to
   test for them. A missing one is a wiring bug, not something to default.
2. **Validates the input** against `inputSchema` with AJV, on *every* entry path.
   Previously AJV ran only on the socket path, so a direct handler call validated
   nothing.
3. **Runs `run` inside one try/catch.**
4. **Returns one envelope:**

```typescript
{
    content: { type: 'application/json', data: <your return value | ToolErrorData> },
    isError: boolean,
    metadata: { toolName, executedAt, durationMs, errorCode? }
}
```

### Reporting failure

Throw a `ToolError`. Do not return `{ success: false }`, and do not return a
result whose payload happens to contain an `error` string — a caller cannot tell
either apart from a real result.

```typescript
throw ToolError.invalidInput('branchName is required for the "create" action.');
throw ToolError.notFound(`No package.json in ${dir}.`);
throw ToolError.permissionDenied('Refusing to fetch a loopback address.');
throw ToolError.preconditionFailed('Docker is not available.');
throw ToolError.executionFailed(`git commit failed: ${stderr}`);
throw ToolError.upstream(`GET ${url} returned 503.`);
throw ToolError.notImplemented('Mocha does not produce coverage on its own.');
```

Callers branch on `isError`, never on payload shape.

### `isError` means the tool failed

It does not mean "the tool found a problem". `tsc`, `eslint` and `jest` all exit
non-zero to report findings — that is the tool working. Those tools return
`passed: false` with the diagnostics and leave `isError` false. Reserve `isError`
for the tool genuinely not working: the binary is missing, the directory does not
exist, the output cannot be parsed.

### Registering it

Add the tool's array to `src/server/mcp/tools/index.ts`. Names must be unique
across the whole tool set — `assertUniqueToolNames` runs at module load and the
server refuses to start on a duplicate, because a duplicate silently shadows the
original.

`tests/unit/tools/McpToolRegistryInvariants.unit.test.ts` enforces the structural
rules: unique names, every tool file reachable from the index, every tool carrying
a name, description, schema and handler, and no marketing language in
descriptions.

### The tool contract

`McpToolDefinition` in
`packages/core/src/protocols/mcp/McpServerTypes.ts` is the interface. (Note:
`packages/core/src/types/toolTypes.ts` is a stub and does not define it.)
