/**
 * MXF Desktop — Header Bar Component
 *
 * Top bar showing connection status, session ID, and agent working indicator.
 * Uses standard window decorations (no Overlay titlebar).
 *
 * @author Brad Anderson <BradA1878@pm.me>
 */

import React from 'react';
import { useAppState } from '../state/appState';

export const HeaderBar: React.FC = () => {
    const connection = useAppState((s) => s.connection);
    const sessionId = useAppState((s) => s.sessionId);
    const isAgentWorking = useAppState((s) => s.isAgentWorking);

    const statusColor = {
        connected: 'var(--success)',
        connecting: 'var(--warning)',
        disconnected: 'var(--text-dim)',
        error: 'var(--error)',
    }[connection];

    const statusLabel = {
        connected: 'Connected',
        connecting: 'Connecting...',
        disconnected: 'Disconnected',
        error: 'Error',
    }[connection];

    return (
        <header style={styles.header}>
            <div style={styles.left}>
                {isAgentWorking && <span style={styles.workingDot} />}
                {sessionId && (
                    <span style={styles.sessionId}>{sessionId}</span>
                )}
            </div>
            <div style={styles.right}>
                <span style={{ ...styles.statusDot, backgroundColor: statusColor }} />
                <span style={styles.statusLabel}>{statusLabel}</span>
            </div>
        </header>
    );
};

const styles: Record<string, React.CSSProperties> = {
    header: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '6px 16px',
        borderBottom: '1px solid var(--border)',
        backgroundColor: 'var(--bg-secondary)',
        flexShrink: 0,
        userSelect: 'none',
    },
    left: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
    },
    workingDot: {
        width: '6px',
        height: '6px',
        borderRadius: '50%',
        backgroundColor: 'var(--accent)',
        animation: 'blink 1s step-end infinite',
    },
    sessionId: {
        fontSize: '11px',
        color: 'var(--text-dim)',
        fontFamily: 'var(--font-mono)',
    },
    right: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
    },
    statusDot: {
        width: '8px',
        height: '8px',
        borderRadius: '50%',
    },
    statusLabel: {
        fontSize: '12px',
        color: 'var(--text-secondary)',
    },
};
