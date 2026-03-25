/**
 * MXF CLI TUI — Header Bar Component
 *
 * Fixed top bar displaying the MXF title, session ID, and connection status.
 * Uses colored dots to indicate connection state. Colors from theme context.
 *
 * @author Brad Anderson <BradA1878@pm.me>
 */

import React from 'react';
import { Box, Text, useStdout } from 'ink';
import { useTheme } from '../theme/ThemeContext';

interface HeaderBarProps {
    /** Current session ID (truncated) */
    sessionId: string;
    /** Named session label (shown if using --session flag) */
    sessionName?: string;
}

/**
 * Header bar — rendered once via <Static> at the top of terminal scrollback.
 * Shows: MXF title | session ID (or session name).
 * Live connection status is shown in StatusBar (dynamic section) since
 * Static items cannot update after initial render.
 */
export const HeaderBar: React.FC<HeaderBarProps> = ({ sessionId, sessionName }) => {
    const theme = useTheme();
    const { stdout } = useStdout();
    const displayName = sessionName || `session: ${sessionId}`;

    return (
        <Box
            borderStyle="round"
            borderColor={theme.border as any}
            paddingX={1}
            justifyContent="space-between"
            width={stdout.columns || 80}
        >
            <Text bold color={theme.accent as any}>MXF</Text>
            <Text color={theme.dimText as any}>{displayName}</Text>
        </Box>
    );
};
