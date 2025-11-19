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
 * MXP Event Forwarding Queue Enhancer
 * 
 * Enhances the existing EventForwardingQueue with MXP 2.0 compression and optimization.
 * Integrates binary protocol, message batching, and priority-aware compression.
 * Only activates when bandwidth optimization is enabled.
 */

import { Logger } from '../utils/Logger';
import { createStrictValidator } from '../utils/validation';
import { EventBus } from '../events/EventBus';
import { Events } from '../events/EventNames';
import { MxpConfigManager } from './MxpConfigManager';
import { BinaryProtocolLayer, CompressionResult } from './BinaryProtocolLayer';

// Event priority levels (matching existing system)
export enum EventPriority {
    CRITICAL = 0,    // System failures, agent disconnections
    HIGH = 1,        // Task assignments, tool results  
    NORMAL = 2,      // Agent messages, status updates
    LOW = 3,         // Discovery requests, heartbeats
    BACKGROUND = 4   // Memory updates, analytics
}

// Enhanced queued event with MXP support
export interface MxpQueuedEvent {
    id: string;
    priority: EventPriority;
    type: 'agent' | 'channel';
    eventName: string;
    payload: any;
    targetId: string; // agentId or channelId
    excludedAgentId?: string;
    timestamp: number;
    retryCount: number;
    
    // MXP enhancements
    compressionEnabled?: boolean;
    originalSize?: number;
    compressedData?: CompressionResult;
    channelId?: string; // For MXP configuration lookup
}

// MXP-enhanced queue configuration
export interface MxpEventQueueConfig {
    enabled: boolean;
    batchSize: number;
    processingDelayMs: number;
    maxQueueSize: number;
    maxRetries: number;
    
    // MXP-specific settings
    mxpEnabled: boolean;
    compressionByPriority: {
        [key in EventPriority]: {
            enabled: boolean;
            algorithm: 'none' | 'msgpack' | 'msgpack-compressed';
            minSize: number; // Only compress messages larger than this
        };
    };
}

// Default MXP-enhanced configuration
const defaultMxpQueueConfig: MxpEventQueueConfig = {
    enabled: true,
    batchSize: 10,
    processingDelayMs: 25,
    maxQueueSize: 1000,
    maxRetries: 3,
    
    mxpEnabled: true,
    compressionByPriority: {
        [EventPriority.CRITICAL]: {
            enabled: false,        // Speed over size for critical events
            algorithm: 'none',
            minSize: 0
        },
        [EventPriority.HIGH]: {
            enabled: true,         // Light compression for high priority
            algorithm: 'msgpack',
            minSize: 512           // 512 bytes minimum
        },
        [EventPriority.NORMAL]: {
            enabled: true,         // Standard compression
            algorithm: 'msgpack',
            minSize: 256           // 256 bytes minimum
        },
        [EventPriority.LOW]: {
            enabled: true,         // Aggressive compression for low priority
            algorithm: 'msgpack-compressed',
            minSize: 128           // 128 bytes minimum
        },
        [EventPriority.BACKGROUND]: {
            enabled: true,         // Maximum compression for background
            algorithm: 'msgpack-compressed',
            minSize: 64            // 64 bytes minimum
        }
    }
};

export class MxpEventForwardingEnhancer {
    private static instance: MxpEventForwardingEnhancer | null = null;
    
    private readonly logger: Logger;
    private readonly validator = createStrictValidator('MxpEventForwardingEnhancer');
    private config: MxpEventQueueConfig;
    
    // Enhanced queues with MXP support
    private enhancedQueues: Map<EventPriority, MxpQueuedEvent[]> = new Map();
    private processing: boolean = false;
    private processingTimer: NodeJS.Timeout | null = null;
    
    // Statistics tracking
    private stats = {
        totalEvents: 0,
        compressedEvents: 0,
        totalBandwidthSaved: 0,
        averageCompressionRatio: 0,
        processingTimeMs: 0
    };

    private constructor(config: MxpEventQueueConfig = defaultMxpQueueConfig) {
        this.config = { ...config };
        this.logger = new Logger('info', 'MxpEventForwardingEnhancer', 'server');
        
        // Initialize enhanced priority queues
        Object.values(EventPriority).forEach(priority => {
            if (typeof priority === 'number') {
                this.enhancedQueues.set(priority, []);
            }
        });

    }

    /**
     * Get the singleton instance of MxpEventForwardingEnhancer
     */
    public static getInstance(): MxpEventForwardingEnhancer {
        if (!MxpEventForwardingEnhancer.instance) {
            MxpEventForwardingEnhancer.instance = new MxpEventForwardingEnhancer();
        }
        return MxpEventForwardingEnhancer.instance;
    }

    /**
     * Enhanced event queueing with MXP compression support
     * Only applies compression when bandwidth optimization is enabled
     */
    public async enqueueEvent(
        eventName: string,
        payload: any,
        priority: EventPriority,
        targetId: string,
        type: 'agent' | 'channel',
        channelId?: string,
        excludedAgentId?: string
    ): Promise<void> {
        this.validator.assertIsNonEmptyString(eventName, 'Event name is required');
        this.validator.assertIsObject(payload, 'Event payload must be an object');
        this.validator.assertIsNonEmptyString(targetId, 'Target ID is required');

        try {
            const startTime = Date.now();
            
            // Check if MXP bandwidth optimization is enabled for this context
            const isBandwidthOptEnabled = channelId ? 
                MxpConfigManager.getInstance().isFeatureEnabled(channelId, 'bandwidthOptimization', targetId) : 
                false;

            // Create base event
            const event: MxpQueuedEvent = {
                id: `mxp_event_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`,
                priority,
                type,
                eventName,
                payload,
                targetId,
                excludedAgentId,
                timestamp: Date.now(),
                retryCount: 0,
                compressionEnabled: isBandwidthOptEnabled && this.config.mxpEnabled,
                channelId
            };

            // Apply MXP compression if enabled
            if (event.compressionEnabled && this.shouldCompressEvent(event)) {
                await this.applyMxpCompression(event);
            }

            // Add to appropriate priority queue
            const queue = this.enhancedQueues.get(priority);
            if (queue) {
                // Check queue size limits
                if (queue.length >= this.config.maxQueueSize) {
                    this.logger.warn(`Queue full for priority ${priority}, dropping oldest event`);
                    queue.shift(); // Remove oldest event
                }
                
                queue.push(event);
                this.stats.totalEvents++;
                
                // ;
            }

            // Start processing if not already running
            if (!this.processing && this.config.enabled) {
                this.startProcessing();
            }

        } catch (error) {
            this.logger.error('Failed to enqueue MXP event', {
                error: error instanceof Error ? error.message : String(error),
                eventName,
                priority: EventPriority[priority],
                targetId
            });
            throw error;
        }
    }

    /**
     * Enhanced batch processing with MXP compression awareness
     */
    private async processBatch(): Promise<void> {
        const batch: MxpQueuedEvent[] = [];
        const batchStartTime = Date.now();
        
        // Collect events by priority (CRITICAL first)
        for (const priority of [EventPriority.CRITICAL, EventPriority.HIGH, EventPriority.NORMAL, EventPriority.LOW, EventPriority.BACKGROUND]) {
            const queue = this.enhancedQueues.get(priority);
            if (queue && queue.length > 0) {
                const batchSize = Math.min(this.config.batchSize - batch.length, queue.length);
                batch.push(...queue.splice(0, batchSize));
                
                if (batch.length >= this.config.batchSize) break;
            }
        }

        if (batch.length === 0) return;

        try {
            // Group events by compression status for efficient processing
            const compressedEvents = batch.filter(e => e.compressedData);
            const uncompressedEvents = batch.filter(e => !e.compressedData);

            // ;

            // Process compressed events (may need decompression for forwarding)
            for (const event of compressedEvents) {
                await this.processCompressedEvent(event);
            }

            // Process uncompressed events normally
            for (const event of uncompressedEvents) {
                await this.processUncompressedEvent(event);
            }

            // Update statistics
            this.stats.processingTimeMs += (Date.now() - batchStartTime);
            

        } catch (error) {
            this.logger.error('Batch processing failed', {
                error: error instanceof Error ? error.message : String(error),
                batchSize: batch.length
            });
        }
    }

    /**
     * Apply MXP compression to an event if warranted
     */
    private async applyMxpCompression(event: MxpQueuedEvent): Promise<void> {
        const priorityConfig = this.config.compressionByPriority[event.priority];
        
        if (!priorityConfig.enabled) {
            return; // Compression disabled for this priority level
        }

        try {
            // Calculate payload size
            const payloadString = JSON.stringify(event.payload);
            const payloadSize = Buffer.byteLength(payloadString, 'utf8');
            event.originalSize = payloadSize;

            // Check minimum size threshold
            if (payloadSize < priorityConfig.minSize) {
                return;
            }

            // Create MXP message for compression
            const mxpMessage = {
                type: event.eventName,
                payload: event.payload,
                metadata: {
                    eventId: event.id,
                    priority: event.priority,
                    timestamp: event.timestamp
                },
                size: payloadSize
            };

            // Apply compression using BinaryProtocolLayer
            const compressionResult = BinaryProtocolLayer.getInstance().encodeMessage(
                mxpMessage,
                event.channelId || 'default',
                event.targetId
            );

            if (compressionResult) {
                event.compressedData = compressionResult;
                this.stats.compressedEvents++;
                this.stats.totalBandwidthSaved += (compressionResult.originalSize - compressionResult.compressedSize);
                
                // Update average compression ratio
                const totalCompressed = this.stats.compressedEvents;
                this.stats.averageCompressionRatio = 
                    ((this.stats.averageCompressionRatio * (totalCompressed - 1)) + compressionResult.compressionRatio) / totalCompressed;

                // ;
            }

        } catch (error) {
            this.logger.warn('MXP compression failed, proceeding without compression', {
                error: error instanceof Error ? error.message : String(error),
                eventId: event.id
            });
        }
    }

    /**
     * Check if an event should be compressed based on configuration
     */
    private shouldCompressEvent(event: MxpQueuedEvent): boolean {
        const priorityConfig = this.config.compressionByPriority[event.priority];
        return priorityConfig.enabled && this.config.mxpEnabled;
    }

    /**
     * Process a compressed event (placeholder for actual forwarding logic)
     */
    private async processCompressedEvent(event: MxpQueuedEvent): Promise<void> {
        // In full implementation, this would forward the compressed event
        // For now, we'll decompress and forward normally as a placeholder
        
        if (event.compressedData) {
            // Optionally decompress for forwarding (depends on receiving end capability)
            const decompressed = BinaryProtocolLayer.getInstance().decodeMessage(event.compressedData);
            if (decompressed) {
                // Forward the decompressed message
                // ;
            }
        }
    }

    /**
     * Process an uncompressed event (placeholder for actual forwarding logic)
     */
    private async processUncompressedEvent(event: MxpQueuedEvent): Promise<void> {
        // In full implementation, this would forward the event normally
        // ;
    }

    /**
     * Start enhanced batch processing
     */
    public startProcessing(): void {
        if (this.processing || !this.config.enabled) return;
        
        this.processing = true;
        this.scheduleNextBatch();
    }

    /**
     * Stop enhanced batch processing
     */
    public stopProcessing(): void {
        this.processing = false;
        if (this.processingTimer) {
            clearTimeout(this.processingTimer);
            this.processingTimer = null;
        }
    }

    /**
     * Schedule next batch processing
     */
    private scheduleNextBatch(): void {
        if (!this.processing) return;

        this.processingTimer = setTimeout(() => {
            this.processBatch();
            this.scheduleNextBatch();
        }, this.config.processingDelayMs);
    }

    /**
     * Get MXP-enhanced queue statistics
     */
    public getEnhancedStats(): {
        totalEvents: number;
        compressedEvents: number;
        compressionRate: number;
        totalBandwidthSaved: number;
        averageCompressionRatio: number;
        queueSizes: Record<string, number>;
        processingTimeMs: number;
    } {
        const queueSizes: Record<string, number> = {};
        for (const [priority, queue] of this.enhancedQueues.entries()) {
            queueSizes[EventPriority[priority]] = queue.length;
        }

        return {
            totalEvents: this.stats.totalEvents,
            compressedEvents: this.stats.compressedEvents,
            compressionRate: this.stats.totalEvents > 0 ? 
                Math.round((this.stats.compressedEvents / this.stats.totalEvents) * 100) : 0,
            totalBandwidthSaved: this.stats.totalBandwidthSaved,
            averageCompressionRatio: this.stats.averageCompressionRatio,
            queueSizes,
            processingTimeMs: this.stats.processingTimeMs
        };
    }

    /**
     * Update configuration at runtime
     */
    public updateConfig(newConfig: Partial<MxpEventQueueConfig>): void {
        this.config = { ...this.config, ...newConfig };
    }

    /**
     * Clear all queues (useful for testing or shutdown)
     */
    public clearQueues(): void {
        for (const queue of this.enhancedQueues.values()) {
            queue.length = 0;
        }
    }

    /**
     * Check if MXP enhancement is enabled
     */
    public isMxpEnabled(): boolean {
        return this.config.mxpEnabled;
    }
}

// Note: Use MxpEventForwardingEnhancer.getInstance() to get the singleton instance
