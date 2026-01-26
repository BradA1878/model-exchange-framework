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
 * ORPAR-Memory Integration Configuration
 *
 * Centralized configuration for the unified cognitive-memory architecture.
 * This configuration controls:
 * - Phase-strata routing behavior
 * - Surprise thresholds and responses
 * - Phase-weighted reward attribution
 * - ORPAR-triggered consolidation rules
 *
 * Feature flag: ORPAR_MEMORY_INTEGRATION_ENABLED (default: false)
 */

import { MemoryStratum } from '../types/MemoryStrataTypes';
import {
    OrparMemoryIntegrationConfig,
    PhaseStrataMapping,
    SurpriseThresholds,
    PhaseWeightConfig,
    ConsolidationRule,
    PhaseStorageSpec,
    DEFAULT_PHASE_STRATA_MAPPINGS,
    DEFAULT_SURPRISE_THRESHOLDS,
    DEFAULT_PHASE_WEIGHTS,
    DEFAULT_CONSOLIDATION_RULES,
    DEFAULT_PHASE_STORAGE_SPECS,
    DEFAULT_ORPAR_MEMORY_CONFIG,
    ORPAR_MEMORY_ENV_VARS,
    getOrparMemoryConfigFromEnv
} from '../types/OrparMemoryIntegrationTypes';
import { Logger } from '../utils/Logger';

const logger = new Logger('info', 'OrparMemoryConfig', 'server');

/**
 * Singleton configuration instance
 */
let configInstance: OrparMemoryIntegrationConfig | null = null;

/**
 * Parse strata list from environment variable
 * Format: "working,short_term,episodic"
 */
function parseStrataList(value: string | undefined): MemoryStratum[] {
    if (!value) return [];

    const strataMap: Record<string, MemoryStratum> = {
        'working': MemoryStratum.Working,
        'short_term': MemoryStratum.ShortTerm,
        'long_term': MemoryStratum.LongTerm,
        'episodic': MemoryStratum.Episodic,
        'semantic': MemoryStratum.Semantic
    };

    return value.split(',')
        .map(s => s.trim().toLowerCase())
        .filter(s => strataMap[s])
        .map(s => strataMap[s]);
}

/**
 * Build phase-strata mappings from environment variables
 */
function buildPhaseStrataMappingsFromEnv(): PhaseStrataMapping[] {
    const baseMappings = [...DEFAULT_PHASE_STRATA_MAPPINGS];

    // Override observation primary strata if specified
    const observationPrimary = parseStrataList(process.env[ORPAR_MEMORY_ENV_VARS.PHASE_STRATA_OBSERVATION_PRIMARY]);
    if (observationPrimary.length > 0) {
        const obsMapping = baseMappings.find(m => m.phase === 'observation');
        if (obsMapping) {
            obsMapping.primaryStrata = observationPrimary;
        }
    }

    // Override reasoning primary strata if specified
    const reasoningPrimary = parseStrataList(process.env[ORPAR_MEMORY_ENV_VARS.PHASE_STRATA_REASONING_PRIMARY]);
    if (reasoningPrimary.length > 0) {
        const reasonMapping = baseMappings.find(m => m.phase === 'reasoning');
        if (reasonMapping) {
            reasonMapping.primaryStrata = reasoningPrimary;
        }
    }

    // Override planning primary strata if specified
    const planningPrimary = parseStrataList(process.env[ORPAR_MEMORY_ENV_VARS.PHASE_STRATA_PLANNING_PRIMARY]);
    if (planningPrimary.length > 0) {
        const planMapping = baseMappings.find(m => m.phase === 'planning');
        if (planMapping) {
            planMapping.primaryStrata = planningPrimary;
        }
    }

    return baseMappings;
}

/**
 * Build consolidation rules from environment variables
 */
function buildConsolidationRulesFromEnv(): ConsolidationRule[] {
    const rules = [...DEFAULT_CONSOLIDATION_RULES];

    // Update promotion Q-value threshold if specified
    const promotionQValue = process.env[ORPAR_MEMORY_ENV_VARS.CONSOLIDATION_PROMOTION_QVALUE];
    if (promotionQValue) {
        const promoteRule = rules.find(r => r.id === 'promote-high-performers');
        if (promoteRule && promoteRule.condition.minQValue !== undefined) {
            promoteRule.condition.minQValue = parseFloat(promotionQValue);
        }
    }

    // Update demotion Q-value threshold if specified
    const demotionQValue = process.env[ORPAR_MEMORY_ENV_VARS.CONSOLIDATION_DEMOTION_QVALUE];
    if (demotionQValue) {
        const demoteRule = rules.find(r => r.id === 'demote-low-performers');
        if (demoteRule && demoteRule.condition.maxQValue !== undefined) {
            demoteRule.condition.maxQValue = parseFloat(demotionQValue);
        }
    }

    return rules;
}

/**
 * Initialize and get the ORPAR-Memory integration configuration
 *
 * Configuration is loaded from:
 * 1. Default values (see OrparMemoryIntegrationTypes.ts)
 * 2. Environment variable overrides
 *
 * @returns The complete configuration
 */
export function getOrparMemoryConfig(): OrparMemoryIntegrationConfig {
    if (configInstance) {
        return configInstance;
    }

    // Start with defaults
    const config: OrparMemoryIntegrationConfig = {
        ...DEFAULT_ORPAR_MEMORY_CONFIG
    };

    // Apply environment variable overrides
    const envConfig = getOrparMemoryConfigFromEnv();

    // Merge enabled flag
    if (envConfig.enabled !== undefined) {
        config.enabled = envConfig.enabled;
    }

    // Merge surprise thresholds
    if (envConfig.surpriseThresholds) {
        config.surpriseThresholds = {
            ...config.surpriseThresholds,
            ...envConfig.surpriseThresholds
        };
    }

    // Merge phase weights
    if (envConfig.phaseWeights) {
        config.phaseWeights = {
            ...config.phaseWeights,
            ...envConfig.phaseWeights
        };
    }

    // Merge debug flag
    if (envConfig.debug !== undefined) {
        config.debug = envConfig.debug;
    }

    // Build phase-strata mappings from environment
    config.phaseStrataMappings = buildPhaseStrataMappingsFromEnv();

    // Build consolidation rules from environment
    config.consolidationRules = buildConsolidationRulesFromEnv();

    // Validate phase weights sum to approximately 1.0
    const weightSum = Object.values(config.phaseWeights).reduce((a, b) => a + b, 0);
    if (Math.abs(weightSum - 1.0) > 0.01) {
        logger.warn(`Phase weights sum to ${weightSum.toFixed(3)}, expected ~1.0. Results may be unexpected.`);
    }

    // Log configuration if debug enabled
    if (config.debug) {
        logger.info('ORPAR-Memory Integration Configuration:', JSON.stringify(config, null, 2));
    }

    // Log enabled status
    if (config.enabled) {
        logger.info('ORPAR-Memory Integration is ENABLED');
    } else {
        logger.debug('ORPAR-Memory Integration is disabled (opt-in via ORPAR_MEMORY_INTEGRATION_ENABLED=true)');
    }

    configInstance = config;
    return config;
}

/**
 * Check if ORPAR-Memory integration is enabled
 *
 * @returns true if integration is enabled
 */
export function isOrparMemoryIntegrationEnabled(): boolean {
    return getOrparMemoryConfig().enabled;
}

/**
 * Get the phase-strata mapping for a specific ORPAR phase
 *
 * @param phase - The ORPAR phase
 * @returns The strata mapping for that phase, or undefined if not found
 */
export function getPhaseStrataMapping(phase: string): PhaseStrataMapping | undefined {
    const config = getOrparMemoryConfig();
    return config.phaseStrataMappings.find(m => m.phase === phase);
}

/**
 * Get the surprise thresholds
 *
 * @returns The surprise thresholds configuration
 */
export function getSurpriseThresholds(): SurpriseThresholds {
    return getOrparMemoryConfig().surpriseThresholds;
}

/**
 * Get the phase weight for a specific ORPAR phase
 *
 * @param phase - The ORPAR phase
 * @returns The weight for that phase
 */
export function getPhaseWeight(phase: string): number {
    const config = getOrparMemoryConfig();
    const weights = config.phaseWeights as unknown as Record<string, number>;
    return weights[phase] ?? 0;
}

/**
 * Get all phase weights
 *
 * @returns The phase weight configuration
 */
export function getPhaseWeights(): PhaseWeightConfig {
    return getOrparMemoryConfig().phaseWeights;
}

/**
 * Get the consolidation rules
 *
 * @returns Array of consolidation rules sorted by priority (descending)
 */
export function getConsolidationRules(): ConsolidationRule[] {
    const config = getOrparMemoryConfig();
    return [...config.consolidationRules].sort((a, b) => b.priority - a.priority);
}

/**
 * Get the storage spec for a specific ORPAR phase
 *
 * @param phase - The ORPAR phase
 * @returns The storage spec for that phase, or undefined if not found
 */
export function getPhaseStorageSpec(phase: string): PhaseStorageSpec | undefined {
    const config = getOrparMemoryConfig();
    return config.phaseStorageSpecs.find(s => s.phase === phase);
}

/**
 * Reset the configuration (useful for testing)
 */
export function resetOrparMemoryConfig(): void {
    configInstance = null;
}

/**
 * Update the configuration at runtime (useful for testing or dynamic updates)
 *
 * @param updates - Partial configuration updates to apply
 */
export function updateOrparMemoryConfig(updates: Partial<OrparMemoryIntegrationConfig>): void {
    const current = getOrparMemoryConfig();
    configInstance = {
        ...current,
        ...updates,
        // Deep merge nested objects
        surpriseThresholds: {
            ...current.surpriseThresholds,
            ...(updates.surpriseThresholds ?? {})
        },
        phaseWeights: {
            ...current.phaseWeights,
            ...(updates.phaseWeights ?? {})
        },
        phaseStrataMappings: updates.phaseStrataMappings ?? current.phaseStrataMappings,
        consolidationRules: updates.consolidationRules ?? current.consolidationRules,
        phaseStorageSpecs: updates.phaseStorageSpecs ?? current.phaseStorageSpecs
    };

    logger.info('ORPAR-Memory configuration updated');
}

// ============================================================================
// Type Guards and Utilities
// ============================================================================

/**
 * Check if a string is a valid ORPAR phase
 */
export function isValidOrparPhase(phase: string): phase is 'observation' | 'reasoning' | 'planning' | 'action' | 'reflection' {
    return ['observation', 'reasoning', 'planning', 'action', 'reflection'].includes(phase);
}

/**
 * Check if a string is a valid memory stratum
 */
export function isValidMemoryStratum(stratum: string): stratum is MemoryStratum {
    return Object.values(MemoryStratum).includes(stratum as MemoryStratum);
}

/**
 * Get the next ORPAR phase in the cycle
 */
export function getNextOrparPhase(currentPhase: string): string | null {
    const phases = ['observation', 'reasoning', 'planning', 'action', 'reflection'];
    const currentIndex = phases.indexOf(currentPhase);
    if (currentIndex === -1 || currentIndex === phases.length - 1) {
        return null;
    }
    return phases[currentIndex + 1];
}

/**
 * Get the previous ORPAR phase in the cycle
 */
export function getPreviousOrparPhase(currentPhase: string): string | null {
    const phases = ['observation', 'reasoning', 'planning', 'action', 'reflection'];
    const currentIndex = phases.indexOf(currentPhase);
    if (currentIndex <= 0) {
        return null;
    }
    return phases[currentIndex - 1];
}
