import { Socket } from 'socket.io';
import { BoundedFixedWindowRateLimiter } from '../../security/BoundedFixedWindowRateLimiter';
import { getSocketPasswordRateLimitConfig } from '../../config/IngressSecurityConfig';

let passwordLimiter: BoundedFixedWindowRateLimiter | undefined;

const getLimiter = (): BoundedFixedWindowRateLimiter => {
    if (!passwordLimiter) {
        const config = getSocketPasswordRateLimitConfig();
        passwordLimiter = new BoundedFixedWindowRateLimiter(
            config.maximum,
            config.windowMs,
            config.maximumKeys
        );
    }
    return passwordLimiter;
};

const normalizeSourceIp = (socket: Socket): string => {
    const handshakeAddress = socket.handshake?.address;
    const connectionAddress = socket.conn?.remoteAddress;
    const value = typeof handshakeAddress === 'string' && handshakeAddress.trim().length > 0
        ? handshakeAddress
        : typeof connectionAddress === 'string' && connectionAddress.trim().length > 0
            ? connectionAddress
            : 'unknown';
    return value.trim().toLowerCase().replace(/^::ffff:/, '');
};

/**
 * Charge independent source-IP and account-identifier buckets atomically. This
 * blocks both one-IP/many-account and many-IP/one-account brute-force patterns.
 */
export const consumeSocketPasswordAttempt = (
    socket: Socket,
    identifier: string
): boolean => {
    const normalizedIdentifier = identifier.trim().toLowerCase();
    if (normalizedIdentifier.length === 0) {
        return false;
    }
    const decision = getLimiter().consumeMany([
        `ip\0${normalizeSourceIp(socket)}`,
        `identifier\0${normalizedIdentifier}`
    ]);
    return decision.allowed;
};

export const resetSocketPasswordRateLimiterForTests = (): void => {
    passwordLimiter?.reset();
    passwordLimiter = undefined;
};
