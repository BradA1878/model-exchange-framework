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
 */

/**
 * ShellCommandParser — Recursive descent parser for shell command strings.
 *
 * Replaces regex-based command extraction in the security guard, properly
 * handling compound commands, env prefixes, wrapper commands, quotes, and
 * redirections. The parser is designed for the 90% case: it is better to
 * extract too many commands (safe for security validation) than to miss any.
 */

import { Logger } from '../../../../utils/Logger';

const logger = new Logger('info', 'ShellCommandParser', 'server');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ParsedCommand {
    /** The actual command being run (after stripping env vars and wrappers) */
    effectiveCommand: string;
    /** All commands found in compound expressions */
    allCommands: string[];
    /** Whether the command contains output redirections (>, >>) */
    hasRedirections: boolean;
    /** Whether the command contains pipe operators (|) */
    hasPipes: boolean;
    /** Whether the command contains subshell constructs ($(), backticks) */
    hasSubshells: boolean;
    /** Whether the command contains compound operators (&&, ||, ;) */
    hasCompoundOperators: boolean;
    /** Environment variable prefixes found (FOO=bar) */
    envPrefixes: Record<string, string>;
    /** Wrapper commands stripped (timeout, env, nice, nohup, etc.) */
    wrapperCommands: string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Known wrapper commands and how many positional arguments each consumes
 * before the real command appears.
 *
 * Special values:
 *   -1 = variable args, handled by dedicated logic (sudo, env, nice)
 */
const WRAPPER_COMMANDS: Record<string, number> = {
    timeout: 1,   // timeout <duration> <cmd ...>
    env: -1,      // env [KEY=VAL ...] <cmd ...>
    nice: -1,     // nice [-n N] <cmd ...>
    nohup: 0,     // nohup <cmd ...>
    sudo: -1,     // sudo [-flags ...] <cmd ...>
    command: 0,   // command <cmd ...>
    exec: 0,      // exec <cmd ...>
    time: 0,      // time <cmd ...>
    strace: -1,   // strace [-flags ...] <cmd ...>
    ltrace: -1,   // ltrace [-flags ...] <cmd ...>
};

/**
 * Regex matching a shell environment variable assignment token (FOO=bar).
 * The value part may be quoted.
 */
const ENV_PREFIX_RE = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/;

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

/**
 * Tokenize a raw shell string into an array of tokens, respecting quoting
 * rules and preserving operator tokens as discrete entries.
 *
 * Operator tokens emitted: &&  ||  ;  |  >  >>  <  2>  2>&1  2>>
 *
 * The tokenizer walks character-by-character, tracking single- and
 * double-quote state. Backslash escapes are honoured inside double-quoted
 * strings.
 */
function tokenize(input: string): string[] {
    const tokens: string[] = [];
    let current = '';
    let i = 0;
    const len = input.length;
    let inSingleQuote = false;
    let inDoubleQuote = false;

    /** Flush the accumulated `current` buffer as a token. */
    const flush = (): void => {
        if (current.length > 0) {
            tokens.push(current);
            current = '';
        }
    };

    while (i < len) {
        const ch = input[i];

        // --- Inside single quotes: everything is literal until closing ' ---
        if (inSingleQuote) {
            if (ch === "'") {
                inSingleQuote = false;
            } else {
                current += ch;
            }
            i++;
            continue;
        }

        // --- Inside double quotes: honour backslash escapes ---
        if (inDoubleQuote) {
            if (ch === '\\' && i + 1 < len) {
                // Escaped character inside double quotes
                current += input[i + 1];
                i += 2;
                continue;
            }
            if (ch === '"') {
                inDoubleQuote = false;
            } else {
                current += ch;
            }
            i++;
            continue;
        }

        // --- Unquoted context ---

        // Backslash escape in unquoted context
        if (ch === '\\' && i + 1 < len) {
            current += input[i + 1];
            i += 2;
            continue;
        }

        // Enter single quote
        if (ch === "'") {
            inSingleQuote = true;
            // Add a zero-width marker so an empty quoted string produces a token
            if (current.length === 0) {
                current = '';
            }
            i++;
            continue;
        }

        // Enter double quote
        if (ch === '"') {
            inDoubleQuote = true;
            if (current.length === 0) {
                current = '';
            }
            i++;
            continue;
        }

        // Whitespace — flush token
        if (ch === ' ' || ch === '\t') {
            flush();
            i++;
            continue;
        }

        // Compound operators: &&, ||, ;
        if (ch === '&' && i + 1 < len && input[i + 1] === '&') {
            flush();
            tokens.push('&&');
            i += 2;
            continue;
        }
        if (ch === '|' && i + 1 < len && input[i + 1] === '|') {
            flush();
            tokens.push('||');
            i += 2;
            continue;
        }
        if (ch === ';') {
            flush();
            tokens.push(';');
            i++;
            continue;
        }

        // Pipe (single |, already ruled out ||)
        if (ch === '|') {
            flush();
            tokens.push('|');
            i++;
            continue;
        }

        // Redirections: 2>>&1 is not standard, but handle 2>&1, 2>>, 2>, >>, >
        if (ch === '2' && i + 1 < len && input[i + 1] === '>') {
            // Might be 2>&1 or 2>> or 2>
            flush();
            if (i + 2 < len && input[i + 2] === '&' && i + 3 < len && input[i + 3] === '1') {
                tokens.push('2>&1');
                i += 4;
            } else if (i + 2 < len && input[i + 2] === '>') {
                tokens.push('2>>');
                i += 3;
            } else {
                tokens.push('2>');
                i += 2;
            }
            continue;
        }

        // >> and >
        if (ch === '>') {
            flush();
            if (i + 1 < len && input[i + 1] === '>') {
                tokens.push('>>');
                i += 2;
            } else {
                tokens.push('>');
                i++;
            }
            continue;
        }

        // < (input redirection)
        if (ch === '<') {
            flush();
            tokens.push('<');
            i++;
            continue;
        }

        // Subshell detection: $( — we don't deeply parse, just flag
        // Backtick — same treatment
        // These are accumulated into the current token for now and
        // detected in a later pass.

        // Default: accumulate into current token
        current += ch;
        i++;
    }

    flush();
    return tokens;
}

// ---------------------------------------------------------------------------
// Compound splitting
// ---------------------------------------------------------------------------

/** Operator tokens that separate compound commands. */
const COMPOUND_OPS = new Set(['&&', '||', ';']);

/** Operator token for pipes. */
const PIPE_OP = '|';

/**
 * Split a flat token list on compound operators (&&, ||, ;) into segments,
 * each segment being the tokens of one pipeline.
 */
function splitOnCompoundOps(tokens: string[]): string[][] {
    const segments: string[][] = [];
    let current: string[] = [];

    for (const tok of tokens) {
        if (COMPOUND_OPS.has(tok)) {
            if (current.length > 0) {
                segments.push(current);
            }
            current = [];
        } else {
            current.push(tok);
        }
    }
    if (current.length > 0) {
        segments.push(current);
    }
    return segments;
}

/**
 * Split a token list on pipe operators into individual simple command
 * token lists.
 */
function splitOnPipes(tokens: string[]): string[][] {
    const segments: string[][] = [];
    let current: string[] = [];

    for (const tok of tokens) {
        if (tok === PIPE_OP) {
            if (current.length > 0) {
                segments.push(current);
            }
            current = [];
        } else {
            current.push(tok);
        }
    }
    if (current.length > 0) {
        segments.push(current);
    }
    return segments;
}

// ---------------------------------------------------------------------------
// Redirection tokens
// ---------------------------------------------------------------------------

const REDIRECTION_TOKENS = new Set(['>', '>>', '<', '2>', '2>>', '2>&1']);

// ---------------------------------------------------------------------------
// Simple command parsing
// ---------------------------------------------------------------------------

/**
 * Parse a single simple command (no pipes, no compound operators) from its
 * token list, stripping env prefixes and wrapper commands to find the
 * effective command name.
 *
 * Returns the effective command, env prefixes map, and wrapper commands list.
 */
function parseSimpleCommand(tokens: string[]): {
    effectiveCommand: string;
    envPrefixes: Record<string, string>;
    wrapperCommands: string[];
    hasRedirections: boolean;
} {
    const envPrefixes: Record<string, string> = {};
    const wrapperCommands: string[] = [];
    let hasRedirections = false;

    // Filter out redirection tokens and their targets from the working copy
    const commandTokens: string[] = [];
    let skipNext = false;
    for (let idx = 0; idx < tokens.length; idx++) {
        if (skipNext) {
            skipNext = false;
            continue;
        }
        const tok = tokens[idx];
        if (REDIRECTION_TOKENS.has(tok)) {
            hasRedirections = true;
            // The token after a redirection operator is the filename — skip it
            if (tok !== '2>&1') {
                skipNext = true;
            }
            continue;
        }
        commandTokens.push(tok);
    }

    // Strip leading env var prefixes (FOO=bar)
    let pos = 0;
    while (pos < commandTokens.length) {
        const match = ENV_PREFIX_RE.exec(commandTokens[pos]);
        if (match) {
            envPrefixes[match[1]] = match[2];
            pos++;
        } else {
            break;
        }
    }

    // Strip wrapper commands
    while (pos < commandTokens.length) {
        const tok = commandTokens[pos];
        const wrapperArgCount = WRAPPER_COMMANDS[tok];

        if (wrapperArgCount === undefined) {
            // Not a wrapper — this is the effective command
            break;
        }

        wrapperCommands.push(tok);
        pos++;

        if (wrapperArgCount >= 0) {
            // Skip the fixed number of arguments
            pos += wrapperArgCount;
        } else {
            // Variable-argument wrappers need special handling
            switch (tok) {
                case 'env':
                    // env skips KEY=VALUE pairs, then the next non-KEY=VALUE token is the command
                    while (pos < commandTokens.length && ENV_PREFIX_RE.test(commandTokens[pos])) {
                        const envMatch = ENV_PREFIX_RE.exec(commandTokens[pos]);
                        if (envMatch) {
                            envPrefixes[envMatch[1]] = envMatch[2];
                        }
                        pos++;
                    }
                    break;

                case 'nice':
                    // nice optionally takes -n <priority>
                    if (pos < commandTokens.length && commandTokens[pos] === '-n') {
                        pos += 2; // skip -n and the priority value
                    }
                    break;

                case 'sudo':
                    // sudo: skip flags (tokens starting with -) but not the command
                    while (pos < commandTokens.length && commandTokens[pos].startsWith('-')) {
                        pos++;
                    }
                    break;

                case 'strace':
                case 'ltrace':
                    // Skip flags (tokens starting with -) and their values
                    // Flags that take a value: -e, -o, -p, -s, -f is standalone
                    while (pos < commandTokens.length && commandTokens[pos].startsWith('-')) {
                        const flag = commandTokens[pos];
                        pos++;
                        // These flags consume the next token as their argument
                        if (['-e', '-o', '-p', '-s', '-S'].includes(flag) && pos < commandTokens.length) {
                            pos++;
                        }
                    }
                    break;

                default:
                    // Unknown variable-arg wrapper — just advance
                    break;
            }
        }
    }

    const effectiveCommand = pos < commandTokens.length ? commandTokens[pos] : '';

    return { effectiveCommand, envPrefixes, wrapperCommands, hasRedirections };
}

// ---------------------------------------------------------------------------
// Subshell detection
// ---------------------------------------------------------------------------

/**
 * Detect whether the raw command string contains subshell constructs
 * ($(...) or backticks) outside of single-quoted regions.
 */
function detectSubshells(raw: string): boolean {
    let inSingleQuote = false;
    let inDoubleQuote = false;

    for (let i = 0; i < raw.length; i++) {
        const ch = raw[i];

        if (ch === '\\' && !inSingleQuote && i + 1 < raw.length) {
            i++; // skip escaped char
            continue;
        }

        if (ch === "'" && !inDoubleQuote) {
            inSingleQuote = !inSingleQuote;
            continue;
        }

        if (ch === '"' && !inSingleQuote) {
            inDoubleQuote = !inDoubleQuote;
            continue;
        }

        if (inSingleQuote) {
            continue;
        }

        // $( outside single quotes
        if (ch === '$' && i + 1 < raw.length && raw[i + 1] === '(') {
            return true;
        }

        // Backtick outside single quotes
        if (ch === '`') {
            return true;
        }
    }

    return false;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse a shell command string into its structural components.
 * Handles compound commands, env prefixes, wrappers, quotes, redirections.
 * Falls back gracefully to simple string splitting for unparseable input.
 *
 * @param rawCommand - The raw shell command string to parse.
 * @returns A `ParsedCommand` describing the structural breakdown.
 */
export function parseCommand(rawCommand: string): ParsedCommand {
    const trimmed = rawCommand.trim();

    // Empty / whitespace-only input
    if (trimmed.length === 0) {
        return {
            effectiveCommand: '',
            allCommands: [],
            hasRedirections: false,
            hasPipes: false,
            hasSubshells: false,
            hasCompoundOperators: false,
            envPrefixes: {},
            wrapperCommands: [],
        };
    }

    try {
        const tokens = tokenize(trimmed);

        // Detect compound operators and pipes at the token level
        const hasCompoundOperators = tokens.some((t) => COMPOUND_OPS.has(t));
        const hasPipes = tokens.some((t) => t === PIPE_OP);
        const hasSubshells = detectSubshells(trimmed);

        // Split into compound segments, then each segment into pipeline stages
        const compoundSegments = splitOnCompoundOps(tokens);
        const allCommands: string[] = [];
        let mergedEnvPrefixes: Record<string, string> = {};
        let mergedWrappers: string[] = [];
        let mergedRedirections = false;
        let firstEffective = '';

        for (const segment of compoundSegments) {
            const pipelineStages = splitOnPipes(segment);

            for (const stage of pipelineStages) {
                const parsed = parseSimpleCommand(stage);

                if (parsed.effectiveCommand.length > 0) {
                    allCommands.push(parsed.effectiveCommand);
                }

                if (parsed.hasRedirections) {
                    mergedRedirections = true;
                }

                // Capture env prefixes and wrappers from the first command
                if (firstEffective === '' && parsed.effectiveCommand.length > 0) {
                    firstEffective = parsed.effectiveCommand;
                    mergedEnvPrefixes = parsed.envPrefixes;
                    mergedWrappers = parsed.wrapperCommands;
                }
            }
        }

        return {
            effectiveCommand: firstEffective,
            allCommands,
            hasRedirections: mergedRedirections,
            hasPipes,
            hasSubshells,
            hasCompoundOperators,
            envPrefixes: mergedEnvPrefixes,
            wrapperCommands: mergedWrappers,
        };
    } catch (err) {
        // Graceful fallback: never throw from the parser. Log a warning and
        // fall back to naive whitespace splitting so the security guard still
        // gets a command to check.
        logger.warn(
            `ShellCommandParser: failed to parse command, falling back to simple split: ${err instanceof Error ? err.message : String(err)}`
        );

        const fallbackParts = trimmed.split(/\s+/);
        const fallbackCmd = fallbackParts[0] || '';

        return {
            effectiveCommand: fallbackCmd,
            allCommands: fallbackCmd.length > 0 ? [fallbackCmd] : [],
            hasRedirections: false,
            hasPipes: false,
            hasSubshells: false,
            hasCompoundOperators: false,
            envPrefixes: {},
            wrapperCommands: [],
        };
    }
}

/**
 * Extract all effective commands from a compound command string.
 * This is the main entry point for security validation — every command
 * returned must be checked against allowlists/blocklists.
 *
 * CRITICAL SECURITY: The old code did `command.split(' ')[0]` which only
 * checks the first command. This function ensures ALL commands in
 * `echo hello; rm -rf /` are extracted and validated.
 *
 * @param rawCommand - The raw shell command string.
 * @returns An array of effective command names found in the input.
 */
export function extractEffectiveCommands(rawCommand: string): string[] {
    const parsed = parseCommand(rawCommand);
    return parsed.allCommands;
}
