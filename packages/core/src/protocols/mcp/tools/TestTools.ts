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

/**
 * TestTools.ts
 *
 * Run a project's test suite with Jest, Mocha or Vitest, or let test_runner pick
 * the one the project actually uses.
 *
 * On exit codes: a test runner exits non-zero when tests fail. That is the tool
 * working — it ran the suite and the suite failed. So a failing suite comes back
 * with `passed: false` and `isError: false`, and `isError` is reserved for the
 * runner not being usable at all.
 *
 * Watch mode is deliberately not offered. These tools are request/response: a
 * watching runner never exits, so the call would hang until it timed out.
 */

import * as fs from 'fs/promises';
import * as path from 'path';

import { TOOL_CATEGORIES } from '../../../constants/ToolNames.js';
import { defineTool, ToolRunContext } from '../defineTool.js';
import { ToolError } from '../ToolError.js';
import { executeShellCommand } from './InfrastructureTools.js';

/** Exit code the shell reports when a command could not be found or spawned. */
const COMMAND_NOT_FOUND = 127;

const workingDirectoryProperty = {
    type: 'string',
    description: 'Working directory path (defaults to the server working directory)'
};

/** Outcome of a test run, in the shape every runner here reports. */
export interface TestRunResult {
    runner: 'jest' | 'mocha' | 'vitest';
    passed: boolean;
    testsRun: number;
    testsPassed: number;
    testsFailed: number;
    executionTimeMs: number;
    output: string;
}

/**
 * Run a test runner via npx and normalize its output.
 *
 * Throws only when the runner could not be executed. A failing suite is a
 * result, and comes back with passed: false.
 */
async function runTestRunner(
    runner: 'jest' | 'mocha' | 'vitest',
    runnerArgs: string[],
    workingDirectory: string | undefined,
    context: ToolRunContext
): Promise<TestRunResult> {
    const startedAt = Date.now();

    const result = await executeShellCommand('npx', [runner, ...runnerArgs], {
        context: {
            agentId: context.agentId,
            channelId: context.channelId,
            requestId: context.requestId
        },
        workingDirectory: workingDirectory || process.cwd(),
        captureOutput: true
    });

    if (result.exitCode === COMMAND_NOT_FOUND) {
        throw ToolError.preconditionFailed(
            `Could not run ${runner} — the command was not found. ` +
            `Install it in the project before running this tool.`,
            { runner }
        );
    }

    // Jest and Vitest write their summary to stderr; Mocha writes to stdout.
    const output = [result.stdout, result.stderr].filter(Boolean).join('\n');
    const counts = parseTestCounts(runner, output);

    return {
        runner,
        passed: result.exitCode === 0,
        ...counts,
        executionTimeMs: Date.now() - startedAt,
        output
    };
}

/**
 * Pull pass/fail counts out of a runner's summary.
 *
 * Each runner prints a different summary, so each gets its own pattern rather
 * than one regex that half-matches all three.
 */
function parseTestCounts(
    runner: 'jest' | 'mocha' | 'vitest',
    output: string
): { testsRun: number; testsPassed: number; testsFailed: number } {
    if (runner === 'jest') {
        // "Tests:       1 failed, 2 skipped, 17 passed, 20 total"
        const summary = output.match(/^Tests:\s+(.+)$/m)?.[1] ?? '';
        const read = (label: string): number => {
            const match = summary.match(new RegExp(`(\\d+)\\s+${label}`));
            return match ? parseInt(match[1], 10) : 0;
        };
        return {
            testsRun: read('total'),
            testsPassed: read('passed'),
            testsFailed: read('failed')
        };
    }

    if (runner === 'vitest') {
        // "Tests  1 failed | 17 passed (18)"
        const summary = output.match(/^\s*Tests\s+(.+)$/m)?.[1] ?? '';
        const passed = parseInt(summary.match(/(\d+)\s+passed/)?.[1] ?? '0', 10);
        const failed = parseInt(summary.match(/(\d+)\s+failed/)?.[1] ?? '0', 10);
        const total = parseInt(summary.match(/\((\d+)\)/)?.[1] ?? '0', 10);
        return {
            testsRun: total || passed + failed,
            testsPassed: passed,
            testsFailed: failed
        };
    }

    // Mocha: "  17 passing (1s)" / "  1 failing"
    const passed = parseInt(output.match(/(\d+)\s+passing/)?.[1] ?? '0', 10);
    const failed = parseInt(output.match(/(\d+)\s+failing/)?.[1] ?? '0', 10);
    return {
        testsRun: passed + failed,
        testsPassed: passed,
        testsFailed: failed
    };
}

export const jestTestTool = defineTool<
    {
        testFiles?: string[];
        testNamePattern?: string;
        coverage?: boolean;
        verbose?: boolean;
        maxWorkers?: number;
        workingDirectory?: string;
    },
    TestRunResult
>({
    name: 'test_jest',
    category: TOOL_CATEGORIES.INFRASTRUCTURE,
    description: 'Run Jest tests. passed is false when any test fails.',
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
                description: 'Run only tests whose name matches this pattern'
            },
            coverage: {
                type: 'boolean',
                default: false,
                description: 'Generate a coverage report'
            },
            verbose: {
                type: 'boolean',
                default: false,
                description: 'Report each test individually'
            },
            maxWorkers: {
                type: 'number',
                minimum: 1,
                description: 'Maximum number of worker processes'
            },
            workingDirectory: workingDirectoryProperty
        }
    },
    run: async (input, context) => {
        const args = ['--no-watchman', '--passWithNoTests'];

        if (input.coverage) {
            args.push('--coverage');
        }
        if (input.verbose) {
            args.push('--verbose');
        }
        if (input.maxWorkers) {
            args.push('--maxWorkers', String(input.maxWorkers));
        }
        if (input.testNamePattern) {
            args.push('--testNamePattern', input.testNamePattern);
        }
        if (input.testFiles && input.testFiles.length > 0) {
            args.push(...input.testFiles);
        }

        return runTestRunner('jest', args, input.workingDirectory, context);
    }
});

export const mochaTestTool = defineTool<
    {
        testFiles?: string[];
        grep?: string;
        reporter?: string;
        timeout?: number;
        recursive?: boolean;
        workingDirectory?: string;
    },
    TestRunResult
>({
    name: 'test_mocha',
    category: TOOL_CATEGORIES.INFRASTRUCTURE,
    description: 'Run Mocha tests. passed is false when any test fails.',
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
                description: 'Run only tests matching this pattern'
            },
            reporter: {
                type: 'string',
                enum: ['spec', 'dot', 'nyan', 'tap', 'json', 'min'],
                default: 'spec',
                description: 'Reporter format'
            },
            timeout: {
                type: 'number',
                minimum: 1,
                description: 'Per-test timeout in milliseconds'
            },
            recursive: {
                type: 'boolean',
                default: false,
                description: 'Look for tests in subdirectories'
            },
            workingDirectory: workingDirectoryProperty
        }
    },
    run: async (input, context) => {
        const args: string[] = [];

        if (input.reporter) {
            args.push('--reporter', input.reporter);
        }
        if (input.grep) {
            args.push('--grep', input.grep);
        }
        if (input.timeout) {
            args.push('--timeout', String(input.timeout));
        }
        if (input.recursive) {
            args.push('--recursive');
        }
        if (input.testFiles && input.testFiles.length > 0) {
            args.push(...input.testFiles);
        }

        return runTestRunner('mocha', args, input.workingDirectory, context);
    }
});

export const vitestTestTool = defineTool<
    {
        testFiles?: string[];
        coverage?: boolean;
        reporter?: string;
        workingDirectory?: string;
    },
    TestRunResult
>({
    name: 'test_vitest',
    category: TOOL_CATEGORIES.INFRASTRUCTURE,
    description: 'Run Vitest tests once (not in watch mode). passed is false when any test fails.',
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
                description: 'Generate a coverage report'
            },
            reporter: {
                type: 'string',
                enum: ['default', 'verbose', 'dot', 'json', 'tap'],
                default: 'default',
                description: 'Reporter format'
            },
            workingDirectory: workingDirectoryProperty
        }
    },
    run: async (input, context) => {
        // `run` is Vitest's non-watching mode. Without it Vitest watches by
        // default and the process would never exit.
        const args = ['run'];

        if (input.coverage) {
            args.push('--coverage');
        }
        if (input.reporter) {
            args.push('--reporter', input.reporter);
        }
        if (input.testFiles && input.testFiles.length > 0) {
            args.push(...input.testFiles);
        }

        return runTestRunner('vitest', args, input.workingDirectory, context);
    }
});

/**
 * Read the project's package.json and work out which runner it uses.
 *
 * Throws when there is no package.json or no known runner in it — guessing
 * "jest" for a project that does not use jest produces a confusing failure two
 * steps later.
 */
async function detectFramework(workingDirectory: string): Promise<'jest' | 'mocha' | 'vitest'> {
    const packageJsonPath = path.join(workingDirectory, 'package.json');

    let raw: string;
    try {
        raw = await fs.readFile(packageJsonPath, 'utf-8');
    } catch {
        throw ToolError.notFound(
            `No package.json in ${workingDirectory}, so the test framework cannot be detected. ` +
            `Pass framework explicitly, or run this from the project root.`
        );
    }

    let packageJson: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    try {
        packageJson = JSON.parse(raw);
    } catch (parseError) {
        throw ToolError.executionFailed(
            `package.json in ${workingDirectory} is not valid JSON: ` +
            `${parseError instanceof Error ? parseError.message : String(parseError)}`
        );
    }

    const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };

    if (deps.vitest) {
        return 'vitest';
    }
    if (deps.jest) {
        return 'jest';
    }
    if (deps.mocha) {
        return 'mocha';
    }

    throw ToolError.notFound(
        `No supported test framework found in ${packageJsonPath}. ` +
        `Expected one of jest, mocha or vitest in dependencies or devDependencies. ` +
        `Pass framework explicitly to override.`
    );
}

export const testRunnerTool = defineTool<
    {
        framework?: 'auto' | 'jest' | 'mocha' | 'vitest';
        testFiles?: string[];
        coverage?: boolean;
        workingDirectory?: string;
    },
    TestRunResult & { detected: boolean }
>({
    name: 'test_runner',
    category: TOOL_CATEGORIES.INFRASTRUCTURE,
    description:
        'Run the project\'s tests, detecting whether it uses Jest, Mocha or Vitest from ' +
        'package.json. passed is false when any test fails.',
    inputSchema: {
        type: 'object',
        properties: {
            framework: {
                type: 'string',
                enum: ['auto', 'jest', 'mocha', 'vitest'],
                default: 'auto',
                description: 'Test framework. "auto" reads it from package.json.'
            },
            testFiles: {
                type: 'array',
                items: { type: 'string' },
                description: 'Specific test files to run'
            },
            coverage: {
                type: 'boolean',
                default: false,
                description: 'Generate a coverage report'
            },
            workingDirectory: workingDirectoryProperty
        }
    },
    run: async (input, context) => {
        const workingDirectory = input.workingDirectory || process.cwd();
        const requested = input.framework ?? 'auto';

        const detected = requested === 'auto';
        const framework = detected
            ? await detectFramework(workingDirectory)
            : requested;

        const args: string[] = [];

        switch (framework) {
            case 'jest':
                args.push('--no-watchman', '--passWithNoTests');
                if (input.coverage) {
                    args.push('--coverage');
                }
                break;
            case 'vitest':
                args.push('run');
                if (input.coverage) {
                    args.push('--coverage');
                }
                break;
            case 'mocha':
                if (input.coverage) {
                    throw ToolError.notImplemented(
                        'Mocha does not produce coverage on its own — run it under nyc or c8 instead.'
                    );
                }
                break;
        }

        if (input.testFiles && input.testFiles.length > 0) {
            args.push(...input.testFiles);
        }

        const result = await runTestRunner(framework, args, workingDirectory, context);

        return { ...result, detected };
    }
});

export const testTools = [
    jestTestTool,
    mochaTestTool,
    vitestTestTool,
    testRunnerTool
];
