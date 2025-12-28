/**
 * Game Server - Express + WebSocket server for real-time game updates
 */

import express, { Express, Request, Response } from 'express';
import { createServer, Server as HttpServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import { GameStateManager } from '../engine/GameStateManager';
import { TurnOrchestrator } from '../engine/TurnOrchestrator';
import { GameTools } from '../mcp/GameTools';
import { Team, CommanderRole, GameConfig, TurnSummary, GameAction } from '../types/game';

export class GameServer {
  private app: Express;
  private httpServer: HttpServer;
  private io: SocketIOServer;
  private gameState: GameStateManager;
  private orchestrator: TurnOrchestrator;
  private gameTools: GameTools;
  private turnTimer: NodeJS.Timeout | null = null;
  private gameStarted: boolean = false;
  private onGameStartCallback: (() => void) | null = null;
  private onTurnCompleteCallback: ((turn: number, turnSummary: TurnSummary) => void) | null = null;
  private lastTurnSummary: TurnSummary | null = null;

  /**
   * Get model short name for a commander (for logging)
   */
  private getModelTag(commanderId: string): string {
    const commander = this.gameState.getState().commanders.find(c => c.id === commanderId);
    const model = (commander as any)?.model;
    if (!model) return commanderId;
    // Extract short name (after /)
    const shortName = model.split('/')[1] || model;
    return `${commanderId}|${shortName}`;
  }

  constructor(private port: number, private gameConfig: Partial<GameConfig> = {}) {
    this.app = express();
    this.httpServer = createServer(this.app);
    this.io = new SocketIOServer(this.httpServer, {
      cors: {
        origin: '*',
        methods: ['GET', 'POST']
      },
      pingTimeout: 120000,
      pingInterval: 30000
    });

    // Initialize game components
    this.gameState = new GameStateManager(`game-${Date.now()}`, this.gameConfig);
    this.orchestrator = new TurnOrchestrator(this.gameState);
    this.gameTools = new GameTools(this.gameState);

    this.setupMiddleware();
    this.setupRoutes();
    this.setupWebSocket();
  }

  /**
   * Setup Express middleware
   */
  private setupMiddleware(): void {
    this.app.use(cors());
    this.app.use(express.json());
    this.app.use(express.static('public'));
  }

  /**
   * Setup REST API routes
   */
  private setupRoutes(): void {
    // Health check
    this.app.get('/health', (req: Request, res: Response) => {
      res.json({ status: 'ok', gameId: this.gameState.getState().gameId });
    });

    // Get game state
    this.app.get('/api/game/state', (req: Request, res: Response) => {
      const state = this.gameState.getState();
      res.json({
        ...state,
        // Don't show resource control until game actually starts
        resourceControl: this.gameStarted 
          ? state.resourceControl 
          : { red: 0, blue: 0, neutral: 100 },
        gameStarted: this.gameStarted
      });
    });

    // Start game (triggers agent task assignment)
    this.app.post('/api/game/start', (req: Request, res: Response) => {
      console.log('🔥 POST /api/game/start received!');
      console.log('   gameStarted:', this.gameStarted);
      console.log('   callback exists:', !!this.onGameStartCallback);
      
      if (this.gameStarted) {
        console.log('⚠️  Game already started, rejecting request');
        res.status(400).json({ error: 'Game already started' });
        return;
      }
      
      this.gameStarted = true;
      
      // Broadcast full game state with gameStarted flag
      this.broadcastGameState();
      
      console.log('🎮 Game manually started by user!');
      
      // Trigger callback to agent orchestrator
      if (this.onGameStartCallback) {
        console.log('📞 Calling onGameStartCallback...');
        this.onGameStartCallback();
        console.log('✅ Callback completed!');
      } else {
        console.log('⚠️  No callback registered!');
      }
      
      res.json({ 
        success: true, 
        message: 'Game started! Agents are now receiving their missions.' 
      });
    });

    // Get commander view (with fog of war)
    this.app.get('/api/game/commander/:id', (req: Request, res: Response) => {
      try {
        const view = this.gameState.getCommanderView(req.params.id);
        res.json(view);
      } catch (error: any) {
        res.status(404).json({ error: error.message });
      }
    });

    // MCP Tool endpoints (called by AI commanders)
    this.app.post('/api/mcp/viewTerritory', (req: Request, res: Response) => {
      const { commanderId, territoryIds } = req.body;
      console.log(`🔍 [${this.getModelTag(commanderId)}] viewTerritory: ${territoryIds?.join(', ') || 'all'}`);
      const result = this.gameTools.viewTerritory(commanderId, territoryIds);
      
      // Broadcast action event (for activity feed)
      this.broadcastGameUpdate('action', {
        commanderId,
        action: 'view',
        timestamp: Date.now(),
        details: { territoryIds }
      });
      
      res.json(result);
    });

    this.app.post('/api/mcp/scanPerimeter', (req: Request, res: Response) => {
      const { commanderId } = req.body;
      console.log(`📡 [${this.getModelTag(commanderId)}] scanPerimeter`);
      const result = this.gameTools.scanPerimeter(commanderId);

      // Broadcast action event and state update
      this.broadcastGameUpdate('action', {
        commanderId,
        action: 'scan',
        timestamp: Date.now(),
        details: result
      });
      this.broadcastGameState();

      res.json(result);
    });

    this.app.post('/api/mcp/moveUnits', (req: Request, res: Response) => {
      const { commanderId, from, to, unitType, count } = req.body;
      console.log(`🚶 [${this.getModelTag(commanderId)}] moveUnits: ${count} ${unitType} from ${from} to ${to}`);
      const result = this.gameTools.moveUnits(commanderId, from, to, unitType, count);

      // Broadcast action event and state update
      this.broadcastGameUpdate('action', {
        commanderId,
        action: 'move',
        timestamp: Date.now(),
        details: { from, to, unitType, count }
      });
      this.broadcastGameState();

      res.json(result);
    });

    this.app.post('/api/mcp/fortifyPosition', (req: Request, res: Response) => {
      const { commanderId, territoryId } = req.body;
      console.log(`🏰 [${this.getModelTag(commanderId)}] fortifyPosition: ${territoryId}`);
      const result = this.gameTools.fortifyPosition(commanderId, territoryId);

      // Broadcast action event and state update
      this.broadcastGameUpdate('action', {
        commanderId,
        action: 'fortify',
        timestamp: Date.now(),
        details: { territoryId }
      });
      this.broadcastGameState();
      res.json(result);
    });

    this.app.post('/api/mcp/collectResources', (req: Request, res: Response) => {
      const { commanderId, territoryId } = req.body;
      console.log(`💰 [${this.getModelTag(commanderId)}] collectResources: ${territoryId}`);
      const result = this.gameTools.collectResources(commanderId, territoryId);

      // Broadcast action event and state update
      this.broadcastGameUpdate('action', {
        commanderId,
        action: 'collect',
        timestamp: Date.now(),
        details: { territoryId, amount: (result as any).amount }
      });
      this.broadcastGameState();
      res.json(result);
    });

    this.app.post('/api/mcp/getTeamStatus', (req: Request, res: Response) => {
      const { commanderId } = req.body;
      console.log(`📊 [${this.getModelTag(commanderId)}] getTeamStatus`);
      const result = this.gameTools.getTeamStatus(commanderId);
      
      // Broadcast action event (for activity feed, no state change)
      this.broadcastGameUpdate('action', {
        commanderId,
        action: 'status',
        timestamp: Date.now()
      });
      
      res.json(result);
    });

    this.app.post('/api/mcp/commitTurn', (req: Request, res: Response) => {
      const { commanderId, summary } = req.body;
      console.log(`✅ [${this.getModelTag(commanderId)}] commitTurn: "${summary?.substring(0, 50)}..."`);

      // Mark commander as ready
      this.orchestrator.markCommanderReady(commanderId);

      const result = this.gameTools.commitTurn(commanderId, summary);

      // Broadcast decision event for activity feed
      this.broadcastGameUpdate('decision', {
        commanderId,
        message: summary,
        timestamp: Date.now()
      });
      
      // Broadcast state update
      this.broadcastGameState();

      // If all commanders ready, execute turn
      if (this.orchestrator.areAllCommandersReady()) {
        this.executeTurn();
      }

      res.json(result);
    });

    this.app.post('/api/mcp/calculateOptimalPath', (req: Request, res: Response) => {
      const { commanderId, from, to, avoidEnemies } = req.body;
      console.log(`🗺️ [${this.getModelTag(commanderId)}] calculateOptimalPath: ${from} → ${to} (avoid enemies: ${avoidEnemies})`);
      const result = this.gameTools.calculateOptimalPath(commanderId, from, to, avoidEnemies);
      
      // Broadcast action event (for activity feed)
      this.broadcastGameUpdate('action', {
        commanderId,
        action: 'plan',
        timestamp: Date.now(),
        details: { from, to, avoidEnemies }
      });
      
      res.json(result);
    });

    // Endpoint to receive forwarded messaging events for comm logs
    this.app.post('/api/events/message', (req: Request, res: Response) => {
      const { type, fromAgentId, toAgentId, channelId, message, timestamp } = req.body;
      
      // Broadcast to dashboard as a 'message' event
      this.broadcastGameUpdate('message', {
        type,
        fromAgentId,
        toAgentId,
        channelId,
        message,
        timestamp
      });
      
      res.json({ success: true });
    });

    // Endpoint to set commander's LLM model
    this.app.post('/api/commander/:id/model', (req: Request, res: Response) => {
      const commanderId = req.params.id;
      const { model } = req.body;
      
      const commander = this.gameState.getState().commanders.find(c => c.id === commanderId);
      if (commander) {
        (commander as any).model = model;
        console.log(`🤖 [${commanderId}] assigned model: ${model}`);
        this.broadcastGameState();
        res.json({ success: true });
      } else {
        res.status(404).json({ error: 'Commander not found' });
      }
    });

    // Endpoint to receive agent thinking/reasoning events
    this.app.post('/api/events/thinking', (req: Request, res: Response) => {
      const { agentId, reasoning, timestamp } = req.body;
      
      // Broadcast to dashboard for agent activity display
      this.broadcastGameUpdate('agentThinking', {
        agentId,
        reasoning,
        timestamp
      });
      
      res.json({ success: true });
    });

    // Endpoint to receive agent LLM response events
    this.app.post('/api/events/response', (req: Request, res: Response) => {
      const { agentId, response, timestamp } = req.body;
      
      // Broadcast to dashboard for agent activity display
      this.broadcastGameUpdate('agentResponse', {
        agentId,
        response,
        timestamp
      });
      
      res.json({ success: true });
    });

    // Endpoint to receive agent tool activity events
    this.app.post('/api/events/activity', (req: Request, res: Response) => {
      const { agentId, tool, status, timestamp } = req.body;
      
      // Broadcast to dashboard for agent activity display
      this.broadcastGameUpdate('agentActivity', {
        agentId,
        tool,
        status, // 'calling', 'complete'
        timestamp
      });
      
      res.json({ success: true });
    });
  }

  /**
   * Setup WebSocket event handlers
   */
  private setupWebSocket(): void {
    this.io.on('connection', socket => {
      console.log(`[WebSocket] Client connected: ${socket.id}`);

      // Send initial game state with gameStarted flag
      const state = this.gameState.getState();
      socket.emit('gameState', {
        ...state,
        // Don't show resource control until game actually starts
        resourceControl: this.gameStarted 
          ? state.resourceControl 
          : { red: 0, blue: 0, neutral: 100 },
        gameStarted: this.gameStarted
      });

      // Handle commander registration
      socket.on('registerCommander', (data: { commanderId: string }) => {
        socket.join(`commander-${data.commanderId}`);
        console.log(`[WebSocket] Commander ${data.commanderId} registered`);
      });

      socket.on('disconnect', () => {
        console.log(`[WebSocket] Client disconnected: ${socket.id}`);
      });
    });
  }

  /**
   * Broadcast game update to all connected clients
   */
  private broadcastGameUpdate(eventType: string, data: any): void {
    this.io.emit(eventType, data);
  }

  /**
   * Broadcast current game state to all connected clients
   * Always includes gameStarted flag
   */
  private broadcastGameState(): void {
    // Update resource control before broadcasting so dashboard shows current values
    this.gameState.updateResourceControl();
    
    const state = this.gameState.getState();
    this.io.emit('gameState', {
      ...state,
      // Don't show resource control until game actually starts
      resourceControl: this.gameStarted 
        ? state.resourceControl 
        : { red: 0, blue: 0, neutral: 100 },
      gameStarted: this.gameStarted
    });
  }

  /**
   * Execute turn and broadcast results
   */
  private executeTurn(): void {
    console.log('\n🎮 Executing turn...');

    const turnSummary = this.orchestrator.executeTurn();
    
    // Store for later access
    this.lastTurnSummary = turnSummary;

    // Broadcast full game state update
    this.broadcastGameState();

    // Get current turn number after execution
    const currentTurn = this.gameState.getState().turn;

    // Check if game is over
    if (this.gameState.isGameOver()) {
      const state = this.gameState.getState();
      console.log(`\n🏆 Game Over! Winner: ${state.winner}`);

      this.broadcastGameUpdate('gameOver', {
        winner: state.winner,
        finalState: state
      });
    } else {
      // Notify that turn is complete and agents should start next turn
      // Pass the turn summary so agents can get a summary of their previous actions
      if (this.onTurnCompleteCallback) {
        this.onTurnCompleteCallback(currentTurn, turnSummary);
      }
    }
  }

  /**
   * Add a commander to the game
   */
  addCommander(
    id: string,
    name: string,
    team: Team,
    role: CommanderRole,
    agentId: string
  ): void {
    const commander = this.gameState.addCommander(id, name, team, role, agentId);

    console.log(`✅ Added commander: ${name} (${team} ${role})`);

    // Broadcast full game state (includes new commander)
    this.broadcastGameState();
  }

  /**
   * Start the game server
   */
  async start(): Promise<void> {
    return new Promise(resolve => {
      this.httpServer.listen(this.port, () => {
        console.log(`\n🎮 Fog of War Game Server running on port ${this.port}`);
        console.log(`   Game ID: ${this.gameState.getState().gameId}`);
        console.log(`   WebSocket: ws://localhost:${this.port}`);
        console.log(`   API: http://localhost:${this.port}/api`);
        resolve();
      });
    });
  }

  /**
   * Stop the game server
   */
  async stop(): Promise<void> {
    if (this.turnTimer) {
      clearTimeout(this.turnTimer);
    }

    return new Promise(resolve => {
      this.io.close(() => {
        this.httpServer.close(() => {
          console.log('\n🛑 Game server stopped');
          resolve();
        });
      });
    });
  }

  /**
   * Get game state manager
   */
  getGameState(): GameStateManager {
    return this.gameState;
  }

  /**
   * Get Socket.IO server instance for external event listening
   */
  getSocketServer(): SocketIOServer {
    return this.io;
  }

  /**
   * Get turn orchestrator
   */
  getOrchestrator(): TurnOrchestrator {
    return this.orchestrator;
  }

  /**
   * Set callback to be invoked when game is manually started
   */
  onGameStart(callback: () => void): void {
    this.onGameStartCallback = callback;
  }

  /**
   * Set callback to be invoked when a turn completes
   * @param callback - Receives turn number and summary of executed actions
   */
  onTurnComplete(callback: (turn: number, turnSummary: TurnSummary) => void): void {
    this.onTurnCompleteCallback = callback;
  }
  
  /**
   * Get the summary from the last executed turn
   */
  getLastTurnSummary(): TurnSummary | null {
    return this.lastTurnSummary;
  }
}
