---
description: Create PR from current branch to main
---

Create a pull request from the current branch to main.

**Steps:**
1. Ensure all changes are committed
2. Create a new branch if on main: `git checkout -b auto/<description>`
3. Push to remote: `git push -u origin <branch>`
4. Create PR using gh CLI with:
   - Clear title describing the change
   - Summary of what was done
   - List of commits included

**Usage:**
```bash
bash .claude/hooks/create-pr.sh "branch-description" "PR Title"
```

**Note:** This skips tests. Use `/test-and-pr` to run tests first.
