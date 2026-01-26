/**
 * Feature Flags Configuration
 *
 * Centralized feature flag configuration for MXF enhancements (P6-P9).
 * All features are disabled by default and can be enabled via environment variables.
 */

import { Logger } from '../utils/Logger';

const logger = new Logger('info', 'FeatureFlags', 'server');

/**
 * Feature flag configuration interface
 */
export interface FeatureFlagsConfig {
  /** LSP-MCP Bridge integration (P7) */
  lspEnabled: boolean;

  /** Agent Dev Kit / Workflow System (P6) */
  workflowSystemEnabled: boolean;

  /** Memory Strata (P8) */
  memoryStrataEnabled: boolean;

  /** Decentralization / P2P (P9) */
  decentralizationEnabled: boolean;

  /** Sub-features for LSP */
  lsp: {
    /** Enable TypeScript language server */
    typescript: boolean;
    /** Enable Python language server */
    python: boolean;
    /** Enable Go language server */
    go: boolean;
    /** Enable caching for LSP responses */
    caching: boolean;
  };

  /** Sub-features for Workflow System */
  workflow: {
    /** Enable workflow templates */
    templates: boolean;
    /** Enable workflow execution */
    execution: boolean;
    /** Enable workflow validation */
    validation: boolean;
  };

  /** Sub-features for Memory Strata */
  memoryStrata: {
    /** Enable surprise detection */
    surpriseDetection: boolean;
    /** Enable memory consolidation */
    consolidation: boolean;
    /** Enable pattern detection */
    patternDetection: boolean;
  };

  /** Sub-features for Decentralization */
  decentralization: {
    /** Enable peer discovery */
    peerDiscovery: boolean;
    /** Enable gossip protocol */
    gossip: boolean;
    /** Enable DHT */
    dht: boolean;
    /** Enable consensus */
    consensus: boolean;
  };
}

/**
 * Parse boolean from environment variable
 */
function parseBooleanEnv(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) {
    return defaultValue;
  }
  return value.toLowerCase() === 'true' || value === '1';
}

/**
 * Load feature flags from environment variables
 */
export function loadFeatureFlags(): FeatureFlagsConfig {
  const config: FeatureFlagsConfig = {
    // Main features (all disabled by default)
    lspEnabled: parseBooleanEnv(process.env.LSP_ENABLED, false),
    workflowSystemEnabled: parseBooleanEnv(process.env.WORKFLOW_SYSTEM_ENABLED, false),
    memoryStrataEnabled: parseBooleanEnv(process.env.MEMORY_STRATA_ENABLED, false),
    decentralizationEnabled: parseBooleanEnv(process.env.DECENTRALIZATION_ENABLED, false),

    // LSP sub-features
    lsp: {
      typescript: parseBooleanEnv(process.env.LSP_TYPESCRIPT_ENABLED, true),
      python: parseBooleanEnv(process.env.LSP_PYTHON_ENABLED, false),
      go: parseBooleanEnv(process.env.LSP_GO_ENABLED, false),
      caching: parseBooleanEnv(process.env.LSP_CACHING_ENABLED, true),
    },

    // Workflow sub-features
    workflow: {
      templates: parseBooleanEnv(process.env.WORKFLOW_TEMPLATES_ENABLED, true),
      execution: parseBooleanEnv(process.env.WORKFLOW_EXECUTION_ENABLED, true),
      validation: parseBooleanEnv(process.env.WORKFLOW_VALIDATION_ENABLED, true),
    },

    // Memory Strata sub-features
    memoryStrata: {
      surpriseDetection: parseBooleanEnv(process.env.MEMORY_STRATA_SURPRISE_DETECTION, true),
      consolidation: parseBooleanEnv(process.env.MEMORY_STRATA_CONSOLIDATION, true),
      patternDetection: parseBooleanEnv(process.env.MEMORY_STRATA_PATTERN_DETECTION, true),
    },

    // Decentralization sub-features
    decentralization: {
      peerDiscovery: parseBooleanEnv(process.env.DECENTRALIZATION_PEER_DISCOVERY, true),
      gossip: parseBooleanEnv(process.env.DECENTRALIZATION_GOSSIP, true),
      dht: parseBooleanEnv(process.env.DECENTRALIZATION_DHT, false),
      consensus: parseBooleanEnv(process.env.DECENTRALIZATION_CONSENSUS, false),
    },
  };

  // Log enabled features
  const enabledFeatures: string[] = [];
  if (config.lspEnabled) enabledFeatures.push('LSP-MCP Bridge');
  if (config.workflowSystemEnabled) enabledFeatures.push('Workflow System');
  if (config.memoryStrataEnabled) enabledFeatures.push('Memory Strata');
  if (config.decentralizationEnabled) enabledFeatures.push('Decentralization');

  if (enabledFeatures.length > 0) {
    logger.info(`Enabled experimental features: ${enabledFeatures.join(', ')}`);
  } else {
    logger.debug('No experimental features enabled (P6-P9 features disabled)');
  }

  return config;
}

/**
 * Global feature flags instance
 */
export const FEATURE_FLAGS: FeatureFlagsConfig = loadFeatureFlags();

/**
 * Helper functions to check feature flags
 */
export const isLspEnabled = (): boolean => FEATURE_FLAGS.lspEnabled;
export const isWorkflowSystemEnabled = (): boolean => FEATURE_FLAGS.workflowSystemEnabled;
export const isMemoryStrataEnabled = (): boolean => FEATURE_FLAGS.memoryStrataEnabled;
export const isDecentralizationEnabled = (): boolean => FEATURE_FLAGS.decentralizationEnabled;

/**
 * Guard function to check if a feature is enabled
 * Throws an error if the feature is disabled
 */
export function requireFeature(
  feature: keyof Pick<FeatureFlagsConfig, 'lspEnabled' | 'workflowSystemEnabled' | 'memoryStrataEnabled' | 'decentralizationEnabled'>,
  featureName: string
): void {
  if (!FEATURE_FLAGS[feature]) {
    throw new Error(
      `Feature "${featureName}" is not enabled. ` +
      `Set ${feature.toUpperCase().replace('ENABLED', '')}=true in environment variables to enable.`
    );
  }
}

/**
 * Check if any experimental features are enabled
 */
export const hasExperimentalFeaturesEnabled = (): boolean => {
  return (
    FEATURE_FLAGS.lspEnabled ||
    FEATURE_FLAGS.workflowSystemEnabled ||
    FEATURE_FLAGS.memoryStrataEnabled ||
    FEATURE_FLAGS.decentralizationEnabled
  );
};
