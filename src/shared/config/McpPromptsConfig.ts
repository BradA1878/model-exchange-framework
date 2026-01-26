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
 * MCP Prompts Configuration
 *
 * Centralized configuration for MCP Prompts feature with environment variable
 * support and sensible defaults.
 */

import { MxfPromptsConfig } from '../types/McpPromptTypes';
import { Logger } from '../utils/Logger';

const logger = new Logger('info', 'McpPromptsConfig', 'server');

/**
 * Default configuration for MCP Prompts
 */
export const DEFAULT_PROMPTS_CONFIG: MxfPromptsConfig = {
    enabled: process.env.MCP_PROMPTS_ENABLED !== 'false',
    cache: {
        strategy: (process.env.MCP_PROMPTS_CACHE_STRATEGY as any) || 'memory',
        ttlSeconds: parseInt(process.env.MCP_PROMPTS_CACHE_TTL || '300', 10),
        maxEntries: parseInt(process.env.MCP_PROMPTS_CACHE_MAX_ENTRIES || '1000', 10)
    },
    discovery: {
        refreshIntervalSeconds: parseInt(process.env.MCP_PROMPTS_REFRESH_INTERVAL || '60', 10),
        timeoutMs: parseInt(process.env.MCP_PROMPTS_TIMEOUT || '5000', 10)
    },
    resolution: {
        maxEmbeddedResourceSize: parseInt(
            process.env.MCP_PROMPTS_MAX_RESOURCE_SIZE || String(1024 * 1024),
            10
        ),
        allowedResourceSchemes: process.env.MCP_PROMPTS_ALLOWED_SCHEMES
            ? process.env.MCP_PROMPTS_ALLOWED_SCHEMES.split(',')
            : ['resource://', 'file://']
    },
    mxpIntegration: {
        compressEmbeddedResources: process.env.MCP_PROMPTS_COMPRESS_RESOURCES !== 'false',
        trackTokenUsage: process.env.MCP_PROMPTS_TRACK_TOKENS !== 'false'
    }
};

/**
 * Load prompts configuration from environment or use defaults
 */
export function loadPromptsConfig(overrides?: Partial<MxfPromptsConfig>): MxfPromptsConfig {
    const config: MxfPromptsConfig = {
        ...DEFAULT_PROMPTS_CONFIG,
        ...overrides,
        cache: {
            ...DEFAULT_PROMPTS_CONFIG.cache,
            ...(overrides?.cache || {})
        },
        discovery: {
            ...DEFAULT_PROMPTS_CONFIG.discovery,
            ...(overrides?.discovery || {})
        },
        resolution: {
            ...DEFAULT_PROMPTS_CONFIG.resolution,
            ...(overrides?.resolution || {})
        },
        mxpIntegration: {
            ...DEFAULT_PROMPTS_CONFIG.mxpIntegration,
            ...(overrides?.mxpIntegration || {})
        }
    };

    logger.info('MCP Prompts configuration loaded', config);

    return config;
}

/**
 * Validate prompts configuration
 */
export function validatePromptsConfig(config: MxfPromptsConfig): string[] {
    const errors: string[] = [];

    if (config.cache.ttlSeconds < 0) {
        errors.push('Cache TTL must be non-negative');
    }

    if (config.cache.maxEntries < 1) {
        errors.push('Cache max entries must be at least 1');
    }

    if (config.discovery.refreshIntervalSeconds < 1) {
        errors.push('Discovery refresh interval must be at least 1 second');
    }

    if (config.discovery.timeoutMs < 100) {
        errors.push('Discovery timeout must be at least 100ms');
    }

    if (config.resolution.maxEmbeddedResourceSize < 1024) {
        errors.push('Max embedded resource size must be at least 1KB');
    }

    if (config.resolution.allowedResourceSchemes.length === 0) {
        errors.push('At least one resource scheme must be allowed');
    }

    if (errors.length > 0) {
        logger.error('MCP Prompts configuration validation failed', { errors });
    }

    return errors;
}

/**
 * Get default configuration
 */
export function getDefaultPromptsConfig(): MxfPromptsConfig {
    return DEFAULT_PROMPTS_CONFIG;
}
