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
 * CommandClassification — classifies shell commands by their nature for
 * downstream decision-making (concurrency safety, output formatting,
 * permission shortcuts).
 */

import { Logger } from '../../../../utils/Logger';

const logger = new Logger('info', 'CommandClassification', 'server');

// ─── Category Enum ──────────────────────────────────────────────────────────────

/** Primary category describing the nature of a shell command. */
export enum CommandCategory {
    READ = 'read',
    SEARCH = 'search',
    LIST = 'list',
    WRITE = 'write',
    GIT = 'git',
    EXECUTE = 'execute',
    NETWORK = 'network',
    SYSTEM = 'system',
    UNKNOWN = 'unknown'
}

// ─── Classification Interface ───────────────────────────────────────────────────

/** Result of classifying a shell command. */
export interface CommandClassification {
    /** Primary category of the command */
    category: CommandCategory;
    /** Whether the command only reads data (safe for concurrent execution) */
    isReadOnly: boolean;
    /** Whether the command produces no useful stdout on success (mkdir, touch, mv, cp) */
    isSilent: boolean;
    /** Whether the command is semantically neutral — pure output commands (echo, printf, true, false) */
    isSemanticNeutral: boolean;
}

// ─── Command Sets (const Sets for O(1) lookup) ─────────────────────────────────

/** Commands that read file contents without modification. */
const READ_COMMANDS = new Set([
    'cat', 'head', 'tail', 'less', 'more', 'file', 'stat', 'wc',
    'strings', 'od', 'xxd', 'hexdump'
]);

/** Commands that search for files or content. */
const SEARCH_COMMANDS = new Set([
    'grep', 'egrep', 'fgrep', 'rg', 'find', 'fd', 'ag', 'ack',
    'locate', 'which', 'whereis', 'type'
]);

/** Commands that list filesystem or system entries. */
const LIST_COMMANDS = new Set([
    'ls', 'dir', 'tree', 'du', 'df', 'lsof', 'lsblk'
]);

/** Commands that modify the filesystem. */
const WRITE_COMMANDS = new Set([
    'cp', 'mv', 'rm', 'mkdir', 'rmdir', 'touch', 'chmod', 'chown',
    'chgrp', 'ln', 'install', 'mktemp'
]);

/** Commands that execute programs or compilers. */
const EXECUTE_COMMANDS = new Set([
    'node', 'python', 'python3', 'bun', 'deno', 'npm', 'yarn', 'pnpm',
    'make', 'cargo', 'go', 'ruby', 'perl', 'php', 'java', 'javac',
    'gcc', 'g++', 'clang', 'rustc', 'tsc'
]);

/** Commands that interact with the network. */
const NETWORK_COMMANDS = new Set([
    'curl', 'wget', 'ping', 'ssh', 'scp', 'sftp', 'rsync', 'nc',
    'ncat', 'telnet', 'ftp', 'dig', 'nslookup', 'host'
]);

/** Commands that query or manage system state. */
const SYSTEM_COMMANDS = new Set([
    'ps', 'top', 'htop', 'kill', 'killall', 'pkill', 'systemctl',
    'service', 'journalctl', 'dmesg', 'mount', 'umount', 'free',
    'uptime', 'uname', 'hostname', 'whoami', 'id', 'env', 'printenv'
]);

/** Commands that produce no useful stdout on success. */
const SILENT_COMMANDS = new Set([
    'cp', 'mv', 'rm', 'mkdir', 'rmdir', 'touch', 'chmod', 'chown',
    'chgrp', 'ln', 'cd', 'export', 'unset', 'wait', 'alias', 'unalias'
]);

/** Commands that are semantically neutral — pure output or no-ops. */
const SEMANTIC_NEUTRAL_COMMANDS = new Set([
    'echo', 'printf', 'true', 'false', ':'
]);

/** Data processing commands — read-only but transform data. */
const DATA_PROCESSING_COMMANDS = new Set([
    'jq', 'awk', 'sed', 'cut', 'sort', 'uniq', 'tr', 'paste',
    'join', 'comm', 'tee', 'xargs'
]);

/** Git subcommands that only read repository state. */
const GIT_READ_SUBCOMMANDS = new Set([
    'status', 'log', 'diff', 'show', 'branch', 'tag', 'remote',
    'fetch', 'stash', 'config', 'blame', 'shortlog', 'describe',
    'rev-parse', 'ls-files', 'ls-tree', 'cat-file', 'reflog'
]);

// ─── Category Priority (higher index = more dangerous) ─────────────────────────

/**
 * Priority ordering for compound command classification.
 * When multiple subcommands have different categories, the most dangerous wins.
 */
const CATEGORY_PRIORITY: readonly CommandCategory[] = [
    CommandCategory.UNKNOWN,
    CommandCategory.LIST,
    CommandCategory.READ,
    CommandCategory.SEARCH,
    CommandCategory.GIT,
    CommandCategory.SYSTEM,
    CommandCategory.NETWORK,
    CommandCategory.EXECUTE,
    CommandCategory.WRITE,
] as const;

// ─── Internal Helpers ───────────────────────────────────────────────────────────

/**
 * Extract the base command from a single command string.
 * Strips leading environment variable assignments (FOO=bar) and returns the
 * first real token, which is the executable name.
 */
function extractBaseCommand(command: string): string {
    const tokens = command.trim().split(/\s+/);
    // Skip env var prefixes like FOO=bar
    for (const token of tokens) {
        if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) {
            continue;
        }
        return token;
    }
    return '';
}

/**
 * Classify a single (non-compound) command string.
 * Returns its category and per-command flags.
 */
function classifySingleCommand(command: string): CommandClassification {
    const trimmed = command.trim();
    if (!trimmed) {
        return {
            category: CommandCategory.UNKNOWN,
            isReadOnly: true,
            isSilent: true,
            isSemanticNeutral: false,
        };
    }

    const baseCommand = extractBaseCommand(trimmed);
    if (!baseCommand) {
        return {
            category: CommandCategory.UNKNOWN,
            isReadOnly: true,
            isSilent: true,
            isSemanticNeutral: false,
        };
    }

    // Semantic neutral check (echo, printf, true, false, :)
    if (SEMANTIC_NEUTRAL_COMMANDS.has(baseCommand)) {
        return {
            category: CommandCategory.UNKNOWN,
            isReadOnly: true,
            isSilent: false,
            isSemanticNeutral: true,
        };
    }

    // Git — needs subcommand inspection
    if (baseCommand === 'git') {
        return classifyGitCommand(trimmed);
    }

    // sed — check for -i (in-place edit) to determine read vs write
    if (baseCommand === 'sed') {
        return classifySedCommand(trimmed);
    }

    // Category lookup
    if (WRITE_COMMANDS.has(baseCommand)) {
        return {
            category: CommandCategory.WRITE,
            isReadOnly: false,
            isSilent: SILENT_COMMANDS.has(baseCommand),
            isSemanticNeutral: false,
        };
    }

    if (EXECUTE_COMMANDS.has(baseCommand)) {
        return {
            category: CommandCategory.EXECUTE,
            isReadOnly: false,
            isSilent: false,
            isSemanticNeutral: false,
        };
    }

    if (NETWORK_COMMANDS.has(baseCommand)) {
        return {
            category: CommandCategory.NETWORK,
            isReadOnly: false,
            isSilent: false,
            isSemanticNeutral: false,
        };
    }

    if (SYSTEM_COMMANDS.has(baseCommand)) {
        // Some system commands are read-only (ps, free, uptime, etc.)
        const readOnlySystemCommands = new Set([
            'ps', 'top', 'htop', 'free', 'uptime', 'uname', 'hostname',
            'whoami', 'id', 'env', 'printenv', 'dmesg', 'journalctl'
        ]);
        return {
            category: CommandCategory.SYSTEM,
            isReadOnly: readOnlySystemCommands.has(baseCommand),
            isSilent: false,
            isSemanticNeutral: false,
        };
    }

    if (SEARCH_COMMANDS.has(baseCommand)) {
        return {
            category: CommandCategory.SEARCH,
            isReadOnly: true,
            isSilent: false,
            isSemanticNeutral: false,
        };
    }

    if (READ_COMMANDS.has(baseCommand)) {
        return {
            category: CommandCategory.READ,
            isReadOnly: true,
            isSilent: false,
            isSemanticNeutral: false,
        };
    }

    if (LIST_COMMANDS.has(baseCommand)) {
        return {
            category: CommandCategory.LIST,
            isReadOnly: true,
            isSilent: false,
            isSemanticNeutral: false,
        };
    }

    // Data processing commands — read-only by default (sed handled above)
    if (DATA_PROCESSING_COMMANDS.has(baseCommand)) {
        return {
            category: CommandCategory.READ,
            isReadOnly: true,
            isSilent: false,
            isSemanticNeutral: false,
        };
    }

    // Silent-only commands not in other categories (cd, export, etc.)
    if (SILENT_COMMANDS.has(baseCommand)) {
        return {
            category: CommandCategory.UNKNOWN,
            isReadOnly: false,
            isSilent: true,
            isSemanticNeutral: false,
        };
    }

    logger.debug(`CommandClassification: unknown command "${baseCommand}"`);
    return {
        category: CommandCategory.UNKNOWN,
        isReadOnly: false,
        isSilent: false,
        isSemanticNeutral: false,
    };
}

/**
 * Classify a git command by inspecting its subcommand.
 * Read-only git subcommands (status, log, diff, etc.) are safe for concurrency.
 * Some subcommands need further flag inspection (branch -d, tag -d, stash list).
 */
function classifyGitCommand(command: string): CommandClassification {
    const tokens = command.trim().split(/\s+/);
    // Find the subcommand — skip 'git' and any global flags (e.g., git -C /path status)
    let subcommand = '';
    for (let i = 1; i < tokens.length; i++) {
        const token = tokens[i];
        // Skip flags and their values
        if (token.startsWith('-')) {
            // Flags like -C take a value, skip next token too
            if (token === '-C' || token === '-c' || token === '--git-dir' || token === '--work-tree') {
                i++;
            }
            continue;
        }
        subcommand = token;
        break;
    }

    if (!subcommand) {
        // Bare 'git' with no subcommand — read-only (just prints help)
        return {
            category: CommandCategory.GIT,
            isReadOnly: true,
            isSilent: false,
            isSemanticNeutral: false,
        };
    }

    let isReadOnly = GIT_READ_SUBCOMMANDS.has(subcommand);

    // branch with -d or -D is a write operation
    if (subcommand === 'branch' && /\s-[dD]\b/.test(command)) {
        isReadOnly = false;
    }

    // tag with -d is a write operation
    if (subcommand === 'tag' && /\s-d\b/.test(command)) {
        isReadOnly = false;
    }

    // stash is only read-only for 'stash list'
    if (subcommand === 'stash') {
        const stashAction = tokens[tokens.indexOf('stash') + 1];
        isReadOnly = stashAction === 'list';
    }

    // config is only read-only with --get
    if (subcommand === 'config') {
        isReadOnly = /--get\b/.test(command);
    }

    return {
        category: CommandCategory.GIT,
        isReadOnly,
        isSilent: false,
        isSemanticNeutral: false,
    };
}

/**
 * Classify a sed command — sed with -i flag is a write, otherwise read-only.
 */
function classifySedCommand(command: string): CommandClassification {
    const tokens = command.trim().split(/\s+/);
    // Check for -i or --in-place flag
    const hasInPlace = tokens.some(t =>
        t === '-i' || t.startsWith('-i') || t === '--in-place'
    );

    if (hasInPlace) {
        return {
            category: CommandCategory.WRITE,
            isReadOnly: false,
            isSilent: true,
            isSemanticNeutral: false,
        };
    }

    return {
        category: CommandCategory.READ,
        isReadOnly: true,
        isSilent: false,
        isSemanticNeutral: false,
    };
}

/**
 * Split a command string on compound operators (&&, ||, ;).
 * Does not split on pipe operators (|) — pipelines are classified by their
 * first command (the data source).
 */
function splitCompoundCommand(command: string): string[] {
    // Split on &&, ||, ; but not on | (single pipe) or |& (bash pipe with stderr)
    // We need to avoid splitting inside quoted strings
    const parts: string[] = [];
    let current = '';
    let inSingleQuote = false;
    let inDoubleQuote = false;
    let i = 0;

    while (i < command.length) {
        const char = command[i];

        // Handle quote toggling
        if (char === "'" && !inDoubleQuote) {
            inSingleQuote = !inSingleQuote;
            current += char;
            i++;
            continue;
        }
        if (char === '"' && !inSingleQuote) {
            inDoubleQuote = !inDoubleQuote;
            current += char;
            i++;
            continue;
        }

        // Only split when outside quotes
        if (!inSingleQuote && !inDoubleQuote) {
            // Check for && operator
            if (char === '&' && i + 1 < command.length && command[i + 1] === '&') {
                parts.push(current);
                current = '';
                i += 2;
                continue;
            }
            // Check for || operator
            if (char === '|' && i + 1 < command.length && command[i + 1] === '|') {
                parts.push(current);
                current = '';
                i += 2;
                continue;
            }
            // Check for ; operator
            if (char === ';') {
                parts.push(current);
                current = '';
                i++;
                continue;
            }
        }

        current += char;
        i++;
    }

    if (current.trim()) {
        parts.push(current);
    }

    return parts.map(p => p.trim()).filter(p => p.length > 0);
}

/**
 * For a pipeline command (contains |), extract the first command (data source)
 * for classification purposes.
 */
function extractPipelineSource(command: string): string {
    let inSingleQuote = false;
    let inDoubleQuote = false;

    for (let i = 0; i < command.length; i++) {
        const char = command[i];

        if (char === "'" && !inDoubleQuote) {
            inSingleQuote = !inSingleQuote;
            continue;
        }
        if (char === '"' && !inSingleQuote) {
            inDoubleQuote = !inDoubleQuote;
            continue;
        }

        if (!inSingleQuote && !inDoubleQuote) {
            // Single pipe (but not ||)
            if (char === '|' && (i + 1 >= command.length || command[i + 1] !== '|')) {
                return command.substring(0, i).trim();
            }
        }
    }

    return command;
}

// ─── Public API ─────────────────────────────────────────────────────────────────

/**
 * Classify a shell command by its nature.
 * For simple commands, looks up the base command in category sets.
 * For compound commands (&&, ||, ;), classifies based on the most "dangerous" component.
 * For pipelines (|), classifies based on the first command (data source).
 */
export function classifyCommand(command: string): CommandClassification {
    const trimmed = command.trim();
    if (!trimmed) {
        logger.debug('CommandClassification: empty command received');
        return {
            category: CommandCategory.UNKNOWN,
            isReadOnly: true,
            isSilent: true,
            isSemanticNeutral: false,
        };
    }

    // Split compound commands
    const subcommands = splitCompoundCommand(trimmed);

    if (subcommands.length === 0) {
        return {
            category: CommandCategory.UNKNOWN,
            isReadOnly: true,
            isSilent: true,
            isSemanticNeutral: false,
        };
    }

    // Classify each subcommand (extracting pipeline source for piped commands)
    const classifications = subcommands.map(sub => {
        const source = extractPipelineSource(sub);
        return classifySingleCommand(source);
    });

    // For a single command, return directly
    if (classifications.length === 1) {
        return classifications[0];
    }

    // For compound commands:
    // - category = most dangerous
    // - isReadOnly = true only if ALL are read-only
    // - isSilent = true only if ALL are silent
    // - isSemanticNeutral = true only if ALL are semantic neutral
    let highestPriority = -1;
    let mostDangerousCategory = CommandCategory.UNKNOWN;

    for (const classification of classifications) {
        const priority = CATEGORY_PRIORITY.indexOf(classification.category);
        if (priority > highestPriority) {
            highestPriority = priority;
            mostDangerousCategory = classification.category;
        }
    }

    return {
        category: mostDangerousCategory,
        isReadOnly: classifications.every(c => c.isReadOnly),
        isSilent: classifications.every(c => c.isSilent),
        isSemanticNeutral: classifications.every(c => c.isSemanticNeutral),
    };
}

/**
 * Quick check if a command is read-only (safe for concurrent execution).
 */
export function isReadOnlyCommand(command: string): boolean {
    return classifyCommand(command).isReadOnly;
}
