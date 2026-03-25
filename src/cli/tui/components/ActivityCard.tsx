/**
 * MXF CLI TUI — Activity Card Component
 *
 * Renders an inline bordered card showing what an agent is actively doing.
 * Active state shows a bordered box; completed/failed state collapses to a one-liner.
 *
 * Active:
 *   ┌─ Operator ─────────────────────────────────────┐
 *   │  Reading src/auth/authService.ts (245 lines) │
 *   └──────────────────────────────────────────────┘
 *
 * Completed:
 *   Operator  ✓ Read src/auth/authService.ts (245 lines)
 *
 * @author Brad Anderson <BradA1878@pm.me>
 */

import React from 'react';
import { Box, Text } from 'ink';

interface ActivityCardProps {
    /** Agent display name (e.g., "Operator") */
    agentName: string;
    /** Agent display color (chalk color name) */
    agentColor: string;
    /** Description of the activity */
    content: string;
    /** Current status of the activity */
    status: 'active' | 'completed' | 'failed';
    /** Optional summary for collapsed state (overrides content) */
    summary?: string;
}

/**
 * ActivityCard — inline indicator for agent file/code operations.
 *
 * Renders as a bordered card when active (agent is working),
 * collapses to a single line with status icon when completed or failed.
 */
const ActivityCardInner: React.FC<ActivityCardProps> = ({
    agentName,
    agentColor,
    content,
    status,
    summary,
}) => {
    // Completed or failed — show collapsed one-liner
    if (status === 'completed') {
        return (
            <Box marginLeft={2}>
                <Text color={agentColor}>{agentName}</Text>
                <Text color="green"> ✓ </Text>
                <Text dimColor>{summary || content}</Text>
            </Box>
        );
    }

    if (status === 'failed') {
        return (
            <Box marginLeft={2}>
                <Text color={agentColor}>{agentName}</Text>
                <Text color="red"> ✗ </Text>
                <Text dimColor>{summary || content}</Text>
            </Box>
        );
    }

    // Active — show bordered card
    return (
        <Box marginLeft={2} borderStyle="single" paddingLeft={1} paddingRight={1}>
            <Text color={agentColor} bold>{agentName}</Text>
            <Text dimColor>  {content}</Text>
        </Box>
    );
};

export const ActivityCard = React.memo(ActivityCardInner);
