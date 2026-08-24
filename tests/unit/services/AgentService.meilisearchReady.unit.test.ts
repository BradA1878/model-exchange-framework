/**
 * AgentService marks an agent ready for the memory_search_* tools once its
 * memory-load backfill has settled.
 *
 * Readiness used to be set only by the server's own per-batch
 * BACKFILL_COMPLETE/PARTIAL events, so an agent with nothing to backfill (a
 * new agent, or one whose history was already indexed live) never became
 * ready and never saw the search tools. The SDK now reports its settled load
 * with BACKFILL_SETTLED, which covers that case and gives the server a record
 * of what the client managed to index.
 */

const mockLoggerError = jest.fn();
const mockLoggerWarn = jest.fn();
const mockLoggerInfo = jest.fn();

jest.mock('@mxf-dev/core/utils/Logger', () => ({
    Logger: class {
        info = mockLoggerInfo; warn = mockLoggerWarn; error = mockLoggerError; debug = jest.fn();
    }
}));

import { EventBus } from '@mxf-dev/core/events/EventBus';
import { MeilisearchEvents } from '@mxf-dev/core/events/event-definitions/MeilisearchEvents';
import {
    createMeilisearchBackfillEventPayload,
    MeilisearchBackfillEventData
} from '@mxf-dev/core/schemas/EventPayloadSchema';
import { AgentService } from '../../../src/server/socket/services/AgentService';

const settled = (counts: Partial<MeilisearchBackfillEventData>): MeilisearchBackfillEventData => ({
    operationId: 'settled-1',
    indexName: 'mxf-conversations',
    totalDocuments: 0,
    indexedDocuments: 0,
    failedDocuments: 0,
    skippedDocuments: 0,
    duration: 0,
    success: true,
    source: 'memory',
    ...counts
});

const reportSettled = (agentId: string, counts: Partial<MeilisearchBackfillEventData>): void => {
    EventBus.server.emit(
        MeilisearchEvents.BACKFILL_SETTLED,
        createMeilisearchBackfillEventPayload(
            MeilisearchEvents.BACKFILL_SETTLED, agentId, 'channel-a', settled(counts)
        )
    );
};

describe('AgentService Meilisearch readiness', () => {
    let service: AgentService;

    beforeEach(() => {
        jest.clearAllMocks();
        EventBus.reset();
        // The singleton registers its listeners in the constructor; a fresh bus needs a fresh instance.
        (AgentService as unknown as { instance: AgentService | undefined }).instance = undefined;
        service = AgentService.getInstance();
    });

    afterAll(() => {
        EventBus.reset();
        (AgentService as unknown as { instance: AgentService | undefined }).instance = undefined;
    });

    it('starts an agent as not ready', () => {
        service.registerAgent('agent-a');

        expect(service.getAgent('agent-a')?.meilisearchReady).toBe(false);
    });

    it('marks an agent ready when its memory load settles with nothing to index', () => {
        service.registerAgent('agent-a');

        reportSettled('agent-a', { totalDocuments: 0, success: true });

        expect(service.getAgent('agent-a')?.meilisearchReady).toBe(true);
        expect(mockLoggerError).not.toHaveBeenCalled();
    });

    it('marks an agent ready when a settled load indexed part of its history, and logs the rest', () => {
        service.registerAgent('agent-a');

        reportSettled('agent-a', {
            totalDocuments: 51,
            indexedDocuments: 1,
            failedDocuments: 50,
            success: false,
            error: 'backfill content exceeds 262144 bytes'
        });

        expect(service.getAgent('agent-a')?.meilisearchReady).toBe(true);
        expect(mockLoggerError).toHaveBeenCalledWith(expect.stringContaining('50 of 51'));
        expect(mockLoggerError).toHaveBeenCalledWith(expect.stringContaining('backfill content exceeds'));
    });

    it('leaves an agent not ready when a settled load indexed nothing it had to index', () => {
        service.registerAgent('agent-a');

        reportSettled('agent-a', {
            totalDocuments: 51,
            indexedDocuments: 0,
            failedDocuments: 51,
            success: false,
            error: 'meilisearch:backfill:request not sent: agent agent-a has no connected socket'
        });

        expect(service.getAgent('agent-a')?.meilisearchReady).toBe(false);
        expect(mockLoggerError).toHaveBeenCalledWith(expect.stringContaining('51 of 51'));
    });

    it('still marks an agent ready on the server\'s own per-batch completion', () => {
        service.registerAgent('agent-a');

        EventBus.server.emit(
            MeilisearchEvents.BACKFILL_COMPLETE,
            createMeilisearchBackfillEventPayload(
                MeilisearchEvents.BACKFILL_COMPLETE, 'agent-a', 'channel-a',
                settled({ totalDocuments: 50, indexedDocuments: 50, source: 'mongodb' })
            )
        );

        expect(service.getAgent('agent-a')?.meilisearchReady).toBe(true);
    });

    it('ignores a settled report for an agent it does not know', () => {
        expect(() => reportSettled('ghost', { totalDocuments: 0, success: true })).not.toThrow();

        expect(service.getAgent('ghost')).toBeNull();
        expect(mockLoggerWarn).toHaveBeenCalledWith(expect.stringContaining('ghost'));
    });
});
