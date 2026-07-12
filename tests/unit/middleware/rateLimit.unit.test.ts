/**
 * Rate Limiting Unit Tests
 *
 * /users/login, /users/register and /users/magic-link were unthrottled, which
 * made the login endpoint an unmetered password oracle. These tests pin the
 * sliding-window limiter that now sits in front of them.
 */

import { Request, Response, NextFunction } from 'express';

jest.mock('@mxf-dev/core/utils/Logger', () => ({
    Logger: jest.fn().mockImplementation(() => ({
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn()
    }))
}));

import {
    consume,
    createRateLimiter,
    createAuthRateLimiter,
    resetRateLimits,
    trackedKeyCount
} from '../../../src/server/api/middleware/rateLimit';

describe('rateLimit', () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
        resetRateLimits();
    });

    afterEach(() => {
        process.env = { ...originalEnv };
        resetRateLimits();
    });

    describe('consume', () => {
        const options = { name: 'test', windowMs: 1000, max: 3 };

        it('allows requests up to the limit', () => {
            expect(consume('k', options, 0).allowed).toBe(true);
            expect(consume('k', options, 10).allowed).toBe(true);
            expect(consume('k', options, 20).allowed).toBe(true);
        });

        it('blocks the request past the limit', () => {
            consume('k', options, 0);
            consume('k', options, 10);
            consume('k', options, 20);

            const blocked = consume('k', options, 30);

            expect(blocked.allowed).toBe(false);
            expect(blocked.remaining).toBe(0);
        });

        it('reports how long until the caller may retry', () => {
            consume('k', options, 100);
            consume('k', options, 110);
            consume('k', options, 120);

            const blocked = consume('k', options, 200);

            // The oldest request was at 100, so the window frees up at 1100
            expect(blocked.retryAfterMs).toBe(900);
        });

        it('slides: old requests age out of the window', () => {
            consume('k', options, 0);
            consume('k', options, 10);
            consume('k', options, 20);

            expect(consume('k', options, 30).allowed).toBe(false);

            // At 1500 every earlier request has aged out
            expect(consume('k', options, 1500).allowed).toBe(true);
        });

        it('ages out requests one at a time rather than clearing the window', () => {
            consume('k', options, 0);
            consume('k', options, 500);
            consume('k', options, 600);

            // At 1200 only the request at t=0 has expired, freeing exactly one slot
            expect(consume('k', options, 1200).allowed).toBe(true);
            expect(consume('k', options, 1201).allowed).toBe(false);
        });

        it('counts each key separately', () => {
            consume('a', options, 0);
            consume('a', options, 1);
            consume('a', options, 2);

            expect(consume('a', options, 3).allowed).toBe(false);
            expect(consume('b', options, 3).allowed).toBe(true);
        });

        it('counts down the remaining allowance', () => {
            expect(consume('k', options, 0).remaining).toBe(2);
            expect(consume('k', options, 1).remaining).toBe(1);
            expect(consume('k', options, 2).remaining).toBe(0);
        });
    });

    describe('createRateLimiter', () => {
        const buildReqRes = (ip: string) => {
            const req = { ip, method: 'POST', originalUrl: '/api/users/login' } as unknown as Request;
            const res: Partial<Response> = {};
            res.setHeader = jest.fn();
            res.status = jest.fn().mockReturnValue(res);
            res.json = jest.fn().mockReturnValue(res);
            return { req, res: res as Response, next: jest.fn() as NextFunction };
        };

        it('rejects an invalid configuration up front', () => {
            expect(() => createRateLimiter({ name: 'x', windowMs: 0, max: 5 })).toThrow();
            expect(() => createRateLimiter({ name: 'x', windowMs: 1000, max: 0 })).toThrow();
            expect(() => createRateLimiter({ name: 'x', windowMs: 1000, max: 1.5 })).toThrow();
        });

        it('passes requests through while under the limit', () => {
            const limiter = createRateLimiter({ name: 'x', windowMs: 60_000, max: 2 });
            const { req, res, next } = buildReqRes('1.1.1.1');

            limiter(req, res, next);

            expect(next).toHaveBeenCalled();
            expect(res.status).not.toHaveBeenCalled();
        });

        it('responds 429 with Retry-After once the limit is hit', () => {
            const limiter = createRateLimiter({ name: 'x', windowMs: 60_000, max: 1 });

            const first = buildReqRes('1.1.1.1');
            limiter(first.req, first.res, first.next);
            expect(first.next).toHaveBeenCalled();

            const second = buildReqRes('1.1.1.1');
            limiter(second.req, second.res, second.next);

            expect(second.next).not.toHaveBeenCalled();
            expect(second.res.status).toHaveBeenCalledWith(429);
            expect(second.res.setHeader).toHaveBeenCalledWith('Retry-After', expect.any(String));
        });

        it('does not let one address exhaust the allowance of another', () => {
            const limiter = createRateLimiter({ name: 'x', windowMs: 60_000, max: 1 });

            const attacker = buildReqRes('1.1.1.1');
            limiter(attacker.req, attacker.res, attacker.next);

            const blocked = buildReqRes('1.1.1.1');
            limiter(blocked.req, blocked.res, blocked.next);
            expect(blocked.res.status).toHaveBeenCalledWith(429);

            const other = buildReqRes('2.2.2.2');
            limiter(other.req, other.res, other.next);
            expect(other.next).toHaveBeenCalled();
        });

        it('namespaces keys per limiter so one does not consume another', () => {
            const login = createRateLimiter({ name: 'login', windowMs: 60_000, max: 1 });
            const register = createRateLimiter({ name: 'register', windowMs: 60_000, max: 1 });

            const a = buildReqRes('1.1.1.1');
            login(a.req, a.res, a.next);
            expect(a.next).toHaveBeenCalled();

            const b = buildReqRes('1.1.1.1');
            register(b.req, b.res, b.next);
            expect(b.next).toHaveBeenCalled();
        });

        it('falls back to a stable key when Express reports no address', () => {
            const limiter = createRateLimiter({ name: 'x', windowMs: 60_000, max: 1 });

            const req = { method: 'POST', originalUrl: '/x', socket: {} } as unknown as Request;
            const res: Partial<Response> = {
                setHeader: jest.fn(),
                status: jest.fn().mockReturnThis(),
                json: jest.fn().mockReturnThis()
            };
            const next = jest.fn() as NextFunction;

            limiter(req, res as Response, next);
            expect(next).toHaveBeenCalled();

            const next2 = jest.fn() as NextFunction;
            limiter(req, res as Response, next2);
            expect(next2).not.toHaveBeenCalled();
        });
    });

    describe('createAuthRateLimiter', () => {
        it('defaults to ten attempts per fifteen minutes', () => {
            delete process.env.AUTH_RATE_LIMIT_MAX;
            delete process.env.AUTH_RATE_LIMIT_WINDOW_MS;

            const limiter = createAuthRateLimiter();
            const res: Partial<Response> = {
                setHeader: jest.fn(),
                status: jest.fn().mockReturnThis(),
                json: jest.fn().mockReturnThis()
            };
            const req = { ip: '9.9.9.9', method: 'POST', originalUrl: '/api/users/login' } as unknown as Request;

            for (let i = 0; i < 10; i++) {
                limiter(req, res as Response, jest.fn() as NextFunction);
            }

            const blocked = jest.fn() as NextFunction;
            limiter(req, res as Response, blocked);

            expect(blocked).not.toHaveBeenCalled();
            expect(res.status).toHaveBeenCalledWith(429);
        });

        it('honours an override', () => {
            process.env.AUTH_RATE_LIMIT_MAX = '2';

            const limiter = createAuthRateLimiter();
            const res: Partial<Response> = {
                setHeader: jest.fn(),
                status: jest.fn().mockReturnThis(),
                json: jest.fn().mockReturnThis()
            };
            const req = { ip: '8.8.8.8', method: 'POST', originalUrl: '/api/users/login' } as unknown as Request;

            limiter(req, res as Response, jest.fn() as NextFunction);
            limiter(req, res as Response, jest.fn() as NextFunction);

            const blocked = jest.fn() as NextFunction;
            limiter(req, res as Response, blocked);

            expect(blocked).not.toHaveBeenCalled();
        });

        it('rejects a non-positive override rather than silently ignoring it', () => {
            process.env.AUTH_RATE_LIMIT_MAX = '-1';
            expect(() => createAuthRateLimiter()).toThrow();

            process.env.AUTH_RATE_LIMIT_MAX = 'lots';
            expect(() => createAuthRateLimiter()).toThrow();
        });
    });

    describe('memory bounds', () => {
        it('drops tracked keys on reset', () => {
            const options = { name: 'test', windowMs: 1000, max: 5 };

            consume('a', options, 0);
            consume('b', options, 0);
            expect(trackedKeyCount()).toBe(2);

            resetRateLimits();
            expect(trackedKeyCount()).toBe(0);
        });

        it('does not grow without limit as addresses cycle', () => {
            const options = { name: 'test', windowMs: 1000, max: 5 };

            for (let i = 0; i < 12_000; i++) {
                consume(`ip-${i}`, options, i);
            }

            expect(trackedKeyCount()).toBeLessThanOrEqual(10_000);
        });
    });
});
