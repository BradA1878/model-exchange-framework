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
 * McpSecurityConfig.ts
 * 
 * Configuration interface and loader for MCP security settings.
 * Allows customization of security policies through configuration files.
 */

import { Logger } from '../../../utils/Logger';
import * as fs from 'fs/promises';
import * as path from 'path';

const logger = new Logger('info', 'McpSecurityConfig', 'server');

export interface McpSecurityConfig {
    // General settings
    enabled: boolean;
    mode: 'strict' | 'moderate' | 'permissive';
    
    // Command execution settings
    commands: {
        // Additional blocked commands (added to defaults)
        additionalBlocked?: string[];
        // Commands to remove from blocked list
        unblock?: string[];
        // Additional allowed commands (added to safe list)
        additionalAllowed?: string[];
        // Custom risk levels for specific commands
        customRiskLevels?: Record<string, 'low' | 'medium' | 'high' | 'critical'>;
        // Timeout for command execution (ms)
        defaultTimeout?: number;
        // Maximum command length
        maxCommandLength?: number;
    };
    
    // File system settings
    filesystem: {
        // Additional allowed paths
        additionalAllowedPaths?: string[];
        // Additional blocked paths
        additionalBlockedPaths?: string[];
        // Maximum file size for read operations
        maxFileSize?: number;
        // Allow operations outside project directory
        allowOutsideProject?: boolean;
        // Backup settings
        autoBackup?: boolean;
        backupDirectory?: string;
    };
    
    // Confirmation settings
    confirmation: {
        // Strategy: 'interactive' | 'policy' | 'logging' | 'none'
        strategy: string;
        // Auto-approve in development
        autoApproveInDev?: boolean;
        // Timeout for confirmations (ms)
        timeout?: number;
        // Risk levels that require confirmation
        requireConfirmationFor?: ('medium' | 'high' | 'critical')[];
        // Custom policies
        customPolicies?: {
            type: string;
            pattern: string;
            action: 'approve' | 'deny' | 'confirm';
        }[];
    };
    
    // Logging settings
    logging: {
        // Log all security events
        enabled: boolean;
        // Log file path
        logPath?: string;
        // Include command output in logs
        includeOutput?: boolean;
        // Maximum log file size
        maxLogSize?: number;
        // Log rotation
        rotation?: {
            enabled: boolean;
            maxFiles: number;
            maxAge: number; // days
        };
    };
    
    // Platform-specific overrides
    platformOverrides?: {
        darwin?: Partial<McpSecurityConfig>;
        win32?: Partial<McpSecurityConfig>;
        linux?: Partial<McpSecurityConfig>;
    };
}

/**
 * Default security configuration
 */
export const DEFAULT_SECURITY_CONFIG: McpSecurityConfig = {
    enabled: true,
    mode: 'moderate',
    
    commands: {
        defaultTimeout: 30000,
        maxCommandLength: 1000
    },
    
    filesystem: {
        maxFileSize: 10 * 1024 * 1024, // 10MB
        allowOutsideProject: false,
        autoBackup: false
    },
    
    confirmation: {
        strategy: 'interactive',
        autoApproveInDev: false,
        timeout: 30000,
        requireConfirmationFor: ['high', 'critical']
    },
    
    logging: {
        enabled: true,
        includeOutput: false,
        maxLogSize: 50 * 1024 * 1024 // 50MB
    }
};

/**
 * Load security configuration from file or environment
 */
export class McpSecurityConfigLoader {
    private config: McpSecurityConfig = DEFAULT_SECURITY_CONFIG;
    private configPath?: string;
    
    constructor(configPath?: string) {
        this.configPath = configPath;
    }
    
    /**
     * Load configuration from file
     */
    async load(): Promise<McpSecurityConfig> {
        try {
            // Find config file if not provided
            if (!this.configPath) {
                this.configPath = await this.findConfigFile();
            }
            
            // Try to load from config file
            if (this.configPath) {
                const configData = await fs.readFile(this.configPath, 'utf8');
                const fileConfig = JSON.parse(configData) as Partial<McpSecurityConfig>;
                this.config = this.mergeConfigs(DEFAULT_SECURITY_CONFIG, fileConfig);
            }
            
            // Apply environment variable overrides
            this.applyEnvironmentOverrides();
            
            // Apply platform-specific overrides
            this.applyPlatformOverrides();
            
            // Validate configuration
            this.validateConfig();
            
            return this.config;
        } catch (error) {
            logger.warn(`Failed to load security config: ${error}. Using defaults.`);
            return DEFAULT_SECURITY_CONFIG;
        }
    }
    
    /**
     * Save configuration to file
     */
    async save(config: McpSecurityConfig, configPath?: string): Promise<void> {
        const savePath = configPath || this.configPath || this.getDefaultConfigPath();
        
        try {
            // Ensure directory exists
            await fs.mkdir(path.dirname(savePath), { recursive: true });
            
            // Write config
            await fs.writeFile(
                savePath,
                JSON.stringify(config, null, 2),
                'utf8'
            );
            
        } catch (error) {
            logger.error(`Failed to save security config: ${error}`);
            throw error;
        }
    }
    
    /**
     * Get current configuration
     */
    getConfig(): McpSecurityConfig {
        return this.config;
    }
    
    /**
     * Find configuration file in standard locations
     */
    private async findConfigFile(): Promise<string | undefined> {
        const locations = [
            // Current directory
            'mcp-security.json',
            '.mcp-security.json',
            // Config directory
            'config/mcp-security.json',
            '.config/mcp-security.json',
            // Home directory
            path.join(process.env.HOME || process.env.USERPROFILE || '', '.mcp-security.json')
        ];
        
        for (const location of locations) {
            try {
                const fullPath = path.resolve(location);
                // Check if file exists
                try {
                    await fs.access(fullPath);
                    return fullPath;
                } catch {
                    // File doesn't exist, continue to next location
                }
            } catch {
                // Continue to next location
            }
        }
        
        return undefined;
    }
    
    /**
     * Get default config path
     */
    private getDefaultConfigPath(): string {
        return path.join(process.cwd(), 'config', 'mcp-security.json');
    }
    
    /**
     * Apply environment variable overrides
     */
    private applyEnvironmentOverrides(): void {
        // MCP_SECURITY_ENABLED
        if (process.env.MCP_SECURITY_ENABLED !== undefined) {
            this.config.enabled = process.env.MCP_SECURITY_ENABLED === 'true';
        }
        
        // MCP_SECURITY_MODE
        if (process.env.MCP_SECURITY_MODE) {
            this.config.mode = process.env.MCP_SECURITY_MODE as any;
        }
        
        // MCP_SECURITY_CONFIRMATION
        if (process.env.MCP_SECURITY_CONFIRMATION) {
            this.config.confirmation.strategy = process.env.MCP_SECURITY_CONFIRMATION;
        }
        
        // MCP_SECURITY_AUTO_APPROVE_DEV
        if (process.env.MCP_SECURITY_AUTO_APPROVE_DEV !== undefined) {
            this.config.confirmation.autoApproveInDev = 
                process.env.MCP_SECURITY_AUTO_APPROVE_DEV === 'true';
        }
        
        // MCP_SECURITY_LOG_PATH
        if (process.env.MCP_SECURITY_LOG_PATH) {
            this.config.logging.logPath = process.env.MCP_SECURITY_LOG_PATH;
        }
    }
    
    /**
     * Apply platform-specific overrides
     */
    private applyPlatformOverrides(): void {
        const platform = process.platform as keyof typeof this.config.platformOverrides;
        const overrides = this.config.platformOverrides?.[platform];
        
        if (overrides) {
            this.config = this.mergeConfigs(this.config, overrides);
        }
    }
    
    /**
     * Merge configurations
     */
    private mergeConfigs(
        base: McpSecurityConfig,
        override: Partial<McpSecurityConfig>
    ): McpSecurityConfig {
        return {
            ...base,
            ...override,
            commands: {
                ...base.commands,
                ...override.commands
            },
            filesystem: {
                ...base.filesystem,
                ...override.filesystem
            },
            confirmation: {
                ...base.confirmation,
                ...override.confirmation
            },
            logging: {
                ...base.logging,
                ...override.logging
            }
        };
    }
    
    /**
     * Validate configuration
     */
    private validateConfig(): void {
        // Validate mode
        if (!['strict', 'moderate', 'permissive'].includes(this.config.mode)) {
            throw new Error(`Invalid security mode: ${this.config.mode}`);
        }
        
        // Validate confirmation strategy
        if (!['interactive', 'policy', 'logging', 'none'].includes(
            this.config.confirmation.strategy
        )) {
            throw new Error(`Invalid confirmation strategy: ${this.config.confirmation.strategy}`);
        }
        
        // Validate timeouts
        if (this.config.commands.defaultTimeout && this.config.commands.defaultTimeout < 0) {
            throw new Error('Command timeout must be positive');
        }
        
        if (this.config.confirmation.timeout && this.config.confirmation.timeout < 0) {
            throw new Error('Confirmation timeout must be positive');
        }
    }
}

/**
 * Create example configuration file
 */
export async function createExampleConfig(outputPath?: string): Promise<void> {
    const exampleConfig: McpSecurityConfig = {
        ...DEFAULT_SECURITY_CONFIG,
        mode: 'moderate',
        commands: {
            additionalBlocked: ['example-dangerous-command'],
            additionalAllowed: ['my-safe-tool'],
            customRiskLevels: {
                'npm install': 'medium',
                'git push': 'high'
            },
            defaultTimeout: 60000,
            maxCommandLength: 2000
        },
        filesystem: {
            additionalAllowedPaths: ['/tmp/my-app', '~/Documents/projects'],
            additionalBlockedPaths: ['/sensitive/data'],
            maxFileSize: 50 * 1024 * 1024,
            allowOutsideProject: false,
            autoBackup: true,
            backupDirectory: '.backups'
        },
        confirmation: {
            strategy: 'interactive',
            autoApproveInDev: true,
            timeout: 45000,
            requireConfirmationFor: ['medium', 'high', 'critical'],
            customPolicies: [
                {
                    type: 'command',
                    pattern: 'npm test',
                    action: 'approve'
                },
                {
                    type: 'file_operation',
                    pattern: '/tmp/*',
                    action: 'approve'
                }
            ]
        },
        logging: {
            enabled: true,
            logPath: './logs/mcp-security.log',
            includeOutput: true,
            maxLogSize: 100 * 1024 * 1024,
            rotation: {
                enabled: true,
                maxFiles: 10,
                maxAge: 30
            }
        },
        platformOverrides: {
            darwin: {
                filesystem: {
                    additionalBlockedPaths: ['/System', '/Library']
                }
            },
            win32: {
                commands: {
                    additionalBlocked: ['format', 'diskpart']
                }
            }
        }
    };
    
    const loader = new McpSecurityConfigLoader();
    await loader.save(exampleConfig, outputPath);
}