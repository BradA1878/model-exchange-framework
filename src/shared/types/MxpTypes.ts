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
 * MXP Types and Interfaces
 * 
 * Defines core types for the Model Exchange Protocol optimization system.
 * Designed to integrate with existing MXF architecture and services.
 */

import { AgentId, ChannelId } from './ChannelContext';
import { ContentFormat } from '../schemas/MessageSchemas';

/**
 * Cross-environment CryptoKeyPair type (works in both Node.js and browser)
 */
export interface MxpCryptoKeyPair {
    publicKey: unknown;
    privateKey: unknown;
}

/**
 * MXP Version and Security Levels
 */
export const MXP_VERSION = '2.0' as const;

export enum SecurityLevel {
    STANDARD = 'standard',     // Current MXF security (server-decryptable)
    ENHANCED = 'enhanced',     // + audit logging, key escrow
    REGULATED = 'regulated',   // + GDPR/HIPAA features, data residency
    CLASSIFIED = 'classified'  // + government/military grade (E2E available)
}

/**
 * MXP Configuration Interface with Channel and Agent-level Granular Control
 */
export interface MxpConfig {
    version: typeof MXP_VERSION;
    
    // Configuration scope and inheritance
    scope: {
        channelId?: string;           // Apply to specific channel
        agentId?: string;             // Apply to specific agent  
        inheritFromChannel: boolean;  // Agent inherits channel config
        overrideSettings: boolean;    // Allow local overrides
    };
    
    // Modular feature configuration
    modules: {
        tokenOptimization?: TokenOptimizationConfig;
        bandwidthOptimization?: BandwidthOptimizationConfig;
        security?: SecurityConfig;
        analytics?: AnalyticsConfig;
    };
    
    // Service integration toggles
    integration: {
        useExistingAggregator: boolean;     // Leverage MxfMessageAggregator
        useExistingPatternLearning: boolean; // Use PatternLearningService
        useExistingEventBus: boolean;       // Use EventBus priority queuing
        useExistingMemory: boolean;         // Use ChannelContextMemoryOperations
        useSystemLlmService: boolean;       // Use SystemLlmService for optimization
    };
}

/**
 * Token Optimization Configuration with Granular Feature Control
 */
export interface TokenOptimizationConfig {
    enabled: boolean;
    
    // Individual strategy toggles
    strategies: {
        contextCompression: boolean;
        promptOptimization: boolean;
        templateMatching: boolean;
        entityDeduplication: boolean;
        toolSchemaReduction: boolean;
        conversationSummarization: boolean;
    };
    
    // Optimization settings
    settings: {
        compressionLevel: 'light' | 'standard' | 'aggressive';
        systemLlmIntegration: boolean;
        patternLearningIntegration: boolean;
        contextWindow: {
            fullContextMessages: number;      // Keep last N messages uncompressed
            compressionRatio: number;         // Target compression (0.2 = 80% reduction)
            referenceMode: boolean;           // Use context references for old messages
        };
        templateEngine: {
            enabled: boolean;
            maxTemplates: number;
            confidenceThreshold: number;
        };
    };
}

/**
 * Token Optimization Strategies
 */
export type TokenOptimizationStrategy = 
    | 'context_compression'
    | 'prompt_optimization' 
    | 'template_matching'
    | 'entity_deduplication'
    | 'tool_schema_reduction'
    | 'conversation_summarization'
    | 'all';

/**
 * Bandwidth Optimization Configuration
 */
export interface BandwidthOptimizationConfig {
    enabled: boolean;
    encoding: ContentFormat;
    compression: 'none' | 'light' | 'standard' | 'aggressive';
    enhancedBatching: boolean;          // Enhance existing MxfMessageAggregator
    priorityQueueIntegration: boolean;  // Use EventBus priority system
    binaryProtocol: {
        enabled: boolean;
        thresholdBytes: number;         // Apply binary encoding for messages > N bytes
        compressionAlgorithm: 'brotli' | 'gzip' | 'zstd';
    };
    messageAggregation: {
        similarityThreshold: number;    // Leverage existing 0.8 threshold
        maxBatchSize: number;
        timeoutMs: number;              // Enhance existing 3-minute failsafe
    };
}

/**
 * Security Configuration
 */
export interface SecurityConfig {
    enabled: boolean;
    level: SecurityLevel;
    features: {
        auditLogging?: boolean;
        keyEscrow?: boolean;
        dataResidency?: string;
        endToEndEncryption?: boolean;  // Only for CLASSIFIED level
        complianceMode?: 'GDPR' | 'HIPAA' | 'SOX' | 'FedRAMP';
    };
    keyManagement: {
        rotationPolicy: 'time' | 'usage' | 'both';
        rotationInterval: number;
        keyLength: 256 | 384 | 521;
        algorithm: 'AES-GCM' | 'ChaCha20-Poly1305';
        enhanceExistingKeys: boolean;   // Build on ChannelKeyService
    };
}

/**
 * Analytics Configuration
 */
export interface AnalyticsConfig {
    enabled: boolean;
    realTimeMetrics: boolean;
    costCalculation: {
        enabled: boolean;
        providers: LlmProviderCosts;
        reportingInterval: 'hourly' | 'daily' | 'weekly' | 'monthly';
    };
    performanceTracking: {
        tokenReduction: boolean;
        bandwidthSavings: boolean;
        latencyImpact: boolean;
        errorRates: boolean;
    };
}

/**
 * LLM Provider Cost Configuration
 */
export interface LlmProviderCosts {
    [provider: string]: {
        input: number;  // Cost per 1K tokens
        output: number; // Cost per 1K tokens
    };
}

/**
 * MXP Optimization Result
 */
export interface MxpOptimizationResult {
    operationId: string;
    timestamp: number;
    agentId: AgentId;
    channelId: ChannelId;
    
    tokenOptimization?: {
        originalTokens: number;
        optimizedTokens: number;
        reductionPercentage: number;
        strategy: string;
    };
    
    bandwidthOptimization?: {
        originalSize: number;
        compressedSize: number;
        reductionPercentage: number;
        encoding: ContentFormat;
    };
    
    security?: {
        level: SecurityLevel;
        encryptionApplied: boolean;
        keyRotated: boolean;
    };
    
    performance: {
        processingTimeMs: number;
        memoryUsageMb: number;
        cpuUtilization: number;
    };
    
    costSavings?: {
        originalCost: number;
        optimizedCost: number;
        savingsAmount: number;
        savingsPercentage: number;
    };
}

/**
 * MXP Context Compression Result
 */
export interface ContextCompressionResult {
    originalContext: any;
    compressedContext: any;
    compressionRatio: number;
    contextReference?: string;
    preservedTokens: number;
    metadata: {
        strategy: string;
        systemLlmUsed: boolean;
        patternLearningApplied: boolean;
    };
}

/**
 * MXP Message Template
 */
export interface MessageTemplate {
    templateId: string;
    pattern: string;
    placeholders: string[];
    usage: {
        frequency: number;
        lastUsed: number;
        confidence: number;
    };
    tokenSavings: {
        originalLength: number;
        templateLength: number;
        averageSavings: number;
    };
}

/**
 * MXP Enhanced Key Pair (extends existing ChannelKey)
 */
export interface EnhancedKeyPair {
    keyId: string;
    secretKey: string;
    algorithm: string;
    serverDecryptable: boolean;
    securityLevel: SecurityLevel;
    
    // Progressive security features
    escrowCopy?: string;
    e2eKeyPair?: MxpCryptoKeyPair;
    functionalityImpact?: {
        messageAggregation: boolean;
        patternLearning: boolean;
        serverAnalytics: boolean;
        crossAgentInsights: boolean;
    };
    functionalityWarning?: string;
}

/**
 * Default MXP Configuration
 */
export const DEFAULT_MXP_CONFIG: MxpConfig = {
    version: MXP_VERSION,
    
    // Default scope - can be applied to any channel or agent
    scope: {
        inheritFromChannel: true,
        overrideSettings: true
    },
    
    modules: {
        tokenOptimization: {
            enabled: true,
            
            // Granular strategy control - enable key optimizations by default
            strategies: {
                contextCompression: true,
                promptOptimization: true,
                templateMatching: true,
                entityDeduplication: false,       // More experimental
                toolSchemaReduction: false,       // Requires careful testing
                conversationSummarization: true
            },
            
            // Optimization settings
            settings: {
                compressionLevel: 'standard',
                systemLlmIntegration: true,
                patternLearningIntegration: true,
                contextWindow: {
                    fullContextMessages: 5,
                    compressionRatio: 0.2,
                    referenceMode: true
                },
                templateEngine: {
                    enabled: true,
                    maxTemplates: 100,
                    confidenceThreshold: 0.8
                }
            }
        },
        bandwidthOptimization: {
            enabled: true,
            encoding: ContentFormat.JSON,
            compression: 'standard',
            enhancedBatching: true,
            priorityQueueIntegration: true,
            binaryProtocol: {
                enabled: true,
                thresholdBytes: 10240,  // 10KB
                compressionAlgorithm: 'brotli'
            },
            messageAggregation: {
                similarityThreshold: 0.8,  // Use existing MxfMessageAggregator threshold
                maxBatchSize: 64 * 1024,   // 64KB
                timeoutMs: 180000          // Use existing 3-minute failsafe
            }
        },
        security: {
            enabled: true,
            level: SecurityLevel.ENHANCED,
            features: {
                auditLogging: true,
                keyEscrow: true,
                complianceMode: 'GDPR'
            },
            keyManagement: {
                rotationPolicy: 'both',
                rotationInterval: 30 * 24 * 60 * 60 * 1000, // 30 days
                keyLength: 256,
                algorithm: 'AES-GCM',
                enhanceExistingKeys: true
            }
        },
        analytics: {
            enabled: true,
            realTimeMetrics: true,
            costCalculation: {
                enabled: true,
                providers: {
                    'gpt-4o': { input: 0.03, output: 0.06 },
                    'claude-3.5-sonnet': { input: 0.025, output: 0.075 },
                    'gemini-pro': { input: 0.02, output: 0.04 }
                },
                reportingInterval: 'daily'
            },
            performanceTracking: {
                tokenReduction: true,
                bandwidthSavings: true,
                latencyImpact: true,
                errorRates: true
            }
        }
    },
    integration: {
        useExistingAggregator: true,
        useExistingPatternLearning: true, 
        useExistingEventBus: true,
        useExistingMemory: true,
        useSystemLlmService: true
    }
};
