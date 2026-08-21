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

interface StoredChannelKeyFields extends Record<string, unknown> {
    keyId: string;
    secretKey: string;
    channelId: string;
    agentId: string;
    createdBy: string;
    name?: string;
    isActive?: boolean;
    expiresAt?: Date;
    createdAt?: Date;
}

interface ChannelKeyModelMock {
    findOne: jest.Mock;
    findOneAndUpdate: jest.Mock;
    find: jest.Mock;
    updateOne: jest.Mock;
    updateMany: jest.Mock;
    schema: { path: jest.Mock };
}

const savedDocs: StoredChannelKeyFields[] = [];
const mockDisconnectKeySockets = jest.fn();
const mockDisconnectChannelSockets = jest.fn();
const mockClaimAgentIdentity = jest.fn();

jest.mock('../../../src/server/security/AgentIdentityOwnershipService', () => ({
    __esModule: true,
    AgentIdentityOwnershipError: class AgentIdentityOwnershipError extends Error {
        constructor(
            public readonly code: string,
            message: string,
            public readonly statusCode: number
        ) {
            super(message);
        }
    },
    default: {
        claimOrValidate: mockClaimAgentIdentity
    }
}));

jest.mock('@mxf-dev/core/models/channel', () => ({
    Channel: {
        exists: jest.fn(),
        findOne: jest.fn()
    }
}));

jest.mock('@mxf-dev/core/models/user', () => ({
    UserRole: { ADMIN: 'admin', PROVIDER: 'provider', CONSUMER: 'consumer' },
    User: {
        findById: jest.fn()
    }
}));

jest.mock('@mxf-dev/core/models/channelKey', () => {
    /** Stand-in for the Mongoose model. */
    class MockChannelKey {
        public readonly fields: StoredChannelKeyFields;

        public constructor(fields: Record<string, unknown>) {
            this.fields = fields as StoredChannelKeyFields;
        }

        public async save(): Promise<StoredChannelKeyFields> {
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

    Object.assign(MockChannelKey, {
        findOne: jest.fn(),
        findOneAndUpdate: jest.fn(),
        find: jest.fn(),
        updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
        updateMany: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
        // The service refuses to mint a key the schema cannot bind to an agent.
        schema: { path: jest.fn().mockReturnValue({ instance: 'String' }) }
    });

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
import { Channel } from '@mxf-dev/core/models/channel';
import { User } from '@mxf-dev/core/models/user';
import channelKeyService from '../../../src/server/socket/services/ChannelKeyService';

const channelKeyModel = ChannelKey as unknown as ChannelKeyModelMock;
const mockFindOne = channelKeyModel.findOne;
const mockFindOneAndUpdate = channelKeyModel.findOneAndUpdate;
const mockFind = channelKeyModel.find;
const mockSchemaPath = channelKeyModel.schema.path;
const mockChannelExists = Channel.exists as jest.Mock;
const mockChannelFindOne = Channel.findOne as jest.Mock;
const mockUserFindById = User.findById as jest.Mock;
/** Model a `.select(...).lean()` query chain resolving to `value`. */
const leanQuery = (value: unknown): { select: () => { lean: () => Promise<unknown> } } => ({
    select: () => ({ lean: () => Promise.resolve(value) })
});

describe('ChannelKeyService', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        savedDocs.length = 0;
        mockSchemaPath.mockReturnValue({ instance: 'String' });
        mockChannelExists.mockResolvedValue({ _id: 'channel-a' });
        mockChannelFindOne.mockImplementation(() => leanQuery({ createdBy: 'user-1', active: true }));
        mockUserFindById.mockImplementation(() => leanQuery(null));
        mockClaimAgentIdentity.mockResolvedValue(undefined);
        channelKeyModel.updateOne = jest.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
        channelKeyModel.updateMany = jest.fn().mockResolvedValue({ modifiedCount: 1 });
        mockDisconnectKeySockets.mockResolvedValue(1);
        mockDisconnectChannelSockets.mockResolvedValue(1);
        channelKeyService.setSocketLifecycle({
            disconnectKeySockets: mockDisconnectKeySockets,
            disconnectChannelSockets: mockDisconnectChannelSockets
        });
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
            expect(mockClaimAgentIdentity).toHaveBeenCalledWith('commander-kane', 'user-1');
        });

        it('denies a victim agentId claim before generating or persisting an attacker key', async () => {
            // The attacker owns the channel; the globally reserved agent identity is what must stop them.
            mockChannelFindOne.mockImplementation(() => leanQuery({ createdBy: 'attacker-owner', active: true }));
            mockClaimAgentIdentity.mockRejectedValueOnce(
                new Error('Agent identity "victim-agent" is permanently reserved by another owner')
            );

            await expect(channelKeyService.createChannelKey(
                'channel-a',
                'attacker-owner',
                'victim-agent'
            )).rejects.toThrow(/permanently reserved/i);

            expect(savedDocs).toHaveLength(0);
        });

        it('persists and returns the canonical credential tool grant', async () => {
            const result = await channelKeyService.createChannelKey(
                'channel-a',
                'user-1',
                'agent-1',
                'bounded key',
                undefined,
                [' task_complete ', 'memory_get', 'task_complete']
            );

            expect(savedDocs[0].allowedTools).toEqual(['task_complete', 'memory_get']);
            expect(result.allowedTools).toEqual(['task_complete', 'memory_get']);
        });

        it('rejects malformed credential tool grants before persistence', async () => {
            await expect(channelKeyService.createChannelKey(
                'channel-a',
                'user-1',
                'agent-1',
                undefined,
                undefined,
                ['memory_get', '   ']
            )).rejects.toThrow(/allowedTools must be an array of non-empty strings/i);

            expect(savedDocs).toHaveLength(0);
        });

        it('refuses to mint a key with no agent', async () => {
            await expect(
                channelKeyService.createChannelKey('channel-a', 'user-1', '')
            ).rejects.toThrow(/agentId is required/i);
        });

        it.each(['system', 'NO_CHANNEL', 'global', 'system:workflows'])(
            'refuses to mint a key for reserved channel %s',
            async (channelId) => {
                await expect(channelKeyService.createChannelKey(
                    channelId,
                    'user-1',
                    'agent-1'
                )).rejects.toMatchObject({
                    code: 'INVALID_IDENTITY',
                    statusCode: 400
                });

                expect(mockClaimAgentIdentity).not.toHaveBeenCalled();
                expect(savedDocs).toHaveLength(0);
            }
        );

        it('refuses to mint a key the schema cannot bind, rather than dropping the binding', async () => {
            mockSchemaPath.mockReturnValue(undefined);

            await expect(
                channelKeyService.createChannelKey('channel-a', 'user-1', 'agent-1')
            ).rejects.toThrow(/agentId. field/i);

            expect(savedDocs).toHaveLength(0);
        });
    });

    describe('createChannelKey channel ownership', () => {
        const ADMIN_ID = '64b7f0c2e4b0a1a2b3c4d5e6';
        const OTHER_USER_ID = '64b7f0c2e4b0a1a2b3c4d5e7';

        it('refuses a key for an existing channel the requester does not own', async () => {
            mockChannelFindOne.mockImplementation(() => leanQuery({ createdBy: 'user-2', active: true }));
            mockUserFindById.mockImplementation(() => leanQuery({ role: 'consumer' }));

            await expect(channelKeyService.createChannelKey('channel-a', OTHER_USER_ID, 'agent-1'))
                .rejects.toThrow(/does not own channel channel-a/);

            expect(savedDocs).toHaveLength(0);
            expect(mockClaimAgentIdentity).not.toHaveBeenCalled();
        });

        it('lets an administrator issue a key for a channel another user owns', async () => {
            mockChannelFindOne.mockImplementation(() => leanQuery({ createdBy: 'user-2', active: true }));
            mockUserFindById.mockImplementation(() => leanQuery({ role: 'admin' }));

            await expect(channelKeyService.createChannelKey('channel-a', ADMIN_ID, 'agent-1'))
                .resolves.toEqual(expect.objectContaining({ channelId: 'channel-a' }));

            expect(mockUserFindById).toHaveBeenCalledWith(ADMIN_ID);
            expect(savedDocs).toHaveLength(1);
        });

        it('does not look up the requester when they own the channel', async () => {
            await channelKeyService.createChannelKey('channel-a', 'user-1', 'agent-1');

            expect(mockUserFindById).not.toHaveBeenCalled();
            expect(savedDocs).toHaveLength(1);
        });

        it('refuses a key for an inactive channel even for its owner', async () => {
            mockChannelFindOne.mockImplementation(() => leanQuery({ createdBy: 'user-1', active: false }));

            await expect(channelKeyService.createChannelKey('channel-a', 'user-1', 'agent-1'))
                .rejects.toThrow(/not active/);

            expect(savedDocs).toHaveLength(0);
        });

        it('still issues a key for a channel that has not been created yet', async () => {
            // The REST key-first flow derives a temporary channel id before the channel exists.
            mockChannelFindOne.mockImplementation(() => leanQuery(null));

            await expect(channelKeyService.createChannelKey('temp_demo_1', 'user-1', 'agent-1'))
                .resolves.toEqual(expect.objectContaining({ channelId: 'temp_demo_1' }));

            expect(mockUserFindById).not.toHaveBeenCalled();
        });
    });

    describe('validateKey', () => {
        /** A stored key record with a real bcrypt hash of `secret`. */
        const storedKey = async (
            overrides: Record<string, unknown> = {}
        ): Promise<StoredChannelKeyFields> => ({
            keyId: 'key_1',
            secretKey: await bcrypt.hash('correct-secret', 10),
            channelId: 'channel-a',
            agentId: 'agent-1',
            createdBy: 'owner-a',
            isActive: true,
            ...overrides
        });

        it('accepts the right secret and returns the key-bound identity', async () => {
            const key = await storedKey();
            mockFindOne.mockResolvedValue(key);
            mockFindOneAndUpdate.mockResolvedValue(key);

            const result = await channelKeyService.validateKey('key_1', 'correct-secret');

            expect(result).toEqual({
                valid: true,
                channelId: 'channel-a',
                agentId: 'agent-1'
            });
            expect(mockClaimAgentIdentity).toHaveBeenCalledWith('agent-1', 'owner-a');
            expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
                expect.objectContaining({
                    keyId: 'key_1',
                    secretKey: key.secretKey,
                    channelId: 'channel-a',
                    agentId: 'agent-1',
                    createdBy: 'owner-a',
                    isActive: true,
                    $or: expect.any(Array)
                }),
                { $set: { lastUsed: expect.any(Date), updatedAt: expect.any(Date) } },
                { new: true }
            );
        });

        it('returns the expiry needed to terminate an authenticated socket', async () => {
            const expiresAt = new Date(Date.now() + 60_000);
            const key = await storedKey({ expiresAt });
            mockFindOne.mockResolvedValue(key);
            mockFindOneAndUpdate.mockResolvedValue(key);

            await expect(channelKeyService.validateKey('key_1', 'correct-secret'))
                .resolves.toEqual(expect.objectContaining({ valid: true, expiresAt }));
        });

        it('returns the immutable persisted credential tool grant', async () => {
            const key = await storedKey({ allowedTools: ['memory_get'] });
            mockFindOne.mockResolvedValue(key);
            mockFindOneAndUpdate.mockResolvedValue(key);

            await expect(channelKeyService.validateKey('key_1', 'correct-secret'))
                .resolves.toEqual(expect.objectContaining({
                    valid: true,
                    allowedTools: ['memory_get']
                }));
        });

        it('rejects the wrong secret', async () => {
            mockFindOne.mockResolvedValue(await storedKey());

            const result = await channelKeyService.validateKey('key_1', 'wrong-secret');

            expect(result).toEqual({ valid: false });
        });

        it('denies a conflicting key before an agent principal can reach memory or core tools', async () => {
            mockFindOne.mockResolvedValue(await storedKey({
                agentId: 'victim-agent',
                createdBy: 'attacker-owner'
            }));
            mockClaimAgentIdentity.mockRejectedValueOnce(
                new Error('Agent identity ownership conflict')
            );

            await expect(channelKeyService.validateKey('key_1', 'correct-secret'))
                .resolves.toEqual({ valid: false });

            expect(mockClaimAgentIdentity).toHaveBeenCalledWith(
                'victim-agent',
                'attacker-owner'
            );
            expect(mockChannelExists).not.toHaveBeenCalled();
            expect(mockFindOneAndUpdate).not.toHaveBeenCalled();
        });

        it.each([
            { agentId: 'SYSTEM_AGENT', channelId: 'NO_CHANNEL' },
            { agentId: 'SYSTEM', channelId: 'SYSTEM' },
            { agentId: 'sdk_system_agent', channelId: 'config_channel' }
        ])('denies legacy sentinel credential $agentId/$channelId before secret comparison', async (identity) => {
            mockFindOne.mockResolvedValue(await storedKey(identity));
            const compareSpy = jest.spyOn(bcrypt, 'compare');

            await expect(channelKeyService.validateKey('key_1', 'correct-secret'))
                .resolves.toEqual({ valid: false });

            expect(compareSpy).not.toHaveBeenCalled();
            expect(mockClaimAgentIdentity).not.toHaveBeenCalled();
            expect(mockFindOneAndUpdate).not.toHaveBeenCalled();
            compareSpy.mockRestore();
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

        it('refuses a key after its channel is deleted or deactivated', async () => {
            mockFindOne.mockResolvedValue(await storedKey());
            mockChannelExists.mockResolvedValue(null);

            expect(await channelKeyService.validateKey('key_1', 'correct-secret'))
                .toEqual({ valid: false });
            expect(ChannelKey.updateOne).not.toHaveBeenCalled();
        });

        it('requires the active channel owner to match the key owner', async () => {
            mockFindOne.mockResolvedValue(await storedKey({ createdBy: 'owner-a' }));
            mockChannelExists.mockResolvedValue(null);

            expect(await channelKeyService.validateKey('key_1', 'correct-secret'))
                .toEqual({ valid: false });
            expect(Channel.exists).toHaveBeenCalledWith({
                channelId: 'channel-a',
                active: true,
                createdBy: 'owner-a'
            });
            expect(ChannelKey.updateOne).not.toHaveBeenCalled();
        });

        it('rejects a non-string secret', async () => {
            expect(await channelKeyService.validateKey('key_1', undefined as unknown as string))
                .toEqual({ valid: false });
        });

        it('fails validation when revocation wins while bcrypt is in flight', async () => {
            const key = await storedKey();
            mockFindOne.mockResolvedValue(key);
            mockFindOneAndUpdate.mockResolvedValue(null);

            let releaseCompare: ((value: boolean) => void) | undefined;
            const compareSpy = jest.spyOn(bcrypt, 'compare').mockImplementationOnce((() => (
                new Promise<boolean>(resolve => {
                    releaseCompare = resolve;
                })
            )) as typeof bcrypt.compare);

            const validation = channelKeyService.validateKey('key_1', 'correct-secret');
            await Promise.resolve();
            await Promise.resolve();
            expect(releaseCompare).toBeDefined();

            await expect(channelKeyService.deactivateChannelKey('key_1')).resolves.toBe(true);
            releaseCompare!(true);

            await expect(validation).resolves.toEqual({ valid: false });
            expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
                expect.objectContaining({ keyId: 'key_1', isActive: true }),
                expect.any(Object),
                { new: true }
            );
            compareSpy.mockRestore();
        });
    });

    describe('lifecycle revocation', () => {
        it('revokes every active row for a deleted channel regardless of owner', async () => {
            channelKeyModel.updateMany.mockResolvedValue({ modifiedCount: 3 });

            await expect(channelKeyService.deactivateChannelKeys('channel-a')).resolves.toBe(3);

            expect(ChannelKey.updateMany).toHaveBeenCalledWith(
                { channelId: 'channel-a', isActive: true },
                { $set: { isActive: false, updatedAt: expect.any(Date) } }
            );
            expect(mockDisconnectChannelSockets).toHaveBeenCalledWith('channel-a');
            expect((ChannelKey.updateMany as jest.Mock).mock.invocationCallOrder[0])
                .toBeLessThan(mockDisconnectChannelSockets.mock.invocationCallOrder[0]);
        });

        it('revokes an agent key only for its exact persisted owner', async () => {
            const select = jest.fn().mockResolvedValue([
                { keyId: 'key-owner-a-1' },
                { keyId: 'key-owner-a-2' }
            ]);
            mockFind.mockReturnValue({ select });
            channelKeyModel.updateMany.mockResolvedValue({ modifiedCount: 2 });

            await expect(
                channelKeyService.deactivateAgentKeys('agent-1', 'owner-a')
            ).resolves.toBe(2);

            expect(ChannelKey.updateMany).toHaveBeenCalledWith(
                { agentId: 'agent-1', createdBy: 'owner-a', isActive: true },
                { $set: { isActive: false, updatedAt: expect.any(Date) } }
            );
            expect(mockFind).toHaveBeenCalledWith({
                agentId: 'agent-1',
                createdBy: 'owner-a'
            });
            expect(mockDisconnectKeySockets).toHaveBeenCalledTimes(2);
            expect(mockDisconnectKeySockets).toHaveBeenCalledWith('key-owner-a-1');
            expect(mockDisconnectKeySockets).toHaveBeenCalledWith('key-owner-a-2');
            expect(mockDisconnectKeySockets).not.toHaveBeenCalledWith('key-owner-b');
            expect((ChannelKey.updateMany as jest.Mock).mock.invocationCallOrder[0])
                .toBeLessThan(mockDisconnectKeySockets.mock.invocationCallOrder[0]);
        });

        it('deactivates one key before evicting only that key\'s sockets', async () => {
            await expect(channelKeyService.deactivateChannelKey('key-old')).resolves.toBe(true);

            expect(ChannelKey.updateOne).toHaveBeenCalledWith(
                { keyId: 'key-old', isActive: true },
                { $set: { isActive: false, updatedAt: expect.any(Date) } }
            );
            expect(mockDisconnectKeySockets).toHaveBeenCalledTimes(1);
            expect(mockDisconnectKeySockets).toHaveBeenCalledWith('key-old');
            expect((ChannelKey.updateOne as jest.Mock).mock.invocationCallOrder[0])
                .toBeLessThan(mockDisconnectKeySockets.mock.invocationCallOrder[0]);
        });

        it('retries socket cleanup for an exact agent key that is already inactive', async () => {
            const select = jest.fn().mockResolvedValue([{ keyId: 'key-needs-cleanup' }]);
            mockFind.mockReturnValue({ select });
            channelKeyModel.updateMany.mockResolvedValue({ modifiedCount: 0 });

            await expect(
                channelKeyService.deactivateAgentKeys('agent-1', 'owner-a')
            ).resolves.toBe(0);

            expect(mockDisconnectKeySockets).toHaveBeenCalledWith('key-needs-cleanup');
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

        it('exposes the non-secret credential tool grant to authorized status callers', async () => {
            mockFindOne.mockReturnValue({
                select: jest.fn().mockResolvedValue({
                    keyId: 'key_1',
                    channelId: 'channel-a',
                    agentId: 'agent-1',
                    allowedTools: ['memory_get']
                })
            });

            expect(await channelKeyService.describeKey('key_1')).toEqual({
                channelId: 'channel-a',
                agentId: 'agent-1',
                allowedTools: ['memory_get']
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
