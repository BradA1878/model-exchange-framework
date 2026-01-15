Review the task queue for completed sandboxed agent work.

1. Check `.claude/task-queue/` for notification JSON files (excluding the `processed/` subdirectory)
2. For each notification file found:
   - Parse the JSON and show: component name, timestamp, files modified/staged
   - Show the git diff for those files
   - Ask if I should stage and commit these changes
3. For approved changes:
   - Stage the files if not already staged
   - Commit with a descriptive message mentioning the component
4. After processing each notification:
   - Move the JSON file to `.claude/task-queue/processed/`
5. After all notifications are processed:
   - Ask if I should create a PR with all the committed changes
   - If yes, create a PR with a summary of all component work
