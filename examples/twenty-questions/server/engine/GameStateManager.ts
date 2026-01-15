/**
 * Twenty Questions Game State Manager
 * Handles all game logic and state with ORPAR cycle tracking
 *
 * Game Flow:
 * 1. Thinker sets secret (setup phase)
 * 2. Guesser asks yes/no question (questioning phase)
 * 3. Thinker answers question (answering phase)
 * 4. Repeat until correct guess or 20 questions exhausted
 *
 * ORPAR Demonstration:
 * - Each question cycle shows the cognitive loop
 * - Guesser: Observe answers → Reason about patterns → Plan strategy → Act (ask) → Reflect
 * - Thinker: Observe question → Reason about answer → Act (answer) → Reflect
 */

import {
    GameState,
    GameStateView,
    PlayerRole,
    PlayerInfo,
    QuestionAnswer,
    AnswerType,
    GamePhase,
    SetSecretResult,
    QuestionResult,
    AnswerResult,
    GuessResult,
    OrparPhaseLog
} from '../types/game';

export class GameStateManager {
    private state: GameState;
    private onStateChange?: (state: GameState) => void;
    private onGameOver?: (winner: PlayerRole | 'none') => void;
    private onPhaseChange?: (phase: GamePhase, role: PlayerRole) => void;

    constructor() {
        this.state = this.createInitialState();
    }

    private createInitialState(): GameState {
        return {
            phase: 'setup',
            secretThing: null,
            category: null,
            questionsAsked: 0,
            maxQuestions: 20,
            questionHistory: [],
            winner: null,
            gameOver: false,
            players: {
                thinker: {
                    agentId: '',
                    name: 'Thinker',
                    model: '',
                    personality: '',
                    orparPhases: []
                },
                guesser: {
                    agentId: '',
                    name: 'Guesser',
                    model: '',
                    personality: '',
                    orparPhases: []
                }
            },
            startTime: Date.now(),
            lastActionTime: null,
            currentTurn: 'thinker',
            orparCycleCount: 0
        };
    }

    /**
     * Reset the game for a new round
     */
    reset(): void {
        const players = this.state.players;
        this.state = this.createInitialState();
        this.state.players = {
            thinker: { ...players.thinker, orparPhases: [] },
            guesser: { ...players.guesser, orparPhases: [] }
        };
        this.notifyStateChange();
    }

    /**
     * Set player info
     */
    setPlayer(role: PlayerRole, info: Partial<PlayerInfo>): void {
        this.state.players[role] = { ...this.state.players[role], ...info };
        this.notifyStateChange();
    }

    /**
     * Get current game state (internal - full state)
     */
    getState(): GameState {
        return { ...this.state };
    }

    /**
     * Get game state view for a specific player (hides secret from guesser)
     */
    getStateView(role: PlayerRole): GameStateView {
        const view: GameStateView = {
            phase: this.state.phase,
            category: this.state.category,
            questionsAsked: this.state.questionsAsked,
            maxQuestions: this.state.maxQuestions,
            questionsRemaining: this.state.maxQuestions - this.state.questionsAsked,
            questionHistory: this.state.questionHistory.map(qa => ({
                ...qa,
                // Hide thinker's reasoning from guesser
                reasoning: role === 'thinker' ? qa.reasoning : undefined
            })),
            gameOver: this.state.gameOver,
            winner: this.state.winner,
            currentTurn: this.state.currentTurn,
            yourRole: role
        };

        // Only thinker can see the secret
        if (role === 'thinker') {
            view.secretThing = this.state.secretThing || undefined;
        }

        return view;
    }

    /**
     * Get a formatted summary of the game state for LLM context
     */
    getStateSummary(role: PlayerRole): string {
        const view = this.getStateView(role);
        let summary = `\n=== Twenty Questions Game State ===\n`;
        summary += `Your Role: ${role.toUpperCase()}\n`;
        summary += `Phase: ${view.phase}\n`;
        summary += `Category: ${view.category || 'Not set yet'}\n`;

        if (role === 'thinker' && view.secretThing) {
            summary += `Secret Thing: ${view.secretThing}\n`;
        }

        summary += `Questions Asked: ${view.questionsAsked}/${view.maxQuestions}\n`;
        summary += `Questions Remaining: ${view.questionsRemaining}\n`;
        summary += `Current Turn: ${view.currentTurn}\n`;

        if (view.questionHistory.length > 0) {
            summary += `\n--- Question History ---\n`;
            view.questionHistory.forEach((qa, i) => {
                summary += `Q${qa.questionNumber}: "${qa.question}" → ${qa.answer.toUpperCase()}\n`;
            });
        }

        if (view.gameOver) {
            summary += `\n*** GAME OVER ***\n`;
            summary += `Winner: ${view.winner}\n`;
        }

        summary += `================================\n`;
        return summary;
    }

    /**
     * Log an ORPAR phase for a player (for demonstration/visualization)
     */
    logOrparPhase(role: PlayerRole, phase: OrparPhaseLog['phase'], summary: string): void {
        this.state.players[role].orparPhases.push({
            phase,
            timestamp: Date.now(),
            summary
        });
        this.notifyStateChange();
    }

    /**
     * Set the secret thing (Thinker only, during setup)
     */
    setSecret(agentId: string, secret: string, category: string): SetSecretResult {
        // Validate it's the thinker
        if (this.state.players.thinker.agentId !== agentId) {
            return {
                success: false,
                message: 'Only the Thinker can set the secret!'
            };
        }

        // Validate we're in setup phase
        if (this.state.phase !== 'setup') {
            return {
                success: false,
                message: `Cannot set secret during ${this.state.phase} phase`
            };
        }

        // Set the secret
        this.state.secretThing = secret;
        this.state.category = category;
        this.state.phase = 'questioning';
        this.state.currentTurn = 'guesser';
        this.state.lastActionTime = Date.now();

        this.notifyStateChange();
        this.onPhaseChange?.('questioning', 'guesser');

        return {
            success: true,
            message: `Secret set! Category hint: "${category}". The Guesser will now ask questions.`,
            category
        };
    }

    /**
     * Ask a question (Guesser only)
     */
    askQuestion(agentId: string, question: string): QuestionResult {
        // Validate it's the guesser
        if (this.state.players.guesser.agentId !== agentId) {
            return {
                success: false,
                message: 'Only the Guesser can ask questions!'
            };
        }

        // Validate game state
        if (this.state.phase !== 'questioning') {
            return {
                success: false,
                message: `Cannot ask questions during ${this.state.phase} phase`
            };
        }

        if (this.state.currentTurn !== 'guesser') {
            return {
                success: false,
                message: 'Wait for your turn! The Thinker is still answering.'
            };
        }

        if (this.state.gameOver) {
            return {
                success: false,
                message: 'Game is already over!'
            };
        }

        // Increment question count
        this.state.questionsAsked++;
        this.state.orparCycleCount++;

        // Record the question (answer to be filled in by thinker)
        const qa: QuestionAnswer = {
            questionNumber: this.state.questionsAsked,
            question,
            answer: 'unknown', // Will be updated by thinker
            timestamp: Date.now(),
            orparCycle: this.state.orparCycleCount
        };
        this.state.questionHistory.push(qa);

        // Switch to answering phase
        this.state.phase = 'answering';
        this.state.currentTurn = 'thinker';
        this.state.lastActionTime = Date.now();

        this.notifyStateChange();
        this.onPhaseChange?.('answering', 'thinker');

        return {
            success: true,
            message: `Question ${this.state.questionsAsked} asked. Waiting for Thinker's answer...`,
            questionNumber: this.state.questionsAsked,
            questionsRemaining: this.state.maxQuestions - this.state.questionsAsked
        };
    }

    /**
     * Answer the current question (Thinker only)
     */
    answerQuestion(agentId: string, answer: AnswerType, reasoning?: string): AnswerResult {
        // Validate it's the thinker
        if (this.state.players.thinker.agentId !== agentId) {
            return {
                success: false,
                message: 'Only the Thinker can answer questions!'
            };
        }

        // Validate game state
        if (this.state.phase !== 'answering') {
            return {
                success: false,
                message: `Cannot answer during ${this.state.phase} phase`
            };
        }

        if (this.state.currentTurn !== 'thinker') {
            return {
                success: false,
                message: 'Wait for your turn! The Guesser is asking a question.'
            };
        }

        // Update the most recent question with the answer
        const currentQA = this.state.questionHistory[this.state.questionHistory.length - 1];
        currentQA.answer = answer;
        currentQA.reasoning = reasoning;

        // Check if questions exhausted
        if (this.state.questionsAsked >= this.state.maxQuestions) {
            this.state.phase = 'guessing';
            this.state.currentTurn = 'guesser';
            this.notifyStateChange();
            this.onPhaseChange?.('guessing', 'guesser');

            return {
                success: true,
                message: `Answered: ${answer.toUpperCase()}. All 20 questions used! Guesser must make a final guess.`,
                answer,
                questionNumber: currentQA.questionNumber
            };
        }

        // Switch back to questioning phase
        this.state.phase = 'questioning';
        this.state.currentTurn = 'guesser';
        this.state.lastActionTime = Date.now();

        this.notifyStateChange();
        this.onPhaseChange?.('questioning', 'guesser');

        return {
            success: true,
            message: `Answered: ${answer.toUpperCase()}. Guesser's turn to ask another question or make a guess.`,
            answer,
            questionNumber: currentQA.questionNumber
        };
    }

    /**
     * Make a final guess (Guesser only)
     */
    makeGuess(agentId: string, guess: string): GuessResult {
        // Validate it's the guesser
        if (this.state.players.guesser.agentId !== agentId) {
            return {
                success: false,
                message: 'Only the Guesser can make guesses!'
            };
        }

        // Validate game state
        if (this.state.phase !== 'questioning' && this.state.phase !== 'guessing') {
            return {
                success: false,
                message: `Cannot make a guess during ${this.state.phase} phase`
            };
        }

        if (this.state.gameOver) {
            return {
                success: false,
                message: 'Game is already over!'
            };
        }

        // Check if guess is correct (case-insensitive, trimmed)
        const normalizedGuess = guess.toLowerCase().trim();
        const normalizedSecret = (this.state.secretThing || '').toLowerCase().trim();
        const isCorrect = normalizedGuess === normalizedSecret;

        // End the game
        this.state.gameOver = true;
        this.state.phase = 'game_over';
        this.state.winner = isCorrect ? 'guesser' : 'thinker';
        this.state.lastActionTime = Date.now();

        this.notifyStateChange();
        this.onGameOver?.(this.state.winner);

        if (isCorrect) {
            return {
                success: true,
                message: `🎉 CORRECT! The secret was "${this.state.secretThing}". Guesser wins!`,
                correct: true,
                secretThing: this.state.secretThing || undefined,
                gameOver: true,
                winner: 'guesser'
            };
        } else {
            return {
                success: true,
                message: `❌ WRONG! The secret was "${this.state.secretThing}", not "${guess}". Thinker wins!`,
                correct: false,
                secretThing: this.state.secretThing || undefined,
                gameOver: true,
                winner: 'thinker'
            };
        }
    }

    /**
     * Check if it's a specific player's turn
     */
    isPlayerTurn(role: PlayerRole): boolean {
        return this.state.currentTurn === role && !this.state.gameOver;
    }

    /**
     * Get the role of an agent by ID
     */
    getAgentRole(agentId: string): PlayerRole | null {
        if (this.state.players.thinker.agentId === agentId) return 'thinker';
        if (this.state.players.guesser.agentId === agentId) return 'guesser';
        return null;
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
    onGameOverCallback(callback: (winner: PlayerRole | 'none') => void): void {
        this.onGameOver = callback;
    }

    /**
     * Set phase change callback
     */
    onPhaseChangeCallback(callback: (phase: GamePhase, role: PlayerRole) => void): void {
        this.onPhaseChange = callback;
    }

    private notifyStateChange(): void {
        this.onStateChange?.(this.getState());
    }
}
