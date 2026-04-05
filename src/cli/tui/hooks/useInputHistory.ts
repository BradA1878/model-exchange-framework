/**
 * MXF CLI TUI — Input History Hook
 *
 * Tracks submitted input strings and provides arrow-key navigation
 * through input history (up = previous, down = next). Saves the
 * current in-progress input when navigation starts so it can be
 * restored when the user scrolls past the end of history.
 *
 * @author Brad Anderson <BradA1878@pm.me>
 */

import { useState, useCallback, useRef } from 'react';

/** Maximum number of history entries to retain */
const MAX_HISTORY_SIZE = 100;

/** Return type for the useInputHistory hook */
export interface InputHistoryResult {
    /** Add a new entry to history (called on input submit) */
    addToHistory: (input: string) => void;
    /** Navigate up in history. Pass current input to save it on first navigation. */
    navigateUp: (currentInput?: string) => string | null;
    /** Navigate down in history (returns next input, or saved input at end) */
    navigateDown: () => string | null;
    /** Reset navigation index (called when user types new input) */
    resetNavigation: () => void;
}

/**
 * Hook for managing input history with up/down arrow navigation.
 *
 * When the user presses Up for the first time, the current in-progress
 * input is saved so that pressing Down past the end of history restores
 * it (matching shell and Claude Code behavior).
 */
export function useInputHistory(): InputHistoryResult {
    const [history] = useState<string[]>([]);
    const indexRef = useRef<number>(-1);
    // Saved in-progress input — stored when user starts navigating history
    const savedInputRef = useRef<string | null>(null);

    const addToHistory = useCallback((input: string) => {
        const trimmed = input.trim();
        if (!trimmed) return;

        // Don't add duplicate of the most recent entry
        if (history.length > 0 && history[history.length - 1] === trimmed) {
            indexRef.current = -1;
            savedInputRef.current = null;
            return;
        }

        history.push(trimmed);

        // Trim oldest entries if we exceed max size
        while (history.length > MAX_HISTORY_SIZE) {
            history.shift();
        }

        // Reset navigation index
        indexRef.current = -1;
        savedInputRef.current = null;
    }, [history]);

    const navigateUp = useCallback((currentInput?: string): string | null => {
        if (history.length === 0) return null;

        if (indexRef.current === -1) {
            // First navigation — save the current in-progress input
            if (currentInput !== undefined) {
                savedInputRef.current = currentInput;
            }
            // Start from the most recent entry
            indexRef.current = history.length - 1;
        } else if (indexRef.current > 0) {
            indexRef.current--;
        }

        return history[indexRef.current] || null;
    }, [history]);

    const navigateDown = useCallback((): string | null => {
        if (history.length === 0 || indexRef.current === -1) return null;

        if (indexRef.current < history.length - 1) {
            indexRef.current++;
            return history[indexRef.current] || null;
        }

        // Past the end — restore saved in-progress input
        indexRef.current = -1;
        const saved = savedInputRef.current;
        savedInputRef.current = null;
        return saved ?? '';
    }, [history]);

    const resetNavigation = useCallback(() => {
        indexRef.current = -1;
        savedInputRef.current = null;
    }, []);

    return { addToHistory, navigateUp, navigateDown, resetNavigation };
}
