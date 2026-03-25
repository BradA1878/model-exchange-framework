/**
 * MXF CLI TUI — Input Handler Hook
 *
 * Parses user input and routes it to the appropriate handler:
 * - `/command` → Slash command registry
 * - `!command` → Shell executor
 * - `@agent message` → Direct task to specific agent
 * - Natural language → Task submission to orchestrator agent
 *
 * @mention routing is dynamic — built from the session's connected agents.
 *
 * @author Brad Anderson <BradA1878@pm.me>
 */

import { useCallback, useMemo, useRef, type Dispatch } from 'react';
import type { AppAction, AppState } from '../state';
import type { ConversationEntry } from '../types';
import type { InteractiveSessionManager } from '../services/InteractiveSessionManager';
import { executeCommand } from '../commands/registry';
import type { CommandContext } from '../commands/registry';
import { executeShellCommand } from '../services/ShellExecutor';

/** Behavioral prefixes prepended to task descriptions based on the current interaction mode */
const MODE_PREFIXES: Record<string, string> = {
    chat: 'Respond conversationally. Do not create tasks, delegate to other agents, modify files, or execute code. Simply discuss the topic.\n\n',
    plan: 'Analyze this request and create a plan. Explain your approach but do not execute it. Do not delegate execution tasks to specialist agents. Present the plan to the user.\n\n',
    action: '',
};

/**
 * Hook that returns a handler for processing user input.
 *
 * @param session - InteractiveSessionManager for task submission
 * @param dispatch - React dispatch function for state updates
 * @param state - Current app state (for context string)
 * @param submitTask - Function to submit a task to the orchestrator
 * @param submitTaskToAgent - Function to submit a task to a specific agent
 * @param requestExit - Callback to trigger TUI exit
 */
export function useInputHandler(
    session: InteractiveSessionManager,
    dispatch: Dispatch<AppAction>,
    state: AppState,
    submitTask: (task: string, contextString?: string | null, recentResult?: string | null) => Promise<void>,
    submitTaskToAgent: (task: string, agentId: string, contextString?: string | null) => Promise<void>,
    requestExit: () => void,
): (input: string) => Promise<void> {
    // Ref for entries — avoids recreating the callback on every entry change
    const entriesRef = useRef<ConversationEntry[]>(state.entries);
    entriesRef.current = state.entries;

    // Build dynamic @mention map from connected agents
    const nameToAgentId = useMemo(() => {
        const map: Record<string, string> = {};
        const definitions = session.getConnectedDefinitions();
        for (const def of definitions) {
            map[def.name.toLowerCase()] = def.agentId;
        }
        return map;
    }, [session]);

    return useCallback(async (input: string) => {
        const trimmed = input.trim();
        if (!trimmed) return;

        // Snap conversation to bottom on any user input submission
        dispatch({ type: 'SCROLL_TO_BOTTOM' });

        // Route based on prefix
        if (trimmed.startsWith('/')) {
            // Slash command
            const context: CommandContext = { dispatch, session, requestExit, getState: () => state };
            await executeCommand(trimmed, context);
        } else if (trimmed.startsWith('!')) {
            // Shell command
            const command = trimmed.substring(1).trim();
            if (!command) return;

            dispatch({
                type: 'ADD_ENTRY',
                entry: { type: 'user', content: `!${command}` },
            });

            const result = await executeShellCommand(command);
            const output = result.stdout || result.stderr || '(no output)';
            const exitInfo = result.exitCode !== 0 ? ` (exit code: ${result.exitCode})` : '';

            dispatch({
                type: 'ADD_ENTRY',
                entry: {
                    type: 'system',
                    content: `$ ${command}${exitInfo}\n${output}`,
                },
            });
        } else if (trimmed.startsWith('@')) {
            // @mention — route task to a specific agent
            const mentionMatch = trimmed.match(/^@(\w+)\s+(.+)$/s);
            if (mentionMatch) {
                const agentName = mentionMatch[1].toLowerCase();
                const agentId = nameToAgentId[agentName];

                if (agentId) {
                    await submitTaskToAgent(mentionMatch[2], agentId, state.contextString);

                    // Clear context after use (one-shot per /context command)
                    if (state.contextString) {
                        dispatch({ type: 'SET_CONTEXT', contextString: null });
                    }
                } else {
                    // List available agents dynamically
                    const available = Object.keys(nameToAgentId).map(n => `@${n}`).join(', ');
                    dispatch({
                        type: 'ADD_ENTRY',
                        entry: {
                            type: 'error',
                            content: `Unknown agent: @${mentionMatch[1]}. Available: ${available}`,
                        },
                    });
                }
            } else {
                const available = Object.keys(nameToAgentId).map(n => `@${n}`).join(', ');
                dispatch({
                    type: 'ADD_ENTRY',
                    entry: {
                        type: 'error',
                        content: `Usage: @agent <message> (e.g., @operator fix the import on line 23). Available: ${available}`,
                    },
                });
            }
        } else {
            // Natural language — submit as task to orchestrator
            // Prepend behavioral mode prefix to guide orchestrator behavior
            const prefix = MODE_PREFIXES[state.currentMode] || '';
            const taskWithMode = prefix ? prefix + trimmed : trimmed;

            // Extract most recent completed task result for continuity.
            // This lets follow-up prompts like "can you display it?" know
            // what the previous task produced (e.g., which file was created).
            let recentResult: string | null = null;
            const entries = entriesRef.current;
            for (let i = entries.length - 1; i >= 0; i--) {
                if (entries[i].type === 'result') {
                    const resultContent = entries[i].content;
                    // Truncate to avoid bloating the prompt
                    recentResult = resultContent.length > 500
                        ? resultContent.substring(0, 500) + '...'
                        : resultContent;
                    break;
                }
            }

            await submitTask(taskWithMode, state.contextString, recentResult);

            // Clear context after use (one-shot per /context command)
            if (state.contextString) {
                dispatch({ type: 'SET_CONTEXT', contextString: null });
            }
        }
    }, [session, dispatch, state.contextString, state.currentMode, submitTask, submitTaskToAgent, requestExit, nameToAgentId]);
}
