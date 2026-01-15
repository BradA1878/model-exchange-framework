/**
 * Twenty Questions Game Server
 * Express + Socket.IO server for real-time game updates
 *
 * This server showcases ORPAR cognitive cycles by:
 * - Tracking phase events from agents
 * - Broadcasting cycle progress to observers
 * - Recording phase timings for analysis
 */

import express, { Application, Request, Response } from 'express';
import { createServer, Server as HttpServer } from 'http';
import { Server as SocketServer, Socket } from 'socket.io';
import cors from 'cors';
import { GameStateManager } from '../engine/GameStateManager';
import { PlayerRole, PlayerInfo, GamePhase } from '../types/game';

interface ChatMessage {
    id: string;
    from: string;
    fromName: string;
    message: string;
    type: 'question' | 'answer' | 'guess' | 'system' | 'orpar';
    timestamp: number;
}

interface OrparEvent {
    agentId: string;
    role: PlayerRole;
    phase: string;
    summary: string;
    timestamp: number;
}

export class GameServer {
    private app: Application;
    private httpServer: HttpServer;
    private io: SocketServer;
    private gameState: GameStateManager;
    private port: number;
    private chatHistory: ChatMessage[] = [];
    private orparEvents: OrparEvent[] = [];
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
            res.json({ status: 'ok', game: 'twenty-questions' });
        });

        // Get full game state
        this.app.get('/api/game/state', (_req: Request, res: Response) => {
            res.json(this.gameState.getState());
        });

        // Get chat history
        this.app.get('/api/game/chat', (_req: Request, res: Response) => {
            res.json(this.chatHistory);
        });

        // Get ORPAR events for visualization
        this.app.get('/api/game/orpar', (_req: Request, res: Response) => {
            res.json(this.orparEvents);
        });

        // Start game (called from dashboard or connect-agents)
        this.app.post('/api/game/start', (_req: Request, res: Response) => {
            if (!this.gameStarted) {
                this.gameStarted = true;
                this.onGameStartCallback?.();
                this.addSystemMessage('Game started! Thinker is choosing a secret...');
                // Emit game:started event for event-driven flow
                this.io.emit('game:started', { timestamp: Date.now() });
                res.json({ success: true, message: 'Game started' });
            } else {
                res.json({ success: false, message: 'Game already started' });
            }
        });

        // Reset game
        this.app.post('/api/game/reset', (_req: Request, res: Response) => {
            this.gameState.reset();
            this.chatHistory = [];
            this.orparEvents = [];
            this.gameStarted = false;
            this.addSystemMessage('Game reset! Waiting to start...');
            this.io.emit('gameReset', this.gameState.getState());
            res.json({ success: true });
        });

        // MCP Tool Endpoints
        this.app.post('/api/mcp/getState', (req: Request, res: Response) => {
            const { playerId } = req.body;
            const role = this.gameState.getAgentRole(playerId);

            if (!role) {
                res.json({
                    success: false,
                    message: `Unknown player: ${playerId}`,
                    state: null
                });
                return;
            }

            res.json({
                success: true,
                state: this.gameState.getStateView(role),
                summary: this.gameState.getStateSummary(role)
            });
        });

        this.app.post('/api/mcp/setSecret', (req: Request, res: Response) => {
            const { playerId, secret, category } = req.body;
            const result = this.gameState.setSecret(playerId, secret, category);

            if (result.success) {
                this.addSystemMessage(`Secret set! Category: "${category}". Let the guessing begin!`);
                this.setThinking(playerId, false);
            }

            res.json(result);
        });

        this.app.post('/api/mcp/askQuestion', (req: Request, res: Response) => {
            const { playerId, question } = req.body;
            const result = this.gameState.askQuestion(playerId, question);

            if (result.success) {
                const role = this.gameState.getAgentRole(playerId);
                const name = role ? this.gameState.getState().players[role].name : 'Guesser';
                this.addQuestionMessage(playerId, name, question, result.questionNumber || 0);
                this.setThinking(playerId, false);
            }

            res.json(result);
        });

        this.app.post('/api/mcp/answerQuestion', (req: Request, res: Response) => {
            const { playerId, answer, reasoning } = req.body;
            const result = this.gameState.answerQuestion(playerId, answer, reasoning);

            if (result.success) {
                const role = this.gameState.getAgentRole(playerId);
                const name = role ? this.gameState.getState().players[role].name : 'Thinker';
                this.addAnswerMessage(playerId, name, answer, result.questionNumber || 0);
                this.setThinking(playerId, false);
            }

            res.json(result);
        });

        this.app.post('/api/mcp/makeGuess', (req: Request, res: Response) => {
            const { playerId, guess } = req.body;
            const result = this.gameState.makeGuess(playerId, guess);

            if (result.success) {
                const role = this.gameState.getAgentRole(playerId);
                const name = role ? this.gameState.getState().players[role].name : 'Guesser';
                this.addGuessMessage(playerId, name, guess, result.correct || false, result.secretThing || '');
                this.setThinking(playerId, false);
            }

            res.json(result);
        });

        // ORPAR Phase Events (from connect-agents.ts)
        this.app.post('/api/events/orpar', (req: Request, res: Response) => {
            const { agentId, role, phase, summary } = req.body;

            const event: OrparEvent = {
                agentId,
                role,
                phase,
                summary,
                timestamp: Date.now()
            };

            this.orparEvents.push(event);
            this.gameState.logOrparPhase(role, phase, summary);

            // Broadcast to dashboard
            this.io.emit('orparEvent', event);

            // Add ORPAR message to chat for visibility
            this.addOrparMessage(agentId, role, phase, summary);

            res.json({ success: true });
        });

        // Thinking state events
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

        // Register player
        this.app.post('/api/player/:role/register', (req: Request, res: Response) => {
            const { role } = req.params as { role: PlayerRole };
            const { agentId, name, model, personality } = req.body;

            if (role !== 'thinker' && role !== 'guesser') {
                res.json({ success: false, message: `Invalid role: ${role}` });
                return;
            }

            this.gameState.setPlayer(role, { agentId, name, model, personality });
            this.addSystemMessage(`${name} joined as ${role.toUpperCase()}`);

            res.json({ success: true });
        });
    }

    private setupSocketHandlers(): void {
        this.io.on('connection', (socket: Socket) => {
            console.log(`[GameServer] Client connected: ${socket.id}`);

            // Send current state on connect
            socket.emit('gameState', this.gameState.getState());
            socket.emit('chatHistory', this.chatHistory);
            socket.emit('orparHistory', this.orparEvents);
            socket.emit('thinkingStates', Object.fromEntries(this.thinkingStates));

            socket.on('disconnect', () => {
                console.log(`[GameServer] Client disconnected: ${socket.id}`);
            });
        });
    }

    private setupGameCallbacks(): void {
        // Track previous state for detecting specific changes
        let previousTurn: string | null = null;
        let previousPhase: string | null = null;

        this.gameState.onStateChangeCallback((state) => {
            // Emit general state update
            this.io.emit('gameState', state);

            // Emit specific game:stateChanged event for event-driven flow
            this.io.emit('game:stateChanged', {
                phase: state.phase,
                currentTurn: state.currentTurn,
                questionsAsked: state.questionsAsked,
                gameOver: state.gameOver,
                timestamp: Date.now()
            });

            // Detect turn changes
            if (previousTurn !== null && previousTurn !== state.currentTurn) {
                this.io.emit('game:turnChanged', {
                    previousTurn,
                    currentTurn: state.currentTurn,
                    timestamp: Date.now()
                });
            }
            previousTurn = state.currentTurn;
        });

        this.gameState.onGameOverCallback((winner) => {
            const message = winner === 'none'
                ? "Time's up! Neither player wins."
                : `${winner.toUpperCase()} wins the game!`;
            this.addSystemMessage(message);
            this.io.emit('gameOver', { winner, state: this.gameState.getState() });
            this.io.emit('game:gameOver', { winner, timestamp: Date.now() });
        });

        this.gameState.onPhaseChangeCallback((phase, role) => {
            this.io.emit('phaseChange', { phase, role, timestamp: Date.now() });

            // Emit specific game:phaseChanged event for event-driven flow
            this.io.emit('game:phaseChanged', { phase, role, timestamp: Date.now() });

            // Detect when secret is set (phase changes from 'setup' to 'questioning')
            if (previousPhase === 'setup' && phase === 'questioning') {
                this.io.emit('game:secretSet', { timestamp: Date.now() });
            }
            previousPhase = phase;
        });
    }

    private addQuestionMessage(from: string, fromName: string, question: string, questionNumber: number): void {
        const chatMsg: ChatMessage = {
            id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            from,
            fromName,
            message: `Q${questionNumber}: ${question}`,
            type: 'question',
            timestamp: Date.now()
        };
        this.chatHistory.push(chatMsg);
        this.io.emit('chatMessage', chatMsg);
    }

    private addAnswerMessage(from: string, fromName: string, answer: string, questionNumber: number): void {
        const chatMsg: ChatMessage = {
            id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            from,
            fromName,
            message: `A${questionNumber}: ${answer.toUpperCase()}`,
            type: 'answer',
            timestamp: Date.now()
        };
        this.chatHistory.push(chatMsg);
        this.io.emit('chatMessage', chatMsg);
    }

    private addGuessMessage(from: string, fromName: string, guess: string, correct: boolean, secret: string): void {
        const emoji = correct ? '🎉' : '❌';
        const result = correct ? 'CORRECT!' : `WRONG! It was "${secret}"`;
        const chatMsg: ChatMessage = {
            id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            from,
            fromName,
            message: `${emoji} Final Guess: "${guess}" - ${result}`,
            type: 'guess',
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

    private addOrparMessage(agentId: string, role: PlayerRole, phase: string, summary: string): void {
        const chatMsg: ChatMessage = {
            id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            from: agentId,
            fromName: `${role.toUpperCase()} [${phase}]`,
            message: summary,
            type: 'orpar',
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
    setPlayer(role: PlayerRole, info: Partial<PlayerInfo>): void {
        this.gameState.setPlayer(role, info);
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
                console.log(`[GameServer] Twenty Questions server running on port ${this.port}`);
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
