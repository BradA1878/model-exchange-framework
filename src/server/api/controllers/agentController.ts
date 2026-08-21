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

import { Request, Response } from 'express';
import { Agent } from '@mxf-dev/core/models/agent';
import { AgentMemory } from '@mxf-dev/core/models/memory';
import { createStrictValidator } from '@mxf-dev/core/utils/validation';
import { Logger } from '@mxf-dev/core/utils/Logger';
import { UserRole } from '@mxf-dev/core/models/user';
import channelKeyService from '../../socket/services/ChannelKeyService';
import agentIdentityOwnershipService, {
    AgentIdentityOwnershipError
} from '../../security/AgentIdentityOwnershipService';

interface AuthenticatedUserRequest extends Request {
    user?: {
        id?: unknown;
        role?: UserRole;
    };
}

interface AuthenticatedUserIdentity {
    userId: string;
    role?: UserRole;
}

// Create validator for this controller
const validate = createStrictValidator('AgentController');

// Initialize logger for agent controller
const logger = new Logger('info', 'AgentController', 'server');

const getAuthenticatedUser = (req: Request): AuthenticatedUserIdentity => {
    const user = (req as AuthenticatedUserRequest).user;
    if (!user || user.id === undefined || user.id === null) {
        throw new Error('User authentication required');
    }

    const userId = String(user.id).trim();
    validate.assertIsNonEmptyString(userId, 'User ID is required');
    return { userId, role: user.role };
};

/**
 * Get all agents
 * @param req - Express request object
 * @param res - Express response object
 */
export const getAgents = async (req: Request, res: Response): Promise<void> => {
    try {
        const { status, serviceType } = req.query;
        // Get user from authentication middleware
        const { userId, role } = getAuthenticatedUser(req);
        const filter: Record<string, unknown> = role === UserRole.ADMIN ? {} : { createdBy: userId };
        
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
        const { userId, role } = getAuthenticatedUser(req);
        const ownershipFilter = role === UserRole.ADMIN ? {} : { createdBy: userId };
        const agent = await Agent.findOne({ agentId: req.params.agentId, ...ownershipFilter });
        
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
        if (Object.prototype.hasOwnProperty.call(req.body ?? {}, 'allowedTools')) {
            res.status(400).json({
                success: false,
                message: 'Agent tool grants are issued on channel keys; allowedTools is not an Agent field'
            });
            return;
        }
        const { agentId, name, description, type, serviceTypes, capabilities } = req.body;
        
        // Get user from authentication middleware
        const { userId } = getAuthenticatedUser(req);

        // Agent and key creation share one permanent ownership reservation.
        // This atomic claim also preserves key-first creation: a reservation
        // made while issuing a key is accepted here for the same owner.
        await agentIdentityOwnershipService.claimOrValidate(agentId, userId);
        
        // Agent IDs are globally unique, so report the conflict before create.
        const existingAgent = await Agent.findOne({ agentId });
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
        const statusCode = error instanceof AgentIdentityOwnershipError
            ? error.statusCode
            : 500;
        res.status(statusCode).json({
            success: false,
            message: error instanceof AgentIdentityOwnershipError
                ? error.message
                : 'Server error',
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
        if (Object.prototype.hasOwnProperty.call(req.body ?? {}, 'allowedTools')) {
            res.status(400).json({
                success: false,
                message: 'Agent tool grants are issued on channel keys; allowedTools is not an Agent field'
            });
            return;
        }
        const { name, description, type, serviceTypes, capabilities, status } = req.body;
        
        // Get user from authentication middleware
        const { userId, role } = getAuthenticatedUser(req);
        // Find and update agent (only user's own agents)
        const ownershipFilter = role === UserRole.ADMIN ? {} : { createdBy: userId };
        const agent = await Agent.findOneAndUpdate(
            { agentId: req.params.agentId, ...ownershipFilter },
            {
                name,
                description,
                type,
                serviceTypes,
                capabilities,
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
        const agentId = req.params.agentId;
        const { userId, role } = getAuthenticatedUser(req);

        // Route authorization has already established ownership. Retain the
        // owner predicate here as defense in depth if the controller is ever
        // mounted elsewhere.
        const ownershipFilter = role === UserRole.ADMIN ? {} : { createdBy: userId };
        const persistedAgent = await Agent.findOne({ agentId, ...ownershipFilter });

        if (!persistedAgent) {
            res.status(404).json({
                success: false,
                message: 'Agent not found'
            });
            return;
        }

        const persistedOwner = String(persistedAgent.createdBy);
        validate.assertIsNonEmptyString(persistedOwner, 'Persisted agent owner is required');

        // Materialize or validate the permanent reservation before deletion.
        // No deletion path removes this row, so another tenant can never take
        // over the identifier after the Agent and its keys are gone.
        await agentIdentityOwnershipService.claimOrValidate(agentId, persistedOwner);

        // Revoke by the exact persisted identity/owner pair before removing the
        // agent. If revocation fails, the agent remains persisted and deletion
        // fails; if a later step races, the safer partial state is a live agent
        // with no credentials rather than a deleted agent with a live key.
        await channelKeyService.deactivateAgentKeys(agentId, persistedOwner);

        // Remove personal memory while the Agent still exists, so a storage
        // failure is retryable and cannot be reported as a successful deletion.
        // Keys are already revoked at this point, preventing new writes during
        // the deletion boundary.
        const memoryDeleteResult = await AgentMemory.deleteMany({ agentId });
        logger.info(`Deleted ${memoryDeleteResult.deletedCount} memory document(s) for agent ${agentId}`);

        const agent = await Agent.findOneAndDelete({
            _id: persistedAgent._id,
            agentId,
            createdBy: persistedAgent.createdBy
        });
        if (!agent) {
            res.status(404).json({
                success: false,
                message: 'Agent was already deleted or changed'
            });
            return;
        }

        res.status(200).json({
            success: true,
            message: 'Agent deleted successfully'
        });
    } catch (error) {
        logger.error(`Error deleting agent ${req.params.agentId}: ${error}`);
        const statusCode = error instanceof AgentIdentityOwnershipError
            ? error.statusCode
            : 500;
        res.status(statusCode).json({
            success: false,
            message: error instanceof AgentIdentityOwnershipError
                ? error.message
                : 'Server error',
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
        validate.assertIsNonEmptyString(serviceType, 'Service type is required');

        const { userId, role } = getAuthenticatedUser(req);
        const ownershipFilter = role === UserRole.ADMIN ? {} : { createdBy: userId };
        const agents = await Agent.find({
            serviceTypes: serviceType,
            status: 'ACTIVE',
            ...ownershipFilter
        })
            .select('agentId name description type serviceTypes capabilities status role specialization lastActive')
            .sort({ lastActive: -1 });
        
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
