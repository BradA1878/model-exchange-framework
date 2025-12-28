#!/usr/bin/env ts-node
/**
 * Copyright 2024 Brad Anderson
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for details
 * @author Brad Anderson <BradA1878@pm.me>
 */
/**
 * MXF CLI - Command Line Interface for Model Exchange Framework
 *
 * Tool for managing users, channels, and agent keys.
 *
 * Commands:
 *   setup:interactive  - Interactive setup (RECOMMENDED) - prompts for all configuration
 *   user:create        - Create a user account
 *   channel:create     - Create a channel
 *   key:generate       - Generate agent keys for a channel
 *   setup              - Complete setup from config file
 * 
 * Security:
 *   - Credentials are written to .env format (NOT JSON files)
 *   - Config files support ${VAR_NAME} or $VAR_NAME for environment variables
 *   - Generated .env variables use format: MXF_CHANNELID_AGENTID_KEY_ID
 * 
 * Interactive Usage (Recommended):
 *   npx ts-node src/sdk/cli/mxf-cli.ts setup:interactive
 *   # Prompts for email, password, project name, and agent names
 *   # Creates everything and saves to .env automatically
 * 
 * Manual Usage:
 *   npx ts-node src/sdk/cli/mxf-cli.ts user:create --email admin@company.com --password secret123
 *   npx ts-node src/sdk/cli/mxf-cli.ts channel:create --id my-channel --name "My Channel"
 *   npx ts-node src/sdk/cli/mxf-cli.ts key:generate --channel my-channel --agents agent1,agent2 --output .env
 */

import { Command } from 'commander';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';
import prompts from 'prompts';

// Load environment variables from .env file
dotenv.config();

// Default API URL
const DEFAULT_PORT = process.env.MXF_PORT || '3001';
const DEFAULT_API_URL = process.env.MXF_API_URL || `http://localhost:${DEFAULT_PORT}/api`;

// API Response types
interface ApiResponse {
    success: boolean;
    message?: string;
    data?: any;
    token?: string;
}

// Color codes for terminal output
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    cyan: '\x1b[36m'
};

/**
 * Log success message
 */
const logSuccess = (message: string): void => {
    console.log(`${colors.green}✓${colors.reset} ${message}`);
};

/**
 * Log error message
 */
const logError = (message: string): void => {
    console.error(`${colors.red}✗${colors.reset} ${message}`);
};

/**
 * Log info message
 */
const logInfo = (message: string): void => {
    console.log(`${colors.cyan}ℹ${colors.reset} ${message}`);
};

/**
 * Log warning message
 */
const logWarning = (message: string): void => {
    console.log(`${colors.yellow}⚠${colors.reset} ${message}`);
};

/**
 * Generate .env formatted content from credentials
 */
const generateEnvContent = (credentials: Record<string, { keyId: string; secretKey: string }>, channelId: string): string => {
    const lines: string[] = [];
    const channelPrefix = `MXF_${channelId.toUpperCase().replace(/-/g, '_')}`;
    
    lines.push(`# Agent credentials for channel: ${channelId}`);
    lines.push(`# Generated: ${new Date().toISOString()}`);
    
    for (const [agentId, creds] of Object.entries(credentials)) {
        const agentPrefix = agentId.toUpperCase().replace(/-/g, '_');
        lines.push(`${channelPrefix}_${agentPrefix}_KEY_ID="${creds.keyId}"`);
        lines.push(`${channelPrefix}_${agentPrefix}_SECRET_KEY="${creds.secretKey}"`);
    }
    
    return lines.join('\n');
};

/**
 * Resolve environment variables in config values
 * Supports: ${VAR_NAME} or $VAR_NAME syntax
 */
const resolveEnvVars = (value: any): any => {
    if (typeof value === 'string') {
        // Support ${VAR_NAME} syntax
        const envVarMatch = value.match(/^\$\{([A-Z_][A-Z0-9_]*)\}$/);
        if (envVarMatch) {
            const envValue = process.env[envVarMatch[1]];
            if (!envValue) {
                logWarning(`Environment variable ${envVarMatch[1]} is not set, using empty string`);
                return '';
            }
            return envValue;
        }
        
        // Support $VAR_NAME syntax
        if (value.startsWith('$') && !value.includes('{')) {
            const varName = value.substring(1);
            const envValue = process.env[varName];
            if (!envValue) {
                logWarning(`Environment variable ${varName} is not set, using empty string`);
                return '';
            }
            return envValue;
        }
        
        // Inline replacement: "Hello ${NAME}" -> "Hello John"
        return value.replace(/\$\{([A-Z_][A-Z0-9_]*)\}/g, (_, varName) => {
            return process.env[varName] || '';
        });
    }
    
    if (typeof value === 'object' && value !== null) {
        if (Array.isArray(value)) {
            return value.map(resolveEnvVars);
        }
        const resolved: any = {};
        for (const [key, val] of Object.entries(value)) {
            resolved[key] = resolveEnvVars(val);
        }
        return resolved;
    }
    
    return value;
};

/**
 * Create user account
 */
const createUser = async (options: {
    email: string;
    password: string;
    username?: string;
    apiUrl?: string;
}): Promise<void> => {
    const apiUrl = options.apiUrl || DEFAULT_API_URL;
    const username = options.username || options.email.split('@')[0];

    try {
        logInfo(`Creating user account: ${options.email}`);

        const response = await axios.post<ApiResponse>(`${apiUrl}/users/register`, {
            username,
            email: options.email,
            password: options.password
        });

        if (response.data.success) {
            logSuccess(`User created successfully: ${options.email}`);
            console.log(`   Username: ${username}`);
            console.log(`   Email: ${options.email}`);
        } else {
            logError(`Failed to create user: ${response.data.message || 'Unknown error'}`);
        }
    } catch (error: any) {
        const errorMessage = error.response?.data?.message || error.message;
        
        // If user already exists, just warn and continue
        if (errorMessage.includes('already exists')) {
            logWarning(`User already exists: ${options.email} (continuing...)`);
        } else {
            logError(`Failed to create user: ${errorMessage}`);
            process.exit(1);
        }
    }
};

/**
 * Create channel
 */
const createChannel = async (options: {
    id: string;
    name: string;
    description?: string;
    email: string;
    password: string;
    isPrivate?: boolean;
    apiUrl?: string;
}): Promise<void> => {
    const apiUrl = options.apiUrl || DEFAULT_API_URL;

    try {
        logInfo(`Authenticating user: ${options.email}`);

        // Login to get JWT token (username field accepts email or username)
        const loginResponse = await axios.post<{ success: boolean; token?: string }>(`${apiUrl}/users/login`, {
            username: options.email,
            password: options.password
        });

        if (!loginResponse.data.success || !loginResponse.data.token) {
            logError('Authentication failed');
            process.exit(1);
        }

        const jwtToken = loginResponse.data.token;
        const authConfig = {
            headers: { 'Authorization': `Bearer ${jwtToken}` }
        };

        logInfo(`Creating channel: ${options.id}`);

        const channelResponse = await axios.post<{ success: boolean }>(
            `${apiUrl}/channels`,
            {
                channelId: options.id,
                name: options.name,
                description: options.description || '',
                isPrivate: options.isPrivate !== false,
                requireApproval: false,
                allowAnonymous: false,
                maxAgents: 100
            },
            authConfig
        );

        if (channelResponse.data.success) {
            logSuccess(`Channel created successfully: ${options.id}`);
            console.log(`   Channel ID: ${options.id}`);
            console.log(`   Name: ${options.name}`);
            console.log(`   Private: ${options.isPrivate !== false}`);
        } else {
            logError('Failed to create channel');
        }
    } catch (error: any) {
        logError(`Failed to create channel: ${error.response?.data?.message || error.message}`);
        process.exit(1);
    }
};

/**
 * Generate agent keys
 */
const generateKeys = async (options: {
    channel: string;
    agents: string;
    email: string;
    password: string;
    output?: string;
    apiUrl?: string;
}): Promise<void> => {
    const apiUrl = options.apiUrl || DEFAULT_API_URL;
    const agentIds = options.agents.split(',').map(id => id.trim());

    try {
        logInfo(`Authenticating user: ${options.email}`);

        // Login to get JWT token (username field accepts email or username)
        const loginResponse = await axios.post<{ success: boolean; token?: string }>(`${apiUrl}/users/login`, {
            username: options.email,
            password: options.password
        });

        if (!loginResponse.data.success || !loginResponse.data.token) {
            logError('Authentication failed');
            process.exit(1);
        }

        const jwtToken = loginResponse.data.token;
        const authConfig = {
            headers: { 'Authorization': `Bearer ${jwtToken}` }
        };

        logInfo(`Generating keys for ${agentIds.length} agent(s)`);

        const credentials: Record<string, { keyId: string; secretKey: string }> = {};

        for (const agentId of agentIds) {
            const keyResponse = await axios.post<{
                success: boolean;
                data?: { keyId: string; secretKey: string };
            }>(
                `${apiUrl}/channel-keys`,
                {
                    channelId: options.channel,
                    name: `${agentId} Key`,
                    expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString() // 1 year
                },
                authConfig
            );

            if (keyResponse.data.success && keyResponse.data.data) {
                credentials[agentId] = {
                    keyId: keyResponse.data.data.keyId,
                    secretKey: keyResponse.data.data.secretKey
                };
                logSuccess(`Generated key for agent: ${agentId}`);
                console.log(`   Key ID: ${keyResponse.data.data.keyId}`);
            } else {
                logError(`Failed to generate key for agent: ${agentId}`);
            }
        }

        // Output credentials to .env format
        if (options.output) {
            const outputPath = path.resolve(options.output);
            const envContent = generateEnvContent(credentials, options.channel);
            
            // Append to .env file (or create if doesn't exist)
            if (fs.existsSync(outputPath)) {
                const existingContent = fs.readFileSync(outputPath, 'utf-8');
                // Check if channel credentials already exist
                const channelPrefix = `MXF_${options.channel.toUpperCase().replace(/-/g, '_')}`;
                if (existingContent.includes(channelPrefix)) {
                    logWarning(`Credentials for channel '${options.channel}' already exist in ${outputPath}`);
                    logWarning('Remove existing entries or use a different output file.');
                } else {
                    fs.appendFileSync(outputPath, '\n' + envContent);
                    logSuccess(`Credentials appended to: ${outputPath}`);
                }
            } else {
                fs.writeFileSync(outputPath, envContent);
                logSuccess(`Credentials saved to: ${outputPath}`);
            }
            
            // Show what was written
            console.log('\n' + colors.bright + 'Environment Variables Added:' + colors.reset);
            console.log(envContent);
        } else {
            console.log('\n' + colors.bright + 'Generated Credentials (.env format):' + colors.reset);
            console.log(generateEnvContent(credentials, options.channel));
        }
    } catch (error: any) {
        logError(`Failed to generate keys: ${error.response?.data?.message || error.message}`);
        process.exit(1);
    }
};

/**
 * Interactive setup - prompts user for all information
 */
const interactiveSetup = async (options: {
    output?: string;
    apiUrl?: string;
}): Promise<void> => {
    const apiUrl = options.apiUrl || DEFAULT_API_URL;

    console.log('');
    console.log(colors.bright + '🚀 MXF Interactive Setup' + colors.reset);
    console.log('This will create a user account, channel, and agent keys.');
    console.log('');

    try {
        // Prompt for user information
        const userResponses = await prompts([
            {
                type: 'text',
                name: 'email',
                message: 'User email:',
                validate: (value: string): boolean | string => value.includes('@') || 'Please enter a valid email'
            },
            {
                type: 'password',
                name: 'password',
                message: 'User password:',
                validate: (value: string): boolean | string => value.length >= 6 || 'Password must be at least 6 characters'
            },
            {
                type: 'text',
                name: 'username',
                message: 'Username:',
                initial: (prev: string): string => prev.split('@')[0]
            }
        ]);

        if (!userResponses.email || !userResponses.password) {
            logError('Setup cancelled');
            process.exit(1);
        }

        // Prompt for channel/project information
        const projectResponses = await prompts([
            {
                type: 'text',
                name: 'channelId',
                message: 'Project/Channel ID (lowercase, hyphens):',
                validate: (value: string): boolean | string => /^[a-z0-9-]+$/.test(value) || 'Use lowercase letters, numbers, and hyphens only'
            },
            {
                type: 'text',
                name: 'channelName',
                message: 'Project/Channel name:',
                initial: (prev: string): string => prev.split('-').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
            },
            {
                type: 'text',
                name: 'description',
                message: 'Description (optional):',
                initial: ''
            }
        ]);

        if (!projectResponses.channelId) {
            logError('Setup cancelled');
            process.exit(1);
        }

        // Prompt for agents
        const agentResponses = await prompts([
            {
                type: 'list',
                name: 'agents',
                message: 'Agent names (comma-separated):',
                separator: ',',
                validate: (value: string[]): boolean | string => value.length > 0 || 'Please enter at least one agent name'
            }
        ]);

        if (!agentResponses.agents || agentResponses.agents.length === 0) {
            logError('Setup cancelled');
            process.exit(1);
        }

        console.log('');
        logInfo('Starting MXF setup...');
        console.log('');

        // Step 1: Create user
        await createUser({
            email: userResponses.email,
            password: userResponses.password,
            username: userResponses.username || userResponses.email.split('@')[0],
            apiUrl
        });
        console.log('');

        // Step 2: Create channel
        await createChannel({
            id: projectResponses.channelId,
            name: projectResponses.channelName,
            description: projectResponses.description,
            email: userResponses.email,
            password: userResponses.password,
            isPrivate: false,
            apiUrl
        });
        console.log('');

        // Step 3: Generate agent keys
        await generateKeys({
            channel: projectResponses.channelId,
            agents: agentResponses.agents.join(','),
            email: userResponses.email,
            password: userResponses.password,
            output: options.output,
            apiUrl
        });

        // Step 4: Write user credentials to .env file
        if (options.output) {
            const outputPath = path.resolve(options.output);
            const userEnvContent = [
                '',
                '# User credentials for MXF authentication',
                `# Generated: ${new Date().toISOString()}`,
                `MXF_USERNAME="${userResponses.email}"`,
                `MXF_PASSWORD="${userResponses.password}"`
            ].join('\n');
            
            // Check if credentials already exist
            if (fs.existsSync(outputPath)) {
                const existingContent = fs.readFileSync(outputPath, 'utf-8');
                if (existingContent.includes('MXF_USERNAME') || existingContent.includes('MXF_PASSWORD')) {
                    logWarning('User credentials (MXF_USERNAME/MXF_PASSWORD) already exist in .env file');
                } else {
                    fs.appendFileSync(outputPath, '\n' + userEnvContent);
                    logSuccess('User credentials added to .env file');
                }
            } else {
                fs.writeFileSync(outputPath, userEnvContent);
                logSuccess('User credentials saved to .env file');
            }
        }

        console.log('');
        logSuccess('✨ Setup completed successfully!');
        console.log('');
        logInfo(`Channel ID: ${projectResponses.channelId}`);
        logInfo(`Agents: ${agentResponses.agents.join(', ')}`);
        logInfo(`Credentials saved to: ${options.output || '.env'}`);
        console.log('');
    } catch (error: any) {
        logError(`Setup failed: ${error.message}`);
        process.exit(1);
    }
};

/**
 * Complete setup from config file
 */
const setup = async (options: {
    config: string;
    output?: string;
    apiUrl?: string;
}): Promise<void> => {
    const apiUrl = options.apiUrl || DEFAULT_API_URL;

    try {
        // Load config file
        let configPath = path.resolve(options.config);
        
        // If config file doesn't exist, try the .example file
        if (!fs.existsSync(configPath)) {
            const examplePath = configPath + '.example';
            if (fs.existsSync(examplePath)) {
                logWarning(`Config file not found: ${configPath}`);
                logInfo(`Using example config file: ${examplePath}`);
                logWarning('⚠️  Please update the credentials in the example file before running setup!');
                configPath = examplePath;
            } else {
                logError(`Config file not found: ${configPath}`);
                logError(`Example file also not found: ${examplePath}`);
                process.exit(1);
            }
        }

        const rawConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        
        // Resolve environment variables in config
        const config = resolveEnvVars(rawConfig);

        logInfo('Starting MXF setup from config file');
        console.log('');

        // Step 1: Create user
        if (config.user) {
            await createUser({
                email: config.user.email,
                password: config.user.password,
                username: config.user.username,
                apiUrl
            });
            console.log('');
        }

        // Step 2: Create channel
        if (config.channel) {
            await createChannel({
                id: config.channel.id,
                name: config.channel.name,
                description: config.channel.description,
                email: config.user.email,
                password: config.user.password,
                isPrivate: config.channel.isPrivate,
                apiUrl
            });
            console.log('');
        }

        // Step 3: Generate agent keys
        if (config.agents && config.agents.length > 0) {
            await generateKeys({
                channel: config.channel.id,
                agents: config.agents.join(','),
                email: config.user.email,
                password: config.user.password,
                output: options.output,
                apiUrl
            });
        }

        // Step 4: Write user credentials to .env file if output is specified
        if (options.output && config.user) {
            const outputPath = path.resolve(options.output);
            const userEnvContent = [
                '',
                '# User credentials for MXF authentication',
                `# Generated: ${new Date().toISOString()}`,
                `MXF_USERNAME="${config.user.email}"`,
                `MXF_PASSWORD="${config.user.password}"`
            ].join('\n');
            
            // Check if credentials already exist
            if (fs.existsSync(outputPath)) {
                const existingContent = fs.readFileSync(outputPath, 'utf-8');
                if (existingContent.includes('MXF_USERNAME') || existingContent.includes('MXF_PASSWORD')) {
                    logWarning('User credentials (MXF_USERNAME/MXF_PASSWORD) already exist in .env file');
                } else {
                    fs.appendFileSync(outputPath, '\n' + userEnvContent);
                    logSuccess('User credentials added to .env file');
                }
            } else {
                fs.writeFileSync(outputPath, userEnvContent);
                logSuccess('User credentials saved to .env file');
            }
        }

        console.log('');
        logSuccess('Setup completed successfully!');
    } catch (error: any) {
        logError(`Setup failed: ${error.message}`);
        process.exit(1);
    }
};

// Create CLI program
const program = new Command();

program
    .name('mxf')
    .description('Model Exchange Framework - CLI Tool')
    .version('1.0.0');

// User commands
program
    .command('user:create')
    .description('Create a user account')
    .requiredOption('-e, --email <email>', 'User email')
    .requiredOption('-p, --password <password>', 'User password')
    .option('-u, --username <username>', 'Username (defaults to email prefix)')
    .option('-a, --api-url <url>', 'API URL', DEFAULT_API_URL)
    .action(createUser);

// Channel commands
program
    .command('channel:create')
    .description('Create a channel')
    .requiredOption('-i, --id <id>', 'Channel ID')
    .requiredOption('-n, --name <name>', 'Channel name')
    .requiredOption('-e, --email <email>', 'User email (for authentication)')
    .requiredOption('-p, --password <password>', 'User password')
    .option('-d, --description <description>', 'Channel description')
    .option('--public', 'Make channel public (default: private)')
    .option('-a, --api-url <url>', 'API URL', DEFAULT_API_URL)
    .action((options) => {
        createChannel({
            ...options,
            isPrivate: !options.public
        });
    });

// Key commands
program
    .command('key:generate')
    .description('Generate agent keys for a channel')
    .requiredOption('-c, --channel <id>', 'Channel ID')
    .requiredOption('--agents <agents>', 'Comma-separated list of agent IDs')
    .requiredOption('-e, --email <email>', 'User email (for authentication)')
    .requiredOption('-p, --password <password>', 'User password')
    .option('-o, --output <file>', 'Output file for credentials (.env format)', '.env')
    .option('-a, --api-url <url>', 'API URL', DEFAULT_API_URL)
    .action(generateKeys);

// Setup command (config file based)
program
    .command('setup')
    .description('Complete setup from config file')
    .requiredOption('-c, --config <file>', 'Config file path (JSON)')
    .option('-o, --output <file>', 'Output file for credentials (.env format)', '.env')
    .option('-a, --api-url <url>', 'API URL', DEFAULT_API_URL)
    .action(setup);

// Interactive setup command (recommended)
program
    .command('setup:interactive')
    .alias('init')
    .description('Interactive setup - prompts for all configuration')
    .option('-o, --output <file>', 'Output file for credentials (.env format)', '.env')
    .option('-a, --api-url <url>', 'API URL', DEFAULT_API_URL)
    .action(interactiveSetup);

// Parse command line arguments
program.parse(process.argv);
