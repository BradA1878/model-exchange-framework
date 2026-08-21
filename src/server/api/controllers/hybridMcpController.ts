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
 * Hybrid MCP Controller
 * 
 * This controller manages the API endpoints for the Hybrid MCP service.
 * It provides routes for managing external MCP servers and unified tool discovery.
 */

import { Request, Response } from 'express';
import { createStrictValidator } from '@mxf-dev/core/utils/validation';
import { assertUnsafeStdioMcpEnabled } from '@mxf-dev/core/protocols/mcp/security/ExternalMcpRegistrationPolicy';
import { Logger } from '@mxf-dev/core/utils/Logger';
import { UserRole } from '@mxf-dev/core/models/user';
import { firstValueFrom } from 'rxjs';
import { ServerHybridMcpService } from '../services/ServerHybridMcpService';
import { McpToolRegistry } from '../services/McpToolRegistry';
import { authorizationService } from '../services/AuthorizationService';

// Create validator for Hybrid MCP controller
const validate = createStrictValidator('HybridMcpController');

// Initialize logger
const logger = new Logger('info', 'HybridMcpController', 'server');

type HybridReadScope =
    | { kind: 'global' }
    | { kind: 'channel'; channelId: string; agentId?: string };

/**
 * Defense-in-depth scope resolution for hybrid topology reads.
 * Routes apply the same policy first; direct controller invocation must not
 * become a way around it.
 */
const authorizeHybridRead = async (
    req: Request,
    res: Response
): Promise<HybridReadScope | null> => {
    const principal = authorizationService.readPrincipal(req);
    const channelId = typeof req.params.channelId === 'string'
        ? req.params.channelId.trim()
        : '';

    if (channelId) {
        const preauthorizedChannel = (req as Request & {
            channel?: { channelId?: unknown };
        }).channel;
        if (String(preauthorizedChannel?.channelId ?? '') !== channelId) {
            const decision = await authorizationService.authorize(
                'access',
                'channel',
                channelId,
                principal
            );
            if (!decision.allowed) {
                res.status(decision.status).json({
                    success: false,
                    message: decision.reason
                });
                return null;
            }
        }

        return {
            kind: 'channel',
            channelId,
            agentId: principal.kind === 'agent' ? principal.agentId : undefined
        };
    }

    if (principal.kind === 'unauthenticated') {
        res.status(401).json({ success: false, message: 'Authentication required' });
        return null;
    }
    if (principal.kind !== 'user' || principal.role !== UserRole.ADMIN) {
        res.status(403).json({ success: false, message: 'Admin access required' });
        return null;
    }

    return { kind: 'global' };
};

/**
 * Get Hybrid MCP service status
 * @param req - Express request object
 * @param res - Express response object
 */
export const getHybridStatus = async (req: Request, res: Response): Promise<void> => {
    try {
        if (!await authorizeHybridRead(req, res)) {
            return;
        }
        const serverHybridMcpService = ServerHybridMcpService.getInstance();
        const status = serverHybridMcpService.getStatus();
        
        res.status(200).json({
            success: true,
            data: status
        });
    } catch (error) {
        logger.error(`Error getting hybrid status: ${error}`);
        res.status(500).json({
            success: false,
            message: 'Error getting hybrid status',
            error: error instanceof Error ? error.message : String(error)
        });
    }
};

/**
 * Get Hybrid MCP service statistics
 * @param req - Express request object
 * @param res - Express response object
 */
export const getHybridStats = async (req: Request, res: Response): Promise<void> => {
    try {
        if (!await authorizeHybridRead(req, res)) {
            return;
        }
        const serverHybridMcpService = ServerHybridMcpService.getInstance();
        const stats = serverHybridMcpService.getServiceStats();
        
        res.status(200).json({
            success: true,
            data: stats
        });
    } catch (error) {
        logger.error(`Error getting hybrid stats: ${error}`);
        res.status(500).json({
            success: false,
            message: 'Error getting hybrid stats',
            error: error instanceof Error ? error.message : String(error)
        });
    }
};

/**
 * Get all available tools (internal + external)
 * @param req - Express request object
 * @param res - Express response object
 */
export const getAllTools = async (req: Request, res: Response): Promise<void> => {
    try {
        const scope = await authorizeHybridRead(req, res);
        if (!scope) {
            return;
        }

        // Constructing the hybrid service binds the external provider into the
        // registry. The registry is then the single composition policy for both
        // REST and socket discovery.
        ServerHybridMcpService.getInstance();
        const registry = McpToolRegistry.getInstance();
        const visibleTools = await firstValueFrom(
            scope.kind === 'channel'
                ? registry.listToolsForChannel(scope.channelId, undefined, scope.agentId)
                : registry.listTools()
        );
        const internalTools = visibleTools
            .filter(tool => !tool.providerId?.startsWith('external-mcp:'))
            .map(tool => ({
                name: tool.name,
                description: tool.description,
                inputSchema: tool.inputSchema,
                source: 'internal' as const,
                enabled: tool.enabled
            }));
        const externalTools = visibleTools
            .filter(tool => tool.providerId?.startsWith('external-mcp:'))
            .map(tool => ({
                name: tool.name,
                canonicalName: tool.metadata?.canonicalName ?? tool.name,
                description: tool.description,
                inputSchema: tool.inputSchema,
                source: 'external' as const,
                serverId: tool.metadata?.externalSource,
                scope: tool.metadata?.externalScope
            }));
        
        const allTools = [...internalTools, ...externalTools];
        
        res.status(200).json({
            success: true,
            count: allTools.length,
            data: {
                internal: internalTools,
                external: externalTools,
                all: allTools
            }
        });
    } catch (error) {
        logger.error(`Error getting all tools: ${error}`);
        res.status(500).json({
            success: false,
            message: 'Error getting tools',
            error: error instanceof Error ? error.message : String(error)
        });
    }
};

/**
 * Get external server statuses
 * @param req - Express request object
 * @param res - Express response object
 */
export const getExternalServers = async (req: Request, res: Response): Promise<void> => {
    try {
        const scope = await authorizeHybridRead(req, res);
        if (!scope) {
            return;
        }

        const serverHybridMcpService = ServerHybridMcpService.getInstance();
        const externalServerManager = serverHybridMcpService.getExternalServerManager();
        const serverStatuses = scope.kind === 'global'
            ? serverHybridMcpService.getExternalServerStatuses()
            : Object.fromEntries([
                ...externalServerManager.getServersByScope('global'),
                ...externalServerManager.getServersByScope('channel', scope.channelId),
                ...(scope.agentId
                    ? externalServerManager.getServersByScope('agent', scope.agentId)
                    : [])
            ].map(status => [status.id, status]));
        
        res.status(200).json({
            success: true,
            count: Object.keys(serverStatuses).length,
            data: serverStatuses
        });
    } catch (error) {
        logger.error(`Error getting external servers: ${error}`);
        res.status(500).json({
            success: false,
            message: 'Error getting external servers',
            error: error instanceof Error ? error.message : String(error)
        });
    }
};

/**
 * Start an external server
 * @param req - Express request object
 * @param res - Express response object
 */
export const startExternalServer = async (req: Request, res: Response): Promise<void> => {
    try {
        const { serverId } = req.params;

        validate.assertIsNonEmptyString(serverId, 'Server ID is required');

        const serverHybridMcpService = ServerHybridMcpService.getInstance();
        const success = await serverHybridMcpService.startExternalServer(serverId);
        
        if (success) {
            res.status(200).json({
                success: true,
                message: `Server ${serverId} started successfully`
            });
        } else {
            res.status(400).json({
                success: false,
                message: `Failed to start server ${serverId}`
            });
        }
    } catch (error) {
        logger.error(`Error starting external server: ${error}`);
        res.status(500).json({
            success: false,
            message: 'Error starting external server',
            error: error instanceof Error ? error.message : String(error)
        });
    }
};

/**
 * Stop an external server
 * @param req - Express request object
 * @param res - Express response object
 */
export const stopExternalServer = async (req: Request, res: Response): Promise<void> => {
    try {
        const { serverId } = req.params;

        validate.assertIsNonEmptyString(serverId, 'Server ID is required');

        const serverHybridMcpService = ServerHybridMcpService.getInstance();
        const success = await serverHybridMcpService.stopExternalServer(serverId);
        
        if (success) {
            res.status(200).json({
                success: true,
                message: `Server ${serverId} stopped successfully`
            });
        } else {
            res.status(400).json({
                success: false,
                message: `Failed to stop server ${serverId}`
            });
        }
    } catch (error) {
        logger.error(`Error stopping external server: ${error}`);
        res.status(500).json({
            success: false,
            message: 'Error stopping external server',
            error: error instanceof Error ? error.message : String(error)
        });
    }
};

/**
 * Register an external MCP server (HTTP API endpoint for dashboard)
 * @param req - Express request object
 * @param res - Express response object
 */
export const registerExternalServer = async (req: Request, res: Response): Promise<void> => {
    try {

        // Validate required fields
        validate.assertIsNonEmptyString(req.body.id, 'Server ID is required');
        validate.assertIsNonEmptyString(req.body.name, 'Server name is required');

        // Transport-specific validation
        const transport = req.body.transport || 'stdio';

        // The route applies the same gate after proving administrator status.
        // Keep this assertion at the execution boundary so direct controller
        // invocation cannot accidentally re-open host process execution.
        assertUnsafeStdioMcpEnabled(transport);

        if (transport === 'stdio') {
            validate.assertIsNonEmptyString(req.body.command, 'Command is required for stdio transport');
            validate.assertIsArray(req.body.args, 'Args must be an array for stdio transport');
        } else if (transport === 'http') {
            res.status(501).json({
                success: false,
                error: 'HTTP transport registration is not implemented by this MXF server'
            });
            return;
        } else {
            res.status(400).json({
                success: false,
                error: `Invalid transport type: ${transport}. Must be 'stdio' or 'http'`
            });
            return;
        }

        // Build server configuration
        const serverConfig = {
            id: req.body.id,
            name: req.body.name,
            version: req.body.version || '1.0.0',
            command: req.body.command,
            args: req.body.args || [],
            transport: transport as 'stdio' | 'http',
            url: req.body.url,
            autoStart: req.body.autoStart !== false, // Default true
            restartOnCrash: req.body.restartOnCrash !== false,
            maxRestartAttempts: req.body.maxRestartAttempts || 3,
            healthCheckInterval: req.body.healthCheckInterval || 30000,
            startupTimeout: req.body.startupTimeout || 10000,
            environmentVariables: req.body.environmentVariables || {}
        };

        // Get hybrid service and register server
        const serverHybridMcpService = ServerHybridMcpService.getInstance();
        const externalServerManager = serverHybridMcpService.getExternalServerManager();

        // Register the server directly
        await externalServerManager.registerServer(serverConfig);


        res.status(201).json({
            success: true,
            server: {
                id: serverConfig.id,
                name: serverConfig.name,
                transport: serverConfig.transport,
                autoStart: serverConfig.autoStart
            },
            message: `External MCP server "${serverConfig.name}" registered successfully`
        });

    } catch (error) {
        logger.error('Error registering external MCP server:', error);
        res.status(400).json({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error during server registration'
        });
    }
};

/**
 * Unregister an external MCP server
 * @param req - Express request object
 * @param res - Express response object
 */
export const unregisterExternalServer = async (req: Request, res: Response): Promise<void> => {
    try {
        const { serverId } = req.params;
        validate.assertIsNonEmptyString(serverId, 'Server ID is required');

        const serverHybridMcpService = ServerHybridMcpService.getInstance();
        const externalServerManager = serverHybridMcpService.getExternalServerManager();
        if (!externalServerManager.getServerStatusById(serverId)) {
            res.status(404).json({
                success: false,
                error: `Server ${serverId} not found`
            });
            return;
        }

        // This is the authoritative removal path: it stops the child and deletes
        // the server record, scope entry, timers, and therefore its provider tools.
        await externalServerManager.unregisterServer(serverId);

        res.json({
            success: true,
            message: `External MCP server "${serverId}" unregistered successfully`
        });

    } catch (error) {
        logger.error('Error unregistering external MCP server:', error);
        res.status(400).json({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error during server unregistration'
        });
    }
};

/**
 * Get status of a specific external MCP server
 * @param req - Express request object
 * @param res - Express response object
 */
export const getServerStatus = async (req: Request, res: Response): Promise<void> => {
    try {
        const scope = await authorizeHybridRead(req, res);
        if (!scope) {
            return;
        }

        const { serverId } = req.params;
        validate.assertIsNonEmptyString(serverId, 'Server ID is required');

        const serverHybridMcpService = ServerHybridMcpService.getInstance();
        const externalServerManager = serverHybridMcpService.getExternalServerManager();

        const isVisible = scope.kind === 'global' || [
            ...externalServerManager.getServersByScope('global'),
            ...externalServerManager.getServersByScope('channel', scope.channelId),
            ...(scope.agentId
                ? externalServerManager.getServersByScope('agent', scope.agentId)
                : [])
        ].some(candidate => candidate.id === serverId);
        const status = isVisible
            ? externalServerManager.getServerStatusById(serverId)
            : undefined;

        if (!status) {
            res.status(404).json({
                success: false,
                error: `Server ${serverId} not found`
            });
            return;
        }

        res.json({
            success: true,
            status: status
        });

    } catch (error) {
        logger.error('Error getting server status:', error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error getting server status'
        });
    }
};
