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
 * ControlLoopLifecycle.ts
 * 
 * MCP tools for control loop lifecycle management - start, stop, and status operations.
 * Handles the core lifecycle of ORPAR control loops within the MXF framework.
 */

import { Events } from '../../../events/EventNames';
import { EventBus } from '../../../events/EventBus';
import { createControlLoopEventPayload, ControlLoopSpecificData } from '../../../schemas/EventPayloadSchema';
import { AgentId, ChannelId } from '../../../types/ChannelContext';
import { Logger } from '../../../utils/Logger';
import { CONTROL_LOOP_TOOLS } from '../../../constants/ToolNames';
import { McpToolHandlerContext, McpToolHandlerResult, McpToolResultContent } from '../McpServerTypes';

const logger = new Logger('info', 'ControlLoopLifecycle', 'server');

/**
 * MCP Tool: controlLoop_start
 * Initialize and start an agent's control loop with configuration
 */
export const controlLoopStartTool = {
    name: CONTROL_LOOP_TOOLS.START,
    description: 'Initialize and start an agent\'s control loop with configuration',
    inputSchema: {
        type: 'object',
        properties: {
            loopId: {
                type: 'string',
                description: 'Unique identifier for the control loop instance'
            },
            config: {
                type: 'object',
                description: 'Configuration parameters for the control loop',
                properties: {
                    maxIterations: { type: 'number', description: 'Maximum number of loop iterations' },
                    timeoutMs: { type: 'number', description: 'Timeout in milliseconds' },
                    observationInterval: { type: 'number', description: 'Observation interval in ms' },
                    autoReflection: { type: 'boolean', description: 'Enable automatic reflection' },
                    phases: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Enabled ORPAR phases'
                    }
                }
            },
            initialObservations: {
                type: 'array',
                description: 'Initial observations to start the loop with',
                items: { type: 'object' }
            }
        },
        required: ['loopId']
    },

    handler: async (input: {
        loopId: string;
        config?: {
            maxIterations?: number;
            timeoutMs?: number;
            observationInterval?: number;
            autoReflection?: boolean;
            phases?: string[];
        };
        initialObservations?: any[];
    }, context: McpToolHandlerContext): Promise<McpToolHandlerResult> => {
        try {
            const controlLoopData: ControlLoopSpecificData = {
                loopId: input.loopId,
                status: 'initializing',
                config: {
                    maxIterations: input.config?.maxIterations || 10,
                    timeoutMs: input.config?.timeoutMs || 300000, // 5 minutes
                    observationInterval: input.config?.observationInterval || 1000,
                    autoReflection: input.config?.autoReflection ?? true,
                    phases: input.config?.phases || ['observation', 'reasoning', 'action', 'planning', 'reflection'],
                    initialObservations: input.initialObservations || [],
                    startedAt: Date.now(),
                    requestId: context.requestId
                }
            };

            // Emit control loop initialize event using existing infrastructure
            const payload = createControlLoopEventPayload(
                Events.ControlLoop.INITIALIZE,
                context.agentId!,
                context.channelId!,
                controlLoopData
            );

            EventBus.server.emit(Events.ControlLoop.INITIALIZE, payload);


            const content: McpToolResultContent = {
                type: 'application/json',
                data: {
                    loopId: input.loopId,
                    status: 'initializing',
                    startedAt: controlLoopData.config.startedAt,
                    config: controlLoopData.config
                }
            };
            return { content };
        } catch (error) {
            logger.error(`Failed to start control loop: ${error}`);
            const content: McpToolResultContent = {
                type: 'application/json',
                data: {
                    error: `Failed to start control loop: ${error instanceof Error ? error.message : String(error)}`
                }
            };
            return { content };
        }
    }
};

/**
 * MCP Tool: controlLoop_status
 * Get current state and metrics of control loops
 */
export const controlLoopStatusTool = {
    name: CONTROL_LOOP_TOOLS.STATUS,
    description: 'Get current state and metrics of control loops',
    inputSchema: {
        type: 'object',
        properties: {
            loopId: {
                type: 'string',
                description: 'ID of the specific control loop to get status for (optional - if not provided, returns all loops)'
            },
            includeMetrics: {
                type: 'boolean',
                default: true,
                description: 'Whether to include performance metrics'
            },
            includeHistory: {
                type: 'boolean',
                default: false,
                description: 'Whether to include execution history'
            }
        }
    },

    handler: async (input: {
        loopId?: string;
        includeMetrics?: boolean;
        includeHistory?: boolean;
    }, context: McpToolHandlerContext): Promise<McpToolHandlerResult> => {
        try {

            // This would normally query the control loop service/registry
            // For now, return a placeholder implementation
            const mockLoops = [
                {
                    loopId: input.loopId || 'example-loop-1',
                    status: 'running',
                    currentPhase: 'observation',
                    startedAt: Date.now() - 60000, // Started 1 minute ago
                    lastActivity: Date.now() - 5000, // Last activity 5 seconds ago
                    metrics: input.includeMetrics ? {
                        cyclesCompleted: 3,
                        averageCycleTime: 15000,
                        successRate: 0.95,
                        errorsCount: 1
                    } : undefined,
                    history: input.includeHistory ? [
                        { phase: 'observation', startedAt: Date.now() - 50000, completedAt: Date.now() - 45000 },
                        { phase: 'reasoning', startedAt: Date.now() - 45000, completedAt: Date.now() - 40000 },
                        { phase: 'action', startedAt: Date.now() - 40000, completedAt: Date.now() - 35000 }
                    ] : undefined
                }
            ];

            const content: McpToolResultContent = {
                type: 'application/json',
                data: {
                    loops: mockLoops,
                    totalLoops: mockLoops.length
                }
            };
            return { content };
        } catch (error) {
            logger.error(`Failed to get control loop status: ${error}`);
            const content: McpToolResultContent = {
                type: 'application/json',
                data: {
                    error: `Failed to get control loop status: ${error instanceof Error ? error.message : String(error)}`
                }
            };
            return { content };
        }
    }
};

/**
 * MCP Tool: controlLoop_stop
 * Stop a running control loop
 */
export const controlLoopStopTool = {
    name: CONTROL_LOOP_TOOLS.STOP,
    description: 'Stop a running control loop',
    inputSchema: {
        type: 'object',
        properties: {
            loopId: {
                type: 'string',
                description: 'ID of the control loop to stop'
            },
            reason: {
                type: 'string',
                description: 'Reason for stopping the control loop',
                default: 'Stopped by agent'
            },
            graceful: {
                type: 'boolean',
                description: 'Whether to stop gracefully or immediately',
                default: true
            }
        },
        required: ['loopId']
    },

    handler: async (input: {
        loopId: string;
        reason?: string;
        graceful?: boolean;
    }, context: McpToolHandlerContext): Promise<McpToolHandlerResult> => {
        try {
            const controlLoopData: ControlLoopSpecificData = {
                loopId: input.loopId,
                status: 'stopping',
                context: { 
                    reason: input.reason || 'Stopped by agent',
                    graceful: input.graceful ?? true,
                    stoppedAt: Date.now(),
                    requestId: context.requestId
                }
            };

            // Emit control loop stopped event using existing infrastructure
            const payload = createControlLoopEventPayload(
                Events.ControlLoop.STOPPED,
                context.agentId!,
                context.channelId!,
                controlLoopData
            );

            EventBus.server.emit(Events.ControlLoop.STOPPED, payload);


            const content: McpToolResultContent = {
                type: 'application/json',
                data: {
                    loopId: input.loopId,
                    status: 'stopped',
                    stoppedAt: Date.now(),
                    reason: input.reason || 'Stopped by agent',
                    graceful: input.graceful ?? true
                }
            };
            return { content };
        } catch (error) {
            logger.error(`Failed to stop control loop: ${error}`);
            const content: McpToolResultContent = {
                type: 'application/json',
                data: {
                    error: `Failed to stop control loop: ${error instanceof Error ? error.message : String(error)}`
                }
            };
            return { content };
        }
    }
};

/**
 * Export lifecycle control loop tools
 */
export const controlLoopLifecycleTools = [
    controlLoopStartTool,
    controlLoopStatusTool,
    controlLoopStopTool
];
