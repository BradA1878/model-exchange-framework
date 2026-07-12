/**
 * Webhook Authentication Unit Tests
 *
 * The inbound webhook routes create tasks and drive agents, which spends LLM
 * budget. They used to accept anything. These tests pin the signature check that
 * now stands in front of them.
 */

import crypto from 'crypto';
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
    authenticateWebhook,
    captureRawBody,
    computeWebhookSignature,
    getMaxSkewSeconds,
    isWebhookEnabled,
    requireWebhookSecret,
    secureCompareHex,
    verifyWebhookRequest,
    RawBodyRequest,
    WEBHOOK_SIGNATURE_HEADER,
    WEBHOOK_TIMESTAMP_HEADER
} from '../../../src/server/api/middleware/webhookAuth';

const SECRET = 'test-webhook-secret';
const NOW_SECONDS = 1_800_000_000;

/**
 * Build a request carrying a correctly signed body.
 */
const signedRequest = (
    body: unknown,
    overrides: { secret?: string; timestamp?: number; signature?: string } = {}
): RawBodyRequest => {
    const rawBody = Buffer.from(JSON.stringify(body));
    const timestamp = String(overrides.timestamp ?? NOW_SECONDS);
    const signature =
        overrides.signature ??
        `sha256=${computeWebhookSignature(overrides.secret ?? SECRET, timestamp, rawBody)}`;

    return {
        rawBody,
        headers: {
            [WEBHOOK_SIGNATURE_HEADER]: signature,
            [WEBHOOK_TIMESTAMP_HEADER]: timestamp
        }
    } as unknown as RawBodyRequest;
};

describe('webhookAuth', () => {
    const originalEnv = { ...process.env };

    afterEach(() => {
        process.env = { ...originalEnv };
    });

    describe('isWebhookEnabled', () => {
        it('is off unless MXF_WEBHOOK_ENABLED is exactly true', () => {
            delete process.env.MXF_WEBHOOK_ENABLED;
            expect(isWebhookEnabled()).toBe(false);

            process.env.MXF_WEBHOOK_ENABLED = 'yes';
            expect(isWebhookEnabled()).toBe(false);

            process.env.MXF_WEBHOOK_ENABLED = 'true';
            expect(isWebhookEnabled()).toBe(true);
        });
    });

    describe('requireWebhookSecret', () => {
        it('returns the configured secret', () => {
            process.env.MXF_WEBHOOK_SECRET = SECRET;
            expect(requireWebhookSecret()).toBe(SECRET);
        });

        it('throws when the secret is missing, so a bad config stops the boot', () => {
            delete process.env.MXF_WEBHOOK_SECRET;
            expect(() => requireWebhookSecret()).toThrow(/MXF_WEBHOOK_SECRET/);
        });

        it('throws when the secret is only whitespace', () => {
            process.env.MXF_WEBHOOK_SECRET = '   ';
            expect(() => requireWebhookSecret()).toThrow(/MXF_WEBHOOK_SECRET/);
        });
    });

    describe('getMaxSkewSeconds', () => {
        it('defaults to five minutes', () => {
            delete process.env.MXF_WEBHOOK_MAX_SKEW_SECONDS;
            expect(getMaxSkewSeconds()).toBe(300);
        });

        it('accepts an override', () => {
            process.env.MXF_WEBHOOK_MAX_SKEW_SECONDS = '60';
            expect(getMaxSkewSeconds()).toBe(60);
        });

        it('rejects a non-positive or non-numeric override', () => {
            process.env.MXF_WEBHOOK_MAX_SKEW_SECONDS = '0';
            expect(() => getMaxSkewSeconds()).toThrow();

            process.env.MXF_WEBHOOK_MAX_SKEW_SECONDS = 'soon';
            expect(() => getMaxSkewSeconds()).toThrow();
        });
    });

    describe('captureRawBody', () => {
        it('copies the raw bytes onto the request', () => {
            const req = {} as Request;
            captureRawBody(req, {} as Response, Buffer.from('{"a":1}'));

            expect((req as RawBodyRequest).rawBody?.toString()).toBe('{"a":1}');
        });

        it('leaves an empty body alone', () => {
            const req = {} as Request;
            captureRawBody(req, {} as Response, Buffer.alloc(0));

            expect((req as RawBodyRequest).rawBody).toBeUndefined();
        });
    });

    describe('secureCompareHex', () => {
        it('matches identical digests', () => {
            const digest = crypto.createHash('sha256').update('x').digest('hex');
            expect(secureCompareHex(digest, digest)).toBe(true);
        });

        it('rejects different digests of the same length', () => {
            const a = crypto.createHash('sha256').update('x').digest('hex');
            const b = crypto.createHash('sha256').update('y').digest('hex');
            expect(secureCompareHex(a, b)).toBe(false);
        });

        it('rejects a length mismatch instead of throwing', () => {
            expect(secureCompareHex('abcd', 'abcdef')).toBe(false);
        });

        it('rejects empty input', () => {
            expect(secureCompareHex('', '')).toBe(false);
        });
    });

    describe('verifyWebhookRequest', () => {
        it('accepts a correctly signed request', () => {
            const req = signedRequest({ channelId: 'c', title: 't' });

            expect(verifyWebhookRequest(req, SECRET, NOW_SECONDS, 300)).toBeNull();
        });

        it('rejects a request signed with the wrong secret', () => {
            const req = signedRequest({ channelId: 'c' }, { secret: 'not-the-secret' });

            expect(verifyWebhookRequest(req, SECRET, NOW_SECONDS, 300)).toBe('invalid_signature');
        });

        it('rejects a body that changed after signing', () => {
            const req = signedRequest({ channelId: 'c' });
            req.rawBody = Buffer.from(JSON.stringify({ channelId: 'other-channel' }));

            expect(verifyWebhookRequest(req, SECRET, NOW_SECONDS, 300)).toBe('invalid_signature');
        });

        it('rejects a replayed request outside the window', () => {
            const req = signedRequest({ channelId: 'c' }, { timestamp: NOW_SECONDS - 3600 });

            expect(verifyWebhookRequest(req, SECRET, NOW_SECONDS, 300)).toBe('stale_timestamp');
        });

        it('rejects a timestamp from the future', () => {
            const req = signedRequest({ channelId: 'c' }, { timestamp: NOW_SECONDS + 3600 });

            expect(verifyWebhookRequest(req, SECRET, NOW_SECONDS, 300)).toBe('stale_timestamp');
        });

        it('accepts a timestamp at the edge of the window', () => {
            const req = signedRequest({ channelId: 'c' }, { timestamp: NOW_SECONDS - 300 });

            expect(verifyWebhookRequest(req, SECRET, NOW_SECONDS, 300)).toBeNull();
        });

        it('rejects a missing signature header', () => {
            const req = signedRequest({ channelId: 'c' });
            delete req.headers[WEBHOOK_SIGNATURE_HEADER];

            expect(verifyWebhookRequest(req, SECRET, NOW_SECONDS, 300)).toBe('missing_signature');
        });

        it('rejects a missing timestamp header', () => {
            const req = signedRequest({ channelId: 'c' });
            delete req.headers[WEBHOOK_TIMESTAMP_HEADER];

            expect(verifyWebhookRequest(req, SECRET, NOW_SECONDS, 300)).toBe('missing_timestamp');
        });

        it('rejects a signature without the sha256= prefix', () => {
            const req = signedRequest({ channelId: 'c' }, { signature: 'a'.repeat(64) });

            expect(verifyWebhookRequest(req, SECRET, NOW_SECONDS, 300)).toBe('malformed_signature');
        });

        it('rejects a signature that is not 64 hex characters', () => {
            const req = signedRequest({ channelId: 'c' }, { signature: 'sha256=zzzz' });

            expect(verifyWebhookRequest(req, SECRET, NOW_SECONDS, 300)).toBe('malformed_signature');
        });

        it('rejects a non-integer timestamp', () => {
            const req = signedRequest({ channelId: 'c' });
            req.headers[WEBHOOK_TIMESTAMP_HEADER] = 'yesterday';

            expect(verifyWebhookRequest(req, SECRET, NOW_SECONDS, 300)).toBe('malformed_timestamp');
        });

        it('reports a missing raw body rather than trusting the parsed one', () => {
            const req = signedRequest({ channelId: 'c' });
            delete req.rawBody;

            expect(verifyWebhookRequest(req, SECRET, NOW_SECONDS, 300)).toBe('missing_raw_body');
        });
    });

    describe('authenticateWebhook middleware', () => {
        const buildRes = () => {
            const res: Partial<Response> = {};
            res.status = jest.fn().mockReturnValue(res);
            res.json = jest.fn().mockReturnValue(res);
            return res as Response;
        };

        beforeEach(() => {
            process.env.MXF_WEBHOOK_SECRET = SECRET;
            delete process.env.MXF_WEBHOOK_MAX_SKEW_SECONDS;
        });

        it('calls next for a correctly signed request', () => {
            const now = Math.floor(Date.now() / 1000);
            const req = signedRequest({ channelId: 'c' }, { timestamp: now }) as unknown as Request;
            const res = buildRes();
            const next = jest.fn() as NextFunction;

            authenticateWebhook(req, res, next);

            expect(next).toHaveBeenCalled();
            expect(res.status).not.toHaveBeenCalled();
        });

        it('responds 401 for an unsigned request', () => {
            const req = {
                rawBody: Buffer.from('{}'),
                headers: {},
                originalUrl: '/api/webhooks/n8n/task'
            } as unknown as Request;
            const res = buildRes();
            const next = jest.fn() as NextFunction;

            authenticateWebhook(req, res, next);

            expect(next).not.toHaveBeenCalled();
            expect(res.status).toHaveBeenCalledWith(401);
        });

        it('responds 500 when no secret is configured, never 200', () => {
            delete process.env.MXF_WEBHOOK_SECRET;

            const req = { headers: {}, originalUrl: '/api/webhooks/n8n/task' } as unknown as Request;
            const res = buildRes();
            const next = jest.fn() as NextFunction;

            authenticateWebhook(req, res, next);

            expect(next).not.toHaveBeenCalled();
            expect(res.status).toHaveBeenCalledWith(500);
        });

        it('responds 500 when the raw body was never captured', () => {
            const now = Math.floor(Date.now() / 1000);
            const req = signedRequest({ channelId: 'c' }, { timestamp: now }) as unknown as RawBodyRequest;
            delete req.rawBody;

            const res = buildRes();
            const next = jest.fn() as NextFunction;

            authenticateWebhook(req as unknown as Request, res, next);

            expect(next).not.toHaveBeenCalled();
            expect(res.status).toHaveBeenCalledWith(500);
        });
    });
});
