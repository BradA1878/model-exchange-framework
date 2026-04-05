/**
 * MXF CLI TUI — Multiline Input Component
 *
 * Custom text input with Emacs-style keybindings, vim mode support, and
 * robust paste detection. Enter always submits; newlines are only inserted
 * via vim mode (o/O commands) or when detected as part of a paste operation.
 *
 * Features:
 *   - Emacs navigation: Ctrl+A/E (line start/end), Ctrl+B/F (char left/right)
 *   - Word movement: Meta+B/F (word left/right)
 *   - Kill buffer: Ctrl+K (kill to EOL), Ctrl+U (kill to BOL), Ctrl+W (kill word)
 *   - Yank: Ctrl+Y pastes from kill buffer, consecutive kills accumulate
 *   - Undo: Ctrl+Z restores previous state (debounced snapshots)
 *   - Forward delete: Ctrl+D
 *   - Paste detection: rapid keystrokes (<20ms) treat Enter as newline
 *   - Smart Up/Down: cursor movement in multiline, history fallback on edges
 *   - Vim mode: toggled via /vim command, provides normal/insert mode editing
 *   - NFC normalization on character insert
 *
 * @author Brad Anderson <BradA1878@pm.me>
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Box, Text, useInput } from 'ink';
import { useTheme } from '../theme/ThemeContext';
import { VimModeService } from '../services/VimMode';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Maximum visible lines before showing a "[N lines]" indicator */
const MAX_VISIBLE_LINES = 5;

/**
 * Paste detection threshold in milliseconds. Keystrokes arriving faster than
 * this are likely part of a paste operation. Normal typing runs 50-200ms
 * between keys; terminal paste delivers characters in <5ms bursts.
 */
const PASTE_THRESHOLD_MS = 20;

/** Maximum undo stack depth */
const MAX_UNDO_STACK = 50;

/** Debounce delay for undo snapshots — push after 500ms of inactivity */
const UNDO_DEBOUNCE_MS = 500;

// ─── Pure Helpers ────────────────────────────────────────────────────────────

/** Character class detection for word boundary navigation */
function isWordChar(ch: string): boolean {
    return /[\w]/.test(ch);
}

/**
 * Find the start of the current or previous word from a position.
 * Skips whitespace first, then traverses characters of the same class
 * (word chars or punctuation) until a boundary is reached.
 */
function wordBoundaryLeft(text: string, pos: number): number {
    if (pos <= 0) return 0;
    let i = pos - 1;
    // Skip whitespace
    while (i > 0 && /\s/.test(text[i])) i--;
    // Traverse same character class
    if (i >= 0) {
        const startIsWord = isWordChar(text[i]);
        while (i > 0 && isWordChar(text[i - 1]) === startIsWord && !/\s/.test(text[i - 1])) i--;
    }
    return Math.max(0, i);
}

/**
 * Find the end of the current or next word from a position.
 * Skips whitespace first, then traverses characters of the same class.
 */
function wordBoundaryRight(text: string, pos: number): number {
    const len = text.length;
    if (pos >= len) return len;
    let i = pos;
    // Skip whitespace
    while (i < len && /\s/.test(text[i])) i++;
    // Traverse same character class
    if (i < len) {
        const startIsWord = isWordChar(text[i]);
        while (i < len && isWordChar(text[i]) === startIsWord && !/\s/.test(text[i])) i++;
    }
    return i;
}

/**
 * Get the line index, column, and line metadata for a cursor position.
 * Used for Up/Down arrow navigation and rendering cursor placement.
 */
function getCursorLocation(text: string, cursor: number): {
    line: number; col: number; lineCount: number; lines: string[];
} {
    const lines = text.split('\n');
    let offset = 0;
    for (let i = 0; i < lines.length; i++) {
        const lineEnd = offset + lines[i].length;
        if (cursor <= lineEnd) {
            return { line: i, col: cursor - offset, lineCount: lines.length, lines };
        }
        offset += lines[i].length + 1;
    }
    return { line: lines.length - 1, col: 0, lineCount: lines.length, lines };
}

/** Get the absolute character offset for the start of a given line index */
function lineStartOffset(lines: string[], lineIndex: number): number {
    let offset = 0;
    for (let i = 0; i < lineIndex; i++) offset += lines[i].length + 1;
    return offset;
}

// ─── Props ───────────────────────────────────────────────────────────────────

interface MultilineInputProps {
    /** Called when the user presses Enter to submit the full buffer */
    onSubmit: (value: string) => void;
    /** Called on every buffer change (for external state sync) */
    onChange?: (value: string) => void;
    /** Placeholder text shown when the buffer is empty */
    placeholder?: string;
    /** Disable input (grays out, ignores keystrokes) */
    isDisabled?: boolean;
    /** Increment to clear the buffer (mirrors TextInput's key prop for reset) */
    resetKey?: number;
    /** External value override for tab autocomplete / history navigation */
    externalValue?: string;
    /**
     * Reports whether Up/Down arrows were consumed by multiline cursor movement.
     * When true, InputLine should NOT navigate history for that direction.
     * Called with ('up', handled) or ('down', handled) on each arrow press.
     */
    onVerticalArrow?: (direction: 'up' | 'down', handled: boolean) => void;
    /** Callback when vim mode changes (so parent can sync state to InfoBar) */
    onVimModeChange?: (mode: 'normal' | 'insert' | null) => void;
}

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * Multiline text input with Emacs-style keybindings, kill buffer, undo,
 * and optional vim mode.
 *
 * Handles its own buffer, cursor position, and rendering. Defers tab/esc
 * key handling to the parent InputLine component.
 */
export const MultilineInput: React.FC<MultilineInputProps> = ({
    onSubmit,
    onChange,
    placeholder = '',
    isDisabled = false,
    resetKey = 0,
    externalValue,
    onVerticalArrow,
    onVimModeChange,
}) => {
    const theme = useTheme();
    const vim = VimModeService.getInstance();

    // ── Core State ───────────────────────────────────────────────────────
    const [buffer, setBuffer] = useState('');
    const [cursor, setCursor] = useState(0);

    // ── Kill Buffer ──────────────────────────────────────────────────────
    // Stores deleted text for Ctrl+Y yank (and vim 'p' paste).
    // Consecutive kills in the same direction accumulate.
    const killBufferRef = useRef('');
    const lastActionWasKillRef = useRef(false);

    // ── Undo Stack ───────────────────────────────────────────────────────
    // Snapshots of (buffer, cursor) pushed after 500ms of inactivity.
    // Ctrl+Z or vim 'u' pops and restores the most recent snapshot.
    const undoStackRef = useRef<Array<{ buffer: string; cursor: number }>>([]);
    const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // ── Paste Detection ──────────────────────────────────────────────────
    // Timestamp-based fallback for terminals without bracketed paste support
    const lastKeystrokeRef = useRef(0);

    // ── External Sync ────────────────────────────────────────────────────
    // Distinguishes internal edits (typing) from external changes (history
    // navigation, tab autocomplete) to avoid cursor-position reset on echo.
    const internalChangeRef = useRef(false);
    const prevResetKeyRef = useRef(resetKey);
    const prevExternalRef = useRef(externalValue);

    // ── Reset on submitCount change ──────────────────────────────────────
    useEffect(() => {
        if (resetKey !== prevResetKeyRef.current) {
            prevResetKeyRef.current = resetKey;
            setBuffer('');
            setCursor(0);
            undoStackRef.current = [];
        }
    }, [resetKey]);

    // ── Sync from external value (history / autocomplete) ────────────────
    useEffect(() => {
        if (externalValue !== undefined && externalValue !== prevExternalRef.current) {
            prevExternalRef.current = externalValue;
            if (!internalChangeRef.current) {
                // Truly external — reset cursor to end of new value
                setBuffer(externalValue);
                setCursor(externalValue.length);
            }
        }
        internalChangeRef.current = false;
    }, [externalValue]);

    // ── Buffer Mutation Helper ───────────────────────────────────────────
    // All buffer edits go through this to keep onChange and internal flag in sync.
    const updateBuffer = useCallback((newBuffer: string, newCursor: number) => {
        internalChangeRef.current = true;
        setBuffer(newBuffer);
        setCursor(newCursor);
        onChange?.(newBuffer);
    }, [onChange]);

    // ── Undo System ─────────────────────────────────────────────────────

    /** Schedule an undo snapshot. Debounced — only pushes after 500ms of no edits. */
    const scheduleUndoPush = useCallback((buf: string, cur: number) => {
        if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
        undoTimerRef.current = setTimeout(() => {
            const stack = undoStackRef.current;
            const top = stack[stack.length - 1];
            if (!top || top.buffer !== buf) {
                stack.push({ buffer: buf, cursor: cur });
                if (stack.length > MAX_UNDO_STACK) stack.shift();
            }
        }, UNDO_DEBOUNCE_MS);
    }, []);

    /** Pop and restore from undo stack */
    const undo = useCallback(() => {
        const stack = undoStackRef.current;
        if (stack.length === 0) return;
        const prev = stack.pop()!;
        updateBuffer(prev.buffer, prev.cursor);
    }, [updateBuffer]);

    // ── Kill Buffer Operations ──────────────────────────────────────────

    /** Add text to kill buffer. Consecutive kills accumulate. */
    const addToKillBuffer = useCallback((text: string, direction: 'forward' | 'backward') => {
        if (lastActionWasKillRef.current) {
            killBufferRef.current = direction === 'forward'
                ? killBufferRef.current + text
                : text + killBufferRef.current;
        } else {
            killBufferRef.current = text;
        }
        lastActionWasKillRef.current = true;
    }, []);

    // ── Vim Action Executor ─────────────────────────────────────────────

    /**
     * Execute a semantic vim action on the buffer.
     * Called when VimModeService consumes a key and returns an action string.
     */
    const executeVimAction = useCallback((action: string) => {
        switch (action) {
            case 'enter-normal':
                onVimModeChange?.('normal');
                break;

            case 'enter-insert':
                onVimModeChange?.('insert');
                break;

            case 'enter-insert-after':
                if (cursor < buffer.length) setCursor(cursor + 1);
                onVimModeChange?.('insert');
                break;

            case 'enter-insert-home': {
                const { line, lines } = getCursorLocation(buffer, cursor);
                setCursor(lineStartOffset(lines, line));
                onVimModeChange?.('insert');
                break;
            }

            case 'enter-insert-end': {
                const { line, lines } = getCursorLocation(buffer, cursor);
                setCursor(lineStartOffset(lines, line) + lines[line].length);
                onVimModeChange?.('insert');
                break;
            }

            case 'open-line-below': {
                // Insert newline after end of current line, enter insert mode
                const { line, lines } = getCursorLocation(buffer, cursor);
                const lineEnd = lineStartOffset(lines, line) + lines[line].length;
                scheduleUndoPush(buffer, cursor);
                const before = buffer.slice(0, lineEnd);
                const after = buffer.slice(lineEnd);
                updateBuffer(before + '\n' + after, lineEnd + 1);
                onVimModeChange?.('insert');
                break;
            }

            case 'open-line-above': {
                // Insert newline before start of current line, enter insert mode
                const { line, lines } = getCursorLocation(buffer, cursor);
                const lineStart = lineStartOffset(lines, line);
                scheduleUndoPush(buffer, cursor);
                const before = buffer.slice(0, lineStart);
                const after = buffer.slice(lineStart);
                updateBuffer(before + '\n' + after, lineStart);
                onVimModeChange?.('insert');
                break;
            }

            case 'move-left':
                if (cursor > 0) setCursor(cursor - 1);
                break;

            case 'move-right':
                if (cursor < buffer.length) setCursor(cursor + 1);
                break;

            case 'move-up': {
                const { line, col, lines } = getCursorLocation(buffer, cursor);
                if (line > 0) {
                    const prevLine = lines[line - 1];
                    const newCol = Math.min(col, prevLine.length);
                    setCursor(lineStartOffset(lines, line - 1) + newCol);
                    onVerticalArrow?.('up', true);
                } else {
                    onVerticalArrow?.('up', false);
                }
                break;
            }

            case 'move-down': {
                const { line, col, lineCount, lines } = getCursorLocation(buffer, cursor);
                if (line < lineCount - 1) {
                    const nextLine = lines[line + 1];
                    const newCol = Math.min(col, nextLine.length);
                    setCursor(lineStartOffset(lines, line + 1) + newCol);
                    onVerticalArrow?.('down', true);
                } else {
                    onVerticalArrow?.('down', false);
                }
                break;
            }

            case 'move-word-forward':
                setCursor(wordBoundaryRight(buffer, cursor));
                break;

            case 'move-word-backward':
                setCursor(wordBoundaryLeft(buffer, cursor));
                break;

            case 'move-home': {
                const { line, lines } = getCursorLocation(buffer, cursor);
                setCursor(lineStartOffset(lines, line));
                break;
            }

            case 'move-end': {
                const { line, lines } = getCursorLocation(buffer, cursor);
                setCursor(lineStartOffset(lines, line) + lines[line].length);
                break;
            }

            case 'delete-char':
                if (cursor < buffer.length) {
                    scheduleUndoPush(buffer, cursor);
                    updateBuffer(buffer.slice(0, cursor) + buffer.slice(cursor + 1), cursor);
                }
                break;

            case 'delete-line': {
                const { line, lines } = getCursorLocation(buffer, cursor);
                const lineStart = lineStartOffset(lines, line);
                scheduleUndoPush(buffer, cursor);
                if (lines.length === 1) {
                    // Only line — clear buffer
                    const killed = buffer;
                    updateBuffer('', 0);
                    addToKillBuffer(killed, 'forward');
                } else {
                    // Remove the line and its trailing or leading newline
                    let killStart = lineStart;
                    let killEnd = lineStart + lines[line].length;
                    if (killEnd < buffer.length) {
                        killEnd++; // consume trailing \n
                    } else if (killStart > 0) {
                        killStart--; // consume leading \n
                    }
                    const killed = buffer.slice(killStart, killEnd);
                    const newBuffer = buffer.slice(0, killStart) + buffer.slice(killEnd);
                    const newCursor = Math.min(killStart, newBuffer.length);
                    updateBuffer(newBuffer, newCursor);
                    addToKillBuffer(killed, 'forward');
                }
                break;
            }

            case 'undo':
                undo();
                break;

            case 'paste-after': {
                const yanked = killBufferRef.current;
                if (!yanked) break;
                scheduleUndoPush(buffer, cursor);
                const insertPos = Math.min(cursor + 1, buffer.length);
                const before = buffer.slice(0, insertPos);
                const after = buffer.slice(insertPos);
                updateBuffer(before + yanked + after, insertPos + yanked.length);
                break;
            }

            // 'noop', 'pending', 'passthrough' — do nothing
            default:
                break;
        }
    }, [buffer, cursor, updateBuffer, scheduleUndoPush, undo, addToKillBuffer, onVerticalArrow, onVimModeChange]);

    // ── Keystroke Handler ───────────────────────────────────────────────

    useInput((input, key) => {
        if (isDisabled) return;

        // Paste detection: bracketed paste state (markers stripped at stdin level
        // by PasteAwareStdin transform), or keystroke timing fallback
        const pasteState = (globalThis as any).__mxfPasteState;
        const now = Date.now();
        const timeSinceLast = now - lastKeystrokeRef.current;
        lastKeystrokeRef.current = now;
        const isPasting = pasteState?.current === true || timeSinceLast < PASTE_THRESHOLD_MS;

        // ── Vim Mode Interception ───────────────────────────────────
        // In vim normal mode, most keys are consumed by the state machine.
        // In vim insert mode, only Escape is consumed.
        if (vim.isEnabled()) {
            // Map Ink key events to vim key names
            let vimKey: string | null = null;
            if (key.escape) vimKey = 'escape';
            else if (key.return) vimKey = null; // Enter always submits, not intercepted by vim
            else if (key.upArrow) vimKey = vim.getMode() === 'normal' ? 'k' : null;
            else if (key.downArrow) vimKey = vim.getMode() === 'normal' ? 'j' : null;
            else if (!key.ctrl && !key.meta && input) vimKey = input;

            if (vimKey !== null) {
                const result = vim.handleKey(vimKey, input);
                if (result.consumed) {
                    executeVimAction(result.action);
                    return;
                }
            }
        }

        // ── Submit / Paste-aware Enter ──────────────────────────────
        if (key.return) {
            lastActionWasKillRef.current = false;
            if (isPasting) {
                // Mid-paste Enter → insert newline instead of submitting
                const before = buffer.slice(0, cursor);
                const after = buffer.slice(cursor);
                scheduleUndoPush(buffer, cursor);
                updateBuffer(before + '\n' + after, cursor + 1);
                return;
            }
            const trimmed = buffer.trim();
            if (trimmed) {
                onSubmit(buffer);
            }
            return;
        }

        // ── Ctrl key combinations ───────────────────────────────────
        if (key.ctrl && input) {
            lastActionWasKillRef.current = false; // reset for most ctrl combos

            switch (input) {
                // Ctrl+A — move to start of current line
                case 'a': {
                    const { line, lines } = getCursorLocation(buffer, cursor);
                    setCursor(lineStartOffset(lines, line));
                    return;
                }

                // Ctrl+E — move to end of current line
                case 'e': {
                    const { line, lines } = getCursorLocation(buffer, cursor);
                    setCursor(lineStartOffset(lines, line) + lines[line].length);
                    return;
                }

                // Ctrl+B — move cursor left (same as left arrow)
                case 'b': {
                    if (cursor > 0) setCursor(cursor - 1);
                    return;
                }

                // Ctrl+F — move cursor right (same as right arrow)
                case 'f': {
                    if (cursor < buffer.length) setCursor(cursor + 1);
                    return;
                }

                // Ctrl+D — forward delete (delete char at cursor)
                case 'd': {
                    if (buffer.length === 0) return;
                    if (cursor < buffer.length) {
                        scheduleUndoPush(buffer, cursor);
                        const before = buffer.slice(0, cursor);
                        const after = buffer.slice(cursor + 1);
                        updateBuffer(before + after, cursor);
                    }
                    return;
                }

                // Ctrl+K — kill from cursor to end of current line → kill buffer
                case 'k': {
                    const { line, lines } = getCursorLocation(buffer, cursor);
                    const lineEnd = lineStartOffset(lines, line) + lines[line].length;
                    if (cursor < lineEnd) {
                        const killed = buffer.slice(cursor, lineEnd);
                        scheduleUndoPush(buffer, cursor);
                        updateBuffer(buffer.slice(0, cursor) + buffer.slice(lineEnd), cursor);
                        addToKillBuffer(killed, 'forward');
                        lastActionWasKillRef.current = true;
                    } else if (cursor < buffer.length) {
                        // At end of line — kill the newline (join with next line)
                        scheduleUndoPush(buffer, cursor);
                        updateBuffer(buffer.slice(0, cursor) + buffer.slice(cursor + 1), cursor);
                        addToKillBuffer('\n', 'forward');
                        lastActionWasKillRef.current = true;
                    }
                    return;
                }

                // Ctrl+U — kill from start of current line to cursor → kill buffer
                case 'u': {
                    const { line, lines } = getCursorLocation(buffer, cursor);
                    const lineStart = lineStartOffset(lines, line);
                    if (cursor > lineStart) {
                        const killed = buffer.slice(lineStart, cursor);
                        scheduleUndoPush(buffer, cursor);
                        updateBuffer(buffer.slice(0, lineStart) + buffer.slice(cursor), lineStart);
                        addToKillBuffer(killed, 'backward');
                        lastActionWasKillRef.current = true;
                    }
                    return;
                }

                // Ctrl+W — kill word backward → kill buffer
                case 'w': {
                    if (cursor === 0) return;
                    const wordStart = wordBoundaryLeft(buffer, cursor);
                    const killed = buffer.slice(wordStart, cursor);
                    scheduleUndoPush(buffer, cursor);
                    updateBuffer(buffer.slice(0, wordStart) + buffer.slice(cursor), wordStart);
                    addToKillBuffer(killed, 'backward');
                    lastActionWasKillRef.current = true;
                    return;
                }

                // Ctrl+Y — yank (paste from kill buffer)
                case 'y': {
                    const yanked = killBufferRef.current;
                    if (!yanked) return;
                    scheduleUndoPush(buffer, cursor);
                    const before = buffer.slice(0, cursor);
                    const after = buffer.slice(cursor);
                    updateBuffer(before + yanked + after, cursor + yanked.length);
                    return;
                }

                // Ctrl+Z — undo
                case 'z': {
                    undo();
                    return;
                }

                default:
                    break;
            }
            // Don't insert ctrl characters as text
            return;
        }

        // ── Meta key combinations ───────────────────────────────────
        if (key.meta && input) {
            lastActionWasKillRef.current = false;

            switch (input) {
                // Meta+B — move to previous word boundary
                case 'b': {
                    setCursor(wordBoundaryLeft(buffer, cursor));
                    return;
                }

                // Meta+F — move to next word boundary
                case 'f': {
                    setCursor(wordBoundaryRight(buffer, cursor));
                    return;
                }

                default:
                    break;
            }
            return;
        }

        // ── Backspace — delete character before cursor ──────────────
        if (key.backspace || key.delete) {
            lastActionWasKillRef.current = false;
            if (cursor > 0) {
                scheduleUndoPush(buffer, cursor);
                const before = buffer.slice(0, cursor - 1);
                const after = buffer.slice(cursor);
                updateBuffer(before + after, cursor - 1);
            }
            return;
        }

        // ── Left Arrow — move cursor left ───────────────────────────
        if (key.leftArrow) {
            lastActionWasKillRef.current = false;
            if (cursor > 0) setCursor(cursor - 1);
            return;
        }

        // ── Right Arrow — move cursor right ─────────────────────────
        if (key.rightArrow) {
            lastActionWasKillRef.current = false;
            if (cursor < buffer.length) setCursor(cursor + 1);
            return;
        }

        // ── Up Arrow — multiline cursor movement / history passthrough
        if (key.upArrow) {
            lastActionWasKillRef.current = false;
            const { line, col, lines } = getCursorLocation(buffer, cursor);
            if (line > 0) {
                const prevLine = lines[line - 1];
                const newCol = Math.min(col, prevLine.length);
                setCursor(lineStartOffset(lines, line - 1) + newCol);
                onVerticalArrow?.('up', true);
            } else {
                onVerticalArrow?.('up', false);
            }
            return;
        }

        // ── Down Arrow — multiline cursor movement / history passthrough
        if (key.downArrow) {
            lastActionWasKillRef.current = false;
            const { line, col, lineCount, lines } = getCursorLocation(buffer, cursor);
            if (line < lineCount - 1) {
                const nextLine = lines[line + 1];
                const newCol = Math.min(col, nextLine.length);
                setCursor(lineStartOffset(lines, line + 1) + newCol);
                onVerticalArrow?.('down', true);
            } else {
                onVerticalArrow?.('down', false);
            }
            return;
        }

        // ── Tab, Esc — pass through to InputLine ────────────────────
        if (key.tab || key.escape) {
            return;
        }

        // ── Printable Characters — insert at cursor ─────────────────
        if (input && !key.ctrl && !key.meta) {
            // Detect leaked terminal escape sequences. Some terminals send
            // CSI u sequences (e.g., `[27;2;13~` for Shift+Enter) that Ink's
            // useInput doesn't parse — they arrive as raw "printable" text.
            if (/\[[\d;]*[~A-Za-z]/.test(input) || /[\x00-\x1f]/.test(input)) {
                // Shift+Enter (CSI u: `[27;2;13~`) → insert newline in vim insert mode
                if (/\[27;2;13~/.test(input) && vim.isEnabled() && vim.getMode() === 'insert') {
                    lastActionWasKillRef.current = false;
                    scheduleUndoPush(buffer, cursor);
                    const before = buffer.slice(0, cursor);
                    const after = buffer.slice(cursor);
                    updateBuffer(before + '\n' + after, cursor + 1);
                }
                // All other escape sequences are silently discarded
                return;
            }

            lastActionWasKillRef.current = false;
            scheduleUndoPush(buffer, cursor);
            // NFC-normalize the input to handle composed characters properly
            const normalized = input.normalize('NFC');
            const before = buffer.slice(0, cursor);
            const after = buffer.slice(cursor);
            updateBuffer(before + normalized + after, cursor + normalized.length);
        }
    });

    // ── Rendering ───────────────────────────────────────────────────────

    // Empty buffer — show placeholder
    if (buffer.length === 0) {
        return (
            <Box flexDirection="column">
                <Text dimColor>{placeholder}</Text>
            </Box>
        );
    }

    // Single-line — render inline with inverse cursor (identical to TextInput)
    const lines = buffer.split('\n');
    if (lines.length === 1) {
        return renderLineWithCursor(buffer, cursor, theme.promptColor);
    }

    // Multiline — show up to MAX_VISIBLE_LINES with overflow indicator
    const visibleLines = lines.length <= MAX_VISIBLE_LINES
        ? lines
        : lines.slice(lines.length - MAX_VISIBLE_LINES);
    const hiddenCount = lines.length - visibleLines.length;

    // Find which line the cursor is on
    const { line: cursorLineIndex, col: cursorColIndex } = getCursorLocation(buffer, cursor);

    // Adjust for hidden lines above the viewport
    const visibleCursorLineIndex = cursorLineIndex - (lines.length - visibleLines.length);

    return (
        <Box flexDirection="column">
            {hiddenCount > 0 && (
                <Text dimColor>[{hiddenCount} more line{hiddenCount > 1 ? 's' : ''} above]</Text>
            )}
            {visibleLines.map((line, idx) => {
                const isCurrentLine = idx === visibleCursorLineIndex;
                if (isCurrentLine && visibleCursorLineIndex >= 0) {
                    return (
                        <Box key={idx}>
                            {idx > 0 || hiddenCount > 0 ? <Text dimColor>  </Text> : null}
                            {renderLineWithCursor(line, cursorColIndex, theme.promptColor)}
                        </Box>
                    );
                }
                return (
                    <Box key={idx}>
                        {idx > 0 || hiddenCount > 0 ? <Text dimColor>  </Text> : null}
                        <Text>{line}</Text>
                    </Box>
                );
            })}
        </Box>
    );
};

// ─── Render Helper ───────────────────────────────────────────────────────────

/**
 * Render a single line of text with an inverse-video cursor at the given position.
 *
 * @param line - The line text
 * @param cursorPos - Cursor position within the line
 * @param _color - Unused, kept for API consistency
 * @returns JSX element with the cursor rendered
 */
function renderLineWithCursor(line: string, cursorPos: number, _color: string): React.ReactElement {
    const before = line.slice(0, cursorPos);
    const cursorChar = cursorPos < line.length ? line[cursorPos] : ' ';
    const after = cursorPos < line.length ? line.slice(cursorPos + 1) : '';

    return (
        <Text>
            {before}
            <Text inverse>{cursorChar}</Text>
            {after}
        </Text>
    );
}
