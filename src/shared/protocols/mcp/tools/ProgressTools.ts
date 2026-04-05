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
 * ProgressTools.ts
 *
 * MCP tool for emitting structured progress updates during task execution.
 * The UI displays these as status indicators rather than conversation messages,
 * keeping the user informed about what the agent is doing.
 *
 * Tools:
 * - progress_update: Fire-and-forget progress emission for UI status display
 */

import { McpToolDefinition, McpToolHandlerContext, McpToolHandlerResult, McpToolResultContent } from '../McpServerTypes';
import { McpToolInput } from '../IMcpClient';
import { Logger } from '../../../utils/Logger';
import { EventBus } from '../../../events/EventBus';
import { Events } from '../../../events/EventNames';
import { createBaseEventPayload } from '../../../schemas/EventPayloadSchema';

const logger = new Logger('info', 'ProgressTools', 'server');

// ============================================================================
// progress_update Tool
// ============================================================================

/**
 * progress_update — Report progress on the current task.
 * The UI displays this as a status indicator rather than a conversation message.
 * Fire-and-forget: emits a progress event and returns immediately.
 */
export const progressUpdateTool: McpToolDefinition = {
    name: 'progress_update',
    description: 'Report progress on the current task. The UI displays this as a status indicator rather than a conversation message. Use this to keep the user informed about what you are doing.',
    inputSchema: {
        type: 'object',
        properties: {
            status: {
                type: 'string',
                description: "Short status message (e.g., 'Reading log files', 'Analyzing patterns')"
            },
            detail: {
                type: 'string',
                description: 'Optional longer detail'
            },
            percent: {
                type: 'number',
                description: 'Optional completion percentage (0-100)',
                minimum: 0,
                maximum: 100
            }
        },
        required: ['status']
    },
    enabled: true,
    handler: async (input: McpToolInput, context: McpToolHandlerContext): Promise<McpToolHandlerResult> => {
        const status = input.status as string;
        const detail = input.detail as string | undefined;
        const percent = input.percent as number | undefined;

        // Validate status is non-empty
        if (!status || typeof status !== 'string' || status.trim().length === 0) {
            return {
                content: { type: 'text', data: 'Error: status is required and must be a non-empty string.' }
            };
        }

        // Validate percent range if provided
        if (percent !== undefined && (typeof percent !== 'number' || percent < 0 || percent > 100)) {
            return {
                content: { type: 'text', data: 'Error: percent must be a number between 0 and 100.' }
            };
        }

        logger.debug(`Progress update from agent ${context.agentId}: ${status}${percent !== undefined ? ` (${percent}%)` : ''}`);

        // Fire-and-forget: emit the progress event to the UI
        EventBus.server.emit(
            Events.Progress.PROGRESS_UPDATE,
            createBaseEventPayload(
                Events.Progress.PROGRESS_UPDATE,
                context.agentId || '',
                context.channelId || '',
                { status, detail, percent }
            )
        );

        return {
            content: { type: 'text', data: 'Progress reported.' }
        };
    }
};

/**
 * All progress tools exported as an array for registration
 */
export const progressTools = [progressUpdateTool];
