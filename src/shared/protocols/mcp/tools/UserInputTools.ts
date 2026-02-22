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
 * UserInputTools.ts
 *
 * MCP tools for prompting users for input during agent execution.
 * Provides both blocking and async modes for collecting user responses.
 *
 * Tools:
 * - user_input: Blocking mode — pauses agent until user responds
 * - request_user_input: Async mode step 1 — sends prompt, returns immediately with requestId
 * - get_user_input_response: Async mode step 2 — polls for response by requestId
 */

import { Logger } from '../../../utils/Logger';
import { McpToolHandlerContext, McpToolHandlerResult } from '../McpServerTypes';
import { USER_INPUT_TOOLS } from '../../../constants/ToolNames';
import { UserInputRequestManager } from '../../../services/UserInputRequestManager';
import { EventBus } from '../../../events/EventBus';
import { UserInputEvents, UserInputType, InputConfig, UserInputUrgency, UserInputTheme } from '../../../events/event-definitions/UserInputEvents';
import { createUserInputRequestPayload } from '../../../schemas/EventPayloadSchema';
import { AgentId, ChannelId } from '../../../types/ChannelContext';

const logger = new Logger('info', 'UserInputTools', 'server');

// ============================================================================
// Shared Input Schema Definition
// ============================================================================

/**
 * Common input schema properties shared between user_input and request_user_input tools
 */
const commonInputSchemaProperties = {
    title: {
        type: 'string',
        minLength: 1,
        description: 'Short heading for the prompt displayed to the user.'
    },
    description: {
        type: 'string',
        description: 'Longer explanation to help the user understand what is being asked (optional).'
    },
    inputType: {
        type: 'string',
        enum: ['text', 'select', 'multi_select', 'confirm'],
        description: 'Type of input to collect from the user.'
    },
    inputConfig: {
        type: 'object',
        description: `Type-specific configuration for the input. Depends on inputType:
- text: { multiline?: boolean, placeholder?: string, minLength?: number, maxLength?: number }
- select: { options: Array<{ value: string, label: string, description?: string }> }
- multi_select: { options: Array<{ value: string, label: string, description?: string }>, minSelections?: number, maxSelections?: number }
- confirm: { confirmLabel?: string, denyLabel?: string }`
    },
    timeoutMs: {
        type: 'number',
        minimum: 1000,
        description: 'Optional timeout in milliseconds. If the user does not respond within this time, the request is cancelled.'
    },
    urgency: {
        type: 'string',
        enum: ['low', 'normal', 'high', 'critical'],
        description: 'Visual emphasis level (optional, ignored by terminal clients).'
    },
    icon: {
        type: 'string',
        description: 'Icon identifier for visual rendering (optional, ignored by terminal clients).'
    },
    theme: {
        type: 'string',
        enum: ['default', 'warning', 'info', 'success', 'error'],
        description: 'Visual theme for the prompt (optional, ignored by terminal clients).'
    }
};

// ============================================================================
// Tool: user_input (blocking mode)
// ============================================================================

/**
 * MCP Tool: user_input
 *
 * Blocking mode — creates a user input request and waits for the response.
 * The tool call stays open until the user responds or the request times out.
 */
export const userInputTool = {
    name: USER_INPUT_TOOLS.USER_INPUT,
    description: `Prompt the user for input and wait for their response (blocking mode).
This tool pauses execution until the user responds, the request times out, or it is cancelled.

Use this when you need user guidance before proceeding:
- Choosing between options ("Which database should I use?")
- Getting approval ("Should I proceed with this plan?")
- Collecting configuration values ("What port should the server listen on?")
- Free-form input ("Describe the feature you want")

The tool supports four input types:
- text: Free-form text input (single or multi-line)
- select: Pick one option from a list
- multi_select: Pick multiple options from a list
- confirm: Simple yes/no question`,

    inputSchema: {
        type: 'object',
        properties: commonInputSchemaProperties,
        required: ['title', 'inputType', 'inputConfig']
    },

    handler: async (
        input: {
            title: string;
            description?: string;
            inputType: UserInputType;
            inputConfig: InputConfig;
            timeoutMs?: number;
            urgency?: UserInputUrgency;
            icon?: string;
            theme?: UserInputTheme;
        },
        context: McpToolHandlerContext
    ): Promise<McpToolHandlerResult> => {
        try {
            const agentId = context.agentId as AgentId;
            const channelId = context.channelId as ChannelId;

            if (!agentId || !channelId) {
                return {
                    content: {
                        type: 'text',
                        data: JSON.stringify({
                            success: false,
                            error: 'Agent ID and channel ID are required for user_input tool'
                        })
                    }
                };
            }

            logger.info(`[user_input] Agent ${agentId} requesting user input: "${input.title}" (${input.inputType})`);

            const manager = UserInputRequestManager.getInstance();

            // Create the request — returns requestData and a Promise that resolves when user responds
            const { requestData, promise } = manager.createRequest({
                agentId,
                channelId,
                title: input.title,
                description: input.description,
                inputType: input.inputType,
                inputConfig: input.inputConfig,
                timeoutMs: input.timeoutMs,
                urgency: input.urgency,
                icon: input.icon,
                theme: input.theme,
            });

            // Emit the request event so it gets forwarded to clients via Socket.IO
            const payload = createUserInputRequestPayload(agentId, channelId, requestData);
            EventBus.server.emit(UserInputEvents.REQUEST, payload);

            // Wait for user response (blocks until resolved, rejected, or timed out)
            const value = await promise;

            logger.info(`[user_input] Request ${requestData.requestId} resolved for agent ${agentId}`);

            return {
                content: {
                    type: 'text',
                    data: JSON.stringify({
                        success: true,
                        requestId: requestData.requestId,
                        inputType: input.inputType,
                        value
                    })
                }
            };
        } catch (error: any) {
            logger.error(`[user_input] Error: ${error.message}`);
            return {
                content: {
                    type: 'text',
                    data: JSON.stringify({
                        success: false,
                        error: error.message
                    })
                }
            };
        }
    }
};

// ============================================================================
// Tool: request_user_input (async mode — step 1)
// ============================================================================

/**
 * MCP Tool: request_user_input
 *
 * Async mode step 1 — creates a user input request and returns immediately
 * with a requestId. The agent can continue working and check for the response
 * later using get_user_input_response.
 */
export const requestUserInputTool = {
    name: USER_INPUT_TOOLS.REQUEST_USER_INPUT,
    description: `Prompt the user for input without blocking (async mode step 1).
Returns immediately with a requestId. Use get_user_input_response to check for the response later.

Use this when you want to continue working while waiting for user input,
or when you need to send multiple prompts before collecting responses.`,

    inputSchema: {
        type: 'object',
        properties: commonInputSchemaProperties,
        required: ['title', 'inputType', 'inputConfig']
    },

    handler: async (
        input: {
            title: string;
            description?: string;
            inputType: UserInputType;
            inputConfig: InputConfig;
            timeoutMs?: number;
            urgency?: UserInputUrgency;
            icon?: string;
            theme?: UserInputTheme;
        },
        context: McpToolHandlerContext
    ): Promise<McpToolHandlerResult> => {
        try {
            const agentId = context.agentId as AgentId;
            const channelId = context.channelId as ChannelId;

            if (!agentId || !channelId) {
                return {
                    content: {
                        type: 'text',
                        data: JSON.stringify({
                            success: false,
                            error: 'Agent ID and channel ID are required for request_user_input tool'
                        })
                    }
                };
            }

            logger.info(`[request_user_input] Agent ${agentId} requesting async user input: "${input.title}" (${input.inputType})`);

            const manager = UserInputRequestManager.getInstance();

            // Create the request (the promise is stored in the manager, not awaited here)
            const { requestData } = manager.createRequest({
                agentId,
                channelId,
                title: input.title,
                description: input.description,
                inputType: input.inputType,
                inputConfig: input.inputConfig,
                timeoutMs: input.timeoutMs,
                urgency: input.urgency,
                icon: input.icon,
                theme: input.theme,
            });

            // Emit the request event so it gets forwarded to clients via Socket.IO
            const payload = createUserInputRequestPayload(agentId, channelId, requestData);
            EventBus.server.emit(UserInputEvents.REQUEST, payload);

            // Return immediately with the requestId
            return {
                content: {
                    type: 'text',
                    data: JSON.stringify({
                        success: true,
                        requestId: requestData.requestId,
                        status: 'pending'
                    })
                }
            };
        } catch (error: any) {
            logger.error(`[request_user_input] Error: ${error.message}`);
            return {
                content: {
                    type: 'text',
                    data: JSON.stringify({
                        success: false,
                        error: error.message
                    })
                }
            };
        }
    }
};

// ============================================================================
// Tool: get_user_input_response (async mode — step 2)
// ============================================================================

/**
 * MCP Tool: get_user_input_response
 *
 * Async mode step 2 — checks the status of a previously submitted user input request.
 * Returns the response if available, or the current status if still pending.
 */
export const getUserInputResponseTool = {
    name: USER_INPUT_TOOLS.GET_USER_INPUT_RESPONSE,
    description: `Check the status of a previously submitted user input request (async mode step 2).
Returns the user's response if they have answered, or the current status if still pending.

Use after calling request_user_input to retrieve the response.`,

    inputSchema: {
        type: 'object',
        properties: {
            requestId: {
                type: 'string',
                minLength: 1,
                description: 'The request ID returned by request_user_input.'
            }
        },
        required: ['requestId']
    },

    handler: async (
        input: { requestId: string },
        context: McpToolHandlerContext
    ): Promise<McpToolHandlerResult> => {
        try {
            const manager = UserInputRequestManager.getInstance();
            const result = manager.getRequest(input.requestId);

            if (!result) {
                return {
                    content: {
                        type: 'text',
                        data: JSON.stringify({
                            success: false,
                            error: `Request ${input.requestId} not found`
                        })
                    }
                };
            }

            if (result.status === 'responded') {
                return {
                    content: {
                        type: 'text',
                        data: JSON.stringify({
                            success: true,
                            requestId: input.requestId,
                            status: 'responded',
                            inputType: result.request.inputType,
                            value: result.value
                        })
                    }
                };
            }

            // For pending, cancelled, or timeout — return status without value
            return {
                content: {
                    type: 'text',
                    data: JSON.stringify({
                        success: true,
                        requestId: input.requestId,
                        status: result.status,
                        title: result.request.title,
                        inputType: result.request.inputType
                    })
                }
            };
        } catch (error: any) {
            logger.error(`[get_user_input_response] Error: ${error.message}`);
            return {
                content: {
                    type: 'text',
                    data: JSON.stringify({
                        success: false,
                        error: error.message
                    })
                }
            };
        }
    }
};

// ============================================================================
// Export array for tool registration
// ============================================================================

/**
 * All user input tools for registration in the MCP tool index
 */
export const userInputTools = [
    userInputTool,
    requestUserInputTool,
    getUserInputResponseTool
];
