/**
 * MXF Desktop — Global Keyboard Shortcuts Hook
 *
 * Registers window-level keyboard shortcuts for common desktop actions.
 * These fire regardless of which component has focus.
 *
 * Shortcuts:
 *   Cmd+L / Ctrl+L   — Clear conversation
 *   Cmd+K / Ctrl+K   — Open command palette
 *   Cmd+T / Ctrl+T   — Toggle terminal panel
 *   Cmd+, / Ctrl+,   — Show debug info
 *   Cmd+/ / Ctrl+/   — Focus input area
 *
 * @author Brad Anderson <BradA1878@pm.me>
 */

import { useEffect, useCallback } from 'react';
import { useAppState } from '../state/appState';

interface ShortcutCallbacks {
    /** Called when Cmd+K is pressed — show command palette */
    onCommandPalette: () => void;
}

export function useKeyboardShortcuts(callbacks: ShortcutCallbacks): void {
    const clearMessages = useAppState((s) => s.clearMessages);
    const toggleTerminal = useAppState((s) => s.toggleTerminal);

    const handler = useCallback((e: KeyboardEvent) => {
        const mod = e.metaKey || e.ctrlKey;
        if (!mod) return;

        switch (e.key) {
            case 'l':
                e.preventDefault();
                clearMessages();
                break;
            case 'k':
                e.preventDefault();
                callbacks.onCommandPalette();
                break;
            case 't':
                // Don't override Cmd+T if there's a text input focused for browser tab
                if (e.target instanceof HTMLTextAreaElement) return;
                e.preventDefault();
                toggleTerminal();
                break;
            case '/':
                e.preventDefault();
                // Focus the input area
                const input = document.querySelector<HTMLTextAreaElement>('[data-mxf-input]');
                input?.focus();
                break;
        }
    }, [clearMessages, toggleTerminal, callbacks]);

    useEffect(() => {
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [handler]);
}
