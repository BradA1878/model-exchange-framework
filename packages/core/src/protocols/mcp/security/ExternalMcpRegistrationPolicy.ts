/**
 * Policy for caller-supplied stdio MCP server registrations.
 *
 * A stdio registration is equivalent to asking the host to execute a command.
 * It is therefore off by default and may only be exposed by a server entry
 * point after that entry point has independently established an administrator
 * principal. Built-in, server-owned configurations do not pass through this
 * policy because their commands come from source-controlled configuration.
 */

export const UNSAFE_STDIO_MCP_ENV = 'MXF_UNSAFE_STDIO_MCP_ENABLED';

/**
 * True only for the exact, explicit opt-in value.
 */
export const isUnsafeStdioMcpEnabled = (): boolean => {
    return process.env[UNSAFE_STDIO_MCP_ENV] === 'true';
};

/**
 * External server payloads historically omitted transport and were treated as
 * stdio, so an absent transport must remain on the dangerous side of the gate.
 */
export const isStdioMcpTransport = (transport: unknown): boolean => {
    return transport === undefined || transport === null || transport === '' || transport === 'stdio';
};

/**
 * Fail closed when a caller-controlled registration would execute a process.
 */
export const assertUnsafeStdioMcpEnabled = (transport: unknown): void => {
    if (isStdioMcpTransport(transport) && !isUnsafeStdioMcpEnabled()) {
        throw new Error(
            `Caller-supplied stdio MCP registration is disabled. ` +
            `An administrator must explicitly set ${UNSAFE_STDIO_MCP_ENV}=true to expose this unsafe capability.`
        );
    }
};
