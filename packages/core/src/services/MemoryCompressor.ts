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
 * @documentation https://mxf-dev.github.io/mxf/
 */

/**
 * MemoryCompressor Service
 *
 * Handles memory consolidation and compression when promoting memories
 * between strata. Integrates with ContextCompressionEngine for semantic
 * compression and summarization.
 *
 * Feature flag: MEMORY_STRATA_ENABLED
 */

import { Logger } from '../utils/Logger.js';
import {
  MemoryEntry,
  MemoryStratum,
  MemoryConsolidation,
  ConsolidationType
} from '../types/MemoryStrataTypes.js';
import { ContextCompressionEngine } from '../mxp/ContextCompressionEngine.js';

/**
 * Compression level for different stratum transitions
 */
export enum CompressionLevel {
  None = 'none',           // No compression (Working → Working)
  Light = 'light',         // 30% compression (Working → ShortTerm)
  Moderate = 'moderate',   // 60% compression (ShortTerm → Episodic/LongTerm)
  Heavy = 'heavy'          // 85% compression (Episodic → Semantic)
}

/**
 * Compression result
 */
export interface CompressionResult {
  originalContent: string;
  compressedContent: string;
  originalLength: number;
  compressedLength: number;
  compressionRatio: number;
  method: CompressionMethod;
}

/**
 * How a memory's content was compressed.
 *
 * Only 'extractive' exists: leading sentences are kept and the remainder is discarded.
 * The union previously also offered 'semantic' and 'abstractive', neither of which was
 * ever implemented — 'semantic' was reported for what was, in fact, the same extractive
 * slicing. Listing methods the service cannot perform invites callers to trust compressed
 * memories more than they should.
 */
export type CompressionMethod = 'extractive';

/**
 * Consolidation options
 */
export interface ConsolidationOptions {
  maxMemories?: number;
  similarityThreshold?: number;
  compressionLevel?: CompressionLevel;
  preserveMetadata?: boolean;
}

/**
 * MemoryCompressor handles memory compression and consolidation
 */
export class MemoryCompressor {
  private static instance: MemoryCompressor;
  private logger: Logger;
  private contextCompressor: ContextCompressionEngine | null = null;
  private enabled: boolean = false;

  // Compression ratios per level
  private readonly compressionRatios: Record<CompressionLevel, number> = {
    [CompressionLevel.None]: 1.0,
    [CompressionLevel.Light]: 0.7,
    [CompressionLevel.Moderate]: 0.4,
    [CompressionLevel.Heavy]: 0.15
  };

  private constructor() {
    this.logger = new Logger('info', 'MemoryCompressor');
  }

  public static getInstance(): MemoryCompressor {
    if (!MemoryCompressor.instance) {
      MemoryCompressor.instance = new MemoryCompressor();
    }
    return MemoryCompressor.instance;
  }

  /**
   * Initialize the MemoryCompressor
   */
  public initialize(config: { enabled: boolean }): void {
    this.enabled = config.enabled;

    if (this.enabled) {
      this.contextCompressor = ContextCompressionEngine.getInstance();
      this.logger.info('[MemoryCompressor] Initialized with semantic compression support');
    }
  }

  /**
   * Check if compression is enabled
   */
  public isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Compress a memory entry for promotion to a slower stratum
   */
  public async compressMemory(
    memory: MemoryEntry,
    targetStratum: MemoryStratum
  ): Promise<MemoryEntry> {
    if (!this.enabled) return memory;

    const compressionLevel = this.getCompressionLevel(memory.stratum, targetStratum);

    if (compressionLevel === CompressionLevel.None) {
      return memory;
    }

    const result = await this.compressContent(memory.content, compressionLevel);

    const compressedMemory: MemoryEntry = {
      ...memory,
      content: result.compressedContent,
      metadata: {
        ...memory.metadata,
        originalLength: result.originalLength,
        compressionRatio: result.compressionRatio,
        compressionMethod: result.method,
        compressedAt: new Date().toISOString()
      }
    };

    this.logger.debug(
      `[MemoryCompressor] Compressed memory ${memory.id} for ${targetStratum} stratum ` +
      `(${result.originalLength} → ${result.compressedLength} chars, ${(result.compressionRatio * 100).toFixed(1)}%)`
    );

    return compressedMemory;
  }

  /**
   * Consolidate multiple memories into a single memory
   */
  public async consolidateMemories(
    memories: MemoryEntry[],
    type: ConsolidationType,
    options: ConsolidationOptions = {}
  ): Promise<MemoryConsolidation> {
    if (!this.enabled || memories.length === 0) {
      throw new Error('Cannot consolidate: compression disabled or no memories provided');
    }

    let consolidatedContent: string;
    let reason: string;

    switch (type) {
      case 'merge':
        consolidatedContent = await this.mergeMemories(memories);
        reason = `Merged ${memories.length} similar memories`;
        break;

      case 'summarize':
        consolidatedContent = await this.summarizeMemories(memories);
        reason = `Summarized ${memories.length} memories`;
        break;

      case 'abstract':
        consolidatedContent = await this.abstractPattern(memories);
        reason = `Abstracted common pattern from ${memories.length} memories`;
        break;

      default:
        throw new Error(`Unsupported consolidation type: ${type}`);
    }

    // Create new consolidated memory
    const baseMemory = memories[0];
    const newMemory: MemoryEntry = {
      ...baseMemory,
      id: `consolidated-${Date.now()}`,
      content: consolidatedContent,
      importance: Math.max(...memories.map(m => m.importance)),
      tags: Array.from(new Set(memories.flatMap(m => m.tags))),
      relatedMemories: memories.map(m => m.id),
      accessCount: memories.reduce((sum, m) => sum + m.accessCount, 0),
      createdAt: new Date(),
      lastAccessed: new Date(),
      metadata: {
        consolidationType: type,
        sourceMemoryCount: memories.length,
        consolidatedAt: new Date().toISOString()
      }
    };

    this.logger.info(
      `[MemoryCompressor] Consolidated ${memories.length} memories via ${type}: ${newMemory.id}`
    );

    return {
      consolidatedMemories: memories.map(m => m.id),
      newMemory,
      type,
      reason
    };
  }

  /**
   * Determine if memories are similar enough to consolidate
   */
  public async areSimilar(
    memory1: MemoryEntry,
    memory2: MemoryEntry,
    threshold: number = 0.7
  ): Promise<boolean> {
    const similarity = this.calculateSimilarity(memory1, memory2);
    return similarity >= threshold;
  }

  // Private helper methods

  private getCompressionLevel(
    fromStratum: MemoryStratum,
    toStratum: MemoryStratum
  ): CompressionLevel {
    // Define compression levels for stratum transitions
    const transitions: Record<string, CompressionLevel> = {
      [`${MemoryStratum.Working}-${MemoryStratum.ShortTerm}`]: CompressionLevel.Light,
      [`${MemoryStratum.ShortTerm}-${MemoryStratum.Episodic}`]: CompressionLevel.Moderate,
      [`${MemoryStratum.ShortTerm}-${MemoryStratum.LongTerm}`]: CompressionLevel.Moderate,
      [`${MemoryStratum.Episodic}-${MemoryStratum.Semantic}`]: CompressionLevel.Heavy,
      [`${MemoryStratum.LongTerm}-${MemoryStratum.Semantic}`]: CompressionLevel.Heavy
    };

    const key = `${fromStratum}-${toStratum}`;
    return transitions[key] || CompressionLevel.None;
  }

  private async compressContent(
    content: string,
    level: CompressionLevel
  ): Promise<CompressionResult> {
    const originalLength = content.length;
    const targetRatio = this.compressionRatios[level];

    // Every compression this service performs is extractive: it keeps leading sentences
    // and discards the rest. The previous 'semantic' branch called a semanticCompress()
    // that never touched the contextCompressor it checked for, and did exactly the same
    // sentence-slicing as the extractive path — it differed only in the label it reported.
    // Callers deciding how much to trust a compressed memory were reading that label, so
    // it now says what actually happened.
    const compressedContent = this.extractiveCompress(content, targetRatio);
    const method: CompressionMethod = 'extractive';

    const compressedLength = compressedContent.length;
    const actualRatio = compressedLength / originalLength;

    return {
      originalContent: content,
      compressedContent,
      originalLength,
      compressedLength,
      compressionRatio: actualRatio,
      method
    };
  }

  private extractiveCompress(content: string, targetRatio: number): string {
    // Simple extractive compression: keep first N% of content
    const targetLength = Math.ceil(content.length * targetRatio);

    if (content.length <= targetLength) {
      return content;
    }

    // Split on sentences and keep complete sentences up to target
    const sentences = content.split(/[.!?]+/).filter(s => s.trim());
    let compressed = '';

    for (const sentence of sentences) {
      const candidate = compressed + sentence + '. ';
      if (candidate.length > targetLength) break;
      compressed = candidate;
    }

    return compressed.trim() || content.substring(0, targetLength) + '...';
  }

  private async mergeMemories(memories: MemoryEntry[]): Promise<string> {
    // Combine content with deduplication
    const contents = memories.map(m => m.content);
    const uniqueContents = Array.from(new Set(contents));
    return uniqueContents.join('\n\n');
  }

  private async summarizeMemories(memories: MemoryEntry[]): Promise<string> {
    // Create a summary of key points
    const contents = memories.map(m => m.content).join('\n\n');

    // Apply moderate compression
    const result = await this.compressContent(contents, CompressionLevel.Moderate);
    return result.compressedContent;
  }

  private async abstractPattern(memories: MemoryEntry[]): Promise<string> {
    // Extract common patterns
    const allWords = memories.flatMap(m =>
      m.content.toLowerCase().split(/\s+/)
    );

    // Count word frequencies
    const wordCounts = new Map<string, number>();
    for (const word of allWords) {
      wordCounts.set(word, (wordCounts.get(word) || 0) + 1);
    }

    // Filter common words (stop words)
    const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for']);
    const keywords = Array.from(wordCounts.entries())
      .filter(([word, count]) => !stopWords.has(word) && count > 1)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([word]) => word);

    return `Common pattern detected across ${memories.length} memories. Key concepts: ${keywords.join(', ')}`;
  }

  private calculateSimilarity(memory1: MemoryEntry, memory2: MemoryEntry): number {
    // Calculate Jaccard similarity based on content words
    const words1 = new Set(memory1.content.toLowerCase().split(/\s+/));
    const words2 = new Set(memory2.content.toLowerCase().split(/\s+/));

    const intersection = new Set([...words1].filter(w => words2.has(w)));
    const union = new Set([...words1, ...words2]);

    const contentSimilarity = union.size > 0 ? intersection.size / union.size : 0;

    // Factor in tag similarity
    const tags1 = new Set(memory1.tags);
    const tags2 = new Set(memory2.tags);
    const tagIntersection = new Set([...tags1].filter(t => tags2.has(t)));
    const tagUnion = new Set([...tags1, ...tags2]);
    const tagSimilarity = tagUnion.size > 0 ? tagIntersection.size / tagUnion.size : 0;

    // Weighted combination
    return contentSimilarity * 0.8 + tagSimilarity * 0.2;
  }
}
