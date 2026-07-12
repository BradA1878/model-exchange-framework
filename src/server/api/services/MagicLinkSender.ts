/**
 * Copyright 2024 Brad Anderson
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * @author Brad Anderson <BradA1878@pm.me>
 * @repository https://github.com/BradA1878/model-exchange-framework
 * @documentation https://mxf-dev.github.io/mxf/
 */

/**
 * Magic Link Sender
 *
 * Delivers magic-link sign-in URLs out of band. The magic-link token is a
 * bearer credential: whoever holds it can exchange it for a 24h session at
 * POST /api/users/magic-link/verify. It must therefore reach the address
 * being authenticated and nothing else — it is never returned in the HTTP
 * response to the requester.
 *
 * Two transports:
 * - `webhook` — POSTs the link to MAGIC_LINK_WEBHOOK_URL (a mail relay, an n8n
 *   workflow, or any HTTP endpoint that turns the payload into an email).
 *   Selected whenever MAGIC_LINK_WEBHOOK_URL is set.
 * - `log` — writes the link through the framework Logger. Development and test
 *   only; constructing it under NODE_ENV=production throws.
 *
 * In production with no webhook configured, getMagicLinkSender() throws. There
 * is no silent no-op: a magic link that is neither delivered nor returned would
 * leave the caller with no way to sign in and no error explaining why.
 *
 * Environment variables:
 * - MAGIC_LINK_BASE_URL     Page that reads the `token` query parameter and
 *                           calls /api/users/magic-link/verify.
 *                           Required in production.
 * - MAGIC_LINK_WEBHOOK_URL  HTTP endpoint that delivers the link. Required in
 *                           production.
 * - MAGIC_LINK_WEBHOOK_TOKEN  Optional bearer token sent as Authorization on
 *                           the webhook request.
 */

import { Logger } from '@mxf-dev/core/utils/Logger';

const logger = new Logger('info', 'MagicLinkSender', 'server');

/** Base URL used for the sign-in link when MAGIC_LINK_BASE_URL is not set (non-production only). */
const DEFAULT_DEV_BASE_URL = 'http://localhost:8080/auth/magic-link';

/**
 * A single magic-link delivery.
 */
export interface MagicLinkDelivery {
    /** Address the link authenticates. */
    email: string;
    /** Fully-qualified sign-in URL containing the token. */
    magicLink: string;
    /** Raw magic-link JWT, also embedded in `magicLink`. */
    token: string;
    /** Token lifetime in minutes. */
    expiresInMinutes: number;
    /** True when this request created the account. */
    isNewUser: boolean;
}

/**
 * Transport that delivers a magic link to its recipient.
 */
export interface MagicLinkSender {
    /** Transport identifier, used in logs and health output. */
    readonly transport: 'webhook' | 'log';

    /**
     * Deliver the link. Throws if delivery fails — the caller must surface the
     * failure rather than report success for a link that never went out.
     *
     * @param delivery - Link, recipient, and expiry
     */
    send(delivery: MagicLinkDelivery): Promise<void>;
}

/**
 * Writes the magic link to the server log instead of sending mail.
 *
 * Development and test only. The link is a bearer credential, so anyone with
 * log access can sign in as the requested user — which is exactly why this
 * transport refuses to run in production.
 */
export class LoggedMagicLinkSender implements MagicLinkSender {
    public readonly transport = 'log' as const;

    constructor() {
        if (process.env.NODE_ENV === 'production') {
            throw new Error(
                'LoggedMagicLinkSender cannot be used in production — it writes the sign-in token to the server log. ' +
                'Set MAGIC_LINK_WEBHOOK_URL to deliver magic links out of band.'
            );
        }
    }

    /**
     * Log the link so a developer can copy it out of the console.
     *
     * @param delivery - Link, recipient, and expiry
     */
    public async send(delivery: MagicLinkDelivery): Promise<void> {
        logger.info(
            `Magic link for ${delivery.email} (expires in ${delivery.expiresInMinutes}m, ` +
            `${delivery.isNewUser ? 'new account' : 'existing account'}): ${delivery.magicLink}`
        );
    }
}

/**
 * POSTs the magic link to an HTTP endpoint that turns it into an email.
 *
 * Request body:
 * `{ email, magicLink, token, expiresInMinutes, isNewUser }`
 *
 * Any non-2xx response throws, so a delivery failure surfaces as a 500 on
 * POST /api/users/magic-link rather than a false success.
 */
export class WebhookMagicLinkSender implements MagicLinkSender {
    public readonly transport = 'webhook' as const;

    private readonly webhookUrl: string;
    private readonly webhookToken?: string;

    /**
     * @param webhookUrl - Endpoint that delivers the link
     * @param webhookToken - Optional bearer token for the endpoint
     */
    constructor(webhookUrl: string, webhookToken?: string) {
        if (!webhookUrl || !webhookUrl.trim()) {
            throw new Error('WebhookMagicLinkSender requires a non-empty webhook URL');
        }
        this.webhookUrl = webhookUrl.trim();
        this.webhookToken = webhookToken?.trim() || undefined;
    }

    /**
     * Deliver the link through the configured webhook.
     *
     * @param delivery - Link, recipient, and expiry
     */
    public async send(delivery: MagicLinkDelivery): Promise<void> {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (this.webhookToken) {
            headers['Authorization'] = `Bearer ${this.webhookToken}`;
        }

        const response = await fetch(this.webhookUrl, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                email: delivery.email,
                magicLink: delivery.magicLink,
                token: delivery.token,
                expiresInMinutes: delivery.expiresInMinutes,
                isNewUser: delivery.isNewUser
            })
        });

        if (!response.ok) {
            const body = await response.text().catch(() => '');
            throw new Error(
                `Magic link webhook returned ${response.status}: ${body.slice(0, 200)}`
            );
        }

        logger.info(`Magic link delivered to ${delivery.email} via webhook`);
    }
}

/**
 * Build the sign-in URL the recipient clicks.
 *
 * The token travels as a `token` query parameter; the page at the base URL
 * reads it and calls POST /api/users/magic-link/verify to exchange it for a
 * session.
 *
 * @param token - Magic-link JWT
 * @returns Fully-qualified sign-in URL
 * @throws If MAGIC_LINK_BASE_URL is unset in production
 */
export const buildMagicLinkUrl = (token: string): string => {
    const configured = process.env.MAGIC_LINK_BASE_URL?.trim();

    if (!configured) {
        if (process.env.NODE_ENV === 'production') {
            throw new Error(
                'MAGIC_LINK_BASE_URL is not set. Set it to the page that exchanges the magic-link ' +
                'token for a session (it must read the `token` query parameter).'
            );
        }
        return `${DEFAULT_DEV_BASE_URL}?token=${encodeURIComponent(token)}`;
    }

    const separator = configured.includes('?') ? '&' : '?';
    return `${configured}${separator}token=${encodeURIComponent(token)}`;
};

/** Cached sender — the transport choice is fixed by environment at first use. */
let cachedSender: MagicLinkSender | null = null;

/**
 * Resolve the magic-link transport for this process.
 *
 * Selection order:
 * 1. MAGIC_LINK_WEBHOOK_URL set → webhook transport.
 * 2. Production with no webhook → throw. A magic link that is neither delivered
 *    nor returned is a dead end, so the server says so instead of pretending.
 * 3. Otherwise → log transport (development and test).
 *
 * @returns The configured sender
 * @throws In production when no transport is configured
 */
export const getMagicLinkSender = (): MagicLinkSender => {
    if (cachedSender) {
        return cachedSender;
    }

    const webhookUrl = process.env.MAGIC_LINK_WEBHOOK_URL?.trim();

    if (webhookUrl) {
        cachedSender = new WebhookMagicLinkSender(webhookUrl, process.env.MAGIC_LINK_WEBHOOK_TOKEN);
        return cachedSender;
    }

    if (process.env.NODE_ENV === 'production') {
        throw new Error(
            'No magic link transport configured. Set MAGIC_LINK_WEBHOOK_URL to an endpoint that ' +
            'emails the sign-in link. Magic-link tokens are never returned in the HTTP response.'
        );
    }

    cachedSender = new LoggedMagicLinkSender();
    return cachedSender;
};

/**
 * Drop the cached sender so the next call re-reads the environment.
 * Used by tests that change MAGIC_LINK_* variables between cases.
 */
export const resetMagicLinkSender = (): void => {
    cachedSender = null;
};

/**
 * Install a sender explicitly, bypassing environment selection.
 * Used by tests to capture deliveries without an HTTP endpoint.
 *
 * @param sender - Sender to use for subsequent deliveries
 */
export const setMagicLinkSender = (sender: MagicLinkSender): void => {
    cachedSender = sender;
};
