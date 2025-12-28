/**
 * Fog of War Game Configuration
 *
 * Modify these settings to customize the game.
 */

export interface GameConfig {
    /** Number of players per team (1-4) */
    playersPerTeam: number;

    /** Maximum number of turns before game ends */
    maxTurns: number;

    /** Turn duration in milliseconds */
    turnDuration: number;

    /** Map size (grid dimensions) */
    mapSize: number;

    /** Game server port */
    gameServerPort: number;

    /** Available LLM models to randomly assign to agents */
    availableModels: string[];
}

const config: GameConfig = {
    // Number of players per team (each team will have this many commanders)
    // Supported roles: scout, warrior, defender (if 3), add support (if 4)
    playersPerTeam: 3,

    // Game settings
    maxTurns: 15,
    turnDuration: 45000,  // 45 seconds
    mapSize: 12,
    gameServerPort: 3002,

    // LLM models to use (randomly assigned to each agent)
    availableModels: [
        'google/gemini-2.5-flash',
        'anthropic/claude-haiku-4.5',
        'openai/gpt-5-nano'
    ]
};

export default config;
