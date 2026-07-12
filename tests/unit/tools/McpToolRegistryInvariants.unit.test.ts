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
 * McpToolRegistryInvariants.unit.test.ts
 *
 * Structural invariants for the MCP tool set. These are the checks that would
 * have caught the whole class of defects found in the tool-system audit:
 *
 *  - a duplicate tool name silently shadowing another tool,
 *  - a tool file that exists, compiles, and is imported by nobody (LspTools sat
 *    orphaned for 476 lines and nine tools),
 *  - a name declared in the constants but resolving to no registered tool,
 *  - a tool missing the parts of its contract the model depends on.
 *
 * They are cheap, they run without a server, and each one fails with a message
 * that names the offending tool.
 */

import * as fs from 'fs';
import * as path from 'path';

// MetaTools reaches SystemLlmServiceManager, which drags in the socket layer and
// its whole service graph. None of that participates in the structural checks
// below, so it is stubbed out — the tool definitions are what is under test.
jest.mock('../../../src/server/socket/services/SystemLlmServiceManager', () => ({
    SystemLlmServiceManager: {
        getInstance: jest.fn(() => ({
            getServiceForChannel: jest.fn(() => null)
        }))
    }
}));

jest.mock('../../../src/server/socket/services/TaskService', () => ({
    TaskService: {
        getInstance: jest.fn(() => ({}))
    }
}));

import { allMxfMcpTools, mxfMcpToolRegistry } from '../../../src/server/mcp/tools/index';

/** Tool directories whose files must all be reachable from the tool index. */
const TOOL_DIRECTORIES = [
    path.resolve(__dirname, '../../../packages/core/src/protocols/mcp/tools'),
    path.resolve(__dirname, '../../../src/server/mcp/tools')
];

/**
 * Files in the tool directories that are not themselves tool modules.
 *
 * Keep this list short and justified. Anything added here is a file that is
 * exempt from the "must be reachable" rule, so an unjustified entry re-opens the
 * orphan hole this test exists to close.
 */
const NON_TOOL_FILES = new Set([
    // The index itself.
    'index.ts'
]);

/**
 * Read every tool module name in a directory (excluding subdirectories, which
 * hold implementation helpers rather than tool definitions).
 */
function listToolModules(directory: string): string[] {
    return fs
        .readdirSync(directory, { withFileTypes: true })
        .filter(entry => entry.isFile())
        .map(entry => entry.name)
        .filter(name => name.endsWith('.ts') && !name.endsWith('.d.ts'))
        .filter(name => !NON_TOOL_FILES.has(name));
}

describe('MCP tool set invariants', () => {
    describe('tool names are unique', () => {
        it('no two tools share a name', () => {
            const counts = new Map<string, number>();

            for (const tool of allMxfMcpTools) {
                counts.set(tool.name, (counts.get(tool.name) ?? 0) + 1);
            }

            const duplicates = Array.from(counts.entries())
                .filter(([, count]) => count > 1)
                .map(([name, count]) => `${name} (defined ${count} times)`);

            // A duplicate name is never benign: the Map built from this array keeps
            // the LAST definition, so which handler runs depends on array order,
            // while the model sees whichever description was registered first.
            expect(duplicates).toEqual([]);
        });

        it('the lookup registry holds every tool', () => {
            // If these differ, a name collided and the Map silently dropped one.
            expect(mxfMcpToolRegistry.size).toBe(allMxfMcpTools.length);
        });
    });

    describe('every tool file is reachable from the index', () => {
        it.each(TOOL_DIRECTORIES)('%s', (directory: string) => {
            const indexPath = path.join(directory, 'index.ts');
            const hasOwnIndex = fs.existsSync(indexPath);

            // packages/core's tool directory has no index — its tools are imported
            // directly by the server tool index. Read that one instead.
            const indexSource = fs.readFileSync(
                hasOwnIndex ? indexPath : path.resolve(__dirname, '../../../src/server/mcp/tools/index.ts'),
                'utf-8'
            );

            const modules = listToolModules(directory);
            const unreferenced = modules.filter(moduleName => {
                const stem = moduleName.replace(/\.ts$/, '');
                // The index imports either './Stem' (same directory) or
                // '@mxf-dev/core/protocols/mcp/tools/Stem' (core).
                return !indexSource.includes(`/${stem}'`) && !indexSource.includes(`'./${stem}'`);
            });

            // A tool file nobody imports is dead weight that still looks alive: it
            // compiles, it typechecks, and its tools are never offered to any agent.
            expect(unreferenced).toEqual([]);
        });
    });

    describe('every tool satisfies the McpToolDefinition contract', () => {
        it('has a name, a description, an input schema, and a handler', () => {
            const broken: string[] = [];

            for (const tool of allMxfMcpTools) {
                const t = tool as {
                    name?: unknown;
                    description?: unknown;
                    inputSchema?: unknown;
                    handler?: unknown;
                };

                if (typeof t.name !== 'string' || t.name.length === 0) {
                    broken.push(`${String(t.name)}: missing name`);
                    continue;
                }
                if (typeof t.description !== 'string' || t.description.length === 0) {
                    broken.push(`${t.name}: missing description`);
                }
                if (typeof t.inputSchema !== 'object' || t.inputSchema === null) {
                    broken.push(`${t.name}: missing inputSchema`);
                }
                // A tool with no handler cannot execute. LspTools shipped nine tool
                // schemas with zero handlers; had they ever been registered, an agent
                // would have been offered nine tools that could not run.
                if (typeof t.handler !== 'function') {
                    broken.push(`${t.name}: missing handler`);
                }
            }

            expect(broken).toEqual([]);
        });

        it('describes itself without marketing language', () => {
            // Tool descriptions are prompt text. "AI-powered" and "advanced" tell a
            // model nothing about what a tool does, and they invite it to expect
            // capabilities the implementation does not have — code_review_agent was
            // described as an "AI-powered code review agent" and was five regexes.
            const banned = /\b(AI-powered|advanced|blazing|seamless|robust|supercharge|10x|game-?chang)/i;

            const offenders = allMxfMcpTools
                .filter(tool => banned.test((tool as { description: string }).description))
                .map(tool => `${(tool as { name: string }).name}: "${(tool as { description: string }).description.slice(0, 80)}..."`);

            expect(offenders).toEqual([]);
        });
    });
});
