/**
 * MXF Desktop — Stream Preview Component
 *
 * Shows a live preview of the currently streaming LLM response.
 * Applies the same limits as the TUI: 2000-char rolling window,
 * max 10 lines displayed, each line truncated to 100 chars.
 *
 * @author Brad Anderson <BradA1878@pm.me>
 */

import React from 'react';
import { useAppState } from '../state/appState';

/** Stream preview display limits (match TUI constants) */
const PREVIEW_MAX_CHARS = 2000;
const PREVIEW_MAX_LINES = 10;
const PREVIEW_LINE_WIDTH = 100;

export const StreamPreview: React.FC = () => {
    const streamPreview = useAppState((s) => s.streamPreview);
    const isAgentWorking = useAppState((s) => s.isAgentWorking);

    if (!streamPreview || !isAgentWorking) return null;

    // Apply rolling window: take last N chars
    let text = streamPreview;
    if (text.length > PREVIEW_MAX_CHARS) {
        text = text.substring(text.length - PREVIEW_MAX_CHARS);
    }

    // Split into lines, take last N, truncate each line
    const lines = text.split('\n');
    const displayLines = lines.slice(-PREVIEW_MAX_LINES).map((line) =>
        line.length > PREVIEW_LINE_WIDTH
            ? line.substring(0, PREVIEW_LINE_WIDTH) + '...'
            : line,
    );

    return (
        <div style={styles.container}>
            <div style={styles.content}>
                {displayLines.join('\n')}
                <span style={styles.cursor}>|</span>
            </div>
        </div>
    );
};

const styles: Record<string, React.CSSProperties> = {
    container: {
        padding: '8px 12px',
        borderRadius: '8px',
        maxWidth: '100%',
        maxHeight: '200px',
        overflow: 'hidden',
        opacity: 0.7,
    },
    content: {
        color: 'var(--text-secondary)',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        lineHeight: '1.6',
        fontSize: '14px',
    },
    cursor: {
        color: 'var(--accent)',
        fontWeight: 700,
    },
};
