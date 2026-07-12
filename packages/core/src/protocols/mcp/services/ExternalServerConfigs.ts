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
 * @documentation https://mxf-dev.github.io/mxf/
 */

/**
 * ExternalServerConfigs.ts
 * 
 * Predefined configurations for external MCP servers that provide
 * enhanced capabilities for the hybrid MCP architecture.
 */

import * as path from 'path';
import { ExternalServerConfig } from './ExternalMcpServerManager.js';
import { getWorkspaceRoot } from '../security/McpToolPolicy.js';

/**
 * Configuration for the Calculator MCP Server
 * Provides advanced mathematical calculation capabilities
 */
export const CALCULATOR_SERVER_CONFIG: ExternalServerConfig = {
    id: 'calculator',
    name: 'Calculator Server',
    version: '1.0.0',
    description: 'Advanced mathematical calculations, symbolic math, equation solving, statistics, and matrix operations',
    command: 'npx',
    args: ['-y', '@wrtnlabs/calculator-mcp'],
    autoStart: true,
    restartOnCrash: true,
    healthCheckInterval: 30000, // 30 seconds
    maxRestartAttempts: 3,
    startupTimeout: 10000, // 10 seconds
    environmentVariables: {
        NODE_ENV: 'production'
    }
};

/**
 * Configuration for the Sequential Thinking MCP Server
 * Provides structured problem-solving and reasoning capabilities
 */
export const SEQUENTIAL_THINKING_SERVER_CONFIG: ExternalServerConfig = {
    id: 'sequential-thinking',
    name: 'Sequential Thinking Server',
    version: '0.6.2',
    description: 'Dynamic and reflective problem-solving through structured thought sequences',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-sequential-thinking'],
    autoStart: true,
    restartOnCrash: true,
    healthCheckInterval: 30000, // 30 seconds
    maxRestartAttempts: 3,
    startupTimeout: 10000, // 10 seconds
    environmentVariables: {
        NODE_ENV: 'production'
    }
};

/**
 * Configuration for the Filesystem MCP Server.
 *
 * The allowed roots are the configured workspace directory plus a scratch
 * directory. This used to pass `os.homedir()`, which handed every agent read
 * access to the entire home directory — including ~/.ssh, ~/.aws, and
 * ~/.mxf/config.json, which is where the MXF CLI stores its own credentials.
 *
 * The server only auto-starts when MXF_WORKSPACE_ROOT is set. There is no default:
 * a filesystem server needs an operator to say which directory agents may touch,
 * and the previous default answered that question with "all of them".
 */
export const FILESYSTEM_SERVER_CONFIG: ExternalServerConfig = {
    id: 'filesystem',
    name: 'Filesystem Server',
    version: '0.6.0',
    description: 'File operations scoped to the configured workspace directory',
    command: 'npx',
    // The MCP filesystem server takes its allowed directories as positional args.
    args: [
        '-y',
        '@modelcontextprotocol/server-filesystem',
        // Empty when unset. getFilesystemServerConfig() below is what callers
        // should use — it fails fast rather than spawning a server with no root.
        getWorkspaceRoot() ?? '',
        '/tmp/mcp-workspace'
    ].filter(arg => arg.length > 0),
    // Only auto-start when a workspace is configured.
    autoStart: getWorkspaceRoot() !== undefined,
    restartOnCrash: true,
    healthCheckInterval: 30000,
    maxRestartAttempts: 3,
    startupTimeout: 10000,
    environmentVariables: {
        NODE_ENV: 'production'
    }
};

/**
 * Configuration for the Git MCP Server
 * Provides Git repository reading, searching, and manipulation capabilities
 */
export const GIT_SERVER_CONFIG: ExternalServerConfig = {
    id: 'git',
    name: 'Git Server',
    version: '0.6.0',
    description: 'Git repository reading, searching, and manipulation',
    command: 'uvx',
    args: ['mcp-server-git', '--repository', process.cwd()],
    autoStart: false, // DISABLED: MCP protocol integration issues
    restartOnCrash: true,
    healthCheckInterval: 30000,
    maxRestartAttempts: 3,
    startupTimeout: 20000, // Increased timeout for Python server initialization
    environmentVariables: {
        NODE_ENV: 'production',
        PATH: `${process.env.HOME}/.local/bin:${process.env.PATH}`
    }
};

/**
 * Configuration for the Fetch MCP Server
 * Provides web content fetching and conversion capabilities
 */
export const FETCH_SERVER_CONFIG: ExternalServerConfig = {
    id: 'fetch',
    name: 'Fetch Server', 
    version: '0.6.0',
    description: 'Web content fetching and HTML-to-markdown conversion',
    command: 'uvx',
    args: ['mcp-server-fetch'],
    autoStart: false, // DISABLED: MCP protocol integration issues
    restartOnCrash: true,
    healthCheckInterval: 30000,
    maxRestartAttempts: 3,
    startupTimeout: 20000, // Increased timeout for Python server initialization
    environmentVariables: {
        NODE_ENV: 'production',
        PATH: `${process.env.HOME}/.local/bin:${process.env.PATH}`
    }
};

/**
 * Configuration for the Memory MCP Server
 * Provides knowledge graph-based persistent memory system
 */
export const MEMORY_SERVER_CONFIG: ExternalServerConfig = {
    id: 'memory',
    name: 'Memory Server',
    version: '0.6.0', 
    description: 'Knowledge graph-based persistent memory system',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-memory'],
    autoStart: true, // Keep enabled - this one works
    restartOnCrash: true,
    healthCheckInterval: 30000,
    maxRestartAttempts: 3,
    startupTimeout: 10000,
    environmentVariables: {
        NODE_ENV: 'production'
    }
};

/**
 * Configuration for the MongoDB Lens MCP Server.
 *
 * OFF by default, and it must stay that way unless you have pointed it somewhere
 * safe.
 *
 * This server hands agents a query interface to whatever MONGODB_URI names. In a
 * default MXF deployment that is the framework's own database — the one holding
 * the users collection, personal access tokens, and agent API keys. It used to
 * auto-start against exactly that.
 *
 * To enable it:
 *   1. Create a MongoDB user with read-only access to a SEPARATE database — not
 *      the one MXF stores its credentials in.
 *   2. Set MONGODB_LENS_URI to that user's connection string.
 *   3. Set autoStart, or start the server explicitly through the hybrid MCP API.
 *
 * MONGODB_LENS_URI is deliberately a different variable from MONGODB_URI, so that
 * enabling this server cannot silently reuse the framework's own credentials.
 */
export const MONGODB_LENS_SERVER_CONFIG: ExternalServerConfig = {
    id: 'mongodb-lens',
    name: 'MongoDB Lens Server',
    version: '1.0.0',
    description: 'Schema analysis, query optimization and aggregation building against a configured MongoDB database',
    command: 'npx',
    args: ['-y', 'mongodb-lens'],
    // Opt-in only. Never point this at the database that holds MXF's users, PATs
    // and API keys.
    autoStart: false,
    restartOnCrash: true,
    healthCheckInterval: 30000,
    maxRestartAttempts: 3,
    startupTimeout: 15000, // MongoDB connection may take longer
    environmentVariables: {
        NODE_ENV: 'production',
        // Validated non-empty at spawn time by ExternalMcpServerManager, so starting
        // this server without MONGODB_LENS_URI set fails with a clear error instead
        // of falling back to the framework's own database.
        MONGODB_URI: process.env.MONGODB_LENS_URI ?? ''
    }
};

/**
 * Configuration for the Time MCP Server
 * Provides time and timezone conversion capabilities
 */
export const TIME_SERVER_CONFIG: ExternalServerConfig = {
    id: 'time',
    name: 'Time Server',
    version: '0.6.0',
    description: 'Time and timezone conversion capabilities',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-time'],
    autoStart: false, // Disable until package is available
    restartOnCrash: true,
    healthCheckInterval: 30000,
    maxRestartAttempts: 3,
    startupTimeout: 10000,
    environmentVariables: {
        NODE_ENV: 'production'
    }
};

/**
 * Configuration for the n8n MCP Server
 * Provides workflow automation with 400+ service integrations
 * Supports both self-hosted (free) and cloud deployments
 */
export const N8N_SERVER_CONFIG: ExternalServerConfig = {
    id: 'n8n',
    name: 'n8n Workflow Automation',
    version: '1.0.0',
    description: 'Workflow automation and management with 400+ integrations including Gmail, Slack, Airtable, Notion, GitHub, Stripe, and more',
    command: 'npx',
    args: ['-y', 'n8n-mcp@latest'],
    autoStart: true, // Enable for workflow automation capabilities
    restartOnCrash: true,
    healthCheckInterval: 30000,
    maxRestartAttempts: 3,
    startupTimeout: 30000, // Increased to 30 seconds - n8n needs time to authenticate and initialize
    environmentVariables: {
        NODE_ENV: 'production',
        // n8n instance URL - defaults to local self-hosted, can be cloud URL (must include /api/v1 path)
        N8N_API_URL: process.env.N8N_API_URL || 'http://localhost:5678/api/v1',
        // n8n API key - required for authentication
        N8N_API_KEY: process.env.N8N_API_KEY || '',
        // Optional webhook authentication
        N8N_WEBHOOK_USERNAME: process.env.N8N_WEBHOOK_USERNAME || '',
        N8N_WEBHOOK_PASSWORD: process.env.N8N_WEBHOOK_PASSWORD || '',
        // Webhook security mode: 'strict' (default), 'moderate' (allows localhost), 'disabled' (allows all)
        // Set to 'moderate' for local development to allow localhost webhooks while blocking private networks
        WEBHOOK_SECURITY_MODE: process.env.WEBHOOK_SECURITY_MODE || 'moderate'
    }
};

/**
 * Configuration for the SuperCollider Wave MCP Server
 * Provides real-time audio synthesis through natural language
 * Requires SuperCollider to be installed locally
 */
export const WAVE_SERVER_CONFIG: ExternalServerConfig = {
    id: 'wave',
    name: 'SuperCollider Wave Server',
    version: '1.0.0',
    description: 'Real-time audio synthesis and sound generation through natural language with SuperCollider integration',
    command: 'npx',
    args: ['-y', 'mcp-wave'],
    autoStart: false, // Disabled by default - requires SuperCollider installation
    restartOnCrash: true,
    healthCheckInterval: 30000,
    maxRestartAttempts: 3,
    startupTimeout: 15000, // SuperCollider initialization may take time
    environmentVariables: {
        NODE_ENV: 'production',
        // Optional: Override SuperCollider installation path
        // SCSYNTH_PATH: process.env.SCSYNTH_PATH || ''
    }
};


/**
 * Array of all external MCP server configurations
 * Controls which external servers are available to the framework
 */
export const EXTERNAL_SERVER_CONFIGS: ExternalServerConfig[] = [
    CALCULATOR_SERVER_CONFIG,
    SEQUENTIAL_THINKING_SERVER_CONFIG,
    FILESYSTEM_SERVER_CONFIG,
    MEMORY_SERVER_CONFIG,
    MONGODB_LENS_SERVER_CONFIG,
    N8N_SERVER_CONFIG,
    WAVE_SERVER_CONFIG
    // TIME_SERVER_CONFIG,      // Disabled: Package not available
    // GIT_SERVER_CONFIG,      // DISABLED: MCP protocol integration issues
    // FETCH_SERVER_CONFIG,    // DISABLED: MCP protocol integration issues (replaced by internal web tools)
];

/**
 * The filesystem server's configuration, or a thrown error explaining why it
 * cannot be started.
 *
 * Use this instead of FILESYSTEM_SERVER_CONFIG when starting the server on
 * purpose: it refuses to hand out a filesystem server with no configured root,
 * rather than spawning one whose allowed directories are whatever happens to be
 * left in the args array.
 *
 * @throws Error when MXF_WORKSPACE_ROOT is not set
 */
export const getFilesystemServerConfig = (): ExternalServerConfig => {
    const workspaceRoot = getWorkspaceRoot();

    if (!workspaceRoot) {
        throw new Error(
            'The filesystem MCP server needs a workspace directory, but MXF_WORKSPACE_ROOT is not set. ' +
            'Set it to the directory agents may read and write ' +
            '(for example: MXF_WORKSPACE_ROOT=/Users/you/projects/my-app). ' +
            'It has no default — the previous default was your home directory, which exposed ' +
            '~/.ssh, ~/.aws and ~/.mxf/config.json to every agent.'
        );
    }

    return {
        ...FILESYSTEM_SERVER_CONFIG,
        args: [
            '-y',
            '@modelcontextprotocol/server-filesystem',
            workspaceRoot,
            '/tmp/mcp-workspace'
        ],
        autoStart: true
    };
};

/**
 * Get configurations for auto-start servers only
 */
export const getAutoStartConfigs = (): ExternalServerConfig[] => {
    return Object.values(EXTERNAL_SERVER_CONFIGS).filter(config => config.autoStart);
};

/**
 * Get configuration by server ID
 */
export const getServerConfigById = (serverId: string): ExternalServerConfig | undefined => {
    return EXTERNAL_SERVER_CONFIGS.find(config => config.id === serverId);
};

/**
 * Categories for external servers (used by meta-tool)
 */
export const EXTERNAL_SERVER_CATEGORIES = {
    CALCULATION: 'calculation',  // Changed from 'computation' to match TOOL_CATEGORIES
    REASONING: 'reasoning',
    INFRASTRUCTURE: 'infrastructure',
    WEB: 'web',
    MEMORY: 'memory',
    VERSION_CONTROL: 'version-control',
    UTILITY: 'utility',
    DATABASE: 'database',
    CACHING: 'caching',
    AUTOMATION: 'automation',
    AUDIO: 'audio'
} as const;

/**
 * Map servers to categories for meta-tool filtering
 */
export const getExternalServerCategory = (serverId: string): string => {
    switch (serverId) {
        case 'calculator':
            return EXTERNAL_SERVER_CATEGORIES.CALCULATION;
        case 'sequential-thinking':
            return EXTERNAL_SERVER_CATEGORIES.REASONING;
        case 'filesystem':
        case 'time':
            return EXTERNAL_SERVER_CATEGORIES.INFRASTRUCTURE;
        case 'fetch':
            return EXTERNAL_SERVER_CATEGORIES.WEB;
        case 'memory':
            return EXTERNAL_SERVER_CATEGORIES.MEMORY;
        case 'git':
            return EXTERNAL_SERVER_CATEGORIES.VERSION_CONTROL;
        case 'mongodb-lens':
            return EXTERNAL_SERVER_CATEGORIES.DATABASE;
        case 'n8n':
            return EXTERNAL_SERVER_CATEGORIES.AUTOMATION;
        case 'wave':
            return EXTERNAL_SERVER_CATEGORIES.AUDIO;
        default:
            return EXTERNAL_SERVER_CATEGORIES.UTILITY;
    }
};
