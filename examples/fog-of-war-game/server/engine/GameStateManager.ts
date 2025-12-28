/**
 * Game State Manager - Central authority for game state
 */

import {
  GameState,
  GameConfig,
  Commander,
  Team,
  CommanderRole,
  Unit,
  UnitType,
  Position,
  GameAction,
  Tile,
  DEFAULT_GAME_CONFIG
} from '../types/game';
import { MapGenerator } from './MapGenerator';
import { FogOfWarSystem } from './FogOfWarSystem';

export class GameStateManager {
  private state: GameState;
  private config: GameConfig;

  constructor(gameId: string, config: Partial<GameConfig> = {}) {
    this.config = { ...DEFAULT_GAME_CONFIG, ...config };
    this.state = this.initializeGame(gameId);
  }

  /**
   * Initialize a new game
   */
  private initializeGame(gameId: string): GameState {
    const map = MapGenerator.generateMap(this.config.mapSize);

    return {
      gameId,
      turn: 0,
      phase: 'planning',
      map,
      commanders: [],
      currentActions: [],
      winner: null,
      resourceControl: {
        red: 0,
        blue: 0,
        neutral: 100
      },
      startTime: Date.now(),
      lastUpdateTime: Date.now()
    };
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
  ): Commander {
    // Determine starting position based on team
    const startPos = this.getStartingPosition(team, this.state.commanders.length);

    // Create starting units
    const units = this.createStartingUnits(id, team, startPos);

    const commander: Commander = {
      id,
      name,
      team,
      role,
      agentId,
      resources: this.config.startingResources,
      controlledTerritories: [startPos],
      visibility: [],
      units,
      status: 'active'
    };

    // Update visibility
    commander.visibility = FogOfWarSystem.calculateVisibility(
      commander,
      this.state.map,
      this.config.fogOfWarRadius
    );

    this.state.commanders.push(commander);

    // Place units on map
    units.forEach(unit => {
      this.state.map[startPos.y][startPos.x].units.push(unit);
    });

    // Update map ownership
    this.state.map[startPos.y][startPos.x].owner = team;

    return commander;
  }

  /**
   * Get starting position for a commander
   */
  private getStartingPosition(team: Team, commanderIndex: number): Position {
    const size = this.config.mapSize;
    const positions: Record<Team, Position[]> = {
      [Team.RED]: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 0, y: 1 },
        { x: 1, y: 1 }
      ],
      [Team.BLUE]: [
        { x: size - 2, y: size - 2 },
        { x: size - 1, y: size - 2 },
        { x: size - 2, y: size - 1 },
        { x: size - 1, y: size - 1 }
      ],
      [Team.NEUTRAL]: []
    };

    const teamPositions = positions[team];
    return teamPositions[commanderIndex % teamPositions.length];
  }

  /**
   * Create starting units for a commander
   */
  private createStartingUnits(commanderId: string, team: Team, position: Position): Unit[] {
    return [
      {
        id: `${commanderId}-infantry`,
        type: UnitType.INFANTRY,
        team,
        count: this.config.startingUnits.infantry,
        health: 100,
        position,
        commanderId
      },
      {
        id: `${commanderId}-cavalry`,
        type: UnitType.CAVALRY,
        team,
        count: this.config.startingUnits.cavalry,
        health: 100,
        position,
        commanderId
      },
      {
        id: `${commanderId}-archers`,
        type: UnitType.ARCHERS,
        team,
        count: this.config.startingUnits.archers,
        health: 100,
        position,
        commanderId
      }
    ];
  }

  /**
   * Get the current game state
   */
  getState(): GameState {
    return this.state;
  }

  /**
   * Get a commander-specific view with fog of war applied
   */
  getCommanderView(commanderId: string) {
    const commander = this.state.commanders.find(c => c.id === commanderId);
    if (!commander) {
      throw new Error(`Commander ${commanderId} not found`);
    }

    // Calculate visibility
    const visibleMap = FogOfWarSystem.getVisibleMap(
      commander,
      this.state.map,
      this.config.fogOfWarRadius
    );

    // Get visible enemy units
    const visibleEnemyUnits = visibleMap
      .flat()
      .flatMap(tile => tile.units.filter(unit => unit.team !== commander.team));

    // Get team status
    const teamCommanders = this.state.commanders.filter(c => c.team === commander.team);

    return {
      commanderId: commander.id,
      team: commander.team,
      role: commander.role,
      visibleTiles: visibleMap,
      ownUnits: commander.units,
      knownEnemyUnits: visibleEnemyUnits,
      resources: commander.resources,
      controlledTerritories: commander.controlledTerritories.length,
      teamResources: teamCommanders.reduce((sum, c) => sum + c.resources, 0),
      teamStatus: teamCommanders.map(c => ({
        commanderId: c.id,
        name: c.name,
        role: c.role,
        status: c.status
      }))
    };
  }

  /**
   * Queue an action for execution
   */
  queueAction(action: GameAction): void {
    action.status = 'pending';
    action.timestamp = Date.now();
    this.state.currentActions.push(action);
  }

  /**
   * Advance to next turn
   */
  advanceTurn(): void {
    this.state.turn++;
    this.state.currentActions = [];
    this.state.phase = 'planning';
    this.state.lastUpdateTime = Date.now();

    // Update visibility for all commanders
    this.state.commanders.forEach(commander => {
      commander.visibility = FogOfWarSystem.calculateVisibility(
        commander,
        this.state.map,
        this.config.fogOfWarRadius
      );
    });

    // Check for victory conditions
    this.checkVictoryConditions();
  }

  /**
   * Check if victory conditions are met
   */
  private checkVictoryConditions(): void {
    this.updateResourceControl();

    // Check resource control victory
    if (this.state.resourceControl.red >= this.config.victoryThreshold * 100) {
      this.state.winner = Team.RED;
      this.state.phase = 'completed';
    } else if (this.state.resourceControl.blue >= this.config.victoryThreshold * 100) {
      this.state.winner = Team.BLUE;
      this.state.phase = 'completed';
    }

    // Check turn limit
    if (this.state.turn >= this.config.maxTurns) {
      this.state.winner =
        this.state.resourceControl.red > this.state.resourceControl.blue
          ? Team.RED
          : Team.BLUE;
      this.state.phase = 'completed';
    }

    // Check if one team is eliminated
    const activeRed = this.state.commanders.filter(
      c => c.team === Team.RED && c.status === 'active'
    );
    const activeBlue = this.state.commanders.filter(
      c => c.team === Team.BLUE && c.status === 'active'
    );

    if (activeRed.length === 0) {
      this.state.winner = Team.BLUE;
      this.state.phase = 'completed';
    } else if (activeBlue.length === 0) {
      this.state.winner = Team.RED;
      this.state.phase = 'completed';
    }
  }

  /**
   * Update resource control percentages
   * Public so GameServer can call it before broadcasting state
   */
  public updateResourceControl(): void {
    let redControl = 0;
    let blueControl = 0;
    let totalResources = 0;

    this.state.map.forEach(row => {
      row.forEach(tile => {
        totalResources += tile.resourceValue;
        if (tile.owner === Team.RED) {
          redControl += tile.resourceValue;
        } else if (tile.owner === Team.BLUE) {
          blueControl += tile.resourceValue;
        }
      });
    });

    this.state.resourceControl = {
      red: (redControl / totalResources) * 100,
      blue: (blueControl / totalResources) * 100,
      neutral: ((totalResources - redControl - blueControl) / totalResources) * 100
    };
  }

  /**
   * Get tile at position
   */
  getTile(position: Position): Tile | null {
    if (
      position.x < 0 ||
      position.x >= this.config.mapSize ||
      position.y < 0 ||
      position.y >= this.config.mapSize
    ) {
      return null;
    }
    return this.state.map[position.y][position.x];
  }

  /**
   * Update tile ownership
   */
  updateTileOwnership(position: Position, newOwner: Team): void {
    const tile = this.getTile(position);
    if (tile) {
      tile.owner = newOwner;

      // Update commander's controlled territories
      this.state.commanders.forEach(commander => {
        if (commander.team === newOwner) {
          if (
            !commander.controlledTerritories.some(
              p => p.x === position.x && p.y === position.y
            )
          ) {
            commander.controlledTerritories.push(position);
          }
        } else {
          commander.controlledTerritories = commander.controlledTerritories.filter(
            p => !(p.x === position.x && p.y === position.y)
          );
        }
      });
    }
  }

  /**
   * Get game configuration
   */
  getConfig(): GameConfig {
    return this.config;
  }

  /**
   * Check if game is over
   */
  isGameOver(): boolean {
    return this.state.phase === 'completed';
  }
}
