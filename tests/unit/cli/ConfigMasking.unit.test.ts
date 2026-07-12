/**
 * Unit tests for `mxf config` secret masking.
 *
 * `config get credentials` used to print the whole credential block as raw
 * JSON, bypassing the masking that `config list` and scalar `get` applied.
 *
 * @author Brad Anderson <BradA1878@pm.me>
 */

// chalk 5 is ESM-only and this suite runs under ts-jest's CommonJS transform.
// Colour is irrelevant to masking, so every style function becomes identity.
jest.mock('chalk', () => {
    const identity = (value: string): string => value;
    return {
        __esModule: true,
        default: new Proxy({}, { get: () => identity }),
    };
});

import { isSecretKey, maskDeep } from '../../../src/cli/commands/config';

/** Strip ANSI colour codes so assertions compare plain text */
// eslint-disable-next-line no-control-regex
const stripAnsi = (value: string): string => value.replace(/\[[0-9;]*m/g, '');

describe('config — isSecretKey', () => {
    it('recognises secret-looking key names', () => {
        for (const key of [
            'domainKey', 'jwtSecret', 'mxpEncryptionKey', 'agentApiKey',
            'password', 'masterKey', 'accessToken', 'apiKey',
        ]) {
            expect(isSecretKey(key)).toBe(true);
        }
    });

    it('treats the MXP salt as a secret', () => {
        // A known salt is what makes the PBKDF2 derivation precomputable.
        expect(isSecretKey('mxpEncryptionSalt')).toBe(true);
    });

    it('leaves non-secret keys alone', () => {
        for (const key of ['port', 'host', 'username', 'database', 'provider', 'defaultModel']) {
            expect(isSecretKey(key)).toBe(false);
        }
    });
});

describe('config — maskDeep', () => {
    it('masks every secret leaf in a nested credentials block', () => {
        const credentials = {
            domainKey: 'a'.repeat(64),
            jwtSecret: 'super-secret-jwt-value',
            mxpEncryptionKey: 'mxp-key-value',
            mxpEncryptionSalt: 'b'.repeat(32),
            agentApiKey: 'agent-api-key-value',
        };

        const masked = maskDeep(credentials, 'credentials');
        const rendered = stripAnsi(JSON.stringify(masked));

        // None of the raw values may appear in the output
        for (const secret of Object.values(credentials)) {
            expect(rendered).not.toContain(secret);
        }
        expect(rendered).toContain('••••');
    });

    it('masks secrets nested several levels deep', () => {
        const config = {
            infrastructure: {
                mongodb: { port: 27017, username: 'mxf_admin', password: 'mongo-secret-pw' },
                meilisearch: { port: 7700, masterKey: 'meili-master-key' },
            },
        };

        const rendered = stripAnsi(JSON.stringify(maskDeep(config, 'infrastructure')));

        expect(rendered).not.toContain('mongo-secret-pw');
        expect(rendered).not.toContain('meili-master-key');
        // Non-secret siblings survive so the output is still useful
        expect(rendered).toContain('27017');
        expect(rendered).toContain('mxf_admin');
    });

    it('preserves structure and non-secret values', () => {
        const masked = maskDeep({ port: 3001, host: 'localhost' }, 'server');

        expect(masked).toEqual({ port: 3001, host: 'localhost' });
    });

    it('leaves null and undefined secrets unmasked so "not set" stays visible', () => {
        const masked = maskDeep({ apiKey: null, jwtSecret: undefined }, 'llm') as Record<string, unknown>;

        expect(masked.apiKey).toBeNull();
        expect(masked.jwtSecret).toBeUndefined();
    });

    it('masks secret values inside arrays', () => {
        const rendered = stripAnsi(JSON.stringify(maskDeep({ tokens: ['tok-aaa-111', 'tok-bbb-222'] }, 'root')));

        expect(rendered).not.toContain('tok-aaa-111');
        expect(rendered).not.toContain('tok-bbb-222');
    });
});
