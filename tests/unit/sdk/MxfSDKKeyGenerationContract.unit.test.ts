/**
 * Public key-generation contract tests.
 *
 * A channel key is an agent credential, so omitting its agent identity must be
 * a compile-time error and malformed JavaScript calls must fail locally before
 * any request is emitted to the server.
 */

const mockAwaitEventResponse = jest.fn();

jest.mock('@mxf-dev/sdk/services/internal/EventRequest', () => ({
    awaitEventResponse: mockAwaitEventResponse,
    EventRequestError: class EventRequestError extends Error {}
}));

import { MxfSDK } from '@mxf-dev/sdk/MxfSDK';
import type { KeyGenerateConfig, KeyGenerateResult } from '@mxf-dev/sdk';

type PublicAgentIdParameter = Parameters<MxfSDK['generateKey']>[1];
type PublicAgentIdIsOptional = undefined extends PublicAgentIdParameter ? true : false;
type ConfigAgentIdIsOptional = undefined extends KeyGenerateConfig['agentId'] ? true : false;
type ResultAgentIdIsOptional = undefined extends KeyGenerateResult['agentId'] ? true : false;

// These assignments are compile-time contract assertions. If any agentId is
// made optional again, TypeScript rejects this test before Jest can run it.
const publicAgentIdIsOptional: PublicAgentIdIsOptional = false;
const configAgentIdIsOptional: ConfigAgentIdIsOptional = false;
const resultAgentIdIsOptional: ResultAgentIdIsOptional = false;

const makeConnectedSdk = (): MxfSDK => {
    const sdk = new MxfSDK({
        serverUrl: 'http://localhost:3001',
        domainKey: 'test-domain-key',
        accessToken: 'pat_test:secret'
    });
    (sdk as unknown as { socket: { connected: boolean } }).socket = { connected: true };
    return sdk;
};

describe('SDK key generation agent identity contract', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('keeps agentId required across the public method, config, and result types', () => {
        expect([
            publicAgentIdIsOptional,
            configAgentIdIsOptional,
            resultAgentIdIsOptional
        ]).toEqual([false, false, false]);
    });

    it('fails a JavaScript-style omitted public agentId locally', async () => {
        const sdk = makeConnectedSdk();

        // @ts-expect-error This intentionally exercises a malformed JavaScript caller.
        await expect(sdk.generateKey('channel-a')).rejects.toThrow(
            /agentId is required when generating a key/i
        );
        expect(mockAwaitEventResponse).not.toHaveBeenCalled();
    });

    it('fails a blank agentId before waiting on a server event', async () => {
        const sdk = makeConnectedSdk();

        await expect(sdk.generateKey('channel-a', '   ')).rejects.toThrow(
            /agentId is required when generating a key/i
        );
        expect(mockAwaitEventResponse).not.toHaveBeenCalled();
    });

    it('carries the required identity through the request and public result', async () => {
        mockAwaitEventResponse.mockImplementationOnce(async (request: {
            payload: { data: { agentId: string } };
            mapResult: (payload: unknown) => KeyGenerateResult;
        }) => request.mapResult({
            data: {
                keyId: 'key-a',
                secretKey: 'secret-a',
                channelId: 'channel-a',
                agentId: request.payload.data.agentId
            }
        }));
        const sdk = makeConnectedSdk();

        await expect(sdk.generateKey('channel-a', 'agent-a', 'Agent A key'))
            .resolves.toEqual(expect.objectContaining({
                keyId: 'key-a',
                channelId: 'channel-a',
                agentId: 'agent-a'
            }));
        expect(mockAwaitEventResponse).toHaveBeenCalledWith(expect.objectContaining({
            payload: expect.objectContaining({
                data: expect.objectContaining({ agentId: 'agent-a' })
            })
        }));
    });
});
