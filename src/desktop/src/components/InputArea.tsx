/**
 * MXF Desktop — Input Area Component
 *
 * Rich text input with native paste support (the primary motivation
 * for the desktop app). Uses a standard textarea element — paste,
 * Shift+Enter, clipboard, and selection all work natively.
 *
 * Features:
 *   - Auto-resize up to 10 lines
 *   - Enter to submit, Shift+Enter for newline
 *   - Emacs keybindings (Ctrl+A/E/K/U/W/Y/Z/D/B/F)
 *   - Kill buffer with consecutive-kill accumulation
 *   - Undo via Ctrl+Z (native browser undo)
 *   - @mention and /command autocomplete (planned)
 *
 * @author Brad Anderson <BradA1878@pm.me>
 */

import React, { useRef, useCallback, useEffect, useMemo } from 'react';
import { useAppState } from '../state/appState';
import { VimModeService } from '../services/VimMode';
import { getRegisteredCommands } from '../services/CommandRegistry';

interface InputAreaProps {
    onSubmit: (value: string) => void;
    disabled?: boolean;
}

/** Character class detection for Emacs word boundaries */
function isWordChar(ch: string): boolean {
    return /[\w]/.test(ch);
}

/** Find the start of the previous word from a position */
function wordBoundaryLeft(text: string, pos: number): number {
    if (pos <= 0) return 0;
    let i = pos - 1;
    // Skip whitespace
    while (i > 0 && /\s/.test(text[i]!)) i--;
    // Skip word chars or non-word chars (stay in same class)
    if (i >= 0 && text[i]) {
        const isWord = isWordChar(text[i]!);
        while (i > 0 && text[i - 1] && isWordChar(text[i - 1]!) === isWord && !/\s/.test(text[i - 1]!)) i--;
    }
    return Math.max(0, i);
}

/** Find the end of the next word from a position */
function wordBoundaryRight(text: string, pos: number): number {
    const len = text.length;
    if (pos >= len) return len;
    let i = pos;
    // Skip whitespace
    while (i < len && /\s/.test(text[i]!)) i++;
    // Skip word chars or non-word chars (stay in same class)
    if (i < len && text[i]) {
        const isWord = isWordChar(text[i]!);
        while (i < len && text[i] && isWordChar(text[i]!) === isWord && !/\s/.test(text[i]!)) i++;
    }
    return i;
}

export const InputArea: React.FC<InputAreaProps> = ({ onSubmit, disabled = false }) => {
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const killBufferRef = useRef('');
    const lastActionWasKillRef = useRef(false);

    const inputValue = useAppState((s) => s.inputValue);
    const setInputValue = useAppState((s) => s.setInputValue);
    const vimEnabled = useAppState((s) => s.vimEnabled);
    const setVimMode = useAppState((s) => s.setVimMode);

    // Auto-resize the textarea based on content
    const autoResize = useCallback(() => {
        const el = textareaRef.current;
        if (!el) return;
        el.style.height = 'auto';
        const lineHeight = 20;
        const maxLines = 10;
        const maxHeight = lineHeight * maxLines;
        el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
    }, []);

    // Resize on value change
    useEffect(() => {
        autoResize();
    }, [inputValue, autoResize]);

    // Focus the textarea on mount
    useEffect(() => {
        textareaRef.current?.focus();
    }, []);

    // Ghost text: find the best matching command for inline completion
    const ghostSuffix = useMemo(() => {
        if (!inputValue.startsWith('/') || inputValue.includes(' ') || inputValue.includes('\n')) return '';
        const typed = inputValue.slice(1).toLowerCase();
        if (!typed) return '';
        const commands = getRegisteredCommands();
        const match = commands.find(cmd => cmd.name.startsWith(typed) && cmd.name !== typed);
        return match ? match.name.slice(typed.length) : '';
    }, [inputValue]);

    const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
        lastActionWasKillRef.current = false;
        setInputValue(e.target.value);
    }, [setInputValue]);

    const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        const el = textareaRef.current;
        if (!el) return;

        const { selectionStart: cursor, selectionEnd } = el;
        const text = el.value;

        // ── Vim keybindings (before all other handlers) ──────────
        if (vimEnabled) {
            const vim = VimModeService.getInstance();
            const result = vim.handleKey(e.key);

            if (result.consumed) {
                e.preventDefault();
                // Sync vim mode to Zustand for StatusBar display
                setVimMode(vim.getMode());

                switch (result.action) {
                    case 'enter-normal':
                    case 'enter-insert':
                        break; // Mode switch only
                    case 'enter-insert-after': {
                        const pos = Math.min(text.length, cursor + 1);
                        requestAnimationFrame(() => el.setSelectionRange(pos, pos));
                        break;
                    }
                    case 'enter-insert-home': {
                        const lineStart = text.lastIndexOf('\n', cursor - 1) + 1;
                        requestAnimationFrame(() => el.setSelectionRange(lineStart, lineStart));
                        break;
                    }
                    case 'enter-insert-end': {
                        let lineEnd = text.indexOf('\n', cursor);
                        if (lineEnd === -1) lineEnd = text.length;
                        requestAnimationFrame(() => el.setSelectionRange(lineEnd, lineEnd));
                        break;
                    }
                    case 'move-left': {
                        const pos = Math.max(0, cursor - 1);
                        el.setSelectionRange(pos, pos);
                        break;
                    }
                    case 'move-right': {
                        const pos = Math.min(text.length, cursor + 1);
                        el.setSelectionRange(pos, pos);
                        break;
                    }
                    case 'move-down': {
                        // Move to same column on next line
                        const lineEnd = text.indexOf('\n', cursor);
                        if (lineEnd !== -1) {
                            const lineStart = text.lastIndexOf('\n', cursor - 1) + 1;
                            const col = cursor - lineStart;
                            const nextLineEnd = text.indexOf('\n', lineEnd + 1);
                            const nextEnd = nextLineEnd === -1 ? text.length : nextLineEnd;
                            const pos = Math.min(lineEnd + 1 + col, nextEnd);
                            el.setSelectionRange(pos, pos);
                        }
                        break;
                    }
                    case 'move-up': {
                        // Move to same column on previous line
                        const lineStart = text.lastIndexOf('\n', cursor - 1) + 1;
                        if (lineStart > 0) {
                            const col = cursor - lineStart;
                            const prevLineStart = text.lastIndexOf('\n', lineStart - 2) + 1;
                            const pos = Math.min(prevLineStart + col, lineStart - 1);
                            el.setSelectionRange(pos, pos);
                        }
                        break;
                    }
                    case 'move-word-forward': {
                        const pos = wordBoundaryRight(text, cursor);
                        el.setSelectionRange(pos, pos);
                        break;
                    }
                    case 'move-word-backward': {
                        const pos = wordBoundaryLeft(text, cursor);
                        el.setSelectionRange(pos, pos);
                        break;
                    }
                    case 'move-home': {
                        const lineStart = text.lastIndexOf('\n', cursor - 1) + 1;
                        el.setSelectionRange(lineStart, lineStart);
                        break;
                    }
                    case 'move-end': {
                        let lineEnd = text.indexOf('\n', cursor);
                        if (lineEnd === -1) lineEnd = text.length;
                        el.setSelectionRange(lineEnd, lineEnd);
                        break;
                    }
                    case 'delete-char': {
                        if (cursor < text.length) {
                            const newText = text.slice(0, cursor) + text.slice(cursor + 1);
                            setInputValue(newText);
                            requestAnimationFrame(() => el.setSelectionRange(cursor, cursor));
                        }
                        break;
                    }
                    case 'delete-line': {
                        const lineStart = text.lastIndexOf('\n', cursor - 1) + 1;
                        let lineEnd = text.indexOf('\n', cursor);
                        if (lineEnd === -1) lineEnd = text.length;
                        else lineEnd++; // Include the newline
                        const killed = text.slice(lineStart, lineEnd);
                        killBufferRef.current = killed;
                        const newText = text.slice(0, lineStart) + text.slice(lineEnd);
                        setInputValue(newText);
                        requestAnimationFrame(() => el.setSelectionRange(lineStart, lineStart));
                        break;
                    }
                    case 'undo':
                        document.execCommand('undo');
                        break;
                    case 'paste-after': {
                        const yanked = killBufferRef.current;
                        if (yanked) {
                            const insertPos = Math.min(cursor + 1, text.length);
                            const newText = text.slice(0, insertPos) + yanked + text.slice(insertPos);
                            const newCursor = insertPos + yanked.length;
                            setInputValue(newText);
                            requestAnimationFrame(() => el.setSelectionRange(newCursor, newCursor));
                        }
                        break;
                    }
                    case 'open-line-below': {
                        let lineEnd = text.indexOf('\n', cursor);
                        if (lineEnd === -1) lineEnd = text.length;
                        const newText = text.slice(0, lineEnd) + '\n' + text.slice(lineEnd);
                        setInputValue(newText);
                        requestAnimationFrame(() => el.setSelectionRange(lineEnd + 1, lineEnd + 1));
                        break;
                    }
                    case 'open-line-above': {
                        const lineStart = text.lastIndexOf('\n', cursor - 1) + 1;
                        const newText = text.slice(0, lineStart) + '\n' + text.slice(lineStart);
                        setInputValue(newText);
                        requestAnimationFrame(() => el.setSelectionRange(lineStart, lineStart));
                        break;
                    }
                    // pending, noop — do nothing
                }
                return;
            }
        }

        // ── Tab: Accept ghost text completion ────────────────────
        if (e.key === 'Tab' && ghostSuffix) {
            e.preventDefault();
            const completed = inputValue + ghostSuffix;
            setInputValue(completed);
            requestAnimationFrame(() => {
                if (el) {
                    const pos = completed.length;
                    el.setSelectionRange(pos, pos);
                }
            });
            return;
        }

        // ── Enter: Submit (without modifier) ─────────────────────
        if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.altKey && !e.ctrlKey) {
            e.preventDefault();
            const trimmed = text.trim();
            if (trimmed) {
                onSubmit(trimmed);
                setInputValue('');
            }
            return;
        }

        // ── Ctrl keybindings (Emacs) ─────────────────────────────
        if (e.ctrlKey && !e.metaKey && !e.altKey) {
            switch (e.key.toLowerCase()) {
                // Ctrl+A: Move to start of current line
                case 'a': {
                    e.preventDefault();
                    const lineStart = text.lastIndexOf('\n', cursor - 1) + 1;
                    el.setSelectionRange(lineStart, lineStart);
                    lastActionWasKillRef.current = false;
                    return;
                }
                // Ctrl+E: Move to end of current line
                case 'e': {
                    e.preventDefault();
                    let lineEnd = text.indexOf('\n', cursor);
                    if (lineEnd === -1) lineEnd = text.length;
                    el.setSelectionRange(lineEnd, lineEnd);
                    lastActionWasKillRef.current = false;
                    return;
                }
                // Ctrl+B: Move cursor left
                case 'b': {
                    e.preventDefault();
                    const pos = Math.max(0, cursor - 1);
                    el.setSelectionRange(pos, pos);
                    lastActionWasKillRef.current = false;
                    return;
                }
                // Ctrl+F: Move cursor right
                case 'f': {
                    e.preventDefault();
                    const pos = Math.min(text.length, cursor + 1);
                    el.setSelectionRange(pos, pos);
                    lastActionWasKillRef.current = false;
                    return;
                }
                // Ctrl+D: Forward delete
                case 'd': {
                    e.preventDefault();
                    if (cursor < text.length) {
                        const newText = text.slice(0, cursor) + text.slice(cursor + 1);
                        setInputValue(newText);
                        // Restore cursor position after React re-render
                        requestAnimationFrame(() => el.setSelectionRange(cursor, cursor));
                    }
                    lastActionWasKillRef.current = false;
                    return;
                }
                // Ctrl+K: Kill to end of line
                case 'k': {
                    e.preventDefault();
                    let lineEnd = text.indexOf('\n', cursor);
                    if (lineEnd === -1) lineEnd = text.length;
                    // If cursor is at end of line, kill the newline
                    if (cursor === lineEnd && cursor < text.length) lineEnd++;
                    const killed = text.slice(cursor, lineEnd);
                    if (killed) {
                        if (lastActionWasKillRef.current) {
                            killBufferRef.current += killed;
                        } else {
                            killBufferRef.current = killed;
                        }
                        lastActionWasKillRef.current = true;
                        const newText = text.slice(0, cursor) + text.slice(lineEnd);
                        setInputValue(newText);
                        requestAnimationFrame(() => el.setSelectionRange(cursor, cursor));
                    }
                    return;
                }
                // Ctrl+U: Kill to start of line
                case 'u': {
                    e.preventDefault();
                    const lineStart = text.lastIndexOf('\n', cursor - 1) + 1;
                    const killed = text.slice(lineStart, cursor);
                    if (killed) {
                        if (lastActionWasKillRef.current) {
                            killBufferRef.current = killed + killBufferRef.current;
                        } else {
                            killBufferRef.current = killed;
                        }
                        lastActionWasKillRef.current = true;
                        const newText = text.slice(0, lineStart) + text.slice(cursor);
                        setInputValue(newText);
                        requestAnimationFrame(() => el.setSelectionRange(lineStart, lineStart));
                    }
                    return;
                }
                // Ctrl+W: Kill word backward
                case 'w': {
                    e.preventDefault();
                    const wordStart = wordBoundaryLeft(text, cursor);
                    const killed = text.slice(wordStart, cursor);
                    if (killed) {
                        if (lastActionWasKillRef.current) {
                            killBufferRef.current = killed + killBufferRef.current;
                        } else {
                            killBufferRef.current = killed;
                        }
                        lastActionWasKillRef.current = true;
                        const newText = text.slice(0, wordStart) + text.slice(cursor);
                        setInputValue(newText);
                        requestAnimationFrame(() => el.setSelectionRange(wordStart, wordStart));
                    }
                    return;
                }
                // Ctrl+Y: Yank (paste from kill buffer)
                case 'y': {
                    e.preventDefault();
                    const yanked = killBufferRef.current;
                    if (yanked) {
                        const newText = text.slice(0, cursor) + yanked + text.slice(selectionEnd);
                        const newCursor = cursor + yanked.length;
                        setInputValue(newText);
                        requestAnimationFrame(() => el.setSelectionRange(newCursor, newCursor));
                    }
                    lastActionWasKillRef.current = false;
                    return;
                }
                default:
                    break;
            }
        }

        // ── Alt/Meta word movement ───────────────────────────────
        if (e.altKey && !e.ctrlKey && !e.metaKey) {
            switch (e.key.toLowerCase()) {
                // Alt+B: Move to previous word boundary
                case 'b': {
                    e.preventDefault();
                    const pos = wordBoundaryLeft(text, cursor);
                    el.setSelectionRange(pos, pos);
                    lastActionWasKillRef.current = false;
                    return;
                }
                // Alt+F: Move to next word boundary
                case 'f': {
                    e.preventDefault();
                    const pos = wordBoundaryRight(text, cursor);
                    el.setSelectionRange(pos, pos);
                    lastActionWasKillRef.current = false;
                    return;
                }
                default:
                    break;
            }
        }

        // Any non-kill key breaks the consecutive-kill chain
        if (!e.ctrlKey || !['k', 'u', 'w'].includes(e.key.toLowerCase())) {
            lastActionWasKillRef.current = false;
        }
    }, [onSubmit, setInputValue, vimEnabled, setVimMode, ghostSuffix]);

    return (
        <div style={styles.container}>
            <span style={styles.prompt}>&gt;</span>
            <div style={styles.textareaWrapper}>
                <textarea
                    ref={textareaRef}
                    data-mxf-input
                    value={inputValue}
                    onChange={handleChange}
                    onKeyDown={handleKeyDown}
                    disabled={disabled}
                    placeholder="Type a task or /help — Cmd+K for command palette"
                    rows={1}
                    style={styles.textarea}
                    spellCheck={false}
                    autoComplete="off"
                />
                {/* Ghost text overlay for slash command completion */}
                {ghostSuffix && (
                    <div style={styles.ghostOverlay} aria-hidden="true">
                        <span style={styles.ghostHidden}>{inputValue}</span>
                        <span style={styles.ghostText}>{ghostSuffix}</span>
                        <span style={styles.ghostHint}> Tab</span>
                    </div>
                )}
            </div>
        </div>
    );
};

const styles: Record<string, React.CSSProperties> = {
    container: {
        display: 'flex',
        alignItems: 'flex-start',
        padding: '8px 16px',
        borderTop: '1px solid var(--border)',
        backgroundColor: 'var(--bg-secondary)',
        flexShrink: 0,
        gap: '8px',
    },
    prompt: {
        color: 'var(--accent)',
        fontFamily: 'var(--font-mono)',
        fontWeight: 700,
        fontSize: '14px',
        lineHeight: '20px',
        paddingTop: '4px',
        userSelect: 'none',
    },
    textareaWrapper: {
        flex: 1,
        position: 'relative',
    },
    textarea: {
        width: '100%',
        background: 'transparent',
        border: 'none',
        outline: 'none',
        color: 'var(--text-primary)',
        fontFamily: 'var(--font-mono)',
        fontSize: '14px',
        lineHeight: '20px',
        resize: 'none',
        overflow: 'hidden',
        padding: '4px 0',
        position: 'relative',
        zIndex: 1,
    },
    ghostOverlay: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        fontFamily: 'var(--font-mono)',
        fontSize: '14px',
        lineHeight: '20px',
        padding: '4px 0',
        pointerEvents: 'none',
        whiteSpace: 'pre',
        overflow: 'hidden',
    },
    ghostHidden: {
        visibility: 'hidden' as const,
    },
    ghostText: {
        color: 'var(--text-dim)',
    },
    ghostHint: {
        color: 'var(--text-dim)',
        fontSize: '11px',
        opacity: 0.6,
    },
};
