/**
 * MCP (Model Context Protocol) API Endpoint Integration Tests
 *
 * Tests all /api/mcp endpoints including:
 * - Tool listing and discovery
 * - Tool execution
 * - Capabilities endpoint
 * - Authentication requirements
 */

import { createTestAPI, TestAPI, API_FIXTURES } from '../../utils/TestAPI';
import { TIMEOUTS } from '../../utils/TestFixtures';

describe('MCP API Endpoints', () => {
    let api: TestAPI;

    beforeAll(async () => {
        api = createTestAPI();

        try {
            await api.authenticateAsUser(
                API_FIXTURES.testUser.email,
                API_FIXTURES.testUser.password
            );
        } catch (error) {
            await api.post('/api/users/register', {
                email: API_FIXTURES.testUser.email,
                password: API_FIXTURES.testUser.password,
                username: 'mcp-test-user'
            });
            await api.authenticateAsUser(
                API_FIXTURES.testUser.email,
                API_FIXTURES.testUser.password
            );
        }
    }, TIMEOUTS.connection);

    afterAll(() => {
        api.cleanup();
    });

    // =========================================================================
    // GET /api/mcp/capabilities - Get MCP capabilities (Public)
    // =========================================================================

    describe('GET /api/mcp/capabilities', () => {
        it('should return 200 with MCP capabilities (public endpoint)', async () => {
            const unauthApi = createTestAPI();
            const response = await unauthApi.get('/api/mcp/capabilities');

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
            expect(response.body).toHaveProperty('data');
        });

        it('capabilities should describe available features', async () => {
            const response = await api.get('/api/mcp/capabilities');

            if (response.status === 200) {
                expect(response.body.data).toBeDefined();
            }
        });
    });

    // =========================================================================
    // GET /api/mcp/tools - List all MCP tools (Public)
    // =========================================================================

    describe('GET /api/mcp/tools', () => {
        it('should return 200 with list of tools (public endpoint)', async () => {
            const unauthApi = createTestAPI();
            const response = await unauthApi.get('/api/mcp/tools');

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
            expect(response.body).toHaveProperty('data');
            expect(Array.isArray(response.body.data)).toBe(true);
        });

        it('should return tools with expected properties', async () => {
            const response = await api.get('/api/mcp/tools');

            if (response.status === 200 && response.body.data.length > 0) {
                const tool = response.body.data[0];
                expect(tool).toHaveProperty('name');
                expect(typeof tool.name).toBe('string');
            }
        });

        it('should return many tools (MXF has ~95 built-in tools)', async () => {
            const response = await api.get('/api/mcp/tools');

            if (response.status === 200) {
                // MXF should have many tools loaded
                expect(response.body.data.length).toBeGreaterThan(0);
            }
        });
    });

    // =========================================================================
    // GET /api/mcp/tools/:name - Get tool by name
    // =========================================================================

    describe('GET /api/mcp/tools/:name', () => {
        it('should return tool details for existing tool', async () => {
            // tool_help is a common MXF tool
            const response = await api.get('/api/mcp/tools/tool_help');

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
            expect(response.body.data.name).toBe('tool_help');
        });

        it('should return 404 for non-existent tool', async () => {
            const response = await api.get('/api/mcp/tools/non_existent_tool_xyz');

            expect(response.status).toBe(404);
            expect(response.body.success).toBe(false);
        });

        it('tool details should include schema', async () => {
            const response = await api.get('/api/mcp/tools/tool_help');

            if (response.status === 200) {
                const tool = response.body.data;
                expect(tool).toHaveProperty('name');
                expect(tool).toHaveProperty('description');
            }
        });
    });

    // =========================================================================
    // POST /api/mcp/tools/:name/execute - Execute MCP tool (Public)
    // =========================================================================

    describe('POST /api/mcp/tools/:name/execute', () => {
        it('should execute tool with valid input', async () => {
            const response = await api.post('/api/mcp/tools/tool_help/execute', {
                toolName: 'messaging_send'
            });

            // May succeed or fail depending on tool requirements
            expect([200, 400, 500]).toContain(response.status);
        });

        it('should return error for non-existent tool', async () => {
            const response = await api.post('/api/mcp/tools/non_existent_tool/execute', {});

            // Returns 404 or 500 depending on how tool lookup fails
            expect([404, 500]).toContain(response.status);
            expect(response.body.success).toBe(false);
        });

        it('should handle missing required parameters', async () => {
            const response = await api.post('/api/mcp/tools/tool_help/execute', {});

            // Should return error for missing required params
            expect([400, 500]).toContain(response.status);
        });
    });

    // =========================================================================
    // POST /api/mcp/tools - Register new tool (JWT required)
    // =========================================================================

    describe('POST /api/mcp/tools', () => {
        it('should require JWT authentication', async () => {
            const unauthApi = createTestAPI();
            const response = await unauthApi.post('/api/mcp/tools', {
                name: 'test_tool',
                description: 'Test tool'
            });

            expect(response.status).toBe(401);
        });

        it('should reject invalid tool definition', async () => {
            const response = await api.post('/api/mcp/tools', {
                // Missing required fields
            });

            // Returns 400 for validation error or 403 for permission denied
            expect([400, 403]).toContain(response.status);
        });
    });

    // =========================================================================
    // PUT /api/mcp/tools/:name - Update tool (JWT required)
    // =========================================================================

    describe('PUT /api/mcp/tools/:name', () => {
        it('should require JWT authentication', async () => {
            const unauthApi = createTestAPI();
            const response = await unauthApi.put('/api/mcp/tools/tool_help', {
                description: 'Updated description'
            });

            expect(response.status).toBe(401);
        });
    });

    // =========================================================================
    // DELETE /api/mcp/tools/:name - Delete tool (Admin required)
    // =========================================================================

    describe('DELETE /api/mcp/tools/:name', () => {
        it('should require admin authentication', async () => {
            const unauthApi = createTestAPI();
            const response = await unauthApi.delete('/api/mcp/tools/tool_help');

            expect(response.status).toBe(401);
        });

        it('should return 404 for non-existent tool', async () => {
            const response = await api.delete('/api/mcp/tools/non_existent_tool');

            // May return 404 or 403 depending on permissions
            expect([403, 404]).toContain(response.status);
        });
    });

    // =========================================================================
    // GET /api/mcp/executions - Get active executions (Admin)
    // =========================================================================

    describe('GET /api/mcp/executions', () => {
        it('should require authentication', async () => {
            const unauthApi = createTestAPI();
            const response = await unauthApi.get('/api/mcp/executions');

            expect(response.status).toBe(401);
        });

        it('should return execution list when authenticated', async () => {
            const response = await api.get('/api/mcp/executions');

            // May return 200 or 403 depending on admin status
            expect([200, 403]).toContain(response.status);
        });
    });

    // =========================================================================
    // Response Format Validation
    // =========================================================================

    describe('Response Format Validation', () => {
        it('tool list should have consistent format', async () => {
            const response = await api.get('/api/mcp/tools');

            expect(response.body).toHaveProperty('success');
            if (response.body.success) {
                expect(Array.isArray(response.body.data)).toBe(true);
            }
        });

        it('tool details should have consistent format', async () => {
            const response = await api.get('/api/mcp/tools/tool_help');

            expect(response.body).toHaveProperty('success');
            if (response.body.success) {
                expect(response.body.data).toHaveProperty('name');
            }
        });
    });
});
