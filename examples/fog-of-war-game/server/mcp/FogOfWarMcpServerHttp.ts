#!/usr/bin/env node
/**
 * Fog of War MCP Server (HTTP-based)
 * 
 * Implements MCP protocol (JSON-RPC over stdio) for game tools.
 * Proxies all tool calls to the game server HTTP API at localhost:3002
 */

const GAME_SERVER_URL = process.env.GAME_SERVER_URL || 'http://localhost:3002';

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
 * Fog of War MCP Server
 * Exposes game tools via MCP protocol for AI commanders
 */
class FogOfWarMcpServerHttp {
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
                                name: 'fog-of-war-game-mcp-server',
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
                                    name: 'game_viewTerritory',
                                    description: 'View details about specific territories on the game map.',
                                    inputSchema: {
                                        type: 'object',
                                        properties: {
                                            commanderId: { type: 'string', description: 'Your commander ID' },
                                            territoryIds: {
                                                type: 'array',
                                                items: { type: 'string' },
                                                description: 'Array of territory IDs like "A1", "B3"'
                                            }
                                        },
                                        required: ['commanderId', 'territoryIds']
                                    }
                                },
                                {
                                    name: 'game_scanPerimeter',
                                    description: 'Scout the visible area around your controlled territories.',
                                    inputSchema: {
                                        type: 'object',
                                        properties: {
                                            commanderId: { type: 'string', description: 'Your commander ID' }
                                        },
                                        required: ['commanderId']
                                    }
                                },
                                {
                                    name: 'game_moveUnits',
                                    description: 'Move units from one territory to another.',
                                    inputSchema: {
                                        type: 'object',
                                        properties: {
                                            commanderId: { type: 'string' },
                                            from: { type: 'string', description: 'Source territory ID' },
                                            to: { type: 'string', description: 'Destination territory ID' },
                                            unitType: { type: 'string', enum: ['infantry', 'cavalry', 'archers'] },
                                            count: { type: 'number' }
                                        },
                                        required: ['commanderId', 'from', 'to', 'unitType', 'count']
                                    }
                                },
                                {
                                    name: 'game_fortifyPosition',
                                    description: 'Strengthen defenses at a controlled territory.',
                                    inputSchema: {
                                        type: 'object',
                                        properties: {
                                            commanderId: { type: 'string' },
                                            territoryId: { type: 'string' }
                                        },
                                        required: ['commanderId', 'territoryId']
                                    }
                                },
                                {
                                    name: 'game_collectResources',
                                    description: 'Gather resources from a controlled territory.',
                                    inputSchema: {
                                        type: 'object',
                                        properties: {
                                            commanderId: { type: 'string' },
                                            territoryId: { type: 'string' }
                                        },
                                        required: ['commanderId', 'territoryId']
                                    }
                                },
                                {
                                    name: 'game_getTeamStatus',
                                    description: 'Get comprehensive status of all team members.',
                                    inputSchema: {
                                        type: 'object',
                                        properties: {
                                            commanderId: { type: 'string' }
                                        },
                                        required: ['commanderId']
                                    }
                                },
                                {
                                    name: 'game_calculateOptimalPath',
                                    description: 'Calculate the optimal path between two territories.',
                                    inputSchema: {
                                        type: 'object',
                                        properties: {
                                            commanderId: { type: 'string' },
                                            from: { type: 'string' },
                                            to: { type: 'string' },
                                            avoidEnemies: { type: 'boolean', default: true }
                                        },
                                        required: ['commanderId', 'from', 'to']
                                    }
                                },
                                {
                                    name: 'game_commitTurn',
                                    description: 'Submit your turn when ready. IMPORTANT: You MUST provide your commanderId (e.g., red-scout, blue-warrior).',
                                    inputSchema: {
                                        type: 'object',
                                        properties: {
                                            commanderId: { type: 'string', description: 'REQUIRED: Your commander ID (red-scout, red-warrior, red-defender, red-support, blue-scout, blue-warrior, blue-defender, blue-support)' },
                                            summary: { type: 'string', description: 'Summary of your turn actions' }
                                        },
                                        required: ['commanderId', 'summary']
                                    }
                                }
                            ]
                        }
                    };

                case 'tools/call':
                    if (!params || !params.name || !params.arguments) {
                        throw new Error('Invalid tool call parameters');
                    }

                    const toolName = params.name.replace('game_', ''); // Remove prefix for API endpoint
                    const toolArgs = typeof params.arguments === 'string' 
                        ? JSON.parse(params.arguments) 
                        : params.arguments;

                    // Extract commanderId from tool arguments
                    const commanderId = toolArgs._commanderId || toolArgs.commanderId;
                    
                    // Log tool call for debugging
                    console.error(`[FogOfWarMcpServerHttp] Tool call: ${params.name} by ${commanderId || 'UNKNOWN'}`);
                    console.error(`[FogOfWarMcpServerHttp] Arguments: ${JSON.stringify(toolArgs)}`);
                    
                    // Ensure commanderId is always passed to game server
                    const gameServerArgs = {
                        ...toolArgs,
                        commanderId: commanderId
                    };

                    // Make HTTP call to game server
                    const result = await callGameServer(toolName, gameServerArgs);

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
        console.error('[FogOfWarMcpServerHttp] Starting...');
        console.error(`[FogOfWarMcpServerHttp] Game Server: ${GAME_SERVER_URL}`);

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
                    console.error(`[FogOfWarMcpServerHttp] Received: ${request.method}`);

                    const response = await this.handleMessage(request);

                    // Send response to stdout
                    process.stdout.write(JSON.stringify(response) + '\n');
                } catch (error) {
                    console.error(`[FogOfWarMcpServerHttp] Error: ${error}`);
                }
            }
        });

        process.stdin.on('end', () => {
            console.error('[FogOfWarMcpServerHttp] Shutting down...');
            process.exit(0);
        });

        console.error('[FogOfWarMcpServerHttp] Ready');
    }
}

// Start the server if run directly
if (require.main === module) {
    const server = new FogOfWarMcpServerHttp();
    server.start();
}

export { FogOfWarMcpServerHttp };
