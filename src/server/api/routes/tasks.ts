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
 * Task Management API Routes
 * 
 * REST endpoints for task creation, assignment, and management
 * with intelligent agent assignment using SystemLLM
 */

import { Router, Request, Response } from 'express';
import { createStrictValidator } from '../../../shared/utils/validation';
import { Logger } from '../../../shared/utils/Logger';
import { TaskService } from '../../socket/services/TaskService';
import { EventBus } from '../../../shared/events/EventBus';
import { TaskEvents } from '../../../shared/events/event-definitions/TaskEvents';
import { createTaskEventPayload, createTaskAssignmentEventPayload } from '../../../shared/schemas/EventPayloadSchema';
import { Task } from '../../../shared/models/task';
import { 
    CreateTaskRequest, 
    UpdateTaskRequest, 
    TaskQueryFilters,
    TaskPriority,
    TaskStatus 
} from '../../../shared/types/TaskTypes';

// Extend Request interface for authentication properties
interface AuthenticatedRequest extends Request {
    user?: { userId: string };
    agentId?: string;
}

const router = Router();
const logger = new Logger('info', 'TaskAPI', 'server');
const validator = createStrictValidator('TaskAPI');

// Initialize TaskService
const taskService = TaskService.getInstance();

/**
 * Create a new task
 * POST /api/tasks
 */
router.post('/', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const createRequest: CreateTaskRequest = req.body;
        
        // Get creator from authentication context
        const createdBy = req.user?.userId || req.agentId || 'system';
        
        // Validate required fields
        validator.assertIsNonEmptyString(createRequest.channelId, 'channelId is required');
        validator.assertIsNonEmptyString(createRequest.title, 'title is required');
        validator.assertIsNonEmptyString(createRequest.description, 'description is required');
        
        const task = await taskService.createTask(createRequest, createdBy);
        
        res.status(201).json({
            success: true,
            data: task
        });
        
    } catch (error) {
        logger.error(`❌ Failed to create task: ${error}`);
        res.status(400).json({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

/**
 * Get tasks with optional filters
 * GET /api/tasks
 */
router.get('/', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const filters: TaskQueryFilters = {};
        
        // Parse query parameters
        if (req.query.channelId) {
            filters.channelId = req.query.channelId as string;
        }
        
        if (req.query.status) {
            if (Array.isArray(req.query.status)) {
                filters.status = req.query.status as TaskStatus[];
            } else {
                filters.status = req.query.status as TaskStatus;
            }
        }
        
        if (req.query.priority) {
            if (Array.isArray(req.query.priority)) {
                filters.priority = req.query.priority as TaskPriority[];
            } else {
                filters.priority = req.query.priority as TaskPriority;
            }
        }
        
        if (req.query.assignedAgentId) {
            filters.assignedAgentId = req.query.assignedAgentId as string;
        }
        
        if (req.query.createdBy) {
            filters.createdBy = req.query.createdBy as string;
        }
        
        if (req.query.tags) {
            filters.tags = Array.isArray(req.query.tags) 
                ? req.query.tags as string[]
                : [req.query.tags as string];
        }
        
        // Date filters
        if (req.query.dueBefore) {
            filters.dueBefore = parseInt(req.query.dueBefore as string);
        }
        
        if (req.query.dueAfter) {
            filters.dueAfter = parseInt(req.query.dueAfter as string);
        }
        
        const tasks = await taskService.getTasks(filters);
        
        res.json({
            success: true,
            data: tasks,
            count: tasks.length
        });
        
    } catch (error) {
        logger.error(`❌ Failed to get tasks: ${error}`);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

/**
 * Get specific task by ID
 * GET /api/tasks/:taskId
 */
router.get('/:taskId', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { taskId } = req.params;
        validator.assertIsNonEmptyString(taskId, 'taskId is required');
        
        const tasks = await taskService.getTasks({ /* no filters - will get all, then filter */ });
        const task = tasks.find((t: any) => t.id === taskId);
        
        if (!task) {
            return res.status(404).json({
                success: false,
                error: 'Task not found'
            });
        }
        
        res.json({
            success: true,
            data: task
        });
        
    } catch (error) {
        logger.error(`❌ Failed to get task: ${error}`);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

/**
 * Update a task
 * PATCH /api/tasks/:taskId
 */
router.patch('/:taskId', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { taskId } = req.params;
        const updateRequest: UpdateTaskRequest = req.body;
        
        validator.assertIsNonEmptyString(taskId, 'taskId is required');
        
        const updatedTask = await taskService.updateTask(taskId, updateRequest);
        
        res.json({
            success: true,
            data: updatedTask
        });
        
    } catch (error) {
        logger.error(`❌ Failed to update task: ${error}`);
        res.status(400).json({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

/**
 * Manually assign task to agent
 * POST /api/tasks/:taskId/assign
 */
router.post('/:taskId/assign', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { taskId } = req.params;
        const { agentId } = req.body;
        
        validator.assertIsNonEmptyString(taskId, 'taskId is required');
        validator.assertIsNonEmptyString(agentId, 'agentId is required');
        
        const updatedTask = await taskService.updateTask(taskId, {
            assignedAgentId: agentId,
            status: 'assigned'
        });
        
        res.json({
            success: true,
            data: updatedTask
        });
        
    } catch (error) {
        logger.error(`❌ Failed to assign task: ${error}`);
        res.status(400).json({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

/**
 * Trigger intelligent assignment for a task
 * POST /api/tasks/:taskId/assign-intelligent
 */
router.post('/:taskId/assign-intelligent', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { taskId } = req.params;
        validator.assertIsNonEmptyString(taskId, 'taskId is required');
        
        const assignmentResult = await taskService.assignTaskIntelligently(taskId);
        
        
        // Emit task:assigned event - get task to obtain channelId
        const taskRecord = await Task.findById(taskId);
        if (taskRecord) {
            const taskAssignmentData = {
                taskId: assignmentResult.taskId,
                assignedAgentId: assignmentResult.assignedAgentId,
                strategy: assignmentResult.strategy,
                confidence: assignmentResult.confidence,
                reasoning: assignmentResult.reasoning,
                assignedAt: assignmentResult.assignedAt,
                task: taskRecord 
            };
            const eventPayload = createTaskAssignmentEventPayload(
                TaskEvents.ASSIGNED,
                assignmentResult.assignedAgentId,
                taskRecord.channelId,
                taskAssignmentData
            );
            EventBus.server.emit(TaskEvents.ASSIGNED, eventPayload);
        }
        
        res.json({
            success: true,
            data: assignmentResult
        });
        
    } catch (error) {
        logger.error(`❌ Failed to assign task intelligently: ${error}`);
        res.status(400).json({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

/**
 * Get channel workload analysis
 * GET /api/tasks/analysis/workload/:channelId
 */
router.get('/analysis/workload/:channelId', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { channelId } = req.params;
        validator.assertIsNonEmptyString(channelId, 'channelId is required');
        
        // Workload analysis is now handled internally by TaskService orchestration
        res.json({
            success: true,
            message: 'Workload analysis triggered internally by TaskService orchestration'
        });
        
    } catch (error) {
        logger.error(`❌ Failed to analyze workload: ${error}`);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

/**
 * Get tasks by channel
 * GET /api/tasks/channel/:channelId
 */
router.get('/channel/:channelId', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { channelId } = req.params;
        validator.assertIsNonEmptyString(channelId, 'channelId is required');
        
        const tasks = await taskService.getTasks({ channelId });
        
        res.json({
            success: true,
            data: tasks,
            count: tasks.length
        });
        
    } catch (error) {
        logger.error(`❌ Failed to get tasks for channel: ${error}`);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

/**
 * Get tasks assigned to agent
 * GET /api/tasks/agent/:agentId
 */
router.get('/agent/:agentId', async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { agentId } = req.params;
        validator.assertIsNonEmptyString(agentId, 'agentId is required');
        
        const tasks = await taskService.getTasks({ assignedAgentId: agentId });
        
        res.json({
            success: true,
            data: tasks,
            count: tasks.length
        });
        
    } catch (error) {
        logger.error(`❌ Failed to get tasks for agent: ${error}`);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

export default router;
