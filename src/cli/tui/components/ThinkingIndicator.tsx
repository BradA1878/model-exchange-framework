/**
 * MXF CLI TUI — Thinking Indicator Component
 *
 * Animated inline indicator shown at the bottom of the conversation area
 * when agents are actively reasoning between tool calls. Provides visual
 * feedback so the user knows the system is working, not hung.
 *
 * When streaming tokens are available (via streamPreview), shows up to
 * 10 lines of the live LLM output so the user can follow the agent's
 * reasoning in real time.
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

/** Maximum characters of streaming preview text to keep (rolling window) */
const PREVIEW_MAX_CHARS = 2000;

/** Maximum lines of streaming preview to display */
const PREVIEW_MAX_LINES = 10;

/** Maximum character width per preview line */
const PREVIEW_LINE_WIDTH = 100;

interface ThinkingIndicatorProps {
    /** Agents currently in 'active' status */
    activeAgents: AgentInfo[];
    /** Live streaming preview from LLM (null when not streaming) */
    streamPreview?: { agentId: string; text: string } | null;
    /** Current task title for context (shown alongside "thinking...") */
    currentTaskTitle?: string | null;
}

/**
 * ThinkingIndicator — shows an animated spinner with the active agent's name.
 * Appears at the bottom of the conversation area during agent reasoning phases.
 * Automatically disappears when agents go idle (task complete/fail).
 *
 * When streamPreview is available, shows a multi-line tail of the streaming text
 * so the user can follow the agent's response as it arrives.
 */
const ThinkingIndicatorInner: React.FC<ThinkingIndicatorProps> = ({ activeAgents, streamPreview, currentTaskTitle }) => {
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

    // Determine agent labels with colors
    const agentLabels = activeAgents.map(a => {
        const color = theme.agentColors[a.id] || a.color || 'white';
        return { id: a.id, name: a.name, color };
    });

    // Build streaming preview lines
    let previewLines: string[] = [];
    if (streamPreview && streamPreview.text) {
        // Take the trailing portion of the stream text
        const tail = streamPreview.text.slice(-PREVIEW_MAX_CHARS);
        // Split into lines, take the last N, and truncate each to max width
        const allLines = tail.split('\n');
        previewLines = allLines
            .slice(-PREVIEW_MAX_LINES)
            .map(line => line.length > PREVIEW_LINE_WIDTH ? line.slice(0, PREVIEW_LINE_WIDTH) + '...' : line);
    }

    return (
        <Box flexDirection="column" paddingX={1}>
            {/* Agent name line with spinner */}
            <Box gap={0}>
                <Text dimColor> {frame} </Text>
                {agentLabels.map((agent, idx) => (
                    <React.Fragment key={idx}>
                        {idx > 0 && <Text dimColor>, </Text>}
                        <Text color={agent.color as any}>{agent.name}</Text>
                    </React.Fragment>
                ))}
                {previewLines.length === 0 && (
                    <Text dimColor>
                        {' thinking...'}
                        {currentTaskTitle ? ` (${currentTaskTitle.length > 40 ? currentTaskTitle.slice(0, 40) + '...' : currentTaskTitle})` : ''}
                    </Text>
                )}
            </Box>

            {/* Streaming preview lines */}
            {previewLines.length > 0 && (
                <Box flexDirection="column" paddingLeft={4}>
                    {previewLines.map((line, idx) => (
                        <Text key={idx} dimColor wrap="truncate">{line}</Text>
                    ))}
                </Box>
            )}
        </Box>
    );
};

export const ThinkingIndicator = React.memo(ThinkingIndicatorInner);
