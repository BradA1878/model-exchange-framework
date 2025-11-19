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
 * MXF Reasoning History Service
 * 
 * Tracks and manages reasoning history for agents using reasoning-capable models.
 * Provides separate tracking from action history to maintain clean separation
 * between internal reasoning and external actions.
 */

import { Logger } from '../../shared/utils/Logger';
import { createStrictValidator } from '../../shared/utils/validation';

const logger = new Logger('debug', 'ReasoningHistoryService', 'client');
const validator = createStrictValidator('ReasoningHistoryService');

/**
 * Reasoning history entry
 */
export interface ReasoningEntry {
    timestamp: Date;
    agentId: string;
    reasoning: string;
    decision?: string;
    confidence?: number;
    context?: string;
    modelUsed?: string;
}

/**
 * Reasoning history options
 */
export interface ReasoningHistoryOptions {
    maxEntries?: number;        // Maximum entries to keep (default: 50)
    maxAge?: number;            // Maximum age in milliseconds (default: 1 hour)
    includeConfidence?: boolean; // Include confidence scores in output
}

/**
 * Service for managing agent reasoning history
 */
export class MxfReasoningHistoryService {
    private reasoningHistory: Map<string, ReasoningEntry[]> = new Map();
    private options: ReasoningHistoryOptions;
    
    constructor(options: ReasoningHistoryOptions = {}) {
        this.options = {
            maxEntries: options.maxEntries || 50,
            maxAge: options.maxAge || 3600000, // 1 hour
            includeConfidence: options.includeConfidence ?? true
        };
        
    }
    
    /**
     * Add a reasoning entry for an agent
     */
    async addReasoning(
        agentId: string, 
        reasoning: string, 
        decision?: string,
        confidence?: number,
        context?: string,
        modelUsed?: string
    ): Promise<void> {
        validator.assertIsNonEmptyString(agentId, 'agentId');
        validator.assertIsNonEmptyString(reasoning, 'reasoning');
        
        const entry: ReasoningEntry = {
            timestamp: new Date(),
            agentId,
            reasoning,
            decision,
            confidence,
            context,
            modelUsed
        };
        
        // Get or create history for agent
        if (!this.reasoningHistory.has(agentId)) {
            this.reasoningHistory.set(agentId, []);
        }
        
        const history = this.reasoningHistory.get(agentId)!;
        history.push(entry);
        
        // Cleanup old entries
        await this.cleanupHistory(agentId);
        
    }
    
    /**
     * Get formatted reasoning history for prompt injection
     */
    async getFormattedReasoningHistory(
        agentId: string, 
        limit: number = 10
    ): Promise<string | null> {
        const history = this.reasoningHistory.get(agentId);
        
        if (!history || history.length === 0) {
            return null;
        }
        
        // Get most recent entries
        const recentEntries = history.slice(-limit);
        
        // Format for prompt
        const formatted = recentEntries.map((entry, index) => {
            const timestamp = entry.timestamp.toLocaleTimeString();
            let line = `- [${timestamp}] ${entry.reasoning}`;
            
            if (entry.decision) {
                line += `\n  Decision: ${entry.decision}`;
            }
            
            if (this.options.includeConfidence && entry.confidence !== undefined) {
                line += ` (confidence: ${(entry.confidence * 100).toFixed(0)}%)`;
            }
            
            return line;
        }).join('\n');
        
        return formatted;
    }
    
    /**
     * Get raw reasoning history for an agent
     */
    getReasoningHistory(agentId: string): ReasoningEntry[] {
        return this.reasoningHistory.get(agentId) || [];
    }
    
    /**
     * Clear old reasoning entries
     */
    async clearOldReasoning(agentId: string, maxAge?: number): Promise<number> {
        const history = this.reasoningHistory.get(agentId);
        if (!history) return 0;
        
        const ageLimit = maxAge || this.options.maxAge!;
        const cutoffTime = Date.now() - ageLimit;
        const originalLength = history.length;
        
        // Filter out old entries
        const filteredHistory = history.filter(entry => 
            entry.timestamp.getTime() > cutoffTime
        );
        
        this.reasoningHistory.set(agentId, filteredHistory);
        
        const removedCount = originalLength - filteredHistory.length;
        if (removedCount > 0) {
        }
        
        return removedCount;
    }
    
    /**
     * Clear all reasoning history for an agent
     */
    clearAgentHistory(agentId: string): void {
        this.reasoningHistory.delete(agentId);
    }
    
    /**
     * Clear all reasoning history
     */
    clearAllHistory(): void {
        const agentCount = this.reasoningHistory.size;
        this.reasoningHistory.clear();
    }
    
    /**
     * Extract reasoning patterns for analysis
     */
    extractPatterns(agentId: string): ReasoningPattern[] {
        const history = this.reasoningHistory.get(agentId);
        if (!history || history.length < 3) return [];
        
        const patterns: ReasoningPattern[] = [];
        
        // Look for repeated reasoning patterns
        const reasoningTexts = history.map(h => h.reasoning.toLowerCase());
        const patternMap = new Map<string, number>();
        
        // Simple pattern detection: look for similar reasoning
        reasoningTexts.forEach(text => {
            // Extract key phrases
            const keyPhrases = this.extractKeyPhrases(text);
            keyPhrases.forEach(phrase => {
                const count = patternMap.get(phrase) || 0;
                patternMap.set(phrase, count + 1);
            });
        });
        
        // Convert to patterns
        patternMap.forEach((count, phrase) => {
            if (count > 2) { // Pattern appears more than twice
                patterns.push({
                    pattern: phrase,
                    frequency: count,
                    confidence: count / history.length
                });
            }
        });
        
        return patterns.sort((a, b) => b.frequency - a.frequency);
    }
    
    /**
     * Get reasoning summary for an agent
     */
    getReasoningSummary(agentId: string): ReasoningSummary {
        const history = this.reasoningHistory.get(agentId) || [];
        
        if (history.length === 0) {
            return {
                totalEntries: 0,
                averageConfidence: 0,
                recentDecisions: [],
                commonPatterns: []
            };
        }
        
        // Calculate average confidence
        const confidenceValues = history
            .filter(h => h.confidence !== undefined)
            .map(h => h.confidence!);
        
        const averageConfidence = confidenceValues.length > 0
            ? confidenceValues.reduce((a, b) => a + b, 0) / confidenceValues.length
            : 0;
        
        // Get recent decisions
        const recentDecisions = history
            .filter(h => h.decision)
            .slice(-5)
            .map(h => h.decision!);
        
        // Get common patterns
        const commonPatterns = this.extractPatterns(agentId)
            .slice(0, 5)
            .map(p => p.pattern);
        
        return {
            totalEntries: history.length,
            averageConfidence,
            recentDecisions,
            commonPatterns
        };
    }
    
    // ============= Private Helper Methods =============
    
    /**
     * Cleanup old entries to maintain size limits
     */
    private async cleanupHistory(agentId: string): Promise<void> {
        const history = this.reasoningHistory.get(agentId);
        if (!history) return;
        
        // Remove old entries by age
        const cutoffTime = Date.now() - this.options.maxAge!;
        let filteredHistory = history.filter(entry => 
            entry.timestamp.getTime() > cutoffTime
        );
        
        // Remove excess entries if over limit
        if (filteredHistory.length > this.options.maxEntries!) {
            const removeCount = filteredHistory.length - this.options.maxEntries!;
            filteredHistory = filteredHistory.slice(removeCount);
        }
        
        this.reasoningHistory.set(agentId, filteredHistory);
    }
    
    /**
     * Extract key phrases from reasoning text
     */
    private extractKeyPhrases(text: string): string[] {
        const phrases: string[] = [];
        
        // Extract patterns like "analyzed...", "decided...", "evaluated..."
        const actionPatterns = /\b(analyzed|decided|evaluated|considered|determined|concluded)\s+[\w\s]+/gi;
        const matches = text.match(actionPatterns);
        if (matches) {
            phrases.push(...matches.map(m => m.toLowerCase()));
        }
        
        // Extract constraint mentions
        const constraintPatterns = /\b(constraint|requirement|limitation|restriction):\s*[\w\s]+/gi;
        const constraintMatches = text.match(constraintPatterns);
        if (constraintMatches) {
            phrases.push(...constraintMatches.map(m => m.toLowerCase()));
        }
        
        return phrases;
    }
}

/**
 * Reasoning pattern interface
 */
export interface ReasoningPattern {
    pattern: string;
    frequency: number;
    confidence: number;
}

/**
 * Reasoning summary interface
 */
export interface ReasoningSummary {
    totalEntries: number;
    averageConfidence: number;
    recentDecisions: string[];
    commonPatterns: string[];
}