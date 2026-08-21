import jwt, { JwtPayload } from 'jsonwebtoken';
import {
    JWT_ISSUER,
    MIN_JWT_SECRET_LENGTH,
    assertJwtSecretConfigured,
    MAGIC_LINK_JWT_AUDIENCE,
    MAGIC_LINK_JWT_TYPE,
    SESSION_JWT_AUDIENCE,
    SESSION_JWT_TYPE,
    signMagicLinkToken,
    signSessionToken,
    verifyMagicLinkToken,
    verifySessionToken
} from '../../../src/server/api/security/jwtTokenPolicy';

describe('JWT token purpose policy', () => {
    const originalSecret = process.env.JWT_SECRET;

    beforeAll(() => {
        process.env.JWT_SECRET = 'unit-test-secret-with-enough-entropy-0123456789';
    });

    afterAll(() => {
        if (originalSecret === undefined) {
            delete process.env.JWT_SECRET;
        } else {
            process.env.JWT_SECRET = originalSecret;
        }
    });

    it('issues and verifies a session token with an explicit issuer, audience, and purpose', () => {
        const token = signSessionToken('user-1', 'consumer');
        const decoded = jwt.decode(token) as JwtPayload;

        expect(decoded.iss).toBe(JWT_ISSUER);
        expect(decoded.aud).toBe(SESSION_JWT_AUDIENCE);
        expect(decoded.type).toBe(SESSION_JWT_TYPE);
        expect(decoded.exp).toEqual(expect.any(Number));
        expect(verifySessionToken(token)).toMatchObject({
            userId: 'user-1',
            role: 'consumer',
            type: SESSION_JWT_TYPE
        });
    });

    it('rejects a session-shaped token without an expiry claim', () => {
        const noExpiry = jwt.sign(
            { userId: 'user-1', role: 'consumer', type: SESSION_JWT_TYPE },
            process.env.JWT_SECRET as string,
            {
                algorithm: 'HS256',
                issuer: JWT_ISSUER,
                audience: SESSION_JWT_AUDIENCE,
                noTimestamp: true
            }
        );

        expect(() => verifySessionToken(noExpiry)).toThrow('Invalid session token purpose or claims');
    });

    it('issues magic-link tokens under a distinct audience and purpose', () => {
        const token = signMagicLinkToken('user-1', 'person@example.test', 'one-time-nonce', 15);
        const decoded = jwt.decode(token) as JwtPayload;

        expect(decoded.iss).toBe(JWT_ISSUER);
        expect(decoded.aud).toBe(MAGIC_LINK_JWT_AUDIENCE);
        expect(decoded.type).toBe(MAGIC_LINK_JWT_TYPE);
        expect(verifyMagicLinkToken(token)).toMatchObject({
            userId: 'user-1',
            email: 'person@example.test',
            jti: 'one-time-nonce',
            type: MAGIC_LINK_JWT_TYPE
        });
    });

    it('rejects a magic-link token as an ordinary session credential', () => {
        const magicToken = signMagicLinkToken(
            'user-1',
            'person@example.test',
            'one-time-nonce',
            15
        );

        expect(() => verifySessionToken(magicToken)).toThrow();
    });

    it('rejects a session token at the magic-link exchange boundary', () => {
        const sessionToken = signSessionToken('user-1', 'consumer');

        expect(() => verifyMagicLinkToken(sessionToken)).toThrow();
    });

    it('rejects otherwise valid signatures with an untrusted issuer or audience', () => {
        const wrongIssuer = jwt.sign(
            { userId: 'user-1', role: 'consumer', type: SESSION_JWT_TYPE },
            process.env.JWT_SECRET as string,
            { algorithm: 'HS256', issuer: 'other-server', audience: SESSION_JWT_AUDIENCE }
        );
        const wrongAudience = jwt.sign(
            { userId: 'user-1', role: 'consumer', type: SESSION_JWT_TYPE },
            process.env.JWT_SECRET as string,
            { algorithm: 'HS256', issuer: JWT_ISSUER, audience: 'other-api' }
        );

        expect(() => verifySessionToken(wrongIssuer)).toThrow();
        expect(() => verifySessionToken(wrongAudience)).toThrow();
    });

    it.each([
        ['', /Missing required environment variable JWT_SECRET/],
        ['   ', /Missing required environment variable JWT_SECRET/],
        ['short', new RegExp(`JWT_SECRET must be at least ${MIN_JWT_SECRET_LENGTH} characters`)],
        ['x'.repeat(MIN_JWT_SECRET_LENGTH - 1), new RegExp(`at least ${MIN_JWT_SECRET_LENGTH} characters`)]
    ])('refuses to sign or verify with JWT_SECRET %j', (secret, expectedError) => {
        const longSecretToken = signSessionToken('user-1', 'consumer');
        process.env.JWT_SECRET = secret;
        try {
            expect(() => signSessionToken('user-1', 'consumer')).toThrow(expectedError);
            expect(() => verifySessionToken(longSecretToken)).toThrow(expectedError);
            expect(() => assertJwtSecretConfigured()).toThrow(expectedError);
        } finally {
            process.env.JWT_SECRET = 'unit-test-secret-with-enough-entropy-0123456789';
        }
    });

    it('accepts a secret of exactly the minimum length', () => {
        process.env.JWT_SECRET = 'y'.repeat(MIN_JWT_SECRET_LENGTH);
        try {
            expect(verifySessionToken(signSessionToken('user-1', 'consumer'))).toMatchObject({
                userId: 'user-1'
            });
        } finally {
            process.env.JWT_SECRET = 'unit-test-secret-with-enough-entropy-0123456789';
        }
    });
});
