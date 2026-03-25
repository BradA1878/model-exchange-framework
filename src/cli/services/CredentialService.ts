/**
 * MXF CLI Credential Service
 *
 * Generates all cryptographic credentials required by MXF infrastructure:
 * domain keys, JWT secrets, API keys, encryption keys, and service passwords.
 *
 * Consolidates key generation logic previously scattered across:
 * - src/server/cli/server-cli.ts (domain key generation)
 * - src/server/cli/generate-mxp-key.ts (MXP encryption key)
 *
 * @author Brad Anderson <BradA1878@pm.me>
 */

import * as crypto from 'crypto';

export class CredentialService {
    private static instance: CredentialService;

    static getInstance(): CredentialService {
        if (!CredentialService.instance) {
            CredentialService.instance = new CredentialService();
        }
        return CredentialService.instance;
    }

    /**
     * Generate a 64-character hex domain key for SDK authentication.
     * Same pattern as server-cli.ts generateDomainKey().
     */
    generateDomainKey(): string {
        return crypto.randomBytes(32).toString('hex');
    }

    /**
     * Generate a JWT signing secret (128-char hex).
     * Used by the server for user authentication tokens.
     */
    generateJwtSecret(): string {
        return crypto.randomBytes(64).toString('hex');
    }

    /**
     * Generate an agent API key (64-char hex).
     * Used for agent-level authentication.
     */
    generateAgentApiKey(): string {
        return crypto.randomBytes(32).toString('hex');
    }

    /**
     * Generate an MXP encryption key (base64url).
     * Used for channel message encryption.
     */
    generateMxpEncryptionKey(): string {
        return crypto.randomBytes(32).toString('base64url');
    }

    /**
     * Generate a secure password (base64url encoded).
     * Used for MongoDB, Redis, and other service authentication.
     */
    generatePassword(length: number = 24): string {
        return crypto.randomBytes(length).toString('base64url');
    }

    /**
     * Generate a Meilisearch master key (base64url encoded).
     * Used for Meilisearch API authentication.
     */
    generateMeilisearchKey(): string {
        return crypto.randomBytes(32).toString('base64url');
    }

    /**
     * Generate all credentials needed for a fresh MXF installation.
     * Returns an object matching the MxfCredentialsConfig shape
     * plus service passwords.
     */
    generateAll(): {
        domainKey: string;
        jwtSecret: string;
        agentApiKey: string;
        mxpEncryptionKey: string;
        mongoPassword: string;
        meilisearchKey: string;
        redisPassword: string;
    } {
        return {
            domainKey: this.generateDomainKey(),
            jwtSecret: this.generateJwtSecret(),
            agentApiKey: this.generateAgentApiKey(),
            mxpEncryptionKey: this.generateMxpEncryptionKey(),
            mongoPassword: this.generatePassword(24),
            meilisearchKey: this.generateMeilisearchKey(),
            redisPassword: this.generatePassword(24),
        };
    }
}
