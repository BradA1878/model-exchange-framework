/**
 * Copyright 2024 Brad Anderson
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * @author Brad Anderson <BradA1878@pm.me>
 * @repository https://github.com/BradA1878/model-exchange-framework
 * @documentation https://brada1878.github.io/model-exchange-framework/
 */

/**
 * CommandSemantics.ts
 *
 * Maps shell commands to exit-code interpretation rules so that agents can
 * distinguish between genuine errors and non-error, semantically meaningful
 * non-zero exit codes. For example, `grep` returning exit code 1 means
 * "no matches found" -- not a failure. Without this module agents would
 * incorrectly classify many successful-but-empty results as errors.
 */

import { Logger } from '../../../../utils/Logger';

const logger = new Logger('info', 'CommandSemantics', 'server');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * The result of interpreting a command's exit code through semantic rules.
 */
export interface CommandSemanticResult {
    /** Human-readable meaning of the exit code */
    meaning: string;
    /** Whether this exit code represents an actual error */
    isError: boolean;
    /** True when exit code is non-zero but NOT an error (semantic meaning) */
    isSemanticNonZero: boolean;
}

/**
 * A handler function that interprets a specific command's exit code,
 * optionally considering stdout and stderr content for richer diagnostics.
 */
type CommandSemantic = (exitCode: number, stdout: string, stderr: string) => CommandSemanticResult;

// ---------------------------------------------------------------------------
// Default semantic -- used for commands without a specific entry
// ---------------------------------------------------------------------------

/**
 * Default exit-code interpretation: exit 0 is success, anything else is an error.
 * This is the POSIX convention and applies to the vast majority of commands.
 */
const DEFAULT_SEMANTIC: CommandSemantic = (exitCode: number): CommandSemanticResult => {
    if (exitCode === 0) {
        return { meaning: 'Command completed successfully', isError: false, isSemanticNonZero: false };
    }
    return { meaning: `Command failed with exit code ${exitCode}`, isError: true, isSemanticNonZero: false };
};

// ---------------------------------------------------------------------------
// Per-command semantic handlers
// ---------------------------------------------------------------------------

/**
 * Semantic handler for grep and ripgrep (rg).
 *
 * Exit codes (POSIX / GNU grep):
 *   0 - One or more matches found
 *   1 - No matches found (this is NOT an error)
 *   2+ - An actual error occurred (bad regex, inaccessible file, etc.)
 */
const grepSemantic: CommandSemantic = (exitCode: number): CommandSemanticResult => {
    if (exitCode === 0) {
        return { meaning: 'Command completed successfully', isError: false, isSemanticNonZero: false };
    }
    if (exitCode === 1) {
        return { meaning: 'No matches found', isError: false, isSemanticNonZero: true };
    }
    return { meaning: `grep error (exit code ${exitCode})`, isError: true, isSemanticNonZero: false };
};

/**
 * Semantic handler for diff.
 *
 * Exit codes (POSIX diff):
 *   0 - Files are identical
 *   1 - Files differ (this is NOT an error -- it is the expected output when files differ)
 *   2+ - An actual error occurred (missing file, permission denied, etc.)
 */
const diffSemantic: CommandSemantic = (exitCode: number): CommandSemanticResult => {
    if (exitCode === 0) {
        return { meaning: 'Command completed successfully', isError: false, isSemanticNonZero: false };
    }
    if (exitCode === 1) {
        return { meaning: 'Files differ', isError: false, isSemanticNonZero: true };
    }
    return { meaning: `diff error (exit code ${exitCode})`, isError: true, isSemanticNonZero: false };
};

/**
 * Semantic handler for cmp (byte-by-byte file comparison).
 *
 * Exit codes:
 *   0 - Files are identical
 *   1 - Files differ (NOT an error)
 *   2+ - An error occurred (missing file, etc.)
 */
const cmpSemantic: CommandSemantic = (exitCode: number): CommandSemanticResult => {
    if (exitCode === 0) {
        return { meaning: 'Command completed successfully', isError: false, isSemanticNonZero: false };
    }
    if (exitCode === 1) {
        return { meaning: 'Files differ', isError: false, isSemanticNonZero: true };
    }
    return { meaning: `cmp error (exit code ${exitCode})`, isError: true, isSemanticNonZero: false };
};

/**
 * Semantic handler for test / [ (shell conditional expressions).
 *
 * Exit codes:
 *   0 - Condition evaluated to true
 *   1 - Condition evaluated to false (NOT an error -- it is a valid boolean result)
 *   2+ - A usage or syntax error occurred
 */
const testSemantic: CommandSemantic = (exitCode: number): CommandSemanticResult => {
    if (exitCode === 0) {
        return { meaning: 'Command completed successfully', isError: false, isSemanticNonZero: false };
    }
    if (exitCode === 1) {
        return { meaning: 'Condition is false', isError: false, isSemanticNonZero: true };
    }
    return { meaning: `test error (exit code ${exitCode})`, isError: true, isSemanticNonZero: false };
};

/**
 * Semantic handler for find.
 *
 * Exit codes (GNU find):
 *   0 - All paths were successfully traversed
 *   1 - Some directories were inaccessible (permission denied, etc.)
 *       but find still produced output for accessible paths -- NOT a hard error
 *   2+ - A more severe error occurred (bad expression, etc.)
 */
const findSemantic: CommandSemantic = (exitCode: number): CommandSemanticResult => {
    if (exitCode === 0) {
        return { meaning: 'Command completed successfully', isError: false, isSemanticNonZero: false };
    }
    if (exitCode === 1) {
        return { meaning: 'Some directories were inaccessible', isError: false, isSemanticNonZero: true };
    }
    return { meaning: `find error (exit code ${exitCode})`, isError: true, isSemanticNonZero: false };
};

/**
 * Semantic handler for curl.
 *
 * curl uses a wide range of exit codes -- all non-zero codes are errors,
 * but each has a specific meaning that helps agents diagnose issues.
 *
 * Common exit codes:
 *   0  - Success
 *   1  - Unsupported protocol
 *   2  - Failed to initialize
 *   3  - URL malformed
 *   5  - Could not resolve proxy
 *   6  - Could not resolve host
 *   7  - Failed to connect to host
 *   22 - HTTP page not retrieved (server returned >= 400)
 *   23 - Write error (disk full, permission denied, etc.)
 *   26 - Read error (local file I/O issue)
 *   27 - Out of memory
 *   28 - Operation timed out
 *   35 - SSL connect error
 *   47 - Too many redirects
 *   51 - Peer's SSL certificate or SSH key was not OK
 *   52 - Server returned nothing (empty response)
 *   56 - Failure receiving network data
 *   60 - SSL certificate problem
 *   67 - Login denied (authentication failure)
 */
const curlSemantic: CommandSemantic = (exitCode: number): CommandSemanticResult => {
    if (exitCode === 0) {
        return { meaning: 'Command completed successfully', isError: false, isSemanticNonZero: false };
    }

    // Map well-known curl exit codes to specific messages for agent diagnostics
    const curlExitCodes: Record<number, string> = {
        1: 'Unsupported protocol',
        2: 'Failed to initialize',
        3: 'URL malformed',
        5: 'Could not resolve proxy',
        6: 'Could not resolve host',
        7: 'Failed to connect',
        22: 'HTTP page not retrieved (server returned error status)',
        23: 'Write error',
        26: 'Read error',
        27: 'Out of memory',
        28: 'Operation timed out',
        35: 'SSL connect error',
        47: 'Too many redirects',
        51: 'SSL certificate verification failed',
        52: 'Server returned empty response',
        56: 'Failure receiving network data',
        60: 'SSL certificate problem',
        67: 'Login denied',
    };

    const specificMeaning = curlExitCodes[exitCode];
    const meaning = specificMeaning
        ? `curl: ${specificMeaning} (exit code ${exitCode})`
        : `curl error (exit code ${exitCode})`;

    return { meaning, isError: true, isSemanticNonZero: false };
};

// ---------------------------------------------------------------------------
// Command semantics registry
// ---------------------------------------------------------------------------

/**
 * Maps base command names to their semantic exit-code interpreters.
 * Each entry defines how to interpret non-zero exit codes for that command.
 */
const COMMAND_SEMANTICS: Map<string, CommandSemantic> = new Map([
    // grep and ripgrep share identical exit-code conventions
    ['grep', grepSemantic],
    ['rg', grepSemantic],

    // diff: exit 1 means "files differ", not an error
    ['diff', diffSemantic],

    // cmp: exit 1 means "files differ", not an error
    ['cmp', cmpSemantic],

    // test / [: exit 1 means "condition is false", not an error
    ['test', testSemantic],
    ['[', testSemantic],

    // find: exit 1 means partial traversal (some dirs inaccessible)
    ['find', findSemantic],

    // curl: all non-zero are errors, but each code has a specific meaning
    ['curl', curlSemantic],
]);

// ---------------------------------------------------------------------------
// Command extraction
// ---------------------------------------------------------------------------

/**
 * Extract the base command that determines the exit code from a compound
 * command string.
 *
 * For pipelines (`cmd1 | cmd2`), the LAST command determines the exit code
 * (unless `pipefail` is set, but we follow default shell behavior).
 *
 * For sequential commands (`cmd1 && cmd2`, `cmd1; cmd2`), the LAST executed
 * command determines the exit code.
 *
 * Handles env-var prefixes (`FOO=bar cmd`) by stripping them.
 *
 * @param command - The full command string as passed to the shell
 * @returns The base command name (e.g., "grep", "curl", "diff")
 */
export function extractExitCodeCommand(command: string): string {
    const trimmed = command.trim();

    if (!trimmed) {
        return '';
    }

    // For pipelines, the last segment determines the exit code.
    // Split on | but not || (which is logical OR, not pipe).
    // We use a regex to split on standalone | characters.
    const pipeSegments = trimmed.split(/(?<!\|)\|(?!\|)/);
    let lastSegment = pipeSegments[pipeSegments.length - 1].trim();

    // For sequential commands (&&, ;), take the last segment.
    // Split on && or ; to get the final command in the chain.
    const sequentialSegments = lastSegment.split(/&&|;/);
    lastSegment = sequentialSegments[sequentialSegments.length - 1].trim();

    // Strip env-var prefixes: patterns like VAR=value before the actual command.
    // Env-var assignments match IDENTIFIER=VALUE (value may be quoted or unquoted).
    let remaining = lastSegment;
    while (true) {
        // Match env-var prefix: WORD=<value> where value can be single-quoted,
        // double-quoted, or an unquoted non-whitespace sequence.
        const envVarMatch = remaining.match(/^[A-Za-z_][A-Za-z0-9_]*=(?:'[^']*'|"[^"]*"|\S*)\s+/);
        if (envVarMatch) {
            remaining = remaining.slice(envVarMatch[0].length);
        } else {
            break;
        }
    }

    // The first token of what remains is the command name.
    // Strip any leading path (e.g., /usr/bin/grep -> grep).
    const firstToken = remaining.split(/\s+/)[0] || '';
    const baseName = firstToken.split('/').pop() || firstToken;

    logger.debug(`Extracted base command "${baseName}" from "${command}"`);

    return baseName;
}

// ---------------------------------------------------------------------------
// Main interpretation function
// ---------------------------------------------------------------------------

/**
 * Interpret a command's exit code using semantic rules specific to that command.
 *
 * Looks up the base command in the `COMMAND_SEMANTICS` registry and applies
 * command-specific interpretation rules. Falls back to `DEFAULT_SEMANTIC` for
 * commands without a specific entry (exit 0 = success, non-zero = error).
 *
 * For exit code 0, always returns success regardless of the command, since
 * exit 0 universally means "completed successfully" in POSIX.
 *
 * @param command - The full command string (may include pipes, env vars, etc.)
 * @param exitCode - The exit code returned by the process
 * @param stdout - Standard output content (optional, used by some semantics)
 * @param stderr - Standard error content (optional, used by some semantics)
 * @returns Semantic interpretation of the exit code
 */
export function interpretExitCode(
    command: string,
    exitCode: number,
    stdout?: string,
    stderr?: string
): CommandSemanticResult {
    // Exit code 0 is universally "success" -- no need to look up command-specific rules
    if (exitCode === 0) {
        return { meaning: 'Command completed successfully', isError: false, isSemanticNonZero: false };
    }

    const baseCommand = extractExitCodeCommand(command);
    const semantic = COMMAND_SEMANTICS.get(baseCommand) || DEFAULT_SEMANTIC;
    const result = semantic(exitCode, stdout || '', stderr || '');

    // Log semantic non-zero cases at debug level so agents can trace decisions
    if (result.isSemanticNonZero) {
        logger.debug(
            `Semantic non-zero exit for "${baseCommand}": exit ${exitCode} => "${result.meaning}" (not an error)`
        );
    }

    return result;
}
