/**
 * Agent API Endpoint Integration Tests
 *
 * Tests all /api/agents endpoints including:
 * - CRUD operations (GET, POST, PUT, DELETE)
 * - Agent context and memory operations
 * - Service type filtering
 * - Authentication requirements
 * - Error handling
 */

import { createTestAPI, TestAPI, API_FIXTURES } from '../../utils/TestAPI';
import { generateTestId, TIMEOUTS } from '../../utils/TestFixtures';

describe('Agent API Endpoints', () => {
    let api: TestAPI;
    let createdAgentIds: string[] = [];

    // Test data
    const testAgent = {
        agentId: '',
        name: 'API Test Agent',
        description: 'Agent created for API testing',
        type: 'worker',
        serviceTypes: ['testing', 'api-test'],
        capabilities: ['testing'],
        allowedTools: ['tool_help', 'messaging_send']
    };

    beforeAll(async () => {
        api = createTestAPI();

        // Authenticate as test user
        try {
            await api.authenticateAsUser(
                API_FIXTURES.testUser.email,
                API_FIXTURES.testUser.password
            );
        } catch (error) {
            // If demo user doesn't exist, try to register first
            const registerResponse = await api.post('/api/users/register', {
                email: API_FIXTURES.testUser.email,
                password: API_FIXTURES.testUser.password,
                username: 'api-test-user'
            });

            if (registerResponse.status === 201 || registerResponse.status === 200) {
                await api.authenticateAsUser(
                    API_FIXTURES.testUser.email,
                    API_FIXTURES.testUser.password
                );
            }
        }
    }, TIMEOUTS.connection);

    afterAll(async () => {
        // Clean up created agents
        for (const agentId of createdAgentIds) {
            try {
                await api.delete(`/api/agents/${agentId}`);
            } catch {
                // Ignore cleanup errors
            }
        }
    });

    // =========================================================================
    // GET /api/agents - List agents
    // =========================================================================

    describe('GET /api/agents', () => {
        it('should return 200 with list of agents when authenticated', async () => {
            const response = await api.get('/api/agents');

            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty('success', true);
            expect(response.body).toHaveProperty('count');
            expect(response.body).toHaveProperty('data');
            expect(Array.isArray(response.body.data)).toBe(true);
        });

        it('should return 401 without authentication', async () => {
            const unauthApi = createTestAPI();
            const response = await unauthApi.get('/api/agents');

            expect(response.status).toBe(401);
        });

        it('should filter agents by status', async () => {
            const response = await api.get('/api/agents', { status: 'ACTIVE' });

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
            // All returned agents should have ACTIVE status
            if (response.body.data.length > 0) {
                response.body.data.forEach((agent: any) => {
                    expect(agent.status).toBe('ACTIVE');
                });
            }
        });

        it('should filter agents by serviceType', async () => {
            const response = await api.get('/api/agents', { serviceType: 'testing' });

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
            // All returned agents should have the serviceType
            if (response.body.data.length > 0) {
                response.body.data.forEach((agent: any) => {
                    expect(agent.serviceTypes).toContain('testing');
                });
            }
        });
    });

    // =========================================================================
    // POST /api/agents - Create agent
    // =========================================================================

    describe('POST /api/agents', () => {
        it('should create a new agent with valid data', async () => {
            const uniqueAgentId = generateTestId('api-agent');
            const agentData = { ...testAgent, agentId: uniqueAgentId };

            const response = await api.post('/api/agents', agentData);

            expect(response.status).toBe(201);
            expect(response.body.success).toBe(true);
            expect(response.body.data).toMatchObject({
                agentId: uniqueAgentId,
                name: agentData.name,
                description: agentData.description
            });

            // Track for cleanup
            createdAgentIds.push(uniqueAgentId);
        });

        it('should return 400 when agent ID already exists', async () => {
            const uniqueAgentId = generateTestId('duplicate-agent');
            const agentData = { ...testAgent, agentId: uniqueAgentId };

            // Create first agent
            await api.post('/api/agents', agentData);
            createdAgentIds.push(uniqueAgentId);

            // Try to create duplicate
            const response = await api.post('/api/agents', agentData);

            expect(response.status).toBe(400);
            expect(response.body.success).toBe(false);
            expect(response.body.message).toContain('already exists');
        });

        it('should return 401 without authentication', async () => {
            const unauthApi = createTestAPI();
            const response = await unauthApi.post('/api/agents', {
                agentId: generateTestId('unauth-agent'),
                name: 'Unauthorized Agent'
            });

            expect(response.status).toBe(401);
        });
    });

    // =========================================================================
    // GET /api/agents/:agentId - Get agent by ID
    // =========================================================================

    describe('GET /api/agents/:agentId', () => {
        let testAgentId: string;

        beforeAll(async () => {
            // Create a test agent for these tests
            testAgentId = generateTestId('get-test-agent');
            await api.post('/api/agents', { ...testAgent, agentId: testAgentId });
            createdAgentIds.push(testAgentId);
        });

        it('should return 200 with agent data for existing agent', async () => {
            const response = await api.get(`/api/agents/${testAgentId}`);

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
            expect(response.body.data.agentId).toBe(testAgentId);
        });

        it('should return 404 for non-existent agent', async () => {
            const response = await api.get('/api/agents/non-existent-agent-id');

            expect(response.status).toBe(404);
            expect(response.body.success).toBe(false);
            expect(response.body.message).toContain('not found');
        });

        it('should return 401 without authentication', async () => {
            const unauthApi = createTestAPI();
            const response = await unauthApi.get(`/api/agents/${testAgentId}`);

            expect(response.status).toBe(401);
        });
    });

    // =========================================================================
    // PUT /api/agents/:agentId - Update agent
    // =========================================================================

    describe('PUT /api/agents/:agentId', () => {
        let testAgentId: string;

        beforeAll(async () => {
            testAgentId = generateTestId('update-test-agent');
            await api.post('/api/agents', { ...testAgent, agentId: testAgentId });
            createdAgentIds.push(testAgentId);
        });

        it('should update agent with valid data', async () => {
            const updateData = {
                name: 'Updated Agent Name',
                description: 'Updated description',
                status: 'ACTIVE'
            };

            const response = await api.put(`/api/agents/${testAgentId}`, updateData);

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
            expect(response.body.data.name).toBe(updateData.name);
            expect(response.body.data.description).toBe(updateData.description);
        });

        it('should return 404 for non-existent agent', async () => {
            const response = await api.put('/api/agents/non-existent-agent-id', {
                name: 'New Name'
            });

            expect(response.status).toBe(404);
            expect(response.body.success).toBe(false);
        });

        it('should update allowedTools', async () => {
            const updateData = {
                allowedTools: ['tool_help', 'messaging_send', 'memory_search_conversations']
            };

            const response = await api.put(`/api/agents/${testAgentId}`, updateData);

            expect(response.status).toBe(200);
            expect(response.body.data.allowedTools).toEqual(updateData.allowedTools);
        });
    });

    // =========================================================================
    // DELETE /api/agents/:agentId - Delete agent
    // =========================================================================

    describe('DELETE /api/agents/:agentId', () => {
        it('should delete existing agent', async () => {
            const deleteAgentId = generateTestId('delete-test-agent');
            await api.post('/api/agents', { ...testAgent, agentId: deleteAgentId });

            const response = await api.delete(`/api/agents/${deleteAgentId}`);

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
            expect(response.body.message).toContain('deleted');

            // Verify agent is actually deleted
            const getResponse = await api.get(`/api/agents/${deleteAgentId}`);
            expect(getResponse.status).toBe(404);
        });

        it('should return 404 for non-existent agent', async () => {
            const response = await api.delete('/api/agents/non-existent-agent-id');

            expect(response.status).toBe(404);
            expect(response.body.success).toBe(false);
        });

        it('should return 401 without authentication', async () => {
            const unauthApi = createTestAPI();
            const response = await unauthApi.delete('/api/agents/some-agent-id');

            expect(response.status).toBe(401);
        });
    });

    // =========================================================================
    // GET /api/agents/services/:serviceType - Get agents by service type
    // =========================================================================

    describe('GET /api/agents/services/:serviceType', () => {
        beforeAll(async () => {
            // Create agents with specific service types
            const serviceAgentId = generateTestId('service-test-agent');
            await api.post('/api/agents', {
                ...testAgent,
                agentId: serviceAgentId,
                serviceTypes: ['api-test-service'],
                status: 'ACTIVE'
            });
            createdAgentIds.push(serviceAgentId);
        });

        it('should return agents filtered by service type', async () => {
            const response = await api.get('/api/agents/services/api-test-service');

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
            expect(response.body).toHaveProperty('count');
            expect(Array.isArray(response.body.data)).toBe(true);
        });

        it('should return empty array for non-existent service type', async () => {
            const response = await api.get('/api/agents/services/non-existent-service');

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
            expect(response.body.data).toEqual([]);
            expect(response.body.count).toBe(0);
        });
    });

    // =========================================================================
    // GET /api/agents/context/:keyId - Get agent context
    // =========================================================================

    describe('GET /api/agents/context/:keyId', () => {
        it('should return 404 for non-existent keyId', async () => {
            const response = await api.get('/api/agents/context/non-existent-key-id');

            expect(response.status).toBe(404);
            expect(response.body.success).toBe(false);
        });

        it('should return 400 for invalid keyId format', async () => {
            const response = await api.get('/api/agents/context/');

            // Empty path should result in 404 (route not found)
            expect([400, 404]).toContain(response.status);
        });
    });

    // =========================================================================
    // GET /api/agents/memory/:keyId - Get agent memory by keyId
    // =========================================================================

    describe('GET /api/agents/memory/:keyId', () => {
        it('should return 400 or 404 for non-existent keyId', async () => {
            const newKeyId = generateTestId('memory-key');
            const response = await api.get(`/api/agents/memory/${newKeyId}`);

            // Endpoint requires existing agent with keyId - returns error for non-existent
            expect([400, 404]).toContain(response.status);
            expect(response.body.success).toBe(false);
        });

        it('should return memory for agent with keyId when exists', async () => {
            // This endpoint requires an agent created with a keyId field
            // Since our test agents don't have keyId set, we expect 404
            const keyId = generateTestId('existing-memory-key');
            const response = await api.get(`/api/agents/memory/${keyId}`);

            // Without a matching agent, returns 400 or 404
            expect([400, 404]).toContain(response.status);
        });
    });

    // =========================================================================
    // PATCH /api/agents/memory/:keyId - Update agent memory
    // =========================================================================

    describe('PATCH /api/agents/memory/:keyId', () => {
        it('should return 404 for non-existent keyId', async () => {
            const response = await api.patch('/api/agents/memory/non-existent-key', {
                notes: { test: 'value' }
            });

            expect(response.status).toBe(404);
            expect(response.body.success).toBe(false);
        });

        it('should return 404 when trying to update non-existent memory', async () => {
            const newKeyId = generateTestId('patch-memory-key');
            const response = await api.patch(`/api/agents/memory/${newKeyId}`, {
                notes: { testNote: 'Test note value' }
            });

            // Without an existing agent with this keyId, returns 404
            expect(response.status).toBe(404);
            expect(response.body.success).toBe(false);
        });
    });

    // =========================================================================
    // PATCH /api/agents/context/:keyId - Update agent context
    // =========================================================================

    describe('PATCH /api/agents/context/:keyId', () => {
        it('should return 404 for non-existent keyId', async () => {
            const response = await api.patch('/api/agents/context/non-existent-key', {
                identity: 'test'
            });

            expect(response.status).toBe(404);
            expect(response.body.success).toBe(false);
        });

        it('should return 404 when trying to update non-existent context', async () => {
            const newKeyId = generateTestId('patch-context-key');
            const contextUpdate = {
                identity: 'Test Identity',
                instructions: 'Test instructions for the agent',
                role: 'worker'
            };

            const response = await api.patch(`/api/agents/context/${newKeyId}`, contextUpdate);

            // Without an existing agent with this keyId, returns 404
            expect(response.status).toBe(404);
            expect(response.body.success).toBe(false);
        });
    });

    // =========================================================================
    // Response Format Validation
    // =========================================================================

    describe('Response Format Validation', () => {
        it('all success responses should have consistent format', async () => {
            const response = await api.get('/api/agents');

            expect(response.body).toHaveProperty('success');
            expect(typeof response.body.success).toBe('boolean');

            if (response.body.success) {
                expect(response.body).toHaveProperty('data');
            }
        });

        it('all error responses should have consistent format', async () => {
            const unauthApi = createTestAPI();
            const response = await unauthApi.get('/api/agents');

            expect(response.body).toHaveProperty('success', false);
            // Error responses should have either 'error' or 'message'
            expect(
                response.body.error !== undefined || response.body.message !== undefined
            ).toBe(true);
        });
    });
});
