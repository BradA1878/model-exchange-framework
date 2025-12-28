#!/usr/bin/env node
/**
 * Tic-Tac-Toe MCP Server (HTTP-based)
 *
 * Implements MCP protocol (JSON-RPC over stdio) for game tools.
 * Proxies all tool calls to the game server HTTP API
 */

const GAME_SERVER_URL = process.env.GAME_SERVER_URL || 'http://localhost:3004';

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
 * Make HTTP POST request to game server
 */
async function callGameServer(endpoint: string, body: any): Promise<any> {
    const response = await fetch(`${GAME_SERVER_URL}/api/mcp/${endpoint}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    });

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    }

    return await response.json();
}

/**
 * Tic-Tac-Toe MCP Server
 * Exposes game tools via MCP protocol for AI players
 */
class TicTacToeMcpServer {
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
                                name: 'tic-tac-toe-mcp-server',
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
                                    name: 'game_makeMove',
                                    description: 'Place your mark (X or O) on the board. Row and column are 0-indexed (0, 1, or 2). You can optionally include a taunt message to your opponent!',
                                    inputSchema: {
                                        type: 'object',
                                        properties: {
                                            playerId: {
                                                type: 'string',
                                                description: 'Your player ID (player-x or player-o)'
                                            },
                                            row: {
                                                type: 'number',
                                                description: 'Row position (0, 1, or 2)',
                                                minimum: 0,
                                                maximum: 2
                                            },
                                            col: {
                                                type: 'number',
                                                description: 'Column position (0, 1, or 2)',
                                                minimum: 0,
                                                maximum: 2
                                            },
                                            taunt: {
                                                type: 'string',
                                                description: 'Optional trash talk message to your opponent'
                                            }
                                        },
                                        required: ['playerId', 'row', 'col']
                                    }
                                },
                                {
                                    name: 'game_getBoard',
                                    description: 'Get the current board state, available moves, and whose turn it is.',
                                    inputSchema: {
                                        type: 'object',
                                        properties: {
                                            playerId: {
                                                type: 'string',
                                                description: 'Your player ID (player-x or player-o)'
                                            }
                                        },
                                        required: ['playerId']
                                    }
                                },
                                {
                                    name: 'game_taunt',
                                    description: 'Send a trash talk message to your opponent without making a move.',
                                    inputSchema: {
                                        type: 'object',
                                        properties: {
                                            playerId: {
                                                type: 'string',
                                                description: 'Your player ID (player-x or player-o)'
                                            },
                                            message: {
                                                type: 'string',
                                                description: 'Your trash talk message'
                                            }
                                        },
                                        required: ['playerId', 'message']
                                    }
                                }
                            ]
                        }
                    };

                case 'tools/call':
                    if (!params || !params.name || !params.arguments) {
                        throw new Error('Invalid tool call parameters');
                    }

                    const toolName = params.name.replace('game_', '');
                    const toolArgs = typeof params.arguments === 'string'
                        ? JSON.parse(params.arguments)
                        : params.arguments;

                    const playerId = toolArgs._playerId || toolArgs.playerId;

                    console.error(`[TicTacToeMcpServer] Tool call: ${params.name} by ${playerId || 'UNKNOWN'}`);
                    console.error(`[TicTacToeMcpServer] Arguments: ${JSON.stringify(toolArgs)}`);

                    const result = await callGameServer(toolName, toolArgs);

                    return {
                        jsonrpc: '2.0',
                        id,
                        result: {
                            content: [
                                {
                                    type: 'text',
                                    text: JSON.stringify(result, null, 2)
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
    start(): void {
        console.error('[TicTacToeMcpServer] Starting...');
        console.error(`[TicTacToeMcpServer] Game Server: ${GAME_SERVER_URL}`);

        let buffer = '';

        process.stdin.on('data', async (chunk) => {
            buffer += chunk.toString();

            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                if (!line.trim()) continue;

                try {
                    const request: JsonRpcRequest = JSON.parse(line);
                    console.error(`[TicTacToeMcpServer] Received: ${request.method}`);

                    const response = await this.handleMessage(request);
                    process.stdout.write(JSON.stringify(response) + '\n');
                } catch (error) {
                    console.error(`[TicTacToeMcpServer] Error: ${error}`);
                }
            }
        });

        process.stdin.on('end', () => {
            console.error('[TicTacToeMcpServer] Shutting down...');
            process.exit(0);
        });

        console.error('[TicTacToeMcpServer] Ready');
    }
}

// Start the server if run directly
if (require.main === module) {
    const server = new TicTacToeMcpServer();
    server.start();
}

export { TicTacToeMcpServer };
