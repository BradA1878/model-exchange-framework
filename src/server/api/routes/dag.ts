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
 * DAG (Directed Acyclic Graph) Routes
 *
 * REST API routes for viewing and querying task dependency graphs.
 * Exposes task DAG data, critical paths, and ready tasks.
 */

import { Router, Request, Response } from 'express';
import { authenticateUser } from '../middleware/auth';
import { Logger } from '../../../shared/utils/Logger';
import { TaskDagService } from '../../../shared/services/dag/TaskDagService';
import { isDagEnabled } from '../../../shared/config/dag.config';
import mongoose from 'mongoose';

const logger = new Logger('error', 'DagRoutes', 'server');
const router = Router();

// Apply authentication to all DAG routes
router.use(authenticateUser);

/**
 * @route GET /api/dag/status
 * @desc Get DAG system status and configuration
 * @access Private (JWT required)
 */
router.get('/status', async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        if (!user?.id) {
            res.status(401).json({ success: false, message: 'User not authenticated' });
            return;
        }

        res.json({
            success: true,
            enabled: isDagEnabled(),
            message: isDagEnabled() ? 'DAG system is enabled' : 'DAG system is disabled'
        });
    } catch (error: any) {
        logger.error('Error checking DAG status:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to check DAG status'
        });
    }
});

/**
 * @route GET /api/dag/tasks/:channelId
 * @desc Get task DAG for a channel
 * @access Private (JWT required)
 */
router.get('/tasks/:channelId', async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        if (!user?.id) {
            res.status(401).json({ success: false, message: 'User not authenticated' });
            return;
        }

        const { channelId } = req.params;

        // Get database connection
        const db = mongoose.connection.db;
        if (!db) {
            throw new Error('Database connection not available');
        }

        // Fetch tasks for the channel
        const tasks = await db.collection('tasks')
            .find({ channelId })
            .toArray();

        if (tasks.length === 0) {
            res.json({
                success: true,
                dag: {
                    channelId,
                    nodes: [],
                    edges: [],
                    stats: {
                        nodeCount: 0,
                        edgeCount: 0,
                        rootCount: 0,
                        leafCount: 0,
                        maxDepth: 0,
                        readyTaskCount: 0,
                        blockedTaskCount: 0,
                        completedTaskCount: 0
                    }
                }
            });
            return;
        }

        // Build DAG visualization data
        const nodes: any[] = [];
        const edges: any[] = [];
        const taskMap = new Map<string, any>();

        // Create node map
        tasks.forEach(task => {
            const taskId = task._id.toString();
            taskMap.set(taskId, task);

            // Calculate in-degree and out-degree
            const inDegree = task.dependsOn?.length || 0;
            const dependents = tasks.filter(t =>
                t.dependsOn?.includes(taskId) || t.blockedBy?.includes(taskId)
            );
            const outDegree = dependents.length;

            // Determine if task is ready (no pending dependencies)
            const isReady = task.status === 'pending' &&
                (!task.dependsOn?.length && !task.blockedBy?.length ||
                (task.dependsOn || []).every((depId: string) => {
                    const dep = taskMap.get(depId);
                    return dep && dep.status === 'completed';
                }));

            nodes.push({
                id: taskId,
                label: task.title || `Task ${taskId.substring(0, 8)}`,
                status: task.status || 'pending',
                priority: task.priority || 'medium',
                progress: task.progress || 0,
                inDegree,
                outDegree,
                isReady,
                dependsOn: task.dependsOn || [],
                blockedBy: task.blockedBy || [],
                assignedTo: task.assignedAgentId,
                createdAt: task.createdAt
            });
        });

        // Create edges from dependencies
        tasks.forEach(task => {
            const taskId = task._id.toString();

            // dependsOn edges (must complete before this task)
            (task.dependsOn || []).forEach((depId: string) => {
                edges.push({
                    id: `${depId}->${taskId}`,
                    source: depId,
                    target: taskId,
                    type: 'depends_on'
                });
            });

            // blockedBy edges (alternative dependency representation)
            (task.blockedBy || []).forEach((blockerId: string) => {
                // Only add if not already in dependsOn to avoid duplicates
                if (!(task.dependsOn || []).includes(blockerId)) {
                    edges.push({
                        id: `${blockerId}->${taskId}`,
                        source: blockerId,
                        target: taskId,
                        type: 'blocked_by'
                    });
                }
            });
        });

        // Calculate statistics
        const statusCounts = tasks.reduce((acc: any, task) => {
            const status = task.status || 'pending';
            acc[status] = (acc[status] || 0) + 1;
            return acc;
        }, {});

        const rootNodes = nodes.filter(n => n.inDegree === 0);
        const leafNodes = nodes.filter(n => n.outDegree === 0);
        const readyTasks = nodes.filter(n => n.isReady);
        const blockedTasks = nodes.filter(n => !n.isReady && n.status === 'pending');

        // Calculate max depth (simple BFS from roots)
        let maxDepth = 0;
        if (rootNodes.length > 0 && edges.length > 0) {
            const visited = new Set<string>();
            const depths = new Map<string, number>();

            rootNodes.forEach(root => {
                depths.set(root.id, 0);
            });

            let changed = true;
            while (changed) {
                changed = false;
                edges.forEach(edge => {
                    const sourceDepth = depths.get(edge.source);
                    if (sourceDepth !== undefined) {
                        const targetDepth = depths.get(edge.target);
                        const newDepth = sourceDepth + 1;
                        if (targetDepth === undefined || newDepth > targetDepth) {
                            depths.set(edge.target, newDepth);
                            changed = true;
                        }
                    }
                });
            }

            maxDepth = Math.max(...Array.from(depths.values()), 0);
        }

        res.json({
            success: true,
            dag: {
                channelId,
                nodes,
                edges,
                stats: {
                    nodeCount: nodes.length,
                    edgeCount: edges.length,
                    rootCount: rootNodes.length,
                    leafCount: leafNodes.length,
                    maxDepth,
                    readyTaskCount: readyTasks.length,
                    blockedTaskCount: blockedTasks.length,
                    completedTaskCount: statusCounts['completed'] || 0,
                    inProgressCount: statusCounts['in_progress'] || 0,
                    pendingCount: statusCounts['pending'] || 0
                }
            }
        });
    } catch (error: any) {
        logger.error('Error fetching DAG:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to fetch DAG'
        });
    }
});

/**
 * @route GET /api/dag/critical-path/:channelId
 * @desc Get critical path (longest dependency chain) for a channel
 * @access Private (JWT required)
 */
router.get('/critical-path/:channelId', async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        if (!user?.id) {
            res.status(401).json({ success: false, message: 'User not authenticated' });
            return;
        }

        const { channelId } = req.params;

        const db = mongoose.connection.db;
        if (!db) {
            throw new Error('Database connection not available');
        }

        // Fetch tasks for the channel
        const tasks = await db.collection('tasks')
            .find({ channelId })
            .toArray();

        if (tasks.length === 0) {
            res.json({
                success: true,
                criticalPath: [],
                pathLength: 0
            });
            return;
        }

        // Build adjacency list
        const taskMap = new Map<string, any>();
        const adjacency = new Map<string, string[]>();
        const reverseAdjacency = new Map<string, string[]>();

        tasks.forEach(task => {
            const taskId = task._id.toString();
            taskMap.set(taskId, task);
            adjacency.set(taskId, []);
            reverseAdjacency.set(taskId, []);
        });

        tasks.forEach(task => {
            const taskId = task._id.toString();
            (task.dependsOn || []).forEach((depId: string) => {
                if (taskMap.has(depId)) {
                    adjacency.get(depId)?.push(taskId);
                    reverseAdjacency.get(taskId)?.push(depId);
                }
            });
        });

        // Find critical path using longest path algorithm
        const distances = new Map<string, number>();
        const predecessors = new Map<string, string | null>();

        // Initialize distances
        tasks.forEach(task => {
            distances.set(task._id.toString(), 0);
            predecessors.set(task._id.toString(), null);
        });

        // Topological sort (Kahn's algorithm)
        const inDegree = new Map<string, number>();
        tasks.forEach(task => {
            const taskId = task._id.toString();
            inDegree.set(taskId, reverseAdjacency.get(taskId)?.length || 0);
        });

        const queue: string[] = [];
        inDegree.forEach((degree, taskId) => {
            if (degree === 0) queue.push(taskId);
        });

        const sortedOrder: string[] = [];
        while (queue.length > 0) {
            const current = queue.shift()!;
            sortedOrder.push(current);

            (adjacency.get(current) || []).forEach(neighbor => {
                const newDegree = (inDegree.get(neighbor) || 1) - 1;
                inDegree.set(neighbor, newDegree);
                if (newDegree === 0) {
                    queue.push(neighbor);
                }
            });
        }

        // Compute longest path
        sortedOrder.forEach(taskId => {
            const currentDist = distances.get(taskId) || 0;
            (adjacency.get(taskId) || []).forEach(neighbor => {
                const newDist = currentDist + 1;
                if (newDist > (distances.get(neighbor) || 0)) {
                    distances.set(neighbor, newDist);
                    predecessors.set(neighbor, taskId);
                }
            });
        });

        // Find the task with maximum distance (end of critical path)
        let maxDist = 0;
        let endTask = '';
        distances.forEach((dist, taskId) => {
            if (dist >= maxDist) {
                maxDist = dist;
                endTask = taskId;
            }
        });

        // Reconstruct critical path
        const criticalPath: any[] = [];
        let current: string | null = endTask;
        while (current) {
            const task = taskMap.get(current);
            if (task) {
                criticalPath.unshift({
                    id: current,
                    title: task.title || `Task ${current.substring(0, 8)}`,
                    status: task.status || 'pending',
                    priority: task.priority || 'medium'
                });
            }
            current = predecessors.get(current) || null;
        }

        res.json({
            success: true,
            criticalPath,
            pathLength: criticalPath.length
        });
    } catch (error: any) {
        logger.error('Error computing critical path:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to compute critical path'
        });
    }
});

/**
 * @route GET /api/dag/ready-tasks/:channelId
 * @desc Get tasks ready for execution (no pending dependencies)
 * @query limit (optional) - Max tasks to return (default 20)
 * @access Private (JWT required)
 */
router.get('/ready-tasks/:channelId', async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        if (!user?.id) {
            res.status(401).json({ success: false, message: 'User not authenticated' });
            return;
        }

        const { channelId } = req.params;
        const { limit = 20 } = req.query;

        const db = mongoose.connection.db;
        if (!db) {
            throw new Error('Database connection not available');
        }

        // Fetch pending tasks for the channel
        const tasks = await db.collection('tasks')
            .find({
                channelId,
                status: { $in: ['pending', 'assigned'] }
            })
            .toArray();

        // Build task map for dependency checking
        const taskMap = new Map<string, any>();
        const allTasks = await db.collection('tasks').find({ channelId }).toArray();
        allTasks.forEach(task => taskMap.set(task._id.toString(), task));

        // Filter to only ready tasks (no pending dependencies)
        const readyTasks = tasks.filter(task => {
            const dependsOn = task.dependsOn || [];
            const blockedBy = task.blockedBy || [];
            const allDeps = [...new Set([...dependsOn, ...blockedBy])];

            // No dependencies - ready
            if (allDeps.length === 0) return true;

            // Check all dependencies are completed
            return allDeps.every(depId => {
                const dep = taskMap.get(depId);
                return dep && dep.status === 'completed';
            });
        });

        // Sort by priority and created date
        const priorityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
        readyTasks.sort((a, b) => {
            const priorityDiff = (priorityOrder[a.priority] || 2) - (priorityOrder[b.priority] || 2);
            if (priorityDiff !== 0) return priorityDiff;
            return (a.createdAt || 0) - (b.createdAt || 0);
        });

        // Apply limit
        const limitedTasks = readyTasks.slice(0, parseInt(limit as string) || 20);

        res.json({
            success: true,
            readyTasks: limitedTasks.map(task => ({
                id: task._id.toString(),
                title: task.title || `Task ${task._id.toString().substring(0, 8)}`,
                description: task.description,
                status: task.status,
                priority: task.priority || 'medium',
                assignedTo: task.assignedAgentId,
                createdAt: task.createdAt,
                tags: task.tags || []
            })),
            totalReady: readyTasks.length
        });
    } catch (error: any) {
        logger.error('Error fetching ready tasks:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to fetch ready tasks'
        });
    }
});

/**
 * @route GET /api/dag/execution-order/:channelId
 * @desc Get topological execution order for a channel
 * @access Private (JWT required)
 */
router.get('/execution-order/:channelId', async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        if (!user?.id) {
            res.status(401).json({ success: false, message: 'User not authenticated' });
            return;
        }

        const { channelId } = req.params;

        const db = mongoose.connection.db;
        if (!db) {
            throw new Error('Database connection not available');
        }

        // Fetch tasks for the channel
        const tasks = await db.collection('tasks')
            .find({ channelId })
            .toArray();

        if (tasks.length === 0) {
            res.json({
                success: true,
                executionOrder: [],
                levels: [],
                hasCycles: false
            });
            return;
        }

        // Build adjacency for topological sort
        const taskMap = new Map<string, any>();
        const inDegree = new Map<string, number>();
        const adjacency = new Map<string, string[]>();

        tasks.forEach(task => {
            const taskId = task._id.toString();
            taskMap.set(taskId, task);
            inDegree.set(taskId, 0);
            adjacency.set(taskId, []);
        });

        // Build edges from dependencies
        tasks.forEach(task => {
            const taskId = task._id.toString();
            (task.dependsOn || []).forEach((depId: string) => {
                if (taskMap.has(depId)) {
                    adjacency.get(depId)?.push(taskId);
                    inDegree.set(taskId, (inDegree.get(taskId) || 0) + 1);
                }
            });
        });

        // Kahn's algorithm with level tracking
        const levels: any[][] = [];
        const executionOrder: any[] = [];
        let currentLevel: string[] = [];

        // Start with root nodes (in-degree 0)
        inDegree.forEach((degree, taskId) => {
            if (degree === 0) currentLevel.push(taskId);
        });

        while (currentLevel.length > 0) {
            // Add current level to result
            const levelTasks = currentLevel.map(taskId => {
                const task = taskMap.get(taskId)!;
                return {
                    id: taskId,
                    title: task.title || `Task ${taskId.substring(0, 8)}`,
                    status: task.status || 'pending',
                    priority: task.priority || 'medium'
                };
            });
            levels.push(levelTasks);
            executionOrder.push(...levelTasks);

            // Process neighbors
            const nextLevel: string[] = [];
            currentLevel.forEach(taskId => {
                (adjacency.get(taskId) || []).forEach(neighbor => {
                    const newDegree = (inDegree.get(neighbor) || 1) - 1;
                    inDegree.set(neighbor, newDegree);
                    if (newDegree === 0) {
                        nextLevel.push(neighbor);
                    }
                });
            });

            currentLevel = nextLevel;
        }

        // Check for cycles (if not all tasks processed)
        const hasCycles = executionOrder.length < tasks.length;

        res.json({
            success: true,
            executionOrder,
            levels,
            hasCycles,
            totalTasks: tasks.length,
            processedTasks: executionOrder.length
        });
    } catch (error: any) {
        logger.error('Error computing execution order:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to compute execution order'
        });
    }
});

/**
 * @route GET /api/dag/channels
 * @desc Get list of channels with DAG data
 * @access Private (JWT required)
 */
router.get('/channels', async (req: Request, res: Response) => {
    try {
        const user = (req as any).user;
        if (!user?.id) {
            res.status(401).json({ success: false, message: 'User not authenticated' });
            return;
        }

        const db = mongoose.connection.db;
        if (!db) {
            throw new Error('Database connection not available');
        }

        // Get channels with task counts and dependency info
        const channelStats = await db.collection('tasks').aggregate([
            {
                $group: {
                    _id: '$channelId',
                    taskCount: { $sum: 1 },
                    withDependencies: {
                        $sum: {
                            $cond: [
                                { $or: [
                                    { $gt: [{ $size: { $ifNull: ['$dependsOn', []] } }, 0] },
                                    { $gt: [{ $size: { $ifNull: ['$blockedBy', []] } }, 0] }
                                ]},
                                1,
                                0
                            ]
                        }
                    },
                    pendingCount: { $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] } },
                    completedCount: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } }
                }
            },
            { $match: { taskCount: { $gt: 0 } } },
            { $sort: { taskCount: -1 } }
        ]).toArray();

        // Get channel details
        const channelIds = channelStats.map(s => s._id);
        const channels = await db.collection('channels')
            .find({ channelId: { $in: channelIds } })
            .toArray();

        const channelMap = new Map(channels.map(c => [c.channelId, c]));

        const result = channelStats.map(stat => {
            const channel = channelMap.get(stat._id);
            return {
                channelId: stat._id,
                name: channel?.name || stat._id,
                taskCount: stat.taskCount,
                withDependencies: stat.withDependencies,
                pendingCount: stat.pendingCount,
                completedCount: stat.completedCount,
                hasDag: stat.withDependencies > 0
            };
        });

        res.json({
            success: true,
            channels: result
        });
    } catch (error: any) {
        logger.error('Error fetching DAG channels:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to fetch DAG channels'
        });
    }
});

export default router;
