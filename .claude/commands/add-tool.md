---
description: Add a new MCP tool to the framework
---

Workflow for adding a new MCP tool to MXF.

**Use this when adding a new tool to the framework.**

**Workflow:**
1. Determine tool category (meta, agent, coordination, memory, etc.)
2. Create tool file in `src/shared/protocols/mcp/tools/<Category>/`
3. Implement tool following the McpTool interface:
   - name, description, parameters, execute function
4. Register tool in the category's index
5. Spawn `test-builder` to generate tests
6. Update `docs/mxf/tool-reference.md` with new tool
7. Run `npm run test:unit`
8. Ready for `/finalize`

**Tool structure:**
```typescript
export const myNewTool: McpTool = {
    name: 'my_new_tool',
    description: 'What this tool does',
    parameters: {
        param1: { type: 'string', description: '...', required: true }
    },
    execute: async (params, context) => {
        // Implementation
        return { success: true, data: result };
    }
};
```

**Categories:** MetaTools, AgentCommunicationTools, CoordinationTools, MemoryTools, TaskTools, etc.
