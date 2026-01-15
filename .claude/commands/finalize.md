---
description: Commit, test, and create PR for review
---

Complete workflow: generate tests, clean up code, update docs, run tests, and create PR.

**This is the "I'm done" command.** Use it when you've completed a task and want to:
1. Generate tests for new/modified code
2. Run code cleanup (remove unused imports, dead code)
3. Update documentation to reflect changes
4. Run pre-commit validation
5. Commit any remaining changes
6. Run the full test suite (unit + integration)
7. Create a PR for review (only if tests pass)
8. Notify with PR URL

**Workflow:**
1. Use the `test-builder` agent to generate tests for changes
2. Run `npm run test:unit` to verify unit tests pass
3. Use the `code-cleanup` agent to clean up recent changes
4. Use the `docs-updater` agent to update documentation
5. Use the `pre-commit` agent to validate code
6. Stage and commit changes
7. Run `npm run test:integration:manual`
8. If all tests pass → Create PR, notify user
9. If tests fail → Notify user, fix issues first

**Usage:**
After completing work, run this command to finalize and create a PR.

**Prerequisites:**
- Server must be running: `npm run dev`
- Infrastructure must be up (Docker)

**What happens on success:**
- Code cleaned up
- Documentation updated
- Branch created: `auto/<description>-<timestamp>`
- Pushed to origin
- PR created targeting main
- macOS/Linux/Windows notification sent
- PR URL copied to clipboard
