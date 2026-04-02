/**
 * MXF CLI TUI — Tool Lifecycle Hook Service
 *
 * Loads and executes pre/post tool execution hooks from ~/.mxf/hooks/.
 * Hook files are shell scripts or JS files named by convention:
 *   - pre-<toolname>.sh / pre-<toolname>.js — runs before tool execution
 *   - post-<toolname>.sh / post-<toolname>.js — runs after tool execution
 *   - pre-all.sh / pre-all.js — runs for every tool call (before)
 *   - post-all.sh / post-all.js — runs for every tool call (after)
 *
 * Pre-hooks can block execution by exiting non-zero (shell) or throwing (JS).
 * Post-hooks are fire-and-forget — errors are logged but don't affect flow.
 *
 * Shell hooks receive context via environment variables:
 *   MXF_TOOL_NAME — the tool being called
 *   MXF_TOOL_ARGS — JSON-serialized tool arguments
 *   MXF_TOOL_RESULT — (post-hooks only) result summary string
 *
 * JS hooks export a default async function receiving { toolName, args, result? }.
 *
 * @author Brad Anderson <BradA1878@pm.me>
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFile } from 'child_process';
import { loggerWithTags } from '../../../shared/utils/Logger';

/** Logger for hook execution events */
const log = loggerWithTags('ToolHookService');

/** Timeout for shell hook execution (10 seconds) */
const SHELL_HOOK_TIMEOUT_MS = 10_000;

/** The directory where user hooks are stored */
const HOOKS_DIR = path.join(os.homedir(), '.mxf', 'hooks');

/** Represents a discovered hook file */
interface HookEntry {
    /** Full absolute path to the hook file */
    filePath: string;
    /** 'pre' or 'post' */
    phase: 'pre' | 'post';
    /** Tool name the hook targets, or 'all' for wildcard hooks */
    toolTarget: string;
    /** 'sh' or 'js' — determines execution strategy */
    type: 'sh' | 'js';
}

/** Result from running a pre-hook — indicates whether execution should proceed */
export interface PreHookResult {
    blocked: boolean;
    reason?: string;
}

/**
 * ToolHookService — singleton that discovers and executes tool lifecycle hooks.
 *
 * Hooks are loaded once at construction from ~/.mxf/hooks/ and cached.
 * The service provides runPreHooks() and runPostHooks() for integration
 * into the TUI event flow.
 */
export class ToolHookService {
    private static instance: ToolHookService | null = null;

    /** Cached list of discovered hook files */
    private hooks: HookEntry[] = [];

    private constructor() {
        this.discoverHooks();
    }

    /** Get or create the singleton instance */
    static getInstance(): ToolHookService {
        if (!ToolHookService.instance) {
            ToolHookService.instance = new ToolHookService();
        }
        return ToolHookService.instance;
    }

    /**
     * Scan ~/.mxf/hooks/ for hook files matching the naming convention.
     * Populates the internal hooks array. Only runs once at construction.
     */
    private discoverHooks(): void {
        if (!fs.existsSync(HOOKS_DIR)) {
            log.debug(`Hooks directory does not exist: ${HOOKS_DIR}`);
            return;
        }

        let entries: string[];
        try {
            entries = fs.readdirSync(HOOKS_DIR);
        } catch (err) {
            log.warn(`Failed to read hooks directory ${HOOKS_DIR}: ${err}`);
            return;
        }

        for (const entry of entries) {
            const parsed = this.parseHookFilename(entry);
            if (parsed) {
                this.hooks.push({
                    ...parsed,
                    filePath: path.join(HOOKS_DIR, entry),
                });
            }
        }

        if (this.hooks.length > 0) {
            log.info(`Loaded ${this.hooks.length} tool hook(s) from ${HOOKS_DIR}`);
        }
    }

    /**
     * Parse a hook filename into its components.
     * Valid patterns: pre-<tool>.sh, pre-<tool>.js, post-<tool>.sh, post-<tool>.js
     *
     * @param filename - The filename to parse (e.g., "pre-read_file.sh")
     * @returns Parsed components or null if the filename doesn't match
     */
    private parseHookFilename(filename: string): Omit<HookEntry, 'filePath'> | null {
        const match = filename.match(/^(pre|post)-(.+)\.(sh|js)$/);
        if (!match) return null;

        const phase = match[1] as 'pre' | 'post';
        const toolTarget = match[2];
        const type = match[3] as 'sh' | 'js';

        return { phase, toolTarget, type };
    }

    /**
     * Get hooks that apply to a specific tool call.
     * Returns both tool-specific hooks and wildcard ('all') hooks.
     *
     * @param phase - 'pre' or 'post'
     * @param toolName - The tool being called
     * @returns Matching hook entries (wildcard hooks first, then tool-specific)
     */
    private getMatchingHooks(phase: 'pre' | 'post', toolName: string): HookEntry[] {
        return this.hooks.filter(
            h => h.phase === phase && (h.toolTarget === 'all' || h.toolTarget === toolName),
        );
    }

    /**
     * Execute a shell script hook via child_process.execFile.
     * The hook receives context through environment variables.
     *
     * @param hook - The hook entry to execute
     * @param env - Environment variables to pass to the process
     * @returns Promise resolving to { exitCode, stderr } on completion
     */
    private executeShellHook(hook: HookEntry, env: Record<string, string>): Promise<{ exitCode: number; stderr: string }> {
        return new Promise((resolve) => {
            const child = execFile(hook.filePath, [], {
                timeout: SHELL_HOOK_TIMEOUT_MS,
                env: { ...process.env, ...env },
            }, (error, _stdout, stderr) => {
                if (error) {
                    // Non-zero exit or timeout — extract exit code
                    const exitCode = (error as any).code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'
                        ? 1
                        : (error as any).killed ? 124 // timeout convention
                            : (error as any).status ?? 1;
                    resolve({ exitCode, stderr: stderr?.trim() || error.message });
                    return;
                }
                resolve({ exitCode: 0, stderr: '' });
            });

            // Safety: if the child process somehow hangs beyond execFile timeout,
            // the execFile timeout option handles killing it
            child.unref?.();
        });
    }

    /**
     * Execute a JavaScript hook by requiring the file and calling its default export.
     * JS hooks export an async function: (context) => void | { blocked: true, reason: string }
     *
     * @param hook - The hook entry to execute
     * @param context - The context object passed to the hook function
     * @returns Promise resolving to the hook's return value (or undefined)
     */
    private async executeJsHook(hook: HookEntry, context: Record<string, any>): Promise<any> {
        // Use require() for JS hooks — synchronous module loading
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const mod = require(hook.filePath);
        const fn = mod.default || mod;
        if (typeof fn !== 'function') {
            log.warn(`JS hook ${hook.filePath} does not export a function — skipping`);
            return undefined;
        }
        return fn(context);
    }

    /**
     * Run all pre-hooks for a tool call. Hooks run sequentially — if any hook
     * blocks (non-zero exit for shell, throw or { blocked: true } for JS),
     * execution stops and returns blocked=true.
     *
     * @param toolName - The tool being called
     * @param args - Tool input arguments
     * @returns { blocked: false } if all hooks pass, or { blocked: true, reason } if blocked
     */
    async runPreHooks(toolName: string, args: Record<string, any>): Promise<PreHookResult> {
        const matching = this.getMatchingHooks('pre', toolName);
        if (matching.length === 0) return { blocked: false };

        const argsJson = JSON.stringify(args);

        for (const hook of matching) {
            try {
                if (hook.type === 'sh') {
                    const { exitCode, stderr } = await this.executeShellHook(hook, {
                        MXF_TOOL_NAME: toolName,
                        MXF_TOOL_ARGS: argsJson,
                    });
                    if (exitCode !== 0) {
                        const reason = stderr || `Pre-hook ${path.basename(hook.filePath)} exited with code ${exitCode}`;
                        log.info(`Pre-hook blocked tool ${toolName}: ${reason}`);
                        return { blocked: true, reason };
                    }
                } else {
                    const result = await this.executeJsHook(hook, { toolName, args });
                    if (result && result.blocked) {
                        const reason = result.reason || `Pre-hook ${path.basename(hook.filePath)} blocked execution`;
                        log.info(`Pre-hook blocked tool ${toolName}: ${reason}`);
                        return { blocked: true, reason };
                    }
                }
            } catch (err) {
                // JS hooks that throw are treated as blocking
                const reason = `Pre-hook ${path.basename(hook.filePath)} threw: ${err}`;
                log.warn(reason);
                return { blocked: true, reason };
            }
        }

        return { blocked: false };
    }

    /**
     * Run all post-hooks for a tool call. Post-hooks are fire-and-forget —
     * errors are logged but never propagated to the caller.
     *
     * @param toolName - The tool that was called
     * @param args - Tool input arguments
     * @param resultSummary - A summary string of the tool's output
     */
    async runPostHooks(toolName: string, args: Record<string, any>, resultSummary: string): Promise<void> {
        const matching = this.getMatchingHooks('post', toolName);
        if (matching.length === 0) return;

        const argsJson = JSON.stringify(args);

        for (const hook of matching) {
            try {
                if (hook.type === 'sh') {
                    await this.executeShellHook(hook, {
                        MXF_TOOL_NAME: toolName,
                        MXF_TOOL_ARGS: argsJson,
                        MXF_TOOL_RESULT: resultSummary,
                    });
                } else {
                    await this.executeJsHook(hook, { toolName, args, result: resultSummary });
                }
            } catch (err) {
                // Post-hooks are fire-and-forget — log and continue
                log.warn(`Post-hook ${path.basename(hook.filePath)} failed: ${err}`);
            }
        }
    }

    /**
     * Get a summary of all loaded hooks for display (e.g., /hooks command).
     *
     * @returns Object with pre and post arrays of hook file paths
     */
    getLoadedHooks(): { pre: string[]; post: string[] } {
        const pre = this.hooks.filter(h => h.phase === 'pre').map(h => h.filePath);
        const post = this.hooks.filter(h => h.phase === 'post').map(h => h.filePath);
        return { pre, post };
    }
}
