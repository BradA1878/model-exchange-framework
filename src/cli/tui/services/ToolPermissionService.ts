/**
 * MXF CLI TUI — Tool Permission Service
 *
 * Evaluates whether a tool call from an agent should be auto-approved,
 * auto-denied, or shown to the user as a confirmation prompt.
 *
 * Two layers:
 *   1. Config-based rules (from ~/.mxf/config.json → permissions)
 *   2. Session-level overrides (set via /approve-all or /approve commands)
 *
 * Rules are evaluated in order: session overrides > config rules > default (ask).
 *
 * @author Brad Anderson <BradA1878@pm.me>
 */

import { ConfigService } from '../../services/ConfigService';

/** Permission decision for a tool call */
export type PermissionDecision = 'allow' | 'deny' | 'ask';

/** A single permission rule from config or session */
export interface PermissionRule {
    /** Tool name pattern — exact match or glob-like (e.g., "read_file", "shell_execute(git *)") */
    pattern: string;
    /** What to do when matched */
    decision: PermissionDecision;
    /** Optional agent ID restriction (null = applies to all agents) */
    agentId?: string;
}

/**
 * Parse a tool pattern into tool name and optional argument pattern.
 * Examples: "read_file" → { tool: "read_file", argPattern: null }
 *           "shell_execute(git *)" → { tool: "shell_execute", argPattern: "git *" }
 */
function parsePattern(pattern: string): { tool: string; argPattern: string | null } {
    const match = pattern.match(/^(\w+)\((.+)\)$/);
    if (match) {
        return { tool: match[1], argPattern: match[2] };
    }
    return { tool: pattern, argPattern: null };
}

/**
 * Check if a command string matches an argument pattern.
 * Supports simple glob: "git *" matches "git status", "git diff", etc.
 */
function matchesArgPattern(argPattern: string, command: string): boolean {
    if (!command) return false;

    // Convert simple glob to regex: "git *" → /^git .*/
    const regexStr = '^' + argPattern
        .replace(/[.+?^${}()|[\]\\]/g, '\\$&')  // Escape regex special chars
        .replace(/\*/g, '.*')                       // * → .*
    + '$';

    try {
        return new RegExp(regexStr).test(command);
    } catch {
        return false;
    }
}

/**
 * ToolPermissionService — evaluates tool call permissions against config and session rules.
 */
export class ToolPermissionService {
    /** Config-based rules loaded from ~/.mxf/config.json */
    private configRules: PermissionRule[] = [];

    /** Session-level rules added via /approve-all or /approve commands */
    private sessionRules: PermissionRule[] = [];

    /** Whether session-level approve-all is active */
    private approveAll: boolean = false;

    constructor() {
        this.loadConfigRules();
    }

    /**
     * Load permission rules from ~/.mxf/config.json.
     *
     * Expected config shape:
     * ```json
     * {
     *   "permissions": {
     *     "autoApprove": ["read_file", "list_directory", "shell_execute(git *)"],
     *     "requireConfirm": ["write_file", "shell_execute(rm *)"],
     *     "deny": []
     *   }
     * }
     * ```
     */
    private loadConfigRules(): void {
        try {
            const config = ConfigService.getInstance().load();
            const perms = (config as any)?.permissions;
            if (!perms) return;

            // Auto-approve rules
            if (Array.isArray(perms.autoApprove)) {
                for (const pattern of perms.autoApprove) {
                    this.configRules.push({ pattern, decision: 'allow' });
                }
            }

            // Require confirmation rules (explicit — overrides auto-approve for specificity)
            if (Array.isArray(perms.requireConfirm)) {
                for (const pattern of perms.requireConfirm) {
                    this.configRules.push({ pattern, decision: 'ask' });
                }
            }

            // Deny rules
            if (Array.isArray(perms.deny)) {
                for (const pattern of perms.deny) {
                    this.configRules.push({ pattern, decision: 'deny' });
                }
            }
        } catch {
            // Config not available — all decisions fall through to 'ask'
        }
    }

    /**
     * Evaluate whether a tool call should be allowed, denied, or shown to the user.
     *
     * @param agentId - The agent making the tool call
     * @param toolName - The tool being called (e.g., "read_file", "shell_execute")
     * @param args - Tool input arguments (for pattern matching)
     * @returns 'allow' (auto-approve), 'deny' (auto-reject), or 'ask' (show prompt)
     */
    evaluate(agentId: string, toolName: string, args?: Record<string, any>): PermissionDecision {
        // Session-level approve-all overrides everything
        if (this.approveAll) return 'allow';

        // Extract the primary command argument for pattern matching
        const command = args?.command || args?.path || args?.filePath || '';

        // Check session rules first (highest priority)
        for (const rule of this.sessionRules) {
            if (rule.agentId && rule.agentId !== agentId) continue;

            const { tool, argPattern } = parsePattern(rule.pattern);
            if (tool !== toolName) continue;

            if (argPattern) {
                if (matchesArgPattern(argPattern, command)) return rule.decision;
            } else {
                return rule.decision;
            }
        }

        // Check config rules (requireConfirm takes priority over autoApprove for same tool)
        // Process deny first, then requireConfirm, then autoApprove
        const deny = this.configRules.filter(r => r.decision === 'deny');
        const ask = this.configRules.filter(r => r.decision === 'ask');
        const allow = this.configRules.filter(r => r.decision === 'allow');

        for (const ruleSet of [deny, ask, allow]) {
            for (const rule of ruleSet) {
                if (rule.agentId && rule.agentId !== agentId) continue;

                const { tool, argPattern } = parsePattern(rule.pattern);
                if (tool !== toolName) continue;

                if (argPattern) {
                    if (matchesArgPattern(argPattern, command)) return rule.decision;
                } else {
                    return rule.decision;
                }
            }
        }

        // Default: ask the user
        return 'ask';
    }

    /** Enable session-level approve-all mode */
    setApproveAll(enabled: boolean): void {
        this.approveAll = enabled;
    }

    /** Whether approve-all mode is active */
    isApproveAll(): boolean {
        return this.approveAll;
    }

    /** Add a session-level permission rule */
    addSessionRule(rule: PermissionRule): void {
        this.sessionRules.push(rule);
    }

    /** Clear all session-level rules */
    clearSessionRules(): void {
        this.sessionRules = [];
        this.approveAll = false;
    }

    /** Get current rules summary for display */
    getRulesSummary(): string {
        const lines: string[] = [];

        if (this.approveAll) {
            lines.push('Session: APPROVE ALL (auto-approving everything)');
        }

        if (this.sessionRules.length > 0) {
            lines.push('Session rules:');
            for (const rule of this.sessionRules) {
                const scope = rule.agentId ? ` (agent: ${rule.agentId})` : '';
                lines.push(`  ${rule.decision.padEnd(5)} ${rule.pattern}${scope}`);
            }
        }

        if (this.configRules.length > 0) {
            lines.push('Config rules:');
            for (const rule of this.configRules) {
                const scope = rule.agentId ? ` (agent: ${rule.agentId})` : '';
                lines.push(`  ${rule.decision.padEnd(5)} ${rule.pattern}${scope}`);
            }
        }

        if (lines.length === 0) {
            lines.push('No permission rules configured. All tool calls will prompt for confirmation.');
            lines.push('Add rules to ~/.mxf/config.json under "permissions" key.');
        }

        return lines.join('\n');
    }
}
