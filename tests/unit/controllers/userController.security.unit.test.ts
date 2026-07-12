/**
 * User Controller Security Unit Tests
 *
 * Three holes, pinned shut:
 *
 * 1. Self-registration read `role` from the request body, so POST /users/register
 *    with {"role":"admin"} made you an administrator.
 * 2. POST /users/magic-link returned the magic-link token in the HTTP response.
 *    That token exchanges for a 24h session, and the endpoint auto-creates users,
 *    so an unauthenticated caller could take over any account by asking for a link
 *    to its address.
 * 3. `username` and `email` went straight from the body into a Mongo filter, so
 *    {"username":{"$gt":""}} matched the first user in the collection.
 */

import { Request, Response } from 'express';

const savedUsers: any[] = [];

jest.mock('@mxf-dev/core/models/user', () => {
    const UserRole = {
        ADMIN: 'admin',
        PROVIDER: 'provider',
        CONSUMER: 'consumer'
    };

    /** Stand-in for the Mongoose model: records what the controller tried to save. */
    class MockUser {
        public _id = 'user-id-1';
        public username: string;
        public email: string;
        public password: string;
        public role: string;
        public firstName?: string;
        public lastName?: string;
        public company?: string;
        public lastLogin?: Date;

        constructor(fields: any) {
            this.username = fields.username;
            this.email = fields.email;
            this.password = fields.password;
            this.role = fields.role;
            this.firstName = fields.firstName;
            this.lastName = fields.lastName;
            this.company = fields.company;
        }

        async save() {
            savedUsers.push(this);
            return this;
        }

        async comparePassword(candidate: string) {
            return candidate === this.password;
        }
    }

    (MockUser as any).findOne = jest.fn();
    (MockUser as any).findById = jest.fn();

    return { User: MockUser, UserRole };
});

jest.mock('@mxf-dev/core/utils/Logger', () => ({
    Logger: jest.fn().mockImplementation(() => ({
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn()
    }))
}));

jest.mock('@mxf-dev/core/utils/env', () => ({
    requireEnv: jest.fn().mockReturnValue('test-jwt-secret')
}));

import { User, UserRole } from '@mxf-dev/core/models/user';
import { userController } from '../../../src/server/api/controllers/userController';
import {
    setMagicLinkSender,
    resetMagicLinkSender,
    MagicLinkDelivery,
    MagicLinkSender
} from '../../../src/server/api/services/MagicLinkSender';

const mockFindOne = (User as any).findOne as jest.Mock;

/** Capture deliveries instead of sending them. */
class RecordingSender implements MagicLinkSender {
    public readonly transport = 'log' as const;
    public readonly sent: MagicLinkDelivery[] = [];

    async send(delivery: MagicLinkDelivery): Promise<void> {
        this.sent.push(delivery);
    }
}

const buildRes = () => {
    const res: Partial<Response> = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res as Response;
};

/** Body of the most recent res.json() call. */
const jsonBody = (res: Response) => (res.json as jest.Mock).mock.calls[0][0];

describe('userController security', () => {
    let sender: RecordingSender;

    beforeEach(() => {
        jest.clearAllMocks();
        savedUsers.length = 0;
        sender = new RecordingSender();
        setMagicLinkSender(sender);
    });

    afterEach(() => {
        resetMagicLinkSender();
    });

    describe('register — privilege escalation', () => {
        it('ignores a role in the request body and creates a consumer', async () => {
            mockFindOne.mockResolvedValue(null);

            const req = {
                body: {
                    username: 'mallory',
                    email: 'mallory@example.com',
                    password: 'hunter2',
                    role: 'admin'
                }
            } as Request;
            const res = buildRes();

            await userController.register(req, res);

            expect(res.status).toHaveBeenCalledWith(201);
            expect(savedUsers).toHaveLength(1);
            expect(savedUsers[0].role).toBe(UserRole.CONSUMER);
            expect(jsonBody(res).user.role).toBe(UserRole.CONSUMER);
        });

        it('creates a consumer when no role is supplied', async () => {
            mockFindOne.mockResolvedValue(null);

            const req = {
                body: { username: 'alice', email: 'alice@example.com', password: 'pw' }
            } as Request;

            await userController.register(req, buildRes());

            expect(savedUsers[0].role).toBe(UserRole.CONSUMER);
        });

        it('ignores a provider role too', async () => {
            mockFindOne.mockResolvedValue(null);

            const req = {
                body: {
                    username: 'bob',
                    email: 'bob@example.com',
                    password: 'pw',
                    role: UserRole.PROVIDER
                }
            } as Request;

            await userController.register(req, buildRes());

            expect(savedUsers[0].role).toBe(UserRole.CONSUMER);
        });
    });

    describe('register — query operator injection', () => {
        it('rejects an object username without touching the database', async () => {
            const req = {
                body: { username: { $gt: '' }, email: 'x@example.com', password: 'pw' }
            } as unknown as Request;
            const res = buildRes();

            await userController.register(req, res);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(mockFindOne).not.toHaveBeenCalled();
            expect(savedUsers).toHaveLength(0);
        });

        it('rejects an object email', async () => {
            const req = {
                body: { username: 'x', email: { $ne: null }, password: 'pw' }
            } as unknown as Request;
            const res = buildRes();

            await userController.register(req, res);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(mockFindOne).not.toHaveBeenCalled();
        });

        it('rejects a non-string password', async () => {
            const req = {
                body: { username: 'x', email: 'x@example.com', password: { $ne: null } }
            } as unknown as Request;
            const res = buildRes();

            await userController.register(req, res);

            expect(res.status).toHaveBeenCalledWith(400);
        });
    });

    describe('login — query operator injection', () => {
        it('rejects an object username with 401 and never queries', async () => {
            const req = {
                body: { username: { $gt: '' }, password: 'anything' }
            } as unknown as Request;
            const res = buildRes();

            await userController.login(req, res);

            expect(res.status).toHaveBeenCalledWith(401);
            expect(mockFindOne).not.toHaveBeenCalled();
        });

        it('rejects a non-string password', async () => {
            const req = {
                body: { username: 'alice', password: { $ne: '' } }
            } as unknown as Request;
            const res = buildRes();

            await userController.login(req, res);

            expect(res.status).toHaveBeenCalledWith(401);
            expect(mockFindOne).not.toHaveBeenCalled();
        });

        it('still logs in a real user with string credentials', async () => {
            mockFindOne.mockResolvedValue({
                _id: 'user-id-1',
                username: 'alice',
                email: 'alice@example.com',
                password: 'pw',
                role: UserRole.CONSUMER,
                comparePassword: async (c: string) => c === 'pw',
                save: jest.fn()
            });

            const req = { body: { username: 'alice', password: 'pw' } } as Request;
            const res = buildRes();

            await userController.login(req, res);

            expect(res.status).toHaveBeenCalledWith(200);
            expect(jsonBody(res).token).toEqual(expect.any(String));
        });
    });

    describe('requestMagicLink — token disclosure', () => {
        it('never returns the token or the link in the response', async () => {
            mockFindOne.mockResolvedValue({
                _id: 'user-id-1',
                username: 'victim',
                email: 'victim@example.com',
                role: UserRole.CONSUMER
            });

            const req = { body: { email: 'victim@example.com' } } as Request;
            const res = buildRes();

            await userController.requestMagicLink(req, res);

            expect(res.status).toHaveBeenCalledWith(200);

            const body = jsonBody(res);
            expect(body.magicLink).toBeUndefined();
            expect(body.token).toBeUndefined();
            expect(JSON.stringify(body)).not.toContain('eyJ'); // no JWT anywhere in the response
        });

        it('delivers the link out of band instead', async () => {
            mockFindOne.mockResolvedValue({
                _id: 'user-id-1',
                username: 'victim',
                email: 'victim@example.com',
                role: UserRole.CONSUMER
            });

            await userController.requestMagicLink(
                { body: { email: 'victim@example.com' } } as Request,
                buildRes()
            );

            expect(sender.sent).toHaveLength(1);
            expect(sender.sent[0].email).toBe('victim@example.com');
            expect(sender.sent[0].token).toEqual(expect.any(String));
            expect(sender.sent[0].magicLink).toContain('token=');
        });

        it('still auto-creates an unknown address', async () => {
            mockFindOne.mockResolvedValue(null);

            await userController.requestMagicLink(
                { body: { email: 'brand-new@example.com' } } as Request,
                buildRes()
            );

            expect(savedUsers).toHaveLength(1);
            expect(savedUsers[0].email).toBe('brand-new@example.com');
            expect(savedUsers[0].role).toBe(UserRole.CONSUMER);
            expect(sender.sent[0].isNewUser).toBe(true);
        });

        it('answers the same way for known and unknown addresses, so users cannot be enumerated', async () => {
            mockFindOne.mockResolvedValue({
                _id: 'user-id-1',
                username: 'known',
                email: 'known@example.com',
                role: UserRole.CONSUMER
            });
            const knownRes = buildRes();
            await userController.requestMagicLink(
                { body: { email: 'known@example.com' } } as Request,
                knownRes
            );

            savedUsers.length = 0;
            mockFindOne.mockResolvedValue(null);
            const unknownRes = buildRes();
            await userController.requestMagicLink(
                { body: { email: 'unknown@example.com' } } as Request,
                unknownRes
            );

            expect(jsonBody(unknownRes)).toEqual(jsonBody(knownRes));
        });

        it('reports failure when delivery fails rather than claiming success', async () => {
            mockFindOne.mockResolvedValue({
                _id: 'user-id-1',
                username: 'victim',
                email: 'victim@example.com',
                role: UserRole.CONSUMER
            });

            setMagicLinkSender({
                transport: 'webhook',
                send: jest.fn().mockRejectedValue(new Error('mail relay down'))
            } as unknown as MagicLinkSender);

            const res = buildRes();
            await userController.requestMagicLink(
                { body: { email: 'victim@example.com' } } as Request,
                res
            );

            expect(res.status).toHaveBeenCalledWith(500);
            expect(jsonBody(res).success).toBe(false);
        });

        it('rejects a malformed address', async () => {
            const res = buildRes();
            await userController.requestMagicLink(
                { body: { email: 'not-an-email' } } as Request,
                res
            );

            expect(res.status).toHaveBeenCalledWith(400);
            expect(sender.sent).toHaveLength(0);
        });

        it('rejects an object email without querying', async () => {
            const res = buildRes();
            await userController.requestMagicLink(
                { body: { email: { $ne: null } } } as unknown as Request,
                res
            );

            expect(res.status).toHaveBeenCalledWith(400);
            expect(mockFindOne).not.toHaveBeenCalled();
        });
    });
});
