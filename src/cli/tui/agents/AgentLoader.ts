/**
 * MXF CLI TUI — Agent Loader
 *
 * Parses agent definition `.md` files into AgentDefinition objects.
 * Each `.md` file uses YAML frontmatter for config and the markdown body
 * as the system prompt — same format as Claude Code skills.
 *
 * Loading order:
 *   1. Built-in agents from `src/cli/tui/agents/built-in/`
 *   2. Custom agents from `~/.mxf/agents/`
 *   Custom agents with a matching `agentId` override built-in agents.
 *
 * @author Brad Anderson <BradA1878@pm.me>
 */

import * as fs from 'fs';
import * as path from 'path';
import type { AgentDefinition } from './AgentDefinitions';
import { logWarning, logInfo } from '../../utils/output';

/** Default config directory for user custom agents */
const DEFAULT_CUSTOM_AGENTS_DIR = path.join(
    process.env.HOME || process.env.USERPROFILE || '~',
    '.mxf',
    'agents',
);

/** Built-in agents directory (relative to this file) */
const BUILT_IN_DIR = path.join(__dirname, 'built-in');

/** Default values for optional frontmatter fields */
const DEFAULTS = {
    role: 'specialist' as const,
    color: 'white',
    temperature: 0.3,
    maxTokens: 8000,
    maxIterations: 20,
    description: '',
    reasoningEnabled: true,
    reasoningEffort: 'medium' as const,
};

/** Required frontmatter fields — file is invalid without these */
const REQUIRED_FIELDS = ['name', 'agentId', 'allowedTools'];

/**
 * Parse YAML-style frontmatter from a string.
 *
 * Handles flat key-value pairs and one level of array values (lines starting with "  - ").
 * This is intentionally lightweight — our frontmatter is simple and doesn't need
 * a full YAML parser.
 *
 * @param frontmatterStr - Raw frontmatter text (without --- delimiters)
 * @returns Parsed key-value record
 */
function parseFrontmatter(frontmatterStr: string): Record<string, any> {
    const result: Record<string, any> = {};
    const lines = frontmatterStr.split('\n');
    let currentKey: string | null = null;
    let currentArray: string[] | null = null;

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;

        // Array item: "  - value"
        if (trimmed.startsWith('- ') && currentKey && currentArray) {
            currentArray.push(trimmed.substring(2).trim());
            continue;
        }

        // Flush previous array if we're starting a new key
        if (currentKey && currentArray) {
            result[currentKey] = currentArray;
            currentKey = null;
            currentArray = null;
        }

        // Key-value pair: "key: value"
        const colonIndex = trimmed.indexOf(':');
        if (colonIndex === -1) continue;

        const key = trimmed.substring(0, colonIndex).trim();
        const value = trimmed.substring(colonIndex + 1).trim();

        if (!value) {
            // Empty value — start of an array block
            currentKey = key;
            currentArray = [];
        } else {
            // Scalar value — parse type
            result[key] = parseScalarValue(value);
        }
    }

    // Flush trailing array
    if (currentKey && currentArray) {
        result[currentKey] = currentArray;
    }

    return result;
}

/**
 * Parse a scalar value string into the appropriate type.
 * Handles numbers, booleans, and strings (strips surrounding quotes).
 */
function parseScalarValue(value: string): string | number | boolean {
    // Boolean
    if (value === 'true') return true;
    if (value === 'false') return false;

    // Number (integer or float)
    if (/^-?\d+(\.\d+)?$/.test(value)) {
        return parseFloat(value);
    }

    // String — strip quotes if present
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
        return value.slice(1, -1);
    }

    return value;
}

/**
 * Parse a single `.md` file into an AgentDefinition.
 *
 * File format:
 * ```
 * ---
 * name: Planner
 * agentId: mxf-planner
 * description: Orchestrator that decomposes tasks
 * role: orchestrator
 * color: white
 * temperature: 0.3
 * maxTokens: 8000
 * maxIterations: 20
 * allowedTools:
 *   - task_create_with_plan
 *   - messaging_send
 * ---
 *
 * System prompt content as markdown body...
 * ```
 *
 * @param filePath - Absolute path to the .md file
 * @returns Parsed AgentDefinition
 * @throws Error if required fields are missing
 */
export function parseAgentFile(filePath: string): AgentDefinition {
    const content = fs.readFileSync(filePath, 'utf-8');

    // Split on --- delimiters
    const parts = content.split(/^---\s*$/m);
    if (parts.length < 3) {
        throw new Error(
            `Invalid agent file format: ${filePath}. ` +
            'Expected YAML frontmatter between --- delimiters followed by system prompt body.',
        );
    }

    // parts[0] is empty (before first ---), parts[1] is frontmatter, parts[2+] is body
    const frontmatterStr = parts[1];
    const bodyParts = parts.slice(2);
    const systemPrompt = bodyParts.join('---').trim();

    if (!systemPrompt) {
        throw new Error(
            `Agent file has no system prompt body: ${filePath}. ` +
            'Add markdown content after the closing --- delimiter.',
        );
    }

    // Parse frontmatter
    const meta = parseFrontmatter(frontmatterStr);

    // Validate required fields
    for (const field of REQUIRED_FIELDS) {
        if (!meta[field]) {
            throw new Error(
                `Agent file ${filePath} is missing required field: ${field}. ` +
                `Required fields: ${REQUIRED_FIELDS.join(', ')}`,
            );
        }
    }

    // Validate allowedTools is an array
    if (!Array.isArray(meta.allowedTools)) {
        throw new Error(
            `Agent file ${filePath}: allowedTools must be a YAML array (lines starting with "  - ").`,
        );
    }

    return {
        agentId: meta.agentId as string,
        name: meta.name as string,
        description: (meta.description as string) || DEFAULTS.description,
        role: (meta.role as string) || DEFAULTS.role,
        systemPrompt,
        allowedTools: meta.allowedTools as string[],
        temperature: typeof meta.temperature === 'number' ? meta.temperature : DEFAULTS.temperature,
        maxTokens: typeof meta.maxTokens === 'number' ? meta.maxTokens : DEFAULTS.maxTokens,
        maxIterations: typeof meta.maxIterations === 'number' ? meta.maxIterations : DEFAULTS.maxIterations,
        color: (meta.color as string) || DEFAULTS.color,
        reasoningEnabled: typeof meta.reasoningEnabled === 'boolean' ? meta.reasoningEnabled : DEFAULTS.reasoningEnabled,
        reasoningEffort: (['low', 'medium', 'high'].includes(meta.reasoningEffort as string)
            ? meta.reasoningEffort as 'low' | 'medium' | 'high'
            : DEFAULTS.reasoningEffort),
    };
}

/**
 * Load all agent definitions from a directory of `.md` files.
 *
 * Reads every `.md` file in the directory, parses each one, and returns
 * the valid definitions. Invalid files are logged as warnings and skipped.
 *
 * @param dirPath - Absolute path to the directory
 * @returns Array of parsed AgentDefinition objects
 */
export function loadFromDirectory(dirPath: string): AgentDefinition[] {
    if (!fs.existsSync(dirPath)) {
        return [];
    }

    const files = fs.readdirSync(dirPath).filter(f => f.endsWith('.md'));
    const definitions: AgentDefinition[] = [];

    for (const file of files) {
        const filePath = path.join(dirPath, file);
        try {
            const definition = parseAgentFile(filePath);
            definitions.push(definition);
        } catch (error) {
            logWarning(`Skipping invalid agent file ${filePath}: ${error}`);
        }
    }

    return definitions;
}

/**
 * Load built-in agent definitions from `src/cli/tui/agents/built-in/`.
 *
 * @returns Array of built-in AgentDefinition objects
 */
export function loadBuiltIn(): AgentDefinition[] {
    return loadFromDirectory(BUILT_IN_DIR);
}

/**
 * Load user custom agent definitions from `~/.mxf/agents/`.
 *
 * @param customDir - Override custom agents directory (defaults to ~/.mxf/agents/)
 * @returns Array of custom AgentDefinition objects
 */
export function loadCustom(customDir?: string): AgentDefinition[] {
    const dir = customDir || DEFAULT_CUSTOM_AGENTS_DIR;
    return loadFromDirectory(dir);
}

/**
 * Load all agent definitions — built-in + custom.
 *
 * Custom agents with a matching `agentId` override the built-in agent.
 * This lets users customize a built-in agent by creating a file with the
 * same agentId in `~/.mxf/agents/`.
 *
 * @param customDir - Override custom agents directory
 * @returns Merged array of AgentDefinition objects (custom overrides built-in)
 */
export function loadAll(customDir?: string): AgentDefinition[] {
    const builtIn = loadBuiltIn();
    const custom = loadCustom(customDir);

    // Build a map starting with built-in, then override with custom
    const definitionMap = new Map<string, AgentDefinition>();
    for (const def of builtIn) {
        definitionMap.set(def.agentId, def);
    }
    for (const def of custom) {
        if (definitionMap.has(def.agentId)) {
            logInfo(`Custom agent overrides built-in: ${def.agentId}`);
        }
        definitionMap.set(def.agentId, def);
    }

    return Array.from(definitionMap.values());
}
