/**
 * Fog of War System - Calculates visibility for each commander
 */

import { Position, Tile, Commander, Team } from '../types/game';

export class FogOfWarSystem {
  /**
   * Calculate visible tiles for a commander based on controlled territories
   * and fog of war radius
   */
  static calculateVisibility(
    commander: Commander,
    map: Tile[][],
    fogRadius: number
  ): Position[] {
    const visiblePositions: Set<string> = new Set();

    // Add visibility from controlled territories
    commander.controlledTerritories.forEach(territory => {
      const visible = this.getVisibleTilesFromPosition(territory, map, fogRadius);
      visible.forEach(pos => {
        visiblePositions.add(`${pos.x},${pos.y}`);
      });
    });

    // Add visibility from units
    commander.units.forEach(unit => {
      const visible = this.getVisibleTilesFromPosition(unit.position, map, fogRadius);
      visible.forEach(pos => {
        visiblePositions.add(`${pos.x},${pos.y}`);
      });
    });

    // Convert back to Position array
    return Array.from(visiblePositions).map(key => {
      const [x, y] = key.split(',').map(Number);
      return { x, y };
    });
  }

  /**
   * Get all tiles visible from a single position within fog radius
   */
  private static getVisibleTilesFromPosition(
    center: Position,
    map: Tile[][],
    radius: number
  ): Position[] {
    const visible: Position[] = [];
    const mapSize = map.length;

    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const pos = { x: center.x + dx, y: center.y + dy };

        // Check if position is within map bounds
        if (pos.x >= 0 && pos.x < mapSize && pos.y >= 0 && pos.y < mapSize) {
          // Check if within radius using Manhattan distance
          const distance = Math.abs(dx) + Math.abs(dy);
          if (distance <= radius) {
            visible.push(pos);
          }
        }
      }
    }

    return visible;
  }

  /**
   * Filter map to only show visible tiles for a commander
   */
  static getVisibleMap(
    commander: Commander,
    map: Tile[][],
    fogRadius: number
  ): Tile[][] {
    const visibility = this.calculateVisibility(commander, map, fogRadius);
    const visibleSet = new Set(visibility.map(p => `${p.x},${p.y}`));

    // Create a copy of the map with fog of war applied
    const visibleMap: Tile[][] = map.map((row, y) =>
      row.map((tile, x) => {
        if (visibleSet.has(`${x},${y}`)) {
          // Tile is visible - return full information
          return { ...tile };
        } else {
          // Tile is hidden - return limited information
          return {
            position: tile.position,
            terrain: tile.terrain,
            owner: Team.NEUTRAL, // Hide ownership
            resourceValue: 0, // Hide resources
            units: [], // Hide units
            fortificationLevel: 0 // Hide fortifications
          };
        }
      })
    );

    return visibleMap;
  }

  /**
   * Get intelligence summary of visible area
   */
  static getIntelligenceSummary(
    commander: Commander,
    map: Tile[][],
    fogRadius: number
  ): string {
    const visibility = this.calculateVisibility(commander, map, fogRadius);
    const visibleTiles = visibility.map(pos => map[pos.y][pos.x]);

    // Count enemy units in visible area
    const enemyUnits = visibleTiles.flatMap(tile =>
      tile.units.filter(unit => unit.team !== commander.team)
    );

    // Count available resources
    const availableResources = visibleTiles
      .filter(tile => tile.owner === Team.NEUTRAL)
      .reduce((sum, tile) => sum + tile.resourceValue, 0);

    // Count enemy territories
    const enemyTerritories = visibleTiles.filter(
      tile => tile.owner !== commander.team && tile.owner !== Team.NEUTRAL
    ).length;

    const summary = [
      `Visibility Report for ${commander.name}:`,
      `- Visible area: ${visibility.length} tiles`,
      `- Enemy units detected: ${enemyUnits.length}`,
      `- Enemy territories: ${enemyTerritories}`,
      `- Unclaimed resources: ${availableResources}`,
      enemyUnits.length > 0
        ? `- Threat level: ${this.calculateThreatLevel(enemyUnits)}`
        : '- No immediate threats detected'
    ].join('\n');

    return summary;
  }

  private static calculateThreatLevel(enemyUnits: any[]): string {
    const totalEnemyStrength = enemyUnits.reduce((sum, unit) => sum + unit.count, 0);

    if (totalEnemyStrength > 200) return 'CRITICAL';
    if (totalEnemyStrength > 100) return 'HIGH';
    if (totalEnemyStrength > 50) return 'MODERATE';
    return 'LOW';
  }

  /**
   * Check if a position is visible to a commander
   */
  static isPositionVisible(
    position: Position,
    commander: Commander,
    map: Tile[][],
    fogRadius: number
  ): boolean {
    const visibility = this.calculateVisibility(commander, map, fogRadius);
    return visibility.some(pos => pos.x === position.x && pos.y === position.y);
  }
}
