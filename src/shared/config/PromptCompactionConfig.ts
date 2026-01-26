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
 * Prompt Auto-Compaction Configuration
 *
 * Central configuration for all prompt compaction features.
 * All features are DISABLED by default for safe rollout.
 */

import { Logger } from '../utils/Logger';

const logger = new Logger('info', 'PromptCompactionConfig', 'server');

/**
 * Prompt compaction configuration interface
 */
export interface PromptCompactionConfig {
    // Master switches
    enabled: boolean;
    residualsEnabled: boolean;
    tieredEnabled: boolean;
    budgetEnabled: boolean;

    // Residual detection settings
    residualThreshold: number;
    residualMaxPercent: number;

    // Tiered compression settings
    tier0Size: number;
    tier1Size: number;
    tier2Size: number;

    // Budget allocation settings
    defaultTokenBudget: number;

    // System prompt optimization
    condensedMode: boolean;
    maxSystemPromptTokens: number;
}

/**
 * Load configuration from environment variables
 */
export function loadPromptCompactionConfig(): PromptCompactionConfig {
    const config: PromptCompactionConfig = {
        // Master switches (all default to false for safe rollout)
        enabled: process.env.PROMPT_COMPACTION_ENABLED === 'true',
        residualsEnabled: process.env.PROMPT_COMPACTION_RESIDUALS_ENABLED === 'true',
        tieredEnabled: process.env.PROMPT_COMPACTION_TIERED_ENABLED === 'true',
        budgetEnabled: process.env.PROMPT_COMPACTION_BUDGET_ENABLED === 'true',

        // Residual detection (skip connections)
        residualThreshold: parseInt(process.env.PROMPT_COMPACTION_RESIDUAL_THRESHOLD || '60'),
        residualMaxPercent: parseFloat(process.env.PROMPT_COMPACTION_RESIDUAL_MAX_PERCENT || '0.20'),

        // Tiered compression (ResNet-inspired hierarchy)
        tier0Size: parseInt(process.env.PROMPT_COMPACTION_TIER0_SIZE || '10'),
        tier1Size: parseInt(process.env.PROMPT_COMPACTION_TIER1_SIZE || '25'),
        tier2Size: parseInt(process.env.PROMPT_COMPACTION_TIER2_SIZE || '50'),

        // Token budget allocation
        defaultTokenBudget: parseInt(process.env.PROMPT_COMPACTION_DEFAULT_BUDGET || '8000'),

        // System prompt optimization
        condensedMode: process.env.PROMPT_COMPACTION_CONDENSED_MODE === 'true',
        maxSystemPromptTokens: parseInt(process.env.PROMPT_COMPACTION_MAX_SYSTEM_PROMPT_TOKENS || '2500')
    };

    logger.info('Prompt compaction configuration loaded', config);

    return config;
}

/**
 * Validate configuration values
 */
export function validatePromptCompactionConfig(config: PromptCompactionConfig): string[] {
    const errors: string[] = [];

    // Validate residual threshold (0-100)
    if (config.residualThreshold < 0 || config.residualThreshold > 100) {
        errors.push('Residual threshold must be between 0 and 100');
    }

    // Validate residual max percent (0.0-1.0)
    if (config.residualMaxPercent < 0 || config.residualMaxPercent > 1.0) {
        errors.push('Residual max percent must be between 0.0 and 1.0');
    }

    // Validate tier sizes (must be increasing)
    if (config.tier0Size >= config.tier1Size) {
        errors.push('Tier 1 size must be greater than Tier 0 size');
    }
    if (config.tier1Size >= config.tier2Size) {
        errors.push('Tier 2 size must be greater than Tier 1 size');
    }

    // Validate token budget (positive)
    if (config.defaultTokenBudget <= 0) {
        errors.push('Default token budget must be positive');
    }

    // Validate max system prompt tokens
    if (config.maxSystemPromptTokens <= 0) {
        errors.push('Max system prompt tokens must be positive');
    }

    if (errors.length > 0) {
        logger.error('Prompt compaction configuration validation failed', { errors });
    }

    return errors;
}

/**
 * Get default configuration (all features disabled)
 */
export function getDefaultPromptCompactionConfig(): PromptCompactionConfig {
    return {
        enabled: false,
        residualsEnabled: false,
        tieredEnabled: false,
        budgetEnabled: false,
        residualThreshold: 60,
        residualMaxPercent: 0.20,
        tier0Size: 10,
        tier1Size: 25,
        tier2Size: 50,
        defaultTokenBudget: 8000,
        condensedMode: false,
        maxSystemPromptTokens: 2500
    };
}
