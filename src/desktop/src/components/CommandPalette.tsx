/**
 * MXF Desktop — Command Palette Component
 *
 * Quick-access overlay for slash commands, triggered by Cmd+K or
 * typing `/` at the start of input. Shows a filterable list of
 * all registered commands.
 *
 * @author Brad Anderson <BradA1878@pm.me>
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { getRegisteredCommands, executeCommand } from '../services/CommandRegistry';
import type { CommandContext } from '../services/CommandRegistry';

interface CommandPaletteProps {
    /** Whether the palette is visible */
    visible: boolean;
    /** Hide the palette */
    onClose: () => void;
    /** Command context for executing selected commands */
    context: CommandContext;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({ visible, onClose, context }) => {
    const [query, setQuery] = useState('');
    const [selectedIndex, setSelectedIndex] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);

    const commands = getRegisteredCommands();

    // Filter commands by query
    const filtered = query
        ? commands.filter(cmd =>
            cmd.name.toLowerCase().includes(query.toLowerCase()) ||
            cmd.description.toLowerCase().includes(query.toLowerCase()),
        )
        : commands;

    // Focus input when palette opens
    useEffect(() => {
        if (visible) {
            setQuery('');
            setSelectedIndex(0);
            setTimeout(() => inputRef.current?.focus(), 50);
        }
    }, [visible]);

    // Reset selection when filter changes
    useEffect(() => {
        setSelectedIndex(0);
    }, [query]);

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            setSelectedIndex((prev) => Math.min(prev + 1, filtered.length - 1));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setSelectedIndex((prev) => Math.max(prev - 1, 0));
        } else if (e.key === 'Enter') {
            e.preventDefault();
            const cmd = filtered[selectedIndex];
            if (cmd) {
                onClose();
                executeCommand(`/${cmd.name}`, context);
            }
        }
    }, [filtered, selectedIndex, onClose, context]);

    if (!visible) return null;

    return (
        <div style={styles.overlay} onClick={onClose}>
            <div style={styles.palette} onClick={(e) => e.stopPropagation()}>
                {/* Search input */}
                <input
                    ref={inputRef}
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Type a command..."
                    style={styles.input}
                    spellCheck={false}
                    autoComplete="off"
                />

                {/* Command list */}
                <div style={styles.list}>
                    {filtered.length === 0 ? (
                        <div style={styles.empty}>No matching commands</div>
                    ) : (
                        filtered.map((cmd, i) => (
                            <div
                                key={cmd.name}
                                style={{
                                    ...styles.item,
                                    ...(i === selectedIndex ? styles.itemSelected : {}),
                                }}
                                onClick={() => {
                                    onClose();
                                    executeCommand(`/${cmd.name}`, context);
                                }}
                                onMouseEnter={() => setSelectedIndex(i)}
                            >
                                <span style={styles.itemName}>/{cmd.name}</span>
                                <span style={styles.itemDesc}>{cmd.description}</span>
                            </div>
                        ))
                    )}
                </div>

                {/* Footer hint */}
                <div style={styles.footer}>
                    <span>Enter to select</span>
                    <span>Esc to close</span>
                </div>
            </div>
        </div>
    );
};

const styles: Record<string, React.CSSProperties> = {
    overlay: {
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: '80px',
        zIndex: 900,
    },
    palette: {
        backgroundColor: 'var(--bg-secondary)',
        border: '1px solid var(--border)',
        borderRadius: '10px',
        width: '450px',
        maxHeight: '400px',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
    },
    input: {
        padding: '12px 16px',
        backgroundColor: 'transparent',
        border: 'none',
        borderBottom: '1px solid var(--border)',
        color: 'var(--text-primary)',
        fontSize: '14px',
        fontFamily: 'var(--font-sans)',
        outline: 'none',
    },
    list: {
        overflowY: 'auto',
        flex: 1,
        padding: '4px',
    },
    item: {
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        padding: '8px 12px',
        borderRadius: '6px',
        cursor: 'pointer',
        transition: 'background-color 0.1s',
    },
    itemSelected: {
        backgroundColor: 'var(--bg-tertiary)',
    },
    itemName: {
        fontFamily: 'var(--font-mono)',
        fontSize: '13px',
        color: 'var(--accent)',
        minWidth: '100px',
    },
    itemDesc: {
        fontSize: '13px',
        color: 'var(--text-secondary)',
    },
    empty: {
        padding: '16px',
        textAlign: 'center',
        color: 'var(--text-dim)',
        fontSize: '13px',
    },
    footer: {
        display: 'flex',
        justifyContent: 'center',
        gap: '16px',
        padding: '6px 12px',
        borderTop: '1px solid var(--border)',
        fontSize: '11px',
        color: 'var(--text-dim)',
    },
};
