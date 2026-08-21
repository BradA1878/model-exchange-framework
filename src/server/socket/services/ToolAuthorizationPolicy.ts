/**
 * Tool authorization policy shared by MCP discovery and execution.
 *
 * Agent allowlists are restrictive:
 * - undefined: the curated core-tool set
 * - []: no tools
 * - non-empty: only the named tools
 *
 * Channel allowlists are an optional additional restriction:
 * - undefined or []: no channel-level restriction
 * - non-empty: the tool must also be named by the channel
 */

import { getCoreToolsArray } from '@mxf-dev/core/constants/CoreTools';

export const UNSAFE_HOST_TOOLS_ENV = 'MXF_UNSAFE_HOST_TOOLS_ENABLED';
export const UNSAFE_NETWORK_TOOLS_ENV = 'MXF_UNSAFE_NETWORK_TOOLS_ENABLED';

const PRIVILEGED_HOST_TOOL_NAMES = new Set([
    'shell_execute',
    'shell_task_status',
    'code_execute',
    'filesystem_read',
    'filesystem_write',
    'filesystem_list',
    'read_file',
    'read_text_file',
    'read_media_file',
    'read_multiple_files',
    'write_file',
    'edit_file',
    'create_directory',
    'list_directory',
    'list_directory_with_sizes',
    'directory_tree',
    'move_file',
    'search_files',
    'get_file_info',
    'list_allowed_directories',
    'delete_file',
    'delete_directory',
    'copy_file',
    'analyze_codebase',
    'find_functions',
    'trace_dependencies',
    'suggest_refactoring',
    'validate_architecture',
    'json_append',
    'json_read',
    'project_context',
    'create_feature_branch',
    'run_full_test_suite',
    'performance_benchmark',
    'rollback_changes',
    'create_backup',
    'code_review_agent',
    'search_project'
]);

const PRIVILEGED_HOST_TOOL_PREFIXES = ['git_', 'test_', 'typescript_', 'filesystem__'];

const PRIVILEGED_NETWORK_TOOL_NAMES = new Set([
    'web_search',
    'web_navigate',
    'web_bulk_extract',
    'web_screenshot',
    'api_fetch'
]);

/**
 * A policy denial rather than a missing tool or invalid tool input.
 * HTTP callers use this type to return 403 without parsing error text.
 */
export class ToolAuthorizationError extends Error {
    public constructor(message: string) {
        super(message);
        this.name = 'ToolAuthorizationError';
    }
}

/**
 * Resolve a client-requested policy against the maximum grant carried by its
 * authenticated channel key. A legacy/omitted key grant is capped at curated
 * core tools instead of preserving client-self-authorization.
 */
export const resolveCredentialBoundAgentPolicy = (
    credentialAllowedTools: readonly string[] | undefined,
    requestedAllowedTools: readonly string[] | undefined
): string[] | undefined => {
    const maximum = credentialAllowedTools ?? getCoreToolsArray();

    if (requestedAllowedTools === undefined) {
        return credentialAllowedTools === undefined
            ? undefined
            : [...credentialAllowedTools];
    }

    if (requestedAllowedTools.some(toolName => (
        typeof toolName !== 'string' || toolName.trim().length === 0
    ))) {
        throw new ToolAuthorizationError(
            'Requested allowedTools must contain only non-empty strings'
        );
    }

    const normalized = [...new Set(requestedAllowedTools.map(toolName => toolName.trim()))];
    const maximumSet = new Set(maximum);
    const expansion = normalized.find(toolName => !maximumSet.has(toolName));
    if (expansion) {
        throw new ToolAuthorizationError(
            `Tool '${expansion}' is outside the authenticated credential grant`
        );
    }

    return normalized;
};

/** Host process/filesystem/code capabilities require explicit operator opt-in. */
export const isPrivilegedHostToolEnabled = (
    toolNames: ReadonlySet<string>
): boolean => {
    const isPrivileged = [...toolNames].some(name =>
        PRIVILEGED_HOST_TOOL_NAMES.has(name) ||
        PRIVILEGED_HOST_TOOL_PREFIXES.some(prefix => name.startsWith(prefix))
    );
    if (!isPrivileged) {
        return true;
    }

    const configured = process.env[UNSAFE_HOST_TOOLS_ENV];
    if (configured === undefined || configured === 'false') {
        return false;
    }
    if (configured === 'true') {
        return true;
    }
    throw new ToolAuthorizationError(
        `${UNSAFE_HOST_TOOLS_ENV} must be exactly 'true' or 'false' when configured`
    );
};

/** Server-originated browser and HTTP capabilities require explicit operator opt-in. */
export const isPrivilegedNetworkToolEnabled = (
    toolNames: ReadonlySet<string>
): boolean => {
    const isPrivileged = [...toolNames].some(name => PRIVILEGED_NETWORK_TOOL_NAMES.has(name));
    if (!isPrivileged) {
        return true;
    }

    const configured = process.env[UNSAFE_NETWORK_TOOLS_ENV];
    if (configured === undefined || configured === 'false') {
        return false;
    }
    if (configured === 'true') {
        return true;
    }
    throw new ToolAuthorizationError(
        `${UNSAFE_NETWORK_TOOLS_ENV} must be exactly 'true' or 'false' when configured`
    );
};

export interface ToolAuthorizationDescriptor {
    name: string;
    /** Namespaced registry name when the agent-facing `name` is raw. */
    canonicalName?: string;
    /** Raw origin-server name when `name` is a namespaced external tool. */
    externalToolName?: string;
    metadata?: {
        canonicalName?: string;
        [key: string]: unknown;
    };
}

/**
 * Return every name by which an allowlist may identify a tool.
 */
export const getToolAuthorizationNames = (
    tool: ToolAuthorizationDescriptor
): ReadonlySet<string> => {
    const names = new Set<string>([tool.name]);
    const canonicalName = tool.canonicalName ?? tool.metadata?.canonicalName;

    if (typeof tool.externalToolName === 'string' && tool.externalToolName.length > 0) {
        names.add(tool.externalToolName);
    }

    if (typeof canonicalName === 'string' && canonicalName.length > 0) {
        names.add(canonicalName);
    }

    return names;
};

/**
 * Apply the agent-level allowlist contract used during tool discovery.
 */
export const isAllowedByAgentPolicy = (
    toolNames: ReadonlySet<string>,
    allowedTools: readonly string[] | undefined
): boolean => {
    const effectiveAllowlist = allowedTools ?? getCoreToolsArray();
    return effectiveAllowlist.some(name => toolNames.has(name));
};

/**
 * Apply the channel-level allowlist contract used during tool discovery.
 */
export const isAllowedByChannelPolicy = (
    toolNames: ReadonlySet<string>,
    allowedTools: readonly string[] | undefined
): boolean => {
    if (!allowedTools || allowedTools.length === 0) {
        return true;
    }

    return allowedTools.some(name => toolNames.has(name));
};
