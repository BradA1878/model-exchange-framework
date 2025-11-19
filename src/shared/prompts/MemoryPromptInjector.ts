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
 * Memory Prompt Injector
 * 
 * Dynamically injects relevant memory entries into agent prompts.
 * Supports filtering by recency, importance, relevance, and memory type.
 */

import { Logger } from '../utils/Logger';
import { createStrictValidator } from '../utils/validation';

const logger = new Logger('info', 'MemoryPromptInjector', 'client');
const validator = createStrictValidator('MemoryPromptInjector');

export interface MemoryEntry {
    id: string;
    content: string;
    type: 'note' | 'state' | 'conversation' | 'custom' | 'task' | 'decision';
    importance?: 'high' | 'medium' | 'low';
    timestamp: Date | string;
    tags?: string[];
    source?: string;
    metadata?: Record<string, any>;
}

export interface MemoryInjectionConfig {
    maxEntries?: number;
    filterByType?: string[];
    filterByImportance?: string[];
    filterByTags?: string[];
    filterByRecency?: boolean;
    includeMetadata?: boolean;
    summarize?: boolean;
}

export class MemoryPromptInjector {
    /**
     * Inject memory context into prompt
     */
    public static injectMemoryContext(
        memories: MemoryEntry[],
        config: MemoryInjectionConfig = {}
    ): string {
        if (!memories || memories.length === 0) {
            return '';
        }

        // Apply filters
        let filteredMemories = this.filterMemories(memories, config);

        // Sort by importance and recency
        filteredMemories = this.sortMemories(filteredMemories, config);

        // Limit number of entries
        const maxEntries = config.maxEntries || 10;
        filteredMemories = filteredMemories.slice(0, maxEntries);

        if (filteredMemories.length === 0) {
            return '';
        }

        // Build memory context section
        return this.buildMemorySection(filteredMemories, config);
    }

    /**
     * Filter memories based on configuration
     */
    private static filterMemories(
        memories: MemoryEntry[],
        config: MemoryInjectionConfig
    ): MemoryEntry[] {
        let filtered = [...memories];

        // Filter by type
        if (config.filterByType && config.filterByType.length > 0) {
            filtered = filtered.filter(m => config.filterByType!.includes(m.type));
        }

        // Filter by importance
        if (config.filterByImportance && config.filterByImportance.length > 0) {
            filtered = filtered.filter(m => 
                m.importance && config.filterByImportance!.includes(m.importance)
            );
        }

        // Filter by tags
        if (config.filterByTags && config.filterByTags.length > 0) {
            filtered = filtered.filter(m => 
                m.tags && m.tags.some(tag => config.filterByTags!.includes(tag))
            );
        }

        // Filter by recency (last 24 hours)
        if (config.filterByRecency) {
            const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
            filtered = filtered.filter(m => {
                const timestamp = typeof m.timestamp === 'string' 
                    ? new Date(m.timestamp) 
                    : m.timestamp;
                return timestamp > oneDayAgo;
            });
        }

        return filtered;
    }

    /**
     * Sort memories by importance and recency
     */
    private static sortMemories(
        memories: MemoryEntry[],
        config: MemoryInjectionConfig
    ): MemoryEntry[] {
        const importanceOrder = { high: 3, medium: 2, low: 1 };

        return memories.sort((a, b) => {
            // First sort by importance if available
            if (a.importance && b.importance) {
                const importanceDiff = 
                    importanceOrder[b.importance] - importanceOrder[a.importance];
                if (importanceDiff !== 0) return importanceDiff;
            }

            // Then sort by recency
            const aTime = typeof a.timestamp === 'string' 
                ? new Date(a.timestamp).getTime() 
                : a.timestamp.getTime();
            const bTime = typeof b.timestamp === 'string' 
                ? new Date(b.timestamp).getTime() 
                : b.timestamp.getTime();
            
            return bTime - aTime;
        });
    }

    /**
     * Build memory section for prompt
     */
    private static buildMemorySection(
        memories: MemoryEntry[],
        config: MemoryInjectionConfig
    ): string {
        const sections = [];

        sections.push(`## Relevant Memory Context

*The following memory entries are relevant to your current task:*`);

        // Group memories by type for better organization
        const groupedMemories = this.groupMemoriesByType(memories);

        for (const [type, typeMemories] of Object.entries(groupedMemories)) {
            const typeLabel = this.getMemoryTypeLabel(type);
            sections.push(`\n### ${typeLabel}`);

            for (const memory of typeMemories) {
                sections.push(this.formatMemoryEntry(memory, config));
            }
        }

        return sections.join('\n');
    }

    /**
     * Group memories by type
     */
    private static groupMemoriesByType(memories: MemoryEntry[]): Record<string, MemoryEntry[]> {
        const grouped: Record<string, MemoryEntry[]> = {};

        for (const memory of memories) {
            if (!grouped[memory.type]) {
                grouped[memory.type] = [];
            }
            grouped[memory.type].push(memory);
        }

        return grouped;
    }

    /**
     * Get human-readable label for memory type
     */
    private static getMemoryTypeLabel(type: string): string {
        const labels: Record<string, string> = {
            note: 'Notes',
            state: 'Shared State',
            conversation: 'Conversation History',
            custom: 'Custom Data',
            task: 'Task Memory',
            decision: 'Decision History'
        };
        return labels[type] || type;
    }

    /**
     * Format a single memory entry
     */
    private static formatMemoryEntry(
        memory: MemoryEntry,
        config: MemoryInjectionConfig
    ): string {
        const parts = [];

        // Format importance indicator
        if (memory.importance) {
            const importanceEmoji = {
                high: '🔴',
                medium: '🟡',
                low: '🟢'
            };
            parts.push(`${importanceEmoji[memory.importance] || ''}`);
        }

        // Add content
        if (config.summarize && memory.content.length > 200) {
            parts.push(`${memory.content.substring(0, 200)}...`);
        } else {
            parts.push(memory.content);
        }

        // Add tags if present
        if (memory.tags && memory.tags.length > 0) {
            parts.push(`[Tags: ${memory.tags.join(', ')}]`);
        }

        // Add source if present
        if (memory.source) {
            parts.push(`(Source: ${memory.source})`);
        }

        // Add metadata if configured
        if (config.includeMetadata && memory.metadata) {
            const metadataStr = Object.entries(memory.metadata)
                .map(([key, value]) => `${key}: ${value}`)
                .join(', ');
            if (metadataStr) {
                parts.push(`{${metadataStr}}`);
            }
        }

        return `- ${parts.join(' ')}`;
    }

    /**
     * Extract task-relevant memories based on current context
     */
    public static extractTaskRelevantMemories(
        memories: MemoryEntry[],
        taskContext: string,
        maxEntries: number = 5
    ): MemoryEntry[] {
        // Simple keyword matching for now
        // Could be enhanced with semantic similarity in the future
        const keywords = this.extractKeywords(taskContext);
        
        const scoredMemories = memories.map(memory => {
            let score = 0;
            
            // Check content for keywords
            for (const keyword of keywords) {
                if (memory.content.toLowerCase().includes(keyword.toLowerCase())) {
                    score += 2;
                }
                // Check tags
                if (memory.tags?.some(tag => tag.toLowerCase().includes(keyword.toLowerCase()))) {
                    score += 1;
                }
            }
            
            // Boost recent memories
            const ageInHours = (Date.now() - new Date(memory.timestamp).getTime()) / (1000 * 60 * 60);
            if (ageInHours < 1) score += 3;
            else if (ageInHours < 24) score += 2;
            else if (ageInHours < 168) score += 1; // Last week
            
            // Boost by importance
            if (memory.importance === 'high') score += 3;
            else if (memory.importance === 'medium') score += 1;
            
            return { memory, score };
        });
        
        // Sort by score and return top N
        return scoredMemories
            .filter(item => item.score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, maxEntries)
            .map(item => item.memory);
    }

    /**
     * Extract keywords from task context
     */
    private static extractKeywords(text: string): string[] {
        // Simple keyword extraction - could be enhanced
        const stopWords = new Set(['the', 'is', 'at', 'which', 'on', 'a', 'an', 'as', 'are', 'was', 'were', 'been', 'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must', 'can', 'shall', 'to', 'of', 'in', 'for', 'with', 'by', 'from', 'about', 'into', 'through', 'during', 'before', 'after', 'above', 'below', 'between', 'under', 'over']);
        
        return text
            .toLowerCase()
            .split(/\W+/)
            .filter(word => word.length > 2 && !stopWords.has(word))
            .slice(0, 10); // Top 10 keywords
    }
}
