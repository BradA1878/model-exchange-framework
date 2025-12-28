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
 * Pattern Memory Service for Enhanced Memory Architecture
 * Phase 2: Within-Channel Pattern Recognition and Workflow Optimization
 * 
 * Enhanced version using SystemLLM for intelligent pattern analysis
 */

import { Observable, BehaviorSubject, of, throwError } from 'rxjs';
import { v4 as uuidv4 } from 'uuid';

import { Logger } from '../utils/Logger';
import { AgentId } from '../types/Agent';
import { ChannelId } from '../types/ChannelContext';
import { 
    PatternMemoryEntry, 
    WorkflowMemoryEntry, 
    PatternAnalysisResult,
    PatternSearchCriteria,
    PatternRecommendation
} from '../types/PatternMemoryTypes';
import { MemoryService } from './MemoryService';
import { SystemLlmServiceManager } from '../../server/socket/services/SystemLlmServiceManager';

/**
 * Enhanced Pattern Memory Service with SystemLLM integration
 */
export class PatternMemoryService {
    private readonly logger: Logger;
    private readonly memoryService: MemoryService;
    
    // In-memory cache for patterns
    private readonly patternCache = new Map<string, PatternMemoryEntry>();
    private readonly workflowCache = new Map<string, WorkflowMemoryEntry>();
    
    // Reactive subjects for real-time updates
    private readonly patternUpdates$ = new BehaviorSubject<PatternMemoryEntry[]>([]);
    private readonly workflowUpdates$ = new BehaviorSubject<WorkflowMemoryEntry[]>([]);

    private constructor() {
        this.logger = new Logger('info', 'PatternMemoryService', 'server');
        this.memoryService = MemoryService.getInstance();
        
    }

    /**
     * Get singleton instance
     */
    public static getInstance(): PatternMemoryService {
        if (!PatternMemoryService.instance) {
            PatternMemoryService.instance = new PatternMemoryService();
        }
        return PatternMemoryService.instance;
    }

    private static instance: PatternMemoryService;

    // =============================================================================
    // PATTERN ANALYSIS AND DETECTION
    // =============================================================================

    /**
     * Analyze a sequence of actions to detect patterns using SystemLLM
     */
    public async analyzeSequenceForPatterns(
        channelId: ChannelId,
        agentId: AgentId,
        actionSequence: string[],
        context: Record<string, any>
    ): Promise<PatternAnalysisResult> {
        try {
            if (!channelId || !agentId || !Array.isArray(actionSequence)) {
                throw new Error('Invalid parameters for pattern analysis');
            }
            
            
            // Use SystemLlmService for intelligent pattern analysis
            const analysisPrompt = this.buildPatternAnalysisPrompt(actionSequence, context);
            
            try {
                // Get per-channel SystemLlmService instance
                const systemLlmService = SystemLlmServiceManager.getInstance().getServiceForChannel(channelId);
                if (!systemLlmService) {
                    throw new Error(`No SystemLLM available for channel ${channelId}`);
                }
                
                // Use SystemLlmService for intelligent pattern analysis with proper interface
                const promptInput = {
                    prompt: analysisPrompt,
                    options: {
                        maxTokens: 800,
                        temperature: 0.3
                    }
                };

                // Use processPrompt which is the proper way to access LLM
                const llmObservable = (systemLlmService as any).processPrompt(promptInput);
                
                const llmResponse = await new Promise<string>((resolve, reject) => {
                    llmObservable.subscribe({
                        next: (response: string) => resolve(response),
                        error: (error: any) => reject(error)
                    });
                });
                
                // Parse LLM response into pattern analysis
                const analysis = this.parsePatternAnalysisResponse(llmResponse);
                
                
                return analysis;
                
            } catch (llmError) {
                // Fallback to simplified analysis if LLM fails
                this.logger.warn(`⚠️ SystemLLM analysis failed, using fallback: ${llmError}`);
                return this.fallbackPatternAnalysis(actionSequence, context);
            }
            
        } catch (error) {
            this.logger.error(`❌ Error analyzing sequence for patterns: ${error}`);
            throw error;
        }
    }

    /**
     * Store a discovered pattern in memory
     */
    public async storePattern(
        channelId: ChannelId,
        agentId: AgentId,
        patternData: Omit<PatternMemoryEntry, 'patternId' | 'firstDiscovered' | 'usageCount' | 'successCount' | 'lastUsed'>
    ): Promise<Observable<PatternMemoryEntry>> {
        try {
            if (!channelId || !agentId || !patternData) {
                throw new Error('Invalid parameters for pattern storage');
            }
            
            const patternId = uuidv4();
            const timestamp = Date.now();
            
            const pattern: PatternMemoryEntry = {
                ...patternData,
                patternId,
                channelId,
                firstDiscovered: timestamp,
                usageCount: 1,
                successCount: 1,
                lastUsed: timestamp,
            };
            
            // Store in cache (using existing MemoryService for basic storage)
            this.patternCache.set(patternId, pattern);
            
            // Store in agent memory using existing MemoryService structure
            this.memoryService.updateAgentMemory(agentId, {
                [`pattern_${patternId}`]: JSON.stringify(pattern)
            }).subscribe({
                next: () => null,
                error: (error) => this.logger.warn(`⚠️ Failed to persist pattern: ${error}`)
            });
            
            // Emit update
            this.emitPatternUpdate(channelId);
            
            
            return of(pattern);
            
        } catch (error) {
            this.logger.error(`❌ Error storing pattern: ${error}`);
            return throwError(() => error);
        }
    }

    /**
     * Search for patterns matching criteria
     */
    public async searchPatterns(criteria: PatternSearchCriteria): Promise<Observable<PatternMemoryEntry[]>> {
        try {
            if (!criteria.channelId) {
                throw new Error('Channel ID is required for pattern search');
            }
            
            
            // Get patterns from cache
            const patterns = Array.from(this.patternCache.values())
                .filter(pattern => pattern.channelId === criteria.channelId)
                .filter(pattern => this.matchesCriteria(pattern, criteria));
            
            // Sort by relevance (effectiveness * usage count)
            patterns.sort((a, b) => {
                const scoreA = a.effectiveness * a.usageCount;
                const scoreB = b.effectiveness * b.usageCount;
                return scoreB - scoreA;
            });
            
            
            return of(patterns);
            
        } catch (error) {
            this.logger.error(`❌ Error searching patterns: ${error}`);
            return throwError(() => error);
        }
    }

    /**
     * Get pattern recommendations for an agent
     */
    public async getPatternRecommendations(
        channelId: ChannelId,
        agentId: AgentId,
        currentContext: Record<string, any>
    ): Promise<Observable<PatternRecommendation[]>> {
        try {
            if (!channelId || !agentId) {
                throw new Error('Channel ID and Agent ID are required for recommendations');
            }
            
            
            // Get high-performing patterns for the channel
            const patterns = Array.from(this.patternCache.values())
                .filter(p => p.channelId === channelId && p.effectiveness > 0.7 && p.usageCount > 1);
            
            // Create simplified recommendations
            const recommendations: PatternRecommendation[] = patterns.slice(0, 5).map(pattern => ({
                pattern,
                relevance: Math.min(pattern.effectiveness * 1.2, 1.0),
                reason: `This pattern has ${(pattern.effectiveness * 100).toFixed(1)}% effectiveness with ${pattern.usageCount} uses`,
                expectedBenefits: [`Improved efficiency based on ${pattern.successCount} successful executions`],
                adaptationSuggestions: ['Consider adapting the pattern to your current context'],
                risks: ['Pattern may need adaptation for different contexts'],
                confidence: pattern.metadata.confidence
            }));
            
            // Sort by relevance
            recommendations.sort((a, b) => b.relevance - a.relevance);
            
            
            return of(recommendations);
            
        } catch (error) {
            this.logger.error(`❌ Error getting pattern recommendations: ${error}`);
            return throwError(() => error);
        }
    }

    // =============================================================================
    // PRIVATE HELPER METHODS
    // =============================================================================

    private hasRepeatingElements(sequence: string[]): boolean {
        const uniqueElements = new Set(sequence);
        return uniqueElements.size < sequence.length * 0.8; // If less than 80% unique, consider it repeating
    }

    private extractToolsFromSequence(sequence: string[]): string[] {
        // Extract tool names from action sequence
        return sequence
            .filter(action => action.includes('tool:') || action.includes('execute'))
            .map(action => action.split(':').pop() || action)
            .filter((tool, index, arr) => arr.indexOf(tool) === index); // Remove duplicates
    }

    private matchesCriteria(pattern: PatternMemoryEntry, criteria: PatternSearchCriteria): boolean {
        if (criteria.patternType && pattern.type !== criteria.patternType) return false;
        if (criteria.minEffectiveness && pattern.effectiveness < criteria.minEffectiveness) return false;
        if (criteria.minUsageCount && pattern.usageCount < criteria.minUsageCount) return false;
        if (criteria.tags && !criteria.tags.some(tag => pattern.tags.includes(tag))) return false;
        
        if (criteria.timeRange) {
            if (pattern.firstDiscovered < criteria.timeRange.start || pattern.firstDiscovered > criteria.timeRange.end) {
                return false;
            }
        }
        
        return true;
    }

    private emitPatternUpdate(channelId: ChannelId): void {
        const patterns = Array.from(this.patternCache.values())
            .filter(p => p.channelId === channelId);
        this.patternUpdates$.next(patterns);
    }

    private buildPatternAnalysisPrompt(actionSequence: string[], context: Record<string, any>): string {
        return `Analyze the following action sequence for patterns:

Action Sequence: ${actionSequence.join(' → ')}

Context: ${JSON.stringify(context, null, 2)}

Please analyze and respond in JSON format with:
{
  "patternDetected": boolean,
  "patternType": "orpar_sequence|tool_chain|collaboration_flow|error_recovery",
  "description": "detailed pattern description",
  "confidence": number (0.0-1.0),
  "recommendations": ["recommendation1", "recommendation2"],
  "metadata": {
    "complexity": number (1-10),
    "reuseability": number (0.0-1.0),
    "performanceImpact": "positive|neutral|negative",
    "toolsInvolved": ["tool1", "tool2"],
    "estimatedEffectiveness": number (0.0-1.0)
  }
}`;
    }

    private parsePatternAnalysisResponse(llmResponse: string): PatternAnalysisResult {
        try {
            // Try to parse as JSON first
            const response = JSON.parse(llmResponse);
            
            return {
                patternDetected: response.patternDetected || false,
                patternType: response.patternType,
                description: response.description || 'No description available',
                confidence: response.confidence || 0.0,
                recommendations: response.recommendations || [],
                metadata: {
                    complexity: response.metadata?.complexity || 1,
                    reuseability: response.metadata?.reuseability || 0.0,
                    performanceImpact: response.metadata?.performanceImpact || 'neutral',
                    toolsInvolved: response.metadata?.toolsInvolved || [],
                    estimatedEffectiveness: response.metadata?.estimatedEffectiveness || 0.0
                }
            };
        } catch (error) {
            // Fallback if JSON parsing fails
            this.logger.warn(`⚠️ Failed to parse LLM response as JSON: ${error}`);
            return this.fallbackPatternAnalysis([], {});
        }
    }

    private fallbackPatternAnalysis(actionSequence: string[], context: Record<string, any>): PatternAnalysisResult {
        // Simplified pattern detection based on sequence length and repetition
        const patternDetected = actionSequence.length >= 3 && this.hasRepeatingElements(actionSequence);
        const confidence = patternDetected ? Math.min(0.7 + (actionSequence.length * 0.05), 0.95) : 0.1;
        
        return {
            patternDetected,
            patternType: patternDetected ? 'orpar_sequence' : undefined,
            description: patternDetected 
                ? `Detected repeating pattern in ${actionSequence.length}-step sequence`
                : 'No significant pattern detected',
            confidence,
            recommendations: patternDetected 
                ? [`Consider optimizing the ${actionSequence.length}-step workflow`, 'Document this pattern for reuse']
                : ['Continue gathering data for pattern detection'],
            metadata: {
                complexity: Math.min(actionSequence.length, 10),
                reuseability: patternDetected ? 0.8 : 0.3,
                performanceImpact: patternDetected ? 'positive' : 'neutral',
                toolsInvolved: this.extractToolsFromSequence(actionSequence),
                estimatedEffectiveness: confidence * 0.9
            }
        };
    }

    // =============================================================================
    // PUBLIC OBSERVABLES
    // =============================================================================

    /**
     * Observable for pattern updates
     */
    public get patternUpdates(): Observable<PatternMemoryEntry[]> {
        return this.patternUpdates$.asObservable();
    }

    /**
     * Observable for workflow updates
     */
    public get workflowUpdates(): Observable<WorkflowMemoryEntry[]> {
        return this.workflowUpdates$.asObservable();
    }

    /**
     * Track ORPAR action sequence for pattern detection
     */
    public trackOrparAction(channelId: ChannelId, agentId: AgentId, phase: string, action: string): void {
        // Simple tracking - could be expanded
    }
}
