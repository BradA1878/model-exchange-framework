/**
 * MXF CLI Configuration Service
 *
 * Manages the ~/.mxf/config.json file — the single source of truth for all
 * MXF infrastructure, credentials, LLM, and feature configuration.
 *
 * Provides:
 * - Atomic read/write of the config file
 * - Dot-path get/set for individual values
 * - Validation of config structure and required fields
 * - Conversion to environment variables for the server
 * - .env bridge file writing for existing bun run dev / demo compatibility
 *
 * @author Brad Anderson <BradA1878@pm.me>
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { MxfConfig } from '../types/config';
import { CredentialService } from './CredentialService';

/** Default config directory and file paths */
const MXF_CONFIG_DIR = path.join(os.homedir(), '.mxf');
const MXF_CONFIG_FILE = path.join(MXF_CONFIG_DIR, 'config.json');

/**
 * Byte length of the generated MXP encryption salt.
 * 16 bytes → 32 hex chars, matching the `openssl rand -hex 16` form
 * documented for MXP_ENCRYPTION_SALT.
 */
const MXP_SALT_BYTES = 16;

/**
 * Generate a random hex salt for MXP channel encryption.
 *
 * Kept here rather than in CredentialService so `createDefault()` and the
 * backfill for pre-existing configs share one generator.
 */
function generateMxpSalt(): string {
    return crypto.randomBytes(MXP_SALT_BYTES).toString('hex');
}

export class ConfigService {
    private static instance: ConfigService;
    private configPath: string;
    private cachedConfig: MxfConfig | null = null;

    constructor(configPath?: string) {
        this.configPath = configPath || MXF_CONFIG_FILE;
    }

    static getInstance(): ConfigService {
        if (!ConfigService.instance) {
            ConfigService.instance = new ConfigService();
        }
        return ConfigService.instance;
    }

    /** Get the path to the config file */
    getConfigPath(): string {
        return this.configPath;
    }

    /** Get the path to the config directory */
    getConfigDir(): string {
        return path.dirname(this.configPath);
    }

    /** Check if config file exists */
    exists(): boolean {
        return fs.existsSync(this.configPath);
    }

    /**
     * Load config from disk. Creates ~/.mxf/ directory if it doesn't exist.
     * Returns null if the config file doesn't exist.
     */
    load(): MxfConfig | null {
        const configDir = this.getConfigDir();
        if (!fs.existsSync(configDir)) {
            fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
        }

        if (!fs.existsSync(this.configPath)) {
            this.cachedConfig = null;
            return null;
        }

        try {
            const content = fs.readFileSync(this.configPath, 'utf-8');
            this.cachedConfig = JSON.parse(content) as MxfConfig;
            return this.cachedConfig;
        } catch (error) {
            throw new Error(`Failed to parse config at ${this.configPath}: ${error}`);
        }
    }

    /**
     * Write config to disk with atomic write (write to temp file, then rename).
     * Sets restrictive permissions (owner read/write only) since config contains secrets.
     */
    save(config: MxfConfig): void {
        const configDir = this.getConfigDir();
        if (!fs.existsSync(configDir)) {
            fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
        }

        config.lastModified = new Date().toISOString();

        // Atomic write: write to temp file, then rename
        const tempPath = this.configPath + '.tmp.' + crypto.randomBytes(4).toString('hex');
        try {
            fs.writeFileSync(tempPath, JSON.stringify(config, null, 2) + '\n', {
                encoding: 'utf-8',
                mode: 0o600,
            });
            fs.renameSync(tempPath, this.configPath);
            this.cachedConfig = config;
        } catch (error) {
            // Clean up temp file if rename failed
            try { fs.unlinkSync(tempPath); } catch { /* ignore cleanup failure */ }
            throw new Error(`Failed to save config: ${error}`);
        }
    }

    /**
     * Get a value by dot-delimited path (e.g., 'credentials.domainKey').
     * Returns undefined if the path doesn't exist.
     */
    get(dotPath: string): any {
        const config = this.cachedConfig || this.load();
        if (!config) return undefined;

        const parts = dotPath.split('.');
        let current: any = config;
        for (const part of parts) {
            if (current === null || current === undefined || typeof current !== 'object') {
                return undefined;
            }
            current = current[part];
        }
        return current;
    }

    /**
     * Set a value by dot-delimited path (e.g., 'server.port', 3002).
     * Creates intermediate objects if they don't exist.
     * Saves the config to disk after updating.
     */
    set(dotPath: string, value: any): void {
        let config = this.cachedConfig || this.load();
        if (!config) {
            throw new Error('No config file exists. Run `mxf install` first.');
        }

        const parts = dotPath.split('.');
        let current: any = config;
        for (let i = 0; i < parts.length - 1; i++) {
            const part = parts[i];
            if (current[part] === null || current[part] === undefined || typeof current[part] !== 'object') {
                current[part] = {};
            }
            current = current[part];
        }
        current[parts[parts.length - 1]] = value;

        this.save(config);
    }

    /**
     * Create a default config with all credentials generated.
     * Uses default ports matching docker-compose.yml.
     *
     * @param composeFilePath - Path to docker-compose.yml (defaults to cwd)
     */
    createDefault(composeFilePath?: string): MxfConfig {
        const credentials = CredentialService.getInstance().generateAll();

        const config: MxfConfig = {
            version: 1,
            lastModified: new Date().toISOString(),

            infrastructure: {
                composeFilePath: composeFilePath || path.join(process.cwd(), 'docker-compose.yml'),
                mongodb: {
                    port: 27017,
                    username: 'mxf_admin',
                    password: credentials.mongoPassword,
                    database: 'mxf',
                },
                meilisearch: {
                    port: 7700,
                    masterKey: credentials.meilisearchKey,
                },
                redis: {
                    port: 6379,
                    password: credentials.redisPassword,
                },
            },

            server: {
                port: 3001,
                host: 'localhost',
            },

            credentials: {
                domainKey: credentials.domainKey,
                jwtSecret: credentials.jwtSecret,
                mxpEncryptionKey: credentials.mxpEncryptionKey,
                mxpEncryptionSalt: generateMxpSalt(),
                agentApiKey: credentials.agentApiKey,
            },

            user: null,

            llm: null,

            features: {
                meilisearch: true,
                semanticSearch: true,
                tensorflow: false,
                muls: false,
                orparMemory: false,
            },
        };

        return config;
    }

    /**
     * Backfill auto-generated credentials that an older config predates.
     *
     * This is a one-time migration, not a fallback: the generated value is
     * random and persisted per install, which is exactly the property the
     * credential is required to have. Configs created before
     * `credentials.mxpEncryptionSalt` existed ran against a hardcoded salt, so
     * they are migrated to a unique one here. Rotating the salt only affects
     * in-flight MXP messages, never data at rest.
     *
     * Idempotent — a config that already has every credential is left untouched
     * and not rewritten.
     *
     * @returns Names of the credentials that were generated (empty if none)
     */
    ensureGeneratedCredentials(): string[] {
        const config = this.cachedConfig || this.load();
        if (!config) return [];

        const generated: string[] = [];

        if (!config.credentials?.mxpEncryptionSalt) {
            config.credentials.mxpEncryptionSalt = generateMxpSalt();
            generated.push('credentials.mxpEncryptionSalt');
        }

        if (generated.length > 0) {
            this.save(config);
        }

        return generated;
    }

    /**
     * Convert config to environment variables that the MXF server expects.
     * This is the bridge between ~/.mxf/config.json and the server's process.env.
     *
     * Materializing the environment requires every generated credential to
     * exist, so any missing one is generated and persisted first.
     */
    toEnvironmentVariables(): Record<string, string> {
        const config = this.cachedConfig || this.load();
        if (!config) return {};

        this.ensureGeneratedCredentials();

        const env: Record<string, string> = {};

        // Server
        env.MXF_PORT = String(config.server.port);
        env.MXF_SERVER_URL = `http://${config.server.host}:${config.server.port}`;
        env.NODE_ENV = 'development';

        // MongoDB
        const mongo = config.infrastructure.mongodb;
        env.MONGODB_URI = `mongodb://${mongo.username}:${mongo.password}@localhost:${mongo.port}/${mongo.database}?authSource=admin`;
        env.MONGODB_USERNAME = mongo.username;
        env.MONGODB_PASSWORD = mongo.password;
        env.MONGODB_DATABASE = mongo.database;

        // Meilisearch
        const meili = config.infrastructure.meilisearch;
        env.MEILISEARCH_HOST = `http://localhost:${meili.port}`;
        env.MEILISEARCH_MASTER_KEY = meili.masterKey;

        // Redis
        const redis = config.infrastructure.redis;
        env.REDIS_HOST = 'localhost';
        env.REDIS_PORT = String(redis.port);
        env.REDIS_PASSWORD = redis.password;

        // Security credentials
        env.MXF_DOMAIN_KEY = config.credentials.domainKey;
        env.JWT_SECRET = config.credentials.jwtSecret;
        env.AGENT_API_KEY = config.credentials.agentApiKey;
        env.MXP_ENCRYPTION_KEY = config.credentials.mxpEncryptionKey;
        env.MXP_ENCRYPTION_ENABLED = 'true';
        // Per-install salt (see ensureGeneratedCredentials). Never a constant:
        // core rejects MXP encryption without a unique salt precisely because a
        // shared one is precomputable.
        env.MXP_ENCRYPTION_SALT = config.credentials.mxpEncryptionSalt;

        // User access token (for demos)
        if (config.user?.accessToken) {
            env.MXF_DEMO_ACCESS_TOKEN = config.user.accessToken;
        }

        // LLM configuration
        if (config.llm) {
            // Set the API key for the correct provider
            switch (config.llm.provider) {
                case 'openrouter':
                    env.OPENROUTER_API_KEY = config.llm.apiKey;
                    break;
                case 'openai':
                    env.OPENAI_API_KEY = config.llm.apiKey;
                    break;
                case 'anthropic':
                    env.ANTHROPIC_API_KEY = config.llm.apiKey;
                    break;
                case 'xai':
                    env.XAI_API_KEY = config.llm.apiKey;
                    break;
                case 'gemini':
                    env.GEMINI_API_KEY = config.llm.apiKey;
                    break;
            }

            // SystemLLM settings (guard against partial llm config)
            if (config.llm.systemLlm) {
                env.SYSTEMLLM_ENABLED = String(config.llm.systemLlm.enabled);
                if (config.llm.systemLlm.enabled) {
                    env.SYSTEMLLM_PROVIDER = config.llm.systemLlm.provider;
                    env.SYSTEMLLM_DEFAULT_MODEL = config.llm.systemLlm.model;
                }
            }

            // Embedding settings (guard against partial llm config)
            if (config.llm.embedding) {
                env.MEILISEARCH_EMBEDDING_PROVIDER = config.llm.embedding.provider;
                env.MEILISEARCH_EMBEDDING_MODEL = config.llm.embedding.model;
                env.MEILISEARCH_EMBEDDING_DIMENSIONS = String(config.llm.embedding.dimensions);
            }
        }

        // Feature flags
        env.ENABLE_MEILISEARCH = String(config.features?.meilisearch ?? false);
        env.ENABLE_SEMANTIC_SEARCH = String(config.features?.semanticSearch ?? false);
        env.TENSORFLOW_ENABLED = String(config.features?.tensorflow ?? false);
        env.MEMORY_UTILITY_LEARNING_ENABLED = String(config.features?.muls ?? false);
        env.ORPAR_MEMORY_INTEGRATION_ENABLED = String(config.features?.orparMemory ?? false);

        // SystemLLM disabled by default when not configured
        if (!config.llm?.systemLlm) {
            env.SYSTEMLLM_ENABLED = 'false';
        }

        return env;
    }

    /**
     * Write a .env file from the current config to the project root.
     * This bridges ~/.mxf/config.json to the existing bun run dev / dotenv pattern.
     * The .env file is already gitignored.
     *
     * The keys this method emits are derived from ~/.mxf/config.json, so config
     * is authoritative for them: an existing key is rewritten in place (keeping
     * its position in the file) and a missing one is appended. Lines the CLI does
     * not manage — comments, blank lines, and any variable the user added
     * themselves — are preserved untouched.
     *
     * Updating in place is what makes `mxf config set server.port 3002` actually
     * take effect; appending only missing keys left the stale value in the file
     * while reporting success.
     *
     * The file holds infrastructure passwords, the JWT secret and the LLM API
     * key, so it is written owner-only (0600).
     *
     * @param projectRoot - Path to the project root where .env will be written
     */
    writeEnvFile(projectRoot: string): void {
        const envVars = this.toEnvironmentVariables();
        if (Object.keys(envVars).length === 0) {
            throw new Error('No config loaded. Run `mxf install` first.');
        }

        const envPath = path.join(projectRoot, '.env');

        // If .env already exists, update managed keys in place and append new ones
        if (fs.existsSync(envPath)) {
            const content = fs.readFileSync(envPath, { encoding: 'utf-8' });
            const lines = content.split('\n');
            const written = new Set<string>();

            const updated = lines.map((line) => {
                const trimmed = line.trim();
                // Preserve comments and blank lines exactly as they are
                if (!trimmed || trimmed.startsWith('#')) return line;

                const eqIndex = trimmed.indexOf('=');
                if (eqIndex === -1) return line;

                const key = trimmed.substring(0, eqIndex).trim();
                // Not a key we manage — leave the user's own variable alone
                if (!(key in envVars)) return line;

                written.add(key);
                return `${key}=${envVars[key]}`;
            });

            // Append any managed key that wasn't already in the file
            const missing = Object.entries(envVars).filter(([key]) => !written.has(key));
            if (missing.length > 0) {
                if (updated.length > 0 && updated[updated.length - 1].trim() !== '') {
                    updated.push('');
                }
                updated.push(`# Added by MXF CLI (${new Date().toISOString()})`);
                for (const [key, value] of missing) {
                    updated.push(`${key}=${value}`);
                }
                updated.push('');
            }

            fs.writeFileSync(envPath, updated.join('\n'), { encoding: 'utf-8', mode: 0o600 });
            // writeFileSync's mode only applies when creating the file, so an
            // existing .env keeps its old (possibly 0644) permissions unless we
            // tighten them explicitly.
            fs.chmodSync(envPath, 0o600);
            return;
        }

        // No .env exists — create a fresh one with categorized layout
        const lines: string[] = [
            '# MXF Environment Configuration',
            '# Auto-generated by MXF CLI from ~/.mxf/config.json',
            `# Created: ${new Date().toISOString()}`,
            '',
        ];

        // Group env vars by category for readability
        const categories: Record<string, string[]> = {
            '# Server': ['MXF_PORT', 'MXF_SERVER_URL', 'NODE_ENV'],
            '# Database': ['MONGODB_URI', 'MONGODB_USERNAME', 'MONGODB_PASSWORD', 'MONGODB_DATABASE'],
            '# Search': ['MEILISEARCH_HOST', 'MEILISEARCH_MASTER_KEY', 'MEILISEARCH_EMBEDDING_PROVIDER', 'MEILISEARCH_EMBEDDING_MODEL', 'MEILISEARCH_EMBEDDING_DIMENSIONS'],
            '# Cache': ['REDIS_HOST', 'REDIS_PORT', 'REDIS_PASSWORD'],
            '# Security': ['MXF_DOMAIN_KEY', 'JWT_SECRET', 'AGENT_API_KEY', 'MXP_ENCRYPTION_KEY', 'MXP_ENCRYPTION_ENABLED', 'MXP_ENCRYPTION_SALT'],
            '# Authentication': ['MXF_DEMO_ACCESS_TOKEN'],
            '# LLM Providers': ['OPENROUTER_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'XAI_API_KEY', 'GEMINI_API_KEY'],
            '# SystemLLM': ['SYSTEMLLM_ENABLED', 'SYSTEMLLM_PROVIDER', 'SYSTEMLLM_DEFAULT_MODEL'],
            '# Feature Flags': ['ENABLE_MEILISEARCH', 'ENABLE_SEMANTIC_SEARCH', 'TENSORFLOW_ENABLED', 'MEMORY_UTILITY_LEARNING_ENABLED', 'ORPAR_MEMORY_INTEGRATION_ENABLED'],
        };

        for (const [header, keys] of Object.entries(categories)) {
            const categoryLines: string[] = [];
            for (const key of keys) {
                if (envVars[key] !== undefined) {
                    categoryLines.push(`${key}=${envVars[key]}`);
                }
            }
            if (categoryLines.length > 0) {
                lines.push(header);
                lines.push(...categoryLines);
                lines.push('');
            }
        }

        // Owner-only: this file holds infra passwords, the JWT secret and the LLM API key.
        fs.writeFileSync(envPath, lines.join('\n'), { encoding: 'utf-8', mode: 0o600 });
    }

    /**
     * Validate config structure and required fields.
     * Returns validation result with specific error messages.
     */
    validate(): { valid: boolean; errors: string[] } {
        const config = this.cachedConfig || this.load();
        const errors: string[] = [];

        if (!config) {
            errors.push('Config file does not exist. Run `mxf install` to create it.');
            return { valid: false, errors };
        }

        if (config.version !== 1) {
            errors.push(`Unknown config version: ${config.version}. Expected: 1`);
        }

        // Infrastructure checks
        if (!config.infrastructure?.composeFilePath) {
            errors.push('Missing infrastructure.composeFilePath');
        }
        if (!config.infrastructure?.mongodb?.password) {
            errors.push('Missing infrastructure.mongodb.password');
        }
        if (!config.infrastructure?.meilisearch?.masterKey) {
            errors.push('Missing infrastructure.meilisearch.masterKey');
        }
        if (!config.infrastructure?.redis?.password) {
            errors.push('Missing infrastructure.redis.password');
        }

        // Credential checks
        if (!config.credentials?.domainKey || config.credentials.domainKey.length !== 64) {
            errors.push('Missing or invalid credentials.domainKey (must be 64-char hex)');
        }
        if (!config.credentials?.jwtSecret) {
            errors.push('Missing credentials.jwtSecret');
        }
        if (!config.credentials?.agentApiKey) {
            errors.push('Missing credentials.agentApiKey');
        }
        if (!config.credentials?.mxpEncryptionKey) {
            errors.push('Missing credentials.mxpEncryptionKey');
        }
        if (!config.credentials?.mxpEncryptionSalt) {
            errors.push('Missing credentials.mxpEncryptionSalt (unique per-install salt for MXP encryption)');
        }

        // Server checks
        if (!config.server?.port || config.server.port < 1 || config.server.port > 65535) {
            errors.push('Invalid server.port (must be 1-65535)');
        }

        return { valid: errors.length === 0, errors };
    }
}
