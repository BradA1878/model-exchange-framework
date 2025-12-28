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

export interface Position {
  x: number
  y: number
}

export interface Unit {
  id: string
  type: string
  team: Team
  count: number
  health: number
  position: Position
  commanderId: string
}

export interface Tile {
  position: Position
  terrain: string
  owner: Team
  resourceValue: number
  units: Unit[]
  fortificationLevel: number
}

export interface Commander {
  id: string
  name: string
  team: Team
  role: CommanderRole
  agentId: string
  resources: number
  controlledTerritories: Position[]
  visibility: Position[]
  units: Unit[]
  status: 'active' | 'defeated' | 'disconnected'
  model?: string  // LLM model being used by this agent
}

export interface GameState {
  gameId: string
  turn: number
  phase: 'planning' | 'execution' | 'negotiation' | 'resolution' | 'completed'
  map: Tile[][]
  commanders: Commander[]
  currentActions: any[]
  winner: Team | null
  resourceControl: {
    red: number
    blue: number
    neutral: number
  }
  startTime: number
  lastUpdateTime: number
  gameStarted?: boolean
}

export interface Message {
  id: string
  senderId: string
  receiverId?: string
  content: string
  timestamp: number
  type: 'team' | 'enemy' | 'system'
}

export interface Action {
  id: string
  commanderId: string
  actionType: string
  timestamp: number
  parameters: Record<string, any>
  status: 'pending' | 'executed' | 'failed'
  result?: any
}

export interface Analytics {
  decisionsPerSecond: number
  tokenUsage: number
  territoryControl: { turn: number; red: number; blue: number }[]
  resourceAccumulation: { turn: number; red: number; blue: number }[]
}
