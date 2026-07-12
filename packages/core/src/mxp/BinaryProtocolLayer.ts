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
 * MXP 2.0 Binary Protocol Layer
 * 
 * Provides intelligent message encoding and compression for bandwidth optimization.
 * Features automatic format selection, multiple compression algorithms, and 
 * configuration-aware processing.
 */

import { v4 as uuidv4 } from 'uuid';
import { Logger } from '../utils/Logger.js';
import { createStrictValidator } from '../utils/validation.js';
import { EventBus } from '../events/EventBus.js';
import { Events } from '../events/EventNames.js';
import { MxpConfigManager } from './MxpConfigManager.js';
import { createMxpBandwidthOptimizationEventPayload } from '../schemas/EventPayloadSchema.js';
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
        brotliThreshold: 10240   // Use Brotli for messages > 10KB
    };

    /** Counters for getCompressionStats(). Updated on every encode. */
    private readonly stats = {
        totalCompressions: 0,
        totalOriginalBytes: 0,
        totalCompressedBytes: 0,
        algorithmUsage: {
            none: 0,
            gzip: 0,
            brotli: 0,
            msgpack: 0
        } as Record<CompressionAlgorithm, number>
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

            // Record the measured result so getCompressionStats() reports reality
            this.stats.totalCompressions++;
            this.stats.totalOriginalBytes += originalSize;
            this.stats.totalCompressedBytes += result.compressedSize;
            this.stats.algorithmUsage[result.algorithm]++;

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

            return result;

        } catch (error) {
            const message_ = error instanceof Error ? error.message : String(error);
            this.logger.error('Message encoding failed', {
                error: message_,
                channelId,
                messageType: message.type
            });

            // No silent fallback to plain JSON: the caller asked for an encoded
            // message and must find out that it did not get one.
            throw new Error(`Binary protocol encoding failed for '${message.type}': ${message_}`);
        }
    }

    /**
     * Decode an encoded message back to its original form.
     *
     * @throws If the payload cannot be decoded. A corrupt message is an error,
     *         not an empty result.
     */
    public decodeMessage(compressedData: CompressionResult): MxpMessage {
        try {
            switch (compressedData.format) {
                case 'json': {
                    const jsonString = compressedData.data.toString('utf8');
                    return JSON.parse(jsonString) as MxpMessage;
                }

                case 'msgpack':
                    return msgpack.decode(compressedData.data) as MxpMessage;

                case 'msgpack-compressed': {
                    const decompressedMsgpack = zlib.brotliDecompressSync(compressedData.data);
                    return msgpack.decode(decompressedMsgpack) as MxpMessage;
                }

                default:
                    throw new Error(`Unknown encoding format: ${compressedData.format}`);
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.logger.error('Message decoding failed', {
                error: message,
                format: compressedData.format,
                algorithm: compressedData.algorithm
            });
            throw new Error(`Binary protocol decoding failed (${compressedData.format}): ${message}`);
        }
    }

    /**
     * Encode a group of messages as one or more batches.
     *
     * Batches that exceed maxBatchSize are split in half recursively until each
     * part fits, and EVERY part is returned. An earlier version encoded only the
     * first half and discarded the rest, silently losing messages.
     *
     * @returns One CompressionResult per batch, or null when bandwidth
     *          optimization is disabled or there is nothing to send.
     * @throws If a batch cannot be encoded, or a single message is too large to
     *         fit in maxBatchSize on its own.
     */
    public batchEncode(
        messages: MxpMessage[],
        channelId: string,
        agentId?: string,
        options: {
            maxBatchSize?: number;
            compressionLevel?: 'light' | 'standard' | 'aggressive';
        } = {}
    ): CompressionResult[] | null {
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

        // Create batch envelope
        const batchMessage: MxpMessage = {
            type: 'mxp_batch',
            payload: {
                version: '2.0',
                messageCount: messages.length,
                messages: messages
            },
            metadata: {
                batchId: `batch_${uuidv4()}`,
                timestamp: Date.now(),
                compressionLevel: options.compressionLevel || 'standard'
            }
        };

        // Check if batch exceeds size limit
        const batchBuffer = Buffer.from(JSON.stringify(batchMessage), 'utf8');

        if (batchBuffer.length <= maxBatchSize) {
            const encoded = this.encodeMessage(batchMessage, channelId, agentId);
            return encoded ? [encoded] : null;
        }

        if (messages.length === 1) {
            throw new Error(
                `Message '${messages[0].type}' is ${batchBuffer.length} bytes, which exceeds the ` +
                `maximum batch size of ${maxBatchSize} bytes and cannot be split further.`
            );
        }

        this.logger.warn(`Batch size ${batchBuffer.length} exceeds limit ${maxBatchSize}, splitting`);

        const midpoint = Math.floor(messages.length / 2);
        const firstHalf = this.batchEncode(messages.slice(0, midpoint), channelId, agentId, options);
        const secondHalf = this.batchEncode(messages.slice(midpoint), channelId, agentId, options);

        return [...(firstHalf ?? []), ...(secondHalf ?? [])];
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
     * Compression statistics measured from the encodes this instance performed.
     *
     * averageCompressionRatio is compressedBytes/originalBytes across all
     * encodes (1.0 = no reduction), and is 0 before anything has been encoded.
     */
    public getCompressionStats(): {
        totalCompressions: number;
        averageCompressionRatio: number;
        totalBandwidthSaved: number;
        algorithmUsage: Record<CompressionAlgorithm, number>;
    } {
        const { totalCompressions, totalOriginalBytes, totalCompressedBytes } = this.stats;

        return {
            totalCompressions,
            averageCompressionRatio: totalOriginalBytes > 0
                ? totalCompressedBytes / totalOriginalBytes
                : 0,
            totalBandwidthSaved: totalOriginalBytes - totalCompressedBytes,
            algorithmUsage: { ...this.stats.algorithmUsage }
        };
    }

    /**
     * Reset the compression counters (used by tests).
     */
    public resetCompressionStats(): void {
        this.stats.totalCompressions = 0;
        this.stats.totalOriginalBytes = 0;
        this.stats.totalCompressedBytes = 0;
        this.stats.algorithmUsage = { none: 0, gzip: 0, brotli: 0, msgpack: 0 };
    }
}

// Note: Use BinaryProtocolLayer.getInstance() to get the singleton instance
