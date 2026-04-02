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
 * DestructiveCommandWarnings.ts
 *
 * Provides purely informational warnings about destructive commands.
 * This module does NOT block execution — it returns human-readable warnings
 * for display and logging purposes only. It does not interact with
 * McpSecurityGuard or any enforcement mechanism.
 */

import { Logger } from '../../../../utils/Logger';

const logger = new Logger('info', 'DestructiveCommandWarnings', 'server');

/**
 * Informational warning about a potentially destructive command.
 * Advisory only — does not block execution.
 */
export interface DestructiveWarning {
    /** Human-readable warning message */
    warning: string;
    /** Severity level of the warning */
    severity: 'info' | 'warning' | 'danger';
}

/**
 * Internal pattern definition for matching destructive commands.
 */
interface DestructivePattern {
    pattern: RegExp;
    warning: string;
    severity: 'info' | 'warning' | 'danger';
}

/**
 * Known destructive command patterns organized by category.
 * Each pattern uses word boundaries to minimize false positives.
 */
const DESTRUCTIVE_PATTERNS: DestructivePattern[] = [
    // ─── Git — data loss (danger) ───────────────────────────────────────
    {
        pattern: /\bgit\b.*\breset\b.*--hard\b/,
        warning: 'May discard uncommitted changes',
        severity: 'danger',
    },
    {
        pattern: /\bgit\b.*\bpush\b.*(?:--force\b|-f\b)/,
        warning: 'May overwrite remote history',
        severity: 'danger',
    },
    {
        pattern: /\bgit\b.*\bclean\b.*-f\b/,
        warning: 'May permanently delete untracked files',
        severity: 'danger',
    },
    {
        pattern: /\bgit\b.*\bcheckout\b.*--\s*\./,
        warning: 'May discard all working tree changes',
        severity: 'danger',
    },
    {
        pattern: /\bgit\b.*\brestore\b.*\.\s*$/,
        warning: 'May discard all working tree changes',
        severity: 'danger',
    },

    // ─── Git — caution (warning) ────────────────────────────────────────
    {
        pattern: /\bgit\b.*\bstash\b.*\bdrop\b/,
        warning: 'May permanently remove stashed changes',
        severity: 'warning',
    },
    {
        pattern: /\bgit\b.*\bstash\b.*\bclear\b/,
        warning: 'May permanently remove stashed changes',
        severity: 'warning',
    },
    {
        pattern: /\bgit\b.*\bbranch\b.*-D\b/,
        warning: 'May force-delete a branch',
        severity: 'warning',
    },
    {
        pattern: /\bgit\b.*(?:\bcommit\b|\bpush\b|\bmerge\b).*--no-verify\b/,
        warning: 'Skips safety hooks',
        severity: 'warning',
    },

    // ─── Git — info ─────────────────────────────────────────────────────
    {
        pattern: /\bgit\b.*\bcommit\b.*--amend\b/,
        warning: 'May rewrite the last commit',
        severity: 'info',
    },

    // ─── File operations (danger) ───────────────────────────────────────
    {
        pattern: /\brm\b.*-(?:[a-z]*r[a-z]*f|[a-z]*f[a-z]*r)[a-z]*\b/,
        warning: 'May recursively force-remove files',
        severity: 'danger',
    },

    // ─── File operations (warning) ──────────────────────────────────────
    {
        pattern: /\brm\b.*-[a-z]*r[a-z]*\b(?!.*-[a-z]*f)/,
        warning: 'May recursively remove files',
        severity: 'warning',
    },
    {
        pattern: /\brm\b.*-[a-z]*f[a-z]*\b(?!.*-[a-z]*r)/,
        warning: 'May force-remove files without confirmation',
        severity: 'warning',
    },

    // ─── Database (danger) ──────────────────────────────────────────────
    {
        pattern: /\b(?:DROP)\s+(?:TABLE|DATABASE|SCHEMA)\b/i,
        warning: 'May drop or truncate database objects',
        severity: 'danger',
    },
    {
        pattern: /\bDELETE\s+FROM\s+\w+\s*;/i,
        warning: 'May delete all rows from a table',
        severity: 'danger',
    },
    {
        pattern: /\bTRUNCATE\s+TABLE\b/i,
        warning: 'May remove all data from a table',
        severity: 'danger',
    },

    // ─── Infrastructure (danger) ────────────────────────────────────────
    {
        pattern: /\bkubectl\b.*\bdelete\b/,
        warning: 'May delete Kubernetes resources',
        severity: 'danger',
    },
    {
        pattern: /\bterraform\b.*\bdestroy\b/,
        warning: 'May destroy Terraform infrastructure',
        severity: 'danger',
    },

    // ─── Permissions (warning) ──────────────────────────────────────────
    {
        pattern: /\bchmod\b.*\b777\b/,
        warning: 'Sets overly permissive file permissions',
        severity: 'warning',
    },
];

/**
 * Check a command for known destructive patterns and return informational warnings.
 * This is purely advisory — it does NOT block execution or interact with McpSecurityGuard.
 * Returns all matching warnings (a command can match multiple patterns).
 *
 * @param command - The shell command string to check
 * @returns Array of matching destructive warnings, empty if none match
 */
export function getDestructiveWarnings(command: string): DestructiveWarning[] {
    const warnings: DestructiveWarning[] = [];

    for (const entry of DESTRUCTIVE_PATTERNS) {
        if (entry.pattern.test(command)) {
            warnings.push({
                warning: entry.warning,
                severity: entry.severity,
            });
        }
    }

    if (warnings.length > 0) {
        logger.debug(
            `[DestructiveCommandWarnings] Found ${warnings.length} warning(s) for command: ${command}`
        );
    }

    return warnings;
}

/**
 * Check if a command has any destructive warnings.
 * Quick check without allocating the warnings array.
 *
 * @param command - The shell command string to check
 * @returns True if at least one destructive pattern matches
 */
export function hasDestructiveWarnings(command: string): boolean {
    for (const entry of DESTRUCTIVE_PATTERNS) {
        if (entry.pattern.test(command)) {
            return true;
        }
    }
    return false;
}
