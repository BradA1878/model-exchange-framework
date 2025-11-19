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
 * Hybrid MCP Controller
 * 
 * This controller manages the API endpoints for the Hybrid MCP service.
 * It provides routes for managing external MCP servers and unified tool discovery.
 */

import { Request, Response } from 'express';
import { createStrictValidator } from '../../../shared/utils/validation';
import { Logger } from '../../../shared/utils/Logger';
import { ServerHybridMcpService } from '../services/ServerHybridMcpService';

// Create validator for Hybrid MCP controller
const validate = createStrictValidator('HybridMcpController');

// Initialize logger
const logger = new Logger('info', 'HybridMcpController', 'server');

/**
 * Get Hybrid MCP service status
 * @param req - Express request object
 * @param res - Express response object
 */
export const getHybridStatus = async (req: Request, res: Response): Promise<void> => {
    try {
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
        const serverHybridMcpService = ServerHybridMcpService.getInstance();
        const internalTools = await serverHybridMcpService.getInternalTools();
        
        // TODO: Add external tools discovery when MCP protocol is implemented
        const externalTools: any[] = [];
        
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
        const serverHybridMcpService = ServerHybridMcpService.getInstance();
        const serverStatuses = serverHybridMcpService.getExternalServerStatuses();
        
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

        if (transport === 'stdio') {
            validate.assertIsNonEmptyString(req.body.command, 'Command is required for stdio transport');
            validate.assertIsArray(req.body.args, 'Args must be an array for stdio transport');
        } else if (transport === 'http') {
            validate.assertIsNonEmptyString(req.body.url, 'URL is required for HTTP transport');
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

        // Stop and remove the server
        const stopped = await serverHybridMcpService.stopExternalServer(serverId);

        if (!stopped) {
            res.status(404).json({
                success: false,
                error: `Server ${serverId} not found or already stopped`
            });
            return;
        }

        // TODO: Add actual removal from registry (currently stop is enough)
        const removed = true;

        if (removed) {

            res.json({
                success: true,
                message: `External MCP server "${serverId}" unregistered successfully`
            });
        } else {
            res.status(404).json({
                success: false,
                error: `Server ${serverId} not found`
            });
        }

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
        const { serverId } = req.params;
        validate.assertIsNonEmptyString(serverId, 'Server ID is required');

        const serverHybridMcpService = ServerHybridMcpService.getInstance();

        // Get server statuses and find the requested one
        const allStatuses = serverHybridMcpService.getExternalServerStatuses();
        const status = allStatuses[serverId];

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
