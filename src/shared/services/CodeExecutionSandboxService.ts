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
 * Provides sandboxed code execution capabilities using vm2 for JavaScript/TypeScript.
 * Enforces resource limits, validates code safety, and provides isolated execution environment.
 */

import { VM, VMScript } from 'vm2';
import { Logger } from '../utils/Logger';
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
    memoryLimit?: number;         // Max memory in MB (not enforced by vm2 directly)
    allowedModules?: string[];    // Whitelisted Node.js modules
    allowBuiltinModules?: boolean; // Allow built-in Node.js modules
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
 */
const DANGEROUS_PATTERNS = [
    { pattern: /eval\s*\(/g, message: 'eval() is not allowed' },
    { pattern: /Function\s*\(/g, message: 'Function constructor is not allowed' },
    { pattern: /require\s*\(/g, message: 'require() is not allowed - modules must be whitelisted' },
    { pattern: /import\s+/g, message: 'import statements are not allowed' },
    { pattern: /process\.exit/g, message: 'process.exit is not allowed' },
    { pattern: /process\.kill/g, message: 'process.kill is not allowed' },
    { pattern: /__proto__/g, message: 'Prototype pollution attempts are not allowed' },
    { pattern: /constructor\s*\[/g, message: 'Constructor access is not allowed' },
];

/**
 * Code Execution Sandbox Service
 *
 * Provides isolated JavaScript/TypeScript execution using vm2.
 * Enforces security policies, resource limits, and code validation.
 */
export class CodeExecutionSandboxService {
    private static instance: CodeExecutionSandboxService;
    private logger: Logger;
    private defaultConfig: SandboxConfig;

    private constructor(config?: Partial<SandboxConfig>) {
        this.logger = new Logger('info', 'CodeExecutionSandboxService', 'server');
        this.defaultConfig = {
            ...DEFAULT_CONFIG,
            ...config
        };

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
     * Validate code for dangerous patterns
     */
    public validateCode(code: string): CodeValidationResult {
        const issues: Array<{ type: 'error' | 'warning'; message: string; pattern?: string }> = [];

        // Check for dangerous patterns
        for (const { pattern, message } of DANGEROUS_PATTERNS) {
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
     * Execute JavaScript code in sandboxed environment
     */
    public async executeJavaScript(
        code: string,
        context: SandboxContext,
        config?: Partial<SandboxConfig>
    ): Promise<ExecutionResult> {
        const execConfig = { ...this.defaultConfig, ...config };
        const startTime = Date.now();
        const logs: string[] = [];

        // Generate code hash for tracking
        const codeHash = crypto.createHash('sha256').update(code).digest('hex').substring(0, 16);

        try {
            // Validate code
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

            // Create sandbox environment
            const sandbox = this.createSandbox(context, logs, execConfig);

            // Create VM instance
            // Note: vm2 doesn't allow require() at all by default - this is secure by design
            const vm = new VM({
                timeout: execConfig.timeout,
                sandbox
            });

            // Wrap code in async function to allow return statements and async operations
            const wrappedCode = `
                (async function() {
                    ${code}
                })();
            `;

            // Execute code and await the promise from the async function
            const resultPromise = vm.run(wrappedCode);
            const result = await resultPromise;

            const executionTime = Date.now() - startTime;


            return {
                success: true,
                output: result,
                logs,
                executionTime,
                resourceUsage: {
                    memory: process.memoryUsage().heapUsed / 1024 / 1024, // MB
                    timeout: false
                },
                codeHash
            };

        } catch (error: any) {
            const executionTime = Date.now() - startTime;

            // Check if it's a timeout error
            const isTimeout = error.message?.includes('Script execution timed out');

            this.logger.error('Code execution failed', {
                codeHash,
                error: error.message,
                executionTime,
                agentId: context.agentId,
                timeout: isTimeout
            });

            return {
                success: false,
                output: null,
                logs,
                executionTime,
                resourceUsage: {
                    memory: process.memoryUsage().heapUsed / 1024 / 1024,
                    timeout: isTimeout
                },
                error: error.message || String(error),
                codeHash
            };
        }
    }

    /**
     * Execute TypeScript code (compiles to JavaScript first)
     */
    public async executeTypeScript(
        code: string,
        context: SandboxContext,
        config?: Partial<SandboxConfig>
    ): Promise<ExecutionResult> {
        // For Phase 1, we'll transpile TypeScript to JavaScript using a simple approach
        // In Phase 2/3, we can add proper TypeScript compilation with @typescript/vfs

        try {
            // Basic TypeScript stripping (removes type annotations)
            // This is a simple approach - in production we'd use proper TS compiler
            const jsCode = this.stripTypeScriptTypes(code);

            // Execute as JavaScript
            return await this.executeJavaScript(jsCode, context, config);

        } catch (error: any) {
            this.logger.error('TypeScript execution failed', {
                error: error.message,
                agentId: context.agentId
            });

            return {
                success: false,
                output: null,
                logs: [],
                executionTime: 0,
                resourceUsage: { memory: 0, timeout: false },
                error: `TypeScript compilation failed: ${error.message}`,
                codeHash: crypto.createHash('sha256').update(code).digest('hex').substring(0, 16)
            };
        }
    }

    /**
     * Create sandbox environment with context
     */
    private createSandbox(
        context: SandboxContext,
        logs: string[],
        config: SandboxConfig
    ): Record<string, any> {
        const sandbox: Record<string, any> = {
            // Provide context as-is (includes agentId, channelId, requestId, and any additional data)
            context,

            // Provide safe utilities
            setTimeout,
            setInterval,
            clearTimeout,
            clearInterval,

            // JSON utilities
            JSON,

            // Math utilities
            Math,

            // Date utilities
            Date,

            // String/Array utilities
            String,
            Number,
            Boolean,
            Array,
            Object
        };

        // Optionally capture console output
        if (config.captureConsole) {
            sandbox.console = {
                log: (...args: any[]) => {
                    logs.push(args.map(a => String(a)).join(' '));
                },
                error: (...args: any[]) => {
                    logs.push('[ERROR] ' + args.map(a => String(a)).join(' '));
                },
                warn: (...args: any[]) => {
                    logs.push('[WARN] ' + args.map(a => String(a)).join(' '));
                },
                info: (...args: any[]) => {
                    logs.push('[INFO] ' + args.map(a => String(a)).join(' '));
                }
            };
        }

        return sandbox;
    }

    /**
     * Simple TypeScript type stripping (basic implementation)
     * TODO: Use proper TypeScript compiler in Phase 2/3
     */
    private stripTypeScriptTypes(code: string): string {
        let jsCode = code;

        // Remove interface declarations (multiline-safe)
        jsCode = jsCode.replace(/interface\s+[A-Za-z_][A-Za-z0-9_]*\s*\{[\s\S]*?\}/g, '');

        // Remove type declarations
        jsCode = jsCode.replace(/type\s+[A-Za-z_][A-Za-z0-9_]*\s*=\s*[\s\S]*?;/g, '');

        // Remove `: Type` annotations (more conservative)
        jsCode = jsCode.replace(/:\s*[A-Za-z_][A-Za-z0-9_<>[\]|&,\s]*(?=[,\)\}=;])/g, '');

        // Remove `as Type` assertions
        jsCode = jsCode.replace(/\s+as\s+[A-Za-z_][A-Za-z0-9_<>[\]|&,\s]*(?=[,\)\}=;])/g, '');

        // Remove type parameters from generic functions/classes
        jsCode = jsCode.replace(/<[A-Za-z_][A-Za-z0-9_<>[\]|&,\s]*>/g, '');

        return jsCode;
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
}
