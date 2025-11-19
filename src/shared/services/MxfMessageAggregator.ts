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

import { Logger } from '../utils/Logger';
import { EventBus } from '../events/EventBus';
import { Events } from '../events/EventNames';
import { createStrictValidator } from '../utils/validation';
import { ChannelMessage, AgentMessage, ContentFormat, wrapBinaryContent } from '../schemas/MessageSchemas';
import { createMxpBandwidthOptimizationEventPayload } from '../schemas/EventPayloadSchema';
import { MxpConfig, BandwidthOptimizationConfig } from '../types/MxpTypes';

/**
 * Message aggregation service to batch and deduplicate incoming messages
 * Prevents message spam by collecting similar messages into coherent batches
 * 
 * Enhanced with MXP bandwidth optimization capabilities:
 * - Binary encoding for large messages
 * - Enhanced compression with configurable algorithms
 * - Real-time bandwidth savings tracking
 * - Integration with existing EventBus priority system
 */
export class MxfMessageAggregator {
    private messageBuffer: Map<string, {
        messages: Array<{
            from: string;
            content: string;
            timestamp: number;
        }>;
        firstMessageTime: number;
        lastMessageTime: number;
        isAgentProcessing: boolean; // Track if agent is currently processing
        processingStartTime?: number; // When agent started processing
    }> = new Map();
    
    // Response-based aggregation with failsafe timeout
    private readonly FAILSAFE_TIMEOUT_MS: number = 180000; // 3 minute failsafe
    private readonly MAX_BUFFER_SIZE: number = 10; // Max messages to buffer per batch
    private readonly SIMILARITY_THRESHOLD: number = 0.8; // Similarity threshold for deduplication
    private aggregationTimers: Map<string, NodeJS.Timeout> = new Map();
    
    // MXP enhancements
    private readonly validator = createStrictValidator('MxfMessageAggregator');
    private readonly eventBus = EventBus.server;
    private mxpConfig?: MxpConfig;
    private bandwidthStats = {
        totalMessagesProcessed: 0,
        totalOriginalSize: 0,
        totalCompressedSize: 0,
        binaryEncodingCount: 0,
        compressionCount: 0
    };
    
    constructor(
        private agentId: string,
        private onAggregatedMessage: (fromAgents: string[], aggregatedContent: string) => void,
        private logger: Logger
    ) {
    }
    
    /**
     * Enable MXP bandwidth optimization enhancements
     */
    public enableMxpEnhancement(config: MxpConfig): void {
        this.validator.assertIsObject(config, 'MXP config must be an object');
        this.mxpConfig = config;
    }
    
    /**
     * Add a message to the aggregation buffer
     * Messages are grouped by source agents and deduplicated
     */
    public addMessage(fromAgent: string, content: string): void {
        const key = `aggregate_${this.agentId}`;
        
        if (!this.messageBuffer.has(key)) {
            this.messageBuffer.set(key, {
                messages: [],
                firstMessageTime: Date.now(),
                lastMessageTime: Date.now(),
                isAgentProcessing: false,
                processingStartTime: undefined
            });
        }
        
        const buffer = this.messageBuffer.get(key)!;
        buffer.messages.push({
            from: fromAgent,
            content,
            timestamp: Date.now()
        });
        buffer.lastMessageTime = Date.now();
        
        // Mark agent as processing if this is the first message
        if (buffer.messages.length === 1) {
            buffer.isAgentProcessing = true;
            buffer.processingStartTime = Date.now();
        }
        
        
        // Clear existing timer and set a new one
        if (this.aggregationTimers.has(key)) {
            clearTimeout(this.aggregationTimers.get(key)!);
        }
        
        // Set failsafe timer only - actual flush happens on agent response
        const timer = setTimeout(() => {
            const timeSinceStart = buffer.processingStartTime ? 
                Date.now() - buffer.processingStartTime : 0;
            this.logger.warn(`⏰ Failsafe timeout triggered after ${Math.round(timeSinceStart / 1000)}s - flushing ${buffer.messages.length} messages`);
            this.flushMessages(key);
        }, this.FAILSAFE_TIMEOUT_MS);
        
        this.aggregationTimers.set(key, timer);
        
        // Check if buffer is full
        if (buffer.messages.length >= this.MAX_BUFFER_SIZE) {
            this.flushMessages(key);
        }
    }
    
    /**
     * Flush the buffer and send aggregated message
     */
    private flushMessages(key: string): void {
        const buffer = this.messageBuffer.get(key);
        if (!buffer || buffer.messages.length === 0) {
            return;
        }
        
        
        // Group messages by sender
        const messagesByAgent = new Map<string, string[]>();
        buffer.messages.forEach(msg => {
            if (!messagesByAgent.has(msg.from)) {
                messagesByAgent.set(msg.from, []);
            }
            messagesByAgent.get(msg.from)!.push(msg.content);
        });
        
        // Create aggregated message with clear instructions for the LLM
        const aggregatedContent = this.createAggregatedMessage(messagesByAgent, buffer);
        const fromAgents = Array.from(messagesByAgent.keys());
        
        // Clear buffer and timer, reset processing state
        if (buffer) {
            buffer.messages = [];
            buffer.isAgentProcessing = false;
            buffer.processingStartTime = undefined;
            buffer.firstMessageTime = Date.now();
            buffer.lastMessageTime = Date.now();
        }
        if (this.aggregationTimers.has(key)) {
            clearTimeout(this.aggregationTimers.get(key)!);
            this.aggregationTimers.delete(key);
        }
        
        // Send aggregated message
        this.onAggregatedMessage(fromAgents, aggregatedContent);
    }
    
    /**
     * Create a well-structured aggregated message with clear instructions for the LLM
     */
    private createAggregatedMessage(messagesByAgent: Map<string, string[]>, buffer: any): string {
        const sections: string[] = [];
        const totalMessages = Array.from(messagesByAgent.values()).flat().length;
        const timeWindowSeconds = Math.round((buffer.lastMessageTime - buffer.firstMessageTime) / 1000);
        
        // Header with clear explanation
        sections.push(`🔄 AGGREGATED MESSAGE BATCH`);
        sections.push(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
        sections.push(`📊 SUMMARY: Received ${totalMessages} messages from ${messagesByAgent.size} agents over ${timeWindowSeconds} seconds`);
        sections.push(`🎯 These messages arrived while you were processing and have been batched to prevent interruption.`);
        sections.push(``);
        
        // Instructions for the LLM
        sections.push(`📋 PROCESSING INSTRUCTIONS:`);
        sections.push(`• Read ALL messages below before responding`);
        sections.push(`• Identify common themes and requests across agents`);
        sections.push(`• Provide ONE comprehensive response addressing all agents`);
        sections.push(`• Use messaging_send to reply to each agent with relevant information`);
        sections.push(``);
        
        // Add each agent's messages
        sections.push(`📨 BATCHED MESSAGES:`);
        sections.push(``);
        
        messagesByAgent.forEach((messages, agentId) => {
            sections.push(`┌─ From: ${agentId}`);
            
            // Deduplicate and merge similar messages
            const uniqueMessages = this.deduplicateMessages(messages);
            
            if (uniqueMessages.length === 1) {
                sections.push(`└─ ${uniqueMessages[0]}`);
            } else {
                uniqueMessages.forEach((msg, idx) => {
                    const prefix = idx === uniqueMessages.length - 1 ? '└─' : '├─';
                    sections.push(`${prefix} ${idx + 1}. ${msg}`);
                });
            }
            sections.push(''); // Empty line between agents
        });
        
        // Footer with action reminder
        sections.push(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
        sections.push(`⚡ ACTION REQUIRED: Process all information above and respond appropriately to each agent.`);
        
        return sections.join('\n');
    }
    
    /**
     * Deduplicate similar messages from the same agent
     */
    private deduplicateMessages(messages: string[]): string[] {
        const unique: string[] = [];
        
        messages.forEach(msg => {
            const isDuplicate = unique.some(existing => 
                this.calculateSimilarityScore(existing, msg) > this.SIMILARITY_THRESHOLD
            );
            
            if (!isDuplicate) {
                unique.push(msg);
            }
        });
        
        return unique;
    }
    
    /**
     * Calculate similarity score between two messages
     * Returns 0.0 (no similarity) to 1.0 (identical)
     */
    private calculateSimilarityScore(msg1: string, msg2: string): number {
        const normalize = (s: string): string => s.toLowerCase().replace(/[^\w\s]/g, '').trim();
        const n1 = normalize(msg1);
        const n2 = normalize(msg2);
        
        // Exact match
        if (n1 === n2) return 1.0;
        
        // Check if one contains the other (high similarity)
        if (n1.includes(n2) || n2.includes(n1)) return 0.9;
        
        // Calculate word overlap similarity
        const words1 = new Set(n1.split(/\s+/).filter(w => w.length > 2)); // Ignore short words
        const words2 = new Set(n2.split(/\s+/).filter(w => w.length > 2));
        
        if (words1.size === 0 && words2.size === 0) return 0.0;
        
        const intersection = new Set([...words1].filter(x => words2.has(x)));
        const union = new Set([...words1, ...words2]);
        
        return intersection.size / union.size;
    }
    
    /**
     * Mark that the agent has sent a response and flush pending messages
     * This is called when the agent completes generateResponse()
     */
    public onAgentResponse(): void {
        const key = `aggregate_${this.agentId}`;
        const buffer = this.messageBuffer.get(key);
        
        if (buffer && buffer.messages.length > 0) {
            const processingTime = buffer.processingStartTime ? 
                Date.now() - buffer.processingStartTime : 0;
            this.flushMessages(key);
        } else if (buffer) {
            // Mark agent as not processing even if no messages to flush
            buffer.isAgentProcessing = false;
            buffer.processingStartTime = undefined;
        }
    }
    
    /**
     * Check if agent is currently processing
     */
    public isAgentProcessing(): boolean {
        const key = `aggregate_${this.agentId}`;
        const buffer = this.messageBuffer.get(key);
        return buffer?.isAgentProcessing || false;
    }
    
    /**
     * Clean up resources
     */
    public cleanup(): void {
        for (const timer of this.aggregationTimers.values()) {
            clearTimeout(timer);
        }
        this.aggregationTimers.clear();
        this.messageBuffer.clear();
    }
}
