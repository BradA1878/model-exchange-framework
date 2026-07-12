/**
 * Copyright 2024 Brad Anderson
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * @author Brad Anderson <BradA1878@pm.me>
 * @repository https://github.com/BradA1878/model-exchange-framework
 * @documentation https://mxf-dev.github.io/mxf/
 */

/**
 * Webhook Authentication Middleware
 *
 * HMAC-SHA256 request signing for the inbound webhook routes (currently n8n).
 * Those routes create tasks, inject channel messages, and drive agents — every
 * one of which spends LLM budget — so they cannot be reachable without
 * authentication.
 *
 * Signing scheme (same shape as Stripe/Slack, verified with a timing-safe
 * comparison the way ChannelKeyService compares channel secrets):
 *
 *   base   = `${timestamp}.${rawBody}`
 *   sig    = HMAC_SHA256(MXF_WEBHOOK_SECRET, base) as lowercase hex
 *   header = X-MXF-Signature: sha256=<sig>
 *            X-MXF-Timestamp: <unix seconds>
 *
 * The timestamp is inside the signed base string and must be recent, so a
 * captured request cannot be replayed indefinitely to keep spending budget.
 *
 * Environment variables:
 * - MXF_WEBHOOK_ENABLED   'true' mounts the webhook routes. Default: off. When
 *                         off there is no unauthenticated surface at all.
 * - MXF_WEBHOOK_SECRET    Shared secret. Required whenever the routes are
 *                         enabled — the server refuses to boot without it.
 * - MXF_WEBHOOK_MAX_SKEW_SECONDS  Signature validity window. Default 300.
 *
 * Raw body: the signature covers the bytes as sent, so the JSON body parser in
 * src/server/index.ts must be configured with the `captureRawBody` verify hook
 * below. Without it the middleware rejects every request with a 500 that says
 * so — it never falls back to signing the re-serialized body, because two JSON
 * encoders will not agree byte for byte.
 */

import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { Logger } from '@mxf-dev/core/utils/Logger';

const logger = new Logger('info', 'WebhookAuth', 'server');

/** Header carrying `sha256=<hex>`. */
export const WEBHOOK_SIGNATURE_HEADER = 'x-mxf-signature';

/** Header carrying the unix-seconds timestamp that is signed with the body. */
export const WEBHOOK_TIMESTAMP_HEADER = 'x-mxf-timestamp';

/** Default signature validity window, in seconds. */
const DEFAULT_MAX_SKEW_SECONDS = 300;

/** Express request with the raw request body captured by the JSON parser. */
export interface RawBodyRequest extends Request {
    rawBody?: Buffer;
}

/**
 * Whether the inbound webhook routes are mounted.
 *
 * Off by default: an unauthenticated route that spends money should not exist
 * unless someone asked for it.
 *
 * @returns True when MXF_WEBHOOK_ENABLED is exactly 'true'
 */
export const isWebhookEnabled = (): boolean => {
    return process.env.MXF_WEBHOOK_ENABLED === 'true';
};

/**
 * Read the webhook secret, failing fast when the routes are enabled without one.
 *
 * Called at module load from the webhook router so a misconfiguration stops the
 * server at boot rather than leaving an open endpoint running.
 *
 * @returns The configured secret
 * @throws If MXF_WEBHOOK_ENABLED is true and MXF_WEBHOOK_SECRET is missing
 */
export const requireWebhookSecret = (): string => {
    const secret = process.env.MXF_WEBHOOK_SECRET?.trim();

    if (!secret) {
        throw new Error(
            'MXF_WEBHOOK_ENABLED=true but MXF_WEBHOOK_SECRET is not set. ' +
            'Webhook routes create tasks and drive agents, so they must be signed. ' +
            'Generate a secret with `openssl rand -hex 32`, or unset MXF_WEBHOOK_ENABLED to disable the routes.'
        );
    }

    return secret;
};

/**
 * Read the signature validity window.
 *
 * @returns Window in seconds
 * @throws If MXF_WEBHOOK_MAX_SKEW_SECONDS is set to something that is not a positive number
 */
export const getMaxSkewSeconds = (): number => {
    const raw = process.env.MXF_WEBHOOK_MAX_SKEW_SECONDS;
    if (raw === undefined || raw.trim() === '') {
        return DEFAULT_MAX_SKEW_SECONDS;
    }

    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(
            `MXF_WEBHOOK_MAX_SKEW_SECONDS must be a positive number of seconds, got '${raw}'`
        );
    }

    return parsed;
};

/**
 * `verify` hook for express.json() that keeps the raw request bytes.
 *
 * The signature covers the body exactly as it arrived, so it has to be captured
 * before the parser discards it.
 *
 * Wire it up in src/server/index.ts:
 *   app.use(express.json({ verify: captureRawBody }));
 *
 * @param req - Incoming request
 * @param _res - Unused
 * @param buf - Raw request body
 */
export const captureRawBody = (req: Request, _res: Response, buf: Buffer): void => {
    if (buf && buf.length > 0) {
        (req as RawBodyRequest).rawBody = Buffer.from(buf);
    }
};

/**
 * Compute the hex HMAC-SHA256 of `${timestamp}.${rawBody}`.
 *
 * @param secret - Shared secret
 * @param timestamp - Unix-seconds timestamp as sent in the header
 * @param rawBody - Raw request body bytes
 * @returns Lowercase hex digest
 */
export const computeWebhookSignature = (
    secret: string,
    timestamp: string,
    rawBody: Buffer
): string => {
    return crypto
        .createHmac('sha256', secret)
        .update(`${timestamp}.`)
        .update(rawBody)
        .digest('hex');
};

/**
 * Compare two hex digests without leaking their contents through timing.
 *
 * crypto.timingSafeEqual throws on length mismatch, so lengths are checked
 * first — a length difference is not secret.
 *
 * @param a - First hex digest
 * @param b - Second hex digest
 * @returns True when the digests are equal
 */
export const secureCompareHex = (a: string, b: string): boolean => {
    if (a.length !== b.length) {
        return false;
    }

    const bufA = Buffer.from(a, 'hex');
    const bufB = Buffer.from(b, 'hex');

    // Buffer.from ignores trailing garbage in malformed hex; a length mismatch
    // after decoding means one side was not valid hex.
    if (bufA.length !== bufB.length || bufA.length === 0) {
        return false;
    }

    return crypto.timingSafeEqual(bufA, bufB);
};

/** Reason a webhook request failed verification. Used for logs and tests. */
export type WebhookRejection =
    | 'missing_raw_body'
    | 'missing_signature'
    | 'missing_timestamp'
    | 'malformed_signature'
    | 'malformed_timestamp'
    | 'stale_timestamp'
    | 'invalid_signature';

/**
 * Verify a signed webhook request.
 *
 * Kept separate from the Express middleware so it can be unit tested without an
 * HTTP server.
 *
 * @param req - Incoming request, with rawBody captured by the JSON parser
 * @param secret - Shared secret
 * @param nowSeconds - Current unix time in seconds
 * @param maxSkewSeconds - Signature validity window
 * @returns null when the request is authentic, otherwise the rejection reason
 */
export const verifyWebhookRequest = (
    req: RawBodyRequest,
    secret: string,
    nowSeconds: number,
    maxSkewSeconds: number
): WebhookRejection | null => {
    const rawBody = req.rawBody;
    if (!rawBody) {
        return 'missing_raw_body';
    }

    const signatureHeader = req.headers[WEBHOOK_SIGNATURE_HEADER];
    if (typeof signatureHeader !== 'string' || signatureHeader.length === 0) {
        return 'missing_signature';
    }

    const timestampHeader = req.headers[WEBHOOK_TIMESTAMP_HEADER];
    if (typeof timestampHeader !== 'string' || timestampHeader.length === 0) {
        return 'missing_timestamp';
    }

    if (!signatureHeader.startsWith('sha256=')) {
        return 'malformed_signature';
    }
    const provided = signatureHeader.slice('sha256='.length).toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(provided)) {
        return 'malformed_signature';
    }

    const timestamp = Number(timestampHeader);
    if (!Number.isFinite(timestamp) || !Number.isInteger(timestamp)) {
        return 'malformed_timestamp';
    }

    // Reject both stale requests (replay) and timestamps from the future
    // (an attacker pre-signing a request to widen the window).
    if (Math.abs(nowSeconds - timestamp) > maxSkewSeconds) {
        return 'stale_timestamp';
    }

    const expected = computeWebhookSignature(secret, timestampHeader, rawBody);
    if (!secureCompareHex(expected, provided)) {
        return 'invalid_signature';
    }

    return null;
};

/**
 * Express middleware that rejects any unsigned or badly signed webhook request.
 *
 * @param req - Incoming request
 * @param res - Response
 * @param next - Next handler
 */
export const authenticateWebhook = (req: Request, res: Response, next: NextFunction): void => {
    let secret: string;
    let maxSkewSeconds: number;

    try {
        secret = requireWebhookSecret();
        maxSkewSeconds = getMaxSkewSeconds();
    } catch (error) {
        logger.error(`Webhook authentication misconfigured: ${error instanceof Error ? error.message : String(error)}`);
        res.status(500).json({
            success: false,
            message: 'Webhook authentication is not configured'
        });
        return;
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    const rejection = verifyWebhookRequest(req as RawBodyRequest, secret, nowSeconds, maxSkewSeconds);

    if (rejection === 'missing_raw_body') {
        // The JSON parser was not given the captureRawBody verify hook, so the
        // bytes that were signed are gone. Fail closed and say why.
        logger.error(
            'Webhook request has no raw body. Configure the JSON body parser in src/server/index.ts as ' +
            'app.use(express.json({ verify: captureRawBody })) so signatures can be checked against the bytes as sent.'
        );
        res.status(500).json({
            success: false,
            message: 'Webhook authentication is not configured'
        });
        return;
    }

    if (rejection) {
        logger.warn(`Rejected webhook request to ${req.originalUrl}: ${rejection}`);
        res.status(401).json({
            success: false,
            message: 'Invalid webhook signature'
        });
        return;
    }

    next();
};
