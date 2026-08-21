jest.mock('@mxf-dev/core/utils/Logger', () => ({
    Logger: jest.fn(() => ({
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn()
    }))
}));

jest.mock('@mxf-dev/core/events/EventBus', () => ({
    EventBus: { server: { emit: jest.fn() } }
}));

import { UserInputRequestManager } from '@mxf-dev/core/services/UserInputRequestManager';

describe('UserInputRequestManager authorization', () => {
    let manager: UserInputRequestManager;

    beforeEach(() => {
        manager = UserInputRequestManager.getInstance();
    });

    afterEach(() => {
        manager.shutdown();
    });

    it('rejects a peer response while allowing the intended agent to resolve it', async () => {
        const { requestData, promise } = manager.createRequest({
            agentId: 'intended-agent',
            channelId: 'channel-real',
            title: 'Approve?',
            inputType: 'confirm',
            inputConfig: {}
        });

        expect(() => manager.submitResponse(
            requestData.requestId,
            true,
            'peer-agent',
            'channel-real'
        )).toThrow('outside the authenticated agent/channel scope');
        expect(manager.getRequest(
            requestData.requestId,
            'intended-agent',
            'channel-real'
        )?.status).toBe('pending');

        manager.submitResponse(
            requestData.requestId,
            true,
            'intended-agent',
            'channel-real'
        );
        await expect(promise).resolves.toBe(true);
    });

    it('does not reveal status or response values outside the request scope', () => {
        const { requestData } = manager.createRequest({
            agentId: 'intended-agent',
            channelId: 'private-channel',
            title: 'Secret answer',
            inputType: 'text',
            inputConfig: {}
        });
        manager.submitResponse(
            requestData.requestId,
            'classified',
            'intended-agent',
            'private-channel'
        );

        expect(manager.getRequest(
            requestData.requestId,
            'peer-agent',
            'private-channel'
        )).toBeNull();
        expect(manager.getRequest(
            requestData.requestId,
            'intended-agent',
            'other-channel'
        )).toBeNull();
        expect(manager.getRequest(
            requestData.requestId,
            'intended-agent',
            'private-channel'
        )?.value).toBe('classified');
    });
});
