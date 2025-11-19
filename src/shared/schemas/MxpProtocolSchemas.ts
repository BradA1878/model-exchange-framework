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
 * MXP (Model Exchange Protocol) Schemas
 * 
 * Defines the structure for efficient, encrypted agent-to-agent communication
 * within the MXF framework. MXP reduces bandwidth and token usage while
 * maintaining security through encryption.
 */

import { z } from 'zod';

/**
 * MXP Protocol Version
 */
export const MXP_VERSION = '2.0' as const;

/**
 * Supported MXP message types
 */
export enum MxpMessageType {
    OPERATION = 'operation',      // Structured operations (calculations, queries, etc.)
    REASONING = 'reasoning',      // Complex reasoning that still needs natural language
    COORDINATION = 'coordination', // Agent coordination messages
    TASK = 'task',               // Task assignments and updates
    RESPONSE = 'response'        // Responses to operations
}

/**
 * Encryption algorithms supported by MXP
 */
export enum MxpEncryptionAlgorithm {
    AES_256_GCM = 'aes-256-gcm',
    NONE = 'none' // For development/debugging only
}

/**
 * Common MXP operations
 */
export enum MxpOperation {
    // Calculation operations
    CALC_SUM = 'calc.sum',
    CALC_AVERAGE = 'calc.average',
    CALC_COMPARE = 'calc.compare',
    
    // Data operations
    DATA_FETCH = 'data.fetch',
    DATA_STORE = 'data.store',
    DATA_QUERY = 'data.query',
    
    // Tool operations
    TOOL_EXECUTE = 'tool.execute',
    TOOL_CHAIN = 'tool.chain',
    
    // Coordination operations
    COORD_SYNC = 'coord.sync',
    COORD_DELEGATE = 'coord.delegate',
    COORD_STATUS = 'coord.status',
    
    // LLM Token Optimization Operations
    // Collaboration operations
    COLLAB_INIT = 'collab.init',
    COLLAB_PROPOSE = 'collab.propose',
    COLLAB_ACCEPT = 'collab.accept',
    COLLAB_COUNTER = 'collab.counter',
    COLLAB_COMPLETE = 'collab.complete',
    
    // Task operations
    TASK_DELEGATE = 'task.delegate',
    TASK_PROGRESS = 'task.progress',
    TASK_COMPLETE = 'task.complete',
    TASK_REQUEST = 'task.request',
    
    // State management operations
    STATE_UPDATE = 'state.update',
    STATE_REFERENCE = 'state.reference',
    STATE_SYNC = 'state.sync',
    STATE_QUERY = 'state.query',
    
    // Decision operations
    DECISION_MADE = 'decision.made',
    DECISION_REQUEST = 'decision.request',
    
    // Custom operation
    CUSTOM = 'custom'
}

/**
 * MXP Payload Schema - The actual message content
 */
export const MxpPayloadSchema = z.object({
    op: z.string().describe('Operation identifier'),
    args: z.array(z.any()).optional().describe('Operation arguments'),
    context: z.any().optional().describe('Additional context data'),
    reasoning: z.string().optional().describe('Natural language reasoning for complex operations'),
    metadata: z.object({
        priority: z.number().min(0).max(10).default(5),
        ttl: z.number().optional().describe('Time to live in milliseconds'),
        correlationId: z.string().optional(),
        requestId: z.string().optional()
    }).optional()
});

export type MxpPayload = z.infer<typeof MxpPayloadSchema>;

/**
 * Encrypted payload wrapper
 */
export const EncryptedPayloadSchema = z.object({
    algorithm: z.nativeEnum(MxpEncryptionAlgorithm),
    data: z.string().describe('Base64 encoded encrypted data'),
    iv: z.string().describe('Initialization vector'),
    authTag: z.string().describe('Authentication tag'),
    keyId: z.string().optional().describe('Key identifier for key rotation')
});

export type EncryptedPayload = z.infer<typeof EncryptedPayloadSchema>;

/**
 * Main MXP Message Schema
 */
export const MxpMessageSchema = z.object({
    version: z.literal(MXP_VERSION),
    type: z.nativeEnum(MxpMessageType),
    encrypted: z.boolean(),
    payload: z.union([MxpPayloadSchema, EncryptedPayloadSchema]),
    
    // Message metadata
    messageId: z.string(),
    timestamp: z.number(),
    senderId: z.string(),
    receiverId: z.string().optional(),
    channelId: z.string().optional(),
    
    // Protocol negotiation
    capabilities: z.array(z.string()).optional().describe('Supported MXP capabilities'),
    fallbackFormat: z.enum(['natural-language', 'json']).optional()
});

export type MxpMessage = z.infer<typeof MxpMessageSchema>;

/**
 * MXP Capability flags for protocol negotiation
 */
export enum MxpCapability {
    ENCRYPTION = 'encryption',
    COMPRESSION = 'compression',
    BATCH_OPERATIONS = 'batch-ops',
    CUSTOM_OPERATIONS = 'custom-ops',
    NATURAL_LANGUAGE_FALLBACK = 'nl-fallback'
}

/**
 * Helper to create an MXP message
 */
export function createMxpMessage(
    type: MxpMessageType,
    senderId: string,
    payload: MxpPayload | EncryptedPayload,
    options: {
        receiverId?: string;
        channelId?: string;
        encrypted?: boolean;
        messageId?: string;
        capabilities?: MxpCapability[];
    } = {}
): MxpMessage {
    return {
        version: MXP_VERSION,
        type,
        encrypted: options.encrypted ?? false,
        payload,
        messageId: options.messageId ?? generateMessageId(),
        timestamp: Date.now(),
        senderId,
        receiverId: options.receiverId,
        channelId: options.channelId,
        capabilities: options.capabilities?.map(c => c.toString()),
        fallbackFormat: 'natural-language'
    };
}

/**
 * Type guard to check if a message is MXP format
 */
export function isMxpMessage(message: any): message is MxpMessage {
    try {
        if (typeof message === 'string') {
            // Try to parse if it's a JSON string
            const parsed = JSON.parse(message);
            return parsed.version === MXP_VERSION;
        }
        return message?.version === MXP_VERSION;
    } catch {
        return false;
    }
}

/**
 * Type guard to check if payload is encrypted
 */
export function isEncryptedPayload(payload: any): payload is EncryptedPayload {
    return payload?.algorithm && payload?.data && payload?.iv;
}

/**
 * Convert natural language to MXP operation (basic example)
 */
export function detectOperation(naturalLanguage: string): { op: string; confidence: number } | null {
    const text = naturalLanguage.toLowerCase();
    
    // Pattern matching for LLM token optimization - detects collaboration patterns
    const patterns = [
        // Calculation operations
        { pattern: /\b(sum|add|total)\b.*\b(of|up)\b/i, op: MxpOperation.CALC_SUM, confidence: 0.8 },
        { pattern: /\b(average|mean)\b.*\b(of)\b/i, op: MxpOperation.CALC_AVERAGE, confidence: 0.8 },
        { pattern: /\b(compare|versus|vs)\b/i, op: MxpOperation.CALC_COMPARE, confidence: 0.7 },
        
        // Data operations
        { pattern: /\b(fetch|get|retrieve)\b.*\b(data|information)\b/i, op: MxpOperation.DATA_FETCH, confidence: 0.7 },
        { pattern: /\b(store|save|persist)\b/i, op: MxpOperation.DATA_STORE, confidence: 0.7 },
        
        // Tool operations - High token savings
        { pattern: /\b(use|execute|run)\b.*\btool\b/i, op: MxpOperation.TOOL_EXECUTE, confidence: 0.8 },
        { pattern: /\b(call|invoke)\b.*\b(function|method)\b/i, op: MxpOperation.TOOL_EXECUTE, confidence: 0.7 },
        
        // Collaboration operations - Major token reduction potential
        { pattern: /\b(let's|let us)\b.*\b(work together|collaborate)\b/i, op: MxpOperation.COLLAB_INIT, confidence: 0.8 },
        { pattern: /\b(propose|suggest|recommend)\b.*\b(we|us)\b/i, op: MxpOperation.COLLAB_PROPOSE, confidence: 0.8 },
        { pattern: /\b(accept|agree|sounds good)\b/i, op: MxpOperation.COLLAB_ACCEPT, confidence: 0.7 },
        { pattern: /\b(how about|what if|instead)\b/i, op: MxpOperation.COLLAB_COUNTER, confidence: 0.7 },
        { pattern: /\b(done|finished|completed)\b.*\b(collaboration|working together)\b/i, op: MxpOperation.COLLAB_COMPLETE, confidence: 0.8 },
        
        // Task operations - Significant token savings in delegation
        { pattern: /\b(delegate|assign|hand off)\b.*\b(task|work)\b/i, op: MxpOperation.TASK_DELEGATE, confidence: 0.8 },
        { pattern: /\b(progress|update|status)\b.*\b(on|of)\b.*\b(task|work)\b/i, op: MxpOperation.TASK_PROGRESS, confidence: 0.8 },
        { pattern: /\b(task|work|assignment)\b.*\b(complete|done|finished)\b/i, op: MxpOperation.TASK_COMPLETE, confidence: 0.8 },
        { pattern: /\b(need|require|request)\b.*\b(help|assistance|support)\b/i, op: MxpOperation.TASK_REQUEST, confidence: 0.7 },
        
        // State management - Huge token savings by referencing vs retransmitting
        { pattern: /\b(based on|referring to|as discussed)\b.*\b(earlier|before|previously)\b/i, op: MxpOperation.STATE_REFERENCE, confidence: 0.8 },
        { pattern: /\b(update|modify|change)\b.*\b(state|status|information)\b/i, op: MxpOperation.STATE_UPDATE, confidence: 0.7 },
        { pattern: /\b(sync|synchronize|align)\b.*\b(state|status)\b/i, op: MxpOperation.STATE_SYNC, confidence: 0.8 },
        
        // Decision operations
        { pattern: /\b(decided|determined|concluded)\b/i, op: MxpOperation.DECISION_MADE, confidence: 0.7 },
        { pattern: /\b(need to decide|should we|what do you think)\b/i, op: MxpOperation.DECISION_REQUEST, confidence: 0.8 },
        
        // Coordination operations
        { pattern: /\b(coordinate|sync|align)\b/i, op: MxpOperation.COORD_SYNC, confidence: 0.6 }
    ];
    
    for (const { pattern, op, confidence } of patterns) {
        if (pattern.test(text)) {
            return { op, confidence };
        }
    }
    
    return null;
}

/**
 * Generate a unique message ID
 */
function generateMessageId(): string {
    return `mxp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Example MXP message creators for common operations
 */
export const MxpMessageCreators = {
    /**
     * Create a calculation operation message
     */
    calculation(
        senderId: string,
        operation: 'sum' | 'average' | 'compare',
        args: any[],
        options?: { receiverId?: string; channelId?: string }
    ): MxpMessage {
        const opMap = {
            sum: MxpOperation.CALC_SUM,
            average: MxpOperation.CALC_AVERAGE,
            compare: MxpOperation.CALC_COMPARE
        };
        
        return createMxpMessage(
            MxpMessageType.OPERATION,
            senderId,
            {
                op: opMap[operation],
                args,
                metadata: { priority: 5 }
            },
            options
        );
    },
    
    /**
     * Create a tool execution message
     */
    toolExecute(
        senderId: string,
        toolName: string,
        toolArgs: any,
        options?: { receiverId?: string; channelId?: string; reasoning?: string }
    ): MxpMessage {
        return createMxpMessage(
            MxpMessageType.OPERATION,
            senderId,
            {
                op: MxpOperation.TOOL_EXECUTE,
                args: [{ tool: toolName, input: toolArgs }],
                reasoning: options?.reasoning,
                metadata: { priority: 7 }
            },
            options
        );
    },
    
    /**
     * Create a coordination sync message
     */
    coordinationSync(
        senderId: string,
        channelId: string,
        status: any,
        context?: any
    ): MxpMessage {
        return createMxpMessage(
            MxpMessageType.COORDINATION,
            senderId,
            {
                op: MxpOperation.COORD_SYNC,
                args: [status],
                context,
                metadata: { priority: 8 }
            },
            { channelId }
        );
    }
};