/**
 * Validated HTTP and Socket.IO transport security configuration.
 */

export const CORS_ALLOWED_ORIGINS_ENV = 'MXF_CORS_ALLOWED_ORIGINS';
export const SOCKET_MAX_HTTP_BUFFER_BYTES_ENV = 'MXF_SOCKET_MAX_HTTP_BUFFER_BYTES';

export const DEFAULT_SOCKET_MAX_HTTP_BUFFER_BYTES = 1024 * 1024;
export const MAX_SOCKET_MAX_HTTP_BUFFER_BYTES = 10 * 1024 * 1024;
const MIN_SOCKET_MAX_HTTP_BUFFER_BYTES = 1024;

const DEVELOPMENT_ORIGINS = [
    'http://localhost:8080',
    'http://127.0.0.1:8080',
    'http://localhost:8088',
    'http://localhost:3002'
];

const validateOrigin = (rawOrigin: string): string => {
    if (rawOrigin === '*') {
        throw new Error(`${CORS_ALLOWED_ORIGINS_ENV} must not contain a wildcard origin`);
    }

    let parsed: URL;
    try {
        parsed = new URL(rawOrigin);
    } catch {
        throw new Error(`${CORS_ALLOWED_ORIGINS_ENV} contains an invalid origin: ${rawOrigin}`);
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error(`${CORS_ALLOWED_ORIGINS_ENV} permits only http and https origins: ${rawOrigin}`);
    }

    if (parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
        throw new Error(`${CORS_ALLOWED_ORIGINS_ENV} entries must be origins without credentials, paths, queries, or fragments: ${rawOrigin}`);
    }

    return parsed.origin;
};

/**
 * Resolve credentialed CORS origins. Production must opt in explicitly;
 * development retains the documented localhost dashboard defaults.
 */
export const getAllowedCorsOrigins = (
    environment: NodeJS.ProcessEnv = process.env
): string[] => {
    const configured = environment[CORS_ALLOWED_ORIGINS_ENV]?.trim();
    const isProduction = environment.NODE_ENV?.trim().toLowerCase() === 'production';

    if (!configured) {
        if (isProduction) {
            throw new Error(`${CORS_ALLOWED_ORIGINS_ENV} is required in production`);
        }
        return [...DEVELOPMENT_ORIGINS];
    }

    const entries = configured
        .split(',')
        .map((origin) => origin.trim())
        .filter((origin) => origin.length > 0);

    if (entries.length === 0) {
        throw new Error(`${CORS_ALLOWED_ORIGINS_ENV} must contain at least one origin`);
    }

    return [...new Set(entries.map(validateOrigin))];
};

/** Resolve and range-check the maximum inbound Socket.IO message size. */
export const getSocketMaxHttpBufferSize = (
    environment: NodeJS.ProcessEnv = process.env
): number => {
    const configured = environment[SOCKET_MAX_HTTP_BUFFER_BYTES_ENV];

    if (configured === undefined || configured.trim() === '') {
        return DEFAULT_SOCKET_MAX_HTTP_BUFFER_BYTES;
    }

    const normalized = configured.trim();
    if (!/^\d+$/.test(normalized)) {
        throw new Error(`${SOCKET_MAX_HTTP_BUFFER_BYTES_ENV} must be an integer number of bytes`);
    }

    const value = Number(normalized);
    if (!Number.isSafeInteger(value) ||
        value < MIN_SOCKET_MAX_HTTP_BUFFER_BYTES ||
        value > MAX_SOCKET_MAX_HTTP_BUFFER_BYTES) {
        throw new Error(
            `${SOCKET_MAX_HTTP_BUFFER_BYTES_ENV} must be between ` +
            `${MIN_SOCKET_MAX_HTTP_BUFFER_BYTES} and ${MAX_SOCKET_MAX_HTTP_BUFFER_BYTES} bytes`
        );
    }

    return value;
};
