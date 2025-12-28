/**
 * Go Fish Game State Manager
 * Handles all game logic and state
 */

import { Card, GameState, GameAction, Player, PlayerPrivateView, Rank, Suit, AskResult, RANKS, SUITS } from '../types/game';

// Configurable: End game after this many total books (default 13 = full game)
const BOOKS_TO_WIN = 4;

interface InternalPlayer extends Player {
    hand: Card[];
}

export class GameStateManager {
    private players: InternalPlayer[] = [];
    private deck: Card[] = [];
    private currentPlayerIndex: number = 0;
    private gameOver: boolean = false;
    private winner: string | null = null;
    private turnHistory: GameAction[] = [];
    private lastAction: GameAction | null = null;
    private startTime: number = Date.now();
    private onStateChange?: (state: GameState) => void;
    private onGameOver?: (winnerId: string, winnerName: string) => void;

    constructor() {
        this.initializeDeck();
    }

    private initializeDeck(): void {
        this.deck = [];
        for (const suit of SUITS) {
            for (const rank of RANKS) {
                this.deck.push({ rank, suit });
            }
        }
        this.shuffleDeck();
    }

    private shuffleDeck(): void {
        for (let i = this.deck.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [this.deck[i], this.deck[j]] = [this.deck[j], this.deck[i]];
        }
    }

    /**
     * Add a player to the game
     */
    addPlayer(id: string, name: string, model: string = '', personality: string = ''): void {
        if (this.players.length >= 4) {
            throw new Error('Maximum 4 players allowed');
        }

        this.players.push({
            id,
            name,
            model,
            handCount: 0,
            books: [],
            hand: [],
            personality
        });
    }

    /**
     * Deal initial cards (7 cards per player for 2 players, 5 for 3-4 players)
     */
    dealCards(): void {
        const cardsPerPlayer = this.players.length <= 2 ? 7 : 5;

        for (let i = 0; i < cardsPerPlayer; i++) {
            for (const player of this.players) {
                const card = this.deck.pop();
                if (card) {
                    player.hand.push(card);
                    player.handCount = player.hand.length;
                }
            }
        }

        // Check for any initial books
        for (const player of this.players) {
            this.checkForBooks(player);
        }

        this.notifyStateChange();
    }

    /**
     * Reset the game
     */
    reset(): void {
        for (const player of this.players) {
            player.hand = [];
            player.handCount = 0;
            player.books = [];
        }

        this.initializeDeck();
        this.currentPlayerIndex = 0;
        this.gameOver = false;
        this.winner = null;
        this.turnHistory = [];
        this.lastAction = null;
        this.startTime = Date.now();

        this.dealCards();
        this.notifyStateChange();
    }

    /**
     * Get public game state (hides other players' hands)
     */
    getPublicState(): GameState {
        return {
            players: this.players.map(p => ({
                id: p.id,
                name: p.name,
                model: p.model,
                handCount: p.handCount,
                books: p.books,
                personality: p.personality
            })),
            currentPlayerIndex: this.currentPlayerIndex,
            deckCount: this.deck.length,
            gameOver: this.gameOver,
            winner: this.winner,
            lastAction: this.lastAction,
            turnHistory: this.turnHistory.slice(-10), // Last 10 actions
            startTime: this.startTime,
            booksToWin: BOOKS_TO_WIN
        };
    }

    /**
     * Get a player's private view (their own hand)
     */
    getPlayerView(playerId: string): PlayerPrivateView | null {
        const player = this.players.find(p => p.id === playerId);
        if (!player) return null;

        return {
            hand: [...player.hand],
            handCount: player.hand.length,
            books: [...player.books]
        };
    }

    /**
     * Get current player ID
     */
    getCurrentPlayerId(): string {
        return this.players[this.currentPlayerIndex]?.id || '';
    }

    /**
     * Check if it's a player's turn
     */
    isPlayerTurn(playerId: string): boolean {
        return this.getCurrentPlayerId() === playerId && !this.gameOver;
    }

    /**
     * Ask another player for cards
     */
    askForCards(askingPlayerId: string, targetPlayerId: string, rank: Rank): AskResult {
        // Validate it's the player's turn
        if (!this.isPlayerTurn(askingPlayerId)) {
            return {
                success: false,
                message: `It's not your turn! Current player: ${this.getCurrentPlayerId()}`,
                cardsReceived: 0,
                goFish: false,
                drewCard: false,
                drewRequestedRank: false,
                madeBook: false,
                yourTurnContinues: false
            };
        }

        const askingPlayer = this.players.find(p => p.id === askingPlayerId)!;
        const targetPlayer = this.players.find(p => p.id === targetPlayerId);

        if (!targetPlayer) {
            return {
                success: false,
                message: `Player ${targetPlayerId} not found`,
                cardsReceived: 0,
                goFish: false,
                drewCard: false,
                drewRequestedRank: false,
                madeBook: false,
                yourTurnContinues: false
            };
        }

        if (targetPlayerId === askingPlayerId) {
            return {
                success: false,
                message: `You can't ask yourself for cards!`,
                cardsReceived: 0,
                goFish: false,
                drewCard: false,
                drewRequestedRank: false,
                madeBook: false,
                yourTurnContinues: false
            };
        }

        // Check if asking player has the rank they're asking for
        const hasRank = askingPlayer.hand.some(c => c.rank === rank);
        if (!hasRank) {
            return {
                success: false,
                message: `You must have at least one ${rank} to ask for it!`,
                cardsReceived: 0,
                goFish: false,
                drewCard: false,
                drewRequestedRank: false,
                madeBook: false,
                yourTurnContinues: false
            };
        }

        // Check if target has the cards
        const matchingCards = targetPlayer.hand.filter(c => c.rank === rank);

        let result: AskResult;

        if (matchingCards.length > 0) {
            // Transfer cards
            for (const card of matchingCards) {
                const index = targetPlayer.hand.indexOf(card);
                targetPlayer.hand.splice(index, 1);
                askingPlayer.hand.push(card);
            }

            targetPlayer.handCount = targetPlayer.hand.length;
            askingPlayer.handCount = askingPlayer.hand.length;

            // Record action
            this.lastAction = {
                type: 'ask',
                playerId: askingPlayerId,
                playerName: askingPlayer.name,
                targetId: targetPlayerId,
                targetName: targetPlayer.name,
                rank,
                success: true,
                cardsReceived: matchingCards.length,
                message: `${askingPlayer.name} got ${matchingCards.length} ${rank}(s) from ${targetPlayer.name}!`,
                timestamp: Date.now()
            };
            this.turnHistory.push(this.lastAction);

            result = {
                success: true,
                message: `Got ${matchingCards.length} ${rank}(s) from ${targetPlayer.name}!`,
                cardsReceived: matchingCards.length,
                goFish: false,
                drewCard: false,
                drewRequestedRank: false,
                madeBook: false,
                yourTurnContinues: true  // Keep playing after getting cards
            };
        } else {
            // Go Fish!
            this.lastAction = {
                type: 'go_fish',
                playerId: askingPlayerId,
                playerName: askingPlayer.name,
                targetId: targetPlayerId,
                targetName: targetPlayer.name,
                rank,
                success: false,
                cardsReceived: 0,
                message: `${targetPlayer.name} says "Go Fish!" to ${askingPlayer.name}`,
                timestamp: Date.now()
            };
            this.turnHistory.push(this.lastAction);

            // Draw from deck
            let drewRequestedRank = false;
            if (this.deck.length > 0) {
                const drawnCard = this.deck.pop()!;
                askingPlayer.hand.push(drawnCard);
                askingPlayer.handCount = askingPlayer.hand.length;

                if (drawnCard.rank === rank) {
                    drewRequestedRank = true;
                }

                result = {
                    success: false,
                    message: drewRequestedRank
                        ? `Go Fish! You drew a ${rank} - lucky! Your turn continues.`
                        : `Go Fish! You drew a card. Turn ends.`,
                    cardsReceived: 0,
                    goFish: true,
                    drewCard: true,
                    drewRequestedRank,
                    madeBook: false,
                    yourTurnContinues: drewRequestedRank  // Continue only if drew requested rank
                };
            } else {
                result = {
                    success: false,
                    message: `Go Fish! But the deck is empty. Turn ends.`,
                    cardsReceived: 0,
                    goFish: true,
                    drewCard: false,
                    drewRequestedRank: false,
                    madeBook: false,
                    yourTurnContinues: false
                };
            }
        }

        // Check for books
        const madeBook = this.checkForBooks(askingPlayer);
        if (madeBook) {
            result.madeBook = true;
            result.bookRank = madeBook;
            result.message += ` Made a book of ${madeBook}s!`;
        }

        // Check for game over conditions
        if (this.checkGameOver()) {
            result.yourTurnContinues = false;
        } else if (!result.yourTurnContinues) {
            // Move to next player
            this.nextTurn();
        }

        this.notifyStateChange();
        return result;
    }

    /**
     * Check if player has 4 of a kind and remove them as a book
     */
    private checkForBooks(player: InternalPlayer): Rank | null {
        for (const rank of RANKS) {
            const cards = player.hand.filter(c => c.rank === rank);
            if (cards.length === 4) {
                // Remove cards and add book
                player.hand = player.hand.filter(c => c.rank !== rank);
                player.handCount = player.hand.length;
                player.books.push(rank);

                // Record action
                const bookAction: GameAction = {
                    type: 'book',
                    playerId: player.id,
                    playerName: player.name,
                    rank,
                    message: `${player.name} made a book of ${rank}s!`,
                    timestamp: Date.now()
                };
                this.turnHistory.push(bookAction);

                return rank;
            }
        }
        return null;
    }

    /**
     * Check if game is over
     */
    private checkGameOver(): boolean {
        // Game ends when BOOKS_TO_WIN books are made (or all 13 for full game)
        const totalBooks = this.players.reduce((sum, p) => sum + p.books.length, 0);

        if (totalBooks >= BOOKS_TO_WIN) {
            this.gameOver = true;

            // Find winner (most books)
            let maxBooks = 0;
            let winnerId = '';
            let winnerName = '';

            for (const player of this.players) {
                if (player.books.length > maxBooks) {
                    maxBooks = player.books.length;
                    winnerId = player.id;
                    winnerName = player.name;
                }
            }

            this.winner = winnerId;

            const gameOverAction: GameAction = {
                type: 'game_over',
                playerId: winnerId,
                playerName: winnerName,
                message: `Game Over! ${winnerName} wins with ${maxBooks} books!`,
                timestamp: Date.now()
            };
            this.turnHistory.push(gameOverAction);
            this.lastAction = gameOverAction;

            this.onGameOver?.(winnerId, winnerName);
            return true;
        }

        // Also check if current player has no cards and deck is empty
        const currentPlayer = this.players[this.currentPlayerIndex];
        if (currentPlayer.hand.length === 0 && this.deck.length === 0) {
            // Skip to next player with cards
            for (let i = 0; i < this.players.length; i++) {
                this.currentPlayerIndex = (this.currentPlayerIndex + 1) % this.players.length;
                if (this.players[this.currentPlayerIndex].hand.length > 0) {
                    break;
                }
            }

            // If no one has cards, game is over
            if (this.players.every(p => p.hand.length === 0)) {
                this.gameOver = true;

                let maxBooks = 0;
                let winnerId = '';
                let winnerName = '';

                for (const player of this.players) {
                    if (player.books.length > maxBooks) {
                        maxBooks = player.books.length;
                        winnerId = player.id;
                        winnerName = player.name;
                    }
                }

                this.winner = winnerId;
                this.onGameOver?.(winnerId, winnerName);
                return true;
            }
        }

        return false;
    }

    /**
     * Move to next player
     */
    private nextTurn(): void {
        // Find next player with cards (or any player if deck has cards)
        const startIndex = this.currentPlayerIndex;
        do {
            this.currentPlayerIndex = (this.currentPlayerIndex + 1) % this.players.length;
            const nextPlayer = this.players[this.currentPlayerIndex];

            // If player has cards, they can play
            if (nextPlayer.hand.length > 0) break;

            // If player has no cards but deck has cards, they draw
            if (this.deck.length > 0) {
                const card = this.deck.pop()!;
                nextPlayer.hand.push(card);
                nextPlayer.handCount = nextPlayer.hand.length;
                break;
            }
        } while (this.currentPlayerIndex !== startIndex);
    }

    /**
     * Get ranks in a player's hand
     */
    getPlayerRanks(playerId: string): Rank[] {
        const player = this.players.find(p => p.id === playerId);
        if (!player) return [];

        const ranks = new Set<Rank>();
        for (const card of player.hand) {
            ranks.add(card.rank);
        }
        return Array.from(ranks);
    }

    /**
     * Get other players' IDs
     */
    getOtherPlayers(playerId: string): { id: string; name: string; handCount: number }[] {
        return this.players
            .filter(p => p.id !== playerId)
            .map(p => ({ id: p.id, name: p.name, handCount: p.handCount }));
    }

    /**
     * Update player model
     */
    setPlayerModel(playerId: string, model: string): void {
        const player = this.players.find(p => p.id === playerId);
        if (player) {
            player.model = model;
            this.notifyStateChange();
        }
    }

    /**
     * Callbacks
     */
    onStateChangeCallback(callback: (state: GameState) => void): void {
        this.onStateChange = callback;
    }

    onGameOverCallback(callback: (winnerId: string, winnerName: string) => void): void {
        this.onGameOver = callback;
    }

    private notifyStateChange(): void {
        this.onStateChange?.(this.getPublicState());
    }
}
