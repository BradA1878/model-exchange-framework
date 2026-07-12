/**
 * Unit tests for the MXF CLI ConfigService.
 *
 * Covers the three behaviours that were previously wrong:
 * - MXP encryption salt is generated per install, never a shared constant
 * - writeEnvFile updates existing keys in place (so `mxf config set` takes effect)
 * - files holding secrets are written owner-only (0600)
 *
 * Every test runs against a throwaway config path, never ~/.mxf.
 *
 * @author Brad Anderson <BradA1878@pm.me>
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ConfigService } from '../../../src/cli/services/ConfigService';

/** Temp working dir for each test — holds both config.json and the .env bridge */
let tmpDir: string;
let configPath: string;
let service: ConfigService;

/** Read a .env file into a key → value map */
function readEnv(envPath: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq === -1) continue;
        out[trimmed.substring(0, eq).trim()] = trimmed.substring(eq + 1).trim();
    }
    return out;
}

/** Octal permission bits of a file (e.g. '600') */
function modeOf(filePath: string): string {
    return (fs.statSync(filePath).mode & 0o777).toString(8);
}

beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mxf-config-test-'));
    configPath = path.join(tmpDir, 'config.json');
    service = new ConfigService(configPath);
});

afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('ConfigService — MXP encryption salt', () => {
    it('generates a salt in createDefault()', () => {
        const config = service.createDefault(path.join(tmpDir, 'docker-compose.yml'));

        expect(config.credentials.mxpEncryptionSalt).toBeTruthy();
        // 16 random bytes rendered as hex
        expect(config.credentials.mxpEncryptionSalt).toMatch(/^[0-9a-f]{32}$/);
    });

    it('never emits the old hardcoded salt', () => {
        service.save(service.createDefault());

        const env = service.toEnvironmentVariables();

        expect(env.MXP_ENCRYPTION_SALT).not.toBe('mxf-default-salt');
    });

    it('generates a different salt for each install', () => {
        const a = service.createDefault().credentials.mxpEncryptionSalt;
        const b = service.createDefault().credentials.mxpEncryptionSalt;

        // A shared salt is precomputable — this is the whole point of the fix.
        expect(a).not.toBe(b);
    });

    it('writes the config salt through to the environment', () => {
        const config = service.createDefault();
        service.save(config);

        const env = service.toEnvironmentVariables();

        expect(env.MXP_ENCRYPTION_SALT).toBe(config.credentials.mxpEncryptionSalt);
        expect(env.MXP_ENCRYPTION_ENABLED).toBe('true');
    });

    it('backfills a salt for a config that predates the field', () => {
        const config = service.createDefault();
        // Simulate a config written before mxpEncryptionSalt existed
        delete (config.credentials as Partial<typeof config.credentials>).mxpEncryptionSalt;
        service.save(config);

        const generated = service.ensureGeneratedCredentials();

        expect(generated).toContain('credentials.mxpEncryptionSalt');
        const reloaded = new ConfigService(configPath).load();
        expect(reloaded?.credentials.mxpEncryptionSalt).toMatch(/^[0-9a-f]{32}$/);
    });

    it('leaves an already-complete config untouched', () => {
        service.save(service.createDefault());
        const before = fs.readFileSync(configPath, 'utf-8');

        const generated = service.ensureGeneratedCredentials();

        expect(generated).toEqual([]);
        expect(fs.readFileSync(configPath, 'utf-8')).toBe(before);
    });

    it('reports a missing salt from validate()', () => {
        const config = service.createDefault();
        delete (config.credentials as Partial<typeof config.credentials>).mxpEncryptionSalt;
        service.save(config);
        // Re-read from disk so validate() sees the stripped config
        const fresh = new ConfigService(configPath);

        const result = fresh.validate();

        expect(result.valid).toBe(false);
        expect(result.errors.some(e => e.includes('mxpEncryptionSalt'))).toBe(true);
    });

    it('passes validate() for a freshly created config', () => {
        service.save(service.createDefault());

        expect(new ConfigService(configPath).validate()).toEqual({ valid: true, errors: [] });
    });
});

describe('ConfigService — writeEnvFile', () => {
    beforeEach(() => {
        service.save(service.createDefault());
    });

    it('creates a .env with the config values', () => {
        service.writeEnvFile(tmpDir);

        const env = readEnv(path.join(tmpDir, '.env'));
        expect(env.MXF_PORT).toBe('3001');
        expect(env.MXP_ENCRYPTION_SALT).toMatch(/^[0-9a-f]{32}$/);
    });

    it('updates an existing key in place rather than leaving it stale', () => {
        const envPath = path.join(tmpDir, '.env');
        service.writeEnvFile(tmpDir);
        expect(readEnv(envPath).MXF_PORT).toBe('3001');

        // This is exactly what `mxf config set server.port 3002` does
        service.set('server.port', 3002);
        service.writeEnvFile(tmpDir);

        // Previously the old value survived and the server kept using it,
        // while the CLI printed ".env bridge file updated."
        expect(readEnv(envPath).MXF_PORT).toBe('3002');
    });

    it('does not leave a duplicate key behind when updating', () => {
        const envPath = path.join(tmpDir, '.env');
        service.writeEnvFile(tmpDir);

        service.set('server.port', 3002);
        service.writeEnvFile(tmpDir);

        const portLines = fs.readFileSync(envPath, 'utf-8')
            .split('\n')
            .filter(l => l.trim().startsWith('MXF_PORT='));
        expect(portLines).toHaveLength(1);
        expect(portLines[0]).toBe('MXF_PORT=3002');
    });

    it('preserves variables the CLI does not manage', () => {
        const envPath = path.join(tmpDir, '.env');
        service.writeEnvFile(tmpDir);
        fs.appendFileSync(envPath, '\n# my own notes\nMY_CUSTOM_VAR=keep-me\n');

        service.set('server.port', 3002);
        service.writeEnvFile(tmpDir);

        const content = fs.readFileSync(envPath, 'utf-8');
        expect(readEnv(envPath).MY_CUSTOM_VAR).toBe('keep-me');
        expect(content).toContain('# my own notes');
    });

    it('appends managed keys that are missing from an existing .env', () => {
        const envPath = path.join(tmpDir, '.env');
        fs.writeFileSync(envPath, 'MY_CUSTOM_VAR=keep-me\n');

        service.writeEnvFile(tmpDir);

        const env = readEnv(envPath);
        expect(env.MY_CUSTOM_VAR).toBe('keep-me');
        expect(env.MXF_PORT).toBe('3001');
        expect(env.JWT_SECRET).toBeTruthy();
    });

    it('writes a new .env owner-only', () => {
        service.writeEnvFile(tmpDir);

        // Holds infra passwords, the JWT secret and the LLM API key
        expect(modeOf(path.join(tmpDir, '.env'))).toBe('600');
    });

    it('tightens permissions on an existing world-readable .env', () => {
        const envPath = path.join(tmpDir, '.env');
        fs.writeFileSync(envPath, 'EXISTING=1\n', { mode: 0o644 });
        expect(modeOf(envPath)).toBe('644');

        service.writeEnvFile(tmpDir);

        expect(modeOf(envPath)).toBe('600');
    });

    it('writes config.json owner-only', () => {
        expect(modeOf(configPath)).toBe('600');
    });
});
