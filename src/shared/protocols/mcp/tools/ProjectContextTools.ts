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
 * Project Context Tools
 *
 * MCP tool for scanning a working directory to determine project type, file tree summary,
 * git info, and detected config files. Gives agents a one-shot way to orient themselves
 * in a working directory.
 */

import { McpToolDefinition, McpToolHandlerContext, McpToolHandlerResult } from '../McpServerTypes';
import { McpToolInput } from '../IMcpClient';
import { Logger } from '../../../utils/Logger';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

const logger = new Logger('info', 'ProjectContextTools', 'server');

/** Manifest files mapped to project type and language */
const MANIFEST_MAP: Record<string, { projectType: string; language: string }> = {
    'package.json': { projectType: 'node', language: 'javascript/typescript' },
    'Cargo.toml': { projectType: 'rust', language: 'rust' },
    'pyproject.toml': { projectType: 'python', language: 'python' },
    'go.mod': { projectType: 'go', language: 'go' },
    'pom.xml': { projectType: 'java-maven', language: 'java' },
    'Gemfile': { projectType: 'ruby', language: 'ruby' },
    '.sln': { projectType: 'dotnet', language: 'csharp' },
    'Makefile': { projectType: 'make', language: 'unknown' },
    'CMakeLists.txt': { projectType: 'cmake', language: 'c/c++' },
};

/** Config files to detect */
const CONFIG_FILES = [
    '.env',
    'tsconfig.json',
    'Dockerfile',
    '.github/',
    'README.md',
    '.gitignore',
    '.eslintrc',
    '.eslintrc.js',
    '.eslintrc.json',
    '.eslintrc.yml',
    '.eslintrc.yaml',
    'jest.config.js',
    'jest.config.ts',
    'jest.config.json',
    'vite.config.js',
    'vite.config.ts',
];

/**
 * Parse basic manifest info from file contents.
 * Extracts name, version, and dependency count where possible.
 */
function parseManifestInfo(filename: string, content: string): Record<string, any> {
    const info: Record<string, any> = {};

    try {
        if (filename === 'package.json') {
            const pkg = JSON.parse(content);
            info.name = pkg.name;
            info.version = pkg.version;
            const deps = Object.keys(pkg.dependencies || {}).length;
            const devDeps = Object.keys(pkg.devDependencies || {}).length;
            info.dependencyCount = deps + devDeps;
            info.dependencies = deps;
            info.devDependencies = devDeps;
        } else if (filename === 'Cargo.toml') {
            // Basic TOML extraction for name/version
            const nameMatch = content.match(/^name\s*=\s*"(.+?)"/m);
            const versionMatch = content.match(/^version\s*=\s*"(.+?)"/m);
            if (nameMatch) info.name = nameMatch[1];
            if (versionMatch) info.version = versionMatch[1];
            // Count [dependencies] entries
            const depSection = content.match(/\[dependencies\]([\s\S]*?)(\[|$)/);
            if (depSection) {
                const depLines = depSection[1].split('\n').filter(l => l.trim() && !l.trim().startsWith('#'));
                info.dependencyCount = depLines.length;
            }
        } else if (filename === 'pyproject.toml') {
            const nameMatch = content.match(/^name\s*=\s*"(.+?)"/m);
            const versionMatch = content.match(/^version\s*=\s*"(.+?)"/m);
            if (nameMatch) info.name = nameMatch[1];
            if (versionMatch) info.version = versionMatch[1];
        } else if (filename === 'go.mod') {
            const moduleMatch = content.match(/^module\s+(.+)/m);
            if (moduleMatch) info.name = moduleMatch[1].trim();
            const goMatch = content.match(/^go\s+(.+)/m);
            if (goMatch) info.goVersion = goMatch[1].trim();
            // Count require lines
            const requireBlock = content.match(/require\s*\(([\s\S]*?)\)/);
            if (requireBlock) {
                const reqLines = requireBlock[1].split('\n').filter(l => l.trim() && !l.trim().startsWith('//'));
                info.dependencyCount = reqLines.length;
            }
        }
    } catch (err) {
        // Manifest parsing is best-effort; return whatever we got
        logger.debug('Failed to parse manifest details', { filename, error: String(err) });
    }

    return info;
}

/**
 * Gather git repository information for a directory.
 * Returns null if the directory is not a git repository.
 */
function getGitInfo(dir: string): Record<string, any> | null {
    try {
        const branch = execSync(`git -C "${dir}" rev-parse --abbrev-ref HEAD`, { encoding: 'utf-8' }).trim();
        const logOutput = execSync(`git -C "${dir}" log --oneline -5`, { encoding: 'utf-8' }).trim();
        const recentCommits = logOutput ? logOutput.split('\n') : [];
        const statusOutput = execSync(`git -C "${dir}" status --porcelain`, { encoding: 'utf-8' }).trim();
        const dirtyLines = statusOutput ? statusOutput.split('\n').filter(l => l.trim()) : [];
        const dirtyCount = dirtyLines.length;

        return {
            branch,
            recentCommits,
            dirtyCount,
            isDirty: dirtyCount > 0,
        };
    } catch {
        // Not a git directory or git not available
        return null;
    }
}

/**
 * Detect which config files exist in the directory.
 */
function detectConfigFiles(dir: string): string[] {
    const found: string[] = [];

    for (const configFile of CONFIG_FILES) {
        const fullPath = path.join(dir, configFile);
        try {
            // For directory entries (ending with /), check if it's a directory
            if (configFile.endsWith('/')) {
                const stat = fs.statSync(fullPath.slice(0, -1));
                if (stat.isDirectory()) {
                    found.push(configFile);
                }
            } else {
                fs.accessSync(fullPath, fs.constants.F_OK);
                found.push(configFile);
            }
        } catch {
            // File doesn't exist, skip
        }
    }

    return found;
}

/**
 * Scan a working directory to get project type, file tree summary, git info,
 * and detected config files. One call orients an agent in the project.
 */
export const project_context_tool: McpToolDefinition = {
    name: 'project_context',
    description: 'Scan the working directory to get project type, file tree summary, git info, and detected config files. One call orients you in the project.',
    enabled: true,
    executionSide: 'either' as const,
    inputSchema: {
        type: 'object',
        properties: {
            workingDirectory: {
                type: 'string',
                description: 'Absolute path to the directory to scan. Defaults to the current working directory if not provided.',
            },
        },
        additionalProperties: false,
    },
    examples: [
        {
            input: {},
            description: 'Scan the current working directory',
        },
        {
            input: { workingDirectory: '/home/user/my-project' },
            description: 'Scan a specific project directory',
        },
    ],
    metadata: {
        category: 'project',
        timeout: 10000,
    },

    async handler(input: McpToolInput, context: McpToolHandlerContext): Promise<McpToolHandlerResult> {
        const dir = (input as any).workingDirectory || process.cwd();
        const resolvedDir = path.resolve(dir);

        logger.info('Scanning project context', { directory: resolvedDir });

        // Validate directory exists
        try {
            const stat = fs.statSync(resolvedDir);
            if (!stat.isDirectory()) {
                return {
                    content: {
                        type: 'application/json',
                        data: { error: `Path is not a directory: ${resolvedDir}` },
                    },
                };
            }
        } catch {
            return {
                content: {
                    type: 'application/json',
                    data: { error: `Directory does not exist: ${resolvedDir}` },
                },
            };
        }

        // 1. List top-level entries, capped at 30
        const entries = fs.readdirSync(resolvedDir, { withFileTypes: true });
        const files: string[] = [];
        const directories: string[] = [];
        let totalEntries = 0;

        for (const entry of entries) {
            totalEntries++;
            if (files.length + directories.length < 30) {
                if (entry.isDirectory()) {
                    directories.push(entry.name + '/');
                } else {
                    files.push(entry.name);
                }
            }
        }

        const fileTree = {
            directory: resolvedDir,
            files,
            directories,
            totalEntries,
            truncated: totalEntries > 30,
        };

        // 2. Detect project type from manifest files
        let projectType = 'unknown';
        let language = 'unknown';
        let manifest: Record<string, any> | null = null;
        let manifestFile: string | null = null;

        for (const [filename, typeInfo] of Object.entries(MANIFEST_MAP)) {
            const manifestPath = path.join(resolvedDir, filename);
            try {
                fs.accessSync(manifestPath, fs.constants.F_OK);
                projectType = typeInfo.projectType;
                language = typeInfo.language;
                manifestFile = filename;
                break;
            } catch {
                // File doesn't exist, try next
            }
        }

        // 3. If manifest found, read and parse basic info
        if (manifestFile) {
            try {
                const manifestPath = path.join(resolvedDir, manifestFile);
                const content = fs.readFileSync(manifestPath, 'utf-8').slice(0, 500);
                const parsed = parseManifestInfo(manifestFile, content);
                manifest = {
                    file: manifestFile,
                    ...parsed,
                };
            } catch (err) {
                logger.debug('Failed to read manifest file', { manifestFile, error: String(err) });
                manifest = { file: manifestFile, error: 'Failed to read manifest' };
            }
        }

        // 4. Git info
        const git = getGitInfo(resolvedDir);

        // 5. Detect config files
        const configFiles = detectConfigFiles(resolvedDir);

        logger.info('Project context scan complete', {
            directory: resolvedDir,
            projectType,
            language,
            fileCount: files.length,
            dirCount: directories.length,
            hasGit: !!git,
            configFilesFound: configFiles.length,
        });

        return {
            content: {
                type: 'application/json',
                data: {
                    projectType,
                    language,
                    manifest,
                    fileTree,
                    git,
                    configFiles,
                },
            },
        };
    },
};

/** All project context tools */
export const projectContextTools = [project_context_tool];
