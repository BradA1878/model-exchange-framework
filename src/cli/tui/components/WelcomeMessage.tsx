/**
 * MXF CLI TUI — Welcome Message Component
 *
 * Displayed when the TUI first launches. Shows a brief overview
 * of the multi-agent system, interaction patterns, and keyboard
 * shortcuts. Colors from theme context.
 *
 * @author Brad Anderson <BradA1878@pm.me>
 */

import React from 'react';
import { Box, Text } from 'ink';
import { useTheme } from '../theme/ThemeContext';

/**
 * Welcome message shown as the first entry in the conversation area.
 */
export const WelcomeMessage: React.FC = () => {
    const theme = useTheme();

    return (
        <Box flexDirection="column" paddingX={1}>
            <Text bold color={theme.accent as any}>Welcome to MXF Interactive</Text>
            <Text> </Text>
            <Text color={theme.dimText as any}>Type a task in natural language. The Planner will coordinate</Text>
            <Text color={theme.dimText as any}>Operator, Executor, and Reviewer agents as needed.</Text>
            <Text> </Text>
            <Text color={theme.dimText as any}>Use @agent to direct a message to a specific agent</Text>
            <Text color={theme.dimText as any}>  (e.g., @operator fix the import on line 23)</Text>
            <Text color={theme.dimText as any}>Use /help to see available commands.</Text>
            <Text color={theme.dimText as any}>Use !command to run shell commands.</Text>
            <Text color={theme.dimText as any}>Tab to autocomplete commands and @mentions.</Text>
            <Text color={theme.dimText as any}>Press Ctrl+C or type /exit to quit.</Text>
            <Text> </Text>
            <Text color={theme.dimText as any}>Shortcuts: Ctrl+L clear | Ctrl+S stop | Ctrl+A detail | Esc cancel</Text>
        </Box>
    );
};
