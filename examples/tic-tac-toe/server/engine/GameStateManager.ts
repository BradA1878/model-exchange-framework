/**
 * Tic-Tac-Toe Game State Manager
 * Handles all game logic and state
 */

import { Board, Cell, GameState, Move, Player, PlayerInfo, TurnResult } from '../types/game';

export class GameStateManager {
    private state: GameState;
    private onStateChange?: (state: GameState) => void;
    private onGameOver?: (winner: Player | 'draw') => void;

    constructor() {
        this.state = this.createInitialState();
    }

    private createInitialState(): GameState {
        return {
            board: [
                [null, null, null],
                [null, null, null],
                [null, null, null]
            ],
            currentPlayer: 'X',
            winner: null,
            gameOver: false,
            moveHistory: [],
            players: {
                X: { agentId: '', name: 'Player X', model: '', wins: 0, personality: '' },
                O: { agentId: '', name: 'Player O', model: '', wins: 0, personality: '' }
            },
            startTime: Date.now(),
            lastMoveTime: null
        };
    }

    /**
     * Reset the game for a new round
     * Randomizes starting player for fairness
     */
    reset(): void {
        const xWins = this.state.players.X.wins;
        const oWins = this.state.players.O.wins;
        const players = this.state.players;

        this.state = this.createInitialState();
        this.state.players = players;
        this.state.players.X.wins = xWins;
        this.state.players.O.wins = oWins;

        // Randomize starting player
        this.state.currentPlayer = Math.random() < 0.5 ? 'X' : 'O';

        this.notifyStateChange();
    }

    /**
     * Set player info
     */
    setPlayer(player: Player, info: Partial<PlayerInfo>): void {
        this.state.players[player] = { ...this.state.players[player], ...info };
        this.notifyStateChange();
    }

    /**
     * Get current game state
     */
    getState(): GameState {
        return { ...this.state };
    }

    /**
     * Get the board as a formatted string for LLM
     * Clear ASCII art with labeled coordinates - no strategic hints (LLMs should figure it out)
     */
    getBoardString(): string {
        const board = this.state.board;
        
        // ASCII art board with clear coordinates
        let result = '\n';
        result += '       col0   col1   col2\n';
        result += '      ┌──────┬──────┬──────┐\n';
        for (let row = 0; row < 3; row++) {
            result += `row${row}  │`;
            for (let col = 0; col < 3; col++) {
                const cell = board[row][col];
                const symbol = cell || '.';
                result += `  ${symbol}   │`;
            }
            result += '\n';
            if (row < 2) {
                result += '      ├──────┼──────┼──────┤\n';
            }
        }
        result += '      └──────┴──────┴──────┘\n';
        result += '\nEmpty cells shown as "." - use (row, col) to place your mark.\n';
        
        return result;
    }

    /**
     * Check if it's a specific player's turn
     */
    isPlayerTurn(player: Player): boolean {
        return this.state.currentPlayer === player && !this.state.gameOver;
    }

    /**
     * Make a move
     */
    makeMove(player: Player, row: number, col: number, taunt?: string): TurnResult {
        // Validate it's the player's turn
        if (this.state.currentPlayer !== player) {
            return {
                success: false,
                message: `It's not your turn! Current player: ${this.state.currentPlayer}`
            };
        }

        // Validate game not over
        if (this.state.gameOver) {
            return {
                success: false,
                message: `Game is already over! Winner: ${this.state.winner}`
            };
        }

        // Validate move bounds
        if (row < 0 || row > 2 || col < 0 || col > 2) {
            return {
                success: false,
                message: `Invalid position! Row and column must be 0, 1, or 2. Got row=${row}, col=${col}`
            };
        }

        // Validate cell is empty
        if (this.state.board[row][col] !== null) {
            return {
                success: false,
                message: `Cell (${row}, ${col}) is already occupied by ${this.state.board[row][col]}!`
            };
        }

        // Make the move
        this.state.board[row][col] = player;
        this.state.lastMoveTime = Date.now();

        // Record move
        const move: Move = {
            player,
            row,
            col,
            timestamp: Date.now(),
            taunt
        };
        this.state.moveHistory.push(move);

        // Check for winner
        const winner = this.checkWinner();
        if (winner) {
            this.state.winner = winner;
            this.state.gameOver = true;
            if (winner !== 'draw') {
                this.state.players[winner].wins++;
            }
            this.notifyStateChange();
            this.onGameOver?.(winner);

            return {
                success: true,
                message: winner === 'draw'
                    ? "It's a draw! The board is full."
                    : `${winner} wins! Congratulations!`,
                board: this.state.board,
                winner,
                gameOver: true
            };
        }

        // Switch turns
        this.state.currentPlayer = player === 'X' ? 'O' : 'X';
        this.notifyStateChange();

        return {
            success: true,
            message: `Move placed at (${row}, ${col}). Now it's ${this.state.currentPlayer}'s turn.`,
            board: this.state.board,
            gameOver: false
        };
    }

    /**
     * Check for winner or draw
     */
    private checkWinner(): Player | 'draw' | null {
        const board = this.state.board;

        // Check rows
        for (let row = 0; row < 3; row++) {
            if (board[row][0] && board[row][0] === board[row][1] && board[row][1] === board[row][2]) {
                return board[row][0];
            }
        }

        // Check columns
        for (let col = 0; col < 3; col++) {
            if (board[0][col] && board[0][col] === board[1][col] && board[1][col] === board[2][col]) {
                return board[0][col];
            }
        }

        // Check diagonals
        if (board[0][0] && board[0][0] === board[1][1] && board[1][1] === board[2][2]) {
            return board[0][0];
        }
        if (board[0][2] && board[0][2] === board[1][1] && board[1][1] === board[2][0]) {
            return board[0][2];
        }

        // Check for draw (board full)
        const isFull = board.every(row => row.every(cell => cell !== null));
        if (isFull) {
            return 'draw';
        }

        return null;
    }

    /**
     * Get available moves
     */
    getAvailableMoves(): { row: number; col: number }[] {
        const moves: { row: number; col: number }[] = [];
        for (let row = 0; row < 3; row++) {
            for (let col = 0; col < 3; col++) {
                if (this.state.board[row][col] === null) {
                    moves.push({ row, col });
                }
            }
        }
        return moves;
    }

    /**
     * Set state change callback
     */
    onStateChangeCallback(callback: (state: GameState) => void): void {
        this.onStateChange = callback;
    }

    /**
     * Set game over callback
     */
    onGameOverCallback(callback: (winner: Player | 'draw') => void): void {
        this.onGameOver = callback;
    }

    private notifyStateChange(): void {
        this.onStateChange?.(this.getState());
    }
}
