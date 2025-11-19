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
 * LayeredPromptAssembler - Clean architectural separation of prompt layers
 * 
 * Implements the MXF Prompt Architecture Guide:
 * - System Prompt (framework rules)
 * - Agent Config Prompt (identity/role)
 * - Task Prompt (current mission)
 * - Action History (recent actions)
 * - Conversation History (clean dialogue)
 * - SystemLLM Insights (ephemeral)
 * - Current Message
 * - Tool Results
 */

import { Logger } from '../../shared/utils/Logger';
import { ConversationMessage } from '../../shared/interfaces/ConversationMessage';
import { AgentConfig } from '../../shared/interfaces/AgentInterfaces';
import { MxfActionHistoryService } from './MxfActionHistoryService';
import { MxfReasoningHistoryService } from './MxfReasoningHistoryService';

export interface PromptLayer {
    type: 'system' | 'agentConfig' | 'task' | 'reasoning' | 'actions' | 'conversation' | 'systemLLM' | 'current' | 'toolResult';
    content: string;
    role: 'system' | 'user' | 'assistant';
    ephemeral?: boolean; // For SystemLLM messages
}

export interface LayeredPromptOptions {
    includeReasoning?: boolean; // For reasoning-capable models
    maxConversationHistory?: number;
    maxActionHistory?: number;
    maxReasoningHistory?: number; // Number of reasoning entries to include
}

export class MxfLayeredPromptAssembler {
    private logger: Logger;
    private agentId: string;
    private agentConfig: AgentConfig;
    public readonly actionHistoryService: MxfActionHistoryService;
    public readonly reasoningHistoryService: MxfReasoningHistoryService;

    constructor(agentId: string, agentConfig: AgentConfig) {
        this.agentId = agentId;
        this.agentConfig = agentConfig;
        this.logger = new Logger('debug', `PromptAssembler:${agentId}`, 'client');
        this.actionHistoryService = new MxfActionHistoryService();
        this.reasoningHistoryService = new MxfReasoningHistoryService({
            maxEntries: 50,
            maxAge: 3600000 // 1 hour
        });
    }

    /**
     * Assemble all prompt layers in the correct order for LLM consumption
     * Following the canonical structure:
     * 1. Static: System prompt (framework rules)
     * 2. Static: Agent config (identity) 
     * 3. Static: Task prompt (current mission)
     * 4. Dynamic: Conversation/actions (grows over time)
     */
    public async assemblePrompt(
        systemPrompt: string,
        taskPrompt: string | null,
        conversationHistory: ConversationMessage[],
        currentMessage: ConversationMessage | null,
        toolResults: string | null,
        options: LayeredPromptOptions = {}
    ): Promise<ConversationMessage[]> {
        // Use the new StructuredPromptBuilder for clean assembly
        const { MxfStructuredPromptBuilder } = await import('./MxfStructuredPromptBuilder');
        const builder = new MxfStructuredPromptBuilder(this.agentId, this.agentConfig);
        
        // Build structured prompt
        const structure = await builder.buildPromptStructure(
            systemPrompt,
            taskPrompt,
            conversationHistory
        );
        
        // Convert to messages
        return builder.structureToMessages(structure);
    }

    /**
     * Convert prompt layers to conversation messages
     * DEPRECATED: Use direct message construction in assemblePrompt instead
     */
    private layersToMessages(layers: PromptLayer[]): ConversationMessage[] {
        // This method is no longer used - keeping for backwards compatibility
        // The assemblePrompt method now directly constructs messages
        // to ensure proper separation between static and dynamic content
        this.logger.warn('layersToMessages is deprecated - messages are now constructed directly');
        return [];
    }

    /**
     * Get clean action history
     */
    private async getActionHistory(maxActions: number = 10): Promise<string | null> {
        // Get formatted history from local action tracking
        const history = await this.actionHistoryService.getFormattedHistory(this.agentId, maxActions);
        
        if (!history || history === '(No recent actions)') {
            return '(No actions taken yet)';
        }
        
        // History is already properly formatted with bullets and timestamps
        return history;
    }

    /**
     * Get clean conversation history (no SystemLLM, no system messages)
     */
    private getCleanConversationHistory(
        conversationHistory: ConversationMessage[], 
        maxMessages: number = 15
    ): string | null {
        // Filter to only actual conversation messages between agents
        const cleanMessages = conversationHistory
            .filter(msg => {
                // Skip system messages and ephemeral content
                if (msg.role === 'system' || msg.metadata?.ephemeral || msg.metadata?.isSystemLLM) {
                    return false;
                }
                
                // Skip tool feedback and system notices
                if (msg.content.includes('TOOL EXECUTION ACKNOWLEDGMENT') ||
                    msg.content.includes('TOOL CALL NOTIFICATION') ||
                    msg.content.includes('IMMEDIATE TOOL FEEDBACK') ||
                    msg.content.includes('[SystemLLM]') ||
                    msg.content.includes('SYSTEM NOTICE') ||
                    msg.content.includes('[External]') ||
                    msg.content.includes('Tool executed:') ||
                    msg.content.includes('[You]:') ||
                    msg.content.includes('[Agent]:') ||
                    msg.content.includes('You have been assigned a task')) {
                    return false;
                }
                
                // Skip structural prompt elements and task descriptions
                if (msg.content.includes('## Current Task') ||
                    msg.content.includes('## Conversation History') ||
                    msg.content.includes('## Your Recent Actions') ||
                    msg.content.includes('## Current Message') ||
                    msg.content.includes('## MISSION') ||
                    msg.content.includes('## PARTICIPANTS') ||
                    msg.content.includes('## REQUIREMENTS') ||
                    msg.content.includes('## COMPLETION') ||
                    msg.content.includes('## TASK CONTEXT') ||
                    msg.content.includes('📋 RECOMMENDED WORKFLOW')) {
                    return false;
                }
                
                // Only include actual agent messages
                return true;
            });

        // Take last N messages (excluding the current message if it's the last one)
        const historyMessages = cleanMessages.slice(-maxMessages - 1, -1);

        if (historyMessages.length === 0) {
            // Check if this is the first interaction with a specific agent
            const currentSender = this.getMessageSenderName(conversationHistory[conversationHistory.length - 1]);
            if (currentSender && currentSender !== 'Unknown' && currentSender !== 'External') {
                return `(No previous conversation with ${currentSender})`;
            }
            return '(No previous conversation)';
        }

        // Format messages with proper attribution
        const formattedMessages = historyMessages.map(msg => {
            const senderName = this.getMessageSenderName(msg);
            // Clean up the message content
            let content = msg.content.trim();
            
            // Remove any [sender]: prefix if it exists (to avoid duplication)
            content = content.replace(/^\[[^\]]+\]:\s*/, '');
            
            return `[${senderName}]: ${content}`;
        });

        return formattedMessages.join('\n');
    }

    /**
     * Extract SystemLLM insight (ephemeral, most recent only)
     */
    private extractSystemLLMInsight(conversationHistory: ConversationMessage[]): string | null {
        // Look for the most recent SystemLLM message
        const systemInsights = conversationHistory
            .filter(msg => 
                msg.content.includes('[SystemLLM]') ||
                msg.content.includes('SYSTEM NOTICE') ||
                (msg.role === 'user' && msg.metadata?.isSystemLLM)
            )
            .slice(-1); // Only the most recent

        if (systemInsights.length === 0) {
            return null;
        }

        // Extract the insight content
        let insight = systemInsights[0].content;
        
        // Remove the [SystemLLM] prefix if present
        insight = insight.replace(/^\[SystemLLM\]:?\s*/i, '');
        insight = insight.replace(/^SYSTEM NOTICE:?\s*/i, '');

        return insight;
    }

    /**
     * Get reasoning history from the service
     */
    private async getReasoningHistory(maxEntries: number = 10): Promise<string | null> {
        const history = await this.reasoningHistoryService.getFormattedReasoningHistory(
            this.agentId,
            maxEntries
        );
        
        if (!history) {
            return '(No reasoning history available)';
        }
        
        return history;
    }
    
    /**
     * Add reasoning to history (for reasoning models)
     */
    public async addReasoningToHistory(
        reasoning: string,
        decision?: string,
        confidence?: number,
        context?: string
    ): Promise<void> {
        if (this.agentConfig.reasoning?.enabled) {
            await this.reasoningHistoryService.addReasoning(
                this.agentId,
                reasoning,
                decision,
                confidence,
                context,
                this.agentConfig.defaultModel
            );
        }
    }

    /**
     * Extract actual message content from tool call notifications
     */
    private extractMessageContent(content: string): string {
        // Check if this is a tool call notification
        if (content.includes('TOOL CALL NOTIFICATION')) {
            // Extract the actual message content from the TOOL DETAILS section
            const contentMatch = content.match(/- Content: ([^\n]+)/i);
            if (contentMatch && contentMatch[1]) {
                // Clean up the extracted content
                let extracted = contentMatch[1].trim();
                // Remove any JSON stringification artifacts
                if (extracted.startsWith('"') && extracted.endsWith('"')) {
                    extracted = extracted.slice(1, -1);
                }
                return extracted;
            }
        }
        
        // Check if this is a tool details block and extract content
        if (content.includes('TOOL DETAILS:')) {
            const lines = content.split('\n');
            for (const line of lines) {
                if (line.includes('- Content:')) {
                    let extracted = line.replace(/^.*- Content:\s*/, '').trim();
                    // Remove any JSON stringification artifacts
                    if (extracted.startsWith('"') && extracted.endsWith('"')) {
                        extracted = extracted.slice(1, -1);
                    }
                    return extracted;
                }
            }
        }
        
        // If not a tool call notification, return as-is but clean up common prefixes
        let cleanContent = content;
        
        // Remove [External]: prefix if present
        cleanContent = cleanContent.replace(/^\[External\]:\s*/i, '');
        
        // Remove any tool-related headers
        cleanContent = cleanContent.replace(/^.*TOOL CALL NOTIFICATION:.*\n/, '');
        cleanContent = cleanContent.replace(/^TOOL DETAILS:.*\n/, '');
        
        // Remove "What would you like to do?" prompt if present
        cleanContent = cleanContent.replace(/\nWhat would you like to do\?\s*$/, '');
        
        // If we still have multi-line content with TOOL DETAILS, extract just the message
        if (cleanContent.includes('\n') && (cleanContent.includes('Tool Used:') || cleanContent.includes('From Agent:'))) {
            // This is likely still a tool message, try to extract just the content line
            const lines = cleanContent.split('\n');
            // Look for the actual message, skipping tool metadata
            for (const line of lines) {
                if (!line.includes(':') && line.trim() && 
                    !line.includes('Please review') && 
                    !line.includes('You have') &&
                    !line.includes('TOOL') &&
                    !line.includes('- ')) {
                    return line.trim();
                }
            }
        }
        
        return cleanContent.trim();
    }

    /**
     * Get proper sender name for message attribution
     */
    private getMessageSenderName(msg: ConversationMessage): string {
        // Check for agentId in metadata (most common for agent messages)
        if (msg.metadata?.agentId) {
            return msg.metadata.agentId;
        }
        
        // Check for fromAgentId (used in message events)
        if (msg.metadata?.fromAgentId) {
            return msg.metadata.fromAgentId;
        }
        
        // Check for sender information
        if (msg.metadata?.senderId) {
            return msg.metadata.senderId;
        }
        
        // Check for senderAgentId
        if (msg.metadata?.senderAgentId) {
            return msg.metadata.senderAgentId;
        }
        
        // Check content for TOOL CALL NOTIFICATION pattern
        if (msg.content.includes('From Agent:')) {
            const fromMatch = msg.content.match(/- From Agent:\s*([^\n]+)/);
            if (fromMatch && fromMatch[1]) {
                return fromMatch[1].trim();
            }
        }
        
        // Role-based fallback
        if (msg.role === 'assistant') {
            return 'You'; // Agent's own previous responses
        } else if (msg.role === 'user') {
            // Try to extract from content patterns
            const match = msg.content.match(/^\[([^\]]+)\]:/);
            if (match && match[1] !== 'External') {
                return match[1];
            }
            
            // If we can't determine the sender and it's a user message,
            // it's likely from another agent, but we don't know which one
            // Rather than 'External', we should try to be more specific
            return 'Agent';
        }
        
        return 'Unknown';
    }

    /**
     * Create a clean system prompt message
     */
    public createSystemPromptMessage(content: string): ConversationMessage {
        return {
            id: `system-prompt-${Date.now()}`,
            role: 'system',
            content: content,
            timestamp: Date.now(),
            metadata: {
                layer: 'system',
                persistent: true
            }
        };
    }

    /**
     * Create a clean task prompt message
     */
    public createTaskPromptMessage(content: string): ConversationMessage {
        return {
            id: `task-prompt-${Date.now()}`,
            role: 'user',
            content: content, // Content should already be formatted by caller
            timestamp: Date.now(),
            metadata: {
                layer: 'task',
                persistent: false
            }
        };
    }

    /**
     * Create an ephemeral SystemLLM message
     */
    public createSystemLLMMessage(content: string): ConversationMessage {
        return {
            id: `systemllm-${Date.now()}`,
            role: 'user',
            content: `[SystemLLM]: ${content}`,
            timestamp: Date.now(),
            metadata: {
                layer: 'systemLLM',
                ephemeral: true,
                isSystemLLM: true
            }
        };
    }
}
