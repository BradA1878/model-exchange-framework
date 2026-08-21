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

import {
    McpToolDefinition,
    McpToolHandlerContext,
    McpToolHandlerResult
} from '../McpServerTypes.js';
import { TaskEffectivenessService } from '../../../services/TaskEffectivenessService.js';
import { AgentPerformanceService } from '../../../services/AgentPerformanceService.js';
import { AgentId } from '../../../types/Agent.js';
import { ChannelId } from '../../../types/ChannelContext.js';

interface AnalyticsTenantIdentity {
    agentId: AgentId;
    channelId: ChannelId;
}

function createToolResult(success: boolean, data: Record<string, unknown>): McpToolHandlerResult {
    return {
        content: {
            type: 'application/json',
            data: { success, ...data }
        }
    };
}

function requireTenantIdentity(context: McpToolHandlerContext): AnalyticsTenantIdentity {
    if (!context.agentId?.trim() || !context.channelId?.trim() ||
        context.agentId !== context.agentId.trim() ||
        context.channelId !== context.channelId.trim()) {
        throw new Error('Authenticated agent and channel context are required');
    }

    return {
        agentId: context.agentId as AgentId,
        channelId: context.channelId as ChannelId
    };
}

function rejectCallerSelectedTenant(input: Record<string, unknown>): void {
    if (Object.prototype.hasOwnProperty.call(input, 'agentId') ||
        Object.prototype.hasOwnProperty.call(input, 'channelId')) {
        throw new Error('Agent and channel identity are derived from authenticated tool context');
    }
}

function requireObjectInput(input: unknown): Record<string, unknown> {
    if (input === null || typeof input !== 'object' || Array.isArray(input)) {
        throw new Error('Tool input must be an object');
    }
    return input as Record<string, unknown>;
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function unavailableHandler(reason: string): () => Promise<McpToolHandlerResult> {
    return async () => createToolResult(false, { error: reason });
}

/** Read already-observed performance for the authenticated agent in its channel. */
export const analytics_agent_performance: McpToolDefinition = {
    name: 'analytics_agent_performance',
    description: 'Get tracked performance metrics for the authenticated agent in the current channel',
    inputSchema: {
        type: 'object',
        properties: {
            includeDetails: {
                type: 'boolean',
                description: 'Include the complete tracked metric record',
                default: false
            }
        },
        additionalProperties: false
    },
    enabled: true,
    handler: async (rawInput: unknown, context: McpToolHandlerContext) => {
        try {
            const input = requireObjectInput(rawInput);
            rejectCallerSelectedTenant(input);
            const { agentId, channelId } = requireTenantIdentity(context);
            const metrics = AgentPerformanceService.getInstance()
                .getTrackedPerformanceMetrics(agentId, channelId);

            if (!metrics) {
                return createToolResult(false, {
                    error: 'No tracked performance metrics exist for this agent in this channel'
                });
            }

            return createToolResult(true, {
                agentId,
                channelId,
                metrics: input.includeDetails === true ? metrics : undefined,
                summary: {
                    totalTasks: metrics.collaboration.successfulCollaborations,
                    averageResponseTime: metrics.orparTiming.averageTotalCycleTime,
                    successRate: metrics.collaboration.collaborationSuccessRate,
                    efficiency: metrics.benchmark.relativePerformance.efficiency
                }
            });
        } catch (error: unknown) {
            return createToolResult(false, {
                error: `Failed to get agent performance: ${errorMessage(error)}`
            });
        }
    }
};

/** Read task-effectiveness analytics for the authenticated agent and channel. */
export const analytics_task_completion: McpToolDefinition = {
    name: 'analytics_task_completion',
    description: 'Analyze task completion for the authenticated agent in the current channel',
    inputSchema: {
        type: 'object',
        properties: {
            timeRange: {
                type: 'string',
                enum: ['24h', '7d', '30d'],
                default: '7d'
            },
            includeBreakdown: {
                type: 'boolean',
                default: true
            }
        },
        additionalProperties: false
    },
    enabled: true,
    handler: async (rawInput: unknown, context: McpToolHandlerContext) => {
        try {
            const input = requireObjectInput(rawInput);
            rejectCallerSelectedTenant(input);
            const { agentId, channelId } = requireTenantIdentity(context);
            const timeRange = input.timeRange === '24h' || input.timeRange === '30d'
                ? input.timeRange
                : '7d';
            const timeRangeMs = timeRange === '24h'
                ? 24 * 60 * 60 * 1000
                : timeRange === '7d'
                    ? 7 * 24 * 60 * 60 * 1000
                    : 30 * 24 * 60 * 60 * 1000;
            const endTime = Date.now();
            const analytics = await TaskEffectivenessService.getInstance().getAnalytics(
                endTime - timeRangeMs,
                endTime,
                agentId,
                channelId
            );
            const taskTypeStats = Object.values(analytics.byTaskType);
            const totalTasks = taskTypeStats.reduce((sum, stats) => sum + stats.count, 0);
            const completedTasks = Object.values(analytics.byChannel)
                .reduce((sum, stats) => sum + stats.completedTasks, 0);
            const averageCompletionTime = totalTasks === 0
                ? 0
                : taskTypeStats.reduce(
                    (sum, stats) => sum + (stats.avgCompletionTime * stats.count),
                    0
                ) / totalTasks;

            return createToolResult(true, {
                timeRange,
                tenant: { agentId, channelId },
                metrics: {
                    totalTasks,
                    completedTasks,
                    failedTasks: totalTasks - completedTasks,
                    averageCompletionTime,
                    completionRate: totalTasks === 0 ? 0 : completedTasks / totalTasks
                },
                breakdown: input.includeBreakdown === false ? undefined : {
                    byTaskType: analytics.byTaskType,
                    byChannel: analytics.byChannel
                },
                trends: analytics.trends
            });
        } catch (error: unknown) {
            return createToolResult(false, {
                error: `Failed to get task analytics: ${errorMessage(error)}`
            });
        }
    }
};

const unavailableInputSchema = {
    type: 'object',
    properties: {},
    additionalProperties: false
};

export const analytics_channel_activity: McpToolDefinition = {
    name: 'analytics_channel_activity',
    description: 'Unavailable until channel activity analytics has an authoritative tenant-scoped data source',
    inputSchema: unavailableInputSchema,
    enabled: false,
    handler: unavailableHandler('Channel activity analytics is not implemented')
};

export const analytics_system_health: McpToolDefinition = {
    name: 'analytics_system_health',
    description: 'Server-global health is not available to agent MCP callers',
    inputSchema: unavailableInputSchema,
    enabled: false,
    handler: unavailableHandler('Server-global health is restricted to administrative surfaces')
};

export const analytics_generate_report: McpToolDefinition = {
    name: 'analytics_generate_report',
    description: 'Unavailable until report generation has an authoritative tenant-scoped implementation',
    inputSchema: unavailableInputSchema,
    enabled: false,
    handler: unavailableHandler('Analytics report generation is not implemented')
};

export const analytics_validation_metrics: McpToolDefinition = {
    name: 'analytics_validation_metrics',
    description: 'Server-global validation analytics is not available to agent MCP callers',
    inputSchema: unavailableInputSchema,
    enabled: false,
    handler: unavailableHandler('Server-global validation analytics is restricted to administrative surfaces')
};

export const analytics_tool_usage: McpToolDefinition = {
    name: 'analytics_tool_usage',
    description: 'Unavailable until tool usage analytics has an authoritative tenant-scoped data source',
    inputSchema: unavailableInputSchema,
    enabled: false,
    handler: unavailableHandler('Tool usage analytics is not implemented')
};

export const analytics_compare_performance: McpToolDefinition = {
    name: 'analytics_compare_performance',
    description: 'Unavailable until performance comparison has an authoritative tenant-scoped implementation',
    inputSchema: unavailableInputSchema,
    enabled: false,
    handler: unavailableHandler('Performance comparison is not implemented')
};

export const analytics_dashboard_data: McpToolDefinition = {
    name: 'analytics_dashboard_data',
    description: 'Server-global dashboard data is not available to agent MCP callers',
    inputSchema: unavailableInputSchema,
    enabled: false,
    handler: unavailableHandler('Server-global dashboard data is restricted to administrative surfaces')
};

export const analytics_export_data: McpToolDefinition = {
    name: 'analytics_export_data',
    description: 'Unavailable until analytics export has an authoritative tenant-scoped implementation',
    inputSchema: unavailableInputSchema,
    enabled: false,
    handler: unavailableHandler('Analytics export is not implemented')
};

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
