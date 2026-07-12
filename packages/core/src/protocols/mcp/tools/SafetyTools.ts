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
 * @documentation https://mxf-dev.github.io/mxf/
 */

import { Logger } from '../../../utils/Logger.js';
import { TOOL_CATEGORIES } from '../../../constants/ToolNames.js';
import { defineTool, ToolRunContext } from '../defineTool.js';
import { ToolError } from '../ToolError.js';
import { executeShellCommand, ShellCommandResult } from './InfrastructureTools.js';
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
 * Branch, backup, rollback, test and benchmark tools used to keep autonomous
 * code changes recoverable.
 *
 * Every git invocation here goes through executeShellCommand, so it is validated
 * by the security guard first. That matters most for rollback_changes, which
 * runs `git reset --hard` and `git checkout` — the guard is what stands between
 * a model's rollback request and an unrecoverable working tree.
 */

/** Run a git subcommand, throwing a ToolError when git reports failure. */
async function runGit(
    args: string[],
    workingDirectory: string,
    context: ToolRunContext
): Promise<ShellCommandResult> {
    const result = await executeShellCommand('git', args, {
        context: {
            agentId: context.agentId,
            channelId: context.channelId,
            requestId: context.requestId
        },
        workingDirectory,
        captureOutput: true
    });

    if (result.exitCode !== 0) {
        throw ToolError.executionFailed(
            `git ${args.join(' ')} failed (exit ${result.exitCode}): ` +
            `${result.stderr?.trim() || 'no error output'}`,
            { details: { exitCode: result.exitCode, args } }
        );
    }

    return result;
}

const workingDirectoryProperty = {
    type: 'string',
    description: 'Working directory (defaults to the server working directory)'
};

export const createFeatureBranchTool = defineTool<
    { branchName: string; baseBranch?: string; workingDirectory?: string },
    { branchName: string; baseBranch: string; headCommit: string; pulled: boolean }
>({
    name: 'create_feature_branch',
    category: TOOL_CATEGORIES.VERSION_CONTROL,
    description: 'Create and switch to a new branch off a base branch, to isolate changes.',
    inputSchema: {
        type: 'object',
        properties: {
            branchName: {
                type: 'string',
                minLength: 1,
                description: 'Name for the new feature branch'
            },
            baseBranch: {
                type: 'string',
                default: 'main',
                description: 'Base branch to create the feature branch from'
            },
            workingDirectory: workingDirectoryProperty
        },
        required: ['branchName']
    },
    run: async (input, context) => {
        const workingDir = input.workingDirectory || process.cwd();
        const baseBranch = input.baseBranch ?? 'main';

        await runGit(['checkout', baseBranch], workingDir, context);

        // A pull can fail for reasons that do not invalidate the branch (no
        // remote, offline). Record whether it worked rather than failing the tool
        // or pretending it succeeded.
        let pulled = true;
        try {
            await runGit(['pull', 'origin', baseBranch], workingDir, context);
        } catch (error) {
            pulled = false;
            logger.warn(
                `Could not pull ${baseBranch} before branching: ` +
                `${error instanceof Error ? error.message : String(error)}`
            );
        }

        await runGit(['checkout', '-b', input.branchName], workingDir, context);

        const hashResult = await runGit(['rev-parse', 'HEAD'], workingDir, context);

        return {
            branchName: input.branchName,
            baseBranch,
            headCommit: hashResult.stdout?.trim() ?? '',
            pulled
        };
    }
});

export const runFullTestSuiteTool = defineTool<
    { testCommand?: string; coverage?: boolean; bail?: boolean; workingDirectory?: string },
    {
        passed: boolean;
        command: string;
        durationMs: number;
        testResults: ReturnType<typeof parseTestResults>;
        coverage: ReturnType<typeof parseCoverageResults> | null;
        output: string;
    }
>({
    name: 'run_full_test_suite',
    category: TOOL_CATEGORIES.INFRASTRUCTURE,
    description:
        'Run the project test suite. passed is false when tests fail. ' +
        'Uses the project test script unless a command is given.',
    inputSchema: {
        type: 'object',
        properties: {
            testCommand: {
                type: 'string',
                description: 'Test command to run (defaults to the project test script)'
            },
            coverage: {
                type: 'boolean',
                default: true,
                description: 'Generate a coverage report (jest only)'
            },
            bail: {
                type: 'boolean',
                default: false,
                description: 'Stop at the first failure (jest only)'
            },
            workingDirectory: workingDirectoryProperty
        }
    },
    run: async (input, context) => {
        const workingDir = input.workingDirectory || process.cwd();

        // Work out what to run. An explicit command wins; otherwise read
        // package.json. A project with no test script and no known runner is a
        // precondition failure — running `npm test` anyway would fail confusingly.
        let testCmd: string[];

        if (input.testCommand) {
            testCmd = input.testCommand.split(/\s+/).filter(Boolean);
        } else {
            const packageJsonPath = path.join(workingDir, 'package.json');
            let pkg: { scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string> };

            try {
                pkg = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));
            } catch {
                throw ToolError.notFound(
                    `Could not read ${packageJsonPath}. ` +
                    `Pass testCommand explicitly, or run this from the project root.`
                );
            }

            const deps = { ...pkg.dependencies, ...pkg.devDependencies };

            if (pkg.scripts?.test) {
                testCmd = ['npm', 'test'];
            } else if (deps.jest) {
                testCmd = ['npx', 'jest'];
            } else if (deps.mocha) {
                testCmd = ['npx', 'mocha'];
            } else if (deps.vitest) {
                testCmd = ['npx', 'vitest', 'run'];
            } else {
                throw ToolError.notFound(
                    `${packageJsonPath} has no "test" script and no jest, mocha or vitest dependency. ` +
                    `Pass testCommand explicitly.`
                );
            }
        }

        const isJest = testCmd.includes('jest');
        if (input.coverage !== false && isJest) {
            testCmd.push('--coverage');
        }
        if (input.bail && isJest) {
            testCmd.push('--bail');
        }

        const startedAt = Date.now();

        const result = await executeShellCommand(testCmd[0], testCmd.slice(1), {
            context: {
                agentId: context.agentId,
                channelId: context.channelId,
                requestId: context.requestId
            },
            workingDirectory: workingDir,
            captureOutput: true
        });

        // A failing suite exits non-zero. That is the tool working, so it comes
        // back as passed: false rather than as a tool error.
        const output = [result.stdout, result.stderr].filter(Boolean).join('\n');

        return {
            passed: result.exitCode === 0,
            command: testCmd.join(' '),
            durationMs: Date.now() - startedAt,
            testResults: parseTestResults(output),
            coverage: input.coverage !== false ? parseCoverageResults(output) : null,
            output
        };
    }
});

export const performanceBenchmarkTool = defineTool<
    { benchmarkCommand?: string; baselineFile?: string; thresholdPercent?: number; workingDirectory?: string },
    {
        passed: boolean;
        command: string;
        durationMs: number;
        benchmarkResults: ReturnType<typeof parseBenchmarkResults>;
        baselineComparison: ReturnType<typeof compareWithBaseline> | null;
        output: string;
    }
>({
    name: 'performance_benchmark',
    category: TOOL_CATEGORIES.INFRASTRUCTURE,
    description:
        'Run the project benchmark script and, when a baseline file is given, compare ' +
        'against it and flag regressions past the threshold.',
    inputSchema: {
        type: 'object',
        properties: {
            benchmarkCommand: {
                type: 'string',
                description: 'Benchmark command (defaults to the project benchmark script)'
            },
            baselineFile: {
                type: 'string',
                description: 'Path to a JSON baseline file to compare against'
            },
            thresholdPercent: {
                type: 'number',
                default: 10,
                minimum: 0,
                description: 'Regression threshold, as a percentage'
            },
            workingDirectory: workingDirectoryProperty
        }
    },
    run: async (input, context) => {
        const workingDir = input.workingDirectory || process.cwd();

        let benchmarkCmd: string[];

        if (input.benchmarkCommand) {
            benchmarkCmd = input.benchmarkCommand.split(/\s+/).filter(Boolean);
        } else {
            const packageJsonPath = path.join(workingDir, 'package.json');
            let pkg: { scripts?: Record<string, string> };

            try {
                pkg = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));
            } catch {
                throw ToolError.notFound(
                    `Could not read ${packageJsonPath}. Pass benchmarkCommand explicitly.`
                );
            }

            if (pkg.scripts?.benchmark) {
                benchmarkCmd = ['npm', 'run', 'benchmark'];
            } else if (pkg.scripts?.perf) {
                benchmarkCmd = ['npm', 'run', 'perf'];
            } else {
                throw ToolError.notFound(
                    `${packageJsonPath} has no "benchmark" or "perf" script. ` +
                    `Pass benchmarkCommand explicitly.`
                );
            }
        }

        const startedAt = Date.now();

        const result = await executeShellCommand(benchmarkCmd[0], benchmarkCmd.slice(1), {
            context: {
                agentId: context.agentId,
                channelId: context.channelId,
                requestId: context.requestId
            },
            workingDirectory: workingDir,
            captureOutput: true
        });

        const output = [result.stdout, result.stderr].filter(Boolean).join('\n');
        const benchmarkResults = parseBenchmarkResults(output);

        // A baseline the caller named but that cannot be read is an error: a
        // silent null here would read as "no regression".
        let baselineComparison = null;
        if (input.baselineFile) {
            let baseline: unknown;
            try {
                baseline = JSON.parse(await fs.readFile(input.baselineFile, 'utf-8'));
            } catch (error) {
                throw ToolError.notFound(
                    `Could not read the baseline file ${input.baselineFile}: ` +
                    `${error instanceof Error ? error.message : String(error)}`
                );
            }
            baselineComparison = compareWithBaseline(
                benchmarkResults,
                baseline,
                input.thresholdPercent ?? 10
            );
        }

        return {
            passed: result.exitCode === 0,
            command: benchmarkCmd.join(' '),
            durationMs: Date.now() - startedAt,
            benchmarkResults,
            baselineComparison,
            output
        };
    }
});

export const rollbackChangesTool = defineTool<
    {
        rollbackType?: 'commit' | 'branch' | 'stash';
        targetCommit?: string;
        targetBranch?: string;
        preserveChanges?: boolean;
        workingDirectory?: string;
    },
    { rollbackType: string; currentBranch: string; hasUncommittedChanges: boolean; preservedChanges: boolean }
>({
    name: 'rollback_changes',
    category: TOOL_CATEGORIES.VERSION_CONTROL,
    description:
        'Roll the repository back to a previous state: reset to a commit, switch to a ' +
        'branch, or pop the latest stash. With preserveChanges the working tree is kept ' +
        '(soft reset / stash); without it, a commit rollback discards uncommitted work.',
    inputSchema: {
        type: 'object',
        properties: {
            rollbackType: {
                type: 'string',
                enum: ['commit', 'branch', 'stash'],
                default: 'commit',
                description: 'What to roll back to'
            },
            targetCommit: {
                type: 'string',
                description: 'Commit to reset to (required when rollbackType is "commit")'
            },
            targetBranch: {
                type: 'string',
                description: 'Branch to switch to (required when rollbackType is "branch")'
            },
            preserveChanges: {
                type: 'boolean',
                default: false,
                description: 'Keep uncommitted work (soft reset, or stash before switching)'
            },
            workingDirectory: workingDirectoryProperty
        }
    },
    run: async (input, context) => {
        const workingDir = input.workingDirectory || process.cwd();
        const rollbackType = input.rollbackType ?? 'commit';
        const preserveChanges = input.preserveChanges ?? false;

        switch (rollbackType) {
            case 'commit': {
                if (!input.targetCommit) {
                    throw ToolError.invalidInput(
                        'targetCommit is required when rollbackType is "commit".'
                    );
                }
                // --hard discards uncommitted work irrecoverably; --soft keeps it.
                const mode = preserveChanges ? '--soft' : '--hard';
                await runGit(['reset', mode, input.targetCommit], workingDir, context);
                break;
            }

            case 'branch': {
                if (!input.targetBranch) {
                    throw ToolError.invalidInput(
                        'targetBranch is required when rollbackType is "branch".'
                    );
                }
                if (preserveChanges) {
                    await runGit(
                        ['stash', 'push', '-m', 'Rollback preservation stash'],
                        workingDir,
                        context
                    );
                }
                await runGit(['checkout', input.targetBranch], workingDir, context);
                break;
            }

            case 'stash':
                await runGit(['stash', 'pop'], workingDir, context);
                break;
        }

        const statusResult = await runGit(['status', '--porcelain'], workingDir, context);
        const branchResult = await runGit(['branch', '--show-current'], workingDir, context);

        return {
            rollbackType,
            currentBranch: branchResult.stdout?.trim() ?? '',
            hasUncommittedChanges: (statusResult.stdout ?? '').trim().length > 0,
            preservedChanges: preserveChanges
        };
    }
});

export const createBackupTool = defineTool<
    {
        backupType?: 'commit' | 'branch' | 'stash' | 'archive';
        backupName?: string;
        includeUntracked?: boolean;
        workingDirectory?: string;
    },
    { backupType: string; backupName: string; backupId: string; timestamp: string }
>({
    name: 'create_backup',
    category: TOOL_CATEGORIES.VERSION_CONTROL,
    description:
        'Snapshot the current state before making changes, as a commit, a branch, a stash, ' +
        'or a tar.gz archive. Returns the identifier needed to restore it.',
    inputSchema: {
        type: 'object',
        properties: {
            backupType: {
                type: 'string',
                enum: ['commit', 'branch', 'stash', 'archive'],
                default: 'commit',
                description: 'How to store the backup'
            },
            backupName: {
                type: 'string',
                description: 'Name for the backup (defaults to a timestamp)'
            },
            includeUntracked: {
                type: 'boolean',
                default: true,
                description: 'Include untracked files'
            },
            workingDirectory: workingDirectoryProperty
        }
    },
    run: async (input, context) => {
        const workingDir = input.workingDirectory || process.cwd();
        const backupType = input.backupType ?? 'commit';
        const includeUntracked = input.includeUntracked ?? true;
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupName = input.backupName || `backup-${timestamp}`;

        let backupId: string;

        switch (backupType) {
            case 'commit': {
                await runGit(['add', includeUntracked ? '-A' : '-u'], workingDir, context);
                await runGit(['commit', '-m', `Backup: ${backupName}`], workingDir, context);

                const hashResult = await runGit(['rev-parse', 'HEAD'], workingDir, context);
                backupId = hashResult.stdout?.trim() ?? '';
                break;
            }

            case 'branch': {
                await runGit(['checkout', '-b', backupName], workingDir, context);
                // Return to where we were — a backup that leaves the caller on the
                // backup branch is a trap.
                await runGit(['checkout', '-'], workingDir, context);
                backupId = backupName;
                break;
            }

            case 'stash': {
                const stashArgs = ['stash', 'push', '-m', backupName];
                if (includeUntracked) {
                    stashArgs.push('--include-untracked');
                }
                await runGit(stashArgs, workingDir, context);
                backupId = backupName;
                break;
            }

            case 'archive': {
                const archivePath = path.join(workingDir, `${backupName}.tar.gz`);
                await runGit(
                    ['archive', '--format=tar.gz', '--output', archivePath, 'HEAD'],
                    workingDir,
                    context
                );
                backupId = archivePath;
                break;
            }
        }

        return {
            backupType,
            backupName,
            backupId,
            timestamp
        };
    }
});

export const codeReviewAgentTool = defineTool<
    {
        reviewType?: 'diff' | 'files' | 'pull_request';
        files?: string[];
        focusAreas?: string[];
        strictness?: 'low' | 'medium' | 'high';
        workingDirectory?: string;
    },
    {
        summary: {
            filesReviewed: number;
            totalIssues: number;
            criticalIssues: number;
            highIssues: number;
            mediumIssues: number;
            lowIssues: number;
            overallScore: number;
        };
        issues: any[];
        recommendations: any[];
        score: number;
    }
>({
    name: 'code_review_agent',
    category: TOOL_CATEGORIES.INFRASTRUCTURE,
    // What this actually does: match a fixed set of regex patterns per focus area
    // (eval(, innerHTML=, hardcoded secrets, TODO/FIXME, debugger, console.log,
    // `any`, long functions...) and score the hits. No model is involved. The old
    // description called it an "AI-powered code review agent", which set an
    // expectation the implementation cannot meet.
    description:
        'Scan changed files for a fixed set of known-bad patterns (eval, innerHTML assignment, ' +
        'hardcoded secrets, debugger statements, TODO comments, long functions) and return the ' +
        'hits with a score. This is pattern matching, not a semantic review — it will not catch ' +
        'logic errors, and it will flag patterns that are fine in context.',
    inputSchema: {
        type: 'object',
        properties: {
            reviewType: {
                type: 'string',
                enum: ['diff', 'files', 'pull_request'],
                default: 'diff',
                description: 'Which files to scan: the working diff, an explicit list, or the diff against main'
            },
            files: {
                type: 'array',
                items: { type: 'string' },
                description: 'Files to scan (required when reviewType is "files")'
            },
            focusAreas: {
                type: 'array',
                items: {
                    type: 'string',
                    enum: ['quality', 'security', 'performance', 'maintainability']
                },
                default: ['quality', 'security', 'performance', 'maintainability'],
                description: 'Which pattern sets to apply'
            },
            strictness: {
                type: 'string',
                enum: ['low', 'medium', 'high'],
                default: 'medium',
                description: 'How heavily each finding counts against the score'
            },
            workingDirectory: workingDirectoryProperty
        }
    },
    run: async (input, context) => {
        const workingDir = input.workingDirectory || process.cwd();
        const reviewType = input.reviewType ?? 'diff';
        const strictness = input.strictness ?? 'medium';
        const focusAreas = input.focusAreas ?? ['quality', 'security', 'performance', 'maintainability'];

        let filesToReview: string[];

        switch (reviewType) {
            case 'diff': {
                const diffResult = await runGit(['diff', '--name-only', 'HEAD'], workingDir, context);
                filesToReview = (diffResult.stdout ?? '').split('\n').filter(f => f.trim());
                break;
            }

            case 'pull_request': {
                const prDiffResult = await runGit(
                    ['diff', '--name-only', 'main...HEAD'],
                    workingDir,
                    context
                );
                filesToReview = (prDiffResult.stdout ?? '').split('\n').filter(f => f.trim());
                break;
            }

            case 'files':
            default:
                if (!input.files || input.files.length === 0) {
                    throw ToolError.invalidInput(
                        'files is required and must be non-empty when reviewType is "files".'
                    );
                }
                filesToReview = input.files;
                break;
        }

        const issues: any[] = [];
        const recommendations: any[] = [];

        for (const file of filesToReview) {
            const fileReview = await reviewFile(file, focusAreas, strictness, workingDir);
            issues.push(...fileReview.issues);
            recommendations.push(...fileReview.recommendations);
        }

        const score = calculateReviewScore(issues, strictness);

        return {
            summary: {
                filesReviewed: filesToReview.length,
                totalIssues: issues.length,
                criticalIssues: issues.filter(i => i.severity === 'critical').length,
                highIssues: issues.filter(i => i.severity === 'high').length,
                mediumIssues: issues.filter(i => i.severity === 'medium').length,
                lowIssues: issues.filter(i => i.severity === 'low').length,
                overallScore: score
            },
            issues,
            recommendations,
            score
        };
    }
});

export const safetyTools = [
    createFeatureBranchTool,
    runFullTestSuiteTool,
    performanceBenchmarkTool,
    rollbackChangesTool,
    createBackupTool,
    codeReviewAgentTool
];
