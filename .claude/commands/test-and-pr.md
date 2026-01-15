---
description: Run tests and create PR if they pass
---

Run the full integration test suite, then create a PR only if all tests pass.

**Workflow:**
1. Run all 92 integration tests (`npm run test:integration:manual`)
2. If tests pass → Create PR with test results in description
3. If tests fail → Notify user, do NOT create PR

**Usage:**
```bash
bash .claude/hooks/test-and-pr.sh "branch-description" "PR Title"
```

**Prerequisites:**
- Server must be running: `npm run dev`
- Infrastructure (MongoDB, Meilisearch, Redis) must be up

**What gets tested:**
- Agent connection and lifecycle (6 tests)
- Channel communication (8 tests)
- Tool execution and validation (11 tests)
- Prompt system configuration (13 tests)
- Task management system (7 tests)
- ORPAR control loop (9 tests)
- Memory operations (8 tests)
- Meilisearch search (8 tests)
- External MCP servers (10 tests)
