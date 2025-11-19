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

import { Logger } from '../../../utils/Logger';
import { executeShellCommand } from './InfrastructureTools';
import { McpToolHandlerContext, McpToolHandlerResult, McpToolResultContent } from '../McpServerTypes';

const logger = new Logger('info', 'TypeScriptTools', 'server');

/**
 * TypeScript Language Server Tools for MXF
 * 
 * Provides TypeScript analysis, diagnostics, and code intelligence
 * These tools are placeholders that demonstrate the interface
 * Full implementation would integrate with shell_execute tool
 */

export const typescriptCheckTool = {
    name: 'typescript_check',
    description: 'Type-check TypeScript files and report diagnostics',
    inputSchema: {
        type: 'object',
        properties: {
            workingDirectory: {
                type: 'string',
                description: 'Working directory path (defaults to current directory)'
            },
            files: {
                type: 'array',
                items: { type: 'string' },
                description: 'Specific files to check (optional, checks all if not provided)'
            }
        }
    },
    handler: async (args: {
        workingDirectory?: string;
        files?: string[];
    }, context: McpToolHandlerContext): Promise<McpToolHandlerResult> => {
        
        try {
            const tscArgs = ['--noEmit', '--pretty', 'false'];
            if (args.files && args.files.length > 0) {
                tscArgs.push(...args.files);
            }
            
            const result = await executeShellCommand('npx', ['tsc', ...tscArgs], {
                workingDirectory: args.workingDirectory || process.cwd(),
                captureOutput: true
            });

            // TypeScript compiler exits with code 1 if there are errors, but this is expected
            const diagnostics = [];
            let totalErrors = 0;
            let totalWarnings = 0;
            let filesChecked = 0;

            if (result.stdout) {
                // Parse TypeScript compiler output
                const lines = result.stdout.split('\n');
                for (const line of lines) {
                    if (line.includes('error TS')) {
                        totalErrors++;
                        diagnostics.push({
                            type: 'error',
                            message: line.trim(),
                            file: line.split('(')[0] || '',
                            line: 0,
                            column: 0
                        });
                    } else if (line.includes('warning TS')) {
                        totalWarnings++;
                        diagnostics.push({
                            type: 'warning',
                            message: line.trim(),
                            file: line.split('(')[0] || '',
                            line: 0,
                            column: 0
                        });
                    }
                }
            }

            const content: McpToolResultContent = {
                type: 'application/json',
                data: {
                    success: result.exitCode === 0,
                    diagnostics,
                    totalErrors,
                    totalWarnings,
                    filesChecked: args.files ? args.files.length : 0,
                    error: result.exitCode !== 0 ? result.stderr : null
                }
            };
            return { content };
        } catch (error) {
            logger.error('TypeScript check failed', { error });
            const content: McpToolResultContent = {
                type: 'application/json',
                data: {
                    success: false,
                    diagnostics: [],
                    totalErrors: 0,
                    totalWarnings: 0,
                    filesChecked: 0,
                    error: error instanceof Error ? error.message : String(error)
                }
            };
            return { content };
        }
    }
};

export const typescriptBuildTool = {
    name: 'typescript_build',
    description: 'Build TypeScript project and emit JavaScript files',
    inputSchema: {
        type: 'object',
        properties: {
            workingDirectory: {
                type: 'string',
                description: 'Working directory path (defaults to current directory)'
            },
            clean: {
                type: 'boolean',
                default: false,
                description: 'Clean output directory before build'
            }
        }
    },
    handler: async (args: {
        workingDirectory?: string;
        clean?: boolean;
    }, context: McpToolHandlerContext): Promise<McpToolHandlerResult> => {
        
        try {
            const startTime = Date.now();
            
            // Clean output directory if requested
            if (args.clean) {
                const cleanResult = await executeShellCommand('npx', ['tsc', '--build', '--clean'], {
                    workingDirectory: args.workingDirectory || process.cwd(),
                    captureOutput: true
                });
                if (cleanResult.exitCode !== 0) {
                    logger.warn('Clean command failed', { error: cleanResult.stderr });
                }
            }
            
            const result = await executeShellCommand('npx', ['tsc', '--build'], {
                workingDirectory: args.workingDirectory || process.cwd(),
                captureOutput: true
            });

            const buildTime = Date.now() - startTime;
            
            const errors = [];
            const warnings = [];
            
            if (result.stdout) {
                const lines = result.stdout.split('\n');
                for (const line of lines) {
                    if (line.includes('error TS')) {
                        errors.push(line.trim());
                    } else if (line.includes('warning TS')) {
                        warnings.push(line.trim());
                    }
                }
            }

            const content: McpToolResultContent = {
                type: 'application/json',
                data: {
                    success: result.exitCode === 0,
                    output: result.stdout || '',
                    errors,
                    warnings,
                    buildTime,
                    error: result.exitCode !== 0 ? result.stderr : null
                }
            };
            return { content };
        } catch (error) {
            logger.error('TypeScript build failed', { error });
            const content: McpToolResultContent = {
                type: 'application/json',
                data: {
                    success: false,
                    output: '',
                    errors: [],
                    warnings: [],
                    buildTime: 0,
                    error: error instanceof Error ? error.message : String(error)
                }
            };
            return { content };
        }
    }
};

export const typescriptFormatTool = {
    name: 'typescript_format',
    description: 'Format TypeScript files using prettier or similar formatter',
    inputSchema: {
        type: 'object',
        properties: {
            files: {
                type: 'array',
                items: { type: 'string' },
                description: 'Files to format (supports glob patterns)'
            },
            check: {
                type: 'boolean',
                default: false,
                description: 'Check if files are formatted without modifying them'
            },
            workingDirectory: {
                type: 'string',
                description: 'Working directory path (defaults to current directory)'
            }
        }
    },
    handler: async (args: {
        files?: string[];
        check?: boolean;
        workingDirectory?: string;
    }, context: McpToolHandlerContext): Promise<McpToolHandlerResult> => {
        
        try {
            const prettierArgs = args.check ? ['--check'] : ['--write'];
            if (args.files && args.files.length > 0) {
                prettierArgs.push(...args.files);
            } else {
                prettierArgs.push('**/*.{ts,tsx,js,jsx}');
            }
            
            const result = await executeShellCommand('npx', ['prettier', ...prettierArgs], {
                workingDirectory: args.workingDirectory || process.cwd(),
                captureOutput: true
            });

            const formattedFiles = [];
            const unchanged = [];
            
            if (result.stdout) {
                const lines = result.stdout.split('\n');
                for (const line of lines) {
                    if (line.includes('unchanged')) {
                        unchanged.push(line.trim());
                    } else if (line.trim() && !line.startsWith('Checking')) {
                        formattedFiles.push(line.trim());
                    }
                }
            }

            const content: McpToolResultContent = {
                type: 'application/json',
                data: {
                    success: result.exitCode === 0,
                    formattedFiles,
                    unchanged,
                    error: result.exitCode !== 0 ? result.stderr : null
                }
            };
            return { content };
        } catch (error) {
            logger.error('TypeScript format failed', { error });
            const content: McpToolResultContent = {
                type: 'application/json',
                data: {
                    success: false,
                    formattedFiles: [],
                    unchanged: [],
                    error: error instanceof Error ? error.message : String(error)
                }
            };
            return { content };
        }
    }
};

export const typescriptLintTool = {
    name: 'typescript_lint',
    description: 'Lint TypeScript files using ESLint',
    inputSchema: {
        type: 'object',
        properties: {
            files: {
                type: 'array',
                items: { type: 'string' },
                description: 'Files to lint (supports glob patterns)'
            },
            fix: {
                type: 'boolean',
                default: false,
                description: 'Automatically fix problems'
            },
            workingDirectory: {
                type: 'string',
                description: 'Working directory path (defaults to current directory)'
            }
        }
    },
    handler: async (args: {
        files?: string[];
        fix?: boolean;
        workingDirectory?: string;
    }, context: McpToolHandlerContext): Promise<McpToolHandlerResult> => {
        
        try {
            const eslintArgs = ['--format', 'json'];
            if (args.fix) {
                eslintArgs.push('--fix');
            }
            
            if (args.files && args.files.length > 0) {
                eslintArgs.push(...args.files);
            } else {
                eslintArgs.push('**/*.{ts,tsx,js,jsx}');
            }
            
            const result = await executeShellCommand('npx', ['eslint', ...eslintArgs], {
                workingDirectory: args.workingDirectory || process.cwd(),
                captureOutput: true
            });

            let results = [];
            try {
                if (result.stdout) {
                    results = JSON.parse(result.stdout);
                }
            } catch (parseError) {
                logger.warn('Could not parse ESLint output as JSON', { output: result.stdout });
                results = [{
                    filePath: 'unknown',
                    messages: [{
                        message: result.stdout,
                        severity: 1,
                        line: 0,
                        column: 0
                    }]
                }];
            }

            const content: McpToolResultContent = {
                type: 'application/json',
                data: {
                    success: result.exitCode === 0,
                    results,
                    error: result.exitCode !== 0 ? result.stderr : null
                }
            };
            return { content };
        } catch (error) {
            logger.error('TypeScript lint failed', { error });
            const content: McpToolResultContent = {
                type: 'application/json',
                data: {
                    success: false,
                    results: [],
                    error: error instanceof Error ? error.message : String(error)
                }
            };
            return { content };
        }
    }
};

export const typescriptTestTool = {
    name: 'typescript_test',
    description: 'Run TypeScript tests using Jest or other test runners',
    inputSchema: {
        type: 'object',
        properties: {
            testFiles: {
                type: 'array',
                items: { type: 'string' },
                description: 'Specific test files to run'
            },
            coverage: {
                type: 'boolean',
                default: false,
                description: 'Generate test coverage report'
            },
            workingDirectory: {
                type: 'string',
                description: 'Working directory path (defaults to current directory)'
            }
        }
    },
    handler: async (args: {
        testFiles?: string[];
        coverage?: boolean;
        workingDirectory?: string;
    }, context: McpToolHandlerContext): Promise<McpToolHandlerResult> => {
        
        try {
            const jestArgs = ['--no-watchman', '--passWithNoTests'];
            
            if (args.coverage) {
                jestArgs.push('--coverage');
            }
            
            if (args.testFiles && args.testFiles.length > 0) {
                jestArgs.push(...args.testFiles);
            }
            
            const result = await executeShellCommand('npx', ['jest', ...jestArgs], {
                workingDirectory: args.workingDirectory || process.cwd(),
                captureOutput: true
            });

            // Parse Jest output for test results
            let testsRun = 0;
            let testsPassed = 0;
            let testsFailed = 0;
            
            if (result.stdout) {
                const runMatch = result.stdout.match(/Tests:\s+(\d+)\s+total/);
                const passMatch = result.stdout.match(/Tests:\s+\d+\s+failed,\s+(\d+)\s+passed/);
                const failMatch = result.stdout.match(/Tests:\s+(\d+)\s+failed/);
                
                if (runMatch) testsRun = parseInt(runMatch[1]);
                if (passMatch) testsPassed = parseInt(passMatch[1]);
                if (failMatch) testsFailed = parseInt(failMatch[1]);
                
                // Alternative parsing for different Jest output formats
                if (testsRun === 0) {
                    const totalMatch = result.stdout.match(/(\d+)\s+tests?\s+passed/);
                    if (totalMatch) {
                        testsRun = parseInt(totalMatch[1]);
                        testsPassed = testsRun;
                    }
                }
            }

            const content: McpToolResultContent = {
                type: 'application/json',
                data: {
                    success: result.exitCode === 0,
                    output: result.stdout || '',
                    testsRun,
                    testsPassed,
                    testsFailed,
                    error: result.exitCode !== 0 ? result.stderr : null
                }
            };
            return { content };
        } catch (error) {
            logger.error('TypeScript test failed', { error });
            const content: McpToolResultContent = {
                type: 'application/json',
                data: {
                    success: false,
                    output: '',
                    testsRun: 0,
                    testsPassed: 0,
                    testsFailed: 0,
                    error: error instanceof Error ? error.message : String(error)
                }
            };
            return { content };
        }
    }
};

// Export all TypeScript tools
export const typescriptTools = [
    typescriptCheckTool,
    typescriptBuildTool,
    typescriptFormatTool,
    typescriptLintTool,
    typescriptTestTool
];
