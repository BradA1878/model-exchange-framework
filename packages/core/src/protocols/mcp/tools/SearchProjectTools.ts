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
 * Search Project Tools
 *
 * Scoped content and filename search under MXF_WORKSPACE_ROOT. Content search
 * invokes rg/grep with an argv array (never a shell); filename search uses a
 * bounded filesystem walk and never starts a process.
 */

import { execFile } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import { promisify } from 'util';

import { Logger } from '../../../utils/Logger.js';
import { createGlobMatcher, MAX_GLOB_WILDCARDS } from '../../../utils/GlobMatcher.js';
import {
    buildShellChildEnv,
    resolveWorkspacePath
} from '../security/McpToolPolicy.js';

const logger = new Logger('info', 'SearchProjectTools', 'server');
const execFileAsync = promisify(execFile);

const DEFAULT_MAX_RESULTS = 50;
const MAX_RESULTS = 200;
const MAX_PATTERN_LENGTH = 512;
const MAX_FILE_TYPES = 20;
const MAX_EXTENSION_LENGTH = 16;
const MAX_SEARCH_OUTPUT_BYTES = 2 * 1024 * 1024;
const MAX_SCANNED_ENTRIES = 50_000;
const MAX_DIRECTORY_DEPTH = 50;
const EXCLUDED_DIRECTORIES = new Set(['.git', 'node_modules', 'dist']);

type SearchMode = 'search_content' | 'search_files';

export interface SearchProjectInput {
    mode: SearchMode;
    pattern: string;
    workingDirectory?: string;
    fileTypes?: string[];
    maxResults?: number;
    caseSensitive?: boolean;
}

interface ProcessFailure extends Error {
    code?: string | number;
    status?: number;
    stdout?: string;
}

function validatePattern(pattern: unknown): asserts pattern is string {
    if (typeof pattern !== 'string' || pattern.length === 0) {
        throw new Error('pattern must be a non-empty string');
    }
    if (pattern.length > MAX_PATTERN_LENGTH) {
        throw new Error(`pattern must be at most ${MAX_PATTERN_LENGTH} characters`);
    }
    if ([...pattern].some(character => {
        const codePoint = character.codePointAt(0) ?? 0;
        return codePoint <= 0x1f || codePoint === 0x7f;
    })) {
        throw new Error('pattern must not contain control characters');
    }
}

function validateFileTypes(value: unknown): string[] {
    if (value === undefined) {
        return [];
    }
    if (!Array.isArray(value) || value.length > MAX_FILE_TYPES) {
        throw new Error(`fileTypes must be an array of at most ${MAX_FILE_TYPES} extensions`);
    }

    const normalized = value.map((extension, index) => {
        if (typeof extension !== 'string') {
            throw new Error(`fileTypes[${index}] must be a string`);
        }
        const withoutDot = extension.startsWith('.') ? extension.slice(1) : extension;
        if (
            withoutDot.length === 0 ||
            withoutDot.length > MAX_EXTENSION_LENGTH ||
            !/^[A-Za-z0-9][A-Za-z0-9_+-]*$/u.test(withoutDot)
        ) {
            throw new Error(
                `fileTypes[${index}] is not a valid file extension (maximum ${MAX_EXTENSION_LENGTH} characters)`
            );
        }
        return withoutDot.toLowerCase();
    });

    return [...new Set(normalized)];
}

function validateMaxResults(value: unknown): number {
    if (value === undefined) {
        return DEFAULT_MAX_RESULTS;
    }
    if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > MAX_RESULTS) {
        throw new Error(`maxResults must be an integer between 1 and ${MAX_RESULTS}`);
    }
    return value as number;
}

function isNoMatch(error: ProcessFailure): boolean {
    return error.code === 1 || error.status === 1;
}

function isCommandMissing(error: ProcessFailure): boolean {
    return error.code === 'ENOENT' || error.message.includes('ENOENT');
}

function parseContentMatches(output: string, maxResults: number): {
    matches: Array<{ file: string; line: number; text: string }>;
    totalFound: number;
    truncated: boolean;
    success: true;
} {
    const lines = output.split('\n').filter(line => line.trim().length > 0);
    const matches = lines.slice(0, maxResults).map(line => {
        const firstColon = line.indexOf(':');
        const secondColon = line.indexOf(':', firstColon + 1);

        if (firstColon < 0 || secondColon < 0) {
            return { file: line, line: 0, text: '' };
        }

        let text = line.slice(secondColon + 1);
        if (text.length > 200) {
            text = `${text.slice(0, 200)}...`;
        }
        return {
            file: line.slice(0, firstColon),
            line: Number.parseInt(line.slice(firstColon + 1, secondColon), 10) || 0,
            text
        };
    });

    return {
        matches,
        totalFound: lines.length,
        truncated: lines.length > maxResults,
        success: true
    };
}

async function runContentSearch(
    pattern: string,
    directory: string,
    maxResults: number,
    caseSensitive: boolean,
    fileTypes: string[]
): Promise<ReturnType<typeof parseContentMatches>> {
    const rgArgs = [
        '--line-number',
        '--no-heading',
        '--color', 'never',
        '--max-count', String(maxResults),
        ...(caseSensitive ? [] : ['--ignore-case']),
        ...fileTypes.flatMap(extension => ['--glob', `*.${extension}`]),
        '--glob', '!.git/**',
        '--glob', '!node_modules/**',
        '--glob', '!dist/**',
        '--', pattern, '.'
    ];

    try {
        const result = await execFileAsync('rg', rgArgs, {
            cwd: directory,
            env: buildShellChildEnv(),
            encoding: 'utf-8',
            timeout: 15_000,
            maxBuffer: MAX_SEARCH_OUTPUT_BYTES
        });
        return parseContentMatches(result.stdout, maxResults);
    } catch (rawError) {
        const rgError = rawError as ProcessFailure;
        if (isNoMatch(rgError)) {
            return parseContentMatches('', maxResults);
        }
        if (!isCommandMissing(rgError)) {
            throw rgError;
        }
    }

    const grepArgs = [
        '--recursive',
        '--line-number',
        '--binary-files=without-match',
        ...(caseSensitive ? [] : ['--ignore-case']),
        ...fileTypes.map(extension => `--include=*.${extension}`),
        '--exclude-dir=.git',
        '--exclude-dir=node_modules',
        '--exclude-dir=dist',
        '--', pattern, '.'
    ];

    try {
        const result = await execFileAsync('grep', grepArgs, {
            cwd: directory,
            env: buildShellChildEnv(),
            encoding: 'utf-8',
            timeout: 15_000,
            maxBuffer: MAX_SEARCH_OUTPUT_BYTES
        });
        return parseContentMatches(result.stdout, maxResults);
    } catch (rawError) {
        const grepError = rawError as ProcessFailure;
        if (isNoMatch(grepError)) {
            return parseContentMatches('', maxResults);
        }
        throw grepError;
    }
}

async function searchFiles(
    pattern: string,
    directory: string,
    maxResults: number,
    caseSensitive: boolean,
    fileTypes: string[]
): Promise<{ files: string[]; totalFound: number; truncated: boolean; success: true }> {
    // Compiled without a regular expression: a pattern cannot make matching
    // backtrack for seconds per entry while this walk holds the event loop.
    const matcher = createGlobMatcher(pattern, caseSensitive);
    const extensionSet = new Set(fileTypes);
    const files: string[] = [];
    const pending: Array<{ absolutePath: string; relativePath: string; depth: number }> = [
        { absolutePath: directory, relativePath: '', depth: 0 }
    ];
    let totalFound = 0;
    let scannedEntries = 0;
    let scanLimitReached = false;

    while (pending.length > 0) {
        const current = pending.pop()!;
        const entries = await fs.readdir(current.absolutePath, { withFileTypes: true });

        for (const entry of entries) {
            scannedEntries += 1;
            if (scannedEntries > MAX_SCANNED_ENTRIES) {
                scanLimitReached = true;
                pending.length = 0;
                break;
            }

            const relativePath = current.relativePath
                ? `${current.relativePath}/${entry.name}`
                : entry.name;

            if (entry.isSymbolicLink()) {
                continue;
            }
            if (entry.isDirectory()) {
                if (
                    !EXCLUDED_DIRECTORIES.has(entry.name) &&
                    current.depth < MAX_DIRECTORY_DEPTH
                ) {
                    pending.push({
                        absolutePath: path.join(current.absolutePath, entry.name),
                        relativePath,
                        depth: current.depth + 1
                    });
                }
                continue;
            }
            if (!entry.isFile()) {
                continue;
            }

            const extension = path.extname(entry.name).slice(1).toLowerCase();
            const extensionMatches = extensionSet.size === 0 || extensionSet.has(extension);
            // A pattern with a separator addresses the path under the search
            // directory; one without addresses the file name.
            const patternMatches = matcher.test(matcher.matchesPath ? relativePath : entry.name);
            if (!extensionMatches || !patternMatches) {
                continue;
            }

            totalFound += 1;
            if (files.length < maxResults) {
                files.push(relativePath);
            }
        }
    }

    return {
        files,
        totalFound,
        truncated: scanLimitReached || totalFound > maxResults,
        success: true
    };
}

export const search_project_tool = {
    name: 'search_project',
    description: 'Search for files or content under MXF_WORKSPACE_ROOT without invoking a shell.',
    enabled: true,
    executionSide: 'either' as const,
    inputSchema: {
        type: 'object',
        properties: {
            mode: {
                type: 'string',
                enum: ['search_content', 'search_files'],
                description: 'search_content searches file contents; search_files finds filenames'
            },
            pattern: {
                type: 'string',
                minLength: 1,
                maxLength: MAX_PATTERN_LENGTH,
                description: 'Regular expression for content search, or a glob for filename search: ' +
                    '* within one segment, ? for one character, ** as a whole segment for any depth ' +
                    `(at most ${MAX_GLOB_WILDCARDS} wildcards)`
            },
            workingDirectory: {
                type: 'string',
                description: 'Directory under MXF_WORKSPACE_ROOT (defaults to MXF_WORKSPACE_ROOT)'
            },
            fileTypes: {
                type: 'array',
                maxItems: MAX_FILE_TYPES,
                items: { type: 'string', minLength: 1, maxLength: MAX_EXTENSION_LENGTH + 1 },
                description: "File extensions to filter (for example ['ts', 'js'])"
            },
            maxResults: {
                type: 'integer',
                description: `Maximum results to return (default: ${DEFAULT_MAX_RESULTS}, max: ${MAX_RESULTS})`,
                default: DEFAULT_MAX_RESULTS,
                minimum: 1,
                maximum: MAX_RESULTS
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
        timeout: 15_000
    },

    async handler(input: SearchProjectInput): Promise<unknown> {
        try {
            if (input.mode !== 'search_content' && input.mode !== 'search_files') {
                throw new Error('mode must be search_content or search_files');
            }
            validatePattern(input.pattern);
            const fileTypes = validateFileTypes(input.fileTypes);
            const maxResults = validateMaxResults(input.maxResults);
            if (input.caseSensitive !== undefined && typeof input.caseSensitive !== 'boolean') {
                throw new Error('caseSensitive must be a boolean');
            }

            const directory = resolveWorkspacePath(
                input.workingDirectory,
                'search_project workingDirectory'
            );
            const stat = await fs.stat(directory);
            if (!stat.isDirectory()) {
                throw new Error('search_project workingDirectory must be a directory');
            }

            return input.mode === 'search_content'
                ? await runContentSearch(
                    input.pattern,
                    directory,
                    maxResults,
                    input.caseSensitive ?? false,
                    fileTypes
                )
                : await searchFiles(
                    input.pattern,
                    directory,
                    maxResults,
                    input.caseSensitive ?? false,
                    fileTypes
                );
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            logger.error('search_project failed', { error: message });
            return { error: message, success: false };
        }
    }
};

export const searchProjectTools = [search_project_tool];
