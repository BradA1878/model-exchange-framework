/**
 * Validated HTTP and Socket.IO transport security configuration.
 */

import { MAX_MEILISEARCH_BACKFILL_WIRE_BYTES } from '@mxf-dev/core/config/MeilisearchIngressLimits';

export const CORS_ALLOWED_ORIGINS_ENV = 'MXF_CORS_ALLOWED_ORIGINS';
export const SOCKET_MAX_HTTP_BUFFER_BYTES_ENV = 'MXF_SOCKET_MAX_HTTP_BUFFER_BYTES';

export const DEFAULT_SOCKET_MAX_HTTP_BUFFER_BYTES = 1024 * 1024;
export const MAX_SOCKET_MAX_HTTP_BUFFER_BYTES = 10 * 1024 * 1024;
const MIN_SOCKET_MAX_HTTP_BUFFER_BYTES = 1024;

/**
 * Reserved for Socket.IO/Engine.IO packet framing (packet type, namespace,
 * ack id, and the event name) around the serialized payload, so the
 * configured buffer covers the whole frame on the wire, not just the JSON
 * bytes an event handler receives.
 */
const SOCKET_IO_FRAMING_OVERHEAD_BYTES = 1024;

/**
 * Smallest buffer that can carry one full Meilisearch backfill request.
 * Engine.IO closes a socket that sends a frame above the configured limit;
 * a value below this would put every dense-history agent in a reconnect
 * loop instead of a policy rejection it could act on, so the server refuses
 * to boot with a limit this low.
 */
const MINIMUM_SOCKET_MAX_HTTP_BUFFER_BYTES =
    MAX_MEILISEARCH_BACKFILL_WIRE_BYTES + SOCKET_IO_FRAMING_OVERHEAD_BYTES;

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
    let value: number;

    if (configured === undefined || configured.trim() === '') {
        value = DEFAULT_SOCKET_MAX_HTTP_BUFFER_BYTES;
    } else {
        const normalized = configured.trim();
        if (!/^\d+$/.test(normalized)) {
            throw new Error(`${SOCKET_MAX_HTTP_BUFFER_BYTES_ENV} must be an integer number of bytes`);
        }

        value = Number(normalized);
        if (!Number.isSafeInteger(value) ||
            value < MIN_SOCKET_MAX_HTTP_BUFFER_BYTES ||
            value > MAX_SOCKET_MAX_HTTP_BUFFER_BYTES) {
            throw new Error(
                `${SOCKET_MAX_HTTP_BUFFER_BYTES_ENV} must be between ` +
                `${MIN_SOCKET_MAX_HTTP_BUFFER_BYTES} and ${MAX_SOCKET_MAX_HTTP_BUFFER_BYTES} bytes`
            );
        }
    }

    // The resolved value — configured or default — must still leave room for
    // one full Meilisearch backfill request once serialized for the socket.
    if (value < MINIMUM_SOCKET_MAX_HTTP_BUFFER_BYTES) {
        throw new Error(
            `${SOCKET_MAX_HTTP_BUFFER_BYTES_ENV} must be at least ` +
            `${MINIMUM_SOCKET_MAX_HTTP_BUFFER_BYTES} bytes (resolved value: ${value}): one full ` +
            'Meilisearch search backfill request must fit in a single Socket.IO frame'
        );
    }

    return value;
};
