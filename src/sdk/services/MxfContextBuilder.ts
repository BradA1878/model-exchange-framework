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
 * MxfContextBuilder - Build AgentContext from current agent state
 * 
 * This service constructs the complete AgentContext that MCP clients need,
 * without any reconstruction or lossy conversions.
 * 
 * Design: Single source of truth approach
 * - Read directly from storage
 * - Provide raw data with rich metadata
 * - Let MCP clients do the structuring
 */

import { AgentContext, TaskContext, ActionEntry } from '../../shared/interfaces/AgentContext';
import { ConversationMessage } from '../../shared/interfaces/ConversationMessage';
import { AgentConfig } from '../../shared/interfaces/AgentInterfaces';
import { Logger } from '../../shared/utils/Logger';
import { MxfActionHistoryService } from './MxfActionHistoryService';
import { PromptTemplateReplacer } from '../../shared/utils/PromptTemplateReplacer';

/**
 * Build AgentContext from current agent state
 */
export class MxfContextBuilder {
    private logger: Logger;
    public readonly actionHistoryService: MxfActionHistoryService;  // Public for action tracking
    
    constructor(agentId: string) {
        this.logger = new Logger('debug', `ContextBuilder:${agentId}`, 'client');
        this.actionHistoryService = new MxfActionHistoryService();
    }
    
    /**
     * Build complete AgentContext from current state
     *
     * This method assembles everything an MCP client needs without any
     * reconstruction or manipulation of the conversation history.
     *
     * @param systemPrompt Framework rules and operating environment
     * @param agentConfig Agent identity and capabilities
     * @param conversationHistory Raw conversation history from storage
     * @param currentTask Active task (if any)
     * @param availableTools Tools available for this request
     * @param channelId Channel the agent is operating in
     * @param channelConfig Channel configuration (optional)
     * @param activeAgents List of active agent IDs in channel (optional)
     * @param currentOrparPhase Current ORPAR cognitive cycle phase (optional)
     * @returns Complete AgentContext ready for MCP clients
     */
    public async buildContext(
        systemPrompt: string,
        agentConfig: AgentConfig,
        conversationHistory: ConversationMessage[],
        currentTask: { description: string; requirements?: string[]; completionCriteria?: string[]; taskId?: string; title?: string; status?: string; progress?: number } | null,
        availableTools: any[],
        channelId: string,
        channelConfig?: any,
        activeAgents?: string[],
        currentOrparPhase?: 'Observe' | 'Reason' | 'Plan' | 'Act' | 'Reflect' | null
    ): Promise<AgentContext> {
        
        // Replace dynamic templates in system prompt (date/time, agent/channel context)
        // This happens fresh on every request without modifying the cached system prompt
        const enhancedSystemPrompt = PromptTemplateReplacer.replaceTemplates(systemPrompt, {
            // Agent and channel identity
            agentId: agentConfig.agentId,
            channelId,
            channelName: channelId, // Not displayed in current template, but available for future use

            // Collaboration context (from channel config)
            activeAgentsCount: (channelConfig?.showActiveAgents && activeAgents && activeAgents.length > 0)
                ? activeAgents.length
                : 1,
            activeAgentsList: (channelConfig?.showActiveAgents && activeAgents && activeAgents.length > 0)
                ? activeAgents
                : [agentConfig.agentId],

            // LLM configuration
            llmProvider: agentConfig.llmProvider || 'Unknown',
            llmModel: agentConfig.defaultModel || 'Unknown',

            // System status (from channel config)
            systemLlmEnabled: channelConfig?.systemLlmEnabled || false,

            // Control loop state - ORPAR phase tracking via event-based updates
            currentOrparPhase: currentOrparPhase || null,

            // Task status (if task is active)
            currentTaskId: currentTask?.taskId || 'None',
            currentTaskTitle: currentTask?.title || 'No active task',
            currentTaskStatus: currentTask?.status || 'N/A',
            currentTaskProgress: currentTask?.progress || 0
        });
        
        // Get recent actions
        const recentActions = await this.getRecentActions(agentConfig.agentId);
        
        // Build task context (if present)
        const taskContext: TaskContext | null = currentTask ? {
            description: currentTask.description,
            requirements: currentTask.requirements,
            completionCriteria: currentTask.completionCriteria,
            taskId: currentTask.taskId,
            title: currentTask.title,
            status: currentTask.status,
            progress: currentTask.progress
        } : null;
        
        // Assemble complete context
        const context: AgentContext = {
            // Core context - use enhanced system prompt with templates replaced
            systemPrompt: enhancedSystemPrompt,
            agentConfig,
            currentTask: taskContext,
            
            // Raw conversation history (no reconstruction!)
            conversationHistory,
            
            // Recent actions
            recentActions,
            
            // Available tools
            availableTools,
            
            // Metadata
            agentId: agentConfig.agentId,
            channelId,
            timestamp: Date.now(),
            
            metadata: {
                // No special hints yet - MCP clients have full context
            }
        };
        
        
        return context;
    }
    
    /**
     * Get recent actions from action history service
     */
    private async getRecentActions(agentId: string, maxActions: number = 10): Promise<ActionEntry[]> {
        const history = await this.actionHistoryService.getFormattedHistory(agentId, maxActions);
        
        if (!history || history === '(No recent actions)') {
            return [];
        }
        
        // Parse formatted history back to action entries
        // Format is: "- [timestamp] action: result"
        const lines = history.split('\n').filter(line => line.trim());
        const actions: ActionEntry[] = [];
        
        for (const line of lines) {
            // Try to parse the formatted line
            const match = line.match(/^\s*-\s*\[([^\]]+)\]\s+(.+?)(?::\s+(.+))?$/);
            if (match) {
                const [, timestampStr, action, result] = match;
                actions.push({
                    action: action.trim(),
                    timestamp: new Date(timestampStr).getTime(),
                    result: result?.trim()
                });
            }
        }
        
        return actions;
    }
    
    /**
     * Helper: Extract task context from conversation history metadata
     * 
     * Looks for messages with contextLayer === 'task' to extract task info
     */
    public static extractTaskFromHistory(history: ConversationMessage[]): TaskContext | null {
        const taskMessages = history.filter(msg => msg.metadata?.contextLayer === 'task');
        
        if (taskMessages.length === 0) {
            return null;
        }
        
        // Use the most recent task message
        const taskMsg = taskMessages[taskMessages.length - 1];
        
        // Parse structured task content if it contains requirements and completion criteria
        let requirements: string[] | undefined;
        let completionCriteria: string[] | undefined;

        if (typeof taskMsg.content === 'object' && taskMsg.content !== null) {
            const structured = taskMsg.content as Record<string, any>;
            requirements = structured.requirements;
            completionCriteria = structured.completionCriteria;
        } else if (typeof taskMsg.content === 'string') {
            // Try to extract requirements from formatted text (e.g., "Requirements: - item1 - item2")
            const reqMatch = taskMsg.content.match(/requirements?:\s*([-•]\s*[^\n]+(?:\n[-•]\s*[^\n]+)*)/i);
            if (reqMatch) {
                requirements = reqMatch[1].split(/\n/).map(r => r.replace(/^[-•]\s*/, '').trim()).filter(Boolean);
            }
            const critMatch = taskMsg.content.match(/completion\s*criteria?:\s*([-•]\s*[^\n]+(?:\n[-•]\s*[^\n]+)*)/i);
            if (critMatch) {
                completionCriteria = critMatch[1].split(/\n/).map(c => c.replace(/^[-•]\s*/, '').trim()).filter(Boolean);
            }
        }

        return {
            description: typeof taskMsg.content === 'string' ? taskMsg.content : JSON.stringify(taskMsg.content),
            requirements,
            completionCriteria
        };
    }
    
    /**
     * Helper: Count messages by context layer
     * 
     * Useful for debugging and understanding context composition
     */
    public static analyzeContext(context: AgentContext): Record<string, number> {
        const counts: Record<string, number> = {
            total: context.conversationHistory.length,
            system: 0,
            identity: 0,
            task: 0,
            conversation: 0,
            action: 0,
            'tool-result': 0,
            current: 0,
            unknown: 0
        };
        
        for (const msg of context.conversationHistory) {
            const layer = msg.metadata?.contextLayer;
            if (layer && layer in counts) {
                counts[layer]++;
            } else {
                counts.unknown++;
            }
        }
        
        return counts;
    }
}
