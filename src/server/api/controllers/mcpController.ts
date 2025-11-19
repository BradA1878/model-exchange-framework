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
 * MCP Controller
 * 
 * This controller manages the API endpoints for the Model Context Protocol (MCP).
 * It provides routes for tool and resource management following the MCP standard.
 */

import { Request, Response } from 'express';
import { createStrictValidator } from '../../../shared/utils/validation';
import { Logger } from '../../../shared/utils/Logger';
import { McpToolRegistry } from '../services/McpToolRegistry';
import { McpSocketExecutor } from '../../socket/services/McpSocketExecutor';
import { McpToolDefinition, McpToolHandlerContext, McpToolHandlerResult, McpToolResultContent } from '../../../shared/protocols/mcp/McpServerTypes';
import { McpToolInput } from '../../../shared/protocols/mcp/IMcpClient';
import { v4 as uuidv4 } from 'uuid';

// Create validator for MCP controller
const validate = createStrictValidator('McpController');

// Initialize logger
const logger = new Logger('info', 'McpController', 'server');

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
        // Get filter from query params
        const filter = req.query.filter as string | undefined;
        
        // Get tools from registry
        McpToolRegistry.getInstance().listTools(filter).subscribe({
            next: (tools: McpToolDefinition[]) => {
                // Return tool list without handler functions
                const sanitizedTools = tools.map(tool => ({
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
        
        // Validate input
        validate.assertIsObject(input);
        
        // Create context
        const context: McpToolHandlerContext = {
            requestId: uuidv4(),
            agentId: req.headers['x-agent-id'] as string,
            channelId: req.headers['x-channel-id'] as string,
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
                if (error.message?.includes('not found') || error.message?.includes('does not exist')) {
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
        // Destructure all required fields from request body
        const { name, description, inputSchema, metadata = {}, provider } = req.body;
        
        // Extract channelId from headers (required for tool registration)
        const channelId = req.headers['x-channel-id'] as string;
        
        // Validate required fields
        if (!name || typeof name !== 'string') {
            res.status(400).json({
                success: false,
                message: 'Tool name is required and must be a string'
            });
            return;
        }
        
        if (!channelId || typeof channelId !== 'string') {
            res.status(400).json({
                success: false,
                message: 'Channel ID is required and must be provided in x-channel-id header'
            });
            return;
        }
        
        // Create a handler that responds with a fixed message
        const toolHandler = (input: McpToolInput, context: McpToolHandlerContext): Promise<McpToolHandlerResult> => {
            return Promise.resolve({
                content: {
                    type: 'text',
                    data: 'Tool registered via API, but execution must be handled separately'
                }
            });
        };
        
        // Create tool definition
        const tool: McpToolDefinition = {
            name,
            description,
            inputSchema,
            handler: toolHandler,
            enabled: true,
            metadata
        };
        
        // Determine the provider ID - use the provider from the request body if available,
        // otherwise fall back to the user ID
        const providerId = provider || (req as any).user.id;
        
        // Register tool
        McpToolRegistry.getInstance().registerTool(tool, providerId, channelId).subscribe({
            next: (success: boolean) => {
                res.status(201).json({
                    success: true,
                    message: `Tool ${name} registered successfully`,
                    data: {
                        name,
                        description,
                        inputSchema,
                        metadata
                    }
                });
            },
            error: (error: Error) => {
                logger.error(`Error registering tool ${name}: ${error}`);
                res.status(400).json({
                    success: false,
                    message: 'Error registering tool',
                    error: error instanceof Error ? error.message : String(error)
                });
            }
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
            next: (success: boolean) => {
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
            next: (success: boolean) => {
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
