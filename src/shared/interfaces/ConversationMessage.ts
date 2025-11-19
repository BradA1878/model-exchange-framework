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
 * Context layer types - what part of the agent's context does this message represent?
 */
export type ContextLayer = 
    | 'system'        // Framework rules and core instructions
    | 'identity'      // Agent configuration and identity
    | 'task'          // Current task description
    | 'conversation'  // Actual agent-to-agent dialogue
    | 'action'        // Action history and recent activities
    | 'current'       // Current message being responded to
    | 'tool-result';  // Tool execution results

/**
 * Message type - semantic meaning of the message
 */
export type MessageType = 
    | 'framework-rules'         // MXF operating environment
    | 'agent-config'            // Agent identity and capabilities
    | 'task-description'        // Task assignment and requirements
    | 'agent-message-sent'      // Message sent by this agent
    | 'agent-message-received'  // Message received from another agent
    | 'tool-result'             // Result from tool execution
    | 'system-notice'           // System intervention or notice
    | 'action-history'          // Historical action summary
    | 'llm-response';           // Direct LLM response

/**
 * Enhanced conversation message metadata
 * 
 * This metadata provides semantic information about messages to enable:
 * - Provider-specific message structuring (Azure vs OpenRouter vs Anthropic)
 * - Intelligent filtering and reordering
 * - Context management and optimization
 * - Relationship tracking between messages
 */
export interface ConversationMessageMetadata {
    // Context Layer: What part of the agent's context is this?
    contextLayer?: ContextLayer;
    
    // Message Type: What is the semantic meaning of this message?
    messageType?: MessageType;
    
    // Relationships: How does this message relate to others?
    inReplyTo?: string;        // Message ID this responds to
    tool_call_id?: string;     // For tool results - which tool call this responds to
    fromAgentId?: string;      // Who sent this message
    toAgentId?: string;        // Who is this message for (if directed)
    
    // Processing Hints: How should this message be handled?
    requiresResponse?: boolean;   // Does this message need a response?
    ephemeral?: boolean;          // Don't persist long-term (e.g., system notices)
    excludeFromMcp?: boolean;     // Skip when sending to LLM (internal only)
    
    // Backward Compatibility: Deprecated fields (keep for now)
    layer?: string;               // DEPRECATED: Use contextLayer
    isToolResult?: boolean;       // DEPRECATED: Use messageType === 'tool-result'
    isSystemLLM?: boolean;        // DEPRECATED: Use messageType === 'system-notice'
    agentId?: string;             // DEPRECATED: Use fromAgentId
    messageContent?: string;      // DEPRECATED: Use content field directly
    
    // Original/Legacy: Allow any other fields for backward compatibility
    [key: string]: any;
}

/**
 * Unified conversation message interface
 * 
 * Represents a single message in an agent's conversation history with rich metadata
 * to enable intelligent processing by MCP clients and other consumers.
 * 
 * Design Principles:
 * - Single source of truth: What's stored is what's used
 * - Rich metadata: Semantic information enables intelligent handling
 * - Provider agnostic: MCP clients interpret metadata for their specific needs
 * - Backward compatible: Optional metadata fields don't break existing code
 */
export interface ConversationMessage {
    // Core fields (always present)
    id: string;
    role: 'user' | 'assistant' | 'system' | 'tool';
    content: string;
    timestamp: number;
    
    // Enhanced metadata (optional, backward compatible)
    metadata?: ConversationMessageMetadata;
    
    // Tool calls (for assistant messages that trigger tool execution)
    tool_calls?: any[];
}
