/**
 * TestAPI - HTTP/REST API Testing Utility
 *
 * Provides HTTP testing capabilities using supertest for in-process testing
 * and axios for external server testing. Complements TestSDK for API endpoint testing.
 */

import request from 'supertest';
import axios, { AxiosInstance, AxiosResponse } from 'axios';
import type { Express } from 'express';

// =============================================================================
// Types and Interfaces
// =============================================================================

export interface TestAPIOptions {
    /** Server URL for external HTTP testing (default: http://localhost:3001) */
    serverUrl?: string;
    /** Use in-process testing with supertest (requires app export) */
    useInProcess?: boolean;
}

export interface AuthCredentials {
    /** JWT token for user authentication */
    jwtToken?: string;
    /** API key ID for agent authentication */
    keyId?: string;
    /** API secret key for agent authentication */
    secretKey?: string;
}

export interface APIResponse<T = any> {
    status: number;
    body: T;
    headers: Record<string, string>;
}

export interface StandardSuccessResponse<T = any> {
    success: true;
    message?: string;
    data: T;
}

export interface StandardErrorResponse {
    success: false;
    error: string;
    message?: string;
    details?: any;
}

// =============================================================================
// TestAPI Class
// =============================================================================

/**
 * HTTP testing utility for MXF REST API endpoints.
 * Supports both in-process testing (supertest) and external HTTP (axios).
 */
export class TestAPI {
    private serverUrl: string;
    private axiosClient: AxiosInstance;
    private auth: AuthCredentials = {};
    private app?: Express;
    private abortController: AbortController;

    constructor(options: TestAPIOptions = {}) {
        this.serverUrl = options.serverUrl || process.env.TEST_SERVER_URL || 'http://localhost:3001';
        this.abortController = new AbortController();

        this.axiosClient = axios.create({
            baseURL: this.serverUrl,
            timeout: 30000,
            validateStatus: () => true // Don't throw on any status code
        });
    }

    /**
     * Cleanup resources to prevent Jest open handle warnings.
     * Call this in afterAll or afterEach.
     */
    cleanup(): void {
        this.abortController.abort();
        this.abortController = new AbortController();
        this.auth = {};
    }

    /**
     * Set Express app for in-process testing with supertest.
     * This is faster than HTTP testing but requires app export.
     */
    setApp(app: Express): void {
        this.app = app;
    }

    // =========================================================================
    // Authentication Methods
    // =========================================================================

    /**
     * Authenticate as a user with JWT token.
     * Logs in and stores the JWT token for subsequent requests.
     * Note: The login endpoint accepts "username" which can be email or username.
     */
    async authenticateAsUser(emailOrUsername: string, password: string): Promise<string> {
        // The login endpoint expects "username" field (which can be email or username)
        const response = await this.post('/api/users/login', { username: emailOrUsername, password });

        if (response.status !== 200 || !response.body.token) {
            throw new Error(`Authentication failed: ${response.body.message || response.body.error || 'Unknown error'}`);
        }

        this.auth.jwtToken = response.body.token;
        return response.body.token;
    }

    /**
     * Set JWT token directly (useful when token is already available).
     */
    setJwtToken(token: string): void {
        this.auth.jwtToken = token;
    }

    /**
     * Authenticate as an agent with key-based authentication.
     */
    authenticateAsAgent(keyId: string, secretKey: string): void {
        this.auth.keyId = keyId;
        this.auth.secretKey = secretKey;
    }

    /**
     * Clear all authentication credentials.
     */
    clearAuth(): void {
        this.auth = {};
    }

    /**
     * Check if authenticated.
     */
    isAuthenticated(): boolean {
        return !!(this.auth.jwtToken || (this.auth.keyId && this.auth.secretKey));
    }

    // =========================================================================
    // HTTP Methods
    // =========================================================================

    /**
     * Make a GET request.
     */
    async get<T = any>(path: string, query?: Record<string, any>): Promise<APIResponse<T>> {
        return this.request<T>('GET', path, undefined, query);
    }

    /**
     * Make a POST request.
     */
    async post<T = any>(path: string, body?: any): Promise<APIResponse<T>> {
        return this.request<T>('POST', path, body);
    }

    /**
     * Make a PUT request.
     */
    async put<T = any>(path: string, body?: any): Promise<APIResponse<T>> {
        return this.request<T>('PUT', path, body);
    }

    /**
     * Make a PATCH request.
     */
    async patch<T = any>(path: string, body?: any): Promise<APIResponse<T>> {
        return this.request<T>('PATCH', path, body);
    }

    /**
     * Make a DELETE request.
     */
    async delete<T = any>(path: string): Promise<APIResponse<T>> {
        return this.request<T>('DELETE', path);
    }

    // =========================================================================
    // Core Request Method
    // =========================================================================

    /**
     * Make an HTTP request with authentication headers.
     */
    private async request<T>(
        method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
        path: string,
        body?: any,
        query?: Record<string, any>
    ): Promise<APIResponse<T>> {
        const headers = this.buildAuthHeaders();

        // Use axios for HTTP requests to running server
        const response = await this.axiosClient.request({
            method,
            url: path,
            data: body,
            params: query,
            headers,
            signal: this.abortController.signal
        });

        return {
            status: response.status,
            body: response.data,
            headers: response.headers as Record<string, string>
        };
    }

    /**
     * Build authentication headers based on current auth state.
     */
    private buildAuthHeaders(): Record<string, string> {
        const headers: Record<string, string> = {
            'Content-Type': 'application/json'
        };

        if (this.auth.jwtToken) {
            headers['Authorization'] = `Bearer ${this.auth.jwtToken}`;
        }

        if (this.auth.keyId) {
            headers['x-key-id'] = this.auth.keyId;
        }

        if (this.auth.secretKey) {
            headers['x-secret-key'] = this.auth.secretKey;
        }

        return headers;
    }

    // =========================================================================
    // Supertest Methods (for in-process testing)
    // =========================================================================

    /**
     * Get supertest request object for in-process testing.
     * Requires app to be set via setApp().
     */
    supertestRequest(): request.Agent {
        if (!this.app) {
            throw new Error('App not set. Call setApp() first or use HTTP methods.');
        }
        return request(this.app);
    }

    /**
     * Make a supertest GET request with authentication.
     */
    supertestGet(path: string): request.Test {
        const req = this.supertestRequest().get(path);
        return this.applySupertestAuth(req);
    }

    /**
     * Make a supertest POST request with authentication.
     */
    supertestPost(path: string, body?: any): request.Test {
        const req = this.supertestRequest().post(path);
        if (body) {
            req.send(body);
        }
        return this.applySupertestAuth(req);
    }

    /**
     * Make a supertest PUT request with authentication.
     */
    supertestPut(path: string, body?: any): request.Test {
        const req = this.supertestRequest().put(path);
        if (body) {
            req.send(body);
        }
        return this.applySupertestAuth(req);
    }

    /**
     * Make a supertest PATCH request with authentication.
     */
    supertestPatch(path: string, body?: any): request.Test {
        const req = this.supertestRequest().patch(path);
        if (body) {
            req.send(body);
        }
        return this.applySupertestAuth(req);
    }

    /**
     * Make a supertest DELETE request with authentication.
     */
    supertestDelete(path: string): request.Test {
        const req = this.supertestRequest().delete(path);
        return this.applySupertestAuth(req);
    }

    /**
     * Apply authentication headers to supertest request.
     */
    private applySupertestAuth(req: request.Test): request.Test {
        req.set('Content-Type', 'application/json');

        if (this.auth.jwtToken) {
            req.set('Authorization', `Bearer ${this.auth.jwtToken}`);
        }

        if (this.auth.keyId) {
            req.set('x-key-id', this.auth.keyId);
        }

        if (this.auth.secretKey) {
            req.set('x-secret-key', this.auth.secretKey);
        }

        return req;
    }

    // =========================================================================
    // Assertion Helpers
    // =========================================================================

    /**
     * Assert response is a successful response (2xx).
     */
    expectSuccess(response: APIResponse): void {
        if (response.status < 200 || response.status >= 300) {
            throw new Error(
                `Expected success response (2xx), got ${response.status}: ` +
                `${JSON.stringify(response.body)}`
            );
        }

        if (response.body && typeof response.body === 'object') {
            if ('success' in response.body && response.body.success === false) {
                throw new Error(
                    `Response body indicates failure: ${response.body.error || 'Unknown error'}`
                );
            }
        }
    }

    /**
     * Assert response is an error with expected status code.
     */
    expectError(response: APIResponse, expectedStatus: number): void {
        if (response.status !== expectedStatus) {
            throw new Error(
                `Expected status ${expectedStatus}, got ${response.status}: ` +
                `${JSON.stringify(response.body)}`
            );
        }
    }

    /**
     * Assert response body matches expected structure.
     */
    expectBodyStructure(response: APIResponse, structure: Record<string, any>): void {
        for (const [key, expectedType] of Object.entries(structure)) {
            if (!(key in response.body)) {
                throw new Error(`Response body missing key: ${key}`);
            }

            const actualType = typeof response.body[key];
            if (actualType !== expectedType && expectedType !== 'any') {
                throw new Error(
                    `Response body key "${key}" expected type ${expectedType}, got ${actualType}`
                );
            }
        }
    }

    /**
     * Assert response has standard MXF success format.
     */
    expectMxfSuccess<T>(response: APIResponse): StandardSuccessResponse<T> {
        this.expectSuccess(response);

        if (!('success' in response.body) || response.body.success !== true) {
            throw new Error('Response missing success: true');
        }

        return response.body as StandardSuccessResponse<T>;
    }

    /**
     * Assert response has standard MXF error format.
     */
    expectMxfError(response: APIResponse, expectedStatus: number): StandardErrorResponse {
        this.expectError(response, expectedStatus);

        if (!('success' in response.body) || response.body.success !== false) {
            throw new Error('Response missing success: false');
        }

        if (!('error' in response.body)) {
            throw new Error('Error response missing error field');
        }

        return response.body as StandardErrorResponse;
    }

    // =========================================================================
    // Utility Methods
    // =========================================================================

    /**
     * Get the server URL.
     */
    getServerUrl(): string {
        return this.serverUrl;
    }

    /**
     * Get the axios client for custom requests.
     */
    getAxiosClient(): AxiosInstance {
        return this.axiosClient;
    }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a new TestAPI instance.
 */
export function createTestAPI(options: TestAPIOptions = {}): TestAPI {
    return new TestAPI(options);
}

/**
 * Create a TestAPI instance with user authentication.
 */
export async function createAuthenticatedUserAPI(
    email: string,
    password: string,
    options: TestAPIOptions = {}
): Promise<TestAPI> {
    const api = new TestAPI(options);
    await api.authenticateAsUser(email, password);
    return api;
}

/**
 * Create a TestAPI instance with agent authentication.
 */
export function createAuthenticatedAgentAPI(
    keyId: string,
    secretKey: string,
    options: TestAPIOptions = {}
): TestAPI {
    const api = new TestAPI(options);
    api.authenticateAsAgent(keyId, secretKey);
    return api;
}

// =============================================================================
// Test Fixtures for API Testing
// =============================================================================

/**
 * API test fixtures and constants.
 */
export const API_FIXTURES = {
    // Valid test user credentials
    testUser: {
        email: process.env.MXF_DEMO_USERNAME || 'demo-user@example.com',
        password: process.env.MXF_DEMO_PASSWORD || 'demo-password-1234'
    },

    // Test endpoints by category
    publicEndpoints: [
        '/api/users/register',
        '/api/users/login',
        '/health',
        '/api/mcp/capabilities',
        '/api/mcp/tools'
    ],

    // Endpoints requiring JWT auth
    jwtEndpoints: [
        '/api/users/profile',
        '/api/analytics/agents/performance',
        '/api/config/templates'
    ],

    // Endpoints supporting dual auth
    dualAuthEndpoints: [
        '/api/agents',
        '/api/channels',
        '/api/tasks',
        '/api/dashboard/stats'
    ],

    // Invalid data for error testing
    invalidData: {
        emptyString: '',
        nullValue: null,
        undefinedValue: undefined,
        emptyObject: {},
        invalidId: 'not-a-valid-id-format',
        invalidEmail: 'not-an-email',
        shortPassword: 'abc',
        longString: 'x'.repeat(10000)
    },

    // Timeout constants
    timeouts: {
        short: 5000,
        standard: 10000,
        long: 30000
    }
};

// =============================================================================
// Custom Jest Matchers for API Testing
// =============================================================================

/**
 * Extend Jest with API-specific matchers.
 * Add to jest.setup.ts: import { extendApiMatchers } from './utils/TestAPI';
 */
export function extendApiMatchers(): void {
    expect.extend({
        toBeSuccessResponse(received: APIResponse) {
            const pass = received.status >= 200 && received.status < 300;
            return {
                pass,
                message: () =>
                    pass
                        ? `Expected response not to be success (2xx), got ${received.status}`
                        : `Expected response to be success (2xx), got ${received.status}`
            };
        },

        toHaveStatus(received: APIResponse, expected: number) {
            const pass = received.status === expected;
            return {
                pass,
                message: () =>
                    pass
                        ? `Expected response not to have status ${expected}`
                        : `Expected response to have status ${expected}, got ${received.status}`
            };
        },

        toBeValidMxfResponse(received: APIResponse) {
            const hasSuccess = 'success' in received.body;
            const pass = hasSuccess && typeof received.body.success === 'boolean';
            return {
                pass,
                message: () =>
                    pass
                        ? 'Expected response not to be valid MXF response'
                        : 'Expected response to have boolean "success" field'
            };
        }
    });
}

// Augment Jest types for custom matchers
declare global {
    namespace jest {
        interface Matchers<R> {
            toBeSuccessResponse(): R;
            toHaveStatus(expected: number): R;
            toBeValidMxfResponse(): R;
        }
    }
}
