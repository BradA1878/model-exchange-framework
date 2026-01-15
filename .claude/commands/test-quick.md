---
description: Run quick smoke tests
---

Run a quick subset of integration tests for fast verification:

```bash
npm run test:integration:manual -- --testPathPattern="(agent-connection|tool-execution)"
```

**Use when:**
- Making small changes
- Need quick feedback
- Testing basic connectivity

**What this tests:**
- Agent connection lifecycle
- Tool execution basics

For comprehensive testing, use `/test` instead.
