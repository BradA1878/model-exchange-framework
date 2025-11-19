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
 * ExternalServerConfigs.ts
 * 
 * Predefined configurations for external MCP servers that provide
 * enhanced capabilities for the hybrid MCP architecture.
 */

import * as path from 'path';
import { ExternalServerConfig } from './ExternalMcpServerManager';

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
 * Configuration for the Filesystem MCP Server
 * Provides secure file operations with access controls
 * 
 * NOTE: Configured to allow access to project root directory.
 * The server receives the current working directory as an allowed path.
 */
export const FILESYSTEM_SERVER_CONFIG: ExternalServerConfig = {
    id: 'filesystem',
    name: 'Filesystem Server',
    version: '0.6.0',
    description: 'Secure file operations with configurable access controls',
    command: 'npx',
    // Pass project root as allowed directory - MCP filesystem server accepts multiple paths
    args: [
        '-y', 
        '@modelcontextprotocol/server-filesystem',
        process.cwd(),  // Allow access to entire project directory
        '/tmp'          // Also allow /tmp for temporary files
    ],
    autoStart: true, // Enable auto-start for file operations
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
 * Configuration for the MongoDB Lens MCP Server
 * Provides database schema analysis, query optimization, and MongoDB intelligence
 */
export const MONGODB_LENS_SERVER_CONFIG: ExternalServerConfig = {
    id: 'mongodb-lens',
    name: 'MongoDB Lens Server',
    version: '1.0.0',
    description: 'Database schema analysis, query optimization, aggregation pipeline building, and MongoDB intelligence',
    command: 'npx',
    args: ['-y', 'mongodb-lens'],
    autoStart: true, // ENABLED: Real package exists (furey/mongodb-lens)
    restartOnCrash: true,
    healthCheckInterval: 30000,
    maxRestartAttempts: 3,
    startupTimeout: 15000, // MongoDB connection may take longer
    environmentVariables: {
        NODE_ENV: 'production',
        MONGODB_URI: process.env.MONGODB_URI || 'mongodb://localhost:27017/mxf'
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
