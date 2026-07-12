/**
 * Unit tests for MXP encryption.
 *
 * Encryption is a security boundary, so the failure policy is the point of these
 * tests: a crypto fault must THROW, never hand back the plaintext.
 *
 * The bug being pinned: encryptMessage() ended with
 *     `const encrypted = this.encrypt(payload); return encrypted || payload;`
 * so any failure inside encrypt() put the unencrypted payload on the wire while
 * the caller believed it was encrypted. MxpMiddleware made the same trade in the
 * other direction — with forceEncryption: true and no key configured it merely
 * incremented a counter and sent cleartext.
 *
 * MxpEncryption reads its key from the environment in a private constructor and
 * caches the instance, so each case builds an isolated module registry with the
 * environment it needs.
 */

import { MxpMessageType, MxpEncryptionAlgorithm } from '@mxf-dev/core/schemas/MxpProtocolSchemas';
import type { MxpPayload, EncryptedPayload } from '@mxf-dev/core/schemas/MxpProtocolSchemas';

const KEY = 'test-mxp-passphrase';
const SALT = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';

const samplePayload = (): MxpPayload => ({
    op: 'calc.sum',
    args: [1, 2, 3],
    reasoning: 'add the numbers'
}) as MxpPayload;

/**
 * Load a fresh MxpEncryption singleton with the given environment.
 * jest.isolateModules gives each case its own module registry, so the singleton
 * and its env-derived key are rebuilt from scratch.
 */
const loadEncryption = (env: { key?: string; salt?: string; enabled?: string }) => {
    const previous = {
        MXP_ENCRYPTION_KEY: process.env.MXP_ENCRYPTION_KEY,
        MXP_ENCRYPTION_SALT: process.env.MXP_ENCRYPTION_SALT,
        MXP_ENCRYPTION_ENABLED: process.env.MXP_ENCRYPTION_ENABLED
    };

    if (env.key === undefined) delete process.env.MXP_ENCRYPTION_KEY;
    else process.env.MXP_ENCRYPTION_KEY = env.key;

    if (env.salt === undefined) delete process.env.MXP_ENCRYPTION_SALT;
    else process.env.MXP_ENCRYPTION_SALT = env.salt;

    if (env.enabled === undefined) delete process.env.MXP_ENCRYPTION_ENABLED;
    else process.env.MXP_ENCRYPTION_ENABLED = env.enabled;

    let mod!: typeof import('@mxf-dev/core/utils/MxpEncryption');
    jest.isolateModules(() => {
        mod = require('@mxf-dev/core/utils/MxpEncryption');
    });

    // Restore the ambient environment for the next case.
    Object.entries(previous).forEach(([name, value]) => {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
    });

    return mod;
};

describe('MxpEncryption', () => {
    let consoleErrorSpy: jest.SpyInstance;
    let consoleWarnSpy: jest.SpyInstance;

    beforeEach(() => {
        // Errors always print now; keep the deliberate-failure cases quiet.
        consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
        consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        consoleErrorSpy.mockRestore();
        consoleWarnSpy.mockRestore();
    });

    describe('with a configured key', () => {
        it('reports encryption as enabled', () => {
            const { mxpEncryption } = loadEncryption({ key: KEY, salt: SALT });
            expect(mxpEncryption.isEncryptionEnabled()).toBe(true);
        });

        it('round-trips a payload', () => {
            const { mxpEncryption } = loadEncryption({ key: KEY, salt: SALT });
            const original = samplePayload();

            const encrypted = mxpEncryption.encrypt(original);

            expect(encrypted).not.toBeNull();
            expect(encrypted!.algorithm).toBe(MxpEncryptionAlgorithm.AES_256_GCM);
            expect(encrypted!.data).toEqual(expect.any(String));
            expect(encrypted!.iv).toEqual(expect.any(String));
            expect(encrypted!.authTag).toEqual(expect.any(String));

            // The ciphertext must not contain the cleartext.
            expect(encrypted!.data).not.toContain('calc.sum');

            expect(mxpEncryption.decrypt(encrypted!)).toEqual(original);
        });

        it('produces a different IV and ciphertext each time', () => {
            const { mxpEncryption } = loadEncryption({ key: KEY, salt: SALT });
            const original = samplePayload();

            const first = mxpEncryption.encrypt(original)!;
            const second = mxpEncryption.encrypt(original)!;

            expect(first.iv).not.toEqual(second.iv);
            expect(first.data).not.toEqual(second.data);

            // Both still decrypt to the same thing.
            expect(mxpEncryption.decrypt(first)).toEqual(original);
            expect(mxpEncryption.decrypt(second)).toEqual(original);
        });

        it('round-trips through encryptMessage/decryptMessage', () => {
            const { mxpEncryption } = loadEncryption({ key: KEY, salt: SALT });
            const original = samplePayload();

            const encrypted = mxpEncryption.encryptMessage(original);

            expect(encrypted).not.toEqual(original);
            expect(encrypted).toHaveProperty('algorithm');

            expect(mxpEncryption.decryptMessage(encrypted as EncryptedPayload)).toEqual(original);
        });

        it('THROWS on a tampered authentication tag rather than returning null', () => {
            const { mxpEncryption } = loadEncryption({ key: KEY, salt: SALT });
            const encrypted = mxpEncryption.encrypt(samplePayload())!;

            const tampered: EncryptedPayload = {
                ...encrypted,
                authTag: Buffer.from('0'.repeat(16)).toString('base64')
            };

            expect(() => mxpEncryption.decrypt(tampered)).toThrow(/decryption failed/i);
        });

        it('THROWS on tampered ciphertext', () => {
            const { mxpEncryption } = loadEncryption({ key: KEY, salt: SALT });
            const encrypted = mxpEncryption.encrypt(samplePayload())!;

            const tampered: EncryptedPayload = {
                ...encrypted,
                data: Buffer.from('not the original ciphertext').toString('base64')
            };

            expect(() => mxpEncryption.decrypt(tampered)).toThrow(/decryption failed/i);
        });

        it('THROWS on an unsupported algorithm', () => {
            const { mxpEncryption } = loadEncryption({ key: KEY, salt: SALT });
            const encrypted = mxpEncryption.encrypt(samplePayload())!;

            const wrongAlgorithm = { ...encrypted, algorithm: 'rot13' } as unknown as EncryptedPayload;

            expect(() => mxpEncryption.decrypt(wrongAlgorithm)).toThrow(/unsupported/i);
        });

        it('cannot be decrypted with a different key', () => {
            const withKeyA = loadEncryption({ key: KEY, salt: SALT });
            const encrypted = withKeyA.mxpEncryption.encrypt(samplePayload())!;

            const withKeyB = loadEncryption({ key: 'a-completely-different-key', salt: SALT });

            expect(() => withKeyB.mxpEncryption.decrypt(encrypted)).toThrow(/decryption failed/i);
        });
    });

    describe('with no key configured', () => {
        it('reports encryption as disabled', () => {
            const { mxpEncryption } = loadEncryption({});
            expect(mxpEncryption.isEncryptionEnabled()).toBe(false);
        });

        it('returns null from encrypt() — the opted-out state, not a failure', () => {
            const { mxpEncryption } = loadEncryption({});
            expect(mxpEncryption.encrypt(samplePayload())).toBeNull();
        });

        it('returns the payload untouched from encryptMessage()', () => {
            const { mxpEncryption } = loadEncryption({});
            const original = samplePayload();

            expect(mxpEncryption.encryptMessage(original)).toEqual(original);
        });

        it('THROWS when asked to decrypt', () => {
            const { mxpEncryption } = loadEncryption({});

            const encrypted: EncryptedPayload = {
                algorithm: MxpEncryptionAlgorithm.AES_256_GCM,
                data: 'ZGF0YQ==',
                iv: 'aXY=',
                authTag: 'dGFn'
            };

            expect(() => mxpEncryption.decrypt(encrypted)).toThrow(/not configured/i);
        });
    });

    describe('salt requirement', () => {
        it('fails fast when a key is set without a salt', () => {
            // Opting into encryption with a predictable salt would let an attacker
            // precompute the key derivation.
            expect(() => loadEncryption({ key: KEY })).toThrow(/MXP_ENCRYPTION_SALT/);
        });
    });

    describe('generateSecureKey()', () => {
        it('produces distinct base64 keys', () => {
            const { MxpEncryption } = loadEncryption({ key: KEY, salt: SALT });

            const first = MxpEncryption.generateSecureKey();
            const second = MxpEncryption.generateSecureKey();

            expect(first).not.toEqual(second);
            expect(Buffer.from(first, 'base64')).toHaveLength(32);
        });
    });
});

describe('MxpMiddleware encryption policy', () => {
    let consoleErrorSpy: jest.SpyInstance;
    let consoleWarnSpy: jest.SpyInstance;

    beforeEach(() => {
        consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
        consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        consoleErrorSpy.mockRestore();
        consoleWarnSpy.mockRestore();
    });

    /** Load MxpMiddleware against a fresh MxpEncryption built from `env`. */
    const loadMiddleware = (env: { key?: string; salt?: string }) => {
        const previous = {
            MXP_ENCRYPTION_KEY: process.env.MXP_ENCRYPTION_KEY,
            MXP_ENCRYPTION_SALT: process.env.MXP_ENCRYPTION_SALT
        };

        if (env.key === undefined) delete process.env.MXP_ENCRYPTION_KEY;
        else process.env.MXP_ENCRYPTION_KEY = env.key;

        if (env.salt === undefined) delete process.env.MXP_ENCRYPTION_SALT;
        else process.env.MXP_ENCRYPTION_SALT = env.salt;

        let mod!: typeof import('@mxf-dev/core/middleware/MxpMiddleware');
        jest.isolateModules(() => {
            mod = require('@mxf-dev/core/middleware/MxpMiddleware');
        });

        Object.entries(previous).forEach(([name, value]) => {
            if (value === undefined) delete process.env[name];
            else process.env[name] = value;
        });

        return mod;
    };

    const mxpMessage = () => ({
        version: '2.0',
        type: MxpMessageType.OPERATION,
        senderId: 'agent-1',
        messageId: 'msg-1',
        timestamp: Date.now(),
        encrypted: false,
        payload: samplePayload()
    }) as any;

    it('THROWS rather than sending plaintext when forceEncryption has no key', async () => {
        // The whole point of the fix: this used to bump a counter and return the
        // message unencrypted.
        const { MxpMiddleware } = loadMiddleware({});

        await expect(
            MxpMiddleware.processOutgoing(mxpMessage(), 'agent-1', { forceEncryption: true })
        ).rejects.toThrow(/forceEncryption/i);
    });

    it('encrypts when forceEncryption is set and a key is configured', async () => {
        const { MxpMiddleware } = loadMiddleware({ key: KEY, salt: SALT });

        const result: any = await MxpMiddleware.processOutgoing(mxpMessage(), 'agent-1', {
            forceEncryption: true
        });

        expect(result.encrypted).toBe(true);
        expect(result.payload).toHaveProperty('algorithm', MxpEncryptionAlgorithm.AES_256_GCM);
        expect(JSON.stringify(result.payload)).not.toContain('calc.sum');
    });

    it('leaves the message alone when encryption is not configured and not forced', async () => {
        const { MxpMiddleware } = loadMiddleware({});

        const result: any = await MxpMiddleware.processOutgoing(mxpMessage(), 'agent-1', {});

        expect(result.encrypted).toBe(false);
        expect(result.payload).toEqual(samplePayload());
    });

    it('THROWS on an incoming message it cannot decrypt', async () => {
        const { MxpMiddleware } = loadMiddleware({ key: KEY, salt: SALT });

        const undecryptable = {
            ...mxpMessage(),
            encrypted: true,
            payload: {
                algorithm: MxpEncryptionAlgorithm.AES_256_GCM,
                data: Buffer.from('garbage').toString('base64'),
                iv: Buffer.from('0123456789abcdef').toString('base64'),
                authTag: Buffer.from('0123456789abcdef').toString('base64')
            }
        };

        await expect(MxpMiddleware.processIncoming(undecryptable)).rejects.toThrow(
            /decryption failed/i
        );
    });
});
