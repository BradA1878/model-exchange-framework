/**
 * Fog of War: Parallel Minds - Core Game Types
 * Defines all game state, entities, and configuration interfaces
 */

export enum Team {
  RED = 'red',
  BLUE = 'blue',
  NEUTRAL = 'neutral'
}

export enum CommanderRole {
  SCOUT = 'scout',
  WARRIOR = 'warrior',
  DEFENDER = 'defender',
  SUPPORT = 'support'
}

export enum TerrainType {
  PLAINS = 'plains',
  FOREST = 'forest',
  MOUNTAIN = 'mountain',
  WATER = 'water',
  FORTRESS = 'fortress'
}

export enum UnitType {
  INFANTRY = 'infantry',
  CAVALRY = 'cavalry',
  ARCHERS = 'archers'
}

export interface Position {
  x: number;
  y: number;
}

export interface Tile {
  position: Position;
  terrain: TerrainType;
  owner: Team;
  resourceValue: number;
  units: Unit[];
  fortificationLevel: number;
}

export interface Unit {
  id: string;
  type: UnitType;
  team: Team;
  count: number;
  health: number;
  position: Position;
  commanderId: string;
}

export interface Commander {
  id: string;
  name: string;
  team: Team;
  role: CommanderRole;
  agentId: string;
  resources: number;
  controlledTerritories: Position[];
  visibility: Position[]; // What they can see (fog of war)
  units: Unit[];
  status: 'active' | 'defeated' | 'disconnected';
}

export interface GameState {
  gameId: string;
  turn: number;
  phase: 'planning' | 'execution' | 'negotiation' | 'resolution' | 'completed';
  map: Tile[][];
  commanders: Commander[];
  currentActions: GameAction[];
  winner: Team | null;
  resourceControl: {
    red: number;
    blue: number;
    neutral: number;
  };
  startTime: number;
  lastUpdateTime: number;
}

export interface GameAction {
  commanderId: string;
  actionType: 'move' | 'fortify' | 'collect' | 'transfer' | 'scout' | 'attack';
  timestamp: number;
  parameters: Record<string, any>;
  status: 'pending' | 'executed' | 'failed' | 'conflicted';
  result?: ActionResult;
}

export interface ActionResult {
  success: boolean;
  message: string;
  changes: {
    unitsLost?: number;
    territoryGained?: Position[];
    resourcesGained?: number;
    intelligenceGathered?: string;
  };
}

export interface GameConfig {
  mapSize: number;
  maxTurns: number;
  turnDuration: number;
  negotiationDuration: number;
  victoryThreshold: number;
  fogOfWarRadius: number;
  startingResources: number;
  startingUnits: {
    infantry: number;
    cavalry: number;
    archers: number;
  };
}

export interface CommanderView {
  commanderId: string;
  team: Team;
  role: CommanderRole;
  visibleTiles: Tile[][];
  ownUnits: Unit[];
  knownEnemyUnits: Unit[];
  resources: number;
  controlledTerritories: number;
  teamResources: number;
  teamStatus: {
    commanderId: string;
    name: string;
    role: CommanderRole;
    status: string;
  }[];
}

export interface TurnSummary {
  turn: number;
  actions: GameAction[];
  battles: BattleResult[];
  resourceChanges: {
    team: Team;
    change: number;
  }[];
  territoryChanges: {
    position: Position;
    previousOwner: Team;
    newOwner: Team;
  }[];
}

export interface BattleResult {
  location: Position;
  attackers: {
    team: Team;
    commanderId: string;
    unitsCommitted: Unit[];
    unitsLost: number;
  };
  defenders: {
    team: Team;
    commanderId: string;
    unitsCommitted: Unit[];
    unitsLost: number;
  };
  victor: Team;
  territoryChanged: boolean;
}

export const DEFAULT_GAME_CONFIG: GameConfig = {
  mapSize: 12,
  maxTurns: 15,
  turnDuration: 45000, // 45 seconds
  negotiationDuration: 10000, // 10 seconds
  victoryThreshold: 0.6, // 60% resource control
  fogOfWarRadius: 1,
  startingResources: 100,
  startingUnits: {
    infantry: 100,
    cavalry: 20,
    archers: 30
  }
};
