/**
 * Unit tests for P2P Services (P9 Foundation)
 * Tests task negotiation, federated memory, gossip protocol, and reputation
 */

// Jest provides describe, it, expect, beforeEach as globals
import { P2PTaskNegotiationService } from '../../../src/shared/services/p2p/P2PTaskNegotiationService';
import { FederatedMemoryService } from '../../../src/shared/services/p2p/FederatedMemoryService';
import { GossipProtocolService } from '../../../src/shared/services/p2p/GossipProtocolService';
import { AgentReputationService } from '../../../src/shared/services/p2p/AgentReputationService';
import { DEFAULT_P2P_FEATURE_FLAGS } from '../../../src/shared/types/DecentralizationTypes';

// Reset all singletons before each test suite to ensure clean state
beforeEach(() => {
    P2PTaskNegotiationService.resetInstance();
    FederatedMemoryService.resetInstance();
    GossipProtocolService.resetInstance();
    AgentReputationService.resetInstance();
});

// Clean up after each test to prevent open handles (timers, etc.)
afterEach(() => {
    P2PTaskNegotiationService.resetInstance();
    FederatedMemoryService.resetInstance();
    GossipProtocolService.resetInstance();
    AgentReputationService.resetInstance();
});

describe('P2P Services - Feature Flags Disabled by Default', () => {
    it('should have all P2P features disabled by default', () => {
        expect(DEFAULT_P2P_FEATURE_FLAGS.P2P_ENABLED).toBe(false);
        expect(DEFAULT_P2P_FEATURE_FLAGS.P2P_NEGOTIATION_ENABLED).toBe(false);
        expect(DEFAULT_P2P_FEATURE_FLAGS.P2P_FEDERATED_MEMORY_ENABLED).toBe(false);
        expect(DEFAULT_P2P_FEATURE_FLAGS.P2P_GOSSIP_PROTOCOL_ENABLED).toBe(false);
        expect(DEFAULT_P2P_FEATURE_FLAGS.P2P_REPUTATION_SYSTEM_ENABLED).toBe(false);
        expect(DEFAULT_P2P_FEATURE_FLAGS.P2P_BLOCKCHAIN_ENABLED).toBe(false);
        expect(DEFAULT_P2P_FEATURE_FLAGS.P2P_TOKEN_ECONOMY_ENABLED).toBe(false);
    });

    it('should throw error when P2P Task Negotiation is disabled', async () => {
        const service = P2PTaskNegotiationService.getInstance({}, DEFAULT_P2P_FEATURE_FLAGS);
        
        await expect(async () => {
            await service.announceTask(
                { id: 'test-task' } as any,
                'test-agent'
            );
        }).rejects.toThrow('P2P task negotiation is disabled');
    });

    it('should throw error when Federated Memory is disabled', async () => {
        const service = FederatedMemoryService.getInstance(DEFAULT_P2P_FEATURE_FLAGS);
        
        await expect(async () => {
            await service.shareMemory({
                id: 'test-memory',
                agentId: 'test-agent',
                type: 'insight',
                content: {},
                privacyLevel: 'private',
                createdAt: Date.now(),
                updatedAt: Date.now()
            });
        }).rejects.toThrow('Federated memory is disabled');
    });

    it('should throw error when Gossip Protocol is disabled', async () => {
        const service = GossipProtocolService.getInstance({}, DEFAULT_P2P_FEATURE_FLAGS);
        
        await expect(async () => {
            await service.propagate({
                gossipId: 'test-message',
                type: 'state_update',
                origin: 'test-sender',
                data: {},
                hops: 0,
                maxHops: 5,
                path: [],
                createdAt: new Date(),
                expiresAt: new Date(Date.now() + 60000)
            });
        }).rejects.toThrow('Gossip protocol is disabled');
    });

    it('should throw error when Reputation System is disabled', async () => {
        const service = AgentReputationService.getInstance(DEFAULT_P2P_FEATURE_FLAGS);
        
        await expect(async () => {
            await service.updateReputation({
                agentId: 'test-agent',
                reason: 'task_completed',
                scoreDelta: 0.1,
                timestamp: Date.now()
            });
        }).rejects.toThrow('Agent reputation system is disabled');
    });
});

describe('P2P Services - Enabled State (Foundation)', () => {
    const enabledFlags = {
        ...DEFAULT_P2P_FEATURE_FLAGS,
        P2P_ENABLED: true,
        P2P_NEGOTIATION_ENABLED: true,
        P2P_FEDERATED_MEMORY_ENABLED: true,
        P2P_GOSSIP_PROTOCOL_ENABLED: true,
        P2P_REPUTATION_SYSTEM_ENABLED: true
    };

    describe('P2PTaskNegotiationService', () => {
        it('should create task announcement when enabled', async () => {
            const service = P2PTaskNegotiationService.getInstance({ enabled: true }, enabledFlags);
            
            const announcement = await service.announceTask(
                {
                    id: 'test-task',
                    channelId: 'test-channel',
                    title: 'Test Task',
                    description: 'Test Description',
                    priority: 'medium',
                    status: 'pending',
                    createdAt: Date.now(),
                    updatedAt: Date.now(),
                    createdBy: 'test-agent',
                    assignmentScope: 'single',
                    assignmentStrategy: 'intelligent'
                } as any,
                'test-agent'
            );

            expect(announcement).toBeDefined();
            expect(announcement.status).toBe('open');
            expect(announcement.task.id).toBe('test-task');
        });

        it('should accept valid bids', async () => {
            const service = P2PTaskNegotiationService.getInstance({ enabled: true }, enabledFlags);
            
            const announcement = await service.announceTask(
                {
                    id: 'test-task-2',
                    channelId: 'test-channel',
                    title: 'Test Task 2',
                    description: 'Test',
                    priority: 'medium',
                    status: 'pending',
                    createdAt: Date.now(),
                    updatedAt: Date.now(),
                    createdBy: 'test-agent',
                    assignmentScope: 'single',
                    assignmentStrategy: 'intelligent'
                } as any,
                'test-agent'
            );

            const result = await service.submitBid({
                bidId: 'bid-1',
                taskId: announcement.task.id,
                agentId: 'bidder-agent',
                estimatedDuration: 30,
                confidence: 0.8,
                relevantCapabilities: ['testing'],
                relevantRoles: ['tester'],
                reputationScore: 0.7,
                relevantTaskHistory: 5,
                successRate: 0.9,
                submittedAt: Date.now(),
                expiresAt: Date.now() + 30000
            });

            expect(result).toBe(true);
        });
    });

    describe('FederatedMemoryService', () => {
        it('should share memory when enabled', async () => {
            const service = FederatedMemoryService.getInstance(enabledFlags);
            
            await service.shareMemory({
                id: 'memory-1',
                agentId: 'test-agent',
                type: 'insight',
                content: { data: 'test' },
                privacyLevel: 'channel',
                createdAt: Date.now(),
                updatedAt: Date.now()
            });

            expect(service.getLocalMemoryCount()).toBe(1);
        });

        it('should query distributed memory', async () => {
            const service = FederatedMemoryService.getInstance(enabledFlags);
            
            await service.shareMemory({
                id: 'memory-2',
                agentId: 'test-agent',
                type: 'pattern',
                content: { pattern: 'test' },
                privacyLevel: 'private',
                createdAt: Date.now(),
                updatedAt: Date.now()
            });

            const results = await service.queryDistributedMemory({
                type: ['pattern'],
                limit: 10
            });

            expect(results.length).toBeGreaterThan(0);
            expect(results[0].type).toBe('pattern');
        });
    });

    describe('GossipProtocolService', () => {
        it('should add and track peers', () => {
            const service = GossipProtocolService.getInstance({ enabled: true }, enabledFlags);
            
            service.addPeer({
                peerId: 'peer-1',
                address: {
                    protocol: 'http',
                    host: 'localhost',
                    port: 3001,
                    full: 'http://localhost:3001'
                },
                publicKey: 'test-key',
                capabilities: {
                    protocols: ['http'],
                    messageTypes: ['test'],
                    services: [],
                    maxMessageSize: 1024,
                    supportsEncryption: false,
                    supportsCompression: false
                },
                reputation: 0.8,
                status: 'connected',
                lastSeen: new Date()
            });

            const peers = service.getKnownPeers();
            expect(peers.length).toBe(1);
            expect(peers[0].peerId).toBe('peer-1');
        });

        it('should remove peers', () => {
            const service = GossipProtocolService.getInstance({ enabled: true }, enabledFlags);
            
            service.addPeer({
                peerId: 'peer-2',
                address: {
                    protocol: 'http',
                    host: 'localhost',
                    port: 3002,
                    full: 'http://localhost:3002'
                },
                publicKey: 'test-key-2',
                capabilities: {
                    protocols: ['http'],
                    messageTypes: ['test'],
                    services: [],
                    maxMessageSize: 1024,
                    supportsEncryption: false,
                    supportsCompression: false
                },
                reputation: 0.8,
                status: 'connected',
                lastSeen: new Date()
            });

            service.removePeer('peer-2');
            
            const peers = service.getKnownPeers();
            const removedPeer = peers.find(p => p.peerId === 'peer-2');
            expect(removedPeer).toBeUndefined();
        });
    });

    describe('AgentReputationService', () => {
        it('should create initial reputation', () => {
            const service = AgentReputationService.getInstance(enabledFlags);
            
            const reputation = service.getOrCreateReputation('new-agent');
            
            expect(reputation).toBeDefined();
            expect(reputation.agentId).toBe('new-agent');
            expect(reputation.overallScore).toBe(0.5);
            expect(reputation.tasksCompleted).toBe(0);
        });

        it('should update reputation', async () => {
            const service = AgentReputationService.getInstance(enabledFlags);
            
            await service.updateReputation({
                agentId: 'test-agent-rep',
                reason: 'task_completed',
                scoreDelta: 0.1,
                timestamp: Date.now()
            });

            const reputation = service.getReputation('test-agent-rep');
            expect(reputation).toBeDefined();
            expect(reputation!.overallScore).toBeGreaterThan(0.5);
            expect(reputation!.reputationHistory.length).toBeGreaterThan(0);
        });

        it('should track reputation history', async () => {
            const service = AgentReputationService.getInstance(enabledFlags);
            
            await service.updateReputation({
                agentId: 'test-agent-history',
                reason: 'task_completed',
                scoreDelta: 0.05,
                timestamp: Date.now()
            });

            await service.updateReputation({
                agentId: 'test-agent-history',
                reason: 'collaboration',
                scoreDelta: 0.03,
                timestamp: Date.now()
            });

            const reputation = service.getReputation('test-agent-history');
            expect(reputation!.reputationHistory.length).toBe(2);
            expect(reputation!.reputationHistory[0].reason).toBe('task_completed');
            expect(reputation!.reputationHistory[1].reason).toBe('collaboration');
        });
    });
});
