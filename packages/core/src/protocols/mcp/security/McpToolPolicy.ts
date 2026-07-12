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
 * @documentation https://mxf-dev.github.io/mxf/
 */

/**
 * McpToolPolicy.ts
 *
 * Operator-controlled policy for the tools that reach outside the process:
 * shell execution, the child environment those shells inherit, the workspace
 * agents may touch, and the hosts `api_fetch` may reach.
 *
 * Every value here comes from configuration (environment variables), never from
 * tool arguments. That distinction is the whole point of the module: an
 * allowlist supplied as a tool input is supplied by the very model it is meant
 * to restrict, so it restricts nothing.
 *
 * Environment variables:
 *   MXF_SHELL_ALLOWED_COMMANDS   Comma-separated base commands agents may run.
 *                                Empty/unset means "no command allowlist" — the
 *                                McpSecurityGuard's own rules still apply.
 *   MXF_SHELL_ENV_PASSTHROUGH    Comma-separated extra environment variable names
 *                                to forward to shell children, on top of the
 *                                always-safe base (PATH, HOME, and friends).
 *   MXF_SHELL_SANDBOX_ENABLED    'true' to run shell_execute inside the Docker
 *                                sandbox (see ShellSandbox.ts). Default false.
 *   MXF_WORKSPACE_ROOT           Directory agents are allowed to work in. Required
 *                                by anything that grants filesystem reach; there is
 *                                no default, because the old default was $HOME.
 *   MXF_HTTP_ALLOW_PRIVATE_HOSTS 'true' to let api_fetch reach loopback/private
 *                                addresses. Default false. Only for local dev.
 */

import * as path from 'path';

/**
 * Environment variables always forwarded to a shell child.
 *
 * These are what a process needs to run at all — a PATH to find binaries, a HOME
 * for tool caches, a TMPDIR to write scratch files, and locale/terminal settings
 * so output is not garbled. Nothing here carries a credential.
 *
 * Everything else in the server's environment — JWT_SECRET, MONGODB_URI,
 * OPENROUTER_API_KEY, MEILISEARCH_MASTER_KEY, MXP_ENCRYPTION_KEY — stays behind.
 */
const BASE_SHELL_ENV_VARS = [
    'PATH',
    'HOME',
    'USER',
    'LOGNAME',
    'SHELL',
    'LANG',
    'LC_ALL',
    'TERM',
    'TMPDIR',
    'TZ',
    'NODE_ENV',
    // Windows equivalents — a child on win32 cannot resolve paths without these.
    'SYSTEMROOT',
    'COMSPEC',
    'PATHEXT',
    'USERPROFILE',
    'TEMP',
    'TMP'
];

/** Parse a comma-separated env var into a trimmed, non-empty list. */
function parseList(value: string | undefined): string[] {
    if (!value) {
        return [];
    }
    return value
        .split(',')
        .map(entry => entry.trim())
        .filter(entry => entry.length > 0);
}

/** Parse a boolean env var. Anything other than 'true' is false. */
function parseBoolean(value: string | undefined, fallback: boolean): boolean {
    if (value === undefined || value === '') {
        return fallback;
    }
    return value.toLowerCase() === 'true';
}

/**
 * Base commands agents are permitted to run via shell_execute.
 *
 * Read from MXF_SHELL_ALLOWED_COMMANDS. An empty list means no allowlist is
 * configured: the McpSecurityGuard's block rules and confirmation prompts remain
 * the control, exactly as before. This is a config-supplied allowlist, so a model
 * cannot widen it by passing arguments.
 */
export function getShellAllowedCommands(): string[] {
    return parseList(process.env.MXF_SHELL_ALLOWED_COMMANDS);
}

/**
 * Is a command allowlist configured at all?
 */
export function hasShellAllowlist(): boolean {
    return getShellAllowedCommands().length > 0;
}

/**
 * Build the environment a shell child process receives.
 *
 * Least privilege: start from the small base set above, add any names the
 * operator explicitly opted into via MXF_SHELL_ENV_PASSTHROUGH, then add the
 * caller's own explicit variables. The server's secrets are never copied in.
 *
 * This mirrors what ExternalMcpServerManager already does when it spawns an
 * external MCP server.
 *
 * @param explicitEnv - Variables the caller wants the child to see
 * @returns The complete environment for the child process
 */
export function buildShellChildEnv(
    explicitEnv?: Record<string, string>
): Record<string, string> {
    const childEnv: Record<string, string> = {};

    const passthroughNames = [
        ...BASE_SHELL_ENV_VARS,
        ...parseList(process.env.MXF_SHELL_ENV_PASSTHROUGH)
    ];

    for (const name of passthroughNames) {
        const value = process.env[name];
        if (value !== undefined && value !== '') {
            childEnv[name] = value;
        }
    }

    // Caller-supplied variables are layered last so a tool can set, for example,
    // CI=true or NODE_OPTIONS for the command it is about to run.
    if (explicitEnv) {
        for (const [name, value] of Object.entries(explicitEnv)) {
            if (value !== undefined && value !== null) {
                childEnv[name] = String(value);
            }
        }
    }

    return childEnv;
}

/**
 * Should shell_execute run commands inside the Docker sandbox?
 *
 * Off by default: the sandbox requires Docker and the mxf/shell-executor image,
 * and turning it on changes where commands run. When it is on and Docker is
 * missing, execution fails — it never silently falls back to the host.
 */
export function isShellSandboxEnabled(): boolean {
    return parseBoolean(process.env.MXF_SHELL_SANDBOX_ENABLED, false);
}

/**
 * The directory tree agents are allowed to work in.
 *
 * Returns undefined when MXF_WORKSPACE_ROOT is not set. Callers that hand out
 * filesystem reach must treat that as fatal — see {@link requireWorkspaceRoot}.
 * There is deliberately no default: the previous default was the user's home
 * directory, which put ~/.ssh, ~/.aws and ~/.mxf/config.json inside the agents'
 * reach.
 */
export function getWorkspaceRoot(): string | undefined {
    const configured = process.env.MXF_WORKSPACE_ROOT;
    if (!configured || configured.trim().length === 0) {
        return undefined;
    }
    return path.resolve(configured.trim());
}

/**
 * The workspace root, or a thrown error explaining how to set it.
 *
 * @throws Error when MXF_WORKSPACE_ROOT is not configured
 */
export function requireWorkspaceRoot(consumer: string): string {
    const root = getWorkspaceRoot();
    if (!root) {
        throw new Error(
            `${consumer} needs a workspace directory but MXF_WORKSPACE_ROOT is not set. ` +
            `Set it to the directory agents are allowed to work in ` +
            `(for example: MXF_WORKSPACE_ROOT=/Users/you/projects/my-app). ` +
            `It has no default — the previous default was your home directory, which ` +
            `exposed ~/.ssh, ~/.aws and ~/.mxf/config.json to agents.`
        );
    }
    return root;
}

/**
 * May api_fetch reach loopback and private-network addresses?
 *
 * Default false. When false, api_fetch refuses localhost, RFC1918 ranges, and
 * the cloud metadata endpoint — otherwise an agent could use the server as a
 * proxy into the MXF API itself, Meilisearch, or a cloud instance's credentials.
 *
 * Turn on only for local development against services on your own machine.
 */
export function allowPrivateHttpHosts(): boolean {
    return parseBoolean(process.env.MXF_HTTP_ALLOW_PRIVATE_HOSTS, false);
}
