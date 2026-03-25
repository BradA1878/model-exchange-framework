/**
 * MXF CLI TUI — Diff View Component
 *
 * Renders a simple unified diff display for file modifications.
 * Removed lines are shown in red with '-' prefix, added lines in green with '+' prefix.
 *
 * Example:
 *   --- src/auth/authService.ts
 *   - const token = getToken();
 *   + const token = await getSecureToken();
 *
 * @author Brad Anderson <BradA1878@pm.me>
 */

import React from 'react';
import { Box, Text } from 'ink';

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
 *
 * Compares original and modified content line by line.
 * Shows removed lines in red and added lines in green.
 */
export const DiffView: React.FC<DiffViewProps> = ({
    filePath,
    original,
    modified,
}) => {
    const originalLines = original.split('\n');
    const modifiedLines = modified.split('\n');

    // Simple line-by-line diff — show lines that differ
    const diffLines: Array<{ type: 'header' | 'removed' | 'added' | 'context'; text: string }> = [];

    diffLines.push({ type: 'header', text: `--- ${filePath}` });

    const maxLen = Math.max(originalLines.length, modifiedLines.length);
    for (let i = 0; i < maxLen; i++) {
        const origLine = i < originalLines.length ? originalLines[i] : undefined;
        const modLine = i < modifiedLines.length ? modifiedLines[i] : undefined;

        if (origLine === modLine) {
            // Unchanged — skip in compact diff view
            continue;
        }

        if (origLine !== undefined && modLine !== undefined) {
            // Changed line
            diffLines.push({ type: 'removed', text: origLine });
            diffLines.push({ type: 'added', text: modLine });
        } else if (origLine !== undefined) {
            // Removed line
            diffLines.push({ type: 'removed', text: origLine });
        } else if (modLine !== undefined) {
            // Added line
            diffLines.push({ type: 'added', text: modLine });
        }
    }

    // If no changes, show a note
    if (diffLines.length === 1) {
        return (
            <Box marginLeft={2}>
                <Text dimColor>No changes detected in {filePath}</Text>
            </Box>
        );
    }

    return (
        <Box flexDirection="column" marginLeft={2}>
            {diffLines.map((line, idx) => {
                switch (line.type) {
                    case 'header':
                        return (
                            <Text key={idx} bold dimColor>{line.text}</Text>
                        );
                    case 'removed':
                        return (
                            <Text key={idx} color="red">- {line.text}</Text>
                        );
                    case 'added':
                        return (
                            <Text key={idx} color="green">+ {line.text}</Text>
                        );
                    default:
                        return (
                            <Text key={idx} dimColor>  {line.text}</Text>
                        );
                }
            })}
        </Box>
    );
};
