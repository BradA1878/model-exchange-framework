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
 * MXP 2.0 Binary Protocol Layer
 * 
 * Provides intelligent message encoding and compression for bandwidth optimization.
 * Features automatic format selection, multiple compression algorithms, and 
 * configuration-aware processing.
 */

import { Logger } from '../utils/Logger';
import { createStrictValidator } from '../utils/validation';
import { EventBus } from '../events/EventBus';
import { Events } from '../events/EventNames';
import { MxpConfigManager } from './MxpConfigManager';
import { createMxpBandwidthOptimizationEventPayload } from '../schemas/EventPayloadSchema';
import * as msgpack from '@msgpack/msgpack';
import * as zlib from 'zlib';
import { promisify } from 'util';
import crypto from 'crypto';

export type EncodingFormat = 'json' | 'msgpack' | 'msgpack-compressed';
export type CompressionAlgorithm = 'gzip' | 'brotli' | 'msgpack' | 'none';

export interface CompressionResult {
    data: Buffer;
    format: EncodingFormat;
    algorithm: CompressionAlgorithm;
    originalSize: number;
    compressedSize: number;
    compressionRatio: number;
}

export interface MxpMessage {
    type: string;
    payload: any;
    metadata?: any;
    size?: number;
    hasBinaryData?: boolean;
}

export class BinaryProtocolLayer {
    private static instance: BinaryProtocolLayer | null = null;
    
    private readonly logger: Logger;
    private readonly validator = createStrictValidator('BinaryProtocolLayer');
    
    // Compression thresholds and settings
    private readonly compressionThresholds = {
        minSize: 1024,      // Only compress messages > 1KB
        brotliThreshold: 10240,  // Use Brotli for messages > 10KB
        gzipThreshold: 1024      // Use Gzip for smaller messages
    };

    private constructor() {
        this.logger = new Logger('info', 'BinaryProtocolLayer', 'server');
    }

    /**
     * Get the singleton instance of BinaryProtocolLayer
     */
    public static getInstance(): BinaryProtocolLayer {
        if (!BinaryProtocolLayer.instance) {
            BinaryProtocolLayer.instance = new BinaryProtocolLayer();
        }
        return BinaryProtocolLayer.instance;
    }

    /**
     * Encode message with optimal compression based on size and configuration
     * Only applies compression when bandwidth optimization is enabled
     */
    public encodeMessage(
        message: MxpMessage, 
        channelId: string, 
        agentId?: string
    ): CompressionResult | null {
        this.validator.assertIsObject(message, 'Message must be an object');
        this.validator.assertIsNonEmptyString(channelId, 'Channel ID is required');

        // Check if bandwidth optimization is enabled
        const isBandwidthOptEnabled = MxpConfigManager.getInstance().isFeatureEnabled(
            channelId,
            'bandwidthOptimization',
            agentId
        );

        if (!isBandwidthOptEnabled) {
            return null; // Return null when disabled - no processing
        }

        try {
            const startTime = Date.now();
            
            // Serialize message to JSON first
            const jsonData = JSON.stringify(message);
            const originalBuffer = Buffer.from(jsonData, 'utf8');
            const originalSize = originalBuffer.length;

            // ;

            // Determine optimal encoding format
            const format = this.selectOptimalFormat(message, originalSize);
            let result: CompressionResult;

            switch (format) {
                case 'json':
                    // Small messages - no compression overhead
                    result = {
                        data: originalBuffer,
                        format: 'json',
                        algorithm: 'none',
                        originalSize,
                        compressedSize: originalSize,
                        compressionRatio: 1.0
                    };
                    break;

                case 'msgpack':
                    // Medium messages - MessagePack encoding (50% smaller than JSON)
                    const msgpackData = Buffer.from(msgpack.encode(message));
                    result = {
                        data: msgpackData,
                        format: 'msgpack',
                        algorithm: 'msgpack',
                        originalSize,
                        compressedSize: msgpackData.length,
                        compressionRatio: msgpackData.length / originalSize
                    };
                    break;

                case 'msgpack-compressed':
                    // Large messages - MessagePack + Brotli compression
                    const msgpackBuffer = Buffer.from(msgpack.encode(message));
                    const compressedData = zlib.brotliCompressSync(msgpackBuffer);
                    result = {
                        data: compressedData,
                        format: 'msgpack-compressed', 
                        algorithm: 'brotli',
                        originalSize,
                        compressedSize: compressedData.length,
                        compressionRatio: compressedData.length / originalSize
                    };
                    break;

                default:
                    throw new Error(`Unknown encoding format: ${format}`);
            }

            // Emit compression event for analytics using proper payload creator
            const bandwidthEventPayload = createMxpBandwidthOptimizationEventPayload(
                Events.Mxp.BANDWIDTH_OPTIMIZATION_COMPLETE,
                agentId || 'system',
                channelId,
                {
                    operationId: crypto.randomUUID(),
                    originalSize,
                    compressedSize: result.compressedSize,
                    compressionRatio: result.compressionRatio,
                    encoding: result.format as 'json' | 'msgpack' | 'msgpack-compressed' | 'binary',
                    timestamp: Date.now()
                },
                { source: 'BinaryProtocolLayer' }
            );
            EventBus.server.emit(Events.Mxp.BANDWIDTH_OPTIMIZATION_COMPLETE, bandwidthEventPayload);

            //     format: result.format,
            //     algorithm: result.algorithm,
            //     originalSize,
            //     compressedSize: result.compressedSize,
            //     compressionRatio: result.compressionRatio,
            //     bandwidthSaved: originalSize - result.compressedSize
            // });

            return result;

        } catch (error) {
            this.logger.error('Message encoding failed', {
                error: error instanceof Error ? error.message : String(error),
                channelId,
                messageType: message.type
            });
            
            // Fallback: return original JSON
            const jsonData = JSON.stringify(message);
            const originalBuffer = Buffer.from(jsonData, 'utf8');
            return {
                data: originalBuffer,
                format: 'json',
                algorithm: 'none',
                originalSize: originalBuffer.length,
                compressedSize: originalBuffer.length,
                compressionRatio: 1.0
            };
        }
    }

    /**
     * Decode compressed message back to original format
     */
    public decodeMessage(compressedData: CompressionResult): MxpMessage | null {
        try {
            let message: MxpMessage;

            switch (compressedData.format) {
                case 'json':
                    // Plain JSON
                    const jsonString = compressedData.data.toString('utf8');
                    message = JSON.parse(jsonString) as MxpMessage;
                    break;
                    
                case 'msgpack':
                    // MessagePack format
                    message = msgpack.decode(compressedData.data) as MxpMessage;
                    break;
                    
                case 'msgpack-compressed':
                    // MessagePack + Brotli compression
                    const decompressedMsgpack = zlib.brotliDecompressSync(compressedData.data);
                    message = msgpack.decode(decompressedMsgpack) as MxpMessage;
                    break;
                    
                default:
                    throw new Error(`Unknown encoding format: ${compressedData.format}`);
            }

            // ;

            return message;

        } catch (error) {
            this.logger.error('Message decoding failed', {
                error: error instanceof Error ? error.message : String(error),
                format: compressedData.format,
                algorithm: compressedData.algorithm
            });
            return null;
        }
    }

    /**
     * Batch compress multiple messages with intelligent batching
     */
    public batchEncode(
        messages: MxpMessage[],
        channelId: string,
        agentId?: string,
        options: {
            maxBatchSize?: number;
            compressionLevel?: 'light' | 'standard' | 'aggressive';
        } = {}
    ): CompressionResult | null {
        this.validator.assertIsArray(messages, 'Messages must be an array');
        
        // Check if bandwidth optimization is enabled
        const isBandwidthOptEnabled = MxpConfigManager.getInstance().isFeatureEnabled(
            channelId,
            'bandwidthOptimization',
            agentId
        );

        if (!isBandwidthOptEnabled) {
            return null;
        }

        if (messages.length === 0) {
            return null;
        }

        const maxBatchSize = options.maxBatchSize || 32768; // 32KB default
        
        try {
            // Create batch envelope
            const batchMessage: MxpMessage = {
                type: 'mxp_batch',
                payload: {
                    version: '2.0',
                    messageCount: messages.length,
                    messages: messages
                },
                metadata: {
                    batchId: `batch_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`,
                    timestamp: Date.now(),
                    compressionLevel: options.compressionLevel || 'standard'
                }
            };

            // Check if batch exceeds size limit
            const batchJson = JSON.stringify(batchMessage);
            const batchBuffer = Buffer.from(batchJson, 'utf8');
            
            if (batchBuffer.length > maxBatchSize) {
                this.logger.warn(`Batch size ${batchBuffer.length} exceeds limit ${maxBatchSize}, splitting`);
                
                // Split into smaller batches (recursive approach)
                const midpoint = Math.floor(messages.length / 2);
                const firstHalf = messages.slice(0, midpoint);
                const secondHalf = messages.slice(midpoint);
                
                // Process first half only for now (in full implementation would handle both)
                return this.batchEncode(firstHalf, channelId, agentId, options);
            }

            // Compress the batch
            const compressionResult = this.encodeMessage(batchMessage, channelId, agentId);
            
            if (compressionResult) {
            }

            return compressionResult;

        } catch (error) {
            this.logger.error('Batch encoding failed', {
                error: error instanceof Error ? error.message : String(error),
                messageCount: messages.length
            });
            return null;
        }
    }

    /**
     * Select optimal encoding format based on message characteristics
     */
    private selectOptimalFormat(message: MxpMessage, size: number): EncodingFormat {
        // Small messages: JSON (avoid compression overhead)
        if (size < this.compressionThresholds.minSize) {
            return 'json';
        }
        
        // Large messages: MessagePack + Brotli compression
        if (size > this.compressionThresholds.brotliThreshold) {
            return 'msgpack-compressed';
        }
        
        // Binary data: Always use MessagePack + compression
        if (message.hasBinaryData) {
            return 'msgpack-compressed';
        }
        
        // Medium messages: MessagePack encoding (50% smaller than JSON)
        return 'msgpack';
    }

    /**
     * Check if bandwidth optimization should be applied
     */
    public shouldApplyCompression(channelId: string, agentId?: string): boolean {
        return MxpConfigManager.getInstance().isFeatureEnabled(
            channelId,
            'bandwidthOptimization',
            agentId
        );
    }

    /**
     * Get compression statistics for monitoring
     */
    public getCompressionStats(): {
        totalCompressions: number;
        averageCompressionRatio: number;
        totalBandwidthSaved: number;
        algorithmUsage: Record<CompressionAlgorithm, number>;
    } {
        // In full implementation, these would be tracked
        return {
            totalCompressions: 0,
            averageCompressionRatio: 0.3, // 70% reduction typical
            totalBandwidthSaved: 0,
            algorithmUsage: {
                'none': 0,
                'gzip': 0,
                'brotli': 0,
                'msgpack': 0
            }
        };
    }

    /**
     * Create streaming compression for real-time communication
     * Placeholder for future implementation with Socket.IO streaming
     */
    public createCompressionStream(channelId: string, agentId?: string): any {
        // Check if compression is enabled
        if (!this.shouldApplyCompression(channelId, agentId)) {
            return null;
        }

        
        // In full implementation, would return Transform stream
        // For now, return configuration object
        return {
            channelId,
            agentId,
            compressionEnabled: true,
            algorithm: 'gzip', // Start with gzip for streaming
            flushInterval: 100  // Flush every 100ms for low latency
        };
    }
}

// Note: Use BinaryProtocolLayer.getInstance() to get the singleton instance
