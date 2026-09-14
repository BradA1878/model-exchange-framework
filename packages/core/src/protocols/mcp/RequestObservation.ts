import { randomUUID } from 'node:crypto';
import type { McpRequestTrace, McpResponseMetadata } from './IMcpClient.js';

/**
 * Start observation at the transport boundary, after the request is serialized.
 * The caller sends serializedBody itself; callbacks only receive a separate copy.
 */
export function observeMcpRequest(
    provider: string,
    model: string,
    serializedBody: string,
    trace?: McpRequestTrace
): { complete: (facts?: Pick<McpResponseMetadata, 'providerRoute' | 'costUsd' | 'finishReason' | 'nativeFinishReason'>) => McpResponseMetadata } {
    const requestId = randomUUID();
    const startedAt = performance.now();
    const activation = trace?.activationId === undefined ? {} : { activationId: trace.activationId };
    trace?.onRequest?.({
        requestId,
        ...activation,
        provider,
        model,
        ...(trace.captureBody ? { body: JSON.parse(serializedBody) } : {})
    });
    return {
        complete: (facts = {}) => ({
            requestId,
            ...activation,
            provider,
            latencyMs: performance.now() - startedAt,
            ...facts
        })
    };
}
