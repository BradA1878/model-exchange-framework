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
import * as fs from 'fs/promises';
import * as path from 'path';

const logger = new Logger('info', 'SafetyTools', 'server');

// Helper functions
function parseTestResults(output: string): any {
    const results = {
        total: 0,
        passed: 0,
        failed: 0,
        skipped: 0,
        suites: 0
    };
    
    // Jest output parsing
    const jestMatch = output.match(/Tests:\s+(\d+)\s+failed,\s+(\d+)\s+passed,\s+(\d+)\s+total/);
    if (jestMatch) {
        results.failed = parseInt(jestMatch[1]);
        results.passed = parseInt(jestMatch[2]);
        results.total = parseInt(jestMatch[3]);
    } else {
        // Alternative Jest format
        const altMatch = output.match(/(\d+)\s+passed/);
        if (altMatch) {
            results.passed = parseInt(altMatch[1]);
            results.total = results.passed;
        }
    }
    
    // Test suites
    const suiteMatch = output.match(/Test Suites:\s+(\d+)\s+total/);
    if (suiteMatch) {
        results.suites = parseInt(suiteMatch[1]);
    }
    
    return results;
}

function parseCoverageResults(output: string): any {
    const coverage = {
        statements: 0,
        branches: 0,
        functions: 0,
        lines: 0
    };
    
    // Jest coverage parsing
    const coverageMatch = output.match(/All files[^|]*\|\s*(\d+(?:\.\d+)?)\s*\|\s*(\d+(?:\.\d+)?)\s*\|\s*(\d+(?:\.\d+)?)\s*\|\s*(\d+(?:\.\d+)?)/);
    if (coverageMatch) {
        coverage.statements = parseFloat(coverageMatch[1]);
        coverage.branches = parseFloat(coverageMatch[2]);
        coverage.functions = parseFloat(coverageMatch[3]);
        coverage.lines = parseFloat(coverageMatch[4]);
    }
    
    return coverage;
}

function parseBenchmarkResults(output: string): any {
    const results: {
        metrics: any[];
        summary: any;
    } = {
        metrics: [],
        summary: {}
    };
    
    // Basic parsing - would need to be customized for specific benchmark tools
    const lines = output.split('\n');
    for (const line of lines) {
        // Look for common benchmark output patterns
        const timeMatch = line.match(/(\w+):\s*(\d+(?:\.\d+)?)\s*(ms|s|ns)/);
        if (timeMatch) {
            results.metrics.push({
                name: timeMatch[1],
                value: parseFloat(timeMatch[2]),
                unit: timeMatch[3]
            });
        }
    }
    
    return results;
}

function compareWithBaseline(current: any, baseline: any, threshold: number): any {
    const comparison: {
        passed: boolean;
        degradations: any[];
        improvements: any[];
    } = {
        passed: true,
        degradations: [],
        improvements: []
    };
    
    // Compare metrics
    for (const metric of current.metrics) {
        const baselineMetric = baseline.metrics?.find((m: any) => m.name === metric.name);
        if (baselineMetric) {
            const change = ((metric.value - baselineMetric.value) / baselineMetric.value) * 100;
            
            if (change > threshold) {
                comparison.passed = false;
                comparison.degradations.push({
                    metric: metric.name,
                    current: metric.value,
                    baseline: baselineMetric.value,
                    change: change.toFixed(2) + '%'
                });
            } else if (change < -5) { // Improvement threshold
                comparison.improvements.push({
                    metric: metric.name,
                    current: metric.value,
                    baseline: baselineMetric.value,
                    change: change.toFixed(2) + '%'
                });
            }
        }
    }
    
    return comparison;
}

// Code review helper functions
async function reviewFile(filePath: string, focusAreas: string[], strictness: string, workingDir: string): Promise<any> {
    const issues: any[] = [];
    const recommendations: any[] = [];
    
    try {
        const content = await fs.readFile(path.join(workingDir, filePath), 'utf-8');
        
        // Security checks
        if (focusAreas.includes('security')) {
            const securityIssues = checkSecurity(content, filePath);
            issues.push(...securityIssues);
        }
        
        // Quality checks
        if (focusAreas.includes('quality')) {
            const qualityIssues = checkQuality(content, filePath);
            issues.push(...qualityIssues);
        }
        
        // Performance checks
        if (focusAreas.includes('performance')) {
            const performanceIssues = checkPerformance(content, filePath);
            issues.push(...performanceIssues);
        }
        
        // Maintainability checks
        if (focusAreas.includes('maintainability')) {
            const maintainabilityIssues = checkMaintainability(content, filePath);
            issues.push(...maintainabilityIssues);
        }
        
    } catch (error) {
        issues.push({
            file: filePath,
            line: 0,
            severity: 'high',
            category: 'file_access',
            message: `Could not read file: ${error}`,
            suggestion: 'Ensure file exists and is readable'
        });
    }
    
    return { issues, recommendations };
}

function checkSecurity(content: string, filePath: string): any[] {
    const issues = [];
    
    // Check for potential security issues
    const securityPatterns = [
        { pattern: /console\.log\([^)]*password/i, message: 'Potential password logging', severity: 'high' },
        { pattern: /\.innerHTML\s*=/, message: 'Potential XSS vulnerability with innerHTML', severity: 'medium' },
        { pattern: /eval\s*\(/, message: 'Use of eval() is dangerous', severity: 'high' },
        { pattern: /document\.write\s*\(/, message: 'document.write can be dangerous', severity: 'medium' },
        { pattern: /(API_KEY|SECRET|TOKEN)\s*=\s*['"][^'"]+['"]/, message: 'Hardcoded secrets detected', severity: 'critical' }
    ];
    
    for (const { pattern, message, severity } of securityPatterns) {
        const matches = content.match(new RegExp(pattern, 'g'));
        if (matches) {
            issues.push({
                file: filePath,
                line: 0,
                severity,
                category: 'security',
                message,
                suggestion: 'Review and fix security issue'
            });
        }
    }
    
    return issues;
}

function checkQuality(content: string, filePath: string): any[] {
    const issues = [];
    
    // Check for quality issues
    const qualityPatterns = [
        { pattern: /\/\/ TODO|\/\/ FIXME|\/\/ HACK/i, message: 'TODO/FIXME comment found', severity: 'low' },
        { pattern: /debugger;/, message: 'Debugger statement found', severity: 'medium' },
        { pattern: /console\.log\(/, message: 'Console.log statement found', severity: 'low' },
        { pattern: /any\s*[;,\]\}]/, message: 'Use of "any" type reduces type safety', severity: 'medium' }
    ];
    
    for (const { pattern, message, severity } of qualityPatterns) {
        const matches = content.match(new RegExp(pattern, 'g'));
        if (matches) {
            issues.push({
                file: filePath,
                line: 0,
                severity,
                category: 'quality',
                message,
                suggestion: 'Improve code quality'
            });
        }
    }
    
    return issues;
}

function checkPerformance(content: string, filePath: string): any[] {
    const issues = [];
    
    // Check for performance issues
    const performancePatterns = [
        { pattern: /for\s*\([^)]*\)\s*{\s*for\s*\([^)]*\)\s*{/, message: 'Nested loops may impact performance', severity: 'medium' },
        { pattern: /setInterval\s*\([^,]*,\s*[1-9]\d*\)/, message: 'Frequent setInterval may impact performance', severity: 'low' },
        { pattern: /JSON\.parse\s*\(.*JSON\.stringify/, message: 'Deep clone using JSON is inefficient', severity: 'low' }
    ];
    
    for (const { pattern, message, severity } of performancePatterns) {
        const matches = content.match(new RegExp(pattern, 'g'));
        if (matches) {
            issues.push({
                file: filePath,
                line: 0,
                severity,
                category: 'performance',
                message,
                suggestion: 'Consider performance optimization'
            });
        }
    }
    
    return issues;
}

function checkMaintainability(content: string, filePath: string): any[] {
    const issues = [];
    
    // Check for maintainability issues
    const lines = content.split('\n');
    
    // Check for long functions
    let functionStart = -1;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        if (line.match(/^\s*(function|const\s+\w+\s*=|.*:\s*function)/)) {
            functionStart = i;
        } else if (functionStart !== -1 && line.includes('}')) {
            const functionLength = i - functionStart;
            if (functionLength > 50) {
                issues.push({
                    file: filePath,
                    line: functionStart + 1,
                    severity: 'medium',
                    category: 'maintainability',
                    message: `Long function (${functionLength} lines)`,
                    suggestion: 'Consider breaking into smaller functions'
                });
            }
            functionStart = -1;
        }
    }
    
    // Check for long lines
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].length > 120) {
            issues.push({
                file: filePath,
                line: i + 1,
                severity: 'low',
                category: 'maintainability',
                message: 'Line too long',
                suggestion: 'Break long lines for better readability'
            });
        }
    }
    
    return issues;
}

function calculateReviewScore(issues: any[], strictness: string): number {
    let score = 100;
    
    const weights = {
        low: { critical: 20, high: 15, medium: 10, low: 5 },
        medium: { critical: 30, high: 20, medium: 10, low: 2 },
        high: { critical: 40, high: 25, medium: 10, low: 1 }
    };
    
    const weight = weights[strictness as keyof typeof weights];
    
    for (const issue of issues) {
        score -= weight[issue.severity as keyof typeof weight] || 0;
    }
    
    return Math.max(0, score);
}

/**
 * Safety Tools for MXF
 * 
 * Provides safety mechanisms for self-modification including rollback,
 * backup, and validation tools to ensure safe autonomous code changes.
 */

export const createFeatureBranchTool = {
    name: 'create_feature_branch',
    description: 'Create a new feature branch to isolate experimental changes',
    inputSchema: {
        type: 'object',
        properties: {
            branchName: {
                type: 'string',
                description: 'Name for the new feature branch'
            },
            baseBranch: {
                type: 'string',
                default: 'main',
                description: 'Base branch to create the feature branch from'
            },
            workingDirectory: {
                type: 'string',
                description: 'Working directory (defaults to current directory)'
            }
        },
        required: ['branchName']
    },
    handler: async (args: any, context: any) => {
        
        try {
            const workingDir = args.workingDirectory || process.cwd();
            
            // Ensure we're on the base branch and it's up to date
            const checkoutResult = await executeShellCommand('git', ['checkout', args.baseBranch || 'main'], {
                workingDirectory: workingDir,
                captureOutput: true
            });
            
            if (checkoutResult.exitCode !== 0) {
                return {
                    success: false,
                    branchName: args.branchName,
                    error: `Failed to checkout base branch: ${checkoutResult.stderr}`
                };
            }
            
            // Pull latest changes
            const pullResult = await executeShellCommand('git', ['pull', 'origin', args.baseBranch || 'main'], {
                workingDirectory: workingDir,
                captureOutput: true
            });
            
            if (pullResult.exitCode !== 0) {
                logger.warn('Failed to pull latest changes', { error: pullResult.stderr });
            }
            
            // Create and checkout new branch
            const branchResult = await executeShellCommand('git', ['checkout', '-b', args.branchName], {
                workingDirectory: workingDir,
                captureOutput: true
            });
            
            if (branchResult.exitCode !== 0) {
                return {
                    success: false,
                    branchName: args.branchName,
                    error: `Failed to create branch: ${branchResult.stderr}`
                };
            }
            
            // Get current commit hash for reference
            const hashResult = await executeShellCommand('git', ['rev-parse', 'HEAD'], {
                workingDirectory: workingDir,
                captureOutput: true
            });
            
            const currentHash = hashResult.stdout?.trim() || 'unknown';
            
            return {
                success: true,
                branchName: args.branchName,
                baseBranch: args.baseBranch || 'main',
                currentHash,
                error: null
            };
        } catch (error) {
            logger.error('Create feature branch failed', { error });
            return {
                success: false,
                branchName: args.branchName,
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }
};

export const runFullTestSuiteTool = {
    name: 'run_full_test_suite',
    description: 'Run the complete test suite to validate changes',
    inputSchema: {
        type: 'object',
        properties: {
            testCommand: {
                type: 'string',
                description: 'Custom test command (defaults to npm test)'
            },
            coverage: {
                type: 'boolean',
                default: true,
                description: 'Generate test coverage report'
            },
            bail: {
                type: 'boolean',
                default: false,
                description: 'Stop on first test failure'
            },
            workingDirectory: {
                type: 'string',
                description: 'Working directory (defaults to current directory)'
            }
        }
    },
    handler: async (args: any, context: any) => {
        
        try {
            const workingDir = args.workingDirectory || process.cwd();
            
            // Determine test command
            let testCmd: string[];
            if (args.testCommand) {
                testCmd = args.testCommand.split(' ');
            } else {
                // Try to detect test framework
                const packageJsonPath = path.join(workingDir, 'package.json');
                try {
                    const packageJson = await fs.readFile(packageJsonPath, 'utf-8');
                    const pkg = JSON.parse(packageJson);
                    
                    if (pkg.scripts?.test) {
                        testCmd = ['npm', 'test'];
                    } else if (pkg.devDependencies?.jest || pkg.dependencies?.jest) {
                        testCmd = ['npx', 'jest'];
                    } else if (pkg.devDependencies?.mocha || pkg.dependencies?.mocha) {
                        testCmd = ['npx', 'mocha'];
                    } else {
                        testCmd = ['npm', 'test'];
                    }
                } catch {
                    testCmd = ['npm', 'test'];
                }
            }
            
            // Add coverage if requested
            if (args.coverage && testCmd.includes('jest')) {
                testCmd.push('--coverage');
            }
            
            // Add bail if requested
            if (args.bail && testCmd.includes('jest')) {
                testCmd.push('--bail');
            }
            
            const startTime = Date.now();
            
            const result = await executeShellCommand(testCmd[0], testCmd.slice(1), {
                workingDirectory: workingDir,
                captureOutput: true
            });
            
            const duration = Date.now() - startTime;
            
            // Parse test results
            const testResults = parseTestResults(result.stdout || '');
            
            return {
                success: result.exitCode === 0,
                output: result.stdout || '',
                errors: result.stderr || '',
                duration,
                testResults,
                coverage: args.coverage ? parseCoverageResults(result.stdout || '') : null,
                error: result.exitCode !== 0 ? result.stderr : null
            };
        } catch (error) {
            logger.error('Run full test suite failed', { error });
            return {
                success: false,
                output: '',
                errors: '',
                duration: 0,
                testResults: null,
                coverage: null,
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }
};

export const performanceBenchmarkTool = {
    name: 'performance_benchmark',
    description: 'Run performance benchmarks to ensure changes don\'t degrade performance',
    inputSchema: {
        type: 'object',
        properties: {
            benchmarkCommand: {
                type: 'string',
                description: 'Custom benchmark command (defaults to npm run benchmark)'
            },
            baselineFile: {
                type: 'string',
                description: 'Path to baseline performance file'
            },
            thresholdPercent: {
                type: 'number',
                default: 10,
                description: 'Performance degradation threshold percentage'
            },
            workingDirectory: {
                type: 'string',
                description: 'Working directory (defaults to current directory)'
            }
        }
    },
    handler: async (args: any, context: any) => {
        
        try {
            const workingDir = args.workingDirectory || process.cwd();
            
            // Determine benchmark command
            let benchmarkCmd: string[];
            if (args.benchmarkCommand) {
                benchmarkCmd = args.benchmarkCommand.split(' ');
            } else {
                // Check for common benchmark scripts
                const packageJsonPath = path.join(workingDir, 'package.json');
                try {
                    const packageJson = await fs.readFile(packageJsonPath, 'utf-8');
                    const pkg = JSON.parse(packageJson);
                    
                    if (pkg.scripts?.benchmark) {
                        benchmarkCmd = ['npm', 'run', 'benchmark'];
                    } else if (pkg.scripts?.perf) {
                        benchmarkCmd = ['npm', 'run', 'perf'];
                    } else {
                        return {
                            success: false,
                            benchmarkResults: null,
                            baselineComparison: null,
                            error: 'No benchmark script found in package.json'
                        };
                    }
                } catch {
                    return {
                        success: false,
                        benchmarkResults: null,
                        baselineComparison: null,
                        error: 'Could not read package.json'
                    };
                }
            }
            
            const startTime = Date.now();
            
            const result = await executeShellCommand(benchmarkCmd[0], benchmarkCmd.slice(1), {
                workingDirectory: workingDir,
                captureOutput: true
            });
            
            const duration = Date.now() - startTime;
            
            // Parse benchmark results
            const benchmarkResults = parseBenchmarkResults(result.stdout || '');
            
            // Compare with baseline if provided
            let baselineComparison = null;
            if (args.baselineFile) {
                try {
                    const baselineContent = await fs.readFile(args.baselineFile, 'utf-8');
                    const baseline = JSON.parse(baselineContent);
                    baselineComparison = compareWithBaseline(benchmarkResults, baseline, args.thresholdPercent);
                } catch (error) {
                    logger.warn('Could not read baseline file', { error });
                }
            }
            
            return {
                success: result.exitCode === 0,
                output: result.stdout || '',
                benchmarkResults,
                baselineComparison,
                duration,
                error: result.exitCode !== 0 ? result.stderr : null
            };
        } catch (error) {
            logger.error('Performance benchmark failed', { error });
            return {
                success: false,
                benchmarkResults: null,
                baselineComparison: null,
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }
};

export const rollbackChangesTool = {
    name: 'rollback_changes',
    description: 'Rollback changes to a previous safe state',
    inputSchema: {
        type: 'object',
        properties: {
            rollbackType: {
                type: 'string',
                enum: ['commit', 'branch', 'stash'],
                default: 'commit',
                description: 'Type of rollback to perform'
            },
            targetCommit: {
                type: 'string',
                description: 'Commit hash to rollback to (for commit rollback)'
            },
            targetBranch: {
                type: 'string',
                description: 'Branch to rollback to (for branch rollback)'
            },
            preserveChanges: {
                type: 'boolean',
                default: false,
                description: 'Preserve changes in working directory'
            },
            workingDirectory: {
                type: 'string',
                description: 'Working directory (defaults to current directory)'
            }
        }
    },
    handler: async (args: any, context: any) => {
        
        try {
            const workingDir = args.workingDirectory || process.cwd();
            let result;
            
            switch (args.rollbackType) {
                case 'commit':
                    if (!args.targetCommit) {
                        return {
                            success: false,
                            rollbackType: args.rollbackType,
                            error: 'Target commit required for commit rollback'
                        };
                    }
                    
                    if (args.preserveChanges) {
                        // Soft reset to preserve changes
                        result = await executeShellCommand('git', ['reset', '--soft', args.targetCommit], {
                            workingDirectory: workingDir,
                            captureOutput: true
                        });
                    } else {
                        // Hard reset to discard changes
                        result = await executeShellCommand('git', ['reset', '--hard', args.targetCommit], {
                            workingDirectory: workingDir,
                            captureOutput: true
                        });
                    }
                    break;
                    
                case 'branch':
                    if (!args.targetBranch) {
                        return {
                            success: false,
                            rollbackType: args.rollbackType,
                            error: 'Target branch required for branch rollback'
                        };
                    }
                    
                    // Stash current changes if preserving
                    if (args.preserveChanges) {
                        await executeShellCommand('git', ['stash', 'push', '-m', 'Rollback preservation stash'], {
                            workingDirectory: workingDir,
                            captureOutput: true
                        });
                    }
                    
                    // Checkout target branch
                    result = await executeShellCommand('git', ['checkout', args.targetBranch], {
                        workingDirectory: workingDir,
                        captureOutput: true
                    });
                    break;
                    
                case 'stash':
                    // Pop the latest stash
                    result = await executeShellCommand('git', ['stash', 'pop'], {
                        workingDirectory: workingDir,
                        captureOutput: true
                    });
                    break;
                    
                default:
                    return {
                        success: false,
                        rollbackType: args.rollbackType,
                        error: 'Invalid rollback type'
                    };
            }
            
            if (result.exitCode !== 0) {
                return {
                    success: false,
                    rollbackType: args.rollbackType,
                    error: result.stderr || 'Rollback failed'
                };
            }
            
            // Get current status after rollback
            const statusResult = await executeShellCommand('git', ['status', '--porcelain'], {
                workingDirectory: workingDir,
                captureOutput: true
            });
            
            const currentBranchResult = await executeShellCommand('git', ['branch', '--show-current'], {
                workingDirectory: workingDir,
                captureOutput: true
            });
            
            return {
                success: true,
                rollbackType: args.rollbackType,
                currentBranch: currentBranchResult.stdout?.trim() || 'unknown',
                hasUncommittedChanges: (statusResult.stdout || '').trim().length > 0,
                error: null
            };
        } catch (error) {
            logger.error('Rollback changes failed', { error });
            return {
                success: false,
                rollbackType: args.rollbackType,
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }
};

export const createBackupTool = {
    name: 'create_backup',
    description: 'Create a backup of the current state before making changes',
    inputSchema: {
        type: 'object',
        properties: {
            backupType: {
                type: 'string',
                enum: ['commit', 'branch', 'stash', 'archive'],
                default: 'commit',
                description: 'Type of backup to create'
            },
            backupName: {
                type: 'string',
                description: 'Name for the backup'
            },
            includeUntracked: {
                type: 'boolean',
                default: true,
                description: 'Include untracked files in backup'
            },
            workingDirectory: {
                type: 'string',
                description: 'Working directory (defaults to current directory)'
            }
        }
    },
    handler: async (args: any, context: any) => {
        
        try {
            const workingDir = args.workingDirectory || process.cwd();
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const backupName = args.backupName || `backup-${timestamp}`;
            
            let result;
            let backupId;
            
            switch (args.backupType) {
                case 'commit':
                    // Add all changes
                    if (args.includeUntracked) {
                        await executeShellCommand('git', ['add', '-A'], {
                            workingDirectory: workingDir,
                            captureOutput: true
                        });
                    } else {
                        await executeShellCommand('git', ['add', '-u'], {
                            workingDirectory: workingDir,
                            captureOutput: true
                        });
                    }
                    
                    // Create commit
                    result = await executeShellCommand('git', ['commit', '-m', `Backup: ${backupName}`], {
                        workingDirectory: workingDir,
                        captureOutput: true
                    });
                    
                    if (result.exitCode === 0) {
                        const hashResult = await executeShellCommand('git', ['rev-parse', 'HEAD'], {
                            workingDirectory: workingDir,
                            captureOutput: true
                        });
                        backupId = hashResult.stdout?.trim();
                    }
                    break;
                    
                case 'branch':
                    // Create backup branch
                    result = await executeShellCommand('git', ['checkout', '-b', backupName], {
                        workingDirectory: workingDir,
                        captureOutput: true
                    });
                    
                    if (result.exitCode === 0) {
                        backupId = backupName;
                        
                        // Switch back to original branch
                        const originalBranchResult = await executeShellCommand('git', ['checkout', '-'], {
                            workingDirectory: workingDir,
                            captureOutput: true
                        });
                        
                        if (originalBranchResult.exitCode !== 0) {
                            logger.warn('Could not switch back to original branch');
                        }
                    }
                    break;
                    
                case 'stash':
                    // Create stash
                    const stashArgs = ['stash', 'push', '-m', backupName];
                    if (args.includeUntracked) {
                        stashArgs.push('--include-untracked');
                    }
                    
                    result = await executeShellCommand('git', stashArgs, {
                        workingDirectory: workingDir,
                        captureOutput: true
                    });
                    
                    if (result.exitCode === 0) {
                        backupId = backupName;
                    }
                    break;
                    
                case 'archive':
                    // Create archive file
                    const archiveName = `${backupName}.tar.gz`;
                    const archivePath = path.join(workingDir, archiveName);
                    
                    result = await executeShellCommand('git', ['archive', '--format=tar.gz', '--output', archivePath, 'HEAD'], {
                        workingDirectory: workingDir,
                        captureOutput: true
                    });
                    
                    if (result.exitCode === 0) {
                        backupId = archivePath;
                    }
                    break;
                    
                default:
                    return {
                        success: false,
                        backupType: args.backupType,
                        error: 'Invalid backup type'
                    };
            }
            
            if (result.exitCode !== 0) {
                return {
                    success: false,
                    backupType: args.backupType,
                    backupName,
                    error: result.stderr || 'Backup creation failed'
                };
            }
            
            return {
                success: true,
                backupType: args.backupType,
                backupName,
                backupId,
                timestamp,
                error: null
            };
        } catch (error) {
            logger.error('Create backup failed', { error });
            return {
                success: false,
                backupType: args.backupType,
                backupName: args.backupName,
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }
};

export const codeReviewAgentTool = {
    name: 'code_review_agent',
    description: 'AI-powered code review agent that analyzes changes for quality, security, and best practices',
    inputSchema: {
        type: 'object',
        properties: {
            reviewType: {
                type: 'string',
                enum: ['diff', 'files', 'pull_request'],
                default: 'diff',
                description: 'Type of code review to perform'
            },
            files: {
                type: 'array',
                items: { type: 'string' },
                description: 'Specific files to review (for files review type)'
            },
            focusAreas: {
                type: 'array',
                items: { type: 'string' },
                default: ['quality', 'security', 'performance', 'maintainability'],
                description: 'Areas to focus on during review'
            },
            strictness: {
                type: 'string',
                enum: ['low', 'medium', 'high'],
                default: 'medium',
                description: 'Review strictness level'
            },
            workingDirectory: {
                type: 'string',
                description: 'Working directory (defaults to current directory)'
            }
        }
    },
    handler: async (args: any, context: any) => {
        
        try {
            const workingDir = args.workingDirectory || process.cwd();
            const reviewResults: {
                summary: any;
                issues: any[];
                recommendations: any[];
                score: number;
            } = {
                summary: {},
                issues: [],
                recommendations: [],
                score: 0
            };
            
            let filesToReview: string[] = [];
            
            // Get files to review based on type
            switch (args.reviewType) {
                case 'diff':
                    const diffResult = await executeShellCommand('git', ['diff', '--name-only', 'HEAD'], {
                        workingDirectory: workingDir,
                        captureOutput: true
                    });
                    
                    if (diffResult.exitCode === 0) {
                        filesToReview = diffResult.stdout?.split('\n').filter(f => f.trim()) || [];
                    }
                    break;
                    
                case 'files':
                    filesToReview = args.files || [];
                    break;
                    
                case 'pull_request':
                    // Compare with main branch
                    const prDiffResult = await executeShellCommand('git', ['diff', '--name-only', 'main...HEAD'], {
                        workingDirectory: workingDir,
                        captureOutput: true
                    });
                    
                    if (prDiffResult.exitCode === 0) {
                        filesToReview = prDiffResult.stdout?.split('\n').filter(f => f.trim()) || [];
                    }
                    break;
            }
            
            // Review each file
            for (const file of filesToReview) {
                const fileReview = await reviewFile(file, args.focusAreas, args.strictness, workingDir);
                reviewResults.issues.push(...fileReview.issues);
                reviewResults.recommendations.push(...fileReview.recommendations);
            }
            
            // Calculate overall score
            reviewResults.score = calculateReviewScore(reviewResults.issues, args.strictness);
            
            // Generate summary
            reviewResults.summary = {
                filesReviewed: filesToReview.length,
                totalIssues: reviewResults.issues.length,
                criticalIssues: reviewResults.issues.filter(i => i.severity === 'critical').length,
                highIssues: reviewResults.issues.filter(i => i.severity === 'high').length,
                mediumIssues: reviewResults.issues.filter(i => i.severity === 'medium').length,
                lowIssues: reviewResults.issues.filter(i => i.severity === 'low').length,
                overallScore: reviewResults.score
            };
            
            return {
                success: true,
                reviewResults,
                error: null
            };
        } catch (error) {
            logger.error('Code review agent failed', { error });
            return {
                success: false,
                reviewResults: null,
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }
};

// Export all safety tools
export const safetyTools = [
    createFeatureBranchTool,
    runFullTestSuiteTool,
    performanceBenchmarkTool,
    rollbackChangesTool,
    createBackupTool,
    codeReviewAgentTool
];