/**
 * MXF Desktop — Terminal Panel Component
 *
 * Embedded xterm.js terminal for shell command output. Shows in a
 * collapsible panel below the conversation area. Commands prefixed
 * with `!` in the input area route their output here.
 *
 * Uses Tauri's streaming shell execution IPC to pipe stdout/stderr
 * into the terminal in real-time.
 *
 * @author Brad Anderson <BradA1878@pm.me>
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import '@xterm/xterm/css/xterm.css';

interface TerminalPanelProps {
    /** Whether the panel is visible */
    visible: boolean;
    /** Callback to toggle panel visibility */
    onToggle: () => void;
}

export const TerminalPanel: React.FC<TerminalPanelProps> = ({ visible, onToggle }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const termRef = useRef<Terminal | null>(null);
    const fitAddonRef = useRef<FitAddon | null>(null);
    const [height, setHeight] = useState(200);

    // Initialize xterm.js terminal
    useEffect(() => {
        if (!visible || !containerRef.current) return;

        // Create terminal if not already initialized
        if (!termRef.current) {
            const terminal = new Terminal({
                cursorBlink: false,
                fontSize: 13,
                fontFamily: 'var(--font-mono)',
                theme: {
                    background: '#0d0d0d',
                    foreground: '#d4d4d4',
                    cursor: '#87a878',
                    selectionBackground: 'rgba(135, 168, 120, 0.3)',
                    black: '#0d0d0d',
                    red: '#c45c5c',
                    green: '#6b8f4a',
                    yellow: '#b8a44e',
                    blue: '#6b7f3a',
                    magenta: '#87a878',
                    cyan: '#87a878',
                    white: '#d4d4d4',
                    brightBlack: '#5c5c5c',
                    brightRed: '#c45c5c',
                    brightGreen: '#87a878',
                    brightYellow: '#b8a44e',
                    brightBlue: '#6b7f3a',
                    brightMagenta: '#9dba8f',
                    brightCyan: '#9dba8f',
                    brightWhite: '#d4d4d4',
                },
                scrollback: 5000,
                convertEol: true,
            });

            const fitAddon = new FitAddon();
            terminal.loadAddon(fitAddon);
            terminal.open(containerRef.current);
            fitAddon.fit();

            termRef.current = terminal;
            fitAddonRef.current = fitAddon;

            terminal.writeln('\x1b[2m--- MXF Shell ---\x1b[0m');
            terminal.writeln('\x1b[2mUse !command in the input area to run shell commands.\x1b[0m');
            terminal.writeln('');
        }

        return () => {
            // Don't dispose on hide — keep the terminal content
        };
    }, [visible]);

    // Resize terminal when panel height changes
    useEffect(() => {
        if (visible && fitAddonRef.current) {
            setTimeout(() => fitAddonRef.current?.fit(), 50);
        }
    }, [visible, height]);

    // Listen for streaming shell output events from Tauri
    useEffect(() => {
        const unlistenStdout = listen<string>('shell-stdout', (event) => {
            termRef.current?.write(event.payload);
        });
        const unlistenStderr = listen<string>('shell-stderr', (event) => {
            termRef.current?.write(`\x1b[31m${event.payload}\x1b[0m`);
        });
        const unlistenExit = listen<number>('shell-exit', (event) => {
            const code = event.payload;
            if (code !== 0) {
                termRef.current?.writeln(`\x1b[31m[exit code: ${code}]\x1b[0m`);
            }
            termRef.current?.writeln('');
        });

        return () => {
            unlistenStdout.then(fn => fn());
            unlistenStderr.then(fn => fn());
            unlistenExit.then(fn => fn());
        };
    }, []);

    // Handle resize drag
    const handleDragStart = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        const startY = e.clientY;
        const startHeight = height;

        const onMouseMove = (ev: MouseEvent) => {
            const delta = startY - ev.clientY;
            const newHeight = Math.max(100, Math.min(600, startHeight + delta));
            setHeight(newHeight);
        };

        const onMouseUp = () => {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            fitAddonRef.current?.fit();
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    }, [height]);

    if (!visible) return null;

    return (
        <div style={{ ...styles.panel, height: `${height}px` }}>
            {/* Resize handle */}
            <div style={styles.resizeHandle} onMouseDown={handleDragStart}>
                <div style={styles.resizeBar} />
            </div>

            {/* Terminal header */}
            <div style={styles.header}>
                <span style={styles.headerTitle}>Terminal</span>
                <div style={styles.headerActions}>
                    <button
                        onClick={() => {
                            termRef.current?.clear();
                            termRef.current?.writeln('\x1b[2m--- Cleared ---\x1b[0m');
                        }}
                        style={styles.headerButton}
                        title="Clear terminal"
                    >
                        Clear
                    </button>
                    <button
                        onClick={onToggle}
                        style={styles.headerButton}
                        title="Close terminal"
                    >
                        Close
                    </button>
                </div>
            </div>

            {/* Terminal content */}
            <div ref={containerRef} style={styles.terminalContainer} />
        </div>
    );
};

/**
 * Execute a shell command and stream output to the terminal panel.
 * Uses Tauri's streaming shell execution IPC.
 */
export async function executeShellStreaming(command: string): Promise<void> {
    await invoke('execute_shell_streaming', { command });
}

const styles: Record<string, React.CSSProperties> = {
    panel: {
        display: 'flex',
        flexDirection: 'column',
        borderTop: '1px solid var(--border)',
        backgroundColor: 'var(--bg-primary)',
        flexShrink: 0,
    },
    resizeHandle: {
        height: '6px',
        cursor: 'ns-resize',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
    },
    resizeBar: {
        width: '40px',
        height: '2px',
        backgroundColor: 'var(--border)',
        borderRadius: '1px',
    },
    header: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '4px 12px',
        backgroundColor: 'var(--bg-secondary)',
        borderBottom: '1px solid var(--border)',
    },
    headerTitle: {
        fontSize: '12px',
        fontWeight: 600,
        color: 'var(--text-dim)',
        fontFamily: 'var(--font-mono)',
    },
    headerActions: {
        display: 'flex',
        gap: '8px',
    },
    headerButton: {
        fontSize: '11px',
        color: 'var(--text-dim)',
        backgroundColor: 'transparent',
        border: 'none',
        cursor: 'pointer',
        fontFamily: 'var(--font-mono)',
        padding: '2px 6px',
    },
    terminalContainer: {
        flex: 1,
        padding: '4px 8px',
    },
};
