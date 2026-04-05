/**
 * MXF Desktop — Confirmation Dialog Component
 *
 * Modal overlay for agent confirmation requests. Shows the agent name,
 * action description, and approve/deny buttons. Renders above the
 * conversation area when a confirmation is pending.
 *
 * @author Brad Anderson <BradA1878@pm.me>
 */

import React, { useCallback, useEffect } from 'react';
import { useAppState } from '../state/appState';
import { DiffView } from './DiffView';

interface ConfirmationDialogProps {
    /** Callback to send the confirmation response to the sidecar */
    onRespond: (requestId: string, approved: boolean) => Promise<void>;
}

export const ConfirmationDialog: React.FC<ConfirmationDialogProps> = ({ onRespond }) => {
    const confirmationQueue = useAppState((s) => s.confirmationQueue);
    const resolveConfirmation = useAppState((s) => s.resolveConfirmation);

    // Show the oldest pending confirmation
    const current = confirmationQueue[0];
    if (!current) return null;

    const handleApprove = useCallback(async () => {
        await onRespond(current.id, true);
        resolveConfirmation(current.id);
    }, [current.id, onRespond, resolveConfirmation]);

    const handleDeny = useCallback(async () => {
        await onRespond(current.id, false);
        resolveConfirmation(current.id);
    }, [current.id, onRespond, resolveConfirmation]);

    // Keyboard shortcuts: Enter to approve, Escape to deny
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleApprove();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                handleDeny();
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [handleApprove, handleDeny]);

    return (
        <div style={styles.overlay}>
            <div style={styles.dialog}>
                {/* Header */}
                <div style={styles.header}>
                    <span style={styles.headerIcon}>?</span>
                    <span style={styles.headerTitle}>{current.title}</span>
                </div>

                {/* Agent name */}
                <div style={styles.agentName}>
                    Agent: {current.agentName}
                </div>

                {/* Description */}
                {current.description && (
                    <div style={styles.description}>
                        {current.description}
                    </div>
                )}

                {/* Details (if present) */}
                {current.details && (
                    <pre style={styles.details}>
                        {current.details}
                    </pre>
                )}

                {/* Diff view for file changes */}
                {current.diff && (
                    <DiffView
                        filePath={current.diff.filePath}
                        original={current.diff.original}
                        modified={current.diff.modified}
                    />
                )}

                {/* Action buttons */}
                <div style={styles.actions}>
                    <button onClick={handleDeny} style={styles.denyButton}>
                        Deny (Esc)
                    </button>
                    <button onClick={handleApprove} style={styles.approveButton}>
                        Approve (Enter)
                    </button>
                </div>

                {/* Queue indicator */}
                {confirmationQueue.length > 1 && (
                    <div style={styles.queueBadge}>
                        +{confirmationQueue.length - 1} more pending
                    </div>
                )}
            </div>
        </div>
    );
};

const styles: Record<string, React.CSSProperties> = {
    overlay: {
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
    },
    dialog: {
        backgroundColor: 'var(--bg-secondary)',
        border: '1px solid var(--border)',
        borderRadius: '12px',
        padding: '24px',
        maxWidth: '500px',
        width: '90%',
        maxHeight: '80vh',
        overflow: 'auto',
    },
    header: {
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        marginBottom: '12px',
    },
    headerIcon: {
        width: '28px',
        height: '28px',
        borderRadius: '50%',
        backgroundColor: 'var(--warning)',
        color: 'var(--bg-primary)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontWeight: 700,
        fontSize: '16px',
    },
    headerTitle: {
        fontSize: '16px',
        fontWeight: 600,
        color: 'var(--text-primary)',
    },
    agentName: {
        fontSize: '13px',
        color: 'var(--accent)',
        fontFamily: 'var(--font-mono)',
        marginBottom: '12px',
    },
    description: {
        fontSize: '14px',
        color: 'var(--text-secondary)',
        lineHeight: '1.5',
        marginBottom: '16px',
        whiteSpace: 'pre-wrap',
    },
    details: {
        fontSize: '12px',
        color: 'var(--text-secondary)',
        fontFamily: 'var(--font-mono)',
        backgroundColor: 'var(--bg-primary)',
        border: '1px solid var(--border)',
        borderRadius: '6px',
        padding: '12px',
        maxHeight: '200px',
        overflow: 'auto',
        marginBottom: '16px',
        whiteSpace: 'pre-wrap',
    },
    actions: {
        display: 'flex',
        gap: '12px',
        justifyContent: 'flex-end',
    },
    denyButton: {
        padding: '8px 20px',
        borderRadius: '6px',
        border: '1px solid var(--border)',
        backgroundColor: 'transparent',
        color: 'var(--text-secondary)',
        fontSize: '13px',
        cursor: 'pointer',
        fontFamily: 'var(--font-sans)',
    },
    approveButton: {
        padding: '8px 20px',
        borderRadius: '6px',
        border: 'none',
        backgroundColor: 'var(--success)',
        color: 'var(--bg-primary)',
        fontSize: '13px',
        fontWeight: 600,
        cursor: 'pointer',
        fontFamily: 'var(--font-sans)',
    },
    queueBadge: {
        marginTop: '12px',
        textAlign: 'center',
        fontSize: '12px',
        color: 'var(--text-dim)',
    },
};
