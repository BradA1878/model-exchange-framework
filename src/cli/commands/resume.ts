/**
 * MXF CLI Resume Command
 *
 * Displays a past TUI session's conversation in the terminal (view-only).
 * Loads session data from ~/.mxf/sessions/ — no server connection required.
 *
 * Usage:
 *   mxf resume <session-id>          # Display session conversation
 *   mxf resume <session-id> --json   # Output raw SessionRecord as JSON
 *
 * @author Brad Anderson <BradA1878@pm.me>
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { SessionHistoryService } from '../tui/services/SessionHistory';
import { formatCostSummary } from '../tui/services/CostTracker';
import { logError, logInfo } from '../utils/output';
import type { ConversationEntry } from '../tui/types';

/** Agent display colors for terminal output (matches TUI dark theme) */
const AGENT_COLORS: Record<string, (text: string) => string> = {
    'mxf-planner': chalk.white,
    'mxf-operator': chalk.cyan,
    'mxf-executor': chalk.yellow,
    'mxf-reviewer': chalk.green,
};

/**
 * Format a single conversation entry for terminal output.
 * Uses chalk for coloring since we're outside the Ink/React TUI.
 */
function formatEntry(entry: ConversationEntry): string | null {
    switch (entry.type) {
        case 'user':
            return chalk.bold.white(`> ${entry.content}`);

        case 'agent': {
            const colorFn = AGENT_COLORS[entry.agentId || ''] || chalk.white;
            const name = entry.agentName || entry.agentId || 'Agent';
            return `${colorFn(name)}  ${entry.content}`;
        }

        case 'tool-call': {
            const name = entry.agentName || entry.agentId || 'Agent';
            const tool = entry.toolName || 'unknown';
            return chalk.dim(`  [${name}] ${tool}`);
        }

        case 'tool-result':
            return chalk.dim(`  [result] ${entry.content.substring(0, 120)}`);

        case 'system':
            return chalk.dim(entry.content);

        case 'error':
            return chalk.red(`  ${entry.content}`);

        case 'activity-card': {
            const name = entry.agentName || 'Agent';
            const status = entry.activityStatus === 'completed' ? chalk.green('✓')
                : entry.activityStatus === 'failed' ? chalk.red('✗')
                : '●';
            const summary = entry.activitySummary || entry.content;
            return chalk.dim(`  ${name} ${status} ${summary}`);
        }

        case 'confirmation-prompt':
            // Skip confirmation prompts in replay (they're stale)
            return null;

        default:
            return entry.content;
    }
}

/**
 * Register the `mxf resume` command with the CLI program.
 *
 * Loads and displays a past session's conversation entries.
 * View-only mode — no agent reconnection or continuation.
 */
export function registerResumeCommand(program: Command): void {
    program
        .command('resume')
        .description('Display a past session conversation (view-only)')
        .argument('<session-id>', 'Session ID to display (from `mxf history`)')
        .option('--json', 'Output the full session record as JSON')
        .action(async (sessionId: string, options: { json?: boolean }) => {
            try {
                const historyService = new SessionHistoryService();
                const record = await historyService.load(sessionId);

                if (!record) {
                    logError(`Session not found: ${sessionId}`);
                    logInfo('Run `mxf history` to see available sessions.');
                    process.exit(1);
                }

                if (options.json) {
                    console.log(JSON.stringify(record, null, 2));
                    return;
                }

                // Print session header
                const startDate = new Date(record.startTime);
                const durationMs = record.endTime - record.startTime;
                const durationMin = Math.floor(durationMs / 60000);
                const durationSec = Math.floor((durationMs % 60000) / 1000);
                const duration = durationMin > 0 ? `${durationMin}m ${durationSec}s` : `${durationSec}s`;

                console.log('');
                console.log(chalk.bold(`Session: ${record.sessionId}`));
                console.log(chalk.dim(`  Date:     ${startDate.toLocaleDateString()} ${startDate.toLocaleTimeString()}`));
                console.log(chalk.dim(`  Duration: ${duration}`));
                console.log(chalk.dim(`  Model:    ${record.model}`));
                console.log(chalk.dim(`  Entries:  ${record.entryCount}`));
                console.log(chalk.dim('─'.repeat(60)));
                console.log('');

                // Print each entry
                for (const entry of record.entries) {
                    const formatted = formatEntry(entry);
                    if (formatted !== null) {
                        console.log(formatted);
                    }
                }

                // Print cost summary
                console.log('');
                console.log(chalk.dim('─'.repeat(60)));
                console.log(formatCostSummary(record.costData));
            } catch (error: any) {
                logError(`Failed to load session: ${error.message}`);
                process.exit(1);
            }
        });
}
