/**
 * MXF Desktop — Diff View Component
 *
 * Renders a simple unified diff display for file modifications.
 * Removed lines shown in red with '-' prefix, added lines in green
 * with '+' prefix. Only changed lines are displayed (compact view).
 *
 * @author Brad Anderson <BradA1878@pm.me>
 */

import React from 'react';

interface DiffViewProps {
    /** File path being modified */
    filePath: string;
    /** Original file content (before changes) */
    original: string;
    /** Modified file content (after changes) */
    modified: string;
}

/**
 * DiffView — simple line-based diff display.
 * Compares original and modified content line by line.
 * Shows removed lines in red and added lines in green.
 */
export const DiffView: React.FC<DiffViewProps> = ({ filePath, original, modified }) => {
    const originalLines = original.split('\n');
    const modifiedLines = modified.split('\n');

    // Simple line-by-line diff — show lines that differ
    const diffLines: Array<{ type: 'header' | 'removed' | 'added'; text: string }> = [];

    diffLines.push({ type: 'header', text: `--- ${filePath}` });

    const maxLen = Math.max(originalLines.length, modifiedLines.length);
    for (let i = 0; i < maxLen; i++) {
        const origLine = i < originalLines.length ? originalLines[i] : undefined;
        const modLine = i < modifiedLines.length ? modifiedLines[i] : undefined;

        if (origLine === modLine) continue; // Unchanged — skip

        if (origLine !== undefined && modLine !== undefined) {
            // Changed line
            diffLines.push({ type: 'removed', text: origLine });
            diffLines.push({ type: 'added', text: modLine });
        } else if (origLine !== undefined) {
            diffLines.push({ type: 'removed', text: origLine });
        } else if (modLine !== undefined) {
            diffLines.push({ type: 'added', text: modLine });
        }
    }

    // No changes detected
    if (diffLines.length === 1) {
        return (
            <div style={styles.noChanges}>No changes detected in {filePath}</div>
        );
    }

    return (
        <div style={styles.container}>
            {diffLines.map((line, idx) => {
                const style = line.type === 'header'
                    ? styles.header
                    : line.type === 'removed'
                        ? styles.removed
                        : styles.added;

                const prefix = line.type === 'removed' ? '- '
                    : line.type === 'added' ? '+ '
                        : '';

                return (
                    <div key={idx} style={style}>
                        {prefix}{line.text}
                    </div>
                );
            })}
        </div>
    );
};

const styles: Record<string, React.CSSProperties> = {
    container: {
        backgroundColor: 'var(--bg-primary)',
        border: '1px solid var(--border)',
        borderRadius: '6px',
        padding: '12px',
        overflow: 'auto',
        maxHeight: '300px',
        fontFamily: 'var(--font-mono)',
        fontSize: '12px',
        lineHeight: '1.5',
        margin: '8px 0',
    },
    noChanges: {
        color: 'var(--text-dim)',
        fontFamily: 'var(--font-mono)',
        fontSize: '12px',
        padding: '4px 0',
    },
    header: {
        color: 'var(--text-dim)',
        fontWeight: 700,
        marginBottom: '4px',
    },
    removed: {
        color: 'var(--error)',
        whiteSpace: 'pre-wrap',
    },
    added: {
        color: 'var(--success)',
        whiteSpace: 'pre-wrap',
    },
};
