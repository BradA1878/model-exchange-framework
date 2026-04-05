/**
 * MXF Desktop — Status Bar Component
 *
 * Bottom bar showing: mode indicator, per-agent status dots, vim mode,
 * context-sensitive help hints, confirmation alerts, estimated cost,
 * and token/iteration counts.
 *
 * @author Brad Anderson <BradA1878@pm.me>
 */

import React, { useMemo, useCallback } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { useAppState } from '../state/appState';

export const StatusBar: React.FC = () => {
    const currentMode = useAppState((s) => s.currentMode);
    const vimEnabled = useAppState((s) => s.vimEnabled);
    const vimMode = useAppState((s) => s.vimMode);
    const isAgentWorking = useAppState((s) => s.isAgentWorking);
    const agents = useAppState((s) => s.agents);
    const costData = useAppState((s) => s.costData);
    const confirmationQueue = useAppState((s) => s.confirmationQueue);
    const workingDirectory = useAppState((s) => s.workingDirectory);
    const setWorkingDirectory = useAppState((s) => s.setWorkingDirectory);

    // Sort agents by workflow order: Concierge → Planner → Operator → Executor → Reviewer → others
    const AGENT_ORDER: Record<string, number> = {
        concierge: 0,
        planner: 1,
        operator: 2,
        executor: 3,
        reviewer: 4,
    };
    const sortedAgents = useMemo(() => {
        return [...agents].sort((a, b) => {
            const aOrder = AGENT_ORDER[a.name.toLowerCase()] ?? 99;
            const bOrder = AGENT_ORDER[b.name.toLowerCase()] ?? 99;
            return aOrder - bOrder;
        });
    }, [agents]);

    // Open native folder picker dialog
    const handleFolderPick = useCallback(async () => {
        try {
            const selected = await open({
                directory: true,
                multiple: false,
                defaultPath: workingDirectory || undefined,
                title: 'Select working directory',
            });
            // Tauri v2 returns string | string[] | null for directory picks
            const path = Array.isArray(selected) ? selected[0] : selected;
            if (path && typeof path === 'string') {
                setWorkingDirectory(path);
            }
        } catch {
            // User cancelled or dialog failed — ignore
        }
    }, [workingDirectory, setWorkingDirectory]);

    // Format token count
    const tokenLabel = costData.totalTokens > 0
        ? `${(costData.totalTokens / 1000).toFixed(1)}k tokens`
        : '';

    // Format estimated cost
    const costLabel = costData.estimatedCost > 0
        ? `~$${costData.estimatedCost.toFixed(4)}`
        : '';

    // Cost color based on budget status
    const costColor = costData.budgetExceeded
        ? 'var(--error)'
        : (costData.costBudget !== null && costData.costBudget > 0 && costData.estimatedCost / costData.costBudget >= 0.8)
            ? 'var(--warning)'
            : 'var(--text-dim)';

    // Context-sensitive help hints
    const getHintText = (): string => {
        if (confirmationQueue.length > 0) return 'Enter: approve | Esc: deny';
        if (isAgentWorking) return '/stop to cancel';
        if (vimEnabled && vimMode === 'normal') return 'i: insert | h/j/k/l: move | dd: delete';
        if (vimEnabled && vimMode === 'insert') return 'Esc: normal mode';
        return '/help | Shift+Enter: newline | Cmd+K: palette';
    };

    return (
        <footer style={styles.footer}>
            <div style={styles.left}>
                {/* Folder picker — shows selected directory name */}
                <span
                    style={styles.folderButton}
                    onClick={handleFolderPick}
                    title={workingDirectory || 'Select working directory'}
                >
                    <span style={styles.folderIcon}>&#128193;</span>
                    <span style={styles.folderLabel}>
                        {workingDirectory
                            ? workingDirectory.split('/').filter(Boolean).pop() || '/'
                            : 'folder'}
                    </span>
                </span>

                {/* Mode indicator */}
                <span style={styles.mode}>{currentMode}</span>

                {/* Vim mode indicator */}
                {vimEnabled && (
                    <span style={vimMode === 'normal' ? styles.vimNormal : styles.vimInsert}>
                        [{vimMode === 'normal' ? 'NORMAL' : 'INSERT'}]
                    </span>
                )}

                {/* Separator */}
                <span style={styles.separator}>|</span>

                {/* Agent status roster (ordered by workflow) */}
                <div style={styles.agentRoster}>
                    {sortedAgents.map((agent) => {
                        const dotChar = agent.status === 'active' ? '●'
                            : agent.status === 'error' ? '×'
                                : '○';
                        const dotColor = agent.status === 'active' ? 'var(--success)'
                            : agent.status === 'error' ? 'var(--error)'
                                : 'var(--text-dim)';
                        return (
                            <span key={agent.id} style={styles.agentItem}>
                                <span style={{ ...styles.agentName, color: agent.color || 'var(--accent)' }}>
                                    {agent.name}
                                </span>
                                <span style={{ color: dotColor }}>{dotChar}</span>
                            </span>
                        );
                    })}
                </div>

                {/* Separator */}
                {agents.length > 0 && <span style={styles.separator}>|</span>}

                {/* Context-sensitive hints */}
                <span style={styles.hint}>{getHintText()}</span>

                {/* Confirmation alert with pulse animation */}
                {confirmationQueue.length > 0 && (
                    <>
                        <span style={styles.separator}>|</span>
                        <span style={styles.confirmation}>
                            ⚠ CONFIRM: {confirmationQueue[0]!.title}
                            {confirmationQueue.length > 1 && (
                                <span style={styles.queueBadge}>+{confirmationQueue.length - 1}</span>
                            )}
                        </span>
                    </>
                )}
            </div>

            <div style={styles.right}>
                {/* Estimated cost */}
                {costLabel && (
                    <span style={{ ...styles.cost, color: costColor }}>{costLabel}</span>
                )}
                {/* Token count */}
                {tokenLabel && (
                    <span style={styles.tokens}>{tokenLabel}</span>
                )}
                {/* Iteration count */}
                {costData.totalIterations > 0 && (
                    <span style={styles.iterations}>
                        {costData.totalIterations} iter
                    </span>
                )}
            </div>
        </footer>
    );
};

const styles: Record<string, React.CSSProperties> = {
    footer: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '4px 16px',
        borderTop: '1px solid var(--border)',
        backgroundColor: 'var(--bg-secondary)',
        flexShrink: 0,
        fontSize: '12px',
        userSelect: 'none',
    },
    left: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        overflow: 'hidden',
    },
    right: {
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        flexShrink: 0,
    },
    folderButton: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        cursor: 'pointer',
        padding: '1px 6px',
        borderRadius: '4px',
        border: '1px solid var(--border)',
        backgroundColor: 'var(--bg-tertiary)',
        transition: 'border-color 0.15s',
    },
    folderIcon: {
        fontSize: '12px',
        lineHeight: 1,
    },
    folderLabel: {
        fontFamily: 'var(--font-mono)',
        fontSize: '11px',
        color: 'var(--text-secondary)',
        maxWidth: '120px',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
    },
    mode: {
        color: 'var(--accent)',
        fontWeight: 600,
        textTransform: 'uppercase',
        fontFamily: 'var(--font-mono)',
        fontSize: '11px',
    },
    vimNormal: {
        color: 'var(--warning)',
        fontWeight: 600,
        fontFamily: 'var(--font-mono)',
        fontSize: '11px',
    },
    vimInsert: {
        color: 'var(--success)',
        fontWeight: 600,
        fontFamily: 'var(--font-mono)',
        fontSize: '11px',
    },
    separator: {
        color: 'var(--text-dim)',
    },
    agentRoster: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
    },
    agentItem: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '3px',
        fontFamily: 'var(--font-mono)',
        fontSize: '11px',
    },
    agentName: {
        fontWeight: 500,
    },
    hint: {
        color: 'var(--text-dim)',
    },
    confirmation: {
        color: 'var(--warning)',
        fontWeight: 700,
        animation: 'pulse 1.5s ease-in-out infinite',
    },
    queueBadge: {
        backgroundColor: 'var(--warning)',
        color: 'var(--bg-primary)',
        borderRadius: '50%',
        padding: '0 4px',
        fontSize: '10px',
        fontWeight: 700,
        marginLeft: '4px',
    },
    cost: {
        fontFamily: 'var(--font-mono)',
        fontWeight: 600,
    },
    tokens: {
        color: 'var(--text-dim)',
        fontFamily: 'var(--font-mono)',
    },
    iterations: {
        color: 'var(--text-dim)',
        fontFamily: 'var(--font-mono)',
    },
};
