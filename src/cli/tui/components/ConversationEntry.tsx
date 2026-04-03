/**
 * MXF CLI TUI — Conversation Entry Component
 *
 * Renders a single entry in the conversation area. Entry type determines
 * the rendering style: user messages, agent messages, tool calls,
 * activity cards, confirmation prompts, system notices, and errors
 * each have distinct visual treatments. Colors from theme context.
 *
 * @author Brad Anderson <BradA1878@pm.me>
 */

import React from 'react';
import { Box, Text } from 'ink';
import type { ConversationEntry as ConversationEntryType } from '../types';
import { ActivityCard } from './ActivityCard';
import { ConfirmationPrompt } from './ConfirmationPrompt';
import { MarkdownText } from './MarkdownText';
import { DiffView } from './DiffView';
import { useTheme } from '../theme/ThemeContext';

interface ConversationEntryProps {
    entry: ConversationEntryType;
    /** Whether to show full tool args and timestamps (Ctrl+A toggle) */
    detailMode?: boolean;
}

/**
 * Custom equality check for ConversationEntry memoization.
 * Returns true when the entry and detailMode have not changed,
 * preventing unnecessary re-renders of unchanged entries.
 * Needed because the reducer spreads entry objects, creating new references
 * even when nothing changed semantically.
 */
function arePropsEqual(
    prev: ConversationEntryProps,
    next: ConversationEntryProps,
): boolean {
    if (prev.detailMode !== next.detailMode) return false;
    if (prev.entry === next.entry) return true;
    if (prev.entry.id !== next.entry.id) return false;
    if (prev.entry.content !== next.entry.content) return false;
    if (prev.entry.type !== next.entry.type) return false;
    if (prev.entry.activityStatus !== next.entry.activityStatus) return false;
    if (prev.entry.activitySummary !== next.entry.activitySummary) return false;
    if (prev.entry.collapsed !== next.entry.collapsed) return false;
    if (prev.entry.confirmationData !== next.entry.confirmationData) return false;
    if (prev.entry.confirmationAccepted !== next.entry.confirmationAccepted) return false;
    if (prev.entry.fileDiffs !== next.entry.fileDiffs) return false;
    if (prev.entry.targetAgentId !== next.entry.targetAgentId) return false;
    return true;
}

/**
 * Render a single conversation entry based on its type.
 */
const ConversationEntryInner: React.FC<ConversationEntryProps> = ({ entry, detailMode = false }) => {
    const theme = useTheme();

    switch (entry.type) {
        case 'user':
            return (
                <Box paddingX={1}>
                    <Text bold color={theme.userText as any}>&gt; {entry.content}</Text>
                </Box>
            );

        case 'agent': {
            const agentName = entry.agentName || 'Agent';
            const agentId = entry.agentId || '';
            const color = theme.agentColors[agentId] || 'white';

            // Inter-agent messages show "Sender → Recipient" attribution
            const targetId = entry.targetAgentId || '';
            const targetName = entry.targetAgentName || '';
            const targetColor = targetId ? (theme.agentColors[targetId] || 'white') : '';

            return (
                <Box flexDirection="column" paddingX={1}>
                    <Box>
                        <Text bold color={color as any}>{agentName}</Text>
                        {targetName && (
                            <>
                                <Text dimColor bold> → </Text>
                                <Text bold color={targetColor as any}>{targetName}</Text>
                            </>
                        )}
                    </Box>
                    <MarkdownText>{entry.content}</MarkdownText>
                    {entry.fileDiffs?.map((diff, idx) => (
                        <DiffView key={`diff-${idx}`} filePath={diff.filePath} original={diff.original} modified={diff.modified} />
                    ))}
                </Box>
            );
        }

        case 'tool-call': {
            const toolAgentName = entry.agentName || 'Agent';
            if (detailMode) {
                // Detail mode: show full tool name, timestamp, and formatted JSON args
                const toolName = entry.toolName || 'unknown';
                const argsRaw = entry.toolArgs ? JSON.stringify(entry.toolArgs, null, 2) : '';
                const timestamp = ` [${new Date(entry.timestamp).toLocaleTimeString()}]`;
                return (
                    <Box paddingX={2} flexDirection="column">
                        <Box>
                            <Text color={theme.border as any}>  ├ </Text>
                            <Text color={theme.dimText as any}>[{toolAgentName}] {toolName}{timestamp}</Text>
                        </Box>
                        {argsRaw && <Text color={theme.dimText as any}>    {argsRaw}</Text>}
                    </Box>
                );
            }
            // Normal mode: show human-readable description with tree connector
            return (
                <Box paddingX={2}>
                    <Text color={theme.border as any}>  ├ </Text>
                    <Text color={theme.dimText as any}>[{toolAgentName}] {entry.content}</Text>
                </Box>
            );
        }

        case 'tool-result': {
            if (!entry.content) return null;

            if (detailMode) {
                // Detail mode: show full result (capped at 20 lines)
                const resultLines = entry.content.split('\n');
                const displayLines = resultLines.slice(0, 20);
                const truncated = resultLines.length > 20;
                return (
                    <Box flexDirection="column" paddingX={2}>
                        <Text color={theme.border as any}>  └ </Text>
                        {displayLines.map((line, idx) => (
                            <Text key={idx} color={theme.dimText as any}>    {line}</Text>
                        ))}
                        {truncated && <Text color={theme.dimText as any}>    ... ({resultLines.length - 20} more lines)</Text>}
                    </Box>
                );
            }
            // Normal mode: single-line summary with tree connector
            return (
                <Box paddingX={2}>
                    <Text color={theme.border as any}>  └ </Text>
                    <Text color={theme.dimText as any}>{entry.content.substring(0, 120)}</Text>
                </Box>
            );
        }

        case 'activity-card': {
            const activityAgentId = entry.agentId || '';
            const activityColor = theme.agentColors[activityAgentId] || 'white';
            return (
                <ActivityCard
                    agentName={entry.agentName || 'Agent'}
                    agentColor={activityColor}
                    content={entry.content}
                    status={entry.activityStatus || 'active'}
                    summary={entry.activitySummary}
                />
            );
        }

        case 'confirmation-prompt': {
            if (!entry.confirmationData) {
                return (
                    <Box paddingX={1}>
                        <Text color={theme.warning as any}>Confirmation required (missing data)</Text>
                    </Box>
                );
            }
            const confirmAgentId = entry.confirmationData.agentId;
            const confirmColor = theme.agentColors[confirmAgentId] || 'white';
            return (
                <ConfirmationPrompt
                    agentName={entry.confirmationData.agentName}
                    agentColor={confirmColor}
                    actionType={entry.confirmationData.actionType}
                    title={entry.confirmationData.title}
                    description={entry.confirmationData.description}
                    fileDiffs={entry.confirmationData.fileDiffs}
                />
            );
        }

        case 'confirmation-response': {
            const responseAgentId = entry.agentId || '';
            const responseColor = theme.agentColors[responseAgentId] || 'white';
            const isAccepted = entry.confirmationAccepted ?? entry.content === 'Approved';
            const icon = isAccepted ? '\u2713' : '\u2717';
            const iconColor = isAccepted ? theme.success : theme.errorText;
            return (
                <Box paddingX={1} gap={1}>
                    <Text color={iconColor as any} bold>{icon}</Text>
                    <Text color={responseColor as any} bold>{entry.agentName || 'Agent'}</Text>
                    <Text bold>{isAccepted ? 'Approved' : 'Denied'}</Text>
                </Box>
            );
        }

        case 'reasoning': {
            const reasoningAgentName = entry.agentName || 'Agent';
            const reasoningAgentId = entry.agentId || '';
            const reasoningColor = theme.agentColors[reasoningAgentId] || 'white';

            if (!detailMode) {
                // Collapsed: one-line preview of reasoning
                const preview = entry.content.substring(0, 100).replace(/\n/g, ' ');
                return (
                    <Box paddingX={2}>
                        <Text color={theme.border as any}>  ├ </Text>
                        <Text dimColor color={reasoningColor as any}>{reasoningAgentName}</Text>
                        <Text dimColor> thinking: {preview}{entry.content.length > 100 ? '...' : ''}</Text>
                    </Box>
                );
            }

            // Expanded: full reasoning text with visual distinction (capped at 30 lines)
            const reasoningLines = entry.content.split('\n');
            const displayReasoningLines = reasoningLines.slice(0, 30);
            const reasoningTruncated = reasoningLines.length > 30;
            return (
                <Box flexDirection="column" paddingX={2}>
                    <Box>
                        <Text color={theme.border as any}>  ├ </Text>
                        <Text dimColor color={reasoningColor as any}>{reasoningAgentName}</Text>
                        <Text dimColor> thinking:</Text>
                    </Box>
                    {displayReasoningLines.map((line, idx) => (
                        <Text key={idx} dimColor>    {line}</Text>
                    ))}
                    {reasoningTruncated && <Text dimColor>    ... ({reasoningLines.length - 30} more lines)</Text>}
                </Box>
            );
        }

        case 'task-complete-banner': {
            // Visual separator banner displayed after task completion with elapsed time
            const separator = '═'.repeat(55);
            return (
                <Box flexDirection="column" paddingX={1} marginTop={1}>
                    <Text dimColor>{separator}</Text>
                    <Text bold color={theme.success as any}>✓ {entry.content}</Text>
                    <Text dimColor>{separator}</Text>
                </Box>
            );
        }

        case 'result':
            return (
                <Box flexDirection="column" paddingX={1} marginTop={1}>
                    <Text bold color={theme.success as any}>Task Complete</Text>
                    <MarkdownText>{entry.content}</MarkdownText>
                </Box>
            );

        case 'system':
            return (
                <Box paddingX={1}>
                    <Text color={theme.systemText as any}>{entry.content}</Text>
                </Box>
            );

        case 'error':
            return (
                <Box paddingX={1}>
                    <Text color={theme.errorText as any}>{entry.content}</Text>
                </Box>
            );

        default:
            return (
                <Box paddingX={1}>
                    <Text>{entry.content}</Text>
                </Box>
            );
    }
};

export const ConversationEntry = React.memo(ConversationEntryInner, arePropsEqual);
