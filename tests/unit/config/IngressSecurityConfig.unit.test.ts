/**
 * Defaults for the socket ingress rate limits.
 *
 * The Meilisearch budget is charged per channel as well as per agent, so its
 * default has to cover a whole multi-agent conversation: six agents in the
 * first-contact demo generate ~120 index requests in their first minute, and
 * a 100/minute channel budget throttled them and failed their tasks.
 */

import {
    getMeilisearchSocketRateLimitConfig,
    MEILISEARCH_SOCKET_RATE_LIMIT_MAX_ENV
} from '../../../src/server/config/IngressSecurityConfig';

describe('Meilisearch socket rate limit defaults', () => {
    it('allows a multi-agent channel a thousand work units per minute by default', () => {
        const config = getMeilisearchSocketRateLimitConfig({});

        expect(config).toEqual({ maximum: 1000, windowMs: 60_000, maximumKeys: 10_000 });
    });

    it('still honours an explicit override', () => {
        const config = getMeilisearchSocketRateLimitConfig({
            [MEILISEARCH_SOCKET_RATE_LIMIT_MAX_ENV]: '250'
        });

        expect(config.maximum).toBe(250);
    });
});
