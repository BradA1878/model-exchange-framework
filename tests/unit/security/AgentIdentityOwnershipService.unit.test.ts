/**
 * Permanent global agent identity ownership security tests.
 */

const mockAgentFind = jest.fn();
const mockChannelKeyFind = jest.fn();
const mockReservationFindOneAndUpdate = jest.fn();
const mockReservationFindOne = jest.fn();
const mockAgentMemoryExists = jest.fn();
const mockRelationshipMemoryExists = jest.fn();
const mockMemoryEntryExists = jest.fn();
const mockSurpriseHistoryExists = jest.fn();
const mockMemoryPatternExists = jest.fn();
const mockMemoryUtilityExists = jest.fn();

jest.mock('@mxf-dev/core/models/agent', () => ({
    Agent: {
        find: mockAgentFind
    }
}));

jest.mock('@mxf-dev/core/models/channelKey', () => ({
    __esModule: true,
    default: {
        find: mockChannelKeyFind
    }
}));

jest.mock('@mxf-dev/core/models/agentIdentityReservation', () => ({
    __esModule: true,
    default: {
        findOneAndUpdate: mockReservationFindOneAndUpdate,
        findOne: mockReservationFindOne
    }
}));

jest.mock('@mxf-dev/core/models/memory', () => ({
    AgentMemory: { exists: mockAgentMemoryExists },
    RelationshipMemory: { exists: mockRelationshipMemoryExists }
}));

jest.mock('@mxf-dev/core/models/memoryStrata', () => ({
    MemoryEntryModel: { exists: mockMemoryEntryExists },
    SurpriseHistoryModel: { exists: mockSurpriseHistoryExists },
    MemoryPatternModel: { exists: mockMemoryPatternExists }
}));

jest.mock('@mxf-dev/core/models/memoryUtility', () => ({
    MemoryUtility: { exists: mockMemoryUtilityExists }
}));

jest.mock('@mxf-dev/core/utils/Logger', () => ({
    Logger: jest.fn().mockImplementation(() => ({
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn()
    }))
}));

import agentIdentityOwnershipService, {
    AgentIdentityOwnershipError
} from '../../../src/server/security/AgentIdentityOwnershipService';

interface ReservationRow {
    _id: string;
    agentId: string;
    ownerId: string;
    claimedAt: Date;
}

const ownerRowsQuery = (rows: Array<{ createdBy?: unknown }>): { select: jest.Mock } => ({
    select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue(rows)
    })
});

describe('AgentIdentityOwnershipService', () => {
    const reservations = new Map<string, ReservationRow>();

    beforeEach(() => {
        jest.clearAllMocks();
        reservations.clear();
        mockAgentFind.mockReturnValue(ownerRowsQuery([]));
        mockChannelKeyFind.mockReturnValue(ownerRowsQuery([]));
        mockAgentMemoryExists.mockResolvedValue(null);
        mockRelationshipMemoryExists.mockResolvedValue(null);
        mockMemoryEntryExists.mockResolvedValue(null);
        mockSurpriseHistoryExists.mockResolvedValue(null);
        mockMemoryPatternExists.mockResolvedValue(null);
        mockMemoryUtilityExists.mockResolvedValue(null);
        mockReservationFindOne.mockImplementation(async ({ _id }: { _id: string }) => (
            reservations.get(_id) ?? null
        ));
        mockReservationFindOneAndUpdate.mockImplementation(async (
            { _id }: { _id: string },
            update: { $setOnInsert: ReservationRow }
        ) => {
            const existing = reservations.get(_id);
            if (existing) {
                return existing;
            }

            const inserted = { ...update.$setOnInsert };
            reservations.set(_id, inserted);
            return inserted;
        });
    });

    it('elects exactly one owner when two tenants claim the same unowned agentId concurrently', async () => {
        const results = await Promise.allSettled([
            agentIdentityOwnershipService.claimOrValidate('global-agent', 'owner-a'),
            agentIdentityOwnershipService.claimOrValidate('global-agent', 'owner-b')
        ]);

        expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
        expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
        expect(results.find(result => result.status === 'rejected')).toMatchObject({
            reason: expect.objectContaining({
                name: 'AgentIdentityOwnershipError',
                code: 'OWNERSHIP_CONFLICT',
                statusCode: 409
            })
        });
        expect(reservations.size).toBe(1);
        expect(['owner-a', 'owner-b']).toContain(reservations.get('global-agent')?.ownerId);
    });

    it('allows the same owner to issue multiple channel keys for one agentId', async () => {
        await expect(
            agentIdentityOwnershipService.claimOrValidate('shared-agent', 'owner-a')
        ).resolves.toBeUndefined();
        await expect(
            agentIdentityOwnershipService.claimOrValidate('shared-agent', 'owner-a')
        ).resolves.toBeUndefined();

        expect(reservations.get('shared-agent')?.ownerId).toBe('owner-a');
    });

    it.each(['system', 'SYSTEM_AGENT', 'sdk_system_agent', 'system:workflow-engine'])(
        'denies external claim of reserved routing identity %s before reading persistence',
        async (agentId) => {
            await expect(
                agentIdentityOwnershipService.claimOrValidate(agentId, 'owner-a')
            ).rejects.toMatchObject({
                code: 'INVALID_IDENTITY',
                statusCode: 400
            });

            expect(mockAgentFind).not.toHaveBeenCalled();
            expect(mockChannelKeyFind).not.toHaveBeenCalled();
            expect(mockReservationFindOneAndUpdate).not.toHaveBeenCalled();
        }
    );

    it('preserves key-first ownership for later Agent creation by the same owner', async () => {
        await agentIdentityOwnershipService.claimOrValidate('key-first-agent', 'owner-a');

        // The later Agent row is now legacy evidence for the same owner.
        mockAgentFind.mockReturnValue(ownerRowsQuery([{ createdBy: 'owner-a' }]));

        await expect(
            agentIdentityOwnershipService.claimOrValidate('key-first-agent', 'owner-a')
        ).resolves.toBeUndefined();
    });

    it('denies an attacker claiming a victim agentId from persisted Agent ownership', async () => {
        mockAgentFind.mockReturnValue(ownerRowsQuery([{ createdBy: 'victim-owner' }]));

        await expect(
            agentIdentityOwnershipService.claimOrValidate('victim-agent', 'attacker-owner')
        ).rejects.toMatchObject({
            code: 'OWNERSHIP_CONFLICT',
            statusCode: 409
        });
        expect(mockReservationFindOneAndUpdate).not.toHaveBeenCalled();
    });

    it('fails closed with an actionable error for conflicting legacy Agent and ChannelKey owners', async () => {
        mockAgentFind.mockReturnValue(ownerRowsQuery([{ createdBy: 'owner-a' }]));
        mockChannelKeyFind.mockReturnValue(ownerRowsQuery([{ createdBy: 'owner-b' }]));

        await expect(
            agentIdentityOwnershipService.claimOrValidate('legacy-conflict', 'owner-a')
        ).rejects.toEqual(expect.objectContaining({
            code: 'LEGACY_OWNERSHIP_CONFLICT',
            message: expect.stringMatching(/reconcile.*persisted records/i)
        }));
        // No active/expiry predicate: revoked credentials remain durable
        // historical ownership evidence.
        expect(mockChannelKeyFind).toHaveBeenCalledWith({ agentId: 'legacy-conflict' });
        expect(mockReservationFindOneAndUpdate).not.toHaveBeenCalled();
    });

    it('keeps the reservation permanent when Agent and key evidence is later deleted', async () => {
        await agentIdentityOwnershipService.claimOrValidate('deleted-agent', 'owner-a');

        mockAgentFind.mockReturnValue(ownerRowsQuery([]));
        mockChannelKeyFind.mockReturnValue(ownerRowsQuery([]));

        await expect(
            agentIdentityOwnershipService.claimOrValidate('deleted-agent', 'owner-b')
        ).rejects.toMatchObject({ code: 'OWNERSHIP_CONFLICT' });
        expect(reservations.get('deleted-agent')?.ownerId).toBe('owner-a');
    });

    it('uses the unique-index winner after an upsert duplicate-key race', async () => {
        reservations.set('raced-agent', {
            _id: 'raced-agent',
            agentId: 'raced-agent',
            ownerId: 'owner-a',
            claimedAt: new Date()
        });
        mockReservationFindOne
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(reservations.get('raced-agent'));
        mockReservationFindOneAndUpdate.mockRejectedValueOnce({ code: 11000 });

        await expect(
            agentIdentityOwnershipService.claimOrValidate('raced-agent', 'owner-b')
        ).rejects.toMatchObject({ code: 'OWNERSHIP_CONFLICT' });
        expect(mockReservationFindOne).toHaveBeenCalledWith({ _id: 'raced-agent' });
    });

    it('fails closed when durable reservation storage is unavailable', async () => {
        mockReservationFindOneAndUpdate.mockRejectedValue(new Error('database unavailable'));

        await expect(
            agentIdentityOwnershipService.claimOrValidate('agent-a', 'owner-a')
        ).rejects.toEqual(expect.objectContaining({
            code: 'RESERVATION_UNAVAILABLE',
            statusCode: 503
        }));
    });

    it('denies first claim of an orphan-memory identity with admin remediation guidance', async () => {
        mockAgentMemoryExists.mockResolvedValue({ _id: 'orphan-memory' });

        await expect(
            agentIdentityOwnershipService.claimOrValidate('victim-agent', 'attacker-owner')
        ).rejects.toEqual(expect.objectContaining({
            code: 'ORPHANED_AGENT_STATE',
            statusCode: 409,
            message: expect.stringMatching(/administrator.*migrate.*remove/i)
        }));
        expect(mockReservationFindOneAndUpdate).not.toHaveBeenCalled();
    });

    it('fails closed when a legacy Agent has no usable owner', async () => {
        mockAgentFind.mockReturnValue(ownerRowsQuery([{}]));

        await expect(
            agentIdentityOwnershipService.claimOrValidate('ownerless-agent', 'first-caller')
        ).rejects.toEqual(expect.objectContaining({
            code: 'LEGACY_OWNERSHIP_CONFLICT',
            statusCode: 409,
            message: expect.stringMatching(/missing or malformed owners.*Agent.*reconcile/i)
        }));
        expect(mockReservationFindOneAndUpdate).not.toHaveBeenCalled();
    });

    it('fails closed when valid and ownerless legacy keys make ownership ambiguous', async () => {
        mockChannelKeyFind.mockReturnValue(ownerRowsQuery([
            { createdBy: 'owner-a' },
            { createdBy: null }
        ]));

        await expect(
            agentIdentityOwnershipService.claimOrValidate('ambiguous-agent', 'owner-a')
        ).rejects.toEqual(expect.objectContaining({
            code: 'LEGACY_OWNERSHIP_CONFLICT',
            statusCode: 409,
            message: expect.stringMatching(/ChannelKey.*reconcile/i)
        }));
        expect(mockReservationFindOneAndUpdate).not.toHaveBeenCalled();
    });

    it('rejects padded identities instead of silently canonicalizing different persisted values', async () => {
        await expect(
            agentIdentityOwnershipService.claimOrValidate(' agent-a', 'owner-a')
        ).rejects.toBeInstanceOf(AgentIdentityOwnershipError);
        expect(mockAgentFind).not.toHaveBeenCalled();
    });
});
