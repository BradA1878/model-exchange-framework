import { promises as fs, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import type { ExternalServerConfig } from './ExternalMcpServerManager.js';
import { getWorkspaceRoot } from '../security/McpToolPolicy.js';

const FILESYSTEM_PACKAGE = '@modelcontextprotocol/server-filesystem';
const requireFromModule = createRequire(import.meta.url);

/** Resolve the installed package without downloading or executing it. */
export const getFilesystemServerExecutable = (): { entryPoint: string; version: string } => {
    try {
        const packagePath = requireFromModule.resolve(`${FILESYSTEM_PACKAGE}/package.json`);
        const manifest: { version?: unknown; bin?: string | Record<string, unknown> } =
            JSON.parse(readFileSync(packagePath, 'utf8'));
        const bin = typeof manifest.bin === 'string'
            ? manifest.bin
            : manifest.bin?.['mcp-server-filesystem'];
        if (typeof bin !== 'string' || bin.length === 0 ||
            typeof manifest.version !== 'string' || manifest.version.length === 0) {
            throw new Error('package.json must declare a version and the filesystem executable');
        }
        const entryPoint = path.resolve(path.dirname(packagePath), bin);
        if (!statSync(entryPoint).isFile()) {
            throw new Error(`filesystem executable is not a file: ${entryPoint}`);
        }
        return { entryPoint, version: manifest.version };
    } catch (error) {
        throw new Error(
            `Cannot resolve installed ${FILESYSTEM_PACKAGE}: ${error instanceof Error ? error.message : String(error)}`
        );
    }
};

/** Read operator root templates; an unset variable leaves agent filesystems disabled. */
export const readAgentFilesystemRootTemplates = (): string[] | undefined => {
    const configured = process.env.MXF_AGENT_FILESYSTEM_ROOTS;
    if (configured === undefined) {
        return undefined;
    }
    if (getWorkspaceRoot() !== undefined) {
        throw new Error('MXF_AGENT_FILESYSTEM_ROOTS and MXF_WORKSPACE_ROOT cannot both be configured');
    }

    const templates = configured.split(',').map(template => template.trim());
    for (const template of templates) {
        if (template.length === 0 || template.includes('\0') || !path.isAbsolute(template)) {
            throw new Error('MXF_AGENT_FILESYSTEM_ROOTS must be a comma-separated list of non-empty absolute root templates');
        }
        if (/[{}]/.test(template.split('{agentId}').join(''))) {
            throw new Error(`Invalid filesystem root template ${JSON.stringify(template)}: only {agentId} placeholders are supported`);
        }
    }
    return templates;
};

/** Build an agent's filesystem command only after every allowed root is verified. */
export const getAgentFilesystemServerConfig = async (agentId: string): Promise<ExternalServerConfig | undefined> => {
    const templates = readAgentFilesystemRootTemplates();
    if (templates === undefined) {
        return undefined;
    }
    if (typeof agentId !== 'string' || agentId.trim().length === 0 ||
        agentId === '.' || agentId === '..' || /[/\\\0]/.test(agentId) || path.isAbsolute(agentId)) {
        throw new Error('Agent filesystem agentId must be a non-empty, single path component without separators, NUL, dot, or dotdot');
    }

    const roots: string[] = [];
    for (const template of templates) {
        // Joining literal pieces preserves valid '$' characters in agent IDs.
        const expandedRoot = template.split('{agentId}').join(agentId);
        try {
            const root = await fs.realpath(expandedRoot);
            if (!(await fs.stat(root)).isDirectory()) {
                throw new Error('root is not a directory');
            }
            roots.push(root);
        } catch (error) {
            throw new Error(
                `Invalid filesystem root ${JSON.stringify(expandedRoot)} for agent ${JSON.stringify(agentId)}: ` +
                `${error instanceof Error ? error.message : String(error)}`
            );
        }
    }

    const executable = getFilesystemServerExecutable();
    return {
        id: `filesystem:${agentId}`,
        name: `Filesystem Server (${agentId})`,
        version: executable.version,
        description: 'File operations scoped to the agent\'s configured directories',
        command: process.execPath,
        args: [executable.entryPoint, ...roots],
        autoStart: true,
        restartOnCrash: true,
        healthCheckInterval: 30000,
        maxRestartAttempts: 3,
        startupTimeout: 10000,
        environmentVariables: { NODE_ENV: 'production' }
    };
};
