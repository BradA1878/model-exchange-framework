import { firstValueFrom, of } from 'rxjs';

const createExecution = jest.fn();
const updateExecution = jest.fn();
const listTools = jest.fn();
const getChannelAllowedTools = jest.fn();
const toolHandler = jest.fn();
const patternSingleton = jest.fn();

jest.mock('@mxf-dev/core/models/mcpToolExecution', (): object => ({
    McpToolExecution: { create: createExecution, findOneAndUpdate: updateExecution }
}));
jest.mock('../../../src/server/api/services/McpToolRegistry', (): object => ({
    McpToolRegistry: { getInstance: (): object => ({ listToolsForChannel: listTools }) }
}));
jest.mock('../../../src/server/socket/services/McpService', (): object => ({
    McpService: { getInstance: (): object => ({ getChannelAllowedTools }) }
}));
jest.mock('../../../src/server/mcp/services/HybridMcpRegistryAccess', (): object => ({
    getHybridMcpToolRegistry: (): null => null
}));
jest.mock('@mxf-dev/core/services/ValidationPerformanceService', (): object => ({
    ValidationPerformanceService: { getInstance: (): object => ({}) }
}));
jest.mock('@mxf-dev/core/services/PatternLearningService', (): object => ({
    PatternLearningService: { getInstance: patternSingleton }
}));

import { EventBus } from '@mxf-dev/core/events/EventBus';
import { Events } from '@mxf-dev/core/events/EventNames';
import { createMcpToolCallPayload, createMcpToolResultPayload } from '@mxf-dev/core/schemas/EventPayloadSchema';
import { AutoCorrectionService } from '@mxf-dev/core/services/AutoCorrectionService';
import { McpToolHandlerContext, McpToolHandlerResult } from '@mxf-dev/core/protocols/mcp/McpServerTypes';
import { validateToolInput, formatValidationError } from '@mxf-dev/core/protocols/mcp/McpToolSchema';
import { ToolExecutionPersistenceService } from '../../../src/server/services/ToolExecutionPersistenceService';
import { McpSocketExecutor } from '../../../src/server/socket/services/McpSocketExecutor';

interface Deferred<T> {
    promise: Promise<T>;
    resolve: (value: T) => void;
    reject: (error: Error) => void;
}
const deferred = <T>(): Deferred<T> => {
    let resolve!: Deferred<T>['resolve'];
    let reject!: Deferred<T>['reject'];
    const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail; });
    return { promise, resolve, reject };
};
const result: McpToolHandlerResult = { content: { type: 'text', data: 'complete' } };
const schema = {
    type: 'object',
    properties: { enabled: { type: 'boolean' } },
    required: ['enabled'],
    additionalProperties: false
};
const context = (): McpToolHandlerContext => ({
    requestId: 'tool-call',
    llmRequestId: 'llm-request',
    activationId: 'activation-a',
    agentId: 'audit-agent',
    channelId: 'audit-channel',
    authorization: { keyId: 'audit-key', allowedTools: ['audit_tool'] }
});

/** Real executor + persistence + schema validation + EventBus; only I/O is mocked. */
describe('admitted tool persistence and shutdown drain', () => {
    let executor: McpSocketExecutor;
    let persistence: ToolExecutionPersistenceService;
    let correction: AutoCorrectionService;
    const priorFlag = process.env.AUTO_CORRECTION_ENABLED;

    beforeEach(async () => {
        EventBus.reset();
        jest.clearAllMocks();
        process.env.AUTO_CORRECTION_ENABLED = 'false';
        (McpSocketExecutor as unknown as { instance: McpSocketExecutor | null }).instance = null;
        (ToolExecutionPersistenceService as unknown as { instance: ToolExecutionPersistenceService | null }).instance = null;
        createExecution.mockResolvedValue({ requestId: 'tool-call' });
        updateExecution.mockResolvedValue({ requestId: 'tool-call' });
        getChannelAllowedTools.mockReturnValue([]);
        toolHandler.mockResolvedValue(result);
        listTools.mockReturnValue(of([{
            name: 'audit_tool', description: 'Audit tool', enabled: true,
            inputSchema: schema, handler: toolHandler
        }]));
        executor = McpSocketExecutor.getInstance();
        correction = AutoCorrectionService.getInstance();
        persistence = ToolExecutionPersistenceService.getInstance();
        await persistence.initialize();
    });

    afterEach(() => {
        correction.shutdown();
        EventBus.reset();
        jest.restoreAllMocks();
        if (priorFlag === undefined) delete process.env.AUTO_CORRECTION_ENABLED;
        else process.env.AUTO_CORRECTION_ENABLED = priorFlag;
    });

    const emitCall = (input: Record<string, unknown> = { enabled: true }): void => {
        const caller = context();
        const payload = {
            ...createMcpToolCallPayload(
                Events.Mcp.TOOL_CALL, caller.agentId!, caller.channelId!,
                { toolName: 'audit_tool', callId: caller.requestId, arguments: input },
                { requestId: caller.llmRequestId, activationId: caller.activationId }
            ),
            authorization: caller.authorization
        };
        EventBus.server.emit(Events.Mcp.TOOL_CALL, payload);
    };

    it('does not record schema rejection or invoke disabled correction/pattern learning', async () => {
        const attempt = jest.spyOn(correction, 'attemptCorrection');
        const errors = jest.fn();
        EventBus.server.on(Events.Mcp.TOOL_ERROR, errors);
        emitCall({});
        await EventBus.drain();
        const originalError = formatValidationError(validateToolInput(schema, {}), 'audit_tool', schema, {});
        expect(errors).toHaveBeenCalledTimes(1);
        expect(errors.mock.calls[0][0]).toMatchObject({
            requestId: 'llm-request', activationId: 'activation-a',
            data: { callId: 'tool-call', error: originalError }
        });
        expect(attempt).not.toHaveBeenCalled();
        expect(patternSingleton).not.toHaveBeenCalled();
        expect(createExecution).not.toHaveBeenCalled();
        expect(updateExecution).not.toHaveBeenCalled();
        expect(toolHandler).not.toHaveBeenCalled();
    });

    it.each(['credential', 'channel', 'missing', 'disabled'])('does not record %s rejection', async (rejection) => {
        const caller = context();
        if (rejection === 'credential') caller.authorization!.allowedTools = [];
        if (rejection === 'channel') getChannelAllowedTools.mockReturnValue(['another_tool']);
        if (rejection === 'missing') listTools.mockReturnValue(of([]));
        if (rejection === 'disabled') listTools.mockReturnValue(of([{
            name: 'audit_tool', enabled: false, inputSchema: schema, handler: toolHandler
        }]));
        await expect(firstValueFrom(executor.executeTool('audit_tool', { enabled: true }, caller))).rejects.toThrow();
        expect(createExecution).not.toHaveBeenCalled();
        expect(updateExecution).not.toHaveBeenCalled();
        expect(toolHandler).not.toHaveBeenCalled();
    });

    it('retains deterministic coercion and records direct HTTP-style execution through completion', async () => {
        await expect(firstValueFrom(executor.executeTool('audit_tool', { enabled: 'true' }, context()))).resolves.toEqual(result);
        expect(toolHandler).toHaveBeenCalledWith({ enabled: true }, expect.objectContaining({
            requestId: 'tool-call', llmRequestId: 'llm-request', activationId: 'activation-a'
        }));
        expect(createExecution).toHaveBeenCalledTimes(1);
        expect(createExecution.mock.calls[0][0]).toMatchObject({
            status: 'running', requestId: 'tool-call', parameters: { enabled: true },
            metadata: { requestId: 'llm-request', activationId: 'activation-a' }
        });
        expect(updateExecution).toHaveBeenCalledWith(
            { requestId: 'tool-call', status: 'running', agentId: 'audit-agent', channelId: 'audit-channel' },
            expect.objectContaining({ status: 'completed', result: result.content }),
            { upsert: false }
        );
        expect(executor.getActiveExecutions()).toEqual([]);
    });

    it('preserves default correction and audits the corrected/coerced parameters', async () => {
        correction.shutdown();
        delete process.env.AUTO_CORRECTION_ENABLED;
        (McpSocketExecutor as unknown as { instance: McpSocketExecutor | null }).instance = null;
        executor = McpSocketExecutor.getInstance();
        correction = AutoCorrectionService.getInstance();
        const attempt = jest.spyOn(correction, 'attemptCorrection').mockResolvedValue({
            corrected: true, correctedParameters: { enabled: 'true' }, shouldRetry: true
        });
        await expect(firstValueFrom(executor.executeTool('audit_tool', {}, context()))).resolves.toEqual(result);
        expect(attempt).toHaveBeenCalledTimes(1);
        expect(createExecution.mock.calls[0][0].parameters).toEqual({ enabled: true });
    });

    it.each(['isError', 'error-content', 'throw', 'synchronous-throw'])('records direct %s failure exactly once', async (kind) => {
        const failure = { content: { type: kind === 'error-content' ? 'error' : 'text', data: 'denied verbatim' }, isError: kind === 'isError' };
        if (kind === 'throw') toolHandler.mockRejectedValue(new Error('denied verbatim'));
        else if (kind === 'synchronous-throw') toolHandler.mockImplementation((): never => { throw new Error('denied verbatim'); });
        else toolHandler.mockResolvedValue(failure);
        const operation = firstValueFrom(executor.executeTool('audit_tool', { enabled: true }, context()));
        if (kind === 'throw' || kind === 'synchronous-throw') await expect(operation).rejects.toThrow('denied verbatim');
        else await expect(operation).resolves.toEqual(failure);
        expect(createExecution).toHaveBeenCalledTimes(1);
        expect(updateExecution).toHaveBeenCalledTimes(1);
        expect(updateExecution.mock.calls[0][1]).toMatchObject({ status: 'failed', errorMessage: 'denied verbatim' });
    });

    it.each(['success', 'failure'])('preserves trace IDs on a socket %s', async (kind) => {
        const terminal = jest.fn();
        EventBus.server.on(kind === 'success' ? Events.Mcp.TOOL_RESULT : Events.Mcp.TOOL_ERROR, terminal);
        if (kind === 'failure') toolHandler.mockRejectedValue(new Error('handler failed'));
        emitCall();
        await EventBus.drain();
        expect(terminal).toHaveBeenCalledTimes(1);
        expect(terminal.mock.calls[0][0]).toMatchObject({
            requestId: 'llm-request', activationId: 'activation-a', data: { callId: 'tool-call' }
        });
        expect(toolHandler.mock.calls[0][1]).toMatchObject({
            requestId: 'tool-call', llmRequestId: 'llm-request', activationId: 'activation-a'
        });
    });

    it('keeps admitted start and terminal writes inside the EventBus shutdown drain', async () => {
        const start = deferred<object>();
        const enteredStart = deferred<void>();
        const finish = deferred<object>();
        const enteredFinish = deferred<void>();
        createExecution.mockImplementation((): Promise<object> => { enteredStart.resolve(); return start.promise; });
        updateExecution.mockImplementation((): Promise<object> => { enteredFinish.resolve(); return finish.promise; });
        const terminal = jest.fn();
        EventBus.server.on(Events.Mcp.TOOL_RESULT, terminal);
        emitCall();
        await enteredStart.promise;
        let drained = false;
        const drain = EventBus.drain().then((): void => { drained = true; });
        expect(toolHandler).not.toHaveBeenCalled();
        expect(EventBus.server.pendingHandlerCount()).toBe(1);
        start.resolve({});
        await enteredFinish.promise;
        expect(drained).toBe(false);
        expect(terminal).not.toHaveBeenCalled();
        finish.resolve({});
        await drain;
        expect(terminal).toHaveBeenCalledTimes(1);
        expect(EventBus.server.pendingHandlerCount()).toBe(0);
    });

    it('surfaces start-write failure without executing the handler', async () => {
        createExecution.mockRejectedValue(new Error('database unavailable'));
        await expect(firstValueFrom(executor.executeTool('audit_tool', { enabled: true }, context())))
            .rejects.toThrow('Tool execution audit failed: Failed to record tool call start: database unavailable');
        expect(toolHandler).not.toHaveBeenCalled();
        expect(updateExecution).not.toHaveBeenCalled();
        expect(executor.getActiveExecutions()).toEqual([]);
    });

    it('surfaces terminal-write failure instead of reporting successful execution', async () => {
        updateExecution.mockRejectedValue(new Error('terminal write unavailable'));
        const successes = jest.fn();
        const failures = jest.fn();
        EventBus.server.on(Events.Mcp.TOOL_RESULT, successes);
        EventBus.server.on(Events.Mcp.TOOL_ERROR, failures);
        emitCall();
        await EventBus.drain();
        expect(toolHandler).toHaveBeenCalledTimes(1);
        expect(successes).not.toHaveBeenCalled();
        expect(failures).toHaveBeenCalledTimes(1);
        expect(failures.mock.calls[0][0].data.error).toContain('terminal write unavailable');
        expect(executor.getActiveExecutions()).toEqual([]);
    });

    it('cancels during the start write, then skips the handler and records one failure', async () => {
        const start = deferred<object>();
        const enteredStart = deferred<void>();
        createExecution.mockImplementation((): Promise<object> => { enteredStart.resolve(); return start.promise; });
        const errors = jest.fn();
        const successes = jest.fn();
        EventBus.server.on(Events.Mcp.TOOL_ERROR, errors);
        EventBus.server.on(Events.Mcp.TOOL_RESULT, successes);
        emitCall();
        await enteredStart.promise;
        const cancellation = firstValueFrom(executor.cancelExecution('tool-call'));
        expect(updateExecution).not.toHaveBeenCalled();
        start.resolve({});
        await expect(cancellation).resolves.toBe(true);
        await EventBus.drain();
        expect(toolHandler).not.toHaveBeenCalled();
        expect(updateExecution).toHaveBeenCalledTimes(1);
        expect(updateExecution.mock.calls[0][1]).toMatchObject({ status: 'failed', errorMessage: 'Execution canceled' });
        expect(successes).not.toHaveBeenCalled();
        expect(errors).toHaveBeenCalledTimes(1);
        expect(errors.mock.calls[0][0]).toMatchObject({
            requestId: 'llm-request', activationId: 'activation-a', data: { callId: 'tool-call', error: 'Execution canceled' }
        });
    });

    it.each(['resolve', 'reject'])('does not overwrite cancellation after late handler %s', async (settlement) => {
        const handler = deferred<McpToolHandlerResult>();
        const enteredHandler = deferred<void>();
        toolHandler.mockImplementation((): Promise<McpToolHandlerResult> => { enteredHandler.resolve(); return handler.promise; });
        const errors = jest.fn();
        const successes = jest.fn();
        EventBus.server.on(Events.Mcp.TOOL_ERROR, errors);
        EventBus.server.on(Events.Mcp.TOOL_RESULT, successes);
        emitCall();
        await enteredHandler.promise;
        await expect(firstValueFrom(executor.cancelExecution('tool-call'))).resolves.toBe(true);
        await EventBus.drain();
        if (settlement === 'resolve') handler.resolve(result);
        else handler.reject(new Error('late rejection'));
        // Observe the source promise's settlement, then its registered handler.
        await handler.promise.catch((): void => {});
        await Promise.resolve();
        expect(updateExecution).toHaveBeenCalledTimes(1);
        expect(updateExecution.mock.calls[0][1].status).toBe('failed');
        expect(errors).toHaveBeenCalledTimes(1);
        expect(successes).not.toHaveBeenCalled();
        expect(executor.getActiveExecutions()).toEqual([]);
    });

    it('settles cancellation audit failure once and reports it to both callers', async () => {
        const handler = deferred<McpToolHandlerResult>();
        const enteredHandler = deferred<void>();
        toolHandler.mockImplementation((): Promise<McpToolHandlerResult> => { enteredHandler.resolve(); return handler.promise; });
        updateExecution.mockRejectedValue(new Error('cancel audit unavailable'));
        const errors = jest.fn();
        EventBus.server.on(Events.Mcp.TOOL_ERROR, errors);
        emitCall();
        await enteredHandler.promise;
        await expect(firstValueFrom(executor.cancelExecution('tool-call'))).rejects.toThrow('cancel audit unavailable');
        await EventBus.drain();
        handler.resolve(result);
        await handler.promise;
        await Promise.resolve();
        expect(errors).toHaveBeenCalledTimes(1);
        expect(errors.mock.calls[0][0].data.error).toContain('cancel audit unavailable');
        expect(updateExecution).toHaveBeenCalledTimes(1);
        expect(executor.getActiveExecutions()).toEqual([]);
    });

    it('does not let handler context or metadata overwrite admitted trace identity', async () => {
        toolHandler.mockImplementation(async (_input: unknown, toolContext: McpToolHandlerContext): Promise<McpToolHandlerResult> => {
            toolContext.requestId = 'forged-call';
            toolContext.llmRequestId = 'forged-llm-request';
            toolContext.activationId = 'forged-activation';
            return { ...result, metadata: { requestId: 'forged', activationId: 'forged' } };
        });
        const terminal = jest.fn();
        EventBus.server.on(Events.Mcp.TOOL_RESULT, terminal);
        emitCall();
        await EventBus.drain();
        expect(updateExecution.mock.calls[0][0].requestId).toBe('tool-call');
        expect(updateExecution.mock.calls[0][1].metadata).toMatchObject({
            requestId: 'llm-request', activationId: 'activation-a'
        });
        expect(terminal.mock.calls[0][0]).toMatchObject({
            requestId: 'llm-request', activationId: 'activation-a', data: { callId: 'tool-call' }
        });
        expect(executor.getActiveExecutions()).toEqual([]);
    });

    it('rejects duplicate active IDs without deleting the admitted owner', async () => {
        const handler = deferred<McpToolHandlerResult>();
        const enteredHandler = deferred<void>();
        toolHandler.mockImplementation((): Promise<McpToolHandlerResult> => { enteredHandler.resolve(); return handler.promise; });
        const original = firstValueFrom(executor.executeTool('audit_tool', { enabled: true }, context()));
        await enteredHandler.promise;
        await expect(firstValueFrom(executor.executeTool('audit_tool', { enabled: true }, context())))
            .rejects.toThrow('already exists');
        await expect(firstValueFrom(executor.executeTool('audit_tool', { enabled: true }, { ...context(), agentId: '' })))
            .rejects.toThrow();
        expect(executor.getActiveExecutions()).toHaveLength(1);
        expect(createExecution).toHaveBeenCalledTimes(1);
        handler.resolve(result);
        await expect(original).resolves.toEqual(result);
        expect(updateExecution).toHaveBeenCalledTimes(1);
    });

    it('ignores unowned/late terminal events and duplicate direct terminal writes', async () => {
        EventBus.server.emit(Events.Mcp.TOOL_RESULT, createMcpToolResultPayload(
            Events.Mcp.TOOL_RESULT, 'audit-agent', 'audit-channel',
            { toolName: 'audit_tool', callId: 'unowned', result: result.content }
        ));
        await EventBus.drain();
        expect(updateExecution).not.toHaveBeenCalled();
        await firstValueFrom(executor.executeTool('audit_tool', { enabled: true }, context()));
        await persistence.recordToolCallError('tool-call', 'late cancellation');
        await persistence.recordToolCallComplete('unowned', result);
        expect(updateExecution).toHaveBeenCalledTimes(1);
    });
});
