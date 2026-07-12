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
 * GitTools.ts
 *
 * Git operations, run by shelling out to the `git` binary through
 * executeShellCommand — which validates the command against the security guard
 * and hands the child a stripped environment.
 *
 * Each tool is declared with defineTool: a git command that fails throws a
 * ToolError and comes back as one envelope with `isError: true`, rather than a
 * `{ success: false, error: '...' }` object that reads like a successful result.
 */

import { TOOL_CATEGORIES } from '../../../constants/ToolNames.js';
import { defineTool, ToolRunContext } from '../defineTool.js';
import { ToolError } from '../ToolError.js';
import { executeShellCommand, ShellCommandResult } from './InfrastructureTools.js';

/** Working-directory property shared by every git tool's schema. */
const workingDirectoryProperty = {
    type: 'string',
    description: 'Working directory path (defaults to the server working directory)'
};

/**
 * Run a git subcommand, throwing a ToolError when git reports failure.
 *
 * Non-zero exit is genuine failure for every subcommand used here — none of them
 * use exit codes to signal a non-error condition the way `git diff --quiet` does.
 */
async function runGit(
    args: string[],
    workingDirectory: string | undefined,
    context: ToolRunContext
): Promise<ShellCommandResult> {
    const result = await executeShellCommand('git', args, {
        context: {
            agentId: context.agentId,
            channelId: context.channelId,
            requestId: context.requestId
        },
        workingDirectory: workingDirectory || process.cwd(),
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

export const gitStatusTool = defineTool<
    { workingDirectory?: string },
    {
        status: string;
        branch: string;
        files: { staged: string[]; modified: string[]; untracked: string[]; deleted: string[] };
    }
>({
    name: 'git_status',
    category: TOOL_CATEGORIES.VERSION_CONTROL,
    description: 'Report the current branch plus staged, modified, untracked and deleted files.',
    inputSchema: {
        type: 'object',
        properties: {
            workingDirectory: workingDirectoryProperty
        }
    },
    run: async (input, context) => {
        const result = await runGit(['status', '--porcelain', '--branch'], input.workingDirectory, context);

        const lines = result.stdout?.split('\n').filter(line => line.trim()) ?? [];
        const files = {
            staged: [] as string[],
            modified: [] as string[],
            untracked: [] as string[],
            deleted: [] as string[]
        };

        let branch = 'unknown';

        for (const line of lines) {
            if (line.startsWith('## ')) {
                const branchMatch = line.match(/^## (.+?)(?:\.\.\.|\s|$)/);
                if (branchMatch) {
                    branch = branchMatch[1];
                }
                continue;
            }

            if (line.length < 2) {
                continue;
            }

            const statusCode = line.substring(0, 2);
            const fileName = line.substring(3);

            // Porcelain format: first char is the index state, second is the
            // working-tree state. '??' in both positions means untracked.
            if (statusCode === '??') {
                files.untracked.push(fileName);
                continue;
            }
            if (statusCode[0] === 'A' || statusCode[0] === 'M' || statusCode[0] === 'D') {
                files.staged.push(fileName);
            }
            if (statusCode[1] === 'M') {
                files.modified.push(fileName);
            } else if (statusCode[1] === 'D') {
                files.deleted.push(fileName);
            }
        }

        return {
            status: result.stdout ?? '',
            branch,
            files
        };
    }
});

export const gitAddTool = defineTool<
    { files: string[]; workingDirectory?: string },
    { stagedCount: number; files: string[] }
>({
    name: 'git_add',
    category: TOOL_CATEGORIES.VERSION_CONTROL,
    description: 'Stage files for commit. Pass "." to stage everything.',
    inputSchema: {
        type: 'object',
        properties: {
            files: {
                type: 'array',
                items: { type: 'string' },
                minItems: 1,
                description: 'Files to stage (use "." for all files)'
            },
            workingDirectory: workingDirectoryProperty
        },
        required: ['files']
    },
    run: async (input, context) => {
        await runGit(['add', ...input.files], input.workingDirectory, context);

        return {
            stagedCount: input.files.length,
            files: input.files
        };
    }
});

export const gitCommitTool = defineTool<
    { message: string; workingDirectory?: string },
    { message: string; commitHash: string }
>({
    name: 'git_commit',
    category: TOOL_CATEGORIES.VERSION_CONTROL,
    description: 'Create a commit from the staged changes.',
    inputSchema: {
        type: 'object',
        properties: {
            message: {
                type: 'string',
                minLength: 1,
                description: 'Commit message'
            },
            workingDirectory: workingDirectoryProperty
        },
        required: ['message']
    },
    run: async (input, context) => {
        const result = await runGit(['commit', '-m', input.message], input.workingDirectory, context);

        // git prints `[branch abc1234] subject` on success.
        const commitHash = result.stdout?.match(/\[[^\]]*\s([0-9a-f]{7,40})\]/)?.[1];
        if (!commitHash) {
            throw ToolError.executionFailed(
                `git commit succeeded but its output did not contain a commit hash: ${result.stdout?.trim()}`
            );
        }

        return {
            message: input.message,
            commitHash
        };
    }
});

export const gitDiffTool = defineTool<
    { staged?: boolean; workingDirectory?: string },
    { diff: string; filesChanged: number; insertions: number; deletions: number }
>({
    name: 'git_diff',
    category: TOOL_CATEGORIES.VERSION_CONTROL,
    description: 'Show the working-tree diff, or the staged diff when staged is true.',
    inputSchema: {
        type: 'object',
        properties: {
            staged: {
                type: 'boolean',
                default: false,
                description: 'Show staged changes (--cached) instead of working-tree changes'
            },
            workingDirectory: workingDirectoryProperty
        }
    },
    run: async (input, context) => {
        const baseArgs = input.staged ? ['diff', '--cached'] : ['diff'];

        const statResult = await runGit([...baseArgs, '--stat'], input.workingDirectory, context);
        const diffResult = await runGit(baseArgs, input.workingDirectory, context);

        const statsMatch = statResult.stdout?.match(
            /(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?/
        );

        return {
            diff: diffResult.stdout ?? '',
            filesChanged: statsMatch ? parseInt(statsMatch[1], 10) : 0,
            insertions: statsMatch ? parseInt(statsMatch[2] ?? '0', 10) : 0,
            deletions: statsMatch ? parseInt(statsMatch[3] ?? '0', 10) : 0
        };
    }
});

export const gitLogTool = defineTool<
    { maxCount?: number; workingDirectory?: string },
    { commits: Array<{ hash: string; subject: string; author: string; date: string; refs: string }> }
>({
    name: 'git_log',
    category: TOOL_CATEGORIES.VERSION_CONTROL,
    description: 'List recent commits with hash, subject, author and date.',
    inputSchema: {
        type: 'object',
        properties: {
            maxCount: {
                type: 'number',
                default: 10,
                minimum: 1,
                maximum: 500,
                description: 'Maximum number of commits to show'
            },
            workingDirectory: workingDirectoryProperty
        }
    },
    run: async (input, context) => {
        const maxCount = input.maxCount ?? 10;

        const result = await runGit(
            ['log', '--format=%H|%s|%an|%ad|%d', '--date=iso', `-n${maxCount}`],
            input.workingDirectory,
            context
        );

        const commits = (result.stdout ?? '')
            .split('\n')
            .filter(line => line.trim())
            .map(line => {
                const [hash, subject, author, date, refs] = line.split('|');
                return {
                    hash,
                    subject,
                    author,
                    date,
                    refs: refs ? refs.trim() : ''
                };
            });

        return { commits };
    }
});

export const gitBranchTool = defineTool<
    { action?: 'list' | 'create' | 'delete' | 'switch'; branchName?: string; workingDirectory?: string },
    { action: string; currentBranch: string; branches: string[] }
>({
    name: 'git_branch',
    category: TOOL_CATEGORIES.VERSION_CONTROL,
    description: 'List branches, or create, delete, or switch to a branch.',
    inputSchema: {
        type: 'object',
        properties: {
            action: {
                type: 'string',
                enum: ['list', 'create', 'delete', 'switch'],
                default: 'list',
                description: 'Action to perform'
            },
            branchName: {
                type: 'string',
                description: 'Branch name (required for create, delete and switch)'
            },
            workingDirectory: workingDirectoryProperty
        }
    },
    run: async (input, context) => {
        const action = input.action ?? 'list';

        // create/delete/switch are meaningless without a name — reject before
        // shelling out, so the model gets a precise correction.
        if (action !== 'list' && !input.branchName) {
            throw ToolError.invalidInput(`branchName is required for the "${action}" action.`);
        }

        let listOutput = '';

        switch (action) {
            case 'create':
                await runGit(['branch', input.branchName!], input.workingDirectory, context);
                break;
            case 'delete':
                await runGit(['branch', '-d', input.branchName!], input.workingDirectory, context);
                break;
            case 'switch':
                await runGit(['switch', input.branchName!], input.workingDirectory, context);
                break;
            case 'list':
            default: {
                const result = await runGit(['branch', '-a'], input.workingDirectory, context);
                listOutput = result.stdout ?? '';
                break;
            }
        }

        const currentBranchResult = await runGit(
            ['branch', '--show-current'],
            input.workingDirectory,
            context
        );

        const branches = listOutput
            .split('\n')
            .filter(line => line.trim())
            .map(line => line.replace(/^[\s*]+/, '').trim())
            .filter(branch => branch.length > 0);

        return {
            action,
            currentBranch: currentBranchResult.stdout?.trim() ?? '',
            branches
        };
    }
});

export const gitPushTool = defineTool<
    { remote?: string; branch?: string; workingDirectory?: string },
    { remote: string; branch?: string; output: string }
>({
    name: 'git_push',
    category: TOOL_CATEGORIES.VERSION_CONTROL,
    description: 'Push commits to a remote repository.',
    inputSchema: {
        type: 'object',
        properties: {
            remote: {
                type: 'string',
                default: 'origin',
                description: 'Remote name'
            },
            branch: {
                type: 'string',
                description: 'Branch to push (defaults to the current branch)'
            },
            workingDirectory: workingDirectoryProperty
        }
    },
    run: async (input, context) => {
        const remote = input.remote ?? 'origin';
        const args = ['push', remote];
        if (input.branch) {
            args.push(input.branch);
        }

        const result = await runGit(args, input.workingDirectory, context);

        // git push reports progress on stderr even when it succeeds, so include both.
        return {
            remote,
            branch: input.branch,
            output: [result.stdout, result.stderr].filter(Boolean).join('\n').trim()
        };
    }
});

export const gitPullTool = defineTool<
    { remote?: string; workingDirectory?: string },
    { remote: string; output: string }
>({
    name: 'git_pull',
    category: TOOL_CATEGORIES.VERSION_CONTROL,
    description: 'Pull changes from a remote repository.',
    inputSchema: {
        type: 'object',
        properties: {
            remote: {
                type: 'string',
                default: 'origin',
                description: 'Remote name'
            },
            workingDirectory: workingDirectoryProperty
        }
    },
    run: async (input, context) => {
        const remote = input.remote ?? 'origin';

        const result = await runGit(['pull', remote], input.workingDirectory, context);

        return {
            remote,
            output: [result.stdout, result.stderr].filter(Boolean).join('\n').trim()
        };
    }
});

export const gitTools = [
    gitStatusTool,
    gitAddTool,
    gitCommitTool,
    gitDiffTool,
    gitLogTool,
    gitBranchTool,
    gitPushTool,
    gitPullTool
];
