/**
 * MXF CLI TUI — Input History Hook
 *
 * Tracks submitted input strings and provides arrow-key navigation
 * through input history (up = previous, down = next).
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
    /** Navigate up in history (returns previous input or null) */
    navigateUp: () => string | null;
    /** Navigate down in history (returns next input or null) */
    navigateDown: () => string | null;
    /** Reset navigation index (called when user types new input) */
    resetNavigation: () => void;
}

/**
 * Hook for managing input history with up/down arrow navigation.
 */
export function useInputHistory(): InputHistoryResult {
    const [history] = useState<string[]>([]);
    const indexRef = useRef<number>(-1);

    const addToHistory = useCallback((input: string) => {
        const trimmed = input.trim();
        if (!trimmed) return;

        // Don't add duplicate of the most recent entry
        if (history.length > 0 && history[history.length - 1] === trimmed) {
            indexRef.current = -1;
            return;
        }

        history.push(trimmed);

        // Trim oldest entries if we exceed max size
        while (history.length > MAX_HISTORY_SIZE) {
            history.shift();
        }

        // Reset navigation index
        indexRef.current = -1;
    }, [history]);

    const navigateUp = useCallback((): string | null => {
        if (history.length === 0) return null;

        if (indexRef.current === -1) {
            // Start navigating from the most recent entry
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

        // Past the end — return to empty input
        indexRef.current = -1;
        return null;
    }, [history]);

    const resetNavigation = useCallback(() => {
        indexRef.current = -1;
    }, []);

    return { addToHistory, navigateUp, navigateDown, resetNavigation };
}
