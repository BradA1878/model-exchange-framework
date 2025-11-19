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
 * McpSecurityGuard.ts
 * 
 * Comprehensive security module for MCP tools providing OS-specific guardrails,
 * command validation, path restrictions, and destructive operation protection.
 */

import { Logger } from '../../../utils/Logger';
import { platform } from 'os';
import * as path from 'path';

const logger = new Logger('info', 'McpSecurityGuard', 'server');

export interface SecurityContext {
    agentId: string;
    channelId: string;
    requestId: string;
    userId?: string;
    permissions?: string[];
}

export interface CommandValidationResult {
    allowed: boolean;
    reason?: string;
    requiresConfirmation?: boolean;
    riskLevel?: 'low' | 'medium' | 'high' | 'critical';
}

export interface PathValidationResult {
    allowed: boolean;
    reason?: string;
    resolvedPath?: string;
}

/**
 * OS-specific command security rules
 */
const OS_COMMAND_RULES = {
    darwin: {
        // macOS specific dangerous commands
        blocked: [
            // Disk operations
            'diskutil', 'hdiutil', 'pdisk', 'gpt', 'newfs_*',
            // System modifications
            'nvram', 'systemsetup', 'scutil', 'launchctl',
            // Security bypass
            'csrutil', 'spctl', 'codesign',
            // User management
            'dscl', 'sysadminctl', 'dseditgroup',
            // Network
            'pfctl', 'dnscacheutil', 'route',
            // Dangerous utilities
            'purge', 'ditto', 'rsync', 'dd'
        ],
        restricted: [
            // Requires confirmation
            { command: 'defaults', riskLevel: 'medium' },
            { command: 'osascript', riskLevel: 'high' },
            { command: 'security', riskLevel: 'high' },
            { command: 'networksetup', riskLevel: 'high' }
        ]
    },
    win32: {
        // Windows specific dangerous commands
        blocked: [
            // Disk operations
            'format', 'diskpart', 'chkdsk', 'convert', 'defrag',
            // System modifications
            'bcdedit', 'regedit', 'reg', 'regsvr32', 'rundll32',
            'sfc', 'dism', 'wmic', 'wevtutil',
            // Security
            'cipher', 'schtasks', 'sc', 'netsh',
            // User management
            'net user', 'net localgroup', 'wuauclt',
            // Dangerous utilities
            'takeown', 'icacls', 'attrib', 'assoc'
        ],
        restricted: [
            { command: 'powershell', riskLevel: 'high' },
            { command: 'cmd', riskLevel: 'medium' },
            { command: 'wsl', riskLevel: 'medium' },
            { command: 'msiexec', riskLevel: 'high' }
        ]
    },
    linux: {
        // Linux specific dangerous commands
        blocked: [
            // Disk operations
            'mkfs', 'fdisk', 'parted', 'dd', 'shred',
            // System modifications
            'systemctl', 'service', 'update-rc.d', 'chkconfig',
            'modprobe', 'insmod', 'rmmod',
            // Package management (require explicit permission)
            'apt-get', 'yum', 'dnf', 'zypper', 'pacman', 'snap',
            // User management
            'useradd', 'userdel', 'usermod', 'passwd', 'groupadd',
            // Network
            'iptables', 'ip6tables', 'ufw', 'firewall-cmd',
            // Dangerous utilities
            'mount', 'umount', 'chroot', 'pivot_root'
        ],
        restricted: [
            { command: 'crontab', riskLevel: 'high' },
            { command: 'at', riskLevel: 'medium' },
            { command: 'visudo', riskLevel: 'critical' },
            { command: 'dpkg', riskLevel: 'high' }
        ]
    }
};

/**
 * Common dangerous commands across all platforms
 */
const COMMON_DANGEROUS_COMMANDS = [
    // Destructive operations
    'rm -rf', 'rm -fr', 'del /s', 'del /f',
    // Privilege escalation
    'sudo', 'su', 'doas', 'runas',
    // System shutdown
    'shutdown', 'reboot', 'halt', 'poweroff',
    // Process management
    'kill -9', 'killall', 'pkill -9',
    // Dangerous redirections
    '> /dev/sda', '> /dev/null', '> /dev/zero'
];

/**
 * Safe command allowlist for common operations
 */
const SAFE_COMMANDS = [
    // File operations
    'ls', 'dir', 'pwd', 'cd', 'find', 'grep', 'cat', 'head', 'tail',
    'less', 'more', 'wc', 'sort', 'uniq', 'diff', 'file',
    // Text processing
    'sed', 'awk', 'cut', 'tr', 'echo', 'printf',
    // Archive operations
    'tar', 'zip', 'unzip', 'gzip', 'gunzip',
    // Network utilities (read-only)
    'ping', 'nslookup', 'dig', 'host', 'curl', 'wget',
    // Development tools
    'git', 'npm', 'yarn', 'pnpm', 'python', 'node', 'java',
    'gcc', 'g++', 'make', 'cmake',
    // System info (read-only)
    'whoami', 'hostname', 'uname', 'date', 'uptime', 'df', 'du',
    'ps', 'top', 'htop', 'free', 'vmstat'
];

/**
 * Path security rules
 */
const PATH_RESTRICTIONS = {
    // Paths that should never be accessed
    blockedPaths: {
        darwin: [
            '/System', '/Library/Security', '/private/etc',
            '/usr/bin', '/usr/sbin', '/private/var/db'
        ],
        win32: [
            'C:\\Windows\\System32', 'C:\\Windows\\SysWOW64',
            'C:\\Program Files', 'C:\\Program Files (x86)',
            'C:\\ProgramData', 'C:\\Users\\All Users'
        ],
        linux: [
            '/etc', '/bin', '/sbin', '/usr/bin', '/usr/sbin',
            '/boot', '/root', '/proc', '/sys', '/dev'
        ]
    },
    // Paths that require confirmation
    sensitivePaths: {
        darwin: ['~/Library', '~/.ssh', '~/.gnupg'],
        win32: ['%APPDATA%', '%LOCALAPPDATA%', '%USERPROFILE%\\.ssh'],
        linux: ['~/.ssh', '~/.gnupg', '~/.config', '/var']
    }
};

export class McpSecurityGuard {
    private platform: NodeJS.Platform;
    private projectRoot: string;
    private allowedPaths: string[] = [];
    
    constructor(projectRoot: string, additionalAllowedPaths?: string[]) {
        this.platform = platform();
        this.projectRoot = path.resolve(projectRoot);
        this.allowedPaths = [this.projectRoot, ...(additionalAllowedPaths || [])];
        
    }
    
    /**
     * Validate a shell command for execution
     */
    validateCommand(command: string, context: SecurityContext): CommandValidationResult {
        const normalizedCommand = command.trim().toLowerCase();
        const commandParts = normalizedCommand.split(/\s+/);
        const baseCommand = commandParts[0];
        
        // Check if command is in safe allowlist
        if (SAFE_COMMANDS.includes(baseCommand)) {
            // Still check for dangerous patterns
            if (this.containsDangerousPattern(normalizedCommand)) {
                return {
                    allowed: false,
                    reason: 'Command contains dangerous patterns',
                    riskLevel: 'high'
                };
            }
            return { allowed: true, riskLevel: 'low' };
        }
        
        // Check common dangerous commands
        for (const dangerous of COMMON_DANGEROUS_COMMANDS) {
            if (normalizedCommand.includes(dangerous)) {
                return {
                    allowed: false,
                    reason: `Command contains dangerous pattern: ${dangerous}`,
                    riskLevel: 'critical'
                };
            }
        }
        
        // Check OS-specific rules
        const osRules = OS_COMMAND_RULES[this.platform as keyof typeof OS_COMMAND_RULES] || OS_COMMAND_RULES.linux;
        
        // Check blocked commands
        for (const blocked of osRules.blocked) {
            if (normalizedCommand.includes(blocked)) {
                return {
                    allowed: false,
                    reason: `Command '${blocked}' is blocked on ${this.platform}`,
                    riskLevel: 'critical'
                };
            }
        }
        
        // Check restricted commands
        for (const restricted of osRules.restricted) {
            if (baseCommand === restricted.command) {
                return {
                    allowed: true,
                    requiresConfirmation: true,
                    reason: `Command '${restricted.command}' requires confirmation`,
                    riskLevel: restricted.riskLevel as any
                };
            }
        }
        
        // Check for shell operators that might be dangerous
        const dangerousOperators = ['&&', '||', ';', '|', '`', '$(',  '${', '>>', '2>'];
        for (const op of dangerousOperators) {
            if (normalizedCommand.includes(op)) {
                return {
                    allowed: true,
                    requiresConfirmation: true,
                    reason: `Command contains shell operator '${op}'`,
                    riskLevel: 'medium'
                };
            }
        }
        
        // Unknown command - require confirmation
        return {
            allowed: true,
            requiresConfirmation: true,
            reason: 'Unknown command requires confirmation',
            riskLevel: 'medium'
        };
    }
    
    /**
     * Validate a file system path
     */
    validatePath(requestedPath: string, operation: 'read' | 'write' | 'delete'): PathValidationResult {
        try {
            // Resolve the path
            const resolvedPath = path.resolve(requestedPath);
            
            // Check for path traversal attempts
            if (requestedPath.includes('..') || requestedPath.includes('~')) {
                // Allow ~ only at the beginning for home directory
                if (requestedPath.startsWith('~')) {
                    const homePath = process.env.HOME || process.env.USERPROFILE || '';
                    const expandedPath = requestedPath.replace('~', homePath);
                    return this.validatePath(expandedPath, operation);
                }
                
                return {
                    allowed: false,
                    reason: 'Path traversal attempts are not allowed'
                };
            }
            
            // Check blocked paths
            const blockedPaths = PATH_RESTRICTIONS.blockedPaths[this.platform as keyof typeof PATH_RESTRICTIONS.blockedPaths] || [];
            for (const blocked of blockedPaths) {
                const expandedBlocked = this.expandPath(blocked);
                if (resolvedPath.startsWith(expandedBlocked)) {
                    return {
                        allowed: false,
                        reason: `Access to ${blocked} is blocked`
                    };
                }
            }
            
            // Check if path is within allowed directories
            let isInAllowedPath = false;
            for (const allowedPath of this.allowedPaths) {
                const resolvedAllowed = path.resolve(allowedPath);
                if (resolvedPath.startsWith(resolvedAllowed)) {
                    isInAllowedPath = true;
                    break;
                }
            }
            
            // If not in allowed paths, check if it's a sensitive path
            if (!isInAllowedPath) {
                const sensitivePaths = PATH_RESTRICTIONS.sensitivePaths[this.platform as keyof typeof PATH_RESTRICTIONS.sensitivePaths] || [];
                for (const sensitive of sensitivePaths) {
                    const expandedSensitive = this.expandPath(sensitive);
                    if (resolvedPath.startsWith(expandedSensitive)) {
                        return {
                            allowed: operation === 'read', // Allow read, block write/delete
                            reason: operation !== 'read' 
                                ? `Write/delete operations to ${sensitive} require explicit permission`
                                : undefined,
                            resolvedPath
                        };
                    }
                }
                
                // Path is outside project - require explicit permission for write/delete
                if (operation !== 'read') {
                    return {
                        allowed: false,
                        reason: 'Write/delete operations outside project directory require explicit permission',
                        resolvedPath
                    };
                }
            }
            
            return {
                allowed: true,
                resolvedPath
            };
            
        } catch (error) {
            return {
                allowed: false,
                reason: `Invalid path: ${error instanceof Error ? error.message : String(error)}`
            };
        }
    }
    
    /**
     * Check if a command should trigger a confirmation prompt
     */
    requiresConfirmation(command: string, context: SecurityContext): boolean {
        const validation = this.validateCommand(command, context);
        return validation.requiresConfirmation || false;
    }
    
    /**
     * Get risk level for a command
     */
    getRiskLevel(command: string, context: SecurityContext): 'low' | 'medium' | 'high' | 'critical' {
        const validation = this.validateCommand(command, context);
        return validation.riskLevel || 'low';
    }
    
    /**
     * Add allowed paths dynamically
     */
    addAllowedPath(pathToAdd: string): void {
        const resolved = path.resolve(pathToAdd);
        if (!this.allowedPaths.includes(resolved)) {
            this.allowedPaths.push(resolved);
        }
    }
    
    /**
     * Helper to check for dangerous patterns in commands
     */
    private containsDangerousPattern(command: string): boolean {
        const patterns = [
            /rm\s+-[rf]+\s+\//,  // rm -rf on root paths
            />\s*\/dev\//,       // Redirecting to device files
            /dd\s+.*of=\//,      // dd writing to root paths
            /chmod\s+777/,       // Overly permissive permissions
            /curl.*\|\s*sh/,     // Curl piped to shell
            /wget.*\|\s*bash/    // Wget piped to shell
        ];
        
        return patterns.some(pattern => pattern.test(command));
    }
    
    /**
     * Helper to expand environment variables and ~ in paths
     */
    private expandPath(pathStr: string): string {
        // Expand ~
        if (pathStr.startsWith('~')) {
            const home = process.env.HOME || process.env.USERPROFILE || '';
            pathStr = pathStr.replace('~', home);
        }
        
        // Expand environment variables
        pathStr = pathStr.replace(/%([^%]+)%/g, (_, varName) => {
            return process.env[varName] || '';
        });
        
        return path.resolve(pathStr);
    }
}

/**
 * Singleton instance factory
 */
let securityGuardInstance: McpSecurityGuard | null = null;

export function getSecurityGuard(projectRoot?: string): McpSecurityGuard {
    if (!securityGuardInstance && projectRoot) {
        securityGuardInstance = new McpSecurityGuard(projectRoot);
    }
    if (!securityGuardInstance) {
        throw new Error('McpSecurityGuard not initialized. Please provide projectRoot on first call.');
    }
    return securityGuardInstance;
}