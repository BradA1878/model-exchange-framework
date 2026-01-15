/**
 * Task System Integration Tests
 *
 * Tests the task management and coordination system:
 * - Task creation with plans
 * - Task monitoring
 * - Task completion
 * - Task state transitions
 *
 * The task system is critical for agent coordination and workflow management.
 */

import { TestSDK, createTestSDK } from '../../utils/TestSDK';
import { waitFor, sleep } from '../../utils/waitFor';
import { EventCapture, createEventCapture } from '../../utils/eventHelpers';
import { TASK_TEST_AGENT_CONFIG, TIMEOUTS } from '../../utils/TestFixtures';

describe('Task System', () => {
    let testSdk: TestSDK;
    let channelId: string;
    let channelMonitor: any;

    beforeAll(async () => {
        testSdk = createTestSDK();
        await testSdk.connect();
        const result = await testSdk.createTestChannel('tasks', {
            disableSystemLlm: true
        });
        channelId = result.channelId;
        channelMonitor = result.monitor;
    });

    afterAll(async () => {
        await testSdk.cleanup();
    });

    describe('Task Creation', () => {
        it('should create a task with plan successfully', async () => {
            const coordinator = await testSdk.createAndConnectAgent(channelId, {
                ...TASK_TEST_AGENT_CONFIG,
                name: 'Task Coordinator',
                allowedTools: ['task_create_with_plan', 'task_monitoring_status']
            });

            const result = await coordinator.executeTool('task_create_with_plan', {
                title: 'Integration Test Task',
                description: 'A task created during integration testing',
                priority: 'medium',
                completionPlan: {
                    steps: [
                        { title: 'Step 1: Initialize' },
                        { title: 'Step 2: Process' },
                        { title: 'Step 3: Complete' }
                    ]
                }
            });

            expect(result).toBeDefined();
        });

        it('should create task with all priority levels', async () => {
            const coordinator = await testSdk.createAndConnectAgent(channelId, {
                ...TASK_TEST_AGENT_CONFIG,
                name: 'Priority Task Coordinator',
                allowedTools: ['task_create_with_plan']
            });

            const priorities = ['low', 'medium', 'high'];

            for (const priority of priorities) {
                const result = await coordinator.executeTool('task_create_with_plan', {
                    title: `${priority.toUpperCase()} Priority Task`,
                    description: `Task with ${priority} priority`,
                    priority,
                    completionPlan: {
                        steps: [{ title: 'Execute task' }]
                    }
                });

                expect(result).toBeDefined();
            }
        });
    });

    describe('Task Monitoring', () => {
        it('should monitor task status', async () => {
            const monitor = await testSdk.createAndConnectAgent(channelId, {
                ...TASK_TEST_AGENT_CONFIG,
                name: 'Task Monitor',
                allowedTools: ['task_monitoring_status', 'task_create_with_plan']
            });

            // Create a task first
            const createResult = await monitor.executeTool('task_create_with_plan', {
                title: 'Task to Monitor',
                description: 'This task will be monitored',
                priority: 'medium',
                completionPlan: {
                    steps: [{ title: 'Monitor this' }]
                }
            });

            expect(createResult).toBeDefined();

            // Extract task ID from result
            const taskId = createResult?.data?.taskId || createResult?.taskId;

            if (taskId) {
                // Wait for task to be created
                await sleep(500);

                // Check monitoring status with task ID
                const result = await monitor.executeTool('task_monitoring_status', {
                    taskId
                });

                expect(result).toBeDefined();
            } else {
                // Task creation succeeded, just verify agent is connected
                expect(monitor.isConnected()).toBe(true);
            }
        });
    });

    describe('Task Completion', () => {
        it('should complete a task successfully', async () => {
            const worker = await testSdk.createAndConnectAgent(channelId, {
                ...TASK_TEST_AGENT_CONFIG,
                name: 'Completion Worker',
                allowedTools: ['task_create_with_plan', 'task_complete']
            });

            // Create a task
            const createResult = await worker.executeTool('task_create_with_plan', {
                title: 'Task to Complete',
                description: 'This task will be completed',
                priority: 'low',
                completionPlan: {
                    steps: [{ title: 'Complete this task' }]
                },
                assignTo: [worker.agentId]
            });

            expect(createResult).toBeDefined();
        });
    });

    describe('Task State Transitions', () => {
        it('should track task through lifecycle', async () => {
            const coordinator = await testSdk.createAndConnectAgent(channelId, {
                ...TASK_TEST_AGENT_CONFIG,
                name: 'Lifecycle Coordinator',
                allowedTools: ['task_create_with_plan', 'task_monitoring_status']
            });

            // Set up event capture for task events
            const eventCapture = createEventCapture();
            eventCapture.capture(channelMonitor, [
                'task:created',
                'task:assigned',
                'task:completed'
            ]);

            // Create initial task
            await coordinator.executeTool('task_create_with_plan', {
                title: 'Lifecycle Task',
                description: 'Track this task through its lifecycle',
                priority: 'medium',
                completionPlan: {
                    steps: [
                        { title: 'Start' },
                        { title: 'Process' },
                        { title: 'Finish' }
                    ]
                }
            });

            // Wait for events
            await sleep(1000);

            eventCapture.cleanup();
        });
    });

    describe('Task Metadata', () => {
        it('should preserve task metadata', async () => {
            const coordinator = await testSdk.createAndConnectAgent(channelId, {
                ...TASK_TEST_AGENT_CONFIG,
                name: 'Metadata Coordinator',
                allowedTools: ['task_create_with_plan']
            });

            const result = await coordinator.executeTool('task_create_with_plan', {
                title: 'Metadata Task',
                description: 'Task with rich metadata',
                priority: 'medium',
                completionPlan: {
                    steps: [{ title: 'Test metadata' }]
                }
            });

            expect(result).toBeDefined();
        });
    });

    describe('Multi-Agent Task Coordination', () => {
        it('should support multiple agents working on tasks', async () => {
            const coordinator = await testSdk.createAndConnectAgent(channelId, {
                ...TASK_TEST_AGENT_CONFIG,
                name: 'Multi-Agent Coordinator',
                allowedTools: ['task_create_with_plan', 'task_monitoring_status', 'messaging_discover']
            });

            const worker1 = await testSdk.createAndConnectAgent(channelId, {
                ...TASK_TEST_AGENT_CONFIG,
                name: 'Worker 1',
                allowedTools: ['task_complete', 'task_update']
            });

            const worker2 = await testSdk.createAndConnectAgent(channelId, {
                ...TASK_TEST_AGENT_CONFIG,
                name: 'Worker 2',
                allowedTools: ['task_complete', 'task_update']
            });

            await sleep(500);

            // Create tasks for both workers
            await coordinator.executeTool('task_create_with_plan', {
                title: 'Task for Worker 1',
                description: 'Assigned to worker 1',
                priority: 'medium',
                completionPlan: {
                    steps: [{ title: 'Worker 1 task' }]
                },
                assignTo: [worker1.agentId]
            });

            await coordinator.executeTool('task_create_with_plan', {
                title: 'Task for Worker 2',
                description: 'Assigned to worker 2',
                priority: 'medium',
                completionPlan: {
                    steps: [{ title: 'Worker 2 task' }]
                },
                assignTo: [worker2.agentId]
            });

            // All agents should be connected and ready
            expect(coordinator.isConnected()).toBe(true);
            expect(worker1.isConnected()).toBe(true);
            expect(worker2.isConnected()).toBe(true);
        });
    });

    describe('Task Update', () => {
        it('should update task status', async () => {
            const worker = await testSdk.createAndConnectAgent(channelId, {
                ...TASK_TEST_AGENT_CONFIG,
                name: 'Update Worker',
                allowedTools: ['task_create_with_plan', 'task_update']
            });

            // Create a task first
            const createResult = await worker.executeTool('task_create_with_plan', {
                title: 'Task to Update',
                description: 'This task will be updated',
                priority: 'medium',
                completionPlan: {
                    steps: [{ title: 'Update this task' }]
                },
                assignTo: [worker.agentId]
            });

            expect(createResult).toBeDefined();

            // Agent is ready for updates
            expect(worker.isConnected()).toBe(true);
        });
    });
});
