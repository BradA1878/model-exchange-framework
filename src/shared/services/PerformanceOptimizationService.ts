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
 * PerformanceOptimizationService - Phase 6 Advanced Analytics
 * 
 * Performance optimization features including:
 * - Bottleneck detection
 * - Cache optimization
 * - Resource usage monitoring
 * - Performance profiling
 * - Automatic tuning
 */

import { EventEmitter } from 'events';
import { Logger } from '../utils/Logger';
import { EventBus } from '../events/EventBus';
import { Events } from '../events/EventNames';
import { ValidationPerformanceService } from './ValidationPerformanceService';
import { ProactiveValidationService } from './ProactiveValidationService';
import { ValidationCacheService } from './ValidationCacheService';
import { ValidationMiddleware } from './ValidationMiddleware';
import { v4 as uuidv4 } from 'uuid';

/**
 * Performance bottleneck types
 */
export enum BottleneckType {
    VALIDATION_LATENCY = 'validation_latency',
    CACHE_MISS = 'cache_miss',
    DATABASE_QUERY = 'database_query',
    NETWORK_IO = 'network_io',
    CPU_BOUND = 'cpu_bound',
    MEMORY_PRESSURE = 'memory_pressure'
}

/**
 * Performance profile
 */
export interface PerformanceProfile {
    profileId: string;
    timestamp: number;
    duration: number;
    operations: OperationProfile[];
    bottlenecks: Bottleneck[];
    recommendations: OptimizationRecommendation[];
    resourceUsage: ResourceUsage;
}

/**
 * Operation profile
 */
export interface OperationProfile {
    name: string;
    startTime: number;
    endTime: number;
    duration: number;
    type: 'validation' | 'cache' | 'database' | 'network' | 'computation';
    metadata?: Record<string, any>;
    children?: OperationProfile[];
}

/**
 * Bottleneck detection result
 */
export interface Bottleneck {
    type: BottleneckType;
    severity: 'low' | 'medium' | 'high' | 'critical';
    location: string;
    impact: number; // Percentage of total time
    frequency: number; // Occurrences per minute
    description: string;
    suggestedFix?: string;
}

/**
 * Optimization recommendation
 */
export interface OptimizationRecommendation {
    id: string;
    priority: 'low' | 'medium' | 'high' | 'critical';
    category: 'cache' | 'query' | 'algorithm' | 'configuration' | 'infrastructure';
    title: string;
    description: string;
    expectedImprovement: number; // Percentage
    effort: 'low' | 'medium' | 'high';
    implementation?: string;
}

/**
 * Resource usage snapshot
 */
export interface ResourceUsage {
    timestamp: number;
    cpu: {
        usage: number; // Percentage
        cores: number;
        loadAverage: number[];
    };
    memory: {
        used: number; // Bytes
        available: number;
        total: number;
        heapUsed: number;
        heapTotal: number;
        external: number;
        arrayBuffers: number;
    };
    io: {
        diskReadRate: number; // Bytes/sec
        diskWriteRate: number;
        networkInRate: number;
        networkOutRate: number;
    };
}

/**
 * Auto-tuning configuration
 */
export interface AutoTuningConfig {
    enabled: boolean;
    targetLatency: number; // ms
    targetThroughput: number; // ops/sec
    adaptiveThresholds: boolean;
    tuningInterval: number; // ms
    maxCacheSize: number; // bytes
    maxConcurrency: number;
}

/**
 * Performance Optimization Service
 */
export class PerformanceOptimizationService extends EventEmitter {
    private readonly logger: Logger;
    
    // Service dependencies
    private readonly validationPerformanceService: ValidationPerformanceService;
    private readonly proactiveValidationService: ProactiveValidationService;
    private readonly validationCacheService: ValidationCacheService;
    private readonly validationMiddleware: ValidationMiddleware;
    
    // Performance tracking
    private readonly activeProfiles = new Map<string, PerformanceProfile>();
    private readonly operationTimings = new Map<string, number[]>();
    private readonly bottleneckHistory: Bottleneck[] = [];
    
    // Resource monitoring
    private resourceMonitorInterval?: NodeJS.Timeout;
    private readonly resourceHistory: ResourceUsage[] = [];
    private readonly maxResourceHistorySize = 1000;
    
    // Auto-tuning
    private autoTuningConfig: AutoTuningConfig = {
        enabled: false,
        targetLatency: 50,
        targetThroughput: 1000,
        adaptiveThresholds: true,
        tuningInterval: 60000, // 1 minute
        maxCacheSize: 100 * 1024 * 1024, // 100MB
        maxConcurrency: 100
    };
    
    private autoTuningInterval?: NodeJS.Timeout;
    private currentTuningParameters = {
        cacheSize: 50 * 1024 * 1024,
        cacheTTL: 300000,
        validationConcurrency: 10,
        batchSize: 100
    };
    
    // Metrics
    private metrics = {
        profilesCreated: 0,
        bottlenecksDetected: 0,
        optimizationsApplied: 0,
        performanceImprovement: 0
    };
    
    private static instance: PerformanceOptimizationService;
    
    private constructor() {
        super();
        this.logger = new Logger('info', 'PerformanceOptimizationService', 'server');
        
        // Initialize service dependencies
        this.validationPerformanceService = ValidationPerformanceService.getInstance();
        this.proactiveValidationService = ProactiveValidationService.getInstance();
        this.validationCacheService = ValidationCacheService.getInstance();
        this.validationMiddleware = ValidationMiddleware.getInstance();
        
        this.setupEventListeners();
        this.startResourceMonitoring();
        
    }
    
    /**
     * Get singleton instance
     */
    public static getInstance(): PerformanceOptimizationService {
        if (!PerformanceOptimizationService.instance) {
            PerformanceOptimizationService.instance = new PerformanceOptimizationService();
        }
        return PerformanceOptimizationService.instance;
    }
    
    // =============================================================================
    // PERFORMANCE PROFILING
    // =============================================================================
    
    /**
     * Start performance profile
     */
    public startProfile(name?: string): string {
        const profileId = uuidv4();
        const profile: PerformanceProfile = {
            profileId,
            timestamp: Date.now(),
            duration: 0,
            operations: [],
            bottlenecks: [],
            recommendations: [],
            resourceUsage: this.captureResourceUsage()
        };
        
        this.activeProfiles.set(profileId, profile);
        this.metrics.profilesCreated++;
        
        
        return profileId;
    }
    
    /**
     * Record operation timing
     */
    public recordOperation(
        profileId: string,
        operation: Omit<OperationProfile, 'duration'>
    ): void {
        const profile = this.activeProfiles.get(profileId);
        if (!profile) return;
        
        const op: OperationProfile = {
            ...operation,
            duration: operation.endTime - operation.startTime
        };
        
        profile.operations.push(op);
        
        // Track operation timings for analysis
        const key = `${op.type}:${op.name}`;
        if (!this.operationTimings.has(key)) {
            this.operationTimings.set(key, []);
        }
        this.operationTimings.get(key)!.push(op.duration);
        
        // Trim history
        const timings = this.operationTimings.get(key)!;
        if (timings.length > 1000) {
            timings.shift();
        }
    }
    
    /**
     * End performance profile
     */
    public async endProfile(profileId: string): Promise<PerformanceProfile> {
        const profile = this.activeProfiles.get(profileId);
        if (!profile) {
            throw new Error(`Profile not found: ${profileId}`);
        }
        
        profile.duration = Date.now() - profile.timestamp;
        profile.resourceUsage = this.captureResourceUsage();
        
        // Detect bottlenecks
        profile.bottlenecks = await this.detectBottlenecks(profile);
        
        // Generate recommendations
        profile.recommendations = await this.generateRecommendations(profile);
        
        // Clean up
        this.activeProfiles.delete(profileId);
        
        
        // Emit profile completed event
        this.emit('profile_completed', profile);
        EventBus.server.emit(Events.Analytics.PERFORMANCE_PROFILE_COMPLETED, {
            profileId,
            duration: profile.duration,
            bottlenecks: profile.bottlenecks.length,
            recommendations: profile.recommendations.length
        });
        
        return profile;
    }
    
    /**
     * Profile validation performance
     */
    public async profileValidation(
        toolName: string,
        parameters: Record<string, any>,
        iterations: number = 10
    ): Promise<PerformanceProfile> {
        const profileId = this.startProfile();
        
        for (let i = 0; i < iterations; i++) {
            const opStart = Date.now();
            
            try {
                await this.proactiveValidationService.validateToolCall(
                    'perf-test-agent',
                    'perf-test-channel',
                    toolName,
                    parameters,
                    uuidv4()
                );
            } catch (error) {
                // Ignore validation errors for profiling
            }
            
            this.recordOperation(profileId, {
                name: `validation_${i}`,
                startTime: opStart,
                endTime: Date.now(),
                type: 'validation',
                metadata: { toolName, iteration: i }
            });
        }
        
        return this.endProfile(profileId);
    }
    
    // =============================================================================
    // BOTTLENECK DETECTION
    // =============================================================================
    
    /**
     * Detect bottlenecks
     */
    public async detectBottlenecks(
        profile?: PerformanceProfile
    ): Promise<Bottleneck[]> {
        const bottlenecks: Bottleneck[] = [];
        
        // Analyze validation latency
        const validationBottlenecks = await this.detectValidationBottlenecks();
        bottlenecks.push(...validationBottlenecks);
        
        // Analyze cache performance
        const cacheBottlenecks = await this.detectCacheBottlenecks();
        bottlenecks.push(...cacheBottlenecks);
        
        // Analyze resource usage
        const resourceBottlenecks = await this.detectResourceBottlenecks();
        bottlenecks.push(...resourceBottlenecks);
        
        // Analyze operation profile if provided
        if (profile) {
            const profileBottlenecks = this.analyzeProfile(profile);
            bottlenecks.push(...profileBottlenecks);
        }
        
        // Sort by severity and impact
        bottlenecks.sort((a, b) => {
            const severityOrder = { critical: 4, high: 3, medium: 2, low: 1 };
            const severityDiff = severityOrder[b.severity] - severityOrder[a.severity];
            return severityDiff !== 0 ? severityDiff : b.impact - a.impact;
        });
        
        // Track bottlenecks
        this.bottleneckHistory.push(...bottlenecks);
        this.metrics.bottlenecksDetected += bottlenecks.length;
        
        // Trim history
        if (this.bottleneckHistory.length > 1000) {
            this.bottleneckHistory.splice(0, this.bottleneckHistory.length - 1000);
        }
        
        return bottlenecks;
    }
    
    /**
     * Detect validation bottlenecks
     */
    private async detectValidationBottlenecks(): Promise<Bottleneck[]> {
        const bottlenecks: Bottleneck[] = [];
        const metrics = this.proactiveValidationService.getPerformanceMetrics();
        
        // Check average latency
        if (metrics.averageLatency > this.autoTuningConfig.targetLatency) {
            bottlenecks.push({
                type: BottleneckType.VALIDATION_LATENCY,
                severity: metrics.averageLatency > 100 ? 'critical' : 'high',
                location: 'ProactiveValidationService',
                impact: (metrics.averageLatency - this.autoTuningConfig.targetLatency) / 
                        metrics.averageLatency * 100,
                frequency: metrics.totalValidations / 60, // per minute
                description: `Validation latency (${metrics.averageLatency.toFixed(1)}ms) exceeds target (${this.autoTuningConfig.targetLatency}ms)`,
                suggestedFix: 'Enable validation caching or simplify validation rules'
            });
        }
        
        // Check cache hit rate
        if (metrics.cacheHitRate < 0.7) {
            bottlenecks.push({
                type: BottleneckType.CACHE_MISS,
                severity: metrics.cacheHitRate < 0.5 ? 'high' : 'medium',
                location: 'ValidationCacheService',
                impact: (1 - metrics.cacheHitRate) * 30, // 30% impact per miss
                frequency: metrics.totalValidations * (1 - metrics.cacheHitRate) / 60,
                description: `Low cache hit rate (${(metrics.cacheHitRate * 100).toFixed(1)}%)`,
                suggestedFix: 'Increase cache TTL or optimize cache key generation'
            });
        }
        
        return bottlenecks;
    }
    
    /**
     * Detect cache bottlenecks
     */
    private async detectCacheBottlenecks(): Promise<Bottleneck[]> {
        const bottlenecks: Bottleneck[] = [];
        const cacheStats = this.validationCacheService.getStats();
        
        // Check eviction rate
        if (cacheStats.evictionRate > 0.1) {
            bottlenecks.push({
                type: BottleneckType.MEMORY_PRESSURE,
                severity: cacheStats.evictionRate > 0.2 ? 'high' : 'medium',
                location: 'ValidationCacheService',
                impact: cacheStats.evictionRate * 50, // 50% impact per eviction
                frequency: cacheStats.evictionRate * 100, // per minute estimate
                description: `High cache eviction rate (${(cacheStats.evictionRate * 100).toFixed(1)}%)`,
                suggestedFix: 'Increase cache size or optimize memory usage'
            });
        }
        
        // Check access time
        if (cacheStats.avgAccessTime > 10) {
            bottlenecks.push({
                type: BottleneckType.CACHE_MISS,
                severity: cacheStats.avgAccessTime > 20 ? 'high' : 'medium',
                location: 'Cache Layer',
                impact: (cacheStats.avgAccessTime - 10) / cacheStats.avgAccessTime * 100,
                frequency: 1000, // All cache accesses
                description: `Slow cache access (${cacheStats.avgAccessTime.toFixed(1)}ms average)`,
                suggestedFix: 'Enable memory caching or optimize cache implementation'
            });
        }
        
        return bottlenecks;
    }
    
    /**
     * Detect resource bottlenecks
     */
    private async detectResourceBottlenecks(): Promise<Bottleneck[]> {
        const bottlenecks: Bottleneck[] = [];
        const recentUsage = this.getRecentResourceUsage();
        
        if (!recentUsage) return bottlenecks;
        
        // Check CPU usage
        if (recentUsage.cpu.usage > 80) {
            bottlenecks.push({
                type: BottleneckType.CPU_BOUND,
                severity: recentUsage.cpu.usage > 90 ? 'critical' : 'high',
                location: 'System',
                impact: recentUsage.cpu.usage - 80,
                frequency: 60, // Continuous
                description: `High CPU usage (${recentUsage.cpu.usage.toFixed(1)}%)`,
                suggestedFix: 'Optimize algorithms or scale horizontally'
            });
        }
        
        // Check memory usage
        const memoryUsagePercent = (recentUsage.memory.used / recentUsage.memory.total) * 100;
        if (memoryUsagePercent > 80) {
            bottlenecks.push({
                type: BottleneckType.MEMORY_PRESSURE,
                severity: memoryUsagePercent > 90 ? 'critical' : 'high',
                location: 'System',
                impact: memoryUsagePercent - 80,
                frequency: 60, // Continuous
                description: `High memory usage (${memoryUsagePercent.toFixed(1)}%)`,
                suggestedFix: 'Optimize memory usage or increase available memory'
            });
        }
        
        return bottlenecks;
    }
    
    /**
     * Analyze performance profile
     */
    private analyzeProfile(profile: PerformanceProfile): Bottleneck[] {
        const bottlenecks: Bottleneck[] = [];
        
        // Group operations by type
        const operationsByType = new Map<string, OperationProfile[]>();
        for (const op of profile.operations) {
            const key = `${op.type}:${op.name}`;
            if (!operationsByType.has(key)) {
                operationsByType.set(key, []);
            }
            operationsByType.get(key)!.push(op);
        }
        
        // Find slow operations
        for (const [key, ops] of operationsByType) {
            const avgDuration = ops.reduce((sum, op) => sum + op.duration, 0) / ops.length;
            const totalDuration = ops.reduce((sum, op) => sum + op.duration, 0);
            const impact = (totalDuration / profile.duration) * 100;
            
            if (avgDuration > 50 && impact > 10) {
                bottlenecks.push({
                    type: this.getBottleneckType(ops[0].type),
                    severity: avgDuration > 100 ? 'high' : 'medium',
                    location: key,
                    impact,
                    frequency: ops.length / (profile.duration / 60000), // per minute
                    description: `Slow operation: ${key} (${avgDuration.toFixed(1)}ms average)`,
                    suggestedFix: `Optimize ${ops[0].type} performance`
                });
            }
        }
        
        return bottlenecks;
    }
    
    /**
     * Get bottleneck type from operation type
     */
    private getBottleneckType(opType: string): BottleneckType {
        switch (opType) {
            case 'validation':
                return BottleneckType.VALIDATION_LATENCY;
            case 'cache':
                return BottleneckType.CACHE_MISS;
            case 'database':
                return BottleneckType.DATABASE_QUERY;
            case 'network':
                return BottleneckType.NETWORK_IO;
            default:
                return BottleneckType.CPU_BOUND;
        }
    }
    
    // =============================================================================
    // OPTIMIZATION RECOMMENDATIONS
    // =============================================================================
    
    /**
     * Generate optimization recommendations
     */
    public async generateRecommendations(
        profile?: PerformanceProfile
    ): Promise<OptimizationRecommendation[]> {
        const recommendations: OptimizationRecommendation[] = [];
        
        // Get current bottlenecks
        const bottlenecks = profile?.bottlenecks || await this.detectBottlenecks();
        
        // Generate recommendations based on bottlenecks
        for (const bottleneck of bottlenecks) {
            const recs = this.generateBottleneckRecommendations(bottleneck);
            recommendations.push(...recs);
        }
        
        // Add general optimization recommendations
        const generalRecs = await this.generateGeneralRecommendations();
        recommendations.push(...generalRecs);
        
        // Remove duplicates and sort by priority
        const uniqueRecs = this.deduplicateRecommendations(recommendations);
        uniqueRecs.sort((a, b) => {
            const priorityOrder = { critical: 4, high: 3, medium: 2, low: 1 };
            return priorityOrder[b.priority] - priorityOrder[a.priority];
        });
        
        return uniqueRecs;
    }
    
    /**
     * Generate recommendations for a bottleneck
     */
    private generateBottleneckRecommendations(
        bottleneck: Bottleneck
    ): OptimizationRecommendation[] {
        const recommendations: OptimizationRecommendation[] = [];
        
        switch (bottleneck.type) {
            case BottleneckType.VALIDATION_LATENCY:
                recommendations.push({
                    id: uuidv4(),
                    priority: bottleneck.severity as any,
                    category: 'cache',
                    title: 'Enable Validation Result Caching',
                    description: 'Cache validation results to reduce repeated validation overhead',
                    expectedImprovement: 40,
                    effort: 'low',
                    implementation: `
validationCacheService.updateConfig({
    enabled: true,
    defaultTTL: 600000, // 10 minutes
    maxSize: 100 * 1024 * 1024 // 100MB
});`
                });
                
                recommendations.push({
                    id: uuidv4(),
                    priority: 'medium',
                    category: 'algorithm',
                    title: 'Optimize Validation Rules',
                    description: 'Simplify complex validation rules and remove redundant checks',
                    expectedImprovement: 25,
                    effort: 'medium'
                });
                break;
                
            case BottleneckType.CACHE_MISS:
                recommendations.push({
                    id: uuidv4(),
                    priority: bottleneck.severity as any,
                    category: 'cache',
                    title: 'Increase Cache TTL',
                    description: 'Extend cache time-to-live for frequently accessed data',
                    expectedImprovement: 30,
                    effort: 'low',
                    implementation: `
validationCacheService.updateConfig({
    defaultTTL: 1800000, // 30 minutes
    aggressiveCaching: true
});`
                });
                
                recommendations.push({
                    id: uuidv4(),
                    priority: 'medium',
                    category: 'cache',
                    title: 'Implement Cache Warming',
                    description: 'Pre-populate cache with common validation patterns',
                    expectedImprovement: 20,
                    effort: 'medium'
                });
                break;
                
            case BottleneckType.MEMORY_PRESSURE:
                recommendations.push({
                    id: uuidv4(),
                    priority: bottleneck.severity as any,
                    category: 'infrastructure',
                    title: 'Increase Memory Allocation',
                    description: 'Allocate more memory to the application',
                    expectedImprovement: 50,
                    effort: 'low',
                    implementation: 'node --max-old-space-size=4096 app.js'
                });
                
                recommendations.push({
                    id: uuidv4(),
                    priority: 'high',
                    category: 'algorithm',
                    title: 'Optimize Memory Usage',
                    description: 'Identify and fix memory leaks, optimize data structures',
                    expectedImprovement: 35,
                    effort: 'high'
                });
                break;
                
            case BottleneckType.CPU_BOUND:
                recommendations.push({
                    id: uuidv4(),
                    priority: bottleneck.severity as any,
                    category: 'infrastructure',
                    title: 'Enable Worker Threads',
                    description: 'Use worker threads for CPU-intensive operations',
                    expectedImprovement: 40,
                    effort: 'medium',
                    implementation: `
const { Worker } = require('worker_threads');
// Move CPU-intensive validation to workers`
                });
                
                recommendations.push({
                    id: uuidv4(),
                    priority: 'medium',
                    category: 'algorithm',
                    title: 'Optimize Algorithms',
                    description: 'Replace O(n²) algorithms with more efficient alternatives',
                    expectedImprovement: 30,
                    effort: 'high'
                });
                break;
        }
        
        return recommendations;
    }
    
    /**
     * Generate general optimization recommendations
     */
    private async generateGeneralRecommendations(): Promise<OptimizationRecommendation[]> {
        const recommendations: OptimizationRecommendation[] = [];
        const metrics = this.proactiveValidationService.getPerformanceMetrics();
        
        // Check if async validation can be enabled
        if (metrics.averageLatency < 30) {
            recommendations.push({
                id: uuidv4(),
                priority: 'low',
                category: 'configuration',
                title: 'Enable Async Validation',
                description: 'Switch to async validation for better throughput',
                expectedImprovement: 20,
                effort: 'low',
                implementation: `
proactiveValidationService.updateConfig({
    defaultValidationLevel: ValidationLevel.ASYNC
});`
            });
        }
        
        // Check if batch processing can help
        const operationRate = this.getOperationRate();
        if (operationRate > 100) {
            recommendations.push({
                id: uuidv4(),
                priority: 'medium',
                category: 'algorithm',
                title: 'Enable Batch Processing',
                description: 'Process validations in batches to reduce overhead',
                expectedImprovement: 25,
                effort: 'medium'
            });
        }
        
        return recommendations;
    }
    
    /**
     * Deduplicate recommendations
     */
    private deduplicateRecommendations(
        recommendations: OptimizationRecommendation[]
    ): OptimizationRecommendation[] {
        const seen = new Set<string>();
        return recommendations.filter(rec => {
            const key = `${rec.category}:${rec.title}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }
    
    // =============================================================================
    // CACHE OPTIMIZATION
    // =============================================================================
    
    /**
     * Optimize cache configuration
     */
    public async optimizeCaching(): Promise<void> {
        const cacheStats = this.validationCacheService.getStats();
        const currentConfig = this.validationCacheService.getConfig();
        
        // Calculate optimal cache size based on hit rate and memory usage
        const optimalSize = this.calculateOptimalCacheSize(cacheStats);
        
        // Calculate optimal TTL based on access patterns
        const optimalTTL = this.calculateOptimalTTL(cacheStats);
        
        // Apply optimizations
        if (Math.abs(optimalSize - currentConfig.memoryCache.maxSize) > 10 * 1024 * 1024) {
            this.validationCacheService.updateConfig({
                memoryCache: {
                    ...currentConfig.memoryCache,
                    maxSize: optimalSize
                }
            });
            
        }
        
        if (Math.abs(optimalTTL - currentConfig.memoryCache.defaultTTL) > 60000) {
            this.validationCacheService.updateConfig({
                memoryCache: {
                    ...currentConfig.memoryCache,
                    defaultTTL: optimalTTL
                }
            });
            
        }
        
        this.metrics.optimizationsApplied++;
    }
    
    /**
     * Calculate optimal cache size
     */
    private calculateOptimalCacheSize(stats: any): number {
        // Target 80% hit rate with minimal memory
        const currentHitRate = stats.hitRate;
        const currentSize = stats.memoryStats.maxSize;
        
        if (currentHitRate < 0.7) {
            // Increase cache size
            return Math.min(
                currentSize * 1.5,
                this.autoTuningConfig.maxCacheSize
            );
        } else if (currentHitRate > 0.9 && stats.evictionRate < 0.05) {
            // Decrease cache size if we have excess
            return Math.max(
                currentSize * 0.8,
                10 * 1024 * 1024 // 10MB minimum
            );
        }
        
        return currentSize;
    }
    
    /**
     * Calculate optimal TTL
     */
    private calculateOptimalTTL(stats: any): number {
        // Base TTL on access patterns
        const avgTimeBetweenAccess = 300000; // 5 minutes default
        
        // Adjust based on hit rate
        if (stats.hitRate < 0.7) {
            return avgTimeBetweenAccess * 2; // Increase TTL
        } else if (stats.hitRate > 0.9) {
            return avgTimeBetweenAccess * 0.8; // Slightly decrease TTL
        }
        
        return avgTimeBetweenAccess;
    }
    
    // =============================================================================
    // AUTO-TUNING
    // =============================================================================
    
    /**
     * Enable auto-tuning
     */
    public enableAutoTuning(config?: Partial<AutoTuningConfig>): void {
        this.autoTuningConfig = { ...this.autoTuningConfig, ...config, enabled: true };
        
        if (this.autoTuningInterval) {
            clearInterval(this.autoTuningInterval);
        }
        
        this.autoTuningInterval = setInterval(() => {
            this.performAutoTuning();
        }, this.autoTuningConfig.tuningInterval);
        
    }
    
    /**
     * Disable auto-tuning
     */
    public disableAutoTuning(): void {
        this.autoTuningConfig.enabled = false;
        
        if (this.autoTuningInterval) {
            clearInterval(this.autoTuningInterval);
            this.autoTuningInterval = undefined;
        }
        
    }
    
    /**
     * Perform auto-tuning
     */
    private async performAutoTuning(): Promise<void> {
        if (!this.autoTuningConfig.enabled) return;
        
        try {
            // Detect current bottlenecks
            const bottlenecks = await this.detectBottlenecks();
            
            // Apply automatic optimizations
            for (const bottleneck of bottlenecks) {
                if (bottleneck.severity === 'critical' || bottleneck.severity === 'high') {
                    await this.applyAutoOptimization(bottleneck);
                }
            }
            
            // Optimize cache configuration
            await this.optimizeCaching();
            
            // Adjust concurrency limits
            await this.optimizeConcurrency();
            
            
        } catch (error) {
            this.logger.error('Auto-tuning error:', error);
        }
    }
    
    /**
     * Apply automatic optimization for a bottleneck
     */
    private async applyAutoOptimization(bottleneck: Bottleneck): Promise<void> {
        switch (bottleneck.type) {
            case BottleneckType.VALIDATION_LATENCY:
                // Increase cache TTL
                this.currentTuningParameters.cacheTTL = Math.min(
                    this.currentTuningParameters.cacheTTL * 1.2,
                    3600000 // 1 hour max
                );
                break;
                
            case BottleneckType.CACHE_MISS:
                // Increase cache size
                this.currentTuningParameters.cacheSize = Math.min(
                    this.currentTuningParameters.cacheSize * 1.2,
                    this.autoTuningConfig.maxCacheSize
                );
                break;
                
            case BottleneckType.CPU_BOUND:
                // Reduce concurrency
                this.currentTuningParameters.validationConcurrency = Math.max(
                    this.currentTuningParameters.validationConcurrency * 0.8,
                    1
                );
                break;
        }
        
        this.metrics.optimizationsApplied++;
    }
    
    /**
     * Optimize concurrency settings
     */
    private async optimizeConcurrency(): Promise<void> {
        const cpuUsage = this.getRecentResourceUsage()?.cpu.usage || 0;
        const currentConcurrency = this.currentTuningParameters.validationConcurrency;
        
        if (cpuUsage < 50 && currentConcurrency < this.autoTuningConfig.maxConcurrency) {
            // Increase concurrency
            this.currentTuningParameters.validationConcurrency = Math.min(
                currentConcurrency * 1.1,
                this.autoTuningConfig.maxConcurrency
            );
        } else if (cpuUsage > 80) {
            // Decrease concurrency
            this.currentTuningParameters.validationConcurrency = Math.max(
                currentConcurrency * 0.9,
                1
            );
        }
    }
    
    // =============================================================================
    // RESOURCE MONITORING
    // =============================================================================
    
    /**
     * Start resource monitoring
     */
    private startResourceMonitoring(): void {
        this.resourceMonitorInterval = setInterval(() => {
            const usage = this.captureResourceUsage();
            this.resourceHistory.push(usage);
            
            // Trim history
            if (this.resourceHistory.length > this.maxResourceHistorySize) {
                this.resourceHistory.shift();
            }
            
            // Emit resource update
            this.emit('resource_update', usage);
        }, 5000); // Every 5 seconds
    }
    
    /**
     * Capture current resource usage
     */
    private captureResourceUsage(): ResourceUsage {
        const memUsage = process.memoryUsage();
        const cpuUsage = process.cpuUsage();
        
        return {
            timestamp: Date.now(),
            cpu: {
                usage: this.calculateCPUPercentage(cpuUsage),
                cores: require('os').cpus().length,
                loadAverage: require('os').loadavg()
            },
            memory: {
                used: memUsage.rss,
                available: require('os').freemem(),
                total: require('os').totalmem(),
                heapUsed: memUsage.heapUsed,
                heapTotal: memUsage.heapTotal,
                external: memUsage.external,
                arrayBuffers: memUsage.arrayBuffers
            },
            io: {
                diskReadRate: 0, // Would need system-specific implementation
                diskWriteRate: 0,
                networkInRate: 0,
                networkOutRate: 0
            }
        };
    }
    
    /**
     * Calculate CPU percentage
     */
    private calculateCPUPercentage(cpuUsage: NodeJS.CpuUsage): number {
        // Simplified calculation
        const totalTime = cpuUsage.user + cpuUsage.system;
        const cores = require('os').cpus().length;
        return Math.min(100, (totalTime / 1000000 / cores) * 100);
    }
    
    /**
     * Get recent resource usage
     */
    private getRecentResourceUsage(): ResourceUsage | undefined {
        return this.resourceHistory[this.resourceHistory.length - 1];
    }
    
    /**
     * Get operation rate
     */
    private getOperationRate(): number {
        const recentOps = Array.from(this.operationTimings.values())
            .reduce((sum, timings) => sum + timings.length, 0);
        return recentOps / 60; // Operations per minute
    }
    
    // =============================================================================
    // EVENT LISTENERS
    // =============================================================================
    
    /**
     * Setup event listeners
     */
    private setupEventListeners(): void {
        // Listen to validation events for performance tracking
        EventBus.server.on(Events.Mcp.TOOL_VALIDATION_STARTED, (event) => {
            // Track validation start times
        });
        
        EventBus.server.on(Events.Mcp.TOOL_VALIDATION_COMPLETED, (event) => {
            // Track validation completion times
        });
    }
    
    // =============================================================================
    // PUBLIC API
    // =============================================================================
    
    /**
     * Get performance metrics
     */
    public getMetrics(): any {
        return {
            ...this.metrics,
            currentTuningParameters: this.currentTuningParameters,
            recentBottlenecks: this.bottleneckHistory.slice(-10),
            resourceUsage: this.getRecentResourceUsage()
        };
    }
    
    /**
     * Get auto-tuning configuration
     */
    public getAutoTuningConfig(): AutoTuningConfig {
        return { ...this.autoTuningConfig };
    }
    
    /**
     * Clear metrics (for testing)
     */
    public clearMetrics(): void {
        this.metrics = {
            profilesCreated: 0,
            bottlenecksDetected: 0,
            optimizationsApplied: 0,
            performanceImprovement: 0
        };
        this.bottleneckHistory.length = 0;
        this.operationTimings.clear();
        this.resourceHistory.length = 0;
    }
    
    /**
     * Cleanup
     */
    public cleanup(): void {
        if (this.resourceMonitorInterval) {
            clearInterval(this.resourceMonitorInterval);
        }
        if (this.autoTuningInterval) {
            clearInterval(this.autoTuningInterval);
        }
    }
}