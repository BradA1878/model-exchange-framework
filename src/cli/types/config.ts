/**
 * MXF CLI Configuration Types
 *
 * Defines the shape of ~/.mxf/config.json which is the single source of truth
 * for all MXF infrastructure, credentials, and LLM configuration.
 *
 * @author Brad Anderson <BradA1878@pm.me>
 */

/**
 * Root configuration stored at ~/.mxf/config.json.
 * Created by `mxf install`, extended by `mxf init`.
 */
export interface MxfConfig {
    /** Schema version for forward compatibility */
    version: 1;

    /** ISO timestamp of last modification */
    lastModified: string;

    /** Docker infrastructure settings */
    infrastructure: MxfInfrastructureConfig;

    /** MXF server connection settings */
    server: MxfServerConfig;

    /** Auto-generated security credentials */
    credentials: MxfCredentialsConfig;

    /** Local user created during install (null until Phase B completes) */
    user: MxfUserConfig | null;

    /** LLM provider configuration (null until `mxf init` runs) */
    llm: MxfLlmConfig | null;

    /** Feature flags for optional MXF subsystems */
    features: MxfFeaturesConfig;

    /** User preferences for TUI behavior and appearance */
    preferences?: MxfPreferencesConfig;

    /** Agent selection and customization */
    agents?: MxfAgentsConfig;

    /** Default cost budget limit in USD for TUI sessions (null/absent = no limit) */
    costBudget?: number;
}

/** Docker infrastructure container settings */
export interface MxfInfrastructureConfig {
    /** Path to docker-compose.yml (defaults to repo root) */
    composeFilePath: string;

    /** MongoDB connection settings */
    mongodb: {
        port: number;
        username: string;
        password: string;
        database: string;
    };

    /** Meilisearch semantic search engine settings */
    meilisearch: {
        port: number;
        masterKey: string;
    };

    /** Redis cache settings */
    redis: {
        port: number;
        password: string;
    };
}

/** MXF server connection settings */
export interface MxfServerConfig {
    /** Server port (default: 3001) */
    port: number;

    /** Server host (default: localhost) */
    host: string;
}

/** Auto-generated security credentials */
export interface MxfCredentialsConfig {
    /** 64-char hex domain key for SDK authentication */
    domainKey: string;

    /** JWT signing secret for user authentication */
    jwtSecret: string;

    /** MXP encryption key for channel encryption */
    mxpEncryptionKey: string;

    /** Agent API key */
    agentApiKey: string;
}

/** Local user account created during install */
export interface MxfUserConfig {
    /** Username */
    username: string;

    /** Email address */
    email: string;

    /** Personal Access Token in tokenId:secret format */
    accessToken: string;
}

/** LLM provider and model configuration */
export interface MxfLlmConfig {
    /** Provider identifier (matches LlmProviderType enum values) */
    provider: string;

    /** API key for the selected provider */
    apiKey: string;

    /** Default model identifier */
    defaultModel: string;

    /** SystemLLM settings for server-side ORPAR operations */
    systemLlm: {
        /** Whether SystemLLM is enabled (costs credits — disabled by default) */
        enabled: boolean;
        /** Provider for SystemLLM */
        provider: string;
        /** Model for SystemLLM */
        model: string;
    };

    /** Embedding provider for Meilisearch semantic search */
    embedding: {
        /** Embedding provider identifier */
        provider: string;
        /** Embedding model identifier */
        model: string;
        /** Embedding dimensions (default: 1536) */
        dimensions: number;
    };
}

/** Feature flags for optional MXF subsystems */
export interface MxfFeaturesConfig {
    /** Enable Meilisearch integration */
    meilisearch: boolean;

    /** Enable semantic search via Meilisearch */
    semanticSearch: boolean;

    /** Enable TensorFlow.js ML features */
    tensorflow: boolean;

    /** Enable Memory Utility Learning System */
    muls: boolean;

    /** Enable ORPAR-Memory integration */
    orparMemory: boolean;
}

/** User preferences for TUI behavior and appearance */
export interface MxfPreferencesConfig {
    /** TUI color theme (dark, light, minimal) */
    theme?: string;
    /** Show/hide agent activity cards in conversation */
    showAgentActivity?: boolean;
    /** Always prompt for confirmation, even for non-destructive actions */
    confirmBeforeExecute?: boolean;
    /** Start with detail mode enabled (Ctrl+A toggle) */
    detailModeDefault?: boolean;
}

/** Agent selection and customization */
export interface MxfAgentsConfig {
    /** List of enabled agent IDs. Empty/undefined = all built-in agents. */
    enabled?: string[];
    /** Path to directory with custom agent .md files (default: ~/.mxf/agents/) */
    customAgentsDir?: string;
    /** Per-agent model overrides. Keys are agentIds, values are model identifiers. */
    models?: Record<string, string>;
}

/** Container health and status information */
export interface ContainerStatus {
    /** Container name (e.g., 'mxf-mongodb') */
    name: string;

    /** Running state */
    status: 'running' | 'stopped' | 'not_found';

    /** Exposed port */
    port: number;

    /** Docker health check state */
    health: 'healthy' | 'unhealthy' | 'starting' | 'none' | 'unknown';
}

/** Combined infrastructure status */
export interface InfraStatus {
    /** Docker availability */
    docker: {
        installed: boolean;
        running: boolean;
    };

    /** Container statuses */
    containers: {
        mongodb: ContainerStatus;
        meilisearch: ContainerStatus;
        redis: ContainerStatus;
    };
}

/** Server health endpoint response */
export interface ServerHealth {
    /** Whether the server is reachable */
    reachable: boolean;

    /** Server status string */
    status: string;

    /** Server uptime in seconds */
    uptime: number;

    /** Environment (development/production) */
    environment: string;

    /** Server version */
    version: string;
}

/** Result of a prerequisite check */
export interface PrerequisiteResult {
    /** Name of the prerequisite (e.g., 'Docker') */
    name: string;

    /** Whether it's available */
    available: boolean;

    /** Version string if available */
    version?: string;

    /** Error message if not available */
    errorMessage?: string;

    /** URL or command to resolve the issue */
    helpUrl?: string;
}
