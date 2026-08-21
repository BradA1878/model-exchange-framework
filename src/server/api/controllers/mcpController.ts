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
 * MCP Controller
 * 
 * This controller manages the API endpoints for the Model Context Protocol (MCP).
 * It provides routes for tool and resource management following the MCP standard.
 */

import { Request, Response } from 'express';
import { createStrictValidator } from '@mxf-dev/core/utils/validation';
import { Logger } from '@mxf-dev/core/utils/Logger';
import { McpToolRegistry } from '../services/McpToolRegistry';
import { McpSocketExecutor } from '../../socket/services/McpSocketExecutor';
import {
    getToolAuthorizationNames,
    isPrivilegedHostToolEnabled,
    isPrivilegedNetworkToolEnabled,
    ToolAuthorizationError
} from '../../socket/services/ToolAuthorizationPolicy';
import { McpToolDefinition, McpToolHandlerContext, McpToolHandlerResult } from '@mxf-dev/core/protocols/mcp/McpServerTypes';
import { UserRole } from '@mxf-dev/core/models/user';
import { v4 as uuidv4 } from 'uuid';
import { loadActiveChannelRuntimePolicy } from '../security/ChannelRuntimePolicy';

// Create validator for MCP controller
const validate = createStrictValidator('McpController');

// Initialize logger
const logger = new Logger('info', 'McpController', 'server');

/**
 * Defense in depth for registry mutation controllers.
 *
 * The router applies the same policy, but a controller must not become an
 * unguarded provider/core-tool mutation path when reused or mounted elsewhere.
 */
const requireRegistryAdministrator = (req: Request, res: Response): boolean => {
    const authenticationRequest = req as Request & {
        authType?: string;
        user?: { role?: string };
    };

    if (authenticationRequest.authType !== 'jwt' ||
        authenticationRequest.user?.role !== UserRole.ADMIN) {
        res.status(403).json({
            success: false,
            message: 'Administrator privileges are required to mutate the MCP tool registry'
        });
        return false;
    }

    return true;
};

/**
 * Get MCP server capabilities
 * @param req - Express request object
 * @param res - Express response object
 */
export const getCapabilities = async (req: Request, res: Response): Promise<void> => {
    try {
        res.status(200).json({
            success: true,
            data: {
                name: 'MXF MCP Server',
                version: '1.0.0',
                capabilities: {
                    tools: true,
                    resources: true,
                    authorization: true,
                    streaming: false
                }
            }
        });
    } catch (error) {
        logger.error(`Error getting capabilities: ${error}`);
        res.status(500).json({
            success: false,
            message: 'Error getting capabilities',
            error: error instanceof Error ? error.message : String(error)
        });
    }
};

/**
 * List all MCP tools
 * @param req - Express request object
 * @param res - Express response object
 */
export const listTools = async (req: Request, res: Response): Promise<void> => {
    try {
        // Get filter from query params — fail fast on junk input.
        const rawFilter = req.query.filter;
        if (rawFilter !== undefined && (typeof rawFilter !== 'string' || rawFilter.length > 200)) {
            res.status(400).json({
                success: false,
                message: 'filter must be a string of at most 200 characters'
            });
            return;
        }
        const filter = rawFilter as string | undefined;
        
        // Get tools from registry
        McpToolRegistry.getInstance().listTools(filter).subscribe({
            next: (tools: McpToolDefinition[]) => {
                // Return tool list without handler functions
                const sanitizedTools = tools
                    .filter(tool => {
                        const names = getToolAuthorizationNames(tool);
                        return isPrivilegedHostToolEnabled(names) &&
                            isPrivilegedNetworkToolEnabled(names);
                    })
                    .map(tool => ({
                    name: tool.name,
                    description: tool.description,
                    inputSchema: tool.inputSchema,
                    metadata: tool.metadata
                    }));
                
                res.status(200).json({
                    success: true,
                    count: sanitizedTools.length,
                    data: sanitizedTools
                });
            },
            error: (error: Error) => {
                logger.error(`Error listing tools: ${error}`);
                res.status(500).json({
                    success: false,
                    message: 'Error listing tools',
                    error: error instanceof Error ? error.message : String(error)
                });
            }
        });
    } catch (error) {
        logger.error(`Error listing tools: ${error}`);
        res.status(500).json({
            success: false,
            message: 'Error listing tools',
            error: error instanceof Error ? error.message : String(error)
        });
    }
};

/**
 * Get a specific MCP tool by name
 * @param req - Express request object
 * @param res - Express response object
 */
export const getToolByName = async (req: Request, res: Response): Promise<void> => {
    try {
        const { name } = req.params;
        
        // Get tool from registry
        McpToolRegistry.getInstance().getTool(name).subscribe({
            next: (tool: McpToolDefinition) => {
                const authorizationNames = getToolAuthorizationNames(tool);
                if (!isPrivilegedHostToolEnabled(authorizationNames) ||
                    !isPrivilegedNetworkToolEnabled(authorizationNames)) {
                    res.status(404).json({
                        success: false,
                        message: `Tool ${name} not found`
                    });
                    return;
                }
                // Return tool without handler function
                const sanitizedTool = {
                    name: tool.name,
                    description: tool.description,
                    inputSchema: tool.inputSchema,
                    metadata: tool.metadata
                };
                
                res.status(200).json({
                    success: true,
                    data: sanitizedTool
                });
            },
            error: (error: Error) => {
                logger.error(`Error getting tool ${name}: ${error}`);
                res.status(404).json({
                    success: false,
                    message: `Tool ${name} not found`,
                    error: error instanceof Error ? error.message : String(error)
                });
            }
        });
    } catch (error) {
        logger.error(`Error getting tool: ${error}`);
        res.status(500).json({
            success: false,
            message: 'Error getting tool',
            error: error instanceof Error ? error.message : String(error)
        });
    }
};

/**
 * Execute an MCP tool
 * @param req - Express request object
 * @param res - Express response object
 */
export const executeTool = async (req: Request, res: Response): Promise<void> => {
    try {
        const { name } = req.params;
        const { input } = req.body;

        const authType = (req as Request & { authType?: string }).authType;
        if (!authType) {
            res.status(401).json({
                success: false,
                message: 'Authentication is required to execute MCP tools'
            });
            return;
        }

        // An HTTP execution must act as an agent. A user JWT authenticates a
        // user, not an agent/channel pair, so it cannot safely supply this
        // context. authenticateDual derives this principal from the bound key.
        if (authType !== 'key') {
            res.status(403).json({
                success: false,
                message: 'Agent key authentication is required to execute MCP tools'
            });
            return;
        }

        const authenticatedAgent = (req as Request & {
            agent?: {
                agentId?: unknown;
                channelId?: unknown;
                keyId?: unknown;
                allowedTools?: unknown;
            };
        }).agent;
        if (
            typeof authenticatedAgent?.agentId !== 'string' ||
            authenticatedAgent.agentId.length === 0 ||
            typeof authenticatedAgent.channelId !== 'string' ||
            authenticatedAgent.channelId.length === 0 ||
            typeof authenticatedAgent.keyId !== 'string' ||
            authenticatedAgent.keyId.length === 0 ||
            (authenticatedAgent.allowedTools !== undefined &&
                !Array.isArray(authenticatedAgent.allowedTools))
        ) {
            logger.error('Key-authenticated MCP execution is missing its bound agent/channel identity');
            res.status(403).json({
                success: false,
                message: 'The authenticated agent key is not bound to a valid agent and channel'
            });
            return;
        }

        // Legacy clients may still send these headers. Treat them only as
        // assertions and refuse a mismatch; never use them as authority.
        const assertedAgentId = req.headers['x-agent-id'];
        const assertedChannelId = req.headers['x-channel-id'];
        if (
            (assertedAgentId !== undefined && assertedAgentId !== authenticatedAgent.agentId) ||
            (assertedChannelId !== undefined && assertedChannelId !== authenticatedAgent.channelId)
        ) {
            res.status(403).json({
                success: false,
                message: 'Execution identity headers must match the authenticated agent key'
            });
            return;
        }
        
        // Validate input
        validate.assertIsObject(input);

        // HTTP execution does not traverse the socket join path that normally
        // hydrates channel policy. Load the exact key-bound active channel now;
        // otherwise an empty policy cache would be mistaken for unrestricted.
        const authenticatedChannel = await loadActiveChannelRuntimePolicy(
            authenticatedAgent.channelId
        );
        if (!authenticatedChannel) {
            res.status(403).json({
                success: false,
                message: 'The authenticated channel is missing or inactive'
            });
            return;
        }
        
        // Create context
        const context: McpToolHandlerContext = {
            requestId: uuidv4(),
            agentId: authenticatedAgent.agentId,
            channelId: authenticatedAgent.channelId,
            authorization: {
                keyId: authenticatedAgent.keyId,
                allowedTools: authenticatedAgent.allowedTools === undefined
                    ? undefined
                    : [...authenticatedAgent.allowedTools] as string[]
            },
            data: {
                ip: req.ip,
                userAgent: req.headers['user-agent']
            }
        };
        
        // Execute tool
        McpSocketExecutor.getInstance().executeTool(name, input, context).subscribe({
            next: (result: McpToolHandlerResult) => {
                res.status(200).json({
                    success: true,
                    requestId: context.requestId,
                    data: result.content,
                    metadata: result.metadata
                });
            },
            error: (error: Error) => {
                logger.error(`Error executing tool ${name}: ${error}`);
                
                // Return appropriate status based on error
                if (error instanceof ToolAuthorizationError) {
                    res.status(403).json({
                        success: false,
                        message: 'MCP tool execution is not authorized',
                        error: error.message
                    });
                } else if (error.message?.includes('not found') || error.message?.includes('does not exist')) {
                    res.status(404).json({
                        success: false,
                        message: `Tool ${name} not found`,
                        error: error instanceof Error ? error.message : String(error)
                    });
                } else if (error.message?.includes('Invalid input')) {
                    res.status(400).json({
                        success: false,
                        message: 'Invalid tool input',
                        error: error instanceof Error ? error.message : String(error)
                    });
                } else {
                    res.status(500).json({
                        success: false,
                        message: 'Error executing tool',
                        error: error instanceof Error ? error.message : String(error)
                    });
                }
            }
        });
    } catch (error) {
        logger.error(`Error executing tool: ${error}`);
        res.status(500).json({
            success: false,
            message: 'Error executing tool',
            error: error instanceof Error ? error.message : String(error)
        });
    }
};

/**
 * Register a new MCP tool
 * @param req - Express request object
 * @param res - Express response object
 */
export const registerTool = async (req: Request, res: Response): Promise<void> => {
    try {
        if (!requireRegistryAdministrator(req, res)) {
            return;
        }

        // A definition without an authenticated, reachable provider handler is
        // not executable. Persisting a placeholder would advertise a capability
        // that can only return simulated output, so this endpoint fails closed
        // until a provider invocation protocol exists.
        res.status(501).json({
            success: false,
            code: 'MCP_PROVIDER_INVOCATION_UNAVAILABLE',
            message: 'REST tool registration is unavailable because no authenticated provider invocation protocol is configured'
        });
    } catch (error) {
        logger.error(`Error registering tool: ${error}`);
        res.status(500).json({
            success: false,
            message: 'Error registering tool',
            error: error instanceof Error ? error.message : String(error)
        });
    }
};

/**
 * Update an existing MCP tool
 * @param req - Express request object
 * @param res - Express response object
 */
export const updateTool = async (req: Request, res: Response): Promise<void> => {
    try {
        if (!requireRegistryAdministrator(req, res)) {
            return;
        }

        const { name } = req.params;
        const { description, inputSchema, enabled, metadata } = req.body;
        
        // Create update object with only provided fields
        const updates: Partial<McpToolDefinition> = {};
        if (description !== undefined) updates.description = description;
        if (inputSchema !== undefined) updates.inputSchema = inputSchema;
        if (enabled !== undefined) updates.enabled = enabled;
        if (metadata !== undefined) updates.metadata = metadata;
        
        // Update tool
        McpToolRegistry.getInstance().updateTool(name, updates).subscribe({
            next: (_success: boolean) => {
                res.status(200).json({
                    success: true,
                    message: `Tool ${name} updated successfully`,
                    data: {
                        name,
                        ...updates
                    }
                });
            },
            error: (error: Error) => {
                logger.error(`Error updating tool ${name}: ${error}`);
                
                if (error.message?.includes('does not exist')) {
                    res.status(404).json({
                        success: false,
                        message: `Tool ${name} not found`,
                        error: error instanceof Error ? error.message : String(error)
                    });
                } else {
                    res.status(400).json({
                        success: false,
                        message: 'Error updating tool',
                        error: error instanceof Error ? error.message : String(error)
                    });
                }
            }
        });
    } catch (error) {
        logger.error(`Error updating tool: ${error}`);
        res.status(500).json({
            success: false,
            message: 'Error updating tool',
            error: error instanceof Error ? error.message : String(error)
        });
    }
};

/**
 * Delete an MCP tool
 * @param req - Express request object
 * @param res - Express response object
 */
export const deleteTool = async (req: Request, res: Response): Promise<void> => {
    try {
        const { name } = req.params;
        
        // Unregister tool
        McpToolRegistry.getInstance().unregisterTool(name).subscribe({
            next: (_success: boolean) => {
                res.status(200).json({
                    success: true,
                    message: `Tool ${name} deleted successfully`
                });
            },
            error: (error: Error) => {
                logger.error(`Error deleting tool ${name}: ${error}`);
                
                if (error.message?.includes('does not exist')) {
                    res.status(404).json({
                        success: false,
                        message: `Tool ${name} not found`,
                        error: error instanceof Error ? error.message : String(error)
                    });
                } else {
                    res.status(400).json({
                        success: false,
                        message: 'Error deleting tool',
                        error: error instanceof Error ? error.message : String(error)
                    });
                }
            }
        });
    } catch (error) {
        logger.error(`Error deleting tool: ${error}`);
        res.status(500).json({
            success: false,
            message: 'Error deleting tool',
            error: error instanceof Error ? error.message : String(error)
        });
    }
};

/**
 * Get active tool executions
 * @param req - Express request object
 * @param res - Express response object
 */
export const getActiveExecutions = async (req: Request, res: Response): Promise<void> => {
    try {
        const executions = McpSocketExecutor.getInstance().getActiveExecutions();
        
        res.status(200).json({
            success: true,
            count: executions.length,
            data: executions
        });
    } catch (error) {
        logger.error(`Error getting active executions: ${error}`);
        res.status(500).json({
            success: false,
            message: 'Error getting active executions',
            error: error instanceof Error ? error.message : String(error)
        });
    }
};

/**
 * Cancel a tool execution
 * @param req - Express request object
 * @param res - Express response object
 */
export const cancelExecution = async (req: Request, res: Response): Promise<void> => {
    try {
        const { requestId } = req.params;
        
        // Cancel execution
        McpSocketExecutor.getInstance().cancelExecution(requestId).subscribe({
            next: (success: boolean) => {
                res.status(200).json({
                    success: true,
                    message: success ? 'Execution canceled successfully' : 'Failed to cancel execution'
                });
            },
            error: (error: Error) => {
                logger.error(`Error canceling execution ${requestId}: ${error}`);
                
                if (error.message?.includes('No execution found')) {
                    res.status(404).json({
                        success: false,
                        message: `Execution ${requestId} not found`,
                        error: error instanceof Error ? error.message : String(error)
                    });
                } else {
                    res.status(400).json({
                        success: false,
                        message: 'Error canceling execution',
                        error: error instanceof Error ? error.message : String(error)
                    });
                }
            }
        });
    } catch (error) {
        logger.error(`Error canceling execution: ${error}`);
        res.status(500).json({
            success: false,
            message: 'Error canceling execution',
            error: error instanceof Error ? error.message : String(error)
        });
    }
};
