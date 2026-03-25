/**
 * MXF CLI TUI — Slash Command Registry
 *
 * Manages registration and dispatch of slash commands (e.g., /help, /clear, /exit).
 * Commands are registered with a name, description, and handler function.
 *
 * @author Brad Anderson <BradA1878@pm.me>
 */

import type { Dispatch } from 'react';
import type { AppAction, AppState } from '../state';
import type { InteractiveSessionManager } from '../services/InteractiveSessionManager';

/** Context passed to slash command handlers */
export interface CommandContext {
    /** React dispatch function for state updates */
    dispatch: Dispatch<AppAction>;
    /** Interactive session manager for SDK operations */
    session: InteractiveSessionManager;
    /** Callback to trigger TUI exit */
    requestExit: () => void;
    /** Get current app state (for commands that need to read state) */
    getState?: () => AppState;
}

/** Definition of a single slash command */
export interface SlashCommand {
    /** Command name without the `/` prefix (e.g., "help") */
    name: string;
    /** Short description shown in /help output */
    description: string;
    /** Usage example (e.g., "/model anthropic/claude-haiku-3.5") */
    usage: string;
    /** Handler function — receives the args string after the command name */
    handler: (args: string, context: CommandContext) => Promise<void>;
}

/** Registry of all available slash commands */
const commands: Map<string, SlashCommand> = new Map();

/**
 * Register a slash command.
 * Called at module load time by handlers.ts.
 */
export function registerCommand(command: SlashCommand): void {
    commands.set(command.name.toLowerCase(), command);
}

/**
 * Execute a slash command by name.
 *
 * @param input - Full input string starting with `/` (e.g., "/model claude-haiku")
 * @param context - Command context with dispatch, session, and exit callback
 * @returns true if the command was found and executed, false if unknown
 */
export async function executeCommand(input: string, context: CommandContext): Promise<boolean> {
    // Parse command name and args from input (e.g., "/context src/index.ts" → name="context", args="src/index.ts")
    const trimmed = input.substring(1).trim();
    const spaceIndex = trimmed.indexOf(' ');
    const name = spaceIndex === -1 ? trimmed : trimmed.substring(0, spaceIndex);
    const args = spaceIndex === -1 ? '' : trimmed.substring(spaceIndex + 1).trim();

    const command = commands.get(name.toLowerCase());
    if (!command) {
        context.dispatch({
            type: 'ADD_ENTRY',
            entry: {
                type: 'error',
                content: `Unknown command: /${name}. Type /help for available commands.`,
            },
        });
        return false;
    }

    await command.handler(args, context);
    return true;
}

/** Get all registered commands (for /help display) */
export function getRegisteredCommands(): SlashCommand[] {
    return Array.from(commands.values());
}
