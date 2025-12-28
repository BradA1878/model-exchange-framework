/**
 * Go Fish Game Server
 * Express + Socket.IO server for real-time game updates
 */

import express, { Application, Request, Response } from 'express';
import { createServer, Server as HttpServer } from 'http';
import { Server as SocketServer, Socket } from 'socket.io';
import cors from 'cors';
import { GameStateManager } from '../engine/GameStateManager';
import { Rank } from '../types/game';

interface ChatMessage {
    id: string;
    from: string;
    fromName: string;
    message: string;
    type: 'ask' | 'response' | 'system' | 'taunt';
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

    constructor(port: number = 3006) {
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
            res.json({ status: 'ok', game: 'go-fish' });
        });

        // Get full game state
        this.app.get('/api/game/state', (_req: Request, res: Response) => {
            res.json(this.gameState.getPublicState());
        });

        // Get chat history
        this.app.get('/api/game/chat', (_req: Request, res: Response) => {
            res.json(this.chatHistory);
        });

        // Start game
        this.app.post('/api/game/start', (_req: Request, res: Response) => {
            if (!this.gameStarted) {
                this.gameStarted = true;
                this.gameState.dealCards();
                this.onGameStartCallback?.();
                this.addSystemMessage('Cards dealt! Let the fishing begin!');
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
            this.io.emit('gameReset', this.gameState.getPublicState());
            res.json({ success: true });
        });

        // MCP Tool: Get hand
        this.app.post('/api/mcp/getHand', (req: Request, res: Response) => {
            const { playerId } = req.body;
            const view = this.gameState.getPlayerView(playerId);
            const state = this.gameState.getPublicState();
            const otherPlayers = this.gameState.getOtherPlayers(playerId);

            if (!view) {
                res.json({ success: false, error: `Unknown player: ${playerId}` });
                return;
            }

            // Format hand for easy reading
            const handByRank: Record<string, number> = {};
            for (const card of view.hand) {
                handByRank[card.rank] = (handByRank[card.rank] || 0) + 1;
            }

            const isYourTurn = this.gameState.isPlayerTurn(playerId);
            const ranksYouCanAskFor = this.gameState.getPlayerRanks(playerId);

            res.json({
                success: true,
                actionType: 'INFO_ONLY',
                note: '✅ HAND INFO retrieved - Do NOT call game_getHand again until your next turn!',
                yourHand: view.hand,
                handSummary: Object.entries(handByRank).map(([rank, count]) => `${rank}×${count}`).join(', '),
                handCount: view.handCount,
                yourBooks: view.books,
                isYourTurn,
                currentPlayer: state.players[state.currentPlayerIndex]?.name || '',
                otherPlayers: otherPlayers,
                deckCount: state.deckCount,
                gameOver: state.gameOver,
                ranksYouCanAskFor,
                requiredNextStep: isYourTurn 
                    ? `🚨 YOUR TURN! You MUST call game_askForCards with: targetPlayerId="${otherPlayers[0]?.id}", rank="${ranksYouCanAskFor[0] || 'A'}" (pick a rank from your hand)`
                    : '⏸️ NOT YOUR TURN - Wait for your turn. Do NOT call any tools until it is your turn.'
            });
        });

        // MCP Tool: Ask for cards
        this.app.post('/api/mcp/askForCards', (req: Request, res: Response) => {
            const { playerId, targetPlayerId, rank } = req.body;

            // Add chat message for the ask
            const state = this.gameState.getPublicState();
            const askingPlayer = state.players.find(p => p.id === playerId);
            const targetPlayer = state.players.find(p => p.id === targetPlayerId);

            if (askingPlayer && targetPlayer) {
                this.addChatMessage(playerId, askingPlayer.name, `"${targetPlayer.name}, do you have any ${rank}s?"`, 'ask');
            }

            const result = this.gameState.askForCards(playerId, targetPlayerId, rank as Rank);

            // Add response message
            if (result.goFish && targetPlayer) {
                this.addChatMessage(targetPlayerId, targetPlayer.name, `"Go Fish!"`, 'response');
            } else if (result.success && result.cardsReceived > 0 && targetPlayer) {
                this.addChatMessage(targetPlayerId, targetPlayer.name, `*hands over ${result.cardsReceived} ${rank}(s)*`, 'response');
            }

            // Clear thinking state
            this.setThinking(playerId, false);

            // Determine if this was a valid action (Go Fish is valid, just means opponent didn't have cards)
            const isValidAction = result.success || result.goFish;
            const turnEnded = !result.yourTurnContinues;

            // Enhanced response with clear guidance
            res.json({
                ...result,
                actionType: 'ACTION',
                note: isValidAction
                    ? (result.goFish 
                        ? `✅ Go Fish! ${targetPlayer?.name || targetPlayerId} didn't have ${rank}s. You drew a card.`
                        : `✅ Got ${result.cardsReceived} ${rank}(s) from ${targetPlayer?.name || targetPlayerId}!`)
                    : `❌ ERROR - ${(result as any).message || 'Invalid action'}`,
                requiredNextStep: isValidAction
                    ? (turnEnded 
                        ? '🛑 TURN ENDED! Call task_complete() now.'
                        : '🎯 YOUR TURN CONTINUES! Ask for another rank.')
                    : '🔄 Fix the error and try again.'
            });
        });

        // MCP Tool: Taunt
        this.app.post('/api/mcp/taunt', (req: Request, res: Response) => {
            const { playerId, message } = req.body;
            const state = this.gameState.getPublicState();
            const player = state.players.find(p => p.id === playerId);

            if (!player) {
                res.json({ success: false, error: `Unknown player: ${playerId}` });
                return;
            }

            this.addChatMessage(playerId, player.name, message, 'taunt');
            res.json({ 
                success: true, 
                actionType: 'OPTIONAL',
                note: '✅ Taunt sent! This is optional and does not affect gameplay.',
                message: 'Taunt sent!'
            });
        });

        // Events from connect-agents
        this.app.post('/api/events/thinking', (req: Request, res: Response) => {
            const { agentId, reasoning } = req.body;
            this.setThinking(agentId, true);
            this.io.emit('agentThinking', { agentId, reasoning, timestamp: Date.now() });
            res.json({ success: true });
        });

        this.app.post('/api/events/response', (req: Request, res: Response) => {
            const { agentId, response } = req.body;
            this.setThinking(agentId, false);
            this.io.emit('agentResponse', { agentId, response, timestamp: Date.now() });
            res.json({ success: true });
        });

        // Register player model
        this.app.post('/api/player/:playerId/model', (req: Request, res: Response) => {
            const { playerId } = req.params;
            const { model } = req.body;
            this.gameState.setPlayerModel(playerId, model);
            res.json({ success: true });
        });
    }

    private setupSocketHandlers(): void {
        this.io.on('connection', (socket: Socket) => {
            console.log(`[GameServer] Client connected: ${socket.id}`);

            socket.emit('gameState', this.gameState.getPublicState());
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

        this.gameState.onGameOverCallback((winnerId, winnerName) => {
            this.addSystemMessage(`Game Over! ${winnerName} wins!`);
            this.io.emit('gameOver', { winnerId, winnerName, state: this.gameState.getPublicState() });
        });
    }

    private addChatMessage(from: string, fromName: string, message: string, type: 'ask' | 'response' | 'taunt'): void {
        const chatMsg: ChatMessage = {
            id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            from,
            fromName,
            message,
            type,
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
     * Add a player
     */
    addPlayer(id: string, name: string, model: string = '', personality: string = ''): void {
        this.gameState.addPlayer(id, name, model, personality);
    }

    /**
     * Register game start callback
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
     * Check if game started
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
                console.log(`[GameServer] Go Fish server running on port ${this.port}`);
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
