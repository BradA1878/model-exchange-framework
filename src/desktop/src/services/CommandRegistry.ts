/**
 * MXF Desktop — Slash Command Registry
 *
 * Manages registration and dispatch of slash commands. Adapted from
 * the TUI's registry pattern but uses the SidecarBridge for server
 * operations and Zustand for state updates.
 *
 * @author Brad Anderson <BradA1878@pm.me>
 */

import type { SidecarBridge } from './SidecarBridge';

/** Context passed to slash command handlers */
export interface CommandContext {
    /** Sidecar bridge for server operations */
    bridge: SidecarBridge | null;
    /** Submit a task to the orchestrator agent */
    submitTask: (task: string) => Promise<void>;
    /** Close the desktop app window */
    requestExit: () => void;
}

/** Definition of a single slash command */
export interface DesktopCommand {
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
const commands: Map<string, DesktopCommand> = new Map();

/**
 * Register a slash command.
 * Called at module load time by CommandHandlers.ts.
 */
export function registerCommand(command: DesktopCommand): void {
    commands.set(command.name.toLowerCase(), command);
}

/**
 * Execute a slash command by name.
 *
 * @param input - Full input string starting with `/` (e.g., "/model claude-haiku")
 * @param context - Command context with bridge, submitTask, and exit callback
 * @returns true if the command was found and executed, false if unknown
 */
export async function executeCommand(input: string, context: CommandContext): Promise<boolean> {
    const trimmed = input.substring(1).trim();
    const spaceIndex = trimmed.indexOf(' ');
    const name = spaceIndex === -1 ? trimmed : trimmed.substring(0, spaceIndex);
    const args = spaceIndex === -1 ? '' : trimmed.substring(spaceIndex + 1).trim();

    const command = commands.get(name.toLowerCase());
    if (!command) {
        // Import here to avoid circular dependency at module load time
        const { useAppState, generateMessageId } = await import('../state/appState');
        useAppState.getState().addMessage({
            id: generateMessageId(),
            type: 'error',
            content: `Unknown command: /${name}. Type /help for available commands.`,
            timestamp: Date.now(),
        });
        return false;
    }

    await command.handler(args, context);
    return true;
}

/** Get all registered commands (for /help display and autocomplete) */
export function getRegisteredCommands(): DesktopCommand[] {
    return Array.from(commands.values());
}
