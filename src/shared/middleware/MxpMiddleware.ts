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
 * MXP Protocol Middleware
 * 
 * Handles protocol detection, translation, and encryption/decryption
 * for seamless integration with existing MXF message flow.
 */

import { 
    MxpMessage, 
    MxpPayload, 
    isMxpMessage, 
    isEncryptedPayload,
    createMxpMessage,
    MxpMessageType,
    detectOperation,
    MxpOperation
} from '../schemas/MxpProtocolSchemas';
import { mxpEncryption } from '../utils/MxpEncryption';
import { ChannelMessage, AgentMessage } from '../schemas/MessageSchemas';
import { Logger } from '../utils/Logger';

const logger = new Logger('debug', 'MxpMiddleware', 'server');

/**
 * MXP Middleware for message transformation
 */
export class MxpMiddleware {
    /**
     * Process outgoing message - detect if it should be converted to MXP
     */
    public static async processOutgoing(
        message: ChannelMessage | AgentMessage | MxpMessage,
        senderId: string,
        options: {
            enableMxp?: boolean;
            forceEncryption?: boolean;
            preferredFormat?: 'mxp' | 'natural-language';
        } = {}
    ): Promise<ChannelMessage | AgentMessage | MxpMessage> {
        // If MXP is disabled, return original message
        if (options.enableMxp === false) {
            this.stats.naturalLanguageMessages++;
            return message;
        }
        
        // If already an MXP message, just handle encryption
        if (isMxpMessage(message)) {
            this.stats.mxpMessages++;
            return this.handleMxpEncryption(message as MxpMessage, options.forceEncryption);
        }
        
        // Try to convert natural language to MXP if preferred
        if (options.preferredFormat === 'mxp') {
            const converted = await this.convertToMxp(message, senderId);
            if (converted) {
                this.stats.messagesConverted++;
                this.stats.mxpMessages++;
                return this.handleMxpEncryption(converted, options.forceEncryption);
            } else {
                this.stats.conversionFailures++;
            }
        }
        
        // Return original message if no conversion
        this.stats.naturalLanguageMessages++;
        return message;
    }
    
    /**
     * Process incoming message - detect format and decrypt if needed
     */
    public static async processIncoming(
        message: any
    ): Promise<ChannelMessage | AgentMessage | MxpMessage> {
        // Check if it's an MXP message
        if (isMxpMessage(message)) {
            this.stats.mxpMessages++;
            const mxpMsg = message as MxpMessage;
            
            // Decrypt if needed
            if (mxpMsg.encrypted && isEncryptedPayload(mxpMsg.payload)) {
                const decrypted = mxpEncryption.decryptMessage(mxpMsg.payload);
                if (decrypted) {
                    this.stats.messagesDecrypted++;
                    return {
                        ...mxpMsg,
                        payload: decrypted,
                        encrypted: false
                    };
                } else {
                    logger.error('Failed to decrypt MXP message');
                    this.stats.encryptionFailures++;
                    throw new Error('Decryption failed');
                }
            }
            
            return mxpMsg;
        }
        
        // Return as-is if not MXP
        this.stats.naturalLanguageMessages++;
        return message;
    }
    
    /**
     * Convert natural language message to MXP format
     */
    private static async convertToMxp(
        message: ChannelMessage | AgentMessage,
        senderId: string
    ): Promise<MxpMessage | null> {
        try {
            // Extract content from message
            const content = message.content?.data;
            if (typeof content !== 'string') {
                return null; // Can't convert non-string content
            }
            
            // Try to detect operation from natural language
            const detection = detectOperation(content);
            if (!detection || detection.confidence < 0.6) {
                return null; // Not confident enough to convert
            }
            
            // Extract arguments based on operation type
            const args = this.extractOperationArgs(content, detection.op);
            
            // Create MXP message
            const mxpMessage = createMxpMessage(
                MxpMessageType.OPERATION,
                senderId,
                {
                    op: detection.op,
                    args,
                    reasoning: content, // Keep original for context
                    metadata: {
                        priority: 5,
                        correlationId: (message as any).metadata?.correlationId
                    }
                },
                {
                    receiverId: message.receiverId,
                    channelId: (message as any).context?.channelId
                }
            );
            
            return mxpMessage;
            
        } catch (error) {
            logger.error(`Failed to convert to MXP: ${error}`);
            return null;
        }
    }
    
    /**
     * Extract operation arguments from natural language
     */
    private static extractOperationArgs(content: string, operation: string): any[] {
        // This is a simplified example - in production, use NLP
        const args: any[] = [];
        
        switch (operation) {
            case MxpOperation.CALC_SUM:
            case MxpOperation.CALC_AVERAGE:
                // Extract numbers from text
                const numbers = content.match(/\d+(\.\d+)?/g);
                if (numbers) {
                    args.push(...numbers.map(n => parseFloat(n)));
                }
                break;
                
            case MxpOperation.DATA_FETCH:
                // Extract quoted strings as data identifiers
                const quotes = content.match(/"([^"]+)"|'([^']+)'/g);
                if (quotes) {
                    args.push(...quotes.map(q => q.slice(1, -1)));
                }
                break;
                
            default:
                // Generic extraction
                args.push({ raw: content });
        }
        
        return args;
    }
    
    /**
     * Handle encryption for MXP messages
     */
    private static handleMxpEncryption(
        message: MxpMessage,
        forceEncryption?: boolean
    ): MxpMessage {
        // Skip if already encrypted
        if (message.encrypted && isEncryptedPayload(message.payload)) {
            return message;
        }
        
        // Check if encryption should be applied
        const shouldEncrypt = forceEncryption || 
            (mxpEncryption.isEncryptionEnabled() && message.type !== MxpMessageType.REASONING);
        
        if (shouldEncrypt && !isEncryptedPayload(message.payload)) {
            const encrypted = mxpEncryption.encrypt(message.payload as MxpPayload);
            if (encrypted) {
                this.stats.messagesEncrypted++;
                return {
                    ...message,
                    encrypted: true,
                    payload: encrypted
                };
            } else {
                this.stats.encryptionFailures++;
            }
        }
        
        return message;
    }
    
    /**
     * Convert MXP message back to natural language (for display/logging)
     */
    public static mxpToNaturalLanguage(message: any): string {
        if (!isMxpMessage(message)) {
            return String(message);
        }
        
        // Handle new format (with operation and values at root level)
        // Cast to any to check for these properties since they're not in the strict type
        const messageAsAny = message as any;
        if (messageAsAny.operation && messageAsAny.values) {
            switch (messageAsAny.operation) {
                case 'calc.sum':
                case MxpOperation.CALC_SUM:
                    return `Calculate the sum of ${messageAsAny.values.join(', ')}`;
                case 'calc.average':
                case MxpOperation.CALC_AVERAGE:
                    return `Calculate the average of ${messageAsAny.values.join(', ')}`;
                default:
                    return `MXP operation: ${messageAsAny.operation} with values: ${JSON.stringify(messageAsAny.values)}`;
            }
        }
        
        // Handle standard format (with payload)
        const typedMessage = message as MxpMessage;
        const payload = typedMessage.payload as MxpPayload;
        if (payload) {
            // If there's reasoning, use it
            if (payload.reasoning) {
                return payload.reasoning;
            }
            
            // Otherwise, generate human-readable description
            switch (payload.op) {
                case MxpOperation.CALC_SUM:
                    return `Calculate the sum of ${payload.args?.join(', ')}`;
                case MxpOperation.CALC_AVERAGE:
                    return `Calculate the average of ${payload.args?.join(', ')}`;
                case MxpOperation.DATA_FETCH:
                    return `Fetch data: ${payload.args?.join(', ')}`;
                case MxpOperation.TOOL_EXECUTE:
                    const toolInfo = payload.args?.[0];
                    return `Execute tool ${toolInfo?.tool} with args: ${JSON.stringify(toolInfo?.input)}`;
                case MxpOperation.COORD_SYNC:
                    return `Synchronize coordination status: ${JSON.stringify(payload.args?.[0])}`;
                default:
                    return `MXP Operation: ${payload.op} with args: ${JSON.stringify(payload.args)}`;
            }
        }
        
        return `MXP message: ${JSON.stringify(message)}`;
    }
    
    /**
     * Check if a message should be converted to MXP
     */
    public static shouldConvertToMxp(content: string): boolean {
        // Don't convert complex reasoning or explanations
        if (content.length > 500) return false;
        
        // Check for operation patterns
        const detection = detectOperation(content);
        return detection !== null && detection.confidence >= 0.7;
    }
    
    /**
     * Get MXP statistics for monitoring
     */
    private static stats = {
        messagesConverted: 0,
        messagesEncrypted: 0,
        messagesDecrypted: 0,
        conversionFailures: 0,
        encryptionFailures: 0,
        naturalLanguageMessages: 0,
        mxpMessages: 0,
        startTime: Date.now()
    };
    
    public static getStats() {
        const uptime = Date.now() - this.stats.startTime;
        const totalMessages = this.stats.naturalLanguageMessages + this.stats.mxpMessages;
        
        return { 
            ...this.stats,
            uptime,
            totalMessages,
            mxpPercentage: totalMessages > 0 ? (this.stats.mxpMessages / totalMessages * 100).toFixed(2) + '%' : '0%',
            encryptionRate: this.stats.mxpMessages > 0 ? (this.stats.messagesEncrypted / this.stats.mxpMessages * 100).toFixed(2) + '%' : '0%'
        };
    }
    
    public static resetStats() {
        this.stats = {
            messagesConverted: 0,
            messagesEncrypted: 0,
            messagesDecrypted: 0,
            conversionFailures: 0,
            encryptionFailures: 0,
            naturalLanguageMessages: 0,
            mxpMessages: 0,
            startTime: Date.now()
        };
    }
}