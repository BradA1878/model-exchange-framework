/**
 * MXF CLI TUI — Multiline Input Component
 *
 * Custom text input that supports multiline editing via Ctrl+J (insert newline)
 * while Enter submits the full buffer. Replaces @inkjs/ui TextInput for the
 * normal input mode. Single-line input renders identically to TextInput.
 *
 * Key bindings:
 *   Enter (key.return)   → submit full buffer
 *   Ctrl+J (input='\n')  → insert newline at cursor
 *   Backspace             → delete character before cursor
 *   Left/Right arrows     → move cursor
 *   Ctrl+U               → clear buffer
 *   Printable characters  → insert at cursor
 *
 * Tab, Up/Down arrows, and Esc are NOT handled here — they pass through to
 * InputLine's useInput for autocomplete, history navigation, and clear.
 *
 * @author Brad Anderson <BradA1878@pm.me>
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Box, Text, useInput } from 'ink';
import { useTheme } from '../theme/ThemeContext';

/** Maximum visible lines before showing a "[N lines]" indicator */
const MAX_VISIBLE_LINES = 5;

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
}

/**
 * Multiline text input — Ctrl+J inserts newlines, Enter submits.
 *
 * Handles its own buffer, cursor position, and rendering. Defers tab/arrow/esc
 * key handling to the parent InputLine component.
 */
export const MultilineInput: React.FC<MultilineInputProps> = ({
    onSubmit,
    onChange,
    placeholder = '',
    isDisabled = false,
    resetKey = 0,
    externalValue,
}) => {
    const theme = useTheme();
    const [buffer, setBuffer] = useState('');
    const [cursor, setCursor] = useState(0);

    // Flag to distinguish internal changes (user typing) from external changes
    // (history navigation, tab autocomplete). Prevents the externalValue sync
    // effect from resetting cursor position on our own onChange echo.
    const internalChangeRef = useRef(false);

    // Track resetKey changes to clear the buffer
    const prevResetKeyRef = useRef(resetKey);
    useEffect(() => {
        if (resetKey !== prevResetKeyRef.current) {
            prevResetKeyRef.current = resetKey;
            setBuffer('');
            setCursor(0);
        }
    }, [resetKey]);

    // Sync from external value (tab autocomplete / history navigation).
    // Only update buffer+cursor when the change is truly external (not our own
    // onChange echo bouncing back). Internal changes set internalChangeRef=true
    // so we can skip the cursor-to-end reset and preserve cursor position.
    const prevExternalRef = useRef(externalValue);
    useEffect(() => {
        if (externalValue !== undefined && externalValue !== prevExternalRef.current) {
            prevExternalRef.current = externalValue;
            if (!internalChangeRef.current) {
                // Truly external change (history navigation, autocomplete) — reset cursor to end
                setBuffer(externalValue);
                setCursor(externalValue.length);
            }
        }
        internalChangeRef.current = false;
    }, [externalValue]);

    // Notify parent of buffer changes. Sets internalChangeRef so the
    // externalValue sync effect knows to skip cursor reset on the echo.
    const updateBuffer = useCallback((newBuffer: string, newCursor: number) => {
        internalChangeRef.current = true;
        setBuffer(newBuffer);
        setCursor(newCursor);
        onChange?.(newBuffer);
    }, [onChange]);

    useInput((input, key) => {
        if (isDisabled) return;

        // Enter (key.return = true for \r) → submit
        if (key.return) {
            const trimmed = buffer.trim();
            if (trimmed) {
                onSubmit(buffer);
            }
            return;
        }

        // Ctrl+J → insert newline. In Ink, Ctrl+J sends \n which parses as
        // key.name='enter' (NOT key.return). We detect it via input === '\n'.
        if (input === '\n') {
            const before = buffer.slice(0, cursor);
            const after = buffer.slice(cursor);
            updateBuffer(before + '\n' + after, cursor + 1);
            return;
        }

        // Backspace → delete character before cursor
        if (key.backspace || key.delete) {
            if (cursor > 0) {
                const before = buffer.slice(0, cursor - 1);
                const after = buffer.slice(cursor);
                updateBuffer(before + after, cursor - 1);
            }
            return;
        }

        // Left arrow → move cursor left
        if (key.leftArrow) {
            if (cursor > 0) {
                setCursor(cursor - 1);
            }
            return;
        }

        // Right arrow → move cursor right
        if (key.rightArrow) {
            if (cursor < buffer.length) {
                setCursor(cursor + 1);
            }
            return;
        }

        // Ctrl+U → clear buffer (standard terminal shortcut)
        if (key.ctrl && input === 'u') {
            updateBuffer('', 0);
            return;
        }

        // Tab, Up/Down, Esc — NOT handled here (pass through to InputLine's useInput)
        if (key.tab || key.upArrow || key.downArrow || key.escape) {
            return;
        }

        // Printable characters → insert at cursor position
        if (input && !key.ctrl && !key.meta) {
            const before = buffer.slice(0, cursor);
            const after = buffer.slice(cursor);
            updateBuffer(before + input + after, cursor + input.length);
        }
    });

    // Empty buffer — show placeholder
    if (buffer.length === 0) {
        return (
            <Box flexDirection="column">
                <Text dimColor>{placeholder}</Text>
            </Box>
        );
    }

    // Render the buffer with cursor
    const lines = buffer.split('\n');
    const isMultiline = lines.length > 1;

    // For single-line, render inline (identical to TextInput behavior)
    if (!isMultiline) {
        return renderLineWithCursor(buffer, cursor, theme.promptColor);
    }

    // Multiline: show up to MAX_VISIBLE_LINES, with overflow indicator
    const visibleLines = lines.length <= MAX_VISIBLE_LINES
        ? lines
        : lines.slice(lines.length - MAX_VISIBLE_LINES);
    const hiddenCount = lines.length - visibleLines.length;

    // Calculate cursor position within visible lines
    let charOffset = 0;
    // Find which line the cursor is on
    let cursorLineIndex = 0;
    let cursorColIndex = 0;
    for (let i = 0; i < lines.length; i++) {
        const lineEnd = charOffset + lines[i].length;
        if (cursor <= lineEnd) {
            cursorLineIndex = i;
            cursorColIndex = cursor - charOffset;
            break;
        }
        charOffset += lines[i].length + 1; // +1 for \n
    }

    // Adjust cursor line index for hidden lines
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
