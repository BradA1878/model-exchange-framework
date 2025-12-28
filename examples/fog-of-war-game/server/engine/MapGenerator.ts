/**
 * Map Generator - Creates procedural game maps with varied terrain
 */

import { Tile, TerrainType, Team, Position } from '../types/game';

export class MapGenerator {
  /**
   * Generate a procedural map with varied terrain and resource distribution
   */
  static generateMap(size: number): Tile[][] {
    const map: Tile[][] = [];

    for (let y = 0; y < size; y++) {
      map[y] = [];
      for (let x = 0; x < size; x++) {
        map[y][x] = this.generateTile(x, y, size);
      }
    }

    // Add strategic fortresses
    this.placeFortresses(map, size);

    // Add resource clusters
    this.placeResourceClusters(map, size);

    // Set starting territories
    this.setStartingTerritories(map, size);

    return map;
  }

  private static generateTile(x: number, y: number, size: number): Tile {
    const terrain = this.determineTerrainType(x, y, size);
    const baseResourceValue = this.calculateResourceValue(terrain);

    return {
      position: { x, y },
      terrain,
      owner: Team.NEUTRAL,
      resourceValue: baseResourceValue,
      units: [],
      fortificationLevel: 0
    };
  }

  private static determineTerrainType(x: number, y: number, size: number): TerrainType {
    // Perlin-like noise approximation using simple hash
    const hash = (x * 374761393 + y * 668265263) % 1000;
    const noise = hash / 1000;

    // Center tends to be plains (strategic battleground)
    const centerDist = Math.sqrt(
      Math.pow(x - size / 2, 2) + Math.pow(y - size / 2, 2)
    );
    const centerInfluence = Math.max(0, 1 - centerDist / (size / 2));

    if (centerInfluence > 0.6) {
      return TerrainType.PLAINS;
    }

    // Terrain distribution based on noise
    if (noise < 0.15) return TerrainType.WATER;
    if (noise < 0.35) return TerrainType.FOREST;
    if (noise < 0.55) return TerrainType.MOUNTAIN;
    return TerrainType.PLAINS;
  }

  private static calculateResourceValue(terrain: TerrainType): number {
    switch (terrain) {
      case TerrainType.PLAINS:
        return Math.floor(Math.random() * 3) + 2; // 2-4 resources
      case TerrainType.FOREST:
        return Math.floor(Math.random() * 4) + 3; // 3-6 resources
      case TerrainType.MOUNTAIN:
        return Math.floor(Math.random() * 5) + 5; // 5-9 resources (valuable but hard to reach)
      case TerrainType.WATER:
        return 0;
      case TerrainType.FORTRESS:
        return Math.floor(Math.random() * 3) + 8; // 8-10 resources
      default:
        return 1;
    }
  }

  private static placeFortresses(map: Tile[][], size: number): void {
    // Place 4 fortresses in strategic locations
    const fortressPositions: Position[] = [
      { x: 2, y: 2 }, // Top-left quadrant
      { x: size - 3, y: 2 }, // Top-right quadrant
      { x: 2, y: size - 3 }, // Bottom-left quadrant
      { x: size - 3, y: size - 3 } // Bottom-right quadrant
    ];

    fortressPositions.forEach(pos => {
      if (this.isValidPosition(pos, size)) {
        map[pos.y][pos.x].terrain = TerrainType.FORTRESS;
        map[pos.y][pos.x].resourceValue = this.calculateResourceValue(TerrainType.FORTRESS);
        map[pos.y][pos.x].fortificationLevel = 3;
      }
    });
  }

  private static placeResourceClusters(map: Tile[][], size: number): void {
    // Create 6-8 resource-rich clusters
    const clusterCount = Math.floor(Math.random() * 3) + 6;

    for (let i = 0; i < clusterCount; i++) {
      const centerX = Math.floor(Math.random() * size);
      const centerY = Math.floor(Math.random() * size);

      // Enrich tiles around cluster center
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const pos = { x: centerX + dx, y: centerY + dy };
          if (this.isValidPosition(pos, size) && map[pos.y][pos.x].terrain !== TerrainType.WATER) {
            map[pos.y][pos.x].resourceValue += Math.floor(Math.random() * 3) + 2;
          }
        }
      }
    }
  }

  private static setStartingTerritories(map: Tile[][], size: number): void {
    // Red team starts in top-left corner
    const redStart: Position[] = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 }
    ];

    // Blue team starts in bottom-right corner
    const blueStart: Position[] = [
      { x: size - 2, y: size - 2 },
      { x: size - 1, y: size - 2 },
      { x: size - 2, y: size - 1 },
      { x: size - 1, y: size - 1 }
    ];

    redStart.forEach(pos => {
      if (this.isValidPosition(pos, size)) {
        map[pos.y][pos.x].owner = Team.RED;
      }
    });

    blueStart.forEach(pos => {
      if (this.isValidPosition(pos, size)) {
        map[pos.y][pos.x].owner = Team.BLUE;
      }
    });
  }

  private static isValidPosition(pos: Position, size: number): boolean {
    return pos.x >= 0 && pos.x < size && pos.y >= 0 && pos.y < size;
  }

  /**
   * Convert position to readable territory ID (e.g., {x: 0, y: 0} -> "A1")
   */
  static positionToId(pos: Position): string {
    const letter = String.fromCharCode(65 + pos.x); // A, B, C, ...
    const number = pos.y + 1;
    return `${letter}${number}`;
  }

  /**
   * Convert territory ID to position (e.g., "A1" -> {x: 0, y: 0})
   */
  static idToPosition(id: string): Position | null {
    const match = id.match(/^([A-Z]+)(\d+)$/);
    if (!match) return null;

    const x = match[1].charCodeAt(0) - 65;
    const y = parseInt(match[2]) - 1;

    return { x, y };
  }
}
