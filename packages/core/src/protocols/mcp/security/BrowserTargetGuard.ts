/**
 * Fail-closed network policy for Puppeteer pages used by MXF web tools.
 *
 * Checking only the top-level URL is insufficient: redirects, scripts, images,
 * frames, and fetch/XHR requests can each target a different host. Every browser
 * request is therefore checked immediately before Puppeteer continues it.
 */

import type { HTTPRequest, Page } from 'puppeteer';

import { checkHttpTarget } from './HttpTargetGuard.js';

const BROWSER_LOCAL_PROTOCOLS = new Set(['about:', 'blob:', 'data:']);

const isBrowserLocalUrl = (rawUrl: string): boolean => {
    try {
        return BROWSER_LOCAL_PROTOCOLS.has(new URL(rawUrl).protocol);
    } catch {
        return rawUrl === 'about:blank';
    }
};

/** Reject a top-level browser target before allocating a browser or page. */
export const requireAllowedBrowserTarget = async (rawUrl: string): Promise<void> => {
    const decision = await checkHttpTarget(rawUrl);
    if (!decision.allowed) {
        throw new Error(decision.reason ?? `Browser target '${rawUrl}' is not allowed`);
    }
};

export const guardBrowserRequest = async (request: HTTPRequest): Promise<void> => {
    if (request.isInterceptResolutionHandled()) {
        return;
    }

    const rawUrl = request.url();
    if (isBrowserLocalUrl(rawUrl)) {
        await request.continue();
        return;
    }

    const decision = await checkHttpTarget(rawUrl);
    if (request.isInterceptResolutionHandled()) {
        return;
    }
    if (!decision.allowed) {
        await request.abort('blockedbyclient');
        return;
    }

    await request.continue();
};

/** Install the target policy before the first navigation on a Puppeteer page. */
export const installBrowserTargetGuard = async (page: Page): Promise<void> => {
    await page.setRequestInterception(true);
    page.on('request', (request: HTTPRequest) => {
        void guardBrowserRequest(request).catch(async () => {
            if (!request.isInterceptResolutionHandled()) {
                await request.abort('blockedbyclient');
            }
        }).catch(() => undefined);
    });
};
