#!/bin/bash
# Test and PR hook for Claude Code
# Runs integration tests, creates PR only if tests pass
# Usage: test-and-pr.sh "branch-description" "PR title"

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$(git rev-parse --show-toplevel)" 2>/dev/null || exit 1

# Arguments
BRANCH_DESC="${1:-$(date +%Y%m%d-%H%M%S)}"
PR_TITLE="${2:-}"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🧪 Running Integration Tests"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Stream test output to temp file to avoid memory issues with large test suites
TEST_OUTPUT_FILE=$(mktemp)
trap "rm -f $TEST_OUTPUT_FILE" EXIT

# Run tests, streaming to file and showing progress
npm run test:integration:manual 2>&1 | tee "$TEST_OUTPUT_FILE" || TEST_EXIT_CODE=$?
TEST_EXIT_CODE=${TEST_EXIT_CODE:-0}

# Extract test summary from file
TEST_SUMMARY=$(grep -E "(Tests:|Test Suites:|Passed|Failed)" "$TEST_OUTPUT_FILE" | tail -5)

if [ $TEST_EXIT_CODE -eq 0 ]; then
    echo ""
    echo "✅ All tests passed!"
    echo ""
    echo "$TEST_SUMMARY"
    echo ""

    # Generate PR body with test results
    PR_BODY="## Summary
Auto-generated PR from Claude Code workflow.

## Test Results
\`\`\`
$TEST_SUMMARY
\`\`\`

✅ All integration tests passed before PR creation.

## Commits"

    # Add commit list
    COMMITS=$(git log origin/main..HEAD --format='- %s' 2>/dev/null | head -20)
    PR_BODY="$PR_BODY
$COMMITS"

    # Create PR
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "📤 Creating Pull Request"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

    "$SCRIPT_DIR/create-pr.sh" "$BRANCH_DESC" "$PR_TITLE" "$PR_BODY"
else
    echo ""
    echo "❌ Tests failed!"
    echo ""
    echo "$TEST_SUMMARY"
    echo ""

    # Show failing tests from temp file
    FAILED_TESTS=$(grep -A 2 "FAIL " "$TEST_OUTPUT_FILE" | head -20)
    if [ -n "$FAILED_TESTS" ]; then
        echo "Failed tests:"
        echo "$FAILED_TESTS"
    fi

    "$SCRIPT_DIR/notify.sh" "Tests Failed" "Fix failing tests before creating PR" ""

    echo ""
    echo "⚠ PR not created. Please fix failing tests first."
    exit 1
fi
