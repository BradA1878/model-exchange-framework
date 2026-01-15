/**
 * Twenty Questions Server Entry Point
 *
 * Starts the game server independently for testing or dashboard development.
 * For the full demo with agents, use: npm run connect-agents
 */

import { GameServer } from './server/GameServer';

const PORT = parseInt(process.env.GAME_SERVER_PORT || '3006');

async function main() {
    console.log('Starting Twenty Questions Game Server...\n');

    const gameServer = new GameServer(PORT);
    await gameServer.start();

    console.log(`\nGame Server running on http://localhost:${PORT}`);
    console.log('\nEndpoints:');
    console.log(`  GET  /health              - Health check`);
    console.log(`  GET  /api/game/state      - Get full game state`);
    console.log(`  GET  /api/game/chat       - Get chat/event history`);
    console.log(`  GET  /api/game/orpar      - Get ORPAR phase events`);
    console.log(`  POST /api/game/start      - Start the game`);
    console.log(`  POST /api/game/reset      - Reset the game`);
    console.log(`  POST /api/mcp/getState    - MCP: Get game state`);
    console.log(`  POST /api/mcp/setSecret   - MCP: Set secret (Thinker)`);
    console.log(`  POST /api/mcp/askQuestion - MCP: Ask question (Guesser)`);
    console.log(`  POST /api/mcp/answerQuestion - MCP: Answer question (Thinker)`);
    console.log(`  POST /api/mcp/makeGuess   - MCP: Make guess (Guesser)`);
    console.log('\nPress Ctrl+C to stop.\n');

    // Keep alive
    process.on('SIGINT', async () => {
        console.log('\nShutting down...');
        await gameServer.stop();
        process.exit(0);
    });
}

main().catch(console.error);
