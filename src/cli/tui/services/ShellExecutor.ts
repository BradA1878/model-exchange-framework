/**
 * MXF CLI TUI — Shell Executor
 *
 * Executes shell commands for the `!command` prefix in the TUI input line.
 * Captures stdout, stderr, and exit code for display in the conversation area.
 *
 * @author Brad Anderson <BradA1878@pm.me>
 */

import { exec } from 'child_process';

/** Maximum execution time for shell commands (30 seconds) */
const SHELL_TIMEOUT_MS = 30_000;

/** Result from a shell command execution */
export interface ShellResult {
    /** Standard output from the command */
    stdout: string;
    /** Standard error from the command */
    stderr: string;
    /** Process exit code (0 = success) */
    exitCode: number;
}

/**
 * Execute a shell command and capture its output.
 *
 * @param command - The shell command to execute (without the `!` prefix)
 * @returns Captured stdout, stderr, and exit code
 */
export function executeShellCommand(command: string): Promise<ShellResult> {
    return new Promise((resolve) => {
        exec(command, { timeout: SHELL_TIMEOUT_MS, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
            resolve({
                stdout: stdout.toString().trimEnd(),
                stderr: stderr.toString().trimEnd(),
                exitCode: error ? (error.code ?? 1) : 0,
            });
        });
    });
}
