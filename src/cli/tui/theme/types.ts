/**
 * MXF CLI TUI — Theme Type Definitions
 *
 * Defines the color scheme interface used by all TUI components.
 * Each theme provides a complete set of colors for borders, text,
 * agents, status indicators, and input prompts.
 *
 * @author Brad Anderson <BradA1878@pm.me>
 */

/** Complete color theme for the TUI */
export interface Theme {
    /** Theme identifier */
    name: string;

    // Chrome / structure
    /** Border and separator color */
    border: string;
    /** Muted/secondary text color */
    dimText: string;

    // Message types
    /** User input text color */
    userText: string;
    /** System message text color */
    systemText: string;
    /** Error message text color */
    errorText: string;

    // Agents — maps agentId to display color
    /** Per-agent text colors (keyed by agentId, e.g., 'mxf-planner' → 'white') */
    agentColors: Record<string, string>;

    // Status indicators
    /** Active agent status dot color */
    statusActive: string;
    /** Idle agent status dot color */
    statusIdle: string;
    /** Error agent status dot color */
    statusError: string;

    // Input
    /** `> ` prompt color */
    promptColor: string;
    /** `[y/n]` confirmation prompt color */
    confirmColor: string;

    // Accents
    /** Title and highlight color */
    accent: string;
    /** Success indicator color */
    success: string;
    /** Warning text color */
    warning: string;
}
