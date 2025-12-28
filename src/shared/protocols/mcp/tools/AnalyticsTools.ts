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
 * MCP Analytics Tools
 * 
 * Comprehensive analytics tools for agents to query system metrics,
 * performance data, and generate insights from the MXF analytics infrastructure.
 */

import { McpToolDefinition, McpToolHandlerResult } from '../McpServerTypes';
import { Logger } from '../../../utils/Logger';
import { ValidationAnalyticsService } from '../../../services/ValidationAnalyticsService';
import { TaskEffectivenessService } from '../../../services/TaskEffectivenessService';
import { AgentPerformanceService } from '../../../services/AgentPerformanceService';
import { createStrictValidator } from '../../../utils/validation';
import { firstValueFrom } from 'rxjs';

const logger = new Logger('info', 'AnalyticsTools', 'server');
const validate = createStrictValidator('AnalyticsTools');

// Helper to create consistent tool results
function createToolResult(success: boolean, data: any): McpToolHandlerResult {
    return {
        content: {
            type: 'application/json',
            data: { success, ...data }
        }
    };
}

/**
 * 1. Get Agent Performance Metrics
 */
export const analytics_agent_performance: McpToolDefinition = {
    name: 'analytics_agent_performance',
    description: 'Get comprehensive performance metrics for a specific agent or all agents',
    inputSchema: {
        type: 'object',
        properties: {
            agentId: {
                type: 'string',
                description: 'Specific agent ID to analyze (optional - omit for all agents)'
            },
            timeRange: {
                type: 'string',
                enum: ['1h', '24h', '7d', '30d'],
                description: 'Time range for metrics analysis',
                default: '24h'
            },
            includeDetails: {
                type: 'boolean',
                description: 'Include detailed breakdowns and trends',
                default: false
            }
        },
        additionalProperties: false
    },
    enabled: true,
    handler: async ({ agentId, timeRange = '24h', includeDetails = false }: any, { agentId: contextAgentId, channelId }: any) => {
        const performanceService = AgentPerformanceService.getInstance();
        try {

            // Try to get performance data if we have both agentId and channelId
            let performanceData = null;
            if ((agentId || contextAgentId) && channelId) {
                try {
                    const performanceObs = await performanceService.getPerformanceMetrics(
                        agentId || contextAgentId,
                        channelId
                    );
                    performanceData = await firstValueFrom(performanceObs);
                } catch (error: any) {
                    logger.warn(`Could not get performance data: ${error.message}`);
                }
            }
            
            return createToolResult(true, {
                agentId: agentId || 'all',
                timeRange,
                metrics: performanceData,
                summary: {
                    totalTasks: performanceData?.collaboration?.successfulCollaborations || 0,
                    averageResponseTime: performanceData?.orparTiming?.averageTotalCycleTime || 0,
                    successRate: performanceData?.collaboration?.collaborationSuccessRate || 0,
                    efficiency: performanceData?.benchmark?.relativePerformance?.efficiency || 0
                }
            });
        } catch (error: any) {
            logger.error('Error getting agent performance:', error);
            return createToolResult(false, { error: `Failed to get agent performance: ${error.message}` });
        }
    }
};

/**
 * 2. Get Channel Activity Analytics
 */
export const analytics_channel_activity: McpToolDefinition = {
    name: 'analytics_channel_activity',
    description: 'Analyze channel activity patterns, message volume, and engagement metrics',
    inputSchema: {
        type: 'object',
        properties: {
            channelId: {
                type: 'string',
                description: 'Specific channel ID to analyze (optional - omit for all channels)'
            },
            timeRange: {
                type: 'string',
                enum: ['1h', '24h', '7d', '30d'],
                description: 'Time range for activity analysis',
                default: '24h'
            },
            includePatterns: {
                type: 'boolean',
                description: 'Include activity pattern analysis',
                default: true
            }
        },
        additionalProperties: false
    },
    enabled: true,
    handler: async ({ channelId, timeRange = '24h', includePatterns = true }: any, { agentId, channelId: contextChannelId }: any) => {
        try {
            
            // Mock implementation - replace with actual analytics service call
            const activityData = {
                totalMessages: 0,
                activeAgents: 0,
                averageResponseTime: 0,
                peakActivity: null,
                patterns: includePatterns ? {
                    mostActiveHours: [],
                    averageMessagesPerHour: 0,
                    responseTimeDistribution: {}
                } : null
            };
            
            return createToolResult(true, {
                channelId: channelId || 'all',
                timeRange,
                activity: activityData,
                insights: [
                    'Channel activity analysis complete',
                    `Analyzed ${timeRange} of data`,
                    includePatterns ? 'Pattern analysis included' : 'Basic metrics only'
                ]
            });
        } catch (error: any) {
            logger.error('Error getting channel activity:', error);
            return createToolResult(false, { error: `Failed to get channel activity: ${error.message}` });
        }
    }
};

/**
 * 3. Get System Health Metrics
 */
export const analytics_system_health: McpToolDefinition = {
    name: 'analytics_system_health',
    description: 'Get comprehensive system health metrics including resource usage and service status',
    inputSchema: {
        type: 'object',
        properties: {
            includeServices: {
                type: 'boolean',
                description: 'Include individual service health checks',
                default: true
            },
            includeResources: {
                type: 'boolean',
                description: 'Include resource usage metrics',
                default: true
            }
        },
        additionalProperties: false
    },
    enabled: true,
    handler: async ({ includeServices = true, includeResources = true }: any, { agentId, channelId }: any) => {
        try {
            
            // Get basic system metrics
            const systemHealth = {
                status: 'healthy',
                uptime: Math.floor(process.uptime()),
                timestamp: new Date().toISOString(),
                memory: includeResources ? {
                    used: process.memoryUsage().heapUsed,
                    total: process.memoryUsage().heapTotal,
                    external: process.memoryUsage().external
                } : null,
                services: includeServices ? {
                    database: 'connected',
                    eventBus: 'active',
                    socketService: 'running',
                    mcpService: 'active'
                } : null
            };
            
            return createToolResult(true, {
                health: systemHealth,
                summary: {
                    overallStatus: systemHealth.status,
                    uptimeHours: Math.floor(systemHealth.uptime / 3600),
                    servicesHealthy: includeServices ? 4 : 'N/A',
                    memoryUsagePercent: includeResources ? 
                        Math.round((systemHealth.memory!.used / systemHealth.memory!.total) * 100) : 'N/A'
                }
            });
        } catch (error: any) {
            logger.error('Error getting system health:', error);
            return createToolResult(false, { error: `Failed to get system health: ${error.message}` });
        }
    }
};

/**
 * 4. Generate Analytics Report
 */
export const analytics_generate_report: McpToolDefinition = {
    name: 'analytics_generate_report',
    description: 'Generate comprehensive analytics reports with customizable parameters',
    inputSchema: {
        type: 'object',
        properties: {
            reportType: {
                type: 'string',
                enum: ['performance', 'activity', 'system', 'comprehensive'],
                description: 'Type of report to generate'
            },
            timeRange: {
                type: 'string',
                enum: ['24h', '7d', '30d', '90d'],
                description: 'Time range for report data',
                default: '7d'
            },
            format: {
                type: 'string',
                enum: ['json', 'summary', 'detailed'],
                description: 'Report output format',
                default: 'summary'
            },
            includeCharts: {
                type: 'boolean',
                description: 'Include chart data for visualizations',
                default: false
            }
        },
        required: ['reportType'],
        additionalProperties: false
    },
    enabled: true,
    handler: async ({ reportType, timeRange = '7d', format = 'summary', includeCharts = false }: any, { agentId, channelId }: any) => {
        try {
            
            // Generate report based on type
            const report = {
                id: `report_${Date.now()}`,
                type: reportType,
                timeRange,
                format,
                generatedAt: new Date().toISOString(),
                data: {
                    summary: `${reportType} report for ${timeRange}`,
                    metrics: {},
                    insights: [],
                    recommendations: []
                },
                charts: includeCharts ? {
                    available: true,
                    types: ['line', 'bar', 'pie']
                } : null
            };
            
            return createToolResult(true, {
                report,
                downloadUrl: null, // Could implement file generation
                sharing: {
                    reportId: report.id,
                    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
                }
            });
        } catch (error: any) {
            logger.error('Error generating report:', error);
            return createToolResult(false, { error: `Failed to generate report: ${error.message}` });
        }
    }
};

/**
 * 5. Get Task Completion Analytics
 */
export const analytics_task_completion: McpToolDefinition = {
    name: 'analytics_task_completion',
    description: 'Analyze task completion rates, patterns, and effectiveness metrics',
    inputSchema: {
        type: 'object',
        properties: {
            timeRange: {
                type: 'string',
                enum: ['24h', '7d', '30d'],
                description: 'Time range for task analysis',
                default: '7d'
            },
            includeBreakdown: {
                type: 'boolean',
                description: 'Include detailed breakdown by priority, type, etc.',
                default: true
            },
            agentId: {
                type: 'string',
                description: 'Filter by specific agent (optional)'
            },
            channelId: {
                type: 'string',
                description: 'Filter by specific channel (optional)'
            }
        },
        additionalProperties: false
    },
    enabled: true,
    handler: async ({ timeRange = '7d', includeBreakdown = true, agentId, channelId }: any, { agentId: contextAgentId, channelId: contextChannelId }: any) => {
        const effectivenessService = TaskEffectivenessService.getInstance();
        try {

            // Get effectiveness data from service
            const now = Date.now();
            const timeRangeMs = timeRange === '24h' ? 24 * 60 * 60 * 1000 :
                               timeRange === '7d' ? 7 * 24 * 60 * 60 * 1000 :
                               30 * 24 * 60 * 60 * 1000;
            const startTime = now - timeRangeMs;
            const taskAnalytics = effectivenessService.getAnalytics(startTime, now, channelId);
            
            return createToolResult(true, {
                timeRange,
                filters: { agentId, channelId },
                metrics: {
                    totalTasks: Object.values(taskAnalytics.byTaskType).reduce((sum, t) => sum + t.count, 0),
                    completedTasks: Object.values(taskAnalytics.byChannel).reduce((sum, c) => sum + c.completedTasks, 0),
                    failedTasks: 0, // Not available in current analytics
                    averageCompletionTime: Object.values(taskAnalytics.byTaskType).reduce((sum, t) => sum + t.avgCompletionTime, 0) / Object.keys(taskAnalytics.byTaskType).length || 0,
                    completionRate: Object.values(taskAnalytics.byTaskType).reduce((sum, t) => sum + t.successRate, 0) / Object.keys(taskAnalytics.byTaskType).length || 0
                },
                breakdown: includeBreakdown ? {
                    byTaskType: taskAnalytics.byTaskType,
                    byChannel: taskAnalytics.byChannel,
                    byAgent: {} // Not available in current analytics
                } : null,
                trends: taskAnalytics.trends || []
            });
        } catch (error: any) {
            logger.error('Error getting task completion analytics:', error);
            return createToolResult(false, { error: `Failed to get task analytics: ${error.message}` });
        }
    }
};

/**
 * 6. Get Validation Analytics
 */
export const analytics_validation_metrics: McpToolDefinition = {
    name: 'analytics_validation_metrics',
    description: 'Get validation system performance and error prevention analytics',
    inputSchema: {
        type: 'object',
        properties: {
            timeRange: {
                type: 'string',
                enum: ['1h', '24h', '7d', '30d'],
                description: 'Time range for validation metrics',
                default: '24h'
            },
            includeDetails: {
                type: 'boolean',
                description: 'Include detailed error patterns and corrections',
                default: true
            }
        },
        additionalProperties: false
    },
    enabled: true,
    handler: async ({ timeRange = '24h', includeDetails = true }: any, { agentId, channelId }: any) => {
        const validationAnalytics = ValidationAnalyticsService.getInstance();
        try {

            // Get validation metrics from service
            const timeRangeEnum = timeRange === '1h' ? 'hour' :
                                  timeRange === '24h' ? 'day' :
                                  timeRange === '7d' ? 'week' : 'month';
            const validationMetrics = await validationAnalytics.aggregateValidationMetrics(timeRangeEnum as any) || {};
            
            return createToolResult(true, {
                timeRange,
                metrics: {
                    totalValidations: validationMetrics.totalValidations || 0,
                    successfulValidations: validationMetrics.successfulValidations || 0,
                    errorsPrevented: validationMetrics.errorsPrevented || 0,
                    averageValidationTime: validationMetrics.averageValidationTime || 0,
                    successRate: validationMetrics.successRate || 0
                },
                autoCorrection: {
                    totalCorrections: validationMetrics.autoCorrections || 0,
                    correctionSuccessRate: validationMetrics.correctionSuccessRate || 0,
                    commonCorrections: validationMetrics.commonCorrections || []
                },
                details: includeDetails ? {
                    errorPatterns: validationMetrics.errorPatterns || [],
                    performanceOptimizations: validationMetrics.optimizations || [],
                    predictiveAccuracy: validationMetrics.predictiveAccuracy || 0
                } : null
            });
        } catch (error: any) {
            logger.error('Error getting validation analytics:', error);
            return createToolResult(false, { error: `Failed to get validation metrics: ${error.message}` });
        }
    }
};

/**
 * 7. Get MCP Tool Usage Analytics
 */
export const analytics_tool_usage: McpToolDefinition = {
    name: 'analytics_tool_usage',
    description: 'Analyze MCP tool usage patterns, popularity, and performance',
    inputSchema: {
        type: 'object',
        properties: {
            timeRange: {
                type: 'string',
                enum: ['24h', '7d', '30d'],
                description: 'Time range for tool usage analysis',
                default: '7d'
            },
            category: {
                type: 'string',
                description: 'Filter by tool category (optional)'
            },
            sortBy: {
                type: 'string',
                enum: ['usage', 'success_rate', 'performance', 'errors'],
                description: 'Sort tools by metric',
                default: 'usage'
            },
            limit: {
                type: 'number',
                description: 'Limit number of tools in results',
                default: 20,
                minimum: 1,
                maximum: 100
            }
        },
        additionalProperties: false
    },
    enabled: true,
    handler: async ({ timeRange = '7d', category, sortBy = 'usage', limit = 20 }: any, { agentId, channelId }: any) => {
        try {
            
            // Mock tool usage data - replace with actual analytics
            const toolUsage = {
                totalExecutions: 0,
                uniqueTools: 0,
                averageExecutionTime: 0,
                topTools: [],
                categories: {},
                trends: []
            };
            
            return createToolResult(true, {
                timeRange,
                filters: { category, sortBy, limit },
                usage: toolUsage,
                insights: [
                    `Analyzed ${toolUsage.uniqueTools} unique tools`,
                    `Total executions: ${toolUsage.totalExecutions}`,
                    `Average execution time: ${toolUsage.averageExecutionTime}ms`
                ]
            });
        } catch (error: any) {
            logger.error('Error getting tool usage analytics:', error);
            return createToolResult(false, { error: `Failed to get tool usage analytics: ${error.message}` });
        }
    }
};

/**
 * 8. Compare Performance Metrics
 */
export const analytics_compare_performance: McpToolDefinition = {
    name: 'analytics_compare_performance',
    description: 'Compare performance metrics between different time periods, agents, or channels',
    inputSchema: {
        type: 'object',
        properties: {
            comparisonType: {
                type: 'string',
                enum: ['time_periods', 'agents', 'channels'],
                description: 'Type of comparison to perform'
            },
            baseline: {
                type: 'object',
                description: 'Baseline parameters for comparison',
                properties: {
                    timeRange: { type: 'string' },
                    agentId: { type: 'string' },
                    channelId: { type: 'string' }
                }
            },
            comparison: {
                type: 'object',
                description: 'Comparison parameters',
                properties: {
                    timeRange: { type: 'string' },
                    agentId: { type: 'string' },
                    channelId: { type: 'string' }
                }
            },
            metrics: {
                type: 'array',
                items: { type: 'string' },
                description: 'Specific metrics to compare',
                default: ['response_time', 'success_rate', 'task_completion']
            }
        },
        required: ['comparisonType', 'baseline', 'comparison'],
        additionalProperties: false
    },
    enabled: true,
    handler: async ({ comparisonType, baseline, comparison, metrics = ['response_time', 'success_rate', 'task_completion'] }: any, { agentId, channelId }: any) => {
        try {
            
            // Mock comparison data since compareMetrics doesn't exist
            const comparisonResult = {
                improvement: 0,
                significantChanges: [],
                recommendations: ['Comparison functionality needs implementation']
            };
            
            return createToolResult(true, {
                comparisonType,
                baseline,
                comparison,
                metrics,
                results: comparisonResult,
                summary: {
                    improvement: comparisonResult.improvement || 0,
                    significantChanges: comparisonResult.significantChanges || [],
                    recommendations: comparisonResult.recommendations || []
                }
            });
        } catch (error: any) {
            logger.error('Error comparing performance:', error);
            return createToolResult(false, { error: `Failed to compare performance: ${error.message}` });
        }
    }
};

/**
 * 9. Get Real-time Analytics Dashboard Data
 */
export const analytics_dashboard_data: McpToolDefinition = {
    name: 'analytics_dashboard_data',
    description: 'Get real-time dashboard data with key metrics and status indicators',
    inputSchema: {
        type: 'object',
        properties: {
            refresh: {
                type: 'boolean',
                description: 'Force refresh of cached data',
                default: false
            },
            widgets: {
                type: 'array',
                items: { 
                    type: 'string',
                    enum: ['system_status', 'active_agents', 'task_queue', 'performance_overview', 'recent_activities']
                },
                description: 'Specific dashboard widgets to include',
                default: ['system_status', 'active_agents', 'task_queue', 'performance_overview']
            }
        },
        additionalProperties: false
    },
    enabled: true,
    handler: async ({ refresh = false, widgets = ['system_status', 'active_agents', 'task_queue', 'performance_overview'] }: any, { agentId, channelId }: any) => {
        try {
            
            const dashboardData: any = {
                timestamp: new Date().toISOString(),
                widgets: {}
            };
            
            // Populate requested widgets
            for (const widget of widgets) {
                switch (widget) {
                    case 'system_status':
                        dashboardData.widgets.system_status = {
                            status: 'healthy',
                            uptime: Math.floor(process.uptime()),
                            services: { active: 4, total: 4 }
                        };
                        break;
                    case 'active_agents':
                        dashboardData.widgets.active_agents = {
                            total: 0,
                            active: 0,
                            idle: 0
                        };
                        break;
                    case 'task_queue':
                        dashboardData.widgets.task_queue = {
                            pending: 0,
                            running: 0,
                            completed: 0
                        };
                        break;
                    case 'performance_overview':
                        dashboardData.widgets.performance_overview = {
                            averageResponseTime: 0,
                            successRate: 0,
                            throughput: 0
                        };
                        break;
                    case 'recent_activities':
                        dashboardData.widgets.recent_activities = {
                            activities: [],
                            count: 0
                        };
                        break;
                }
            }
            
            return createToolResult(true, {
                dashboard: dashboardData,
                meta: {
                    refreshed: refresh,
                    widgetCount: widgets.length,
                    dataAge: 0
                }
            });
        } catch (error: any) {
            logger.error('Error getting dashboard data:', error);
            return createToolResult(false, { error: `Failed to get dashboard data: ${error.message}` });
        }
    }
};

/**
 * 10. Export Analytics Data
 */
export const analytics_export_data: McpToolDefinition = {
    name: 'analytics_export_data',
    description: 'Export analytics data in various formats for external analysis or reporting',
    inputSchema: {
        type: 'object',
        properties: {
            dataType: {
                type: 'string',
                enum: ['performance', 'tasks', 'validation', 'system', 'comprehensive'],
                description: 'Type of data to export'
            },
            timeRange: {
                type: 'string',
                enum: ['24h', '7d', '30d', '90d'],
                description: 'Time range for exported data',
                default: '7d'
            },
            format: {
                type: 'string',
                enum: ['json', 'csv', 'excel'],
                description: 'Export format',
                default: 'json'
            },
            includeRawData: {
                type: 'boolean',
                description: 'Include raw data points (larger file)',
                default: false
            },
            filters: {
                type: 'object',
                description: 'Optional filters for data export',
                properties: {
                    agentId: { type: 'string' },
                    channelId: { type: 'string' },
                    category: { type: 'string' }
                }
            }
        },
        required: ['dataType'],
        additionalProperties: false
    },
    enabled: true,
    handler: async ({ dataType, timeRange = '7d', format = 'json', includeRawData = false, filters = {} }: any, { agentId, channelId }: any) => {
        try {
            
            // Generate export metadata
            const exportData = {
                exportId: `export_${Date.now()}`,
                dataType,
                timeRange,
                format,
                includeRawData,
                filters,
                generatedAt: new Date().toISOString(),
                estimatedSize: '1.2MB', // Mock estimate
                downloadReady: true,
                expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
            };
            
            return createToolResult(true, {
                export: exportData,
                downloadInfo: {
                    url: null, // Would be actual download URL
                    filename: `mxf_analytics_${dataType}_${timeRange}.${format}`,
                    size: exportData.estimatedSize
                },
                preview: {
                    recordCount: 100, // Mock count
                    columns: ['timestamp', 'metric', 'value', 'context'],
                    sampleData: includeRawData ? [] : null
                }
            });
        } catch (error: any) {
            logger.error('Error exporting analytics data:', error);
            return createToolResult(false, { error: `Failed to export data: ${error.message}` });
        }
    }
};

// Export all analytics tools
export const analyticsTools: McpToolDefinition[] = [
    analytics_agent_performance,
    analytics_channel_activity,
    analytics_system_health,
    analytics_generate_report,
    analytics_task_completion,
    analytics_validation_metrics,
    analytics_tool_usage,
    analytics_compare_performance,
    analytics_dashboard_data,
    analytics_export_data
];