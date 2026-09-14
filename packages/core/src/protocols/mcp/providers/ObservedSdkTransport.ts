import { AsyncLocalStorage } from 'node:async_hooks';
import type { ClientOptions } from 'openai';
import type { McpApiResponse, McpRequestTrace } from '../IMcpClient.js';
import { observeMcpRequest } from '../RequestObservation.js';

interface RequestScope {
    trace?: McpRequestTrace;
    observation?: ReturnType<typeof observeMcpRequest>;
}

/** Observe SDK serialization and each SDK retry without sharing request state between calls. */
export class ObservedSdkTransport {
    private readonly requests = new AsyncLocalStorage<RequestScope>();

    constructor(private readonly provider: string) {}

    /** Installed through the provider SDK's supported per-instance fetch option. */
    public readonly fetch: NonNullable<ClientOptions['fetch']> = async (url, init) => {
        const scope = this.requests.getStore();
        if (scope) {
            if (typeof init?.body !== 'string') throw new Error('Observed provider requests require a serialized JSON body');
            const body = JSON.parse(init.body) as { model: string };
            scope.observation = observeMcpRequest(this.provider, body.model, init.body, scope.trace);
        }
        // The SDK supports native fetch at runtime, but its Node declaration names
        // node-fetch's Response, which adds methods unused by JSON completions.
        return await globalThis.fetch(url as string, init as RequestInit) as unknown as Awaited<ReturnType<NonNullable<ClientOptions['fetch']>>>;
    };

    public async run(
        trace: McpRequestTrace | undefined,
        operation: () => Promise<McpApiResponse>
    ): Promise<McpApiResponse> {
        const scope: RequestScope = { trace };
        return this.requests.run(scope, async () => {
            const response = await operation();
            if (scope.observation) {
                response.request = scope.observation.complete(response.stop_reason === null ? {} : { finishReason: response.stop_reason });
            } else if (trace?.captureBody) {
                throw new Error('Provider request capture did not observe an HTTP request');
            }
            return response;
        });
    }
}
