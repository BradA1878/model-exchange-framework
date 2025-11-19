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
 * ReasoningToolParser Service
 * 
 * Parses reasoning text from reasoning-capable LLM models to extract tool call intentions.
 * This service enables reasoning models (like o1, o3, deepseek-reasoner, gemini-thinking)
 * to work within MXF's tool-based architecture by interpreting their reasoning output.
 * 
 * Key responsibilities:
 * - Parse reasoning text for tool intentions
 * - Extract tool calls using structured and heuristic methods
 * - Synthesize MCP-compliant tool_calls array
 * - Emit events for observability
 * 
 * Integration:
 * - Called when agent has reasoning.enabled = true
 * - Works with plain-text reasoning output from LLM
 * - Returns tool_calls that integrate with existing MXF flow
 */

import { Logger } from '../utils/Logger';
import { createStrictValidator } from '../utils/validation';
import { EventBus } from '../events/EventBus';
import { AgentEvents } from '../events/EventNames';
import { v4 as uuidv4 } from 'uuid';
import { McpTool, McpToolUseContent, McpContentType } from '../protocols/mcp/IMcpClient';
import { 
    createLlmReasoningParsedEventPayload,
    createLlmReasoningToolsSynthesizedEventPayload,
    LlmReasoningParsedEventData,
    LlmReasoningToolsSynthesizedEventData
} from '../schemas/EventPayloadSchema';

/**
 * Tool intention extracted from reasoning text
 */
export interface ToolIntention {
    toolName: string;
    arguments: Record<string, any>;
    confidence: number;
    reasoning: string;
}

/**
 * Result of reasoning parsing
 */
export interface ReasoningParseResult {
    toolIntentions: ToolIntention[];
    synthesizedToolCalls: McpToolUseContent[];
    parseSuccessful: boolean;
    parseMethod: 'structured' | 'heuristic' | 'failed';
    metadata?: Record<string, any>;
}

/**
 * Configuration for reasoning parser
 */
export interface ReasoningParserConfig {
    confidenceThreshold?: number;  // Minimum confidence to accept tool intention (default: 0.7)
    maxToolsPerParse?: number;     // Maximum tools to extract per reasoning (default: 5)
    enableHeuristics?: boolean;    // Enable heuristic parsing fallback (default: true)
}

const DEFAULT_PARSER_CONFIG: Required<ReasoningParserConfig> = {
    confidenceThreshold: 0.7,
    maxToolsPerParse: 5,
    enableHeuristics: true
};

/**
 * ReasoningToolParser - Parses reasoning text to extract tool intentions
 */
export class ReasoningToolParser {
    private static instance: ReasoningToolParser | null = null;
    
    private readonly logger: Logger;
    private readonly validator = createStrictValidator('ReasoningToolParser');
    private readonly config: Required<ReasoningParserConfig>;

    private constructor(config?: ReasoningParserConfig) {
        this.logger = new Logger('debug', 'ReasoningToolParser', 'client');
        this.config = { ...DEFAULT_PARSER_CONFIG, ...config };
    }

    /**
     * Get singleton instance
     */
    public static getInstance(config?: ReasoningParserConfig): ReasoningToolParser {
        if (!ReasoningToolParser.instance) {
            ReasoningToolParser.instance = new ReasoningToolParser(config);
        }
        return ReasoningToolParser.instance;
    }

    /**
     * Parse reasoning text to extract tool intentions
     * 
     * @param reasoningText - Plain text reasoning from LLM
     * @param availableTools - Tools available to the agent
     * @param agentId - Agent ID for event tracking
     * @param channelId - Channel ID for event tracking
     * @returns Parse result with tool intentions and synthesized tool calls
     */
    public async parseReasoningForTools(
        reasoningText: string,
        availableTools: McpTool[],
        agentId: string,
        channelId: string
    ): Promise<ReasoningParseResult> {
        // Validate inputs
        this.validator.assertIsNonEmptyString(reasoningText, 'Reasoning text is required');
        this.validator.assertIsArray(availableTools, 'Available tools must be an array');
        this.validator.assertIsNonEmptyString(agentId, 'Agent ID is required');
        this.validator.assertIsNonEmptyString(channelId, 'Channel ID is required');


        try {
            // Try structured parsing (look for JSON-formatted tool calls)
            const structuredResult = this.parseStructuredToolCalls(reasoningText, availableTools);
            if (structuredResult.parseSuccessful) {
                this.emitParseEvent(agentId, channelId, structuredResult, reasoningText);
                return structuredResult;
            }

            // Fallback to simple tool name detection if enabled
            if (this.config.enableHeuristics) {
                const heuristicResult = this.parseToolNameMentions(reasoningText, availableTools);
                if (heuristicResult.parseSuccessful) {
                    this.emitParseEvent(agentId, channelId, heuristicResult, reasoningText);
                    return heuristicResult;
                }
            }

            // If all parsing methods fail, return empty result
            this.logger.warn(`⚠️ No tool intentions found in reasoning text`);
            return {
                toolIntentions: [],
                synthesizedToolCalls: [],
                parseSuccessful: false,
                parseMethod: 'failed'
            };

        } catch (error) {
            this.logger.error(`❌ Failed to parse reasoning: ${error}`);
            return {
                toolIntentions: [],
                synthesizedToolCalls: [],
                parseSuccessful: false,
                parseMethod: 'failed',
                metadata: { error: String(error) }
            };
        }
    }

    /**
     * Parse structured tool calls from reasoning text
     * Looks for JSON-formatted tool call instructions
     */
    private parseStructuredToolCalls(
        reasoningText: string,
        availableTools: McpTool[]
    ): ReasoningParseResult {
        try {
            // Look for JSON blocks that might contain tool calls
            const jsonBlockRegex = /```json\s*([\s\S]*?)\s*```|```\s*([\s\S]*?)\s*```|\{[\s\S]*\}/g;
            const matches = reasoningText.matchAll(jsonBlockRegex);
            
            const toolIntentions: ToolIntention[] = [];
            
            for (const match of matches) {
                const jsonText = match[1] || match[2] || match[0];
                try {
                    const parsed = JSON.parse(jsonText);
                    
                    // Check if it's a tool call or array of tool calls
                    const toolCalls = Array.isArray(parsed) ? parsed : [parsed];
                    
                    for (const call of toolCalls) {
                        if (call.tool || call.name || call.function) {
                            const toolName = call.tool || call.name || call.function?.name || call.function;
                            const args = call.args || call.arguments || call.parameters || call.input || {};
                            
                            // Verify tool exists
                            const tool = availableTools.find(t => t.name === toolName);
                            if (tool && toolIntentions.length < this.config.maxToolsPerParse) {
                                toolIntentions.push({
                                    toolName,
                                    arguments: args,
                                    confidence: 0.9, // High confidence for structured format
                                    reasoning: `Extracted from structured JSON: ${toolName}`
                                });
                            }
                        }
                    }
                } catch (e) {
                    // Not valid JSON, continue
                    continue;
                }
            }
            
            if (toolIntentions.length > 0) {
                return {
                    toolIntentions,
                    synthesizedToolCalls: this.synthesizeToolCalls(toolIntentions),
                    parseSuccessful: true,
                    parseMethod: 'structured'
                };
            }
            
            return {
                toolIntentions: [],
                synthesizedToolCalls: [],
                parseSuccessful: false,
                parseMethod: 'structured'
            };
            
        } catch (error) {
            this.logger.error(`Structured parsing failed: ${error}`);
            return {
                toolIntentions: [],
                synthesizedToolCalls: [],
                parseSuccessful: false,
                parseMethod: 'structured'
            };
        }
    }

    /**
     * Parse tool calls by detecting tool name mentions in reasoning
     * Searches for actual tool names from available tools list
     */
    private parseToolNameMentions(
        reasoningText: string,
        availableTools: McpTool[]
    ): ReasoningParseResult {
        try {
            const toolIntentions: ToolIntention[] = [];
            const lowerText = reasoningText.toLowerCase();
            
            // Pattern: Look for mentions of "use <tool_name>" or "call <tool_name>"
            const actionPattern = /(?:use|call|execute|invoke)\s+(\w+)/gi;
            const matches = lowerText.matchAll(actionPattern);
            
            // Build set of available tool names (lowercase) for O(1) lookup
            const toolNameMap = new Map(availableTools.map(t => [t.name.toLowerCase(), t]));
            
            // Check each match against available tools
            for (const match of matches) {
                const mentionedName = match[1].toLowerCase();
                
                if (toolNameMap.has(mentionedName) && toolIntentions.length < this.config.maxToolsPerParse) {
                    const tool = toolNameMap.get(mentionedName)!;
                    
                    // Don't duplicate
                    if (!toolIntentions.some(t => t.toolName === tool.name)) {
                        toolIntentions.push({
                            toolName: tool.name,
                            arguments: {},
                            confidence: 0.75,
                            reasoning: `Tool name mentioned: "${match[0]}"`
                        });
                    }
                }
            }
            
            // Also check for direct tool name mentions (not after action verbs)
            for (const tool of availableTools) {
                const toolNamePattern = new RegExp(`\\b${tool.name}\\b`, 'i');
                if (toolNamePattern.test(reasoningText)) {
                    // Don't duplicate
                    if (!toolIntentions.some(t => t.toolName === tool.name)) {
                        if (toolIntentions.length < this.config.maxToolsPerParse) {
                            toolIntentions.push({
                                toolName: tool.name,
                                arguments: {},
                                confidence: 0.65,
                                reasoning: `Tool name found in reasoning text`
                            });
                        }
                    }
                }
            }
            
            // Filter by confidence threshold
            const filteredIntentions = toolIntentions.filter(
                t => t.confidence >= this.config.confidenceThreshold
            );
            
            if (filteredIntentions.length > 0) {
                return {
                    toolIntentions: filteredIntentions,
                    synthesizedToolCalls: this.synthesizeToolCalls(filteredIntentions),
                    parseSuccessful: true,
                    parseMethod: 'heuristic'
                };
            }
            
            return {
                toolIntentions: [],
                synthesizedToolCalls: [],
                parseSuccessful: false,
                parseMethod: 'heuristic'
            };
            
        } catch (error) {
            this.logger.error(`Tool name detection failed: ${error}`);
            return {
                toolIntentions: [],
                synthesizedToolCalls: [],
                parseSuccessful: false,
                parseMethod: 'heuristic'
            };
        }
    }

    /**
     * Extract arguments from text for a specific tool
     */
    private extractArgsFromText(text: string, tool: McpTool): Record<string, any> {
        const args: Record<string, any> = {};
        
        try {
            // Get required parameters from tool schema
            const schema = tool.input_schema;
            const required = schema?.required || [];
            const properties = schema?.properties || {};
            
            // Extract common parameter patterns
            // "content: <value>" or "content = <value>" or "content is <value>"
            const paramPattern = /(\w+)\s*(?::|=|is)\s*([^,;\n]+)/gi;
            let match;
            
            while ((match = paramPattern.exec(text)) !== null) {
                const paramName = match[1].toLowerCase();
                const paramValue = match[2].trim().replace(/["']/g, ''); // Remove quotes
                
                // Check if this parameter exists in tool schema
                if (properties[paramName]) {
                    args[paramName] = paramValue;
                }
            }
            
            // If no args extracted but tool has required params, try to extract content
            if (Object.keys(args).length === 0 && required.includes('content')) {
                // Use the entire text as content if it's a required parameter
                args.content = text.trim();
            }
            
        } catch (error) {
            this.logger.warn(`Failed to extract args from text: ${error}`);
        }
        
        return args;
    }

    /**
     * Synthesize MCP-compliant tool_calls from tool intentions
     */
    private synthesizeToolCalls(intentions: ToolIntention[]): McpToolUseContent[] {
        return intentions.map(intention => ({
            type: McpContentType.TOOL_USE,
            id: uuidv4(),
            name: intention.toolName,
            input: intention.arguments
        }));
    }

    /**
     * Emit parsing event for observability
     */
    private emitParseEvent(
        agentId: string,
        channelId: string,
        result: ReasoningParseResult,
        reasoningText: string
    ): void {
        try {
            const parsedData: LlmReasoningParsedEventData = {
                reasoning: reasoningText,
                toolIntentions: result.toolIntentions,
                parseMethod: result.parseMethod,
                toolCount: result.toolIntentions.length,
                parseSuccessful: result.parseSuccessful,
                metadata: result.metadata
            };
            
            const eventPayload = createLlmReasoningParsedEventPayload(
                AgentEvents.LLM_REASONING_PARSED,
                agentId,
                channelId,
                parsedData
            );
            
            EventBus.client.emit(AgentEvents.LLM_REASONING_PARSED, eventPayload);
            
        } catch (error) {
            this.logger.error(`Failed to emit parse event: ${error}`);
        }
    }

    /**
     * Update parser configuration
     */
    public updateConfig(config: Partial<ReasoningParserConfig>): void {
        Object.assign(this.config, config);
    }

    /**
     * Get current configuration
     */
    public getConfig(): Required<ReasoningParserConfig> {
        return { ...this.config };
    }
}
