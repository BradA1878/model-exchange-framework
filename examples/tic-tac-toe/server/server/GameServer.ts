/**
 * Tic-Tac-Toe Game Server
 * Express + Socket.IO server for real-time game updates
 */

import express, { Application, Request, Response } from 'express';
import { createServer, Server as HttpServer } from 'http';
import { Server as SocketServer, Socket } from 'socket.io';
import cors from 'cors';
import { GameStateManager } from '../engine/GameStateManager';
import { Player, PlayerInfo, Move } from '../types/game';

interface ChatMessage {
    id: string;
    from: string;
    fromName: string;
    message: string;
    type: 'taunt' | 'system' | 'thinking';
    timestamp: number;
}

export class GameServer {
    private app: Application;
    private httpServer: HttpServer;
    private io: SocketServer;
    private gameState: GameStateManager;
    private port: number;
    private chatHistory: ChatMessage[] = [];
    private thinkingStates: Map<string, boolean> = new Map();
    private onGameStartCallback?: () => void;
    private gameStarted: boolean = false;

    constructor(port: number = 3004) {
        this.port = port;
        this.app = express();
        this.httpServer = createServer(this.app);
        this.io = new SocketServer(this.httpServer, {
            cors: {
                origin: '*',
                methods: ['GET', 'POST']
            }
        });
        this.gameState = new GameStateManager();
        this.setupMiddleware();
        this.setupRoutes();
        this.setupSocketHandlers();
        this.setupGameCallbacks();
    }

    private setupMiddleware(): void {
        this.app.use(cors());
        this.app.use(express.json());
    }

    private setupRoutes(): void {
        // Health check
        this.app.get('/health', (_req: Request, res: Response) => {
            res.json({ status: 'ok', game: 'tic-tac-toe' });
        });

        // Get full game state
        this.app.get('/api/game/state', (_req: Request, res: Response) => {
            res.json(this.gameState.getState());
        });

        // Get chat history
        this.app.get('/api/game/chat', (_req: Request, res: Response) => {
            res.json(this.chatHistory);
        });

        // Start game (called from dashboard)
        this.app.post('/api/game/start', (_req: Request, res: Response) => {
            if (!this.gameStarted) {
                this.gameStarted = true;
                this.onGameStartCallback?.();
                this.addSystemMessage('Game started! X goes first.');
                res.json({ success: true, message: 'Game started' });
            } else {
                res.json({ success: false, message: 'Game already started' });
            }
        });

        // Reset game
        this.app.post('/api/game/reset', (_req: Request, res: Response) => {
            this.gameState.reset();
            this.chatHistory = [];
            this.gameStarted = false;
            this.addSystemMessage('Game reset! Waiting to start...');
            this.io.emit('gameReset', this.gameState.getState());
            res.json({ success: true });
        });

        // MCP Tool Endpoints
        this.app.post('/api/mcp/makeMove', (req: Request, res: Response) => {
            const { playerId, row, col, taunt } = req.body;
            const player = this.getPlayerSymbol(playerId);

            if (!player) {
                res.json({ success: false, message: `Unknown player: ${playerId}` });
                return;
            }

            const result = this.gameState.makeMove(player, row, col, taunt);

            if (result.success && taunt) {
                this.addTauntMessage(playerId, this.gameState.getState().players[player].name, taunt);
            }

            // Clear thinking state
            this.setThinking(playerId, false);

            res.json(result);
        });

        this.app.post('/api/mcp/getBoard', (req: Request, res: Response) => {
            const { playerId } = req.body;
            const player = this.getPlayerSymbol(playerId);
            const state = this.gameState.getState();

            res.json({
                board: this.gameState.getBoardString(),
                boardArray: state.board,
                currentPlayer: state.currentPlayer,
                isYourTurn: player ? state.currentPlayer === player : false,
                gameOver: state.gameOver,
                winner: state.winner,
                availableMoves: this.gameState.getAvailableMoves(),
                moveCount: state.moveHistory.length
            });
        });

        this.app.post('/api/mcp/taunt', (req: Request, res: Response) => {
            const { playerId, message } = req.body;
            const player = this.getPlayerSymbol(playerId);

            if (!player) {
                res.json({ success: false, message: `Unknown player: ${playerId}` });
                return;
            }

            const playerName = this.gameState.getState().players[player].name;
            this.addTauntMessage(playerId, playerName, message);

            res.json({ success: true, message: 'Taunt sent!' });
        });

        // Receive thinking/response events from connect-agents
        this.app.post('/api/events/thinking', (req: Request, res: Response) => {
            const { agentId, reasoning } = req.body;
            this.setThinking(agentId, true);

            // Broadcast thinking to dashboard
            this.io.emit('agentThinking', { agentId, reasoning, timestamp: Date.now() });
            res.json({ success: true });
        });

        this.app.post('/api/events/response', (req: Request, res: Response) => {
            const { agentId, response } = req.body;
            this.setThinking(agentId, false);

            // Broadcast response to dashboard
            this.io.emit('agentResponse', { agentId, response, timestamp: Date.now() });
            res.json({ success: true });
        });

        // Register player model
        this.app.post('/api/player/:playerId/model', (req: Request, res: Response) => {
            const { playerId } = req.params;
            const { model } = req.body;
            const player = this.getPlayerSymbol(playerId);

            if (player) {
                this.gameState.setPlayer(player, { model });
            }
            res.json({ success: true });
        });
    }

    private setupSocketHandlers(): void {
        this.io.on('connection', (socket: Socket) => {
            console.log(`[GameServer] Client connected: ${socket.id}`);

            // Send current state on connect
            socket.emit('gameState', this.gameState.getState());
            socket.emit('chatHistory', this.chatHistory);
            socket.emit('thinkingStates', Object.fromEntries(this.thinkingStates));

            socket.on('disconnect', () => {
                console.log(`[GameServer] Client disconnected: ${socket.id}`);
            });
        });
    }

    private setupGameCallbacks(): void {
        this.gameState.onStateChangeCallback((state) => {
            this.io.emit('gameState', state);
        });

        this.gameState.onGameOverCallback((winner) => {
            const message = winner === 'draw'
                ? "It's a draw! Well played by both!"
                : `${winner} wins the game!`;
            this.addSystemMessage(message);
            this.io.emit('gameOver', { winner, state: this.gameState.getState() });
        });
    }

    private getPlayerSymbol(playerId: string): Player | null {
        const state = this.gameState.getState();
        if (state.players.X.agentId === playerId) return 'X';
        if (state.players.O.agentId === playerId) return 'O';
        return null;
    }

    private addTauntMessage(from: string, fromName: string, message: string): void {
        const chatMsg: ChatMessage = {
            id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            from,
            fromName,
            message,
            type: 'taunt',
            timestamp: Date.now()
        };
        this.chatHistory.push(chatMsg);
        this.io.emit('chatMessage', chatMsg);
    }

    private addSystemMessage(message: string): void {
        const chatMsg: ChatMessage = {
            id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            from: 'system',
            fromName: 'Game',
            message,
            type: 'system',
            timestamp: Date.now()
        };
        this.chatHistory.push(chatMsg);
        this.io.emit('chatMessage', chatMsg);
    }

    private setThinking(playerId: string, isThinking: boolean): void {
        this.thinkingStates.set(playerId, isThinking);
        this.io.emit('thinkingState', { playerId, isThinking });
    }

    /**
     * Set player info
     */
    setPlayer(player: Player, info: Partial<PlayerInfo>): void {
        this.gameState.setPlayer(player, info);
    }

    /**
     * Register callback for game start
     */
    onGameStart(callback: () => void): void {
        this.onGameStartCallback = callback;
    }

    /**
     * Get game state manager
     */
    getGameState(): GameStateManager {
        return this.gameState;
    }

    /**
     * Check if game is started
     */
    isGameStarted(): boolean {
        return this.gameStarted;
    }

    /**
     * Start the server
     */
    async start(): Promise<void> {
        return new Promise((resolve) => {
            this.httpServer.listen(this.port, () => {
                console.log(`[GameServer] Tic-Tac-Toe server running on port ${this.port}`);
                resolve();
            });
        });
    }

    /**
     * Stop the server
     */
    async stop(): Promise<void> {
        return new Promise((resolve) => {
            this.io.close();
            this.httpServer.close(() => {
                console.log('[GameServer] Server stopped');
                resolve();
            });
        });
    }
}
