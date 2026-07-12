/**
 * Memory strata configuration (Nested Learning).
 *
 * The strata services — StratumManager, SurpriseCalculator, MemoryCompressor,
 * RetentionGateService — take their configuration as a constructor argument, and until
 * now the only place that argument was ever built was inside test files. There was no
 * production configuration path and no boot-time initialization, so StratumManager stayed
 * disabled no matter what MEMORY_STRATA_ENABLED was set to, and the whole layer — which
 * PhaseMemoryOperations and PhaseStrataRouter sit on top of — was inert.
 *
 * This module is the missing production path. It reads the same env flag the rest of the
 * framework already exposes and produces a config the server initializes the strata
 * services with at boot.
 */

import { MemoryStrataConfig, MemoryImportance } from '../types/MemoryStrataTypes.js';
import { isMemoryStrataEnabled } from './FeatureFlags.js';

export { isMemoryStrataEnabled };

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const parseIntEnv = (value: string | undefined, fallback: number): number => {
    if (value === undefined || value.trim() === '') {
        return fallback;
    }
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) {
        throw new Error(
            `Invalid integer for memory strata configuration: "${value}". ` +
            `Remove the variable to use the default (${fallback}), or set a whole number.`
        );
    }
    return parsed;
};

const parseFloatEnv = (value: string | undefined, fallback: number): number => {
    if (value === undefined || value.trim() === '') {
        return fallback;
    }
    const parsed = Number.parseFloat(value);
    if (!Number.isFinite(parsed)) {
        throw new Error(
            `Invalid number for memory strata configuration: "${value}". ` +
            `Remove the variable to use the default (${fallback}), or set a number.`
        );
    }
    return parsed;
};

/**
 * Resolve the minimum long-term importance, which is a numeric enum, not a string.
 */
const parseImportanceEnv = (value: string | undefined): MemoryImportance => {
    if (value === undefined || value.trim() === '') {
        return MemoryImportance.Medium;
    }
    const byName = (MemoryImportance as unknown as Record<string, number>)[value.trim()];
    if (typeof byName === 'number') {
        return byName as MemoryImportance;
    }
    throw new Error(
        `Invalid MEMORY_STRATA_LONG_TERM_MIN_IMPORTANCE: "${value}". ` +
        `Expected one of: Critical, High, Medium, Low, Trivial.`
    );
};

/**
 * Build the strata configuration from the environment.
 *
 * Invalid numeric values throw rather than silently falling back, so a typo in a tuning
 * variable surfaces at boot instead of quietly changing how memory is retained.
 */
export function getMemoryStrataConfig(): MemoryStrataConfig {
    return {
        enabled: isMemoryStrataEnabled(),

        working: {
            maxEntries: parseIntEnv(process.env.MEMORY_STRATA_WORKING_MAX_ENTRIES, 50),
            ttl: parseIntEnv(process.env.MEMORY_STRATA_WORKING_TTL_MS, 30 * MINUTE)
        },

        shortTerm: {
            maxEntries: parseIntEnv(process.env.MEMORY_STRATA_SHORT_TERM_MAX_ENTRIES, 500),
            ttl: parseIntEnv(process.env.MEMORY_STRATA_SHORT_TERM_TTL_MS, 7 * DAY),
            consolidationThreshold: parseIntEnv(
                process.env.MEMORY_STRATA_SHORT_TERM_CONSOLIDATION_THRESHOLD,
                3
            )
        },

        longTerm: {
            maxEntriesPerAgent: parseIntEnv(process.env.MEMORY_STRATA_LONG_TERM_MAX_ENTRIES, 5000),
            minImportance: parseImportanceEnv(process.env.MEMORY_STRATA_LONG_TERM_MIN_IMPORTANCE),
            enableArchival: process.env.MEMORY_STRATA_LONG_TERM_ARCHIVAL !== 'false',
            archivalAge: parseIntEnv(process.env.MEMORY_STRATA_LONG_TERM_ARCHIVAL_AGE_MS, 90 * DAY)
        },

        episodic: {
            maxEpisodesPerAgent: parseIntEnv(process.env.MEMORY_STRATA_EPISODIC_MAX_EPISODES, 200),
            episodeDuration: parseIntEnv(process.env.MEMORY_STRATA_EPISODIC_DURATION_MS, HOUR)
        },

        semantic: {
            maxConceptsPerAgent: parseIntEnv(process.env.MEMORY_STRATA_SEMANTIC_MAX_CONCEPTS, 1000),
            minConfidence: parseFloatEnv(process.env.MEMORY_STRATA_SEMANTIC_MIN_CONFIDENCE, 0.6)
        },

        surprise: {
            enabled: process.env.MEMORY_STRATA_SURPRISE_ENABLED !== 'false',
            threshold: parseFloatEnv(process.env.MEMORY_STRATA_SURPRISE_THRESHOLD, 0.5),
            analysisWindow: parseIntEnv(process.env.MEMORY_STRATA_SURPRISE_WINDOW, 20)
        },

        consolidation: {
            enabled: process.env.MEMORY_STRATA_CONSOLIDATION_ENABLED !== 'false',
            interval: parseIntEnv(process.env.MEMORY_STRATA_CONSOLIDATION_INTERVAL_MS, HOUR),
            similarityThreshold: parseFloatEnv(
                process.env.MEMORY_STRATA_CONSOLIDATION_SIMILARITY,
                0.85
            )
        },

        patterns: {
            enabled: process.env.MEMORY_STRATA_PATTERNS_ENABLED !== 'false',
            minLength: parseIntEnv(process.env.MEMORY_STRATA_PATTERN_MIN_LENGTH, 3),
            minConfidence: parseFloatEnv(process.env.MEMORY_STRATA_PATTERN_MIN_CONFIDENCE, 0.7),
            analysisInterval: parseIntEnv(
                process.env.MEMORY_STRATA_PATTERN_ANALYSIS_INTERVAL_MS,
                30 * MINUTE
            )
        }
    };
}
