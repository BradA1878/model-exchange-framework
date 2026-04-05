/**
 * MXF Desktop — Activity Card Component
 *
 * Renders an inline card showing what an agent is actively doing.
 * Active state shows a bordered card; completed/failed state collapses
 * to a one-liner with status icon.
 *
 * Active:
 *   ┌ Operator ──────────────────────────┐
 *   │ Reading src/auth/authService.ts    │
 *   └───────────────────────────────────-┘
 *
 * Completed:
 *   Operator ✓ Read src/auth/authService.ts
 *
 * Failed:
 *   Operator ✗ Read src/auth/authService.ts
 *
 * @author Brad Anderson <BradA1878@pm.me>
 */

import React from 'react';
import type { ConversationMessage } from '../types';

interface ActivityCardProps {
    message: ConversationMessage;
}

/**
 * ActivityCard — inline indicator for agent file/code operations.
 * Renders as a bordered card when active, collapses to a single line
 * with status icon when completed or failed.
 */
const ActivityCardInner: React.FC<ActivityCardProps> = ({ message }) => {
    const { content, agentName, agentColor, activityStatus } = message;
    const color = agentColor || 'var(--accent)';
    const status = activityStatus || 'active';

    // Completed — collapsed one-liner
    if (status === 'completed') {
        return (
            <div style={styles.collapsed}>
                <span style={{ ...styles.agentName, color }}>{agentName}</span>
                <span style={styles.checkmark}> ✓ </span>
                <span style={styles.summary}>{content}</span>
            </div>
        );
    }

    // Failed — collapsed one-liner
    if (status === 'failed') {
        return (
            <div style={styles.collapsed}>
                <span style={{ ...styles.agentName, color }}>{agentName}</span>
                <span style={styles.failmark}> ✗ </span>
                <span style={styles.summary}>{content}</span>
            </div>
        );
    }

    // Active — bordered card
    return (
        <div style={styles.activeCard}>
            <div style={{ ...styles.activeHeader, color }}>
                {agentName}
            </div>
            <div style={styles.activeContent}>{content}</div>
        </div>
    );
};

export const ActivityCard = React.memo(ActivityCardInner);

const styles: Record<string, React.CSSProperties> = {
    collapsed: {
        display: 'flex',
        alignItems: 'center',
        gap: '2px',
        padding: '2px 12px',
        fontFamily: 'var(--font-mono)',
        fontSize: '12px',
    },
    agentName: {
        fontWeight: 600,
    },
    checkmark: {
        color: 'var(--success)',
    },
    failmark: {
        color: 'var(--error)',
    },
    summary: {
        color: 'var(--text-dim)',
    },
    activeCard: {
        border: '1px solid var(--border)',
        borderRadius: '6px',
        padding: '6px 12px',
        margin: '2px 12px',
    },
    activeHeader: {
        fontFamily: 'var(--font-mono)',
        fontSize: '12px',
        fontWeight: 700,
        marginBottom: '2px',
    },
    activeContent: {
        fontFamily: 'var(--font-mono)',
        fontSize: '12px',
        color: 'var(--text-dim)',
    },
};
