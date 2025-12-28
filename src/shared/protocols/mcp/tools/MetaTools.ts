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
 * MXF MCP Meta-Tools
 * 
 * Advanced meta-tools that provide intelligent tool management and recommendation
 * capabilities. These tools use AI/LLM services to analyze agent intents and
 * provide contextual tool recommendations from the unified MCP tool registry.
 */

import { firstValueFrom, Observable } from 'rxjs';
import { createStrictValidator } from '../../../utils/validation';
import { Logger } from '../../../utils/Logger';
import { SystemLlmServiceManager } from '../../../../server/socket/services/SystemLlmServiceManager';
import { TOOL_RECOMMENDATION_SCHEMA } from '../../../schemas/JsonResponseSchemas';
import { McpToolRegistry } from '../../../../server/api/services/McpToolRegistry';
import { META_TOOLS } from '../../../constants/ToolNames';
import { TaskService } from '../../../../server/socket/services/TaskService';
import { TaskEvents } from '../../../events/event-definitions/TaskEvents';
import { EventBus } from '../../../events/EventBus';
import { createTaskEventPayload } from '../../../schemas/EventPayloadSchema';
import { ValidationPerformanceService } from '../../../services/ValidationPerformanceService';
import { PatternLearningService } from '../../../services/PatternLearningService';
import { AutoCorrectionService } from '../../../services/AutoCorrectionService';
import { ToolExecutionInterceptor } from '../../../services/ToolExecutionInterceptor';
import { RecoveryWorkflowService } from '../../../services/RecoveryWorkflowService';
import { AutoCorrectionIntegrationService } from '../../../services/AutoCorrectionIntegrationService';
import { EnhancedParameterPattern, PatternRecommendation } from '../../../types/PatternLearningTypes';
import { AgentId } from '../../../types/Agent';
import { ChannelId } from '../../../types/ChannelContext';

const logger = new Logger('info', 'MetaTools', 'server');
const validator = createStrictValidator('MetaTools');

/**
 * Tool categories for organization and filtering
 */
const TOOL_CATEGORIES = {
    COMMUNICATION: 'communication',
    CONTROL_LOOP: 'control-loop', 
    INFRASTRUCTURE: 'infrastructure',
    CONTEXT_MEMORY: 'context-memory',
    META: 'meta'
} as const;

/**
 * Get tool category based on name
 */
const getToolCategory = (toolName: string): string => {
    if (toolName.startsWith('agent_')) return TOOL_CATEGORIES.COMMUNICATION;
    if (toolName.startsWith('control_loop_')) return TOOL_CATEGORIES.CONTROL_LOOP;
    if (toolName.startsWith('fs_') || toolName.startsWith('memory_') || toolName.startsWith('shell_')) return TOOL_CATEGORIES.INFRASTRUCTURE;
    if (toolName.startsWith('channel_') || toolName.startsWith('agent_context') || toolName.startsWith('agent_memory')) return TOOL_CATEGORIES.CONTEXT_MEMORY;
    if (toolName.startsWith('tools_')) return TOOL_CATEGORIES.META;
    return 'unknown';
};

/**
 * Tool recommendation result interface - Enhanced for Phase 3
 */
export interface ToolRecommendation {
    name: string;
    description: string;
    category: string;
    relevanceScore: number;
    reasoning: string;
    usageHint: string;
    /** Enhanced validation-aware properties */
    validationInsights?: {
        successRate: number;
        commonErrors: string[];
        avgRecoveryTime?: number;
        lastValidationIssue?: string;
    };
    /** Parameter examples from successful patterns */
    parameterExamples?: Array<{
        example: Record<string, any>;
        description: string;
        confidence: number;
        usageCount: number;
    }>;
    /** Related tool chains from patterns */
    toolChains?: Array<{
        sequence: string[];
        description: string;
        successRate: number;
    }>;
}

/**
 * Tool recommendation response interface - Enhanced for Phase 3
 */
export interface ToolRecommendationResponse {
    agentId: string;
    intent: string;
    recommendedTools: ToolRecommendation[];
    totalAvailableTools: number;
    processingTime: number;
    llmProvider: string;
    confidence: number;
    /** Enhanced validation-aware insights */
    validationInsights?: {
        agentPerformanceScore: number;
        riskLevel: 'low' | 'medium' | 'high';
        recommendedHelpTools: string[];
        learningOpportunities: string[];
    };
    /** Pattern-based recommendations */
    patternRecommendations?: PatternRecommendation[];
    /** Error context if this is an error-driven recommendation */
    errorContext?: {
        originalError: string;
        failedTool: string;
        suggestedAlternatives: string[];
        preventionTips: string[];
    };
}

/**
 * Generate fallback recommendations using keyword matching
 */
const generateFallbackRecommendations = async (
    intent: string,
    maxRecommendations: number,
    excludeTools: string[]
): Promise<ToolRecommendation[]> => {
    try {
        // Get tools from the actual registry
        const allTools = await firstValueFrom(McpToolRegistry.getInstance().listTools());
        
        // Filter out excluded tools
        const filteredTools = allTools.filter(tool => !excludeTools.includes(tool.name));
        
        // Simple keyword-based scoring
        const intentLower = intent.toLowerCase();
        const recommendations = filteredTools
            .map(tool => {
                const nameScore = tool.name.toLowerCase().includes(intentLower) ? 0.8 : 0;
                const descScore = tool.description.toLowerCase().includes(intentLower) ? 0.6 : 0;
                const relevanceScore = Math.max(nameScore, descScore, 0.1); // Minimum score
                
                return {
                    name: tool.name,
                    description: tool.description,
                    category: getToolCategory(tool.name),
                    relevanceScore,
                    reasoning: `Keyword match in ${nameScore > 0 ? 'name' : 'description'}`,
                    usageHint: `Use ${tool.name} to ${tool.description.toLowerCase()}`
                };
            })
            .sort((a, b) => b.relevanceScore - a.relevanceScore)
            .slice(0, maxRecommendations);

        return recommendations;
    } catch (error) {
        logger.error(`Failed to generate fallback recommendations: ${error}`);
        return [];
    }
};

/**
 * MCP Meta-Tools for intelligent tool management - Enhanced for Phase 3 Validation-Aware Recommendations
 */
export const tools_recommend = {
    name: META_TOOLS.TOOLS_RECOMMEND,
    description: 'Get AI-powered recommendations for the most relevant MCP tools based on your intent and context. Uses advanced LLM analysis enhanced with validation performance data and successful parameter patterns to suggest optimal tool combinations.',
    inputSchema: {
        type: 'object',
        properties: {
            intent: {
                type: 'string',
                description: 'Your goal or what you want to accomplish (e.g., "analyze conversation patterns", "coordinate agent tasks", "process files")'
            },
            context: {
                type: 'string',
                description: 'Optional additional context about your situation or requirements'
            },
            maxRecommendations: {
                type: 'number',
                description: 'Maximum number of tool recommendations to return (default: 5)',
                minimum: 1,
                maximum: 10
            },
            categoryFilter: {
                type: 'array',
                items: { type: 'string' },
                description: 'Optional filter to only recommend tools from specific categories: communication, control-loop, infrastructure, context-memory, meta'
            },
            excludeTools: {
                type: 'array',
                items: { type: 'string' },
                description: 'Optional list of tool names to exclude from recommendations'
            },
            /** Enhanced Phase 3 parameters */
            includeValidationInsights: {
                type: 'boolean',
                description: 'Include validation performance data and success rates (default: true)',
                default: true
            },
            includeParameterExamples: {
                type: 'boolean',
                description: 'Include successful parameter examples from learned patterns (default: true)',
                default: true
            },
            includePatternRecommendations: {
                type: 'boolean',
                description: 'Include pattern-based recommendations from other agents (default: true)',
                default: true
            },
            errorContext: {
                type: 'object',
                properties: {
                    failedTool: {
                        type: 'string',
                        description: 'Name of tool that failed, triggering this recommendation request'
                    },
                    errorMessage: {
                        type: 'string',
                        description: 'Error message from the failed tool execution'
                    },
                    failedParameters: {
                        type: 'object',
                        description: 'Parameters that caused the failure',
                        additionalProperties: true
                    }
                },
                description: 'Optional error context for error-driven recommendations'
            }
        },
        required: ['intent']
    },
    handler: async (input: {
        intent: string;
        context?: string;
        maxRecommendations?: number;
        categoryFilter?: string[];
        excludeTools?: string[];
        /** Enhanced Phase 3 parameters */
        includeValidationInsights?: boolean;
        includeParameterExamples?: boolean;
        includePatternRecommendations?: boolean;
        errorContext?: {
            failedTool?: string;
            errorMessage?: string;
            failedParameters?: Record<string, any>;
        };
    }, context: {
        agentId: string;
        channelId: string;
        requestId: string;
    }): Promise<ToolRecommendationResponse> => {
        const startTime = Date.now();
        
        try {
            // Validate required inputs
            validator.assertIsString(input.intent, 'intent');
            validator.assertIsString(context.agentId, 'agentId');
            validator.assertIsString(context.channelId, 'channelId');


            // Set defaults
            const maxRecommendations = input.maxRecommendations || 5;
            const excludeTools = input.excludeTools || [];
            const includeValidationInsights = input.includeValidationInsights !== false;
            const includeParameterExamples = input.includeParameterExamples !== false;
            const includePatternRecommendations = input.includePatternRecommendations !== false;
            
            // Initialize Phase 3 services
            const validationService = ValidationPerformanceService.getInstance();
            const patternService = PatternLearningService.getInstance();
            
            // Get agent's validation metrics and patterns if requested
            let validationMetrics = null;
            let agentPatternRecommendations: PatternRecommendation[] = [];
            
            if (includeValidationInsights || includeParameterExamples) {
                try {
                    validationMetrics = await validationService.getValidationMetrics(
                        context.agentId as AgentId, 
                        context.channelId as ChannelId
                    );
                } catch (error) {
                    logger.warn(`Failed to retrieve validation metrics: ${error}, continuing without validation insights`);
                }
            }
            
            
            // Try to get tools from hybrid registry first, fallback to internal registry
            let allToolsFromRegistry: any[] = [];
            let isHybridRegistry = false;
            
            try {
                // Check if we have a hybrid registry available (will be injected later)
                const hybridRegistry = (global as any).hybridMcpToolRegistry;
                if (hybridRegistry) {
                    allToolsFromRegistry = hybridRegistry.getAllToolsSnapshot();
                    isHybridRegistry = true;
                } else {
                    // Fallback to internal registry only
                    allToolsFromRegistry = await firstValueFrom(McpToolRegistry.getInstance().listTools());
                }
            } catch (error) {
                // Fallback to internal registry on any error
                allToolsFromRegistry = await firstValueFrom(McpToolRegistry.getInstance().listTools());
                logger.warn(`Hybrid registry unavailable, using internal only: ${error instanceof Error ? error.message : String(error)}`);
            }
            
            
            // Get enhanced tool metrics if validation insights are requested
            let enhancedToolMetrics = null;
            if (includeValidationInsights && validationMetrics) {
                try {
                    enhancedToolMetrics = await validationService.getEnhancedToolMetrics(
                        context.agentId as AgentId,
                        context.channelId as ChannelId
                    );
                } catch (error) {
                    logger.warn(`Failed to get enhanced tool metrics: ${error}`);
                }
            }
            
            // Filter available tools based on criteria
            let availableTools = allToolsFromRegistry.filter(tool => {
                // Exclude tools specified in excludeTools
                if (excludeTools.includes(tool.name)) {
                    return false;
                }
                
                // Filter by category if specified
                if (input.categoryFilter && input.categoryFilter.length > 0) {
                    // For hybrid tools, use the category property directly
                    // For internal tools, use the getToolCategory function
                    const toolCategory = isHybridRegistry && tool.category 
                        ? tool.category 
                        : getToolCategory(tool.name);
                    const isIncluded = input.categoryFilter.includes(toolCategory);
                    return isIncluded;
                }
                
                return true;
            });

            // CRITICAL: Filter by agent's allowedTools if specified
            // This ensures meta-tools only recommend tools the agent is permitted to use
            try {
                // Try to get agent configuration to check allowedTools
                // For now, we'll add this as a TODO and implement a mechanism to pass allowedTools
                // TODO: Implement mechanism to pass agent's allowedTools to meta-tools
                // We need to extend the context parameter to include allowedTools
                
                // Placeholder implementation - in production this would come from agent config
                const agentAllowedTools = (context as any).allowedTools as string[] | undefined;
                
                if (agentAllowedTools && agentAllowedTools.length > 0) {
                    const originalCount = availableTools.length;
                    availableTools = availableTools.filter(tool => {
                        const isAllowed = agentAllowedTools.includes(tool.name);
                        if (!isAllowed) {
                        }
                        return isAllowed;
                    });
                }
            } catch (error) {
                logger.warn(`Failed to apply allowedTools filtering in meta-tools: ${error}`);
                // Continue without filtering if there's an error
            }


            const calculatorTools = availableTools.filter(tool => 
                tool.name.toLowerCase().includes('calculator') || 
                tool.name.toLowerCase().includes('calc') ||
                (isHybridRegistry && tool.category === 'calculation')
            );
            
            if (calculatorTools.length > 0) {
            } else {
                logger.warn('⚠️ No calculator tools found in available tools for recommendation');
            }

            // Build enhanced tool registry summary for LLM context with validation data
            const toolSummary = await Promise.all(availableTools.map(async tool => {
                const baseInfo = {
                    name: tool.name,
                    description: tool.description,
                    category: isHybridRegistry && tool.category ? tool.category : getToolCategory(tool.name),
                    source: isHybridRegistry && tool.source ? tool.source : 'internal',
                    inputSchema: tool.inputSchema || {} // Use actual schema from registry
                };
                
                // Add validation insights if available
                if (enhancedToolMetrics && includeValidationInsights) {
                    const successRate = enhancedToolMetrics.toolValidationSuccessRates[tool.name];
                    const commonErrors = enhancedToolMetrics.commonValidationErrors[tool.name] || [];
                    const isHelpTrigger = enhancedToolMetrics.helpTriggeringTools.includes(tool.name);
                    
                    (baseInfo as any).validationInsights = {
                        successRate: successRate || 1.0,
                        commonErrors,
                        requiresHelp: isHelpTrigger,
                        riskLevel: successRate ? (successRate > 0.8 ? 'low' : successRate > 0.5 ? 'medium' : 'high') : 'unknown'
                    };
                }
                
                // Add parameter examples if requested
                if (includeParameterExamples && patternService) {
                    try {
                        const patterns = await patternService.getEnhancedPatterns(
                            context.channelId as ChannelId,
                            tool.name,
                            true // include shared patterns
                        );
                        
                        if (patterns.successful.length > 0) {
                            (baseInfo as any).parameterExamples = patterns.successful
                                .slice(0, 3) // Top 3 examples
                                .map(pattern => ({
                                    example: pattern.parameters,
                                    confidence: pattern.confidenceScore,
                                    usageCount: pattern.frequency,
                                    description: `Used ${pattern.frequency} times with ${Math.round(pattern.confidenceScore * 100)}% confidence`
                                }));
                        }
                    } catch (error) {
                    }
                }
                
                return baseInfo;
            }));

            const calculatorToolsInSummary = toolSummary.filter(tool => 
                tool.source === 'calculator' || 
                tool.category === 'calculation' ||
                tool.name.toLowerCase().includes('calc') ||
                tool.name.toLowerCase().includes('add') ||
                tool.name.toLowerCase().includes('sub') ||
                tool.name.toLowerCase().includes('mul') ||
                tool.name.toLowerCase().includes('div')
            );
            
            if (calculatorToolsInSummary.length > 0) {
                //     name: t.name,
                //     source: t.source,
                //     category: t.category,
                //     description: t.description?.substring(0, 50) + '...'
                // })));
            } else {
                logger.warn('⚠️ No calculator tools found in toolSummary before LLM recommendation');
            }

            // Get per-channel SystemLlmService instance
            const systemLlmService = SystemLlmServiceManager.getInstance().getServiceForChannel(context.channelId);
            if (!systemLlmService) {
                throw new Error(`No SystemLLM available for channel ${context.channelId}`);
            }

            // Request LLM analysis with the new dedicated method
            const llmResponse = await firstValueFrom(
                systemLlmService.generateToolRecommendations(
                    input.intent,
                    toolSummary,
                    maxRecommendations,
                    input.context,
                    {
                        temperature: 0.3,
                        maxTokens: 4000  // Increased to handle 168+ tools
                    }
                )
            );

            // Parse LLM response - already parsed by SystemLlmService
            const analysisResult = llmResponse;
            
            if (analysisResult.recommendations?.length > 0) {
            }

            // Build enhanced final recommendations with validation insights
            const recommendations: ToolRecommendation[] = await Promise.all(
                analysisResult.recommendations
                    .slice(0, maxRecommendations)
                    .map(async (rec: any) => {
                        const tool = availableTools.find(t => t.name === rec.toolName);
                        if (!tool) {
                            logger.warn(`LLM recommended unknown tool: ${rec.toolName}`);
                            return null;
                        }
                        
                        const baseRecommendation: ToolRecommendation = {
                            name: tool.name,
                            description: tool.description,
                            category: isHybridRegistry && tool.category ? tool.category : getToolCategory(tool.name),
                            relevanceScore: rec.relevanceScore,
                            reasoning: rec.reasoning,
                            usageHint: rec.usageHint
                        };
                        
                        // Add validation insights if available
                        if (enhancedToolMetrics && includeValidationInsights) {
                            const successRate = enhancedToolMetrics.toolValidationSuccessRates[tool.name] || 1.0;
                            const commonErrors = enhancedToolMetrics.commonValidationErrors[tool.name] || [];
                            const corrections = enhancedToolMetrics.parameterCorrections.find(c => c.tool === tool.name);
                            
                            baseRecommendation.validationInsights = {
                                successRate,
                                commonErrors,
                                avgRecoveryTime: corrections ? 5000 : undefined, // Simplified
                                lastValidationIssue: commonErrors.length > 0 ? commonErrors[0] : undefined
                            };
                        }
                        
                        // Add parameter examples if available
                        if (includeParameterExamples) {
                            try {
                                const patterns = await patternService.getEnhancedPatterns(
                                    context.channelId as ChannelId,
                                    tool.name,
                                    true
                                );
                                
                                if (patterns.successful.length > 0) {
                                    baseRecommendation.parameterExamples = patterns.successful
                                        .slice(0, 2) // Top 2 examples per tool
                                        .map(pattern => ({
                                            example: pattern.parameters,
                                            description: `Successful pattern used ${pattern.frequency} times`,
                                            confidence: pattern.confidenceScore,
                                            usageCount: pattern.frequency
                                        }));
                                }
                                
                                // TODO: Add tool chains from patterns
                                // This would require analyzing pattern sequences
                            } catch (error) {
                            }
                        }
                        
                        return baseRecommendation;
                    })
            );
            
            const validRecommendations = recommendations
                .filter(Boolean) // Remove null entries
                .sort((a: ToolRecommendation, b: ToolRecommendation) => {
                    // Enhanced sorting: combine relevance with validation success rate
                    const aScore = a.relevanceScore * (a.validationInsights?.successRate || 1.0);
                    const bScore = b.relevanceScore * (b.validationInsights?.successRate || 1.0);
                    return bScore - aScore;
                });

            // Get pattern-based recommendations if requested
            if (includePatternRecommendations && patternService) {
                try {
                    // Get pattern recommendations for tools mentioned in the intent
                    const toolsInIntent = validRecommendations.map(r => r.name);
                    for (const toolName of toolsInIntent.slice(0, 3)) { // Limit to top 3 tools
                        const patterns = await patternService.getPatternRecommendations(
                            context.agentId as AgentId,
                            context.channelId as ChannelId,
                            toolName
                        );
                        agentPatternRecommendations.push(...patterns.slice(0, 2)); // Max 2 per tool
                    }
                } catch (error) {
                }
            }
            
            const processingTime = Date.now() - startTime;
            
            // Calculate validation-aware insights
            let validationInsights = undefined;
            if (includeValidationInsights && validationMetrics) {
                const performanceAnalysis = await validationService.analyzeValidationPerformance(
                    context.agentId as AgentId,
                    context.channelId as ChannelId
                );
                
                validationInsights = {
                    agentPerformanceScore: performanceAnalysis.validationHealthScore,
                    riskLevel: performanceAnalysis.validationHealthScore > 0.8 ? 'low' as const : 
                               performanceAnalysis.validationHealthScore > 0.5 ? 'medium' as const : 'high' as const,
                    recommendedHelpTools: performanceAnalysis.recommendations
                        .filter(r => r.priority === 'high')
                        .flatMap(r => r.tools)
                        .slice(0, 3),
                    learningOpportunities: performanceAnalysis.recommendations
                        .map(r => r.action)
                        .slice(0, 3)
                };
            }
            
            // Handle error context if provided
            let errorContext = undefined;
            if (input.errorContext?.failedTool) {
                const alternatives = validRecommendations
                    .filter(r => r.name !== input.errorContext?.failedTool)
                    .slice(0, 3)
                    .map(r => r.name);
                    
                errorContext = {
                    originalError: input.errorContext.errorMessage || 'Unknown error',
                    failedTool: input.errorContext.failedTool,
                    suggestedAlternatives: alternatives,
                    preventionTips: [
                        'Use tool_help to understand parameter requirements',
                        'Validate parameters with tool_validate before execution',
                        'Review successful parameter examples from other agents'
                    ]
                };
            }


            return {
                agentId: context.agentId,
                intent: input.intent,
                recommendedTools: validRecommendations,
                totalAvailableTools: availableTools.length,
                processingTime,
                llmProvider: 'SystemLlmService',
                confidence: analysisResult.confidence,
                validationInsights,
                patternRecommendations: agentPatternRecommendations.length > 0 ? agentPatternRecommendations : undefined,
                errorContext
            };

        } catch (error) {
            logger.warn(`LLM-based tool recommendation failed, using fallback method: ${error instanceof Error ? error.message : String(error)}`);
            
            // Fallback to simple keyword-based recommendations from registry
            const fallbackRecommendations = await generateFallbackRecommendations(
                input.intent,
                input.maxRecommendations || 5,
                input.excludeTools || []
            );
            
            const processingTime = Date.now() - startTime;
            
            // Get total tool count from registry for accurate reporting
            let totalAvailableTools = 0;
            try {
                const allTools = await firstValueFrom(McpToolRegistry.getInstance().listTools());
                totalAvailableTools = allTools.length;
            } catch (registryError) {
                logger.error(`Failed to get tool count from registry: ${registryError}`);
                totalAvailableTools = 26; // Fallback estimate
            }
            
            
            return {
                agentId: context.agentId,
                intent: input.intent,
                recommendedTools: fallbackRecommendations,
                totalAvailableTools,
                processingTime,
                llmProvider: 'fallback',
                confidence: 0.5
            };
        }
    }
};

/**
 * Task completion tool - signal when an assigned task is complete
 */
export const task_complete = {
    name: META_TOOLS.TASK_COMPLETE,
    description: 'REQUIRED: Call this tool when you have finished an assigned task. This is MANDATORY - tasks are NOT complete until you call this tool. It signals the task management system that your work is finished.',
    inputSchema: {
        type: 'object',
        properties: {
            summary: {
                type: 'string',
                description: 'Summary of the work completed and results achieved'
            },
            result: {
                type: 'string',
                description: 'Alternative to summary - the result of the completed work'
            },
            success: {
                type: 'boolean',
                description: 'Whether the task was completed successfully (true) or failed (false)',
                default: true
            },
            details: {
                type: 'object',
                description: 'Optional detailed results, outputs, or artifacts from task completion',
                additionalProperties: true
            },
            nextSteps: {
                type: 'string',
                description: 'Optional suggestions for follow-up work or next steps'
            }
        },
        // No required fields - accept any reasonable input
        required: []
    },
    handler: async (input: {
        summary?: string;
        result?: string;
        success?: boolean;
        details?: Record<string, any>;
        nextSteps?: string;
    }, context: {
        agentId: string;
        channelId: string;
        requestId: string;
    }) => {
        const startTime = Date.now();
        
        // Accept either 'summary' or 'result' parameter (LLMs may use either)
        // Fall back to a default if neither is provided
        const summaryText = input.summary || input.result || 'Task completed';
        
        // Validate context (but be forgiving on input)
        validator.assertIsNonEmptyString(context.agentId, 'agentId is required');
        validator.assertIsNonEmptyString(context.channelId, 'channelId is required');
        
        // Prepare completion data
        const completionData = {
            summary: summaryText,
            success: input.success !== false, // Default to true
            details: input.details || {},
            nextSteps: input.nextSteps,
            requestId: context.requestId
        };
        
        // Use TaskService to handle completion (single source of truth)
        const taskService = TaskService.getInstance();
        const result = await taskService.handleTaskCompletion(
            context.agentId,
            context.channelId,
            completionData
        );
                
        return {
            status: result.status,
            agentId: context.agentId,
            message: result.message,
            taskId: result.taskId,
            nextSteps: result.nextSteps,
            processingTime: Date.now() - startTime
        };
    }
};

/**
 * Validates tool availability before execution
 */
export const tools_validate = {
    name: META_TOOLS.TOOLS_VALIDATE,
    description: 'Validates that specified tools are available and properly configured before attempting to use them. Helps prevent execution errors by checking tool availability.',
    inputSchema: {
        type: 'object',
        properties: {
            toolNames: {
                type: 'array',
                items: { type: 'string' },
                description: 'List of tool names to validate'
            },
            checkConfiguration: {
                type: 'boolean',
                description: 'Whether to check tool configuration and dependencies (default: false)',
                default: false
            }
        },
        required: ['toolNames']
    },
    handler: async (input: {
        toolNames: string[];
        checkConfiguration?: boolean;
    }, context: {
        agentId: string;
        channelId: string;
        requestId: string;
    }) => {
        const startTime = Date.now();
        
        try {
            // Get all available tools
            let allTools: any[] = [];
            try {
                const hybridRegistry = (global as any).hybridMcpToolRegistry;
                if (hybridRegistry) {
                    allTools = hybridRegistry.getAllToolsSnapshot();
                } else {
                    allTools = await firstValueFrom(McpToolRegistry.getInstance().listTools());
                }
            } catch (error) {
                allTools = await firstValueFrom(McpToolRegistry.getInstance().listTools());
            }
            
            const validationResults = input.toolNames.map(toolName => {
                const tool = allTools.find(t => t.name === toolName);
                if (!tool) {
                    return {
                        toolName,
                        available: false,
                        error: 'Tool not found in registry'
                    };
                }
                
                return {
                    toolName,
                    available: true,
                    category: getToolCategory(toolName),
                    description: tool.description,
                    source: tool.source || 'internal'
                };
            });
            
            const unavailableTools = validationResults.filter(r => !r.available);
            
            return {
                totalChecked: input.toolNames.length,
                availableCount: validationResults.length - unavailableTools.length,
                unavailableCount: unavailableTools.length,
                allAvailable: unavailableTools.length === 0,
                results: validationResults,
                processingTime: Date.now() - startTime
            };
        } catch (error) {
            logger.error(`Tool validation failed: ${error}`);
            throw error;
        }
    }
};

/**
 * Interactive tool discovery with category filtering
 */
export const tools_discover = {
    name: META_TOOLS.TOOLS_DISCOVER,
    description: 'Discover and explore available MCP tools with interactive filtering by category, source, and other criteria. Returns exact tool information without AI interpretation.',
    inputSchema: {
        type: 'object',
        properties: {
            category: {
                type: 'string',
                description: 'Filter tools by category (communication, control-loop, infrastructure, context-memory, meta, etc.)'
            },
            source: {
                type: 'string',
                description: 'Filter by tool source (internal, external, or specific MCP server name)'
            },
            namePattern: {
                type: 'string',
                description: 'Filter tools by name pattern (case-insensitive substring match)'
            },
            includeSchema: {
                type: 'boolean',
                description: 'Include full input schemas in results (default: false)',
                default: false
            },
            limit: {
                type: 'number',
                description: 'Maximum number of tools to return (default: 20)',
                minimum: 1,
                maximum: 100,
                default: 20
            }
        }
    },
    handler: async (input: {
        category?: string;
        source?: string;
        namePattern?: string;
        includeSchema?: boolean;
        limit?: number;
    }, context: {
        agentId: string;
        channelId: string;
        requestId: string;
    }) => {
        const startTime = Date.now();
        
        try {
            // Get all available tools
            let allTools: any[] = [];
            try {
                const hybridRegistry = (global as any).hybridMcpToolRegistry;
                if (hybridRegistry) {
                    allTools = hybridRegistry.getAllToolsSnapshot();
                } else {
                    allTools = await firstValueFrom(McpToolRegistry.getInstance().listTools());
                }
            } catch (error) {
                allTools = await firstValueFrom(McpToolRegistry.getInstance().listTools());
            }
            
            // Apply filters
            let filteredTools = allTools;
            
            if (input.category) {
                filteredTools = filteredTools.filter(tool => 
                    getToolCategory(tool.name) === input.category
                );
            }
            
            if (input.source) {
                filteredTools = filteredTools.filter(tool => 
                    (tool.source || 'internal').toLowerCase().includes(input.source!.toLowerCase())
                );
            }
            
            if (input.namePattern) {
                filteredTools = filteredTools.filter(tool => 
                    tool.name.toLowerCase().includes(input.namePattern!.toLowerCase())
                );
            }

            // CRITICAL: Filter by agent's allowedTools if specified
            // This ensures tools_discover only returns tools the agent is permitted to use
            try {
                const agentAllowedTools = (context as any).allowedTools as string[] | undefined;
                
                if (agentAllowedTools && agentAllowedTools.length > 0) {
                    const originalCount = filteredTools.length;
                    filteredTools = filteredTools.filter(tool => {
                        const isAllowed = agentAllowedTools.includes(tool.name);
                        if (!isAllowed) {
                        }
                        return isAllowed;
                    });
                }
            } catch (error) {
                logger.warn(`Failed to apply allowedTools filtering in tools_discover: ${error}`);
                // Continue without filtering if there's an error
            }
            
            // Apply limit
            const limit = input.limit || 20;
            filteredTools = filteredTools.slice(0, limit);
            
            // Format results
            const results = filteredTools.map(tool => ({
                name: tool.name,
                description: tool.description,
                category: getToolCategory(tool.name),
                source: tool.source || 'internal',
                ...(input.includeSchema && { inputSchema: tool.inputSchema })
            }));
            
            // Group by category for summary
            const categoryGroups = results.reduce((groups: any, tool) => {
                const category = tool.category;
                if (!groups[category]) groups[category] = [];
                groups[category].push(tool.name);
                return groups;
            }, {});
            
            return {
                totalAvailable: allTools.length,
                filteredCount: results.length,
                filters: {
                    category: input.category,
                    source: input.source,
                    namePattern: input.namePattern
                },
                categoryGroups,
                tools: results,
                processingTime: Date.now() - startTime
            };
        } catch (error) {
            logger.error(`Tool discovery failed: ${error}`);
            throw error;
        }
    }
};

/**
 * Compares similar tools and suggests alternatives
 */
export const tools_compare = {
    name: META_TOOLS.TOOLS_COMPARE,
    description: 'Compare multiple tools side-by-side and suggest alternatives based on functionality, performance, and use cases.',
    inputSchema: {
        type: 'object',
        properties: {
            toolNames: {
                type: 'array',
                items: { type: 'string' },
                description: 'List of tool names to compare'
            },
            comparisonCriteria: {
                type: 'array',
                items: { type: 'string' },
                description: 'Criteria for comparison (performance, complexity, dependencies, etc.)'
            },
            suggestAlternatives: {
                type: 'boolean',
                description: 'Whether to suggest alternative tools with similar functionality',
                default: true
            }
        },
        required: ['toolNames']
    },
    handler: async (input: {
        toolNames: string[];
        comparisonCriteria?: string[];
        suggestAlternatives?: boolean;
    }, context: {
        agentId: string;
        channelId: string;
        requestId: string;
    }) => {
        const startTime = Date.now();
        
        try {
            // Get all available tools
            let allTools: any[] = [];
            try {
                const hybridRegistry = (global as any).hybridMcpToolRegistry;
                if (hybridRegistry) {
                    allTools = hybridRegistry.getAllToolsSnapshot();
                } else {
                    allTools = await firstValueFrom(McpToolRegistry.getInstance().listTools());
                }
            } catch (error) {
                allTools = await firstValueFrom(McpToolRegistry.getInstance().listTools());
            }
            
            // Find requested tools
            const requestedTools = input.toolNames.map(name => {
                const tool = allTools.find(t => t.name === name);
                if (!tool) {
                    return { name, found: false, error: 'Tool not found' };
                }
                return {
                    name: tool.name,
                    found: true,
                    description: tool.description,
                    category: getToolCategory(tool.name),
                    source: tool.source || 'internal',
                    inputSchema: tool.inputSchema
                };
            });
            
            // Find similar tools for alternatives
            const alternatives = input.suggestAlternatives ? allTools.filter(tool => 
                !input.toolNames.includes(tool.name) &&
                requestedTools.some(req => req.found && getToolCategory(req.name) === getToolCategory(tool.name))
            ).slice(0, 5) : [];
            
            return {
                comparison: {
                    requestedTools,
                    foundCount: requestedTools.filter(t => t.found).length,
                    notFoundCount: requestedTools.filter(t => !t.found).length
                },
                alternatives: alternatives.map(tool => ({
                    name: tool.name,
                    description: tool.description,
                    category: getToolCategory(tool.name),
                    source: tool.source || 'internal'
                })),
                processingTime: Date.now() - startTime
            };
        } catch (error) {
            logger.error(`Tool comparison failed: ${error}`);
            throw error;
        }
    }
};

/**
 * Optimizes prompts for better LLM performance
 */
export const prompt_optimize = {
    name: META_TOOLS.PROMPT_OPTIMIZE,
    description: 'Analyzes and optimizes prompts for better LLM performance, clarity, and effectiveness.',
    inputSchema: {
        type: 'object',
        properties: {
            prompt: {
                type: 'string',
                description: 'The prompt to optimize'
            },
            context: {
                type: 'string',
                description: 'Context about how the prompt will be used'
            },
            optimizationGoals: {
                type: 'array',
                items: { type: 'string' },
                description: 'Goals for optimization (clarity, conciseness, specificity, etc.)'
            }
        },
        required: ['prompt']
    },
    handler: async (input: {
        prompt: string;
        context?: string;
        optimizationGoals?: string[];
    }, context: {
        agentId: string;
        channelId: string;
        requestId: string;
    }) => {
        const startTime = Date.now();
        
        try {
            // Basic prompt analysis
            const analysis = {
                length: input.prompt.length,
                wordCount: input.prompt.split(/\s+/).length,
                hasInstructions: input.prompt.toLowerCase().includes('you are') || input.prompt.toLowerCase().includes('please'),
                hasConstraints: input.prompt.toLowerCase().includes('must') || input.prompt.toLowerCase().includes('do not'),
                hasExamples: input.prompt.includes('example') || input.prompt.includes('Example'),
                hasStructure: input.prompt.includes('##') || input.prompt.includes('###') || input.prompt.includes('**')
            };
            
            // Generate optimization suggestions
            const suggestions = [];
            
            if (analysis.length > 2000) {
                suggestions.push({
                    type: 'length',
                    issue: 'Prompt may be too long for optimal processing',
                    suggestion: 'Consider breaking into smaller, focused sections'
                });
            }
            
            if (!analysis.hasInstructions) {
                suggestions.push({
                    type: 'clarity',
                    issue: 'Prompt lacks clear role definition',
                    suggestion: 'Add "You are..." or similar role definition at the beginning'
                });
            }
            
            if (!analysis.hasConstraints) {
                suggestions.push({
                    type: 'constraints',
                    issue: 'No explicit constraints found',
                    suggestion: 'Add constraints to guide behavior (e.g., "You must only...")'
                });
            }
            
            if (!analysis.hasExamples) {
                suggestions.push({
                    type: 'examples',
                    issue: 'No examples provided',
                    suggestion: 'Add few-shot examples to improve response quality'
                });
            }
            
            if (!analysis.hasStructure) {
                suggestions.push({
                    type: 'structure',
                    issue: 'Prompt lacks clear structure',
                    suggestion: 'Use headers and formatting to organize content'
                });
            }
            
            return {
                analysis,
                suggestions,
                score: Math.max(0, 100 - suggestions.length * 15), // Simple scoring
                processingTime: Date.now() - startTime
            };
        } catch (error) {
            logger.error(`Prompt optimization failed: ${error}`);
            throw error;
        }
    }
};

/**
 * Helps agents understand their own capabilities
 */
export const agent_introspect = {
    name: META_TOOLS.AGENT_INTROSPECT,
    description: 'Helps agents understand their own capabilities, available tools, and current state for better self-awareness.',
    inputSchema: {
        type: 'object',
        properties: {
            includeTools: {
                type: 'boolean',
                description: 'Include available tools in the introspection',
                default: true
            },
            includeContext: {
                type: 'boolean',
                description: 'Include current context and memory state',
                default: true
            },
            includePerformance: {
                type: 'boolean',
                description: 'Include performance metrics if available',
                default: false
            }
        }
    },
    handler: async (input: {
        includeTools?: boolean;
        includeContext?: boolean;
        includePerformance?: boolean;
    }, context: {
        agentId: string;
        channelId: string;
        requestId: string;
    }) => {
        const startTime = Date.now();
        
        try {
            const result: any = {
                agentId: context.agentId,
                channelId: context.channelId,
                timestamp: new Date().toISOString()
            };
            
            if (input.includeTools !== false) {
                // Get available tools
                let allTools: any[] = [];
                try {
                    const hybridRegistry = (global as any).hybridMcpToolRegistry;
                    if (hybridRegistry) {
                        allTools = hybridRegistry.getAllToolsSnapshot();
                    } else {
                        allTools = await firstValueFrom(McpToolRegistry.getInstance().listTools());
                    }
                } catch (error) {
                    allTools = await firstValueFrom(McpToolRegistry.getInstance().listTools());
                }
                
                const toolsByCategory = allTools.reduce((groups: any, tool) => {
                    const category = getToolCategory(tool.name);
                    if (!groups[category]) groups[category] = [];
                    groups[category].push(tool.name);
                    return groups;
                }, {});
                
                result.capabilities = {
                    totalTools: allTools.length,
                    toolsByCategory,
                    sources: [...new Set(allTools.map(t => t.source || 'internal'))]
                };
            }
            
            if (input.includeContext !== false) {
                result.context = {
                    currentChannel: context.channelId,
                    requestId: context.requestId,
                    // Add more context as needed
                };
            }
            
            if (input.includePerformance) {
                result.performance = {
                    // Add performance metrics if available
                    uptime: process.uptime(),
                    memoryUsage: process.memoryUsage()
                };
            }
            
            result.processingTime = Date.now() - startTime;
            return result;
        } catch (error) {
            logger.error(`Agent introspection failed: ${error}`);
            throw error;
        }
    }
};

/**
 * Plans multi-step workflows using available tools
 */
export const workflow_plan = {
    name: META_TOOLS.WORKFLOW_PLAN,
    description: 'Plans multi-step workflows using available tools, considering dependencies and optimal execution order.',
    inputSchema: {
        type: 'object',
        properties: {
            goal: {
                type: 'string',
                description: 'The overall goal or objective to achieve'
            },
            constraints: {
                type: 'array',
                items: { type: 'string' },
                description: 'Constraints or requirements for the workflow'
            },
            preferredTools: {
                type: 'array',
                items: { type: 'string' },
                description: 'Preferred tools to use if available'
            },
            maxSteps: {
                type: 'number',
                description: 'Maximum number of steps in the workflow',
                minimum: 1,
                maximum: 20,
                default: 10
            }
        },
        required: ['goal']
    },
    handler: async (input: {
        goal: string;
        constraints?: string[];
        preferredTools?: string[];
        maxSteps?: number;
    }, context: {
        agentId: string;
        channelId: string;
        requestId: string;
    }) => {
        const startTime = Date.now();
        
        try {
            // Get available tools
            let allTools: any[] = [];
            try {
                const hybridRegistry = (global as any).hybridMcpToolRegistry;
                if (hybridRegistry) {
                    allTools = hybridRegistry.getAllToolsSnapshot();
                } else {
                    allTools = await firstValueFrom(McpToolRegistry.getInstance().listTools());
                }
            } catch (error) {
                allTools = await firstValueFrom(McpToolRegistry.getInstance().listTools());
            }
            
            // Basic workflow planning (simplified)
            const steps = [];
            const goalLower = input.goal.toLowerCase();
            
            // Add initial discovery step
            steps.push({
                stepNumber: 1,
                action: 'Discovery',
                tool: 'tools_recommend',
                description: 'Discover relevant tools for the goal',
                reasoning: 'Start by finding the best tools for the task'
            });
            
            // Add goal-specific steps based on keywords
            if (goalLower.includes('file') || goalLower.includes('read') || goalLower.includes('write')) {
                steps.push({
                    stepNumber: steps.length + 1,
                    action: 'File Operations',
                    tool: 'read_file',
                    description: 'Read or process files as needed',
                    reasoning: 'Goal involves file operations'
                });
            }
            
            if (goalLower.includes('message') || goalLower.includes('communicate')) {
                steps.push({
                    stepNumber: steps.length + 1,
                    action: 'Communication',
                    tool: 'messaging_send',
                    description: 'Send messages to relevant agents',
                    reasoning: 'Goal involves communication'
                });
            }
            
            if (goalLower.includes('analyze') || goalLower.includes('process')) {
                steps.push({
                    stepNumber: steps.length + 1,
                    action: 'Analysis',
                    tool: 'tools_recommend',
                    description: 'Use appropriate analysis tools',
                    reasoning: 'Goal requires analysis capabilities'
                });
            }
            
            // Add completion step
            steps.push({
                stepNumber: steps.length + 1,
                action: 'Completion',
                tool: 'task_complete',
                description: 'Report task completion with results',
                reasoning: 'Final step to document completion'
            });
            
            // Limit steps
            const maxSteps = input.maxSteps || 10;
            const limitedSteps = steps.slice(0, maxSteps);
            
            return {
                goal: input.goal,
                totalSteps: limitedSteps.length,
                estimatedTime: limitedSteps.length * 2, // Rough estimate in minutes
                workflow: limitedSteps,
                availableTools: allTools.length,
                processingTime: Date.now() - startTime
            };
        } catch (error) {
            logger.error(`Workflow planning failed: ${error}`);
            throw error;
        }
    }
};

/**
 * Get validation-aware tool recommendations based on failed executions and error context
 */
export const tools_recommend_on_error = {
    name: META_TOOLS.TOOLS_RECOMMEND_ON_ERROR,
    description: 'Get intelligent tool recommendations specifically triggered by validation failures or execution errors. Provides alternative tools, parameter corrections, and prevention strategies.',
    inputSchema: {
        type: 'object',
        properties: {
            failedTool: {
                type: 'string',
                description: 'Name of the tool that failed'
            },
            errorMessage: {
                type: 'string',
                description: 'Error message from the failed execution'
            },
            failedParameters: {
                type: 'object',
                description: 'Parameters that were used in the failed call',
                additionalProperties: true
            },
            intent: {
                type: 'string',
                description: 'What you were trying to accomplish with the failed tool'
            },
            maxAlternatives: {
                type: 'number',
                description: 'Maximum number of alternative tools to suggest (default: 3)',
                minimum: 1,
                maximum: 10,
                default: 3
            },
            includeParameterCorrections: {
                type: 'boolean',
                description: 'Include parameter correction suggestions (default: true)',
                default: true
            },
            includeLearningRecommendations: {
                type: 'boolean',
                description: 'Include learning-based recommendations from successful patterns (default: true)',
                default: true
            }
        },
        required: ['failedTool', 'errorMessage']
    },
    handler: async (input: {
        failedTool: string;
        errorMessage: string;
        failedParameters?: any;
        intent?: string;
        maxAlternatives?: number;
        includeParameterCorrections?: boolean;
        includeLearningRecommendations?: boolean;
    }, context: {
        agentId: string;
        channelId: string;
        requestId: string;
    }) => {
        const startTime = Date.now();
        
        try {
            // Validate inputs
            validator.assertIsNonEmptyString(input.failedTool, 'failedTool is required');
            validator.assertIsNonEmptyString(input.errorMessage, 'errorMessage is required');
            validator.assertIsNonEmptyString(context.agentId, 'agentId is required');
            validator.assertIsNonEmptyString(context.channelId, 'channelId is required');


            // Set defaults
            const maxAlternatives = input.maxAlternatives || 3;
            const includeParameterCorrections = input.includeParameterCorrections !== false;
            const includeLearningRecommendations = input.includeLearningRecommendations !== false;
            
            // Initialize services
            const validationService = ValidationPerformanceService.getInstance();
            const patternService = PatternLearningService.getInstance();
            
            // Store the failed pattern for learning
            if (input.failedParameters) {
                try {
                    const errorType = input.errorMessage.includes('Missing required') ? 'missingRequired' :
                                    input.errorMessage.includes('Unknown properties') ? 'unknownProperties' :
                                    input.errorMessage.includes('type') ? 'typeMismatch' : 'other';
                    
                    await patternService.storeFailedPattern(
                        context.agentId as AgentId,
                        context.channelId as ChannelId,
                        input.failedTool,
                        input.failedParameters,
                        errorType,
                        input.errorMessage
                    );
                } catch (error) {
                    logger.warn(`Failed to store error pattern: ${error}`);
                }
            }
            
            // Get all available tools
            let allTools: any[] = [];
            try {
                const hybridRegistry = (global as any).hybridMcpToolRegistry;
                if (hybridRegistry) {
                    allTools = hybridRegistry.getAllToolsSnapshot();
                } else {
                    allTools = await firstValueFrom(McpToolRegistry.getInstance().listTools());
                }
            } catch (error) {
                allTools = await firstValueFrom(McpToolRegistry.getInstance().listTools());
            }
            
            // Find similar tools in the same category
            const failedToolCategory = getToolCategory(input.failedTool);
            const alternativeTools = allTools
                .filter(tool => 
                    tool.name !== input.failedTool &&
                    getToolCategory(tool.name) === failedToolCategory
                )
                .slice(0, maxAlternatives);
            
            // Get enhanced tool metrics for validation insights
            let enhancedToolMetrics = null;
            try {
                enhancedToolMetrics = await validationService.getEnhancedToolMetrics(
                    context.agentId as AgentId,
                    context.channelId as ChannelId
                );
            } catch (error) {
                logger.warn(`Failed to get enhanced tool metrics: ${error}`);
            }
            
            // Build alternative recommendations
            const alternatives: ToolRecommendation[] = [];
            
            for (const tool of alternativeTools) {
                const successRate = enhancedToolMetrics?.toolValidationSuccessRates[tool.name] || 1.0;
                const commonErrors = enhancedToolMetrics?.commonValidationErrors[tool.name] || [];
                
                const recommendation: ToolRecommendation = {
                    name: tool.name,
                    description: tool.description,
                    category: getToolCategory(tool.name),
                    relevanceScore: successRate, // Use success rate as relevance for error-based recommendations
                    reasoning: `Alternative to ${input.failedTool} with ${Math.round(successRate * 100)}% success rate`,
                    usageHint: `Try ${tool.name} instead of ${input.failedTool} for similar functionality`,
                    validationInsights: {
                        successRate,
                        commonErrors,
                        lastValidationIssue: commonErrors.length > 0 ? commonErrors[0] : undefined
                    }
                };
                
                // Add parameter examples if available
                if (includeLearningRecommendations) {
                    try {
                        const patterns = await patternService.getEnhancedPatterns(
                            context.channelId as ChannelId,
                            tool.name,
                            true
                        );
                        
                        if (patterns.successful.length > 0) {
                            recommendation.parameterExamples = patterns.successful
                                .slice(0, 2)
                                .map(pattern => ({
                                    example: pattern.parameters,
                                    description: `Proven successful pattern`,
                                    confidence: pattern.confidenceScore,
                                    usageCount: pattern.frequency
                                }));
                        }
                    } catch (error) {
                    }
                }
                
                alternatives.push(recommendation);
            }
            
            // Get parameter corrections for the failed tool
            let parameterCorrections: Array<{
                suggested: any;
                reason: string;
                confidence: number;
            }> = [];
            if (includeParameterCorrections && input.failedParameters) {
                try {
                    const patterns = await patternService.getEnhancedPatterns(
                        context.channelId as ChannelId,
                        input.failedTool,
                        true
                    );
                    
                    // Find successful patterns that might work as corrections
                    parameterCorrections = patterns.successful
                        .slice(0, 3)
                        .map(pattern => ({
                            suggested: pattern.parameters,
                            reason: `Successful pattern used ${pattern.frequency} times`,
                            confidence: pattern.confidenceScore
                        }));
                } catch (error) {
                }
            }
            
            // Generate prevention tips based on error type
            const preventionTips: string[] = [];
            if (input.errorMessage.includes('Missing required')) {
                preventionTips.push('Use tool_help to review required parameters before execution');
                preventionTips.push('Use tool_validate to check parameter completeness');
            } else if (input.errorMessage.includes('Unknown properties')) {
                preventionTips.push('Check tool schema for valid parameter names');
                preventionTips.push('Remove unrecognized parameters from your request');
            } else if (input.errorMessage.includes('type')) {
                preventionTips.push('Verify parameter data types match schema requirements');
                preventionTips.push('Convert strings to numbers or booleans as needed');
            } else {
                preventionTips.push('Review tool documentation for proper usage');
                preventionTips.push('Test with minimal parameters first');
            }
            
            const processingTime = Date.now() - startTime;
            
            return {
                failedTool: input.failedTool,
                errorType: input.errorMessage.includes('Missing required') ? 'missingRequired' :
                          input.errorMessage.includes('Unknown properties') ? 'unknownProperties' :
                          input.errorMessage.includes('type') ? 'typeMismatch' : 'other',
                errorMessage: input.errorMessage,
                alternatives: alternatives.sort((a, b) => b.relevanceScore - a.relevanceScore),
                parameterCorrections,
                preventionTips,
                learningInsights: {
                    patternStored: !!input.failedParameters,
                    similarFailuresInChannel: enhancedToolMetrics?.commonValidationErrors[input.failedTool]?.length || 0,
                    recommendedLearningActions: [
                        'Study successful parameter examples',
                        'Use help tools before attempting similar operations',
                        'Review patterns from other agents'
                    ]
                },
                processingTime,
                agentId: context.agentId,
                channelId: context.channelId
            };
        } catch (error) {
            logger.error(`Error-based recommendation failed: ${error}`);
            throw error;
        }
    }
};

/**
 * Analyzes failed tool calls and suggests fixes - Enhanced with Phase 4 Auto-Correction
 */
export const error_diagnose = {
    name: META_TOOLS.ERROR_DIAGNOSE,
    description: 'Analyzes failed tool calls and execution errors to provide diagnostic information, suggested fixes, and automatic correction attempts when possible.',
    inputSchema: {
        type: 'object',
        properties: {
            toolName: {
                type: 'string',
                description: 'Name of the tool that failed'
            },
            errorMessage: {
                type: 'string',
                description: 'Error message from the failed execution'
            },
            inputUsed: {
                type: 'object',
                description: 'Input parameters that were used in the failed call',
                additionalProperties: true
            },
            context: {
                type: 'string',
                description: 'Additional context about when/how the error occurred'
            },
            enableAutoCorrection: {
                type: 'boolean',
                description: 'Whether to attempt automatic correction of the error (default: true)',
                default: true
            },
            includePatternAnalysis: {
                type: 'boolean',
                description: 'Whether to include pattern-based analysis and recommendations (default: true)',
                default: true
            }
        },
        required: ['toolName', 'errorMessage']
    },
    handler: async (input: {
        toolName: string;
        errorMessage: string;
        inputUsed?: any;
        context?: string;
        enableAutoCorrection?: boolean;
        includePatternAnalysis?: boolean;
    }, context: {
        agentId: string;
        channelId: string;
        requestId: string;
    }) => {
        const startTime = Date.now();
        
        try {
            const enableAutoCorrection = input.enableAutoCorrection !== false;
            const includePatternAnalysis = input.includePatternAnalysis !== false;
            
            // Initialize services
            const autoCorrectionService = AutoCorrectionService.getInstance();
            const validationService = ValidationPerformanceService.getInstance();
            const patternService = PatternLearningService.getInstance();
            
            // Get tool information
            let allTools: any[] = [];
            try {
                const hybridRegistry = (global as any).hybridMcpToolRegistry;
                if (hybridRegistry) {
                    allTools = hybridRegistry.getAllToolsSnapshot();
                } else {
                    allTools = await firstValueFrom(McpToolRegistry.getInstance().listTools());
                }
            } catch (error) {
                allTools = await firstValueFrom(McpToolRegistry.getInstance().listTools());
            }
            
            const tool = allTools.find(t => t.name === input.toolName);
            
            if (!tool) {
                return {
                    diagnosis: 'Tool not found',
                    severity: 'high',
                    possibleCauses: ['Tool name misspelled', 'Tool not registered', 'Tool not available'],
                    suggestions: [
                        `Use tools_discover to find available tools`,
                        `Check spelling of tool name: "${input.toolName}"`,
                        `Use tools_validate to check tool availability`
                    ],
                    processingTime: Date.now() - startTime,
                    autoCorrectionAttempted: false
                };
            }
            
            // Analyze error message
            const errorLower = input.errorMessage.toLowerCase();
            const analysis: {
                diagnosis: string;
                severity: string;
                possibleCauses: string[];
                suggestions: string[];
                errorType: string;
            } = {
                diagnosis: 'Unknown error',
                severity: 'medium',
                possibleCauses: [],
                suggestions: [],
                errorType: 'other'
            };
            
            if (errorLower.includes('required') || errorLower.includes('missing')) {
                analysis.diagnosis = 'Missing required parameter';
                analysis.severity = 'medium';
                analysis.errorType = 'missingRequired';
                analysis.possibleCauses = ['Required input parameter not provided', 'Parameter name incorrect'];
                analysis.suggestions = [
                    'Check tool schema for required parameters',
                    'Verify parameter names match exactly',
                    'Ensure all required fields are provided'
                ];
            } else if (errorLower.includes('unknown') && errorLower.includes('propert')) {
                analysis.diagnosis = 'Unknown or invalid properties';
                analysis.severity = 'medium';
                analysis.errorType = 'unknownProperties';
                analysis.possibleCauses = ['Extra parameter provided', 'Parameter name typo', 'Schema mismatch'];
                analysis.suggestions = [
                    'Remove unknown parameters',
                    'Check parameter names for typos',
                    'Verify against current tool schema'
                ];
            } else if (errorLower.includes('invalid') || errorLower.includes('validation')) {
                analysis.diagnosis = 'Parameter validation failed';
                analysis.severity = 'medium';
                analysis.errorType = 'typeMismatch';
                analysis.possibleCauses = ['Invalid parameter value', 'Wrong data type', 'Value out of range'];
                analysis.suggestions = [
                    'Check parameter types in tool schema',
                    'Verify value ranges and constraints',
                    'Ensure data format matches expected format'
                ];
            } else if (errorLower.includes('timeout') || errorLower.includes('connection')) {
                analysis.diagnosis = 'Connection or timeout error';
                analysis.severity = 'high';
                analysis.errorType = 'timeout';
                analysis.possibleCauses = ['Network connectivity issues', 'External service unavailable', 'Request timeout'];
                analysis.suggestions = [
                    'Check network connectivity',
                    'Verify external service availability',
                    'Try again after a brief delay'
                ];
            } else if (errorLower.includes('permission') || errorLower.includes('access')) {
                analysis.diagnosis = 'Permission or access denied';
                analysis.severity = 'high';
                analysis.errorType = 'permission';
                analysis.possibleCauses = ['Insufficient permissions', 'Authentication required', 'Resource not accessible'];
                analysis.suggestions = [
                    'Check access permissions',
                    'Verify authentication credentials',
                    'Ensure resource exists and is accessible'
                ];
            }
            
            // Attempt auto-correction if enabled and applicable
            let autoCorrectionResult = null;
            if (enableAutoCorrection && input.inputUsed && ['missingRequired', 'unknownProperties', 'typeMismatch'].includes(analysis.errorType)) {
                try {
                    
                    autoCorrectionResult = await autoCorrectionService.attemptCorrection(
                        context.agentId as AgentId,
                        context.channelId as ChannelId,
                        input.toolName,
                        input.inputUsed,
                        input.errorMessage,
                        tool.inputSchema
                    );
                    
                    if (autoCorrectionResult.corrected) {
                        analysis.suggestions.unshift(
                            `AUTO-CORRECTION AVAILABLE: Try with corrected parameters (confidence: ${Math.round((autoCorrectionResult.confidence || 0) * 100)}%)`
                        );
                    }
                } catch (error) {
                    logger.warn(`Auto-correction attempt failed: ${error}`);
                }
            }
            
            // Get pattern-based insights if enabled
            let patternInsights = null;
            if (includePatternAnalysis) {
                try {
                    // Get validation metrics for this agent and tool
                    const validationMetrics = await validationService.getValidationMetrics(
                        context.agentId as AgentId,
                        context.channelId as ChannelId
                    );
                    
                    const toolErrors = validationMetrics.validationErrorsByTool[input.toolName] || 0;
                    const failedPatterns = validationMetrics.parameterPatterns.failedPatterns[input.toolName] || [];
                    const successfulPatterns = validationMetrics.parameterPatterns.successfulPatterns[input.toolName] || [];
                    
                    // Get enhanced patterns from persistent storage
                    const enhancedPatterns = await patternService.getEnhancedPatterns(
                        context.channelId as ChannelId,
                        input.toolName,
                        true // include shared patterns
                    );
                    
                    patternInsights = {
                        previousErrorsWithThisTool: toolErrors,
                        commonFailurePatterns: failedPatterns.slice(0, 3).map(p => ({
                            parameters: p.parameters,
                            errorType: p.errorType,
                            frequency: p.frequency
                        })),
                        successfulPatterns: enhancedPatterns.successful.slice(0, 3).map(p => ({
                            parameters: p.parameters,
                            confidence: p.confidenceScore,
                            usageCount: p.frequency,
                            description: `Used successfully ${p.frequency} times`
                        })),
                        sharedPatterns: enhancedPatterns.shared.slice(0, 2).map(p => ({
                            parameters: p.parameters,
                            confidence: p.confidenceScore,
                            source: `Shared pattern from other agents`,
                            usageCount: p.frequency
                        })),
                        recommendations: toolErrors > 2 ? [
                            'This tool has failed multiple times - consider using tool_help',
                            'Review successful patterns from other agents',
                            'Consider alternative tools with similar functionality'
                        ] : []
                    };
                } catch (error) {
                    logger.warn(`Failed to get pattern insights: ${error}`);
                }
            }
            
            // Store failed pattern for learning
            if (input.inputUsed && includePatternAnalysis) {
                try {
                    await patternService.storeFailedPattern(
                        context.agentId as AgentId,
                        context.channelId as ChannelId,
                        input.toolName,
                        input.inputUsed,
                        analysis.errorType,
                        input.errorMessage
                    );
                } catch (error) {
                    logger.warn(`Failed to store failed pattern: ${error}`);
                }
            }
            
            const result = {
                toolName: input.toolName,
                toolFound: true,
                errorMessage: input.errorMessage,
                ...analysis,
                toolSchema: tool.inputSchema,
                autoCorrectionAttempted: !!autoCorrectionResult,
                autoCorrectionResult: autoCorrectionResult ? {
                    corrected: autoCorrectionResult.corrected,
                    correctedParameters: autoCorrectionResult.correctedParameters,
                    strategy: autoCorrectionResult.strategy,
                    confidence: autoCorrectionResult.confidence,
                    attemptId: autoCorrectionResult.attemptId,
                    shouldRetry: autoCorrectionResult.shouldRetry,
                    retryDelay: autoCorrectionResult.retryDelay
                } : null,
                patternInsights,
                processingTime: Date.now() - startTime,
                nextSteps: autoCorrectionResult?.corrected ? [
                    'Use the corrected parameters provided in autoCorrectionResult',
                    `Wait ${autoCorrectionResult.retryDelay}ms before retry to avoid overwhelming the system`,
                    'Report correction success/failure using the attemptId for learning'
                ] : [
                    'Review the suggestions and fix the parameters manually',
                    'Use tool_help to understand the tool schema better',
                    'Consider examining successful patterns from other agents'
                ]
            };
            
            
            return result;
            
        } catch (error) {
            logger.error(`Error diagnosis failed: ${error}`);
            throw error;
        }
    }
};

/**
 * Auto-correction system management and monitoring tools - Phase 4
 */

/**
 * Get comprehensive auto-correction system status and metrics
 */
export const auto_correction_status = {
    name: 'auto_correction_status',
    description: 'Get comprehensive status, metrics, and health information for the Phase 4 auto-correction system including all services and components.',
    inputSchema: {
        type: 'object',
        properties: {
            includeMetrics: {
                type: 'boolean',
                description: 'Include detailed system metrics (default: true)',
                default: true
            },
            includeHistory: {
                type: 'boolean',
                description: 'Include recent event history (default: false)',
                default: false
            },
            historyHours: {
                type: 'number',
                description: 'Hours of history to include when includeHistory is true (default: 1)',
                minimum: 1,
                maximum: 24,
                default: 1
            }
        }
    },
    handler: async (input: {
        includeMetrics?: boolean;
        includeHistory?: boolean;
        historyHours?: number;
    }, context: {
        agentId: string;
        channelId: string;
        requestId: string;
    }) => {
        const startTime = Date.now();
        
        try {
            const includeMetrics = input.includeMetrics !== false;
            const includeHistory = input.includeHistory === true;
            const historyHours = input.historyHours || 1;
            
            // Get integration service for system-wide view
            const integrationService = AutoCorrectionIntegrationService.getInstance();
            const correctionService = AutoCorrectionService.getInstance();
            const interceptor = ToolExecutionInterceptor.getInstance();
            const recoveryService = RecoveryWorkflowService.getInstance();
            
            // Get system health status
            const healthStatus = integrationService.getSystemHealthStatus();
            
            const result: any = {
                systemHealth: healthStatus,
                timestamp: new Date().toISOString(),
                services: {
                    correctionService: {
                        enabled: correctionService.getConfig().enabled,
                        maxRetryAttempts: correctionService.getConfig().maxRetryAttempts,
                        confidenceThreshold: correctionService.getConfig().confidenceThreshold,
                        enabledStrategies: correctionService.getConfig().enabledStrategies
                    },
                    interceptor: {
                        enabled: interceptor.getConfig().enabled,
                        autoRetryOnCorrection: interceptor.getConfig().autoRetryOnCorrection,
                        maxRetryAttempts: interceptor.getConfig().maxRetryAttempts,
                        activeExecutions: interceptor.getActiveExecutionsCount()
                    },
                    recoveryService: {
                        enabled: recoveryService.getConfig().enabled,
                        circuitBreakerEnabled: recoveryService.getConfig().circuitBreakerEnabled,
                        activeWorkflows: recoveryService.getActiveWorkflows().length,
                        circuitBreakerStates: Object.keys(recoveryService.getCircuitBreakerStates()).length
                    },
                    integration: {
                        crossServiceLearning: integrationService.getConfig().enableCrossServiceLearning,
                        systemMetrics: integrationService.getConfig().enableSystemMetrics,
                        automaticOptimization: integrationService.getConfig().enableAutomaticOptimization
                    }
                }
            };
            
            // Include detailed metrics if requested
            if (includeMetrics) {
                const systemMetrics = integrationService.getCurrentMetrics();
                if (systemMetrics) {
                    result.metrics = systemMetrics;
                } else {
                    result.metrics = {
                        status: 'Metrics collection in progress...',
                        correctionService: correctionService.getCorrectionStats(),
                        interceptor: interceptor.getExecutionStats(),
                        recoveryWorkflows: recoveryService.getRecoveryStats()
                    };
                }
            }
            
            // Include event history if requested
            if (includeHistory) {
                result.recentEvents = integrationService.getEventHistory(historyHours)
                    .slice(-50) // Last 50 events
                    .map(event => ({
                        timestamp: new Date(event.timestamp).toISOString(),
                        eventType: event.eventType,
                        component: event.component,
                        agentId: event.agentId,
                        toolName: event.details.toolName,
                        success: event.eventType.includes('success')
                    }));
            }
            
            result.processingTime = Date.now() - startTime;
            
            return result;
            
        } catch (error) {
            logger.error(`Failed to get auto-correction status: ${error}`);
            throw error;
        }
    }
};

/**
 * Configure auto-correction system settings
 */
export const auto_correction_configure = {
    name: 'auto_correction_configure',
    description: 'Configure auto-correction system settings including enabling/disabling services, adjusting thresholds, and modifying strategies.',
    inputSchema: {
        type: 'object',
        properties: {
            service: {
                type: 'string',
                enum: ['correction', 'interceptor', 'recovery', 'integration'],
                description: 'Which service to configure'
            },
            config: {
                type: 'object',
                description: 'Configuration settings to update',
                properties: {
                    enabled: { type: 'boolean' },
                    maxRetryAttempts: { type: 'number', minimum: 1, maximum: 10 },
                    confidenceThreshold: { type: 'number', minimum: 0.1, maximum: 1.0 },
                    enabledStrategies: {
                        type: 'array',
                        items: {
                            type: 'string',
                            enum: ['missing_required', 'wrong_parameter_names', 'type_mismatch', 'pattern_based']
                        }
                    },
                    autoRetryOnCorrection: { type: 'boolean' },
                    circuitBreakerEnabled: { type: 'boolean' },
                    enableCrossServiceLearning: { type: 'boolean' },
                    enableAutomaticOptimization: { type: 'boolean' }
                },
                additionalProperties: true
            }
        },
        required: ['service', 'config']
    },
    handler: async (input: {
        service: 'correction' | 'interceptor' | 'recovery' | 'integration';
        config: Record<string, any>;
    }, context: {
        agentId: string;
        channelId: string;
        requestId: string;
    }) => {
        const startTime = Date.now();
        
        try {
            let service: any;
            let currentConfig: any;
            
            switch (input.service) {
                case 'correction':
                    service = AutoCorrectionService.getInstance();
                    currentConfig = service.getConfig();
                    break;
                case 'interceptor':
                    service = ToolExecutionInterceptor.getInstance();
                    currentConfig = service.getConfig();
                    break;
                case 'recovery':
                    service = RecoveryWorkflowService.getInstance();
                    currentConfig = service.getConfig();
                    break;
                case 'integration':
                    service = AutoCorrectionIntegrationService.getInstance();
                    currentConfig = service.getConfig();
                    break;
                default:
                    throw new Error(`Unknown service: ${input.service}`);
            }
            
            // Validate configuration changes
            const updatedConfig = { ...currentConfig, ...input.config };
            
            // Apply configuration
            service.updateConfig(input.config);
            
            
            return {
                service: input.service,
                previousConfig: currentConfig,
                newConfig: service.getConfig(),
                changedSettings: Object.keys(input.config),
                processingTime: Date.now() - startTime,
                status: 'Configuration updated successfully'
            };
            
        } catch (error) {
            logger.error(`Failed to configure auto-correction service: ${error}`);
            throw error;
        }
    }
};

/**
 * Test auto-correction with a simulated error
 */
export const auto_correction_test = {
    name: 'auto_correction_test',
    description: 'Test the auto-correction system with a simulated tool execution error to verify functionality and measure response.',
    inputSchema: {
        type: 'object',
        properties: {
            toolName: {
                type: 'string',
                description: 'Name of tool to simulate failure for'
            },
            errorType: {
                type: 'string',
                enum: ['missing_required', 'unknown_properties', 'type_mismatch', 'timeout', 'permission'],
                description: 'Type of error to simulate'
            },
            parameters: {
                type: 'object',
                description: 'Test parameters to use in simulation',
                additionalProperties: true
            },
            testCorrection: {
                type: 'boolean',
                description: 'Whether to test auto-correction (default: true)',
                default: true
            }
        },
        required: ['toolName', 'errorType']
    },
    handler: async (input: {
        toolName: string;
        errorType: 'missing_required' | 'unknown_properties' | 'type_mismatch' | 'timeout' | 'permission';
        parameters?: Record<string, any>;
        testCorrection?: boolean;
    }, context: {
        agentId: string;
        channelId: string;
        requestId: string;
    }) => {
        const startTime = Date.now();
        
        try {
            const testCorrection = input.testCorrection !== false;
            const parameters = input.parameters || { test: 'value' };
            
            // Generate appropriate error message for test
            const errorMessages = {
                missing_required: 'Missing required parameter: id',
                unknown_properties: 'Unknown properties: invalidParam',
                type_mismatch: 'Expected number but received string for parameter: count',
                timeout: 'Request timeout after 30000ms',
                permission: 'Access denied: insufficient permissions'
            };
            
            const errorMessage = errorMessages[input.errorType];
            
            
            const result: any = {
                testParameters: {
                    toolName: input.toolName,
                    errorType: input.errorType,
                    simulatedError: errorMessage,
                    testParameters: parameters
                },
                testResults: {
                    correctionAttempted: false,
                    correctionSuccessful: false,
                    strategy: null,
                    confidence: 0,
                    processingTime: 0
                }
            };
            
            if (testCorrection) {
                const correctionService = AutoCorrectionService.getInstance();
                
                // Attempt correction
                const correctionResult = await correctionService.attemptCorrection(
                    context.agentId as AgentId,
                    context.channelId as ChannelId,
                    input.toolName,
                    parameters,
                    errorMessage
                );
                
                result.testResults = {
                    correctionAttempted: true,
                    correctionSuccessful: correctionResult.corrected,
                    strategy: correctionResult.strategy,
                    confidence: correctionResult.confidence,
                    correctedParameters: correctionResult.correctedParameters,
                    shouldRetry: correctionResult.shouldRetry,
                    retryDelay: correctionResult.retryDelay,
                    attemptId: correctionResult.attemptId,
                    processingTime: Date.now() - startTime
                };
                
                // Report test result (simulated success for testing)
                if (correctionResult.attemptId) {
                    setTimeout(async () => {
                        await correctionService.reportCorrectionResult(
                            correctionResult.attemptId!,
                            Math.random() > 0.3, // 70% simulated success rate
                            correctionResult.corrected ? undefined : 'Simulated test failure'
                        );
                    }, 100);
                }
            }
            
            result.totalProcessingTime = Date.now() - startTime;
            result.testStatus = testCorrection && result.testResults.correctionSuccessful 
                ? 'PASSED - Auto-correction working' 
                : testCorrection 
                    ? 'PARTIAL - Correction attempted but failed'
                    : 'SKIPPED - Correction test disabled';
            
            return result;
            
        } catch (error) {
            logger.error(`Auto-correction test failed: ${error}`);
            throw error;
        }
    }
};

/**
 * Get auto-correction learning insights and recommendations
 */
export const auto_correction_insights = {
    name: 'auto_correction_insights',
    description: 'Get learning insights, patterns, and recommendations from the auto-correction system to improve agent performance.',
    inputSchema: {
        type: 'object',
        properties: {
            toolName: {
                type: 'string',
                description: 'Specific tool to get insights for (optional)'
            },
            timeframe: {
                type: 'string',
                enum: ['1h', '6h', '24h', '7d'],
                description: 'Timeframe for insights (default: 24h)',
                default: '24h'
            },
            includeRecommendations: {
                type: 'boolean',
                description: 'Include actionable recommendations (default: true)',
                default: true
            }
        }
    },
    handler: async (input: {
        toolName?: string;
        timeframe?: '1h' | '6h' | '24h' | '7d';
        includeRecommendations?: boolean;
    }, context: {
        agentId: string;
        channelId: string;
        requestId: string;
    }) => {
        const startTime = Date.now();
        
        try {
            const timeframe = input.timeframe || '24h';
            const includeRecommendations = input.includeRecommendations !== false;
            
            // Convert timeframe to hours
            const timeframeHours = {
                '1h': 1,
                '6h': 6, 
                '24h': 24,
                '7d': 168
            }[timeframe];
            
            const integrationService = AutoCorrectionIntegrationService.getInstance();
            const validationService = ValidationPerformanceService.getInstance();
            const patternService = PatternLearningService.getInstance();
            
            // Get recent events for analysis
            const recentEvents = integrationService.getEventHistory(timeframeHours);
            
            // Filter by tool if specified
            const relevantEvents = input.toolName 
                ? recentEvents.filter(e => e.details.toolName === input.toolName)
                : recentEvents;
            
            // Analyze correction patterns
            const correctionEvents = relevantEvents.filter(e => 
                e.eventType === 'correction_success' || e.eventType === 'correction_failure'
            );
            
            const successfulCorrections = correctionEvents.filter(e => e.eventType === 'correction_success');
            const failedCorrections = correctionEvents.filter(e => e.eventType === 'correction_failure');
            
            // Get validation insights for this agent
            const validationMetrics = await validationService.getValidationMetrics(
                context.agentId as AgentId,
                context.channelId as ChannelId
            );
            
            const performanceAnalysis = await validationService.analyzeValidationPerformance(
                context.agentId as AgentId,
                context.channelId as ChannelId
            );
            
            const result = {
                timeframe,
                totalEvents: relevantEvents.length,
                correctionAnalysis: {
                    totalAttempts: correctionEvents.length,
                    successful: successfulCorrections.length,
                    failed: failedCorrections.length,
                    successRate: correctionEvents.length > 0 
                        ? successfulCorrections.length / correctionEvents.length 
                        : 0,
                    mostSuccessfulStrategies: analyzeStrategies(successfulCorrections),
                    commonFailurePatterns: analyzeFailurePatterns(failedCorrections)
                },
                agentPerformance: {
                    validationHealthScore: performanceAnalysis.validationHealthScore,
                    totalValidationErrors: validationMetrics.totalValidationErrors,
                    selfCorrectionRate: validationMetrics.efficiency.selfCorrectionRate,
                    problemAreas: performanceAnalysis.problemAreas.slice(0, 3)
                },
                learningInsights: {
                    masteredTools: performanceAnalysis.learningEffectiveness.masteredTools,
                    strugglingTools: performanceAnalysis.learningEffectiveness.strugglingTools,
                    learningRate: performanceAnalysis.learningEffectiveness.learningRate
                },
                processingTime: Date.now() - startTime
            } as any;
            
            // Add recommendations if requested
            if (includeRecommendations) {
                result.recommendations = [
                    ...performanceAnalysis.recommendations.slice(0, 5),
                    ...generateAutoCorrectionRecommendations(
                        result.correctionAnalysis,
                        result.agentPerformance
                    )
                ];
            }
            
            return result;
            
        } catch (error) {
            logger.error(`Failed to generate auto-correction insights: ${error}`);
            throw error;
        }
    }
};

// Helper methods for insights analysis (would be moved to a proper utility class in production)
function analyzeStrategies(successfulEvents: any[]): Array<{strategy: string, count: number, averageConfidence: number}> {
    const strategies = new Map<string, {count: number, totalConfidence: number}>();
    
    successfulEvents.forEach(event => {
        const strategy = event.details.strategy || 'unknown';
        const confidence = event.details.confidence || 0;
        
        if (!strategies.has(strategy)) {
            strategies.set(strategy, {count: 0, totalConfidence: 0});
        }
        
        const current = strategies.get(strategy)!;
        current.count++;
        current.totalConfidence += confidence;
    });
    
    return Array.from(strategies.entries())
        .map(([strategy, data]) => ({
            strategy,
            count: data.count,
            averageConfidence: data.count > 0 ? data.totalConfidence / data.count : 0
        }))
        .sort((a, b) => b.count - a.count);
}

function analyzeFailurePatterns(failedEvents: any[]): Array<{pattern: string, count: number}> {
    const patterns = new Map<string, number>();
    
    failedEvents.forEach(event => {
        const toolName = event.details.toolName || 'unknown';
        patterns.set(toolName, (patterns.get(toolName) || 0) + 1);
    });
    
    return Array.from(patterns.entries())
        .map(([pattern, count]) => ({pattern, count}))
        .sort((a, b) => b.count - a.count);
}

function generateAutoCorrectionRecommendations(
    correctionAnalysis: any, 
    agentPerformance: any
): Array<{priority: string, action: string, expectedImprovement: string}> {
    const recommendations: Array<{priority: string, action: string, expectedImprovement: string}> = [];
    
    if (correctionAnalysis.successRate < 0.5) {
        recommendations.push({
            priority: 'high',
            action: 'Review and improve parameter validation before tool execution',
            expectedImprovement: 'Reduce need for auto-correction by 30-50%'
        });
    }
    
    if (agentPerformance.selfCorrectionRate < 0.3) {
        recommendations.push({
            priority: 'medium',
            action: 'Increase usage of tool_help and validation tools',
            expectedImprovement: 'Improve self-correction rate and reduce errors'
        });
    }
    
    if (agentPerformance.strugglingTools.length > 0) {
        recommendations.push({
            priority: 'high',
            action: `Focus training on struggling tools: ${agentPerformance.strugglingTools.slice(0, 3).join(', ')}`,
            expectedImprovement: 'Reduce tool-specific error rates significantly'
        });
    }
    
    return recommendations;
}

/**
 * All meta-tools for export - Enhanced with Phase 4 auto-correction management
 */
export const metaTools = [
    tools_recommend,
    tools_recommend_on_error,
    tools_validate,
    tools_discover,
    tools_compare,
    prompt_optimize,
    agent_introspect,
    workflow_plan,
    error_diagnose,
    task_complete,
    // Phase 4 Auto-Correction Management Tools
    auto_correction_status,
    auto_correction_configure,
    auto_correction_test,
    auto_correction_insights
];
