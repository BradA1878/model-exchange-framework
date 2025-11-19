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
 * ValidationCacheService - Phase 5 Proactive Validation System
 * 
 * Multi-level caching service for validation results with memory, Redis, and MongoDB tiers.
 * Provides performance-optimized caching with TTL management and cache invalidation.
 */

import { Observable, Subject } from 'rxjs';
import { Logger } from '../utils/Logger';
import { ValidationResult } from './ProactiveValidationService';
import { AgentId } from '../types/Agent';
import { ChannelId } from '../types/ChannelContext';
import { createHash } from 'crypto';

/**
 * Cache entry with metadata
 */
export interface CacheEntry<T = any> {
    key: string;
    value: T;
    createdAt: number;
    expiresAt: number;
    accessCount: number;
    lastAccessed: number;
    size: number; // in bytes
    tags: string[];
    metadata: {
        agentId: AgentId;
        channelId: ChannelId;
        toolName: string;
        parametersHash: string;
        validationLevel: string;
    };
}

/**
 * Cache statistics
 */
export interface CacheStats {
    totalEntries: number;
    totalSize: number; // in bytes
    hitRate: number;
    missRate: number;
    evictionRate: number;
    avgAccessTime: number;
    memoryStats: CacheLevelStats;
    redisStats: CacheLevelStats;
    mongoStats: CacheLevelStats;
}

/**
 * Cache level statistics
 */
export interface CacheLevelStats {
    enabled: boolean;
    entries: number;
    size: number;
    hits: number;
    misses: number;
    evictions: number;
    avgResponseTime: number;
    errorRate: number;
}

/**
 * Cache configuration
 */
export interface ValidationCacheConfig {
    enabled: boolean;
    enableMemoryCache: boolean;
    enableRedisCache: boolean;
    enableMongoCache: boolean;
    
    // Memory cache settings
    memoryCache: {
        maxEntries: number;
        maxSize: number; // in bytes
        defaultTTL: number; // in ms
        evictionPolicy: 'LRU' | 'LFU' | 'FIFO';
        cleanupInterval: number; // in ms
    };
    
    // Redis cache settings
    redisCache: {
        enabled: boolean;
        keyPrefix: string;
        defaultTTL: number; // in seconds
        maxRetries: number;
        retryDelay: number; // in ms
        compression: boolean;
    };
    
    // MongoDB cache settings
    mongoCache: {
        enabled: boolean;
        collection: string;
        defaultTTL: number; // in ms
        indexKeys: string[];
        maxDocuments: number;
        backgroundCleanup: boolean;
    };
    
    // Performance settings
    performance: {
        maxCacheTime: number; // max time to spend on cache operations
        parallelWrites: boolean;
        writeThrough: boolean;
        readThrough: boolean;
    };
}

/**
 * Cache operation result
 */
export interface CacheOperationResult<T = any> {
    success: boolean;
    data?: T;
    fromCache: 'MEMORY' | 'REDIS' | 'MONGO' | 'NONE';
    responseTime: number;
    error?: string;
}

/**
 * Cache invalidation request
 */
export interface CacheInvalidationRequest {
    pattern?: string; // key pattern to match
    tags?: string[]; // tags to match
    toolName?: string;
    agentId?: AgentId;
    channelId?: ChannelId;
    olderThan?: number; // timestamp
}

/**
 * Cache events
 */
export interface CacheEvent {
    timestamp: number;
    type: 'HIT' | 'MISS' | 'SET' | 'DELETE' | 'EVICT' | 'ERROR' | 'INVALIDATE';
    level: 'MEMORY' | 'REDIS' | 'MONGO';
    key: string;
    size?: number;
    responseTime: number;
    details?: any;
}

/**
 * Validation Cache Service with multi-level caching
 */
export class ValidationCacheService {
    private readonly logger: Logger;
    
    // Configuration
    private config: ValidationCacheConfig;
    
    // Memory cache
    private readonly memoryCache = new Map<string, CacheEntry>();
    private readonly accessOrder = new Map<string, number>(); // for LRU
    private readonly accessFrequency = new Map<string, number>(); // for LFU
    private memoryCacheSize = 0;
    
    // Cache statistics
    private readonly stats = {
        memory: { enabled: true, entries: 0, size: 0, hits: 0, misses: 0, evictions: 0, avgResponseTime: 0, errorRate: 0, totalResponseTime: 0, totalRequests: 0 },
        redis: { enabled: false, entries: 0, size: 0, hits: 0, misses: 0, evictions: 0, avgResponseTime: 0, errorRate: 0, totalResponseTime: 0, totalRequests: 0 },
        mongo: { enabled: false, entries: 0, size: 0, hits: 0, misses: 0, evictions: 0, avgResponseTime: 0, errorRate: 0, totalResponseTime: 0, totalRequests: 0 }
    };
    
    // Events
    private readonly cacheEvents$ = new Subject<CacheEvent>();
    
    // Redis client (placeholder - would be actual Redis client)
    private redisClient: any = null;
    
    // MongoDB connection (placeholder - would be actual MongoDB connection)
    private mongoCollection: any = null;
    
    // Background tasks
    private cleanupInterval: NodeJS.Timeout | null = null;
    
    private static instance: ValidationCacheService;

    private constructor() {
        this.logger = new Logger('info', 'ValidationCacheService', 'server');
        
        this.config = this.getDefaultConfig();
        this.initializeCacheLevels();
        this.startBackgroundTasks();
        
    }

    /**
     * Get singleton instance
     */
    public static getInstance(): ValidationCacheService {
        if (!ValidationCacheService.instance) {
            ValidationCacheService.instance = new ValidationCacheService();
        }
        return ValidationCacheService.instance;
    }

    // =============================================================================
    // CORE CACHE OPERATIONS
    // =============================================================================

    /**
     * Get validation result from cache
     */
    public async getValidationResult(
        agentId: AgentId,
        channelId: ChannelId,
        toolName: string,
        parameters: Record<string, any>
    ): Promise<ValidationResult | null> {
        if (!this.config.enabled) {
            return null;
        }

        const key = this.generateCacheKey(agentId, channelId, toolName, parameters);
        const startTime = Date.now();

        try {
            // Try memory cache first
            if (this.config.enableMemoryCache) {
                const memoryResult = await this.getFromMemoryCache(key);
                if (memoryResult.success) {
                    this.emitCacheEvent({
                        timestamp: Date.now(),
                        type: 'HIT',
                        level: 'MEMORY',
                        key,
                        responseTime: Date.now() - startTime
                    });
                    return memoryResult.data || null;
                }
            }

            // Try Redis cache
            if (this.config.enableRedisCache && this.redisClient) {
                const redisResult = await this.getFromRedisCache(key);
                if (redisResult.success) {
                    // Write back to memory cache for faster future access
                    if (this.config.enableMemoryCache) {
                        await this.setToMemoryCache(key, redisResult.data!, {
                            agentId,
                            channelId,
                            toolName,
                            parametersHash: this.hashParameters(parameters),
                            validationLevel: redisResult.data?.riskAssessment?.recommendedValidationLevel || 'UNKNOWN'
                        });
                    }

                    this.emitCacheEvent({
                        timestamp: Date.now(),
                        type: 'HIT',
                        level: 'REDIS',
                        key,
                        responseTime: Date.now() - startTime
                    });
                    return redisResult.data || null;
                }
            }

            // Try MongoDB cache
            if (this.config.enableMongoCache && this.mongoCollection) {
                const mongoResult = await this.getFromMongoCache(key);
                if (mongoResult.success) {
                    // Write back to higher cache levels
                    const metadata = {
                        agentId,
                        channelId,
                        toolName,
                        parametersHash: this.hashParameters(parameters),
                        validationLevel: mongoResult.data?.riskAssessment?.recommendedValidationLevel || 'UNKNOWN'
                    };

                    if (this.config.enableRedisCache && this.redisClient) {
                        await this.setToRedisCache(key, mongoResult.data!, metadata);
                    }
                    if (this.config.enableMemoryCache) {
                        await this.setToMemoryCache(key, mongoResult.data!, metadata);
                    }

                    this.emitCacheEvent({
                        timestamp: Date.now(),
                        type: 'HIT',
                        level: 'MONGO',
                        key,
                        responseTime: Date.now() - startTime
                    });
                    return mongoResult.data || null;
                }
            }

            // Cache miss
            this.emitCacheEvent({
                timestamp: Date.now(),
                type: 'MISS',
                level: 'MEMORY',
                key,
                responseTime: Date.now() - startTime
            });

            return null;

        } catch (error) {
            this.logger.error(`Cache get operation failed for key ${key}:`, error);
            this.emitCacheEvent({
                timestamp: Date.now(),
                type: 'ERROR',
                level: 'MEMORY',
                key,
                responseTime: Date.now() - startTime,
                details: { error: error instanceof Error ? error.message : String(error) }
            });
            return null;
        }
    }

    /**
     * Cache validation result
     */
    public async cacheValidationResult(
        agentId: AgentId,
        channelId: ChannelId,
        toolName: string,
        parameters: Record<string, any>,
        validationResult: ValidationResult
    ): Promise<boolean> {
        if (!this.config.enabled) {
            return false;
        }

        const key = this.generateCacheKey(agentId, channelId, toolName, parameters);
        const startTime = Date.now();
        const metadata = {
            agentId,
            channelId,
            toolName,
            parametersHash: this.hashParameters(parameters),
            validationLevel: validationResult.riskAssessment.recommendedValidationLevel
        };

        try {
            const writePromises: Promise<any>[] = [];

            // Write to all enabled cache levels
            if (this.config.enableMemoryCache) {
                writePromises.push(this.setToMemoryCache(key, validationResult, metadata));
            }

            if (this.config.enableRedisCache && this.redisClient) {
                writePromises.push(this.setToRedisCache(key, validationResult, metadata));
            }

            if (this.config.enableMongoCache && this.mongoCollection) {
                writePromises.push(this.setToMongoCache(key, validationResult, metadata));
            }

            // Execute writes based on configuration
            if (this.config.performance.parallelWrites) {
                await Promise.allSettled(writePromises);
            } else {
                for (const writePromise of writePromises) {
                    try {
                        await writePromise;
                    } catch (error) {
                        this.logger.warn(`Cache write failed:`, error);
                    }
                }
            }

            this.emitCacheEvent({
                timestamp: Date.now(),
                type: 'SET',
                level: 'MEMORY',
                key,
                size: this.estimateSize(validationResult),
                responseTime: Date.now() - startTime
            });

            return true;

        } catch (error) {
            this.logger.error(`Cache set operation failed for key ${key}:`, error);
            this.emitCacheEvent({
                timestamp: Date.now(),
                type: 'ERROR',
                level: 'MEMORY',
                key,
                responseTime: Date.now() - startTime,
                details: { error: error instanceof Error ? error.message : String(error) }
            });
            return false;
        }
    }

    // =============================================================================
    // MEMORY CACHE IMPLEMENTATION
    // =============================================================================

    private async getFromMemoryCache(key: string): Promise<CacheOperationResult<ValidationResult>> {
        const startTime = Date.now();

        try {
            const entry = this.memoryCache.get(key);
            if (!entry) {
                this.stats.memory.misses++;
                return { success: false, fromCache: 'NONE', responseTime: Date.now() - startTime };
            }

            // Check expiration
            if (Date.now() > entry.expiresAt) {
                this.memoryCache.delete(key);
                this.memoryCacheSize -= entry.size;
                this.stats.memory.entries--;
                this.stats.memory.misses++;
                this.stats.memory.evictions++;
                return { success: false, fromCache: 'NONE', responseTime: Date.now() - startTime };
            }

            // Update access information
            entry.accessCount++;
            entry.lastAccessed = Date.now();
            this.updateAccessTracking(key);

            this.stats.memory.hits++;
            this.updateResponseTimeStats('memory', Date.now() - startTime);

            return {
                success: true,
                data: entry.value,
                fromCache: 'MEMORY',
                responseTime: Date.now() - startTime
            };

        } catch (error) {
            this.stats.memory.errorRate++;
            return {
                success: false,
                fromCache: 'NONE',
                responseTime: Date.now() - startTime,
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }

    private async setToMemoryCache(
        key: string,
        value: ValidationResult,
        metadata: CacheEntry['metadata']
    ): Promise<CacheOperationResult> {
        const startTime = Date.now();

        try {
            const size = this.estimateSize(value);
            const now = Date.now();
            
            // Check size limits and evict if necessary
            await this.ensureMemoryCacheSpace(size);

            const entry: CacheEntry<ValidationResult> = {
                key,
                value,
                createdAt: now,
                expiresAt: now + this.config.memoryCache.defaultTTL,
                accessCount: 1,
                lastAccessed: now,
                size,
                tags: [metadata.toolName, metadata.agentId, metadata.channelId],
                metadata
            };

            this.memoryCache.set(key, entry);
            this.memoryCacheSize += size;
            this.stats.memory.entries++;
            this.stats.memory.size = this.memoryCacheSize;
            this.updateAccessTracking(key);

            return {
                success: true,
                fromCache: 'MEMORY',
                responseTime: Date.now() - startTime
            };

        } catch (error) {
            this.stats.memory.errorRate++;
            return {
                success: false,
                fromCache: 'NONE',
                responseTime: Date.now() - startTime,
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }

    private async ensureMemoryCacheSpace(requiredSize: number): Promise<void> {
        // Check if we need to make space
        while ((this.memoryCacheSize + requiredSize > this.config.memoryCache.maxSize) ||
               (this.memoryCache.size >= this.config.memoryCache.maxEntries)) {
            
            const keyToEvict = this.selectEvictionCandidate();
            if (!keyToEvict) break;

            const entry = this.memoryCache.get(keyToEvict);
            if (entry) {
                this.memoryCache.delete(keyToEvict);
                this.memoryCacheSize -= entry.size;
                this.stats.memory.entries--;
                this.stats.memory.evictions++;
                this.accessOrder.delete(keyToEvict);
                this.accessFrequency.delete(keyToEvict);

                this.emitCacheEvent({
                    timestamp: Date.now(),
                    type: 'EVICT',
                    level: 'MEMORY',
                    key: keyToEvict,
                    size: entry.size,
                    responseTime: 0
                });
            }
        }
    }

    private selectEvictionCandidate(): string | null {
        if (this.memoryCache.size === 0) return null;

        switch (this.config.memoryCache.evictionPolicy) {
            case 'LRU':
                return this.selectLRUCandidate();
            case 'LFU':
                return this.selectLFUCandidate();
            case 'FIFO':
                return this.selectFIFOCandidate();
            default:
                return Array.from(this.memoryCache.keys())[0];
        }
    }

    private selectLRUCandidate(): string | null {
        let oldestKey: string | null = null;
        let oldestTime = Date.now();

        for (const [key, entry] of this.memoryCache.entries()) {
            if (entry.lastAccessed < oldestTime) {
                oldestTime = entry.lastAccessed;
                oldestKey = key;
            }
        }

        return oldestKey;
    }

    private selectLFUCandidate(): string | null {
        let leastUsedKey: string | null = null;
        let leastUsedCount = Infinity;

        for (const [key, entry] of this.memoryCache.entries()) {
            if (entry.accessCount < leastUsedCount) {
                leastUsedCount = entry.accessCount;
                leastUsedKey = key;
            }
        }

        return leastUsedKey;
    }

    private selectFIFOCandidate(): string | null {
        let oldestKey: string | null = null;
        let oldestTime = Date.now();

        for (const [key, entry] of this.memoryCache.entries()) {
            if (entry.createdAt < oldestTime) {
                oldestTime = entry.createdAt;
                oldestKey = key;
            }
        }

        return oldestKey;
    }

    private updateAccessTracking(key: string): void {
        const now = Date.now();
        this.accessOrder.set(key, now);
        
        const currentFreq = this.accessFrequency.get(key) || 0;
        this.accessFrequency.set(key, currentFreq + 1);
    }

    // =============================================================================
    // REDIS CACHE IMPLEMENTATION (PLACEHOLDER)
    // =============================================================================

    private async getFromRedisCache(key: string): Promise<CacheOperationResult<ValidationResult>> {
        const startTime = Date.now();

        try {
            if (!this.redisClient) {
                return { success: false, fromCache: 'NONE', responseTime: 0 };
            }

            // Placeholder for Redis implementation
            // const result = await this.redisClient.get(this.config.redisCache.keyPrefix + key);
            // if (result) {
            //     const data = this.config.redisCache.compression 
            //         ? this.decompress(result)
            //         : JSON.parse(result);
            //     return { success: true, data, fromCache: 'REDIS', responseTime: Date.now() - startTime };
            // }

            this.stats.redis.misses++;
            return { success: false, fromCache: 'NONE', responseTime: Date.now() - startTime };

        } catch (error) {
            this.stats.redis.errorRate++;
            return {
                success: false,
                fromCache: 'NONE',
                responseTime: Date.now() - startTime,
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }

    private async setToRedisCache(
        key: string,
        value: ValidationResult,
        metadata: CacheEntry['metadata']
    ): Promise<CacheOperationResult> {
        const startTime = Date.now();

        try {
            if (!this.redisClient) {
                return { success: false, fromCache: 'NONE', responseTime: 0 };
            }

            // Placeholder for Redis implementation
            // const serialized = this.config.redisCache.compression 
            //     ? this.compress(JSON.stringify(value))
            //     : JSON.stringify(value);
            // 
            // await this.redisClient.setex(
            //     this.config.redisCache.keyPrefix + key,
            //     this.config.redisCache.defaultTTL,
            //     serialized
            // );

            this.stats.redis.entries++;
            return {
                success: true,
                fromCache: 'REDIS',
                responseTime: Date.now() - startTime
            };

        } catch (error) {
            this.stats.redis.errorRate++;
            return {
                success: false,
                fromCache: 'NONE',
                responseTime: Date.now() - startTime,
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }

    // =============================================================================
    // MONGODB CACHE IMPLEMENTATION (PLACEHOLDER)
    // =============================================================================

    private async getFromMongoCache(key: string): Promise<CacheOperationResult<ValidationResult>> {
        const startTime = Date.now();

        try {
            if (!this.mongoCollection) {
                return { success: false, fromCache: 'NONE', responseTime: 0 };
            }

            // Placeholder for MongoDB implementation
            // const document = await this.mongoCollection.findOne({
            //     key,
            //     expiresAt: { $gt: new Date() }
            // });
            // 
            // if (document) {
            //     this.stats.mongo.hits++;
            //     return {
            //         success: true,
            //         data: document.value,
            //         fromCache: 'MONGO',
            //         responseTime: Date.now() - startTime
            //     };
            // }

            this.stats.mongo.misses++;
            return { success: false, fromCache: 'NONE', responseTime: Date.now() - startTime };

        } catch (error) {
            this.stats.mongo.errorRate++;
            return {
                success: false,
                fromCache: 'NONE',
                responseTime: Date.now() - startTime,
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }

    private async setToMongoCache(
        key: string,
        value: ValidationResult,
        metadata: CacheEntry['metadata']
    ): Promise<CacheOperationResult> {
        const startTime = Date.now();

        try {
            if (!this.mongoCollection) {
                return { success: false, fromCache: 'NONE', responseTime: 0 };
            }

            // Placeholder for MongoDB implementation
            // const document = {
            //     key,
            //     value,
            //     metadata,
            //     createdAt: new Date(),
            //     expiresAt: new Date(Date.now() + this.config.mongoCache.defaultTTL),
            //     size: this.estimateSize(value)
            // };
            // 
            // await this.mongoCollection.replaceOne(
            //     { key },
            //     document,
            //     { upsert: true }
            // );

            this.stats.mongo.entries++;
            return {
                success: true,
                fromCache: 'MONGO',
                responseTime: Date.now() - startTime
            };

        } catch (error) {
            this.stats.mongo.errorRate++;
            return {
                success: false,
                fromCache: 'NONE',
                responseTime: Date.now() - startTime,
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }

    // =============================================================================
    // CACHE INVALIDATION
    // =============================================================================

    /**
     * Invalidate cache entries based on criteria
     */
    public async invalidateCache(request: CacheInvalidationRequest): Promise<{
        invalidated: number;
        levels: { memory: number; redis: number; mongo: number };
    }> {
        const result = {
            invalidated: 0,
            levels: { memory: 0, redis: 0, mongo: 0 }
        };

        try {
            // Invalidate memory cache
            if (this.config.enableMemoryCache) {
                result.levels.memory = await this.invalidateMemoryCache(request);
                result.invalidated += result.levels.memory;
            }

            // Invalidate Redis cache
            if (this.config.enableRedisCache && this.redisClient) {
                result.levels.redis = await this.invalidateRedisCache(request);
                result.invalidated += result.levels.redis;
            }

            // Invalidate MongoDB cache
            if (this.config.enableMongoCache && this.mongoCollection) {
                result.levels.mongo = await this.invalidateMongoCache(request);
                result.invalidated += result.levels.mongo;
            }

            if (result.invalidated > 0) {
            }

        } catch (error) {
            this.logger.error('Cache invalidation failed:', error);
        }

        return result;
    }

    private async invalidateMemoryCache(request: CacheInvalidationRequest): Promise<number> {
        let invalidated = 0;

        for (const [key, entry] of this.memoryCache.entries()) {
            if (this.shouldInvalidateEntry(key, entry, request)) {
                this.memoryCache.delete(key);
                this.memoryCacheSize -= entry.size;
                this.stats.memory.entries--;
                this.accessOrder.delete(key);
                this.accessFrequency.delete(key);
                invalidated++;

                this.emitCacheEvent({
                    timestamp: Date.now(),
                    type: 'DELETE',
                    level: 'MEMORY',
                    key,
                    responseTime: 0
                });
            }
        }

        return invalidated;
    }

    private async invalidateRedisCache(request: CacheInvalidationRequest): Promise<number> {
        // Placeholder for Redis invalidation
        // Would implement pattern-based key deletion
        return 0;
    }

    private async invalidateMongoCache(request: CacheInvalidationRequest): Promise<number> {
        // Placeholder for MongoDB invalidation
        // Would implement query-based document deletion
        return 0;
    }

    private shouldInvalidateEntry(
        key: string,
        entry: CacheEntry,
        request: CacheInvalidationRequest
    ): boolean {
        // Check pattern matching
        if (request.pattern && !this.matchesPattern(key, request.pattern)) {
            return false;
        }

        // Check tag matching
        if (request.tags && !request.tags.some(tag => entry.tags.includes(tag))) {
            return false;
        }

        // Check tool name
        if (request.toolName && entry.metadata.toolName !== request.toolName) {
            return false;
        }

        // Check agent ID
        if (request.agentId && entry.metadata.agentId !== request.agentId) {
            return false;
        }

        // Check channel ID
        if (request.channelId && entry.metadata.channelId !== request.channelId) {
            return false;
        }

        // Check age
        if (request.olderThan && entry.createdAt > request.olderThan) {
            return false;
        }

        return true;
    }

    private matchesPattern(key: string, pattern: string): boolean {
        // Simple pattern matching - could be enhanced with proper glob patterns
        return key.includes(pattern.replace('*', ''));
    }

    // =============================================================================
    // HELPER METHODS
    // =============================================================================

    private generateCacheKey(
        agentId: AgentId,
        channelId: ChannelId,
        toolName: string,
        parameters: Record<string, any>
    ): string {
        const parametersHash = this.hashParameters(parameters);
        return `validation:${agentId}:${channelId}:${toolName}:${parametersHash}`;
    }

    private hashParameters(parameters: Record<string, any>): string {
        const normalized = JSON.stringify(parameters, Object.keys(parameters).sort());
        return createHash('sha256').update(normalized).digest('hex').substring(0, 16);
    }

    private estimateSize(value: any): number {
        // Rough size estimation in bytes
        return JSON.stringify(value).length * 2; // Assume 2 bytes per character (UTF-16)
    }

    private updateResponseTimeStats(level: keyof typeof this.stats, responseTime: number): void {
        const levelStats = this.stats[level];
        levelStats.totalRequests++;
        levelStats.totalResponseTime += responseTime;
        levelStats.avgResponseTime = levelStats.totalResponseTime / levelStats.totalRequests;
    }

    private initializeCacheLevels(): void {
        // Initialize Redis client if enabled
        if (this.config.redisCache.enabled) {
            try {
                // Placeholder for Redis client initialization
                // this.redisClient = new Redis(redisConfig);
                this.stats.redis.enabled = false; // Will be true when implemented
            } catch (error) {
                this.logger.warn('Failed to initialize Redis cache:', error);
                this.config.enableRedisCache = false;
            }
        }

        // Initialize MongoDB collection if enabled
        if (this.config.mongoCache.enabled) {
            try {
                // Placeholder for MongoDB initialization
                // this.mongoCollection = db.collection(this.config.mongoCache.collection);
                this.stats.mongo.enabled = false; // Will be true when implemented
            } catch (error) {
                this.logger.warn('Failed to initialize MongoDB cache:', error);
                this.config.enableMongoCache = false;
            }
        }

    }

    private startBackgroundTasks(): void {
        // Memory cache cleanup
        if (this.config.memoryCache.cleanupInterval > 0) {
            this.cleanupInterval = setInterval(() => {
                this.cleanupExpiredMemoryEntries();
            }, this.config.memoryCache.cleanupInterval);
        }

        // MongoDB background cleanup
        if (this.config.mongoCache.backgroundCleanup) {
            setInterval(() => {
                this.cleanupMongoCache().catch(error => {
                    this.logger.warn('MongoDB cache cleanup failed:', error);
                });
            }, 60 * 60 * 1000); // Every hour
        }

        // Statistics reporting
        setInterval(() => {
            this.reportCacheStatistics();
        }, 5 * 60 * 1000); // Every 5 minutes
    }

    private cleanupExpiredMemoryEntries(): void {
        const now = Date.now();
        let cleaned = 0;

        for (const [key, entry] of this.memoryCache.entries()) {
            if (now > entry.expiresAt) {
                this.memoryCache.delete(key);
                this.memoryCacheSize -= entry.size;
                this.stats.memory.entries--;
                this.accessOrder.delete(key);
                this.accessFrequency.delete(key);
                cleaned++;

                this.emitCacheEvent({
                    timestamp: now,
                    type: 'EVICT',
                    level: 'MEMORY',
                    key,
                    responseTime: 0
                });
            }
        }

        if (cleaned > 0) {
        }
    }

    private async cleanupMongoCache(): Promise<void> {
        // Placeholder for MongoDB cleanup
        // await this.mongoCollection.deleteMany({ expiresAt: { $lt: new Date() } });
    }

    private reportCacheStatistics(): void {
        const totalRequests = this.stats.memory.hits + this.stats.memory.misses +
                             this.stats.redis.hits + this.stats.redis.misses +
                             this.stats.mongo.hits + this.stats.mongo.misses;

        if (totalRequests === 0) return;

        const totalHits = this.stats.memory.hits + this.stats.redis.hits + this.stats.mongo.hits;
        const overallHitRate = totalHits / totalRequests;

    }

    private emitCacheEvent(event: CacheEvent): void {
        this.cacheEvents$.next(event);
    }

    private getDefaultConfig(): ValidationCacheConfig {
        return {
            enabled: true,
            enableMemoryCache: true,
            enableRedisCache: false, // Disabled until Redis client is implemented
            enableMongoCache: false, // Disabled until MongoDB client is implemented

            memoryCache: {
                maxEntries: 10000,
                maxSize: 50 * 1024 * 1024, // 50MB
                defaultTTL: 5 * 60 * 1000, // 5 minutes
                evictionPolicy: 'LRU',
                cleanupInterval: 60 * 1000 // 1 minute
            },

            redisCache: {
                enabled: false,
                keyPrefix: 'mxf:validation:',
                defaultTTL: 300, // 5 minutes in seconds
                maxRetries: 3,
                retryDelay: 1000,
                compression: true
            },

            mongoCache: {
                enabled: false,
                collection: 'validation_cache',
                defaultTTL: 24 * 60 * 60 * 1000, // 24 hours
                indexKeys: ['key', 'metadata.toolName', 'metadata.agentId', 'expiresAt'],
                maxDocuments: 1000000,
                backgroundCleanup: true
            },

            performance: {
                maxCacheTime: 10, // 10ms max cache operation time
                parallelWrites: true,
                writeThrough: false,
                readThrough: true
            }
        };
    }

    // =============================================================================
    // PUBLIC API
    // =============================================================================

    /**
     * Get cache events observable
     */
    public get cacheEvents(): Observable<CacheEvent> {
        return this.cacheEvents$.asObservable();
    }

    /**
     * Get cache statistics
     */
    public getStats(): CacheStats {
        const totalRequests = this.stats.memory.hits + this.stats.memory.misses +
                             this.stats.redis.hits + this.stats.redis.misses +
                             this.stats.mongo.hits + this.stats.mongo.misses;

        const totalHits = this.stats.memory.hits + this.stats.redis.hits + this.stats.mongo.hits;

        return {
            totalEntries: this.stats.memory.entries + this.stats.redis.entries + this.stats.mongo.entries,
            totalSize: this.stats.memory.size + this.stats.redis.size + this.stats.mongo.size,
            hitRate: totalRequests > 0 ? totalHits / totalRequests : 0,
            missRate: totalRequests > 0 ? 1 - (totalHits / totalRequests) : 0,
            evictionRate: totalRequests > 0 ? 
                (this.stats.memory.evictions + this.stats.redis.evictions + this.stats.mongo.evictions) / totalRequests : 0,
            avgAccessTime: totalRequests > 0 ?
                (this.stats.memory.avgResponseTime + this.stats.redis.avgResponseTime + this.stats.mongo.avgResponseTime) / 3 : 0,
            memoryStats: { ...this.stats.memory },
            redisStats: { ...this.stats.redis },
            mongoStats: { ...this.stats.mongo }
        };
    }

    /**
     * Update configuration
     */
    public updateConfig(newConfig: Partial<ValidationCacheConfig>): void {
        this.config = { ...this.config, ...newConfig };
    }

    /**
     * Get current configuration
     */
    public getConfig(): ValidationCacheConfig {
        return { ...this.config };
    }

    /**
     * Clear all caches
     */
    public async clearAllCaches(): Promise<void> {
        // Clear memory cache
        this.memoryCache.clear();
        this.accessOrder.clear();
        this.accessFrequency.clear();
        this.memoryCacheSize = 0;
        this.stats.memory.entries = 0;
        this.stats.memory.size = 0;

        // Clear Redis cache (placeholder)
        if (this.redisClient) {
            // await this.redisClient.flushdb();
        }

        // Clear MongoDB cache (placeholder)
        if (this.mongoCollection) {
            // await this.mongoCollection.deleteMany({});
        }

    }

    /**
     * Get memory cache size info
     */
    public getMemoryCacheInfo(): {
        entries: number;
        size: number;
        maxSize: number;
        utilization: number;
    } {
        return {
            entries: this.memoryCache.size,
            size: this.memoryCacheSize,
            maxSize: this.config.memoryCache.maxSize,
            utilization: this.memoryCacheSize / this.config.memoryCache.maxSize
        };
    }

    /**
     * Shutdown cache service
     */
    public shutdown(): void {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }

        if (this.redisClient) {
            // this.redisClient.disconnect();
        }

    }
}