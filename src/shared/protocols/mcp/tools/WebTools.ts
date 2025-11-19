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
 * @documentation https://brada1878.github.io/model-exchange-framework/
 */

/**
 * WebTools.ts
 * 
 * Web search, navigation, and content extraction tools for MXF
 * Ported from external MCP-WWW server for better integration
 */

import { WEB_TOOLS } from '../../../constants/ToolNames';
import { WebSearchService } from '../../../services/WebSearchService';
import { BrowserManager } from '../../../services/BrowserManager';
import { ContentProcessor } from '../../../services/ContentProcessor';

// Initialize singleton services
const webSearchService = new WebSearchService();
const browserManager = new BrowserManager();
const contentProcessor = new ContentProcessor();

/**
 * Web Search Tool - Performs web searches with content extraction
 */
export const webSearchTool = {
    name: WEB_TOOLS.WEB_SEARCH,
    description: 'Perform web searches with optional content extraction and structured output',
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
    handler: async (input: {
        query: string;
        maxResults?: number;
        searchEngine?: string;
        extractContent?: boolean;
        format?: string;
    }, context: {
        requestId: string;
        agentId?: string;
        channelId?: string;
    }) => {
        try {
            const result = await webSearchService.search({
                query: input.query,
                maxResults: input.maxResults || 10,
                searchEngine: input.searchEngine || 'google',
                extractContent: input.extractContent ?? true,
                format: input.format || 'structured'
            });

            return {
                content: {
                    type: 'text',
                    text: JSON.stringify(result, null, 2)
                },
                metadata: {
                    toolName: WEB_TOOLS.WEB_SEARCH,
                    requestId: context.requestId,
                    timestamp: new Date().toISOString()
                }
            };
        } catch (error) {
            return {
                content: {
                    type: 'text',
                    text: `Error: ${error instanceof Error ? error.message : 'Web search failed'}`
                },
                metadata: {
                    toolName: WEB_TOOLS.WEB_SEARCH,
                    requestId: context.requestId,
                    timestamp: new Date().toISOString(),
                    error: true
                }
            };
        }
    },
    enabled: true
};

/**
 * Web Navigation Tool - Navigate to URLs and extract content
 */
export const webNavigationTool = {
    name: WEB_TOOLS.WEB_NAVIGATE,
    description: 'Navigate to a URL and extract content with optional screenshot capture',
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
    handler: async (input: {
        url: string;
        waitStrategy?: string;
        includeScreenshot?: boolean;
        screenshotFormat?: string;
        extractContent?: boolean;
        format?: string;
    }, context: {
        requestId: string;
        agentId?: string;
        channelId?: string;
    }) => {
        try {
            const result = await webSearchService.navigate({
                url: input.url,
                waitStrategy: input.waitStrategy || 'networkidle2',
                includeScreenshot: input.includeScreenshot || false,
                screenshotFormat: input.screenshotFormat || 'png',
                extractContent: input.extractContent ?? true,
                format: input.format || 'structured'
            });

            return {
                content: {
                    type: 'text',
                    text: JSON.stringify(result, null, 2)
                },
                metadata: {
                    toolName: WEB_TOOLS.WEB_NAVIGATE,
                    requestId: context.requestId,
                    timestamp: new Date().toISOString()
                }
            };
        } catch (error) {
            return {
                content: {
                    type: 'text',
                    text: `Error: ${error instanceof Error ? error.message : 'Web navigation failed'}`
                },
                metadata: {
                    toolName: WEB_TOOLS.WEB_NAVIGATE,
                    requestId: context.requestId,
                    timestamp: new Date().toISOString(),
                    error: true
                }
            };
        }
    },
    enabled: true
};

/**
 * Web Content Extraction Tool - Extract content from multiple URLs
 */
export const webContentExtractionTool = {
    name: WEB_TOOLS.WEB_BULK_EXTRACT,
    description: 'Extract content from multiple URLs simultaneously',
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
    handler: async (input: {
        urls: string[];
        concurrency?: number;
        format?: string;
    }, context: {
        requestId: string;
        agentId?: string;
        channelId?: string;
    }) => {
        try {
            const result = await webSearchService.bulkExtract({
                urls: input.urls,
                concurrency: input.concurrency || 3,
                format: input.format || 'structured'
            });

            return {
                content: {
                    type: 'text',
                    text: JSON.stringify(result, null, 2)
                },
                metadata: {
                    toolName: WEB_TOOLS.WEB_BULK_EXTRACT,
                    requestId: context.requestId,
                    timestamp: new Date().toISOString()
                }
            };
        } catch (error) {
            return {
                content: {
                    type: 'text',
                    text: `Error: ${error instanceof Error ? error.message : 'Bulk content extraction failed'}`
                },
                metadata: {
                    toolName: WEB_TOOLS.WEB_BULK_EXTRACT,
                    requestId: context.requestId,
                    timestamp: new Date().toISOString(),
                    error: true
                }
            };
        }
    },
    enabled: true
};

/**
 * Web Screenshot Tool - Capture screenshots of web pages
 */
export const webScreenshotTool = {
    name: WEB_TOOLS.WEB_SCREENSHOT,
    description: 'Capture screenshots of web pages',
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
    handler: async (input: {
        url: string;
        format?: string;
        fullPage?: boolean;
        width?: number;
        height?: number;
    }, context: {
        requestId: string;
        agentId?: string;
        channelId?: string;
    }) => {
        try {
            const result = await webSearchService.screenshot({
                url: input.url,
                format: input.format || 'png',
                fullPage: input.fullPage || false,
                width: input.width || 1280,
                height: input.height || 720
            });

            return {
                content: {
                    type: 'text',
                    text: `Screenshot captured for ${input.url} (${result.length} bytes)`
                },
                metadata: {
                    toolName: WEB_TOOLS.WEB_SCREENSHOT,
                    requestId: context.requestId,
                    timestamp: new Date().toISOString(),
                    screenshotSize: result.length
                }
            };
        } catch (error) {
            return {
                content: {
                    type: 'text',
                    text: `Error: ${error instanceof Error ? error.message : 'Screenshot capture failed'}`
                },
                metadata: {
                    toolName: WEB_TOOLS.WEB_SCREENSHOT,
                    requestId: context.requestId,
                    timestamp: new Date().toISOString(),
                    error: true
                }
            };
        }
    },
    enabled: true
};

/**
 * Export all web tools
 */
/**
 * API Fetch Tool - Fetch JSON from API endpoints
 */
export const apiFetchTool = {
    name: 'api_fetch',
    description: 'Fetch JSON data from API endpoints. Use this for APIs, not web_navigate (which is for HTML pages).',
    inputSchema: {
        type: 'object',
        properties: {
            url: {
                type: 'string',
                description: 'API endpoint URL',
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
                default: 30000
            }
        },
        required: ['url']
    },
    handler: async (input: {
        url: string;
        method?: string;
        headers?: Record<string, string>;
        body?: any;
        timeout?: number;
    }, context: {
        requestId: string;
        agentId?: string;
        channelId?: string;
    }) => {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), input.timeout || 30000);

            const fetchOptions: RequestInit = {
                method: input.method || 'GET',
                headers: {
                    'Accept': 'application/json',
                    ...input.headers
                },
                signal: controller.signal
            };

            if (input.body && (input.method === 'POST' || input.method === 'PUT')) {
                fetchOptions.body = JSON.stringify(input.body);
                fetchOptions.headers = {
                    ...fetchOptions.headers,
                    'Content-Type': 'application/json'
                };
            }

            const response = await fetch(input.url, fetchOptions);
            clearTimeout(timeoutId);

            if (!response.ok) {
                const errorText = await response.text();
                return {
                    content: {
                        type: 'text',
                        text: JSON.stringify({
                            error: true,
                            status: response.status,
                            statusText: response.statusText,
                            url: input.url,
                            body: errorText.substring(0, 500) // Truncate error responses
                        }, null, 2)
                    },
                    metadata: {
                        toolName: 'api_fetch',
                        requestId: context.requestId,
                        timestamp: new Date().toISOString(),
                        error: true
                    }
                };
            }

            // Get raw response text (don't assume JSON)
            const responseText = await response.text();
            const contentType = response.headers.get('content-type') || '';

            // Try to parse as JSON if content-type suggests it
            let data: any = responseText;
            let dataType = 'text';

            if (contentType.includes('application/json') || contentType.includes('text/json')) {
                try {
                    data = JSON.parse(responseText);
                    dataType = 'json';
                } catch (e) {
                    // JSON parse failed - return as text
                    data = responseText;
                    dataType = 'text (JSON parse failed)';
                }
            }

            return {
                content: {
                    type: 'text',
                    text: JSON.stringify({
                        success: true,
                        status: response.status,
                        contentType: contentType,
                        dataType: dataType,
                        url: input.url,
                        data: data
                    }, null, 2)
                },
                metadata: {
                    toolName: 'api_fetch',
                    requestId: context.requestId,
                    timestamp: new Date().toISOString()
                }
            };

        } catch (error) {
            return {
                content: {
                    type: 'text',
                    text: JSON.stringify({
                        error: true,
                        message: error instanceof Error ? error.message : 'API fetch failed',
                        url: input.url
                    }, null, 2)
                },
                metadata: {
                    toolName: 'api_fetch',
                    requestId: context.requestId,
                    timestamp: new Date().toISOString(),
                    error: true
                }
            };
        }
    },
    enabled: true
};

export const webTools = [
    webSearchTool,
    webNavigationTool,
    webContentExtractionTool,
    webScreenshotTool,
    apiFetchTool
];