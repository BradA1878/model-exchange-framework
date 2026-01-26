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
 * CodeExecutionSandboxService.ts
 *
 * Provides sandboxed code execution capabilities using Docker containers with Bun runtime.
 * Enforces resource limits, validates code safety, and provides isolated execution environment.
 *
 * Security: Code runs in isolated Docker containers with:
 * - No network access
 * - Read-only filesystem
 * - All capabilities dropped
 * - Non-root user
 * - Memory and CPU limits
 */

import { Logger } from '../utils/Logger';
import { ContainerPoolManager } from './ContainerPoolManager';
import crypto from 'crypto';

/**
 * Supported execution languages
 */
export enum ExecutionLanguage {
    JAVASCRIPT = 'javascript',
    TYPESCRIPT = 'typescript'
}

/**
 * Sandbox configuration
 */
export interface SandboxConfig {
    timeout: number;              // Max execution time in milliseconds
    memoryLimit?: number;         // Max memory in MB
    allowedModules?: string[];    // Whitelisted Node.js modules (not used with Docker)
    allowBuiltinModules?: boolean; // Allow built-in Node.js modules (not used with Docker)
    captureConsole?: boolean;     // Capture console.log output
}

/**
 * Execution context provided to sandboxed code
 */
export interface SandboxContext {
    agentId: string;
    channelId: string;
    requestId: string;
    [key: string]: any;           // Additional context data
}

/**
 * Execution result
 */
export interface ExecutionResult {
    success: boolean;
    output: any;                  // Return value from code
    logs: string[];               // Console output
    executionTime: number;        // Time taken in ms
    resourceUsage: {
        memory: number;           // Estimated memory usage
        timeout: boolean;         // Whether timeout occurred
    };
    error?: string;               // Error message if failed
    codeHash: string;             // Hash of executed code for tracking
}

/**
 * Validation result for code safety
 */
export interface CodeValidationResult {
    safe: boolean;
    issues: Array<{
        type: 'error' | 'warning';
        message: string;
        pattern?: string;
    }>;
}

/**
 * Default sandbox configuration
 */
const DEFAULT_CONFIG: SandboxConfig = {
    timeout: 5000,
    memoryLimit: 128,
    allowBuiltinModules: false,
    captureConsole: true,
    allowedModules: []
};

/**
 * Dangerous patterns to detect in code
 * These are checked BEFORE sending to container for defense in depth
 */
const DANGEROUS_PATTERNS = [
    { pattern: /eval\s*\(/g, message: 'eval() is not allowed' },
    { pattern: /Function\s*\(/g, message: 'Function constructor is not allowed' },
    { pattern: /require\s*\(/g, message: 'require() is not allowed - modules must be whitelisted' },
    { pattern: /import\s+.*from/g, message: 'import statements are not allowed' },
    { pattern: /process\.exit/g, message: 'process.exit is not allowed' },
    { pattern: /process\.kill/g, message: 'process.kill is not allowed' },
    { pattern: /__proto__/g, message: 'Prototype pollution attempts are not allowed' },
    { pattern: /constructor\s*\[/g, message: 'Constructor access is not allowed' },
    { pattern: /child_process/g, message: 'child_process module is not allowed' },
    { pattern: /Bun\.spawn/g, message: 'Bun.spawn is not allowed' },
    { pattern: /Bun\.spawnSync/g, message: 'Bun.spawnSync is not allowed' },
    { pattern: /Bun\.file/g, message: 'Bun.file is not allowed' },
    { pattern: /Bun\.write/g, message: 'Bun.write is not allowed' },
];

/**
 * Code Execution Sandbox Service
 *
 * Provides isolated JavaScript/TypeScript execution using Docker containers with Bun runtime.
 * Enforces security policies, resource limits, and code validation.
 */
export class CodeExecutionSandboxService {
    private static instance: CodeExecutionSandboxService;
    private logger: Logger;
    private defaultConfig: SandboxConfig;
    private containerPool: ContainerPoolManager;
    private initialized: boolean = false;

    private constructor(config?: Partial<SandboxConfig>) {
        this.logger = new Logger('info', 'CodeExecutionSandboxService', 'server');
        this.defaultConfig = {
            ...DEFAULT_CONFIG,
            ...config
        };
        this.containerPool = ContainerPoolManager.getInstance();
    }

    /**
     * Get singleton instance
     */
    public static getInstance(config?: Partial<SandboxConfig>): CodeExecutionSandboxService {
        if (!CodeExecutionSandboxService.instance) {
            CodeExecutionSandboxService.instance = new CodeExecutionSandboxService(config);
        }
        return CodeExecutionSandboxService.instance;
    }

    /**
     * Initialize the sandbox service
     * Must be called before execution to set up Docker container pool
     */
    public async initialize(): Promise<boolean> {
        if (this.initialized) {
            return this.containerPool.isDockerAvailable();
        }

        try {
            const dockerAvailable = await this.containerPool.initialize();

            if (dockerAvailable) {
                this.logger.info('Code execution sandbox initialized with Docker');
            } else {
                this.logger.warn('Docker not available - code execution will be disabled');
            }

            this.initialized = true;
            return dockerAvailable;

        } catch (error: any) {
            this.logger.error(`Failed to initialize sandbox: ${error.message}`);
            this.initialized = true;
            return false;
        }
    }

    /**
     * Check if the service is ready for execution
     */
    public isReady(): boolean {
        return this.initialized && this.containerPool.isDockerAvailable();
    }

    /**
     * Validate code for dangerous patterns
     * This runs BEFORE container execution for defense in depth
     */
    public validateCode(code: string): CodeValidationResult {
        const issues: Array<{ type: 'error' | 'warning'; message: string; pattern?: string }> = [];

        // Check for dangerous patterns
        for (const { pattern, message } of DANGEROUS_PATTERNS) {
            // Reset regex lastIndex for global patterns
            pattern.lastIndex = 0;
            if (pattern.test(code)) {
                issues.push({
                    type: 'error',
                    message,
                    pattern: pattern.source
                });
            }
        }

        // Check code length
        if (code.length > 100000) {
            issues.push({
                type: 'warning',
                message: 'Code is very large (>100KB) - may hit memory limits'
            });
        }

        // Check for infinite loops (basic heuristic)
        const whileLoops = (code.match(/while\s*\(/g) || []).length;
        const forLoops = (code.match(/for\s*\(/g) || []).length;
        if (whileLoops > 10 || forLoops > 10) {
            issues.push({
                type: 'warning',
                message: 'Multiple loops detected - ensure they terminate properly'
            });
        }

        return {
            safe: issues.filter(i => i.type === 'error').length === 0,
            issues
        };
    }

    /**
     * Execute JavaScript code in sandboxed Docker container
     */
    public async executeJavaScript(
        code: string,
        context: SandboxContext,
        config?: Partial<SandboxConfig>
    ): Promise<ExecutionResult> {
        return this.executeCode(code, 'javascript', context, config);
    }

    /**
     * Execute TypeScript code in sandboxed Docker container
     * Bun handles TypeScript natively - no transpilation needed
     */
    public async executeTypeScript(
        code: string,
        context: SandboxContext,
        config?: Partial<SandboxConfig>
    ): Promise<ExecutionResult> {
        return this.executeCode(code, 'typescript', context, config);
    }

    /**
     * Execute code in Docker container
     */
    private async executeCode(
        code: string,
        language: 'javascript' | 'typescript',
        context: SandboxContext,
        config?: Partial<SandboxConfig>
    ): Promise<ExecutionResult> {
        const execConfig = { ...this.defaultConfig, ...config };
        const startTime = Date.now();

        // Generate code hash for tracking
        const codeHash = crypto.createHash('sha256').update(code).digest('hex').substring(0, 16);

        // Check if Docker is available
        if (!this.isReady()) {
            return {
                success: false,
                output: null,
                logs: [],
                executionTime: Date.now() - startTime,
                resourceUsage: { memory: 0, timeout: false },
                error: 'Code execution is not available - Docker is not running or image not built',
                codeHash
            };
        }

        try {
            // Validate code before sending to container
            const validation = this.validateCode(code);
            if (!validation.safe) {
                const errorMessage = validation.issues
                    .filter(i => i.type === 'error')
                    .map(i => i.message)
                    .join('; ');

                return {
                    success: false,
                    output: null,
                    logs: [],
                    executionTime: Date.now() - startTime,
                    resourceUsage: { memory: 0, timeout: false },
                    error: `Code validation failed: ${errorMessage}`,
                    codeHash
                };
            }

            // Log warnings
            validation.issues
                .filter(i => i.type === 'warning')
                .forEach(issue => {
                    this.logger.warn('Code validation warning', { message: issue.message, codeHash });
                });

            // Execute in Docker container
            const result = await this.containerPool.execute({
                code,
                language,
                timeout: execConfig.timeout,
                context
            });

            return {
                success: result.success,
                output: result.output,
                logs: result.logs,
                executionTime: result.executionTime,
                resourceUsage: {
                    memory: execConfig.memoryLimit || 128,
                    timeout: result.timeout
                },
                error: result.error,
                codeHash
            };

        } catch (error: any) {
            const executionTime = Date.now() - startTime;

            this.logger.error('Code execution failed', {
                codeHash,
                error: error.message,
                executionTime,
                agentId: context.agentId
            });

            return {
                success: false,
                output: null,
                logs: [],
                executionTime,
                resourceUsage: {
                    memory: 0,
                    timeout: false
                },
                error: error.message || String(error),
                codeHash
            };
        }
    }

    /**
     * Get current configuration
     */
    public getConfig(): SandboxConfig {
        return { ...this.defaultConfig };
    }

    /**
     * Update default configuration
     */
    public updateConfig(config: Partial<SandboxConfig>): void {
        this.defaultConfig = {
            ...this.defaultConfig,
            ...config
        };
    }

    /**
     * Shutdown the service
     */
    public async shutdown(): Promise<void> {
        if (this.containerPool) {
            await this.containerPool.shutdown();
        }
        this.initialized = false;
    }
}
