/**
 * MXF Desktop — Root Application Component
 *
 * Main layout: header (fixed top), conversation (scrollable middle),
 * input area (fixed bottom), status bar (fixed bottom). Manages
 * theme application, server connection, keyboard shortcuts, and
 * command palette.
 *
 * @author Brad Anderson <BradA1878@pm.me>
 */

import React, { useEffect, useCallback, useRef, useState } from 'react';
import { useAppState, generateMessageId } from './state/appState';
import { applyTheme } from './theme/themes';
import { useSession } from './hooks/useSession';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { executeCommand } from './services/CommandRegistry';
import type { CommandContext } from './services/CommandRegistry';
// Import CommandHandlers to register all commands at module load time
import './services/CommandHandlers';
import { HeaderBar } from './components/HeaderBar';
import { ConversationArea } from './components/ConversationArea';
import { InputArea } from './components/InputArea';
import { StatusBar } from './components/StatusBar';
import { ConfirmationDialog } from './components/ConfirmationDialog';
import { UserInputDialog } from './components/UserInputDialog';
import { TerminalPanel } from './components/TerminalPanel';
import { CommandPalette } from './components/CommandPalette';
import { ThinkingIndicator } from './components/ThinkingIndicator';

const App: React.FC = () => {
    const theme = useAppState((s) => s.theme);
    const addMessage = useAppState((s) => s.addMessage);
    const showTerminal = useAppState((s) => s.showTerminal);
    const toggleTerminal = useAppState((s) => s.toggleTerminal);
    const [showPalette, setShowPalette] = useState(false);

    // Apply theme CSS variables when theme changes
    useEffect(() => {
        applyTheme(theme);
    }, [theme]);

    // Session lifecycle — connects to MXF server on mount
    const { submitTask, respondToConfirmation, respondToUserInput, bridgeRef } = useSession();

    // Build command context — stable ref to avoid re-creating on every render
    const submitTaskRef = useRef(submitTask);
    submitTaskRef.current = submitTask;

    const getCommandContext = useCallback((): CommandContext => ({
        bridge: bridgeRef.current,
        submitTask: (task: string) => submitTaskRef.current(task),
        requestExit: () => window.close(),
    }), [bridgeRef]);

    // Global keyboard shortcuts
    useKeyboardShortcuts({
        onCommandPalette: () => setShowPalette(true),
    });

    // Handle input submission — routes slash commands, shell commands,
    // and natural language tasks
    const handleSubmit = useCallback(async (value: string) => {
        // Handle slash commands via the command registry
        if (value.startsWith('/')) {
            await executeCommand(value, getCommandContext());
            return;
        }

        // Handle shell commands — display and execute via Tauri IPC
        if (value.startsWith('!')) {
            const command = value.substring(1).trim();
            if (!command) return;

            addMessage({
                id: generateMessageId(),
                type: 'user',
                content: value,
                timestamp: Date.now(),
            });

            try {
                const { invoke } = await import('@tauri-apps/api/core');
                const result = await invoke<{ stdout: string; stderr: string; exit_code: number }>('execute_shell_command', {
                    command,
                });

                const output = [
                    result.stdout ? result.stdout.trim() : '',
                    result.stderr ? `stderr: ${result.stderr.trim()}` : '',
                ].filter(Boolean).join('\n');

                addMessage({
                    id: generateMessageId(),
                    type: 'system',
                    content: output || '(no output)',
                    timestamp: Date.now(),
                });
            } catch (err: unknown) {
                const message = err instanceof Error ? err.message : String(err);
                addMessage({
                    id: generateMessageId(),
                    type: 'error',
                    content: `Shell command failed: ${message}`,
                    timestamp: Date.now(),
                });
            }
            return;
        }

        // Submit natural language task to the server
        submitTask(value);
    }, [addMessage, getCommandContext, submitTask]);

    // Handle file drag-and-drop — load dropped files as context
    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
    }, []);

    const handleDrop = useCallback(async (e: React.DragEvent) => {
        e.preventDefault();

        const files = Array.from(e.dataTransfer.files);
        if (files.length === 0) return;

        // Read file paths from drag-and-drop
        const fileNames = files.map(f => f.name).join(', ');
        addMessage({
            id: generateMessageId(),
            type: 'system',
            content: `Files dropped: ${fileNames}\nNote: File context loading from drag-and-drop requires /context <path> for now.`,
            timestamp: Date.now(),
        });
    }, [addMessage]);

    return (
        <div
            style={styles.app}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
        >
            <HeaderBar />
            <ConversationArea />
            <ThinkingIndicator />
            <InputArea onSubmit={handleSubmit} />
            <TerminalPanel visible={showTerminal} onToggle={toggleTerminal} />
            <StatusBar />
            <ConfirmationDialog onRespond={respondToConfirmation} />
            <UserInputDialog onRespond={respondToUserInput} />
            <CommandPalette
                visible={showPalette}
                onClose={() => setShowPalette(false)}
                context={getCommandContext()}
            />
        </div>
    );
};

const styles: Record<string, React.CSSProperties> = {
    app: {
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        overflow: 'hidden',
    },
};

export default App;
