/**
 * Tic-Tac-Toe Game Types
 */

export type Player = 'X' | 'O';
export type Cell = Player | null;
export type Board = [
    [Cell, Cell, Cell],
    [Cell, Cell, Cell],
    [Cell, Cell, Cell]
];

export interface GameState {
    board: Board;
    currentPlayer: Player;
    winner: Player | 'draw' | null;
    gameOver: boolean;
    moveHistory: Move[];
    players: {
        X: PlayerInfo;
        O: PlayerInfo;
    };
    startTime: number;
    lastMoveTime: number | null;
}

export interface PlayerInfo {
    agentId: string;
    name: string;
    model: string;
    wins: number;
    personality: string;
}

export interface Move {
    player: Player;
    row: number;
    col: number;
    timestamp: number;
    taunt?: string;
}

export interface GameAction {
    type: 'move' | 'taunt' | 'get_board';
    playerId: string;
    data?: any;
    timestamp: number;
}

export interface TurnResult {
    success: boolean;
    message: string;
    board?: Board;
    winner?: Player | 'draw' | null;
    gameOver?: boolean;
}
