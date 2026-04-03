/**
 * MXF CLI TUI — Status Bar Component
 *
 * Fixed bottom bar showing agent status indicators, iteration count,
 * and elapsed session time. Colors from theme context.
 *
 * @author Brad Anderson <BradA1878@pm.me>
 */

import React from 'react';
import { Box, Text } from 'ink';
import { Spinner } from '@inkjs/ui';
import type { AgentInfo, ConnectionStatus } from '../types';
import { useElapsedTime, formatElapsedTime } from '../hooks/useElapsedTime';
import { useTheme } from '../theme/ThemeContext';

interface StatusBarProps {
    /** Active agents with their status */
    agents: AgentInfo[];
    /** Total iteration count for the session */
    iterationCount: number;
    /** Whether an agent is actively working */
    isAgentWorking: boolean;
    /** Total tokens consumed across all agents (0 when not tracked) */
    totalTokens?: number;
    /** Estimated cost in USD (null when pricing unknown) */
    estimatedCost?: number | null;
    /** SDK connection status (shown as colored dot) */
    connection?: ConnectionStatus;
}

/**
 * Status bar — fixed at the bottom above the input line.
 * Shows: agent indicators | iteration count | elapsed time
 */
/** Map connection status to colored indicator */
const CONNECTION_INDICATORS: Record<ConnectionStatus, { dot: string; color: string }> = {
    connected: { dot: '●', color: 'green' },
    connecting: { dot: '◐', color: 'yellow' },
    disconnected: { dot: '○', color: 'gray' },
    error: { dot: '×', color: 'red' },
};

const StatusBarInner: React.FC<StatusBarProps> = ({ agents, iterationCount, isAgentWorking, totalTokens = 0, estimatedCost, connection = 'disconnected' }) => {
    const elapsed = useElapsedTime();
    const theme = useTheme();

    /** Map agent status to themed dot */
    const getStatusDot = (status: string) => {
        switch (status) {
            case 'active': return { dot: '●', color: theme.statusActive };
            case 'error': return { dot: '×', color: theme.statusError };
            default: return { dot: '○', color: theme.statusIdle };
        }
    };

    return (
        <Box
            borderStyle="round"
            borderColor={theme.border as any}
            paddingX={1}
            justifyContent="space-between"
            width="100%"
        >
            {/* Agent indicators */}
            <Box gap={1}>
                <Text color={theme.dimText as any}>agents:</Text>
                {agents.map((agent) => {
                    const statusInfo = getStatusDot(agent.status);
                    const agentColor = theme.agentColors[agent.id] || agent.color || 'white';
                    return (
                        <Box key={agent.id} gap={0}>
                            <Text color={agentColor as any}>{agent.name} </Text>
                            <Text color={statusInfo.color as any}>{statusInfo.dot}</Text>
                        </Box>
                    );
                })}
                {isAgentWorking && (() => {
                    const activeAgents = agents.filter(a => a.status === 'active');
                    const label = activeAgents.length > 0
                        ? activeAgents.map(a => a.currentActivity
                            ? `${a.name} ● ${a.currentActivity}`
                            : `${a.name} ● working`
                        ).join(' | ')
                        : 'working';
                    return <Spinner label={label} />;
                })()}
            </Box>

            {/* Token count (with iterations fallback) */}
            <Box gap={1}>
                {totalTokens > 0 ? (
                    <>
                        <Text color={theme.dimText as any}>tokens:</Text>
                        <Text>{totalTokens.toLocaleString()}</Text>
                    </>
                ) : (
                    <>
                        <Text color={theme.dimText as any}>iterations:</Text>
                        <Text>{iterationCount > 0 ? iterationCount.toLocaleString() : '0'}</Text>
                    </>
                )}
                {estimatedCost != null && estimatedCost > 0 && (
                    <>
                        <Text color={theme.dimText as any}> cost:</Text>
                        <Text>~${estimatedCost.toFixed(4)}</Text>
                    </>
                )}
            </Box>

            {/* Elapsed time + connection status */}
            <Box gap={1}>
                <Text color={theme.dimText as any}>elapsed:</Text>
                <Text>{formatElapsedTime(elapsed)}</Text>
                <Text color={CONNECTION_INDICATORS[connection].color as any}>{CONNECTION_INDICATORS[connection].dot} {connection}</Text>
            </Box>
        </Box>
    );
};

export const StatusBar = React.memo(StatusBarInner);
