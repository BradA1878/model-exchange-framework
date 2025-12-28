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
 * MXF Meilisearch Service
 *
 * Integrates Meilisearch for semantic search across conversations, actions, and patterns.
 * Provides hybrid search combining keyword matching with vector similarity.
 */

import { MeiliSearch } from 'meilisearch';
import { Logger } from '../utils/Logger';
import { ConversationMessage } from '../interfaces/ConversationMessage';
import { PatternMemoryEntry } from '../types/PatternMemoryTypes';

/**
 * Meilisearch index names
 */
export enum MeilisearchIndex {
    CONVERSATIONS = 'mxf-conversations',
    ACTIONS = 'mxf-actions',
    PATTERNS = 'mxf-patterns',
    OBSERVATIONS = 'mxf-observations'
}

/**
 * Document types for indexing
 */
export interface ConversationDocument {
    id: string;
    agentId: string;
    channelId: string;
    role: 'user' | 'assistant' | 'system' | 'tool';
    content: string;
    timestamp: number;
    metadata?: Record<string, any>;
    _vectors?: { [embedderName: string]: number[] }; // Semantic embeddings by embedder name
}

export interface ActionDocument {
    id: string;
    agentId: string;
    channelId: string;
    toolName: string;
    description: string;
    timestamp: number;
    input?: any;
    result?: any;
    success: boolean;
    metadata?: Record<string, any>;
    _vectors?: number[];
}

export interface PatternDocument {
    id: string;
    patternId: string;
    channelId: string;
    type: string;
    description: string;
    toolsInvolved: string[];
    effectiveness: number;
    usageCount: number;
    discoveredBy: string;
    timestamp: number;
    _vectors?: number[];
}

/**
 * Search parameters
 */
export interface SearchParams {
    query: string;
    filter?: string;
    limit?: number;
    offset?: number;
    hybridRatio?: number; // 0.0-1.0: 0=keyword, 1=semantic
    attributesToRetrieve?: string[];
    attributesToHighlight?: string[];
}

/**
 * Search result with relevance score
 */
export interface SearchResult<T> {
    hits: Array<T & { _rankingScore: number }>;
    query: string;
    processingTimeMs: number;
    limit: number;
    offset: number;
    estimatedTotalHits: number;
}

/**
 * Embedding generator function type
 */
export type EmbeddingGenerator = (text: string, options?: { model?: string; dimensions?: number }) => Promise<number[]>;

/**
 * Meilisearch Service Configuration
 */
export interface MeilisearchServiceConfig {
    host: string;
    apiKey: string;
    enableEmbeddings?: boolean;
    embeddingModel?: string;
    embeddingDimensions?: number;
    batchSize?: number;
    loggerContext?: 'server' | 'client';
    embeddingGenerator?: EmbeddingGenerator; // Optional function to generate embeddings (server-only)
}

/**
 * MXF Meilisearch Service
 */
export class MxfMeilisearchService {
    private static instance: MxfMeilisearchService;
    private client: MeiliSearch;
    private embeddingGenerator?: EmbeddingGenerator; // Optional embedding function (server-only)
    private config: MeilisearchServiceConfig;
    private initialized: boolean = false;
    private logger: Logger;

    private constructor(config: MeilisearchServiceConfig) {
        this.config = {
            batchSize: 100,
            enableEmbeddings: true,
            embeddingModel: 'text-embedding-3-small',
            embeddingDimensions: 1536,
            loggerContext: 'server',
            ...config
        };

        // Initialize logger with correct context
        this.logger = new Logger('info', 'MxfMeilisearchService', this.config.loggerContext!);

        this.client = new MeiliSearch({
            host: this.config.host,
            apiKey: this.config.apiKey
        });

        // Store optional embedding generator function (server-only)
        this.embeddingGenerator = this.config.embeddingGenerator;

    }

    /**
     * Get singleton instance
     */
    public static getInstance(config?: MeilisearchServiceConfig): MxfMeilisearchService {
        if (!MxfMeilisearchService.instance) {
            if (!config) {
                // Load from environment variables
                config = {
                    host: process.env.MEILISEARCH_HOST || 'http://localhost:7700',
                    apiKey: process.env.MEILISEARCH_MASTER_KEY || '',
                    enableEmbeddings: process.env.ENABLE_SEMANTIC_SEARCH !== 'false',
                    embeddingModel: process.env.MEILISEARCH_EMBEDDING_MODEL || 'text-embedding-3-small',
                    embeddingDimensions: parseInt(process.env.MEILISEARCH_EMBEDDING_DIMENSIONS || '1536'),
                    batchSize: parseInt(process.env.MEILISEARCH_BATCH_SIZE || '100')
                };
            }
            MxfMeilisearchService.instance = new MxfMeilisearchService(config);
        } else if (config?.embeddingGenerator && !MxfMeilisearchService.instance.embeddingGenerator) {
            // Upgrade existing instance with embedding generator (for server initialization)
            MxfMeilisearchService.instance.embeddingGenerator = config.embeddingGenerator;
            MxfMeilisearchService.instance.logger.info('Meilisearch Service upgraded with embedding generator');

            // Update config if provided
            if (config.enableEmbeddings !== undefined) {
                MxfMeilisearchService.instance.config.enableEmbeddings = config.enableEmbeddings;
            }
            if (config.embeddingModel) {
                MxfMeilisearchService.instance.config.embeddingModel = config.embeddingModel;
            }
            if (config.embeddingDimensions) {
                MxfMeilisearchService.instance.config.embeddingDimensions = config.embeddingDimensions;
            }
        }
        return MxfMeilisearchService.instance;
    }

    /**
     * Initialize indexes with proper settings
     */
    public async initialize(): Promise<void> {
        if (this.initialized) {
            return;
        }

        try {

            // Create indexes
            await this.createIndex(MeilisearchIndex.CONVERSATIONS, 'id');
            await this.createIndex(MeilisearchIndex.ACTIONS, 'id');
            await this.createIndex(MeilisearchIndex.PATTERNS, 'id');
            await this.createIndex(MeilisearchIndex.OBSERVATIONS, 'id');

            // Configure conversation index
            await this.configureConversationIndex();

            // Configure action index
            await this.configureActionIndex();

            // Configure pattern index
            await this.configurePatternIndex();

            this.initialized = true;
        } catch (error) {
            this.logger.error('Failed to initialize Meilisearch', error);
            throw error;
        }
    }

    /**
     * Create an index if it doesn't exist, and ensure primary key is set
     */
    private async createIndex(indexName: string, primaryKey: string): Promise<void> {
        try {
            const indexes = await this.client.getIndexes();
            const existingIndex = indexes.results.find(idx => idx.uid === indexName);

            if (!existingIndex) {
                // Index doesn't exist - create it with primary key
                await this.client.createIndex(indexName, { primaryKey });
            } else if (!existingIndex.primaryKey) {
                // Index exists but has no primary key - update it
                const index = this.client.index(indexName);
                await index.update({ primaryKey });
            } else {
            }
        } catch (error) {
            this.logger.error(`Failed to create/update index ${indexName}`, error);
            throw error;
        }
    }

    /**
     * Configure conversation index settings
     */
    private async configureConversationIndex(): Promise<void> {
        const index = this.client.index(MeilisearchIndex.CONVERSATIONS);

        const settings: any = {
            searchableAttributes: ['content', 'role', 'agentId'],
            filterableAttributes: ['agentId', 'channelId', 'role', 'timestamp'],
            sortableAttributes: ['timestamp'],
            rankingRules: [
                'words',
                'typo',
                'proximity',
                'attribute',
                'sort',
                'exactness'
            ],
            displayedAttributes: ['*']
        };

        // Add vector embedder configuration if semantic search is enabled
        if (this.config.enableEmbeddings && this.embeddingGenerator) {
            settings.embedders = {
                default: {
                    source: 'userProvided',
                    dimensions: this.config.embeddingDimensions || 1536
                }
            };
        } else {
            // Explicitly remove embedders when semantic search is disabled
            settings.embedders = null;
        }

        await index.updateSettings(settings);

    }

    /**
     * Configure action index settings
     */
    private async configureActionIndex(): Promise<void> {
        const index = this.client.index(MeilisearchIndex.ACTIONS);

        await index.updateSettings({
            searchableAttributes: ['toolName', 'description', 'agentId'],
            filterableAttributes: ['agentId', 'channelId', 'toolName', 'timestamp', 'success'],
            sortableAttributes: ['timestamp', 'usageCount'],
            rankingRules: [
                'words',
                'typo',
                'proximity',
                'attribute',
                'sort',
                'exactness'
            ]
        });

    }

    /**
     * Configure pattern index settings
     */
    private async configurePatternIndex(): Promise<void> {
        const index = this.client.index(MeilisearchIndex.PATTERNS);

        await index.updateSettings({
            searchableAttributes: ['description', 'type', 'toolsInvolved'],
            filterableAttributes: ['channelId', 'type', 'effectiveness', 'usageCount', 'discoveredBy'],
            sortableAttributes: ['effectiveness', 'usageCount', 'timestamp'],
            rankingRules: [
                'words',
                'typo',
                'proximity',
                'attribute',
                'sort',
                'exactness'
            ]
        });

    }

    /**
     * Generate embedding for text using provided embedding generator
     * Respects SYSTEMLLM_PROVIDER configuration from server
     */
    private async generateEmbedding(text: string): Promise<number[] | undefined> {
        if (!this.config.enableEmbeddings || !this.embeddingGenerator) {
            return undefined;
        }

        try {
            // Call the embedding generator function (provided by server)
            const embedding = await this.embeddingGenerator(text, {
                model: this.config.embeddingModel,
                dimensions: this.config.embeddingDimensions
            });

            return embedding;
        } catch (error) {
            //this.logger.error(`Embedding generation failed:`, error);
            return undefined;
        }
    }

    /**
     * Index a conversation message
     */
    public async indexConversation(message: ConversationMessage): Promise<void> {
        try {
            const embedding = await this.generateEmbedding(message.content);
            
            // Build document with proper _vectors format for Meilisearch
            const document: ConversationDocument = {
                id: message.id,
                agentId: message.metadata?.agentId || message.metadata?.fromAgentId || 'unknown',
                channelId: message.metadata?.channelId || 'unknown',
                role: message.role,
                content: message.content,
                timestamp: message.timestamp,
                metadata: message.metadata,
                // Meilisearch expects _vectors as { embedderName: array }, not just array
                _vectors: embedding ? { default: embedding } : undefined
            };

            const index = this.client.index(MeilisearchIndex.CONVERSATIONS);
            const taskPromise = index.addDocuments([document]);

            // Wait for indexing task to complete so documents are immediately searchable
            await taskPromise.waitTask();

        } catch (error) {
            this.logger.error('Failed to index conversation', error);
            // Don't throw - indexing failures shouldn't break the main flow
        }
    }

    /**
     * Index an action
     */
    public async indexAction(action: {
        id: string;
        agentId: string;
        channelId: string;
        toolName: string;
        description: string;
        timestamp: number;
        input?: any;
        result?: any;
        success: boolean;
        metadata?: Record<string, any>;
    }): Promise<void> {
        try {
            const document: ActionDocument = {
                ...action,
                _vectors: await this.generateEmbedding(`${action.toolName}: ${action.description}`)
            };

            const index = this.client.index(MeilisearchIndex.ACTIONS);
            const taskPromise = index.addDocuments([document]);

            // Wait for indexing task to complete
            await taskPromise.waitTask();

        } catch (error) {
            this.logger.error('Failed to index action', error);
        }
    }

    /**
     * Index a pattern
     */
    public async indexPattern(pattern: PatternMemoryEntry): Promise<void> {
        try {
            // Create a description from the pattern data
            const description = `${pattern.type} pattern: ${pattern.pattern.sequence.join(' -> ')}`;

            const document: PatternDocument = {
                id: pattern.patternId,
                patternId: pattern.patternId,
                channelId: pattern.channelId,
                type: pattern.type,
                description: description,
                toolsInvolved: pattern.pattern.toolsUsed || [],
                effectiveness: pattern.effectiveness,
                usageCount: pattern.usageCount,
                discoveredBy: pattern.agentParticipants[0] || 'unknown',
                timestamp: pattern.firstDiscovered,
                _vectors: await this.generateEmbedding(description)
            };

            const index = this.client.index(MeilisearchIndex.PATTERNS);
            const taskPromise = index.addDocuments([document]);

            // Wait for indexing task to complete
            await taskPromise.waitTask();

        } catch (error) {
            this.logger.error('Failed to index pattern', error);
        }
    }

    /**
     * Search conversations
     */
    public async searchConversations(params: SearchParams): Promise<SearchResult<ConversationDocument>> {
        return this.search<ConversationDocument>(MeilisearchIndex.CONVERSATIONS, params);
    }

    /**
     * Search actions
     */
    public async searchActions(params: SearchParams): Promise<SearchResult<ActionDocument>> {
        return this.search<ActionDocument>(MeilisearchIndex.ACTIONS, params);
    }

    /**
     * Search patterns
     */
    public async searchPatterns(params: SearchParams): Promise<SearchResult<PatternDocument>> {
        return this.search<PatternDocument>(MeilisearchIndex.PATTERNS, params);
    }

    /**
     * Generic search function
     */
    private async search<T extends Record<string, any>>(indexName: string, params: SearchParams): Promise<SearchResult<T>> {
        try {
            const index = this.client.index(indexName);

            const searchParams: any = {
                limit: params.limit || 20,
                offset: params.offset || 0
            };

            if (params.filter) {
                searchParams.filter = params.filter;
            }

            if (params.attributesToRetrieve) {
                searchParams.attributesToRetrieve = params.attributesToRetrieve;
            }

            if (params.attributesToHighlight) {
                searchParams.attributesToHighlight = params.attributesToHighlight;
            }

            // Enable hybrid search if embeddings are available and ratio is set
            if (this.config.enableEmbeddings && params.hybridRatio !== undefined) {
                searchParams.hybrid = {
                    semanticRatio: params.hybridRatio,
                    embedder: 'default'
                };
            }

            const result = await index.search<T>(params.query, searchParams);

            return {
                hits: result.hits as any,
                query: result.query,
                processingTimeMs: result.processingTimeMs,
                limit: result.limit,
                offset: result.offset,
                estimatedTotalHits: result.estimatedTotalHits || 0
            };
        } catch (error) {
            this.logger.error(`Search failed for index ${indexName}`, error);
            throw error;
        }
    }

    /**
     * Get health status
     */
    public async getHealth(): Promise<{ healthy: boolean; version?: string }> {
        try {
            const health = await this.client.health();
            const version = await this.client.getVersion();
            return {
                healthy: health.status === 'available',
                version: version.pkgVersion
            };
        } catch (error) {
            this.logger.error('Health check failed', error);
            return { healthy: false };
        }
    }

    /**
     * Get index stats
     */
    public async getStats(): Promise<Record<string, any>> {
        try {
            const stats = await this.client.getStats();
            return stats;
        } catch (error) {
            this.logger.error('Failed to get stats', error);
            return {};
        }
    }

    /**
     * Clear an index
     */
    public async clearIndex(indexName: MeilisearchIndex): Promise<void> {
        try {
            const index = this.client.index(indexName);
            await index.deleteAllDocuments();
        } catch (error) {
            this.logger.error(`Failed to clear index ${indexName}`, error);
            throw error;
        }
    }
}

export default MxfMeilisearchService;
