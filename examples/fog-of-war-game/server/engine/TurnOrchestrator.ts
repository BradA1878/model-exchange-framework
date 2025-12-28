/**
 * Turn Orchestrator - Manages parallel turn execution and conflict resolution
 */

import { GameStateManager } from './GameStateManager';
import { CombatSystem } from './CombatSystem';
import { MapGenerator } from './MapGenerator';
import {
  GameAction,
  TurnSummary,
  BattleResult,
  Position,
  Team,
  UnitType
} from '../types/game';

export class TurnOrchestrator {
  private readyCommanders: Set<string> = new Set();

  constructor(private gameState: GameStateManager) {}

  /**
   * Mark commander as ready for turn execution
   */
  markCommanderReady(commanderId: string): void {
    this.readyCommanders.add(commanderId);
  }

  /**
   * Check if all commanders are ready
   */
  areAllCommandersReady(): boolean {
    const activeCommanders = this.gameState
      .getState()
      .commanders.filter(c => c.status === 'active');
    return activeCommanders.every(c => this.readyCommanders.has(c.id));
  }

  /**
   * Execute all pending actions and resolve conflicts
   */
  executeTurn(): TurnSummary {
    const state = this.gameState.getState();
    const actions = state.currentActions;
    const battles: BattleResult[] = [];
    const resourceChanges: { team: Team; change: number }[] = [];
    const territoryChanges: {
      position: Position;
      previousOwner: Team;
      newOwner: Team;
    }[] = [];

    console.log(
      `\n=== Executing Turn ${state.turn} with ${actions.length} actions ===`
    );

    // Group actions by type for proper execution order
    const moveActions = actions.filter(a => a.actionType === 'move');
    const collectActions = actions.filter(a => a.actionType === 'collect');
    const fortifyActions = actions.filter(a => a.actionType === 'fortify');

    // 1. Execute resource collection first
    collectActions.forEach(action => {
      const result = this.executeCollectAction(action);
      if (result.success && result.changes.resourcesGained) {
        const commander = state.commanders.find(c => c.id === action.commanderId);
        if (commander) {
          resourceChanges.push({
            team: commander.team,
            change: result.changes.resourcesGained
          });
        }
      }
    });

    // 2. Execute fortifications
    fortifyActions.forEach(action => {
      this.executeFortifyAction(action);
    });

    // 3. Execute movements and resolve conflicts
    const conflictMap = this.detectConflicts(moveActions);

    moveActions.forEach(action => {
      const result = this.executeMoveAction(action, conflictMap);
      action.result = result;

      if (result.success) {
        action.status = 'executed';
      } else {
        action.status = 'failed';
      }
    });

    // 4. Resolve battles
    const battleResults = this.resolveBattles(conflictMap);
    battles.push(...battleResults);

    // Track territory changes from battles
    battleResults.forEach(battle => {
      if (battle.territoryChanged) {
        const tile = this.gameState.getTile(battle.location);
        if (tile) {
          const previousOwner = tile.owner;
          this.gameState.updateTileOwnership(battle.location, battle.victor);

          territoryChanges.push({
            position: battle.location,
            previousOwner,
            newOwner: battle.victor
          });
        }
      }
    });

    // 5. Reset ready state for next turn
    this.readyCommanders.clear();

    // 6. Advance game turn
    this.gameState.advanceTurn();

    console.log(`=== Turn ${state.turn} Complete ===\n`);

    return {
      turn: state.turn,
      actions,
      battles,
      resourceChanges,
      territoryChanges
    };
  }

  /**
   * Execute a resource collection action
   */
  private executeCollectAction(action: GameAction) {
    const commander = this.gameState
      .getState()
      .commanders.find(c => c.id === action.commanderId);

    if (!commander) {
      return {
        success: false,
        message: 'Commander not found',
        changes: {}
      };
    }

    const territoryId = action.parameters.territoryId as string;
    const pos = MapGenerator.idToPosition(territoryId);

    if (!pos) {
      return {
        success: false,
        message: 'Invalid territory',
        changes: {}
      };
    }

    const tile = this.gameState.getTile(pos);

    if (!tile || tile.owner !== commander.team) {
      return {
        success: false,
        message: 'Territory not controlled',
        changes: {}
      };
    }

    const resourcesGained = tile.resourceValue;
    commander.resources += resourcesGained;

    console.log(
      `  [COLLECT] ${commander.name} collected ${resourcesGained} from ${territoryId}`
    );

    return {
      success: true,
      message: `Collected ${resourcesGained} resources`,
      changes: {
        resourcesGained
      }
    };
  }

  /**
   * Execute a fortify action
   */
  private executeFortifyAction(action: GameAction) {
    const commander = this.gameState
      .getState()
      .commanders.find(c => c.id === action.commanderId);

    if (!commander) return;

    const territoryId = action.parameters.territoryId as string;
    const pos = MapGenerator.idToPosition(territoryId);

    if (!pos) return;

    const tile = this.gameState.getTile(pos);
    if (tile && tile.owner === commander.team) {
      const cost = 20;
      if (commander.resources >= cost) {
        commander.resources -= cost;
        tile.fortificationLevel = Math.min(5, tile.fortificationLevel + 1);
        console.log(
          `  [FORTIFY] ${commander.name} fortified ${territoryId} to level ${tile.fortificationLevel}`
        );
      }
    }
  }

  /**
   * Execute a move action
   */
  private executeMoveAction(
    action: GameAction,
    conflictMap: Map<string, GameAction[]>
  ) {
    const { from, to, unitType, count } = action.parameters;

    const fromPos = MapGenerator.idToPosition(from as string);
    const toPos = MapGenerator.idToPosition(to as string);

    if (!fromPos || !toPos) {
      return {
        success: false,
        message: 'Invalid positions',
        changes: {}
      };
    }

    const fromTile = this.gameState.getTile(fromPos);
    const toTile = this.gameState.getTile(toPos);

    if (!fromTile || !toTile) {
      return {
        success: false,
        message: 'Invalid tiles',
        changes: {}
      };
    }

    const commander = this.gameState
      .getState()
      .commanders.find(c => c.id === action.commanderId);

    if (!commander) {
      return {
        success: false,
        message: 'Commander not found',
        changes: {}
      };
    }

    // Find unit to move
    const unitIndex = fromTile.units.findIndex(
      u => u.type === (unitType as UnitType) && u.commanderId === action.commanderId
    );

    if (unitIndex === -1) {
      return {
        success: false,
        message: 'Unit not found',
        changes: {}
      };
    }

    const unit = fromTile.units[unitIndex];

    if (unit.count < (count as number)) {
      return {
        success: false,
        message: 'Insufficient units',
        changes: {}
      };
    }

    // Move units
    if (unit.count === count) {
      // Move entire unit
      fromTile.units.splice(unitIndex, 1);
      unit.position = toPos;
      toTile.units.push(unit);
    } else {
      // Split unit
      unit.count -= count as number;
      const newUnit = {
        ...unit,
        id: `${unit.id}-split-${Date.now()}`,
        count: count as number,
        position: toPos
      };
      toTile.units.push(newUnit);
    }

    console.log(
      `  [MOVE] ${commander.name} moved ${count} ${unitType} from ${from} to ${to}`
    );

    return {
      success: true,
      message: `Moved ${count} ${unitType}`,
      changes: {}
    };
  }

  /**
   * Detect conflicts where multiple actions target same location
   */
  private detectConflicts(actions: GameAction[]): Map<string, GameAction[]> {
    const conflictMap = new Map<string, GameAction[]>();

    actions.forEach(action => {
      const targetId = action.parameters.to as string;

      if (!conflictMap.has(targetId)) {
        conflictMap.set(targetId, []);
      }

      conflictMap.get(targetId)!.push(action);
    });

    return conflictMap;
  }

  /**
   * Resolve battles at conflicted locations
   */
  private resolveBattles(conflictMap: Map<string, GameAction[]>): BattleResult[] {
    const battles: BattleResult[] = [];

    conflictMap.forEach((actions, territoryId) => {
      const pos = MapGenerator.idToPosition(territoryId);
      if (!pos) return;

      const tile = this.gameState.getTile(pos);
      if (!tile) return;

      // Check if there are units from different teams
      const teams = new Set(tile.units.map(u => u.team));

      if (teams.size > 1) {
        // Battle occurs!
        const redUnits = tile.units.filter(u => u.team === Team.RED);
        const blueUnits = tile.units.filter(u => u.team === Team.BLUE);

        if (redUnits.length > 0 && blueUnits.length > 0) {
          const battle = CombatSystem.resolveBattle(
            redUnits,
            blueUnits,
            pos,
            tile.fortificationLevel
          );

          battles.push(battle);

          console.log(
            `  [BATTLE] at ${territoryId}: ${battle.victor} wins! ` +
              `(Red lost ${battle.attackers.unitsLost}, Blue lost ${battle.defenders.unitsLost})`
          );

          // Update tile ownership if territory changed
          if (battle.territoryChanged) {
            tile.owner = battle.victor;
          }
        }
      }
    });

    return battles;
  }

  /**
   * Get turn progress
   */
  getTurnProgress(): {
    ready: number;
    total: number;
    waiting: string[];
  } {
    const activeCommanders = this.gameState
      .getState()
      .commanders.filter(c => c.status === 'active');

    const waiting = activeCommanders
      .filter(c => !this.readyCommanders.has(c.id))
      .map(c => c.name);

    return {
      ready: this.readyCommanders.size,
      total: activeCommanders.length,
      waiting
    };
  }
}
