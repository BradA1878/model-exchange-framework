/**
 * Go Fish Game Types
 */

export type Rank = 'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K';
export type Suit = 'hearts' | 'diamonds' | 'clubs' | 'spades';

export interface Card {
    rank: Rank;
    suit: Suit;
}

export interface Player {
    id: string;
    name: string;
    model: string;
    handCount: number;  // Don't expose actual cards to other players
    books: Rank[];      // Completed sets of 4
    personality: string;
}

export interface PlayerPrivateView {
    hand: Card[];
    handCount: number;
    books: Rank[];
}

export interface GameState {
    players: Player[];
    currentPlayerIndex: number;
    deckCount: number;
    gameOver: boolean;
    winner: string | null;
    lastAction: GameAction | null;
    turnHistory: GameAction[];
    startTime: number;
    booksToWin: number;
}

export interface GameAction {
    type: 'ask' | 'go_fish' | 'book' | 'game_over';
    playerId: string;
    playerName: string;
    targetId?: string;
    targetName?: string;
    rank?: Rank;
    success?: boolean;
    cardsReceived?: number;
    message?: string;
    timestamp: number;
}

export interface AskResult {
    success: boolean;
    message: string;
    cardsReceived: number;
    goFish: boolean;
    drewCard: boolean;
    drewRequestedRank: boolean;
    madeBook: boolean;
    bookRank?: Rank;
    yourTurnContinues: boolean;
}

export const RANKS: Rank[] = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
export const SUITS: Suit[] = ['hearts', 'diamonds', 'clubs', 'spades'];
