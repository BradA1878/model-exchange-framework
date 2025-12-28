#!/usr/bin/env node
/**
 * Go Fish MCP Server (HTTP-based)
 *
 * Implements MCP protocol (JSON-RPC over stdio) for game tools.
 */

const GAME_SERVER_URL = process.env.GAME_SERVER_URL || 'http://localhost:3006';

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

async function callGameServer(endpoint: string, body: any): Promise<any> {
    const response = await fetch(`${GAME_SERVER_URL}/api/mcp/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    }

    return await response.json();
}

class GoFishMcpServer {
    private initialized = false;

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
                            capabilities: { tools: {} },
                            serverInfo: { name: 'go-fish-mcp-server', version: '1.0.0' }
                        }
                    };

                case 'tools/list':
                    return {
                        jsonrpc: '2.0',
                        id,
                        result: {
                            tools: [
                                {
                                    name: 'game_getHand',
                                    description: 'Get your current hand, books, and game status. Shows which ranks you can ask for and who you can ask.',
                                    inputSchema: {
                                        type: 'object',
                                        properties: {
                                            playerId: {
                                                type: 'string',
                                                description: 'Your player ID'
                                            }
                                        },
                                        required: ['playerId']
                                    }
                                },
                                {
                                    name: 'game_askForCards',
                                    description: 'Ask another player for cards of a specific rank. You must have at least one card of that rank in your hand. If they have any, you get them all. If not, you "Go Fish" and draw from the deck.',
                                    inputSchema: {
                                        type: 'object',
                                        properties: {
                                            playerId: {
                                                type: 'string',
                                                description: 'Your player ID'
                                            },
                                            targetPlayerId: {
                                                type: 'string',
                                                description: 'The player ID you want to ask'
                                            },
                                            rank: {
                                                type: 'string',
                                                description: 'The rank to ask for (A, 2-10, J, Q, K)',
                                                enum: ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']
                                            }
                                        },
                                        required: ['playerId', 'targetPlayerId', 'rank']
                                    }
                                },
                                {
                                    name: 'game_taunt',
                                    description: 'Send a playful message to the other players.',
                                    inputSchema: {
                                        type: 'object',
                                        properties: {
                                            playerId: {
                                                type: 'string',
                                                description: 'Your player ID'
                                            },
                                            message: {
                                                type: 'string',
                                                description: 'Your message to the table'
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

                    console.error(`[GoFishMcpServer] Tool call: ${params.name}`);
                    console.error(`[GoFishMcpServer] Arguments: ${JSON.stringify(toolArgs)}`);

                    const result = await callGameServer(toolName, toolArgs);

                    return {
                        jsonrpc: '2.0',
                        id,
                        result: {
                            content: [{
                                type: 'text',
                                text: JSON.stringify(result, null, 2)
                            }]
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

    start(): void {
        console.error('[GoFishMcpServer] Starting...');
        console.error(`[GoFishMcpServer] Game Server: ${GAME_SERVER_URL}`);

        let buffer = '';

        process.stdin.on('data', async (chunk) => {
            buffer += chunk.toString();
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                if (!line.trim()) continue;

                try {
                    const request: JsonRpcRequest = JSON.parse(line);
                    console.error(`[GoFishMcpServer] Received: ${request.method}`);

                    const response = await this.handleMessage(request);
                    process.stdout.write(JSON.stringify(response) + '\n');
                } catch (error) {
                    console.error(`[GoFishMcpServer] Error: ${error}`);
                }
            }
        });

        process.stdin.on('end', () => {
            console.error('[GoFishMcpServer] Shutting down...');
            process.exit(0);
        });

        console.error('[GoFishMcpServer] Ready');
    }
}

if (require.main === module) {
    const server = new GoFishMcpServer();
    server.start();
}

export { GoFishMcpServer };
