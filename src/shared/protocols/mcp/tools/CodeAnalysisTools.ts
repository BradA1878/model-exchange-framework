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
import { paginationInputSchema, paginateArray, paginateMultipleArrays, checkResultSize } from '../../../utils/ToolPaginationUtils';
import * as fs from 'fs/promises';
import * as path from 'path';

const logger = new Logger('info', 'CodeAnalysisTools', 'server');

// Helper functions
function detectFunctionType(content: string): string {
    if (content.includes('function ')) return 'function_declaration';
    if (content.includes('const ') && content.includes('=')) return 'const_function';
    if (content.includes(': function')) return 'method_function';
    if (content.includes(': (')) return 'arrow_function';
    return 'unknown';
}

function analyzeComplexity(content: string): any[] {
    const functions = [];
    const lines = content.split('\n');
    let currentFunction: any = null;
    let braceCount = 0;
    let functionStart = 0;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        // Detect function start
        if (line.match(/^\s*(function|const\s+\w+\s*=|.*:\s*function)/)) {
            const nameMatch = line.match(/(?:function\s+(\w+)|const\s+(\w+)|(\w+)\s*:)/);
            if (nameMatch) {
                currentFunction = {
                    name: nameMatch[1] || nameMatch[2] || nameMatch[3],
                    line: i + 1,
                    start: i,
                    complexity: 0
                };
                functionStart = i;
                braceCount = 0;
            }
        }

        // Count braces
        if (currentFunction) {
            braceCount += (line.match(/\{/g) || []).length;
            braceCount -= (line.match(/\}/g) || []).length;
            
            if (braceCount === 0 && line.includes('}')) {
                currentFunction.complexity = i - functionStart;
                if (currentFunction.complexity > 50) {
                    functions.push(currentFunction);
                }
                currentFunction = null;
            }
        }
    }

    return functions;
}

function findDuplication(lines: string[]): any[] {
    const duplicates = [];
    const blockSize = 5;
    
    for (let i = 0; i < lines.length - blockSize; i++) {
        const block = lines.slice(i, i + blockSize).join('\n');
        const similarBlocks = [];
        
        for (let j = i + blockSize; j < lines.length - blockSize; j++) {
            const compareBlock = lines.slice(j, j + blockSize).join('\n');
            if (calculateSimilarity(block, compareBlock) > 0.8) {
                similarBlocks.push(j + 1);
            }
        }
        
        if (similarBlocks.length > 0) {
            duplicates.push({
                lines: [i + 1, ...similarBlocks],
                similarity: 0.8
            });
        }
    }
    
    return duplicates;
}

function calculateSimilarity(str1: string, str2: string): number {
    const words1 = str1.split(/\s+/);
    const words2 = str2.split(/\s+/);
    const intersection = words1.filter(word => words2.includes(word));
    return intersection.length / Math.max(words1.length, words2.length);
}

function analyzePatterns(content: string): any[] {
    const patterns = [];
    
    // Check for console.log statements
    if (content.includes('console.log')) {
        patterns.push({
            type: 'patterns',
            severity: 'low',
            message: 'Console.log statements found',
            line: 0,
            suggestion: 'Consider using a proper logging library'
        });
    }

    // Check for any usage
    if (content.includes(': any')) {
        patterns.push({
            type: 'patterns',
            severity: 'medium',
            message: 'Any type usage found',
            line: 0,
            suggestion: 'Consider using specific types for better type safety'
        });
    }

    return patterns;
}

function validateLayering(filePath: string, content: string): any[] {
    const violations = [];
    
    // Check if service layer imports from controller layer
    if (filePath.includes('/services/') && content.includes('from.*controller')) {
        violations.push({
            type: 'layering',
            severity: 'high',
            file: filePath,
            message: 'Service layer should not import from controller layer',
            suggestion: 'Move common logic to a shared utility or use dependency injection'
        });
    }
    
    return violations;
}

function validateDependencies(filePath: string, content: string): any[] {
    const violations = [];
    
    // Check for circular dependencies (basic check)
    const imports = content.match(/import.*from\s+['"]([^'"]+)['"]/g) || [];
    for (const importStr of imports) {
        const modulePath = importStr.match(/from\s+['"]([^'"]+)['"]/)?.[1];
        if (modulePath && modulePath.includes(path.basename(filePath, path.extname(filePath)))) {
            violations.push({
                type: 'dependencies',
                severity: 'high',
                file: filePath,
                message: 'Potential circular dependency detected',
                suggestion: 'Restructure modules to avoid circular dependencies'
            });
        }
    }
    
    return violations;
}

function validateNaming(filePath: string, content: string): any[] {
    const violations = [];
    
    // Check file naming conventions
    const fileName = path.basename(filePath);
    if (fileName.includes('_') && !fileName.includes('.test.') && !fileName.includes('.spec.')) {
        violations.push({
            type: 'naming',
            severity: 'low',
            file: filePath,
            message: 'File uses underscore naming instead of camelCase or PascalCase',
            suggestion: 'Use camelCase for variables/functions or PascalCase for classes/components'
        });
    }
    
    return violations;
}

/**
 * Code Analysis Tools for MXF
 * 
 * Provides intelligent code analysis using filesystem access and TypeScript compiler APIs
 * These tools enable agents to understand architecture, dependencies, and code patterns
 */

export const analyzeCodebaseTool = {
    name: 'analyze_codebase',
    description: 'Analyze codebase structure, dependencies, and architecture patterns',
    inputSchema: {
        type: 'object',
        properties: {
            workingDirectory: {
                type: 'string',
                description: 'Root directory to analyze (defaults to current directory)'
            },
            includePatterns: {
                type: 'array',
                items: { type: 'string' },
                default: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
                description: 'File patterns to include in analysis'
            },
            excludePatterns: {
                type: 'array',
                items: { type: 'string' },
                default: ['node_modules/**', 'dist/**', 'build/**', '**/*.test.*', '**/*.spec.*'],
                description: 'File patterns to exclude from analysis'
            },
            maxDepth: {
                type: 'number',
                default: 10,
                description: 'Maximum directory depth to analyze'
            }
        }
    },
    handler: async (args: any, context: any) => {
        
        try {
            const workingDir = args.workingDirectory || process.cwd();
            const analysis: {
                structure: any;
                dependencies: any;
                patterns: any;
                metrics: any;
                recommendations: any[];
            } = {
                structure: {},
                dependencies: {},
                patterns: {},
                metrics: {},
                recommendations: []
            };

            // Get project structure
            const result = await executeShellCommand('find', [
                workingDir,
                '-type', 'f',
                '-name', '*.ts',
                '-o', '-name', '*.tsx',
                '-o', '-name', '*.js',
                '-o', '-name', '*.jsx'
            ], {
                workingDirectory: workingDir,
                captureOutput: true
            });

            if (result.exitCode === 0 && result.stdout) {
                const files = result.stdout.split('\n').filter(f => f.trim());
                
                // Analyze file structure
                analysis.structure = {
                    totalFiles: files.length,
                    directories: [...new Set(files.map(f => path.dirname(f)))],
                    filesByType: {
                        typescript: files.filter(f => f.endsWith('.ts')).length,
                        tsx: files.filter(f => f.endsWith('.tsx')).length,
                        javascript: files.filter(f => f.endsWith('.js')).length,
                        jsx: files.filter(f => f.endsWith('.jsx')).length
                    }
                };

                // Analyze dependencies using package.json
                try {
                    const packageJson = await fs.readFile(path.join(workingDir, 'package.json'), 'utf-8');
                    const pkg = JSON.parse(packageJson);
                    analysis.dependencies = {
                        production: Object.keys(pkg.dependencies || {}),
                        development: Object.keys(pkg.devDependencies || {}),
                        peerDependencies: Object.keys(pkg.peerDependencies || {})
                    };
                } catch (error) {
                    logger.warn('Could not read package.json', { error });
                }

                // Analyze TypeScript configuration
                try {
                    const tsconfigPath = path.join(workingDir, 'tsconfig.json');
                    const tsconfig = await fs.readFile(tsconfigPath, 'utf-8');
                    const config = JSON.parse(tsconfig);
                    analysis.patterns = {
                        ...analysis.patterns,
                        typescript: {
                            target: config.compilerOptions?.target,
                            module: config.compilerOptions?.module,
                            strict: config.compilerOptions?.strict,
                            includes: config.include,
                            excludes: config.exclude
                        }
                    };
                } catch (error) {
                    logger.warn('Could not read tsconfig.json', { error });
                }
            }

            return {
                success: true,
                analysis,
                error: null
            };
        } catch (error) {
            logger.error('Codebase analysis failed', { error });
            return {
                success: false,
                analysis: null,
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }
};

export const findFunctionsTool = {
    name: 'find_functions',
    description: 'Find function definitions and their signatures across the codebase. Supports pagination for large result sets.',
    inputSchema: {
        type: 'object',
        properties: {
            functionName: {
                type: 'string',
                description: 'Function name to search for (supports regex patterns)'
            },
            filePatterns: {
                type: 'array',
                items: { type: 'string' },
                default: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
                description: 'File patterns to search in'
            },
            includeSignatures: {
                type: 'boolean',
                default: true,
                description: 'Include function signatures in results'
            },
            workingDirectory: {
                type: 'string',
                description: 'Working directory path (defaults to current directory)'
            },
            ...paginationInputSchema
        },
        required: ['functionName']
    },
    handler: async (args: any, context: any) => {

        try {
            const workingDir = args.workingDirectory || process.cwd();
            const limit = args.limit ?? 50;
            const offset = args.offset ?? 0;
            const allFunctions: any[] = [];

            // Use ripgrep for fast searching
            const result = await executeShellCommand('rg', [
                '--type-add', 'code:*.{ts,tsx,js,jsx}',
                '--type', 'code',
                '--line-number',
                '--no-heading',
                `(function\\s+${args.functionName}|const\\s+${args.functionName}\\s*=|${args.functionName}\\s*:\\s*function|${args.functionName}\\s*:\\s*\\()`
            ], {
                workingDirectory: workingDir,
                captureOutput: true
            });

            if (result.exitCode === 0 && result.stdout) {
                const lines = result.stdout.split('\n').filter(l => l.trim());

                for (const line of lines) {
                    const [filePath, lineNumber, content] = line.split(':', 3);
                    if (filePath && lineNumber && content) {
                        allFunctions.push({
                            file: filePath,
                            line: parseInt(lineNumber),
                            content: content.trim(),
                            type: detectFunctionType(content)
                        });
                    }
                }
            }

            // Apply pagination
            const { items: functions, pagination } = paginateArray(allFunctions, limit, offset);

            return checkResultSize({
                success: true,
                functions,
                ...pagination,  // totalCount, limit, offset, hasMore, nextOffset
                error: null
            }, 'find_functions', logger);
        } catch (error) {
            logger.error('Find functions failed', { error });
            return {
                success: false,
                functions: [],
                totalCount: 0,
                limit: args.limit ?? 50,
                offset: args.offset ?? 0,
                hasMore: false,
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }
};

export const traceDependenciesTool = {
    name: 'trace_dependencies',
    description: 'Trace dependencies and imports for impact analysis. Supports pagination for large result sets.',
    inputSchema: {
        type: 'object',
        properties: {
            filePath: {
                type: 'string',
                description: 'File path to analyze dependencies for'
            },
            direction: {
                type: 'string',
                enum: ['imports', 'exports', 'both'],
                default: 'both',
                description: 'Direction to trace dependencies'
            },
            maxDepth: {
                type: 'number',
                default: 3,
                description: 'Maximum depth to trace dependencies'
            },
            workingDirectory: {
                type: 'string',
                description: 'Working directory path (defaults to current directory)'
            },
            ...paginationInputSchema
        },
        required: ['filePath']
    },
    handler: async (args: any, context: any) => {

        try {
            const workingDir = args.workingDirectory || process.cwd();
            const limit = args.limit ?? 50;
            const offset = args.offset ?? 0;
            const allImports: any[] = [];
            const allExports: any[] = [];
            const allDependents: any[] = [];

            // Read the target file
            const fullPath = path.resolve(workingDir, args.filePath);
            const content = await fs.readFile(fullPath, 'utf-8');

            // Extract imports
            if (args.direction === 'imports' || args.direction === 'both') {
                const importRegex = /import\s+.*?\s+from\s+['"]([^'"]+)['"]/g;
                let match;
                while ((match = importRegex.exec(content)) !== null) {
                    allImports.push({
                        module: match[1],
                        isRelative: match[1].startsWith('.'),
                        line: content.substring(0, match.index).split('\n').length
                    });
                }
            }

            // Extract exports
            if (args.direction === 'exports' || args.direction === 'both') {
                const exportRegex = /export\s+(?:default\s+)?(?:class|function|const|let|var|interface|type)\s+(\w+)/g;
                let match;
                while ((match = exportRegex.exec(content)) !== null) {
                    allExports.push({
                        name: match[1],
                        line: content.substring(0, match.index).split('\n').length
                    });
                }
            }

            // Find files that import this file
            const relativePath = path.relative(workingDir, args.filePath);
            const importPattern = relativePath.replace(/\\/g, '/').replace(/\.(ts|tsx|js|jsx)$/, '');

            const dependentsResult = await executeShellCommand('rg', [
                '--type-add', 'code:*.{ts,tsx,js,jsx}',
                '--type', 'code',
                '--line-number',
                '--no-heading',
                `from\\s+['"].*${importPattern}['"]`
            ], {
                workingDirectory: workingDir,
                captureOutput: true
            });

            if (dependentsResult.exitCode === 0 && dependentsResult.stdout) {
                const lines = dependentsResult.stdout.split('\n').filter(l => l.trim());

                for (const line of lines) {
                    const [filePath, lineNumber, lineContent] = line.split(':', 3);
                    if (filePath && lineNumber) {
                        allDependents.push({
                            file: filePath,
                            line: parseInt(lineNumber),
                            content: lineContent?.trim() ?? ''
                        });
                    }
                }
            }

            // Apply pagination to each array
            const { paginatedArrays, metadata } = paginateMultipleArrays(
                { imports: allImports, exports: allExports, dependents: allDependents },
                limit,
                offset
            );

            return checkResultSize({
                success: true,
                dependencies: paginatedArrays,
                pagination: metadata,  // Contains per-array metadata plus combinedTotalCount and anyHasMore
                error: null
            }, 'trace_dependencies', logger);
        } catch (error) {
            logger.error('Trace dependencies failed', { error });
            return {
                success: false,
                dependencies: null,
                pagination: null,
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }
};

export const suggestRefactoringTool = {
    name: 'suggest_refactoring',
    description: 'Analyze code and suggest refactoring opportunities. Supports pagination for large result sets.',
    inputSchema: {
        type: 'object',
        properties: {
            filePath: {
                type: 'string',
                description: 'File path to analyze for refactoring'
            },
            analysisType: {
                type: 'string',
                enum: ['complexity', 'duplication', 'patterns', 'performance', 'all'],
                default: 'all',
                description: 'Type of analysis to perform'
            },
            workingDirectory: {
                type: 'string',
                description: 'Working directory path (defaults to current directory)'
            },
            ...paginationInputSchema
        },
        required: ['filePath']
    },
    handler: async (args: any, context: any) => {

        try {
            const workingDir = args.workingDirectory || process.cwd();
            const limit = args.limit ?? 50;
            const offset = args.offset ?? 0;
            const allSuggestions: any[] = [];

            // Read the file
            const fullPath = path.resolve(workingDir, args.filePath);
            const content = await fs.readFile(fullPath, 'utf-8');
            const lines = content.split('\n');

            // Analyze complexity
            if (args.analysisType === 'complexity' || args.analysisType === 'all') {
                const complexFunctions = analyzeComplexity(content);
                allSuggestions.push(...complexFunctions.map((f: any) => ({
                    type: 'complexity',
                    severity: 'medium',
                    message: `Function '${f.name}' has high complexity (${f.complexity} lines)`,
                    line: f.line,
                    suggestion: 'Consider breaking this function into smaller, more focused functions'
                })));
            }

            // Analyze code duplication
            if (args.analysisType === 'duplication' || args.analysisType === 'all') {
                const duplicates = findDuplication(lines);
                allSuggestions.push(...duplicates.map((d: any) => ({
                    type: 'duplication',
                    severity: 'low',
                    message: `Similar code block found at lines ${d.lines.join(', ')}`,
                    line: d.lines[0],
                    suggestion: 'Consider extracting common code into a reusable function'
                })));
            }

            // Analyze patterns
            if (args.analysisType === 'patterns' || args.analysisType === 'all') {
                const patterns = analyzePatterns(content);
                allSuggestions.push(...patterns);
            }

            // Apply pagination
            const { items: suggestions, pagination } = paginateArray(allSuggestions, limit, offset);

            return checkResultSize({
                success: true,
                suggestions,
                ...pagination,  // totalCount, limit, offset, hasMore, nextOffset
                error: null
            }, 'suggest_refactoring', logger);
        } catch (error) {
            logger.error('Suggest refactoring failed', { error });
            return {
                success: false,
                suggestions: [],
                totalCount: 0,
                limit: args.limit ?? 50,
                offset: args.offset ?? 0,
                hasMore: false,
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }
};

export const validateArchitectureTool = {
    name: 'validate_architecture',
    description: 'Validate code changes against architectural principles and patterns. Supports pagination for large result sets.',
    inputSchema: {
        type: 'object',
        properties: {
            filePaths: {
                type: 'array',
                items: { type: 'string' },
                description: 'File paths to validate'
            },
            rules: {
                type: 'array',
                items: { type: 'string' },
                default: ['layering', 'dependencies', 'naming', 'patterns'],
                description: 'Validation rules to apply'
            },
            ...paginationInputSchema
        },
        required: ['filePaths']
    },
    handler: async (args: any, context: any) => {

        try {
            const limit = args.limit ?? 50;
            const offset = args.offset ?? 0;
            const allViolations: any[] = [];

            for (const filePath of args.filePaths) {
                const content = await fs.readFile(filePath, 'utf-8');

                // Validate layering
                if (args.rules.includes('layering')) {
                    const layerViolations = validateLayering(filePath, content);
                    allViolations.push(...layerViolations);
                }

                // Validate dependencies
                if (args.rules.includes('dependencies')) {
                    const depViolations = validateDependencies(filePath, content);
                    allViolations.push(...depViolations);
                }

                // Validate naming
                if (args.rules.includes('naming')) {
                    const namingViolations = validateNaming(filePath, content);
                    allViolations.push(...namingViolations);
                }
            }

            // Apply pagination
            const { items: violations, pagination } = paginateArray(allViolations, limit, offset);

            return checkResultSize({
                success: true,
                violations,
                ...pagination,  // totalCount, limit, offset, hasMore, nextOffset
                isValid: pagination.totalCount === 0,
                error: null
            }, 'validate_architecture', logger);
        } catch (error) {
            logger.error('Architecture validation failed', { error });
            return {
                success: false,
                violations: [],
                totalCount: 0,
                limit: args.limit ?? 50,
                offset: args.offset ?? 0,
                hasMore: false,
                isValid: false,
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }
};

// Export all code analysis tools
export const codeAnalysisTools = [
    analyzeCodebaseTool,
    findFunctionsTool,
    traceDependenciesTool,
    suggestRefactoringTool,
    validateArchitectureTool
];