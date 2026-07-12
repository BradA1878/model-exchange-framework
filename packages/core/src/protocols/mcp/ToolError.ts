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
 * ToolError.ts
 *
 * The single error type for MCP tool handlers.
 *
 * Before this existed, tool failures were encoded three different ways — a thrown
 * Error, a `{ success: false }` object, or a result whose `data` happened to hold
 * an `error` string — so callers could not tell a failure from a result. Handlers
 * written with `defineTool` throw a ToolError; the factory turns it into one
 * result envelope with `isError: true`.
 *
 * `code` is a stable, machine-readable classification. `message` is written for
 * the model that will read it: say what failed and what to do next.
 */

/**
 * Machine-readable failure classifications.
 *
 * These map to how a caller should react, not to where the failure happened:
 * - INVALID_INPUT: arguments did not satisfy the tool's schema or its own checks.
 *   The model should fix the arguments and retry.
 * - NOT_FOUND: a referenced entity (task, plan, file, server) does not exist.
 * - PERMISSION_DENIED: the operation was blocked by a security policy.
 * - PRECONDITION_FAILED: the system is not in a state where this can run
 *   (for example a required service is not initialized).
 * - EXECUTION_FAILED: the tool ran but the underlying operation failed.
 * - UPSTREAM_ERROR: a dependency the tool calls out to failed (external MCP
 *   server, HTTP API, database).
 * - NOT_IMPLEMENTED: the requested mode or option is not supported.
 */
export type ToolErrorCode =
    | 'INVALID_INPUT'
    | 'NOT_FOUND'
    | 'PERMISSION_DENIED'
    | 'PRECONDITION_FAILED'
    | 'EXECUTION_FAILED'
    | 'UPSTREAM_ERROR'
    | 'NOT_IMPLEMENTED';

/**
 * Serialized form of a ToolError, carried as the `data` of an error envelope.
 */
export interface ToolErrorData {
    /** Always true — lets a reader detect an error payload without shape sniffing */
    error: true;
    /** Stable classification */
    code: ToolErrorCode;
    /** Human/model-readable description of what failed */
    message: string;
    /** Name of the tool that failed */
    tool?: string;
    /** Structured, tool-specific context (never secrets) */
    details?: Record<string, unknown>;
}

/**
 * The error type thrown by tool handlers.
 *
 * Use the static constructors rather than `new ToolError(...)` where one fits —
 * they keep codes consistent across the ~184 tools.
 */
export class ToolError extends Error {
    /** Stable, machine-readable classification */
    public readonly code: ToolErrorCode;
    /** Structured context for the caller. Must not contain secrets. */
    public readonly details?: Record<string, unknown>;
    /**
     * The original error, when this ToolError wraps one.
     *
     * Set as a plain property rather than through the ES2022 `Error(msg, { cause })`
     * option, because the test tsconfig compiles against an older lib where that
     * constructor overload does not exist.
     */
    public readonly cause?: unknown;
    /** Tool name, set by defineTool when the error passes through the factory */
    public toolName?: string;

    constructor(
        code: ToolErrorCode,
        message: string,
        options?: { details?: Record<string, unknown>; cause?: unknown }
    ) {
        super(message);
        this.name = 'ToolError';
        this.code = code;
        this.details = options?.details;
        this.cause = options?.cause;

        // Restore the prototype chain — required for `instanceof` to work when
        // the compile target is ES5/ES2015 and Error is subclassed.
        Object.setPrototypeOf(this, ToolError.prototype);
    }

    /** Arguments did not satisfy the schema or the handler's own checks. */
    public static invalidInput(
        message: string,
        details?: Record<string, unknown>
    ): ToolError {
        return new ToolError('INVALID_INPUT', message, { details });
    }

    /** A referenced entity does not exist. */
    public static notFound(
        message: string,
        details?: Record<string, unknown>
    ): ToolError {
        return new ToolError('NOT_FOUND', message, { details });
    }

    /** Blocked by a security policy. */
    public static permissionDenied(
        message: string,
        details?: Record<string, unknown>
    ): ToolError {
        return new ToolError('PERMISSION_DENIED', message, { details });
    }

    /** The system is not in a state where this operation can run. */
    public static preconditionFailed(
        message: string,
        details?: Record<string, unknown>
    ): ToolError {
        return new ToolError('PRECONDITION_FAILED', message, { details });
    }

    /** The tool ran but the underlying operation failed. */
    public static executionFailed(
        message: string,
        options?: { details?: Record<string, unknown>; cause?: unknown }
    ): ToolError {
        return new ToolError('EXECUTION_FAILED', message, options);
    }

    /** A dependency the tool calls out to failed. */
    public static upstream(
        message: string,
        options?: { details?: Record<string, unknown>; cause?: unknown }
    ): ToolError {
        return new ToolError('UPSTREAM_ERROR', message, options);
    }

    /** The requested mode or option is not supported. */
    public static notImplemented(
        message: string,
        details?: Record<string, unknown>
    ): ToolError {
        return new ToolError('NOT_IMPLEMENTED', message, { details });
    }

    /**
     * Serialize to the payload carried in an error result envelope.
     */
    public toData(): ToolErrorData {
        return {
            error: true,
            code: this.code,
            message: this.message,
            ...(this.toolName ? { tool: this.toolName } : {}),
            ...(this.details ? { details: this.details } : {})
        };
    }
}

/**
 * Coerce any thrown value into a ToolError.
 *
 * A plain `throw new Error(...)` from a handler (or from a library it calls)
 * becomes an EXECUTION_FAILED ToolError with the original attached as `cause`,
 * so every failure leaves the factory in the same shape.
 */
export function toToolError(thrown: unknown): ToolError {
    if (thrown instanceof ToolError) {
        return thrown;
    }

    if (thrown instanceof Error) {
        return new ToolError('EXECUTION_FAILED', thrown.message, { cause: thrown });
    }

    return new ToolError('EXECUTION_FAILED', String(thrown), { cause: thrown });
}
