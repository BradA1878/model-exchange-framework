/**
 * Combat System - Resolves battles between units
 */

import { Unit, UnitType, BattleResult, Team, Position } from '../types/game';

export class CombatSystem {
  // Rock-paper-scissors style advantages
  private static readonly ADVANTAGES: Record<UnitType, UnitType> = {
    [UnitType.INFANTRY]: UnitType.ARCHERS, // Infantry beats Archers
    [UnitType.CAVALRY]: UnitType.INFANTRY, // Cavalry beats Infantry
    [UnitType.ARCHERS]: UnitType.CAVALRY // Archers beat Cavalry
  };

  // Base combat strength per unit
  private static readonly BASE_STRENGTH: Record<UnitType, number> = {
    [UnitType.INFANTRY]: 1.0,
    [UnitType.CAVALRY]: 1.5,
    [UnitType.ARCHERS]: 0.8
  };

  /**
   * Resolve combat between attacking and defending units
   */
  static resolveBattle(
    attackers: Unit[],
    defenders: Unit[],
    location: Position,
    fortificationBonus: number
  ): BattleResult {
    const attackerTeam = attackers[0]?.team || Team.NEUTRAL;
    const defenderTeam = defenders[0]?.team || Team.NEUTRAL;

    // Calculate total strength for each side
    const attackerStrength = this.calculateCombatStrength(attackers, defenders, false);
    const defenderStrength =
      this.calculateCombatStrength(defenders, attackers, true) * (1 + fortificationBonus * 0.2);

    // Determine victor
    const victorTeam = attackerStrength > defenderStrength ? attackerTeam : defenderTeam;
    const isAttackerVictory = victorTeam === attackerTeam;

    // Calculate casualties
    const attackerLosses = this.calculateCasualties(attackers, defenderStrength);
    const defenderLosses = this.calculateCasualties(defenders, attackerStrength);

    // Apply losses to units
    this.applyLosses(attackers, attackerLosses);
    this.applyLosses(defenders, defenderLosses);

    return {
      location,
      attackers: {
        team: attackerTeam,
        commanderId: attackers[0]?.commanderId || 'unknown',
        unitsCommitted: this.cloneUnits(attackers),
        unitsLost: attackerLosses
      },
      defenders: {
        team: defenderTeam,
        commanderId: defenders[0]?.commanderId || 'unknown',
        unitsCommitted: this.cloneUnits(defenders),
        unitsLost: defenderLosses
      },
      victor: victorTeam,
      territoryChanged: isAttackerVictory
    };
  }

  /**
   * Calculate total combat strength of units
   */
  private static calculateCombatStrength(
    units: Unit[],
    enemies: Unit[],
    isDefending: boolean
  ): number {
    return units.reduce((total, unit) => {
      const baseStrength = this.BASE_STRENGTH[unit.type] * unit.count * (unit.health / 100);

      // Apply type advantage bonus
      const advantageBonus = this.calculateTypeAdvantage(unit, enemies);

      // Defenders get 20% bonus
      const defenseBonus = isDefending ? 1.2 : 1.0;

      return total + baseStrength * advantageBonus * defenseBonus;
    }, 0);
  }

  /**
   * Calculate type advantage multiplier
   */
  private static calculateTypeAdvantage(unit: Unit, enemies: Unit[]): number {
    const advantageAgainst = this.ADVANTAGES[unit.type];

    // Check if any enemy units are weak against this unit type
    const weakEnemies = enemies.filter(e => e.type === advantageAgainst);
    const weakEnemyCount = weakEnemies.reduce((sum, e) => sum + e.count, 0);
    const totalEnemyCount = enemies.reduce((sum, e) => sum + e.count, 0);

    if (totalEnemyCount === 0) return 1.0;

    // Calculate advantage percentage
    const advantageRatio = weakEnemyCount / totalEnemyCount;

    // 1.0 (no advantage) to 1.5 (full advantage)
    return 1.0 + advantageRatio * 0.5;
  }

  /**
   * Calculate casualties based on enemy strength
   */
  private static calculateCasualties(units: Unit[], enemyStrength: number): number {
    const totalUnits = units.reduce((sum, unit) => sum + unit.count, 0);

    // Casualty rate is proportional to enemy strength
    const casualtyRate = Math.min(0.8, enemyStrength / (totalUnits * 100));

    return Math.floor(totalUnits * casualtyRate * (0.8 + Math.random() * 0.4));
  }

  /**
   * Apply losses to units
   */
  private static applyLosses(units: Unit[], totalLosses: number): void {
    let remainingLosses = totalLosses;

    // Distribute losses across units proportionally
    for (const unit of units) {
      if (remainingLosses <= 0) break;

      const lossesForThisUnit = Math.min(unit.count, Math.ceil(remainingLosses / units.length));
      unit.count -= lossesForThisUnit;
      remainingLosses -= lossesForThisUnit;

      // Also reduce health slightly
      unit.health = Math.max(20, unit.health - Math.random() * 15);
    }

    // Remove units with zero count (filter creates new array, avoiding mutation during iteration)
    const survivingUnits = units.filter(unit => unit.count > 0);
    
    // Clear original array and replace with survivors
    units.length = 0;
    units.push(...survivingUnits);
  }

  /**
   * Clone units for battle result recording
   */
  private static cloneUnits(units: Unit[]): Unit[] {
    return units.map(unit => ({ ...unit }));
  }

  /**
   * Calculate movement cost based on terrain and distance
   */
  static calculateMovementCost(
    from: Position,
    to: Position,
    terrainType: string
  ): number {
    const distance = Math.abs(to.x - from.x) + Math.abs(to.y - from.y);

    const terrainMultiplier: Record<string, number> = {
      plains: 1.0,
      forest: 1.5,
      mountain: 2.0,
      water: 999, // Cannot move through water
      fortress: 1.2
    };

    return distance * (terrainMultiplier[terrainType] || 1.0);
  }

  /**
   * Check if movement is valid
   */
  static isMovementValid(from: Position, to: Position, mapSize: number): boolean {
    // Must be within map bounds
    if (to.x < 0 || to.x >= mapSize || to.y < 0 || to.y >= mapSize) {
      return false;
    }

    // Must be adjacent or within reasonable distance
    const distance = Math.abs(to.x - from.x) + Math.abs(to.y - from.y);
    return distance <= 3; // Max 3 tiles per move
  }
}
