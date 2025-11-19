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
 * AgentContext - Complete context provided by SDK to MCP clients
 * 
 * This interface represents everything an MCP client needs to structure
 * messages for its specific API (OpenAI, Azure, Anthropic, etc.).
 * 
 * Design Principles:
 * - SDK provides WHAT context exists, MCP clients decide HOW to format it
 * - No reconstruction: Raw conversation history from storage
 * - Provider-agnostic: Each client interprets context for their API
 * - Single source of truth: What's in context is what gets used
 */

import { ConversationMessage } from './ConversationMessage';
import { AgentConfig } from './AgentInterfaces';

/**
 * Task context - information about the current task the agent is working on
 */
export interface TaskContext {
    // Task description/prompt
    description: string;
    
    // Task requirements (optional structured requirements)
    requirements?: string[];
    
    // Completion criteria (what defines task completion)
    completionCriteria?: string[];
    
    // Task metadata
    taskId?: string;
    title?: string;
    status?: string;
    progress?: number;
    assignedBy?: string;
    assignedAt?: number;
}

/**
 * Action entry - a single action the agent has taken
 */
export interface ActionEntry {
    // What action was taken
    action: string;
    
    // When it was taken
    timestamp: number;
    
    // Result of the action (if available)
    result?: string;
    
    // Tool name (if this was a tool call)
    toolName?: string;
    
    // Action metadata
    metadata?: Record<string, any>;
}

/**
 * Complete agent context provided by SDK to MCP clients
 * 
 * This is the CONTRACT between SDK and MCP clients:
 * - SDK: "Here's all the context you need"
 * - MCP Client: "I'll structure this for my provider's API"
 * 
 * Each MCP client can:
 * - Filter messages based on metadata.contextLayer
 * - Combine or split context as needed for their API
 * - Apply provider-specific ordering/formatting rules
 * - Use metadata to intelligently handle tool results, system messages, etc.
 */
export interface AgentContext {
    // ===== CORE CONTEXT (always present) =====
    
    /**
     * System prompt - framework rules and operating environment
     * This defines how the agent should behave within MXF
     */
    systemPrompt: string;
    
    /**
     * Agent configuration - who the agent is and what they can do
     * Includes: agentId, purpose, capabilities, role, department, etc.
     */
    agentConfig: AgentConfig;
    
    // ===== TASK CONTEXT (if agent has an active task) =====
    
    /**
     * Current task the agent is working on
     * null if no active task
     */
    currentTask: TaskContext | null;
    
    // ===== CONVERSATION HISTORY (raw, no reconstruction) =====
    
    /**
     * Complete conversation history from storage
     * 
     * CRITICAL: This is the raw history - no reconstruction, no extraction cycles.
     * Use message.metadata.contextLayer to filter:
     * - 'system': Framework messages (usually skip, already in systemPrompt)
     * - 'identity': Agent config messages (usually skip, already in agentConfig)
     * - 'task': Task description messages (usually skip, already in currentTask)
     * - 'conversation': Actual agent dialogue (ALWAYS include)
     * - 'action': Action history (include as context if needed)
     * - 'tool-result': Tool execution results (ALWAYS include)
     * - 'current': Current message being responded to (handle specially)
     * 
     * Use message.metadata.messageType for semantic meaning:
     * - 'agent-message-sent': This agent sent this message
     * - 'agent-message-received': This agent received this message
     * - 'tool-result': Result from tool execution
     * - etc.
     */
    conversationHistory: ConversationMessage[];
    
    // ===== ACTION HISTORY (recent agent activities) =====
    
    /**
     * Recent actions the agent has taken
     * Useful for context but not always needed in conversation
     */
    recentActions: ActionEntry[];
    
    // ===== TOOLS (available capabilities) =====
    
    /**
     * Tools available to the agent for this request
     * May be filtered based on context and relevance
     */
    availableTools: any[]; // Type depends on tool format (MCP, OpenAI, etc.)
    
    // ===== METADATA =====
    
    /**
     * Agent ID for reference
     */
    agentId: string;
    
    /**
     * Channel ID the agent is operating in
     */
    channelId: string;
    
    /**
     * Timestamp of context creation
     */
    timestamp: number;
    
    /**
     * Additional context-specific metadata
     */
    metadata?: {
        // Is this a follow-up to a tool execution?
        followingToolExecution?: boolean;
        
        // Maximum tokens/messages constraints
        maxTokens?: number;
        maxMessages?: number;
        
        // Provider-specific hints (optional)
        providerHints?: Record<string, any>;
        
        // Any other context metadata
        [key: string]: any;
    };
}

/**
 * Type guard to check if context has an active task
 */
export const hasActiveTask = (context: AgentContext): context is AgentContext & { currentTask: TaskContext } => {
    return context.currentTask !== null;
};

/**
 * Helper to filter conversation history by context layer
 */
export const filterByContextLayer = (
    history: ConversationMessage[],
    layers: string[]
): ConversationMessage[] => {
    return history.filter(msg => 
        msg.metadata?.contextLayer && layers.includes(msg.metadata.contextLayer)
    );
};

/**
 * Helper to get only actual dialogue messages (sent/received between agents)
 */
export const getDialogueMessages = (context: AgentContext): ConversationMessage[] => {
    return filterByContextLayer(context.conversationHistory, ['conversation', 'tool-result']);
};
