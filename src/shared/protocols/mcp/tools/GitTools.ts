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

const logger = new Logger('info', 'GitTools', 'server');

/**
 * Git Tools for MXF
 * 
 * Provides git version control operations using shell commands
 * These tools are placeholders that demonstrate the interface
 * Full implementation would integrate with shell_execute tool
 */

export const gitStatusTool = {
    name: 'git_status',
    description: 'Get git repository status including staged, modified, and untracked files',
    inputSchema: {
        type: 'object',
        properties: {
            workingDirectory: {
                type: 'string',
                description: 'Working directory path (defaults to current directory)'
            }
        }
    },
    handler: async (args: {
        workingDirectory?: string;
    }, context: McpToolHandlerContext): Promise<McpToolHandlerResult> => {
        
        try {
            // Execute git status --porcelain to get parseable output
            const result = await executeShellCommand('git', ['status', '--porcelain', '--branch'], {
                workingDirectory: args.workingDirectory || process.cwd(),
                captureOutput: true
            });

            if (result.exitCode !== 0) {
                const content: McpToolResultContent = {
                    type: 'application/json',
                    data: {
                        success: false,
                        status: '',
                        files: { staged: [], modified: [], untracked: [], deleted: [] },
                        branch: 'unknown',
                        error: result.stderr || 'Git command failed'
                    }
                };
                return { content };
            }

            // Parse the output
            const lines = result.stdout?.split('\n').filter(line => line.trim()) || [];
            const files = {
                staged: [] as string[],
                modified: [] as string[],
                untracked: [] as string[],
                deleted: [] as string[]
            };

            let branch = 'unknown';
            
            for (const line of lines) {
                if (line.startsWith('## ')) {
                    // Branch information
                    const branchMatch = line.match(/^## (.+?)(?:\.\.\.|\s|$)/);
                    if (branchMatch) {
                        branch = branchMatch[1];
                    }
                } else if (line.length >= 2) {
                    // File status
                    const statusCode = line.substring(0, 2);
                    const fileName = line.substring(3);
                    
                    // Index status (first character)
                    if (statusCode[0] === 'A' || statusCode[0] === 'M' || statusCode[0] === 'D') {
                        files.staged.push(fileName);
                    }
                    
                    // Working tree status (second character)
                    if (statusCode[1] === 'M') {
                        files.modified.push(fileName);
                    } else if (statusCode[1] === 'D') {
                        files.deleted.push(fileName);
                    }
                    
                    // Untracked files
                    if (statusCode === '??') {
                        files.untracked.push(fileName);
                    }
                }
            }

            const content: McpToolResultContent = {
                type: 'application/json',
                data: {
                    success: true,
                    status: result.stdout || '',
                    files,
                    branch,
                    error: null
                }
            };
            return { content };
        } catch (error) {
            logger.error('Git status failed', { error });
            const content: McpToolResultContent = {
                type: 'application/json',
                data: {
                    success: false,
                    status: '',
                    files: { staged: [], modified: [], untracked: [], deleted: [] },
                    branch: 'unknown',
                    error: error instanceof Error ? error.message : String(error)
                }
            };
            return { content };
        }
    }
};

export const gitAddTool = {
    name: 'git_add',
    description: 'Stage files for commit',
    inputSchema: {
        type: 'object',
        properties: {
            files: {
                type: 'array',
                items: { type: 'string' },
                description: 'Files to stage (use "." for all files)'
            },
            workingDirectory: {
                type: 'string',
                description: 'Working directory path (defaults to current directory)'
            }
        },
        required: ['files']
    },
    handler: async (args: {
        files: string[];
        workingDirectory?: string;
    }, context: McpToolHandlerContext): Promise<McpToolHandlerResult> => {
        
        try {
            const result = await executeShellCommand('git', ['add', ...args.files], {
                workingDirectory: args.workingDirectory || process.cwd(),
                captureOutput: true
            });

            if (result.exitCode !== 0) {
                const content: McpToolResultContent = {
                    type: 'application/json',
                    data: {
                        success: false,
                        message: result.stderr || 'Git add failed',
                        error: result.stderr || 'Git add command failed'
                    }
                };
                return { content };
            }

            const content: McpToolResultContent = {
                type: 'application/json',
                data: {
                    success: true,
                    message: `Successfully staged ${args.files.length} file(s)`,
                    error: null
                }
            };
            return { content };
        } catch (error) {
            logger.error('Git add failed', { error });
            const content: McpToolResultContent = {
                type: 'application/json',
                data: {
                    success: false,
                    message: '',
                    error: error instanceof Error ? error.message : String(error)
                }
            };
            return { content };
        }
    }
};

export const gitCommitTool = {
    name: 'git_commit',
    description: 'Create a git commit with a message',
    inputSchema: {
        type: 'object',
        properties: {
            message: {
                type: 'string',
                description: 'Commit message'
            },
            workingDirectory: {
                type: 'string',
                description: 'Working directory path (defaults to current directory)'
            }
        },
        required: ['message']
    },
    handler: async (args: {
        message: string;
        workingDirectory?: string;
    }, context: McpToolHandlerContext): Promise<McpToolHandlerResult> => {
        
        try {
            const result = await executeShellCommand('git', ['commit', '-m', args.message], {
                workingDirectory: args.workingDirectory || process.cwd(),
                captureOutput: true
            });

            if (result.exitCode !== 0) {
                const content: McpToolResultContent = {
                    type: 'application/json',
                    data: {
                        success: false,
                        message: args.message,
                        error: result.stderr || 'Git commit failed'
                    }
                };
                return { content };
            }

            const content: McpToolResultContent = {
                type: 'application/json',
                data: {
                    success: true,
                    message: args.message,
                    commitHash: result.stdout?.match(/\[(.+?)\]/)?.[1] || 'unknown',
                    error: null
                }
            };
            return { content };
        } catch (error) {
            logger.error('Git commit failed', { error });
            const content: McpToolResultContent = {
                type: 'application/json',
                data: {
                    success: false,
                    message: args.message,
                    error: error instanceof Error ? error.message : String(error)
                }
            };
            return { content };
        }
    }
};

export const gitDiffTool = {
    name: 'git_diff',
    description: 'Show differences between commits, commit and working tree, etc',
    inputSchema: {
        type: 'object',
        properties: {
            staged: {
                type: 'boolean',
                default: false,
                description: 'Show staged changes (--cached)'
            },
            workingDirectory: {
                type: 'string',
                description: 'Working directory path (defaults to current directory)'
            }
        }
    },
    handler: async (args: {
        staged?: boolean;
        workingDirectory?: string;
    }, context: McpToolHandlerContext): Promise<McpToolHandlerResult> => {
        
        try {
            const gitArgs = ['diff'];
            if (args.staged) {
                gitArgs.push('--cached');
            }
            gitArgs.push('--stat');
            
            const result = await executeShellCommand('git', gitArgs, {
                workingDirectory: args.workingDirectory || process.cwd(),
                captureOutput: true
            });

            if (result.exitCode !== 0) {
                const content: McpToolResultContent = {
                    type: 'application/json',
                    data: {
                        success: false,
                        diff: '',
                        filesChanged: 0,
                        insertions: 0,
                        deletions: 0,
                        error: result.stderr || 'Git diff failed'
                    }
                };
                return { content };
            }

            // Get the actual diff content
            const diffResult = await executeShellCommand('git', args.staged ? ['diff', '--cached'] : ['diff'], {
                workingDirectory: args.workingDirectory || process.cwd(),
                captureOutput: true
            });

            // Parse stats from output
            const statsMatch = result.stdout?.match(/(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(\-\))?/);
            
            const content: McpToolResultContent = {
                type: 'application/json',
                data: {
                    success: true,
                    diff: diffResult.stdout || '',
                    filesChanged: statsMatch ? parseInt(statsMatch[1]) : 0,
                    insertions: statsMatch ? parseInt(statsMatch[2] || '0') : 0,
                    deletions: statsMatch ? parseInt(statsMatch[3] || '0') : 0,
                    error: null
                }
            };
            return { content };
        } catch (error) {
            logger.error('Git diff failed', { error });
            const content: McpToolResultContent = {
                type: 'application/json',
                data: {
                    success: false,
                    diff: '',
                    filesChanged: 0,
                    insertions: 0,
                    deletions: 0,
                    error: error instanceof Error ? error.message : String(error)
                }
            };
            return { content };
        }
    }
};

export const gitLogTool = {
    name: 'git_log',
    description: 'Show commit logs',
    inputSchema: {
        type: 'object',
        properties: {
            maxCount: {
                type: 'number',
                default: 10,
                description: 'Maximum number of commits to show'
            },
            workingDirectory: {
                type: 'string',
                description: 'Working directory path (defaults to current directory)'
            }
        }
    },
    handler: async (args: {
        maxCount?: number;
        workingDirectory?: string;
    }, context: McpToolHandlerContext): Promise<McpToolHandlerResult> => {
        
        try {
            const result = await executeShellCommand('git', [
                'log',
                '--oneline',
                '--format=%H|%s|%an|%ad|%d',
                '--date=iso',
                `-n${args.maxCount || 10}`
            ], {
                workingDirectory: args.workingDirectory || process.cwd(),
                captureOutput: true
            });

            if (result.exitCode !== 0) {
                const content: McpToolResultContent = {
                    type: 'application/json',
                    data: {
                        success: false,
                        commits: [],
                        error: result.stderr || 'Git log failed'
                    }
                };
                return { content };
            }

            // Parse commits
            const commits = result.stdout?.split('\n')
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
                }) || [];

            const content: McpToolResultContent = {
                type: 'application/json',
                data: {
                    success: true,
                    commits,
                    error: null
                }
            };
            return { content };
        } catch (error) {
            logger.error('Git log failed', { error });
            const content: McpToolResultContent = {
                type: 'application/json',
                data: {
                    success: false,
                    commits: [],
                    error: error instanceof Error ? error.message : String(error)
                }
            };
            return { content };
        }
    }
};

export const gitBranchTool = {
    name: 'git_branch',
    description: 'List, create, or delete branches',
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
                description: 'Branch name (required for create, delete, switch actions)'
            },
            workingDirectory: {
                type: 'string',
                description: 'Working directory path (defaults to current directory)'
            }
        }
    },
    handler: async (args: {
        action?: 'list' | 'create' | 'delete' | 'switch';
        branchName?: string;
        workingDirectory?: string;
    }, context: McpToolHandlerContext): Promise<McpToolHandlerResult> => {
        
        try {
            let result;
            
            switch (args.action) {
                case 'create':
                    if (!args.branchName) {
                        throw new Error('Branch name required for create action');
                    }
                    result = await executeShellCommand('git', ['branch', args.branchName], {
                        workingDirectory: args.workingDirectory || process.cwd(),
                        captureOutput: true
                    });
                    break;
                    
                case 'delete':
                    if (!args.branchName) {
                        throw new Error('Branch name required for delete action');
                    }
                    result = await executeShellCommand('git', ['branch', '-d', args.branchName], {
                        workingDirectory: args.workingDirectory || process.cwd(),
                        captureOutput: true
                    });
                    break;
                    
                case 'switch':
                    if (!args.branchName) {
                        throw new Error('Branch name required for switch action');
                    }
                    result = await executeShellCommand('git', ['switch', args.branchName], {
                        workingDirectory: args.workingDirectory || process.cwd(),
                        captureOutput: true
                    });
                    break;
                    
                case 'list':
                default:
                    result = await executeShellCommand('git', ['branch', '-a'], {
                        workingDirectory: args.workingDirectory || process.cwd(),
                        captureOutput: true
                    });
                    break;
            }

            if (result.exitCode !== 0) {
                const content: McpToolResultContent = {
                    type: 'application/json',
                    data: {
                        success: false,
                        currentBranch: '',
                        branches: [],
                        error: result.stderr || 'Git branch command failed'
                    }
                };
                return { content };
            }

            // Get current branch
            const currentBranchResult = await executeShellCommand('git', ['branch', '--show-current'], {
                workingDirectory: args.workingDirectory || process.cwd(),
                captureOutput: true
            });

            const currentBranch = currentBranchResult.stdout?.trim() || '';
            
            // Parse branches for list action
            let branches: string[] = [];
            if (args.action === 'list' || !args.action) {
                branches = result.stdout?.split('\n')
                    .filter(line => line.trim())
                    .map(line => line.replace(/^[\s\*]+/, '').trim())
                    .filter(branch => branch) || [];
            }

            const content: McpToolResultContent = {
                type: 'application/json',
                data: {
                    success: true,
                    currentBranch,
                    branches,
                    error: null
                }
            };
            return { content };
        } catch (error) {
            logger.error('Git branch failed', { error });
            const content: McpToolResultContent = {
                type: 'application/json',
                data: {
                    success: false,
                    currentBranch: '',
                    branches: [],
                    error: error instanceof Error ? error.message : String(error)
                }
            };
            return { content };
        }
    }
};

export const gitPushTool = {
    name: 'git_push',
    description: 'Push commits to remote repository',
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
                description: 'Branch to push (defaults to current branch)'
            },
            workingDirectory: {
                type: 'string',
                description: 'Working directory path (defaults to current directory)'
            }
        }
    },
    handler: async (args: {
        remote?: string;
        branch?: string;
        workingDirectory?: string;
    }, context: McpToolHandlerContext): Promise<McpToolHandlerResult> => {
        
        try {
            const gitArgs = ['push'];
            if (args.remote) {
                gitArgs.push(args.remote);
            }
            if (args.branch) {
                gitArgs.push(args.branch);
            }
            
            const result = await executeShellCommand('git', gitArgs, {
                workingDirectory: args.workingDirectory || process.cwd(),
                captureOutput: true
            });

            if (result.exitCode !== 0) {
                const content: McpToolResultContent = {
                    type: 'application/json',
                    data: {
                        success: false,
                        message: result.stderr || 'Git push failed',
                        error: result.stderr || 'Git push command failed'
                    }
                };
                return { content };
            }

            const content: McpToolResultContent = {
                type: 'application/json',
                data: {
                    success: true,
                    message: result.stdout || 'Push completed successfully',
                    error: null
                }
            };
            return { content };
        } catch (error) {
            logger.error('Git push failed', { error });
            const content: McpToolResultContent = {
                type: 'application/json',
                data: {
                    success: false,
                    message: '',
                    error: error instanceof Error ? error.message : String(error)
                }
            };
            return { content };
        }
    }
};

export const gitPullTool = {
    name: 'git_pull',
    description: 'Pull changes from remote repository',
    inputSchema: {
        type: 'object',
        properties: {
            remote: {
                type: 'string',
                default: 'origin',
                description: 'Remote name'
            },
            workingDirectory: {
                type: 'string',
                description: 'Working directory path (defaults to current directory)'
            }
        }
    },
    handler: async (args: {
        remote?: string;
        workingDirectory?: string;
    }, context: McpToolHandlerContext): Promise<McpToolHandlerResult> => {
        
        try {
            const gitArgs = ['pull'];
            if (args.remote) {
                gitArgs.push(args.remote);
            }
            
            const result = await executeShellCommand('git', gitArgs, {
                workingDirectory: args.workingDirectory || process.cwd(),
                captureOutput: true
            });

            if (result.exitCode !== 0) {
                const content: McpToolResultContent = {
                    type: 'application/json',
                    data: {
                        success: false,
                        message: result.stderr || 'Git pull failed',
                        error: result.stderr || 'Git pull command failed'
                    }
                };
                return { content };
            }

            const content: McpToolResultContent = {
                type: 'application/json',
                data: {
                    success: true,
                    message: result.stdout || 'Pull completed successfully',
                    error: null
                }
            };
            return { content };
        } catch (error) {
            logger.error('Git pull failed', { error });
            const content: McpToolResultContent = {
                type: 'application/json',
                data: {
                    success: false,
                    message: '',
                    error: error instanceof Error ? error.message : String(error)
                }
            };
            return { content };
        }
    }
};

// Export all git tools
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
