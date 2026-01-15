---
description: Run tests matching a specific path pattern
---

Run integration tests that match a specific path pattern.

**Usage:** Provide a pattern as argument

**Examples:**

```bash
# Test agent functionality
npm run test:integration:manual -- --testPathPattern=agent

# Test channel functionality
npm run test:integration:manual -- --testPathPattern=channel

# Test tool functionality
npm run test:integration:manual -- --testPathPattern=tool

# Test prompt system
npm run test:integration:manual -- --testPathPattern=prompt

# Test task system
npm run test:integration:manual -- --testPathPattern=task

# Test ORPAR
npm run test:integration:manual -- --testPathPattern=orpar

# Test memory
npm run test:integration:manual -- --testPathPattern=memory

# Test Meilisearch
npm run test:integration:manual -- --testPathPattern=meilisearch

# Test external MCP
npm run test:integration:manual -- --testPathPattern=external-mcp
```

**Tip:** Use specific patterns to run targeted tests after making changes to specific areas.
