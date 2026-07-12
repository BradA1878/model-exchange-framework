/**
 * Channel Key Service Unit Tests
 *
 * Two properties, both of which the previous implementation lacked:
 *
 * 1. Secrets are hashed at rest. `channelkeys.secretKey` used to hold the value an
 *    agent sends to authenticate, so read access to the database was read access
 *    to every agent's credential.
 * 2. A key names its agent. Socket auth reads the identity off the key, so an
 *    agent cannot announce itself as another agent in the same channel.
 */

import bcrypt from 'bcrypt';

const savedDocs: any[] = [];

jest.mock('@mxf-dev/core/models/channelKey', () => {
    /** Stand-in for the Mongoose model. */
    class MockChannelKey {
        constructor(public fields: any) {}

        async save() {
            savedDocs.push(this.fields);
            return {
                ...this.fields,
                // Mongoose returns the persisted doc, which for us is the fields as given
                keyId: this.fields.keyId,
                channelId: this.fields.channelId,
                name: this.fields.name,
                isActive: this.fields.isActive,
                expiresAt: this.fields.expiresAt,
                createdAt: this.fields.createdAt
            };
        }
    }

    (MockChannelKey as any).findOne = jest.fn();
    (MockChannelKey as any).find = jest.fn();
    (MockChannelKey as any).updateOne = jest.fn().mockResolvedValue({ modifiedCount: 1 });
    // The service refuses to mint a key the schema cannot bind to an agent
    (MockChannelKey as any).schema = { path: jest.fn().mockReturnValue({ instance: 'String' }) };

    return {
        __esModule: true,
        default: MockChannelKey,
        generateChannelKey: jest.fn(() => ({
            keyId: 'key_generated',
            secretKey: 'plaintext-secret-value'
        }))
    };
});

jest.mock('@mxf-dev/core/utils/Logger', () => ({
    Logger: jest.fn().mockImplementation(() => ({
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn()
    }))
}));

jest.mock('@mxf-dev/core/utils/validation', () => ({
    createStrictValidator: jest.fn().mockReturnValue({
        assertIsNonEmptyString: jest.fn((value: unknown, message?: string) => {
            if (typeof value !== 'string' || value.trim().length === 0) {
                throw new Error(message || 'expected a non-empty string');
            }
            return true;
        })
    })
}));

import ChannelKey from '@mxf-dev/core/models/channelKey';
import channelKeyService from '../../../src/server/socket/services/ChannelKeyService';

const mockFindOne = (ChannelKey as any).findOne as jest.Mock;
const mockSchemaPath = (ChannelKey as any).schema.path as jest.Mock;

describe('ChannelKeyService', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        savedDocs.length = 0;
        mockSchemaPath.mockReturnValue({ instance: 'String' });
        (ChannelKey as any).updateOne = jest.fn().mockResolvedValue({ modifiedCount: 1 });
    });

    describe('createChannelKey', () => {
        it('stores a bcrypt hash, never the secret', async () => {
            const result = await channelKeyService.createChannelKey(
                'channel-a',
                'user-1',
                'agent-1',
                'demo key'
            );

            expect(savedDocs).toHaveLength(1);
            expect(savedDocs[0].secretKey).not.toBe('plaintext-secret-value');
            expect(savedDocs[0].secretKey).toMatch(/^\$2[aby]\$\d{2}\$/);

            // The stored hash verifies the secret that was handed back
            await expect(bcrypt.compare(result.secretKey, savedDocs[0].secretKey)).resolves.toBe(true);
        });

        it('returns the plaintext secret exactly once', async () => {
            const result = await channelKeyService.createChannelKey(
                'channel-a',
                'user-1',
                'agent-1'
            );

            expect(result.secretKey).toBe('plaintext-secret-value');
        });

        it('binds the key to an agent', async () => {
            const result = await channelKeyService.createChannelKey(
                'channel-a',
                'user-1',
                'commander-kane'
            );

            expect(savedDocs[0].agentId).toBe('commander-kane');
            expect(result.agentId).toBe('commander-kane');
        });

        it('refuses to mint a key with no agent', async () => {
            await expect(
                channelKeyService.createChannelKey('channel-a', 'user-1', '')
            ).rejects.toThrow(/agentId is required/i);
        });

        it('refuses to mint a key the schema cannot bind, rather than dropping the binding', async () => {
            mockSchemaPath.mockReturnValue(undefined);

            await expect(
                channelKeyService.createChannelKey('channel-a', 'user-1', 'agent-1')
            ).rejects.toThrow(/agentId. field/i);

            expect(savedDocs).toHaveLength(0);
        });
    });

    describe('validateKey', () => {
        /** A stored key record with a real bcrypt hash of `secret`. */
        const storedKey = async (overrides: Record<string, unknown> = {}) => ({
            keyId: 'key_1',
            secretKey: await bcrypt.hash('correct-secret', 10),
            channelId: 'channel-a',
            agentId: 'agent-1',
            isActive: true,
            ...overrides
        });

        it('accepts the right secret and returns the key-bound identity', async () => {
            mockFindOne.mockResolvedValue(await storedKey());

            const result = await channelKeyService.validateKey('key_1', 'correct-secret');

            expect(result).toEqual({
                valid: true,
                channelId: 'channel-a',
                agentId: 'agent-1'
            });
        });

        it('rejects the wrong secret', async () => {
            mockFindOne.mockResolvedValue(await storedKey());

            const result = await channelKeyService.validateKey('key_1', 'wrong-secret');

            expect(result).toEqual({ valid: false });
        });

        it('rejects an unknown key', async () => {
            mockFindOne.mockResolvedValue(null);

            expect(await channelKeyService.validateKey('key_nope', 'x')).toEqual({ valid: false });
        });

        it('rejects an expired key', async () => {
            mockFindOne.mockResolvedValue(
                await storedKey({ expiresAt: new Date(Date.now() - 1000) })
            );

            expect(await channelKeyService.validateKey('key_1', 'correct-secret'))
                .toEqual({ valid: false });
        });

        it('refuses a key whose secret is still plaintext instead of comparing in the clear', async () => {
            mockFindOne.mockResolvedValue({
                keyId: 'key_legacy',
                secretKey: 'correct-secret', // never hashed
                channelId: 'channel-a',
                agentId: 'agent-1',
                isActive: true
            });

            // The secret matches character for character, and it is still refused
            expect(await channelKeyService.validateKey('key_legacy', 'correct-secret'))
                .toEqual({ valid: false });
        });

        it('refuses a key that is not bound to an agent', async () => {
            mockFindOne.mockResolvedValue(await storedKey({ agentId: undefined }));

            expect(await channelKeyService.validateKey('key_1', 'correct-secret'))
                .toEqual({ valid: false });
        });

        it('rejects a non-string secret', async () => {
            expect(await channelKeyService.validateKey('key_1', undefined as unknown as string))
                .toEqual({ valid: false });
        });
    });

    describe('describeKey', () => {
        it('reports the channel and agent without needing the secret', async () => {
            mockFindOne.mockReturnValue({
                select: jest.fn().mockResolvedValue({
                    keyId: 'key_1',
                    channelId: 'channel-a',
                    agentId: 'agent-1'
                })
            });

            expect(await channelKeyService.describeKey('key_1')).toEqual({
                channelId: 'channel-a',
                agentId: 'agent-1'
            });
        });

        it('returns null for a key that is gone or inactive', async () => {
            mockFindOne.mockReturnValue({ select: jest.fn().mockResolvedValue(null) });

            expect(await channelKeyService.describeKey('key_nope')).toBeNull();
        });
    });

    describe('deriveAgentIdFromKey', () => {
        it('is stable for the same key and channel', () => {
            const a = channelKeyService.deriveAgentIdFromKey('key_1', 'channel-a');
            const b = channelKeyService.deriveAgentIdFromKey('key_1', 'channel-a');

            expect(a).toBe(b);
            expect(a).toMatch(/^agent-[0-9a-f]{12}$/);
        });

        it('differs across keys and across channels', () => {
            expect(channelKeyService.deriveAgentIdFromKey('key_1', 'channel-a'))
                .not.toBe(channelKeyService.deriveAgentIdFromKey('key_2', 'channel-a'));

            expect(channelKeyService.deriveAgentIdFromKey('key_1', 'channel-a'))
                .not.toBe(channelKeyService.deriveAgentIdFromKey('key_1', 'channel-b'));
        });
    });
});
