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
 * Task Effectiveness API Controller
 * 
 * REST endpoints for accessing task effectiveness metrics and analytics
 */

import { Request, Response } from 'express';
import { TaskEffectivenessService } from '../../../shared/services/TaskEffectivenessService';
import { Logger } from '../../../shared/utils/Logger';
import { AgentId } from '../../../shared/types/Agent';
import { ChannelId } from '../../../shared/types/ChannelContext';

const logger = new Logger('info', 'TaskEffectivenessController', 'server');
// Lazy-load effectivenessService inside each handler to avoid module-level instantiation

/**
 * Get task effectiveness metrics
 * GET /api/effectiveness/task/:taskId
 */
export const getTaskEffectiveness = async (req: Request, res: Response): Promise<void> => {
    const effectivenessService = TaskEffectivenessService.getInstance();
    try {
        const { taskId } = req.params;

        if (!taskId) {
            res.status(400).json({
                success: false,
                error: 'Task ID is required'
            });
            return;
        }

        const metrics = await effectivenessService.getTaskMetrics(taskId);
        if (!metrics) {
            res.status(404).json({
                success: false,
                error: 'Task not found'
            });
            return;
        }
        
        const comparison = effectivenessService.compareWithBaseline(taskId);
        
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
        const analytics = await effectivenessService.getEnhancedAnalytics(
            startTime,
            now,
            channelId as ChannelId
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
        const agentAnalytics = await effectivenessService.getAgentEffectiveness(
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
    const effectivenessService = TaskEffectivenessService.getInstance();
    try {
        const { taskId } = req.params;
        
        if (!taskId) {
            res.status(400).json({
                success: false,
                error: 'Task ID is required'
            });
            return;
        }
        
        const comparison = effectivenessService.compareWithBaseline(taskId);
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
        
        const trends = await effectivenessService.getEffectivenessTrends(
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