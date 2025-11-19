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
 * Key Authentication Helper
 * 
 * Provides utility functions for key-based authentication in both
 * production and testing environments.
 */

import { Logger } from '../../shared/utils/Logger';
import channelKeyService from '../socket/services/ChannelKeyService';

// Create a logger instance with appropriate context and tags
const logger = new Logger('debug', 'KeyAuthHelper', 'server');

// For testing: In-memory key storage
interface TestKeyData {
    keyId: string;
    secretKey: string;
    channelId: string;
    agentId: string;
    created: number;
    expires?: number;
}

/**
 * Key Authentication Helper
 * 
 * This utility provides key validation for both production and testing
 * environments, enabling seamless integration tests with proper key-based
 * authentication.
 */
class KeyAuthHelper {
    private static instance: KeyAuthHelper;
    // Store for test keys (in-memory only) - static to ensure singleton behavior
    private static testKeys = new Map<string, TestKeyData>();
    /**
     * Validate a channel authentication key
     * 
     * First checks test keys (for integration testing), then falls back
     * to normal key validation through the database.
     * 
     * @param keyId - Key identifier
     * @param secretKey - Secret key to validate
     * @returns Validation result with channel ID if valid
     */
    public async validateKey(
        keyId: string,
        secretKey: string
    ): Promise<{ valid: boolean; channelId?: string; agentId?: string }> {
        try {
            //;
            
            // First check if this key exists in our test key store (regardless of format)
            if (process.env.NODE_ENV !== 'production' && KeyAuthHelper.testKeys.has(keyId)) {
                
                const testKey = KeyAuthHelper.testKeys.get(keyId)!;
                
                // Check if it has expired
                if (testKey.expires && testKey.expires < Date.now()) {
                    logger.warn(`Test key expired: ${keyId}`);
                    return { valid: false };
                }
                
                // Check if secret key matches
                if (testKey.secretKey !== secretKey) {
                    logger.warn(`Invalid secret for test key: ${keyId}`);
                    return { valid: false };
                }
                
                return {
                    valid: true,
                    channelId: testKey.channelId,
                    agentId: testKey.agentId
                };
            }
            
            // If not found in test store, validate using normal channel key service
            //;
            const validation = await channelKeyService.validateKey(keyId, secretKey);
            return validation;
        } catch (error) {
            logger.error(`Error validating key: ${error instanceof Error ? error.message : String(error)}`);
            return { valid: false };
        }
    }
    
    /**
     * Register a test key for integration testing
     * 
     * @param keyData - Key data to register
     * @returns Success flag
     */
    public registerTestKey(keyData: TestKeyData): boolean {
        if (process.env.NODE_ENV === 'production') {
            logger.error('Cannot register test keys in production environment');
            return false;
        }
        
        try {
            KeyAuthHelper.testKeys.set(keyData.keyId, keyData);
            return true;
        } catch (error) {
            logger.error(`Error registering test key: ${error instanceof Error ? error.message : String(error)}`);
            return false;
        }
    }
    
    /**
     * Generate a new test key
     * 
     * @param agentId - Agent ID to create key for
     * @param channelId - Channel ID for authentication
     * @returns The created test key data
     */
    public async generateTestKey(agentId: string, channelId: string): Promise<TestKeyData> {
        const crypto = require('crypto');
        
        // Create key ID in the proper format
        const keyId = `key_${crypto.randomBytes(8).toString('hex')}`;
        const secretKey = crypto.randomBytes(32).toString('base64');
        
        const keyData: TestKeyData = {
            keyId,
            secretKey,
            channelId,
            agentId,
            created: Date.now()
        };
        
        // Register the key
        this.registerTestKey(keyData);
        
        return keyData;
    }

    /**
     * Get the singleton instance of KeyAuthHelper
     */
    public static getInstance(): KeyAuthHelper {
        if (!KeyAuthHelper.instance) {
            //;
            KeyAuthHelper.instance = new KeyAuthHelper();
        } else {
            //;
        }
        return KeyAuthHelper.instance;
    }

    /**
     * Private constructor to enforce singleton pattern
     */
    private constructor() {}
}

/**
 * Register a test key with the key auth helper
 * Convenience function for tests
 */
export const registerTestKey = (
    keyId: string,
    secretKey: string,
    channelId: string,
    agentId: string
): boolean => {
    return KeyAuthHelper.getInstance().registerTestKey({
        keyId,
        secretKey,
        channelId,
        agentId,
        created: Date.now()
    });
};

// Export the KeyAuthHelper class as the default export
export default KeyAuthHelper;
