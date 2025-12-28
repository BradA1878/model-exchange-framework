/**
 * MCP Tool Type Definitions for Fog of War Game
 * These match the tool interfaces that AI commanders can call
 */

export interface ViewTerritoryInput {
  ids: string[]; // Array of territory IDs like "A1", "B3", etc.
}

export interface ViewTerritoryOutput {
  territories: {
    id: string;
    terrain: string;
    owner: string;
    resources: number;
    units: {
      type: string;
      count: number;
      team: string;
    }[];
    fortification: number;
    visible: boolean;
  }[];
}

export interface MoveUnitsInput {
  from: string; // Territory ID
  to: string; // Territory ID
  unitType: 'infantry' | 'cavalry' | 'archers';
  count: number;
}

export interface MoveUnitsOutput {
  success: boolean;
  message: string;
  movementCost: number;
  arrival: 'immediate' | 'next-turn';
  conflict?: {
    enemyPresent: boolean;
    battleRequired: boolean;
  };
}

export interface ScanPerimeterInput {
  // No input required - scans commander's visible radius
}

export interface ScanPerimeterOutput {
  visibleTiles: {
    id: string;
    terrain: string;
    owner: string;
    hasEnemyUnits: boolean;
    hasResources: boolean;
  }[];
  enemyUnitsDetected: {
    approximate_location: string;
    type: string;
    estimatedCount: string; // "few", "moderate", "many"
  }[];
  intelligence: string; // Natural language summary
}

export interface TeamMessageInput {
  message: string;
  priority?: 'low' | 'normal' | 'high' | 'urgent';
}

export interface NegotiateEnemyInput {
  commanderId: string;
  message: string;
  isSecret: boolean;
}

export interface ProposeStrategyInput {
  plan: string;
  requiredAllies?: string[];
  duration?: number; // turns
}

export interface GetTeamStatusOutput {
  team: string;
  totalResources: number;
  totalTerritories: number;
  commanders: {
    id: string;
    name: string;
    role: string;
    status: 'active' | 'defeated' | 'disconnected';
    resources: number;
    territories: number;
    units: {
      infantry: number;
      cavalry: number;
      archers: number;
    };
  }[];
  controlPercentage: number;
  isWinning: boolean;
}

export interface CommitTurnInput {
  ready: boolean;
  summary?: string;
}

export interface CommitTurnOutput {
  accepted: boolean;
  waitingFor: string[]; // Other commanders not yet ready
  timeRemaining: number;
}

export interface CalculateOptimalPathInput {
  from: string;
  to: string;
  avoidEnemies?: boolean;
  preferTerrain?: string[];
}

export interface CalculateOptimalPathOutput {
  path: string[];
  distance: number;
  movementCost: number;
  risks: {
    enemyEncounters: number;
    difficultTerrain: number;
  };
  recommendation: string;
}
