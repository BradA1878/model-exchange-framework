/**
 * MXF CLI TUI — Confirmation Prompt Component
 *
 * Renders an inline confirmation prompt when an agent needs user approval
 * before a side-effecting operation (file write, code execution).
 *
 * File modification:
 *   Operator wants to modify files:
 *     M  src/auth/authService.ts
 *
 * Code execution:
 *   Executor wants to run:
 *     $ python analyze.py --input data.csv
 *
 * The actual [y/n] input is handled by InputLine in confirmation mode.
 * This component only renders the prompt description.
 *
 * @author Brad Anderson <BradA1878@pm.me>
 */

import React from 'react';
import { Box, Text } from 'ink';
import { DiffView } from './DiffView';

interface ConfirmationPromptProps {
    /** Agent display name (e.g., "Operator") */
    agentName: string;
    /** Agent display color (chalk color name) */
    agentColor: string;
    /** Type of action requiring confirmation */
    actionType: 'file-modify' | 'code-execute';
    /** Short title describing the action */
    title: string;
    /** Longer description with details (file path, command) */
    description?: string;
    /** File diffs to display inline with the confirmation prompt */
    fileDiffs?: Array<{ filePath: string; original: string; modified: string }>;
}

/**
 * ConfirmationPrompt — inline prompt description for side-effecting operations.
 *
 * Renders the agent name, action description, and details.
 * The [y/n] input is handled separately by InputLine in confirmation mode.
 */
export const ConfirmationPrompt: React.FC<ConfirmationPromptProps> = ({
    agentName,
    agentColor,
    actionType,
    title,
    description,
    fileDiffs,
}) => {
    if (actionType === 'file-modify') {
        return (
            <Box flexDirection="column" marginLeft={2}>
                <Box>
                    <Text color={agentColor} bold>{agentName}</Text>
                    <Text> wants to modify files:</Text>
                </Box>
                <Box marginLeft={2}>
                    <Text color="yellow">M  </Text>
                    <Text>{title}</Text>
                </Box>
                {description && (
                    <Box marginLeft={2}>
                        <Text color="white">{description}</Text>
                    </Box>
                )}
                {fileDiffs?.map((diff, idx) => (
                    <DiffView key={`diff-${idx}`} filePath={diff.filePath} original={diff.original} modified={diff.modified} />
                ))}
            </Box>
        );
    }

    // code-execute
    return (
        <Box flexDirection="column" marginLeft={2}>
            <Box>
                <Text color={agentColor} bold>{agentName}</Text>
                <Text> wants to run:</Text>
            </Box>
            <Box marginLeft={2}>
                <Text color="cyan">$  </Text>
                <Text>{title}</Text>
            </Box>
            {description && (
                <Box marginLeft={2}>
                    <Text color="white">{description}</Text>
                </Box>
            )}
        </Box>
    );
};
