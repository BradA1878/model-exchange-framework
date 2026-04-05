/**
 * MXF Desktop — Vim Mode Service
 *
 * Lightweight state machine providing vim-style keybindings for the
 * input area. Supports normal/insert mode switching, cursor movement,
 * word navigation, line operations, and undo.
 *
 * Starts in insert mode by default so the user can type immediately.
 * Toggled on/off via the /vim slash command.
 *
 * Normal mode keys:
 *   i/a/I/A     — enter insert mode (at cursor/after/home/end)
 *   o/O         — open line below/above and enter insert mode
 *   h/l         — move left/right
 *   j/k         — move down/up
 *   w/b         — word forward/backward
 *   0/$         — move to line start/end
 *   x           — delete character at cursor
 *   dd          — delete entire line
 *   u           — undo
 *   p           — paste from kill buffer
 *   Escape      — stay in normal mode (no-op)
 *
 * Insert mode keys:
 *   Escape      — switch to normal mode
 *   All other   — pass through to input component
 *
 * Ported from the TUI — pure state machine, zero browser/Node deps.
 *
 * @author Brad Anderson <BradA1878@pm.me>
 */

/** Result of processing a key through the vim state machine */
export interface VimKeyResult {
    /** Semantic action to perform (e.g., 'move-left', 'enter-insert', 'delete-line') */
    action: string;
    /** Whether the key was consumed by vim (true = don't pass to input) */
    consumed: boolean;
}

/** Vim mode: normal for command input, insert for text editing */
export type VimModeType = 'normal' | 'insert';

/**
 * VimModeService — singleton state machine for vim keybindings.
 *
 * When disabled, all keys pass through unconsumed. When enabled, keys are
 * intercepted in normal mode to provide movement and editing commands,
 * while insert mode passes everything through except Escape.
 */
export class VimModeService {
    private static instance: VimModeService;

    /** Whether vim mode is active */
    private _enabled: boolean = false;

    /** Current vim mode (normal or insert) */
    private _mode: VimModeType = 'insert';

    /** Pending key buffer for multi-key commands (e.g., 'dd') */
    private _pendingKey: string | null = null;

    private constructor() {
        // Singleton — use getInstance()
    }

    /** Get the singleton VimModeService instance */
    static getInstance(): VimModeService {
        if (!VimModeService.instance) {
            VimModeService.instance = new VimModeService();
        }
        return VimModeService.instance;
    }

    /** Check whether vim mode is currently enabled */
    isEnabled(): boolean {
        return this._enabled;
    }

    /** Get the current vim mode ('normal' or 'insert') */
    getMode(): VimModeType {
        return this._mode;
    }

    /** Toggle vim mode on/off. Resets to insert mode when enabling. */
    toggle(): void {
        this._enabled = !this._enabled;
        // Always start in insert mode when toggling on so the user can type immediately
        this._mode = 'insert';
        this._pendingKey = null;
    }

    /** Explicitly set the vim mode */
    setMode(mode: VimModeType): void {
        this._mode = mode;
        // Clear any pending multi-key sequence on mode change
        this._pendingKey = null;
    }

    /**
     * Process a keypress through the vim state machine.
     *
     * @param key - The key name from KeyboardEvent.key
     * @returns VimKeyResult with the semantic action and whether the key was consumed
     */
    handleKey(key: string): VimKeyResult {
        // When vim is disabled, never consume keys
        if (!this._enabled) {
            return { action: 'passthrough', consumed: false };
        }

        if (this._mode === 'insert') {
            return this.handleInsertMode(key);
        }

        return this.handleNormalMode(key);
    }

    /**
     * Handle keys in insert mode.
     * Only Escape is intercepted to switch to normal mode.
     */
    private handleInsertMode(key: string): VimKeyResult {
        if (key === 'Escape') {
            this._mode = 'normal';
            return { action: 'enter-normal', consumed: true };
        }
        // All other keys pass through to the input component
        return { action: 'passthrough', consumed: false };
    }

    /**
     * Handle keys in normal mode.
     * Provides movement, mode switching, and editing commands.
     */
    private handleNormalMode(key: string): VimKeyResult {
        // Check for pending multi-key sequences (e.g., 'dd')
        if (this._pendingKey === 'd') {
            this._pendingKey = null;
            if (key === 'd') {
                return { action: 'delete-line', consumed: true };
            }
            // Invalid sequence — swallow the key
            return { action: 'noop', consumed: true };
        }

        switch (key) {
            // Mode switching — enter insert mode
            case 'i':
                this._mode = 'insert';
                return { action: 'enter-insert', consumed: true };
            case 'a':
                this._mode = 'insert';
                return { action: 'enter-insert-after', consumed: true };
            case 'I':
                this._mode = 'insert';
                return { action: 'enter-insert-home', consumed: true };
            case 'A':
                this._mode = 'insert';
                return { action: 'enter-insert-end', consumed: true };

            // Open line — insert newline and enter insert mode
            case 'o':
                this._mode = 'insert';
                return { action: 'open-line-below', consumed: true };
            case 'O':
                this._mode = 'insert';
                return { action: 'open-line-above', consumed: true };

            // Cursor movement — character
            case 'h':
                return { action: 'move-left', consumed: true };
            case 'l':
                return { action: 'move-right', consumed: true };

            // Cursor movement — vertical
            case 'j':
                return { action: 'move-down', consumed: true };
            case 'k':
                return { action: 'move-up', consumed: true };

            // Cursor movement — word
            case 'w':
                return { action: 'move-word-forward', consumed: true };
            case 'b':
                return { action: 'move-word-backward', consumed: true };

            // Cursor movement — line boundaries
            case '0':
                return { action: 'move-home', consumed: true };
            case '$':
                return { action: 'move-end', consumed: true };

            // Editing
            case 'x':
                return { action: 'delete-char', consumed: true };
            case 'd':
                // Start of multi-key 'dd' sequence
                this._pendingKey = 'd';
                return { action: 'pending', consumed: true };

            // Undo
            case 'u':
                return { action: 'undo', consumed: true };

            // Paste from kill buffer
            case 'p':
                return { action: 'paste-after', consumed: true };

            // All other keys are swallowed in normal mode
            default:
                return { action: 'noop', consumed: true };
        }
    }
}
