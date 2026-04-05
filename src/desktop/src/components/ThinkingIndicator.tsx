/**
 * MXF Desktop — Thinking Indicator Component
 *
 * Animated indicator shown when agents are working. Displays a braille
 * dot spinner with active agent names, current task title, and elapsed
 * time. Positioned between the conversation area and input area.
 *
 * @author Brad Anderson <BradA1878@pm.me>
 */

import React, { useState, useEffect, useRef } from 'react';
import { useAppState } from '../state/appState';

/** Braille dot spinner frames — cycles at ~80ms */
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const SPINNER_INTERVAL = 80;

/**
 * Format elapsed seconds as a human-readable string.
 * Shows "Ns" for under a minute, "Nm Ns" for longer.
 */
function formatElapsed(seconds: number): string {
    if (seconds < 60) return `${seconds}s`;
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}m ${s}s`;
}

export const ThinkingIndicator: React.FC = () => {
    const isAgentWorking = useAppState((s) => s.isAgentWorking);
    const agents = useAppState((s) => s.agents);
    const currentTaskTitle = useAppState((s) => s.currentTaskTitle);
    const activeTaskStartTime = useAppState((s) => s.activeTaskStartTime);
    const progressStatus = useAppState((s) => s.progressStatus);

    const [frameIdx, setFrameIdx] = useState(0);
    const [elapsed, setElapsed] = useState(0);
    const spinnerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const elapsedRef = useRef<ReturnType<typeof setInterval> | null>(null);

    // Spinner animation
    useEffect(() => {
        if (isAgentWorking) {
            spinnerRef.current = setInterval(() => {
                setFrameIdx((prev) => (prev + 1) % SPINNER_FRAMES.length);
            }, SPINNER_INTERVAL);
        } else {
            setFrameIdx(0);
        }
        return () => {
            if (spinnerRef.current) clearInterval(spinnerRef.current);
        };
    }, [isAgentWorking]);

    // Elapsed time counter
    useEffect(() => {
        if (isAgentWorking && activeTaskStartTime) {
            setElapsed(Math.floor((Date.now() - activeTaskStartTime) / 1000));
            elapsedRef.current = setInterval(() => {
                setElapsed(Math.floor((Date.now() - activeTaskStartTime) / 1000));
            }, 1000);
        } else {
            setElapsed(0);
        }
        return () => {
            if (elapsedRef.current) clearInterval(elapsedRef.current);
        };
    }, [isAgentWorking, activeTaskStartTime]);

    // When idle, render an empty spacer to prevent layout shift
    if (!isAgentWorking) {
        return <div style={styles.spacer} />;
    }

    const activeAgents = agents.filter((a) => a.status === 'active');
    const agentDisplay = activeAgents.length > 0
        ? activeAgents.map((a) => a.name).join(', ')
        : 'Agent';

    // Truncate task title to 40 chars
    const taskDisplay = currentTaskTitle
        ? currentTaskTitle.length > 40
            ? currentTaskTitle.substring(0, 40) + '...'
            : currentTaskTitle
        : null;

    // Show agent-reported progress status instead of generic "thinking..."
    const statusText = progressStatus?.status || 'thinking...';
    const showProgressBar = progressStatus?.percent != null;

    return (
        <div style={styles.container}>
            <span style={styles.spinner}>{SPINNER_FRAMES[frameIdx]}</span>
            <span style={styles.agentNames}>
                {progressStatus?.agentName || agentDisplay}
            </span>
            <span style={styles.thinking}> {statusText}</span>
            {progressStatus?.detail && (
                <span style={styles.taskTitle}> — {progressStatus.detail}</span>
            )}
            {!progressStatus && taskDisplay && (
                <span style={styles.taskTitle}> ({taskDisplay})</span>
            )}
            {showProgressBar && (
                <div style={styles.progressBar}>
                    <div style={{ ...styles.progressFill, width: `${progressStatus!.percent}%` }} />
                </div>
            )}
            <span style={styles.elapsed}>{formatElapsed(elapsed)}</span>
        </div>
    );
};

const styles: Record<string, React.CSSProperties> = {
    spacer: {
        height: '4px',
        flexShrink: 0,
    },
    container: {
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'nowrap',
        gap: '6px',
        padding: '4px 16px',
        flexShrink: 0,
        fontFamily: 'var(--font-mono)',
        fontSize: '12px',
        minWidth: 0,
    },
    spinner: {
        color: 'var(--accent)',
        fontSize: '14px',
        flexShrink: 0,
    },
    agentNames: {
        color: 'var(--success)',
        fontWeight: 600,
        flexShrink: 0,
    },
    thinking: {
        color: 'var(--text-dim)',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        minWidth: 0,
    },
    taskTitle: {
        color: 'var(--text-dim)',
        fontStyle: 'italic',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        minWidth: 0,
    },
    elapsed: {
        color: 'var(--text-dim)',
        marginLeft: 'auto',
        flexShrink: 0,
        whiteSpace: 'nowrap',
    },
    progressBar: {
        width: '60px',
        height: '4px',
        backgroundColor: 'var(--border)',
        borderRadius: '2px',
        overflow: 'hidden',
        flexShrink: 0,
    },
    progressFill: {
        height: '100%',
        backgroundColor: 'var(--success)',
        borderRadius: '2px',
        transition: 'width 0.3s ease',
    },
};
