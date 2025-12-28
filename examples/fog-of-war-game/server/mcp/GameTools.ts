/**
 * MCP Tools for Fog of War Game
 * These tools are exposed to AI commanders for game interaction
 */

import { GameStateManager } from '../engine/GameStateManager';
import { MapGenerator } from '../engine/MapGenerator';
import { FogOfWarSystem } from '../engine/FogOfWarSystem';
import { CombatSystem } from '../engine/CombatSystem';
import { Team, Position, UnitType, GameAction } from '../types/game';

export class GameTools {
  // Cache for scan results per commander per turn
  private scanCache: Map<string, { turn: number; result: any }> = new Map();
  
  constructor(private gameState: GameStateManager) {}

  /**
   * VIEW_TERRITORY - Get information about specific territories
   */
  viewTerritory(commanderId: string, territoryIds: string[]) {
    const commander = this.gameState
      .getState()
      .commanders.find(c => c.id === commanderId);
    if (!commander) {
      return { error: 'Commander not found' };
    }

    const territories = territoryIds
      .map(id => {
        const pos = MapGenerator.idToPosition(id);
        if (!pos) return null;

        const tile = this.gameState.getTile(pos);
        if (!tile) return null;

        // Check if tile is visible
        const isVisible = FogOfWarSystem.isPositionVisible(
          pos,
          commander,
          this.gameState.getState().map,
          this.gameState.getConfig().fogOfWarRadius
        );

        return {
          id,
          terrain: tile.terrain,
          owner: isVisible ? tile.owner : Team.NEUTRAL,
          resources: isVisible ? tile.resourceValue : 0,
          units: isVisible
            ? tile.units.map(u => ({
                type: u.type,
                count: u.count,
                team: u.team
              }))
            : [],
          fortification: isVisible ? tile.fortificationLevel : 0,
          visible: isVisible
        };
      })
      .filter(t => t !== null);

    return {
      success: true,
      actionType: 'INFO_ONLY',
      note: '✅ TERRITORY INFO retrieved - Do NOT call viewTerritory again for same tiles!',
      territories,
      requiredNextStep: '🚨 NOW: Take 1-2 actions (moveUnits/fortifyPosition/collectResources), then call game_commitTurn!'
    };
  }

  /**
   * SCAN_PERIMETER - Get compact intelligence summary about visible area
   * Returns categorized tile IDs for efficient LLM processing.
   * Use game_viewTerritory(tileIds) to get full details on specific tiles.
   * NOTE: Cached per turn - calling multiple times returns same result.
   */
  scanPerimeter(commanderId: string) {
    const commander = this.gameState
      .getState()
      .commanders.find(c => c.id === commanderId);
    if (!commander) {
      return { error: 'Commander not found' };
    }
    
    const currentTurn = this.gameState.getState().turn;
    const cacheKey = `${commanderId}-scan`;
    const cached = this.scanCache.get(cacheKey);
    
    // Return cached result if already scanned this turn
    if (cached && cached.turn === currentTurn) {
      return {
        ...cached.result,
        cached: true,
        warning: '⚠️ ALREADY SCANNED THIS TURN - visibility unchanged. STOP scanning and proceed to ACTION phase!',
        requiredNextStep: '🚨 NOW: Choose an action (moveUnits, fortifyPosition, collectResources) then call game_commitTurn!'
      };
    }

    // Get visibility positions (only actually visible tiles)
    const visibilityPositions = FogOfWarSystem.calculateVisibility(
      commander,
      this.gameState.getState().map,
      this.gameState.getConfig().fogOfWarRadius
    );

    // Get actual tile data for visible positions
    const map = this.gameState.getState().map;
    const visibleTiles = visibilityPositions.map(pos => map[pos.y][pos.x]);

    // Categorize tiles by ownership and features
    const friendlyTiles: string[] = [];
    const enemyTiles: string[] = [];
    const neutralTiles: string[] = [];
    const tilesWithResources: string[] = [];
    const tilesWithEnemyUnits: string[] = [];
    const tilesWithFriendlyUnits: string[] = [];

    visibleTiles.forEach(tile => {
      const tileId = MapGenerator.positionToId(tile.position);
      
      // Categorize by ownership
      if (tile.owner === commander.team) {
        friendlyTiles.push(tileId);
      } else if (tile.owner === Team.NEUTRAL) {
        neutralTiles.push(tileId);
      } else {
        enemyTiles.push(tileId);
      }

      // Categorize by features
      if (tile.resourceValue > 0) {
        tilesWithResources.push(tileId);
      }
      if (tile.units.some(u => u.team !== commander.team)) {
        tilesWithEnemyUnits.push(tileId);
      }
      if (tile.units.some(u => u.team === commander.team)) {
        tilesWithFriendlyUnits.push(tileId);
      }
    });

    // Count enemy units for threat assessment
    const enemyUnitCount = visibleTiles
      .flatMap(tile => tile.units.filter(u => u.team !== commander.team))
      .reduce((sum, unit) => sum + unit.count, 0);

    // Determine threat level
    let threatLevel: string;
    if (enemyUnitCount === 0) {
      threatLevel = 'none';
    } else if (enemyUnitCount < 50) {
      threatLevel = 'low';
    } else if (enemyUnitCount < 150) {
      threatLevel = 'moderate';
    } else {
      threatLevel = 'high';
    }

    // Get text intelligence summary
    const intelligence = FogOfWarSystem.getIntelligenceSummary(
      commander,
      this.gameState.getState().map,
      this.gameState.getConfig().fogOfWarRadius
    );

    const result = {
      success: true,
      actionType: 'INFO_ONLY',
      note: '✅ SCAN COMPLETE - Do NOT call scanPerimeter again this turn!',
      visibleTileIds: visibleTiles.map(t => MapGenerator.positionToId(t.position)),
      summary: {
        friendlyTiles,
        enemyTiles,
        neutralTiles,
        tilesWithResources,
        tilesWithEnemyUnits,
        tilesWithFriendlyUnits
      },
      threatLevel,
      intelligence,
      requiredNextStep: '🚨 NOW: Take 1-2 actions (moveUnits/fortifyPosition/collectResources), then call game_commitTurn!'
    };
    
    // Cache the result for this turn
    this.scanCache.set(cacheKey, { turn: currentTurn, result });
    
    return result;
  }

  /**
   * MOVE_UNITS - Move units from one territory to another
   */
  moveUnits(
    commanderId: string,
    from: string,
    to: string,
    unitType: UnitType,
    count: number
  ) {
    const commander = this.gameState
      .getState()
      .commanders.find(c => c.id === commanderId);
    if (!commander) {
      return { error: 'Commander not found' };
    }

    const fromPos = MapGenerator.idToPosition(from);
    const toPos = MapGenerator.idToPosition(to);

    if (!fromPos || !toPos) {
      return { error: 'Invalid territory ID' };
    }

    // Validate movement
    if (
      !CombatSystem.isMovementValid(fromPos, toPos, this.gameState.getConfig().mapSize)
    ) {
      return { error: 'Invalid movement - too far or out of bounds' };
    }

    const fromTile = this.gameState.getTile(fromPos);
    if (!fromTile || fromTile.owner !== commander.team) {
      return { error: 'You do not control the source territory' };
    }

    // Find units to move
    const unitToMove = fromTile.units.find(
      u => u.type === unitType && u.commanderId === commanderId
    );

    if (!unitToMove || unitToMove.count < count) {
      return { error: 'Insufficient units available' };
    }

    // Calculate movement cost
    const movementCost = CombatSystem.calculateMovementCost(
      fromPos,
      toPos,
      fromTile.terrain
    );

    // Queue the action
    const action: GameAction = {
      commanderId,
      actionType: 'move',
      timestamp: Date.now(),
      parameters: { from, to, unitType, count },
      status: 'pending'
    };

    this.gameState.queueAction(action);

    // Check for potential conflict
    const toTile = this.gameState.getTile(toPos);
    const hasEnemies = toTile?.units.some(u => u.team !== commander.team);

    return {
      success: true,
      actionType: 'ACTION_QUEUED',
      actionQueued: true,
      note: `✅ MOVE QUEUED: ${count} ${unitType} from ${from} to ${to}`,
      message: `Movement of ${count} ${unitType} from ${from} to ${to} queued`,
      movementCost,
      conflict: hasEnemies ? 'Enemy present - battle will occur' : 'No enemy presence',
      requiredNextStep: '🚨 NOW: Either queue more actions OR call game_commitTurn to end your turn!'
    };
  }

  /**
   * FORTIFY_POSITION - Strengthen defenses at a territory
   */
  fortifyPosition(commanderId: string, territoryId: string) {
    const commander = this.gameState
      .getState()
      .commanders.find(c => c.id === commanderId);
    if (!commander) {
      return { error: 'Commander not found' };
    }

    const pos = MapGenerator.idToPosition(territoryId);
    if (!pos) {
      return { error: 'Invalid territory ID' };
    }

    const tile = this.gameState.getTile(pos);
    if (!tile || tile.owner !== commander.team) {
      return { error: 'You do not control this territory' };
    }

    const fortifyCost = 20;
    if (commander.resources < fortifyCost) {
      return { error: 'Insufficient resources' };
    }

    // Queue the action
    const action: GameAction = {
      commanderId,
      actionType: 'fortify',
      timestamp: Date.now(),
      parameters: { territoryId },
      status: 'pending'
    };

    this.gameState.queueAction(action);

    return {
      success: true,
      actionType: 'ACTION_QUEUED',
      actionQueued: true,
      note: `✅ FORTIFY QUEUED: ${territoryId} will reach level ${tile.fortificationLevel + 1}`,
      message: `Fortification of ${territoryId} queued`,
      cost: fortifyCost,
      newLevel: tile.fortificationLevel + 1,
      requiredNextStep: '🚨 NOW: Either queue more actions OR call game_commitTurn to end your turn!'
    };
  }

  /**
   * COLLECT_RESOURCES - Gather resources from controlled territory
   */
  collectResources(commanderId: string, territoryId: string) {
    const commander = this.gameState
      .getState()
      .commanders.find(c => c.id === commanderId);
    if (!commander) {
      return { error: 'Commander not found' };
    }

    const pos = MapGenerator.idToPosition(territoryId);
    if (!pos) {
      return { error: 'Invalid territory ID' };
    }

    const tile = this.gameState.getTile(pos);
    if (!tile || tile.owner !== commander.team) {
      return { error: 'You do not control this territory' };
    }

    const action: GameAction = {
      commanderId,
      actionType: 'collect',
      timestamp: Date.now(),
      parameters: { territoryId },
      status: 'pending'
    };

    this.gameState.queueAction(action);

    return {
      success: true,
      actionType: 'ACTION_QUEUED',
      actionQueued: true,
      note: `✅ COLLECT QUEUED: ${tile.resourceValue} resources from ${territoryId}`,
      message: `Resource collection from ${territoryId} queued (${tile.resourceValue} resources)`,
      amount: tile.resourceValue,
      requiredNextStep: '🚨 NOW: Either queue more actions OR call game_commitTurn to end your turn!'
    };
  }

  /**
   * GET_TEAM_STATUS - Get status of all team members
   */
  getTeamStatus(commanderId: string) {
    const commander = this.gameState
      .getState()
      .commanders.find(c => c.id === commanderId);
    if (!commander) {
      return { error: 'Commander not found' };
    }

    const teamCommanders = this.gameState
      .getState()
      .commanders.filter(c => c.team === commander.team);

    const totalResources = teamCommanders.reduce((sum, c) => sum + c.resources, 0);
    const totalTerritories = teamCommanders.reduce(
      (sum, c) => sum + c.controlledTerritories.length,
      0
    );

    const commanders = teamCommanders.map(c => ({
      id: c.id,
      name: c.name,
      role: c.role,
      status: c.status,
      resources: c.resources,
      territories: c.controlledTerritories.length,
      units: {
        infantry: c.units.find(u => u.type === UnitType.INFANTRY)?.count || 0,
        cavalry: c.units.find(u => u.type === UnitType.CAVALRY)?.count || 0,
        archers: c.units.find(u => u.type === UnitType.ARCHERS)?.count || 0
      }
    }));

    const state = this.gameState.getState();
    const teamControl =
      commander.team === Team.RED
        ? state.resourceControl.red
        : state.resourceControl.blue;
    const enemyControl =
      commander.team === Team.RED
        ? state.resourceControl.blue
        : state.resourceControl.red;

    return {
      success: true,
      actionType: 'INFO_ONLY',
      note: '✅ STATUS INFO retrieved - Do NOT call getTeamStatus again this turn!',
      team: commander.team,
      totalResources,
      totalTerritories,
      commanders,
      controlPercentage: teamControl,
      isWinning: teamControl > enemyControl,
      requiredNextStep: '🚨 NOW: Take 1-2 actions (moveUnits/fortifyPosition/collectResources), then call game_commitTurn!'
    };
  }

  /**
   * COMMIT_TURN - Signal that commander is ready for turn execution
   * After calling this, the agent MUST call task_complete to signal they're done.
   */
  commitTurn(commanderId: string, summary?: string) {
    const commander = this.gameState
      .getState()
      .commanders.find(c => c.id === commanderId);
    if (!commander) {
      return { error: 'Commander not found' };
    }

    const currentTurn = this.gameState.getState().turn;
    return {
      success: true,
      actionType: 'TURN_COMMITTED',
      accepted: true,
      turn: currentTurn,
      turnCommitted: true,
      note: `🎯 TURN ${currentTurn} COMMITTED SUCCESSFULLY!`,
      message: summary || 'Turn committed',
      requiredNextStep: '🚨 FINAL STEP: Call task_complete({ summary: "your turn summary" }) NOW!',
      warning: '⚠️ Do NOT call any other game tools. ONLY call task_complete to finish.'
    };
  }

  /**
   * CALCULATE_OPTIMAL_PATH - Find best path between territories
   */
  calculateOptimalPath(
    commanderId: string,
    from: string,
    to: string,
    avoidEnemies: boolean = true
  ) {
    const commander = this.gameState
      .getState()
      .commanders.find(c => c.id === commanderId);
    if (!commander) {
      return { error: 'Commander not found' };
    }

    const fromPos = MapGenerator.idToPosition(from);
    const toPos = MapGenerator.idToPosition(to);

    if (!fromPos || !toPos) {
      return { error: 'Invalid territory ID' };
    }

    // Simple A* pathfinding (simplified for demo)
    const path: string[] = [from];
    let current = fromPos;

    while (current.x !== toPos.x || current.y !== toPos.y) {
      // Move toward target (simplified - not true A*)
      const dx = Math.sign(toPos.x - current.x);
      const dy = Math.sign(toPos.y - current.y);

      current = { x: current.x + dx, y: current.y + dy };
      path.push(MapGenerator.positionToId(current));
    }

    const distance = path.length - 1;
    const movementCost = distance * 1.5; // Approximate

    return {
      success: true,
      actionType: 'INFO_ONLY',
      note: '✅ PATH CALCULATED - Do NOT call calculateOptimalPath again with same parameters!',
      path,
      distance,
      movementCost,
      risks: {
        enemyEncounters: 0,
        difficultTerrain: 0
      },
      requiredNextStep: '🚨 NOW: Call game_moveUnits to move units, then call game_commitTurn!'
    };
  }
}
