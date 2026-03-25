/**
 * MXF CLI TUI — Input Line Component
 *
 * Text input line at the bottom of the TUI. Uses @inkjs/ui TextInput
 * for user input with a `> ` prompt prefix. Handles submit via Enter
 * and delegates to the input handler for routing (slash commands,
 * shell commands, @mentions, or natural language tasks).
 *
 * Features:
 * - Tab autocomplete for /commands and @agents
 * - Arrow key history navigation (up/down) via useInputHistory hook
 * - Esc key clears current input
 * - Confirmation mode: [y/n] prompt for side-effecting actions
 *
 * @author Brad Anderson <BradA1878@pm.me>
 */

import React, { useState, useCallback, useRef, type Dispatch } from 'react';
import { Box, Text, useInput } from 'ink';
import { Select } from '@inkjs/ui';
import { MultilineInput } from './MultilineInput';
import { useInputHistory } from '../hooks/useInputHistory';
import { getCompletions } from '../services/AutocompleteProvider';
import { getRegisteredCommands } from '../commands/registry';
import { useTheme } from '../theme/ThemeContext';
import type { AppAction, PendingSelection } from '../state';

interface InputLineProps {
    /** Callback when user submits input (presses Enter) */
    onSubmit: (input: string) => Promise<void>;
    /** Whether input should be disabled (e.g., during agent work) */
    isDisabled?: boolean;
    /** Whether a confirmation prompt is pending (switches to [y/n] mode) */
    confirmationPending?: boolean;
    /** Title of the pending confirmation (shown inline in [y/n] prompt for context) */
    confirmationTitle?: string | null;
    /** Callback when user responds to a confirmation prompt */
    onConfirmation?: (accepted: boolean) => void;
    /** Dispatch function for state actions (e.g., cancelling selection mode) */
    dispatch?: Dispatch<AppAction>;
    /** Agent names available for @mention autocomplete (dynamically populated from active agents) */
    agentNames?: string[];
    /** Pending selection (e.g., model picker) — renders arrow-key Select component */
    pendingSelection?: PendingSelection | null;
    /** Callback when user selects an item from a pending selection */
    onSelection?: (value: string) => void;
    /** Current interaction mode — shown as prefix indicator on the prompt */
    currentMode?: 'chat' | 'plan' | 'action';
}

/**
 * Input line — fixed at the bottom of the TUI layout.
 * Shows `> ` prompt for normal input, or `[y/n] ` for confirmation mode.
 * Supports tab autocomplete, arrow key history navigation, and Esc to clear.
 */
export const InputLine: React.FC<InputLineProps> = ({
    onSubmit,
    isDisabled = false,
    confirmationPending = false,
    confirmationTitle = null,
    onConfirmation,
    dispatch,
    agentNames = [],
    pendingSelection = null,
    onSelection,
    currentMode = 'action',
}) => {
    const [value, setValue] = useState('');
    const [submitCount, setSubmitCount] = useState(0);
    const theme = useTheme();
    const { addToHistory, navigateUp, navigateDown, resetNavigation } = useInputHistory();

    // Autocomplete state
    const completionsRef = useRef<string[]>([]);
    const completionIndexRef = useRef<number>(-1);
    const [ghostText, setGhostText] = useState('');

    // Handle Tab for autocomplete, arrow keys for history, and Esc to clear
    useInput((input, key) => {
        // Esc — cancel selection mode, or clear current input and autocomplete
        if (key.escape) {
            if (pendingSelection && dispatch) {
                dispatch({ type: 'SET_PENDING_SELECTION', selection: null });
                dispatch({ type: 'ADD_ENTRY', entry: { type: 'system', content: 'Selection cancelled.' } });
            }
            setValue('');
            setGhostText('');
            completionsRef.current = [];
            completionIndexRef.current = -1;
            resetNavigation();
            return;
        }

        // Tab — autocomplete
        if (key.tab && !confirmationPending) {
            const commandNames = getRegisteredCommands().map((c) => c.name);

            if (completionsRef.current.length === 0) {
                // First Tab press — generate completions
                const matches = getCompletions(value, commandNames, agentNames);
                if (matches.length > 0) {
                    completionsRef.current = matches;
                    completionIndexRef.current = 0;
                    setValue(matches[0]);
                    setGhostText(matches.length > 1 ? ` (${matches.length} matches)` : '');
                }
            } else {
                // Subsequent Tab — cycle through completions
                completionIndexRef.current = (completionIndexRef.current + 1) % completionsRef.current.length;
                const match = completionsRef.current[completionIndexRef.current];
                setValue(match);
                setGhostText(completionsRef.current.length > 1
                    ? ` (${completionIndexRef.current + 1}/${completionsRef.current.length})`
                    : '');
            }
            return;
        }

        // Up arrow — navigate to previous history entry
        // Skip when Select component is active (it handles its own arrow keys)
        if (key.upArrow && !confirmationPending && !pendingSelection) {
            const prev = navigateUp();
            if (prev !== null) {
                setValue(prev);
                clearAutocomplete();
            }
            return;
        }

        // Down arrow — navigate to next history entry
        // Skip when Select component is active (it handles its own arrow keys)
        if (key.downArrow && !confirmationPending && !pendingSelection) {
            const next = navigateDown();
            if (next !== null) {
                setValue(next);
                clearAutocomplete();
            }
            return;
        }
    });

    /** Clear autocomplete state */
    const clearAutocomplete = useCallback(() => {
        completionsRef.current = [];
        completionIndexRef.current = -1;
        setGhostText('');
    }, []);

    // Reset history navigation and autocomplete when user types new input
    const handleChange = useCallback((newValue: string) => {
        setValue(newValue);
        resetNavigation();
        clearAutocomplete();
    }, [resetNavigation, clearAutocomplete]);

    const handleSubmit = useCallback(async (input: string) => {
        const trimmed = input.trim();
        if (!trimmed) return;

        setValue('');
        setSubmitCount(c => c + 1);
        clearAutocomplete();

        if (confirmationPending && onConfirmation) {
            // Confirmation mode: interpret y/n
            const lower = trimmed.toLowerCase();
            if (lower === 'y' || lower === 'yes') {
                onConfirmation(true);
            } else if (lower === 'n' || lower === 'no') {
                onConfirmation(false);
            }
            // Ignore other input in confirmation mode
            return;
        }

        // Add to history before submitting
        addToHistory(trimmed);
        resetNavigation();
        await onSubmit(trimmed);
    }, [onSubmit, confirmationPending, onConfirmation, addToHistory, resetNavigation, clearAutocomplete]);

    // Selection mode — arrow-key navigable Select component (e.g., model picker)
    if (pendingSelection) {
        return (
            <Box flexDirection="column" paddingX={1}>
                <Select
                    options={pendingSelection.choices}
                    defaultValue={pendingSelection.defaultValue}
                    onChange={(value) => {
                        if (onSelection) onSelection(value);
                    }}
                />
                <Text dimColor>  ↑↓ navigate · Enter select · Esc cancel</Text>
            </Box>
        );
    }

    // Unified input — always renders MultilineInput to avoid the component-switch
    // freeze. Previously, confirmation mode used @inkjs/ui TextInput while normal
    // mode used MultilineInput. Swapping between them unmounts one useInput hook
    // and mounts another, causing Ink to lose the stdin listener. By always using
    // MultilineInput, the useInput hook stays mounted across mode transitions.
    const modePrefix = confirmationPending ? '' : (currentMode === 'chat' ? 'chat' : currentMode === 'plan' ? 'plan' : '');
    const placeholder = confirmationPending
        ? 'y or n'
        : isDisabled ? 'Agent working...' : 'Type a task or /help (Ctrl+J: newline)';

    return (
        <Box paddingX={1}>
            {confirmationPending ? (
                <>
                    <Text bold color={theme.confirmColor as any}>[y/n] </Text>
                    {confirmationTitle && <Text>{confirmationTitle} — </Text>}
                </>
            ) : modePrefix ? (
                <Text bold color={theme.dimText as any}>[{modePrefix}] </Text>
            ) : null}
            {!confirmationPending && <Text bold color={theme.promptColor as any}>&gt; </Text>}
            <MultilineInput
                resetKey={submitCount}
                placeholder={placeholder}
                isDisabled={isDisabled}
                onChange={handleChange}
                onSubmit={handleSubmit}
                externalValue={value}
            />
            {ghostText && !confirmationPending && <Text dimColor>{ghostText}</Text>}
        </Box>
    );
};
