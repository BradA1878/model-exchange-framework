---
description: Deep investigation of a bug or issue
---

Systematic investigation workflow for debugging complex issues.

**Use this when facing a bug or unexpected behavior.**

**Workflow:**
1. Reproduce the issue - understand exact steps
2. Gather evidence:
   - Read relevant source files
   - Check recent git changes: `git log --oneline -20`
   - Search for related code: patterns, error messages
3. Form hypotheses about root cause
4. Test hypotheses with targeted investigation
5. Identify the fix
6. Propose solution with explanation

**Output format:**
- **Issue**: What's happening
- **Root Cause**: Why it's happening
- **Evidence**: How we know
- **Fix**: What to change
- **Risk**: Any side effects to consider
