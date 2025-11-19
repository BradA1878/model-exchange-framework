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
 * MCP Routes
 * 
 * This module defines API routes for the Model Context Protocol.
 * It follows the MCP specification for standardized tool and resource management.
 */

import express from 'express';
import * as mcpController from '../controllers/mcpController';
import { requireAdmin, requireProvider } from '../middleware/auth';
import { validateToolInput } from '../middleware/validation';

// Create router
const router = express.Router();

/**
 * @route   GET /api/mcp/capabilities
 * @desc    Get MCP server capabilities
 * @access  Public
 */
router.get('/capabilities', mcpController.getCapabilities);

/**
 * @route   GET /api/mcp/tools
 * @desc    List all MCP tools
 * @access  Public
 */
router.get('/tools', mcpController.listTools);

/**
 * @route   GET /api/mcp/tools/:name
 * @desc    Get MCP tool by name
 * @access  Public
 */
router.get('/tools/:name', mcpController.getToolByName);

/**
 * @route   POST /api/mcp/tools/:name/execute
 * @desc    Execute an MCP tool
 * @access  Public
 */
router.post('/tools/:name/execute', mcpController.executeTool);

/**
 * @route   POST /api/mcp/tools
 * @desc    Register a new MCP tool
 * @access  Restricted (admin or provider)
 */
router.post('/tools', requireProvider, validateToolInput, mcpController.registerTool);

/**
 * @route   PUT /api/mcp/tools/:name
 * @desc    Update an existing MCP tool
 * @access  Restricted (admin or provider)
 */
router.put('/tools/:name', requireProvider, validateToolInput, mcpController.updateTool);

/**
 * @route   DELETE /api/mcp/tools/:name
 * @desc    Delete an MCP tool
 * @access  Restricted (admin only)
 */
router.delete('/tools/:name', requireAdmin, mcpController.deleteTool);

/**
 * @route   GET /api/mcp/executions
 * @desc    Get active tool executions
 * @access  Restricted (admin only)
 */
router.get('/executions', requireAdmin, mcpController.getActiveExecutions);

/**
 * @route   DELETE /api/mcp/executions/:requestId
 * @desc    Cancel a tool execution
 * @access  Restricted (admin only)
 */
router.delete('/executions/:requestId', requireAdmin, mcpController.cancelExecution);

export default router;
