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
 * SystemLLM Memory Analyzer
 * 
 * Adapter that integrates SystemLLM service for intelligent memory content analysis.
 * This bridges the server-side SystemLLM with the client-side AutoMemoryCreator.
 */

import { ISystemLlmAnalyzer, MemoryAnalysisResult } from './AutoMemoryCreator';
import { MemoryEntry } from '../prompts/MemoryPromptInjector';
import { Logger } from '../utils/Logger';
import { createStrictValidator } from '../utils/validation';

const logger = new Logger('info', 'SystemLlmMemoryAnalyzer', 'client');
const validator = createStrictValidator('SystemLlmMemoryAnalyzer');

/**
 * JSON Schema for memory analysis structured output
 */
const MEMORY_ANALYSIS_SCHEMA = {
    type: 'object',
    properties: {
        shouldCreateMemory: {
            type: 'boolean',
            description: 'Whether this content should be stored as a memory'
        },
        importance: {
            type: 'string',
            enum: ['high', 'medium', 'low'],
            description: 'Importance level of the memory'
        },
        memoryType: {
            type: 'string',
            enum: ['note', 'state', 'conversation', 'custom', 'task', 'decision'],
            description: 'Type of memory entry'
        },
        confidence: {
            type: 'number',
            minimum: 0,
            maximum: 1,
            description: 'Confidence score for the analysis'
        },
        reasoning: {
            type: 'string',
            description: 'Explanation of why memory should or should not be created'
        },
        suggestedSummary: {
            type: 'string',
            description: 'Optional summarized version of the content'
        },
        keyInsights: {
            type: 'array',
            items: { type: 'string' },
            description: 'Key insights extracted from the content'
        },
        suggestedTags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Suggested tags for the memory'
        },
        entities: {
            type: 'array',
            items: { type: 'string' },
            description: 'Named entities found in the content'
        },
        sentiment: {
            type: 'string',
            enum: ['positive', 'neutral', 'negative'],
            description: 'Sentiment of the content'
        },
        complexity: {
            type: 'string',
            enum: ['simple', 'moderate', 'complex'],
            description: 'Complexity level of the content'
        }
    },
    required: ['shouldCreateMemory', 'importance', 'memoryType', 'confidence', 'reasoning', 'keyInsights', 'suggestedTags', 'entities', 'sentiment', 'complexity']
};

/**
 * SystemLLM Memory Analyzer implementation
 * 
 * This class acts as an adapter between AutoMemoryCreator and SystemLLM service.
 * It uses the server-side SystemLLM for intelligent content analysis.
 */
export class SystemLlmMemoryAnalyzer implements ISystemLlmAnalyzer {
    private systemLlmService: any; // SystemLlmService instance
    
    constructor(systemLlmService?: any) {
        this.systemLlmService = systemLlmService;
    }
    
    /**
     * Analyze memory content using SystemLLM for intelligent decision making
     */
    public async analyzeMemoryContent(
        content: string, 
        context?: Record<string, any>
    ): Promise<MemoryAnalysisResult> {
        try {
            validator.assertIsNonEmptyString(content, 'Content is required for memory analysis');
            
            if (!this.systemLlmService) {
                throw new Error('SystemLLM service not available');
            }
            
            // Build analysis prompt with rich context
            const analysisPrompt = this.buildMemoryAnalysisPrompt(content, context);
            
            // Use SystemLLM reasoning model for intelligent analysis
            const response = await this.systemLlmService.sendLlmRequest(
                analysisPrompt,
                MEMORY_ANALYSIS_SCHEMA,
                {
                    model: this.systemLlmService.getModelForOperation('reasoning'),
                    temperature: 0.3, // Lower temperature for more consistent analysis
                    maxTokens: 1000
                }
            );
            
            // Parse and validate the response
            let analysisResult: MemoryAnalysisResult;
            
            if (typeof response === 'string') {
                analysisResult = this.systemLlmService.extractJsonFromResponse(response);
            } else {
                analysisResult = response as MemoryAnalysisResult;
            }
            
            // Validate the analysis result
            this.validateAnalysisResult(analysisResult);
            
            
            return analysisResult;
            
        } catch (error) {
            logger.error(`SystemLLM memory analysis failed: ${error}`);
            // Return a conservative fallback analysis
            return this.createFallbackAnalysis(content, context);
        }
    }
    
    /**
     * Summarize content using SystemLLM
     */
    public async summarizeContent(content: string, maxLength?: number): Promise<string> {
        try {
            if (!this.systemLlmService) {
                return this.fallbackSummarize(content, maxLength);
            }
            
            const summarizePrompt = `Please provide a concise summary of the following content, keeping it under ${maxLength || 500} characters while preserving the key information and context:

Content:
${content}

Summary:`;
            
            const response = await this.systemLlmService.sendLlmRequest(
                summarizePrompt,
                { type: 'string' },
                {
                    model: this.systemLlmService.getModelForOperation('observation'),
                    temperature: 0.3,
                    maxTokens: Math.floor((maxLength || 500) / 2) // Rough token estimate
                }
            );
            
            return typeof response === 'string' ? response.trim() : String(response).trim();
            
        } catch (error) {
            logger.warn(`SystemLLM summarization failed, using fallback: ${error}`);
            return this.fallbackSummarize(content, maxLength);
        }
    }
    
    /**
     * Extract key insights using SystemLLM
     */
    public async extractKeyInsights(
        content: string, 
        context?: Record<string, any>
    ): Promise<string[]> {
        try {
            if (!this.systemLlmService) {
                return [content.substring(0, 100)];
            }
            
            const insightsPrompt = `Extract the key insights and important points from this content. Focus on actionable information, decisions made, important facts, and notable patterns.

Context: ${JSON.stringify(context || {})}

Content:
${content}

Return a JSON array of key insights (3-5 items maximum):`;
            
            const response = await this.systemLlmService.sendLlmRequest(
                insightsPrompt,
                {
                    type: 'array',
                    items: { type: 'string' },
                    maxItems: 5
                },
                {
                    model: this.systemLlmService.getModelForOperation('reasoning'),
                    temperature: 0.4,
                    maxTokens: 300
                }
            );
            
            if (Array.isArray(response)) {
                return response;
            } else if (typeof response === 'string') {
                const parsed = this.systemLlmService.extractJsonFromResponse(response);
                return Array.isArray(parsed) ? parsed : [response];
            }
            
            return [String(response)];
            
        } catch (error) {
            logger.warn(`SystemLLM insights extraction failed: ${error}`);
            return [content.substring(0, 100)];
        }
    }
    
    /**
     * Generate tags using SystemLLM
     */
    public async generateTags(
        content: string, 
        context?: Record<string, any>
    ): Promise<string[]> {
        try {
            if (!this.systemLlmService) {
                return this.fallbackTags(content, context);
            }
            
            const tagsPrompt = `Generate relevant tags for this content. Focus on topics, actions, entities, and categories that would help with future retrieval and organization.

Context: ${JSON.stringify(context || {})}

Content:
${content}

Return a JSON array of tags (5-8 tags maximum, use lowercase with hyphens for spaces):`;
            
            const response = await this.systemLlmService.sendLlmRequest(
                tagsPrompt,
                {
                    type: 'array',
                    items: { type: 'string' },
                    maxItems: 8
                },
                {
                    model: this.systemLlmService.getModelForOperation('observation'),
                    temperature: 0.5,
                    maxTokens: 200
                }
            );
            
            if (Array.isArray(response)) {
                return response.map(tag => String(tag).toLowerCase().replace(/\s+/g, '-'));
            } else if (typeof response === 'string') {
                const parsed = this.systemLlmService.extractJsonFromResponse(response);
                if (Array.isArray(parsed)) {
                    return parsed.map(tag => String(tag).toLowerCase().replace(/\s+/g, '-'));
                }
            }
            
            return this.fallbackTags(content, context);
            
        } catch (error) {
            logger.warn(`SystemLLM tag generation failed: ${error}`);
            return this.fallbackTags(content, context);
        }
    }
    
    /**
     * Build comprehensive memory analysis prompt
     */
    private buildMemoryAnalysisPrompt(content: string, context?: Record<string, any>): string {
        return `You are analyzing content to determine if it should be stored as a memory entry in an AI agent system.

Context Information:
- Channel: ${context?.channelId || 'unknown'}
- Agent: ${context?.agentId || 'unknown'}  
- Role: ${context?.role || 'unknown'}
- Timestamp: ${context?.timestamp ? new Date(context.timestamp).toISOString() : 'unknown'}
- Additional Context: ${JSON.stringify(context || {})}

Content to Analyze:
${content}

Please analyze this content and determine:

1. **Should Create Memory**: Should this content be stored as a memory? Consider:
   - Is it important information that could be useful later?
   - Does it contain decisions, insights, or significant events?
   - Is it more than just routine conversation?
   - Does it provide context that could help with future tasks?

2. **Importance Level**:
   - HIGH: Critical decisions, major insights, important facts, errors/problems, task completions
   - MEDIUM: Useful information, minor insights, coordination activities, preferences
   - LOW: Routine conversation, small talk, already-known information

3. **Memory Type**:
   - NOTE: General information or observations
   - STATE: System or channel state changes
   - CONVERSATION: Important dialogue or communication
   - TASK: Task-related information or progress
   - DECISION: Decisions made or choices considered
   - CUSTOM: Specialized or unique content

4. **Analysis Quality**: Provide reasoning, extract key insights, suggest tags, identify entities, assess sentiment and complexity.

Return your analysis in the specified JSON format.`;
    }
    
    /**
     * Validate analysis result structure
     */
    private validateAnalysisResult(result: any): void {
        validator.assertIsObject(result);
        validator.assertIsBoolean(result.shouldCreateMemory);
        validator.assertIsNonEmptyString(result.importance);
        validator.assertIsNonEmptyString(result.memoryType);
        validator.assertIsNumber(result.confidence);
        validator.assertIsNonEmptyString(result.reasoning);
        
        if (!['high', 'medium', 'low'].includes(result.importance)) {
            throw new Error(`Invalid importance level: ${result.importance}`);
        }
        
        if (!['note', 'state', 'conversation', 'custom', 'task', 'decision'].includes(result.memoryType)) {
            throw new Error(`Invalid memory type: ${result.memoryType}`);
        }
        
        if (result.confidence < 0 || result.confidence > 1) {
            throw new Error(`Invalid confidence score: ${result.confidence}`);
        }
    }
    
    /**
     * Create fallback analysis when SystemLLM fails
     */
    private createFallbackAnalysis(content: string, context?: Record<string, any>): MemoryAnalysisResult {
        const hasImportantKeywords = /\b(decided|completed|failed|error|important|critical|discovered|learned|agreed|resolved)\b/i.test(content);
        
        return {
            shouldCreateMemory: hasImportantKeywords || (content.length > 200),
            importance: hasImportantKeywords ? 'medium' : 'low',
            memoryType: 'note',
            confidence: 0.5,
            reasoning: 'Fallback analysis based on basic keyword detection and content length',
            keyInsights: [content.substring(0, 100)],
            suggestedTags: this.fallbackTags(content, context),
            entities: [],
            sentiment: 'neutral',
            complexity: content.length > 500 ? 'complex' : 'simple'
        };
    }
    
    /**
     * Fallback content summarization
     */
    private fallbackSummarize(content: string, maxLength?: number): string {
        const limit = maxLength || 500;
        if (content.length <= limit) {
            return content;
        }
        
        const halfLength = Math.floor(limit / 2) - 10;
        return `${content.substring(0, halfLength)} [...] ${content.substring(content.length - halfLength)}`;
    }
    
    /**
     * Fallback tag generation
     */
    private fallbackTags(content: string, context?: Record<string, any>): string[] {
        const tags = new Set<string>();
        
        // Add context-based tags
        if (context?.role) tags.add(`role-${context.role}`);
        if (context?.agentId) tags.add(`agent-${context.agentId}`);
        
        // Basic content-based tags
        if (content.includes('task')) tags.add('task');
        if (content.includes('error') || content.includes('failed')) tags.add('error');
        if (content.includes('completed') || content.includes('finished')) tags.add('completion');
        if (content.includes('decided') || content.includes('decision')) tags.add('decision');
        
        // Time-based tags
        const now = new Date();
        const hour = now.getHours();
        if (hour >= 9 && hour <= 17) tags.add('business-hours');
        else tags.add('after-hours');
        
        return Array.from(tags).slice(0, 6);
    }
}
