/**
 * MXF CLI TUI — Session Hook
 *
 * Bridges the InteractiveSessionManager to React state via dispatch.
 * Handles connect on mount, disconnect on unmount, and provides
 * submitTask and submitTaskToAgent callbacks for input routing.
 *
 * On connect, initializes all enabled agents in the status bar with their colors.
 * Agent definitions come from TuiConfig.agentDefinitions (loaded from .md files).
 *
 * On disconnect, saves session history to ~/.mxf/sessions/ via SessionHistoryService.
 *
 * @author Brad Anderson <BradA1878@pm.me>
 */

import { useEffect, useCallback, useRef, type Dispatch } from 'react';
import type { AppAction, AppState } from '../state';
import type { InteractiveSessionManager } from '../services/InteractiveSessionManager';
import { getAgentMaps } from '../agents/AgentDefinitions';
import { SessionHistoryService } from '../services/SessionHistory';
import type { SessionRecord } from '../services/SessionHistory';

/**
 * Hook that manages the InteractiveSessionManager lifecycle.
 *
 * - Connects to the MXF server on mount (creates agents from definitions)
 * - Dispatches connection status changes
 * - Provides submitTask callback (routes to orchestrator by default)
 * - Provides submitTaskToAgent callback (for @mention direct routing)
 * - Saves session history on disconnect
 * - Disconnects all agents on unmount
 *
 * @param session - The InteractiveSessionManager instance
 * @param dispatch - React dispatch function for state updates
 * @param getState - Function to get current app state (for session history saving)
 */
export function useSession(
    session: InteractiveSessionManager,
    dispatch: Dispatch<AppAction>,
    getState: () => AppState,
): {
    submitTask: (task: string, contextString?: string | null, recentResult?: string | null) => Promise<void>;
    submitTaskToAgent: (task: string, agentId: string, contextString?: string | null) => Promise<void>;
} {
    const sessionRef = useRef(session);
    const getStateRef = useRef(getState);

    useEffect(() => {
        sessionRef.current = session;
    }, [session]);

    useEffect(() => {
        getStateRef.current = getState;
    }, [getState]);

    // Connect on mount
    useEffect(() => {
        let cancelled = false;

        const connect = async () => {
            dispatch({ type: 'SET_CONNECTION', status: 'connecting' });

            try {
                await sessionRef.current.connect();

                if (!cancelled) {
                    dispatch({ type: 'SET_CONNECTION', status: 'connected' });

                    // Initialize agents in the status bar from connected definitions
                    const definitions = sessionRef.current.getConnectedDefinitions();
                    dispatch({
                        type: 'SET_AGENTS',
                        agents: definitions.map((def) => ({
                            id: def.agentId,
                            name: def.name,
                            status: 'idle' as const,
                            color: def.color,
                        })),
                    });

                    // Build welcome message with agent list, models, cwd, and quick-start hints
                    const agentList = definitions.map(d => d.name).join(', ');
                    const defaultModel = sessionRef.current.getDefaultModel();
                    const agentModels = sessionRef.current.getAgentModels();
                    const cwd = process.cwd();

                    // Show per-agent models when overrides are configured
                    const modelLines: string[] = [];
                    if (Object.keys(agentModels).length > 0) {
                        modelLines.push(`Default model: ${defaultModel}`);
                        for (const def of definitions) {
                            const model = agentModels[def.agentId] || defaultModel;
                            const suffix = agentModels[def.agentId] ? '' : ' (default)';
                            modelLines.push(`  ${def.name}: ${model}${suffix}`);
                        }
                    } else {
                        modelLines.push(`Model: ${defaultModel}`);
                    }

                    dispatch({
                        type: 'ADD_ENTRY',
                        entry: {
                            type: 'system',
                            content: [
                                `Connected. ${agentList} agents ready.`,
                                ...modelLines,
                                `Working directory: ${cwd}`,
                                '',
                                'Type a task to get started, or /help for commands.',
                            ].join('\n'),
                        },
                    });
                }
            } catch (error: any) {
                if (!cancelled) {
                    dispatch({ type: 'SET_CONNECTION', status: 'error' });
                    dispatch({
                        type: 'ADD_ENTRY',
                        entry: {
                            type: 'error',
                            content: `Connection failed: ${error.message || error}`,
                        },
                    });
                }
            }
        };

        connect();

        // Save session history and disconnect on unmount
        return () => {
            cancelled = true;

            // Save session history before disconnecting
            const state = getStateRef.current();
            if (state.entries.length > 0) {
                const historyService = new SessionHistoryService();
                const record: SessionRecord = {
                    sessionId: state.sessionId,
                    channelId: sessionRef.current.getChannelId(),
                    startTime: state.costData.startTime,
                    endTime: Date.now(),
                    model: sessionRef.current.getDefaultModel(),
                    entries: state.entries,
                    costData: state.costData,
                    entryCount: state.entries.length,
                };
                historyService.save(record).catch(() => {});
            }

            sessionRef.current.disconnect().catch(() => {});
        };
    }, []); // Run once on mount

    // Submit task to orchestrator (default routing)
    const submitTask = useCallback(async (task: string, contextString?: string | null, recentResult?: string | null) => {
        if (!sessionRef.current.isConnected()) {
            dispatch({
                type: 'ADD_ENTRY',
                entry: {
                    type: 'error',
                    content: 'Not connected to MXF server. Please wait for connection or restart.',
                },
            });
            return;
        }

        // Add user message to conversation
        dispatch({
            type: 'ADD_ENTRY',
            entry: { type: 'user', content: task },
        });

        // Find orchestrator from connected definitions and mark as working
        const definitions = sessionRef.current.getConnectedDefinitions();
        const orchestrator = definitions.find(d => d.role === 'orchestrator');
        const orchestratorId = orchestrator?.agentId || definitions[0]?.agentId || '';

        dispatch({ type: 'SET_AGENT_WORKING', working: true });
        dispatch({ type: 'SET_AGENT_STATUS', agentId: orchestratorId, status: 'active' });
        // Record task title and start time for the completion banner elapsed time display
        dispatch({ type: 'SET_TASK', taskId: orchestratorId, title: task });

        try {
            await sessionRef.current.submitTask(task, contextString, recentResult);
        } catch (error: any) {
            dispatch({ type: 'SET_AGENT_WORKING', working: false });
            dispatch({ type: 'SET_AGENT_STATUS', agentId: orchestratorId, status: 'error' });
            dispatch({
                type: 'ADD_ENTRY',
                entry: {
                    type: 'error',
                    content: `Task submission failed: ${error.message || error}`,
                },
            });
        }
    }, [dispatch]);

    // Submit task directly to a specific agent (for @mention routing)
    const submitTaskToAgent = useCallback(async (task: string, agentId: string, contextString?: string | null) => {
        if (!sessionRef.current.isConnected()) {
            dispatch({
                type: 'ADD_ENTRY',
                entry: {
                    type: 'error',
                    content: 'Not connected to MXF server. Please wait for connection or restart.',
                },
            });
            return;
        }

        // Resolve name from connected definitions
        const definitions = sessionRef.current.getConnectedDefinitions();
        const { names } = getAgentMaps(definitions);
        const agentName = names[agentId] || agentId;

        // Add user message to conversation (showing the @mention)
        dispatch({
            type: 'ADD_ENTRY',
            entry: { type: 'user', content: `@${agentName.toLowerCase()} ${task}` },
        });

        // Mark target agent as working
        dispatch({ type: 'SET_AGENT_WORKING', working: true });
        dispatch({ type: 'SET_AGENT_STATUS', agentId, status: 'active' });
        // Record task title and start time for the completion banner elapsed time display
        dispatch({ type: 'SET_TASK', taskId: agentId, title: task });

        try {
            await sessionRef.current.submitTaskToAgent(task, agentId, contextString);
        } catch (error: any) {
            dispatch({ type: 'SET_AGENT_WORKING', working: false });
            dispatch({ type: 'SET_AGENT_STATUS', agentId, status: 'error' });
            dispatch({
                type: 'ADD_ENTRY',
                entry: {
                    type: 'error',
                    content: `Task submission to ${agentName} failed: ${error.message || error}`,
                },
            });
        }
    }, [dispatch]);

    return { submitTask, submitTaskToAgent };
}
