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
 * Rate Limiting Middleware
 *
 * Per-IP sliding-window limiter for the endpoints an unauthenticated caller can
 * reach: sign-in, registration, magic-link requests, and the inbound webhooks.
 * Without it, /users/login is an unmetered password oracle and the webhooks are
 * an unmetered way to spend LLM budget.
 *
 * Sliding window, not fixed window: each key keeps the timestamps of its recent
 * requests and old ones age out. A fixed window lets a caller send `max`
 * requests at the end of one window and `max` more at the start of the next.
 *
 * State is per process and held in memory. Across several server instances each
 * process enforces its own limit; run the instances behind a proxy that also
 * rate-limits, or swap the store, if that matters. Memory is bounded: entries
 * age out on access and the oldest keys are evicted once MAX_TRACKED_KEYS is
 * reached, so a caller cycling source addresses cannot grow the map without
 * limit.
 *
 * Client address: taken from `req.ip`, which honours X-Forwarded-For only when
 * Express is configured with `trust proxy`. Behind a load balancer, set it —
 * otherwise every request looks like it came from the proxy and shares one
 * bucket.
 */

import { Request, Response, NextFunction } from 'express';
import { Logger } from '@mxf-dev/core/utils/Logger';

const logger = new Logger('info', 'RateLimit', 'server');

/** Upper bound on distinct keys held in memory across all limiters. */
const MAX_TRACKED_KEYS = 10_000;

/**
 * Configuration for a rate limiter.
 */
export interface RateLimitOptions {
    /** Length of the sliding window, in milliseconds. */
    windowMs: number;
    /** Requests allowed per key within the window. */
    max: number;
    /** Name used in logs and to namespace keys between limiters. */
    name: string;
}

/** Request timestamps (ms) for one key, oldest first. */
type RequestLog = number[];

/** Shared store so MAX_TRACKED_KEYS bounds total memory, not per-limiter memory. */
const store = new Map<string, RequestLog>();

/**
 * Drop entries that have aged out of the window.
 *
 * @param log - Request timestamps for a key
 * @param windowStart - Earliest timestamp still inside the window
 * @returns The surviving timestamps
 */
const pruneLog = (log: RequestLog, windowStart: number): RequestLog => {
    // Timestamps are appended in order, so the survivors are a suffix.
    let firstLive = 0;
    while (firstLive < log.length && log[firstLive] <= windowStart) {
        firstLive++;
    }
    return firstLive === 0 ? log : log.slice(firstLive);
};

/**
 * Evict the oldest keys once the store is full.
 *
 * Map iteration is insertion-ordered, so the first keys out are the ones least
 * recently created. Keys are re-inserted on each request, which keeps active
 * callers near the back.
 */
const evictIfFull = (): void => {
    while (store.size >= MAX_TRACKED_KEYS) {
        const oldest = store.keys().next().value;
        if (oldest === undefined) {
            return;
        }
        store.delete(oldest);
    }
};

/**
 * Identify the caller.
 *
 * @param req - Incoming request
 * @returns The client address, or 'unknown' when Express cannot determine one
 */
const clientKey = (req: Request): string => {
    return req.ip || req.socket?.remoteAddress || 'unknown';
};

/**
 * Record a request and report whether it is over the limit.
 *
 * Exported so the limit logic can be unit tested without an HTTP server.
 *
 * @param key - Namespaced key (limiter name + client address)
 * @param options - Window length and request allowance
 * @param now - Current time in milliseconds
 * @returns Whether the request is allowed, plus the retry delay when it is not
 */
export const consume = (
    key: string,
    options: RateLimitOptions,
    now: number
): { allowed: boolean; remaining: number; retryAfterMs: number } => {
    const windowStart = now - options.windowMs;
    const existing = store.get(key);
    const log = existing ? pruneLog(existing, windowStart) : [];

    if (log.length >= options.max) {
        // Keep the pruned log so the entry does not grow while blocked.
        store.set(key, log);
        const oldest = log[0];
        const retryAfterMs = Math.max(0, oldest + options.windowMs - now);
        return { allowed: false, remaining: 0, retryAfterMs };
    }

    log.push(now);

    // Re-insert so this key moves to the back of the eviction order.
    store.delete(key);
    evictIfFull();
    store.set(key, log);

    return { allowed: true, remaining: options.max - log.length, retryAfterMs: 0 };
};

/**
 * Build an Express middleware that limits requests per client address.
 *
 * @param options - Window length, allowance, and limiter name
 * @returns Express middleware
 */
export const createRateLimiter = (options: RateLimitOptions) => {
    if (!Number.isFinite(options.windowMs) || options.windowMs <= 0) {
        throw new Error(`Rate limiter '${options.name}' requires a positive windowMs`);
    }
    if (!Number.isInteger(options.max) || options.max <= 0) {
        throw new Error(`Rate limiter '${options.name}' requires a positive integer max`);
    }

    return (req: Request, res: Response, next: NextFunction): void => {
        const key = `${options.name}:${clientKey(req)}`;
        const result = consume(key, options, Date.now());

        res.setHeader('X-RateLimit-Limit', String(options.max));
        res.setHeader('X-RateLimit-Remaining', String(result.remaining));

        if (!result.allowed) {
            const retryAfterSeconds = Math.ceil(result.retryAfterMs / 1000);
            res.setHeader('Retry-After', String(retryAfterSeconds));

            logger.warn(`Rate limit hit on ${options.name} from ${clientKey(req)} (${req.method} ${req.originalUrl})`);

            res.status(429).json({
                success: false,
                message: 'Too many requests. Please try again later.',
                retryAfterSeconds
            });
            return;
        }

        next();
    };
};

/**
 * Clear all tracked request logs.
 * Used by tests so one case cannot exhaust the allowance of the next.
 */
export const resetRateLimits = (): void => {
    store.clear();
};

/**
 * Number of keys currently tracked. Exposed for tests and health output.
 *
 * @returns Tracked key count
 */
export const trackedKeyCount = (): number => store.size;

/**
 * Read a positive-integer override from the environment.
 *
 * @param name - Environment variable name
 * @param fallback - Value used when the variable is unset
 * @returns The configured value
 * @throws If the variable is set to something that is not a positive integer
 */
const envInt = (name: string, fallback: number): number => {
    const raw = process.env[name];
    if (raw === undefined || raw.trim() === '') {
        return fallback;
    }

    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error(`${name} must be a positive integer, got '${raw}'`);
    }

    return parsed;
};

/**
 * Limiter for the credential endpoints: /users/login, /users/register,
 * /users/magic-link, /users/magic-link/verify.
 *
 * Ten attempts per address per 15 minutes. Enough for a person who mistypes a
 * password; nowhere near enough to guess one.
 *
 * Override with AUTH_RATE_LIMIT_MAX and AUTH_RATE_LIMIT_WINDOW_MS.
 *
 * @returns Express middleware
 */
export const createAuthRateLimiter = () => createRateLimiter({
    name: 'auth',
    windowMs: envInt('AUTH_RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000),
    max: envInt('AUTH_RATE_LIMIT_MAX', 10)
});

/**
 * Limiter for the inbound webhook routes.
 *
 * Sixty requests per address per minute, applied before signature checking so
 * an unsigned flood cannot force the server to compute HMACs at line rate.
 *
 * Override with WEBHOOK_RATE_LIMIT_MAX and WEBHOOK_RATE_LIMIT_WINDOW_MS.
 *
 * @returns Express middleware
 */
export const createWebhookRateLimiter = () => createRateLimiter({
    name: 'webhook',
    windowMs: envInt('WEBHOOK_RATE_LIMIT_WINDOW_MS', 60 * 1000),
    max: envInt('WEBHOOK_RATE_LIMIT_MAX', 60)
});
