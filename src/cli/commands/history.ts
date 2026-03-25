/**
 * MXF CLI History Command
 *
 * Lists past TUI sessions from ~/.mxf/sessions/.
 * Reads local session files only — no server connection required.
 *
 * Usage:
 *   mxf history              # List recent sessions (default: 20)
 *   mxf history --limit 50   # Show more sessions
 *   mxf history --json       # Output as JSON
 *
 * @author Brad Anderson <BradA1878@pm.me>
 */

import { Command } from 'commander';
import { SessionHistoryService, formatSessionList } from '../tui/services/SessionHistory';
import { logError, logInfo } from '../utils/output';

/**
 * Register the `mxf history` command with the CLI program.
 *
 * Lists saved session summaries from ~/.mxf/sessions/.
 * Reuses SessionHistoryService from the TUI (no React/Ink dependency).
 */
export function registerHistoryCommand(program: Command): void {
    program
        .command('history')
        .description('List past interactive sessions')
        .option('--limit <n>', 'Maximum number of sessions to show', '20')
        .option('--json', 'Output as JSON')
        .action(async (options: { limit?: string; json?: boolean }) => {
            try {
                const limit = parseInt(options.limit || '20', 10);
                if (isNaN(limit) || limit < 1) {
                    logError('--limit must be a positive number.');
                    process.exit(1);
                }

                const historyService = new SessionHistoryService();
                const summaries = await historyService.list();

                if (options.json) {
                    console.log(JSON.stringify(summaries.slice(0, limit), null, 2));
                    return;
                }

                const limited = summaries.slice(0, limit);
                const formatted = formatSessionList(limited);
                console.log(formatted);

                if (summaries.length > limit) {
                    logInfo(`Showing ${limit} of ${summaries.length} sessions. Use --limit to see more.`);
                }
            } catch (error: any) {
                logError(`Failed to load session history: ${error.message}`);
                process.exit(1);
            }
        });
}
