export const SOCKET_PASSWORD_RATE_LIMIT_MAX_ENV = 'MXF_SOCKET_PASSWORD_RATE_LIMIT_MAX';
export const SOCKET_PASSWORD_RATE_LIMIT_WINDOW_MS_ENV = 'MXF_SOCKET_PASSWORD_RATE_LIMIT_WINDOW_MS';
export const SOCKET_PASSWORD_RATE_LIMIT_MAX_KEYS_ENV = 'MXF_SOCKET_PASSWORD_RATE_LIMIT_MAX_KEYS';

export const MEILISEARCH_SOCKET_RATE_LIMIT_MAX_ENV = 'MXF_MEILISEARCH_SOCKET_RATE_LIMIT_MAX';
export const MEILISEARCH_SOCKET_RATE_LIMIT_WINDOW_MS_ENV = 'MXF_MEILISEARCH_SOCKET_RATE_LIMIT_WINDOW_MS';
export const MEILISEARCH_SOCKET_RATE_LIMIT_MAX_KEYS_ENV = 'MXF_MEILISEARCH_SOCKET_RATE_LIMIT_MAX_KEYS';

export interface IngressRateLimitConfig {
    maximum: number;
    windowMs: number;
    maximumKeys: number;
}

const readInteger = (
    environment: NodeJS.ProcessEnv,
    name: string,
    fallback: number,
    maximum: number
): number => {
    const raw = environment[name];
    if (raw === undefined || raw.trim() === '') {
        return fallback;
    }
    if (!/^\d+$/.test(raw.trim())) {
        throw new Error(`${name} must be a positive integer`);
    }
    const value = Number(raw.trim());
    if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
        throw new Error(`${name} must be between 1 and ${maximum}`);
    }
    return value;
};

export const getSocketPasswordRateLimitConfig = (
    environment: NodeJS.ProcessEnv = process.env
): IngressRateLimitConfig => ({
    maximum: readInteger(environment, SOCKET_PASSWORD_RATE_LIMIT_MAX_ENV, 5, 100),
    windowMs: readInteger(environment, SOCKET_PASSWORD_RATE_LIMIT_WINDOW_MS_ENV, 60_000, 86_400_000),
    maximumKeys: readInteger(environment, SOCKET_PASSWORD_RATE_LIMIT_MAX_KEYS_ENV, 10_000, 1_000_000)
});

/**
 * The Meilisearch budget is charged per channel as well as per agent, in work
 * units of up to 4 KB of message text. It has to cover a whole multi-agent
 * conversation: six agents generate ~120 index requests in their first minute,
 * and a 100/minute channel budget throttled them and failed their tasks. 1000
 * per minute is still a flood guard (at most ~4 MB of text per channel per
 * minute) while leaving normal traffic untouched.
 */
export const getMeilisearchSocketRateLimitConfig = (
    environment: NodeJS.ProcessEnv = process.env
): IngressRateLimitConfig => ({
    maximum: readInteger(environment, MEILISEARCH_SOCKET_RATE_LIMIT_MAX_ENV, 1000, 10_000),
    windowMs: readInteger(environment, MEILISEARCH_SOCKET_RATE_LIMIT_WINDOW_MS_ENV, 60_000, 86_400_000),
    maximumKeys: readInteger(environment, MEILISEARCH_SOCKET_RATE_LIMIT_MAX_KEYS_ENV, 10_000, 1_000_000)
});
