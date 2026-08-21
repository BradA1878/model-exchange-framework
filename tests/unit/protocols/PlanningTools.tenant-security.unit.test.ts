const mockPlanFindOne = jest.fn();
const mockPlanFind = jest.fn();
const mockChannelExists = jest.fn();
const mockEventEmit = jest.fn();
const savedPlanFields: Array<Record<string, unknown>> = [];

jest.mock('@mxf-dev/core/models/plan', () => {
    class MockPlanModel {
        public planId: string;
        public title: string;
        public createdBy: string;
        public channelId: string;
        public items: unknown[];
        public metadata: unknown;
        public createdAt = new Date('2026-01-01T00:00:00.000Z');

        public constructor(fields: Record<string, unknown>) {
            this.planId = fields.planId as string;
            this.title = fields.title as string;
            this.createdBy = fields.createdBy as string;
            this.channelId = fields.channelId as string;
            this.items = fields.items as unknown[];
            this.metadata = fields.metadata;
        }

        public async save(): Promise<this> {
            savedPlanFields.push({
                planId: this.planId,
                createdBy: this.createdBy,
                channelId: this.channelId
            });
            return this;
        }

        public static findOne = mockPlanFindOne;
        public static find = mockPlanFind;
    }

    return { __esModule: true, default: MockPlanModel };
});

jest.mock('@mxf-dev/core/models/channel', () => ({
    Channel: { exists: mockChannelExists }
}));

jest.mock('@mxf-dev/core/events/EventBus', () => ({
    EventBus: { server: { emit: mockEventEmit } }
}));

jest.mock('@mxf-dev/core/utils/Logger', () => ({
    Logger: jest.fn(() => ({
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn()
    }))
}));

jest.mock('uuid', () => ({ v4: jest.fn(() => 'plan-created') }));

import {
    planning_create,
    planning_share,
    planning_update_item,
    planning_view
} from '@mxf-dev/core/protocols/mcp/tools/PlanningTools';
import {
    McpToolHandlerContext,
    McpToolHandlerResult
} from '@mxf-dev/core/protocols/mcp/McpServerTypes';

const resultData = (result: unknown): unknown => (
    (result as McpToolHandlerResult).content.data
);

const channelAContext: McpToolHandlerContext = {
    requestId: 'request-a',
    agentId: 'agent-a',
    channelId: 'channel-a'
};

const buildPlanDocument = (): {
    planId: string;
    title: string;
    createdBy: string;
    channelId: string;
    createdAt: Date;
    items: Array<{ id: string; title: string; status: string }>;
    metadata: Record<string, unknown>;
    save: jest.Mock;
} => ({
    planId: 'shared-plan-id',
    title: 'Channel A plan',
    createdBy: 'agent-a',
    channelId: 'channel-a',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    items: [{ id: 'item-1', title: 'Scoped step', status: 'pending' }],
    metadata: {},
    save: jest.fn().mockResolvedValue(undefined)
});

describe('PlanningTools tenant scoping', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        savedPlanFields.length = 0;
        mockChannelExists.mockResolvedValue({ _id: 'channel-a' });
    });

    it('requires authenticated context before creating a persisted plan', async () => {
        const result = await planning_create.handler(
            { title: 'No tenant', items: [] },
            { requestId: 'missing-scope' }
        );

        expect(resultData(result)).toEqual(expect.objectContaining({
            error: expect.stringContaining('Authenticated agentId and channelId')
        }));
        expect(savedPlanFields).toHaveLength(0);
        expect(mockEventEmit).not.toHaveBeenCalled();
    });

    it('binds creation to the exact authenticated agent and channel', async () => {
        const result = await planning_create.handler(
            { title: 'Scoped plan', items: [{ title: 'Step one' }] },
            channelAContext
        );

        expect(savedPlanFields).toEqual([{
            planId: 'plan-created',
            createdBy: 'agent-a',
            channelId: 'channel-a'
        }]);
        expect(resultData(result)).toEqual(expect.objectContaining({ success: true }));
    });

    it('scopes foreign plan reads and updates in the database predicate', async () => {
        mockPlanFindOne.mockResolvedValue(null);

        const viewed = await planning_view.handler(
            { planId: 'shared-plan-id' },
            channelAContext
        );
        const updated = await planning_update_item.handler(
            { planId: 'shared-plan-id', itemId: 'item-1', status: 'completed' },
            channelAContext
        );

        expect(mockPlanFindOne).toHaveBeenNthCalledWith(1, {
            planId: 'shared-plan-id',
            channelId: 'channel-a'
        });
        expect(mockPlanFindOne).toHaveBeenNthCalledWith(2, {
            planId: 'shared-plan-id',
            channelId: 'channel-a'
        });
        expect(resultData(viewed)).toEqual(expect.objectContaining({
            error: expect.stringContaining('Plan not found')
        }));
        expect(resultData(updated)).toEqual(expect.objectContaining({
            error: expect.stringContaining('Plan not found')
        }));
        expect(mockEventEmit).not.toHaveBeenCalled();
    });

    it('allows same-channel update and emits only after persistence', async () => {
        const plan = buildPlanDocument();
        mockPlanFindOne.mockResolvedValue(plan);

        const result = await planning_update_item.handler(
            { planId: 'shared-plan-id', itemId: 'item-1', status: 'completed' },
            channelAContext
        );

        expect(plan.save).toHaveBeenCalledTimes(1);
        expect(resultData(result)).toEqual(expect.objectContaining({ success: true }));
        expect(mockEventEmit).toHaveBeenCalled();
    });

    it('rejects a foreign share target before emitting any plan content', async () => {
        mockPlanFindOne.mockResolvedValue(buildPlanDocument());
        mockChannelExists.mockResolvedValue(null);

        const result = await planning_share.handler(
            { planId: 'shared-plan-id', agentIds: ['agent-in-channel-b'] },
            channelAContext
        );

        expect(mockChannelExists).toHaveBeenCalledWith({
            channelId: 'channel-a',
            active: true,
            participants: { $all: ['agent-in-channel-b'] }
        });
        expect(resultData(result)).toEqual(expect.objectContaining({ success: false }));
        expect(mockEventEmit).not.toHaveBeenCalled();
    });

    it('does not load or share a plan from another channel', async () => {
        mockPlanFindOne.mockResolvedValue(null);

        const result = await planning_share.handler(
            { planId: 'foreign-plan', agentIds: ['agent-peer'] },
            channelAContext
        );

        expect(mockPlanFindOne).toHaveBeenCalledWith({
            planId: 'foreign-plan',
            channelId: 'channel-a'
        });
        expect(resultData(result)).toEqual(expect.objectContaining({
            error: expect.stringContaining('Plan not found')
        }));
        expect(mockChannelExists).not.toHaveBeenCalled();
        expect(mockEventEmit).not.toHaveBeenCalled();
    });

    it('queues same-channel sharing without claiming confirmed delivery', async () => {
        mockPlanFindOne.mockResolvedValue(buildPlanDocument());

        const result = await planning_share.handler(
            { planId: 'shared-plan-id', agentIds: ['agent-peer'] },
            channelAContext
        );

        expect(resultData(result)).toEqual(expect.objectContaining({
            success: true,
            sharedWith: ['agent-peer'],
            deliveryConfirmed: false
        }));
        expect(mockEventEmit).toHaveBeenCalledTimes(1);
    });
});
