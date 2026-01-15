#!/bin/bash
# Auto-commit hook for Claude Code
# Runs on Stop event to commit staged changes
# Uses the user's git identity (not Claude)

set -e

cd "$(git rev-parse --show-toplevel)" 2>/dev/null || exit 0

# Check if we're in a git repo
if ! git rev-parse --git-dir > /dev/null 2>&1; then
    exit 0
fi

# Check for staged changes
if git diff --cached --quiet; then
    # No staged changes, check for unstaged changes to stage
    if git diff --quiet && [ -z "$(git ls-files --others --exclude-standard)" ]; then
        # No changes at all
        exit 0
    fi
fi

# Get a summary of changes for the commit message
STAGED_FILES=$(git diff --cached --name-only 2>/dev/null | head -10)
STAGED_COUNT=$(git diff --cached --name-only 2>/dev/null | wc -l | tr -d ' ')

if [ -z "$STAGED_FILES" ]; then
    # Nothing staged, exit silently
    exit 0
fi

# Build commit message
if [ "$STAGED_COUNT" -eq 1 ]; then
    # Single file change
    FILE_NAME=$(echo "$STAGED_FILES" | head -1)
    COMMIT_MSG="Update $FILE_NAME"
else
    # Multiple files
    COMMIT_MSG="Update $STAGED_COUNT files"
fi

# Add detail about what changed
STATS=$(git diff --cached --stat --stat-width=50 2>/dev/null | tail -1)
if [ -n "$STATS" ]; then
    COMMIT_MSG="$COMMIT_MSG

Changes: $STATS"
fi

# Create the commit
git commit -m "$COMMIT_MSG" > /dev/null 2>&1

echo "✓ Auto-committed: $COMMIT_MSG"
