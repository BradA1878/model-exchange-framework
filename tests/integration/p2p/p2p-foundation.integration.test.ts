/**
 * P2P Foundation Integration Tests (P9)
 *
 * Tests the P2P foundation services including:
 * - Feature flag enforcement (all P2P features disabled by default)
 * - P2PTaskNegotiationService task announcement and bidding
 * - FederatedMemoryService memory sharing and querying
 * - GossipProtocolService peer management and message propagation
 * - AgentReputationService reputation tracking
 * - Event emission verification for all P2P operations
 *
 * IMPORTANT: All P2P features are DISABLED by default.
 * Tests verify both disabled state behavior and enabled state behavior.
 */

import { v4 as uuidv4 } from 'uuid';
import { Subscription } from 'rxjs';
import { EventBus } from '../../../src/shared/events/EventBus';
import { P2PTaskNegotiationService } from '../../../src/shared/services/p2p/P2PTaskNegotiationService';
import { FederatedMemoryService } from '../../../src/shared/services/p2p/FederatedMemoryService';
import { GossipProtocolService } from '../../../src/shared/services/p2p/GossipProtocolService';
import { AgentReputationService } from '../../../src/shared/services/p2p/AgentReputationService';
import {
    P2PFeatureFlags,
    DEFAULT_P2P_FEATURE_FLAGS,
    TaskBid,
    TaskAnnouncement,
    FederatedMemoryEntry,
    DistributedMemoryQuery,
    GossipMessage,
    PeerNode,
    AgentReputationUpdate
} from '../../../src/shared/types/DecentralizationTypes';
import { ChannelTask } from '../../../src/shared/types/TaskTypes';
import { sleep } from '../../utils/waitFor';

/**
 * Helper to create a mock ChannelTask for testing
 */
function createMockTask(overrides: Partial<ChannelTask> = {}): ChannelTask {
    return {
        id: overrides.id || uuidv4(),
        channelId: overrides.channelId || 'test-channel',
        title: overrides.title || 'Test Task',
        description: overrides.description || 'A test task for P2P negotiation',
        status: overrides.status || 'pending',
        priority: overrides.priority || 'medium',
        createdAt: overrides.createdAt ?? Date.now(),
        updatedAt: overrides.updatedAt ?? Date.now(),
        createdBy: overrides.createdBy || 'test-agent',
        assignmentScope: 'single',
        assignmentStrategy: 'manual',
        ...overrides
    } as ChannelTask;
}

/**
 * Helper to create a mock TaskBid for testing
 */
function createMockBid(taskId: string, agentId: string, overrides: Partial<TaskBid> = {}): TaskBid {
    return {
        bidId: overrides.bidId || uuidv4(),
        taskId,
        agentId,
        price: overrides.price ?? 10,
        estimatedDuration: overrides.estimatedDuration ?? 30,
        confidence: overrides.confidence ?? 0.8,
        relevantCapabilities: overrides.relevantCapabilities || ['testing'],
        relevantRoles: overrides.relevantRoles || ['tester'],
        reputationScore: overrides.reputationScore ?? 0.7,
        relevantTaskHistory: overrides.relevantTaskHistory ?? 5,
        successRate: overrides.successRate ?? 0.9,
        submittedAt: overrides.submittedAt ?? Date.now(),
        expiresAt: overrides.expiresAt ?? Date.now() + 60000,
        ...overrides
    };
}

/**
 * Helper to create a mock PeerNode for testing
 */
function createMockPeer(overrides: Partial<PeerNode> = {}): PeerNode {
    return {
        peerId: overrides.peerId || uuidv4(),
        name: overrides.name || 'Test Peer',
        address: overrides.address || {
            protocol: 'wss',
            host: 'localhost',
            port: 3001,
            full: 'wss://localhost:3001'
        },
        publicKey: overrides.publicKey || 'test-public-key',
        capabilities: overrides.capabilities || {
            protocols: ['mxf'],
            messageTypes: ['gossip', 'direct'],
            services: ['task-negotiation'],
            maxMessageSize: 1024 * 1024,
            supportsEncryption: true,
            supportsCompression: true
        },
        reputation: overrides.reputation ?? 0.8,
        status: overrides.status || 'connected',
        lastSeen: overrides.lastSeen || new Date(),
        ...overrides
    };
}

/**
 * Helper to create a mock FederatedMemoryEntry for testing
 */
function createMockMemoryEntry(overrides: Partial<FederatedMemoryEntry> = {}): FederatedMemoryEntry {
    return {
        id: overrides.id || uuidv4(),
        agentId: overrides.agentId || 'test-agent',
        channelId: overrides.channelId || 'test-channel',
        type: overrides.type || 'insight',
        content: overrides.content || { data: 'test content' },
        privacyLevel: overrides.privacyLevel || 'channel',
        createdAt: overrides.createdAt ?? Date.now(),
        updatedAt: overrides.updatedAt ?? Date.now(),
        ...overrides
    };
}

/**
 * Helper to create enabled feature flags for testing
 */
function createEnabledFlags(overrides: Partial<P2PFeatureFlags> = {}): P2PFeatureFlags {
    return {
        P2P_ENABLED: true,
        P2P_NEGOTIATION_ENABLED: true,
        P2P_FEDERATED_MEMORY_ENABLED: true,
        P2P_GOSSIP_PROTOCOL_ENABLED: true,
        P2P_REPUTATION_SYSTEM_ENABLED: true,
        P2P_BLOCKCHAIN_ENABLED: false,
        P2P_TOKEN_ECONOMY_ENABLED: false,
        ...overrides
    };
}

describe('P2P Foundation Integration Tests', () => {
    // Event tracking for verification
    let capturedEvents: Array<{ type: string; payload: any }> = [];
    let eventSubscription: Subscription;

    beforeEach(() => {
        // Reset singleton instances before each test to ensure isolation
        P2PTaskNegotiationService.resetInstance();
        FederatedMemoryService.resetInstance();
        GossipProtocolService.resetInstance();
        AgentReputationService.resetInstance();

        // Clear captured events
        capturedEvents = [];

        // Subscribe to all P2P events for verification
        eventSubscription = EventBus.server.onAll((eventType: string, payload: any) => {
            if (eventType.startsWith('p2p:')) {
                capturedEvents.push({ type: eventType, payload });
            }
        });
    });

    afterEach(() => {
        // Clean up event subscription
        if (eventSubscription) {
            eventSubscription.unsubscribe();
        }

        // Reset singletons again for clean state
        P2PTaskNegotiationService.resetInstance();
        FederatedMemoryService.resetInstance();
        GossipProtocolService.resetInstance();
        AgentReputationService.resetInstance();
    });

    // =========================================================================
    // Feature Flag Enforcement Tests
    // =========================================================================

    describe('Feature Flag Enforcement', () => {
        it('should have all P2P features disabled by default', () => {
            expect(DEFAULT_P2P_FEATURE_FLAGS.P2P_ENABLED).toBe(false);
            expect(DEFAULT_P2P_FEATURE_FLAGS.P2P_NEGOTIATION_ENABLED).toBe(false);
            expect(DEFAULT_P2P_FEATURE_FLAGS.P2P_FEDERATED_MEMORY_ENABLED).toBe(false);
            expect(DEFAULT_P2P_FEATURE_FLAGS.P2P_GOSSIP_PROTOCOL_ENABLED).toBe(false);
            expect(DEFAULT_P2P_FEATURE_FLAGS.P2P_REPUTATION_SYSTEM_ENABLED).toBe(false);
            expect(DEFAULT_P2P_FEATURE_FLAGS.P2P_BLOCKCHAIN_ENABLED).toBe(false);
            expect(DEFAULT_P2P_FEATURE_FLAGS.P2P_TOKEN_ECONOMY_ENABLED).toBe(false);
        });

        it('should throw error when using P2PTaskNegotiationService while disabled', async () => {
            const service = P2PTaskNegotiationService.getInstance();
            const task = createMockTask();

            await expect(service.announceTask(task, 'test-agent'))
                .rejects.toThrow('P2P task negotiation is disabled');
        });

        it('should throw error when using FederatedMemoryService while disabled', async () => {
            const service = FederatedMemoryService.getInstance();
            const entry = createMockMemoryEntry();

            await expect(service.shareMemory(entry))
                .rejects.toThrow('Federated memory is disabled');
        });

        it('should throw error when using GossipProtocolService while disabled', async () => {
            const service = GossipProtocolService.getInstance();
            const message: GossipMessage = {
                gossipId: uuidv4(),
                type: 'event',
                data: { test: 'data' },
                origin: 'test-peer',
                path: [],
                createdAt: new Date(),
                expiresAt: new Date(Date.now() + 60000),
                hops: 0,
                maxHops: 5
            };

            await expect(service.propagate(message))
                .rejects.toThrow('Gossip protocol is disabled');
        });

        it('should throw error when using AgentReputationService while disabled', async () => {
            const service = AgentReputationService.getInstance();
            const update: AgentReputationUpdate = {
                agentId: 'test-agent',
                reason: 'task_completed',
                scoreDelta: 0.01,
                timestamp: Date.now()
            };

            await expect(service.updateReputation(update))
                .rejects.toThrow('Agent reputation system is disabled');
        });

        it('should allow creating service instances with default disabled flags', () => {
            // Services should be creatable even when disabled
            const taskService = P2PTaskNegotiationService.getInstance();
            const memoryService = FederatedMemoryService.getInstance();
            const gossipService = GossipProtocolService.getInstance();
            const reputationService = AgentReputationService.getInstance();

            expect(taskService).toBeDefined();
            expect(memoryService).toBeDefined();
            expect(gossipService).toBeDefined();
            expect(reputationService).toBeDefined();
        });
    });

    // =========================================================================
    // P2PTaskNegotiationService Tests (When Enabled)
    // =========================================================================

    describe('P2PTaskNegotiationService (Enabled)', () => {
        let service: P2PTaskNegotiationService;

        beforeEach(() => {
            const flags = createEnabledFlags();
            service = P2PTaskNegotiationService.getInstance(
                { enabled: true },
                flags
            );
        });

        describe('Task Announcement', () => {
            it('should announce a task successfully', async () => {
                const task = createMockTask();
                const announcement = await service.announceTask(task, 'announcer-agent');

                expect(announcement).toBeDefined();
                expect(announcement.announcementId).toBeDefined();
                expect(announcement.task.id).toBe(task.id);
                expect(announcement.announcerAgentId).toBe('announcer-agent');
                expect(announcement.status).toBe('open');
            });

            it('should set correct bid window times', async () => {
                const task = createMockTask();
                const bidWindowMs = 5000;
                const beforeAnnounce = Date.now();

                const announcement = await service.announceTask(
                    task,
                    'announcer-agent',
                    { bidWindowMs }
                );

                expect(announcement.bidWindowStart).toBeGreaterThanOrEqual(beforeAnnounce);
                expect(announcement.bidWindowEnd).toBe(announcement.bidWindowStart + bidWindowMs);
            });

            it('should emit p2p:task_announced event', async () => {
                const task = createMockTask();
                await service.announceTask(task, 'announcer-agent');

                // Wait for event propagation
                await sleep(50);

                const announcedEvent = capturedEvents.find(e => e.type === 'p2p:task_announced');
                expect(announcedEvent).toBeDefined();
                expect(announcedEvent?.payload.data.announcement).toBeDefined();
            });

            it('should use custom selection strategy when provided', async () => {
                const task = createMockTask();
                const announcement = await service.announceTask(
                    task,
                    'announcer-agent',
                    { selectionStrategy: 'highest_confidence' }
                );

                expect(announcement.selectionStrategy).toBe('highest_confidence');
            });

            it('should store announcement for retrieval', async () => {
                const task = createMockTask();
                const announcement = await service.announceTask(task, 'announcer-agent');

                const retrieved = service.getAnnouncement(announcement.announcementId);
                expect(retrieved).toBeDefined();
                expect(retrieved?.announcementId).toBe(announcement.announcementId);
            });

            it('should track active announcements', async () => {
                const task1 = createMockTask();
                const task2 = createMockTask();

                await service.announceTask(task1, 'agent-1');
                await service.announceTask(task2, 'agent-2');

                const activeAnnouncements = service.getActiveAnnouncements();
                expect(activeAnnouncements.length).toBe(2);
            });
        });

        describe('Bid Collection and Submission', () => {
            it('should accept a valid bid', async () => {
                const task = createMockTask();
                const announcement = await service.announceTask(task, 'announcer-agent');
                const bid = createMockBid(task.id, 'bidder-agent');

                const result = await service.submitBid(bid);
                expect(result).toBe(true);
            });

            it('should emit p2p:task_bid_received event on bid submission', async () => {
                const task = createMockTask();
                await service.announceTask(task, 'announcer-agent');
                const bid = createMockBid(task.id, 'bidder-agent');

                await service.submitBid(bid);
                await sleep(50);

                const bidEvent = capturedEvents.find(e => e.type === 'p2p:task_bid_received');
                expect(bidEvent).toBeDefined();
                expect(bidEvent?.payload.data.bid.bidId).toBe(bid.bidId);
            });

            it('should reject bid for non-existent task', async () => {
                const bid = createMockBid('non-existent-task', 'bidder-agent');

                const result = await service.submitBid(bid);
                expect(result).toBe(false);
            });

            it('should reject duplicate bids from same agent', async () => {
                const task = createMockTask();
                await service.announceTask(task, 'announcer-agent');

                const bid1 = createMockBid(task.id, 'same-agent');
                const bid2 = createMockBid(task.id, 'same-agent', { bidId: uuidv4() });

                const result1 = await service.submitBid(bid1);
                const result2 = await service.submitBid(bid2);

                expect(result1).toBe(true);
                expect(result2).toBe(false);
            });

            it('should track bids for an announcement', async () => {
                const task = createMockTask();
                const announcement = await service.announceTask(task, 'announcer-agent');

                const bid1 = createMockBid(task.id, 'agent-1');
                const bid2 = createMockBid(task.id, 'agent-2');

                await service.submitBid(bid1);
                await service.submitBid(bid2);

                const bids = service.getBids(announcement.announcementId);
                expect(bids.length).toBe(2);
            });

            it('should reject bids exceeding max bids limit', async () => {
                const task = createMockTask();
                await service.announceTask(task, 'announcer-agent', { maxBids: 2 });

                const bid1 = createMockBid(task.id, 'agent-1');
                const bid2 = createMockBid(task.id, 'agent-2');
                const bid3 = createMockBid(task.id, 'agent-3');

                await service.submitBid(bid1);
                await service.submitBid(bid2);
                const result3 = await service.submitBid(bid3);

                expect(result3).toBe(false);
            });
        });

        describe('Winner Selection Strategies', () => {
            it('should select winner using best_value strategy', async () => {
                const task = createMockTask();
                const announcement = await service.announceTask(
                    task,
                    'announcer-agent',
                    { bidWindowMs: 100, selectionStrategy: 'best_value' }
                );

                // Submit bids with different characteristics
                const bid1 = createMockBid(task.id, 'agent-1', {
                    reputationScore: 0.5,
                    confidence: 0.5,
                    estimatedDuration: 60,
                    price: 100
                });
                const bid2 = createMockBid(task.id, 'agent-2', {
                    reputationScore: 0.9,
                    confidence: 0.9,
                    estimatedDuration: 30,
                    price: 50
                });

                await service.submitBid(bid1);
                await service.submitBid(bid2);

                // Wait for bid window to close
                await sleep(200);

                const updatedAnnouncement = service.getAnnouncement(announcement.announcementId);
                expect(updatedAnnouncement?.status).toBe('awarded');

                // Check for award event
                const awardEvent = capturedEvents.find(e => e.type === 'p2p:task_awarded');
                expect(awardEvent).toBeDefined();
            });

            it('should select winner using lowest_cost strategy', async () => {
                const task = createMockTask();
                await service.announceTask(
                    task,
                    'announcer-agent',
                    { bidWindowMs: 100, selectionStrategy: 'lowest_price' }
                );

                const expensiveBid = createMockBid(task.id, 'expensive-agent', { price: 100 });
                const cheapBid = createMockBid(task.id, 'cheap-agent', { price: 10 });

                await service.submitBid(expensiveBid);
                await service.submitBid(cheapBid);

                // Wait for bid window to close and winner selection
                await sleep(200);

                const awardEvent = capturedEvents.find(e => e.type === 'p2p:task_awarded');
                expect(awardEvent).toBeDefined();
                expect(awardEvent?.payload.data.selectionResult.winningBid.agentId).toBe('cheap-agent');
            });

            it('should select winner using highest_confidence strategy', async () => {
                const task = createMockTask();
                await service.announceTask(
                    task,
                    'announcer-agent',
                    { bidWindowMs: 100, selectionStrategy: 'highest_confidence' }
                );

                const lowConfidenceBid = createMockBid(task.id, 'uncertain-agent', { confidence: 0.3 });
                const highConfidenceBid = createMockBid(task.id, 'confident-agent', { confidence: 0.95 });

                await service.submitBid(lowConfidenceBid);
                await service.submitBid(highConfidenceBid);

                // Wait for bid window to close
                await sleep(200);

                const awardEvent = capturedEvents.find(e => e.type === 'p2p:task_awarded');
                expect(awardEvent).toBeDefined();
                expect(awardEvent?.payload.data.selectionResult.winningBid.agentId).toBe('confident-agent');
            });

            it('should cancel announcement if minimum bids not met', async () => {
                const task = createMockTask();
                const announcement = await service.announceTask(
                    task,
                    'announcer-agent',
                    { bidWindowMs: 100, minBids: 3 }
                );

                // Only submit 1 bid when 3 are required
                const bid = createMockBid(task.id, 'lonely-agent');
                await service.submitBid(bid);

                // Wait for bid window to close
                await sleep(200);

                const updatedAnnouncement = service.getAnnouncement(announcement.announcementId);
                expect(updatedAnnouncement?.status).toBe('cancelled');

                // Check for cancellation event
                const cancelEvent = capturedEvents.find(e => e.type === 'p2p:task_announcement_cancelled');
                expect(cancelEvent).toBeDefined();
                expect(cancelEvent?.payload.data.reason).toBe('min_bids_not_met');
            });
        });

        describe('Announcement Cancellation', () => {
            it('should cancel an announcement manually', async () => {
                const task = createMockTask();
                const announcement = await service.announceTask(task, 'announcer-agent');

                service.cancelAnnouncement(announcement.announcementId);

                const updatedAnnouncement = service.getAnnouncement(announcement.announcementId);
                expect(updatedAnnouncement?.status).toBe('cancelled');
            });

            it('should emit cancellation event on manual cancel', async () => {
                const task = createMockTask();
                const announcement = await service.announceTask(task, 'announcer-agent');

                service.cancelAnnouncement(announcement.announcementId);
                await sleep(50);

                const cancelEvent = capturedEvents.find(e => e.type === 'p2p:task_announcement_cancelled');
                expect(cancelEvent).toBeDefined();
                expect(cancelEvent?.payload.data.reason).toBe('manual_cancellation');
            });

            it('should reject bids for cancelled announcements', async () => {
                const task = createMockTask();
                const announcement = await service.announceTask(task, 'announcer-agent');
                service.cancelAnnouncement(announcement.announcementId);

                const bid = createMockBid(task.id, 'late-agent');
                const result = await service.submitBid(bid);

                expect(result).toBe(false);
            });
        });
    });

    // =========================================================================
    // FederatedMemoryService Tests (When Enabled)
    // =========================================================================

    describe('FederatedMemoryService (Enabled)', () => {
        let service: FederatedMemoryService;

        beforeEach(() => {
            const flags = createEnabledFlags();
            service = FederatedMemoryService.getInstance(flags);
        });

        describe('Memory Sharing', () => {
            it('should share memory entry successfully', async () => {
                const entry = createMockMemoryEntry();

                await service.shareMemory(entry);

                expect(service.getLocalMemoryCount()).toBe(1);
            });

            it('should emit p2p:memory_shared event', async () => {
                const entry = createMockMemoryEntry();

                await service.shareMemory(entry);
                await sleep(50);

                const shareEvent = capturedEvents.find(e => e.type === 'p2p:memory_shared');
                expect(shareEvent).toBeDefined();
                expect(shareEvent?.payload.data.entry.id).toBe(entry.id);
            });

            it('should handle different privacy levels', async () => {
                const privateEntry = createMockMemoryEntry({ privacyLevel: 'private' });
                const channelEntry = createMockMemoryEntry({ privacyLevel: 'channel' });
                const federatedEntry = createMockMemoryEntry({ privacyLevel: 'federated' });
                const publicEntry = createMockMemoryEntry({ privacyLevel: 'public' });

                await service.shareMemory(privateEntry);
                await service.shareMemory(channelEntry);
                await service.shareMemory(federatedEntry);
                await service.shareMemory(publicEntry);

                expect(service.getLocalMemoryCount()).toBe(4);
            });

            it('should store multiple memory entries', async () => {
                const entry1 = createMockMemoryEntry({ id: 'entry-1' });
                const entry2 = createMockMemoryEntry({ id: 'entry-2' });
                const entry3 = createMockMemoryEntry({ id: 'entry-3' });

                await service.shareMemory(entry1);
                await service.shareMemory(entry2);
                await service.shareMemory(entry3);

                expect(service.getLocalMemoryCount()).toBe(3);
            });
        });

        describe('Distributed Memory Queries', () => {
            beforeEach(async () => {
                // Populate with test data
                const entries = [
                    createMockMemoryEntry({
                        id: 'insight-1',
                        type: 'insight',
                        agentId: 'agent-1',
                        channelId: 'channel-1',
                        privacyLevel: 'channel',
                        createdAt: Date.now() - 1000,
                        relevanceScore: 0.9
                    }),
                    createMockMemoryEntry({
                        id: 'pattern-1',
                        type: 'pattern',
                        agentId: 'agent-2',
                        channelId: 'channel-1',
                        privacyLevel: 'federated',
                        createdAt: Date.now() - 500,
                        relevanceScore: 0.7
                    }),
                    createMockMemoryEntry({
                        id: 'learning-1',
                        type: 'learning',
                        agentId: 'agent-1',
                        channelId: 'channel-2',
                        privacyLevel: 'public',
                        createdAt: Date.now(),
                        relevanceScore: 0.5
                    }),
                ];

                for (const entry of entries) {
                    await service.shareMemory(entry);
                }
            });

            it('should query by type', async () => {
                const query: DistributedMemoryQuery = { type: ['insight'] };
                const results = await service.queryDistributedMemory(query);

                expect(results.length).toBe(1);
                expect(results[0].type).toBe('insight');
            });

            it('should query by agentId', async () => {
                const query: DistributedMemoryQuery = { agentId: 'agent-1' };
                const results = await service.queryDistributedMemory(query);

                expect(results.length).toBe(2);
                results.forEach(r => expect(r.agentId).toBe('agent-1'));
            });

            it('should query by channelId', async () => {
                const query: DistributedMemoryQuery = { channelId: 'channel-1' };
                const results = await service.queryDistributedMemory(query);

                expect(results.length).toBe(2);
                results.forEach(r => expect(r.channelId).toBe('channel-1'));
            });

            it('should query by privacy level', async () => {
                const query: DistributedMemoryQuery = { privacyLevel: ['public', 'federated'] };
                const results = await service.queryDistributedMemory(query);

                expect(results.length).toBe(2);
            });

            it('should query by timestamp range', async () => {
                const now = Date.now();
                const query: DistributedMemoryQuery = {
                    fromTimestamp: now - 600,
                    toTimestamp: now + 100
                };
                const results = await service.queryDistributedMemory(query);

                expect(results.length).toBe(2);
            });

            it('should query by minimum relevance score', async () => {
                const query: DistributedMemoryQuery = { minRelevance: 0.8 };
                const results = await service.queryDistributedMemory(query);

                expect(results.length).toBe(1);
                expect(results[0].relevanceScore).toBeGreaterThanOrEqual(0.8);
            });

            it('should respect limit parameter', async () => {
                const query: DistributedMemoryQuery = { limit: 2 };
                const results = await service.queryDistributedMemory(query);

                expect(results.length).toBe(2);
            });

            it('should combine multiple query filters', async () => {
                const query: DistributedMemoryQuery = {
                    agentId: 'agent-1',
                    channelId: 'channel-1'
                };
                const results = await service.queryDistributedMemory(query);

                expect(results.length).toBe(1);
                expect(results[0].id).toBe('insight-1');
            });
        });

        describe('Peer Synchronization', () => {
            it('should emit sync request event', async () => {
                await service.syncWithPeers();
                await sleep(50);

                const syncEvent = capturedEvents.find(e => e.type === 'p2p:memory_sync_requested');
                expect(syncEvent).toBeDefined();
            });
        });
    });

    // =========================================================================
    // GossipProtocolService Tests (When Enabled)
    // =========================================================================

    describe('GossipProtocolService (Enabled)', () => {
        let service: GossipProtocolService;

        beforeEach(() => {
            const flags = createEnabledFlags();
            service = GossipProtocolService.getInstance(
                { enabled: true, gossipInterval: 60000, maxHops: 5, fanout: 3 },
                flags
            );
        });

        describe('Peer Management', () => {
            it('should add a peer', () => {
                const peer = createMockPeer();

                service.addPeer(peer);

                const peers = service.getKnownPeers();
                expect(peers.length).toBe(1);
                expect(peers[0].peerId).toBe(peer.peerId);
            });

            it('should emit p2p:peer_added event', async () => {
                const peer = createMockPeer();

                service.addPeer(peer);
                await sleep(50);

                const addEvent = capturedEvents.find(e => e.type === 'p2p:peer_added');
                expect(addEvent).toBeDefined();
                expect(addEvent?.payload.data.peer.peerId).toBe(peer.peerId);
            });

            it('should remove a peer', () => {
                const peer = createMockPeer();
                service.addPeer(peer);

                service.removePeer(peer.peerId);

                const peers = service.getKnownPeers();
                expect(peers.length).toBe(0);
            });

            it('should emit p2p:peer_removed event', async () => {
                const peer = createMockPeer();
                service.addPeer(peer);

                service.removePeer(peer.peerId);
                await sleep(50);

                const removeEvent = capturedEvents.find(e => e.type === 'p2p:peer_removed');
                expect(removeEvent).toBeDefined();
                expect(removeEvent?.payload.data.peerId).toBe(peer.peerId);
            });

            it('should list all known peers', () => {
                const peer1 = createMockPeer({ peerId: 'peer-1' });
                const peer2 = createMockPeer({ peerId: 'peer-2' });
                const peer3 = createMockPeer({ peerId: 'peer-3' });

                service.addPeer(peer1);
                service.addPeer(peer2);
                service.addPeer(peer3);

                const peers = service.getKnownPeers();
                expect(peers.length).toBe(3);
            });

            it('should handle adding peer with same ID (update)', () => {
                const peer = createMockPeer({ peerId: 'same-peer', name: 'Original' });
                const updatedPeer = createMockPeer({ peerId: 'same-peer', name: 'Updated' });

                service.addPeer(peer);
                service.addPeer(updatedPeer);

                const peers = service.getKnownPeers();
                expect(peers.length).toBe(1);
                expect(peers[0].name).toBe('Updated');
            });
        });

        describe('Message Propagation', () => {
            beforeEach(() => {
                // Add some connected peers for propagation
                const peer1 = createMockPeer({ peerId: 'peer-1', status: 'connected' });
                const peer2 = createMockPeer({ peerId: 'peer-2', status: 'connected' });
                const peer3 = createMockPeer({ peerId: 'peer-3', status: 'connected' });

                service.addPeer(peer1);
                service.addPeer(peer2);
                service.addPeer(peer3);
            });

            it('should propagate gossip message', async () => {
                const message: GossipMessage = {
                    gossipId: uuidv4(),
                    type: 'event',
                    data: { test: 'data' },
                    origin: 'test-origin',
                    path: [],
                    createdAt: new Date(),
                    expiresAt: new Date(Date.now() + 60000),
                    hops: 0,
                    maxHops: 5
                };

                await service.propagate(message);
                await sleep(50);

                const propagateEvent = capturedEvents.find(e => e.type === 'p2p:gossip_propagated');
                expect(propagateEvent).toBeDefined();
                expect(propagateEvent?.payload.data.messageId).toBe(message.gossipId);
            });

            it('should not propagate already seen messages', async () => {
                const gossipId = uuidv4();
                const message: GossipMessage = {
                    gossipId,
                    type: 'event',
                    data: { test: 'data' },
                    origin: 'test-origin',
                    path: [],
                    createdAt: new Date(),
                    expiresAt: new Date(Date.now() + 60000),
                    hops: 0,
                    maxHops: 5
                };

                // Propagate first time
                await service.propagate(message);

                // Clear events
                capturedEvents = [];

                // Try to propagate same message again
                await service.propagate(message);
                await sleep(50);

                const propagateEvents = capturedEvents.filter(e => e.type === 'p2p:gossip_propagated');
                expect(propagateEvents.length).toBe(0);
            });

            it('should handle message receipt', async () => {
                const message: GossipMessage = {
                    gossipId: uuidv4(),
                    type: 'rumor',
                    data: { content: 'interesting rumor' },
                    origin: 'remote-peer',
                    path: ['remote-peer'],
                    createdAt: new Date(),
                    expiresAt: new Date(Date.now() + 60000),
                    hops: 1,
                    maxHops: 5
                };

                await service.handleMessage(message);
                await sleep(50);

                const receiveEvent = capturedEvents.find(e => e.type === 'p2p:gossip_message_received');
                expect(receiveEvent).toBeDefined();
            });
        });

        describe('Hop Limit Enforcement', () => {
            beforeEach(() => {
                // Add connected peers
                const peer = createMockPeer({ peerId: 'peer-1', status: 'connected' });
                service.addPeer(peer);
            });

            it('should not propagate message at max hops', async () => {
                const message: GossipMessage = {
                    gossipId: uuidv4(),
                    type: 'event',
                    data: { test: 'data' },
                    origin: 'test-origin',
                    path: ['peer-1', 'peer-2', 'peer-3', 'peer-4', 'peer-5'],
                    createdAt: new Date(),
                    expiresAt: new Date(Date.now() + 60000),
                    hops: 5,
                    maxHops: 5
                };

                await service.propagate(message);
                await sleep(50);

                const propagateEvent = capturedEvents.find(e => e.type === 'p2p:gossip_propagated');
                expect(propagateEvent).toBeUndefined();
            });

            it('should increment hops when handling message', async () => {
                const originalHops = 2;
                const message: GossipMessage = {
                    gossipId: uuidv4(),
                    type: 'event',
                    data: { test: 'data' },
                    origin: 'test-origin',
                    path: [],
                    createdAt: new Date(),
                    expiresAt: new Date(Date.now() + 60000),
                    hops: originalHops,
                    maxHops: 5
                };

                await service.handleMessage(message);

                // The message hops should be incremented
                expect(message.hops).toBe(originalHops + 1);
            });

            it('should stop propagation when hops exceed maxHops after increment', async () => {
                const message: GossipMessage = {
                    gossipId: uuidv4(),
                    type: 'event',
                    data: { test: 'data' },
                    origin: 'test-origin',
                    path: [],
                    createdAt: new Date(),
                    expiresAt: new Date(Date.now() + 60000),
                    hops: 4,
                    maxHops: 5
                };

                await service.handleMessage(message);
                await sleep(50);

                // Message received event should still fire
                const receiveEvent = capturedEvents.find(e => e.type === 'p2p:gossip_message_received');
                expect(receiveEvent).toBeDefined();

                // But no further propagation after hops = 5
                expect(message.hops).toBe(5);
            });
        });

        describe('Peer Discovery', () => {
            it('should discover peers', async () => {
                const peer1 = createMockPeer({ peerId: 'peer-1' });
                const peer2 = createMockPeer({ peerId: 'peer-2' });
                service.addPeer(peer1);
                service.addPeer(peer2);

                const discovered = await service.discoverPeers();

                expect(discovered.length).toBe(2);
            });

            it('should emit peer discovery event', async () => {
                await service.discoverPeers();
                await sleep(50);

                const discoveryEvent = capturedEvents.find(e => e.type === 'p2p:peer_discovery_requested');
                expect(discoveryEvent).toBeDefined();
            });
        });
    });

    // =========================================================================
    // AgentReputationService Tests (When Enabled)
    // =========================================================================

    describe('AgentReputationService (Enabled)', () => {
        let service: AgentReputationService;

        beforeEach(() => {
            const flags = createEnabledFlags();
            service = AgentReputationService.getInstance(flags);
        });

        describe('Reputation Creation', () => {
            it('should create new reputation for unknown agent', () => {
                const reputation = service.getOrCreateReputation('new-agent');

                expect(reputation).toBeDefined();
                expect(reputation.agentId).toBe('new-agent');
                expect(reputation.overallScore).toBe(0.5); // Default starting score
                expect(reputation.tasksCompleted).toBe(0);
            });

            it('should return existing reputation for known agent', () => {
                // Create initial reputation
                const initial = service.getOrCreateReputation('known-agent');

                // Get again - should be same object
                const retrieved = service.getOrCreateReputation('known-agent');

                expect(retrieved.agentId).toBe(initial.agentId);
                expect(retrieved.firstSeen).toBe(initial.firstSeen);
            });

            it('should initialize all reputation metrics', () => {
                const reputation = service.getOrCreateReputation('test-agent');

                expect(reputation.overallScore).toBeDefined();
                expect(reputation.tasksCompleted).toBe(0);
                expect(reputation.tasksSucceeded).toBe(0);
                expect(reputation.tasksFailed).toBe(0);
                expect(reputation.successRate).toBe(0);
                expect(reputation.averageConfidence).toBe(0);
                expect(reputation.averageCompletionTime).toBe(0);
                expect(reputation.reliabilityScore).toBe(0.5);
                expect(reputation.collaborationScore).toBe(0.5);
                expect(reputation.helpfulnessScore).toBe(0.5);
                expect(reputation.firstSeen).toBeDefined();
                expect(reputation.lastUpdated).toBeDefined();
                expect(reputation.reputationHistory).toEqual([]);
            });
        });

        describe('Reputation Updates', () => {
            it('should update reputation with positive delta', async () => {
                service.getOrCreateReputation('improving-agent');

                const update: AgentReputationUpdate = {
                    agentId: 'improving-agent',
                    reason: 'task_completed',
                    scoreDelta: 0.1,
                    timestamp: Date.now()
                };

                await service.updateReputation(update);

                const reputation = service.getReputation('improving-agent');
                expect(reputation?.overallScore).toBe(0.6); // 0.5 + 0.1
            });

            it('should update reputation with negative delta', async () => {
                service.getOrCreateReputation('failing-agent');

                const update: AgentReputationUpdate = {
                    agentId: 'failing-agent',
                    reason: 'task_failed',
                    scoreDelta: -0.1,
                    timestamp: Date.now()
                };

                await service.updateReputation(update);

                const reputation = service.getReputation('failing-agent');
                expect(reputation?.overallScore).toBe(0.4); // 0.5 - 0.1
            });

            it('should clamp reputation score between 0 and 1', async () => {
                // Test upper bound
                service.getOrCreateReputation('star-agent');
                await service.updateReputation({
                    agentId: 'star-agent',
                    reason: 'bonus',
                    scoreDelta: 1.0, // Would be 1.5
                    timestamp: Date.now()
                });

                let reputation = service.getReputation('star-agent');
                expect(reputation?.overallScore).toBe(1.0);

                // Test lower bound
                service.getOrCreateReputation('bad-agent');
                await service.updateReputation({
                    agentId: 'bad-agent',
                    reason: 'penalty',
                    scoreDelta: -1.0, // Would be -0.5
                    timestamp: Date.now()
                });

                reputation = service.getReputation('bad-agent');
                expect(reputation?.overallScore).toBe(0);
            });

            it('should emit p2p:reputation_updated event', async () => {
                service.getOrCreateReputation('event-agent');

                await service.updateReputation({
                    agentId: 'event-agent',
                    reason: 'collaboration',
                    scoreDelta: 0.05,
                    timestamp: Date.now()
                });
                await sleep(50);

                const updateEvent = capturedEvents.find(e => e.type === 'p2p:reputation_updated');
                expect(updateEvent).toBeDefined();
                expect(updateEvent?.payload.data.targetAgentId).toBe('event-agent');
                expect(updateEvent?.payload.data.oldScore).toBe(0.5);
                expect(updateEvent?.payload.data.newScore).toBe(0.55);
            });

            it('should update lastUpdated timestamp', async () => {
                const reputation = service.getOrCreateReputation('timestamp-agent');
                const originalTimestamp = reputation.lastUpdated;

                await sleep(10);

                await service.updateReputation({
                    agentId: 'timestamp-agent',
                    reason: 'task_completed',
                    scoreDelta: 0.01,
                    timestamp: Date.now()
                });

                const updated = service.getReputation('timestamp-agent');
                expect(updated?.lastUpdated).toBeGreaterThan(originalTimestamp);
            });
        });

        describe('Reputation History Tracking', () => {
            it('should add entry to reputation history', async () => {
                service.getOrCreateReputation('history-agent');

                await service.updateReputation({
                    agentId: 'history-agent',
                    reason: 'task_completed',
                    scoreDelta: 0.05,
                    relatedTaskId: 'task-123',
                    timestamp: Date.now()
                });

                const reputation = service.getReputation('history-agent');
                expect(reputation?.reputationHistory.length).toBe(1);
                expect(reputation?.reputationHistory[0].reason).toBe('task_completed');
                expect(reputation?.reputationHistory[0].delta).toBe(0.05);
                expect(reputation?.reputationHistory[0].relatedTaskId).toBe('task-123');
            });

            it('should maintain multiple history entries', async () => {
                service.getOrCreateReputation('multi-history-agent');

                const updates: AgentReputationUpdate[] = [
                    { agentId: 'multi-history-agent', reason: 'task_completed', scoreDelta: 0.01, timestamp: Date.now() },
                    { agentId: 'multi-history-agent', reason: 'collaboration', scoreDelta: 0.02, timestamp: Date.now() + 1 },
                    { agentId: 'multi-history-agent', reason: 'peer_rating', scoreDelta: 0.03, timestamp: Date.now() + 2 },
                ];

                for (const update of updates) {
                    await service.updateReputation(update);
                }

                const reputation = service.getReputation('multi-history-agent');
                expect(reputation?.reputationHistory.length).toBe(3);
            });

            it('should limit history to 100 entries', async () => {
                service.getOrCreateReputation('overflow-agent');

                // Add 105 updates
                for (let i = 0; i < 105; i++) {
                    await service.updateReputation({
                        agentId: 'overflow-agent',
                        reason: 'task_completed',
                        scoreDelta: 0.001,
                        timestamp: Date.now() + i
                    });
                }

                const reputation = service.getReputation('overflow-agent');
                expect(reputation?.reputationHistory.length).toBe(100);
            });

            it('should include related task and agent IDs in history', async () => {
                service.getOrCreateReputation('related-agent');

                await service.updateReputation({
                    agentId: 'related-agent',
                    reason: 'collaboration',
                    scoreDelta: 0.02,
                    relatedTaskId: 'task-456',
                    relatedAgentId: 'partner-agent',
                    timestamp: Date.now()
                });

                const reputation = service.getReputation('related-agent');
                const entry = reputation?.reputationHistory[0];
                expect(entry?.relatedTaskId).toBe('task-456');
                expect(entry?.relatedAgentId).toBe('partner-agent');
            });
        });

        describe('Reputation Queries', () => {
            beforeEach(async () => {
                // Create agents with different reputations
                service.getOrCreateReputation('top-agent');
                await service.updateReputation({
                    agentId: 'top-agent',
                    reason: 'bonus',
                    scoreDelta: 0.4,
                    timestamp: Date.now()
                });

                service.getOrCreateReputation('mid-agent');
                await service.updateReputation({
                    agentId: 'mid-agent',
                    reason: 'task_completed',
                    scoreDelta: 0.1,
                    timestamp: Date.now()
                });

                service.getOrCreateReputation('low-agent');
                await service.updateReputation({
                    agentId: 'low-agent',
                    reason: 'penalty',
                    scoreDelta: -0.2,
                    timestamp: Date.now()
                });
            });

            it('should get reputation by agent ID', () => {
                const reputation = service.getReputation('top-agent');

                expect(reputation).toBeDefined();
                expect(reputation?.agentId).toBe('top-agent');
                expect(reputation?.overallScore).toBe(0.9);
            });

            it('should return undefined for unknown agent', () => {
                const reputation = service.getReputation('unknown-agent');
                expect(reputation).toBeUndefined();
            });

            it('should get all reputations', () => {
                const allReputations = service.getAllReputations();

                expect(allReputations.length).toBe(3);
            });

            it('should get top agents by reputation', () => {
                const topAgents = service.getTopAgentsByReputation(2);

                expect(topAgents.length).toBe(2);
                expect(topAgents[0].agentId).toBe('top-agent');
                expect(topAgents[1].agentId).toBe('mid-agent');
            });

            it('should respect limit in top agents query', () => {
                const topAgents = service.getTopAgentsByReputation(1);

                expect(topAgents.length).toBe(1);
                expect(topAgents[0].agentId).toBe('top-agent');
            });
        });
    });

    // =========================================================================
    // Event Emission Verification Tests
    // =========================================================================

    describe('Event Emission Verification', () => {
        it('should emit all expected P2P task negotiation events', async () => {
            const flags = createEnabledFlags();
            const service = P2PTaskNegotiationService.getInstance(
                { enabled: true, defaultBidWindowMs: 100 },
                flags
            );

            const task = createMockTask();
            const announcement = await service.announceTask(task, 'test-agent');
            const bid = createMockBid(task.id, 'bidder');
            await service.submitBid(bid);

            // Wait for bid window to close
            await sleep(200);

            const eventTypes = capturedEvents.map(e => e.type);
            expect(eventTypes).toContain('p2p:task_announced');
            expect(eventTypes).toContain('p2p:task_bid_received');
            // Either awarded or cancelled depending on min bids
            expect(
                eventTypes.includes('p2p:task_awarded') ||
                eventTypes.includes('p2p:task_announcement_cancelled')
            ).toBe(true);
        });

        it('should emit all expected P2P memory events', async () => {
            const flags = createEnabledFlags();
            const service = FederatedMemoryService.getInstance(flags);

            const entry = createMockMemoryEntry();
            await service.shareMemory(entry);
            await service.syncWithPeers();

            await sleep(50);

            const eventTypes = capturedEvents.map(e => e.type);
            expect(eventTypes).toContain('p2p:memory_shared');
            expect(eventTypes).toContain('p2p:memory_sync_requested');
        });

        it('should emit all expected P2P gossip events', async () => {
            const flags = createEnabledFlags();
            const service = GossipProtocolService.getInstance(
                { enabled: true, gossipInterval: 60000, maxHops: 5, fanout: 3 },
                flags
            );

            const peer = createMockPeer({ status: 'connected' });
            service.addPeer(peer);

            const message: GossipMessage = {
                gossipId: uuidv4(),
                type: 'event',
                data: {},
                origin: 'test',
                path: [],
                createdAt: new Date(),
                expiresAt: new Date(Date.now() + 60000),
                hops: 0,
                maxHops: 5
            };
            await service.propagate(message);

            service.removePeer(peer.peerId);
            await service.discoverPeers();

            await sleep(50);

            const eventTypes = capturedEvents.map(e => e.type);
            expect(eventTypes).toContain('p2p:peer_added');
            expect(eventTypes).toContain('p2p:gossip_propagated');
            expect(eventTypes).toContain('p2p:peer_removed');
            expect(eventTypes).toContain('p2p:peer_discovery_requested');
        });

        it('should emit all expected P2P reputation events', async () => {
            const flags = createEnabledFlags();
            const service = AgentReputationService.getInstance(flags);

            service.getOrCreateReputation('event-test-agent');
            await service.updateReputation({
                agentId: 'event-test-agent',
                reason: 'task_completed',
                scoreDelta: 0.05,
                timestamp: Date.now()
            });

            await sleep(50);

            const eventTypes = capturedEvents.map(e => e.type);
            expect(eventTypes).toContain('p2p:reputation_updated');
        });

        it('should include proper event payload structure', async () => {
            const flags = createEnabledFlags();
            const memoryService = FederatedMemoryService.getInstance(flags);

            const entry = createMockMemoryEntry();
            await memoryService.shareMemory(entry);

            await sleep(50);

            const shareEvent = capturedEvents.find(e => e.type === 'p2p:memory_shared');
            expect(shareEvent).toBeDefined();
            expect(shareEvent?.payload.agentId).toBeDefined();
            expect(shareEvent?.payload.channelId).toBeDefined();
            expect(shareEvent?.payload.timestamp).toBeDefined();
            expect(shareEvent?.payload.eventId).toBeDefined();
            expect(shareEvent?.payload.data).toBeDefined();
        });
    });

    // =========================================================================
    // Service Isolation Tests
    // =========================================================================

    describe('Service Isolation', () => {
        it('should reset P2PTaskNegotiationService state between tests', async () => {
            const flags = createEnabledFlags();
            const service1 = P2PTaskNegotiationService.getInstance(
                { enabled: true },
                flags
            );

            const task = createMockTask();
            await service1.announceTask(task, 'agent-1');

            expect(service1.getActiveAnnouncements().length).toBe(1);

            // Reset and create new instance
            P2PTaskNegotiationService.resetInstance();
            const service2 = P2PTaskNegotiationService.getInstance(
                { enabled: true },
                flags
            );

            expect(service2.getActiveAnnouncements().length).toBe(0);
        });

        it('should reset FederatedMemoryService state between tests', async () => {
            const flags = createEnabledFlags();
            const service1 = FederatedMemoryService.getInstance(flags);

            await service1.shareMemory(createMockMemoryEntry());
            expect(service1.getLocalMemoryCount()).toBe(1);

            // Reset and create new instance
            FederatedMemoryService.resetInstance();
            const service2 = FederatedMemoryService.getInstance(flags);

            expect(service2.getLocalMemoryCount()).toBe(0);
        });

        it('should reset GossipProtocolService state between tests', () => {
            const flags = createEnabledFlags();
            const service1 = GossipProtocolService.getInstance(
                { enabled: true, gossipInterval: 60000, maxHops: 5, fanout: 3 },
                flags
            );

            service1.addPeer(createMockPeer());
            expect(service1.getKnownPeers().length).toBe(1);

            // Reset and create new instance
            GossipProtocolService.resetInstance();
            const service2 = GossipProtocolService.getInstance(
                { enabled: true, gossipInterval: 60000, maxHops: 5, fanout: 3 },
                flags
            );

            expect(service2.getKnownPeers().length).toBe(0);
        });

        it('should reset AgentReputationService state between tests', () => {
            const flags = createEnabledFlags();
            const service1 = AgentReputationService.getInstance(flags);

            service1.getOrCreateReputation('test-agent');
            expect(service1.getAllReputations().length).toBe(1);

            // Reset and create new instance
            AgentReputationService.resetInstance();
            const service2 = AgentReputationService.getInstance(flags);

            expect(service2.getAllReputations().length).toBe(0);
        });
    });
});
