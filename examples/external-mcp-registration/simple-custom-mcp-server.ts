#!/usr/bin/env node
/**
 * Copyright 2024 Brad Anderson
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for details
 * @author Brad Anderson <BradA1878@pm.me>
 */

/**
 * Simple Custom MCP Server
 *
 * A minimal MCP server implementation for testing SDK external server registration.
 * Implements MCP protocol via stdio (JSON-RPC messages over stdin/stdout).
 */

interface JsonRpcRequest {
    jsonrpc: '2.0';
    id?: number | string;
    method: string;
    params?: any;
}

interface JsonRpcResponse {
    jsonrpc: '2.0';
    id?: number | string;
    result?: any;
    error?: {
        code: number;
        message: string;
        data?: any;
    };
}

/**
 * Simple Custom MCP Server
 * Provides basic string manipulation tools for testing
 */
class SimpleCustomMcpServer {
    private initialized = false;

    /**
     * Handle MCP protocol messages
     */
    async handleMessage(request: JsonRpcRequest): Promise<JsonRpcResponse> {
        const { method, params, id } = request;

        try {
            switch (method) {
                case 'initialize':
                    this.initialized = true;
                    return {
                        jsonrpc: '2.0',
                        id,
                        result: {
                            protocolVersion: '2024-11-05',
                            capabilities: {
                                tools: {}
                            },
                            serverInfo: {
                                name: 'simple-custom-mcp-server',
                                version: '1.0.0'
                            }
                        }
                    };

                case 'tools/list':
                    return {
                        jsonrpc: '2.0',
                        id,
                        result: {
                            tools: [
                                {
                                    name: 'reverse_string',
                                    description: 'Reverse a string',
                                    inputSchema: {
                                        type: 'object',
                                        properties: {
                                            text: {
                                                type: 'string',
                                                description: 'Text to reverse'
                                            }
                                        },
                                        required: ['text']
                                    }
                                },
                                {
                                    name: 'uppercase',
                                    description: 'Convert string to uppercase',
                                    inputSchema: {
                                        type: 'object',
                                        properties: {
                                            text: {
                                                type: 'string',
                                                description: 'Text to convert'
                                            }
                                        },
                                        required: ['text']
                                    }
                                },
                                {
                                    name: 'word_count',
                                    description: 'Count words in text',
                                    inputSchema: {
                                        type: 'object',
                                        properties: {
                                            text: {
                                                type: 'string',
                                                description: 'Text to analyze'
                                            }
                                        },
                                        required: ['text']
                                    }
                                }
                            ]
                        }
                    };

                case 'tools/call':
                    if (!params || !params.name) {
                        throw new Error('Tool name is required');
                    }

                    const toolName = params.name;
                    const toolArgs = params.arguments || {};

                    let result: any;

                    switch (toolName) {
                        case 'reverse_string':
                            if (!toolArgs.text) {
                                throw new Error('text parameter is required');
                            }
                            result = {
                                reversed: toolArgs.text.split('').reverse().join(''),
                                originalLength: toolArgs.text.length
                            };
                            break;

                        case 'uppercase':
                            if (!toolArgs.text) {
                                throw new Error('text parameter is required');
                            }
                            result = {
                                uppercase: toolArgs.text.toUpperCase(),
                                originalLength: toolArgs.text.length
                            };
                            break;

                        case 'word_count':
                            if (!toolArgs.text) {
                                throw new Error('text parameter is required');
                            }
                            const words = toolArgs.text.trim().split(/\s+/);
                            result = {
                                wordCount: words.length,
                                characterCount: toolArgs.text.length,
                                words: words
                            };
                            break;

                        default:
                            throw new Error(`Unknown tool: ${toolName}`);
                    }

                    return {
                        jsonrpc: '2.0',
                        id,
                        result: {
                            content: [
                                {
                                    type: 'text',
                                    text: JSON.stringify(result)
                                }
                            ]
                        }
                    };

                default:
                    throw new Error(`Unknown method: ${method}`);
            }
        } catch (error) {
            return {
                jsonrpc: '2.0',
                id,
                error: {
                    code: -32603,
                    message: error instanceof Error ? error.message : String(error)
                }
            };
        }
    }

    /**
     * Start the MCP server (stdio transport)
     */
    start() {
        console.error('Simple Custom MCP Server starting...');

        let buffer = '';

        process.stdin.on('data', async (chunk) => {
            buffer += chunk.toString();

            // Process complete JSON-RPC messages (newline-delimited)
            const lines = buffer.split('\n');
            buffer = lines.pop() || ''; // Keep incomplete line in buffer

            for (const line of lines) {
                if (!line.trim()) continue;

                try {
                    const request: JsonRpcRequest = JSON.parse(line);
                    console.error(`Received: ${request.method}`);

                    const response = await this.handleMessage(request);

                    // Send response to stdout
                    process.stdout.write(JSON.stringify(response) + '\n');
                } catch (error) {
                    console.error(`Error processing message: ${error}`);
                }
            }
        });

        process.stdin.on('end', () => {
            console.error('Simple Custom MCP Server shutting down...');
            process.exit(0);
        });

        console.error('Simple Custom MCP Server ready');
    }
}

// Start the server
const server = new SimpleCustomMcpServer();
server.start();
