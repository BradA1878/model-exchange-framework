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
 * Task Management API Routes
 * 
 * REST endpoints for task creation, assignment, and management
 * with intelligent agent assignment using SystemLLM
 */

import { Router, Request, Response } from 'express';
import { createStrictValidator } from '@mxf-dev/core/utils/validation';
import { Logger } from '@mxf-dev/core/utils/Logger';
import {
    AgentTaskLifecycleTransition,
    TaskService
} from '../../socket/services/TaskService';
import { 
    ChannelTask,
    TaskQueryFilters,
    TaskPriority,
    TaskStatus 
} from '@mxf-dev/core/types/TaskTypes';
import {
    parseCreateTaskRequest,
    parseNonLifecycleTaskUpdateRequest
} from '../../socket/services/TaskRequestPolicy';
import {
    AuthorizationPrincipal,
    ChannelAuthorizationScope,
    authorizationService
} from '../services/AuthorizationService';

const router = Router();
const logger = new Logger('info', 'TaskAPI', 'server');
const validator = createStrictValidator('TaskAPI');

// Initialize TaskService
const taskService = TaskService.getInstance();

const sendAuthorizationFailure = (
    res: Response,
    decision: { status: 401 | 403 | 404; reason: string },
    concealExistence: boolean = false
): void => {
    const status = concealExistence && decision.status !== 401 ? 404 : decision.status;
    res.status(status).json({
        success: false,
        error: concealExistence && status === 404 ? 'Task not found' : decision.reason
    });
};

const authorizeChannel = async (
    req: Request,
    res: Response,
    channelId: string
): Promise<boolean> => {
    const principal = authorizationService.readPrincipal(req);
    const decision = await authorizationService.authorize(
        'access',
        'channel',
        channelId,
        principal
    );

    if (!decision.allowed) {
        sendAuthorizationFailure(res, decision);
        return false;
    }

    return true;
};

/** Resolve task -> channel first, then authorize without revealing foreign task existence. */
const resolveAuthorizedTaskChannel = async (
    req: Request,
    res: Response,
    taskId: string
): Promise<string | null> => {
    const channelId = await taskService.getTaskChannelId(taskId);
    if (!channelId) {
        res.status(404).json({ success: false, error: 'Task not found' });
        return null;
    }

    const principal = authorizationService.readPrincipal(req);
    const decision = await authorizationService.authorize(
        'access',
        'channel',
        channelId,
        principal
    );

    if (!decision.allowed) {
        sendAuthorizationFailure(res, decision, true);
        return null;
    }

    return channelId;
};

/** Resolve task -> channel, then require owning-user or administrator authority. */
const resolveManagedTaskChannel = async (
    req: Request,
    res: Response,
    taskId: string
): Promise<string | null> => {
    const channelId = await taskService.getTaskChannelId(taskId);
    if (!channelId) {
        res.status(404).json({ success: false, error: 'Task not found' });
        return null;
    }

    const decision = await authorizationService.authorize(
        'manage',
        'channel',
        channelId,
        authorizationService.readPrincipal(req)
    );
    if (!decision.allowed) {
        sendAuthorizationFailure(res, decision, true);
        return null;
    }
    return channelId;
};

const parseOwnerLifecycleTransition = (value: unknown): AgentTaskLifecycleTransition => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new Error('Task lifecycle transition must be an object');
    }
    const input = value as Record<string, unknown>;
    if (typeof input.action !== 'string') {
        throw new Error('Task lifecycle action is required');
    }

    const allowedFields = new Set(
        input.action === 'complete'
            ? ['action', 'result']
            : input.action === 'fail'
                ? ['action', 'error']
                : input.action === 'cancel'
                    ? ['action', 'reason']
                    : ['action']
    );
    const unknownFields = Object.keys(input).filter(field => !allowedFields.has(field));
    if (unknownFields.length > 0) {
        throw new Error(
            `Task lifecycle transition contains unsupported field(s): ${unknownFields.sort().join(', ')}`
        );
    }

    switch (input.action) {
        case 'start':
            return { kind: 'start' };
        case 'complete':
            if (!Object.prototype.hasOwnProperty.call(input, 'result')) {
                throw new Error('Task completion result is required');
            }
            return { kind: 'complete', output: input.result };
        case 'fail':
            if (typeof input.error !== 'string' || input.error.trim().length === 0) {
                throw new Error('Task failure error must be a non-empty string');
            }
            return { kind: 'fail', error: input.error };
        case 'cancel':
            if (input.reason !== undefined &&
                (typeof input.reason !== 'string' || input.reason.trim().length === 0)) {
                throw new Error('Task cancellation reason must be non-empty when provided');
            }
            return { kind: 'cancel', reason: input.reason as string | undefined };
        default:
            throw new Error('Task lifecycle action must be one of: start, complete, fail, cancel');
    }
};

const resolveTaskCollectionScope = async (
    req: Request,
    res: Response,
    requestedChannelId?: string
): Promise<ChannelAuthorizationScope | null> => {
    if (requestedChannelId) {
        const allowed = await authorizeChannel(req, res, requestedChannelId);
        return allowed
            ? { unrestricted: false, channelIds: [requestedChannelId] }
            : null;
    }

    const principal = authorizationService.readPrincipal(req);
    const decision = await authorizationService.resolveChannelScope(principal);
    if (!decision.allowed) {
        sendAuthorizationFailure(res, decision);
        return null;
    }

    return decision.scope;
};

const getAuthenticatedCreatorId = (principal: AuthorizationPrincipal): string => {
    if (principal.kind === 'user') {
        return principal.userId;
    }
    if (principal.kind === 'agent') {
        return principal.agentId;
    }

    throw new Error('Authenticated task creator identity is required');
};

const getTasksForScope = (
    filters: TaskQueryFilters,
    scope: ChannelAuthorizationScope
): Promise<ChannelTask[]> => scope.unrestricted
    ? taskService.getTasks(filters)
    : taskService.getTasksInChannels(filters, scope.channelIds);

/**
 * Create a new task
 * POST /api/tasks
 */
router.post('/', async (req: Request, res: Response) => {
    try {
        // Parse before authorization or service work. A TypeScript annotation on
        // req.body does not remove runtime fields, so accepting it directly would
        // let callers smuggle model-only state into TaskService's object spread.
        const createRequest = parseCreateTaskRequest(req.body);

        if (!await authorizeChannel(req, res, createRequest.channelId)) {
            return;
        }

        // Identity comes only from authentication middleware. Body/header values
        // are never considered when attributing a task.
        const principal = authorizationService.readPrincipal(req);
        const createdBy = getAuthenticatedCreatorId(principal);
        
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
router.get('/', async (req: Request, res: Response) => {
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
        
        const scope = await resolveTaskCollectionScope(req, res, filters.channelId);
        if (!scope) {
            return;
        }

        const tasks = await getTasksForScope(filters, scope);
        
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
router.get('/:taskId', async (req: Request, res: Response) => {
    try {
        const { taskId } = req.params;
        validator.assertIsNonEmptyString(taskId, 'taskId is required');

        const channelId = await resolveAuthorizedTaskChannel(req, res, taskId);
        if (!channelId) {
            return;
        }

        const task = await taskService.getTaskInChannel(taskId, channelId);
        
        if (!task) {
            res.status(404).json({
                success: false,
                error: 'Task not found'
            });
            return;
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
router.patch('/:taskId', async (req: Request, res: Response) => {
    try {
        const { taskId } = req.params;
        // Reject model-only fields before even resolving the task's channel. The
        // service parses again because socket/internal boundaries can call it
        // without going through this route.
        const updateRequest = parseNonLifecycleTaskUpdateRequest(req.body);
        
        validator.assertIsNonEmptyString(taskId, 'taskId is required');

        const channelId = await resolveAuthorizedTaskChannel(req, res, taskId);
        if (!channelId) {
            return;
        }

        const updatedTask = await taskService.updateTaskInChannel(taskId, channelId, updateRequest);
        
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
 * Owner/admin-only lifecycle transition. Channel-key agents must use the
 * assignee-scoped socket operations so their identity remains on the CAS.
 */
router.post('/:taskId/transition', async (req: Request, res: Response) => {
    try {
        const { taskId } = req.params;
        validator.assertIsNonEmptyString(taskId, 'taskId is required');
        const transition = parseOwnerLifecycleTransition(req.body);
        const channelId = await resolveManagedTaskChannel(req, res, taskId);
        if (!channelId) {
            return;
        }

        const principal = authorizationService.readPrincipal(req);
        if (principal.kind !== 'user') {
            throw new Error('A user account is required to transition this task');
        }
        const task = await taskService.transitionTaskAsOwnerInChannel(
            taskId,
            channelId,
            principal.userId,
            transition
        );
        res.json({ success: true, data: task });
    } catch (error) {
        logger.error(`❌ Failed to transition task: ${error}`);
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
router.post('/:taskId/assign', async (req: Request, res: Response) => {
    try {
        const { taskId } = req.params;
        const { agentId } = req.body;
        
        validator.assertIsNonEmptyString(taskId, 'taskId is required');
        validator.assertIsNonEmptyString(agentId, 'agentId is required');

        const channelId = await resolveAuthorizedTaskChannel(req, res, taskId);
        if (!channelId) {
            return;
        }

        const principal = authorizationService.readPrincipal(req);
        const assignedBy = getAuthenticatedCreatorId(principal);
        const updatedTask = await taskService.assignTaskInChannel(
            taskId,
            channelId,
            agentId,
            assignedBy
        );
        
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
router.post('/:taskId/assign-intelligent', async (req: Request, res: Response) => {
    try {
        const { taskId } = req.params;
        validator.assertIsNonEmptyString(taskId, 'taskId is required');

        const channelId = await resolveAuthorizedTaskChannel(req, res, taskId);
        if (!channelId) {
            return;
        }

        const assignmentResult = await taskService.assignTaskIntelligentlyInChannel(taskId, channelId);
        
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
router.get('/analysis/workload/:channelId', async (req: Request, res: Response) => {
    try {
        const { channelId } = req.params;
        validator.assertIsNonEmptyString(channelId, 'channelId is required');

        if (!await authorizeChannel(req, res, channelId)) {
            return;
        }
        
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
router.get('/channel/:channelId', async (req: Request, res: Response) => {
    try {
        const { channelId } = req.params;
        validator.assertIsNonEmptyString(channelId, 'channelId is required');

        if (!await authorizeChannel(req, res, channelId)) {
            return;
        }

        const tasks = await taskService.getTasksInChannels({ channelId }, [channelId]);
        
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
router.get('/agent/:agentId', async (req: Request, res: Response) => {
    try {
        const { agentId } = req.params;
        validator.assertIsNonEmptyString(agentId, 'agentId is required');

        const scope = await resolveTaskCollectionScope(req, res);
        if (!scope) {
            return;
        }

        const tasks = await getTasksForScope({ assignedAgentId: agentId }, scope);
        
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
