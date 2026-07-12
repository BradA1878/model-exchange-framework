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
 * defineTool.ts
 *
 * The one way to declare an MCP tool.
 *
 * Tools used to hand-roll their own scaffolding: each file repeated its own
 * try/catch, its own `error instanceof Error ? error.message : String(error)`,
 * its own logger call, and its own result wrapper. Four different result shapes
 * emerged across the tool set, so there was no reliable way to tell that a tool
 * had failed.
 *
 * `defineTool` owns that scaffolding. A tool supplies a schema and a `run`
 * function that returns a value or throws a {@link ToolError}; the factory:
 *
 *   1. validates the execution context (agentId / channelId / requestId),
 *   2. validates the input against `inputSchema` with AJV on every entry path —
 *      not just the socket path, so a direct handler call is checked too,
 *   3. runs `run` inside a single try/catch,
 *   4. returns one envelope: `{ content: { type, data }, isError, metadata }`.
 *
 * `isError` is explicit (MCP-spec style). Callers test that flag; they never
 * shape-sniff the payload.
 */

import { Ajv, type ValidateFunction } from 'ajv';
import * as ajvFormatsModule from 'ajv-formats';
import type { FormatsPluginOptions } from 'ajv-formats';

import { Logger } from '../../utils/Logger.js';
import { McpToolDefinition, McpToolHandlerResult, McpToolResultContent } from './McpServerTypes.js';
import { McpToolExample } from './McpToolSchema.js';
import { ToolError, ToolErrorData, toToolError } from './ToolError.js';

// ajv-formats ships CJS (`module.exports = plugin` with a `.default` mirror), so
// the import's shape differs between the NodeNext build and ts-jest's node10
// resolver. Both branches below are the identical plugin function. This mirrors
// the handling in McpToolSchema.ts.
type AddFormatsPlugin = (ajv: Ajv, opts?: FormatsPluginOptions) => Ajv;
const ajvFormatsAny = ajvFormatsModule as { default?: unknown };
const addFormats: AddFormatsPlugin = (
    typeof ajvFormatsAny.default === 'function' ? ajvFormatsAny.default : ajvFormatsModule
) as AddFormatsPlugin;

const logger = new Logger('info', 'defineTool', 'server');

/**
 * Shared AJV instance for input validation.
 *
 * `strict: false` because tool schemas carry annotation keywords AJV does not
 * know (for example `default` inside nested properties, and MXF's own metadata).
 * `coerceTypes` is deliberately OFF: an LLM sending `"5"` where the schema says
 * `number` is a real mistake worth surfacing, not one to paper over.
 */
const ajv = new Ajv({
    allErrors: true,
    strict: false,
    validateFormats: true,
    coerceTypes: false,
    useDefaults: true
});
addFormats(ajv);

/**
 * Content type used for structured tool results.
 */
const JSON_CONTENT_TYPE = 'application/json';

/**
 * The single result shape every `defineTool` tool returns.
 *
 * Extends the framework's McpToolHandlerResult, so these tools drop into the
 * existing registries and socket paths unchanged, and adds the explicit
 * `isError` flag those shapes were missing.
 */
export interface ToolResultEnvelope<TData = unknown> extends McpToolHandlerResult {
    /** Result payload. `data` holds the tool's own output, or a ToolErrorData on failure. */
    content: McpToolResultContent & { data: TData | ToolErrorData };
    /** True when the tool failed. Callers branch on this — never on payload shape. */
    isError: boolean;
    /** Execution metadata (tool name, timing, and the error code when isError). */
    metadata: {
        toolName: string;
        executedAt: number;
        durationMs: number;
        /** Present only when isError is true */
        errorCode?: string;
        [key: string]: unknown;
    };
}

/**
 * Context handed to a tool's `run` function.
 *
 * agentId, channelId and requestId are always present — `defineTool` rejects the
 * call before `run` is reached if any is missing, so `run` never has to check.
 */
export interface ToolRunContext {
    /** Agent that invoked the tool. Always present. */
    agentId: string;
    /** Channel the invocation belongs to. Always present. */
    channelId: string;
    /** Correlation id for events and logs. Always present. */
    requestId: string;
    /** Any extra context the caller attached. */
    data?: Record<string, unknown>;
}

/**
 * Options accepted by {@link defineTool}.
 */
export interface DefineToolOptions<TInput, TOutput> {
    /** Tool name exposed to the model. Must be unique across the whole tool set. */
    name: string;
    /**
     * What the tool does, written for the model that decides whether to call it.
     * This is prompt text: state the behavior plainly, and describe only what the
     * implementation actually does.
     */
    description: string;
    /** Category used for grouping and filtering. */
    category: string;
    /** JSON Schema for the tool's input. Enforced on every entry path. */
    inputSchema: Record<string, any>;
    /**
     * The tool's behavior. Return the payload to send back; throw a ToolError to
     * fail. Do not catch-and-wrap — the factory owns error handling.
     */
    run: (input: TInput, context: ToolRunContext) => Promise<TOutput> | TOutput;
    /** Optional worked examples surfaced in tool documentation. */
    examples?: McpToolExample[];
    /** Where the tool may execute. Defaults to 'server'. */
    executionSide?: 'server' | 'client' | 'either';
    /** Whether the tool is enabled. Defaults to true. */
    enabled?: boolean;
    /** Extra metadata merged into the registered tool definition. */
    metadata?: Record<string, any>;
}

/**
 * A tool produced by {@link defineTool}.
 *
 * Structurally a McpToolDefinition, so it registers exactly like a hand-written
 * tool, plus the `category` it was declared with.
 */
export interface DefinedMcpTool extends McpToolDefinition {
    category: string;
}

/**
 * Format AJV errors into one line a model can act on.
 */
function formatSchemaErrors(validate: ValidateFunction): string {
    const errors = validate.errors ?? [];
    if (errors.length === 0) {
        return 'input did not match the tool schema';
    }

    return errors
        .map(err => {
            // instancePath is '' for a root-level failure (e.g. a missing required
            // property); name that root explicitly rather than printing an empty path.
            const where = err.instancePath ? err.instancePath.replace(/^\//, '') : 'input';
            return `${where} ${err.message}`;
        })
        .join('; ');
}

/**
 * Declare an MCP tool.
 *
 * @example
 * export const gitStatusTool = defineTool({
 *     name: 'git_status',
 *     category: TOOL_CATEGORIES.VERSION_CONTROL,
 *     description: 'Report staged, modified and untracked files by running `git status`.',
 *     inputSchema: {
 *         type: 'object',
 *         properties: { workingDirectory: { type: 'string' } }
 *     },
 *     run: async (input, context) => {
 *         const result = await runGit(['status'], input.workingDirectory);
 *         if (result.exitCode !== 0) {
 *             throw ToolError.executionFailed(`git status failed: ${result.stderr}`);
 *         }
 *         return { files: parse(result.stdout) };
 *     }
 * });
 */
export function defineTool<TInput = Record<string, any>, TOutput = unknown>(
    options: DefineToolOptions<TInput, TOutput>
): DefinedMcpTool {
    const {
        name,
        description,
        category,
        inputSchema,
        run,
        examples,
        executionSide = 'server',
        enabled = true,
        metadata = {}
    } = options;

    // Fail at module load, not at call time, if a tool is declared wrong. A tool
    // with no name or no schema cannot be registered or described to a model.
    if (!name || typeof name !== 'string') {
        throw new Error('defineTool: name must be a non-empty string');
    }
    if (!description || typeof description !== 'string') {
        throw new Error(`defineTool(${name}): description must be a non-empty string`);
    }
    if (!category || typeof category !== 'string') {
        throw new Error(`defineTool(${name}): category must be a non-empty string`);
    }
    if (!inputSchema || typeof inputSchema !== 'object') {
        throw new Error(`defineTool(${name}): inputSchema must be an object`);
    }
    if (typeof run !== 'function') {
        throw new Error(`defineTool(${name}): run must be a function`);
    }

    // Compile the schema once, at declaration. A schema AJV cannot compile is a
    // bug in the tool, and it surfaces here rather than on first invocation.
    let validateInput: ValidateFunction;
    try {
        validateInput = ajv.compile(inputSchema);
    } catch (error) {
        throw new Error(
            `defineTool(${name}): inputSchema failed to compile: ` +
            `${error instanceof Error ? error.message : String(error)}`
        );
    }

    const handler = async (
        rawInput: unknown,
        rawContext: unknown
    ): Promise<ToolResultEnvelope<TOutput>> => {
        const startedAt = Date.now();

        const fail = (toolError: ToolError): ToolResultEnvelope<TOutput> => {
            toolError.toolName = name;

            logger.error(`Tool ${name} failed [${toolError.code}]: ${toolError.message}`);

            return {
                content: {
                    type: JSON_CONTENT_TYPE,
                    data: toolError.toData()
                },
                isError: true,
                metadata: {
                    toolName: name,
                    executedAt: Date.now(),
                    durationMs: Date.now() - startedAt,
                    errorCode: toolError.code
                }
            };
        };

        // ── 1. Validate the execution context ──────────────────────────────
        // agentId and channelId gate every downstream security and memory
        // decision. A missing one is a wiring bug — never default it.
        const context = rawContext as Partial<ToolRunContext> | undefined;

        if (!context || typeof context !== 'object') {
            return fail(ToolError.invalidInput(
                `Tool ${name} was called without an execution context. ` +
                `agentId, channelId and requestId are required.`
            ));
        }
        if (typeof context.agentId !== 'string' || context.agentId.length === 0) {
            return fail(ToolError.invalidInput(
                `Tool ${name} was called without a valid agentId. ` +
                `agentId is required for all MCP tool execution.`
            ));
        }
        if (typeof context.channelId !== 'string' || context.channelId.length === 0) {
            return fail(ToolError.invalidInput(
                `Tool ${name} was called without a valid channelId. ` +
                `channelId is required for all MCP tool execution.`
            ));
        }
        if (typeof context.requestId !== 'string' || context.requestId.length === 0) {
            return fail(ToolError.invalidInput(
                `Tool ${name} was called without a valid requestId. ` +
                `requestId is required to correlate tool events.`
            ));
        }

        const runContext: ToolRunContext = {
            agentId: context.agentId,
            channelId: context.channelId,
            requestId: context.requestId,
            data: context.data
        };

        // ── 2. Validate the input against the schema ───────────────────────
        // AJV runs here so a direct handler call is checked exactly like a call
        // arriving over the socket. `useDefaults` fills declared defaults in place.
        const input = (rawInput ?? {}) as TInput;

        if (!validateInput(input)) {
            return fail(ToolError.invalidInput(
                `Invalid arguments for ${name}: ${formatSchemaErrors(validateInput)}`,
                { schemaErrors: validateInput.errors ?? [] }
            ));
        }

        // ── 3. Run the tool ────────────────────────────────────────────────
        try {
            const output = await run(input, runContext);

            return {
                content: {
                    type: JSON_CONTENT_TYPE,
                    data: output
                },
                isError: false,
                metadata: {
                    toolName: name,
                    executedAt: Date.now(),
                    durationMs: Date.now() - startedAt
                }
            };
        } catch (error) {
            return fail(toToolError(error));
        }
    };

    return {
        name,
        description,
        category,
        inputSchema,
        enabled,
        executionSide,
        examples,
        metadata: {
            ...metadata,
            category
        },
        handler: handler as McpToolDefinition['handler']
    };
}

/**
 * Type guard: did this tool call fail?
 *
 * Use this instead of inspecting the payload. Results produced by `defineTool`
 * always carry an explicit `isError`.
 */
export function isToolError(result: unknown): result is ToolResultEnvelope & { isError: true } {
    return (
        typeof result === 'object' &&
        result !== null &&
        'isError' in result &&
        (result as { isError: unknown }).isError === true
    );
}
