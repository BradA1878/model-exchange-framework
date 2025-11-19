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
 * MXP Encryption Utilities
 * 
 * Simple encryption/decryption using a shared key from environment variables.
 * Uses AES-256-GCM for authenticated encryption.
 */

import * as crypto from 'crypto';
import { EncryptedPayload, MxpPayload, MxpEncryptionAlgorithm } from '../schemas/MxpProtocolSchemas';
import { Logger } from './Logger';

const logger = new Logger('info', 'MxpEncryption', 'server');

/**
 * MXP Encryption configuration
 */
export class MxpEncryption {
    private static instance: MxpEncryption;
    private encryptionKey: Buffer | null = null;
    private isEnabled: boolean = false;
    
    private constructor() {
        this.initializeFromEnv();
    }
    
    public static getInstance(): MxpEncryption {
        if (!MxpEncryption.instance) {
            MxpEncryption.instance = new MxpEncryption();
        }
        return MxpEncryption.instance;
    }
    
    /**
     * Initialize encryption from environment variables
     */
    private initializeFromEnv(): void {
        const keyPhrase = process.env.MXP_ENCRYPTION_KEY;
        const enableEncryption = process.env.MXP_ENCRYPTION_ENABLED !== 'false'; // Default to true
        
        if (keyPhrase) {
            // Derive a 256-bit key from the passphrase using PBKDF2
            const salt = process.env.MXP_ENCRYPTION_SALT || 'mxf-default-salt';
            this.encryptionKey = crypto.pbkdf2Sync(keyPhrase, salt, 100000, 32, 'sha256');
            this.isEnabled = enableEncryption;
            
            if (this.isEnabled) {
            } else {
            }
        } else {
            logger.warn('MXP_ENCRYPTION_KEY not set - encryption disabled');
            this.isEnabled = false;
        }
    }
    
    /**
     * Check if encryption is enabled
     */
    public isEncryptionEnabled(): boolean {
        return this.isEnabled && this.encryptionKey !== null;
    }
    
    /**
     * Encrypt an MXP payload
     */
    public encrypt(payload: MxpPayload): EncryptedPayload | null {
        if (!this.isEncryptionEnabled()) {
            return null;
        }
        
        try {
            // Generate a random IV for each encryption
            const iv = crypto.randomBytes(16);
            
            // Create cipher
            const cipher = crypto.createCipheriv('aes-256-gcm', this.encryptionKey!, iv);
            
            // Encrypt the payload
            const payloadString = JSON.stringify(payload);
            const encrypted = Buffer.concat([
                cipher.update(payloadString, 'utf8'),
                cipher.final()
            ]);
            
            // Get the authentication tag
            const authTag = cipher.getAuthTag();
            
            return {
                algorithm: MxpEncryptionAlgorithm.AES_256_GCM,
                data: encrypted.toString('base64'),
                iv: iv.toString('base64'),
                authTag: authTag.toString('base64')
            };
        } catch (error) {
            logger.error(`Encryption failed: ${error}`);
            return null;
        }
    }
    
    /**
     * Decrypt an encrypted payload
     */
    public decrypt(encryptedPayload: EncryptedPayload): MxpPayload | null {
        if (!this.isEncryptionEnabled()) {
            logger.error('Cannot decrypt - encryption not configured');
            return null;
        }
        
        if (encryptedPayload.algorithm !== MxpEncryptionAlgorithm.AES_256_GCM) {
            logger.error(`Unsupported encryption algorithm: ${encryptedPayload.algorithm}`);
            return null;
        }
        
        try {
            // Decode from base64
            const encrypted = Buffer.from(encryptedPayload.data, 'base64');
            const iv = Buffer.from(encryptedPayload.iv, 'base64');
            const authTag = Buffer.from(encryptedPayload.authTag, 'base64');
            
            // Create decipher
            const decipher = crypto.createDecipheriv('aes-256-gcm', this.encryptionKey!, iv);
            decipher.setAuthTag(authTag);
            
            // Decrypt
            const decrypted = Buffer.concat([
                decipher.update(encrypted),
                decipher.final()
            ]);
            
            // Parse the JSON payload
            return JSON.parse(decrypted.toString('utf8'));
        } catch (error) {
            logger.error(`Decryption failed: ${error}`);
            return null;
        }
    }
    
    /**
     * Encrypt a full message payload (for convenience)
     */
    public encryptMessage(payload: MxpPayload): MxpPayload | EncryptedPayload {
        if (!this.isEncryptionEnabled()) {
            return payload; // Return unencrypted if encryption is disabled
        }
        
        const encrypted = this.encrypt(payload);
        return encrypted || payload; // Fallback to unencrypted on error
    }
    
    /**
     * Decrypt a message payload (with type checking)
     */
    public decryptMessage(payload: MxpPayload | EncryptedPayload): MxpPayload | null {
        // Check if it's an encrypted payload
        if ('algorithm' in payload && 'data' in payload && 'iv' in payload) {
            return this.decrypt(payload as EncryptedPayload);
        }
        
        // It's already decrypted
        return payload as MxpPayload;
    }
    
    /**
     * Generate a secure random key (utility for initial setup)
     */
    public static generateSecureKey(): string {
        return crypto.randomBytes(32).toString('base64');
    }
}

/**
 * Singleton instance export
 */
export const mxpEncryption = MxpEncryption.getInstance();