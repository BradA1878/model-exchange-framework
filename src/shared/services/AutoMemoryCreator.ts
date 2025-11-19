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
 * Auto-Memory Creation System
 * 
 * Automatically creates and manages memory entries based on agent interactions,
 * decisions, and important events. Uses SystemLLM for intelligent content analysis
 * instead of basic keyword parsing.
 */

import { Logger } from '../utils/Logger';
import { createStrictValidator } from '../utils/validation';
import { MemoryEntry } from '../prompts/MemoryPromptInjector';

const logger = new Logger('info', 'AutoMemoryCreator', 'client');
const validator = createStrictValidator('AutoMemoryCreator');

/**
 * SystemLLM interface for server-side intelligent analysis
 * This will be injected as a dependency to avoid circular imports
 */
export interface ISystemLlmAnalyzer {
    analyzeMemoryContent(content: string, context?: Record<string, any>): Promise<MemoryAnalysisResult>;
    summarizeContent(content: string, maxLength?: number): Promise<string>;
    extractKeyInsights(content: string, context?: Record<string, any>): Promise<string[]>;
    generateTags(content: string, context?: Record<string, any>): Promise<string[]>;
}

/**
 * Result from SystemLLM memory analysis
 */
export interface MemoryAnalysisResult {
    shouldCreateMemory: boolean;
    importance: 'high' | 'medium' | 'low';
    memoryType: MemoryEntry['type'];
    confidence: number;
    reasoning: string;
    suggestedSummary?: string;
    keyInsights: string[];
    suggestedTags: string[];
    entities: string[];
    sentiment: 'positive' | 'neutral' | 'negative';
    complexity: 'simple' | 'moderate' | 'complex';
}

export interface AutoMemoryConfig {
    enabled: boolean;
    autoDetectImportance: boolean;
    autoTagging: boolean;
    memoryRetentionDays?: number;
    maxMemoriesPerType?: number;
    importanceThresholds?: {
        high: number;
        medium: number;
        low: number;
    };
}

export interface MemoryTrigger {
    type: 'decision' | 'task_completion' | 'error' | 'collaboration' | 'state_change' | 'pattern';
    pattern?: RegExp;
    importance?: 'high' | 'medium' | 'low';
    tags?: string[];
}

export class AutoMemoryCreator {
    private config: AutoMemoryConfig;
    private memoryBuffer: MemoryEntry[];
    private channelId: string;
    private agentId: string;
    private systemLlmAnalyzer?: ISystemLlmAnalyzer;

    constructor(
        channelId: string,
        agentId: string,
        config: Partial<AutoMemoryConfig> = {},
        systemLlmAnalyzer?: ISystemLlmAnalyzer
    ) {
        this.channelId = channelId;
        this.agentId = agentId;
        this.systemLlmAnalyzer = systemLlmAnalyzer;
        this.config = {
            enabled: true,
            autoDetectImportance: true,
            autoTagging: true,
            memoryRetentionDays: 30,
            maxMemoriesPerType: 100,
            importanceThresholds: {
                high: 0.8,
                medium: 0.5,
                low: 0.2
            },
            ...config
        };
        this.memoryBuffer = [];
        
    }

    /**
     * Initialize default memory triggers
     */
    private initializeDefaultTriggers(): MemoryTrigger[] {
        return [
            // Decision patterns
            {
                type: 'decision',
                pattern: /(?:decided|chose|selected|determined|opted for)/i,
                importance: 'high',
                tags: ['decision', 'choice']
            },
            // Task completion patterns
            {
                type: 'task_completion',
                pattern: /(?:completed|finished|accomplished|achieved|done with)/i,
                importance: 'medium',
                tags: ['task', 'completion']
            },
            // Error patterns
            {
                type: 'error',
                pattern: /(?:error|failed|exception|unable to|couldn't)/i,
                importance: 'high',
                tags: ['error', 'issue']
            },
            // Collaboration patterns
            {
                type: 'collaboration',
                pattern: /(?:coordinating with|working with|collaborating|sharing with)/i,
                importance: 'medium',
                tags: ['collaboration', 'teamwork']
            },
            // State change patterns
            {
                type: 'state_change',
                pattern: /(?:changed|updated|modified|transitioned|switched)/i,
                importance: 'medium',
                tags: ['state', 'change']
            },
            // Learning patterns
            {
                type: 'pattern',
                pattern: /(?:learned|discovered|found that|noticed|observed)/i,
                importance: 'high',
                tags: ['learning', 'pattern']
            }
        ];
    }

    /**
     * Process a message for potential memory creation using SystemLLM analysis
     */
    public async processMessage(
        content: string,
        context?: Record<string, any>
    ): Promise<MemoryEntry | null> {
        if (!this.config.enabled) {
            return null;
        }

        try {
            // Use SystemLLM for intelligent analysis if available
            let analysis: MemoryAnalysisResult;
            
            if (this.systemLlmAnalyzer) {
                analysis = await this.systemLlmAnalyzer.analyzeMemoryContent(content, {
                    channelId: this.channelId,
                    agentId: this.agentId,
                    ...context
                });
            } else {
                // Fallback to basic analysis
                analysis = await this.fallbackAnalysis(content, context);
            }

            // Check if memory should be created based on analysis
            if (!analysis.shouldCreateMemory && !context?.forceMemory) {
                return null;
            }

            // Create memory entry using analysis results
            const memory = await this.createMemoryFromAnalysis(content, analysis, context);

            // Add to buffer
            this.memoryBuffer.push(memory);

            // Check if we should flush buffer
            if (this.shouldFlushBuffer()) {
                await this.flushMemoryBuffer();
            }

            return memory;

        } catch (error) {
            logger.error(`Error processing message for memory: ${error}`);
            return null;
        }
    }

    /**
     * Fallback analysis when SystemLLM is not available
     */
    private async fallbackAnalysis(content: string, context?: Record<string, any>): Promise<MemoryAnalysisResult> {
        // Basic importance detection using keyword patterns
        const importance = this.detectImportance(content, context);
        const memoryType = this.determineMemoryType(null, context);
        const shouldCreateMemory = importance !== 'low' || context?.forceMemory;
        
        return {
            shouldCreateMemory,
            importance,
            memoryType,
            confidence: 0.6, // Lower confidence for fallback analysis
            reasoning: shouldCreateMemory ? 'Basic keyword analysis suggests this content is worth remembering' : 'Content appears routine based on keyword analysis',
            keyInsights: [content.substring(0, 100)], // Simple keyword extraction fallback
            suggestedTags: this.generateTags(content, null, context),
            entities: this.extractEntities(content),
            sentiment: 'neutral',
            complexity: content.length > 500 ? 'complex' : 'simple'
        };
    }
    
    /**
     * Create memory entry from SystemLLM analysis results
     */
    private async createMemoryFromAnalysis(
        content: string, 
        analysis: MemoryAnalysisResult, 
        context?: Record<string, any>
    ): Promise<MemoryEntry> {
        // Use SystemLLM summary if available, otherwise fallback
        let finalContent = content;
        if (analysis.suggestedSummary) {
            finalContent = analysis.suggestedSummary;
        } else if (this.systemLlmAnalyzer && content.length > 500) {
            try {
                finalContent = await this.systemLlmAnalyzer.summarizeContent(content, 500);
            } catch (error) {
                logger.warn(`Failed to get SystemLLM summary, using original content: ${error}`);
                finalContent = this.summarizeContent(content, 500);
            }
        } else if (content.length > 500) {
            finalContent = this.summarizeContent(content, 500);
        }

        const entry: MemoryEntry = {
            id: `mem_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            content: finalContent,
            type: analysis.memoryType,
            importance: analysis.importance,
            timestamp: new Date(),
            source: this.agentId,
            tags: analysis.suggestedTags || [],
            metadata: {
                channelId: this.channelId,
                agentId: this.agentId,
                confidence: analysis.confidence,
                reasoning: analysis.reasoning,
                complexity: analysis.complexity,
                sentiment: analysis.sentiment,
                entities: analysis.entities,
                keyInsights: analysis.keyInsights,
                analysisMethod: this.systemLlmAnalyzer ? 'SystemLLM' : 'fallback',
                originalLength: content.length,
                ...context
            }
        };

        return entry;
    }

    /**
     * Detect importance of content
     */
    private detectImportance(
        content: string,
        context?: Record<string, any>
    ): 'high' | 'medium' | 'low' {
        if (!this.config.autoDetectImportance) {
            return 'medium';
        }

        let score = 0;

        // Length-based scoring
        if (content.length > 500) score += 0.2;
        if (content.length > 1000) score += 0.2;

        // Keyword-based scoring
        const importantKeywords = [
            'critical', 'important', 'essential', 'must', 'required',
            'failed', 'error', 'success', 'completed', 'decision'
        ];
        for (const keyword of importantKeywords) {
            if (content.toLowerCase().includes(keyword)) {
                score += 0.15;
            }
        }

        // Context-based scoring
        if (context?.isDecision) score += 0.3;
        if (context?.isError) score += 0.4;
        if (context?.isCompletion) score += 0.2;
        if (context?.involvesCost) score += 0.3;
        if (context?.affectsMultipleAgents) score += 0.3;

        // Determine importance based on score
        const thresholds = this.config.importanceThresholds!;
        if (score >= thresholds.high) return 'high';
        if (score >= thresholds.medium) return 'medium';
        return 'low';
    }

    /**
     * Create a memory entry
     */
    private createMemoryEntry(
        content: string,
        trigger: MemoryTrigger | null,
        context?: Record<string, any>
    ): MemoryEntry {
        const entry: MemoryEntry = {
            id: `mem_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            content: this.summarizeContent(content),
            type: this.determineMemoryType(trigger, context),
            importance: trigger?.importance || this.detectImportance(content, context),
            timestamp: new Date(),
            source: this.agentId,
            tags: [],
            metadata: {
                channelId: this.channelId,
                agentId: this.agentId,
                triggerType: trigger?.type,
                ...context
            }
        };

        // Auto-tagging
        if (this.config.autoTagging) {
            entry.tags = this.generateTags(content, trigger, context);
        }

        return entry;
    }

    /**
     * Summarize content if too long
     */
    private summarizeContent(content: string, maxLength: number = 500): string {
        if (content.length <= maxLength) {
            return content;
        }

        // Simple summarization - take first and last parts
        const halfLength = Math.floor(maxLength / 2) - 20;
        const start = content.substring(0, halfLength);
        const end = content.substring(content.length - halfLength);
        
        return `${start} [...] ${end}`;
    }

    /**
     * Determine memory type
     */
    private determineMemoryType(
        trigger: MemoryTrigger | null,
        context?: Record<string, any>
    ): MemoryEntry['type'] {
        if (trigger?.type === 'decision') return 'decision';
        if (trigger?.type === 'task_completion') return 'task';
        if (context?.isConversation) return 'conversation';
        if (context?.isState) return 'state';
        return 'note';
    }

    /**
     * Generate tags for memory entry
     */
    private generateTags(
        content: string,
        trigger: MemoryTrigger | null,
        context?: Record<string, any>
    ): string[] {
        const tags = new Set<string>();

        // Add trigger tags
        if (trigger?.tags) {
            trigger.tags.forEach(tag => tags.add(tag));
        }

        // Add context tags
        if (context?.tags) {
            context.tags.forEach((tag: string) => tags.add(tag));
        }

        // Extract entity tags (simple implementation)
        const entities = this.extractEntities(content);
        entities.forEach(entity => tags.add(entity));

        // Add time-based tags
        const hour = new Date().getHours();
        if (hour >= 0 && hour < 6) tags.add('overnight');
        else if (hour >= 6 && hour < 12) tags.add('morning');
        else if (hour >= 12 && hour < 18) tags.add('afternoon');
        else tags.add('evening');

        return Array.from(tags).slice(0, 10); // Limit to 10 tags
    }

    /**
     * Extract entities from content (simple implementation)
     */
    private extractEntities(content: string): string[] {
        const entities: string[] = [];
        
        // Extract agent names (simple pattern)
        const agentPattern = /(?:agent|AI|bot)\s+(\w+)/gi;
        let match;
        while ((match = agentPattern.exec(content)) !== null) {
            entities.push(match[1].toLowerCase());
        }

        // Extract tool names (if mentioned)
        const toolPattern = /(?:using|tool|invoke|call)\s+(\w+)/gi;
        while ((match = toolPattern.exec(content)) !== null) {
            entities.push(`tool:${match[1].toLowerCase()}`);
        }

        return entities;
    }

    /**
     * Check if buffer should be flushed
     */
    private shouldFlushBuffer(): boolean {
        // Flush if buffer is large
        if (this.memoryBuffer.length >= 10) return true;
        
        // Flush if oldest memory is more than 5 minutes old
        if (this.memoryBuffer.length > 0) {
            const oldest = new Date(this.memoryBuffer[0].timestamp);
            const ageInMinutes = (Date.now() - oldest.getTime()) / (1000 * 60);
            if (ageInMinutes > 5) return true;
        }

        return false;
    }

    /**
     * Flush memory buffer to storage
     */
    private async flushMemoryBuffer(): Promise<void> {
        if (this.memoryBuffer.length === 0) return;

        try {
            // Here you would integrate with your actual memory storage system
            // For now, just log
            
            // Clear buffer after successful flush
            this.memoryBuffer = [];
        } catch (error) {
            logger.error('Failed to flush memory buffer:', error);
        }
    }

    /**
     * Manually create a memory entry
     */
    public createManualMemory(
        content: string,
        type: MemoryEntry['type'],
        importance: 'high' | 'medium' | 'low',
        tags?: string[]
    ): MemoryEntry {
        return {
            id: `mem_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            content,
            type,
            importance,
            timestamp: new Date(),
            source: this.agentId,
            tags: tags || [],
            metadata: {
                channelId: this.channelId,
                agentId: this.agentId,
                manual: true
            }
        };
    }

    /**
     * Clean up old memories based on retention policy
     */
    public async cleanupOldMemories(memories: MemoryEntry[]): Promise<MemoryEntry[]> {
        if (!this.config.memoryRetentionDays) {
            return memories;
        }

        const cutoffDate = new Date(
            Date.now() - this.config.memoryRetentionDays * 24 * 60 * 60 * 1000
        );

        // Keep all high importance memories regardless of age
        // Apply retention policy to medium and low importance
        const filtered = memories.filter(memory => {
            const memoryDate = new Date(memory.timestamp);
            return memory.importance === 'high' || memoryDate > cutoffDate;
        });

        // Apply max memories per type limit
        if (this.config.maxMemoriesPerType) {
            return this.limitMemoriesPerType(filtered);
        }

        return filtered;
    }

    /**
     * Limit memories per type
     */
    private limitMemoriesPerType(memories: MemoryEntry[]): MemoryEntry[] {
        const maxPerType = this.config.maxMemoriesPerType!;
        const grouped: Record<string, MemoryEntry[]> = {};

        // Group by type
        for (const memory of memories) {
            if (!grouped[memory.type]) {
                grouped[memory.type] = [];
            }
            grouped[memory.type].push(memory);
        }

        // Limit each type and recombine
        const limited: MemoryEntry[] = [];
        for (const [type, typeMemories] of Object.entries(grouped)) {
            // Sort by importance then recency
            const sorted = typeMemories.sort((a, b) => {
                const importanceOrder = { high: 3, medium: 2, low: 1 };
                const importanceDiff = 
                    (importanceOrder[b.importance || 'low'] || 0) - 
                    (importanceOrder[a.importance || 'low'] || 0);
                if (importanceDiff !== 0) return importanceDiff;
                
                return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
            });

            limited.push(...sorted.slice(0, maxPerType));
        }

        return limited;
    }
}
