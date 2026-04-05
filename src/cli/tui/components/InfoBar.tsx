/**
 * MXF CLI TUI — Info Bar Component
 *
 * Two-line status area below the input line:
 *   1. Horizontal rule (─) for visual separation
 *   2. Info line: mode | agent working status | confirmation alert
 *
 * The confirmation alert is bold + warning-colored when a prompt is pending,
 * making it impossible to miss that the system is waiting for user input.
 *
 * @author Brad Anderson <BradA1878@pm.me>
 */

import React from 'react';
import { Box, Text, useStdout } from 'ink';
import type { AgentInfo } from '../types';
import { useTheme } from '../theme/ThemeContext';

interface InfoBarProps {
    /** Current interaction mode (chat, plan, action) */
    currentMode: 'chat' | 'plan' | 'action';
    /** Agents currently in 'active' status */
    activeAgents: AgentInfo[];
    /** Whether any agent is actively working */
    isAgentWorking: boolean;
    /** Whether a confirmation prompt is pending */
    confirmationPending: boolean;
    /** Title of the pending confirmation (shown in the alert) */
    confirmationTitle: string | null;
    /** Number of additional confirmation requests queued behind the current one */
    confirmationQueueSize?: number;
    /** Vim mode state: 'normal'/'insert' when enabled, null when disabled */
    vimMode?: 'normal' | 'insert' | null;
}

/** Map mode names to display labels */
const MODE_LABELS: Record<string, string> = {
    action: 'action',
    plan: 'plan',
    chat: 'chat',
};

/**
 * Info bar — renders a horizontal rule and a status info line.
 * Shows mode, active agent name, and a prominent confirmation alert.
 */
const InfoBarInner: React.FC<InfoBarProps> = ({
    currentMode,
    activeAgents,
    isAgentWorking,
    confirmationPending,
    confirmationTitle,
    confirmationQueueSize = 0,
    vimMode = null,
}) => {
    const theme = useTheme();
    const { stdout } = useStdout();
    const terminalWidth = stdout.columns || 80;

    // Build the horizontal rule — full terminal width minus padding
    const ruleWidth = Math.max(terminalWidth - 2, 10);
    const rule = '─'.repeat(ruleWidth);

    // Mode label
    const modeLabel = MODE_LABELS[currentMode] || currentMode;

    // Active agent working label
    let agentLabel = '';
    if (isAgentWorking && activeAgents.length > 0) {
        const names = activeAgents.map(a => a.name);
        agentLabel = names.length === 1
            ? `${names[0]} ● working`
            : `${names.join(', ')} ● working`;
    }

    // Confirmation alert with queue count
    let confirmLabel = '';
    if (confirmationPending) {
        confirmLabel = `⚠ CONFIRM: ${confirmationTitle || 'Pending approval'}`;
        if (confirmationQueueSize > 0) {
            confirmLabel += ` (+${confirmationQueueSize} more)`;
        }
    }

    return (
        <Box flexDirection="column">
            {/* Horizontal rule */}
            <Box paddingX={1}>
                <Text color={theme.border as any}>{rule}</Text>
            </Box>

            {/* Info line: vim mode | mode | agent status | confirmation alert */}
            <Box paddingX={1} gap={1}>
                {vimMode !== null && vimMode !== undefined && (
                    <>
                        <Text bold color={vimMode === 'normal' ? (theme.warning as any) : (theme.statusActive as any)}>
                            [{vimMode.toUpperCase()}]
                        </Text>
                        <Text color={theme.dimText as any}>|</Text>
                    </>
                )}
                <Text color={theme.dimText as any}>{modeLabel}</Text>

                {agentLabel && (
                    <>
                        <Text color={theme.dimText as any}>│</Text>
                        <Text color={theme.statusActive as any}>{agentLabel}</Text>
                    </>
                )}

                {confirmLabel && (
                    <>
                        <Text color={theme.dimText as any}>│</Text>
                        <Text bold color={theme.warning as any}>{confirmLabel}</Text>
                    </>
                )}

                {/* Keyboard hints when no alert is showing */}
                {!confirmLabel && !agentLabel && (
                    <>
                        <Text color={theme.dimText as any}>│</Text>
                        <Text dimColor>/help</Text>
                        <Text dimColor>│</Text>
                        <Text dimColor>/vim</Text>
                    </>
                )}
            </Box>
        </Box>
    );
};

export const InfoBar = React.memo(InfoBarInner);
