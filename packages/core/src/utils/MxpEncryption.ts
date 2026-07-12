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
 * MXP Encryption Utilities
 *
 * Encryption/decryption using a shared key from environment variables.
 * Uses AES-256-GCM for authenticated encryption.
 *
 * ## Failure policy
 *
 * Encryption is a security boundary, so there is no degraded mode:
 *
 * - `encrypt()` / `decrypt()` return `null` ONLY to mean "encryption is not
 *   configured" (no MXP_ENCRYPTION_KEY). That is a deliberate, operator-chosen
 *   state, not a failure.
 * - Any actual crypto failure — bad key, bad IV, failed authentication tag,
 *   unsupported algorithm — THROWS.
 *
 * Earlier versions returned the plaintext payload when encryption threw
 * (`return encrypted || payload`), so a crypto fault silently put cleartext on
 * the wire while the caller believed it was encrypted.
 */

import * as crypto from 'crypto';
import { requireEnv } from './env.js';
import { EncryptedPayload, MxpPayload, MxpEncryptionAlgorithm } from '../schemas/MxpProtocolSchemas.js';
import { Logger } from './Logger.js';

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
            // Derive a 256-bit key from the passphrase using PBKDF2. Opting
            // into MXP encryption requires a unique salt — a hardcoded default
            // would let attackers precompute the key derivation.
            const salt = requireEnv(
                'MXP_ENCRYPTION_SALT',
                'MXP_ENCRYPTION_KEY is set, so a unique salt is required (generate one with `openssl rand -hex 16`).'
            );
            this.encryptionKey = crypto.pbkdf2Sync(keyPhrase, salt, 100000, 32, 'sha256');
            this.isEnabled = enableEncryption;
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
     * Encrypt an MXP payload.
     *
     * @returns The encrypted payload, or null if encryption is not configured.
     * @throws If encryption IS configured but the cipher fails. Never returns
     *         plaintext.
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
            const message = error instanceof Error ? error.message : String(error);
            logger.error(`Encryption failed: ${message}`);
            throw new Error(`MXP encryption failed: ${message}`);
        }
    }

    /**
     * Decrypt an encrypted payload.
     *
     * @throws If encryption is not configured, the algorithm is unsupported, or
     *         the ciphertext fails authentication.
     */
    public decrypt(encryptedPayload: EncryptedPayload): MxpPayload {
        if (!this.isEncryptionEnabled()) {
            throw new Error(
                'Cannot decrypt MXP payload: encryption is not configured. Set MXP_ENCRYPTION_KEY and MXP_ENCRYPTION_SALT.'
            );
        }

        if (encryptedPayload.algorithm !== MxpEncryptionAlgorithm.AES_256_GCM) {
            throw new Error(`Unsupported MXP encryption algorithm: ${encryptedPayload.algorithm}`);
        }

        try {
            // Decode from base64
            const encrypted = Buffer.from(encryptedPayload.data, 'base64');
            const iv = Buffer.from(encryptedPayload.iv, 'base64');
            const authTag = Buffer.from(encryptedPayload.authTag, 'base64');

            // Create decipher
            const decipher = crypto.createDecipheriv('aes-256-gcm', this.encryptionKey!, iv);
            decipher.setAuthTag(authTag);

            // Decrypt — final() throws if the authentication tag does not match
            const decrypted = Buffer.concat([
                decipher.update(encrypted),
                decipher.final()
            ]);

            // Parse the JSON payload
            return JSON.parse(decrypted.toString('utf8'));
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            logger.error(`Decryption failed: ${message}`);
            throw new Error(`MXP decryption failed: ${message}`);
        }
    }

    /**
     * Encrypt a full message payload.
     *
     * @returns The encrypted payload, or the original payload when encryption
     *          is not configured.
     * @throws If encryption is configured but fails.
     */
    public encryptMessage(payload: MxpPayload): MxpPayload | EncryptedPayload {
        if (!this.isEncryptionEnabled()) {
            return payload; // Encryption not configured — caller opted out
        }

        const encrypted = this.encrypt(payload);
        if (!encrypted) {
            // isEncryptionEnabled() was true, so encrypt() either returns a
            // payload or throws. Reaching here means the two disagree.
            throw new Error('MXP encryption is enabled but produced no payload');
        }

        return encrypted;
    }

    /**
     * Decrypt a message payload (with type checking).
     *
     * @throws If the payload is encrypted and decryption fails.
     */
    public decryptMessage(payload: MxpPayload | EncryptedPayload): MxpPayload {
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