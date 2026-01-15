---
description: Safe refactoring with test verification
---

Refactoring workflow that ensures behavior is preserved.

**Use this for refactoring tasks.** Ensures safety through:
1. Understanding current behavior
2. Ensuring test coverage exists
3. Making incremental changes
4. Verifying after each step

**Workflow:**
1. Identify scope of refactoring
2. Run `npm run test:unit` - establish baseline
3. If tests are missing, spawn `test-builder` first
4. Make incremental refactoring changes
5. Run `npm run test:unit` after each change
6. Spawn `code-cleanup` agent
7. Run full test suite: `npm run test:integration:manual`
8. Ready for `/finalize`

**Golden rule: Never refactor without tests. If tests don't exist, write them first.**
