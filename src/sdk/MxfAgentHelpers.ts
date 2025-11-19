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
 * Helper functions for MxfAgent
 * 
 * This file contains utility functions and helper methods extracted from MxfAgent
 * to improve code organization and maintainability.
 */

import { ConversationMessage } from '../shared/interfaces/ConversationMessage';
import { McpMessage, McpRole, McpContentType } from '../shared/protocols/mcp/IMcpClient';
import { Logger } from '../shared/utils/Logger';
import * as fs from 'fs';
import * as path from 'path';

export interface ToolExecutionResult {
    success?: boolean;
    delivered?: boolean;
    result?: any;
    status?: string;
    error?: string;
    message?: string;
    failed?: boolean;
    // MCP standardized format support
    content?: {
        type: string;
        data: any;
    };
}

export interface TaskContext {
    id?: string;
    title?: string;
    description?: string;
    leadAgentId?: string;
    metadata?: {
        isCompletionAgent?: boolean;
        multiAgentTask?: boolean;
        agentRole?: string;
        completionAgentId?: string;
    };
}

export interface AgentContext {
    agentId: string;
    currentTask?: TaskContext;
    disableToolGatekeeping?: boolean;
    allowedTools?: string[];  // Agent-specific tool filtering
}

/**
 * Tool Management Helpers
 */
export class ToolHelpers {
    /**
     * Smart gatekeeping: Provide contextually relevant tools based on conversation state
     * This reduces cognitive load while maintaining tool discovery capabilities
     */
    static getContextualTools(
        conversationHistory: ConversationMessage[], 
        allTools: any[], 
        context: AgentContext,
        logger: Logger
    ): any[] {
        // Handle empty tools array - this is a critical error that needs to be fixed
        if (!allTools || allTools.length === 0) {
            logger.error('❌ SMART GATE: No tools available - cannot provide contextual tools');
            return [];
        }

        // FIRST: Apply agent-specific tool filtering (allowedTools takes precedence)
        let filteredTools = allTools;
        if (context.allowedTools && context.allowedTools.length > 0) {
            filteredTools = allTools.filter(tool => {
                const toolName = tool.name || tool.function?.name || '';
                const isAllowed = context.allowedTools!.includes(toolName);
                if (!isAllowed) {
                    //;
                }
                return isAllowed;
            });
            
            // CRITICAL FIX: When allowedTools is explicitly set, skip contextual filtering
            // The server has already done the filtering, and contextual filtering would
            // exclude tools like task_create that don't match specific patterns
            return filteredTools;
        }

        // Guard: Check if tool gatekeeping is disabled (only affects contextual filtering, not allowedTools)
        if (context.disableToolGatekeeping === true) {
            return filteredTools;
        }

        // Deduplicate tools by name (keep first occurrence)
        const uniqueToolsMap = new Map<string, any>();
        for (const tool of filteredTools) {
            if (!uniqueToolsMap.has(tool.name)) {
                uniqueToolsMap.set(tool.name, tool);
            }
        }
        const uniqueTools = Array.from(uniqueToolsMap.values());
        
    
    // Filter out recently executed tools to prevent redundant calls
    const recentlyExecutedTools = ToolHelpers.getRecentlyExecutedTools(conversationHistory, logger);
    const toolsFilteredByRecency = uniqueTools.filter(tool => {
        const wasRecentlyExecuted = recentlyExecutedTools.includes(tool.name);
        if (wasRecentlyExecuted) {
        }
        return !wasRecentlyExecuted;
    });
    
    
    if (context.disableToolGatekeeping) {
        return toolsFilteredByRecency;
    }
        
        // Check if agent is designated completion agent for current task
        const isCompletionAgent = TaskHelpers.isCurrentTaskCompletionAgent(context, logger);
        
        // Conditionally include meta tools based on task role
        const metaTools = toolsFilteredByRecency.filter(tool => {
            if (tool.name === 'task_complete') {
                // For single-agent tasks or when gatekeeping is disabled, always include
                if (!context.currentTask?.metadata?.multiAgentTask || context.disableToolGatekeeping) {
                    return true;
                }
                
                // For multi-agent tasks, be more lenient
                // Include if: designated completion agent OR no completion agent is explicitly set
                if (isCompletionAgent || !context.currentTask?.metadata?.completionAgentId) {
                    return true;
                }
                
                // Only exclude if another agent is explicitly designated
                return false;
            }
            // Always include tools_recommend for discovery
            return ['tools_recommend'].includes(tool.name);
        });
        
        if (!isCompletionAgent) {
        }
        
        // Always include core MXF communication tools and validation
        const coreTools = toolsFilteredByRecency.filter(tool => 
            tool.name.startsWith('messaging_') || 
            tool.name.startsWith('controlLoop_') ||
            tool.name === 'validate_next_action' || // Always include for validation checkpoints
            tool.name === 'no_further_action' // Always include for graceful turn ending
        );
        
        // Start with essential tools
        const contextualTools = [...metaTools, ...coreTools];
        
        // Analyze conversation for context clues
        const conversationText = conversationHistory
            .map(msg => msg.content || '')
            .join(' ')
            .toLowerCase();
        
        // Add tools based on conversation content
        if (conversationText.includes('file') || conversationText.includes('read') || conversationText.includes('write')) {
            const fileTools = toolsFilteredByRecency.filter(tool => 
                tool.name.startsWith('filesystem_') || 
                tool.name === 'read_file' || 
                tool.name === 'write_file' ||
                tool.name === 'list_directory'
            );
            contextualTools.push(...fileTools);
        }
        
        if (conversationText.includes('shell') || conversationText.includes('command') || conversationText.includes('execute')) {
            const shellTools = toolsFilteredByRecency.filter(tool => 
                tool.name === 'shell_execute' ||
                tool.name === 'run_command'
            );
            contextualTools.push(...shellTools);
        }
        
        if (conversationText.includes('memory') || conversationText.includes('context') || conversationText.includes('remember')) {
            const memoryTools = toolsFilteredByRecency.filter(tool => 
                tool.name.includes('memory') || 
                tool.name.includes('context')
            );
            contextualTools.push(...memoryTools);
        }
        
        if (conversationText.includes('time') || conversationText.includes('date') || conversationText.includes('datetime') || conversationText.includes('timezone')) {
            const datetimeTools = toolsFilteredByRecency.filter(tool => 
                tool.name.startsWith('datetime_') ||
                tool.name.includes('time') ||
                tool.name.includes('date')
            );
            contextualTools.push(...datetimeTools);
        }
        
        // Remove duplicates from final list
        const finalTools = Array.from(new Map(contextualTools.map(tool => [tool.name, tool])).values());
        
    
    // Log which tools were excluded for debugging
    if (recentlyExecutedTools.length > 0) {
    }
        
        return finalTools;
    }

    /**
     * Get list of tools that were recently executed successfully
     * This helps prevent redundant tool calls by filtering them from recommendations
     */
    static getRecentlyExecutedTools(conversationHistory: ConversationMessage[], logger: Logger): string[] {
        try {
            const recentlyExecutedTools: string[] = [];
            
            // Look for successful tool execution acknowledgments in recent conversation
            // We check the last few messages to identify recently executed tools
            const recentMessages = conversationHistory.slice(-5); // Check last 5 messages
            
            for (const message of recentMessages) {
                if (message.role === 'user' && message.content) {
                    // Look for tool execution acknowledgment patterns
                    const toolExecutionPattern = /✅ TOOL EXECUTION ACKNOWLEDGMENT: (\w+) completed successfully/g;
                    let match;
                    
                    while ((match = toolExecutionPattern.exec(message.content)) !== null) {
                        const toolName = match[1];
                        if (!recentlyExecutedTools.includes(toolName)) {
                            recentlyExecutedTools.push(toolName);
                            //;
                        }
                    }
                }
            }
            
            //;
            return recentlyExecutedTools;
            
        } catch (error) {
            return [];
        }
    }

    /**
     * Parse JSON tool calls from text content
     * Handles both single tool calls and arrays, with optional markdown formatting
     */
    static parseJsonToolCalls(text: string, availableTools: any[], logger: Logger): any[] {
        try {
            
            // Remove markdown code block formatting if present
            const cleanedText = text.replace(/```json\s*/g, '').replace(/```\s*/g, '');
            
            // Try to find JSON patterns in the text - improved regex for nested objects
            const jsonMatches = ToolHelpers.extractCompleteJsonObjects(cleanedText);
            
            if (!jsonMatches || jsonMatches.length === 0) {
                return [];
            }
            
            const toolCalls: any[] = [];
            
            // Look for tool name mentions in the text before the JSON
            const toolNameMatch = text.match(/(?:use|call|invoke)\s+`?([a-zA-Z_][a-zA-Z0-9_]*)`?/i);
            const mentionedToolName = toolNameMatch ? toolNameMatch[1] : null;
            
            for (const jsonMatch of jsonMatches) {
                try {
                    const parsed = JSON.parse(jsonMatch);
                    
                    // Check if this looks like a complete tool call (has name and arguments)
                    if (parsed.name && typeof parsed.name === 'string') {
                        const toolCall = {
                            name: parsed.name,
                            input: parsed.arguments || parsed.input || {},
                            id: `tool-call-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
                        };
                        
                        toolCalls.push(toolCall);
                    } else {
                        // If no name, try to infer from mentioned tool name
                        if (mentionedToolName) {
                            const toolCall = {
                                name: mentionedToolName,
                                input: parsed,
                                id: `tool-call-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
                            };
                            toolCalls.push(toolCall);
                        } else {
                            // If no name and no mentioned tool name, generate a correction
                            
                            // Try to intelligently match malformed call to available tools
                            const correctedCall = ToolHelpers.generateToolCallCorrection(parsed, availableTools, logger);
                            logger.warn(`Generated correction message: ${correctedCall.substring(0, 200)}...`);
                            
                            // Return special error object to be handled by caller
                            toolCalls.push({
                                name: '__SYSTEM_ERROR__',
                                input: {
                                    errorType: 'malformed_tool_call',
                                    message: correctedCall
                                },
                                id: `error-${Date.now()}`
                            });
                        }
                    }
                } catch (parseError) {
                    // Skip individual JSON parsing errors
                    logger.warn(`Skipping invalid JSON: ${jsonMatch} - Error: ${parseError}`);
                }
            }
            
            return toolCalls;
        } catch (error) {
            logger.error(`Error parsing JSON tool calls: ${error}`);
            return [];
        }
    }

    /**
     * Generate a correction for a malformed tool call using intelligent pattern matching
     */
    static generateToolCallCorrection(parsed: any, availableTools: any[], logger: Logger): string {
        try {
            const parsedKeys = Object.keys(parsed);
            
            if (availableTools.length === 0) {
                logger.warn('No available tools for tool call correction');
                return `Use format: {"name": "tool_name", "arguments": {...}}`;
            }
            
            let bestMatch: { tool: any; score: number } | null = null;
            
            // Score each tool against the malformed JSON
            for (const tool of availableTools) {
                const score = ToolHelpers.scoreToolMatch(parsed, tool);
                if (!bestMatch || score > bestMatch.score) {
                    bestMatch = { tool, score };
                }
            }
            
            
            // If we found a good match (score > 0), provide specific correction
            if (bestMatch && bestMatch.score > 0) {
                return `Use this format for ${bestMatch.tool.name}:
{
  "name": "${bestMatch.tool.name}",
  "arguments": {
    // your parameters here
  }
}`;
            }
            
            // Generic correction using best guess
            const likelyToolName = bestMatch?.tool?.name || 'messaging_send';
            return `Use this format:
{
  "name": "${likelyToolName}",
  "arguments": {
    // your parameters here
  }
}

Available tools: ${availableTools.map((t: any) => t.name).join(', ')}`;
            
        } catch (error) {
            logger.error(`Error generating tool call correction: ${error}`);
            return `Use format: {"name": "tool_name", "arguments": {...}}`;
        }
    }

    /**
     * Score how well a malformed JSON matches a tool's expected schema
     */
    static scoreToolMatch(parsed: any, tool: any): number {
        try {
            const parsedKeys = Object.keys(parsed);
            let score = 0;
            
            // Check if tool has input schema
            if (!tool.inputSchema || !tool.inputSchema.properties) {
                return 0;
            }
            
            // Score based on matching keys
            for (const key of parsedKeys) {
                if (tool.inputSchema.properties[key]) {
                    score += tool.inputSchema.required?.includes(key) ? 3 : 1; // Higher score for required keys
                }
            }
            
            // Bonus points if all required keys are present
            const requiredKeys = tool.inputSchema.required || [];
            const missingRequired = requiredKeys.filter((key: string) => !parsedKeys.includes(key));
            if (missingRequired.length === 0 && requiredKeys.length > 0) {
                score += 5;
            }
            
            return Math.max(0, score);
        } catch (error) {
            return 0;
        }
    }

    /**
     * Extract complete JSON objects from a string
     */
    static extractCompleteJsonObjects(text: string): string[] | null {
        const jsonStrings: string[] = [];
        let i = 0;
        
        while (i < text.length) {
            // Find the start of a potential JSON object
            if (text[i] === '{') {
                let braceCount = 1;
                let start = i;
                let j = i + 1;
                let inString = false;
                let escaped = false;
                
                // Track braces until we find the complete object
                while (j < text.length && braceCount > 0) {
                    const char = text[j];
                    
                    if (escaped) {
                        escaped = false;
                    } else if (char === '\\' && inString) {
                        escaped = true;
                    } else if (char === '"') {
                        inString = !inString;
                    } else if (!inString) {
                        if (char === '{') {
                            braceCount++;
                        } else if (char === '}') {
                            braceCount--;
                        }
                    }
                    
                    j++;
                }
                
                // If we found a complete object, extract it
                if (braceCount === 0) {
                    const jsonString = text.substring(start, j);
                    try {
                        // Validate by parsing
                        JSON.parse(jsonString);
                        jsonStrings.push(jsonString);
                    } catch (e) {
                        // Invalid JSON, skip
                    }
                    i = j;
                } else {
                    i++;
                }
            } else {
                i++;
            }
        }
        
        return jsonStrings.length > 0 ? jsonStrings : null;
    }
}

/**
 * Tool Execution Result Helpers
 */
export class ToolExecutionHelpers {
    /**
     * Check if tool execution was successful
     */
    static isToolExecutionSuccessful(toolResult: ToolExecutionResult): boolean {
        // Handle different tool result formats
        
        // Standard success property
        if (typeof toolResult.success === 'boolean') {
            return toolResult.success;
        }
        
        // Messaging tools return { delivered: boolean }
        if (typeof toolResult.delivered === 'boolean') {
            return toolResult.delivered;
        }
        
        // Some tools return nested result with success
        if (toolResult.result && typeof toolResult.result.success === 'boolean') {
            return toolResult.result.success;
        }
        
        // Some tools return status-based success
        if (toolResult.status) {
            return toolResult.status === 'success' || toolResult.status === 'completed' || toolResult.status === 'task_completed';
        }
        
        // If tool returned a result without error, assume success
        if (toolResult && !toolResult.error && !toolResult.failed) {
            return true;
        }
        
        // Default to false if we can't determine success
        return false;
    }

    /**
     * Get basic tool result message
     */
    static getToolResultMessage(toolResult: ToolExecutionResult, toolName: string): string {
        if (ToolExecutionHelpers.isToolExecutionSuccessful(toolResult)) {
            return `✅ ${toolName} completed successfully`;
        } else {
            return `❌ ${toolName} failed: ${toolResult.error || toolResult.message || 'Unknown error'}`;
        }
    }

    /**
     * Get detailed tool result message with guidance
     * Returns a brief confirmation instead of verbose acknowledgment
     */
    static getDetailedToolResultMessage(
        toolResult: ToolExecutionResult, 
        toolName: string, 
        toolInput: any, 
        availableTools?: any[]
    ): string {
        // Return brief confirmations that will be shown as [Tool Result] in the prompt
        // These should NOT become part of conversation history
        if (ToolExecutionHelpers.isToolExecutionSuccessful(toolResult)) {
            // CRITICAL: Check if result has content wrapper or is legacy format
            if (!toolResult.content) {
                // Legacy format - plain object without content wrapper
                // Examples: TaskBridgeTools, old InfrastructureTools
                if (toolResult.result) {
                    return typeof toolResult.result === 'string' ? toolResult.result : JSON.stringify(toolResult.result);
                }
                // Return entire result as JSON
                return JSON.stringify(toolResult);
            }
            // Handle MCP standardized format { content: { type, data } }
            else if (toolResult.content?.data) {
                const data = toolResult.content.data;
                // Return the actual data content
                if (typeof data === 'string') {
                    return data;
                }
                return JSON.stringify(data);
            }
            // Handle alternative format { content: { type, text } }
            else if ((toolResult.content as any)?.text) {
                return (toolResult.content as any).text;
            }
            // Handle direct data field { type: "application/json", data: {...} }
            else if ((toolResult as any).data !== undefined) {
                const data = (toolResult as any).data;
                if (typeof data === 'string') {
                    return data;
                }
                return JSON.stringify(data);
            }
            // Handle legacy format with .result (shouldn't reach here if !content check works)
            else if (toolResult.result) {
                const result = toolResult.result;
                if (typeof result === 'string') {
                    return result;
                }
                return JSON.stringify(result);
            }
            // Fallback only if neither format is present
            else {
                return 'Success';
            }
        } else {
            // For errors, return brief error message
            return `Error: ${toolResult.error || toolResult.message || 'Tool execution failed'}`;
        }
    }
    
    /**
     * Extract just tool names from tool array for minimal feedback
     */
    static getToolNamesOnly(tools: any[]): string[] {
        return tools.map(tool => {
            if (typeof tool === 'object' && tool !== null) {
                return tool.name || tool.function?.name || 'unknown_tool';
            }
            return String(tool);
        }).filter(name => name !== 'unknown_tool');
    }
}

/**
 * Task Management Helpers
 */
export class TaskHelpers {
    /**
     * Check if current agent is designated as the completion agent for the current task
     */
    static isCurrentTaskCompletionAgent(context: AgentContext, logger: Logger): boolean {
        try {
            // Check if we have an active task assigned to this agent
            const currentTask = context.currentTask;
            if (!currentTask) {
                // No active task - allow task_complete for single operations
                //;
                return true;
            }
            
            // Check task metadata for completion designation
            const metadata = currentTask.metadata;
            
            if (metadata && typeof metadata.isCompletionAgent === 'boolean') {
                //;
                return metadata.isCompletionAgent;
            }
            
            // For single-agent tasks, the agent handles completion
            if (!metadata?.multiAgentTask) {
                //;
                return true;
            }
            
            // For multi-agent tasks without explicit designation, check if current agent is lead agent
            if (currentTask.leadAgentId && currentTask.leadAgentId === context.agentId) {
                //;
                return true;
            }
            
            // For multi-agent tasks without explicit designation, default to false
            // This prevents multiple agents from calling task_complete
            //;
            return false;
            
        } catch (error) {
            logger.warn(`Could not determine completion agent status: ${error}`);
            // Default to false for safety in multi-agent scenarios
            return false;
        }
    }

    /**
     * Build task-specific guidance based on agent role in the task
     */
    static buildTaskSpecificGuidance(
        task: TaskContext,
        agentId: string,
        agentRole: string = 'contributor'
    ): string {
        // Task-specific guidance is now handled in the task prompt
        // This method returns empty string to avoid duplication
        return '';
    }
}

/**
 * Conversation Helpers
 */
export class ConversationHelpers {
    /**
     * Convert internal conversation format to MCP message format
     * 
     * IMPORTANT: This method does NOT reorder messages. Each MCP provider client
     * is responsible for reordering messages according to its specific requirements:
     * - OpenRouter: Needs strict tool_call → tool_result pairing
     * - Azure: Needs natural conversation flow with responses
     * - Others: May have different requirements
     */
    static createMcpMessages(messages: ConversationMessage[]): McpMessage[] {
        // Convert messages directly to MCP format without reordering
        return messages.map(message => {
            // LayeredPromptAssembler now returns role directly
            // Convert string role to McpRole enum
            let role: McpRole;
            const msgRole = message.role || 'user';
            
            switch (msgRole.toLowerCase()) {
                case 'system':
                    role = McpRole.SYSTEM;
                    break;
                case 'assistant':
                    role = McpRole.ASSISTANT;
                    break;
                case 'tool':
                    role = McpRole.TOOL;
                    break;
                case 'user':
                default:
                    role = McpRole.USER;
                    break;
            }
            
            // No need for special handling - tool role is already set correctly
            
            // Extract content  
            const content = typeof message.content === 'string' 
                ? message.content 
                : (message.content as any)?.data || JSON.stringify(message.content);
            
            // Validate content
            if (!content) {
            }
            
            // Create base MCP message
            const mcpMessage: McpMessage = {
                role: role, // Respect LayeredPromptAssembler's role assignments
                content: {
                    type: McpContentType.TEXT,
                    text: content
                }
            };
            
            // Include tool_calls if present (for assistant messages with tool calls)
            if (message.role === 'assistant') {
                const hasToolCalls = !!(message as any).tool_calls;
                if (hasToolCalls) {
                    (mcpMessage as any).tool_calls = (message as any).tool_calls;
                }
            }
            
            // Include tool_call_id for tool role messages
            if (role === McpRole.TOOL && message.metadata?.tool_call_id) {
                (mcpMessage as any).tool_call_id = message.metadata.tool_call_id;
            }
            
            return mcpMessage;
        });
    }

    /**
     * Create immediate tool feedback prompt for targeted tool calls
     */
    static createImmediateToolFeedbackPrompt(
        fromAgentId: string, 
        toolName: string, 
        toolData: any, 
        toolType: string
    ): string {
        return `
🎯 TOOL CALL NOTIFICATION: You have been targeted by a ${toolType} from agent "${fromAgentId}".

TOOL DETAILS:
- Tool Used: ${toolName}
- From Agent: ${fromAgentId}
- Content: ${typeof toolData === 'string' ? toolData : JSON.stringify(toolData)}
- Type: ${toolType}
- Timestamp: ${new Date().toISOString()}

Please review this tool call and decide how to respond or proceed. You have full autonomy to:
- Respond if appropriate
- Take action based on the content
- Ignore if not relevant to your current task
- Use any available tools as needed

What would you like to do?`;
    }
}

/**
 * Utility Helpers
 */
export class UtilityHelpers {
    /**
     * Write debug log to file
     */
    static writeDebugLog(message: string, data: any, agentId: string): void {
        const logDir = path.join(__dirname, '..', '..', 'logs');
        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir);
        }
        const logFile = path.join(logDir, `debug-${agentId}.log`);
        const logEntry = `${new Date().toISOString()} ${message} ${JSON.stringify(data)}\n`;
        fs.appendFileSync(logFile, logEntry);
    }
}