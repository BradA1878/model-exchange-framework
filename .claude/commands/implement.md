---
description: Implement a feature with full quality workflow
---

Full implementation workflow with quality gates built in.

**Use this when starting new feature work.** It guides you through:
1. Understanding requirements
2. Planning the implementation
3. Writing the code
4. Generating tests
5. Cleaning up and documenting

**Workflow:**
1. Clarify requirements with the user if needed
2. Plan the implementation approach
3. Implement the feature/fix
4. Spawn `test-builder` agent to generate tests
5. Run `npm run test:unit` to verify
6. Spawn `code-cleanup` agent
7. Spawn `docs-updater` agent
8. Report completion - ready for `/finalize`

**This command ensures quality is built-in from the start, not bolted on at the end.**
