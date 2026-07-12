/**
 * MXF CLI TUI — Keyboard Shortcuts Hook
 *
 * Global keyboard shortcuts captured via Ink's useInput hook.
 * Routes key combinations to dispatch actions for common operations.
 *
 * Shortcuts:
 *   Ctrl+C   — Exit the TUI
 *   Esc      — Stop active agent work
 *   Ctrl+L   — Clear conversation history
 *   Ctrl+S   — Stop all agents
 *   Ctrl+A   — Toggle detail mode (full vs truncated tool args)
 *
 * Esc and Ctrl+S run the real cancel path (StopController) rather than only
 * flipping the working flag — see StopController for why that distinction costs
 * money.
 *
 * Arrow key history is handled in InputLine.tsx since it needs
 * to control the input value directly.
 *
 * @author Brad Anderson <BradA1878@pm.me>
 */

import { useInput } from 'ink';
import type { Dispatch } from 'react';
import type { AppAction, AppState } from '../state';
import type { InteractiveSessionManager } from '../services/InteractiveSessionManager';
import { stopAgentActivity } from '../services/StopController';

/**
 * Hook that registers global keyboard shortcuts for the TUI.
 *
 * @param dispatch - React dispatch function for state updates
 * @param state - Current app state (to check isAgentWorking)
 * @param requestExit - Callback to trigger graceful TUI exit
 * @param session - Session manager, used to actually cancel in-flight agent work
 */
export function useKeyboardShortcuts(
    dispatch: Dispatch<AppAction>,
    state: AppState,
    requestExit: () => void,
    session: InteractiveSessionManager,
): void {
    useInput((input, key) => {
        // Ctrl+C — exit the TUI
        if (input === 'c' && key.ctrl) {
            requestExit();
            return;
        }

        // Esc — stop active agent work (only when an agent is actually working).
        // useInput's callback is sync; stopAgentActivity reports its own outcome
        // through dispatch, so the promise is intentionally not awaited here.
        if (key.escape && state.isAgentWorking) {
            void stopAgentActivity(session, dispatch);
            return;
        }

        // Ctrl+L — clear conversation history
        if (input === 'l' && key.ctrl) {
            dispatch({ type: 'CLEAR_ENTRIES' });
        }

        // Ctrl+S — stop all agents
        if (input === 's' && key.ctrl) {
            void stopAgentActivity(session, dispatch);
        }

        // Ctrl+A — toggle detail mode (verbose tool output)
        if (input === 'a' && key.ctrl) {
            dispatch({ type: 'TOGGLE_DETAIL_MODE' });
        }
    });
}
