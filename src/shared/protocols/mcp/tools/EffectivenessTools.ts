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
 * MCP Tools for Task Effectiveness Tracking
 * 
 * Enables agents to track and measure their own effectiveness
 */

import { McpToolDefinition, McpToolHandlerResult } from '../McpServerTypes';
import { TaskEffectivenessService } from '../../../services/TaskEffectivenessService';
import { AgentId } from '../../../types/Agent';
import { ChannelId } from '../../../types/ChannelContext';
import { 
    TaskDefinition,
    TaskExecutionEvent,
    EffectivenessComparison,
    EffectivenessAnalytics
} from '../../../types/EffectivenessTypes';
import { v4 as uuidv4 } from 'uuid';

// Helper to create tool result
function createToolResult(success: boolean, data: any): McpToolHandlerResult {
    return {
        content: {
            type: 'application/json',
            data: { success, ...data }
        }
    };
}

/**
 * Start tracking effectiveness for a task
 */
export const task_effectiveness_start: McpToolDefinition = {
    name: 'task_effectiveness_start',
    description: 'Start tracking effectiveness metrics for a new task',
    inputSchema: {
        type: 'object',
        properties: {
            taskType: {
                type: 'string',
                description: 'Type of task (e.g., "research", "analysis", "development", "creative", etc.)'
            },
            description: {
                type: 'string',
                description: 'Human-readable description of what this task aims to accomplish'
            },
            successCriteria: {
                type: 'object',
                description: 'Optional success criteria for the task',
                properties: {
                    required: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Required outcomes for success'
                    },
                    optional: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Optional/bonus outcomes'
                    }
                }
            },
            baselineMetrics: {
                type: 'object',
                description: 'Optional baseline metrics for comparison (e.g., how long it takes a human)',
                properties: {
                    completionTime: {
                        type: 'number',
                        description: 'Baseline completion time in milliseconds'
                    },
                    humanInterventions: {
                        type: 'number',
                        description: 'Expected human interventions in baseline'
                    }
                }
            }
        },
        required: ['taskType', 'description']
    },
    enabled: true,
    handler: async ({ taskType, description, successCriteria, baselineMetrics }: any, { agentId, channelId }: any) => {
        const effectivenessService = TaskEffectivenessService.getInstance();
        try {
            const definition: TaskDefinition = {
                taskId: uuidv4(),
                channelId: channelId as ChannelId,
                taskType,
                description,
                successCriteria,
                baseline: baselineMetrics ? {
                    type: 'human' as const,
                    metrics: {
                        performance: {
                            completionTime: baselineMetrics.completionTime,
                            humanInterventions: baselineMetrics.humanInterventions,
                            autonomyScore: 0, // Human baseline has 0 autonomy
                            stepCount: 0,
                            toolsUsed: 0,
                            uniqueTools: [],
                            agentInteractions: 0
                        }
                    }
                } : undefined
            };
            
            const taskId = effectivenessService.startTask(definition);
            
            return createToolResult(true, {
                taskId,
                message: `Started tracking effectiveness for ${taskType} task`,
                trackingStarted: Date.now()
            });
        } catch (error) {
            return createToolResult(false, {
                error: `Failed to start effectiveness tracking: ${error}`
            });
        }
    }
};

/**
 * Record a significant event in task execution
 */
export const task_effectiveness_event: McpToolDefinition = {
    name: 'task_effectiveness_event',
    description: 'Record a significant event during task execution (tool use, milestone, error, etc.)',
    inputSchema: {
        type: 'object',
        properties: {
            taskId: {
                type: 'string',
                description: 'The task ID returned from task_effectiveness_start'
            },
            eventType: {
                type: 'string',
                enum: ['step', 'tool_use', 'milestone', 'error', 'human_input', 'agent_join'],
                description: 'Type of event to record'
            },
            details: {
                type: 'object',
                description: 'Event-specific details (e.g., tool name, error message, milestone name)'
            }
        },
        required: ['taskId', 'eventType']
    },
    enabled: true,
    handler: async ({ taskId, eventType, details = {} }: any, { agentId }: any) => {
        const effectivenessService = TaskEffectivenessService.getInstance();
        try {
            const event: TaskExecutionEvent = {
                eventId: uuidv4(),
                taskId,
                timestamp: Date.now(),
                type: eventType as any,
                agentId: agentId as AgentId,
                details
            };
            
            effectivenessService.recordEvent(event);
            
            return createToolResult(true, {
                message: `Recorded ${eventType} event for task`,
                eventId: event.eventId
            });
        } catch (error) {
            return createToolResult(false, {
                error: `Failed to record event: ${error}`
            });
        }
    }
};

/**
 * Update quality metrics for a task
 */
export const task_effectiveness_quality: McpToolDefinition = {
    name: 'task_effectiveness_quality',
    description: 'Update quality metrics for the current task (completeness, iterations, custom metrics)',
    inputSchema: {
        type: 'object',
        properties: {
            taskId: {
                type: 'string',
                description: 'The task ID to update'
            },
            completenessScore: {
                type: 'number',
                minimum: 0,
                maximum: 1,
                description: 'How complete is the task so far (0-1)?'
            },
            iterationCount: {
                type: 'number',
                description: 'Number of iterations/revisions made'
            },
            customMetrics: {
                type: 'object',
                description: 'Custom quality metrics specific to this task type',
                additionalProperties: { type: 'number' }
            }
        },
        required: ['taskId']
    },
    enabled: true,
    handler: async ({ taskId, completenessScore, iterationCount, customMetrics }: any, { agentId }: any) => {
        const effectivenessService = TaskEffectivenessService.getInstance();
        try {
            const updates: any = {};
            if (completenessScore !== undefined) updates.completenessScore = completenessScore;
            if (iterationCount !== undefined) updates.iterationCount = iterationCount;
            if (customMetrics) updates.customMetrics = customMetrics;
            
            effectivenessService.updateQuality(taskId, updates, agentId as AgentId);
            
            return createToolResult(true, {
                message: 'Updated quality metrics',
                updates
            });
        } catch (error) {
            return createToolResult(false, {
                error: `Failed to update quality metrics: ${error}`
            });
        }
    }
};

/**
 * Complete a task and get effectiveness summary
 */
export const task_effectiveness_complete: McpToolDefinition = {
    name: 'task_effectiveness_complete',
    description: 'Complete task tracking and get effectiveness summary with comparisons',
    inputSchema: {
        type: 'object',
        properties: {
            taskId: {
                type: 'string',
                description: 'The task ID to complete'
            },
            success: {
                type: 'boolean',
                description: 'Was the primary goal achieved?'
            },
            customMetrics: {
                type: 'object',
                description: 'Final custom metrics for this task',
                additionalProperties: { type: 'number' }
            }
        },
        required: ['taskId', 'success']
    },
    enabled: true,
    handler: async ({ taskId, success, customMetrics }: any) => {
        const effectivenessService = TaskEffectivenessService.getInstance();
        try {
            const metrics = await effectivenessService.completeTask(taskId, success, customMetrics);
            if (!metrics) {
                return createToolResult(false, {
                    error: 'Task not found or already completed'
                });
            }
            
            const comparison = effectivenessService.compareWithBaseline(taskId);
            
            return createToolResult(true, {
                message: 'Task completed and effectiveness measured',
                metrics: {
                    completionTime: metrics.performance.completionTime,
                    autonomyScore: metrics.performance.autonomyScore,
                    toolsUsed: metrics.performance.toolsUsed,
                    errorCount: metrics.quality.errorCount,
                    overallScore: comparison?.summary.overallScore || 0
                },
                comparison: comparison ? {
                    speedImprovement: `${comparison.improvements.speedImprovement.toFixed(1)}%`,
                    achievements: comparison.summary.achievements,
                    recommendations: comparison.summary.recommendations
                } : undefined
            });
        } catch (error) {
            return createToolResult(false, {
                error: `Failed to complete task: ${error}`
            });
        }
    }
};

/**
 * Get effectiveness analytics for a time period
 */
export const task_effectiveness_analytics: McpToolDefinition = {
    name: 'task_effectiveness_analytics',
    description: 'Get effectiveness analytics for completed tasks in a time period',
    inputSchema: {
        type: 'object',
        properties: {
            timeRange: {
                type: 'string',
                enum: ['hour', 'day', 'week', 'month'],
                description: 'Time range to analyze'
            },
            taskType: {
                type: 'string',
                description: 'Optional: Filter by specific task type'
            }
        },
        required: ['timeRange']
    },
    enabled: true,
    handler: async ({ timeRange, taskType }: any, { channelId }: any) => {
        const effectivenessService = TaskEffectivenessService.getInstance();
        try {
            const now = Date.now();
            const ranges = {
                hour: 60 * 60 * 1000,
                day: 24 * 60 * 60 * 1000,
                week: 7 * 24 * 60 * 60 * 1000,
                month: 30 * 24 * 60 * 60 * 1000
            };
            
            const startTime = now - ranges[timeRange as keyof typeof ranges];
            const analytics = await effectivenessService.getEnhancedAnalytics(
                startTime, 
                now, 
                channelId as ChannelId,
                taskType
            );
            
            // Filter by task type if specified
            let relevantStats = analytics.byTaskType;
            if (taskType) {
                relevantStats = { [taskType]: analytics.byTaskType[taskType] };
            }
            
            return createToolResult(true, {
                timeRange,
                analytics: {
                    taskTypes: Object.entries(relevantStats).map(([type, stats]) => ({
                        type,
                        count: stats.count,
                        avgCompletionTime: `${(stats.avgCompletionTime / 1000).toFixed(1)}s`,
                        successRate: `${(stats.successRate * 100).toFixed(1)}%`,
                        avgAutonomy: `${(stats.avgAutonomyScore * 100).toFixed(1)}%`
                    })),
                    patterns: {
                        highPerformance: analytics.patterns.highPerformanceTasks,
                        needsImprovement: analytics.patterns.lowPerformanceTasks
                    }
                }
            });
        } catch (error) {
            return createToolResult(false, {
                error: `Failed to get analytics: ${error}`
            });
        }
    }
};

/**
 * Compare current task with previous similar tasks
 */
export const task_effectiveness_compare: McpToolDefinition = {
    name: 'task_effectiveness_compare',
    description: 'Compare current task performance with previous similar tasks',
    inputSchema: {
        type: 'object',
        properties: {
            taskId: {
                type: 'string',
                description: 'Current task ID to compare'
            }
        },
        required: ['taskId']
    },
    enabled: true,
    handler: async ({ taskId }: any) => {
        const effectivenessService = TaskEffectivenessService.getInstance();
        try {
            const comparison = effectivenessService.compareWithBaseline(taskId);
            if (!comparison) {
                return createToolResult(false, {
                    error: 'Task not found or no comparison available'
                });
            }
            
            return createToolResult(true, {
                comparison: {
                    currentScore: comparison.summary.overallScore,
                    improvements: {
                        speed: `${comparison.improvements.speedImprovement.toFixed(1)}%`,
                        autonomy: `${comparison.improvements.autonomyImprovement.toFixed(1)}%`,
                        quality: `${comparison.improvements.qualityImprovement.toFixed(1)}%`
                    },
                    achievements: comparison.summary.achievements,
                    areasToImprove: comparison.summary.improvements,
                    recommendations: comparison.summary.recommendations
                }
            });
        } catch (error) {
            return createToolResult(false, {
                error: `Failed to compare task: ${error}`
            });
        }
    }
};

// Export all effectiveness tools
export const effectivenessTools: McpToolDefinition[] = [
    task_effectiveness_start,
    task_effectiveness_event,
    task_effectiveness_quality,
    task_effectiveness_complete,
    task_effectiveness_analytics,
    task_effectiveness_compare
];