/**
 * Tic-Tac-Toe Game Server Entry Point
 */

import { GameServer } from './server/GameServer';

const port = parseInt(process.env.GAME_SERVER_PORT || '3004');

const server = new GameServer(port);

server.start().then(() => {
    console.log(`Tic-Tac-Toe game server running on http://localhost:${port}`);
}).catch((error) => {
    console.error('Failed to start game server:', error);
    process.exit(1);
});
