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
 * Agent Registry Types and Name Resolution
 * 
 * Provides sophisticated agent name resolution with aliases, common names,
 * and fuzzy matching capabilities for natural language interpretation.
 */

import { Logger } from '../utils/Logger';

const logger = new Logger('debug', 'AgentRegistry', 'server');

/**
 * Enhanced agent registry entry with name resolution support
 */
export interface AgentRegistryEntry {
    agentId: string;                // Unique agent identifier
    commonName: string;              // Primary display name
    aliases: string[];               // Alternative names/references
    role: string;                    // Agent's role in the system
    capabilities: string[];          // Agent's capabilities
    metadata?: {
        department?: string;
        clearanceLevel?: string;
        timezone?: string;
        [key: string]: any;
    };
}

/**
 * Name resolution result with confidence scoring
 */
export interface NameResolutionResult {
    agentId: string;
    confidence: number;              // 0-1 confidence score
    matchType: 'exact' | 'alias' | 'fuzzy' | 'partial';
    resolvedFrom: string;            // The name that was matched
}

/**
 * Agent name resolver with sophisticated matching capabilities
 */
export class AgentNameResolver {
    private registry: Map<string, AgentRegistryEntry> = new Map();
    private nameIndex: Map<string, string> = new Map(); // name -> agentId
    private commonResolutions: Map<string, string> = new Map(); // Cached resolutions
    
    constructor() {
    }
    
    /**
     * Register an agent with all their names and aliases
     */
    registerAgent(entry: AgentRegistryEntry): void {
        // Store the main entry
        this.registry.set(entry.agentId, entry);
        
        // Index all names for fast lookup
        this.indexName(entry.commonName.toLowerCase(), entry.agentId);
        this.indexName(entry.agentId.toLowerCase(), entry.agentId);
        
        // Index all aliases
        entry.aliases.forEach(alias => {
            this.indexName(alias.toLowerCase(), entry.agentId);
        });
        
        // Also index common variations
        this.indexCommonVariations(entry);
        
    }
    
    /**
     * Resolve a name to an agent ID with confidence scoring
     */
    resolveNameToId(name: string, channelContext?: string[]): NameResolutionResult | null {
        const normalizedName = this.normalizeName(name);
        
        // 1. Check exact match in index
        if (this.nameIndex.has(normalizedName)) {
            return {
                agentId: this.nameIndex.get(normalizedName)!,
                confidence: 1.0,
                matchType: 'exact',
                resolvedFrom: name
            };
        }
        
        // 2. Check cached common resolutions
        if (this.commonResolutions.has(normalizedName)) {
            return {
                agentId: this.commonResolutions.get(normalizedName)!,
                confidence: 0.95,
                matchType: 'alias',
                resolvedFrom: name
            };
        }
        
        // 3. Try fuzzy matching
        const fuzzyResult = this.fuzzyMatch(normalizedName, channelContext);
        if (fuzzyResult) {
            // Cache this resolution for future use
            this.commonResolutions.set(normalizedName, fuzzyResult.agentId);
            return fuzzyResult;
        }
        
        // 4. Try partial matching (e.g., "scheduler" matches "ai-scheduler")
        const partialResult = this.partialMatch(normalizedName);
        if (partialResult) {
            this.commonResolutions.set(normalizedName, partialResult.agentId);
            return partialResult;
        }
        
        return null;
    }
    
    /**
     * Precompute common name resolutions for a channel
     */
    precomputeCommonResolutions(channelAgentIds: string[]): Map<string, string> {
        const resolutions = new Map<string, string>();
        
        channelAgentIds.forEach(agentId => {
            const entry = this.registry.get(agentId);
            if (!entry) return;
            
            // Add common shortened versions
            const firstName = entry.commonName.split(' ')[0];
            resolutions.set(firstName.toLowerCase(), agentId);
            
            // Add role-based references
            if (entry.role) {
                resolutions.set(entry.role.toLowerCase(), agentId);
                
                // Add "the" prefix versions
                resolutions.set(`the ${entry.role.toLowerCase()}`, agentId);
            }
            
            // Add department references if available
            if (entry.metadata?.department) {
                resolutions.set(entry.metadata.department.toLowerCase(), agentId);
            }
        });
        
        // Merge with common resolutions cache
        resolutions.forEach((agentId, name) => {
            this.commonResolutions.set(name, agentId);
        });
        
        return resolutions;
    }
    
    /**
     * Get all agents in the registry
     */
    getAllAgents(): AgentRegistryEntry[] {
        return Array.from(this.registry.values());
    }
    
    /**
     * Get agent by ID
     */
    getAgent(agentId: string): AgentRegistryEntry | null {
        return this.registry.get(agentId) || null;
    }
    
    /**
     * Clear the registry
     */
    clear(): void {
        this.registry.clear();
        this.nameIndex.clear();
        this.commonResolutions.clear();
    }
    
    // ============= Private Helper Methods =============
    
    private indexName(name: string, agentId: string): void {
        this.nameIndex.set(name, agentId);
    }
    
    private normalizeName(name: string): string {
        return name.toLowerCase()
            .trim()
            .replace(/^(the|a|an)\s+/i, '') // Remove articles
            .replace(/[.,!?]/g, '');         // Remove punctuation
    }
    
    private indexCommonVariations(entry: AgentRegistryEntry): void {
        const name = entry.commonName;
        
        // First name only
        const firstName = name.split(' ')[0];
        this.indexName(firstName.toLowerCase(), entry.agentId);
        
        // Last name only (if exists)
        const parts = name.split(' ');
        if (parts.length > 1) {
            const lastName = parts[parts.length - 1];
            this.indexName(lastName.toLowerCase(), entry.agentId);
        }
        
        // Role-based variations
        if (entry.role) {
            this.indexName(entry.role.toLowerCase(), entry.agentId);
            this.indexName(`the ${entry.role.toLowerCase()}`, entry.agentId);
        }
        
        // Department variations
        if (entry.metadata?.department) {
            this.indexName(entry.metadata.department.toLowerCase(), entry.agentId);
        }
    }
    
    private fuzzyMatch(name: string, channelContext?: string[]): NameResolutionResult | null {
        let bestMatch: NameResolutionResult | null = null;
        let bestScore = 0;
        
        this.nameIndex.forEach((agentId, indexedName) => {
            const score = this.calculateSimilarity(name, indexedName);
            
            // Boost score if agent is in current channel context
            const contextBoost = channelContext?.includes(agentId) ? 0.1 : 0;
            const adjustedScore = Math.min(score + contextBoost, 0.95);
            
            if (adjustedScore > bestScore && adjustedScore > 0.7) {
                bestScore = adjustedScore;
                bestMatch = {
                    agentId,
                    confidence: adjustedScore,
                    matchType: 'fuzzy',
                    resolvedFrom: indexedName
                };
            }
        });
        
        return bestMatch;
    }
    
    private partialMatch(name: string): NameResolutionResult | null {
        for (const [indexedName, agentId] of this.nameIndex.entries()) {
            if (indexedName.includes(name) || name.includes(indexedName)) {
                return {
                    agentId,
                    confidence: 0.8,
                    matchType: 'partial',
                    resolvedFrom: indexedName
                };
            }
        }
        return null;
    }
    
    private calculateSimilarity(str1: string, str2: string): number {
        // Simple Levenshtein distance-based similarity
        const maxLength = Math.max(str1.length, str2.length);
        if (maxLength === 0) return 1;
        
        const distance = this.levenshteinDistance(str1, str2);
        return 1 - (distance / maxLength);
    }
    
    private levenshteinDistance(str1: string, str2: string): number {
        const matrix: number[][] = [];
        
        for (let i = 0; i <= str2.length; i++) {
            matrix[i] = [i];
        }
        
        for (let j = 0; j <= str1.length; j++) {
            matrix[0][j] = j;
        }
        
        for (let i = 1; i <= str2.length; i++) {
            for (let j = 1; j <= str1.length; j++) {
                if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
                    matrix[i][j] = matrix[i - 1][j - 1];
                } else {
                    matrix[i][j] = Math.min(
                        matrix[i - 1][j - 1] + 1,  // substitution
                        matrix[i][j - 1] + 1,       // insertion
                        matrix[i - 1][j] + 1        // deletion
                    );
                }
            }
        }
        
        return matrix[str2.length][str1.length];
    }
    
    /**
     * Build formatted registry for SystemLLM context
     */
    formatForSystemLLM(): string {
        const entries = Array.from(this.registry.values());
        return entries.map(entry => {
            const aliases = entry.aliases.length > 0 ? ` (aka: ${entry.aliases.join(', ')})` : '';
            return `- ${entry.commonName}: ${entry.agentId}${aliases} - ${entry.role}`;
        }).join('\n');
    }
}