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
 * MXF SDK Action History Service
 * 
 * Client-side service that tracks action history locally in the SDK.
 * This provides immediate, accurate action history for prompt injection
 * without server round-trips or formatting dependencies.
 */

import { Logger } from '../../shared/utils/Logger';
import { createStrictValidator } from '../../shared/utils/validation';

const logger = new Logger('info', 'MxfActionHistoryService', 'client');
const validator = createStrictValidator('MxfActionHistoryService');

export interface ActionEntry {
    timestamp: number;
    agentId: string;
    toolName: string;
    description: string;
    input?: any;
    result?: any;
    metadata?: {
        targetAgentId?: string;
        messageContent?: string;
        [key: string]: any;
    };
}

export interface FormattedActionHistory {
    agentId: string;
    channelId: string;
    entries: FormattedHistoryEntry[];
    totalEntries: number;
    timeWindowMs: number;
}

export interface FormattedHistoryEntry {
    timestamp: string;
    action: string;
    type: string;
    summary: string;
}

export class MxfActionHistoryService {
    private logger = logger;
    private actionHistory: Map<string, ActionEntry[]> = new Map(); // Per-agent action history
    private maxHistorySize = 100; // Maximum actions to keep per agent

    constructor() {
    }

    /**
     * Track a new action for an agent
     */
    public trackAction(action: ActionEntry): void {
        try {
            validator.assertIsNonEmptyString(action.agentId, 'action.agentId');
            validator.assertIsNonEmptyString(action.toolName, 'action.toolName');
            
            // Get or create action history for this agent
            if (!this.actionHistory.has(action.agentId)) {
                this.actionHistory.set(action.agentId, []);
            }
            
            const agentHistory = this.actionHistory.get(action.agentId)!;
            
            // Add new action to the beginning (most recent first)
            agentHistory.unshift(action);
            
            // Trim history if it exceeds max size
            if (agentHistory.length > this.maxHistorySize) {
                agentHistory.splice(this.maxHistorySize);
            }
            
        } catch (error) {
            this.logger.error(`Failed to track action: ${error}`);
        }
    }

    /**
     * Get recent actions for an agent
     */
    public getRecentActions(agentId: string, limit: number = 20): ActionEntry[] {
        const agentHistory = this.actionHistory.get(agentId) || [];
        return agentHistory.slice(0, limit);
    }

    /**
     * Get formatted action history for injection into prompts
     */
    async getFormattedHistory(
        agentId: string, 
        limit: number = 20
    ): Promise<string> {
        try {
            validator.assertIsNonEmptyString(agentId, 'agentId');
            validator.assertIsNumber(limit, 'limit');

            const actions = this.getRecentActions(agentId, limit);
            
            if (actions.length === 0) {
                return '(No recent actions)';
            }
            
            // Format actions for display
            const formattedActions = actions.map(action => {
                const timestamp = new Date(action.timestamp).toLocaleTimeString('en-US', { 
                    hour: '2-digit', 
                    minute: '2-digit', 
                    second: '2-digit',
                    hour12: false 
                });
                
                // Special formatting for messaging_send - no message content to avoid redundancy
                if (action.toolName === 'messaging_send' && action.metadata?.targetAgentId) {
                    return `- [${timestamp}] messaging_send → ${action.metadata.targetAgentId}`;
                }
                
                // Special formatting for task_complete
                if (action.toolName === 'task_complete') {
                    return `- [${timestamp}] task_complete: ${action.description}`;
                }
                
                // Special formatting for tools_recommend - extract tool names from result
                if (action.toolName === 'tools_recommend') {
                    // Try to extract tool names from result
                    let toolNames = '(no tools)';
                    if (action.result?.recommendedTools && Array.isArray(action.result.recommendedTools)) {
                        // Extract tool names from recommendation objects
                        const names = action.result.recommendedTools
                            .map((tool: any) => tool.name || tool.tool || tool)
                            .filter((name: any) => typeof name === 'string');
                        if (names.length > 0) {
                            toolNames = names.join(', ');
                        }
                    } else if (action.description && action.description !== 'undefined') {
                        // Fallback to description if we have it
                        toolNames = action.description;
                    }
                    return `- [${timestamp}] tools_recommend: ${toolNames}`;
                }
                
                // Default formatting - always include tool name
                return `- [${timestamp}] ${action.toolName}: ${action.description}`;
            });
            
            return formattedActions.join('\n');

        } catch (error) {
            this.logger.error(`Failed to get formatted history for agent ${agentId}: ${error}`);
            return '(No recent actions)';
        }
    }

    /**
     * Clear action history for an agent
     */
    public clearHistory(agentId: string): void {
        this.actionHistory.delete(agentId);
    }

    /**
     * Clear all action history
     */
    public clearAllHistory(): void {
        this.actionHistory.clear();
    }

    /**
     * Get channel-wide activity context
     * Fetches from server-side ActionHistoryService via API
     */
    async getChannelContext(channelId: string, limit: number = 10): Promise<string> {
        try {
            validator.assertIsNonEmptyString(channelId, 'channelId');
            validator.assertIsNumber(limit, 'limit');

            
            // Temporary fallback - in production this would be an API call
            return '(No recent channel activity)';

        } catch (error) {
            this.logger.error(`Failed to get channel context for ${channelId}: ${error}`);
            return '(No recent channel activity)';
        }
    }

    /**
     * Inject action history into agent prompts
     * This is the main method used by MxfAgent
     */
    async injectHistoryIntoPrompt(
        agentId: string, 
        channelId: string,
        basePrompt: string, 
        historyLimit: number = 20
    ): Promise<string> {
        try {
            validator.assertIsNonEmptyString(agentId, 'agentId');
            validator.assertIsNonEmptyString(channelId, 'channelId');
            validator.assertIsNonEmptyString(basePrompt, 'basePrompt');

            const agentHistory = await this.getFormattedHistory(agentId, historyLimit);
            const channelContext = await this.getChannelContext(channelId, 5);

            // Only inject history section if we have actual data
            if (agentHistory === '(No recent actions)' && channelContext === '(No recent channel activity)') {
                return basePrompt;
            }

            const historySection = `
## Your Recent Actions (Latest First)
${agentHistory}

## Recent Channel Activity
${channelContext}

## Remember
- Review your action history before taking new actions
- Don't repeat actions already completed
- Build upon previous actions and responses
- Use JSON tool calls for fastest execution (~10ms)
- Natural language responses require SystemLLM interpretation (~200-500ms)
`;

            return `${basePrompt}\n\n${historySection}`;

        } catch (error) {
            this.logger.error(`Failed to inject history into prompt for agent ${agentId}: ${error}`);
            return basePrompt; // Return original prompt on error
        }
    }
}
