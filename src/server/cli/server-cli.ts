#!/usr/bin/env ts-node
/**
 * Copyright 2024 Brad Anderson
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for details
 * @author Brad Anderson <BradA1878@pm.me>
 */
/**
 * MXF Server CLI - Server Operator Tools
 * 
 * Commands for MXF server operators only (not for SDK users).
 * 
 * Commands:
 *   domain-key:generate  - Generate a new domain key for SDK authentication
 *   domain-key:show      - Display current domain key
 *   user:create          - Create a user account
 *   user:list            - List all users
 *   demo:setup           - Create demo user with standard credentials (RECOMMENDED for demos)
 * 
 * Usage:
 *   npx ts-node src/server/cli/server-cli.ts domain-key:generate
 *   npx ts-node src/server/cli/server-cli.ts demo:setup
 *   npx ts-node src/server/cli/server-cli.ts user:create --email admin@company.com --password secret123
 */

import { Command } from 'commander';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

// Default API URL
const DEFAULT_PORT = process.env.MXF_PORT || '3001';
const DEFAULT_API_URL = process.env.MXF_API_URL || `http://localhost:${DEFAULT_PORT}/api`;

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
 * Generate a secure random domain key
 */
const generateDomainKey = (): string => {
    return crypto.randomBytes(32).toString('hex');
};

/**
 * Get path to .env file
 */
const getEnvPath = (): string => {
    return path.join(process.cwd(), '.env');
};

/**
 * Read .env file content
 */
const readEnvFile = (): string => {
    const envPath = getEnvPath();
    if (!fs.existsSync(envPath)) {
        return '';
    }
    return fs.readFileSync(envPath, 'utf-8');
};

/**
 * Write .env file content
 */
const writeEnvFile = (content: string): void => {
    const envPath = getEnvPath();
    fs.writeFileSync(envPath, content, 'utf-8');
};

/**
 * Update or add env variable in .env file
 */
const updateEnvVariable = (key: string, value: string): void => {
    let envContent = readEnvFile();
    const regex = new RegExp(`^${key}=.*$`, 'm');
    
    if (regex.test(envContent)) {
        // Update existing variable
        envContent = envContent.replace(regex, `${key}=${value}`);
    } else {
        // Add new variable
        if (envContent && !envContent.endsWith('\n')) {
            envContent += '\n';
        }
        envContent += `${key}=${value}\n`;
    }
    
    writeEnvFile(envContent);
};

// ============================================================================
// DOMAIN KEY COMMANDS
// ============================================================================

/**
 * Generate domain key command
 */
const domainKeyGenerate = (): void => {
    console.log('');
    console.log('═'.repeat(80));
    console.log('Generate SDK Domain Key');
    console.log('═'.repeat(80));
    console.log('');
    
    const newKey = generateDomainKey();
    
    // Update .env file
    updateEnvVariable('MXF_DOMAIN_KEY', newKey);
    
    console.log('');
    logSuccess('Domain key generated and saved to .env file');
    console.log('');
    console.log(`${colors.bright}Domain Key:${colors.reset} ${newKey}`);
    console.log('');
    console.log('⚠️  IMPORTANT:');
    console.log('   1. Keep this key secure - it authenticates SDK connections');
    console.log('   2. Provide this key to SDK users via secure channel');
    console.log('   3. Restart the MXF server for changes to take effect');
    console.log('');
    console.log('SDK users should set this in their environment:');
    console.log(`   ${colors.cyan}MXF_DOMAIN_KEY=${newKey}${colors.reset}`);
    console.log('');
    console.log('═'.repeat(80));
    console.log('');
};

/**
 * Show current domain key command
 */
const domainKeyShow = (): void => {
    console.log('');
    console.log('═'.repeat(80));
    console.log('Current SDK Domain Key');
    console.log('═'.repeat(80));
    console.log('');
    
    const currentKey = process.env.MXF_DOMAIN_KEY;
    
    if (!currentKey || currentKey === 'change-this-to-a-secure-domain-key') {
        logWarning('No domain key configured!');
        console.log('');
        console.log('Run the following command to generate one:');
        console.log(`   ${colors.cyan}npm run server:cli -- domain-key:generate${colors.reset}`);
        console.log('');
    } else if (currentKey === 'disabled') {
        logWarning('Domain key is DISABLED');
        console.log('');
        console.log('This is insecure! Generate a proper key:');
        console.log(`   ${colors.cyan}npm run server:cli -- domain-key:generate${colors.reset}`);
        console.log('');
    } else {
        logSuccess('Domain key is configured');
        console.log('');
        console.log(`${colors.bright}Domain Key:${colors.reset} ${currentKey}`);
        console.log('');
        console.log('Provide this key to SDK users via secure channel.');
        console.log('');
    }
    
    console.log('═'.repeat(80));
    console.log('');
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Update .env file with user credentials (legacy - kept for backward compatibility)
 */
const updateEnvFileWithCredentials = (username: string, password: string): void => {
    try {
        const envPath = path.join(process.cwd(), '.env');
        let envContent = '';

        // Read existing .env if it exists
        if (fs.existsSync(envPath)) {
            envContent = fs.readFileSync(envPath, 'utf-8');
        }

        // Parse existing .env
        const lines = envContent.split('\n');

        // Rebuild .env content
        const newLines: string[] = [];

        // Preserve existing values and comments
        lines.forEach(line => {
            const trimmed = line.trim();
            if (trimmed.startsWith('#') || !trimmed) {
                // Keep comments and empty lines
                newLines.push(line);
            } else {
                const [key] = trimmed.split('=');
                if (key && key.trim() !== 'MXF_DEMO_USERNAME' && key.trim() !== 'MXF_DEMO_PASSWORD') {
                    // Keep other env vars
                    newLines.push(line);
                }
            }
        });

        // Add demo credentials section if not already there
        if (!envContent.includes('MXF_DEMO_USERNAME') && !envContent.includes('MXF_DEMO_PASSWORD')) {
            newLines.push('');
            newLines.push('# Demo User Credentials (legacy - use MXF_DEMO_ACCESS_TOKEN instead)');
        }

        newLines.push(`MXF_DEMO_USERNAME=${username}`);
        newLines.push(`MXF_DEMO_PASSWORD=${password}`);

        // Write back to .env
        fs.writeFileSync(envPath, newLines.join('\n') + '\n', 'utf-8');

        console.log('');
        logSuccess('.env file updated with credentials');
        console.log(`${colors.bright}Location:${colors.reset} ${envPath}`);
        console.log('');

    } catch (error: any) {
        console.log('');
        logWarning(`Could not update .env file: ${error.message}`);
        console.log('Please manually add these to your .env:');
        console.log(`  MXF_DEMO_USERNAME=${username}`);
        console.log(`  MXF_DEMO_PASSWORD=${password}`);
        console.log('');
    }
};

/**
 * Update .env file with demo access token (RECOMMENDED)
 */
const updateEnvFileWithToken = (accessToken: string): void => {
    try {
        const envPath = path.join(process.cwd(), '.env');
        let envContent = '';

        // Read existing .env if it exists
        if (fs.existsSync(envPath)) {
            envContent = fs.readFileSync(envPath, 'utf-8');
        }

        // Parse existing .env
        const lines = envContent.split('\n');

        // Rebuild .env content
        const newLines: string[] = [];

        // Preserve existing values and comments
        lines.forEach(line => {
            const trimmed = line.trim();
            if (trimmed.startsWith('#') || !trimmed) {
                // Keep comments and empty lines
                newLines.push(line);
            } else {
                const [key] = trimmed.split('=');
                if (key && key.trim() !== 'MXF_DEMO_ACCESS_TOKEN') {
                    // Keep other env vars
                    newLines.push(line);
                }
            }
        });

        // Add access token section if not already there
        if (!envContent.includes('MXF_DEMO_ACCESS_TOKEN')) {
            newLines.push('');
            newLines.push('# Demo Access Token (RECOMMENDED for SDK authentication)');
        }

        newLines.push(`MXF_DEMO_ACCESS_TOKEN=${accessToken}`);

        // Write back to .env
        fs.writeFileSync(envPath, newLines.join('\n') + '\n', 'utf-8');

        console.log('');
        logSuccess('.env file updated with access token');
        console.log(`${colors.bright}Location:${colors.reset} ${envPath}`);
        console.log('');

    } catch (error: any) {
        console.log('');
        logWarning(`Could not update .env file: ${error.message}`);
        console.log('Please manually add this to your .env:');
        console.log(`  MXF_DEMO_ACCESS_TOKEN=${accessToken}`);
        console.log('');
    }
};

// ============================================================================
// USER MANAGEMENT
// ============================================================================

/**
 * Create user command
 */
const userCreate = async (options: any): Promise<void> => {
    console.log('');
    console.log('═'.repeat(80));
    console.log('Create MXF User');
    console.log('═'.repeat(80));
    console.log('');
    
    // Validate required fields
    if (!options.email) {
        logError('Email is required (--email)');
        return;
    }
    
    if (!options.password) {
        logError('Password is required (--password)');
        return;
    }
    
    const username = options.username || options.email.split('@')[0];
    const role = options.role || 'consumer';
    
    const userData = {
        username,
        email: options.email,
        password: options.password,
        role
    };
    
    try {
        logInfo('Creating user...');
        
        const apiUrl = options.apiUrl || DEFAULT_API_URL;
        const response = await axios.post(`${apiUrl}/users/register`, userData);
        
        console.log('');
        logSuccess('User created successfully');
        console.log('');
        console.log(`${colors.bright}Username:${colors.reset} ${username}`);
        console.log(`${colors.bright}Email:${colors.reset} ${options.email}`);
        console.log(`${colors.bright}Role:${colors.reset} ${role}`);
        console.log('');
        
        if (response.data && (response.data as any).data) {
            const userId = (response.data as any).data.id;
            console.log(`${colors.bright}User ID:${colors.reset} ${userId}`);
            console.log('');
        }
        
        console.log('The user can now:');
        console.log('  1. Login via the Dashboard');
        console.log('  2. Create channels');
        console.log('  3. Generate agent keys');
        console.log('');
        
        // Update .env file with credentials (legacy)
        updateEnvFileWithCredentials(username, options.password);
        
    } catch (error: any) {
        console.log('');
        logError('Failed to create user');
        console.log('');
        
        if (error.response) {
            console.log(`Error: ${error.response.data?.message || error.response.statusText}`);
        } else {
            console.log(`Error: ${error.message}`);
        }
        
        console.log('');
        console.log('Make sure:');
        console.log('  1. MXF server is running');
        console.log('  2. Database is accessible');
        console.log('  3. Email is not already registered');
        console.log('');
    }
    
    console.log('═'.repeat(80));
    console.log('');
};

/**
 * List users command
 */
const userList = async (options: any): Promise<void> => {
    console.log('');
    console.log('═'.repeat(80));
    console.log('MXF Users');
    console.log('═'.repeat(80));
    console.log('');
    
    logWarning('User listing requires authentication');
    logInfo('This feature will be implemented in a future update');
    
    console.log('');
    console.log('For now, check users directly in:');
    console.log('  - MongoDB database');
    console.log('  - Dashboard UI');
    console.log('');
    console.log('═'.repeat(80));
    console.log('');
};

/**
 * Demo setup command - creates demo user and generates a Personal Access Token
 */
const demoSetup = async (options: any): Promise<void> => {
    console.log('');
    console.log('═'.repeat(80));
    console.log('Setup Demo User with Personal Access Token');
    console.log('═'.repeat(80));
    console.log('');

    const apiUrl = options.apiUrl || DEFAULT_API_URL;
    const demoCredentials = {
        username: 'demo-user',
        email: 'demo@example.com',
        password: 'demo-password-1234',
        role: 'consumer'
    };

    let jwtToken: string | null = null;
    let userExists = false;

    // Step 1: Try to create demo user or login if exists
    logInfo('Step 1: Creating or finding demo user...');

    try {
        const response = await axios.post(`${apiUrl}/users/register`, demoCredentials);
        logSuccess('Demo user created successfully');
        jwtToken = (response.data as any)?.token;
    } catch (error: any) {
        if (error.response && error.response.status === 409) {
            logInfo('Demo user already exists, logging in...');
            userExists = true;
        } else {
            logError('Failed to create demo user');
            if (error.response) {
                console.log(`Error: ${error.response.data?.message || error.response.statusText}`);
            } else {
                console.log(`Error: ${error.message}`);
            }
            console.log('');
            console.log('Make sure:');
            console.log('  1. MXF server is running (npm run start:dev)');
            console.log('  2. Database is accessible');
            console.log('═'.repeat(80));
            console.log('');
            return;
        }
    }

    // Step 2: Login to get JWT token (needed to create PAT)
    if (!jwtToken) {
        logInfo('Step 2: Logging in to get authentication token...');
        try {
            // Note: API expects 'username' field but accepts email value
            const loginResponse = await axios.post(`${apiUrl}/users/login`, {
                username: demoCredentials.email,
                password: demoCredentials.password
            });
            jwtToken = (loginResponse.data as any)?.token;
            if (!jwtToken) {
                logError('Login successful but no token returned');
                console.log('═'.repeat(80));
                console.log('');
                return;
            }
            logSuccess('Logged in successfully');
        } catch (error: any) {
            logError('Failed to login');
            if (error.response) {
                console.log(`Error: ${error.response.data?.message || error.response.statusText}`);
            } else {
                console.log(`Error: ${error.message}`);
            }
            console.log('═'.repeat(80));
            console.log('');
            return;
        }
    }

    // Step 3: Create Personal Access Token
    logInfo('Step 3: Creating Personal Access Token for SDK authentication...');

    try {
        const tokenResponse = await axios.post(
            `${apiUrl}/tokens`,
            {
                name: 'Demo SDK Token',
                description: 'Auto-generated token for running MXF demos'
            },
            {
                headers: {
                    Authorization: `Bearer ${jwtToken}`
                }
            }
        );

        const tokenData = (tokenResponse.data as any)?.data;
        if (!tokenData || !tokenData.tokenId || !tokenData.secret) {
            logError('Token created but missing data');
            console.log('═'.repeat(80));
            console.log('');
            return;
        }

        const accessToken = `${tokenData.tokenId}:${tokenData.secret}`;

        console.log('');
        logSuccess('Personal Access Token created successfully!');
        console.log('');
        console.log('═'.repeat(80));
        console.log(`${colors.bright}${colors.yellow}⚠️  IMPORTANT: Save this token now - it cannot be retrieved later!${colors.reset}`);
        console.log('═'.repeat(80));
        console.log('');
        console.log(`${colors.bright}Access Token:${colors.reset} ${colors.cyan}${accessToken}${colors.reset}`);
        console.log('');
        console.log('Add this to your .env file:');
        console.log(`   ${colors.cyan}MXF_DEMO_ACCESS_TOKEN=${accessToken}${colors.reset}`);
        console.log('');

        // Update .env file with access token
        updateEnvFileWithToken(accessToken);

        // Also update legacy credentials for backward compatibility
        updateEnvFileWithCredentials(demoCredentials.username, demoCredentials.password);

        console.log('Demo scripts are now ready to use:');
        console.log('  • bun run demo:first-contact');
        console.log('  • bun run demo:interview');
        console.log('  • bun run demo:twenty-questions');
        console.log('');
        console.log(`${colors.bright}Recommended SDK Usage:${colors.reset}`);
        console.log('```typescript');
        console.log('const sdk = new MxfSDK({');
        console.log('    serverUrl: \'http://localhost:3001\',');
        console.log('    domainKey: process.env.MXF_DOMAIN_KEY!,');
        console.log('    accessToken: process.env.MXF_DEMO_ACCESS_TOKEN!');
        console.log('});');
        console.log('```');

    } catch (error: any) {
        // Check if it's because a demo token already exists
        if (error.response && error.response.status === 400) {
            logWarning('Could not create new token (may already exist)');
            console.log('');
            console.log('If you need a new token, you can:');
            console.log('  1. Login to the dashboard');
            console.log('  2. Go to Settings > API Tokens');
            console.log('  3. Create a new token or revoke the existing one');
        } else {
            logError('Failed to create Personal Access Token');
            if (error.response) {
                console.log(`Error: ${error.response.data?.error || error.response.statusText}`);
            } else {
                console.log(`Error: ${error.message}`);
            }
        }

        // Still update legacy credentials as fallback
        console.log('');
        logInfo('Falling back to username/password authentication');
        updateEnvFileWithCredentials(demoCredentials.username, demoCredentials.password);
        console.log('');
        console.log('Demo scripts can still run using username/password:');
        console.log(`   ${colors.bright}Username:${colors.reset} ${demoCredentials.username}`);
        console.log(`   ${colors.bright}Password:${colors.reset} ${demoCredentials.password}`);
    }

    console.log('');
    console.log('═'.repeat(80));
    console.log('');
};

// ============================================================================
// CLI SETUP
// ============================================================================

const program = new Command();

program
    .name('mxf-server-cli')
    .description('MXF Server CLI - Server operator tools')
    .version('1.0.0');

// Domain Key Commands
program
    .command('domain-key:generate')
    .description('Generate a new SDK domain key')
    .action(domainKeyGenerate);

program
    .command('domain-key:show')
    .description('Show current SDK domain key')
    .action(domainKeyShow);

// User Commands
program
    .command('user:create')
    .description('Create a new user account')
    .option('--email <email>', 'User email (required)')
    .option('--password <password>', 'User password (required)')
    .option('--username <username>', 'Username (defaults to email prefix)')
    .option('--role <role>', 'User role (consumer/admin)', 'consumer')
    .option('--api-url <url>', 'API URL', DEFAULT_API_URL)
    .action(userCreate);

program
    .command('user:list')
    .description('List all users')
    .option('--api-url <url>', 'API URL', DEFAULT_API_URL)
    .action(userList);

// Demo Commands
program
    .command('demo:setup')
    .description('Create demo user and generate Personal Access Token for SDK authentication')
    .option('--api-url <url>', 'API URL', DEFAULT_API_URL)
    .action(demoSetup);

// Parse arguments
program.parse(process.argv);

// Show help if no command provided
if (!process.argv.slice(2).length) {
    program.outputHelp();
}
