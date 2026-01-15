#!/bin/bash
# Create PR hook for Claude Code
# Creates a branch, pushes, and opens a PR to main
# Usage: create-pr.sh "branch-description" "PR title" "PR body"

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$(git rev-parse --show-toplevel)" 2>/dev/null || exit 1

# Arguments
BRANCH_DESC="${1:-$(date +%Y%m%d-%H%M%S)}"
PR_TITLE="${2:-}"
PR_BODY="${3:-}"

# Sanitize branch description for use in branch name
# Add timestamp suffix to prevent collisions
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
SANITIZED=$(echo "$BRANCH_DESC" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g' | sed 's/--*/-/g' | sed 's/^-//' | sed 's/-$//' | cut -c1-40)
BRANCH_NAME="auto/${SANITIZED}-${TIMESTAMP}"

# Get current branch
CURRENT_BRANCH=$(git branch --show-current)

# Check if we're already on a branch that's not main
if [ "$CURRENT_BRANCH" = "main" ] || [ "$CURRENT_BRANCH" = "master" ]; then
    # Create and switch to new branch
    git checkout -b "$BRANCH_NAME"
    echo "✓ Created branch: $BRANCH_NAME"
else
    BRANCH_NAME="$CURRENT_BRANCH"
    echo "✓ Using existing branch: $BRANCH_NAME"
fi

# Check if there are commits to push
COMMITS_AHEAD=$(git rev-list --count origin/main..HEAD 2>/dev/null || echo "0")
if [ "$COMMITS_AHEAD" = "0" ]; then
    echo "⚠ No commits ahead of main. Nothing to push."
    "$SCRIPT_DIR/notify.sh" "PR Creation Failed" "No commits to push"
    exit 1
fi

# Push to remote
git push -u origin "$BRANCH_NAME" 2>/dev/null || git push origin "$BRANCH_NAME"
echo "✓ Pushed to origin/$BRANCH_NAME"

# Generate PR title if not provided
if [ -z "$PR_TITLE" ]; then
    # Use the most recent commit message as title
    PR_TITLE=$(git log -1 --format='%s')
fi

# Generate PR body if not provided
if [ -z "$PR_BODY" ]; then
    # Get commit summaries
    COMMITS=$(git log origin/main..HEAD --format='- %s' 2>/dev/null | head -20)
    PR_BODY="## Summary
Auto-generated PR from Claude Code workflow.

## Commits
$COMMITS

## Test Status
Tests should be run before merging."
fi

# Create PR using gh CLI
PR_URL=$(gh pr create \
    --title "$PR_TITLE" \
    --body "$PR_BODY" \
    --base main \
    --head "$BRANCH_NAME" \
    2>&1)

if [ $? -eq 0 ]; then
    echo "✓ PR created successfully"
    "$SCRIPT_DIR/notify.sh" "PR Ready for Review" "$PR_TITLE" "$PR_URL"
else
    # Check if PR already exists
    EXISTING_PR=$(gh pr view "$BRANCH_NAME" --json url --jq '.url' 2>/dev/null || echo "")
    if [ -n "$EXISTING_PR" ]; then
        echo "✓ PR already exists"
        "$SCRIPT_DIR/notify.sh" "PR Already Exists" "$PR_TITLE" "$EXISTING_PR"
    else
        echo "✗ Failed to create PR: $PR_URL"
        "$SCRIPT_DIR/notify.sh" "PR Creation Failed" "$PR_URL"
        exit 1
    fi
fi
