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
 * TypeScriptTools.ts
 *
 * TypeScript checking, building, formatting, linting and test running. Each tool
 * shells out to the real binary (tsc, prettier, eslint, jest) through
 * executeShellCommand, which validates the command and strips the child's
 * environment.
 *
 * On exit codes: tsc, eslint and jest all exit non-zero to mean "I found
 * problems". That is a successful tool call with a negative finding, not a tool
 * failure — so those tools return `passed: false` with the diagnostics, and
 * `isError` stays false. `isError` is reserved for the tool genuinely not
 * working: the binary is missing, the working directory does not exist, output
 * cannot be parsed.
 */

import { TOOL_CATEGORIES } from '../../../constants/ToolNames.js';
import { defineTool, ToolRunContext } from '../defineTool.js';
import { ToolError } from '../ToolError.js';
import { executeShellCommand, ShellCommandResult } from './InfrastructureTools.js';

/** Exit code the shell reports when a command could not be found or spawned. */
const COMMAND_NOT_FOUND = 127;

const workingDirectoryProperty = {
    type: 'string',
    description: 'Working directory path (defaults to the server working directory)'
};

/**
 * Run one of the node toolchain binaries via npx.
 *
 * Throws only when the binary could not be run at all. A non-zero exit that the
 * binary uses to report findings is handed back to the caller to interpret.
 */
async function runNpx(
    args: string[],
    workingDirectory: string | undefined,
    context: ToolRunContext
): Promise<ShellCommandResult> {
    const result = await executeShellCommand('npx', args, {
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
            `Could not run "npx ${args[0]}" — the command was not found. ` +
            `${result.stderr?.trim() ?? ''}`.trim(),
            { command: args[0] }
        );
    }

    return result;
}

/** Pull `file(line,col): error TSxxxx: message` diagnostics out of tsc output. */
function parseTscDiagnostics(output: string): Array<{
    type: 'error' | 'warning';
    file: string;
    line: number;
    column: number;
    code: string;
    message: string;
}> {
    const diagnostics: Array<{
        type: 'error' | 'warning';
        file: string;
        line: number;
        column: number;
        code: string;
        message: string;
    }> = [];

    // tsc --pretty false emits: path/file.ts(12,5): error TS2304: Cannot find name 'x'.
    const pattern = /^(.+?)\((\d+),(\d+)\):\s+(error|warning)\s+(TS\d+):\s+(.*)$/;

    for (const line of output.split('\n')) {
        const match = line.match(pattern);
        if (!match) {
            continue;
        }
        diagnostics.push({
            type: match[4] as 'error' | 'warning',
            file: match[1],
            line: parseInt(match[2], 10),
            column: parseInt(match[3], 10),
            code: match[5],
            message: match[6].trim()
        });
    }

    return diagnostics;
}

export const typescriptCheckTool = defineTool<
    { workingDirectory?: string; files?: string[] },
    {
        passed: boolean;
        totalErrors: number;
        totalWarnings: number;
        diagnostics: ReturnType<typeof parseTscDiagnostics>;
    }
>({
    name: 'typescript_check',
    category: TOOL_CATEGORIES.INFRASTRUCTURE,
    description:
        'Type-check TypeScript with `tsc --noEmit` and return the diagnostics. ' +
        'passed is false when there are type errors.',
    inputSchema: {
        type: 'object',
        properties: {
            workingDirectory: workingDirectoryProperty,
            files: {
                type: 'array',
                items: { type: 'string' },
                description: 'Specific files to check. Checks the whole project when omitted.'
            }
        }
    },
    run: async (input, context) => {
        const tscArgs = ['tsc', '--noEmit', '--pretty', 'false'];
        if (input.files && input.files.length > 0) {
            tscArgs.push(...input.files);
        }

        const result = await runNpx(tscArgs, input.workingDirectory, context);

        // tsc writes diagnostics to stdout and exits 1 when it finds any. That is
        // the tool working, not the tool failing.
        const diagnostics = parseTscDiagnostics(result.stdout ?? '');
        const totalErrors = diagnostics.filter(d => d.type === 'error').length;
        const totalWarnings = diagnostics.filter(d => d.type === 'warning').length;

        // A non-zero exit with nothing parseable means tsc fell over for some other
        // reason (bad tsconfig, unreadable directory). That is a real failure.
        if (result.exitCode !== 0 && diagnostics.length === 0) {
            throw ToolError.executionFailed(
                `tsc exited ${result.exitCode} without producing diagnostics: ` +
                `${(result.stderr || result.stdout)?.trim() || 'no output'}`
            );
        }

        return {
            passed: totalErrors === 0,
            totalErrors,
            totalWarnings,
            diagnostics
        };
    }
});

export const typescriptBuildTool = defineTool<
    { workingDirectory?: string; clean?: boolean },
    { passed: boolean; buildTimeMs: number; errors: string[]; output: string }
>({
    name: 'typescript_build',
    category: TOOL_CATEGORIES.INFRASTRUCTURE,
    description: 'Build the TypeScript project with `tsc --build` and emit JavaScript.',
    inputSchema: {
        type: 'object',
        properties: {
            workingDirectory: workingDirectoryProperty,
            clean: {
                type: 'boolean',
                default: false,
                description: 'Run `tsc --build --clean` first'
            }
        }
    },
    run: async (input, context) => {
        const startedAt = Date.now();

        if (input.clean) {
            const cleanResult = await runNpx(
                ['tsc', '--build', '--clean'],
                input.workingDirectory,
                context
            );
            // A failed clean leaves stale output behind, which makes the build's
            // result meaningless. Say so rather than building on top of it.
            if (cleanResult.exitCode !== 0) {
                throw ToolError.executionFailed(
                    `tsc --build --clean failed (exit ${cleanResult.exitCode}): ` +
                    `${(cleanResult.stderr || cleanResult.stdout)?.trim() || 'no output'}`
                );
            }
        }

        const result = await runNpx(['tsc', '--build'], input.workingDirectory, context);

        const errors = (result.stdout ?? '')
            .split('\n')
            .filter(line => line.includes('error TS'))
            .map(line => line.trim());

        return {
            passed: result.exitCode === 0,
            buildTimeMs: Date.now() - startedAt,
            errors,
            output: result.stdout ?? ''
        };
    }
});

export const typescriptFormatTool = defineTool<
    { files?: string[]; check?: boolean; workingDirectory?: string },
    { mode: 'check' | 'write'; formatted: boolean; files: string[]; output: string }
>({
    name: 'typescript_format',
    category: TOOL_CATEGORIES.INFRASTRUCTURE,
    description:
        'Format TypeScript/JavaScript files with prettier. ' +
        'With check: true it reports whether files are formatted without changing them.',
    inputSchema: {
        type: 'object',
        properties: {
            files: {
                type: 'array',
                items: { type: 'string' },
                description: 'Files to format (glob patterns allowed). Defaults to all TS/JS sources.'
            },
            check: {
                type: 'boolean',
                default: false,
                description: 'Report formatting problems instead of rewriting files'
            },
            workingDirectory: workingDirectoryProperty
        }
    },
    run: async (input, context) => {
        const mode: 'check' | 'write' = input.check ? 'check' : 'write';
        const prettierArgs = ['prettier', input.check ? '--check' : '--write'];

        if (input.files && input.files.length > 0) {
            prettierArgs.push(...input.files);
        } else {
            prettierArgs.push('**/*.{ts,tsx,js,jsx}');
        }

        const result = await runNpx(prettierArgs, input.workingDirectory, context);

        // In check mode prettier exits 1 when files need formatting — a finding,
        // not a failure. In write mode a non-zero exit means it could not write.
        if (mode === 'write' && result.exitCode !== 0) {
            throw ToolError.executionFailed(
                `prettier --write failed (exit ${result.exitCode}): ` +
                `${(result.stderr || result.stdout)?.trim() || 'no output'}`
            );
        }

        const files = (result.stdout ?? '')
            .split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 0 && !line.startsWith('Checking'));

        return {
            mode,
            formatted: result.exitCode === 0,
            files,
            output: result.stdout ?? ''
        };
    }
});

export const typescriptLintTool = defineTool<
    { files?: string[]; fix?: boolean; workingDirectory?: string },
    { passed: boolean; errorCount: number; warningCount: number; results: unknown[] }
>({
    name: 'typescript_lint',
    category: TOOL_CATEGORIES.INFRASTRUCTURE,
    description:
        'Lint TypeScript/JavaScript with ESLint and return the findings. ' +
        'passed is false when there are lint errors.',
    inputSchema: {
        type: 'object',
        properties: {
            files: {
                type: 'array',
                items: { type: 'string' },
                description: 'Files to lint (glob patterns allowed). Defaults to all TS/JS sources.'
            },
            fix: {
                type: 'boolean',
                default: false,
                description: 'Automatically fix the problems ESLint can fix'
            },
            workingDirectory: workingDirectoryProperty
        }
    },
    run: async (input, context) => {
        const eslintArgs = ['eslint', '--format', 'json'];
        if (input.fix) {
            eslintArgs.push('--fix');
        }

        if (input.files && input.files.length > 0) {
            eslintArgs.push(...input.files);
        } else {
            eslintArgs.push('**/*.{ts,tsx,js,jsx}');
        }

        const result = await runNpx(eslintArgs, input.workingDirectory, context);

        // ESLint exits 1 when it finds errors, but always prints its JSON report.
        // No parseable report means ESLint itself fell over — that is a failure,
        // and it must not be reported as "no lint problems".
        const raw = (result.stdout ?? '').trim();
        if (raw.length === 0) {
            throw ToolError.executionFailed(
                `eslint produced no report (exit ${result.exitCode}): ` +
                `${result.stderr?.trim() || 'no error output'}`
            );
        }

        let results: Array<{ errorCount?: number; warningCount?: number }>;
        try {
            results = JSON.parse(raw);
        } catch (parseError) {
            throw ToolError.executionFailed(
                `Could not parse the ESLint JSON report: ` +
                `${parseError instanceof Error ? parseError.message : String(parseError)}`,
                { details: { outputPreview: raw.slice(0, 200) } }
            );
        }

        const errorCount = results.reduce((sum, file) => sum + (file.errorCount ?? 0), 0);
        const warningCount = results.reduce((sum, file) => sum + (file.warningCount ?? 0), 0);

        return {
            passed: errorCount === 0,
            errorCount,
            warningCount,
            results
        };
    }
});

export const typescriptTestTool = defineTool<
    { testFiles?: string[]; coverage?: boolean; workingDirectory?: string },
    { passed: boolean; testsRun: number; testsPassed: number; testsFailed: number; output: string }
>({
    name: 'typescript_test',
    category: TOOL_CATEGORIES.INFRASTRUCTURE,
    description:
        'Run Jest tests and return the counts. passed is false when any test fails.',
    inputSchema: {
        type: 'object',
        properties: {
            testFiles: {
                type: 'array',
                items: { type: 'string' },
                description: 'Specific test files to run. Runs the whole suite when omitted.'
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
        const jestArgs = ['jest', '--no-watchman', '--passWithNoTests'];

        if (input.coverage) {
            jestArgs.push('--coverage');
        }
        if (input.testFiles && input.testFiles.length > 0) {
            jestArgs.push(...input.testFiles);
        }

        const result = await runNpx(jestArgs, input.workingDirectory, context);

        // Jest writes its summary to stderr, not stdout.
        const output = [result.stdout, result.stderr].filter(Boolean).join('\n');

        // Summary line: "Tests: 1 failed, 2 skipped, 17 passed, 20 total"
        const summary = output.match(/^Tests:\s+(.+)$/m)?.[1] ?? '';
        const readCount = (label: string): number => {
            const match = summary.match(new RegExp(`(\\d+)\\s+${label}`));
            return match ? parseInt(match[1], 10) : 0;
        };

        const testsRun = readCount('total');
        const testsPassed = readCount('passed');
        const testsFailed = readCount('failed');

        return {
            passed: result.exitCode === 0,
            testsRun,
            testsPassed,
            testsFailed,
            output
        };
    }
});

export const typescriptTools = [
    typescriptCheckTool,
    typescriptBuildTool,
    typescriptFormatTool,
    typescriptLintTool,
    typescriptTestTool
];
