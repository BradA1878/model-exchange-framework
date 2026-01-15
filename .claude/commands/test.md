---
description: Run all integration tests
---

Run the complete integration test suite against the running dev server:

```bash
npm run test:integration:manual
```

**Prerequisites:**
- Server must be running: `npm run dev`
- Infrastructure (MongoDB, Meilisearch, Redis) must be up

**What this tests:**
- Agent connection and lifecycle
- Channel communication
- Tool execution and validation
- Prompt system configuration
- Task management system
- ORPAR control loop
- Memory operations
- Meilisearch search
- External MCP servers

Use this command before completing implementation tasks to verify changes work correctly.
