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
 * Task DAG Configuration
 *
 * Centralized configuration for the Task DAG system.
 * This configuration controls:
 * - DAG enforcement behavior
 * - Cycle detection timeouts
 * - Validation thresholds
 * - Event emission
 *
 * Feature flag: TASK_DAG_ENABLED (default: false)
 */

import { DagConfig, DEFAULT_DAG_CONFIG, DAG_ENV_VARS } from '../types/DagTypes';
import { Logger } from '../utils/Logger';

const logger = new Logger('info', 'DagConfig', 'server');

/**
 * Singleton configuration instance
 */
let configInstance: DagConfig | null = null;

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
    const parsed = parseInt(value, 10);
    return isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Load configuration from environment variables
 */
function loadConfigFromEnv(): Partial<DagConfig> {
    return {
        enabled: parseBoolean(process.env[DAG_ENV_VARS.ENABLED], DEFAULT_DAG_CONFIG.enabled),
        cacheTtlMs: parseNumber(process.env[DAG_ENV_VARS.CACHE_TTL_MS], DEFAULT_DAG_CONFIG.cacheTtlMs),
        cycleCheckTimeoutMs: parseNumber(
            process.env[DAG_ENV_VARS.CYCLE_CHECK_TIMEOUT_MS],
            DEFAULT_DAG_CONFIG.cycleCheckTimeoutMs
        ),
        enforceOnStatusChange: parseBoolean(
            process.env[DAG_ENV_VARS.ENFORCE_ON_STATUS_CHANGE],
            DEFAULT_DAG_CONFIG.enforceOnStatusChange
        ),
        maxInDegreeWarning: parseNumber(
            process.env[DAG_ENV_VARS.MAX_IN_DEGREE_WARNING],
            DEFAULT_DAG_CONFIG.maxInDegreeWarning
        ),
        maxOutDegreeWarning: parseNumber(
            process.env[DAG_ENV_VARS.MAX_OUT_DEGREE_WARNING],
            DEFAULT_DAG_CONFIG.maxOutDegreeWarning
        ),
        maxChainLengthWarning: parseNumber(
            process.env[DAG_ENV_VARS.MAX_CHAIN_LENGTH_WARNING],
            DEFAULT_DAG_CONFIG.maxChainLengthWarning
        ),
        emitEvents: parseBoolean(process.env[DAG_ENV_VARS.EMIT_EVENTS], DEFAULT_DAG_CONFIG.emitEvents),
        debug: parseBoolean(process.env[DAG_ENV_VARS.DEBUG], DEFAULT_DAG_CONFIG.debug),
        maxReadyTasksLimit: parseNumber(
            process.env[DAG_ENV_VARS.MAX_READY_TASKS_LIMIT],
            DEFAULT_DAG_CONFIG.maxReadyTasksLimit
        ),
        defaultReadyTasksLimit: parseNumber(
            process.env[DAG_ENV_VARS.DEFAULT_READY_TASKS_LIMIT],
            DEFAULT_DAG_CONFIG.defaultReadyTasksLimit
        ),
    };
}

/**
 * Get the DAG configuration
 *
 * Configuration is loaded from:
 * 1. Default values (see DagTypes.ts)
 * 2. Environment variable overrides
 *
 * @returns The complete DAG configuration
 */
export function getDagConfig(): DagConfig {
    if (configInstance) {
        return configInstance;
    }

    // Start with defaults
    const config: DagConfig = {
        ...DEFAULT_DAG_CONFIG,
    };

    // Apply environment variable overrides
    const envConfig = loadConfigFromEnv();
    Object.assign(config, envConfig);

    // Log configuration if debug enabled
    if (config.debug) {
        logger.info('Task DAG Configuration:', JSON.stringify(config, null, 2));
    }

    // Log enabled status
    if (config.enabled) {
        logger.info('Task DAG system is ENABLED');
    } else {
        logger.debug('Task DAG system is disabled (opt-in via TASK_DAG_ENABLED=true)');
    }

    configInstance = config;
    return config;
}

/**
 * Check if the DAG system is enabled
 *
 * @returns true if the DAG system is enabled
 */
export function isDagEnabled(): boolean {
    return getDagConfig().enabled;
}

/**
 * Check if DAG enforcement on status change is enabled
 *
 * @returns true if enforcement is enabled
 */
export function isDagEnforcementEnabled(): boolean {
    const config = getDagConfig();
    return config.enabled && config.enforceOnStatusChange;
}

/**
 * Get the cycle check timeout
 *
 * @returns The timeout in milliseconds
 */
export function getCycleCheckTimeout(): number {
    return getDagConfig().cycleCheckTimeoutMs;
}

/**
 * Get the cache TTL
 *
 * @returns The TTL in milliseconds
 */
export function getDagCacheTtl(): number {
    return getDagConfig().cacheTtlMs;
}

/**
 * Check if DAG events should be emitted
 *
 * @returns true if events should be emitted
 */
export function shouldEmitDagEvents(): boolean {
    const config = getDagConfig();
    return config.enabled && config.emitEvents;
}

/**
 * Reset the configuration (useful for testing)
 */
export function resetDagConfig(): void {
    configInstance = null;
}

/**
 * Update the configuration at runtime (useful for testing or dynamic updates)
 *
 * @param updates - Partial configuration updates to apply
 */
export function updateDagConfig(updates: Partial<DagConfig>): void {
    const current = getDagConfig();
    configInstance = {
        ...current,
        ...updates,
    };

    logger.info('Task DAG configuration updated');
}
