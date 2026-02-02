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

import { Request, Response } from 'express';
import { Agent } from '../../../shared/models/agent';
import { AgentMemory } from '../../../shared/models/memory';
import { createStrictValidator } from '../../../shared/utils/validation';
import { Logger } from '../../../shared/utils/Logger';
import { EventBus } from '../../../shared/events/EventBus';
import { Events } from '../../../shared/events/EventNames';

// Create validator for this controller
const validate = createStrictValidator('AgentController');

// Initialize logger for agent controller
const logger = new Logger('info', 'AgentController', 'server');

/**
 * Get all agents
 * @param req - Express request object
 * @param res - Express response object
 */
export const getAgents = async (req: Request, res: Response): Promise<void> => {
    try {
        const { status, serviceType } = req.query;
        // Get user from authentication middleware
        const user = (req as any).user;
        
        // Validate user authentication
        validate.assertIsObject(user, 'User authentication required');
        validate.assertIsObject(user.id, 'User ID is required');
        
        const userId = user.id.toString();
        const filter: any = { createdBy: userId };
        
        if (status) {
            filter.status = status;
        }
        
        if (serviceType) {
            filter.serviceTypes = serviceType;
        }
        
        const agents = await Agent.find(filter).sort({ lastActive: -1 });
        res.status(200).json({
            success: true,
            count: agents.length,
            data: agents
        });
    } catch (error) {
        logger.error(`Error fetching agents: ${error}`);
        res.status(500).json({
            success: false,
            message: 'Server error',
            error: (error as Error).message
        });
    }
};

/**
 * Get agent by ID
 * @param req - Express request object
 * @param res - Express response object
 */
export const getAgentById = async (req: Request, res: Response): Promise<void> => {
    try {
        // Get user from authentication middleware
        const user = (req as any).user;
        
        // Validate user authentication
        validate.assertIsObject(user, 'User authentication required');
        validate.assertIsObject(user.id, 'User ID is required');
        
        const userId = user.id.toString();
        
        const agent = await Agent.findOne({ agentId: req.params.agentId, createdBy: userId });
        
        if (!agent) {
            res.status(404).json({
                success: false,
                message: 'Agent not found'
            });
            return;
        }
        
        res.status(200).json({
            success: true,
            data: agent
        });
    } catch (error) {
        logger.error(`Error fetching agent ${req.params.agentId}: ${error}`);
        res.status(500).json({
            success: false,
            message: 'Server error',
            error: (error as Error).message
        });
    }
};

/**
 * Create a new agent
 * @param req - Express request object
 * @param res - Express response object
 */
export const createAgent = async (req: Request, res: Response): Promise<void> => {
    try {
        const { agentId, name, description, type, serviceTypes, capabilities, allowedTools } = req.body;
        
        // Get user from authentication middleware
        const user = (req as any).user;
        
        // Validate user authentication
        validate.assertIsObject(user, 'User authentication required');
        validate.assertIsObject(user.id, 'User ID is required');
        
        const userId = user.id.toString();
        
        // Check if agent already exists for this user
        const existingAgent = await Agent.findOne({ agentId, createdBy: userId });
        if (existingAgent) {
            res.status(400).json({
                success: false,
                message: 'Agent with this ID already exists'
            });
            return;
        }
        
        // Create new agent
        const agent = await Agent.create({
            agentId,
            name,
            description,
            type,
            serviceTypes,
            capabilities,
            allowedTools, // Tool access control - optional array of allowed tool names
            createdBy: userId,
            status: 'INACTIVE',
            lastActive: new Date()
        });
        
        res.status(201).json({
            success: true,
            data: agent
        });
    } catch (error) {
        logger.error(`Error creating agent: ${error}`);
        res.status(500).json({
            success: false,
            message: 'Server error',
            error: (error as Error).message
        });
    }
};

/**
 * Update an existing agent
 * @param req - Express request object
 * @param res - Express response object
 */
export const updateAgent = async (req: Request, res: Response): Promise<void> => {
    try {
        const { name, description, type, serviceTypes, capabilities, allowedTools, status } = req.body;
        
        // Get user from authentication middleware
        const user = (req as any).user;
        
        // Validate user authentication
        validate.assertIsObject(user, 'User authentication required');
        validate.assertIsObject(user.id, 'User ID is required');
        
        const userId = user.id.toString();
        
        // Find and update agent (only user's own agents)
        const agent = await Agent.findOneAndUpdate(
            { agentId: req.params.agentId, createdBy: userId },
            {
                name,
                description,
                type,
                serviceTypes,
                capabilities,
                allowedTools, // Tool access control - optional array of allowed tool names
                status,
                lastActive: new Date()
            },
            { new: true, runValidators: true }
        );
        
        if (!agent) {
            res.status(404).json({
                success: false,
                message: 'Agent not found'
            });
            return;
        }
        
        res.status(200).json({
            success: true,
            data: agent
        });
    } catch (error) {
        logger.error(`Error updating agent ${req.params.agentId}: ${error}`);
        res.status(500).json({
            success: false,
            message: 'Server error',
            error: (error as Error).message
        });
    }
};

/**
 * Delete an agent
 * @param req - Express request object
 * @param res - Express response object
 */
export const deleteAgent = async (req: Request, res: Response): Promise<void> => {
    try {
        const authType = (req as any).authType;
        const agentId = req.params.agentId;

        let agent;
        if (authType === 'key') {
            // API key auth: key validation already proved authorization
            agent = await Agent.findOneAndDelete({ agentId });
        } else {
            // JWT auth: ownership check via createdBy
            const user = (req as any).user;
            validate.assertIsObject(user, 'User authentication required');
            validate.assertIsObject(user.id, 'User ID is required');
            const userId = user.id.toString();
            agent = await Agent.findOneAndDelete({ agentId, createdBy: userId });
        }

        if (!agent) {
            res.status(404).json({
                success: false,
                message: 'Agent not found'
            });
            return;
        }

        // Clean up agent memory
        try {
            const memoryDeleteResult = await AgentMemory.deleteMany({ agentId: agentId });
            logger.info(`Deleted ${memoryDeleteResult.deletedCount} memory document(s) for agent ${agentId}`);
        } catch (memoryError) {
            logger.error(`Error deleting memory for agent ${agentId}: ${memoryError}`);
            // Continue - agent is already deleted, just log the error
        }

        res.status(200).json({
            success: true,
            message: 'Agent deleted successfully'
        });
    } catch (error) {
        logger.error(`Error deleting agent ${req.params.agentId}: ${error}`);
        res.status(500).json({
            success: false,
            message: 'Server error',
            error: (error as Error).message
        });
    }
};

/**
 * Get agents by service type
 * @param req - Express request object
 * @param res - Express response object
 */
export const getAgentsByService = async (req: Request, res: Response): Promise<void> => {
    try {
        const serviceType = req.params.serviceType;
        const agents = await Agent.find({ 
            serviceTypes: serviceType,
            status: 'ACTIVE'
        }).sort({ lastActive: -1 });
        
        res.status(200).json({
            success: true,
            count: agents.length,
            data: agents
        });
    } catch (error) {
        logger.error(`Error fetching agents for service ${req.params.serviceType}: ${error}`);
        res.status(500).json({
            success: false,
            message: 'Server error',
            error: (error as Error).message
        });
    }
};

/**
 * Get agent context by keyId (read-only data)
 * 
 * @param req - Express request object
 * @param res - Express response object
 */
export const getAgentContext = async (req: Request, res: Response): Promise<void> => {
    try {
        const { keyId } = req.params;
        validate.assertIsNonEmptyString(keyId);
        
        // Find agent by keyId
        const agent = await Agent.findOne({ keyId });
        
        if (!agent) {
            res.status(404).json({
                success: false,
                message: `Agent with keyId ${keyId} not found`
            });
            return;
        }
        
        // Return just the context information
        res.status(200).json({
            success: true,
            data: {
                keyId: agent.keyId,
                identity: agent.context?.identity,
                role: agent.role,
                specialization: agent.specialization,
                instructions: agent.context?.instructions,
                constraints: agent.context?.constraints,
                examples: agent.context?.examples
            }
        });
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        res.status(400).json({
            success: false,
            message: errorMessage
        });
    }
};

/**
 * Get or create agent memory by keyId
 * 
 * @param req - Express request object
 * @param res - Express response object
 */
export const getOrCreateAgentMemory = async (req: Request, res: Response): Promise<void> => {
    try {
        const { keyId } = req.params;
        validate.assertIsNonEmptyString(keyId);
        
        // Find agent by keyId
        let agent = await Agent.findOne({ keyId });
        
        if (!agent) {
            // Create a new agent if not found
            agent = new Agent({
                keyId,
                agentId: keyId, // Use keyId as agentId for now
                serviceTypes: ['memory'],
                status: 'ACTIVE',
                memory: {
                    notes: {},
                    conversationHistory: [],
                    customData: {},
                    updatedAt: new Date()
                }
            });
            
            await agent.save();
        } else if (!agent.memory) {
            // Initialize memory if it doesn't exist
            agent.memory = {
                notes: {},
                conversationHistory: [],
                customData: {},
                updatedAt: new Date()
            };
            
            await agent.save();
        }
        
        // Return the memory data
        res.status(200).json({
            success: true,
            data: {
                keyId: agent.keyId,
                notes: agent.memory?.notes || {},
                conversationHistory: agent.memory?.conversationHistory || [],
                customData: agent.memory?.customData || {},
                updatedAt: agent.memory?.updatedAt
            }
        });
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        res.status(400).json({
            success: false,
            message: errorMessage
        });
    }
};

/**
 * Update agent memory
 * 
 * @param req - Express request object
 * @param res - Express response object
 */
export const updateAgentMemory = async (req: Request, res: Response): Promise<void> => {
    try {
        const { keyId } = req.params;
        validate.assertIsNonEmptyString(keyId);
        validate.assertIsObject(req.body);
        
        // Find agent by keyId
        const agent = await Agent.findOne({ keyId });
        
        if (!agent) {
            res.status(404).json({
                success: false,
                message: `Agent with keyId ${keyId} not found`
            });
            return;
        }
        
        // Initialize memory if it doesn't exist
        if (!agent.memory) {
            agent.memory = {
                notes: {},
                conversationHistory: [],
                customData: {},
                updatedAt: new Date()
            };
        }
        
        // Update memory fields if provided in request
        if (req.body.notes) {
            agent.memory.notes = {
                ...agent.memory.notes || {},
                ...req.body.notes
            };
        }
        
        if (req.body.customData) {
            agent.memory.customData = {
                ...agent.memory.customData || {},
                ...req.body.customData
            };
        }
        
        // Handle conversation history (append if provided)
        if (req.body.conversationHistory && Array.isArray(req.body.conversationHistory)) {
            if (!agent.memory.conversationHistory) {
                agent.memory.conversationHistory = [];
            }
            agent.memory.conversationHistory.push(...req.body.conversationHistory);
        }
        
        // Update timestamp
        agent.memory.updatedAt = new Date();
        
        // Save the updated agent
        await agent.save();
        
        // Return updated memory
        res.status(200).json({
            success: true,
            data: {
                keyId: agent.keyId,
                notes: agent.memory.notes,
                conversationHistory: agent.memory.conversationHistory,
                customData: agent.memory.customData,
                updatedAt: agent.memory.updatedAt
            }
        });
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        res.status(400).json({
            success: false,
            message: errorMessage
        });
    }
};

/**
 * Update agent context (admin only)
 * 
 * @param req - Express request object
 * @param res - Express response object
 */
export const updateAgentContext = async (req: Request, res: Response): Promise<void> => {
    try {
        const { keyId } = req.params;
        validate.assertIsNonEmptyString(keyId);
        validate.assertIsObject(req.body);
        
        // Find agent by keyId
        const agent = await Agent.findOne({ keyId });
        
        if (!agent) {
            res.status(404).json({
                success: false,
                message: `Agent with keyId ${keyId} not found`
            });
            return;
        }
        
        // Initialize context if it doesn't exist
        if (!agent.context) {
            agent.context = {};
        }
        
        // Update context fields if provided
        if (req.body.identity) {
            agent.context.identity = req.body.identity;
        }
        
        if (req.body.instructions) {
            agent.context.instructions = req.body.instructions;
        }
        
        if (req.body.constraints) {
            agent.context.constraints = req.body.constraints;
        }
        
        if (req.body.examples) {
            agent.context.examples = req.body.examples;
        }
        
        if (req.body.role) {
            agent.role = req.body.role;
        }
        
        if (req.body.specialization) {
            agent.specialization = req.body.specialization;
        }
        
        // Update timestamp
        agent.context.updatedAt = new Date();
        
        // Save the updated agent
        await agent.save();
        
        // Return updated context
        res.status(200).json({
            success: true,
            data: {
                keyId: agent.keyId,
                identity: agent.context.identity,
                role: agent.role,
                specialization: agent.specialization,
                instructions: agent.context.instructions,
                constraints: agent.context.constraints,
                examples: agent.context.examples
            }
        });
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        res.status(400).json({
            success: false,
            message: errorMessage
        });
    }
};
