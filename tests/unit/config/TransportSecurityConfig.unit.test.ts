import { MAX_MEILISEARCH_BACKFILL_WIRE_BYTES } from '@mxf-dev/core/config/MeilisearchIngressLimits';
import {
    CORS_ALLOWED_ORIGINS_ENV,
    DEFAULT_SOCKET_MAX_HTTP_BUFFER_BYTES,
    MAX_SOCKET_MAX_HTTP_BUFFER_BYTES,
    SOCKET_MAX_HTTP_BUFFER_BYTES_ENV,
    getAllowedCorsOrigins,
    getSocketMaxHttpBufferSize
} from '../../../src/server/config/TransportSecurityConfig';

describe('TransportSecurityConfig', () => {
    describe('credentialed CORS origins', () => {
        it('uses exact localhost origins in development', () => {
            const origins = getAllowedCorsOrigins({ NODE_ENV: 'development' });

            expect(origins).toContain('http://localhost:8080');
            expect(origins).not.toContain('*');
        });

        it('requires an explicit origin list in production', () => {
            expect(() => getAllowedCorsOrigins({ NODE_ENV: 'production' }))
                .toThrow(CORS_ALLOWED_ORIGINS_ENV);
        });

        it('normalizes and de-duplicates configured origins', () => {
            const origins = getAllowedCorsOrigins({
                NODE_ENV: 'production',
                [CORS_ALLOWED_ORIGINS_ENV]: ' https://dashboard.example.test,https://dashboard.example.test/ '
            });

            expect(origins).toEqual(['https://dashboard.example.test']);
        });

        it.each([
            '*',
            'file:///tmp/dashboard.html',
            'https://user:password@example.test',
            'https://example.test/dashboard',
            'https://example.test?tenant=one'
        ])('rejects unsafe or non-origin entry %s', (origin) => {
            expect(() => getAllowedCorsOrigins({
                NODE_ENV: 'production',
                [CORS_ALLOWED_ORIGINS_ENV]: origin
            })).toThrow(CORS_ALLOWED_ORIGINS_ENV);
        });
    });

    describe('Socket.IO inbound payload limit', () => {
        it('defaults to one MiB', () => {
            expect(getSocketMaxHttpBufferSize({})).toBe(DEFAULT_SOCKET_MAX_HTTP_BUFFER_BYTES);
        });

        it('accepts a bounded configured integer', () => {
            expect(getSocketMaxHttpBufferSize({
                [SOCKET_MAX_HTTP_BUFFER_BYTES_ENV]: '2097152'
            })).toBe(2 * 1024 * 1024);
        });

        it.each(['1.5', 'abc', '-1', '0', String(MAX_SOCKET_MAX_HTTP_BUFFER_BYTES + 1)])(
            'rejects invalid or unsafe value %s',
            (value) => {
                expect(() => getSocketMaxHttpBufferSize({
                    [SOCKET_MAX_HTTP_BUFFER_BYTES_ENV]: value
                })).toThrow(SOCKET_MAX_HTTP_BUFFER_BYTES_ENV);
            }
        );

        it('rejects a configured buffer too small to carry one Meilisearch backfill request', () => {
            expect(() => getSocketMaxHttpBufferSize({
                [SOCKET_MAX_HTTP_BUFFER_BYTES_ENV]: String(MAX_MEILISEARCH_BACKFILL_WIRE_BYTES)
            })).toThrow(SOCKET_MAX_HTTP_BUFFER_BYTES_ENV);
        });

        it('accepts a buffer exactly large enough for one backfill request plus framing overhead', () => {
            expect(getSocketMaxHttpBufferSize({
                [SOCKET_MAX_HTTP_BUFFER_BYTES_ENV]: String(MAX_MEILISEARCH_BACKFILL_WIRE_BYTES + 1024)
            })).toBe(MAX_MEILISEARCH_BACKFILL_WIRE_BYTES + 1024);
        });
    });
});
