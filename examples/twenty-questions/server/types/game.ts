/**
 * Twenty Questions Game Types
 *
 * This game demonstrates advanced MXF features:
 * - ORPAR Cognitive Cycle: Observe → Reason → Plan → Act → Reflect
 * - Knowledge Graph: Guesser builds explicit knowledge model of possibility space
 * - MULS: Q-value tracking of which memories/strategies proved most useful
 * - TensorFlow/ML: Risk assessment for "should I guess now or ask more?"
 * - ORPAR-Memory Integration: Phase-aware memory strata routing
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
    // Advanced MXF feature tracking
    knowledgeGraph: KnowledgeGraphState;
    riskAssessments: RiskAssessment[];
    mulsRewards: MulsReward[];
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

// Knowledge Graph tracking for the Guesser's mental model of the possibility space
export interface KnowledgeNode {
    entity: string;
    type: 'category' | 'property' | 'candidate' | 'eliminated';
    confidence: number;
    questionNumber: number;  // When this was learned
}

export interface KnowledgeEdge {
    from: string;
    to: string;
    relationship: string;  // e.g., "has_property", "is_not", "could_be"
    questionNumber: number;
}

// Aggregated knowledge graph state for dashboard visualization
export interface KnowledgeGraphState {
    nodes: KnowledgeNode[];
    edges: KnowledgeEdge[];
}

// ML risk assessment tracking — Guesser uses this to decide when to guess vs ask more
export interface RiskAssessment {
    questionNumber: number;
    riskScore: number;       // 0-1, higher = riskier to guess now
    confidence: number;      // 0-1, how confident the model is in its assessment
    recommendation: string;  // "ask_more" or "guess_now"
    timestamp: number;
}

// MULS reward tracking — records which memories/strategies were rewarded
export interface MulsReward {
    questionNumber: number;
    reward: number;          // Reward value injected
    reason: string;          // Why this reward was given
    timestamp: number;
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
