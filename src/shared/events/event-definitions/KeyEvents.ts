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
 * Key Events
 * 
 * This module defines all key-related events used in the framework.
 * Covers channel key generation, rotation, and management operations.
 */

import { ChannelId, AgentId } from '../../types/ChannelContext';

/**
 * Events related to channel keys
 */
export const Events = {
    // Key generation
    GENERATE: 'key:generate', // Generate a new channel key
    GENERATED: 'key:generated', // Channel key has been generated
    GENERATION_FAILED: 'key:generation:failed', // Key generation failed
    
    // Key validation
    VALIDATE: 'key:validate', // Validate a channel key
    VALIDATED: 'key:validated', // Key validated successfully
    VALIDATION_FAILED: 'key:validation:failed', // Key validation failed
    
    // Key rotation
    ROTATE: 'key:rotate', // Rotate a channel key
    ROTATED: 'key:rotated', // Key has been rotated
    ROTATION_FAILED: 'key:rotation:failed', // Key rotation failed
    
    // Key deactivation
    DEACTIVATE: 'key:deactivate', // Deactivate a channel key
    DEACTIVATED: 'key:deactivated', // Key has been deactivated
    DEACTIVATION_FAILED: 'key:deactivation:failed', // Key deactivation failed
    
    // Key listing
    LIST: 'key:list', // List keys for a channel
    LISTED: 'key:listed', // Keys listed successfully
    LIST_FAILED: 'key:list:failed' // Key listing failed
};

/**
 * Payload types for Key events
 */
export interface KeyPayloads {
    // Key generation
    'key:generate': { 
        channelId: string;
        agentId?: string;
        name?: string;
        expiresAt?: string; // ISO date string
    };
    'key:generated': { 
        keyId: string;
        secretKey: string;
        channelId: string;
        agentId?: string;
        expiresAt?: string;
    };
    'key:generation:failed': { 
        channelId: string;
        error: string;
    };
    
    // Key validation
    'key:validate': { 
        keyId: string;
        secretKey: string;
    };
    'key:validated': { 
        keyId: string;
        channelId: string;
        agentId?: string;
        valid: boolean;
    };
    'key:validation:failed': { 
        keyId: string;
        error: string;
    };
    
    // Key rotation
    'key:rotate': { 
        keyId: string;
        channelId: string;
    };
    'key:rotated': { 
        oldKeyId: string;
        newKeyId: string;
        newSecretKey: string;
        channelId: string;
    };
    'key:rotation:failed': { 
        keyId: string;
        channelId: string;
        error: string;
    };
    
    // Key deactivation
    'key:deactivate': { 
        keyId: string;
    };
    'key:deactivated': { 
        keyId: string;
        channelId: string;
    };
    'key:deactivation:failed': { 
        keyId: string;
        error: string;
    };
    
    // Key listing
    'key:list': { 
        channelId: string;
        activeOnly?: boolean;
    };
    'key:listed': { 
        channelId: string;
        keys: Array<{
            keyId: string;
            name?: string;
            isActive: boolean;
            expiresAt?: string;
            createdAt: string;
            lastUsed?: string;
        }>;
    };
    'key:list:failed': { 
        channelId: string;
        error: string;
    };
}

/**
 * Export key events
 */
export const KeyEvents = Events;
