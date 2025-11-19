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
 * StructuredPromptBuilder - Clean prompt assembly without string manipulation
 * 
 * This replaces the LayeredPromptAssembler with a cleaner approach that:
 * - Uses structured data instead of string parsing
 * - Maintains clean separation between message types
 * - Builds prompts exactly as the LLM expects them
 */

import { Logger } from '../../shared/utils/Logger';
import { ConversationMessage } from '../../shared/interfaces/ConversationMessage';
import { AgentConfig } from '../../shared/interfaces/AgentInterfaces';
import { MxfActionHistoryService } from './MxfActionHistoryService';
import { MxfReasoningHistoryService } from './MxfReasoningHistoryService';

export interface DialogueMessage {
    agentId: string;      // Who sent this message
    content: string;      // The actual message content
    timestamp: number;    // When it was sent
    type: 'sent' | 'received';  // From this agent's perspective
    toolCalls?: any[];    // Preserve tool_calls if present (camelCase version)
    tool_calls?: any[];   // Also support underscore version for compatibility
    toolCallId?: string;  // Link to original tool call for tool results
}

export interface PromptStructure {
    systemPrompt: string;
    agentIdentity: string;
    taskPrompt: string | null;
    recentActions: string[];
    conversationHistory: DialogueMessage[];
    systemLLMInsight: string | null;
    currentMessage: DialogueMessage | null;
    meilisearchNotice?: {
        enabled: boolean;
        trimmedCount: number;
        totalCount: number;
    };
}

export class MxfStructuredPromptBuilder {
    private logger: Logger;
    private agentId: string;
    private agentConfig: AgentConfig;
    public readonly actionHistoryService: MxfActionHistoryService;
    public readonly reasoningHistoryService: MxfReasoningHistoryService;
    
    constructor(agentId: string, agentConfig: AgentConfig) {
        this.agentId = agentId;
        this.agentConfig = agentConfig;
        this.logger = new Logger('debug', `StructuredPromptBuilder:${agentId}`, 'client');
        this.actionHistoryService = new MxfActionHistoryService();
        this.reasoningHistoryService = new MxfReasoningHistoryService({
            maxEntries: 50,
            maxAge: 3600000 // 1 hour
        });
    }
    
    /**
     * Build structured prompt data from conversation history
     */
    public async buildPromptStructure(
        systemPrompt: string,
        taskPrompt: string | null,
        conversationHistory: ConversationMessage[]
    ): Promise<PromptStructure> {
        // Extract dialogue messages from conversation history
        const dialogue = this.extractDialogueMessages(conversationHistory);

        // Get recent actions
        const actions = await this.getRecentActions();

        // Extract SystemLLM insight if present
        const systemLLMInsight = this.findSystemLLMInsight(conversationHistory);

        // Find current message (most recent incoming)
        const currentMessage = this.getCurrentMessage(dialogue);

        // Build agent identity prompt
        const agentIdentity = await this.buildAgentIdentity();

        // CRITICAL FIX: Don't exclude assistant messages with tool_calls from conversation history
        // Only exclude USER messages from current processing to avoid duplication
        const lastMessage = dialogue[dialogue.length - 1];
        const shouldExcludeLast = lastMessage?.type === 'received' && !lastMessage.toolCallId;

        // Hybrid prompt approach: Recent messages + Meilisearch notice for older context
        const finalDialogue = shouldExcludeLast ? dialogue.slice(0, -1) : dialogue;
        const isMeilisearchEnabled = process.env.ENABLE_MEILISEARCH !== 'false';
        const recentMessageLimit = 15; // Keep most recent 15 messages

        let trimmedDialogue = finalDialogue;
        let meilisearchNotice = undefined;

        if (isMeilisearchEnabled && finalDialogue.length > recentMessageLimit) {
            // Trim to most recent messages
            const trimmedCount = finalDialogue.length - recentMessageLimit;
            trimmedDialogue = finalDialogue.slice(-recentMessageLimit);

            meilisearchNotice = {
                enabled: true,
                trimmedCount,
                totalCount: finalDialogue.length
            };

        }

        return {
            systemPrompt,
            agentIdentity,
            taskPrompt,
            recentActions: actions,
            conversationHistory: trimmedDialogue,
            systemLLMInsight,
            currentMessage: shouldExcludeLast ? currentMessage : null,
            meilisearchNotice
        };
    }
    
    /**
     * Convert structured prompt to LLM messages
     * Uses proper turn-based conversation structure instead of text blobs
     */
    public structureToMessages(structure: PromptStructure): ConversationMessage[] {
        const messages: ConversationMessage[] = [];
        
        // 1. System prompt (framework rules)
        messages.push({
            id: `system-${Date.now()}`,
            role: 'system',
            content: structure.systemPrompt,
            timestamp: Date.now(),
            metadata: { layer: 'system' }
        });
        
        // 2. Agent identity as system context
        messages.push({
            id: `identity-${Date.now()}`,
            role: 'user',
            content: structure.agentIdentity,
            timestamp: Date.now(),
            metadata: { layer: 'agentConfig' }
        });
        
        // 3. Task prompt
        if (structure.taskPrompt) {
            messages.push({
                id: `task-${Date.now()}`,
                role: 'user',
                content: `## Current Task\n${structure.taskPrompt}`,
                timestamp: Date.now(),
                metadata: { layer: 'task' }
            });
        }
        
        // 4. Recent actions context (keep as single message for context)
        if (structure.recentActions.length > 0) {
            const actionsContent = [
                '## Your Recent Actions',
                ...structure.recentActions
            ].join('\n');
            
            messages.push({
                id: `actions-${Date.now()}`,
                role: 'user',
                content: actionsContent,
                timestamp: Date.now(),
                metadata: { layer: 'actions' }
            });
        }
        
        // 5. SystemLLM insight (if present, add as system context)
        if (structure.systemLLMInsight) {
            messages.push({
                id: `systemllm-${Date.now()}`,
                role: 'user',
                content: `## Current SystemLLM Insight\n[SystemLLM]: ${structure.systemLLMInsight}`,
                timestamp: Date.now(),
                metadata: { layer: 'systemllm', isSystemLLM: true }
            });
        }

        // 5.5. Meilisearch notice (if conversation history was trimmed)
        if (structure.meilisearchNotice?.enabled) {
            const notice = [
                '## 📚 Conversation Context Notice',
                '',
                `To optimize token usage, this prompt shows only the most recent ${structure.conversationHistory.length} messages.`,
                `${structure.meilisearchNotice.trimmedCount} older messages from this conversation are available via semantic search.`,
                '',
                '**To access older context:**',
                '- Use the `memory_search_conversations` tool to semantically search past messages',
                '- Search by keywords, topics, or concepts from earlier in the conversation',
                '- Example: `memory_search_conversations({ query: "authentication discussion", limit: 5 })`',
                '',
                `**Available history:** ${structure.meilisearchNotice.totalCount} total messages (showing most recent ${structure.conversationHistory.length})`,
                ''
            ].join('\n');

            messages.push({
                id: `meilisearch-notice-${Date.now()}`,
                role: 'user',
                content: notice,
                timestamp: Date.now(),
                metadata: { layer: 'meilisearch-notice', isMeilisearchNotice: true }
            });
        }

        // 6. CRITICAL FIX: Add conversation history as proper turns WITH agent attribution
        // Instead of text blob, each message becomes its own role-based message
        // IMPORTANT: Include agent ID so LLM knows who said what
        if (structure.conversationHistory.length > 0) {
            structure.conversationHistory.forEach((dialogueMsg, index) => {
                // CRITICAL FIX: Handle tool results specially - they need to become TOOL role messages
                if (dialogueMsg.toolCallId) {
                    // This is a tool result - use proper TOOL role directly
                    const toolResultMessage: ConversationMessage = {
                        id: `tool-result-${dialogueMsg.timestamp}-${index}`,
                        role: 'tool', // Use proper TOOL role directly
                        content: dialogueMsg.content,
                        timestamp: dialogueMsg.timestamp,
                        metadata: { 
                            layer: 'conversation',
                            isToolResult: true,
                            tool_call_id: dialogueMsg.toolCallId,
                            fromAgentId: dialogueMsg.agentId
                        }
                    };
                    messages.push(toolResultMessage);
                    return;
                }
                
                // Map dialogue messages to proper roles based on who sent them
                const role = dialogueMsg.type === 'sent' ? 'assistant' : 'user';
                
                // CRITICAL FIX: Don't add agent attribution to assistant messages - it breaks tool_calls
                // Only add attribution to user messages for context
                const content = role === 'assistant' 
                    ? dialogueMsg.content  // Keep assistant content as-is to preserve tool_calls structure
                    : `[${dialogueMsg.agentId}]: ${dialogueMsg.content}`;  // Add attribution to user messages
                
                const message: ConversationMessage = {
                    id: `history-${dialogueMsg.timestamp}-${index}`,
                    role: role,
                    content: content,
                    timestamp: dialogueMsg.timestamp,
                    metadata: { 
                        contextLayer: 'conversation',
                        originalAgentId: dialogueMsg.agentId,
                        fromAgentId: dialogueMsg.type === 'sent' ? dialogueMsg.agentId : undefined,
                        messageType: dialogueMsg.type === 'sent' ? 'agent-message-sent' : 'agent-message-received'
                    }
                };
                
                // CRITICAL: Preserve tool_calls for assistant messages
                // FIX: Check both property names due to naming inconsistency
                if (role === 'assistant' && (dialogueMsg.toolCalls || dialogueMsg.tool_calls)) {
                    (message as any).tool_calls = dialogueMsg.toolCalls || dialogueMsg.tool_calls;
                }
                
                messages.push(message);
            });
        }
        
        // 7. Current message (new incoming message requiring response)
        // IMPORTANT: Include agent attribution so LLM knows who is speaking now
        if (structure.currentMessage) {
            const currentContent = `[${structure.currentMessage.agentId}]: ${structure.currentMessage.content}`;
            
            messages.push({
                id: `current-${Date.now()}`,
                role: 'user',
                content: currentContent,
                timestamp: structure.currentMessage.timestamp,
                metadata: { 
                    layer: 'current',
                    fromAgentId: structure.currentMessage.agentId,
                    requiresResponse: true
                }
            });
        }
        
        return messages;
    }
    
    /**
     * Extract clean dialogue messages from conversation history
     */
    private extractDialogueMessages(history: ConversationMessage[]): DialogueMessage[] {
        const dialogue: DialogueMessage[] = [];
        
        for (const msg of history) {
            // Skip system messages
            if (msg.role === 'system') continue;
            
            // Handle assistant messages (LLM responses, including those with tool_calls)
            if (msg.role === 'assistant') {
                dialogue.push({
                    agentId: msg.metadata?.agentId || this.agentId,
                    content: msg.content,
                    timestamp: msg.timestamp,
                    type: 'sent',
                    toolCalls: (msg as any).tool_calls // Preserve tool_calls if present
                });
                continue;
            }
            
            // Handle tool result messages with proper formatting
            if (msg.metadata?.isToolResult && msg.metadata?.tool_call_id) {
                dialogue.push({
                    agentId: msg.metadata.fromAgentId || this.agentId,
                    content: msg.content, // Content already cleaned in MCP conversion
                    timestamp: msg.timestamp,
                    type: 'sent', // Tool results are sent by this agent
                    toolCallId: msg.metadata.tool_call_id // Link to original tool call
                });
                continue;
            }
            
            // Handle received messages from other agents (with messageType)
            if (msg.metadata?.messageType === 'agent-message-received') {
                dialogue.push({
                    agentId: msg.metadata.fromAgentId || msg.metadata.agentId || 'unknown',
                    content: msg.metadata.messageContent || msg.content,
                    timestamp: msg.metadata.timestamp || msg.timestamp,
                    type: 'received'
                });
                continue;
            }
            
            // Handle sent messages from this agent (with messageType)
            if (msg.metadata?.messageType === 'agent-message-sent') {
                dialogue.push({
                    agentId: this.agentId,
                    content: msg.metadata.messageContent || msg.content,
                    timestamp: msg.metadata.timestamp || msg.timestamp,
                    type: 'sent'
                });
                continue;
            }
            
            // Handle user messages that don't have messageType but are part of conversation
            if (msg.role === 'user' && !msg.metadata?.contextLayer && !msg.metadata?.messageType) {
                // This is likely a conversation message, include it
                dialogue.push({
                    agentId: msg.metadata?.fromAgentId || 'user',
                    content: msg.content,
                    timestamp: msg.timestamp,
                    type: 'received'
                });
            }
        }
        
        return dialogue;
    }
    
    /**
     * Get recent actions from action history service
     */
    private async getRecentActions(maxActions: number = 10): Promise<string[]> {
        const history = await this.actionHistoryService.getFormattedHistory(this.agentId, maxActions);
        
        if (!history || history === '(No recent actions)') {
            return [];
        }
        
        // Split by newlines and filter empty lines
        return history.split('\n').filter(line => line.trim());
    }
    
    /**
     * Find SystemLLM insight from conversation history
     */
    private findSystemLLMInsight(history: ConversationMessage[]): string | null {
        // Look for the most recent SystemLLM message
        for (let i = history.length - 1; i >= 0; i--) {
            const msg = history[i];
            if (msg.metadata?.isSystemLLM || msg.metadata?.source === 'SystemLLM') {
                // Return clean content without prefixes
                return msg.metadata?.insight || msg.content;
            }
        }
        return null;
    }
    
    /**
     * Get the current message (most recent incoming)
     */
    private getCurrentMessage(dialogue: DialogueMessage[]): DialogueMessage | null {
        // Find the most recent received message
        for (let i = dialogue.length - 1; i >= 0; i--) {
            if (dialogue[i].type === 'received') {
                return dialogue[i];
            }
        }
        return null;
    }
    
    /**
     * Build agent identity prompt
     */
    private async buildAgentIdentity(): Promise<string> {
        const { MxfAgentSystemPrompt } = await import('../../shared/prompts/MxfAgentSystemPrompt');
        return MxfAgentSystemPrompt.buildAgentIdentityPrompt(this.agentConfig);
    }
    
    /**
     * Create a clean dialogue message for storage
     */
    public static createDialogueMessage(
        role: 'sent' | 'received',
        agentId: string,
        targetAgentId: string | null,
        content: string,
        messageSource?: {
            sourceType?: 'agent' | 'system' | 'task' | 'memory' | 'context';
            sourceName?: string;
            taskEvent?: string;
        }
    ): ConversationMessage {
        const messageType = role === 'sent' ? 'agent-message-sent' : 'agent-message-received';
        
        // Determine appropriate role based on message source and type
        let conversationRole: 'user' | 'assistant' | 'system' = role === 'sent' ? 'assistant' : 'user';
        
        if (messageSource?.sourceType) {
            switch (messageSource.sourceType) {
                case 'system':
                    conversationRole = 'system';
                    break;
                case 'task':
                    // Initial task creation -> user (triggers response)
                    // Task updates -> system (context only)  
                    // Task completion -> user (triggers final acknowledgment)
                    if (messageSource.taskEvent?.includes('CREATE_REQUEST') || 
                        messageSource.taskEvent?.includes('STARTED')) {
                        conversationRole = 'user';
                    } else if (messageSource.taskEvent?.includes('COMPLETED') ||
                               messageSource.taskEvent?.includes('FAILED')) {
                        conversationRole = 'user';
                    } else {
                        conversationRole = 'system'; // Updates, progress, etc.
                    }
                    break;
                case 'memory':
                case 'context':
                    conversationRole = 'system';
                    break;
                case 'agent':
                default:
                    // Keep original logic for agent-to-agent messages
                    conversationRole = role === 'sent' ? 'assistant' : 'user';
                    break;
            }
        }
        
        return {
            id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            role: conversationRole,
            content: content,
            timestamp: Date.now(),
            metadata: {
                messageType,
                agentId: role === 'sent' ? agentId : (targetAgentId || undefined),
                fromAgentId: role === 'received' ? agentId : undefined,
                toAgentId: role === 'sent' ? (targetAgentId || undefined) : undefined,
                targetAgentId: role === 'sent' ? (targetAgentId || undefined) : undefined,
                messageContent: content,  // Store clean content in metadata
                sourceType: messageSource?.sourceType || 'agent',
                sourceName: messageSource?.sourceName,
                taskEvent: messageSource?.taskEvent
            }
        };
    }
    
    /**
     * Create a SystemLLM insight message
     */
    public static createSystemLLMMessage(insight: string): ConversationMessage {
        return {
            id: `systemllm-${Date.now()}`,
            role: 'user',
            content: insight,
            timestamp: Date.now(),
            metadata: {
                isSystemLLM: true,
                source: 'SystemLLM',
                insight: insight,
                ephemeral: true
            }
        };
    }
}
