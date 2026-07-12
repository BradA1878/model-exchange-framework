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
 * n8n Webhook Integration Routes
 *
 * Webhook endpoints for n8n workflows to trigger MXF actions
 * - Task creation from external events
 * - Generic event notifications
 * - Direct agent messaging
 *
 * Every route here spends money: creating a task assigns it to an agent, which
 * starts an ORPAR loop against a paid model. They are therefore:
 *
 * 1. Mounted only when MXF_WEBHOOK_ENABLED=true (see routes/index.ts). Off by
 *    default, so there is no open surface unless someone asked for one.
 * 2. Signed with HMAC-SHA256 over the raw body (see middleware/webhookAuth.ts).
 *    The server refuses to boot if the routes are enabled without a secret.
 * 3. Rate limited per source address before signature checking.
 *
 * n8n must send, on every request except /health:
 *   X-MXF-Timestamp: <unix seconds>
 *   X-MXF-Signature: sha256=<hex HMAC-SHA256 of `${timestamp}.${rawBody}` with MXF_WEBHOOK_SECRET>
 */

import { Router, Request, Response } from 'express';
import { createStrictValidator } from '@mxf-dev/core/utils/validation';
import { Logger } from '@mxf-dev/core/utils/Logger';
import { TaskService } from '../../socket/services/TaskService';
import { EventBus } from '@mxf-dev/core/events/EventBus';
import { Events } from '@mxf-dev/core/events/EventNames';
import { createBaseEventPayload, createTaskEventPayload } from '@mxf-dev/core/schemas/EventPayloadSchema';
import { authenticateWebhook, requireWebhookSecret } from '../middleware/webhookAuth';
import { createWebhookRateLimiter } from '../middleware/rateLimit';
import {
    CreateTaskRequest,
    TaskPriority
} from '@mxf-dev/core/types/TaskTypes';

const router = Router();
const logger = new Logger('debug', 'N8nWebhooks', 'server');
const validator = createStrictValidator('N8nWebhooks');

/**
 * Actor recorded on every event these routes emit.
 *
 * The webhook holds a shared secret, not an agent identity, so it can never
 * speak as an agent. Requests may still name an agent to *deliver* to; that
 * goes in receiverId, never in the payload's agentId.
 */
const WEBHOOK_ACTOR_ID = 'n8n-webhook';

/**
 * Event types accepted by POST /event.
 *
 * The emitted name is `webhook:<eventType>`, which lands on EventBus.server, so
 * the suffix is constrained rather than taken verbatim. Without this an unsigned
 * — or merely careless — caller could shape a name that collides with an
 * internal namespace.
 */
const EVENT_TYPE_PATTERN = /^[a-z0-9][a-z0-9_.-]{0,63}$/i;

// Fail fast at boot: enabling these routes without a secret is a configuration
// error, not something to discover on the first unsigned request.
requireWebhookSecret();

// Throttle by source address before any signature is computed, so an unsigned
// flood cannot make the server do HMAC work at line rate.
router.use(createWebhookRateLimiter());

// Initialize TaskService
const taskService = TaskService.getInstance();

/**
 * Task Creation Webhook
 * POST /api/webhooks/n8n/task
 * 
 * Allows n8n workflows to create tasks in MXF based on external events
 * 
 * @example Weather Alert → n8n → MXF Task
 * {
 *   "channelId": "content-distribution",
 *   "title": "Weather Alert: Heavy Rain",
 *   "description": "Create and distribute weather advisory",
 *   "assignTo": "content-distributor",
 *   "priority": "high",
 *   "metadata": {
 *     "source": "weather-api",
 *     "temperature": 45,
 *     "conditions": "heavy rain"
 *   }
 * }
 */
router.post('/task', authenticateWebhook, async (req: Request, res: Response) => {
    try {
        const {
            channelId,
            title,
            description,
            assignTo,
            priority = 'medium',
            coordinationMode = 'collaborative',
            metadata = {}
        } = req.body;
        
        // Validate required fields
        validator.assertIsNonEmptyString(channelId, 'channelId is required');
        validator.assertIsNonEmptyString(title, 'title is required');
        validator.assertIsNonEmptyString(description, 'description is required');
        
        // Clean up n8n expression artifacts (remove leading "=" if present)
        const cleanTitle = title.startsWith('=') ? title.substring(1) : title;
        
        // Clean metadata values that may have "=" prefix from n8n expressions
        const cleanMetadata: Record<string, any> = {};
        for (const [key, value] of Object.entries(metadata)) {
            if (typeof value === 'string' && value.startsWith('=')) {
                cleanMetadata[key] = value.substring(1);
            } else {
                cleanMetadata[key] = value;
            }
        }
        
        // Validate priority if provided
        const validPriorities: TaskPriority[] = ['low', 'medium', 'high', 'urgent'];
        if (priority && !validPriorities.includes(priority)) {
            throw new Error(`Invalid priority. Must be one of: ${validPriorities.join(', ')}`);
        }
        
        // Validate coordinationMode if provided
        const validCoordinationModes = ['collaborative', 'sequential', 'hierarchical'];
        if (coordinationMode && !validCoordinationModes.includes(coordinationMode)) {
            throw new Error(`Invalid coordinationMode. Must be one of: ${validCoordinationModes.join(', ')}`);
        }
        
        // Create task request
        const createRequest: CreateTaskRequest = {
            title: cleanTitle,
            description,
            channelId,
            priority: priority as TaskPriority,
            coordinationMode: coordinationMode as 'collaborative' | 'sequential' | 'hierarchical',
            assignmentStrategy: assignTo ? 'manual' : 'intelligent',
            assignmentScope: 'single',
            metadata: {
                ...cleanMetadata,
                source: 'n8n-webhook',
                triggeredAt: Date.now(),
                webhookUrl: req.originalUrl,
                // Disable auto-completion for solar-storm-response demo (always-on)
                enableMonitoring: channelId === 'solar-storm-response' ? false : cleanMetadata.enableMonitoring
            }
        };
        
        // Create task via TaskService
        const task = await taskService.createTask(createRequest, 'n8n-webhook');
        
        // If specific agent requested, assign it
        if (assignTo) {
            await taskService.updateTask(task.id, {
                assignedAgentId: assignTo,
                status: 'assigned'
            });
            
        } else {
            // Trigger intelligent assignment
            await taskService.assignTaskIntelligently(task.id);
            
        }
        
        // Emit task event for monitoring (with fail-fast validation)
        try {
            const taskEventPayload = createTaskEventPayload(
                Events.Task.REQUEST,
                'n8n-webhook',
                channelId,
                {
                    taskId: task.id,
                    task: {
                        title: task.title,
                        description: task.description,
                        priority: task.priority,
                        coordinationMode: task.coordinationMode,
                        assignmentStrategy: task.assignmentStrategy,
                        assignmentScope: task.assignmentScope,
                        metadata: task.metadata
                    }
                },
                { source: 'n8n-webhook' }
            );
            EventBus.server.emit(Events.Task.REQUEST, taskEventPayload);
        } catch (eventError) {
            logger.error(`❌ Failed to create task event payload: ${eventError}`);
            // Continue anyway - task was created successfully, event emission is optional
        }
        
        res.status(201).json({
            success: true,
            taskId: task.id,
            task: {
                id: task.id,
                title: task.title,
                status: task.status,
                assignedAgentId: task.assignedAgentId,
                channelId: task.channelId
            },
            message: `Task "${cleanTitle}" created successfully`
        });
        
    } catch (error) {
        logger.error(`❌ n8n webhook task creation failed: ${error}`);
        res.status(400).json({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
            message: 'Failed to create task from n8n webhook'
        });
    }
});

/**
 * Batch Task Creation Webhook
 * POST /api/webhooks/n8n/task/batch
 * 
 * Allows n8n workflows to create a single task with multiple items (e.g., multiple storms)
 * This prevents race conditions and premature task completion when processing arrays
 * 
 * @example Multiple Solar Storms → One Coordinated Response
 * {
 *   "channelId": "solar-storm-response",
 *   "title": "Multiple Solar Storms Detected",
 *   "description": "Process multiple storms in coordinated response",
 *   "assignTo": "storm-coordinator",
 *   "priority": "high",
 *   "items": [
 *     { "stormId": "GST-001", "kpIndex": 6.67, "startTime": "..." },
 *     { "stormId": "GST-002", "kpIndex": 7.33, "startTime": "..." }
 *   ]
 * }
 */
router.post('/task/batch', authenticateWebhook, async (req: Request, res: Response) => {
    try {
        const {
            channelId,
            title,
            description,
            assignTo,
            priority = 'medium',
            coordinationMode = 'collaborative',
            items = []
        } = req.body;
        
        // Validate required fields
        validator.assertIsNonEmptyString(channelId, 'channelId is required');
        validator.assertIsNonEmptyString(title, 'title is required');
        validator.assertIsNonEmptyString(description, 'description is required');
        
        if (!Array.isArray(items) || items.length === 0) {
            throw new Error('items array is required and must not be empty');
        }
        
        // Clean up n8n expression artifacts
        const cleanTitle = title.startsWith('=') ? title.substring(1) : title;
        
        // Clean each item's metadata
        const cleanItems = items.map(item => {
            const cleanItem: Record<string, any> = {};
            for (const [key, value] of Object.entries(item)) {
                if (typeof value === 'string' && value.startsWith('=')) {
                    cleanItem[key] = value.substring(1);
                } else {
                    cleanItem[key] = value;
                }
            }
            return cleanItem;
        });
        
        // Validate priority/coordinationMode
        const validPriorities: TaskPriority[] = ['low', 'medium', 'high', 'urgent'];
        if (priority && !validPriorities.includes(priority)) {
            throw new Error(`Invalid priority. Must be one of: ${validPriorities.join(', ')}`);
        }
        
        const validCoordinationModes = ['collaborative', 'sequential', 'hierarchical'];
        if (coordinationMode && !validCoordinationModes.includes(coordinationMode)) {
            throw new Error(`Invalid coordinationMode. Must be one of: ${validCoordinationModes.join(', ')}`);
        }
        
        // Create single task with all items in metadata
        const createRequest: CreateTaskRequest = {
            title: cleanTitle,
            description: `${description}\n\nProcessing ${cleanItems.length} items.`,
            channelId,
            priority: priority as TaskPriority,
            coordinationMode: coordinationMode as 'collaborative' | 'sequential' | 'hierarchical',
            assignmentStrategy: assignTo ? 'manual' : 'intelligent',
            assignmentScope: 'single',
            metadata: {
                source: 'n8n-webhook-batch',
                itemCount: cleanItems.length,
                items: cleanItems,
                triggeredAt: Date.now(),
                webhookUrl: req.originalUrl,
                // Disable auto-completion for solar-storm-response demo (always-on)
                enableMonitoring: channelId === 'solar-storm-response' ? false : undefined
            }
        };
        
        // Create task via TaskService
        const task = await taskService.createTask(createRequest, 'n8n-webhook');
        
        // Assign if specific agent requested
        if (assignTo) {
            await taskService.updateTask(task.id, {
                assignedAgentId: assignTo,
                status: 'assigned'
            });
            
        } else {
            await taskService.assignTaskIntelligently(task.id);
            
        }
        
        // Emit task event for monitoring (with fail-fast validation)
        try {
            const taskEventPayload = createTaskEventPayload(
                Events.Task.REQUEST,
                'n8n-webhook',
                channelId,
                {
                    taskId: task.id,
                    task: {
                        title: task.title,
                        description: task.description,
                        priority: task.priority,
                        coordinationMode: task.coordinationMode,
                        assignmentStrategy: task.assignmentStrategy,
                        assignmentScope: task.assignmentScope,
                        metadata: task.metadata
                    }
                },
                { source: 'n8n-webhook-batch' }
            );
            EventBus.server.emit(Events.Task.REQUEST, taskEventPayload);
        } catch (eventError) {
            logger.error(`❌ Failed to create batch task event payload: ${eventError}`);
            // Continue anyway - task was created successfully, event emission is optional
        }
        
        res.status(201).json({
            success: true,
            taskId: task.id,
            task: {
                id: task.id,
                title: task.title,
                status: task.status,
                assignedAgentId: task.assignedAgentId,
                channelId: task.channelId,
                itemCount: cleanItems.length
            },
            message: `Batch task "${cleanTitle}" created successfully with ${cleanItems.length} items`
        });
        
    } catch (error) {
        logger.error(`❌ n8n webhook batch task creation failed: ${error}`);
        res.status(400).json({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
            message: 'Failed to create batch task from n8n webhook'
        });
    }
});

/**
 * Generic Event Webhook
 * POST /api/webhooks/n8n/event
 * 
 * Allows n8n workflows to trigger custom events in MXF
 * Useful for monitoring, alerts, or custom integrations
 * 
 * @example GitHub Deploy → n8n → MXF Event → Agent Notification
 * {
 *   "channelId": "devops-channel",
 *   "eventType": "deployment_completed",
 *   "data": {
 *     "repository": "mxf-production",
 *     "branch": "main",
 *     "commit": "abc123",
 *     "status": "success"
 *   }
 * }
 */
router.post('/event', authenticateWebhook, async (req: Request, res: Response) => {
    try {
        const { channelId, eventType, data = {} } = req.body;

        // Validate required fields
        validator.assertIsNonEmptyString(channelId, 'channelId is required');
        validator.assertIsNonEmptyString(eventType, 'eventType is required');

        // Constrain the emitted name. The event lands on EventBus.server, so the
        // suffix is checked against a fixed charset rather than concatenated as-is.
        if (!EVENT_TYPE_PATTERN.test(eventType)) {
            throw new Error(
                'eventType must be 1-64 characters of letters, digits, underscore, dot, or hyphen'
            );
        }

        // Emit custom event
        const customEventName = `webhook:${eventType}`;
        const eventPayload = createBaseEventPayload(
            customEventName,
            WEBHOOK_ACTOR_ID,
            channelId,
            {
                ...data,
                eventType,
                source: 'n8n',
                triggeredAt: Date.now(),
                webhookUrl: req.originalUrl
            }
        );

        EventBus.server.emit(customEventName, eventPayload);


        res.json({
            success: true,
            event: {
                type: eventType,
                channelId,
                triggeredAt: Date.now()
            },
            message: `Event "${eventType}" triggered successfully`
        });
        
    } catch (error) {
        logger.error(`❌ n8n webhook event failed: ${error}`);
        res.status(400).json({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
            message: 'Failed to trigger event from n8n webhook'
        });
    }
});

/**
 * Direct Message Webhook
 * POST /api/webhooks/n8n/message
 * 
 * Allows n8n workflows to send messages directly to agents or channels
 * 
 * @example Scheduled Reminder → n8n → Agent Message
 * {
 *   "channelId": "team-channel",
 *   "agentId": "scheduler-agent",  // Optional: specific agent
 *   "message": "Daily standup in 15 minutes",
 *   "metadata": {
 *     "type": "reminder",
 *     "importance": "high"
 *   }
 * }
 */
router.post('/message', authenticateWebhook, async (req: Request, res: Response) => {
    try {
        const { channelId, agentId, message, metadata = {} } = req.body;

        // Validate required fields
        validator.assertIsNonEmptyString(channelId, 'channelId is required');
        validator.assertIsNonEmptyString(message, 'message is required');

        // `agentId` is a delivery target, not an identity. It selects who receives
        // the message (receiverId); the actor stays WEBHOOK_ACTOR_ID. Passing it
        // through as the payload's agentId — as this route used to — let a caller
        // publish messages that appear to come from any agent.
        const receiverId = typeof agentId === 'string' && agentId.trim().length > 0
            ? agentId.trim()
            : 'broadcast';

        // Emit message event
        const messageEventPayload = createBaseEventPayload(
            Events.Message.AGENT_MESSAGE,
            WEBHOOK_ACTOR_ID,
            channelId,
            {
                senderId: WEBHOOK_ACTOR_ID,
                receiverId,
                content: message,
                metadata: {
                    ...metadata,
                    source: 'n8n',
                    triggeredAt: Date.now(),
                    webhookUrl: req.originalUrl
                }
            }
        );

        EventBus.server.emit(Events.Message.AGENT_MESSAGE, messageEventPayload);
        
        
        res.json({
            success: true,
            data: {
                channelId,
                agentId: receiverId,
                content: message,
                sentAt: Date.now()
            },
            message: 'Message sent successfully'
        });

    } catch (error) {
        logger.error(`❌ n8n webhook message failed: ${error}`);
        res.status(400).json({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
            message: 'Failed to send message from n8n webhook'
        });
    }
});

/**
 * Health Check Endpoint
 * GET /api/webhooks/n8n/health
 * 
 * Simple endpoint for n8n to verify webhook connectivity
 */
router.get('/health', (req: Request, res: Response) => {
    res.json({
        success: true,
        status: 'healthy',
        service: 'mxf-n8n-webhooks',
        timestamp: Date.now()
    });
});

export default router;
