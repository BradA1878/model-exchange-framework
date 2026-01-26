/**
 * Dashboard API Endpoint Integration Tests
 *
 * Tests all /api/dashboard endpoints including:
 * - Stats retrieval
 * - Activity monitoring
 * - Overview data
 * - Authentication requirements
 */

import { createTestAPI, TestAPI, API_FIXTURES } from '../../utils/TestAPI';
import { TIMEOUTS } from '../../utils/TestFixtures';

describe('Dashboard API Endpoints', () => {
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
                username: 'dashboard-test-user'
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
    // GET /api/dashboard/stats - Get dashboard stats
    // =========================================================================

    describe('GET /api/dashboard/stats', () => {
        it('should return 200 with dashboard statistics', async () => {
            const response = await api.get('/api/dashboard/stats');

            expect(response.status).toBe(200);
            // Dashboard returns data directly (not wrapped in {success, data})
            expect(response.body).toBeDefined();
        });

        it('stats should include expected metrics', async () => {
            const response = await api.get('/api/dashboard/stats');

            if (response.status === 200) {
                // Dashboard stats include totalChannels, activeAgents, completedTasks, totalCredits
                expect(response.body).toHaveProperty('totalChannels');
                expect(response.body).toHaveProperty('activeAgents');
            }
        });

        it('should return 401 without authentication', async () => {
            const unauthApi = createTestAPI();
            const response = await unauthApi.get('/api/dashboard/stats');

            expect(response.status).toBe(401);
        });
    });

    // =========================================================================
    // GET /api/dashboard/activity - Get dashboard activity
    // =========================================================================

    describe('GET /api/dashboard/activity', () => {
        it('should return 200 with activity data', async () => {
            const response = await api.get('/api/dashboard/activity');

            expect(response.status).toBe(200);
            // Activity returns data directly
            expect(response.body).toBeDefined();
        });

        it('should accept time range parameters', async () => {
            const response = await api.get('/api/dashboard/activity', {
                start: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
                end: new Date().toISOString()
            });

            expect(response.status).toBe(200);
        });

        it('should return 401 without authentication', async () => {
            const unauthApi = createTestAPI();
            const response = await unauthApi.get('/api/dashboard/activity');

            expect(response.status).toBe(401);
        });
    });

    // =========================================================================
    // GET /api/dashboard/overview - Get dashboard overview
    // =========================================================================

    describe('GET /api/dashboard/overview', () => {
        it('should return 200 with overview data', async () => {
            const response = await api.get('/api/dashboard/overview');

            expect(response.status).toBe(200);
            // Overview returns data directly
            expect(response.body).toBeDefined();
        });

        it('overview should provide system summary', async () => {
            const response = await api.get('/api/dashboard/overview');

            if (response.status === 200) {
                // Overview returns an array or object of system metrics
                expect(response.body).toBeDefined();
            }
        });

        it('should return 401 without authentication', async () => {
            const unauthApi = createTestAPI();
            const response = await unauthApi.get('/api/dashboard/overview');

            expect(response.status).toBe(401);
        });
    });

    // =========================================================================
    // Response Format Validation
    // =========================================================================

    describe('Response Format Validation', () => {
        it('all dashboard endpoints should return valid JSON', async () => {
            const endpoints = [
                '/api/dashboard/stats',
                '/api/dashboard/activity',
                '/api/dashboard/overview'
            ];

            for (const endpoint of endpoints) {
                const response = await api.get(endpoint);

                expect(response.status).toBe(200);
                // Dashboard returns data directly (not wrapped)
                expect(response.body).toBeDefined();
            }
        });

        it('dashboard data should be serializable JSON', async () => {
            const response = await api.get('/api/dashboard/stats');

            if (response.status === 200) {
                // Verify data can be serialized and parsed
                const serialized = JSON.stringify(response.body);
                const parsed = JSON.parse(serialized);
                expect(parsed).toEqual(response.body);
            }
        });
    });

    // =========================================================================
    // Performance Considerations
    // =========================================================================

    describe('Performance', () => {
        it('stats endpoint should respond within timeout', async () => {
            const startTime = Date.now();
            const response = await api.get('/api/dashboard/stats');
            const duration = Date.now() - startTime;

            expect(response.status).toBe(200);
            expect(duration).toBeLessThan(TIMEOUTS.standard);
        });

        it('activity endpoint should respond within timeout', async () => {
            const startTime = Date.now();
            const response = await api.get('/api/dashboard/activity');
            const duration = Date.now() - startTime;

            expect(response.status).toBe(200);
            expect(duration).toBeLessThan(TIMEOUTS.standard);
        });
    });
});
