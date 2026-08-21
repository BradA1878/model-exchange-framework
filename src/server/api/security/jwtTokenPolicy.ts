import jwt, { JwtPayload } from 'jsonwebtoken';
import { requireEnv } from '@mxf-dev/core/utils/env';

export const JWT_ISSUER = 'mxf-server';
export const SESSION_JWT_AUDIENCE = 'mxf-api';
export const MAGIC_LINK_JWT_AUDIENCE = 'mxf-magic-link';
export const SESSION_JWT_TYPE = 'user';
export const MAGIC_LINK_JWT_TYPE = 'magic_link';

const JWT_ALGORITHM = 'HS256' as const;
const SESSION_EXPIRY_SECONDS = 24 * 60 * 60;

export interface SessionJwtClaims extends JwtPayload {
    userId: string;
    type: typeof SESSION_JWT_TYPE;
    role: string;
    exp: number;
}

export interface MagicLinkJwtClaims extends JwtPayload {
    userId: string;
    email: string;
    jti: string;
    type: typeof MAGIC_LINK_JWT_TYPE;
}

/**
 * Shortest JWT_SECRET the server accepts. HS256 keys need at least 256 bits of
 * material; `mxf install` generates 64 hex characters and the README suggests
 * `openssl rand -base64 64`.
 */
export const MIN_JWT_SECRET_LENGTH = 32;

const getJwtSecret = (): string => {
    const secret = requireEnv(
        'JWT_SECRET',
        'Set a strong secret in .env — it signs and verifies all user JWTs.'
    );
    if (secret.trim().length < MIN_JWT_SECRET_LENGTH) {
        throw new Error(
            `JWT_SECRET must be at least ${MIN_JWT_SECRET_LENGTH} characters; ` +
            'generate one with `openssl rand -base64 64`.'
        );
    }
    return secret;
};

/** Fail at startup, before any service initializes, when JWT_SECRET is missing or too short. */
export const assertJwtSecretConfigured = (): void => {
    getJwtSecret();
};

const requireObjectPayload = (decoded: string | JwtPayload): JwtPayload => {
    if (typeof decoded === 'string') {
        throw new jwt.JsonWebTokenError('JWT payload must be an object');
    }
    return decoded;
};

export const signSessionToken = (userId: string, role: string): string => {
    return jwt.sign(
        { userId, type: SESSION_JWT_TYPE, role },
        getJwtSecret(),
        {
            algorithm: JWT_ALGORITHM,
            issuer: JWT_ISSUER,
            audience: SESSION_JWT_AUDIENCE,
            expiresIn: SESSION_EXPIRY_SECONDS
        }
    );
};

export const signMagicLinkToken = (
    userId: string,
    email: string,
    nonce: string,
    expiresInMinutes: number
): string => {
    return jwt.sign(
        { userId, email, type: MAGIC_LINK_JWT_TYPE },
        getJwtSecret(),
        {
            algorithm: JWT_ALGORITHM,
            issuer: JWT_ISSUER,
            audience: MAGIC_LINK_JWT_AUDIENCE,
            jwtid: nonce,
            expiresIn: expiresInMinutes * 60
        }
    );
};

export const verifySessionToken = (token: string): SessionJwtClaims => {
    const decoded = requireObjectPayload(jwt.verify(token, getJwtSecret(), {
        algorithms: [JWT_ALGORITHM],
        issuer: JWT_ISSUER,
        audience: SESSION_JWT_AUDIENCE
    }));

    if (decoded.type !== SESSION_JWT_TYPE ||
        typeof decoded.userId !== 'string' ||
        typeof decoded.role !== 'string' ||
        typeof decoded.exp !== 'number' ||
        !Number.isSafeInteger(decoded.exp) ||
        decoded.exp <= 0) {
        throw new jwt.JsonWebTokenError('Invalid session token purpose or claims');
    }

    return decoded as SessionJwtClaims;
};

export const verifyMagicLinkToken = (token: string): MagicLinkJwtClaims => {
    const decoded = requireObjectPayload(jwt.verify(token, getJwtSecret(), {
        algorithms: [JWT_ALGORITHM],
        issuer: JWT_ISSUER,
        audience: MAGIC_LINK_JWT_AUDIENCE
    }));

    if (decoded.type !== MAGIC_LINK_JWT_TYPE ||
        typeof decoded.userId !== 'string' ||
        typeof decoded.email !== 'string' ||
        typeof decoded.jti !== 'string' || decoded.jti.length === 0) {
        throw new jwt.JsonWebTokenError('Invalid magic-link token purpose or claims');
    }

    return decoded as MagicLinkJwtClaims;
};
