import { EventBus } from '@mxf-dev/core/events/EventBus';
import { Events } from '@mxf-dev/core/events/EventNames';
import { AgentChannelAdministrationError, MxfService } from '@mxf-dev/sdk/services/MxfService';
import { TaskHelper } from '@mxf-dev/sdk/services/internal/TaskHelper';

const AGENT_ID = 'public-contract-agent';
const CHANNEL_ID = 'public-contract-channel';

const logger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
};

const createService = (): MxfService => {
    const service = new MxfService(
        CHANNEL_ID,
        { serverUrl: 'http://mxf.test' },
        {},
        logger
    );
    service.setAgentId(AGENT_ID);
    return service;
};

describe('MxfService public contract', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        EventBus.reset();
    });

    afterEach(() => {
        jest.restoreAllMocks();
        EventBus.reset();
    });

    it('binds outbound messages to the service identity', async () => {
        const emitSpy = jest.spyOn(EventBus.client, 'emitOn').mockImplementation(() => undefined);
        const service = createService();

        const messageId = await service.sendMessage('contract message', {
            metadata: { correlationId: 'public-test' },
        });

        expect(emitSpy).toHaveBeenCalledTimes(1);
        expect(emitSpy).toHaveBeenCalledWith(
            AGENT_ID,
            Events.Message.CHANNEL_MESSAGE,
            expect.objectContaining({
                agentId: AGENT_ID,
                channelId: CHANNEL_ID,
                data: expect.objectContaining({
                    senderId: AGENT_ID,
                    metadata: expect.objectContaining({
                        messageId,
                        correlationId: 'public-test',
                    }),
                }),
            })
        );
    });

    it('prevents metadata and context from overriding canonical message identity', async () => {
        const emitSpy = jest.spyOn(EventBus.client, 'emitOn').mockImplementation(() => undefined);
        const service = createService();
        const earliestTimestamp = Date.now();

        const messageId = await service.sendMessage('identity test', {
            messageId: 'canonical-message-id',
            metadata: {
                messageId: 'forged-message-id',
                timestamp: 1,
            },
            context: {
                channelId: 'forged-channel',
                purpose: 'contract-test',
            },
        });

        expect(messageId).toBe('canonical-message-id');
        const payload = emitSpy.mock.calls[0]?.[2] as {
            data?: {
                metadata?: { messageId?: string; timestamp?: number };
                context?: { channelId?: string; purpose?: string };
            };
        };
        expect(payload.data?.metadata).toEqual(expect.objectContaining({
            messageId: 'canonical-message-id',
        }));
        expect(payload.data?.metadata?.timestamp).toBeGreaterThanOrEqual(earliestTimestamp);
        expect(payload.data?.context).toEqual({
            channelId: CHANNEL_ID,
            purpose: 'contract-test',
        });
    });

    it('exposes authoritative task failure through the channel service', async () => {
        const failTask = jest.spyOn(TaskHelper, 'failTask').mockResolvedValue(undefined);
        const service = createService();

        await expect(service.failTask('task-123', 'worker failed')).resolves.toBeUndefined();

        expect(failTask).toHaveBeenCalledWith(
            'task-123',
            AGENT_ID,
            CHANNEL_ID,
            'worker failed'
        );
    });

    it('rejects empty task failure reasons before emitting a lifecycle request', async () => {
        const failTask = jest.spyOn(TaskHelper, 'failTask').mockResolvedValue(undefined);
        const service = createService();

        await expect(service.failTask('task-123', '   ')).rejects.toThrow();
        expect(failTask).not.toHaveBeenCalled();
    });

    it('rejects channel and key administration on an agent connection without emitting', async () => {
        const emitSpy = jest.spyOn(EventBus.client, 'emit').mockImplementation(() => undefined as never);
        const emitOnSpy = jest.spyOn(EventBus.client, 'emitOn').mockImplementation(() => undefined);
        const service = createService();
        const attempts: Array<() => Promise<unknown>> = [
            (): Promise<unknown> => service.createChannel({ channelId: 'c', name: 'C' }),
            (): Promise<unknown> => service.generateKey({ channelId: CHANNEL_ID, agentId: 'new-agent' }),
            (): Promise<unknown> => service.deactivateKey('key-1'),
            (): Promise<unknown> => service.listKeys()
        ];

        for (const attempt of attempts) {
            const rejection = attempt();
            await expect(rejection).rejects.toEqual(expect.objectContaining({
                name: 'AgentChannelAdministrationError',
                code: 'MXF_ADMIN_CHANNEL_REQUIRED',
                message: expect.stringContaining('MxfSDK')
            }));
            await expect(rejection).rejects.toBeInstanceOf(AgentChannelAdministrationError);
        }

        expect(emitSpy).not.toHaveBeenCalled();
        expect(emitOnSpy).not.toHaveBeenCalled();
    });
});
