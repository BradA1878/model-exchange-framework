#!/bin/bash
# Notify umbrella agent that sandboxed work is complete
# Runs on Stop event for sandboxed agents
# Sends Slack notification via SLACK_COMMIT_WEBHOOK_URL

set -euo pipefail

# Get repo root, exit gracefully if not in a git repo
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || {
    echo "⚠ Not in a git repository, skipping notification"
    exit 0
}

# Source .env from repo root if it exists
if [ -f "$REPO_ROOT/.env" ]; then
    set -a
    source "$REPO_ROOT/.env"
    set +a
fi

# JSON escape function to prevent injection
json_escape() {
    local str="$1"
    str="${str//\\/\\\\}"      # backslash
    str="${str//\"/\\\"}"      # double quote
    str="${str//$'\n'/\\n}"    # newline
    str="${str//$'\r'/\\r}"    # carriage return
    str="${str//$'\t'/\\t}"    # tab
    printf '%s' "$str"
}

QUEUE_DIR="$REPO_ROOT/.claude/task-queue"
COMPONENT="${CLAUDE_COMPONENT:-unknown}"
TIMESTAMP=$(date -u +%Y%m%dT%H%M%SZ)
PID=$$

# Create queue directory if it doesn't exist
if ! mkdir -p "$QUEUE_DIR" 2>/dev/null; then
    echo "✗ Failed to create task-queue directory: $QUEUE_DIR"
    exit 1
fi

# Get list of modified files
MODIFIED=$(git diff --name-only 2>/dev/null | tr '\n' ',' | sed 's/,$//') || MODIFIED=""
STAGED=$(git diff --cached --name-only 2>/dev/null | tr '\n' ',' | sed 's/,$//') || STAGED=""

# Only write notification if there are changes
if [ -z "$MODIFIED" ] && [ -z "$STAGED" ]; then
    echo "✓ No changes to report"
    exit 0
fi

# Write notification file with PID for uniqueness
NOTIFICATION_FILE="$QUEUE_DIR/${TIMESTAMP}-${PID}-${COMPONENT}.json"

if ! cat > "$NOTIFICATION_FILE" << EOF
{
  "component": "$COMPONENT",
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "pid": "$PID",
  "status": "completed",
  "files_modified": "$MODIFIED",
  "files_staged": "$STAGED",
  "working_dir": "$(pwd)"
}
EOF
then
    echo "✗ Failed to write notification file: $NOTIFICATION_FILE"
    exit 1
fi

echo "✓ Notified umbrella agent: $COMPONENT work complete"
echo "  → $NOTIFICATION_FILE"

# Send Slack notification if webhook is configured
if [ -n "${SLACK_COMMIT_WEBHOOK_URL:-}" ]; then
    # Build file list for message
    FILE_LIST=""
    if [ -n "$MODIFIED" ]; then
        FILE_LIST="Modified: ${MODIFIED}"
    fi
    if [ -n "$STAGED" ]; then
        [ -n "$FILE_LIST" ] && FILE_LIST="${FILE_LIST}\n"
        FILE_LIST="${FILE_LIST}Staged: ${STAGED}"
    fi

    # Escape for JSON
    SAFE_COMPONENT=$(json_escape "$COMPONENT")
    SAFE_FILES=$(json_escape "$FILE_LIST")

    # Capitalize component name (portable)
    CAPITALIZED=$(echo "$SAFE_COMPONENT" | awk '{print toupper(substr($0,1,1)) tolower(substr($0,2))}')

    # Add @mention if configured
    MENTION=""
    if [ -n "${SLACK_USER_ID:-}" ]; then
        MENTION="<@${SLACK_USER_ID}> "
    fi

    SLACK_TEXT="${MENTION}🔔 *${CAPITALIZED} Agent Completed*\\n${SAFE_FILES}\\nRun \`/review-queue\` in umbrella to review"

    HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$SLACK_COMMIT_WEBHOOK_URL" \
        -H "Content-Type: application/json" \
        -d "{
            \"blocks\": [
                {
                    \"type\": \"section\",
                    \"text\": {
                        \"type\": \"mrkdwn\",
                        \"text\": \"$SLACK_TEXT\"
                    }
                }
            ]
        }" 2>/dev/null) || {
        echo "⚠ Failed to send Slack notification (curl error)"
    }

    if [ "$HTTP_STATUS" -eq 200 ]; then
        echo "✓ Sent to Slack"
    else
        echo "⚠ Slack notification failed (HTTP $HTTP_STATUS)"
    fi
else
    echo "⚠ SLACK_COMMIT_WEBHOOK_URL not set, skipping Slack notification"
fi
