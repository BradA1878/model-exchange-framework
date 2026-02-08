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
 * Analytics Routes
 * 
 * Routes for analytics, performance metrics, and reporting endpoints
 */

import { Router, Request, Response } from 'express';
import * as os from 'os';
import {
    getAgentPerformance,
    getChannelActivity,
    getTaskCompletionAnalytics,
    getSystemHealth,
    requestReport
} from '../controllers/analyticsController';
import { authenticateUser, requireAdmin } from '../middleware/auth';
import validationAnalyticsRoutes from './validationAnalytics';
import mongoose from 'mongoose';
import { Logger } from '../../../shared/utils/Logger';
import { ValidationPerformanceService } from '../../../shared/services/ValidationPerformanceService';
import { AgentService } from '../../socket/services/AgentService';
import { UserRole } from '../../../shared/models/user';

// Create logger instance for analytics routes
const logger = new Logger('error', 'AnalyticsRoutes', 'server');

const router = Router();

// Apply authentication to all analytics routes
router.use(authenticateUser);

// Mount validation analytics routes
router.use('/', validationAnalyticsRoutes);

/**
 * @route GET /api/analytics/agents/performance
 * @desc Get performance metrics for all agents
 * @access Private (JWT required)
 */
router.get('/agents/performance', getAgentPerformance);

/**
 * @route GET /api/analytics/agents/:agentId/performance
 * @desc Get performance metrics for specific agent
 * @access Private (JWT required)
 */
router.get('/agents/:agentId/performance', getAgentPerformance);

/**
 * @route GET /api/analytics/channels/activity
 * @desc Get activity metrics for all channels
 * @access Private (JWT required)
 */
router.get('/channels/activity', getChannelActivity);

/**
 * @route GET /api/analytics/channels/:channelId/activity
 * @desc Get activity metrics for specific channel
 * @access Private (JWT required)
 */
router.get('/channels/:channelId/activity', getChannelActivity);

/**
 * @route GET /api/analytics/tasks/completion
 * @desc Get task completion analytics
 * @query startDate (optional) - Start date for analytics range
 * @query endDate (optional) - End date for analytics range
 * @access Private (JWT required)
 */
router.get('/tasks/completion', getTaskCompletionAnalytics);

/**
 * @route GET /api/analytics/system/health
 * @desc Get system health metrics
 * @access Private (JWT required)
 */
router.get('/system/health', getSystemHealth);

/**
 * @route POST /api/analytics/reports
 * @desc Request report generation
 * @body reportType - Type of report to generate
 * @body parameters - Parameters for report generation
 * @access Private (JWT required)
 */
router.post('/reports', requestReport);

// Additional routes to match frontend expectations

/**
 * @route GET /api/analytics/stats
 * @desc Get analytics summary statistics
 */
router.get('/stats', async (req: Request, res: Response) => {
    try {
        // Validate authenticated user
        const user = (req as any).user;
        if (!user?.id) {
            res.status(401).json({ success: false, message: 'User not authenticated' });
            return;
        }

        // Get database connection
        const db = mongoose.connection.db;
        if (!db) {
            throw new Error('Database connection not available');
        }

        // Check if user is admin - admins see all data, non-admins see only their own
        const isAdmin = user.role === UserRole.ADMIN;
        const userId = user.id.toString();

        let agentsCount: number;
        let channelsCount: number;
        let tasksCount: number;
        let usersCount: number;
        let mcpToolsCount: number;

        if (isAdmin) {
            // Admin sees all data
            [agentsCount, channelsCount, tasksCount, usersCount, mcpToolsCount] = await Promise.all([
                db.collection('agents').countDocuments(),
                db.collection('channels').countDocuments(),
                db.collection('tasks').countDocuments(),
                db.collection('users').countDocuments(),
                db.collection('mcptools').countDocuments()
            ]);
        } else {
            // Non-admin sees only their own channels/agents
            // First get user's channel IDs and agent IDs for scoping tasks
            const [userChannels, userAgents] = await Promise.all([
                db.collection('channels').find({ createdBy: userId }).project({ channelId: 1 }).toArray(),
                db.collection('agents').find({ createdBy: userId }).project({ agentId: 1 }).toArray()
            ]);

            const userChannelIds = userChannels.map(c => c.channelId);
            const userAgentIds = userAgents.map(a => a.agentId);

            // Count user-scoped data
            channelsCount = userChannels.length;
            agentsCount = userAgents.length;

            // Tasks associated with user's channels or agents
            tasksCount = await db.collection('tasks').countDocuments({
                $or: [
                    { channelId: { $in: userChannelIds } },
                    { assignedAgentId: { $in: userAgentIds } },
                    { createdBy: userId }
                ]
            });

            // Users count is always 1 for non-admin (themselves)
            usersCount = 1;

            // MCP tools count is system-wide (tools are shared)
            mcpToolsCount = await db.collection('mcptools').countDocuments();
        }

        // Calculate system uptime (process uptime)
        const uptimeSeconds = process.uptime();
        const uptimeHours = Math.floor(uptimeSeconds / 3600);
        const systemUptime = `${uptimeHours}h`;

        // Calculate real metrics from available services
        let responseTime = '0ms';
        let errorRate = '0%';
        let dataProcessed = '0GB';
        let peakConcurrency = 0;
        let averageLoad = '0%';

        try {
            // Get validation performance metrics for error rate and response time
            const validationService = ValidationPerformanceService.getInstance();
            const validationMetrics = validationService.getAggregateMetrics();

            if (validationMetrics) {
                // Calculate average response time from validation metrics
                if (validationMetrics.averageValidationTime > 0) {
                    responseTime = `${Math.round(validationMetrics.averageValidationTime)}ms`;
                }
                // Calculate error rate from validation failures
                const totalValidations = validationMetrics.totalValidations || 0;
                const failedValidations = validationMetrics.failedValidations || 0;
                if (totalValidations > 0) {
                    const rate = (failedValidations / totalValidations) * 100;
                    errorRate = `${rate.toFixed(1)}%`;
                }
            }
        } catch (err) {
            // ValidationPerformanceService may not be initialized yet
        }

        try {
            // Get current agent connections for concurrency
            const agentService = AgentService.getInstance();
            const connectedAgents = agentService.getConnectedAgentCount();
            peakConcurrency = connectedAgents;
        } catch (err) {
            // AgentService may not be initialized yet
        }

        // Calculate CPU load average (system-wide metric)
        const loadAvg = os.loadavg();
        const cpuCount = os.cpus().length;
        // loadavg[0] is 1-minute average, normalize by CPU count
        const normalizedLoad = (loadAvg[0] / cpuCount) * 100;
        averageLoad = `${Math.min(100, Math.round(normalizedLoad))}%`;

        // Calculate memory usage as proxy for data processed
        const memUsage = process.memoryUsage();
        const heapUsedGB = memUsage.heapUsed / (1024 * 1024 * 1024);
        dataProcessed = `${heapUsedGB.toFixed(2)}GB`;

        const stats = {
            totalEvents: tasksCount,
            activeAgents: agentsCount,
            activeChannels: channelsCount,
            tasksCompleted: tasksCount,
            totalUsers: usersCount,
            mcpToolsCount: mcpToolsCount,
            systemUptime: systemUptime,
            responseTime,
            errorRate,
            dataProcessed,
            peakConcurrency,
            averageLoad
        };

        res.json({
            success: true,
            data: stats
        });
    } catch (error: any) {
        logger.error('Error fetching analytics stats:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to fetch analytics stats'
        });
    }
});

/**
 * @route GET /api/analytics/events
 * @desc Get analytics events data
 * @query limit (optional) - Limit number of events
 * @query search (optional) - Search filter
 * @query eventType (optional) - Event type filter
 * @query status (optional) - Status filter
 * @query startDate (optional) - Start date filter
 * @query endDate (optional) - End date filter
 * @access Private (JWT required)
 */
router.get('/events', async (req: Request, res: Response) => {
    try {
        // Validate authenticated user
        const user = (req as any).user;
        if (!user?.id) {
            res.status(401).json({ success: false, message: 'User not authenticated' });
            return;
        }

        const { limit = 10, search, eventType, status, startDate, endDate } = req.query;

        // Return real events data or empty array - no mock data
        const events: any[] = [];

        res.json({
            success: true,
            data: events,
            total: events.length,
            filters: { limit, search, eventType, status, startDate, endDate }
        });
    } catch (error: any) {
        logger.error('Error fetching analytics events:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to fetch analytics events'
        });
    }
});

/**
 * @route GET /api/analytics/performance
 * @desc Get overall performance metrics
 * @query timeRange (optional) - Time range for metrics (24h, 7d, 30d)
 * @access Private (JWT required)
 */
router.get('/performance', async (req: Request, res: Response) => {
    try {
        // Validate authenticated user
        const user = (req as any).user;
        if (!user?.id) {
            res.status(401).json({ success: false, message: 'User not authenticated' });
            return;
        }

        const { timeRange = '24h' } = req.query;

        // Return real performance data or zeros - no mock data
        const performanceData = {
            timeRange,
            metrics: {
                totalRequests: 0,
                averageResponseTime: 0,
                errorRate: 0,
                throughput: 0,
                cpuUsage: 0,
                memoryUsage: 0
            },
            chartData: [],
            timestamp: new Date().toISOString()
        };

        res.json({
            success: true,
            data: performanceData
        });
    } catch (error: any) {
        logger.error('Error fetching performance data:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to fetch performance data'
        });
    }
});

/**
 * @route GET /api/analytics/channels
 * @desc Alias for GET /api/analytics/channels/activity
 * @query timeRange (optional) - Time range for metrics
 * @access Private (JWT required)
 */
router.get('/channels', getChannelActivity);

/**
 * @route GET /api/analytics/agents
 * @desc Alias for GET /api/analytics/agents/performance  
 * @query timeRange (optional) - Time range for metrics
 * @access Private (JWT required)
 */
router.get('/agents', getAgentPerformance);

/**
 * @route GET /api/analytics/admin/channels
 * @desc Get all channels for admin view
 * @access Private (JWT required, admin only)
 */
router.get('/admin/channels', requireAdmin, async (req: Request, res: Response) => {
    try {
        // User is already validated by requireAdmin middleware
        const user = (req as any).user;

        // Get database connection
        const db = mongoose.connection.db;
        if (!db) {
            throw new Error('Database connection not available');
        }

        // Fetch all channels with basic info
        const channels = await db.collection('channels')
            .find({}, {
                projection: {
                    channelId: 1,
                    name: 1,
                    description: 1,
                    createdBy: 1,
                    participants: 1,
                    active: 1,
                    createdAt: 1,
                    updatedAt: 1
                }
            })
            .sort({ createdAt: -1 })
            .toArray();

        // Calculate channel pattern analytics
        const channelPatterns = {
            // Activity patterns
            activityDistribution: await db.collection('channels').aggregate([
                {
                    $addFields: {
                        daysSinceActive: {
                            $divide: [
                                { $subtract: [new Date(), '$lastActive'] },
                                1000 * 60 * 60 * 24
                            ]
                        }
                    }
                },
                {
                    $bucket: {
                        groupBy: '$daysSinceActive',
                        boundaries: [0, 1, 7, 30, 90, Infinity],
                        default: 'Unknown',
                        output: { count: { $sum: 1 } }
                    }
                }
            ]).toArray(),
            
            // Participation patterns
            participantDistribution: await db.collection('channels').aggregate([
                {
                    $addFields: {
                        participantCount: { $size: { $ifNull: ['$participants', []] } }
                    }
                },
                {
                    $group: {
                        _id: {
                            $switch: {
                                branches: [
                                    { case: { $eq: ['$participantCount', 0] }, then: '0' },
                                    { case: { $lte: ['$participantCount', 5] }, then: '1-5' },
                                    { case: { $lte: ['$participantCount', 10] }, then: '6-10' },
                                    { case: { $lte: ['$participantCount', 20] }, then: '11-20' }
                                ],
                                default: '20+'
                            }
                        },
                        count: { $sum: 1 }
                    }
                }
            ]).toArray(),
            
            // Configuration patterns
            configurationPatterns: await db.collection('channels').aggregate([
                {
                    $group: {
                        _id: null,
                        privateChannels: { $sum: { $cond: ['$isPrivate', 1, 0] } },
                        approvalRequired: { $sum: { $cond: ['$requireApproval', 1, 0] } },
                        allowAnonymous: { $sum: { $cond: ['$allowAnonymous', 1, 0] } },
                        verified: { $sum: { $cond: ['$verified', 1, 0] } }
                    }
                }
            ]).toArray(),
            
            // Creation trends (last 30 days)
            creationTrends: await db.collection('channels').aggregate([
                { $match: { createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } } },
                {
                    $group: {
                        _id: {
                            $dateToString: { format: '%Y-%m-%d', date: '$createdAt' }
                        },
                        count: { $sum: 1 }
                    }
                },
                { $sort: { '_id': 1 } }
            ]).toArray()
        };

        // Map channels with proper field names for frontend
        const mappedChannels = channels.map(channel => ({
            id: channel.channelId,
            name: channel.name || `Channel ${channel.channelId}`,
            description: channel.description || 'No description',
            createdBy: channel.createdBy,
            participantCount: channel.participants?.length || 0,
            status: channel.active ? 'active' : 'inactive',
            isPrivate: channel.isPrivate || false,
            requireApproval: channel.requireApproval || false,
            maxAgents: channel.maxAgents || 0,
            verified: channel.verified || false,
            lastActive: channel.lastActive,
            createdAt: channel.createdAt,
            updatedAt: channel.updatedAt
        }));

        res.json({
            success: true,
            channels: mappedChannels,
            patterns: channelPatterns,
            total: mappedChannels.length
        });
    } catch (error: any) {
        logger.error('Error fetching admin channels:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to fetch channels'
        });
    }
});

/**
 * @route GET /api/analytics/admin/agents
 * @desc Get all agents for admin view
 * @access Private (JWT required, admin only)
 */
router.get('/admin/agents', requireAdmin, async (req: Request, res: Response) => {
    try {
        // User is already validated by requireAdmin middleware
        const user = (req as any).user;

        // Get database connection
        const db = mongoose.connection.db;
        if (!db) {
            throw new Error('Database connection not available');
        }

        // Fetch all agents with basic info
        const agents = await db.collection('agents')
            .find({}, {
                projection: {
                    agentId: 1,
                    type: 1,
                    status: 1,
                    name: 1,
                    description: 1,
                    createdBy: 1,
                    channelId: 1,
                    serviceTypes: 1,
                    capabilities: 1,
                    lastActive: 1,
                    createdAt: 1,
                    updatedAt: 1
                }
            })
            .sort({ createdAt: -1 })
            .toArray();

        // Calculate agent pattern analytics
        const agentPatterns = {
            // Status distribution
            statusDistribution: await db.collection('agents').aggregate([
                { $group: { _id: '$status', count: { $sum: 1 } } }
            ]).toArray(),
            
            // Capability patterns
            capabilityPatterns: await db.collection('agents').aggregate([
                { $unwind: { path: '$capabilities', preserveNullAndEmptyArrays: true } },
                { $group: { _id: '$capabilities', count: { $sum: 1 } } },
                { $match: { _id: { $ne: null } } },
                { $sort: { count: -1 } },
                { $limit: 10 }
            ]).toArray(),
            
            // Service type patterns
            serviceTypePatterns: await db.collection('agents').aggregate([
                { $unwind: { path: '$serviceTypes', preserveNullAndEmptyArrays: true } },
                { $group: { _id: '$serviceTypes', count: { $sum: 1 } } },
                { $match: { _id: { $ne: null } } },
                { $sort: { count: -1 } },
                { $limit: 10 }
            ]).toArray(),
            
            // Creation trends (last 30 days)
            creationTrends: await db.collection('agents').aggregate([
                { $match: { createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } } },
                {
                    $group: {
                        _id: {
                            $dateToString: { format: '%Y-%m-%d', date: '$createdAt' }
                        },
                        count: { $sum: 1 }
                    }
                },
                { $sort: { '_id': 1 } }
            ]).toArray()
        };

        // Map agents with proper field names for frontend
        const mappedAgents = agents.map(agent => ({
            id: agent.agentId,
            name: agent.name || agent.agentId,
            type: agent.type || 'unknown',
            status: agent.status || 'unknown',
            description: agent.description || 'No description',
            createdBy: agent.createdBy,
            channelId: agent.channelId,
            serviceTypes: agent.serviceTypes || [],
            capabilities: agent.capabilities || [],
            lastActivity: agent.lastActive,
            createdAt: agent.createdAt,
            updatedAt: agent.updatedAt
        }));

        res.json({
            success: true,
            agents: mappedAgents,
            patterns: agentPatterns,
            total: mappedAgents.length
        });
    } catch (error: any) {
        logger.error('Error fetching admin agents:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to fetch agents'
        });
    }
});

/**
 * @route GET /api/analytics/admin/mcptools
 * @desc Get all MCP tools for admin view
 * @access Private (JWT required, admin only)
 */
router.get('/admin/mcptools', requireAdmin, async (req: Request, res: Response) => {
    try {
        // User is already validated by requireAdmin middleware
        const user = (req as any).user;

        // Get database connection
        const db = mongoose.connection.db;
        if (!db) {
            throw new Error('Database connection not available');
        }

        // Fetch all MCP tools with basic info
        const mcpTools = await db.collection('mcptools')
            .find({}, {
                projection: {
                    toolId: 1,
                    name: 1,
                    description: 1,
                    category: 1,
                    server: 1,
                    version: 1,
                    status: 1,
                    executions: 1,
                    lastUsed: 1,
                    createdAt: 1
                }
            })
            .sort({ name: 1 })
            .toArray();

        // Map tools with proper field names for frontend
        const mappedTools = mcpTools.map(tool => ({
            id: tool.toolId || tool._id,
            name: tool.name || 'Unknown Tool',
            description: tool.description || 'No description',
            category: tool.category || 'general',
            server: tool.server || 'unknown',
            version: tool.version || '1.0.0',
            status: tool.status || 'active',
            executions: tool.executions || 0,
            lastUsed: tool.lastUsed,
            createdAt: tool.createdAt
        }));

        res.json({
            success: true,
            tools: mappedTools,
            total: mappedTools.length
        });
    } catch (error: any) {
        logger.error('Error fetching MCP tools:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to fetch MCP tools'
        });
    }
});

/**
 * @route GET /api/analytics/admin/executions
 * @desc Get tool executions for admin view (from McpToolExecution collection)
 * @query status (optional) - Filter by status (running, completed, failed, timeout)
 * @query limit (optional) - Limit number of results (default 100)
 * @query toolName (optional) - Filter by tool name
 * @access Private (JWT required, admin only)
 */
router.get('/admin/executions', requireAdmin, async (req: Request, res: Response) => {
    try {
        // User is already validated by requireAdmin middleware
        const user = (req as any).user;

        // Get database connection
        const db = mongoose.connection.db;
        if (!db) {
            throw new Error('Database connection not available');
        }

        // Build query from request params
        const { status, limit = 100, toolName } = req.query;
        const query: Record<string, any> = {};

        if (status) {
            query.status = status;
        }
        if (toolName) {
            query.toolName = { $regex: toolName, $options: 'i' };
        }

        // Fetch tool executions from the new collection
        const executions = await db.collection('mcptoolexecutions')
            .find(query, {
                projection: {
                    requestId: 1,
                    toolName: 1,
                    source: 1,
                    serverId: 1,
                    agentId: 1,
                    channelId: 1,
                    status: 1,
                    startedAt: 1,
                    completedAt: 1,
                    durationMs: 1,
                    parameters: 1,
                    result: 1,
                    errorMessage: 1,
                    category: 1
                }
            })
            .sort({ startedAt: -1 })
            .limit(parseInt(limit as string) || 100)
            .toArray();

        // Get execution statistics
        const [total, completed, failed, running] = await Promise.all([
            db.collection('mcptoolexecutions').countDocuments(),
            db.collection('mcptoolexecutions').countDocuments({ status: 'completed' }),
            db.collection('mcptoolexecutions').countDocuments({ status: 'failed' }),
            db.collection('mcptoolexecutions').countDocuments({ status: 'running' })
        ]);

        // Get average duration for completed executions
        const avgResult = await db.collection('mcptoolexecutions').aggregate([
            { $match: { status: 'completed', durationMs: { $exists: true } } },
            { $group: { _id: null, avgDuration: { $avg: '$durationMs' } } }
        ]).toArray();
        const avgDurationMs = avgResult[0]?.avgDuration || 0;

        // Map executions with proper field names for frontend
        const mappedExecutions = executions.map(execution => ({
            id: execution.requestId || execution._id,
            toolName: execution.toolName || 'Unknown Tool',
            source: execution.source || 'internal',
            serverId: execution.serverId,
            agentId: execution.agentId || 'system',
            channelId: execution.channelId || 'default',
            status: execution.status || 'unknown',
            startedAt: execution.startedAt,
            startTime: execution.startedAt, // Alias for dashboard component compatibility
            completedAt: execution.completedAt,
            durationMs: execution.durationMs,
            parameters: execution.parameters || {},
            result: execution.result,
            errorMessage: execution.errorMessage,
            category: execution.category
        }));

        res.json({
            success: true,
            executions: mappedExecutions,
            total: mappedExecutions.length,
            stats: {
                total,
                completed,
                failed,
                running,
                avgDurationMs: Math.round(avgDurationMs)
            }
        });
    } catch (error: any) {
        logger.error('Error fetching tool executions:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to fetch tool executions'
        });
    }
});

/**
 * @route GET /api/analytics/admin/tasks
 * @desc Get comprehensive task analytics data
 * @access Private (JWT required, admin only)
 */
router.get('/admin/tasks', requireAdmin, async (req: Request, res: Response) => {
    try {
        // User is already validated by requireAdmin middleware
        const user = (req as any).user;

        const db = mongoose.connection.db;
        if (!db) {
            throw new Error('Database connection not available');
        }

        // Get tasks with analytics data
        const tasks = await db.collection('tasks')
            .find({}, {
                projection: {
                    channelId: 1,
                    title: 1,
                    description: 1,
                    priority: 1,
                    status: 1,
                    progress: 1,
                    assignedAgentId: 1,
                    assignmentStrategy: 1,
                    requiredRoles: 1,
                    requiredCapabilities: 1,
                    tags: 1,
                    createdBy: 1,
                    createdAt: 1,
                    updatedAt: 1,
                    dependsOn: 1,
                    blockedBy: 1
                }
            })
            .sort({ createdAt: -1 })
            .limit(1000) // Limit for performance
            .toArray();

        // Calculate analytics metrics
        const totalTasks = await db.collection('tasks').countDocuments();
        const statusCounts = await db.collection('tasks').aggregate([
            { $group: { _id: '$status', count: { $sum: 1 } } }
        ]).toArray();
        
        const priorityCounts = await db.collection('tasks').aggregate([
            { $group: { _id: '$priority', count: { $sum: 1 } } }
        ]).toArray();

        const strategyCounts = await db.collection('tasks').aggregate([
            { $group: { _id: '$assignmentStrategy', count: { $sum: 1 } } }
        ]).toArray();

        // Daily task creation trends (last 30 days)
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        
        const dailyTrends = await db.collection('tasks').aggregate([
            { $match: { createdAt: { $gte: thirtyDaysAgo } } },
            {
                $group: {
                    _id: {
                        $dateToString: { format: '%Y-%m-%d', date: '$createdAt' }
                    },
                    count: { $sum: 1 }
                }
            },
            { $sort: { '_id': 1 } }
        ]).toArray();

        // Map tasks for frontend
        const mappedTasks = tasks.map(task => ({
            id: task._id,
            channelId: task.channelId,
            title: task.title || 'Untitled Task',
            description: task.description || 'No description',
            priority: task.priority || 'medium',
            status: task.status || 'pending',
            progress: task.progress || 0,
            assignedAgentId: task.assignedAgentId,
            assignmentStrategy: task.assignmentStrategy || 'manual',
            requiredRoles: task.requiredRoles || [],
            requiredCapabilities: task.requiredCapabilities || [],
            tags: task.tags || [],
            createdBy: task.createdBy,
            createdAt: task.createdAt,
            updatedAt: task.updatedAt,
            dependsOn: task.dependsOn || [],
            blockedBy: task.blockedBy || []
        }));

        res.json({
            success: true,
            tasks: mappedTasks,
            analytics: {
                totalTasks,
                statusDistribution: statusCounts,
                priorityDistribution: priorityCounts,
                strategyDistribution: strategyCounts,
                dailyTrends
            }
        });
    } catch (error: any) {
        logger.error('Error fetching task analytics:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to fetch task analytics'
        });
    }
});

/**
 * @route GET /api/analytics/admin/auditlogs
 * @desc Get audit log analytics data
 * @access Private (JWT required, admin only)
 */
router.get('/admin/auditlogs', requireAdmin, async (req: Request, res: Response) => {
    try {
        // User is already validated by requireAdmin middleware
        const user = (req as any).user;

        const db = mongoose.connection.db;
        if (!db) {
            throw new Error('Database connection not available');
        }

        // Get recent audit logs
        const auditLogs = await db.collection('auditlogs')
            .find({}, {
                projection: {
                    eventType: 1,
                    agentId: 1,
                    timestamp: 1,
                    targetAgentId: 1,
                    messageType: 1,
                    serviceTypes: 1,
                    capabilities: 1,
                    error: 1,
                    metadata: 1,
                    createdAt: 1
                }
            })
            .sort({ timestamp: -1 })
            .limit(500)
            .toArray();

        // Event type distribution
        const eventTypeCounts = await db.collection('auditlogs').aggregate([
            { $group: { _id: '$eventType', count: { $sum: 1 } } },
            { $sort: { count: -1 } }
        ]).toArray();

        // Activity trends (last 7 days)
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        
        const activityTrends = await db.collection('auditlogs').aggregate([
            { $match: { timestamp: { $gte: sevenDaysAgo } } },
            {
                $group: {
                    _id: {
                        $dateToString: { format: '%Y-%m-%d', date: '$timestamp' }
                    },
                    count: { $sum: 1 }
                }
            },
            { $sort: { '_id': 1 } }
        ]).toArray();

        // Error rate analysis
        const errorLogs = await db.collection('auditlogs').countDocuments({
            error: { $exists: true, $ne: null }
        });
        const totalLogs = await db.collection('auditlogs').countDocuments();

        res.json({
            success: true,
            auditLogs: auditLogs,
            analytics: {
                totalLogs,
                errorLogs,
                errorRate: totalLogs > 0 ? (errorLogs / totalLogs * 100).toFixed(2) : 0,
                eventTypeDistribution: eventTypeCounts,
                activityTrends
            }
        });
    } catch (error: any) {
        logger.error('Error fetching audit log analytics:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to fetch audit log analytics'
        });
    }
});

/**
 * @route GET /api/analytics/admin/security
 * @desc Get security analytics (channel keys usage)
 * @access Private (JWT required, admin only)
 */
router.get('/admin/security', requireAdmin, async (req: Request, res: Response) => {
    try {
        // User is already validated by requireAdmin middleware
        const user = (req as any).user;

        const db = mongoose.connection.db;
        if (!db) {
            throw new Error('Database connection not available');
        }

        // Get channel keys data
        const channelKeys = await db.collection('channelkeys')
            .find({}, {
                projection: {
                    keyId: 1,
                    channelId: 1,
                    name: 1,
                    createdBy: 1,
                    isActive: 1,
                    lastUsed: 1,
                    createdAt: 1
                }
            })
            .sort({ createdAt: -1 })
            .toArray();

        // Key usage analytics
        const totalKeys = channelKeys.length;
        const activeKeys = channelKeys.filter(key => key.isActive).length;
        const usedKeys = channelKeys.filter(key => key.lastUsed).length;

        // Keys created over time (last 30 days)
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        
        const keyCreationTrends = await db.collection('channelkeys').aggregate([
            { $match: { createdAt: { $gte: thirtyDaysAgo } } },
            {
                $group: {
                    _id: {
                        $dateToString: { format: '%Y-%m-%d', date: '$createdAt' }
                    },
                    count: { $sum: 1 }
                }
            },
            { $sort: { '_id': 1 } }
        ]).toArray();

        res.json({
            success: true,
            channelKeys: channelKeys,
            analytics: {
                totalKeys,
                activeKeys,
                usedKeys,
                usageRate: totalKeys > 0 ? (usedKeys / totalKeys * 100).toFixed(2) : 0,
                keyCreationTrends
            }
        });
    } catch (error: any) {
        logger.error('Error fetching security analytics:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to fetch security analytics'
        });
    }
});

export default router;
