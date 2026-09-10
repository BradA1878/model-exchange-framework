import express, { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { Events } from '@mxf-dev/core/events/EventNames';
import {
    DEMO_API_ENV,
    isAgentSocketMcpEventAllowed,
    isDemoApiEnabled,
    requireDemoApiEnabled,
    requireUnsafeStdioMcpEnabled
} from '../../../src/server/api/middleware/runtimeFeaturePolicy';
import {
    UNSAFE_STDIO_MCP_ENV,
    assertUnsafeStdioMcpEnabled,
    isUnsafeStdioMcpEnabled
} from '@mxf-dev/core/protocols/mcp/security/ExternalMcpRegistrationPolicy';

const makeResponse = (): Response => {
    const response = {
        status: jest.fn(),
        json: jest.fn()
    } as unknown as Response;
    (response.status as jest.Mock).mockReturnValue(response);
    return response;
};

describe('runtime feature policy', () => {
    const originalEnv = { ...process.env };

    afterEach(() => {
        process.env = { ...originalEnv };
    });

    describe('demo API', () => {
        it('is absent by default and for non-exact opt-in values', () => {
            delete process.env[DEMO_API_ENV];
            expect(isDemoApiEnabled()).toBe(false);

            process.env[DEMO_API_ENV] = 'yes';
            expect(isDemoApiEnabled()).toBe(false);
        });

        it('can be enabled only outside production', () => {
            process.env[DEMO_API_ENV] = 'true';
            process.env.NODE_ENV = 'development';
            expect(isDemoApiEnabled()).toBe(true);

            process.env.NODE_ENV = ' Production ';
            expect(isDemoApiEnabled()).toBe(false);
        });

        it('returns 404 instead of reaching a controller when disabled', () => {
            delete process.env[DEMO_API_ENV];
            const response = makeResponse();
            const next = jest.fn() as NextFunction;

            requireDemoApiEnabled({} as Request, response, next);

            expect(response.status).toHaveBeenCalledWith(404);
            expect(next).not.toHaveBeenCalled();
        });
    });

    describe('caller-supplied stdio MCP', () => {
        const controller = jest.fn((_req: Request, res: Response): void => {
            res.status(204).end();
        });
        const app = express();
        app.use(express.json());
        app.post('/register', requireUnsafeStdioMcpEnabled, controller);

        beforeEach(() => controller.mockClear());

        it('is disabled by default and absent transport fails closed as stdio', () => {
            delete process.env[UNSAFE_STDIO_MCP_ENV];

            expect(isUnsafeStdioMcpEnabled()).toBe(false);
            expect(() => assertUnsafeStdioMcpEnabled(undefined)).toThrow(UNSAFE_STDIO_MCP_ENV);
            expect(() => assertUnsafeStdioMcpEnabled('stdio')).toThrow(UNSAFE_STDIO_MCP_ENV);
        });

        it('requires the exact explicit opt-in', () => {
            process.env[UNSAFE_STDIO_MCP_ENV] = 'yes';
            expect(() => assertUnsafeStdioMcpEnabled('stdio')).toThrow();

            process.env[UNSAFE_STDIO_MCP_ENV] = 'true';
            expect(() => assertUnsafeStdioMcpEnabled('stdio')).not.toThrow();
        });

        it.each(['sse', 'STDIO', 1, {}, false])('rejects unsupported transport %j', transport => {
            delete process.env[UNSAFE_STDIO_MCP_ENV];
            expect(() => assertUnsafeStdioMcpEnabled(transport)).toThrow(/Unsupported MCP transport/);
            process.env[UNSAFE_STDIO_MCP_ENV] = 'true';
            expect(() => assertUnsafeStdioMcpEnabled(transport)).toThrow(/Unsupported MCP transport/);
        });

        describe.each(['false', 'true'])('HTTP middleware with stdio opt-in %s', enabled => {
            it.each(['sse', 'STDIO', false, {}])('returns 400 for invalid transport %j before the controller', async transport => {
                process.env[UNSAFE_STDIO_MCP_ENV] = enabled;

                const response = await request(app).post('/register').set('Content-Type', 'application/json').send({ transport });

                expect(response.status).toBe(400);
                expect(response.body).toEqual({
                    success: false,
                    error: 'Unsupported MCP transport; expected stdio or http'
                });
                expect(controller).not.toHaveBeenCalled();
            });
        });

        it.each([{}, { transport: 'stdio' }])('returns 403 for valid stdio %j when disabled', async body => {
            delete process.env[UNSAFE_STDIO_MCP_ENV];

            const response = await request(app).post('/register').set('Content-Type', 'application/json').send(body);

            expect(response.status).toBe(403);
            expect(response.body.error).toContain(UNSAFE_STDIO_MCP_ENV);
            expect(controller).not.toHaveBeenCalled();
        });

        it('reaches the controller for valid stdio only when enabled', async () => {
            process.env[UNSAFE_STDIO_MCP_ENV] = 'true';

            const response = await request(app).post('/register').set('Content-Type', 'application/json').send({ transport: 'stdio' });

            expect(response.status).toBe(204);
            expect(controller).toHaveBeenCalledTimes(1);
        });

        it('rejects the unimplemented HTTP transport instead of falling through to spawn', () => {
            delete process.env[UNSAFE_STDIO_MCP_ENV];
            expect(() => assertUnsafeStdioMcpEnabled('http')).not.toThrow();

            const next = jest.fn() as NextFunction;
            const response = makeResponse();
            requireUnsafeStdioMcpEnabled(
                { body: { transport: 'http' } } as Request,
                response,
                next
            );
            expect(response.status).toHaveBeenCalledWith(501);
            expect(next).not.toHaveBeenCalled();
        });

        it('rejects a default-stdio HTTP payload before its controller', () => {
            delete process.env[UNSAFE_STDIO_MCP_ENV];
            const response = makeResponse();
            const next = jest.fn() as NextFunction;

            requireUnsafeStdioMcpEnabled({ body: {} } as Request, response, next);

            expect(response.status).toHaveBeenCalledWith(403);
            expect(next).not.toHaveBeenCalled();
        });

        it('never permits process-registration events on an agent socket', () => {
            expect(isAgentSocketMcpEventAllowed(Events.Mcp.EXTERNAL_SERVER_REGISTER)).toBe(false);
            expect(isAgentSocketMcpEventAllowed(Events.Mcp.CHANNEL_SERVER_REGISTER)).toBe(false);
            expect(isAgentSocketMcpEventAllowed(Events.Mcp.TOOL_CALL)).toBe(true);
        });

        it('allows only MCP request directions and fails closed for server events', () => {
            expect(isAgentSocketMcpEventAllowed(Events.Mcp.TOOL_LIST)).toBe(true);
            expect(isAgentSocketMcpEventAllowed(Events.Mcp.RESOURCE_GET)).toBe(true);
            expect(isAgentSocketMcpEventAllowed(Events.Mcp.TOOL_RESULT)).toBe(false);
            expect(isAgentSocketMcpEventAllowed(Events.Mcp.TOOL_LIST_RESULT)).toBe(false);
            expect(isAgentSocketMcpEventAllowed(Events.Mcp.SERVER_START)).toBe(false);
            expect(isAgentSocketMcpEventAllowed('mcp:new:event')).toBe(false);
        });
    });
});
