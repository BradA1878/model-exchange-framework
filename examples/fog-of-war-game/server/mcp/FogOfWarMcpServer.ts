#!/usr/bin/env node
/**
 * Fog of War MCP Server
 * 
 * Implements MCP protocol (JSON-RPC over stdio) for game tools.
 * Tools are automatically converted to OpenAI-compatible function calls
 * by the MXF OpenRouterMessageAdapter.
 */

import { GameTools } from './GameTools';
import { GameStateManager } from '../engine/GameStateManager';

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
 * Fog of War MCP Server
 * Exposes game tools via MCP protocol for AI commanders
 */
export class FogOfWarMcpServer {
    private initialized = false;
    private gameTools: GameTools | null = null;
    private gameStateManager: GameStateManager | null = null;

    /**
     * Initialize with game state manager
     * Called via environment variable or initialization message
     */
    private initializeGameState(): void {
        const gameStateId = process.env.GAME_STATE_ID;
        
        if (!gameStateId) {
            console.error('[FogOfWarMcpServer] WARNING: No GAME_STATE_ID provided');
            // Create a placeholder - real integration will inject the actual game state
            this.gameStateManager = new GameStateManager('placeholder-game');
        }
        
        this.gameTools = new GameTools(this.gameStateManager!);
    }

    /**
     * Handle MCP protocol messages
     */
    async handleMessage(request: JsonRpcRequest): Promise<JsonRpcResponse> {
        const { method, params, id } = request;

        try {
            switch (method) {
                case 'initialize':
                    this.initialized = true;
                    this.initializeGameState();
                    
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
                                    description: 'View details about specific territories on the game map. Returns terrain type, ownership, resources, units, and fortification level. Only visible tiles return full information due to fog of war.',
                                    inputSchema: {
                                        type: 'object',
                                        properties: {
                                            territoryIds: {
                                                type: 'array',
                                                items: { type: 'string' },
                                                description: 'Array of territory IDs in format "A1", "B3", "C5", etc. (column letter + row number)'
                                            }
                                        },
                                        required: ['territoryIds']
                                    }
                                },
                                {
                                    name: 'game_scanPerimeter',
                                    description: 'Scout the visible area around your controlled territories and unit positions. Returns intelligence about visible tiles, enemy units detected, and threat assessment. Essential for reconnaissance and situational awareness.',
                                    inputSchema: {
                                        type: 'object',
                                        properties: {},
                                        required: []
                                    }
                                },
                                {
                                    name: 'game_moveUnits',
                                    description: 'Move units from one territory to another. Movement creates an action that will be executed during turn resolution. If destination has enemy units, combat will occur. Movement cost depends on terrain and distance.',
                                    inputSchema: {
                                        type: 'object',
                                        properties: {
                                            from: {
                                                type: 'string',
                                                description: 'Source territory ID (e.g., "A1")'
                                            },
                                            to: {
                                                type: 'string',
                                                description: 'Destination territory ID (e.g., "B2")'
                                            },
                                            unitType: {
                                                type: 'string',
                                                enum: ['infantry', 'cavalry', 'archers'],
                                                description: 'Type of unit to move. Infantry beats archers, cavalry beats infantry, archers beat cavalry.'
                                            },
                                            count: {
                                                type: 'number',
                                                description: 'Number of units to move (must not exceed available units)'
                                            }
                                        },
                                        required: ['from', 'to', 'unitType', 'count']
                                    }
                                },
                                {
                                    name: 'game_fortifyPosition',
                                    description: 'Strengthen defenses at a controlled territory. Fortifications provide +20% defense bonus per level (max level 5). Costs 20 resources per level. Crucial for holding strategic positions.',
                                    inputSchema: {
                                        type: 'object',
                                        properties: {
                                            territoryId: {
                                                type: 'string',
                                                description: 'Territory ID to fortify (e.g., "C3"). Must be controlled by your team.'
                                            }
                                        },
                                        required: ['territoryId']
                                    }
                                },
                                {
                                    name: 'game_collectResources',
                                    description: 'Gather resources from a controlled territory. Resources are needed for fortifications and can be transferred to teammates. Higher value territories provide more resources per turn.',
                                    inputSchema: {
                                        type: 'object',
                                        properties: {
                                            territoryId: {
                                                type: 'string',
                                                description: 'Territory ID to collect from (e.g., "D4"). Must be controlled by your team and have available resources.'
                                            }
                                        },
                                        required: ['territoryId']
                                    }
                                },
                                {
                                    name: 'game_getTeamStatus',
                                    description: 'Get comprehensive status of all team members including resources, territories, units, and control percentage. Essential for coordination and strategic planning.',
                                    inputSchema: {
                                        type: 'object',
                                        properties: {},
                                        required: []
                                    }
                                },
                                {
                                    name: 'game_calculateOptimalPath',
                                    description: 'Calculate the optimal path between two territories considering terrain, distance, and optionally enemy positions. Returns path as array of territory IDs, movement cost, and risk assessment.',
                                    inputSchema: {
                                        type: 'object',
                                        properties: {
                                            from: {
                                                type: 'string',
                                                description: 'Starting territory ID (e.g., "A1")'
                                            },
                                            to: {
                                                type: 'string',
                                                description: 'Destination territory ID (e.g., "E5")'
                                            },
                                            avoidEnemies: {
                                                type: 'boolean',
                                                description: 'Whether to route around enemy positions (default: true)'
                                            }
                                        },
                                        required: ['from', 'to']
                                    }
                                }
                            ]
                        }
                    };

                case 'tools/call':
                    if (!this.gameTools) {
                        throw new Error('Game tools not initialized');
                    }

                    if (!params || !params.name) {
                        throw new Error('Tool name is required');
                    }

                    const toolName = params.name;
                    const toolArgs = params.arguments || {};
                    
                    // Extract commanderId from arguments (injected by MXF agent context)
                    const commanderId = toolArgs._commanderId || toolArgs.commanderId;
                    
                    if (!commanderId) {
                        throw new Error('commanderId is required but not provided');
                    }

                    let result: any;

                    // Execute game tools
                    switch (toolName) {
                        case 'game_viewTerritory':
                            result = this.gameTools.viewTerritory(
                                commanderId,
                                toolArgs.territoryIds
                            );
                            break;

                        case 'game_scanPerimeter':
                            result = this.gameTools.scanPerimeter(commanderId);
                            break;

                        case 'game_moveUnits':
                            result = this.gameTools.moveUnits(
                                commanderId,
                                toolArgs.from,
                                toolArgs.to,
                                toolArgs.unitType,
                                toolArgs.count
                            );
                            break;

                        case 'game_fortifyPosition':
                            result = this.gameTools.fortifyPosition(
                                commanderId,
                                toolArgs.territoryId
                            );
                            break;

                        case 'game_collectResources':
                            result = this.gameTools.collectResources(
                                commanderId,
                                toolArgs.territoryId
                            );
                            break;

                        case 'game_getTeamStatus':
                            result = this.gameTools.getTeamStatus(commanderId);
                            break;

                        case 'game_calculateOptimalPath':
                            result = this.gameTools.calculateOptimalPath(
                                commanderId,
                                toolArgs.from,
                                toolArgs.to,
                                toolArgs.avoidEnemies
                            );
                            break;

                        default:
                            throw new Error(`Unknown tool: ${toolName}`);
                    }

                    // Return result in MCP format
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
    start(): void {
        console.error('[FogOfWarMcpServer] Starting...');

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
                    console.error(`[FogOfWarMcpServer] Received: ${request.method}`);

                    const response = await this.handleMessage(request);

                    // Send response to stdout
                    process.stdout.write(JSON.stringify(response) + '\n');
                } catch (error) {
                    console.error(`[FogOfWarMcpServer] Error processing message: ${error}`);
                }
            }
        });

        process.stdin.on('end', () => {
            console.error('[FogOfWarMcpServer] Shutting down...');
            process.exit(0);
        });

        console.error('[FogOfWarMcpServer] Ready');
    }
}

// Start the server if run directly
if (require.main === module) {
    const server = new FogOfWarMcpServer();
    server.start();
}
