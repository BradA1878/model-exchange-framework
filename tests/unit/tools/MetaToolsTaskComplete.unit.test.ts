/**
 * Unit tests for task_complete / task_complete_bridge summary coercion.
 *
 * The tool's stated contract is lenient ("accept any reasonable input",
 * required: []), but the schema used to declare summary/result as strict
 * strings, so JSON-Schema validation rejected object-valued summaries
 * before the forgiving handler could run. Cheap-tier models routinely
 * summarize their work as structured data; the schema now admits
 * string | object for summary/result and the handlers stringify objects
 * so everything downstream of handleTaskCompletion still receives a string.
 *
 * Fail-fast is preserved: numbers, booleans, arrays, and null are still
 * rejected by the schema — only the object form the handler was written
 * to tolerate is admitted.
 */

jest.mock('@mxf-dev/core/utils/Logger', () => ({
    Logger: jest.fn().mockImplementation(() => ({
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn()
    }))
}));

jest.mock('@mxf-dev/core/events/EventBus', () => ({
    EventBus: {
        server: { emit: jest.fn(), on: jest.fn() },
        client: { emit: jest.fn(), on: jest.fn() }
    }
}));

jest.mock('../../../src/server/socket/services/TaskService', () => ({
    TaskService: { getInstance: jest.fn() }
}));

jest.mock('../../../src/server/socket/services/SystemLlmServiceManager', () => ({
    SystemLlmServiceManager: { getInstance: jest.fn() }
}));

jest.mock('../../../src/server/socket/services/McpService', () => ({
    McpService: { getInstance: jest.fn() }
}));

jest.mock('../../../src/server/api/services/McpToolRegistry', () => ({
    McpToolRegistry: { getInstance: jest.fn() }
}));

jest.mock('../../../src/server/mcp/services/HybridMcpRegistryAccess', () => ({
    getHybridMcpToolRegistry: jest.fn().mockReturnValue(null)
}));

import { task_complete } from '../../../src/server/mcp/tools/MetaTools';
import { completeTaskBridgeTool } from '../../../src/server/mcp/tools/TaskBridgeTools';
import { TaskService } from '../../../src/server/socket/services/TaskService';
import { validateToolInput } from '@mxf-dev/core/protocols/mcp/McpToolSchema';

const context = {
    agentId: 'test-agent-1',
    channelId: 'test-channel-1',
    requestId: 'test-request-1'
};

const structuredSummary = {
    signals_written: 15,
    key_themes: ['rates', 'earnings'],
    categories: { macro: 9, equity: 6 }
};

let mockHandleTaskCompletion: jest.Mock;

beforeEach(() => {
    mockHandleTaskCompletion = jest.fn().mockResolvedValue({
        status: 'task_completed',
        message: 'ok',
        taskId: 'task-1',
        nextSteps: undefined
    });
    (TaskService.getInstance as jest.Mock).mockReturnValue({
        handleTaskCompletion: mockHandleTaskCompletion
    });
});

describe('task_complete input schema', () => {
    it('accepts an object-valued summary', () => {
        const result = validateToolInput(task_complete.inputSchema, {
            summary: structuredSummary
        });
        expect(result.valid).toBe(true);
    });

    it('accepts an object-valued result', () => {
        const result = validateToolInput(task_complete.inputSchema, {
            result: structuredSummary
        });
        expect(result.valid).toBe(true);
    });

    it('accepts a string summary (unchanged behavior)', () => {
        const result = validateToolInput(task_complete.inputSchema, {
            summary: 'Wrote 15 signals covering rates and earnings'
        });
        expect(result.valid).toBe(true);
    });

    it('accepts an empty input (no required fields)', () => {
        const result = validateToolInput(task_complete.inputSchema, {});
        expect(result.valid).toBe(true);
    });

    it('still rejects a number-valued summary (fail-fast preserved)', () => {
        const result = validateToolInput(task_complete.inputSchema, { summary: 42 });
        expect(result.valid).toBe(false);
    });

    it('still rejects an array-valued summary (fail-fast preserved)', () => {
        const result = validateToolInput(task_complete.inputSchema, {
            summary: ['a', 'b']
        });
        expect(result.valid).toBe(false);
    });

    it('still rejects a null summary (fail-fast preserved)', () => {
        const result = validateToolInput(task_complete.inputSchema, { summary: null });
        expect(result.valid).toBe(false);
    });
});

describe('task_complete handler summary normalization', () => {
    it('stringifies an object summary before passing it downstream', async () => {
        await task_complete.handler({ summary: structuredSummary } as any, context);

        expect(mockHandleTaskCompletion).toHaveBeenCalledWith(
            context.agentId,
            context.channelId,
            expect.objectContaining({ summary: JSON.stringify(structuredSummary) })
        );
    });

    it('stringifies an object result when summary is absent', async () => {
        await task_complete.handler({ result: structuredSummary } as any, context);

        expect(mockHandleTaskCompletion).toHaveBeenCalledWith(
            context.agentId,
            context.channelId,
            expect.objectContaining({ summary: JSON.stringify(structuredSummary) })
        );
    });

    it('passes a string summary through verbatim', async () => {
        const summary = 'Wrote 15 signals covering rates and earnings';
        await task_complete.handler({ summary }, context);

        expect(mockHandleTaskCompletion).toHaveBeenCalledWith(
            context.agentId,
            context.channelId,
            expect.objectContaining({ summary })
        );
    });

    it('prefers summary over result when both are objects', async () => {
        await task_complete.handler(
            { summary: structuredSummary, result: { other: true } } as any,
            context
        );

        expect(mockHandleTaskCompletion).toHaveBeenCalledWith(
            context.agentId,
            context.channelId,
            expect.objectContaining({ summary: JSON.stringify(structuredSummary) })
        );
    });

    it('rejects missing completion evidence instead of fabricating a summary', async () => {
        await expect(task_complete.handler({}, context))
            .rejects.toThrow(/completion summary or result is required/i);

        expect(mockHandleTaskCompletion).not.toHaveBeenCalled();
    });

    it('falls through an empty-string summary to result (unchanged behavior)', async () => {
        await task_complete.handler({ summary: '', result: 'from result' }, context);

        expect(mockHandleTaskCompletion).toHaveBeenCalledWith(
            context.agentId,
            context.channelId,
            expect.objectContaining({ summary: 'from result' })
        );
    });

    it('preserves an explicit failure outcome for the authoritative service', async () => {
        await task_complete.handler({ summary: 'validation failed', success: false }, context);

        expect(mockHandleTaskCompletion).toHaveBeenCalledWith(
            context.agentId,
            context.channelId,
            expect.objectContaining({
                summary: 'validation failed',
                success: false
            })
        );
    });
});

describe('task_complete_bridge summary coercion', () => {
    it('schema accepts an object-valued summary', () => {
        const result = validateToolInput(completeTaskBridgeTool.inputSchema, {
            summary: structuredSummary
        });
        expect(result.valid).toBe(true);
    });

    it('schema still requires summary', () => {
        const result = validateToolInput(completeTaskBridgeTool.inputSchema, {});
        expect(result.valid).toBe(false);
    });

    it('schema still rejects a number-valued summary (fail-fast preserved)', () => {
        const result = validateToolInput(completeTaskBridgeTool.inputSchema, {
            summary: 42
        });
        expect(result.valid).toBe(false);
    });

    it('handler stringifies an object summary before passing it downstream', async () => {
        await completeTaskBridgeTool.handler({ summary: structuredSummary }, context);

        expect(mockHandleTaskCompletion).toHaveBeenCalledWith(
            context.agentId,
            context.channelId,
            expect.objectContaining({ summary: JSON.stringify(structuredSummary) })
        );
    });

    it('handler passes a string summary through verbatim', async () => {
        const summary = 'Bridge completion summary';
        await completeTaskBridgeTool.handler({ summary }, context);

        expect(mockHandleTaskCompletion).toHaveBeenCalledWith(
            context.agentId,
            context.channelId,
            expect.objectContaining({ summary })
        );
    });

    it('handler preserves an explicit failure outcome', async () => {
        await completeTaskBridgeTool.handler({
            summary: 'bridge validation failed',
            success: false
        }, context);

        expect(mockHandleTaskCompletion).toHaveBeenCalledWith(
            context.agentId,
            context.channelId,
            expect.objectContaining({
                summary: 'bridge validation failed',
                success: false
            })
        );
    });
});
