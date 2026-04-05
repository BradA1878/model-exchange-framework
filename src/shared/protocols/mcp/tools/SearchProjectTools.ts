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
 * Search Project Tools
 *
 * MCP tool for scoped grep/find within a working directory. Supports two modes:
 * - search_content: grep for patterns in file contents (uses rg with grep fallback)
 * - search_files: find files by name/glob pattern
 *
 * Safety: Validates pattern input against an allowlist to prevent command injection.
 */

import { McpToolDefinition, McpToolHandlerContext, McpToolHandlerResult, McpToolResultContent } from '../McpServerTypes';
import { McpToolInput } from '../IMcpClient';
import { Logger } from '../../../utils/Logger';
import { execSync } from 'child_process';

const logger = new Logger('info', 'SearchProjectTools', 'server');

/** Characters that are not allowed in search patterns to prevent command injection */
const DANGEROUS_CHARS = [';', '|', '&', '$', '`', '(', ')'];

/**
 * Validate that the pattern does not contain dangerous shell characters.
 * Throws an error if any dangerous character is found.
 */
function validatePattern(pattern: string): void {
    for (const char of DANGEROUS_CHARS) {
        if (pattern.includes(char)) {
            throw new Error(`Pattern contains dangerous character '${char}'. Patterns must not include: ${DANGEROUS_CHARS.join(' ')}`);
        }
    }
}

/**
 * Handle search_content mode: grep for patterns in file contents.
 * Tries ripgrep (rg) first, falls back to grep if rg is not installed.
 */
function handleSearchContent(
    pattern: string,
    dir: string,
    maxResults: number,
    caseSensitive: boolean,
    fileTypes?: string[]
): any {
    const caseFlag = caseSensitive ? '' : '-i';
    let output = '';

    try {
        // Try ripgrep first
        let cmd = `rg -n --max-count ${maxResults} ${caseFlag}`;

        // Add file type filters for rg
        if (fileTypes && fileTypes.length > 0) {
            for (const ext of fileTypes) {
                cmd += ` --type-add 'custom:*.${ext}' --type custom`;
            }
        }

        // Exclude common non-source directories
        cmd += ` --glob '!.git' --glob '!node_modules' --glob '!dist'`;
        cmd += ` "${pattern}" "${dir}"`;

        logger.info(`Executing ripgrep: ${cmd}`);
        output = execSync(cmd, { cwd: dir, timeout: 15000, encoding: 'utf-8' });
    } catch (rgError: any) {
        // Check if rg is not installed (ENOENT)
        if (rgError.code === 'ENOENT' || (rgError.message && rgError.message.includes('ENOENT'))) {
            logger.info('ripgrep not found, falling back to grep');

            // Fall back to grep
            let grepCmd = `grep -rn ${caseFlag}`;

            // Add file type includes for grep
            if (fileTypes && fileTypes.length > 0) {
                for (const ext of fileTypes) {
                    grepCmd += ` --include="*.${ext}"`;
                }
            }

            // Exclude common non-source directories
            grepCmd += ` --exclude-dir=.git --exclude-dir=node_modules --exclude-dir=dist`;
            grepCmd += ` "${pattern}" "${dir}"`;

            logger.info(`Executing grep: ${grepCmd}`);
            output = execSync(grepCmd, { cwd: dir, timeout: 15000, encoding: 'utf-8' });
        } else if (rgError.status === 1) {
            // rg returns exit code 1 when no matches found — not an error
            output = '';
        } else {
            throw rgError;
        }
    }

    // Parse output: each line is file:line:text
    const lines = output.split('\n').filter((line: string) => line.trim().length > 0);
    const totalFound = lines.length;

    const matches = lines.slice(0, maxResults).map((line: string) => {
        // rg/grep output format: file:line:text
        const firstColon = line.indexOf(':');
        const secondColon = line.indexOf(':', firstColon + 1);

        if (firstColon === -1 || secondColon === -1) {
            return { file: line, line: 0, text: '' };
        }

        const file = line.substring(0, firstColon);
        const lineNum = parseInt(line.substring(firstColon + 1, secondColon), 10);
        let text = line.substring(secondColon + 1);

        // Truncate text to 200 chars
        if (text.length > 200) {
            text = text.substring(0, 200) + '...';
        }

        return { file, line: lineNum, text };
    });

    return {
        matches,
        totalFound,
        truncated: totalFound > maxResults,
        success: true
    };
}

/**
 * Handle search_files mode: find files by name/glob pattern.
 * Uses the find command to locate files matching the pattern.
 */
function handleSearchFiles(
    pattern: string,
    dir: string,
    maxResults: number,
    fileTypes?: string[]
): any {
    let cmd: string;

    if (fileTypes && fileTypes.length > 0) {
        // Build find command with file type filters
        const typeConditions = fileTypes.map(ext => `-name "*.${ext}"`).join(' -o ');
        cmd = `find "${dir}" \\( ${typeConditions} \\) -type f -not -path '*/.git/*' -not -path '*/node_modules/*' -not -path '*/dist/*'`;
    } else {
        cmd = `find "${dir}" -name "${pattern}" -type f -not -path '*/.git/*' -not -path '*/node_modules/*' -not -path '*/dist/*'`;
    }

    logger.info(`Executing find: ${cmd}`);

    let output = '';
    try {
        output = execSync(cmd, { cwd: dir, timeout: 15000, encoding: 'utf-8' });
    } catch (error: any) {
        // find returns exit code 1 on permission errors but may still have output
        if (error.stdout) {
            output = error.stdout;
        } else {
            throw error;
        }
    }

    const allFiles = output.split('\n').filter((line: string) => line.trim().length > 0);
    const totalFound = allFiles.length;
    const files = allFiles.slice(0, maxResults);

    return {
        files,
        totalFound,
        truncated: totalFound > maxResults,
        success: true
    };
}

/**
 * Search for files or content within the working directory.
 * Two modes: search_content (grep for patterns in file contents) and search_files (find files by name/glob).
 */
export const search_project_tool = {
    name: 'search_project',
    description: 'Search for files or content within the working directory. Two modes: search_content (grep for patterns in file contents) and search_files (find files by name/glob).',
    enabled: true,
    executionSide: 'either' as const,
    inputSchema: {
        type: 'object',
        properties: {
            mode: {
                type: 'string',
                enum: ['search_content', 'search_files'],
                description: 'search_content greps file contents, search_files finds files by name'
            },
            pattern: {
                type: 'string',
                description: 'Search pattern (regex for content, glob for files)'
            },
            workingDirectory: {
                type: 'string',
                description: 'Directory to search in (defaults to current working directory)'
            },
            fileTypes: {
                type: 'array',
                items: { type: 'string' },
                description: "File extensions to filter (e.g., ['ts', 'js'])"
            },
            maxResults: {
                type: 'number',
                description: 'Maximum results to return (default: 50, max: 200)',
                default: 50,
                maximum: 200
            },
            caseSensitive: {
                type: 'boolean',
                description: 'Case-sensitive search (default: false)',
                default: false
            }
        },
        required: ['mode', 'pattern'],
        additionalProperties: false
    },
    examples: [
        {
            input: { mode: 'search_content', pattern: 'TODO', fileTypes: ['ts'] },
            description: 'Search for TODO comments in TypeScript files'
        },
        {
            input: { mode: 'search_files', pattern: '*.ts' },
            description: 'Find all TypeScript files'
        }
    ],
    metadata: {
        category: 'search',
        timeout: 15000
    },

    async handler(input: any, context: any): Promise<any> {
        try {
            const { mode, pattern, workingDirectory, fileTypes, maxResults: inputMax, caseSensitive } = input;

            // Validate pattern for command injection safety
            validatePattern(pattern);

            const dir = workingDirectory || process.cwd();
            const maxResults = Math.min(inputMax || 50, 200);
            const isCaseSensitive = caseSensitive ?? false;

            if (mode === 'search_content') {
                return handleSearchContent(pattern, dir, maxResults, isCaseSensitive, fileTypes);
            } else {
                return handleSearchFiles(pattern, dir, maxResults, fileTypes);
            }
        } catch (error: any) {
            logger.error('search_project failed:', error.message);
            return {
                error: error.message,
                success: false
            };
        }
    }
};

/** Exported array of search project tools for registration */
export const searchProjectTools = [search_project_tool];
