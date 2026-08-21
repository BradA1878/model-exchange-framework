import type { HTTPRequest, Page } from 'puppeteer';

import {
    guardBrowserRequest,
    installBrowserTargetGuard,
    requireAllowedBrowserTarget
} from '@mxf-dev/core/protocols/mcp/security/BrowserTargetGuard';
import { getSecureBrowserLaunchArgs } from '@mxf-dev/core/services/BrowserManager';

const makeRequest = (url: string, handled = false): {
    request: HTTPRequest;
    continueRequest: jest.Mock;
    abortRequest: jest.Mock;
} => {
    const continueRequest = jest.fn().mockResolvedValue(undefined);
    const abortRequest = jest.fn().mockResolvedValue(undefined);
    const request = {
        url: jest.fn(() => url),
        isInterceptResolutionHandled: jest.fn(() => handled),
        continue: continueRequest,
        abort: abortRequest
    } as unknown as HTTPRequest;
    return { request, continueRequest, abortRequest };
};

describe('BrowserTargetGuard', () => {
    it('does not disable Chromium process sandboxing', () => {
        expect(getSecureBrowserLaunchArgs()).not.toEqual(expect.arrayContaining([
            '--no-sandbox',
            '--disable-setuid-sandbox'
        ]));
    });

    it('rejects private top-level targets before navigation', async () => {
        await expect(requireAllowedBrowserTarget('http://127.0.0.1:3001/secrets'))
            .rejects.toThrow(/loopback/);
    });

    it.each([
        'http://[::ffff:7f00:1]:3001/secrets',
        'http://[0:0:0:0:0:ffff:7f00:1]:3001/secrets',
        'http://[::ffff:a9fe:a9fe]/latest/meta-data'
    ])('rejects hexadecimal IPv4-mapped IPv6 target %s', async (url) => {
        await expect(requireAllowedBrowserTarget(url)).rejects.toThrow(
            /loopback|link-local|metadata/
        );
    });

    it('aborts private subresources and redirects', async () => {
        const { request, continueRequest, abortRequest } = makeRequest(
            'http://169.254.169.254/latest/meta-data'
        );

        await guardBrowserRequest(request);

        expect(abortRequest).toHaveBeenCalledWith('blockedbyclient');
        expect(continueRequest).not.toHaveBeenCalled();
    });

    it('continues public and browser-local resources', async () => {
        const publicRequest = makeRequest('https://93.184.216.34/page');
        const dataRequest = makeRequest('data:text/plain,safe');

        await guardBrowserRequest(publicRequest.request);
        await guardBrowserRequest(dataRequest.request);

        expect(publicRequest.continueRequest).toHaveBeenCalledTimes(1);
        expect(dataRequest.continueRequest).toHaveBeenCalledTimes(1);
        expect(publicRequest.abortRequest).not.toHaveBeenCalled();
        expect(dataRequest.abortRequest).not.toHaveBeenCalled();
    });

    it('does not race another interception handler', async () => {
        const handledRequest = makeRequest('http://127.0.0.1/private', true);
        await guardBrowserRequest(handledRequest.request);
        expect(handledRequest.continueRequest).not.toHaveBeenCalled();
        expect(handledRequest.abortRequest).not.toHaveBeenCalled();
    });

    it('enables interception before registering the request guard', async () => {
        const setRequestInterception = jest.fn().mockResolvedValue(undefined);
        const on = jest.fn();
        const page = { setRequestInterception, on } as unknown as Page;

        await installBrowserTargetGuard(page);

        expect(setRequestInterception).toHaveBeenCalledWith(true);
        expect(on).toHaveBeenCalledWith('request', expect.any(Function));
        expect(setRequestInterception.mock.invocationCallOrder[0])
            .toBeLessThan(on.mock.invocationCallOrder[0]);
    });
});
