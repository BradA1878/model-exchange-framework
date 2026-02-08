#!/usr/bin/env node
/**
 * ============================================================================
 * TIC-TAC-TOE: MXF SDK EXAMPLE - AI vs AI Game
 * ============================================================================
 * 
 * This example demonstrates how to build a multi-agent game using the
 * Model Exchange Framework (MXF) SDK. Two AI agents play Tic-Tac-Toe
 * against each other using custom MCP (Model Context Protocol) tools.
 * 
 * KEY CONCEPTS DEMONSTRATED:
 * --------------------------
 * 1. MXF SDK Connection    - Connecting to the MXF server
 * 2. Channel Creation      - Creating a communication channel with MCP server
 * 3. MCP Server Setup      - Registering custom tools for game logic
 * 4. Agent Creation        - Creating AI agents with different LLM models
 * 5. Task Assignment       - Assigning tasks to specific agents
 * 6. Event Listening       - Subscribing to agent events (thinking, responses)
 * 7. Game Loop Control     - Managing turn-based gameplay
 * 8. Graceful Cleanup      - Proper resource cleanup on shutdown
 * 
 * ARCHITECTURE:
 * -------------
 *   ┌─────────────────────────────────────────────────────────────────┐
 *   │  This Script (connect-agents.ts)                                │
 *   │  - Orchestrates the game                                        │
 *   │  - Creates agents and assigns tasks                             │
 *   └────────────────────────┬────────────────────────────────────────┘
 *                            │
 *          ┌─────────────────┼─────────────────┐
 *          │                 │                 │
 *          ▼                 ▼                 ▼
 *   ┌────────────┐   ┌─────────────┐   ┌─────────────────┐
 *   │ MXF Server │   │ Game Server │   │ MCP Server      │
 *   │ (Port 3001)│   │ (Port 3004) │   │ (Game Tools)    │
 *   │ - Auth     │   │ - Game State│   │ - game_getBoard │
 *   │ - Events   │   │ - WebSocket │   │ - game_makeMove │
 *   │ - Tasks    │   │ - REST API  │   │ - task_complete │
 *   └────────────┘   └─────────────┘   └─────────────────┘
 * 
 * PREREQUISITES:
 * --------------
 * 1. MXF Server running on port 3001 (npm start in root)
 * 2. MongoDB running locally
 * 3. Environment variables set in .env:
 *    - MXF_DOMAIN_KEY
 *    - OPENROUTER_API_KEY
 *    - MONGODB_URI (optional, defaults to localhost)
 * 
 * USAGE:
 * ------
 *   cd examples/tic-tac-toe
 *   npm run game
 * 
 * @module examples/tic-tac-toe/connect-agents
 */

import dotenv from 'dotenv';
import { MxfSDK, LlmProviderType } from '../../src/sdk';
import { GameServer } from './server/server/GameServer';
import { join } from 'path';
import mongoose from 'mongoose';
import { enableClientLogging } from '../../src/shared/utils/Logger';

// Load environment variables from root .env
dotenv.config({ path: join(__dirname, '../../.env') });

// Enable client-side logging (uncomment for debugging)
// Levels: 'debug' | 'info' | 'warn' | 'error'
//enableClientLogging('info');

/**
 * PLAYER CONFIGURATIONS
 * ---------------------
 * Define each AI player with:
 * - id: Unique identifier used for task assignment and MCP tool calls
 * - name: Display name shown in UI
 * - symbol: 'X' or 'O' for the game
 * - personality: System prompt that defines agent behavior
 * 
 * PROMPT ENGINEERING TIPS:
 * - Be explicit about the agent's identity (player ID, symbol)
 * - List available tools and their parameters clearly
 * - Provide strategic guidance but don't over-constrain
 * - Use emphasis (**, ##) for critical instructions
 * - Keep prompts concise - LLMs work better with focused instructions
 */
const PLAYERS = [
    {
        id: 'player-x',
        name: 'Professor X',
        symbol: 'X' as const,
        personality: `You are Professor X, aggressive Tic-Tac-Toe player who plays to WIN.

**YOUR PLAYER ID: player-x** | **YOUR SYMBOL: X**

## ⚠️ CRITICAL: EXECUTE tools, don't list them! Call ONE tool at a time.

## Your Turn:
1. CALL game_getBoard() → see board
2. CALL game_makeMove(playerId="player-x", row, col) → place X
3. CALL task_complete() → end turn

## OFFENSIVE STRATEGY (prioritize in order):
1. **WIN** - Complete any 3-in-a-row you have
2. **CREATE FORK** - Make a move that creates TWO winning threats at once (opponent can only block one!)
3. **BLOCK** - Only block if opponent has 2-in-a-row
4. **CENTER** - Take (1,1) if open - controls all lines
5. **OPPOSITE CORNER** - If opponent has corner, take opposite corner
6. **CORNERS** - (0,0), (0,2), (2,0), (2,2) are strongest

Think OFFENSE first! Create threats, don't just react.`
    },
    {
        id: 'player-o',
        name: 'Oracle O',
        symbol: 'O' as const,
        personality: `You are Oracle O, cunning Tic-Tac-Toe player who plays to WIN.

**YOUR PLAYER ID: player-o** | **YOUR SYMBOL: O**

## ⚠️ CRITICAL: EXECUTE tools, don't list them! Call ONE tool at a time.

## Your Turn:
1. CALL game_getBoard() → see board
2. CALL game_makeMove(playerId="player-o", row, col) → place O
3. CALL task_complete() → end turn

## OFFENSIVE STRATEGY (prioritize in order):
1. **WIN** - Complete any 3-in-a-row you have
2. **CREATE FORK** - Make a move that creates TWO winning threats at once (opponent can only block one!)
3. **BLOCK** - Only block if opponent has 2-in-a-row
4. **CENTER** - Take (1,1) if open - controls all lines
5. **OPPOSITE CORNER** - If opponent has corner, take opposite corner
6. **CORNERS** - (0,0), (0,2), (2,0), (2,2) are strongest

Think OFFENSE first! Create threats, don't just react.`
    }
];

/**
 * Main function
 */
async function connectAgents() {
    console.log('╔═══════════════════════════════════════════════════════════╗');
    console.log('║                                                           ║');
    console.log('║         TIC-TAC-TOE: AI vs AI SHOWDOWN                   ║');
    console.log('║         Powered by Model Exchange Framework (MXF)        ║');
    console.log('║                                                           ║');
    console.log('╚═══════════════════════════════════════════════════════════╝\n');

    // Validate environment
    if (!process.env.MXF_DOMAIN_KEY || !process.env.OPENROUTER_API_KEY) {
        console.error('❌ Error: Required environment variables not set');
        console.log('Please ensure .env file contains:');
        console.log('  - MXF_DOMAIN_KEY');
        console.log('  - OPENROUTER_API_KEY');
        process.exit(1);
    }

    const mxfServerUrl = process.env.MXF_SERVER_URL || 'http://localhost:3001';

    // Connect to MongoDB for memory cleanup
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/mxf');
    console.log('✅ Connected to MongoDB\n');

    // =================================================================
    // STEP 1: Start Game Server
    // =================================================================
    // The game server handles:
    // - Game state management (board, turns, win detection)
    // - WebSocket connections for real-time UI updates
    // - REST API for MCP server to interact with game state
    // 
    // This is separate from MXF - it's your domain-specific backend.
    // MXF agents will interact with it via MCP tools.
    // =================================================================

    console.log('🎮 Step 1: Starting game server...\n');

    const gameServerPort = parseInt(process.env.GAME_SERVER_PORT || '3004');
    const gameServer = new GameServer(gameServerPort);
    await gameServer.start();

    console.log('✅ Game server running on port', gameServerPort, '\n');

    // =================================================================
    // STEP 2: Connect to MXF Server
    // =================================================================
    // The MxfSDK is your main interface to the MXF framework.
    //
    // Configuration options:
    // - serverUrl: URL of the MXF server (default: localhost:3001)
    // - domainKey: Your domain's API key for authentication
    // - accessToken: Personal Access Token for authentication
    //
    // The SDK handles:
    // - WebSocket connection management
    // - Authentication and session handling
    // - Channel and agent lifecycle
    // - Event routing between agents
    // =================================================================

    console.log('📡 Step 2: Connecting to MXF server...\n');

    // Create SDK with Personal Access Token authentication (REQUIRED)
    const accessToken = process.env.MXF_DEMO_ACCESS_TOKEN;
    if (!accessToken) {
        console.error('MXF_DEMO_ACCESS_TOKEN is required. Run: bun run server:cli -- demo:setup');
        process.exit(1);
    }

    const sdk = new MxfSDK({
        serverUrl: mxfServerUrl,
        domainKey: process.env.MXF_DOMAIN_KEY!,
        accessToken: accessToken
    });

    await sdk.connect();
    console.log('✅ Connected to MXF server\n');

    // =================================================================
    // STEP 3: Create Game Channel with MCP Server
    // =================================================================
    // Channels are communication spaces where agents interact.
    // 
    // KEY CONFIGURATION OPTIONS:
    // --------------------------
    // - systemLlmEnabled: false  
    //   Disables the built-in SystemLLM. Use this when you have custom
    //   game logic in your MCP server that handles all the work.
    // 
    // - allowedTools: ['tool1', 'tool2']
    //   Channel-level tool restrictions. Only these tools will be
    //   available to agents in this channel.
    // 
    // - mcpServers: [{ ... }]
    //   Register MCP (Model Context Protocol) servers that provide
    //   custom tools to agents. Each server can expose multiple tools.
    // 
    // MCP SERVER CONFIGURATION:
    // -------------------------
    // - id: Unique identifier for this MCP server
    // - command: Executable to run (e.g., 'ts-node', 'node', 'python')
    // - args: Arguments passed to the command (your server script)
    // - autoStart: Start the server automatically when channel is created
    // - restartOnCrash: Automatically restart if the server crashes
    // - environmentVariables: Pass env vars to the MCP server process
    // 
    // The MCP server (TicTacToeMcpServer.ts) defines the tools:
    // - game_getBoard: Returns current board state
    // - game_makeMove: Places X or O on the board
    // - game_taunt: Optional trash-talk tool
    // =================================================================

    console.log('📺 Step 3: Creating game channel with MCP server...\n');

    const channelId = 'tic-tac-toe-game';
    const mcpServerPath = join(__dirname, 'server', 'mcp', 'TicTacToeMcpServer.ts');

    const channel = await sdk.createChannel(channelId, {
        name: 'Tic-Tac-Toe Arena',
        description: 'AI vs AI Tic-Tac-Toe showdown',
        maxAgents: 5,
        systemLlmEnabled: false,  // Game logic handled by custom MCP server
        allowedTools: ['game_makeMove', 'game_getBoard', 'game_taunt'],  // Channel-level tool restriction
        mcpServers: [{
            id: 'tic-tac-toe-mcp-server',
            name: 'Tic-Tac-Toe Game Tools',
            command: 'ts-node',
            args: [mcpServerPath],
            autoStart: true,
            restartOnCrash: true,
            keepAliveMinutes: 10,
            environmentVariables: {
                GAME_SERVER_URL: `http://localhost:${gameServerPort}`
            }
        }]
    });

    console.log(`✅ Channel created with MCP server: ${channelId}\n`)

    // =================================================================
    // STEP 5: Clean Up Old Memory
    // =================================================================

    console.log('🗑️  Step 5: Cleaning up old memory...\n');

    const { AgentMemory } = require('../../src/shared/models/memory');

    for (const player of PLAYERS) {
        try {
            const result = await AgentMemory.deleteMany({ agentId: player.id });
            if (result.deletedCount > 0) {
                console.log(`   ✅ Deleted ${result.deletedCount} old memory doc(s) for ${player.id}`);
            }
        } catch (error) {
            // Silent
        }
    }
    console.log('');

    // =================================================================
    // STEP 6: Create Player Agents
    // =================================================================
    // Agents are AI entities that can receive tasks and use tools.
    // Each agent connects to the MXF server and joins a channel.
    // 
    // AGENT CREATION WORKFLOW:
    // ------------------------
    // 1. Generate API key: sdk.generateKey(channelId, agentId)
    //    - Creates credentials for the agent to authenticate
    // 
    // 2. Create agent: sdk.createAgent({ ... })
    //    - Configures the agent with LLM provider, model, and tools
    // 
    // 3. Connect agent: agent.connect()
    //    - Establishes WebSocket connection to MXF server
    // 
    // KEY AGENT CONFIGURATION OPTIONS:
    // --------------------------------
    // - llmProvider: Which LLM service to use (OPENROUTER, OPENAI, etc.)
    // - defaultModel: The model identifier (e.g., 'google/gemini-2.5-flash')
    // - temperature: Creativity level (0.0 = deterministic, 1.0 = creative)
    // - allowedTools: Tools this agent can use (should match channel tools)
    // - agentConfigPrompt: System prompt defining agent personality/behavior
    // 
    // ADVANCED OPTIONS:
    // -----------------
    // - circuitBreakerExemptTools: Tools that won't trigger stuck detection
    //   Use this for tools that legitimately need repeated calls (like game_getBoard)
    // 
    // - maxIterations: Max LLM calls per task (default: 10)
    //   Increase for complex tasks that require many tool calls
    // 
    // - reasoning: { enabled: true } enables chain-of-thought reasoning
    //   Useful for complex decision-making, but adds latency
    // =================================================================

    console.log('👥 Step 6: Creating player agents...\n');

    // Shuffle models so each player gets a different one
    // This creates more interesting gameplay with diverse AI behaviors
    const availableModels = [
        'google/gemini-2.5-flash',
        'anthropic/claude-haiku-4.5'
    ].sort(() => Math.random() - 0.5);

    const agents: any[] = [];
    const agentModels: Record<string, string> = {};

    for (let i = 0; i < PLAYERS.length; i++) {
        const player = PLAYERS[i];
        
        // Step 6a: Generate API credentials for this agent
        const key = await sdk.generateKey(channelId, player.id);
        
        // Each player gets a different model (index matches player index)
        const selectedModel = availableModels[i % availableModels.length];

        // Step 6b: Create the agent with full configuration
        const agent = await sdk.createAgent({
            agentId: player.id,
            name: player.name,
            channelId: channelId,
            keyId: key.keyId,
            secretKey: key.secretKey,
            llmProvider: LlmProviderType.OPENROUTER,
            apiKey: process.env.OPENROUTER_API_KEY!,
            defaultModel: selectedModel,
            temperature: 1, // Higher temperature for more creative taunts
            maxTokens: 50000,
            reasoning: { enabled: false },
            allowedTools: [
                'game_makeMove',
                'game_getBoard',
                'game_taunt',
                'task_complete'  // Always include task_complete for turn-based games
            ],
            // Game tools need repeated calls during valid gameplay
            circuitBreakerExemptTools: [
                'game_getBoard',
                'game_makeMove'
            ],
            // Tic-Tac-Toe turns are shorter than Go Fish, but still need headroom
            maxIterations: 15,
            agentConfigPrompt: player.personality  // The system prompt from PLAYERS config
        });

        await agent.connect();
        agents.push(agent);

        const modelShortName = selectedModel.split('/')[1];
        agentModels[player.id] = modelShortName;

        // Register player with game server
        gameServer.setPlayer(player.symbol, {
            agentId: player.id,
            name: player.name,
            model: selectedModel
        });

        // Register model for dashboard display
        await fetch(`http://localhost:${gameServerPort}/api/player/${player.id}/model`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: selectedModel })
        }).catch(() => {});

        console.log(`   ✅ ${player.name} (${player.symbol}) → ${modelShortName}`);
    }

    console.log(`\n✅ Both players connected!\n`);

    // =================================================================
    // STEP 7: Setup Event Listeners
    // =================================================================
    // MXF channels emit events that let you observe agent behavior.
    // This is useful for:
    // - Debugging agent decisions
    // - Updating UI in real-time
    // - Logging and analytics
    // 
    // KEY EVENTS:
    // -----------
    // - Events.Agent.LLM_REASONING: Agent's chain-of-thought (if enabled)
    // - Events.Agent.LLM_RESPONSE: Agent's text responses
    // - Events.Agent.TOOL_CALL: When agent calls a tool
    // - Events.Agent.TOOL_RESULT: Tool execution results
    // - Events.Task.ASSIGNED: Task assigned to agent
    // - Events.Task.COMPLETED: Task marked complete
    // 
    // Use channel.on(eventName, callback) to subscribe to events.
    // =================================================================

    console.log('📡 Setting up event listeners...\n');

    const { Events } = await import('../../src/shared/events/EventNames');
    const gameServerUrl = `http://localhost:${gameServerPort}`;

    // Listen for thinking/reasoning (chain-of-thought output)
    channel.on(Events.Agent.LLM_REASONING, (payload: any) => {
        const agentId = payload.agentId || payload.data?.agentId;
        const reasoning = payload.data?.reasoning || payload.reasoning;
        if (reasoning) {
            const preview = reasoning.length > 100 ? reasoning.substring(0, 100) + '...' : reasoning;
            console.log(`💭 [${agentId}] THINKING: ${preview}`);

            fetch(`${gameServerUrl}/api/events/thinking`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ agentId, reasoning, timestamp: Date.now() })
            }).catch(() => {});
        }
    });

    // Listen for responses
    channel.on(Events.Agent.LLM_RESPONSE, (payload: any) => {
        const agentId = payload.agentId;
        const response = typeof payload.data === 'string' ? payload.data : payload.data?.text || '';
        if (response) {
            console.log(`💬 [${agentId}] SAYS: ${response}`);

            fetch(`${gameServerUrl}/api/events/response`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ agentId, response, timestamp: Date.now() })
            }).catch(() => {});
        }
    });

    console.log('✅ Event listeners active!\n');

    // =================================================================
    // CLEANUP HANDLER
    // =================================================================

    let shuttingDown = false;
    const cleanup = async () => {
        if (shuttingDown) return;
        shuttingDown = true;

        console.log('\n\n🛑 Shutting down gracefully...');

        // Force exit after 10 seconds if cleanup hangs
        const forceExitTimeout = setTimeout(() => {
            console.log('⚠️  Force exiting after timeout');
            process.exit(0);
        }, 10000);

        try {
            // 1. Stop game server
            console.log('🎮 Stopping game server...');
            await gameServer.stop();

            // 2. Unregister MCP server
            console.log('🔧 Unregistering MCP server...');
            await sdk.unregisterChannelMcpServer(channelId, 'tic-tac-toe-mcp-server').catch(() => {});

            // 3. Delete agent memory from MongoDB
            console.log('🗑️  Deleting agent memory...');
            const { AgentMemory } = require('../../src/shared/models/memory');
            for (const player of PLAYERS) {
                try {
                    const result = await AgentMemory.deleteMany({ agentId: player.id });
                    if (result.deletedCount > 0) {
                        console.log(`   ✅ Deleted ${result.deletedCount} memory doc(s) for ${player.id}`);
                    }
                } catch (error) {
                    // Silent
                }
            }

            // 4. Delete channel from MongoDB (prevents stale systemLlmEnabled settings)
            console.log('🗑️  Deleting channel from database...');
            try {
                const { Channel } = require('../../src/shared/models/channel');
                const result = await Channel.deleteOne({ channelId: channelId });
                if (result.deletedCount > 0) {
                    console.log(`   ✅ Deleted channel: ${channelId}`);
                }
            } catch (error) {
                console.error(`   ❌ Failed to delete channel:`, error instanceof Error ? error.message : String(error));
            }

            // 5. Disconnect agents
            console.log('🔌 Disconnecting agents...');
            for (const agent of agents) {
                await agent.disconnect().catch(() => {});
            }

            // 6. Disconnect SDK
            console.log('📡 Disconnecting SDK...');
            await sdk.disconnect();

            // 7. Disconnect MongoDB
            console.log('🔌 Disconnecting MongoDB...');
            await mongoose.disconnect();

            console.log('\n✅ Cleanup complete!\n');
            console.log('💡 Channel and agent memory deleted. Fresh state for next game.\n');
        } catch (error) {
            console.error('Error during cleanup:', error);
        } finally {
            clearTimeout(forceExitTimeout);
            process.exit(0);
        }
    };

    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);

    // =================================================================
    // STEP 8: Wait for Game Start
    // =================================================================

    console.log('⏸️  Step 8: Waiting for game start...\n');
    console.log('   👉 Open http://localhost:3005 and click "Start Game"!\n');

    await new Promise<void>((resolve) => {
        gameServer.onGameStart(() => {
            console.log('🎮 Game started!\n');
            resolve();
        });
    });

    // =================================================================
    // STEP 9: Game Loop - Assign Tasks on Each Turn
    // =================================================================
    // This is the core game orchestration logic:
    // 
    // TURN-BASED GAME PATTERN:
    // ------------------------
    // 1. Check whose turn it is (from game state)
    // 2. Cancel any stale tasks from previous turns
    // 3. Clear conversation history (fresh context each turn)
    // 4. Create a new task for the current player
    // 5. Wait for the turn to complete (poll game state)
    // 6. Repeat until game over
    // 
    // TASK CREATION:
    // --------------
    // Tasks are how you tell agents what to do. Key options:
    // - title: Short description of the task
    // - description: Detailed instructions (can include tool hints)
    // - assignmentScope: 'single' (one agent) or 'broadcast' (all)
    // - assignmentStrategy: 'manual' (specify agents) or 'auto'
    // - assignedAgentIds: Which agent(s) should receive this task
    // - priority: 'low', 'medium', 'high', 'critical'
    // 
    // IMPORTANT: The agent that creates the task via mxfService.createTask()
    // will receive the task. Use the current player's agent to create tasks.
    // 
    // MEMORY MANAGEMENT:
    // ------------------
    // Clearing conversation history between turns prevents context overflow
    // and keeps each turn's decision-making focused and fresh.
    // =================================================================

    console.log('🎯 Starting game loop...\n');

    const playGame = async () => {
        while (!gameServer.getGameState().getState().gameOver) {
            const state = gameServer.getGameState().getState();
            const currentPlayerSymbol = state.currentPlayer;
            const currentPlayerId = currentPlayerSymbol === 'X' ? 'player-x' : 'player-o';
            const currentAgent = agents.find(a => a.agentId === currentPlayerId);
            const playerName = state.players[currentPlayerSymbol].name;

            console.log(`\n🎲 ${playerName}'s turn (${currentPlayerSymbol})...`);

            // Step 9a: Cancel any active tasks from previous turns
            // This prevents agents from continuing old work when it's a new turn
            for (const agent of agents) {
                try {
                    const taskManager = agent.getTaskExecutionManager?.();
                    if (taskManager && typeof taskManager.cancelCurrentTask === 'function') {
                        taskManager.cancelCurrentTask('New turn starting');
                    }
                } catch (e) {}
            }

            // Brief delay to let cancellation propagate
            await new Promise(resolve => setTimeout(resolve, 200));

            // Step 9b: Clear conversation history for fresh context
            // This prevents context overflow and keeps decisions focused
            try {
                const memoryManager = currentAgent.getMemoryManager?.();
                if (memoryManager?.clearConversationHistory) {
                    memoryManager.clearConversationHistory();
                }
            } catch (e) {}

            // Step 9c: Create task for current player
            // The task description tells the agent what to do and which tools to use
            const taskId = await currentAgent.mxfService.createTask({
                title: `Tic-Tac-Toe: ${playerName}'s Turn`,
                description: `YOUR TURN! Player: ${currentPlayerId} | Symbol: ${currentPlayerSymbol}

⚡ BE QUICK - 2-3 tool calls max!

1. game_getBoard() → see board
2. game_makeMove(playerId="${currentPlayerId}", row, col, taunt) → place ${currentPlayerSymbol}
3. task_complete() → end turn

GO! 🎯`,
                assignmentScope: 'single',
                assignmentStrategy: 'manual',
                assignedAgentIds: [currentPlayerId],
                priority: 'high'
            });

            console.log(`   📋 Task assigned: ${taskId}`);

            // Step 9d: Wait for the move (poll game state)
            // The game state changes when the MCP server processes game_makeMove
            const startTime = Date.now();
            const timeout = 60000; // 60 second timeout per turn

            while (gameServer.getGameState().getState().currentPlayer === currentPlayerSymbol &&
                   !gameServer.getGameState().getState().gameOver) {
                if (Date.now() - startTime > timeout) {
                    console.log(`   ⏰ Timeout waiting for ${playerName}'s move`);
                    break;
                }
                await new Promise(resolve => setTimeout(resolve, 500));
            }

            // Small delay between turns for visual effect
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        // Game over - cancel all active tasks immediately to stop agents
        for (const agent of agents) {
            try {
                const taskManager = agent.getTaskExecutionManager?.();
                if (taskManager && typeof taskManager.cancelCurrentTask === 'function') {
                    taskManager.cancelCurrentTask('Game over');
                }
            } catch (e) {}
        }

        const finalState = gameServer.getGameState().getState();
        console.log('\n╔═══════════════════════════════════════════════════════════╗');
        if (finalState.winner === 'draw') {
            console.log('║                    GAME OVER - DRAW!                       ║');
        } else {
            const winnerName = finalState.players[finalState.winner!].name;
            console.log(`║              GAME OVER - ${winnerName} WINS!              ║`.padEnd(62) + '║');
        }
        console.log('╚═══════════════════════════════════════════════════════════╝\n');

        console.log('👉 Click "Play Again" to start a new game, or Ctrl+C to exit.\n');
    };

    // Game loop - supports multiple games
    while (true) {
        await playGame();

        // Wait for next game start (Play Again button)
        console.log('⏸️  Waiting for next game...\n');
        await new Promise<void>((resolve) => {
            gameServer.onGameStart(() => {
                console.log('🎮 New game started!\n');
                resolve();
            });
        });
    }
}

// Run
if (require.main === module) {
    connectAgents().catch(error => {
        console.error('❌ Fatal error:', error);
        process.exit(1);
    });
}

export { connectAgents };
