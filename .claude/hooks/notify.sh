#!/bin/bash
# Notification helper for Claude Code
# Usage: notify.sh "Title" "Message" ["URL"]
# Sends PR notifications to Slack
# Requires: SLACK_PR_WEBHOOK_URL environment variable

set -euo pipefail

# Source .env from repo root if it exists
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || REPO_ROOT=""
if [ -n "$REPO_ROOT" ] && [ -f "$REPO_ROOT/.env" ]; then
    set -a
    source "$REPO_ROOT/.env"
    set +a
fi

# JSON escape function to prevent injection
json_escape() {
    local str="$1"
    # Escape backslashes first, then other special characters
    str="${str//\\/\\\\}"      # backslash
    str="${str//\"/\\\"}"      # double quote
    str="${str//$'\n'/\\n}"    # newline
    str="${str//$'\r'/\\r}"    # carriage return
    str="${str//$'\t'/\\t}"    # tab
    printf '%s' "$str"
}

TITLE="${1:-Notification}"
MESSAGE="${2:-}"
URL="${3:-}"

# Print to terminal
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🔔 $TITLE"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if [ -n "$MESSAGE" ]; then
    echo "$MESSAGE"
fi
if [ -n "$URL" ]; then
    echo ""
    echo "🔗 $URL"
fi
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Check for Slack webhook URL
if [ -z "${SLACK_PR_WEBHOOK_URL:-}" ]; then
    echo "⚠ SLACK_PR_WEBHOOK_URL not set, skipping Slack notification"
    exit 0
fi

# Escape user input for JSON
SAFE_TITLE=$(json_escape "$TITLE")
SAFE_MESSAGE=$(json_escape "$MESSAGE")
SAFE_URL=$(json_escape "$URL")

# Build Slack message text with optional @mention
MENTION=""
if [ -n "${SLACK_USER_ID:-}" ]; then
    MENTION="<@${SLACK_USER_ID}> "
fi

if [ -n "$URL" ]; then
    SLACK_TEXT="${MENTION}*${SAFE_TITLE}*\\n${SAFE_MESSAGE}\\n<${SAFE_URL}|View PR>"
else
    SLACK_TEXT="${MENTION}*${SAFE_TITLE}*\\n${SAFE_MESSAGE}"
fi

# Send to Slack
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$SLACK_PR_WEBHOOK_URL" \
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
    echo "✗ Failed to send Slack notification (curl error)"
    exit 1
}

if [ "$HTTP_STATUS" -eq 200 ]; then
    echo "✓ Sent to Slack"
else
    echo "✗ Slack notification failed (HTTP $HTTP_STATUS)"
    exit 1
fi
