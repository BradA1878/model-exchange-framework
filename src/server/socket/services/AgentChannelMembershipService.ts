import { ChannelService } from './ChannelService';

interface Membership {
    agentId: string;
    channelId: string;
    sockets: Set<string>;
    settled: Promise<void>;
}

/** Serialize participant changes so an old disconnect cannot undo a new join. */
export class AgentChannelMembershipService {
    private static instance: AgentChannelMembershipService | undefined;
    private readonly memberships = new Map<string, Membership>();
    private readonly sockets = new Map<string, Membership>();

    public static getInstance(): AgentChannelMembershipService {
        return this.instance ??= new AgentChannelMembershipService();
    }

    public acquire(agentId: string, channelId: string, socketId: string): Promise<void> {
        const key = JSON.stringify([agentId, channelId]);
        let membership = this.memberships.get(key);
        if (!membership) {
            membership = { agentId, channelId, sockets: new Set(), settled: Promise.resolve() };
            this.memberships.set(key, membership);
        }
        membership.sockets.add(socketId);
        this.sockets.set(socketId, membership);
        const current = membership;
        return this.enqueue(current, async () => {
            if (!current.sockets.has(socketId)) throw new Error('Socket disconnected before channel admission');
            if (!await ChannelService.getInstance().addParticipant(channelId, agentId, agentId)) {
                throw new Error(`Authenticated channel ${channelId} is unavailable`);
            }
            if (!current.sockets.has(socketId)) throw new Error('Socket disconnected during channel admission');
        });
    }

    public release(socketId: string): Promise<void> {
        const membership = this.sockets.get(socketId);
        if (!membership) return Promise.resolve();
        this.sockets.delete(socketId);
        membership.sockets.delete(socketId);
        return this.enqueue(membership, async () => {
            if (membership.sockets.size !== 0) return;
            await ChannelService.getInstance().removeParticipant(membership.channelId, membership.agentId, membership.agentId);
            const key = JSON.stringify([membership.agentId, membership.channelId]);
            if (membership.sockets.size === 0 && this.memberships.get(key) === membership) this.memberships.delete(key);
        });
    }

    private enqueue(membership: Membership, operation: () => Promise<void>): Promise<void> {
        const result = membership.settled.then(operation);
        // The caller receives the original rejection. Later cleanup must still
        // run when an earlier join failed or its socket was cancelled.
        membership.settled = result.then(() => undefined, () => undefined);
        return result;
    }
}
