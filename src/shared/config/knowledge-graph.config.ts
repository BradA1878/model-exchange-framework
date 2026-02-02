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
 * Knowledge Graph Configuration
 *
 * Centralized configuration for the Knowledge Graph system.
 * Controls entity extraction, Q-value learning, surprise detection, and context retrieval.
 *
 * Feature flag: KNOWLEDGE_GRAPH_ENABLED (default: false)
 */

import {
    KnowledgeGraphConfig,
    DEFAULT_KNOWLEDGE_GRAPH_CONFIG,
    KNOWLEDGE_GRAPH_ENV_VARS,
} from '../types/KnowledgeGraphTypes';
import { Logger } from '../utils/Logger';

const logger = new Logger('info', 'KnowledgeGraphConfig', 'server');

/**
 * Singleton configuration instance
 */
let configInstance: KnowledgeGraphConfig | null = null;

/**
 * Parse boolean from environment variable
 */
function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
    if (value === undefined || value === '') {
        return defaultValue;
    }
    return value.toLowerCase() === 'true' || value === '1';
}

/**
 * Parse number from environment variable
 */
function parseNumber(value: string | undefined, defaultValue: number): number {
    if (value === undefined || value === '') {
        return defaultValue;
    }
    const parsed = parseFloat(value);
    return isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Load configuration from environment variables
 */
function loadConfigFromEnv(): Partial<KnowledgeGraphConfig> {
    return {
        enabled: parseBoolean(
            process.env[KNOWLEDGE_GRAPH_ENV_VARS.ENABLED],
            DEFAULT_KNOWLEDGE_GRAPH_CONFIG.enabled
        ),
        extractionEnabled: parseBoolean(
            process.env[KNOWLEDGE_GRAPH_ENV_VARS.EXTRACTION_ENABLED],
            DEFAULT_KNOWLEDGE_GRAPH_CONFIG.extractionEnabled
        ),
        extractionModel:
            process.env[KNOWLEDGE_GRAPH_ENV_VARS.EXTRACTION_MODEL] ||
            DEFAULT_KNOWLEDGE_GRAPH_CONFIG.extractionModel,
        minConfidence: parseNumber(
            process.env[KNOWLEDGE_GRAPH_ENV_VARS.MIN_CONFIDENCE],
            DEFAULT_KNOWLEDGE_GRAPH_CONFIG.minConfidence
        ),
        autoMergeThreshold: parseNumber(
            process.env[KNOWLEDGE_GRAPH_ENV_VARS.AUTO_MERGE_THRESHOLD],
            DEFAULT_KNOWLEDGE_GRAPH_CONFIG.autoMergeThreshold
        ),
        qValueEnabled: parseBoolean(
            process.env[KNOWLEDGE_GRAPH_ENV_VARS.QVALUE_ENABLED],
            DEFAULT_KNOWLEDGE_GRAPH_CONFIG.qValueEnabled
        ),
        qValueLearningRate: parseNumber(
            process.env[KNOWLEDGE_GRAPH_ENV_VARS.QVALUE_LEARNING_RATE],
            DEFAULT_KNOWLEDGE_GRAPH_CONFIG.qValueLearningRate
        ),
        surpriseEnabled: parseBoolean(
            process.env[KNOWLEDGE_GRAPH_ENV_VARS.SURPRISE_ENABLED],
            DEFAULT_KNOWLEDGE_GRAPH_CONFIG.surpriseEnabled
        ),
        surpriseThreshold: parseNumber(
            process.env[KNOWLEDGE_GRAPH_ENV_VARS.SURPRISE_THRESHOLD],
            DEFAULT_KNOWLEDGE_GRAPH_CONFIG.surpriseThreshold
        ),
        maxContextEntities: parseNumber(
            process.env[KNOWLEDGE_GRAPH_ENV_VARS.MAX_CONTEXT_ENTITIES],
            DEFAULT_KNOWLEDGE_GRAPH_CONFIG.maxContextEntities
        ),
        maxContextRelationships: parseNumber(
            process.env[KNOWLEDGE_GRAPH_ENV_VARS.MAX_CONTEXT_RELATIONSHIPS],
            DEFAULT_KNOWLEDGE_GRAPH_CONFIG.maxContextRelationships
        ),
        orparIntegrationEnabled: parseBoolean(
            process.env[KNOWLEDGE_GRAPH_ENV_VARS.ORPAR_INTEGRATION_ENABLED],
            DEFAULT_KNOWLEDGE_GRAPH_CONFIG.orparIntegrationEnabled
        ),
        debug: parseBoolean(
            process.env[KNOWLEDGE_GRAPH_ENV_VARS.DEBUG],
            DEFAULT_KNOWLEDGE_GRAPH_CONFIG.debug
        ),
    };
}

/**
 * Get the Knowledge Graph configuration
 *
 * Configuration is loaded from:
 * 1. Default values (see KnowledgeGraphTypes.ts)
 * 2. Environment variable overrides
 *
 * @returns The complete Knowledge Graph configuration
 */
export function getKnowledgeGraphConfig(): KnowledgeGraphConfig {
    if (configInstance) {
        return configInstance;
    }

    // Start with defaults
    const config: KnowledgeGraphConfig = {
        ...DEFAULT_KNOWLEDGE_GRAPH_CONFIG,
    };

    // Apply environment variable overrides
    const envConfig = loadConfigFromEnv();
    Object.assign(config, envConfig);

    // Log configuration if debug enabled
    if (config.debug) {
        logger.info('Knowledge Graph Configuration:', JSON.stringify(config, null, 2));
    }

    // Log enabled status
    if (config.enabled) {
        logger.info('Knowledge Graph system is ENABLED');
        if (config.extractionEnabled) {
            logger.info(`  - Entity extraction enabled (model: ${config.extractionModel})`);
        }
        if (config.qValueEnabled) {
            logger.info(`  - Q-value learning enabled (rate: ${config.qValueLearningRate})`);
        }
        if (config.surpriseEnabled) {
            logger.info(`  - Surprise detection enabled (threshold: ${config.surpriseThreshold})`);
        }
    } else {
        logger.debug('Knowledge Graph system is disabled (opt-in via KNOWLEDGE_GRAPH_ENABLED=true)');
    }

    configInstance = config;
    return config;
}

/**
 * Check if Knowledge Graph is enabled
 *
 * @returns true if the Knowledge Graph system is enabled
 */
export function isKnowledgeGraphEnabled(): boolean {
    return getKnowledgeGraphConfig().enabled;
}

/**
 * Check if entity extraction is enabled
 *
 * @returns true if extraction is enabled
 */
export function isExtractionEnabled(): boolean {
    const config = getKnowledgeGraphConfig();
    return config.enabled && config.extractionEnabled;
}

/**
 * Check if Q-value learning is enabled
 *
 * @returns true if Q-value learning is enabled
 */
export function isQValueLearningEnabled(): boolean {
    const config = getKnowledgeGraphConfig();
    return config.enabled && config.qValueEnabled;
}

/**
 * Check if surprise detection is enabled
 *
 * @returns true if surprise detection is enabled
 */
export function isSurpriseDetectionEnabled(): boolean {
    const config = getKnowledgeGraphConfig();
    return config.enabled && config.surpriseEnabled;
}

/**
 * Check if ORPAR integration is enabled
 *
 * @returns true if ORPAR integration is enabled
 */
export function isOrparIntegrationEnabled(): boolean {
    const config = getKnowledgeGraphConfig();
    return config.enabled && config.orparIntegrationEnabled;
}

/**
 * Get the extraction model
 *
 * @returns The model name for entity extraction
 */
export function getExtractionModel(): string {
    return getKnowledgeGraphConfig().extractionModel;
}

/**
 * Get the minimum confidence threshold
 *
 * @returns The minimum confidence for extracted entities
 */
export function getMinConfidence(): number {
    return getKnowledgeGraphConfig().minConfidence;
}

/**
 * Get the Q-value learning rate
 *
 * @returns The learning rate for Q-value updates
 */
export function getQValueLearningRate(): number {
    return getKnowledgeGraphConfig().qValueLearningRate;
}

/**
 * Get the surprise threshold
 *
 * @returns The threshold for high surprise alerts
 */
export function getSurpriseThreshold(): number {
    return getKnowledgeGraphConfig().surpriseThreshold;
}

/**
 * Get context limits
 *
 * @returns Object with maxContextEntities and maxContextRelationships
 */
export function getContextLimits(): { maxEntities: number; maxRelationships: number } {
    const config = getKnowledgeGraphConfig();
    return {
        maxEntities: config.maxContextEntities,
        maxRelationships: config.maxContextRelationships,
    };
}

/**
 * Reset the configuration (useful for testing)
 */
export function resetKnowledgeGraphConfig(): void {
    configInstance = null;
}

/**
 * Update the configuration at runtime (useful for testing or dynamic updates)
 *
 * @param updates - Partial configuration updates to apply
 */
export function updateKnowledgeGraphConfig(updates: Partial<KnowledgeGraphConfig>): void {
    const current = getKnowledgeGraphConfig();
    configInstance = {
        ...current,
        ...updates,
    };

    logger.info('Knowledge Graph configuration updated');
}
