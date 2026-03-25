/**
 * MXF CLI TUI — Confirmation Hook
 *
 * Bridges the InteractiveSessionManager's user_input callback to React state.
 * When an agent calls `user_input` with `inputType: 'confirm'`, this hook:
 * 1. Dispatches a confirmation-prompt entry to the conversation
 * 2. Sets confirmationPending state (locks InputLine to [y/n] mode)
 *
 * Handles multiple concurrent requests via a queue: only one prompt is shown
 * at a time. Additional requests are queued and shown sequentially after
 * the user responds to the current one.
 *
 * When the user responds (y/n), the hook:
 * 1. Resolves the Promise that the agent's user_input tool is blocking on
 * 2. Checks the queue for more requests — shows the next one or exits confirmation mode
 * 3. Adds an "Approved" or "Denied" system entry
 *
 * @author Brad Anderson <BradA1878@pm.me>
 */

import { useEffect, useRef, useCallback, type Dispatch } from 'react';
import type { InteractiveSessionManager } from '../services/InteractiveSessionManager';
import type { UserInputRequestData } from '../../../sdk/index';
import type { AppAction } from '../state';

/** A queued confirmation request waiting to be shown */
interface QueuedRequest {
    agentId: string;
    request: UserInputRequestData;
}

/**
 * Hook that bridges agent user_input requests to TUI confirmation prompts.
 *
 * Registers a callback on the session manager that fires when any agent
 * calls `user_input`. Only one confirmation prompt is shown at a time;
 * additional requests are queued and processed sequentially.
 *
 * @param session - The InteractiveSessionManager (null before connect)
 * @param dispatch - React dispatch for state updates
 * @param agentNames - Dynamic map of agentId → display name
 * @returns Object with handleConfirmationResponse callback
 */
export function useConfirmation(
    session: InteractiveSessionManager | null,
    dispatch: Dispatch<AppAction>,
    agentNames?: Record<string, string>,
): {
    handleConfirmationResponse: (accepted: boolean) => void;
} {
    const dispatchRef = useRef(dispatch);
    const sessionRef = useRef(session);
    const agentNamesRef = useRef(agentNames || {});

    // The request ID currently being shown to the user (null = no prompt active)
    const currentRequestIdRef = useRef<string | null>(null);

    // The agent ID of the request currently being shown (for response attribution)
    const currentAgentIdRef = useRef<string | null>(null);

    // Queue of requests waiting to be shown after the current one is resolved
    const pendingQueueRef = useRef<QueuedRequest[]>([]);

    useEffect(() => {
        dispatchRef.current = dispatch;
    }, [dispatch]);

    useEffect(() => {
        sessionRef.current = session;
    }, [session]);

    useEffect(() => {
        agentNamesRef.current = agentNames || {};
    }, [agentNames]);

    /**
     * Show a confirmation prompt for a single request.
     * Adds the entry to the conversation and switches input to [y/n] mode.
     */
    const showConfirmation = useCallback((agentId: string, request: UserInputRequestData) => {
        const agentName = agentNamesRef.current[agentId] || agentId;

        // Determine action type from the request context
        const isCodeExec = request.title?.toLowerCase().includes('run') ||
            request.title?.toLowerCase().includes('execute') ||
            request.title?.toLowerCase().includes('command');
        const actionType = isCodeExec ? 'code-execute' : 'file-modify';

        // Track current request and agent
        currentAgentIdRef.current = agentId;
        currentRequestIdRef.current = request.requestId;

        // Single compound dispatch: adds the confirmation entry AND sets pending
        // state atomically. Two separate dispatches (ADD_ENTRY + SET_CONFIRMATION_PENDING)
        // cause two renders with a gap because socket callbacks bypass React 18 auto-batching.
        dispatchRef.current({
            type: 'SET_CONFIRMATION',
            entry: {
                type: 'confirmation-prompt',
                agentId,
                agentName,
                content: request.title || 'Confirm action?',
                confirmationData: {
                    agentId,
                    agentName,
                    actionType: actionType as 'file-modify' | 'code-execute',
                    title: request.title || 'Confirm action?',
                    description: request.description,
                    requestId: request.requestId,
                },
            },
            title: request.title || null,
        });
    }, []);

    // Register the user input callback on the session manager
    useEffect(() => {
        if (!session) return;

        session.setUserInputCallback((agentId, request) => {
            if (currentRequestIdRef.current) {
                // A confirmation is already showing — queue this request
                pendingQueueRef.current.push({ agentId, request });
                return;
            }
            // No active prompt — show immediately
            showConfirmation(agentId, request);
        });
    }, [session, showConfirmation]);

    // Handle the user's y/n response
    const handleConfirmationResponse = useCallback((accepted: boolean) => {
        const requestId = currentRequestIdRef.current;
        if (!requestId) return;

        // Resolve the Promise that the agent's user_input tool is blocking on
        if (sessionRef.current) {
            sessionRef.current.resolveUserInput(requestId, accepted);
        }

        // Build the response entry payload (check/cross icon + agent color)
        const respondingAgentId = currentAgentIdRef.current || '';
        const respondingAgentName = agentNamesRef.current[respondingAgentId] || respondingAgentId || 'Agent';
        const responseEntry = {
            type: 'confirmation-response' as const,
            agentId: respondingAgentId,
            agentName: respondingAgentName,
            content: accepted ? 'Approved' : 'Denied',
            confirmationAccepted: accepted,
        };

        // Clear current request and agent
        currentAgentIdRef.current = null;
        currentRequestIdRef.current = null;

        // Check queue for the next request.
        // Brief delay before showing the next prompt to let Ink settle
        // and prevent rapid re-render flickering.
        if (pendingQueueRef.current.length > 0) {
            // More confirmations queued — add the response entry only (keep
            // confirmationPending=true so InputLine stays in TextInput mode,
            // preventing the component-switch race that causes freezes).
            dispatchRef.current({ type: 'ADD_ENTRY', entry: responseEntry });
            const next = pendingQueueRef.current.shift()!;
            setTimeout(() => {
                showConfirmation(next.agentId, next.request);
            }, 100);
        } else {
            // No more requests — compound dispatch: add response entry AND exit
            // confirmation mode atomically. Two separate dispatches here caused the
            // freeze bug (InputLine switches from TextInput to MultilineInput between renders).
            dispatchRef.current({ type: 'CONFIRMATION_RESPONSE', entry: responseEntry });
        }
    }, [showConfirmation]);

    return { handleConfirmationResponse };
}
