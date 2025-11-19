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
 * ActionValidationTools.ts
 * 
 * MCP tools for validating and approving agent next actions after tool execution.
 * Provides intelligent validation to prevent redundant tool calls and improve agent decision-making.
 */

import { Events } from '../../../events/EventNames';
import { EventBus } from '../../../events/EventBus';
import { AgentId, ChannelId } from '../../../types/ChannelContext';
import { Logger } from '../../../utils/Logger';
import { SystemLlmService } from '../../../../server/socket/services/SystemLlmService';
import { v4 as uuidv4 } from 'uuid';
import { McpToolHandlerContext, McpToolHandlerResult, McpToolResultContent } from '../McpServerTypes';

const logger = new Logger('info', 'ActionValidationTools', 'server');

/**
 * MCP Tool: validate_next_action
 * Validate and approve agent's next intended action after tool execution
 */
export const validateNextActionTool = {
    name: 'validate_next_action',
    description: 'Validate your next intended action and get approved tools to prevent redundant calls',
    inputSchema: {
        type: 'object',
        properties: {
            justCompleted: {
                type: 'string',
                description: 'Name of the tool you just completed successfully'
            },
            justCompletedResult: {
                type: 'string',
                description: 'Result status of the completed tool (success/failure)'
            },
            justCompletedDetails: {
                type: 'string',
                description: 'Details about what the completed tool accomplished'
            },
            taskContext: {
                type: 'string',
                description: 'Brief description of your overall task/objective'
            },
            nextActionIntent: {
                type: 'string',
                description: 'What you want to accomplish next (natural language description)'
            },
            proposedTool: {
                type: 'string',
                description: 'Specific tool you want to use (if you have one in mind)',
                optional: true
            },
            progressSummary: {
                type: 'string',
                description: 'What you think you have accomplished so far toward your task'
            }
        },
        required: ['justCompleted', 'justCompletedResult', 'justCompletedDetails', 'taskContext', 'nextActionIntent', 'progressSummary']
    },

    handler: async (input: {
        justCompleted: string;
        justCompletedResult: string;
        justCompletedDetails: string;
        taskContext: string;
        nextActionIntent: string;
        proposedTool?: string;
        progressSummary: string;
    }, context: McpToolHandlerContext): Promise<McpToolHandlerResult> => {
        try {
            const validationId = `validation_${context.requestId}_${Date.now()}`;
            

            // Create validation prompt for SystemLLM
            const validationPrompt = `
🤖 AGENT ACTION VALIDATION REQUEST

Agent: ${context.agentId}
Channel: ${context.channelId}

COMPLETED ACTION:
- Tool: ${input.justCompleted}
- Result: ${input.justCompletedResult}
- Details: ${input.justCompletedDetails}

CURRENT CONTEXT:
- Task: ${input.taskContext}
- Progress: ${input.progressSummary}

AGENT'S NEXT INTENT:
"${input.nextActionIntent}"
${input.proposedTool ? `- Proposed Tool: ${input.proposedTool}` : ''}

EVALUATION CRITERIA:
1. Is the next action necessary given what was just completed?
2. Would the proposed action be redundant or counterproductive?
3. What is the most logical next step to advance the task?
4. Are there better tools available for the agent's intent?

Please provide validation response in the following format:
- APPROVED: true/false
- REASON: Brief explanation of your decision
- RECOMMENDED_INTENT: What the agent should do instead (if not approved)
- APPROVED_TOOLS: List of 3-5 tools the agent should have access to for their next action
- GUIDANCE: Specific advice for the agent's next steps

Available tools to recommend from: messaging_send, messaging_discover, messaging_coordinate, messaging_broadcast, task_complete, tools_recommend, controlLoop_start, controlLoop_observe, controlLoop_reason, controlLoop_plan, controlLoop_execute, controlLoop_reflect, controlLoop_status, controlLoop_stop, filesystem_read, filesystem_write, filesystem_list, shell_execute, memory_store, memory_retrieve, channel_memory_read, channel_memory_write, channel_context_read, agent_context_read, agent_memory_read, agent_memory_write
`;

            // Use SystemLLM for intelligent validation (future enhancement)
            // const systemLlmService = new SystemLlmService();
            // const validationResponse = await systemLlmService.analyzeChannelForCoordination(context.channelId);

            // For now, use a simpler approach with basic logic validation
            // TODO: Implement dedicated validation analysis method in SystemLlmService

            // Basic validation logic (can be enhanced with proper LLM integration)
            const isRedundant = input.proposedTool === input.justCompleted && input.justCompletedResult === 'success';
            const approved = !isRedundant;
            
            const reason = isRedundant 
                ? `Redundant: You just completed ${input.justCompleted} successfully. No need to repeat immediately.`
                : 'Action appears logical and non-redundant';
            
            const recommendedIntent = isRedundant 
                ? 'Consider completing your task or trying a different approach'
                : undefined;
            
            const guidance = isRedundant
                ? `You successfully completed ${input.justCompleted}. Consider if your task is complete or if you need a different tool.`
                : 'Your proposed action seems appropriate. Proceed carefully.';

            // Extract approved tools
            let approvedTools: string[] = [];
            
            if (approved && input.proposedTool) {
                approvedTools = [input.proposedTool, 'task_complete', 'tools_recommend'];
            } else {
                // Default safe tools if not approved
                approvedTools = ['task_complete', 'tools_recommend', 'messaging_discover'];
            }

            // Filter out undefined tools
            approvedTools = approvedTools.filter((tool: string | undefined) => tool !== undefined && tool.length > 0);


            const content: McpToolResultContent = {
                type: 'application/json',
                data: {
                    approved,
                    reason,
                    recommendedIntent,
                    approvedTools,
                    guidance,
                    validationId
                }
            };
            return { content };
            
        } catch (error) {
            logger.error(`Failed to validate next action: ${error}`);
            
            // Fail-safe: Allow task completion and tools recommendation
            const content: McpToolResultContent = {
                type: 'application/json',
                data: {
                    approved: false,
                    reason: `Validation failed: ${error instanceof Error ? error.message : String(error)}`,
                    approvedTools: ['task_complete', 'tools_recommend'],
                    guidance: 'Validation system encountered an error. Consider completing your task or requesting tool recommendations.',
                    validationId: `error_${Date.now()}`
                }
            };
            return { content };
        }
    }
};

/**
 * MCP Tool: no_further_action
 * Simple tool for agents to signal they don't want to take any further action after a tool execution
 */
export const noFurtherActionTool = {
    name: 'no_further_action',
    description: 'Signal that you do not want to take any further action after completing a tool - ends your turn gracefully',
    inputSchema: {
        type: 'object',
        properties: {
            reason: {
                type: 'string',
                description: 'Brief reason why no further action is needed (optional)',
                optional: true
            },
            taskStatus: {
                type: 'string',
                enum: ['complete', 'waiting', 'delegated', 'blocked'],
                description: 'Current status of your task',
                default: 'complete'
            }
        },
        required: []
    },

    handler: async (input: {
        reason?: string;
        taskStatus?: 'complete' | 'waiting' | 'delegated' | 'blocked';
    }, context: McpToolHandlerContext): Promise<McpToolHandlerResult> => {
        try {
            const reason = input.reason || 'Agent chose to end turn without further action';
            const taskStatus = input.taskStatus || 'complete';
            

            const content: McpToolResultContent = {
                type: 'application/json',
                data: {
                    acknowledged: true,
                    turnEnded: true,
                    reason,
                    taskStatus
                }
            };
            return { content };
            
        } catch (error) {
            logger.error(`Failed to process no_further_action: ${error}`);
            
            const content: McpToolResultContent = {
                type: 'application/json',
                data: {
                    acknowledged: true,
                    turnEnded: true,
                    reason: 'Turn ended due to processing error',
                    taskStatus: 'blocked'
                }
            };
            return { content };
        }
    }
};

/**
 * Export action validation tools
 */
export const actionValidationTools = [
    validateNextActionTool,
    noFurtherActionTool
];
