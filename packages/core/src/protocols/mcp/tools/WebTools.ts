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
 * WebTools.ts
 *
 * Web search, navigation, content extraction, screenshots, and HTTP fetches.
 *
 * Every tool here is declared with defineTool, so a failure arrives as one
 * envelope with `isError: true` rather than as a string starting with "Error:"
 * that a caller has to parse.
 *
 * api_fetch runs from inside the server's trust boundary, so its target URL is
 * checked by HttpTargetGuard before the request goes out — see that module for
 * why an unrestricted fetch is a server-side request forgery hole.
 */

import { WEB_TOOLS, TOOL_CATEGORIES } from '../../../constants/ToolNames.js';
import { WebSearchService } from '../../../services/WebSearchService.js';
import { defineTool } from '../defineTool.js';
import { ToolError } from '../ToolError.js';
import { checkHttpTarget } from '../security/HttpTargetGuard.js';

// WebSearchService owns the browser and content-processing plumbing these tools
// need; they do not touch BrowserManager or ContentProcessor directly.
const webSearchService = new WebSearchService();

/**
 * Search the web and optionally pull the content of each result.
 */
export const webSearchTool = defineTool<{
    query: string;
    maxResults?: number;
    searchEngine?: string;
    extractContent?: boolean;
    format?: string;
}, unknown>({
    name: WEB_TOOLS.WEB_SEARCH,
    category: TOOL_CATEGORIES.WEB,
    description: 'Search the web and return results, optionally with the full text of each page.',
    inputSchema: {
        type: 'object',
        properties: {
            query: {
                type: 'string',
                description: 'The search query'
            },
            maxResults: {
                type: 'number',
                description: 'Maximum number of results to return',
                default: 10,
                minimum: 1,
                maximum: 50
            },
            searchEngine: {
                type: 'string',
                description: 'Search engine to use',
                enum: ['google', 'bing', 'duckduckgo'],
                default: 'google'
            },
            extractContent: {
                type: 'boolean',
                description: 'Whether to extract full content from search results',
                default: true
            },
            format: {
                type: 'string',
                description: 'Output format',
                enum: ['structured', 'markdown', 'plaintext'],
                default: 'structured'
            }
        },
        required: ['query']
    },
    run: async (input) => {
        return webSearchService.search({
            query: input.query,
            maxResults: input.maxResults ?? 10,
            searchEngine: input.searchEngine ?? 'google',
            extractContent: input.extractContent ?? true,
            format: input.format ?? 'structured'
        });
    }
});

/**
 * Load a URL in a browser and extract its content.
 */
export const webNavigationTool = defineTool<{
    url: string;
    waitStrategy?: string;
    includeScreenshot?: boolean;
    screenshotFormat?: string;
    extractContent?: boolean;
    format?: string;
}, unknown>({
    name: WEB_TOOLS.WEB_NAVIGATE,
    category: TOOL_CATEGORIES.WEB,
    description: 'Load a URL in a headless browser and extract its content, optionally with a screenshot.',
    inputSchema: {
        type: 'object',
        properties: {
            url: {
                type: 'string',
                description: 'The URL to navigate to',
                format: 'uri'
            },
            waitStrategy: {
                type: 'string',
                description: 'Page load wait strategy',
                enum: ['load', 'domcontentloaded', 'networkidle0', 'networkidle2'],
                default: 'networkidle2'
            },
            includeScreenshot: {
                type: 'boolean',
                description: 'Whether to include a screenshot',
                default: false
            },
            screenshotFormat: {
                type: 'string',
                description: 'Screenshot format',
                enum: ['png', 'jpeg'],
                default: 'png'
            },
            extractContent: {
                type: 'boolean',
                description: 'Whether to extract and process page content',
                default: true
            },
            format: {
                type: 'string',
                description: 'Output format',
                enum: ['structured', 'markdown', 'plaintext'],
                default: 'structured'
            }
        },
        required: ['url']
    },
    run: async (input) => {
        return webSearchService.navigate({
            url: input.url,
            waitStrategy: input.waitStrategy ?? 'networkidle2',
            includeScreenshot: input.includeScreenshot ?? false,
            screenshotFormat: input.screenshotFormat ?? 'png',
            extractContent: input.extractContent ?? true,
            format: input.format ?? 'structured'
        });
    }
});

/**
 * Extract content from several URLs at once.
 */
export const webContentExtractionTool = defineTool<{
    urls: string[];
    concurrency?: number;
    format?: string;
}, unknown>({
    name: WEB_TOOLS.WEB_BULK_EXTRACT,
    category: TOOL_CATEGORIES.WEB,
    description: 'Extract the content of several URLs in one call.',
    inputSchema: {
        type: 'object',
        properties: {
            urls: {
                type: 'array',
                description: 'Array of URLs to extract content from',
                items: {
                    type: 'string',
                    format: 'uri'
                },
                minItems: 1,
                maxItems: 10
            },
            concurrency: {
                type: 'number',
                description: 'Number of concurrent extractions',
                default: 3,
                minimum: 1,
                maximum: 5
            },
            format: {
                type: 'string',
                description: 'Output format',
                enum: ['structured', 'markdown', 'plaintext'],
                default: 'structured'
            }
        },
        required: ['urls']
    },
    run: async (input) => {
        return webSearchService.bulkExtract({
            urls: input.urls,
            concurrency: input.concurrency ?? 3,
            format: input.format ?? 'structured'
        });
    }
});

/**
 * Capture a screenshot of a page.
 */
export const webScreenshotTool = defineTool<{
    url: string;
    format?: string;
    fullPage?: boolean;
    width?: number;
    height?: number;
}, { url: string; format: string; byteLength: number }>({
    name: WEB_TOOLS.WEB_SCREENSHOT,
    category: TOOL_CATEGORIES.WEB,
    description: 'Capture a screenshot of a web page.',
    inputSchema: {
        type: 'object',
        properties: {
            url: {
                type: 'string',
                description: 'The URL to capture',
                format: 'uri'
            },
            format: {
                type: 'string',
                description: 'Screenshot format',
                enum: ['png', 'jpeg'],
                default: 'png'
            },
            fullPage: {
                type: 'boolean',
                description: 'Capture full page screenshot',
                default: false
            },
            width: {
                type: 'number',
                description: 'Viewport width',
                default: 1280,
                minimum: 100,
                maximum: 3840
            },
            height: {
                type: 'number',
                description: 'Viewport height',
                default: 720,
                minimum: 100,
                maximum: 2160
            }
        },
        required: ['url']
    },
    run: async (input) => {
        const format = input.format ?? 'png';
        const screenshot = await webSearchService.screenshot({
            url: input.url,
            format,
            fullPage: input.fullPage ?? false,
            width: input.width ?? 1280,
            height: input.height ?? 720
        });

        return {
            url: input.url,
            format,
            byteLength: screenshot.length
        };
    }
});

/**
 * Fetch a URL and return the response body.
 *
 * The target is checked before the request goes out: the server can reach the
 * MXF API on localhost, Meilisearch, MongoDB, and a cloud metadata endpoint, and
 * an unrestricted fetch would let an agent reach all of them through us.
 */
export const apiFetchTool = defineTool<{
    url: string;
    method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
    headers?: Record<string, string>;
    body?: unknown;
    timeout?: number;
}, {
    status: number;
    contentType: string;
    dataType: 'json' | 'text';
    url: string;
    data: unknown;
}>({
    name: WEB_TOOLS.API_FETCH,
    category: TOOL_CATEGORIES.WEB_REQUEST,
    description:
        'Fetch a public HTTP(S) endpoint and return the response body, parsed as JSON when the ' +
        'response says it is JSON. Use this for APIs; use web_navigate for HTML pages. ' +
        'Private and loopback addresses are refused.',
    inputSchema: {
        type: 'object',
        properties: {
            url: {
                type: 'string',
                description: 'API endpoint URL (http or https, public host)',
                format: 'uri'
            },
            method: {
                type: 'string',
                description: 'HTTP method',
                enum: ['GET', 'POST', 'PUT', 'DELETE'],
                default: 'GET'
            },
            headers: {
                type: 'object',
                description: 'HTTP headers (e.g., {"Authorization": "Bearer token"})',
                additionalProperties: { type: 'string' }
            },
            body: {
                type: 'object',
                description: 'Request body for POST/PUT (JSON)'
            },
            timeout: {
                type: 'number',
                description: 'Request timeout in milliseconds',
                default: 30000,
                minimum: 1,
                maximum: 120000
            }
        },
        required: ['url']
    },
    run: async (input) => {
        // Refuse targets inside the trust boundary before opening a socket.
        const targetCheck = await checkHttpTarget(input.url);
        if (!targetCheck.allowed) {
            throw ToolError.permissionDenied(
                targetCheck.reason ?? `Refusing to fetch ${input.url}`,
                { url: input.url }
            );
        }

        const method = input.method ?? 'GET';
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), input.timeout ?? 30000);

        try {
            const headers: Record<string, string> = {
                Accept: 'application/json',
                ...input.headers
            };

            const fetchOptions: RequestInit = {
                method,
                headers,
                signal: controller.signal,
                // A redirect can point back at a blocked host after the check above,
                // so follow none of them — the agent can fetch the new location
                // explicitly and have it checked in turn.
                redirect: 'manual'
            };

            if (input.body !== undefined && (method === 'POST' || method === 'PUT')) {
                fetchOptions.body = JSON.stringify(input.body);
                headers['Content-Type'] = 'application/json';
            }

            const response = await fetch(input.url, fetchOptions);

            if (response.status >= 300 && response.status < 400) {
                const location = response.headers.get('location');
                throw ToolError.upstream(
                    `${input.url} redirected to ${location ?? 'an unspecified location'}. ` +
                    `Redirects are not followed — call api_fetch again with that URL if you want it.`,
                    { details: { status: response.status, location, url: input.url } }
                );
            }

            const responseText = await response.text();
            const contentType = response.headers.get('content-type') ?? '';

            if (!response.ok) {
                throw ToolError.upstream(
                    `${method} ${input.url} returned ${response.status} ${response.statusText}`,
                    {
                        details: {
                            status: response.status,
                            statusText: response.statusText,
                            url: input.url,
                            body: responseText.slice(0, 500)
                        }
                    }
                );
            }

            // Parse as JSON only when the response claims to be JSON. A body that
            // says it is JSON but does not parse is an upstream error, not a
            // string to hand back as if nothing happened.
            let data: unknown = responseText;
            let dataType: 'json' | 'text' = 'text';

            if (contentType.includes('application/json') || contentType.includes('text/json')) {
                try {
                    data = JSON.parse(responseText);
                    dataType = 'json';
                } catch (parseError) {
                    throw ToolError.upstream(
                        `${input.url} declared Content-Type "${contentType}" but the body is not valid JSON: ` +
                        `${parseError instanceof Error ? parseError.message : String(parseError)}`,
                        { details: { url: input.url, contentType, bodyPreview: responseText.slice(0, 200) } }
                    );
                }
            }

            return {
                status: response.status,
                contentType,
                dataType,
                url: input.url,
                data
            };

        } catch (error) {
            // A ToolError from the branches above is already the right shape.
            if (error instanceof ToolError) {
                throw error;
            }
            if (error instanceof Error && error.name === 'AbortError') {
                throw ToolError.upstream(
                    `${method} ${input.url} timed out after ${input.timeout ?? 30000}ms`,
                    { details: { url: input.url } }
                );
            }
            throw ToolError.upstream(
                `${method} ${input.url} failed: ${error instanceof Error ? error.message : String(error)}`,
                { cause: error, details: { url: input.url } }
            );
        } finally {
            clearTimeout(timeoutId);
        }
    }
});

export const webTools = [
    webSearchTool,
    webNavigationTool,
    webContentExtractionTool,
    webScreenshotTool,
    apiFetchTool
];
