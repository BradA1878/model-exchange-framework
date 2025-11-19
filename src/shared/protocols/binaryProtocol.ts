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

import * as crypto from 'crypto';
import * as zlib from 'zlib';
import { v4 as uuidv4 } from 'uuid';
import { createStrictValidator } from '../../shared/utils/validation';

/**
 * Message types supported by the protocol
 */
export enum MessageType {
    COMMAND = 0x01,
    QUERY = 0x02,
    RESPONSE = 0x03,
    ERROR = 0x04,
    HEARTBEAT = 0x05,
    AUDIT = 0x06
}

/**
 * Header structure for the model excahnge protocol (MXP)
 */
export interface MessageHeader {
    version: number;        // Protocol version
    messageType: number;    // Type of message (see MessageType enum)
    messageId: string;      // Unique message identifier
    timestamp: number;      // Message creation timestamp
    sourceAgent: string;    // ID of the sending agent
    targetAgent: string;    // ID of the receiving agent
    payloadLength: number;  // Length of the payload in bytes
    encrypted: boolean;     // Whether the payload is encrypted
    compressed: boolean;    // Whether the payload is compressed
    flags: number;          // Additional flags for future use
}

/**
 * Main Protocol class for binary message encoding/decoding
 */
export class Protocol {
    private static readonly HEADER_SIZE = 128; // Fixed size header for simplicity
    private static readonly PROTOCOL_VERSION = 1;
    private static readonly BINARY_SIGNATURE = 0x00; // Binary signature for validation
    
    /**
     * Create a new message with the specified parameters
     * @param messageType - Type of message from MessageType enum
     * @param sourceAgent - ID of the sending agent
     * @param targetAgent - ID of the receiving agent
     * @param payload - Message payload (object or Buffer)
     * @param options - Additional options for compression and encryption
     * @returns Binary buffer containing the complete message
     */
    public static createMessage(
        messageType: MessageType,
        sourceAgent: string,
        targetAgent: string,
        payload: Record<string, any> | Buffer,
        options: {
            compress?: boolean;
            encrypt?: boolean;
            encryptionKey?: Buffer;
            messageId?: string; // Add optional messageId parameter
        } = {}
    ): Buffer {
        // Add validation to ensure proper inputs
const validator = createStrictValidator('Protocol');
if (messageType === undefined || messageType === null) { throw new Error(`[Protocol] Message type is required`); }
if (!Object.values(MessageType).includes(messageType)) { throw new Error(`[Protocol] Invalid message type`); }
if (!validator.assertIsNonEmptyString(sourceAgent)) { throw new Error(`[Protocol] Source agent must be a non-empty string`); }
if (!validator.assertIsNonEmptyString(targetAgent)) { throw new Error(`[Protocol] Target agent must be a non-empty string`); }
if (payload === undefined || payload === null) { throw new Error(`[Protocol] Payload cannot be undefined`); }
        
        // Use provided messageId or generate a new one
        const messageId = options.messageId || uuidv4();
        const timestamp = Date.now();
        
        // Convert object payload to buffer if needed
        let payloadBuffer = Buffer.isBuffer(payload) 
            ? payload 
            : Buffer.from(JSON.stringify(payload));
            
        let isCompressed = false;
        let isEncrypted = false;
        
        // Apply compression if requested
        if (options.compress) {
            payloadBuffer = zlib.deflateSync(payloadBuffer);
            isCompressed = true;
        }
        
        // Apply encryption if requested and key provided
        if (options.encrypt && options.encryptionKey) {
            const iv = crypto.randomBytes(16);
            const cipher = crypto.createCipheriv('aes-256-cbc', options.encryptionKey, iv);
            
            // Prepend IV to encrypted data
            const encrypted = Buffer.concat([
                iv,
                cipher.update(payloadBuffer),
                cipher.final()
            ]);
            
            payloadBuffer = encrypted;
            isEncrypted = true;
        }
        
        // Create the header
        const header: MessageHeader = {
            version: Protocol.PROTOCOL_VERSION,
            messageType,
            messageId,
            timestamp,
            sourceAgent,
            targetAgent,
            payloadLength: payloadBuffer.length,
            encrypted: isEncrypted,
            compressed: isCompressed,
            flags: 0 // Reserved for future use
        };
        
        // Serialize the header to a buffer
        const headerBuffer = Protocol.encodeHeader(header);
        
        // Combine header and payload
        return Buffer.concat([headerBuffer, payloadBuffer]);
    }
    
    /**
     * Encode a message header to a binary buffer
     * @param header - Message header object
     * @returns Buffer containing the binary header
     */
    public static encodeHeader(header: MessageHeader): Buffer {
        const buffer = Buffer.alloc(Protocol.HEADER_SIZE);
        let offset = 0;
        
        // Write binary signature
        buffer.writeUInt8(Protocol.BINARY_SIGNATURE, offset);
        offset += 1;
        
        // Write fixed-size fields
        buffer.writeUInt8(header.version, offset);
        offset += 1;
        
        buffer.writeUInt8(header.messageType, offset);
        offset += 1;
        
        // Write the message ID (36 bytes for UUID)
        buffer.write(header.messageId, offset, 36, 'utf8');
        offset += 36;
        
        // Write timestamp (8 bytes)
        buffer.writeBigUInt64BE(BigInt(header.timestamp), offset);
        offset += 8;
        
        // Write source agent ID (max 32 bytes)
        const sourceAgentBuf = Buffer.from(header.sourceAgent, 'utf8');
        buffer.writeUInt8(sourceAgentBuf.length, offset);
        offset += 1;
        sourceAgentBuf.copy(buffer, offset, 0, Math.min(sourceAgentBuf.length, 32));
        offset += 32;
        
        // Write target agent ID (max 32 bytes)
        const targetAgentBuf = Buffer.from(header.targetAgent, 'utf8');
        buffer.writeUInt8(targetAgentBuf.length, offset);
        offset += 1;
        targetAgentBuf.copy(buffer, offset, 0, Math.min(targetAgentBuf.length, 32));
        offset += 32;
        
        // Write payload length (4 bytes)
        buffer.writeUInt32BE(header.payloadLength, offset);
        offset += 4;
        
        // Write flags (1 byte)
        let flags = header.flags & 0x3F; // Use bits 0-5 for flags
        if (header.encrypted) {
            flags |= 0x40; // Set bit 6 for encryption
        }
        if (header.compressed) {
            flags |= 0x80; // Set bit 7 for compression
        }
        buffer.writeUInt8(flags, offset);
        
        return buffer;
    }
    
    /**
     * Decode a binary buffer to extract the message header
     * @param buffer - Binary buffer containing the message
     * @returns Decoded message header
     */
    public static decodeHeader(buffer: Buffer): MessageHeader {
        if (buffer.length < Protocol.HEADER_SIZE) {
            throw new Error('Buffer too small for header');
        }
        
        let offset = 0;
        
        // Read binary signature
        const signature = buffer.readUInt8(offset);
        if (signature !== Protocol.BINARY_SIGNATURE) {
            throw new Error('Invalid binary signature');
        }
        offset += 1;
        
        // Read fixed-size fields
        const version = buffer.readUInt8(offset);
        offset += 1;
        
        const messageType = buffer.readUInt8(offset);
        offset += 1;
        
        // Read message ID (36 bytes for UUID)
        const messageId = buffer.toString('utf8', offset, offset + 36);
        offset += 36;
        
        // Read timestamp (8 bytes)
        const timestamp = Number(buffer.readBigUInt64BE(offset));
        offset += 8;
        
        // Read source agent ID
        const sourceAgentLength = buffer.readUInt8(offset);
        offset += 1;
        const sourceAgent = buffer.toString('utf8', offset, offset + sourceAgentLength);
        offset += 32;
        
        // Read target agent ID
        const targetAgentLength = buffer.readUInt8(offset);
        offset += 1;
        const targetAgent = buffer.toString('utf8', offset, offset + targetAgentLength);
        offset += 32;
        
        // Read payload length
        const payloadLength = buffer.readUInt32BE(offset);
        offset += 4;
        
        // Read flags
        const flags = buffer.readUInt8(offset);
        const encrypted = (flags & 0x40) !== 0; // Check bit 6
        const compressed = (flags & 0x80) !== 0; // Check bit 7
        const flagsValue = flags & 0x3F; // Mask out bits 6-7
        
        return {
            version,
            messageType,
            messageId,
            timestamp,
            sourceAgent,
            targetAgent,
            payloadLength,
            encrypted,
            compressed,
            flags: flagsValue
        };
    }
    
    /**
     * Decode a complete message including header and payload
     * @param buffer - Binary buffer containing the full message
     * @param decryptionKey - Optional key for decryption if message is encrypted
     * @returns Object containing the decoded header and payload
     */
    public static decodeMessage(
        buffer: Buffer,
        decryptionKey?: Buffer
    ): { header: MessageHeader; payload: Buffer; decoded?: any } {
        const header = this.decodeHeader(buffer);
        
        // Extract the payload
        let payload = buffer.slice(Protocol.HEADER_SIZE);
        
        // Check payload length - be more lenient with validation
        // Some message formats may have slight length variations
        if (Math.abs(payload.length - header.payloadLength) > 10) {
            throw new Error(`Payload length mismatch: expected ${header.payloadLength}, got ${payload.length}`);
        }
        
        // Decrypt if necessary
        if (header.encrypted) {
            if (!decryptionKey) {
                throw new Error('Encrypted message but no decryption key provided');
            }
            
            const iv = payload.slice(0, 16);
            const encryptedData = payload.slice(16);
            
            const decipher = crypto.createDecipheriv('aes-256-cbc', decryptionKey, iv);
            
            // Prepend IV to encrypted data
            const encrypted = Buffer.concat([
                decipher.update(encryptedData),
                decipher.final()
            ]);
            
            payload = encrypted;
        }
        
        // Decompress if necessary
        if (header.compressed) {
            payload = zlib.inflateSync(payload);
        }
        
        // Try to parse JSON payload
        let decoded = undefined;
        try {
            decoded = JSON.parse(payload.toString('utf8'));
        } catch (e) {
            // Not JSON, leave decoded as undefined
        }
        
        return {
            header,
            payload,
            decoded
        };
    }
    
    /**
     * Extracts essential message information (messageId, source, target) without fully decoding
     * This is used to quickly get the message ID for delivery confirmations
     * @param buffer Binary buffer containing a protocol message
     * @returns Object with extracted message info or null if invalid
     */
    public static peekMessageInfo(buffer: Buffer): { messageId: string; source: string; target: string } | null {
        // Simple validation check
        if (!this.isBinaryMessage(buffer)) {
            return null;
        }
        
        try {
            // Get just the header, which contains the info we need
            const header = this.decodeHeader(buffer);
            
            return {
                messageId: header.messageId,
                source: header.sourceAgent,
                target: header.targetAgent
            };
        } catch (error) {
            // If any error occurs during extraction, return null
            return null;
        }
    }
    
    /**
     * Checks if a buffer is a valid binary message
     * @param buffer The buffer to check
     * @returns True if the buffer is a valid binary message
     */
    public static isBinaryMessage(buffer: any): boolean {
        // Quick validations
        if (!buffer) {
            return false;
        }
        
        if (!Buffer.isBuffer(buffer)) {
            return false;
        }
        
        // Buffer must be at least long enough to contain a complete header
        if (buffer.length < this.HEADER_SIZE) {
            return false;
        }
        
        try {
            // Check header validity
            const version = buffer.readUInt8(0); // First byte should be version
            
            // Read header to validate message structure
            const header = this.decodeHeader(buffer);
            
            // Validate that the total message length matches the header specification
            const expectedTotalLength = this.HEADER_SIZE + header.payloadLength;
            if (buffer.length < expectedTotalLength) {
                return false;
            }
            
            return true;
        } catch (error) {
            // If any buffer operations fail, it's not a valid message
            return false;
        }
    }
}
