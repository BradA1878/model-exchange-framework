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
import { Channel } from '../../../shared/models/channel';
import { Agent } from '../../../shared/models/agent';
import { Task } from '../../../shared/models/task';
import { User } from '../../../shared/models/user';
import { Logger } from '../../../shared/utils/Logger';

// Dashboard Statistics Interface
interface DashboardStats {
    totalChannels: number;
    activeAgents: number;
    completedTasks: number;
    totalCredits: number;
}

// Activity Item Interface
interface ActivityItem {
    id: string;
    type: 'task_completed' | 'task_started' | 'channel_created' | 'agent_joined' | 'agent_assigned';
    title: string;
    agent: string;
    channelId?: string;
    taskId?: string;
    timestamp: string;
    icon: string;
    color: 'success' | 'info' | 'primary' | 'warning' | 'error';
}

// System Overview Interface
interface SystemOverview {
    name: string;
    value: number;
    color: string;
    trend?: 'up' | 'down' | 'stable';
    percentage?: number;
}

// Create logger instance for dashboard controller
const logger = new Logger('error', 'DashboardController', 'server');

export const dashboardController = {
    /**
     * Get dashboard statistics for the authenticated user
     */
    getStats: async (req: Request, res: Response): Promise<void> => {
        try {
            // Get current user from authentication middleware
            const userId = (req as any).user?.id;
            if (!userId) {
                res.status(401).json({ success: false, message: 'User not authenticated' });
                return;
            }

            // Get counts from database filtered by user
            const [totalChannels, totalAgents, completedTasks, userRecord] = await Promise.all([
                Channel.countDocuments({ createdBy: userId }),
                Agent.countDocuments({ createdBy: userId }),
                Task.countDocuments({ createdBy: userId, status: 'completed' }),
                User.findById(userId)
            ]);

            // Get active agents for this user (agents that have been active in the last 24 hours)
            const oneDayAgo = new Date();
            oneDayAgo.setDate(oneDayAgo.getDate() - 1);
            
            const activeAgents = await Agent.countDocuments({
                createdBy: userId,
                lastActiveAt: { $gte: oneDayAgo }
            });

            // Calculate user's total credits (default for now, could be extended in future)
            const totalCredits = 1000; // Default credits for new users

            const stats: DashboardStats = {
                totalChannels,
                activeAgents: activeAgents || totalAgents, // Fallback to total user agents if no lastActiveAt field
                completedTasks,
                totalCredits
            };

            res.status(200).json(stats);
        } catch (error) {
            logger.error('Error fetching dashboard stats:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to fetch dashboard statistics'
            });
        }
    },

    /**
     * Get recent activity feed for the authenticated user
     */
    getActivity: async (req: Request, res: Response): Promise<void> => {
        try {
            // Get current user from authentication middleware
            const userId = (req as any).user?.id;
            if (!userId) {
                res.status(401).json({ success: false, message: 'User not authenticated' });
                return;
            }

            const limit = parseInt(req.query.limit as string) || 10;
            const activities: ActivityItem[] = [];

            // Get recent tasks for this user (completed and started)
            const recentTasks = await Task.find({ createdBy: userId })
                .sort({ createdAt: -1 })
                .limit(limit)
                .populate('assignedAgentIds')
                .populate('channelId');

            // Get recent channels for this user
            const recentChannels = await Channel.find({ createdBy: userId })
                .sort({ createdAt: -1 })
                .limit(5);

            // Get recent agents for this user
            const recentAgents = await Agent.find({ createdBy: userId })
                .sort({ createdAt: -1 })
                .limit(5);

            // Process tasks into activities
            for (const task of recentTasks) {
                const agentName = (task as any).assignedAgentIds?.[0]?.agentId || 'Unknown Agent';
                const channelId = (task as any).channelId?._id?.toString();

                if (task.status === 'completed') {
                    activities.push({
                        id: `task-completed-${(task as any)._id}`,
                        type: 'task_completed',
                        title: `Task completed: ${task.description || 'Untitled Task'}`,
                        agent: agentName,
                        channelId,
                        taskId: (task as any)._id.toString(),
                        timestamp: task.updatedAt?.toISOString() || task.createdAt.toISOString(),
                        icon: 'check-circle',
                        color: 'success'
                    });
                } else if (task.status === 'in_progress') {
                    activities.push({
                        id: `task-started-${(task as any)._id}`,
                        type: 'task_started',
                        title: `Task started: ${task.description || 'Untitled Task'}`,
                        agent: agentName,
                        channelId,
                        taskId: (task as any)._id.toString(),
                        timestamp: task.createdAt.toISOString(),
                        icon: 'play-circle',
                        color: 'info'
                    });
                }
            }

            // Process channels into activities
            for (const channel of recentChannels.slice(0, 3)) {
                activities.push({
                    id: `channel-created-${(channel as any)._id}`,
                    type: 'channel_created',
                    title: `Channel created: ${channel.name}`,
                    agent: 'System',
                    channelId: (channel as any)._id.toString(),
                    timestamp: channel.createdAt.toISOString(),
                    icon: 'plus-circle',
                    color: 'primary'
                });
            }

            // Process agents into activities
            for (const agent of recentAgents.slice(0, 2)) {
                activities.push({
                    id: `agent-joined-${(agent as any)._id}`,
                    type: 'agent_joined',
                    title: `Agent joined: ${agent.agentId}`,
                    agent: agent.agentId,
                    timestamp: agent.createdAt.toISOString(),
                    icon: 'user-plus',
                    color: 'info'
                });
            }

            // Sort by timestamp descending and limit
            activities.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
            const limitedActivities = activities.slice(0, limit);

            res.status(200).json(limitedActivities);
        } catch (error) {
            logger.error('Error fetching dashboard activity:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to fetch dashboard activity'
            });
        }
    },

    /**
     * Get system overview metrics for the authenticated user
     */
    getOverview: async (req: Request, res: Response): Promise<void> => {
        try {
            // Get current user from authentication middleware
            const userId = (req as any).user?.id;
            if (!userId) {
                res.status(401).json({ success: false, message: 'User not authenticated' });
                return;
            }

            // Get various metrics for user's resources
            const [
                totalTasks,
                activeTasks,
                totalChannels,
                activeChannels,
                totalAgents,
                activeAgents
            ] = await Promise.all([
                Task.countDocuments({ createdBy: userId }),
                Task.countDocuments({ createdBy: userId, status: { $in: ['pending', 'in_progress'] } }),
                Channel.countDocuments({ createdBy: userId }),
                Channel.countDocuments({ createdBy: userId, status: 'active' }),
                Agent.countDocuments({ createdBy: userId }),
                Agent.countDocuments({ createdBy: userId, status: 'active' })
            ]);

            // Calculate completion rate
            const completionRate = totalTasks > 0 ? Math.round((totalTasks - activeTasks) / totalTasks * 100) : 0;

            // Calculate channel utilization
            const channelUtilization = totalChannels > 0 ? Math.round(activeChannels / totalChannels * 100) : 0;

            // Calculate agent utilization
            const agentUtilization = totalAgents > 0 ? Math.round(activeAgents / totalAgents * 100) : 0;

            const overview: SystemOverview[] = [
                {
                    name: 'Task Completion Rate',
                    value: completionRate,
                    color: completionRate >= 80 ? '#10b981' : completionRate >= 60 ? '#f59e0b' : '#ef4444',
                    trend: completionRate >= 75 ? 'up' : completionRate >= 50 ? 'stable' : 'down',
                    percentage: completionRate
                },
                {
                    name: 'Channel Utilization',
                    value: channelUtilization,
                    color: channelUtilization >= 70 ? '#10b981' : channelUtilization >= 40 ? '#f59e0b' : '#ef4444',
                    trend: channelUtilization >= 60 ? 'up' : channelUtilization >= 30 ? 'stable' : 'down',
                    percentage: channelUtilization
                },
                {
                    name: 'Agent Activity',
                    value: agentUtilization,
                    color: agentUtilization >= 60 ? '#10b981' : agentUtilization >= 30 ? '#f59e0b' : '#ef4444',
                    trend: agentUtilization >= 50 ? 'up' : agentUtilization >= 25 ? 'stable' : 'down',
                    percentage: agentUtilization
                },
                {
                    name: 'Total Channels',
                    value: totalChannels,
                    color: '#3b82f6',
                    trend: 'stable'
                }
            ];

            res.status(200).json(overview);
        } catch (error) {
            logger.error('Error fetching system overview:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to fetch system overview'
            });
        }
    }
};
