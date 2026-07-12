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
 * HttpTargetGuard.ts
 *
 * Decides whether an agent-supplied URL may be fetched from the server.
 *
 * The server sits inside the trust boundary: it can reach the MXF API on
 * localhost:3001, Meilisearch, MongoDB, and — on a cloud host — the instance
 * metadata endpoint at 169.254.169.254 that hands out IAM credentials. A tool
 * that fetches an arbitrary URL on the model's behalf turns the server into a
 * proxy across that boundary (server-side request forgery).
 *
 * This guard resolves the hostname and checks every address it resolves to, so a
 * public name that points at 127.0.0.1 is caught as well as a literal IP.
 *
 * The guard fails closed: a target that cannot be resolved or cannot be parsed
 * is refused, with an error saying why. It never silently skips the check.
 */

import { promises as dns } from 'dns';
import { isIP } from 'net';

import { allowPrivateHttpHosts } from './McpToolPolicy.js';

/**
 * Result of checking a URL.
 */
export interface HttpTargetCheck {
    /** Whether the fetch may proceed */
    allowed: boolean;
    /** Why it was refused — written for the model, so it can correct course */
    reason?: string;
    /** The addresses the hostname resolved to */
    resolvedAddresses?: string[];
}

/**
 * IPv4 ranges the server must not be steered into.
 * Each entry is [first octet-based CIDR, human name].
 */
const BLOCKED_IPV4_RANGES: Array<{ cidr: string; name: string }> = [
    { cidr: '0.0.0.0/8', name: '"this network"' },
    { cidr: '10.0.0.0/8', name: 'RFC1918 private network' },
    { cidr: '100.64.0.0/10', name: 'carrier-grade NAT' },
    { cidr: '127.0.0.0/8', name: 'loopback' },
    { cidr: '169.254.0.0/16', name: 'link-local / cloud instance metadata' },
    { cidr: '172.16.0.0/12', name: 'RFC1918 private network' },
    { cidr: '192.0.0.0/24', name: 'IETF protocol assignments' },
    { cidr: '192.168.0.0/16', name: 'RFC1918 private network' },
    { cidr: '198.18.0.0/15', name: 'benchmark network' },
    { cidr: '224.0.0.0/4', name: 'multicast' },
    { cidr: '240.0.0.0/4', name: 'reserved' }
];

/** Convert a dotted-quad IPv4 string to a 32-bit unsigned integer. */
function ipv4ToInt(address: string): number | null {
    const octets = address.split('.');
    if (octets.length !== 4) {
        return null;
    }

    let value = 0;
    for (const octet of octets) {
        // Reject empty, non-numeric, or out-of-range octets rather than coercing.
        if (!/^\d{1,3}$/.test(octet)) {
            return null;
        }
        const num = Number(octet);
        if (num > 255) {
            return null;
        }
        value = (value << 8) | num;
    }

    // `>>> 0` forces the result back to unsigned — the shifts above produce a
    // signed 32-bit int for addresses above 127.255.255.255.
    return value >>> 0;
}

/** Is an IPv4 address inside the given CIDR block? */
function ipv4InCidr(address: string, cidr: string): boolean {
    const [network, prefixText] = cidr.split('/');
    const prefix = Number(prefixText);

    const addressInt = ipv4ToInt(address);
    const networkInt = ipv4ToInt(network);

    if (addressInt === null || networkInt === null) {
        return false;
    }

    // A /0 mask would shift by 32, which is a no-op in JS — handle it explicitly.
    if (prefix === 0) {
        return true;
    }

    const mask = (0xffffffff << (32 - prefix)) >>> 0;
    return (addressInt & mask) === (networkInt & mask);
}

/**
 * Is this address one the server must not be steered into?
 *
 * @returns the name of the matched range, or null when the address is fine
 */
function matchBlockedRange(address: string): string | null {
    const version = isIP(address);

    if (version === 4) {
        for (const range of BLOCKED_IPV4_RANGES) {
            if (ipv4InCidr(address, range.cidr)) {
                return range.name;
            }
        }
        return null;
    }

    if (version === 6) {
        const normalized = address.toLowerCase();

        // IPv6 loopback
        if (normalized === '::1' || normalized === '0:0:0:0:0:0:0:1') {
            return 'IPv6 loopback';
        }
        // Unspecified address
        if (normalized === '::' || normalized === '0:0:0:0:0:0:0:0') {
            return 'IPv6 unspecified address';
        }
        // Unique local addresses, fc00::/7
        if (/^f[cd][0-9a-f]{2}:/.test(normalized)) {
            return 'IPv6 unique local address';
        }
        // Link-local, fe80::/10
        if (/^fe[89ab][0-9a-f]:/.test(normalized)) {
            return 'IPv6 link-local address';
        }
        // IPv4-mapped (::ffff:127.0.0.1) — re-check the embedded IPv4 address,
        // otherwise ::ffff:169.254.169.254 would walk straight past this guard.
        const mapped = normalized.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
        if (mapped) {
            return matchBlockedRange(mapped[1]);
        }
        return null;
    }

    return null;
}

/**
 * Check whether an agent-supplied URL may be fetched.
 *
 * @param rawUrl - The URL the tool was asked to fetch
 * @returns Whether the fetch may proceed, and why not when it may not
 */
export async function checkHttpTarget(rawUrl: string): Promise<HttpTargetCheck> {
    let url: URL;
    try {
        url = new URL(rawUrl);
    } catch {
        return {
            allowed: false,
            reason: `"${rawUrl}" is not a valid URL.`
        };
    }

    // Only HTTP(S). file:, gopher:, ftp: and friends reach places an HTTP client
    // has no business reaching.
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        return {
            allowed: false,
            reason: `Protocol "${url.protocol}" is not allowed. Use http: or https:.`
        };
    }

    // The operator can open this up for local development. Off by default.
    if (allowPrivateHttpHosts()) {
        return { allowed: true };
    }

    const hostname = url.hostname.replace(/^\[|\]$/g, ''); // strip IPv6 brackets

    // A literal IP needs no DNS round trip.
    if (isIP(hostname) !== 0) {
        const blocked = matchBlockedRange(hostname);
        if (blocked) {
            return {
                allowed: false,
                reason:
                    `Refusing to fetch ${hostname}: it is a ${blocked} address. ` +
                    `This tool may only reach public internet hosts. ` +
                    `Set MXF_HTTP_ALLOW_PRIVATE_HOSTS=true to permit private addresses.`,
                resolvedAddresses: [hostname]
            };
        }
        return { allowed: true, resolvedAddresses: [hostname] };
    }

    // "localhost" and anything under .localhost resolve to loopback by definition.
    const lowerHost = hostname.toLowerCase();
    if (lowerHost === 'localhost' || lowerHost.endsWith('.localhost')) {
        return {
            allowed: false,
            reason:
                `Refusing to fetch ${hostname}: it is a loopback address. ` +
                `This tool may only reach public internet hosts. ` +
                `Set MXF_HTTP_ALLOW_PRIVATE_HOSTS=true to permit private addresses.`
        };
    }

    // Resolve the name and check every address behind it. A public hostname can
    // legitimately resolve to 127.0.0.1, and a malicious one will.
    let addresses: string[];
    try {
        const records = await dns.lookup(hostname, { all: true, verbatim: true });
        addresses = records.map(record => record.address);
    } catch (error) {
        // Fail closed. An unresolvable host is not a host we quietly try anyway.
        return {
            allowed: false,
            reason:
                `Could not resolve "${hostname}": ` +
                `${error instanceof Error ? error.message : String(error)}`
        };
    }

    if (addresses.length === 0) {
        return {
            allowed: false,
            reason: `"${hostname}" did not resolve to any address.`
        };
    }

    for (const address of addresses) {
        const blocked = matchBlockedRange(address);
        if (blocked) {
            return {
                allowed: false,
                reason:
                    `Refusing to fetch ${hostname}: it resolves to ${address}, ` +
                    `a ${blocked} address. This tool may only reach public internet hosts. ` +
                    `Set MXF_HTTP_ALLOW_PRIVATE_HOSTS=true to permit private addresses.`,
                resolvedAddresses: addresses
            };
        }
    }

    return { allowed: true, resolvedAddresses: addresses };
}
