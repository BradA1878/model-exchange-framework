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

const logger = new Logger('info', 'TestTools', 'server');

/**
 * Test Tools for MXF
 * 
 * Provides comprehensive testing capabilities for multiple test runners
 * and testing frameworks including Jest, Mocha, Vitest, and others
 */

export const jestTestTool = {
    name: 'test_jest',
    description: 'Run Jest tests with comprehensive options',
    inputSchema: {
        type: 'object',
        properties: {
            testFiles: {
                type: 'array',
                items: { type: 'string' },
                description: 'Specific test files to run'
            },
            testNamePattern: {
                type: 'string',
                description: 'Run tests with names matching this pattern'
            },
            coverage: {
                type: 'boolean',
                default: false,
                description: 'Generate test coverage report'
            },
            watchMode: {
                type: 'boolean',
                default: false,
                description: 'Run tests in watch mode'
            },
            verbose: {
                type: 'boolean',
                default: false,
                description: 'Display individual test results'
            },
            maxWorkers: {
                type: 'number',
                description: 'Maximum number of worker processes'
            },
            workingDirectory: {
                type: 'string',
                description: 'Working directory path (defaults to current directory)'
            }
        }
    },
    handler: async (args: {
        testFiles?: string[];
        testNamePattern?: string;
        coverage?: boolean;
        watchMode?: boolean;
        verbose?: boolean;
        maxWorkers?: number;
        workingDirectory?: string;
    }, context: McpToolHandlerContext): Promise<McpToolHandlerResult> => {
        
        try {
            const jestArgs = ['--no-watchman', '--passWithNoTests'];
            
            if (args.coverage) {
                jestArgs.push('--coverage');
            }
            
            if (args.verbose) {
                jestArgs.push('--verbose');
            }
            
            if (args.maxWorkers) {
                jestArgs.push('--maxWorkers', args.maxWorkers.toString());
            }
            
            if (args.testNamePattern) {
                jestArgs.push('--testNamePattern', args.testNamePattern);
            }
            
            if (args.watchMode) {
                jestArgs.push('--watch');
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
            let testSuites = 0;
            let testSuitesPassed = 0;
            let testSuitesFailed = 0;
            
            if (result.stdout) {
                // Parse test results
                const runMatch = result.stdout.match(/Tests:\s+(\d+)\s+total/);
                const passMatch = result.stdout.match(/Tests:\s+\d+\s+failed,\s+(\d+)\s+passed/);
                const failMatch = result.stdout.match(/Tests:\s+(\d+)\s+failed/);
                
                // Parse test suites
                const suitesMatch = result.stdout.match(/Test Suites:\s+(\d+)\s+total/);
                const suitesPassMatch = result.stdout.match(/Test Suites:\s+\d+\s+failed,\s+(\d+)\s+passed/);
                const suitesFailMatch = result.stdout.match(/Test Suites:\s+(\d+)\s+failed/);
                
                if (runMatch) testsRun = parseInt(runMatch[1]);
                if (passMatch) testsPassed = parseInt(passMatch[1]);
                if (failMatch) testsFailed = parseInt(failMatch[1]);
                
                if (suitesMatch) testSuites = parseInt(suitesMatch[1]);
                if (suitesPassMatch) testSuitesPassed = parseInt(suitesPassMatch[1]);
                if (suitesFailMatch) testSuitesFailed = parseInt(suitesFailMatch[1]);
                
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
                    runner: 'jest',
                    output: result.stdout || '',
                    errorOutput: result.stderr || '',
                    testsRun,
                    testsPassed,
                    testsFailed,
                    testSuites,
                    testSuitesPassed,
                    testSuitesFailed,
                    executionTime: result.executionTime,
                    coverage: args.coverage ? 'Coverage report generated' : null,
                    error: result.exitCode !== 0 ? result.stderr : null
                }
            };
            return { content };
        } catch (error) {
            logger.error('Jest test failed', { error });
            const content: McpToolResultContent = {
                type: 'application/json',
                data: {
                    success: false,
                    runner: 'jest',
                    output: '',
                    errorOutput: '',
                    testsRun: 0,
                    testsPassed: 0,
                    testsFailed: 0,
                    testSuites: 0,
                    testSuitesPassed: 0,
                    testSuitesFailed: 0,
                    executionTime: 0,
                    coverage: null,
                    error: error instanceof Error ? error.message : String(error)
                }
            };
            return { content };
        }
    }
};

export const mochaTestTool = {
    name: 'test_mocha',
    description: 'Run Mocha tests with comprehensive options',
    inputSchema: {
        type: 'object',
        properties: {
            testFiles: {
                type: 'array',
                items: { type: 'string' },
                description: 'Specific test files to run'
            },
            grep: {
                type: 'string',
                description: 'Run tests matching this pattern'
            },
            reporter: {
                type: 'string',
                enum: ['spec', 'json', 'tap', 'dot', 'nyan', 'landing', 'list', 'progress', 'json-stream', 'min'],
                default: 'spec',
                description: 'Test reporter format'
            },
            timeout: {
                type: 'number',
                default: 2000,
                description: 'Test timeout in milliseconds'
            },
            recursive: {
                type: 'boolean',
                default: false,
                description: 'Look for tests in subdirectories'
            },
            workingDirectory: {
                type: 'string',
                description: 'Working directory path (defaults to current directory)'
            }
        }
    },
    handler: async (args: {
        testFiles?: string[];
        grep?: string;
        reporter?: string;
        timeout?: number;
        recursive?: boolean;
        workingDirectory?: string;
    }, context: McpToolHandlerContext): Promise<McpToolHandlerResult> => {
        
        try {
            const mochaArgs = ['--reporter', args.reporter || 'spec'];
            
            if (args.timeout) {
                mochaArgs.push('--timeout', args.timeout.toString());
            }
            
            if (args.grep) {
                mochaArgs.push('--grep', args.grep);
            }
            
            if (args.recursive) {
                mochaArgs.push('--recursive');
            }
            
            if (args.testFiles && args.testFiles.length > 0) {
                mochaArgs.push(...args.testFiles);
            } else {
                mochaArgs.push('test/**/*.js');
            }
            
            const result = await executeShellCommand('npx', ['mocha', ...mochaArgs], {
                workingDirectory: args.workingDirectory || process.cwd(),
                captureOutput: true
            });

            // Parse Mocha output for test results
            let testsRun = 0;
            let testsPassed = 0;
            let testsFailed = 0;
            
            if (result.stdout) {
                const passMatch = result.stdout.match(/(\d+)\s+passing/);
                const failMatch = result.stdout.match(/(\d+)\s+failing/);
                
                if (passMatch) testsPassed = parseInt(passMatch[1]);
                if (failMatch) testsFailed = parseInt(failMatch[1]);
                
                testsRun = testsPassed + testsFailed;
            }

            const content: McpToolResultContent = {
                type: 'application/json',
                data: {
                    success: result.exitCode === 0,
                    runner: 'mocha',
                    output: result.stdout || '',
                    errorOutput: result.stderr || '',
                    testsRun,
                    testsPassed,
                    testsFailed,
                    executionTime: result.executionTime,
                    error: result.exitCode !== 0 ? result.stderr : null
                }
            };
            return { content };
        } catch (error) {
            logger.error('Mocha test failed', { error });
            const content: McpToolResultContent = {
                type: 'application/json',
                data: {
                    success: false,
                    runner: 'mocha',
                    output: '',
                    errorOutput: '',
                    testsRun: 0,
                    testsPassed: 0,
                    testsFailed: 0,
                    executionTime: 0,
                    error: error instanceof Error ? error.message : String(error)
                }
            };
            return { content };
        }
    }
};

export const vitestTestTool = {
    name: 'test_vitest',
    description: 'Run Vitest tests with comprehensive options',
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
            watchMode: {
                type: 'boolean',
                default: false,
                description: 'Run tests in watch mode'
            },
            reporter: {
                type: 'string',
                enum: ['default', 'verbose', 'dot', 'json', 'junit', 'html'],
                default: 'default',
                description: 'Test reporter format'
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
        watchMode?: boolean;
        reporter?: string;
        workingDirectory?: string;
    }, context: McpToolHandlerContext): Promise<McpToolHandlerResult> => {
        
        try {
            const vitestArgs = ['--run']; // Force single run (no watch by default)
            
            if (args.coverage) {
                vitestArgs.push('--coverage');
            }
            
            if (args.watchMode) {
                vitestArgs.pop(); // Remove --run
                vitestArgs.push('--watch');
            }
            
            if (args.reporter) {
                vitestArgs.push('--reporter', args.reporter);
            }
            
            if (args.testFiles && args.testFiles.length > 0) {
                vitestArgs.push(...args.testFiles);
            }
            
            const result = await executeShellCommand('npx', ['vitest', ...vitestArgs], {
                workingDirectory: args.workingDirectory || process.cwd(),
                captureOutput: true
            });

            // Parse Vitest output for test results
            let testsRun = 0;
            let testsPassed = 0;
            let testsFailed = 0;
            
            if (result.stdout) {
                const testsMatch = result.stdout.match(/Test Files\s+(\d+)\s+passed/);
                const failMatch = result.stdout.match(/Test Files\s+(\d+)\s+failed/);
                
                if (testsMatch) testsPassed = parseInt(testsMatch[1]);
                if (failMatch) testsFailed = parseInt(failMatch[1]);
                
                testsRun = testsPassed + testsFailed;
            }

            const content: McpToolResultContent = {
                type: 'application/json',
                data: {
                    success: result.exitCode === 0,
                    runner: 'vitest',
                    output: result.stdout || '',
                    errorOutput: result.stderr || '',
                    testsRun,
                    testsPassed,
                    testsFailed,
                    executionTime: result.executionTime,
                    coverage: args.coverage ? 'Coverage report generated' : null,
                    error: result.exitCode !== 0 ? result.stderr : null
                }
            };
            return { content };
        } catch (error) {
            logger.error('Vitest test failed', { error });
            const content: McpToolResultContent = {
                type: 'application/json',
                data: {
                    success: false,
                    runner: 'vitest',
                    output: '',
                    errorOutput: '',
                    testsRun: 0,
                    testsPassed: 0,
                    testsFailed: 0,
                    executionTime: 0,
                    coverage: null,
                    error: error instanceof Error ? error.message : String(error)
                }
            };
            return { content };
        }
    }
};

export const testRunnerTool = {
    name: 'test_runner',
    description: 'Universal test runner that detects and runs the appropriate test framework',
    inputSchema: {
        type: 'object',
        properties: {
            framework: {
                type: 'string',
                enum: ['auto', 'jest', 'mocha', 'vitest'],
                default: 'auto',
                description: 'Test framework to use (auto-detects if not specified)'
            },
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
            watchMode: {
                type: 'boolean',
                default: false,
                description: 'Run tests in watch mode'
            },
            workingDirectory: {
                type: 'string',
                description: 'Working directory path (defaults to current directory)'
            }
        }
    },
    handler: async (args: {
        framework?: 'auto' | 'jest' | 'mocha' | 'vitest';
        testFiles?: string[];
        coverage?: boolean;
        watchMode?: boolean;
        workingDirectory?: string;
    }, context: McpToolHandlerContext): Promise<McpToolHandlerResult> => {
        
        try {
            let framework = args.framework;
            
            // Auto-detect framework if not specified
            if (framework === 'auto' || !framework) {
                // Check package.json for test scripts and dependencies
                const packageJsonResult = await executeShellCommand('cat', ['package.json'], {
                    workingDirectory: args.workingDirectory || process.cwd(),
                    captureOutput: true
                });
                
                if (packageJsonResult.exitCode === 0 && packageJsonResult.stdout) {
                    try {
                        const packageJson = JSON.parse(packageJsonResult.stdout);
                        
                        // Check dependencies and devDependencies
                        const allDeps = {
                            ...packageJson.dependencies,
                            ...packageJson.devDependencies
                        };
                        
                        if (allDeps.vitest) {
                            framework = 'vitest';
                        } else if (allDeps.jest) {
                            framework = 'jest';
                        } else if (allDeps.mocha) {
                            framework = 'mocha';
                        } else {
                            framework = 'jest'; // Default fallback
                        }
                    } catch (parseError) {
                        framework = 'jest'; // Default fallback
                    }
                } else {
                    framework = 'jest'; // Default fallback
                }
            }
            
            // Delegate to the appropriate test tool
            switch (framework) {
                case 'jest':
                    return await jestTestTool.handler(args, context);
                case 'mocha':
                    return await mochaTestTool.handler(args, context);
                case 'vitest':
                    return await vitestTestTool.handler(args, context);
                default:
                    throw new Error(`Unknown test framework: ${framework}`);
            }
        } catch (error) {
            logger.error('Universal test runner failed', { error });
            const content: McpToolResultContent = {
                type: 'application/json',
                data: {
                    success: false,
                    runner: 'unknown',
                    output: '',
                    errorOutput: '',
                    testsRun: 0,
                    testsPassed: 0,
                    testsFailed: 0,
                    executionTime: 0,
                    error: error instanceof Error ? error.message : String(error)
                }
            };
            return { content };
        }
    }
};

// Export all test tools
export const testTools = [
    jestTestTool,
    mochaTestTool,
    vitestTestTool,
    testRunnerTool
];
