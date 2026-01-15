#!/usr/bin/env node
/**
 * Twenty Questions MCP Server (HTTP-based)
 *
 * Implements MCP protocol (JSON-RPC over stdio) for game tools.
 * Proxies all tool calls to the game server HTTP API.
 *
 * Tools:
 * - game_getState: Get current game state
 * - game_setSecret: Set the secret thing (Thinker only)
 * - game_askQuestion: Ask a yes/no question (Guesser only)
 * - game_answerQuestion: Answer the current question (Thinker only)
 * - game_makeGuess: Make a final guess (Guesser only)
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
 * Twenty Questions MCP Server
 * Exposes game tools via MCP protocol for AI players
 */
class TwentyQuestionsMcpServer {
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
                                name: 'twenty-questions-mcp-server',
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
                                    name: 'game_getState',
                                    description: 'Get the current state of the Twenty Questions game from your perspective. Shows question history, remaining questions, and game status.',
                                    inputSchema: {
                                        type: 'object',
                                        properties: {
                                            playerId: {
                                                type: 'string',
                                                description: 'Your player ID (agent ID)'
                                            }
                                        },
                                        required: ['playerId']
                                    }
                                },
                                {
                                    name: 'game_setSecret',
                                    description: 'Set the secret thing to be guessed (Thinker only). Choose something specific but guessable within 20 yes/no questions.',
                                    inputSchema: {
                                        type: 'object',
                                        properties: {
                                            playerId: {
                                                type: 'string',
                                                description: 'Your player ID (must be the Thinker)'
                                            },
                                            secret: {
                                                type: 'string',
                                                description: 'The secret thing (e.g., "elephant", "Eiffel Tower", "pizza")'
                                            },
                                            category: {
                                                type: 'string',
                                                description: 'Category hint for the guesser (e.g., "animal", "landmark", "food")'
                                            }
                                        },
                                        required: ['playerId', 'secret', 'category']
                                    }
                                },
                                {
                                    name: 'game_askQuestion',
                                    description: 'Ask a yes/no question about the secret thing (Guesser only). Strategic questions narrow down possibilities.',
                                    inputSchema: {
                                        type: 'object',
                                        properties: {
                                            playerId: {
                                                type: 'string',
                                                description: 'Your player ID (must be the Guesser)'
                                            },
                                            question: {
                                                type: 'string',
                                                description: 'A yes/no question (e.g., "Is it alive?", "Is it bigger than a car?")'
                                            }
                                        },
                                        required: ['playerId', 'question']
                                    }
                                },
                                {
                                    name: 'game_answerQuestion',
                                    description: 'Answer the most recent question honestly (Thinker only). You must answer truthfully!',
                                    inputSchema: {
                                        type: 'object',
                                        properties: {
                                            playerId: {
                                                type: 'string',
                                                description: 'Your player ID (must be the Thinker)'
                                            },
                                            answer: {
                                                type: 'string',
                                                enum: ['yes', 'no', 'sometimes', 'unknown'],
                                                description: 'Your honest answer to the question'
                                            },
                                            reasoning: {
                                                type: 'string',
                                                description: 'Your reasoning for this answer (kept private from Guesser)'
                                            }
                                        },
                                        required: ['playerId', 'answer']
                                    }
                                },
                                {
                                    name: 'game_makeGuess',
                                    description: 'Make a final guess about the secret thing (Guesser only). Use when you think you know the answer!',
                                    inputSchema: {
                                        type: 'object',
                                        properties: {
                                            playerId: {
                                                type: 'string',
                                                description: 'Your player ID (must be the Guesser)'
                                            },
                                            guess: {
                                                type: 'string',
                                                description: 'Your guess for the secret thing'
                                            }
                                        },
                                        required: ['playerId', 'guess']
                                    }
                                }
                            ]
                        }
                    };

                case 'tools/call':
                    if (!params || !params.name) {
                        throw new Error('Invalid tool call parameters: missing tool name');
                    }

                    const toolName = params.name.replace('game_', '');
                    const toolArgs = typeof params.arguments === 'string'
                        ? JSON.parse(params.arguments)
                        : (params.arguments || {});

                    // Auto-inject playerId from _playerId if not provided
                    // MXF injects _playerId automatically from the agent context
                    if (!toolArgs.playerId && toolArgs._playerId) {
                        toolArgs.playerId = toolArgs._playerId;
                    }

                    const playerId = toolArgs.playerId;

                    console.error(`[TwentyQuestionsMcpServer] Tool call: ${params.name} by ${playerId || 'UNKNOWN'}`);
                    console.error(`[TwentyQuestionsMcpServer] Arguments: ${JSON.stringify(toolArgs)}`);

                    // Validate required parameters before calling server
                    if (!playerId) {
                        return {
                            jsonrpc: '2.0',
                            id,
                            result: {
                                content: [{
                                    type: 'text',
                                    text: JSON.stringify({
                                        success: false,
                                        error: `Missing playerId. You must provide your player ID (e.g., "agent-thinker" or "agent-guesser").`
                                    }, null, 2)
                                }]
                            }
                        };
                    }

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
        console.error('[TwentyQuestionsMcpServer] Starting...');
        console.error(`[TwentyQuestionsMcpServer] Game Server: ${GAME_SERVER_URL}`);

        let buffer = '';

        process.stdin.on('data', async (chunk) => {
            buffer += chunk.toString();

            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                if (!line.trim()) continue;

                try {
                    const request: JsonRpcRequest = JSON.parse(line);
                    console.error(`[TwentyQuestionsMcpServer] Received: ${request.method}`);

                    const response = await this.handleMessage(request);
                    process.stdout.write(JSON.stringify(response) + '\n');
                } catch (error) {
                    console.error(`[TwentyQuestionsMcpServer] Error: ${error}`);
                }
            }
        });

        process.stdin.on('end', () => {
            console.error('[TwentyQuestionsMcpServer] Shutting down...');
            process.exit(0);
        });

        console.error('[TwentyQuestionsMcpServer] Ready');
    }
}

// Start the server if run directly
if (require.main === module) {
    const server = new TwentyQuestionsMcpServer();
    server.start();
}

export { TwentyQuestionsMcpServer };
