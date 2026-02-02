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
 * TensorFlow.js Configuration
 *
 * Centralized configuration for the TensorFlow.js integration layer.
 * Controls model management, training schedules, tensor memory monitoring,
 * and persistence backend.
 *
 * Feature flag: TENSORFLOW_ENABLED (default: false)
 */

import {
    TensorFlowConfig,
    DEFAULT_TENSORFLOW_CONFIG,
    TENSORFLOW_ENV_VARS,
    ModelStorageBackend,
} from '../types/TensorFlowTypes';
import { Logger } from '../utils/Logger';

const logger = new Logger('info', 'TensorFlowConfig', 'server');

/**
 * Singleton configuration instance
 */
let configInstance: TensorFlowConfig | null = null;

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
function loadConfigFromEnv(): Partial<TensorFlowConfig> {
    return {
        enabled: parseBoolean(
            process.env[TENSORFLOW_ENV_VARS.ENABLED],
            DEFAULT_TENSORFLOW_CONFIG.enabled
        ),
        storageBackend: (
            process.env[TENSORFLOW_ENV_VARS.STORAGE_BACKEND] as ModelStorageBackend
        ) || DEFAULT_TENSORFLOW_CONFIG.storageBackend,
        modelStoragePath:
            process.env[TENSORFLOW_ENV_VARS.MODEL_STORAGE_PATH] ||
            DEFAULT_TENSORFLOW_CONFIG.modelStoragePath,
        memoryLoggingIntervalMs: parseNumber(
            process.env[TENSORFLOW_ENV_VARS.MEMORY_LOGGING_INTERVAL_MS],
            DEFAULT_TENSORFLOW_CONFIG.memoryLoggingIntervalMs
        ),
        maxTensorMemoryBytes: parseNumber(
            process.env[TENSORFLOW_ENV_VARS.MAX_TENSOR_MEMORY_BYTES],
            DEFAULT_TENSORFLOW_CONFIG.maxTensorMemoryBytes
        ),
        debug: parseBoolean(
            process.env[TENSORFLOW_ENV_VARS.DEBUG],
            DEFAULT_TENSORFLOW_CONFIG.debug
        ),
        autoTrainEnabled: parseBoolean(
            process.env[TENSORFLOW_ENV_VARS.AUTO_TRAIN_ENABLED],
            DEFAULT_TENSORFLOW_CONFIG.autoTrainEnabled
        ),
        globalRetrainIntervalMs: parseNumber(
            process.env[TENSORFLOW_ENV_VARS.GLOBAL_RETRAIN_INTERVAL_MS],
            DEFAULT_TENSORFLOW_CONFIG.globalRetrainIntervalMs
        ),
    };
}

/**
 * Get the TensorFlow.js configuration
 *
 * Configuration is loaded from:
 * 1. Default values (see TensorFlowTypes.ts)
 * 2. Environment variable overrides
 *
 * @returns The complete TensorFlow.js configuration
 */
export function getTensorFlowConfig(): TensorFlowConfig {
    if (configInstance) {
        return configInstance;
    }

    // Start with defaults
    const config: TensorFlowConfig = {
        ...DEFAULT_TENSORFLOW_CONFIG,
    };

    // Apply environment variable overrides
    const envConfig = loadConfigFromEnv();
    Object.assign(config, envConfig);

    // Log configuration if debug enabled
    if (config.debug) {
        logger.info('TensorFlow.js Configuration:', JSON.stringify(config, null, 2));
    }

    // Log enabled status
    if (config.enabled) {
        logger.info('TensorFlow.js integration is ENABLED');
        logger.info(`  - Storage backend: ${config.storageBackend}`);
        if (config.storageBackend === ModelStorageBackend.FILESYSTEM) {
            logger.info(`  - Model storage path: ${config.modelStoragePath}`);
        }
        if (config.autoTrainEnabled) {
            logger.info(`  - Auto-training enabled (retrain interval: ${config.globalRetrainIntervalMs}ms)`);
        }
        logger.info(`  - Memory warning threshold: ${(config.maxTensorMemoryBytes / 1024 / 1024).toFixed(0)}MB`);
    } else {
        logger.debug('TensorFlow.js integration is disabled (opt-in via TENSORFLOW_ENABLED=true)');
    }

    configInstance = config;
    return config;
}

/**
 * Check if TensorFlow.js integration is enabled
 *
 * @returns true if TensorFlow.js is enabled via TENSORFLOW_ENABLED=true
 */
export function isTensorFlowEnabled(): boolean {
    return getTensorFlowConfig().enabled;
}

/**
 * Check if auto-training is enabled
 *
 * @returns true if both TF.js and auto-training are enabled
 */
export function isAutoTrainEnabled(): boolean {
    const config = getTensorFlowConfig();
    return config.enabled && config.autoTrainEnabled;
}

/**
 * Get the model storage path (for filesystem backend)
 *
 * @returns The filesystem path for model storage
 */
export function getModelStoragePath(): string {
    return getTensorFlowConfig().modelStoragePath;
}

/**
 * Get the storage backend type
 *
 * @returns The configured storage backend (MONGODB_GRIDFS or FILESYSTEM)
 */
export function getStorageBackend(): ModelStorageBackend {
    return getTensorFlowConfig().storageBackend;
}

/**
 * Reset the configuration (useful for testing)
 */
export function resetTensorFlowConfig(): void {
    configInstance = null;
}

/**
 * Update the configuration at runtime (useful for testing or dynamic updates)
 *
 * @param updates - Partial configuration updates to apply
 */
export function updateTensorFlowConfig(updates: Partial<TensorFlowConfig>): void {
    const current = getTensorFlowConfig();
    configInstance = {
        ...current,
        ...updates,
    };

    logger.info('TensorFlow.js configuration updated');
}
