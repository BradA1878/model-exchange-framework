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
 * Task Effectiveness API Controller
 * 
 * REST endpoints for accessing task effectiveness metrics and analytics
 */

import { Request, Response } from 'express';
import { TaskEffectivenessService } from '@mxf-dev/core/services/TaskEffectivenessService';
import { Logger } from '@mxf-dev/core/utils/Logger';
import { AgentId } from '@mxf-dev/core/types/Agent';
import { ChannelId } from '@mxf-dev/core/types/ChannelContext';
import { UserRole } from '@mxf-dev/core/models/user';
import { authorizationService } from '../services/AuthorizationService';

const logger = new Logger('info', 'TaskEffectivenessController', 'server');
// Lazy-load effectivenessService inside each handler to avoid module-level instantiation

/**
 * Every effectiveness read takes agent and channel ids from the request and
 * reports across tenants, so it is administrator-only. The router mounts this
 * controller behind requireAdmin; the check is repeated here so a different
 * mount or a reused handler cannot serve the data to anyone else.
 *
 * @returns true when the request may proceed; otherwise the response is sent
 */
const requireAdministrator = (req: Request, res: Response): boolean => {
    const principal = authorizationService.readPrincipal(req);
    if (principal.kind === 'unauthenticated') {
        res.status(401).json({ success: false, error: 'Authentication required' });
        return false;
    }
    if (principal.kind !== 'user' || principal.role !== UserRole.ADMIN) {
        res.status(403).json({ success: false, error: 'Admin access required' });
        return false;
    }
    return true;
};

/**
 * Get task effectiveness metrics
 * GET /api/effectiveness/task/:taskId
 */
export const getTaskEffectiveness = async (req: Request, res: Response): Promise<void> => {
    if (!requireAdministrator(req, res)) {
        return;
    }
    const effectivenessService = TaskEffectivenessService.getInstance();
    try {
        const { taskId } = req.params;
        const agentId = typeof req.query.agentId === 'string' ? req.query.agentId : undefined;
        const channelId = typeof req.query.channelId === 'string' ? req.query.channelId : undefined;

        if (!taskId || !agentId || !channelId) {
            res.status(400).json({
                success: false,
                error: 'Task ID, agent ID, and channel ID are required'
            });
            return;
        }

        const metrics = await effectivenessService.getTaskMetrics(taskId, agentId, channelId);
        if (!metrics) {
            res.status(404).json({
                success: false,
                error: 'Task not found'
            });
            return;
        }
        
        const comparison = await effectivenessService.compareWithBaseline(taskId, agentId, channelId);
        
        res.json({
            success: true,
            data: {
                metrics,
                comparison,
                status: metrics.metadata.status,
                completionTime: metrics.performance.completionTime,
                autonomyScore: metrics.performance.autonomyScore,
                overallScore: comparison?.summary.overallScore || 0
            }
        });
    } catch (error) {
        logger.error(`Error getting task effectiveness: ${error}`);
        res.status(500).json({
            success: false,
            error: 'Failed to retrieve task effectiveness'
        });
    }
};

/**
 * Get effectiveness analytics for a channel
 * GET /api/effectiveness/analytics/:channelId
 */
export const getChannelEffectivenessAnalytics = async (req: Request, res: Response): Promise<void> => {
    if (!requireAdministrator(req, res)) {
        return;
    }
    const effectivenessService = TaskEffectivenessService.getInstance();
    try {
        const { channelId } = req.params;
        const { timeRange = 'day', taskType } = req.query;
        
        if (!channelId) {
            res.status(400).json({
                success: false,
                error: 'Channel ID is required'
            });
            return;
        }
        
        const now = Date.now();
        const ranges = {
            hour: 60 * 60 * 1000,
            day: 24 * 60 * 60 * 1000,
            week: 7 * 24 * 60 * 60 * 1000,
            month: 30 * 24 * 60 * 60 * 1000,
            quarter: 90 * 24 * 60 * 60 * 1000
        };
        
        const startTime = now - (ranges[timeRange as keyof typeof ranges] || ranges.day);
        const analytics = await effectivenessService.getAdministrativeChannelAnalytics(
            startTime,
            now,
            channelId as ChannelId,
            typeof taskType === 'string' ? taskType : undefined
        );
        
        // Filter by task type if specified
        let filteredAnalytics = { ...analytics };
        if (taskType && typeof taskType === 'string') {
            filteredAnalytics.byTaskType = {
                [taskType]: analytics.byTaskType[taskType] || {
                    count: 0,
                    avgCompletionTime: 0,
                    successRate: 0,
                    avgAutonomyScore: 0,
                    commonTools: []
                }
            };
        }
        
        res.json({
            success: true,
            data: {
                timeRange,
                channelId,
                analytics: filteredAnalytics,
                summary: {
                    totalTasks: Object.values(analytics.byTaskType).reduce((sum, type) => sum + type.count, 0),
                    averageSuccessRate: calculateAverageSuccessRate(analytics.byTaskType),
                    averageAutonomy: calculateAverageAutonomy(analytics.byTaskType),
                    topPerformingTypes: analytics.patterns.highPerformanceTasks,
                    needsImprovement: analytics.patterns.lowPerformanceTasks
                }
            }
        });
    } catch (error) {
        logger.error(`Error getting channel effectiveness analytics: ${error}`);
        res.status(500).json({
            success: false,
            error: 'Failed to retrieve effectiveness analytics'
        });
    }
};

/**
 * Get agent effectiveness summary
 * GET /api/effectiveness/agent/:agentId
 */
export const getAgentEffectiveness = async (req: Request, res: Response): Promise<void> => {
    if (!requireAdministrator(req, res)) {
        return;
    }
    const effectivenessService = TaskEffectivenessService.getInstance();
    try {
        const { agentId } = req.params;
        const { channelId, timeRange = 'week' } = req.query;
        
        if (!agentId) {
            res.status(400).json({
                success: false,
                error: 'Agent ID is required'
            });
            return;
        }
        
        const now = Date.now();
        const ranges = {
            hour: 60 * 60 * 1000,
            day: 24 * 60 * 60 * 1000,
            week: 7 * 24 * 60 * 60 * 1000,
            month: 30 * 24 * 60 * 60 * 1000
        };
        
        const startTime = now - (ranges[timeRange as keyof typeof ranges] || ranges.week);
        
        // Get agent-specific analytics
        const agentAnalytics = await effectivenessService.getAdministrativeAgentEffectiveness(
            agentId as AgentId,
            startTime,
            now,
            channelId as ChannelId | undefined
        );
        
        res.json({
            success: true,
            data: {
                agentId,
                timeRange,
                channelId,
                effectiveness: agentAnalytics,
                summary: {
                    tasksCompleted: agentAnalytics.totalTasks,
                    averageScore: agentAnalytics.averageScore,
                    successRate: agentAnalytics.successRate,
                    autonomyLevel: agentAnalytics.averageAutonomy,
                    topTaskTypes: agentAnalytics.taskTypeBreakdown.slice(0, 5),
                    recentTrend: agentAnalytics.trend
                }
            }
        });
    } catch (error) {
        logger.error(`Error getting agent effectiveness: ${error}`);
        res.status(500).json({
            success: false,
            error: 'Failed to retrieve agent effectiveness'
        });
    }
};

/**
 * Compare task effectiveness against baseline
 * GET /api/effectiveness/compare/:taskId
 */
export const compareTaskEffectiveness = async (req: Request, res: Response): Promise<void> => {
    if (!requireAdministrator(req, res)) {
        return;
    }
    const effectivenessService = TaskEffectivenessService.getInstance();
    try {
        const { taskId } = req.params;
        const agentId = typeof req.query.agentId === 'string' ? req.query.agentId : undefined;
        const channelId = typeof req.query.channelId === 'string' ? req.query.channelId : undefined;
        
        if (!taskId || !agentId || !channelId) {
            res.status(400).json({
                success: false,
                error: 'Task ID, agent ID, and channel ID are required'
            });
            return;
        }
        
        const comparison = await effectivenessService.compareWithBaseline(taskId, agentId, channelId);
        if (!comparison) {
            res.status(404).json({
                success: false,
                error: 'Task not found or no baseline available'
            });
            return;
        }
        
        res.json({
            success: true,
            data: {
                taskId,
                comparison,
                improvements: {
                    speed: `${comparison.improvements.speedImprovement.toFixed(1)}%`,
                    autonomy: `${comparison.improvements.autonomyImprovement.toFixed(1)}%`,
                    quality: `${comparison.improvements.qualityImprovement.toFixed(1)}%`,
                    resources: `${comparison.improvements.resourceEfficiency.toFixed(1)}%`
                },
                summary: comparison.summary
            }
        });
    } catch (error) {
        logger.error(`Error comparing task effectiveness: ${error}`);
        res.status(500).json({
            success: false,
            error: 'Failed to compare task effectiveness'
        });
    }
};

/**
 * Get effectiveness trends
 * GET /api/effectiveness/trends
 */
export const getEffectivenessTrends = async (req: Request, res: Response): Promise<void> => {
    if (!requireAdministrator(req, res)) {
        return;
    }
    const effectivenessService = TaskEffectivenessService.getInstance();
    try {
        const { channelId, timeRange = 'month', interval = 'day' } = req.query;
        
        const now = Date.now();
        const ranges = {
            week: 7 * 24 * 60 * 60 * 1000,
            month: 30 * 24 * 60 * 60 * 1000,
            quarter: 90 * 24 * 60 * 60 * 1000
        };
        
        const intervals = {
            hour: 60 * 60 * 1000,
            day: 24 * 60 * 60 * 1000,
            week: 7 * 24 * 60 * 60 * 1000
        };
        
        const startTime = now - (ranges[timeRange as keyof typeof ranges] || ranges.month);
        const intervalMs = intervals[interval as keyof typeof intervals] || intervals.day;
        
        const trends = await effectivenessService.getAdministrativeEffectivenessTrends(
            startTime,
            now,
            intervalMs,
            channelId as ChannelId | undefined
        );
        
        res.json({
            success: true,
            data: {
                timeRange,
                interval,
                channelId,
                trends,
                summary: {
                    overallTrend: calculateOverallTrend(trends.dataPoints),
                    peakPerformance: findPeakPerformance(trends.dataPoints),
                    currentPerformance: trends.dataPoints[trends.dataPoints.length - 1] || null
                }
            }
        });
    } catch (error) {
        logger.error(`Error getting effectiveness trends: ${error}`);
        res.status(500).json({
            success: false,
            error: 'Failed to retrieve effectiveness trends'
        });
    }
};

// Helper functions
function calculateAverageSuccessRate(byTaskType: Record<string, any>): number {
    const types = Object.values(byTaskType);
    if (types.length === 0) return 0;
    
    const totalSuccess = types.reduce((sum, type) => sum + type.successRate * type.count, 0);
    const totalCount = types.reduce((sum, type) => sum + type.count, 0);
    
    return totalCount > 0 ? totalSuccess / totalCount : 0;
}

function calculateAverageAutonomy(byTaskType: Record<string, any>): number {
    const types = Object.values(byTaskType);
    if (types.length === 0) return 0;
    
    const totalAutonomy = types.reduce((sum, type) => sum + type.avgAutonomyScore * type.count, 0);
    const totalCount = types.reduce((sum, type) => sum + type.count, 0);
    
    return totalCount > 0 ? totalAutonomy / totalCount : 0;
}

function calculateOverallTrend(dataPoints: any[]): 'improving' | 'stable' | 'declining' {
    if (dataPoints.length < 2) return 'stable';
    
    const firstHalf = dataPoints.slice(0, Math.floor(dataPoints.length / 2));
    const secondHalf = dataPoints.slice(Math.floor(dataPoints.length / 2));
    
    const firstAvg = firstHalf.reduce((sum, p) => sum + p.averageScore, 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((sum, p) => sum + p.averageScore, 0) / secondHalf.length;
    
    const change = (secondAvg - firstAvg) / firstAvg;
    
    if (change > 0.05) return 'improving';
    if (change < -0.05) return 'declining';
    return 'stable';
}

function findPeakPerformance(dataPoints: any[]): any {
    if (dataPoints.length === 0) return null;
    
    return dataPoints.reduce((peak, current) => 
        current.averageScore > (peak?.averageScore || 0) ? current : peak
    , dataPoints[0]);
}
