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
 * ControlLoopPhases.ts
 * 
 * MCP tools for ORPAR control loop phases - Observe, Reason, Plan, Action, Reflect.
 * Implements the cognitive cycle phases of autonomous agent behavior within the MXF framework.
 */

import { Events } from '../../../events/EventNames';
import { EventBus } from '../../../events/EventBus';
import { createControlLoopEventPayload, ControlLoopSpecificData } from '../../../schemas/EventPayloadSchema';
import { AgentId, ChannelId } from '../../../types/ChannelContext';
import { Logger } from '../../../utils/Logger';
import { CONTROL_LOOP_TOOLS } from '../../../constants/ToolNames';
import { SystemLlmServiceManager } from '../../../../server/socket/services/SystemLlmServiceManager';
import { lastValueFrom } from 'rxjs';
import { McpToolHandlerContext, McpToolHandlerResult, McpToolResultContent } from '../McpServerTypes';

const logger = new Logger('info', 'ControlLoopPhases', 'server');

/**
 * MCP Tool: controlLoop_observe
 * Submit observations to a running control loop
 */
export const controlLoopObserveTool = {
    name: CONTROL_LOOP_TOOLS.OBSERVE,
    description: 'Execute the observation phase of the control loop',
    inputSchema: {
        type: 'object',
        properties: {
            loopId: {
                type: 'string',
                description: 'ID of the control loop to submit observations to'
            },
            observations: {
                type: 'array',
                description: 'Array of observations to submit',
                items: {
                    type: 'object',
                    properties: {
                        type: { type: 'string', description: 'Type of observation' },
                        data: { description: 'Observation data' },
                        source: { type: 'string', description: 'Source of the observation' },
                        timestamp: { type: 'number', description: 'Observation timestamp' },
                        confidence: { type: 'number', minimum: 0, maximum: 1, description: 'Confidence level' }
                    },
                    required: ['type', 'data']
                }
            },
            priority: {
                type: 'number',
                minimum: 1,
                maximum: 10,
                default: 5,
                description: 'Priority of these observations'
            }
        },
        required: ['loopId', 'observations']
    },

    handler: async (input: {
        loopId: string;
        observations: Array<{
            type: string;
            data: any;
            source?: string;
            timestamp?: number;
            confidence?: number;
        }>;
        priority?: number;
    }, context: McpToolHandlerContext): Promise<McpToolHandlerResult> => {
        try {
            // Enrich observations with metadata
            const enrichedObservations = input.observations.map((obs, index) => ({
                ...obs,
                observationId: `obs_${context.requestId}_${index}`,
                timestamp: obs.timestamp || Date.now(),
                source: obs.source || context.agentId,
                confidence: obs.confidence || 0.8
            }));

            const controlLoopData: ControlLoopSpecificData = {
                loopId: input.loopId,
                status: 'observing',
                config: {
                    observations: enrichedObservations,
                    priority: input.priority || 5,
                    requestId: context.requestId
                }
            };

            // Emit observation event using existing infrastructure
            const payload = createControlLoopEventPayload(
                Events.ControlLoop.OBSERVATION,
                context.agentId!,
                context.channelId!,
                controlLoopData
            );

            EventBus.server.emit(Events.ControlLoop.OBSERVATION, payload);


            const content: McpToolResultContent = {
                type: 'application/json',
                data: {
                    loopId: input.loopId,
                    observationsAccepted: enrichedObservations.length,
                    observationIds: enrichedObservations.map(obs => obs.observationId),
                    nextPhase: 'reasoning'
                }
            };
            return { content };
        } catch (error) {
            logger.error(`Failed to submit observations: ${error}`);
            const content: McpToolResultContent = {
                type: 'application/json',
                data: {
                    error: `Failed to submit observations: ${error instanceof Error ? error.message : String(error)}`
                }
            };
            return { content };
        }
    }
};

/**
 * MCP Tool: controlLoop_reason
 * Trigger reasoning phase with context and parameters
 */
export const controlLoopReasonTool = {
    name: CONTROL_LOOP_TOOLS.REASON,
    description: 'Trigger reasoning phase with context and parameters',
    inputSchema: {
        type: 'object',
        properties: {
            loopId: {
                type: 'string',
                description: 'ID of the control loop to trigger reasoning for'
            },
            reasoningContext: {
                type: 'object',
                description: 'Context and parameters for reasoning',
                properties: {
                    focus: { type: 'string', description: 'What to focus reasoning on' },
                    constraints: { type: 'object', description: 'Reasoning constraints' },
                    goals: { type: 'array', items: { type: 'string' }, description: 'Reasoning goals' },
                    timeoutMs: { type: 'number', description: 'Reasoning timeout' }
                }
            },
            includeHistory: {
                type: 'boolean',
                default: true,
                description: 'Whether to include historical context'
            }
        },
        required: ['loopId']
    },

    handler: async (input: {
        loopId: string;
        reasoningContext?: {
            focus?: string;
            constraints?: Record<string, any>;
            goals?: string[];
            timeoutMs?: number;
        };
        includeHistory?: boolean;
    }, context: McpToolHandlerContext): Promise<McpToolHandlerResult> => {
        try {
            const reasoningId = `reasoning_${context.requestId}_${Date.now()}`;
            
            const controlLoopData: ControlLoopSpecificData = {
                loopId: input.loopId,
                status: 'reasoning',
                config: {
                    reasoningId,
                    reasoningContext: {
                        focus: input.reasoningContext?.focus || 'general',
                        constraints: input.reasoningContext?.constraints || {},
                        goals: input.reasoningContext?.goals || [],
                        timeoutMs: input.reasoningContext?.timeoutMs || 30000,
                        includeHistory: input.includeHistory ?? true,
                        requestId: context.requestId
                    }
                }
            };

            // Emit reasoning event using existing infrastructure
            const payload = createControlLoopEventPayload(
                Events.ControlLoop.REASONING,
                context.agentId!,
                context.channelId!,
                controlLoopData
            );

            EventBus.server.emit(Events.ControlLoop.REASONING, payload);


            const content: McpToolResultContent = {
                type: 'application/json',
                data: {
                    loopId: input.loopId,
                    reasoningId,
                    status: 'reasoning',
                    estimatedDuration: input.reasoningContext?.timeoutMs || 30000
                }
            };
            return { content };
        } catch (error) {
            logger.error(`Failed to trigger reasoning: ${error}`);
            const content: McpToolResultContent = {
                type: 'application/json',
                data: {
                    error: `Failed to trigger reasoning: ${error instanceof Error ? error.message : String(error)}`
                }
            };
            return { content };
        }
    }
};

/**
 * MCP Tool: controlLoop_plan
 * Generate or modify plans based on reasoning results
 */
export const controlLoopPlanTool = {
    name: CONTROL_LOOP_TOOLS.PLAN,
    description: 'Generate or modify plans based on reasoning results',
    inputSchema: {
        type: 'object',
        properties: {
            loopId: {
                type: 'string',
                description: 'ID of the control loop to create plans for'
            },
            planningMode: {
                type: 'string',
                enum: ['create', 'modify', 'optimize', 'validate'],
                default: 'create',
                description: 'Mode of planning operation'
            },
            planningConstraints: {
                type: 'object',
                description: 'Constraints for plan generation',
                properties: {
                    maxSteps: { type: 'number', description: 'Maximum number of plan steps' },
                    timeConstraint: { type: 'number', description: 'Time constraint in ms' },
                    resources: { type: 'object', description: 'Available resources' },
                    priorities: { type: 'array', items: { type: 'string' }, description: 'Priority list' }
                }
            },
            existingPlan: {
                type: 'object',
                description: 'Existing plan to modify (if planningMode is modify)'
            }
        },
        required: ['loopId']
    },

    handler: async (input: {
        loopId: string;
        planningMode?: 'create' | 'modify' | 'optimize' | 'validate';
        planningConstraints?: {
            maxSteps?: number;
            timeConstraint?: number;
            resources?: Record<string, any>;
            priorities?: string[];
        };
        existingPlan?: any;
    }, context: McpToolHandlerContext): Promise<McpToolHandlerResult> => {
        try {
            const planId = `plan_${context.requestId}_${Date.now()}`;
            
            const controlLoopData: ControlLoopSpecificData = {
                loopId: input.loopId,
                status: 'planning',
                config: {
                    planId,
                    planningMode: input.planningMode || 'create',
                    planningConstraints: {
                        maxSteps: input.planningConstraints?.maxSteps || 10,
                        timeConstraint: input.planningConstraints?.timeConstraint || 60000,
                        resources: input.planningConstraints?.resources || {},
                        priorities: input.planningConstraints?.priorities || [],
                        requestId: context.requestId
                    },
                    existingPlan: input.existingPlan
                }
            };

            // Emit planning event using existing infrastructure
            const payload = createControlLoopEventPayload(
                Events.ControlLoop.PLAN,
                context.agentId!,
                context.channelId!,
                controlLoopData
            );

            EventBus.server.emit(Events.ControlLoop.PLAN, payload);


            const content: McpToolResultContent = {
                type: 'application/json',
                data: {
                    loopId: input.loopId,
                    planId,
                    planningMode: input.planningMode || 'create',
                    status: 'planning'
                }
            };
            return { content };
        } catch (error) {
            logger.error(`Failed to trigger planning: ${error}`);
            const content: McpToolResultContent = {
                type: 'application/json',
                data: {
                    error: `Failed to trigger planning: ${error instanceof Error ? error.message : String(error)}`
                }
            };
            return { content };
        }
    }
};

/**
 * MCP Tool: controlLoop_execute
 * Execute specific plan actions or steps
 */
export const controlLoopExecuteTool = {
    name: CONTROL_LOOP_TOOLS.EXECUTE,
    description: 'Execute specific plan actions or steps',
    inputSchema: {
        type: 'object',
        properties: {
            loopId: {
                type: 'string',
                description: 'ID of the control loop to execute actions for'
            },
            actions: {
                type: 'array',
                description: 'Array of actions to execute',
                items: {
                    type: 'object',
                    properties: {
                        actionType: { type: 'string', description: 'Type of action' },
                        parameters: { type: 'object', description: 'Action parameters' },
                        priority: { type: 'number', minimum: 1, maximum: 10, description: 'Action priority' },
                        timeout: { type: 'number', description: 'Action timeout in ms' },
                        retryPolicy: { type: 'object', description: 'Retry policy for the action' }
                    },
                    required: ['actionType', 'parameters']
                }
            },
            executionMode: {
                type: 'string',
                enum: ['sequential', 'parallel', 'conditional'],
                default: 'sequential',
                description: 'How to execute multiple actions'
            }
        },
        required: ['loopId', 'actions']
    },

    handler: async (input: {
        loopId: string;
        actions: Array<{
            actionType: string;
            parameters: Record<string, any>;
            priority?: number;
            timeout?: number;
            retryPolicy?: Record<string, any>;
        }>;
        executionMode?: 'sequential' | 'parallel' | 'conditional';
    }, context: McpToolHandlerContext): Promise<McpToolHandlerResult> => {
        try {
            const executionId = `exec_${context.requestId}_${Date.now()}`;
            
            // Enrich actions with metadata
            const enrichedActions = input.actions.map((action, index) => ({
                ...action,
                actionId: `action_${executionId}_${index}`,
                priority: action.priority || 5,
                timeout: action.timeout || 30000,
                retryPolicy: action.retryPolicy || { maxRetries: 3, backoffMs: 1000 }
            }));

            const controlLoopData: ControlLoopSpecificData = {
                loopId: input.loopId,
                status: 'executing',
                config: {
                    executionId,
                    actions: enrichedActions,
                    executionMode: input.executionMode || 'sequential',
                    requestId: context.requestId
                }
            };

            // Emit execution event using existing infrastructure
            const payload = createControlLoopEventPayload(
                Events.ControlLoop.EXECUTION,
                context.agentId!,
                context.channelId!,
                controlLoopData
            );

            EventBus.server.emit(Events.ControlLoop.EXECUTION, payload);


            // Estimate duration based on actions and mode
            const estimatedDuration = input.executionMode === 'parallel' 
                ? Math.max(...enrichedActions.map(a => a.timeout))
                : enrichedActions.reduce((sum, a) => sum + a.timeout, 0);

            const content: McpToolResultContent = {
                type: 'application/json',
                data: {
                    loopId: input.loopId,
                    executionId,
                    actionsScheduled: enrichedActions.length,
                    executionMode: input.executionMode || 'sequential',
                    estimatedDuration
                }
            };
            return { content };
        } catch (error) {
            logger.error(`Failed to execute actions: ${error}`);
            const content: McpToolResultContent = {
                type: 'application/json',
                data: {
                    error: `Failed to execute actions: ${error instanceof Error ? error.message : String(error)}`
                }
            };
            return { content };
        }
    }
};

/**
 * MCP Tool: controlLoop_reflect
 * Generate reflections on completed control loop cycles
 */
export const controlLoopReflectTool = {
    name: CONTROL_LOOP_TOOLS.REFLECT,
    description: 'Generate reflections on completed control loop cycles',
    inputSchema: {
        type: 'object',
        properties: {
            loopId: {
                type: 'string',
                description: 'ID of the control loop to reflect on'
            },
            reflectionScope: {
                type: 'string',
                enum: ['cycle', 'phase', 'action', 'overall'],
                default: 'cycle',
                description: 'Scope of reflection'
            },
            reflectionAspects: {
                type: 'array',
                items: { type: 'string' },
                description: 'Specific aspects to reflect on',
                default: ['effectiveness', 'efficiency', 'learning', 'improvements']
            },
            includeMetrics: {
                type: 'boolean',
                default: true,
                description: 'Whether to include performance metrics'
            }
        },
        required: ['loopId']
    },

    handler: async (input: {
        loopId: string;
        reflectionScope?: 'cycle' | 'phase' | 'action' | 'overall';
        reflectionAspects?: string[];
        includeMetrics?: boolean;
    }, context: McpToolHandlerContext): Promise<McpToolHandlerResult> => {
        try {
            const reflectionId = `reflect_${context.requestId}_${Date.now()}`;
            const reflectionScope = input.reflectionScope || 'cycle';
            const reflectionAspects = input.reflectionAspects || ['effectiveness', 'efficiency', 'learning', 'improvements'];
            
            let reflectionData = null;
            const llmCapabilityAvailable = !!process.env.OPENROUTER_API_KEY;
            
            if (llmCapabilityAvailable && context.channelId) {
                try {
                    // Get per-channel SystemLlmService instance
                    const systemLlmService = SystemLlmServiceManager.getInstance().getServiceForChannel(context.channelId);
                    if (!systemLlmService) {
                        throw new Error(`No SystemLLM available for channel ${context.channelId}`);
                    }
                    
                    // Create a mock plan based on available context for reflection
                    const mockPlan = {
                        id: `plan_${input.loopId}_${Date.now()}`,
                        agentId: context.agentId,
                        goal: `Control loop ${input.loopId} execution`,
                        description: `Agent ${context.agentId} executed control loop ${input.loopId} with ${reflectionScope} scope`,
                        actions: [
                            {
                                id: `action_${reflectionId}`,
                                description: `Control loop ${reflectionScope} phase execution`,
                                status: 'completed' as const,
                                metadata: { 
                                    reflectionScope: reflectionScope,
                                    aspects: reflectionAspects
                                }
                            }
                        ],
                        metadata: {
                            controlLoopId: input.loopId,
                            reflectionRequest: true
                        }
                    };
                    
                    const mockExecutedActions = mockPlan.actions;
                    const mockResults = [{
                        actionId: mockPlan.actions[0].id,
                        status: 'completed',
                        metadata: mockPlan.actions[0].metadata
                    }];
                    
                    // Generate actual reflection using SystemLlmService
                    reflectionData = await lastValueFrom(
                        systemLlmService.generateReflection(mockPlan as any, mockExecutedActions as any, mockResults)
                    );
                    
                    
                } catch (llmError) {
                    logger.warn(`SystemLlmService reflection failed, proceeding without LLM reflection: ${llmError instanceof Error ? llmError.message : String(llmError)}`);
                    // reflectionData remains null, will be handled below
                }
            }

            const controlLoopData: ControlLoopSpecificData = {
                loopId: input.loopId,
                status: 'reflection', // Use 'reflection' status to match ControlLoop implementation
                reflection: reflectionData, // Include actual LLM-generated reflection data if available
                config: {
                    reflectionId,
                    reflectionScope: reflectionScope,
                    reflectionAspects: reflectionAspects,
                    includeMetrics: input.includeMetrics ?? true,
                    requestId: context.requestId
                }
            };

            // Emit reflection event - let ControlLoopService or actual ControlLoop instance handle reflection generation
            const payload = createControlLoopEventPayload(
                Events.ControlLoop.REFLECTION,
                context.agentId!,
                context.channelId!,
                controlLoopData
            );

            EventBus.server.emit(Events.ControlLoop.REFLECTION, payload);


            const content: McpToolResultContent = {
                type: 'application/json',
                data: {
                    loopId: input.loopId,
                    reflectionId,
                    scope: reflectionScope,
                    aspects: reflectionAspects,
                    status: 'reflecting',
                    reflectionData
                }
            };
            return { content };
        } catch (error) {
            logger.error(`Failed to trigger reflection: ${error}`);
            const content: McpToolResultContent = {
                type: 'application/json',
                data: {
                    error: `Failed to trigger reflection: ${error instanceof Error ? error.message : String(error)}`
                }
            };
            return { content };
        }
    }
};

/**
 * Export ORPAR phase control loop tools
 */
export const controlLoopPhaseTools = [
    controlLoopObserveTool,
    controlLoopReasonTool,
    controlLoopPlanTool,
    controlLoopExecuteTool,
    controlLoopReflectTool
];
