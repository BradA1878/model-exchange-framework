/**
 * Runtime feature gates for server capabilities that can launch processes or
 * spend external-service budget.
 */

import { NextFunction, Request, Response } from 'express';
import {
    assertUnsafeStdioMcpEnabled,
    isStdioMcpTransport
} from '@mxf-dev/core/protocols/mcp/security/ExternalMcpRegistrationPolicy';
import { Events } from '@mxf-dev/core/events/EventNames';

export const DEMO_API_ENV = 'MXF_DEMO_API_ENABLED';

const ALL_MCP_EVENTS = new Set<string>(Object.values(Events.Mcp));

/**
 * MCP events are directional. Agent sockets may submit requests, but response,
 * lifecycle, observability, and host-process management events originate on
 * the server. Keeping this list explicit makes newly-added MCP events fail
 * closed until their client-to-server semantics are reviewed.
 */
const AGENT_SOCKET_MCP_REQUEST_EVENTS = new Set<string>([
    Events.Mcp.TOOL_CALL,
    Events.Mcp.TOOL_REGISTER,
    Events.Mcp.TOOL_UNREGISTER,
    Events.Mcp.TOOL_LIST,
    Events.Mcp.MXF_TOOL_LIST,
    Events.Mcp.RESOURCE_GET,
    Events.Mcp.RESOURCE_LIST
]);

/**
 * Agent/channel-key sockets never receive the host-process capability. Admin
 * user sockets use a separate path that checks role and the unsafe feature flag.
 */
export const isKnownMcpEvent = (eventName: string): boolean => ALL_MCP_EVENTS.has(eventName);

export const isAgentSocketMcpEventAllowed = (eventName: string): boolean => {
    return AGENT_SOCKET_MCP_REQUEST_EVENTS.has(eventName);
};

/**
 * Demo process routes are opt-in and are never exposed in production.
 */
export const isDemoApiEnabled = (): boolean => {
    return process.env[DEMO_API_ENV] === 'true' &&
        process.env.NODE_ENV?.trim().toLowerCase() !== 'production';
};

/**
 * Defense in depth for controller calls outside the normal router mount.
 */
export const requireDemoApiEnabled = (req: Request, res: Response, next: NextFunction): void => {
    if (!isDemoApiEnabled()) {
        res.status(404).json({
            success: false,
            error: 'Demo API is not enabled'
        });
        return;
    }

    next();
};

/**
 * Require the explicit operator opt-in whenever an HTTP request supplies a
 * stdio configuration. HTTP transport payloads are rejected because the
 * current external manager implements only child-process stdio.
 *
 * This middleware must be installed after authentication and requireAdmin.
 */
export const requireUnsafeStdioMcpEnabled = (req: Request, res: Response, next: NextFunction): void => {
    const transport = req.body?.transport;

    if (transport === 'http') {
        // ExternalMcpServerManager currently implements stdio only. Treating an
        // HTTP-labelled payload as supported would still hand its `command` to
        // spawn(), creating a feature-gate bypass.
        res.status(501).json({
            success: false,
            error: 'HTTP transport registration is not implemented by this MXF server'
        });
        return;
    }

    if (!isStdioMcpTransport(transport)) {
        res.status(400).json({
            success: false,
            error: `Invalid MCP transport: ${String(transport)}`
        });
        return;
    }

    try {
        assertUnsafeStdioMcpEnabled(transport);
        next();
    } catch (error) {
        res.status(403).json({
            success: false,
            error: error instanceof Error ? error.message : 'Caller-supplied stdio MCP registration is disabled'
        });
    }
};
