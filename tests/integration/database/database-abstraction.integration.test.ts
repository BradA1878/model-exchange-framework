/**
 * Database Abstraction Layer Integration Tests
 *
 * Tests the P4 Database Abstraction Layer including:
 * - DatabaseAdapterFactory initialization and configuration
 * - Repository CRUD operations (create, read, update, delete)
 * - Filter and pagination operations
 * - Agent-specific repository operations
 * - Channel repository operations
 * - Task repository operations
 * - Memory repository operations
 * - Factory reset behavior
 *
 * These tests validate the database-agnostic abstraction layer
 * that enables plug-and-play database support through common
 * repository interfaces.
 */

import { TestSDK, createTestSDK } from '../../utils/TestSDK';
import { waitFor, sleep } from '../../utils/waitFor';
import { generateTestId, TIMEOUTS } from '../../utils/TestFixtures';

import {
    DatabaseAdapterFactory,
    DatabaseConfig,
    RepositoryBundle
} from '../../../src/shared/database/DatabaseAdapterFactory';

import { IAgentEntity } from '../../../src/shared/repositories/interfaces/IAgentRepository';
import { IChannelEntity } from '../../../src/shared/repositories/interfaces/IChannelRepository';
import { ITaskEntity, TaskStatus, TaskPriority } from '../../../src/shared/repositories/interfaces/ITaskRepository';
import {
    IAgentMemory,
    IChannelMemory,
    IRelationshipMemory,
    MemoryScope,
    MemoryPersistenceLevel
} from '../../../src/shared/repositories/interfaces/IMemoryRepository';
import { FilterOptions } from '../../../src/shared/repositories/types/FilterTypes';
import { PaginationOptions } from '../../../src/shared/repositories/types/PaginationTypes';

describe('Database Abstraction Layer', () => {
    let testSdk: TestSDK;
    let channelId: string;
    let repos: RepositoryBundle;

    // Test identifiers for cleanup
    const testAgentIds: string[] = [];
    const testChannelIds: string[] = [];
    const testTaskIds: string[] = [];
    const testMemoryAgentIds: string[] = [];
    const testMemoryChannelIds: string[] = [];

    beforeAll(async () => {
        console.log('[DB-TEST] Starting beforeAll...');

        // Connect to the server to ensure MongoDB is available
        console.log('[DB-TEST] Creating TestSDK...');
        testSdk = createTestSDK();

        console.log('[DB-TEST] Connecting to server...');
        await testSdk.connect();
        console.log('[DB-TEST] Connected to server');

        // Create a test channel for operations that need one
        console.log('[DB-TEST] Creating test channel...');
        const result = await testSdk.createTestChannel('db-abstraction', {
            disableSystemLlm: true
        });
        channelId = result.channelId;
        console.log(`[DB-TEST] Channel created: ${channelId}`);

        // Initialize the DatabaseAdapterFactory with MongoDB configuration
        console.log('[DB-TEST] Initializing DatabaseAdapterFactory...');
        const mongoConfig: DatabaseConfig = {
            type: 'mongodb',
            connectionString: process.env.MONGODB_URI || 'mongodb://localhost:27017/mxf-test'
        };

        DatabaseAdapterFactory.initialize(mongoConfig);

        // Connect to the database (establishes connection if not already connected by server)
        console.log('[DB-TEST] Connecting to database...');
        await DatabaseAdapterFactory.connect();
        console.log('[DB-TEST] Database connected');

        console.log('[DB-TEST] Creating repositories...');
        repos = DatabaseAdapterFactory.create();
        console.log('[DB-TEST] beforeAll complete');
    }, TIMEOUTS.long);

    afterAll(async () => {
        // Clean up test data - delete agents by their agentId
        for (const agentId of testAgentIds) {
            try {
                await repos.agents.deleteByAgentId(agentId);
            } catch (error) {
                // Ignore cleanup errors - agent may not exist or already deleted
            }
        }

        for (const taskId of testTaskIds) {
            try {
                await repos.tasks.delete(taskId);
            } catch (error) {
                // Ignore cleanup errors
            }
        }

        for (const agentId of testMemoryAgentIds) {
            try {
                await repos.memory.deleteAgentMemory(agentId);
            } catch (error) {
                // Ignore cleanup errors
            }
        }

        for (const memChannelId of testMemoryChannelIds) {
            try {
                await repos.memory.deleteChannelMemory(memChannelId);
            } catch (error) {
                // Ignore cleanup errors
            }
        }

        // Reset the factory for other tests
        DatabaseAdapterFactory.reset();

        await testSdk.cleanup();
    }, TIMEOUTS.long);

    // =========================================================================
    // DatabaseAdapterFactory Tests
    // =========================================================================

    describe('DatabaseAdapterFactory', () => {
        describe('Initialization and Configuration', () => {
            it('should throw error when create() is called without initialization', () => {
                // Reset factory state
                DatabaseAdapterFactory.reset();

                expect(() => DatabaseAdapterFactory.create()).toThrow(
                    'DatabaseAdapterFactory not initialized. Call initialize() first.'
                );

                // Re-initialize for subsequent tests
                DatabaseAdapterFactory.initialize({
                    type: 'mongodb',
                    connectionString: process.env.MONGODB_URI || 'mongodb://localhost:27017/mxf-test'
                });
                repos = DatabaseAdapterFactory.create();
            });

            it('should initialize with MongoDB configuration', () => {
                const config = DatabaseAdapterFactory.getConfig();

                expect(config).not.toBeNull();
                expect(config?.type).toBe('mongodb');
                expect(config?.connectionString).toBeDefined();
            });

            it('should return singleton repository bundle on repeated create() calls', () => {
                const bundle1 = DatabaseAdapterFactory.create();
                const bundle2 = DatabaseAdapterFactory.create();

                expect(bundle1).toBe(bundle2);
                expect(bundle1.agents).toBe(bundle2.agents);
                expect(bundle1.channels).toBe(bundle2.channels);
                expect(bundle1.tasks).toBe(bundle2.tasks);
                expect(bundle1.memory).toBe(bundle2.memory);
            });

            it('should reset instance on re-initialization', () => {
                const bundle1 = DatabaseAdapterFactory.create();

                // Re-initialize
                DatabaseAdapterFactory.initialize({
                    type: 'mongodb',
                    connectionString: process.env.MONGODB_URI || 'mongodb://localhost:27017/mxf-test'
                });

                const bundle2 = DatabaseAdapterFactory.create();

                // Should be different instances after re-initialization
                expect(bundle1).not.toBe(bundle2);

                // Update reference for other tests
                repos = bundle2;
            });

            it('should throw error for unsupported database types', () => {
                DatabaseAdapterFactory.reset();

                DatabaseAdapterFactory.initialize({
                    type: 'postgresql' as any,
                    connectionString: 'postgresql://localhost/test'
                });

                expect(() => DatabaseAdapterFactory.create()).toThrow(
                    'PostgreSQL adapter not yet implemented'
                );

                // Reset and re-initialize with MongoDB for other tests
                DatabaseAdapterFactory.reset();
                DatabaseAdapterFactory.initialize({
                    type: 'mongodb',
                    connectionString: process.env.MONGODB_URI || 'mongodb://localhost:27017/mxf-test'
                });
                repos = DatabaseAdapterFactory.create();
            });

            it('should provide all required repository interfaces', () => {
                const bundle = DatabaseAdapterFactory.create();

                expect(bundle.agents).toBeDefined();
                expect(bundle.channels).toBeDefined();
                expect(bundle.tasks).toBeDefined();
                expect(bundle.memory).toBeDefined();

                // Check repository methods exist
                expect(typeof bundle.agents.findById).toBe('function');
                expect(typeof bundle.agents.findMany).toBe('function');
                expect(typeof bundle.agents.create).toBe('function');
                expect(typeof bundle.agents.update).toBe('function');
                expect(typeof bundle.agents.delete).toBe('function');
            });
        });

        describe('Factory Reset Behavior', () => {
            it('should clear instance and config on reset', () => {
                DatabaseAdapterFactory.reset();

                expect(DatabaseAdapterFactory.getConfig()).toBeNull();
                expect(() => DatabaseAdapterFactory.create()).toThrow();

                // Re-initialize for other tests
                DatabaseAdapterFactory.initialize({
                    type: 'mongodb',
                    connectionString: process.env.MONGODB_URI || 'mongodb://localhost:27017/mxf-test'
                });
                repos = DatabaseAdapterFactory.create();
            });
        });
    });

    // =========================================================================
    // Agent Repository Tests
    // =========================================================================

    describe('Agent Repository', () => {
        describe('CRUD Operations', () => {
            it('should create a new agent', async () => {
                const agentId = generateTestId('crud-agent');
                testAgentIds.push(agentId);

                const agentData = {
                    agentId,
                    name: 'Test CRUD Agent',
                    description: 'Agent for CRUD testing',
                    type: 'test',
                    serviceTypes: ['testing', 'integration'],
                    capabilities: ['test-capability'],
                    status: 'ACTIVE' as const,
                    createdBy: 'test-user',
                    lastActive: new Date()
                };

                const created = await repos.agents.create(agentData);

                expect(created).toBeDefined();
                expect(created.agentId).toBe(agentId);
                expect(created.name).toBe('Test CRUD Agent');
                expect(created.serviceTypes).toContain('testing');
                expect(created.status).toBe('ACTIVE');
            });

            it('should find agent by agentId', async () => {
                const agentId = generateTestId('find-agent');
                testAgentIds.push(agentId);

                await repos.agents.create({
                    agentId,
                    name: 'Find Test Agent',
                    serviceTypes: ['testing'],
                    status: 'ACTIVE' as const,
                    createdBy: 'test-user',
                    lastActive: new Date()
                });

                const found = await repos.agents.findByAgentId(agentId);

                expect(found).not.toBeNull();
                expect(found?.agentId).toBe(agentId);
                expect(found?.name).toBe('Find Test Agent');
            });

            it('should return null for non-existent agent', async () => {
                const found = await repos.agents.findByAgentId('non-existent-agent-id');
                expect(found).toBeNull();
            });

            it('should update agent status', async () => {
                const agentId = generateTestId('update-status-agent');
                testAgentIds.push(agentId);

                await repos.agents.create({
                    agentId,
                    name: 'Status Update Agent',
                    serviceTypes: ['testing'],
                    status: 'ACTIVE' as const,
                    createdBy: 'test-user',
                    lastActive: new Date()
                });

                const updated = await repos.agents.updateStatus(agentId, 'INACTIVE');

                expect(updated).not.toBeNull();
                expect(updated?.status).toBe('INACTIVE');
            });

            it('should update agent last active timestamp', async () => {
                const agentId = generateTestId('lastactive-agent');
                testAgentIds.push(agentId);

                const initialTime = new Date(Date.now() - 60000); // 1 minute ago

                await repos.agents.create({
                    agentId,
                    name: 'Last Active Agent',
                    serviceTypes: ['testing'],
                    status: 'ACTIVE' as const,
                    createdBy: 'test-user',
                    lastActive: initialTime
                });

                const newTime = new Date();
                await repos.agents.updateLastActive(agentId, newTime);

                const found = await repos.agents.findByAgentId(agentId);
                expect(found?.lastActive.getTime()).toBeGreaterThanOrEqual(initialTime.getTime());
            });
        });

        describe('Service Type Operations', () => {
            it('should find agents by service types (ANY match)', async () => {
                const agentId1 = generateTestId('svc-type-agent-1');
                const agentId2 = generateTestId('svc-type-agent-2');
                testAgentIds.push(agentId1, agentId2);

                await repos.agents.create({
                    agentId: agentId1,
                    name: 'Service Type Agent 1',
                    serviceTypes: ['service-a', 'service-b'],
                    status: 'ACTIVE' as const,
                    createdBy: 'test-user',
                    lastActive: new Date()
                });

                await repos.agents.create({
                    agentId: agentId2,
                    name: 'Service Type Agent 2',
                    serviceTypes: ['service-b', 'service-c'],
                    status: 'ACTIVE' as const,
                    createdBy: 'test-user',
                    lastActive: new Date()
                });

                // Find agents with service-b (ANY match)
                const found = await repos.agents.findByServiceTypes(['service-b']);

                expect(found.length).toBeGreaterThanOrEqual(2);
                const foundIds = found.map(a => a.agentId);
                expect(foundIds).toContain(agentId1);
                expect(foundIds).toContain(agentId2);
            });

            it('should find agents by service types (ALL match)', async () => {
                const agentId = generateTestId('svc-type-all-agent');
                testAgentIds.push(agentId);

                await repos.agents.create({
                    agentId,
                    name: 'All Service Types Agent',
                    serviceTypes: ['unique-service-x', 'unique-service-y', 'unique-service-z'],
                    status: 'ACTIVE' as const,
                    createdBy: 'test-user',
                    lastActive: new Date()
                });

                // Find agents with ALL of these services
                const found = await repos.agents.findByServiceTypes(
                    ['unique-service-x', 'unique-service-y'],
                    true // matchAll = true
                );

                expect(found.length).toBeGreaterThanOrEqual(1);
                const foundAgent = found.find(a => a.agentId === agentId);
                expect(foundAgent).toBeDefined();
            });
        });

        describe('Stale Agent Detection', () => {
            it('should find stale agents based on threshold', async () => {
                const agentId = generateTestId('stale-agent');
                testAgentIds.push(agentId);

                // Create an agent with old lastActive timestamp
                const oldTime = new Date(Date.now() - 3600000); // 1 hour ago

                await repos.agents.create({
                    agentId,
                    name: 'Stale Agent',
                    serviceTypes: ['testing'],
                    status: 'ACTIVE' as const,
                    createdBy: 'test-user',
                    lastActive: oldTime
                });

                // Find agents stale for more than 30 minutes
                const staleAgents = await repos.agents.findStaleAgents(30 * 60 * 1000);

                expect(staleAgents.length).toBeGreaterThanOrEqual(1);
                const foundStale = staleAgents.find(a => a.agentId === agentId);
                expect(foundStale).toBeDefined();
            });

            it('should not include recently active agents as stale', async () => {
                const agentId = generateTestId('recent-agent');
                testAgentIds.push(agentId);

                await repos.agents.create({
                    agentId,
                    name: 'Recent Agent',
                    serviceTypes: ['testing'],
                    status: 'ACTIVE' as const,
                    createdBy: 'test-user',
                    lastActive: new Date() // Just now
                });

                // Find agents stale for more than 1 hour
                const staleAgents = await repos.agents.findStaleAgents(3600000);

                const foundStale = staleAgents.find(a => a.agentId === agentId);
                expect(foundStale).toBeUndefined();
            });
        });

        describe('Bulk Operations', () => {
            it('should bulk update status for multiple agents', async () => {
                const agentId1 = generateTestId('bulk-agent-1');
                const agentId2 = generateTestId('bulk-agent-2');
                testAgentIds.push(agentId1, agentId2);

                await repos.agents.create({
                    agentId: agentId1,
                    name: 'Bulk Agent 1',
                    serviceTypes: ['testing'],
                    status: 'ACTIVE' as const,
                    createdBy: 'test-user',
                    lastActive: new Date()
                });

                await repos.agents.create({
                    agentId: agentId2,
                    name: 'Bulk Agent 2',
                    serviceTypes: ['testing'],
                    status: 'ACTIVE' as const,
                    createdBy: 'test-user',
                    lastActive: new Date()
                });

                const updatedCount = await repos.agents.bulkUpdateStatus(
                    [agentId1, agentId2],
                    'INACTIVE'
                );

                expect(updatedCount).toBe(2);

                const agent1 = await repos.agents.findByAgentId(agentId1);
                const agent2 = await repos.agents.findByAgentId(agentId2);

                expect(agent1?.status).toBe('INACTIVE');
                expect(agent2?.status).toBe('INACTIVE');
            });
        });

        describe('Capabilities and Tools Updates', () => {
            it('should update agent capabilities', async () => {
                const agentId = generateTestId('caps-agent');
                testAgentIds.push(agentId);

                await repos.agents.create({
                    agentId,
                    name: 'Capabilities Agent',
                    serviceTypes: ['testing'],
                    capabilities: ['initial-cap'],
                    status: 'ACTIVE' as const,
                    createdBy: 'test-user',
                    lastActive: new Date()
                });

                const updated = await repos.agents.updateCapabilities(
                    agentId,
                    ['new-cap-1', 'new-cap-2']
                );

                expect(updated).not.toBeNull();
                expect(updated?.capabilities).toContain('new-cap-1');
                expect(updated?.capabilities).toContain('new-cap-2');
                expect(updated?.capabilities).not.toContain('initial-cap');
            });

            it('should update agent allowed tools', async () => {
                const agentId = generateTestId('tools-agent');
                testAgentIds.push(agentId);

                await repos.agents.create({
                    agentId,
                    name: 'Tools Agent',
                    serviceTypes: ['testing'],
                    allowedTools: ['tool_a'],
                    status: 'ACTIVE' as const,
                    createdBy: 'test-user',
                    lastActive: new Date()
                });

                const updated = await repos.agents.updateAllowedTools(
                    agentId,
                    ['tool_b', 'tool_c', 'tool_d']
                );

                expect(updated).not.toBeNull();
                expect(updated?.allowedTools).toHaveLength(3);
                expect(updated?.allowedTools).toContain('tool_b');
            });
        });
    });

    // =========================================================================
    // Channel Repository Tests
    // =========================================================================

    describe('Channel Repository', () => {
        describe('CRUD Operations', () => {
            it('should find channel by channelId', async () => {
                // Use the test channel created in beforeAll
                const found = await repos.channels.findByChannelId(channelId);

                expect(found).not.toBeNull();
                expect(found?.channelId).toBe(channelId);
            });

            it('should return null for non-existent channel', async () => {
                const found = await repos.channels.findByChannelId('non-existent-channel');
                expect(found).toBeNull();
            });
        });

        describe('Participant Management', () => {
            it('should add participant to channel', async () => {
                const participantId = generateTestId('participant');

                const updated = await repos.channels.addParticipant(channelId, participantId);

                expect(updated).not.toBeNull();
                expect(updated?.participants).toContain(participantId);
            });

            it('should not add duplicate participants', async () => {
                const participantId = generateTestId('dup-participant');

                // Add twice
                await repos.channels.addParticipant(channelId, participantId);
                const result = await repos.channels.addParticipant(channelId, participantId);

                // Count occurrences
                const count = result?.participants.filter(p => p === participantId).length;
                expect(count).toBe(1);
            });

            it('should remove participant from channel', async () => {
                const participantId = generateTestId('remove-participant');

                // Add then remove
                await repos.channels.addParticipant(channelId, participantId);
                const updated = await repos.channels.removeParticipant(channelId, participantId);

                expect(updated?.participants).not.toContain(participantId);
            });

            it('should check if agent is participant', async () => {
                const participantId = generateTestId('check-participant');

                await repos.channels.addParticipant(channelId, participantId);

                const isParticipant = await repos.channels.isParticipant(channelId, participantId);
                const isNotParticipant = await repos.channels.isParticipant(channelId, 'not-a-participant');

                expect(isParticipant).toBe(true);
                expect(isNotParticipant).toBe(false);
            });

            it('should get all participants of a channel', async () => {
                const participants = await repos.channels.getParticipants(channelId);

                expect(Array.isArray(participants)).toBe(true);
            });
        });

        describe('Channel Statistics', () => {
            it('should get channel statistics', async () => {
                const stats = await repos.channels.getStatistics(channelId);

                expect(stats).toBeDefined();
                expect(typeof stats.participantCount).toBe('number');
                expect(typeof stats.messageCount).toBe('number');
                expect(typeof stats.taskCount).toBe('number');
                expect(stats.createdAt).toBeInstanceOf(Date);
            });

            it('should throw error for statistics of non-existent channel', async () => {
                await expect(
                    repos.channels.getStatistics('non-existent-channel')
                ).rejects.toThrow('Channel non-existent-channel not found');
            });
        });

        describe('Channel Search', () => {
            it('should search channels by name', async () => {
                // The test channel name includes 'db-abstraction'
                const results = await repos.channels.searchByName('db-abstraction');

                expect(results.length).toBeGreaterThanOrEqual(1);
            });

            it('should find active channels', async () => {
                const activeChannels = await repos.channels.findActive();

                expect(Array.isArray(activeChannels)).toBe(true);
                // All returned channels should be active
                for (const channel of activeChannels) {
                    expect(channel.active).toBe(true);
                }
            });
        });

        describe('Last Active Update', () => {
            it('should update channel last active timestamp', async () => {
                const before = await repos.channels.findByChannelId(channelId);
                const beforeTime = before?.lastActive?.getTime() || 0;

                await sleep(100); // Small delay to ensure time difference

                await repos.channels.updateLastActive(channelId);

                const after = await repos.channels.findByChannelId(channelId);
                expect(after?.lastActive?.getTime()).toBeGreaterThanOrEqual(beforeTime);
            });
        });
    });

    // =========================================================================
    // Task Repository Tests
    // =========================================================================

    describe('Task Repository', () => {
        describe('CRUD Operations', () => {
            it('should create a new task', async () => {
                const taskData = {
                    channelId,
                    title: 'Test Task',
                    description: 'Task for integration testing',
                    priority: 'medium' as TaskPriority,
                    status: 'pending' as TaskStatus,
                    assignmentStrategy: 'manual' as const,
                    createdBy: 'test-user'
                };

                const created = await repos.tasks.create(taskData);
                testTaskIds.push(created.id!);

                expect(created).toBeDefined();
                expect(created.title).toBe('Test Task');
                expect(created.status).toBe('pending');
                expect(created.priority).toBe('medium');
            });

            it('should find task by ID', async () => {
                const created = await repos.tasks.create({
                    channelId,
                    title: 'Find Task Test',
                    description: 'Task to find',
                    priority: 'low' as TaskPriority,
                    status: 'pending' as TaskStatus,
                    assignmentStrategy: 'manual' as const,
                    createdBy: 'test-user'
                });
                testTaskIds.push(created.id!);

                const found = await repos.tasks.findById(created.id!);

                expect(found).not.toBeNull();
                expect(found?.title).toBe('Find Task Test');
            });
        });

        describe('Task Status Operations', () => {
            it('should update task status', async () => {
                const created = await repos.tasks.create({
                    channelId,
                    title: 'Status Update Task',
                    description: 'Task for status update',
                    priority: 'medium' as TaskPriority,
                    status: 'pending' as TaskStatus,
                    assignmentStrategy: 'manual' as const,
                    createdBy: 'test-user'
                });
                testTaskIds.push(created.id!);

                const updated = await repos.tasks.updateStatus(created.id!, 'in_progress');

                expect(updated).not.toBeNull();
                expect(updated?.status).toBe('in_progress');
            });

            it('should set progress to 100 when completed', async () => {
                const created = await repos.tasks.create({
                    channelId,
                    title: 'Complete Task Test',
                    description: 'Task to complete',
                    priority: 'high' as TaskPriority,
                    status: 'in_progress' as TaskStatus,
                    assignmentStrategy: 'manual' as const,
                    createdBy: 'test-user',
                    progress: 50
                });
                testTaskIds.push(created.id!);

                const updated = await repos.tasks.updateStatus(created.id!, 'completed');

                expect(updated?.status).toBe('completed');
                expect(updated?.progress).toBe(100);
            });

            it('should find tasks by status', async () => {
                const created = await repos.tasks.create({
                    channelId,
                    title: 'Status Filter Task',
                    description: 'Task for status filtering',
                    priority: 'low' as TaskPriority,
                    status: 'assigned' as TaskStatus,
                    assignmentStrategy: 'manual' as const,
                    createdBy: 'test-user'
                });
                testTaskIds.push(created.id!);

                const found = await repos.tasks.findByStatus('assigned');

                expect(found.length).toBeGreaterThanOrEqual(1);
                const foundTask = found.find(t => t.id === created.id);
                expect(foundTask).toBeDefined();
            });

            it('should find tasks by multiple statuses', async () => {
                const found = await repos.tasks.findByStatus(['pending', 'assigned']);

                for (const task of found) {
                    expect(['pending', 'assigned']).toContain(task.status);
                }
            });
        });

        describe('Task Assignment', () => {
            it('should assign task to an agent', async () => {
                const created = await repos.tasks.create({
                    channelId,
                    title: 'Assignment Task',
                    description: 'Task for assignment',
                    priority: 'medium' as TaskPriority,
                    status: 'pending' as TaskStatus,
                    assignmentStrategy: 'manual' as const,
                    createdBy: 'test-user'
                });
                testTaskIds.push(created.id!);

                const agentId = generateTestId('assignee');
                const assigned = await repos.tasks.assignTo(created.id!, agentId);

                expect(assigned).not.toBeNull();
                expect(assigned?.assignedAgentId).toBe(agentId);
                expect(assigned?.status).toBe('assigned');
                expect(assigned?.assignedAgentIds).toContain(agentId);
            });

            it('should unassign task', async () => {
                const agentId = generateTestId('unassign-agent');
                const created = await repos.tasks.create({
                    channelId,
                    title: 'Unassign Task',
                    description: 'Task to unassign',
                    priority: 'low' as TaskPriority,
                    status: 'assigned' as TaskStatus,
                    assignmentStrategy: 'manual' as const,
                    assignedAgentId: agentId,
                    createdBy: 'test-user'
                });
                testTaskIds.push(created.id!);

                const unassigned = await repos.tasks.unassign(created.id!);

                expect(unassigned).not.toBeNull();
                expect(unassigned?.assignedAgentId).toBeUndefined();
                expect(unassigned?.status).toBe('pending');
            });

            it('should find tasks by assignee', async () => {
                const agentId = generateTestId('find-assignee');
                const created = await repos.tasks.create({
                    channelId,
                    title: 'Assignee Find Task',
                    description: 'Task for finding by assignee',
                    priority: 'medium' as TaskPriority,
                    status: 'assigned' as TaskStatus,
                    assignmentStrategy: 'manual' as const,
                    assignedAgentId: agentId,
                    createdBy: 'test-user'
                });
                testTaskIds.push(created.id!);

                const found = await repos.tasks.findByAssignee(agentId);

                expect(found.length).toBeGreaterThanOrEqual(1);
                const foundTask = found.find(t => t.id === created.id);
                expect(foundTask).toBeDefined();
            });
        });

        describe('Task Progress', () => {
            it('should update task progress', async () => {
                const created = await repos.tasks.create({
                    channelId,
                    title: 'Progress Task',
                    description: 'Task for progress update',
                    priority: 'medium' as TaskPriority,
                    status: 'in_progress' as TaskStatus,
                    assignmentStrategy: 'manual' as const,
                    progress: 0,
                    createdBy: 'test-user'
                });
                testTaskIds.push(created.id!);

                const updated = await repos.tasks.updateProgress(created.id!, 75);

                expect(updated).not.toBeNull();
                expect(updated?.progress).toBe(75);
            });
        });

        describe('Task Filtering by Channel', () => {
            it('should find tasks by channel', async () => {
                const created = await repos.tasks.create({
                    channelId,
                    title: 'Channel Task',
                    description: 'Task in specific channel',
                    priority: 'high' as TaskPriority,
                    status: 'pending' as TaskStatus,
                    assignmentStrategy: 'manual' as const,
                    createdBy: 'test-user'
                });
                testTaskIds.push(created.id!);

                const found = await repos.tasks.findByChannel(channelId);

                expect(found.length).toBeGreaterThanOrEqual(1);
                for (const task of found) {
                    expect(task.channelId).toBe(channelId);
                }
            });

            it('should find pending tasks in channel', async () => {
                const pending = await repos.tasks.findPending(channelId);

                for (const task of pending) {
                    expect(task.status).toBe('pending');
                    expect(task.channelId).toBe(channelId);
                }
            });
        });

        describe('Task Statistics', () => {
            it('should get channel statistics', async () => {
                const stats = await repos.tasks.getChannelStatistics(channelId);

                expect(stats).toBeDefined();
                expect(typeof stats.total).toBe('number');
                expect(stats.byStatus).toBeDefined();
                expect(stats.byPriority).toBeDefined();
                expect(typeof stats.overdueCount).toBe('number');
            });

            it('should get agent statistics', async () => {
                const agentId = generateTestId('stats-agent');
                await repos.tasks.create({
                    channelId,
                    title: 'Stats Task',
                    description: 'Task for agent stats',
                    priority: 'medium' as TaskPriority,
                    status: 'assigned' as TaskStatus,
                    assignmentStrategy: 'manual' as const,
                    assignedAgentId: agentId,
                    createdBy: 'test-user'
                }).then(t => testTaskIds.push(t.id!));

                const stats = await repos.tasks.getAgentStatistics(agentId);

                expect(stats).toBeDefined();
                expect(stats.total).toBeGreaterThanOrEqual(1);
            });
        });

        describe('Task Priority', () => {
            it('should find tasks by priority', async () => {
                const created = await repos.tasks.create({
                    channelId,
                    title: 'Urgent Priority Task',
                    description: 'Urgent task',
                    priority: 'urgent' as TaskPriority,
                    status: 'pending' as TaskStatus,
                    assignmentStrategy: 'manual' as const,
                    createdBy: 'test-user'
                });
                testTaskIds.push(created.id!);

                const found = await repos.tasks.findByPriority('urgent');

                expect(found.length).toBeGreaterThanOrEqual(1);
                for (const task of found) {
                    expect(task.priority).toBe('urgent');
                }
            });
        });

        describe('Overdue Tasks', () => {
            it('should find overdue tasks', async () => {
                // Create task first with a future due date (model validates new tasks)
                const futureDate = new Date(Date.now() + 86400000); // 1 day in future

                const created = await repos.tasks.create({
                    channelId,
                    title: 'Overdue Task',
                    description: 'Task that is overdue',
                    priority: 'high' as TaskPriority,
                    status: 'in_progress' as TaskStatus,
                    assignmentStrategy: 'manual' as const,
                    dueDate: futureDate,
                    createdBy: 'test-user'
                });
                testTaskIds.push(created.id!);

                // Update the due date to the past (validation only applies to new tasks)
                const pastDate = new Date(Date.now() - 86400000); // 1 day ago
                await repos.tasks.update(created.id!, { dueDate: pastDate });

                const overdue = await repos.tasks.findOverdue();

                expect(overdue.length).toBeGreaterThanOrEqual(1);
                const foundOverdue = overdue.find(t => t.id === created.id);
                expect(foundOverdue).toBeDefined();
            });
        });
    });

    // =========================================================================
    // Memory Repository Tests
    // =========================================================================

    describe('Memory Repository', () => {
        describe('Agent Memory Operations', () => {
            it('should save and get agent memory', async () => {
                const agentId = generateTestId('mem-agent');
                testMemoryAgentIds.push(agentId);

                const memory = await repos.memory.saveAgentMemory({
                    agentId,
                    notes: { key: 'value', nested: { a: 1 } },
                    customData: { preference: 'test' }
                });

                expect(memory).toBeDefined();
                expect(memory.agentId).toBe(agentId);
                expect(memory.notes?.key).toBe('value');

                const retrieved = await repos.memory.getAgentMemory(agentId);

                expect(retrieved).not.toBeNull();
                expect(retrieved?.notes?.key).toBe('value');
            });

            it('should update agent memory', async () => {
                const agentId = generateTestId('update-mem-agent');
                testMemoryAgentIds.push(agentId);

                await repos.memory.saveAgentMemory({
                    agentId,
                    notes: { original: true }
                });

                const updated = await repos.memory.updateAgentMemory(agentId, {
                    notes: { updated: true }
                });

                expect(updated).not.toBeNull();
                expect(updated?.notes?.updated).toBe(true);
            });

            it('should delete agent memory', async () => {
                const agentId = generateTestId('delete-mem-agent');

                await repos.memory.saveAgentMemory({
                    agentId,
                    notes: { toDelete: true }
                });

                const deleted = await repos.memory.deleteAgentMemory(agentId);
                expect(deleted).toBe(true);

                const retrieved = await repos.memory.getAgentMemory(agentId);
                expect(retrieved).toBeNull();
            });

            it('should return null for non-existent agent memory', async () => {
                const retrieved = await repos.memory.getAgentMemory('non-existent-agent');
                expect(retrieved).toBeNull();
            });
        });

        describe('Channel Memory Operations', () => {
            it('should save and get channel memory', async () => {
                const memChannelId = generateTestId('mem-channel');
                testMemoryChannelIds.push(memChannelId);

                const memory = await repos.memory.saveChannelMemory({
                    channelId: memChannelId,
                    notes: { topic: 'testing' },
                    sharedState: { counter: 0 }
                });

                expect(memory).toBeDefined();
                expect(memory.channelId).toBe(memChannelId);

                const retrieved = await repos.memory.getChannelMemory(memChannelId);

                expect(retrieved).not.toBeNull();
                expect(retrieved?.notes?.topic).toBe('testing');
                expect(retrieved?.sharedState?.counter).toBe(0);
            });

            it('should update channel memory', async () => {
                const memChannelId = generateTestId('update-mem-channel');
                testMemoryChannelIds.push(memChannelId);

                await repos.memory.saveChannelMemory({
                    channelId: memChannelId,
                    sharedState: { version: 1 }
                });

                const updated = await repos.memory.updateChannelMemory(memChannelId, {
                    sharedState: { version: 2 }
                });

                expect(updated?.sharedState?.version).toBe(2);
            });

            it('should delete channel memory', async () => {
                const memChannelId = generateTestId('delete-mem-channel');

                await repos.memory.saveChannelMemory({
                    channelId: memChannelId,
                    notes: { toDelete: true }
                });

                const deleted = await repos.memory.deleteChannelMemory(memChannelId);
                expect(deleted).toBe(true);

                const retrieved = await repos.memory.getChannelMemory(memChannelId);
                expect(retrieved).toBeNull();
            });
        });

        describe('Relationship Memory Operations', () => {
            it('should save and get relationship memory', async () => {
                const agentId1 = generateTestId('rel-agent-1');
                const agentId2 = generateTestId('rel-agent-2');
                testMemoryAgentIds.push(agentId1, agentId2);

                const memory = await repos.memory.saveRelationshipMemory({
                    agentId1,
                    agentId2,
                    notes: { trust: 'high' },
                    interactionHistory: [{ type: 'greeting', timestamp: new Date() }]
                });

                expect(memory).toBeDefined();

                const retrieved = await repos.memory.getRelationshipMemory(agentId1, agentId2);

                expect(retrieved).not.toBeNull();
                expect(retrieved?.notes?.trust).toBe('high');
            });

            it('should find relationship memory regardless of agent order', async () => {
                const agentId1 = generateTestId('order-agent-1');
                const agentId2 = generateTestId('order-agent-2');
                testMemoryAgentIds.push(agentId1, agentId2);

                await repos.memory.saveRelationshipMemory({
                    agentId1,
                    agentId2,
                    notes: { bidirectional: true }
                });

                // Query with reversed order
                const retrieved = await repos.memory.getRelationshipMemory(agentId2, agentId1);

                expect(retrieved).not.toBeNull();
                expect(retrieved?.notes?.bidirectional).toBe(true);
            });

            it('should get all relationships for an agent', async () => {
                const mainAgent = generateTestId('main-agent');
                const otherAgent1 = generateTestId('other-1');
                const otherAgent2 = generateTestId('other-2');
                testMemoryAgentIds.push(mainAgent, otherAgent1, otherAgent2);

                await repos.memory.saveRelationshipMemory({
                    agentId1: mainAgent,
                    agentId2: otherAgent1,
                    notes: { relationship: 1 }
                });

                await repos.memory.saveRelationshipMemory({
                    agentId1: mainAgent,
                    agentId2: otherAgent2,
                    notes: { relationship: 2 }
                });

                const relationships = await repos.memory.getAgentRelationships(mainAgent);

                expect(relationships.length).toBeGreaterThanOrEqual(2);
            });

            it('should delete relationship memory', async () => {
                const agentId1 = generateTestId('del-rel-1');
                const agentId2 = generateTestId('del-rel-2');

                await repos.memory.saveRelationshipMemory({
                    agentId1,
                    agentId2,
                    notes: { toDelete: true }
                });

                const deleted = await repos.memory.deleteRelationshipMemory(agentId1, agentId2);
                expect(deleted).toBe(true);

                const retrieved = await repos.memory.getRelationshipMemory(agentId1, agentId2);
                expect(retrieved).toBeNull();
            });
        });

        describe('Memory Bulk Operations', () => {
            it('should delete memory by scope (agent)', async () => {
                const agentId = generateTestId('scope-del-agent');

                await repos.memory.saveAgentMemory({
                    agentId,
                    notes: { scopeDelete: true }
                });

                const deleted = await repos.memory.deleteByScope(MemoryScope.AGENT, agentId);
                expect(deleted).toBe(true);

                const retrieved = await repos.memory.getAgentMemory(agentId);
                expect(retrieved).toBeNull();
            });

            it('should delete memory by scope (channel)', async () => {
                const memChannelId = generateTestId('scope-del-channel');

                await repos.memory.saveChannelMemory({
                    channelId: memChannelId,
                    notes: { scopeDelete: true }
                });

                const deleted = await repos.memory.deleteByScope(MemoryScope.CHANNEL, memChannelId);
                expect(deleted).toBe(true);

                const retrieved = await repos.memory.getChannelMemory(memChannelId);
                expect(retrieved).toBeNull();
            });
        });

        describe('Memory Statistics', () => {
            it('should get memory statistics', async () => {
                const stats = await repos.memory.getStatistics();

                expect(stats).toBeDefined();
                expect(typeof stats.agentMemoryCount).toBe('number');
                expect(typeof stats.channelMemoryCount).toBe('number');
                expect(typeof stats.relationshipMemoryCount).toBe('number');
            });
        });
    });

    // =========================================================================
    // Filter and Pagination Tests
    // =========================================================================

    describe('Filter and Pagination Operations', () => {
        describe('Pagination', () => {
            it('should paginate results with limit and offset', async () => {
                // Create multiple agents for pagination testing
                const baseId = generateTestId('page');
                for (let i = 0; i < 5; i++) {
                    const agentId = `${baseId}-${i}`;
                    testAgentIds.push(agentId);
                    await repos.agents.create({
                        agentId,
                        name: `Pagination Agent ${i}`,
                        serviceTypes: ['pagination-test'],
                        status: 'ACTIVE' as const,
                        createdBy: 'test-user',
                        lastActive: new Date()
                    });
                }

                const pagination: PaginationOptions = {
                    limit: 2,
                    offset: 0,
                    sortBy: 'createdAt',
                    sortOrder: 'desc'
                };

                const filter: FilterOptions<IAgentEntity> = {
                    arrayContains: [{
                        field: 'serviceTypes',
                        value: 'pagination-test',
                        mode: 'any'
                    }]
                };

                const page1 = await repos.agents.findMany(filter, pagination);

                expect(page1.items.length).toBeLessThanOrEqual(2);
                expect(page1.pagination.limit).toBe(2);
                expect(page1.pagination.offset).toBe(0);
                expect(page1.pagination.page).toBe(1);
            });

            it('should return correct pagination metadata', async () => {
                const pagination: PaginationOptions = {
                    limit: 10,
                    offset: 0
                };

                const result = await repos.agents.findMany(undefined, pagination);

                expect(result.pagination).toBeDefined();
                expect(result.pagination.totalPages).toBe(Math.ceil(result.total / 10));
                expect(typeof result.hasMore).toBe('boolean');
            });
        });

        describe('Filter Operations', () => {
            it('should filter by equality', async () => {
                const agentId = generateTestId('filter-eq');
                testAgentIds.push(agentId);

                await repos.agents.create({
                    agentId,
                    name: 'Filter Equality Agent',
                    serviceTypes: ['filter-test'],
                    status: 'ACTIVE' as const,
                    createdBy: 'filter-test-user',
                    lastActive: new Date()
                });

                const filter: FilterOptions<IAgentEntity> = {
                    where: { status: 'ACTIVE' } as any
                };

                const result = await repos.agents.findMany(filter);

                expect(result.items.length).toBeGreaterThan(0);
                for (const agent of result.items) {
                    expect(agent.status).toBe('ACTIVE');
                }
            });

            it('should filter with comparison operators', async () => {
                const agentId = generateTestId('filter-comp');
                testAgentIds.push(agentId);

                const recentDate = new Date(Date.now() - 60000); // 1 minute ago

                await repos.agents.create({
                    agentId,
                    name: 'Filter Comparison Agent',
                    serviceTypes: ['comparison-test'],
                    status: 'ACTIVE' as const,
                    createdBy: 'test-user',
                    lastActive: new Date()
                });

                const filter: FilterOptions<IAgentEntity> = {
                    comparisons: [{
                        field: 'lastActive',
                        operator: 'gte',
                        value: recentDate
                    }]
                };

                const result = await repos.agents.findMany(filter);

                expect(result.items.length).toBeGreaterThan(0);
            });

            it('should filter with array contains (any mode)', async () => {
                const agentId = generateTestId('filter-array');
                testAgentIds.push(agentId);

                await repos.agents.create({
                    agentId,
                    name: 'Filter Array Agent',
                    serviceTypes: ['unique-array-service'],
                    status: 'ACTIVE' as const,
                    createdBy: 'test-user',
                    lastActive: new Date()
                });

                const filter: FilterOptions<IAgentEntity> = {
                    arrayContains: [{
                        field: 'serviceTypes',
                        value: 'unique-array-service',
                        mode: 'any'
                    }]
                };

                const result = await repos.agents.findMany(filter);

                expect(result.items.length).toBeGreaterThanOrEqual(1);
                const found = result.items.find(a => a.agentId === agentId);
                expect(found).toBeDefined();
            });
        });

        describe('Count and Exists Operations', () => {
            it('should count entities matching filter', async () => {
                const filter: FilterOptions<IAgentEntity> = {
                    where: { status: 'ACTIVE' } as any
                };

                const count = await repos.agents.count(filter);

                expect(typeof count).toBe('number');
                expect(count).toBeGreaterThanOrEqual(0);
            });

            it('should check if entity exists', async () => {
                const agentId = generateTestId('exists-agent');
                testAgentIds.push(agentId);

                await repos.agents.create({
                    agentId,
                    name: 'Exists Agent',
                    serviceTypes: ['exists-test-unique'],
                    status: 'ACTIVE' as const,
                    createdBy: 'test-user',
                    lastActive: new Date()
                });

                const existsFilter: FilterOptions<IAgentEntity> = {
                    arrayContains: [{
                        field: 'serviceTypes',
                        value: 'exists-test-unique',
                        mode: 'any'
                    }]
                };

                const exists = await repos.agents.exists(existsFilter);
                expect(exists).toBe(true);

                const notExistsFilter: FilterOptions<IAgentEntity> = {
                    arrayContains: [{
                        field: 'serviceTypes',
                        value: 'non-existent-service-type-12345',
                        mode: 'any'
                    }]
                };

                const notExists = await repos.agents.exists(notExistsFilter);
                expect(notExists).toBe(false);
            });
        });
    });
});
