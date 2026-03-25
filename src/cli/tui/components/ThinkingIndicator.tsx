/**
 * MXF CLI TUI — Thinking Indicator Component
 *
 * Animated inline indicator shown at the bottom of the conversation area
 * when agents are actively reasoning between tool calls. Provides visual
 * feedback so the user knows the system is working, not hung.
 *
 * When streaming tokens are available (via streamPreview), shows the last
 * ~80 characters of the live LLM output instead of a static "thinking..."
 * message, so the user can see progress in real time.
 *
 * Uses the `useSpinner` hook from @inkjs/ui for the animated dots frame
 * (~80ms interval, lightweight single timer).
 *
 * @author Brad Anderson <BradA1878@pm.me>
 */

import React from 'react';
import { Box, Text } from 'ink';
import { useSpinner } from '@inkjs/ui';
import { useTheme } from '../theme/ThemeContext';
import type { AgentInfo } from '../types';

/** Maximum characters of streaming preview text to display */
const PREVIEW_MAX_CHARS = 80;

interface ThinkingIndicatorProps {
    /** Agents currently in 'active' status */
    activeAgents: AgentInfo[];
    /** Live streaming preview from LLM (null when not streaming) */
    streamPreview?: { agentId: string; text: string } | null;
}

/**
 * ThinkingIndicator — shows an animated spinner with the active agent's name.
 * Appears at the bottom of the conversation area during agent reasoning phases.
 * Automatically disappears when agents go idle (task complete/fail).
 *
 * When streamPreview is available, shows a truncated tail of the streaming text
 * instead of the static "thinking..." label.
 */
const ThinkingIndicatorInner: React.FC<ThinkingIndicatorProps> = ({ activeAgents, streamPreview }) => {
    const { frame } = useSpinner({ type: 'dots' });
    const theme = useTheme();

    // Always reserve 1 line of height even when idle. Returning null would
    // toggle the component between 0 and 1 lines, causing ConversationArea
    // to recalculate its viewport on a different cadence than throttledEntries
    // — leading to visible scroll jumps during rapid agent activity.
    if (activeAgents.length === 0) {
        return (
            <Box height={1} paddingX={1}>
                <Text> </Text>
            </Box>
        );
    }

    // Determine which agent to highlight based on stream preview
    const streamingAgentId = streamPreview?.agentId;

    // Show all active agent names
    const agentLabels = activeAgents.map(a => {
        const color = theme.agentColors[a.id] || a.color || 'white';
        return { id: a.id, name: a.name, color };
    });

    // Build the trailing label: streaming preview text or "thinking..."
    let trailingLabel: string;
    if (streamPreview && streamPreview.text) {
        // Take the last PREVIEW_MAX_CHARS characters, trim whitespace, collapse newlines
        const rawTail = streamPreview.text.slice(-PREVIEW_MAX_CHARS);
        trailingLabel = ' ' + rawTail.replace(/\n+/g, ' ').trim();
        // Add ellipsis if we truncated
        if (streamPreview.text.length > PREVIEW_MAX_CHARS) {
            trailingLabel = ' ...' + trailingLabel.trimStart();
        }
    } else {
        trailingLabel = ' thinking...';
    }

    return (
        <Box paddingX={1} gap={0}>
            <Text dimColor> {frame} </Text>
            {agentLabels.map((agent, idx) => (
                <React.Fragment key={idx}>
                    {idx > 0 && <Text dimColor>, </Text>}
                    <Text color={agent.color as any}>{agent.name}</Text>
                </React.Fragment>
            ))}
            <Text dimColor>{trailingLabel}</Text>
        </Box>
    );
};

export const ThinkingIndicator = React.memo(ThinkingIndicatorInner);
