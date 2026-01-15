---
description: Review code changes before commit
---

Code review workflow for quality assurance.

**Use this before committing to get a self-review.**

**Review checklist:**
1. **Correctness**: Does the code do what it's supposed to?
2. **Tests**: Are there tests? Do they cover edge cases?
3. **Security**: Any injection risks, exposed secrets, unsafe operations?
4. **Performance**: Any obvious performance issues?
5. **Style**: Follows codebase conventions?
6. **Documentation**: Comments where needed?

**Workflow:**
1. Run `git diff` to see all changes
2. Review each changed file
3. Check for:
   - Unused imports/variables
   - Console.logs that should be removed
   - Hardcoded values that should be config
   - Missing error handling
   - Missing validation
4. Report findings with file:line references
5. Suggest improvements

**Output format:**
- **Issues found**: List with severity (critical/warning/nitpick)
- **Suggestions**: Improvements to consider
- **Approval**: Ready to commit or needs changes
