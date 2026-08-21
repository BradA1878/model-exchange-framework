import { Observable, throwError } from 'rxjs';

import {
    IAgentMemory,
    IChannelMemory,
    IRelationshipMemory
} from '@mxf-dev/core/types/MemoryTypes';
import { MemoryHandlers } from '@mxf-dev/sdk/handlers/MemoryHandlers';
import { MxfMemoryService } from '@mxf-dev/sdk/services/MxfMemoryService';

const AGENT_ID = 'memory-handler-agent';
const PEER_ID = 'memory-handler-peer';
const CHANNEL_ID = 'memory-handler-channel';

interface FailureCase {
    label: string;
    installFailure: (service: MxfMemoryService) => void;
    run: (handlers: MemoryHandlers) => Promise<unknown>;
}

const storageFailure = (): Observable<never> =>
    throwError(() => new Error('authoritative storage unavailable'));

describe('MemoryHandlers authoritative failure contract', () => {
    let service: MxfMemoryService;
    let handlers: MemoryHandlers;

    beforeEach(() => {
        (MxfMemoryService as unknown as { instance?: MxfMemoryService }).instance = undefined;
        service = MxfMemoryService.getInstance();
        handlers = new MemoryHandlers(CHANNEL_ID, AGENT_ID);
    });

    afterEach(() => {
        handlers.cleanup();
        jest.restoreAllMocks();
        (MxfMemoryService as unknown as { instance?: MxfMemoryService }).instance = undefined;
    });

    it.each<FailureCase>([
        {
            label: 'agent GET',
            installFailure: (target: MxfMemoryService): void => {
                jest.spyOn(target, 'getAgentMemory').mockReturnValue(storageFailure());
            },
            run: (target: MemoryHandlers): Promise<unknown> => target.getAgentMemory()
        },
        {
            label: 'agent UPDATE',
            installFailure: (target: MxfMemoryService): void => {
                jest.spyOn(target, 'updateAgentMemory').mockReturnValue(storageFailure());
            },
            run: (target: MemoryHandlers): Promise<unknown> =>
                target.updateAgentMemory({ notes: { key: 'value' } })
        },
        {
            label: 'agent DELETE',
            installFailure: (target: MxfMemoryService): void => {
                jest.spyOn(target, 'deleteMemory').mockReturnValue(storageFailure());
            },
            run: (target: MemoryHandlers): Promise<unknown> => target.deleteAgentMemory()
        },
        {
            label: 'channel GET',
            installFailure: (target: MxfMemoryService): void => {
                jest.spyOn(target, 'getChannelMemory').mockReturnValue(storageFailure());
            },
            run: (target: MemoryHandlers): Promise<unknown> =>
                target.getChannelMemory(CHANNEL_ID)
        },
        {
            label: 'channel UPDATE',
            installFailure: (target: MxfMemoryService): void => {
                jest.spyOn(target, 'updateChannelMemory').mockReturnValue(storageFailure());
            },
            run: (target: MemoryHandlers): Promise<unknown> =>
                target.updateChannelMemory(CHANNEL_ID, { notes: { key: 'value' } })
        },
        {
            label: 'channel DELETE',
            installFailure: (target: MxfMemoryService): void => {
                jest.spyOn(target, 'deleteMemory').mockReturnValue(storageFailure());
            },
            run: (target: MemoryHandlers): Promise<unknown> =>
                target.deleteChannelMemory(CHANNEL_ID)
        },
        {
            label: 'relationship GET',
            installFailure: (target: MxfMemoryService): void => {
                jest.spyOn(target, 'getRelationshipMemory').mockReturnValue(storageFailure());
            },
            run: (target: MemoryHandlers): Promise<unknown> =>
                target.getRelationshipMemory(PEER_ID)
        },
        {
            label: 'relationship UPDATE',
            installFailure: (target: MxfMemoryService): void => {
                jest.spyOn(target, 'updateRelationshipMemory').mockReturnValue(storageFailure());
            },
            run: (target: MemoryHandlers): Promise<unknown> => target.updateRelationshipMemory(
                PEER_ID,
                { notes: { key: 'value' } }
            )
        },
        {
            label: 'relationship DELETE',
            installFailure: (target: MxfMemoryService): void => {
                jest.spyOn(target, 'deleteMemory').mockReturnValue(storageFailure());
            },
            run: (target: MemoryHandlers): Promise<unknown> =>
                target.deleteRelationshipMemory(PEER_ID)
        }
    ])('$label rejects instead of returning null or false', async ({ installFailure, run }) => {
        installFailure(service);

        await expect(run(handlers)).rejects.toThrow('authoritative storage unavailable');
    });

    it('cleanup cancels an unanswered operation without creating a timer', async () => {
        const setTimeoutSpy = jest.spyOn(global, 'setTimeout');
        const teardown = jest.fn();
        jest.spyOn(service, 'getAgentMemory').mockReturnValue(
            new Observable<IAgentMemory>(() => teardown)
        );

        const pendingRequest = handlers.getAgentMemory();
        expect(teardown).not.toHaveBeenCalled();
        expect(setTimeoutSpy).not.toHaveBeenCalled();

        handlers.cleanup();

        await expect(pendingRequest).rejects.toThrow(/memory handler was cleaned up/);
        expect(teardown).toHaveBeenCalledTimes(1);
        expect(setTimeoutSpy).not.toHaveBeenCalled();
    });

    it('rejects an operation that completes without an authoritative result', async () => {
        jest.spyOn(service, 'getChannelMemory').mockReturnValue(
            new Observable<IChannelMemory>(subscriber => subscriber.complete())
        );

        await expect(handlers.getChannelMemory(CHANNEL_ID))
            .rejects.toThrow(/completed without a result/);
    });

    it('returns the exact relationship memory supplied by the authoritative service', async () => {
        const expected = {} as IRelationshipMemory;
        jest.spyOn(service, 'getRelationshipMemory').mockReturnValue(
            new Observable<IRelationshipMemory>(subscriber => {
                subscriber.next(expected);
                subscriber.complete();
            })
        );

        await expect(handlers.getRelationshipMemory(PEER_ID)).resolves.toBe(expected);
    });
});
