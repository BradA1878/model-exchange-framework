#!/usr/bin/env node
/**
 * ============================================================================
 * GO FISH: MXF SDK EXAMPLE - AI Card Game
 * ============================================================================
 * 
 * This example demonstrates a more complex multi-agent game using the
 * Model Exchange Framework (MXF) SDK. Two AI agents play Go Fish against
 * each other, featuring hidden information (private hands) and multi-step turns.
 * 
 * KEY CONCEPTS DEMONSTRATED:
 * --------------------------
 * 1. Hidden Information     - Agents only see their own cards
 * 2. Multi-Step Turns       - Turns can continue (hot streaks)
 * 3. Complex MCP Tools      - game_getHand, game_askForCards with state
 * 4. Higher maxIterations   - Long turns need more LLM calls
 * 5. Turn Continuation      - Agent keeps playing while successful
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
 *   ┌────────────┐   ┌─────────────┐   ┌──────────────────┐
 *   │ MXF Server │   │ Game Server │   │ MCP Server       │
 *   │ (Port 3001)│   │ (Port 3006) │   │ (Game Tools)     │
 *   │ - Auth     │   │ - Card Deck │   │ - game_getHand   │
 *   │ - Events   │   │ - Game State│   │ - game_askForCards│
 *   │ - Tasks    │   │ - REST API  │   │ - task_complete  │
 *   └────────────┘   └─────────────┘   └──────────────────┘
 * 
 * GO FISH RULES:
 * --------------
 * - Each player starts with 7 cards
 * - On your turn, ask opponent for a rank you have
 * - If they have it, take their cards and GO AGAIN
 * - If not, "Go Fish" - draw from deck, turn ends
 * - Collect 4 of a kind = 1 book
 * - Player with most books wins!
 * 
 * DIFFERENCES FROM TIC-TAC-TOE:
 * -----------------------------
 * - maxIterations: 25 (vs 15) - turns can have many asks
 * - Private state: game_getHand only shows YOUR cards
 * - Turn continuation: yourTurnContinues flag in response
 * - Longer timeouts: 90s (vs 60s) per turn
 * 
 * @module examples/go-fish/connect-agents
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
 * Go Fish prompts emphasize the turn continuation mechanic:
 * - If yourTurnContinues=true after asking, keep asking!
 * - If yourTurnContinues=false, call task_complete()
 * 
 * The "hot streak" mechanic means agents need to understand
 * they can make multiple successful asks in a single turn.
 */
const PLAYERS = [
    {
        id: 'player-fox',
        name: 'Foxy Fisher',
        personality: `You are Foxy Fisher, a cunning Go Fish player.

**YOUR PLAYER ID: player-fox**

## 🚨 CRITICAL: You MUST call tools! NEVER just output text without a tool call!

## ⚡ BE BRIEF! 1-2 short sentences max. Focus on ACTIONS!

## Your Turn Flow:
1. CALL game_getHand() → see your cards
2. CALL game_askForCards(playerId="player-fox", targetPlayerId, rank) → ask for a rank YOU have
3. If yourTurnContinues=true, CALL game_askForCards again
4. If yourTurnContinues=false, CALL task_complete()

🦊 Be sly, be quick! ALWAYS CALL A TOOL!`
    },
    {
        id: 'player-frog',
        name: 'Captain Ribbit',
        personality: `You are Captain Ribbit, a frog admiral playing Go Fish.

**YOUR PLAYER ID: player-frog**

## 🚨 CRITICAL: You MUST call tools! NEVER just output text without a tool call!

## ⚡ BE BRIEF! 1-2 short sentences max. Focus on ACTIONS!

## Your Turn Flow:
1. CALL game_getHand() → see your cards
2. CALL game_askForCards(playerId="player-frog", targetPlayerId, rank) → ask for a rank YOU have
3. If yourTurnContinues=true, CALL game_askForCards again
4. If yourTurnContinues=false, CALL task_complete()

🐸 Ribbit! Swift naval precision! ALWAYS CALL A TOOL!`
    }
];

/**
 * Main function
 */
async function connectAgents() {
    console.log('╔═══════════════════════════════════════════════════════════╗');
    console.log('║                                                           ║');
    console.log('║         GO FISH: AI CARD GAME                            ║');
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

    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/mxf');
    console.log('✅ Connected to MongoDB\n');

    // =================================================================
    // STEP 1: Start Game Server
    // =================================================================

    console.log('🎮 Step 1: Starting game server...\n');

    const gameServerPort = parseInt(process.env.GAME_SERVER_PORT || '3006');
    const gameServer = new GameServer(gameServerPort);
    await gameServer.start();

    // Add players to game
    for (const player of PLAYERS) {
        gameServer.addPlayer(player.id, player.name, '', player.personality);
    }

    console.log('✅ Game server running on port', gameServerPort, '\n');

    // =================================================================
    // STEP 2: Connect to MXF Server
    // =================================================================

    console.log('📡 Step 2: Connecting to MXF server...\n');

    // Create SDK with Personal Access Token authentication (REQUIRED)
    const accessToken = process.env.MXF_DEMO_ACCESS_TOKEN;
    if (!accessToken) {
        console.error('❌ MXF_DEMO_ACCESS_TOKEN is required. Run: bun run server:cli -- demo:setup');
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
    // STEP 3: Create Game Channel
    // =================================================================

    console.log('📺 Step 3: Creating game channel with MCP server...\n');

    const channelId = 'go-fish-game';
    const mcpServerPath = join(__dirname, 'server', 'mcp', 'GoFishMcpServer.ts');

    // Create channel with MCP server and SystemLLM disabled
    // No admin agent needed - SDK registers MCP servers directly
    const channel = await sdk.createChannel(channelId, {
        name: 'Go Fish Table',
        description: 'AI Go Fish card game',
        maxAgents: 5,
        systemLlmEnabled: false,  // Game logic handled by custom MCP server
        allowedTools: [
            'game_getHand',
            'game_askForCards',
            'game_taunt',
            'task_complete'
        ],  // Channel-level tool restriction
        mcpServers: [{
            id: 'go-fish-mcp-server',
            name: 'Go Fish Game Tools',
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
    // Go Fish agents need special configuration for multi-step turns:
    // 
    // WHY maxIterations: 25?
    // ----------------------
    // A lucky Go Fish turn might go:
    //   1. game_getHand() - see cards
    //   2. game_askForCards() - success! (keep going)
    //   3. game_getHand() - check updated hand
    //   4. game_askForCards() - success! (keep going)
    //   5. game_getHand() - check again
    //   6. game_askForCards() - "Go Fish" (turn ends)
    //   7. task_complete()
    // That's 7+ tool calls for a single turn. With LLM reasoning
    // between each call, you need ~15-25 iterations.
    // 
    // WHY circuitBreakerExemptTools?
    // ------------------------------
    // The circuit breaker detects "stuck" agents by watching for
    // repeated tool calls. But in Go Fish, calling game_getHand
    // multiple times is NORMAL gameplay, not a stuck agent.
    // Exempt these tools from triggering the circuit breaker.
    // 
    // MODEL SELECTION:
    // ----------------
    // Not all models work well for games:
    // - gpt-5-nano: Too simple, doesn't follow complex instructions
    // - gpt-5-mini: Too slow, causes timeouts
    // - gemini-2.5-flash: Fast and capable ✓
    // - claude-haiku-4.5: Good balance of speed/quality ✓
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
        const key = await sdk.generateKey(channelId, player.id);
        const selectedModel = availableModels[i % availableModels.length];

        const agent = await sdk.createAgent({
            agentId: player.id,
            name: player.name,
            channelId: channelId,
            keyId: key.keyId,
            secretKey: key.secretKey,
            llmProvider: LlmProviderType.OPENROUTER,
            apiKey: process.env.OPENROUTER_API_KEY!,
            defaultModel: selectedModel,
            temperature: 0.7,
            maxTokens: 50000,
            reasoning: { enabled: false },
            allowedTools: [
                'game_getHand',
                'game_askForCards',
                'game_taunt',
                'task_complete'
            ],
            // Game tools need repeated calls during valid gameplay
            // Exempt from circuit breaker to allow hot streaks
            circuitBreakerExemptTools: [
                'game_getHand',
                'game_askForCards'
            ],
            // Go Fish turns can be long (multiple successful asks)
            maxIterations: 25,
            agentConfigPrompt: player.personality
        });

        await agent.connect();
        agents.push(agent);

        const modelShortName = selectedModel.split('/')[1];
        agentModels[player.id] = modelShortName;

        // Update game server with model info
        await fetch(`http://localhost:${gameServerPort}/api/player/${player.id}/model`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: selectedModel })
        }).catch(() => {});

        console.log(`   ✅ ${player.name} → ${modelShortName}`);
    }

    console.log(`\n✅ All players connected!\n`);

    // =================================================================
    // STEP 7: Setup Event Listeners
    // =================================================================

    console.log('📡 Setting up event listeners...\n');

    const { Events } = await import('../../src/shared/events/EventNames');
    const gameServerUrl = `http://localhost:${gameServerPort}`;

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
            await sdk.unregisterChannelMcpServer(channelId, 'go-fish-mcp-server').catch(() => {});

            // 3. Delete agent memory from MongoDB
            console.log('🗑️  Deleting agent memory...');
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
    console.log('   👉 Open http://localhost:3007 and click "Start Game"!\n');

    await new Promise<void>((resolve) => {
        gameServer.onGameStart(() => {
            console.log('🎮 Game started! Cards dealt!\n');
            resolve();
        });
    });

    // =================================================================
    // STEP 9: Game Loop
    // =================================================================
    // Go Fish game loop is similar to Tic-Tac-Toe but with key differences:
    // 
    // 1. LONGER TIMEOUTS (90s vs 60s):
    //    A turn can have multiple successful asks, each requiring
    //    LLM processing. Give agents more time.
    // 
    // 2. TURN CONTINUATION:
    //    The game_askForCards tool returns yourTurnContinues=true/false.
    //    Agents must keep asking while true, then call task_complete.
    // 
    // 3. PRIVATE STATE:
    //    Unlike Tic-Tac-Toe where board is public, Go Fish has hidden
    //    hands. game_getHand only returns the calling agent's cards.
    // =================================================================

    console.log('🎯 Starting game loop...\n');

    const playGame = async () => {
        while (!gameServer.getGameState().getPublicState().gameOver) {
            const state = gameServer.getGameState().getPublicState();
            const currentPlayerId = gameServer.getGameState().getCurrentPlayerId();
            const currentAgent = agents.find(a => a.agentId === currentPlayerId);
            const currentPlayer = state.players.find(p => p.id === currentPlayerId);

            if (!currentAgent || !currentPlayer) {
                await new Promise(resolve => setTimeout(resolve, 1000));
                continue;
            }

            console.log(`\n🎣 ${currentPlayer.name}'s turn...`);

            // Cancel any active tasks from previous turns
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

            // Clear conversation history
            try {
                const memoryManager = currentAgent.getMemoryManager?.();
                if (memoryManager?.clearConversationHistory) {
                    memoryManager.clearConversationHistory();
                }
            } catch (e) {}

            // Create task - use the current player's agent to create their own task
            // This prevents admin from receiving tasks (server sets toAgentId to creator)
            const taskId = await currentAgent.mxfService.createTask({
                title: `Go Fish: ${currentPlayer.name}'s Turn`,
                description: `YOUR TURN! Player ID: ${currentPlayerId}

⚡ BE QUICK - 2-3 tool calls max!

1. game_getHand() → see cards
2. game_askForCards(playerId="${currentPlayerId}", targetPlayerId, rank)
3. If yourTurnContinues=true, ask again. If false → task_complete()

GO! 🐟`,
                assignmentScope: 'single',
                assignmentStrategy: 'manual',
                assignedAgentIds: [currentPlayerId],
                priority: 'high'
            });

            console.log(`   📋 Task assigned: ${taskId}`);

            // Wait for turn to change or game over
            const startTime = Date.now();
            const timeout = 90000; // 90 seconds (Go Fish can have multiple asks per turn)

            while (gameServer.getGameState().getCurrentPlayerId() === currentPlayerId &&
                   !gameServer.getGameState().getPublicState().gameOver) {
                if (Date.now() - startTime > timeout) {
                    console.log(`   ⏰ Timeout waiting for ${currentPlayer.name}'s turn`);
                    break;
                }
                await new Promise(resolve => setTimeout(resolve, 500));
            }

            // Small delay between turns
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        // Game over!
        const finalState = gameServer.getGameState().getPublicState();
        const winnerPlayer = finalState.players.find(p => p.id === finalState.winner);

        console.log('\n╔═══════════════════════════════════════════════════════════╗');
        console.log(`║         GAME OVER - ${winnerPlayer?.name || 'Unknown'} WINS!           ║`.padEnd(62) + '║');
        console.log('╚═══════════════════════════════════════════════════════════╝\n');

        console.log('Final Scores:');
        for (const player of finalState.players) {
            console.log(`  ${player.name}: ${player.books.length} books`);
        }

        console.log('\nPress Ctrl+C to exit...\n');
    };

    await playGame();

    // Keep process alive
    await new Promise(() => {});
}

// Run
if (require.main === module) {
    connectAgents().catch(error => {
        console.error('❌ Fatal error:', error);
        process.exit(1);
    });
}

export { connectAgents };
