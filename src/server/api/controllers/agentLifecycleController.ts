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
 * @repository https://github.com/mxf-dev/mxf
 * @documentation https://mxf-dev.github.io/mxf/
 */

/**
 * Agent Lifecycle Controller
 * 
 * Handles agent lifecycle operations like restart, shutdown, pause, resume, and metrics
 */

import { Request, Response } from 'express';
import { Agent } from '@mxf-dev/core/models/agent';
import { createStrictValidator } from '@mxf-dev/core/utils/validation';
import { Logger } from '@mxf-dev/core/utils/Logger';
import { EventBus } from '@mxf-dev/core/events/EventBus';
import { Events } from '@mxf-dev/core/events/EventNames';
import { MemoryPersistenceService } from '../services/MemoryPersistenceService';
import { MemoryScope } from '@mxf-dev/core/types/MemoryTypes';
import { firstValueFrom } from 'rxjs';

// Create validator for this controller
const validate = createStrictValidator('AgentLifecycleController');

// Initialize logger for agent lifecycle controller
const logger = new Logger('info', 'AgentLifecycleController', 'server');

/**
 * Validates the optional req.body.reason field: when present it must be a
 * reasonable-length string (it lands in event payloads and logs). Returns the
 * validated reason or the provided default; sends a 400 and returns null on
 * invalid input.
 */
const validateReason = (req: Request, res: Response, defaultReason: string): string | null => {
    const { reason } = (req.body ?? {}) as { reason?: unknown };
    if (reason === undefined || reason === null) {
        return defaultReason;
    }
    if (typeof reason !== 'string' || reason.trim() === '' || reason.length > 500) {
        res.status(400).json({
            success: false,
            message: 'reason must be a non-empty string of at most 500 characters'
        });
        return null;
    }
    return reason;
};

/**
 * Restart an agent
 * 
 * @param req - Express request object
 * @param res - Express response object
 */
export const restartAgent = async (req: Request, res: Response): Promise<void> => {
    try {
        const validatedReason_restart = validateReason(req, res, 'Manual restart');
        if (validatedReason_restart === null) {
            return;
        }
        const { agentId } = req.params;
        validate.assertIsNonEmptyString(agentId);
        
        // Find agent
        const agent = await Agent.findOne({ agentId });
        
        if (!agent) {
            res.status(404).json({
                success: false,
                message: `Agent ${agentId} not found`
            });
            return;
        }
        
        // Emit restart event
        const eventPayload = {
            agentId: agent.agentId,
            reason: validatedReason_restart,
            timestamp: new Date()
        };
        
        EventBus.server.emit(Events.Agent.RESTART_REQUEST, eventPayload);
        
        
        res.status(200).json({
            success: true,
            message: `Restart request sent for agent ${agentId}`,
            data: {
                agentId: agent.agentId,
                status: 'restart_requested'
            }
        });
    } catch (error) {
        logger.error(`Error restarting agent ${req.params.agentId}: ${error}`);
        res.status(500).json({
            success: false,
            message: 'Server error',
            error: (error as Error).message
        });
    }
};

/**
 * Shutdown an agent
 * 
 * @param req - Express request object
 * @param res - Express response object
 */
export const shutdownAgent = async (req: Request, res: Response): Promise<void> => {
    try {
        const validatedReason_shutdown = validateReason(req, res, 'Manual shutdown');
        if (validatedReason_shutdown === null) {
            return;
        }
        const { agentId } = req.params;
        validate.assertIsNonEmptyString(agentId);
        
        // Find agent
        const agent = await Agent.findOne({ agentId });
        
        if (!agent) {
            res.status(404).json({
                success: false,
                message: `Agent ${agentId} not found`
            });
            return;
        }
        
        // Emit shutdown event
        const eventPayload = {
            agentId: agent.agentId,
            reason: validatedReason_shutdown,
            timestamp: new Date()
        };
        
        EventBus.server.emit(Events.Agent.SHUTDOWN_REQUEST, eventPayload);
        
        // Update agent status to INACTIVE
        agent.status = 'INACTIVE';
        await agent.save();
        
        
        res.status(200).json({
            success: true,
            message: `Shutdown request sent for agent ${agentId}`,
            data: {
                agentId: agent.agentId,
                status: 'shutdown_requested'
            }
        });
    } catch (error) {
        logger.error(`Error shutting down agent ${req.params.agentId}: ${error}`);
        res.status(500).json({
            success: false,
            message: 'Server error',
            error: (error as Error).message
        });
    }
};

/**
 * Get agent performance metrics
 * 
 * @param req - Express request object
 * @param res - Express response object
 */
export const getAgentMetrics = async (req: Request, res: Response): Promise<void> => {
    try {
        const { agentId } = req.params;
        validate.assertIsNonEmptyString(agentId);
        
        // Find agent
        const agent = await Agent.findOne({ agentId });
        
        if (!agent) {
            res.status(404).json({
                success: false,
                message: `Agent ${agentId} not found`
            });
            return;
        }
        
        // Emit metrics request event
        const eventPayload = {
            agentId: agent.agentId,
            timestamp: new Date()
        };
        
        EventBus.server.emit(Events.Agent.METRICS_REQUEST, eventPayload);
        
        // Basic metrics from agent model
        const metrics = {
            agentId: agent.agentId,
            uptime: Date.now() - agent.createdAt.getTime(),
            status: agent.status,
            lastActivity: agent.lastActive || agent.createdAt,
            totalTasks: 0, // Basic metric - would need to query task collection
            completedTasks: 0, // Basic metric - would need to query task collection
            failedTasks: 0, // Basic metric - would need to query task collection
            avgResponseTime: 0, // Basic metric - would need performance tracking
            successRate: 0 // Basic metric - calculated from task completion data
        };
        
        res.status(200).json({
            success: true,
            data: metrics
        });
    } catch (error) {
        logger.error(`Error getting agent metrics ${req.params.agentId}: ${error}`);
        res.status(500).json({
            success: false,
            message: 'Server error',
            error: (error as Error).message
        });
    }
};

/**
 * Pause an agent
 * 
 * @param req - Express request object
 * @param res - Express response object
 */
export const pauseAgent = async (req: Request, res: Response): Promise<void> => {
    try {
        const validatedReason_pause = validateReason(req, res, 'Manual pause');
        if (validatedReason_pause === null) {
            return;
        }
        const { agentId } = req.params;
        validate.assertIsNonEmptyString(agentId);
        
        // Find agent
        const agent = await Agent.findOne({ agentId });
        
        if (!agent) {
            res.status(404).json({
                success: false,
                message: `Agent ${agentId} not found`
            });
            return;
        }
        
        // Emit pause event
        const eventPayload = {
            agentId: agent.agentId,
            reason: validatedReason_pause,
            timestamp: new Date()
        };
        
        EventBus.server.emit(Events.Agent.PAUSE_REQUEST, eventPayload);
        
        // Note: PAUSED status not in Agent model - would use INACTIVE for now
        // await Agent.findByIdAndUpdate(agentId, {
        //     status: 'INACTIVE' // Using INACTIVE instead of PAUSED since PAUSED not in model
        // });
        
        
        res.status(200).json({
            success: true,
            message: `Agent ${agentId} paused successfully`,
            data: {
                agentId: agent.agentId,
                status: 'PAUSED'
            }
        });
    } catch (error) {
        logger.error(`Error pausing agent ${req.params.agentId}: ${error}`);
        res.status(500).json({
            success: false,
            message: 'Server error',
            error: (error as Error).message
        });
    }
};

/**
 * Resume an agent
 * 
 * @param req - Express request object
 * @param res - Express response object
 */
export const resumeAgent = async (req: Request, res: Response): Promise<void> => {
    try {
        const validatedReason_resume = validateReason(req, res, 'Manual resume');
        if (validatedReason_resume === null) {
            return;
        }
        const { agentId } = req.params;
        validate.assertIsNonEmptyString(agentId);
        
        // Find agent
        const agent = await Agent.findOne({ agentId });
        
        if (!agent) {
            res.status(404).json({
                success: false,
                message: `Agent ${agentId} not found`
            });
            return;
        }
        
        // Emit resume event
        const eventPayload = {
            agentId: agent.agentId,
            reason: validatedReason_resume,
            timestamp: new Date()
        };
        
        EventBus.server.emit(Events.Agent.RESUME_REQUEST, eventPayload);
        
        // Update agent status to ACTIVE
        agent.status = 'ACTIVE';
        agent.lastActive = new Date();
        await agent.save();
        
        
        res.status(200).json({
            success: true,
            message: `Agent ${agentId} resumed successfully`,
            data: {
                agentId: agent.agentId,
                status: 'ACTIVE'
            }
        });
    } catch (error) {
        logger.error(`Error resuming agent ${req.params.agentId}: ${error}`);
        res.status(500).json({
            success: false,
            message: 'Server error',
            error: (error as Error).message
        });
    }
};

/**
 * Delete agent memory
 *
 * Deletes all persistent memory for an agent from MongoDB.
 * This includes conversation history, notes, and custom data.
 *
 * @param req - Express request object
 * @param res - Express response object
 */
export const deleteAgentMemory = async (req: Request, res: Response): Promise<void> => {
    try {
        const { agentId } = req.params;
        validate.assertIsNonEmptyString(agentId);

        // Delete agent memory using the persistence service
        const memoryPersistenceService = MemoryPersistenceService.getInstance();
        const deleted = await firstValueFrom(
            memoryPersistenceService.deleteMemory(MemoryScope.AGENT, agentId)
        );

        if (deleted) {
            logger.info(`Agent memory deleted for ${agentId}`);
            res.status(200).json({
                success: true,
                message: `Memory deleted for agent ${agentId}`
            });
        } else {
            // Memory may not have existed, but that's okay - return success
            res.status(200).json({
                success: true,
                message: `No memory found for agent ${agentId} (may have been already deleted)`
            });
        }
    } catch (error) {
        logger.error(`Error deleting agent memory ${req.params.agentId}: ${error}`);
        res.status(500).json({
            success: false,
            message: 'Server error',
            error: (error as Error).message
        });
    }
};
