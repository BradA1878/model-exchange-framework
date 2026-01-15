/**
 * Twenty Questions Game Types
 *
 * This game demonstrates the ORPAR cognitive cycle:
 * - Guesser: Observe → Reason → Plan → Act (ask question) → Reflect
 * - Thinker: Observe (question) → Reason → Act (answer) → Reflect
 */

export type PlayerRole = 'thinker' | 'guesser';
export type AnswerType = 'yes' | 'no' | 'sometimes' | 'unknown';
export type GamePhase = 'setup' | 'thinking' | 'questioning' | 'answering' | 'guessing' | 'game_over';

export interface GameState {
    phase: GamePhase;
    secretThing: string | null;  // Only known to thinker
    category: string | null;     // Hint: person, place, thing, animal, etc.
    questionsAsked: number;
    maxQuestions: number;
    questionHistory: QuestionAnswer[];
    winner: PlayerRole | 'none' | null;
    gameOver: boolean;
    players: {
        thinker: PlayerInfo;
        guesser: PlayerInfo;
    };
    startTime: number;
    lastActionTime: number | null;
    currentTurn: PlayerRole;
    orparCycleCount: number;  // Track ORPAR cycles for demo purposes
}

export interface PlayerInfo {
    agentId: string;
    name: string;
    model: string;
    personality: string;
    orparPhases: OrparPhaseLog[];  // Track phases for visualization
}

export interface OrparPhaseLog {
    phase: 'Observe' | 'Reason' | 'Plan' | 'Act' | 'Reflect';
    timestamp: number;
    summary: string;
}

export interface QuestionAnswer {
    questionNumber: number;
    question: string;
    answer: AnswerType;
    reasoning?: string;  // Thinker's reasoning (hidden from guesser)
    guesserReasoning?: string;  // Guesser's reasoning after answer
    timestamp: number;
    orparCycle: number;
}

export interface Guess {
    guess: string;
    correct: boolean;
    timestamp: number;
}

export interface GameAction {
    type: 'set_secret' | 'ask_question' | 'answer_question' | 'make_guess' | 'get_state';
    playerId: string;
    role: PlayerRole;
    data?: any;
    timestamp: number;
}

export interface SetSecretResult {
    success: boolean;
    message: string;
    category?: string;
}

export interface QuestionResult {
    success: boolean;
    message: string;
    questionNumber?: number;
    questionsRemaining?: number;
    previousAnswers?: QuestionAnswer[];
}

export interface AnswerResult {
    success: boolean;
    message: string;
    answer?: AnswerType;
    questionNumber?: number;
}

export interface GuessResult {
    success: boolean;
    message: string;
    correct?: boolean;
    secretThing?: string;
    gameOver?: boolean;
    winner?: PlayerRole | 'none';
}

export interface GameStateView {
    phase: GamePhase;
    category: string | null;
    questionsAsked: number;
    maxQuestions: number;
    questionsRemaining: number;
    questionHistory: QuestionAnswer[];
    gameOver: boolean;
    winner: PlayerRole | 'none' | null;
    currentTurn: PlayerRole;
    yourRole: PlayerRole;
    // secretThing only included for thinker
    secretThing?: string;
}

// MCP Tool schemas for the game
export const GAME_TOOL_SCHEMAS = {
    game_getState: {
        name: 'game_getState',
        description: 'Get the current state of the Twenty Questions game from your perspective',
        inputSchema: {
            type: 'object',
            properties: {},
            required: []
        }
    },
    game_setSecret: {
        name: 'game_setSecret',
        description: 'Set the secret thing to be guessed (Thinker only). Choose something specific but guessable.',
        inputSchema: {
            type: 'object',
            properties: {
                secret: {
                    type: 'string',
                    description: 'The secret thing (person, place, thing, animal, etc.)'
                },
                category: {
                    type: 'string',
                    description: 'Category hint: person, place, thing, animal, food, vehicle, etc.'
                }
            },
            required: ['secret', 'category']
        }
    },
    game_askQuestion: {
        name: 'game_askQuestion',
        description: 'Ask a yes/no question about the secret thing (Guesser only)',
        inputSchema: {
            type: 'object',
            properties: {
                question: {
                    type: 'string',
                    description: 'A yes/no question about the secret thing'
                }
            },
            required: ['question']
        }
    },
    game_answerQuestion: {
        name: 'game_answerQuestion',
        description: 'Answer the most recent question (Thinker only)',
        inputSchema: {
            type: 'object',
            properties: {
                answer: {
                    type: 'string',
                    enum: ['yes', 'no', 'sometimes', 'unknown'],
                    description: 'Your answer to the question'
                },
                reasoning: {
                    type: 'string',
                    description: 'Your reasoning for this answer (kept private)'
                }
            },
            required: ['answer']
        }
    },
    game_makeGuess: {
        name: 'game_makeGuess',
        description: 'Make a final guess about the secret thing (Guesser only)',
        inputSchema: {
            type: 'object',
            properties: {
                guess: {
                    type: 'string',
                    description: 'Your guess for the secret thing'
                }
            },
            required: ['guess']
        }
    }
};
