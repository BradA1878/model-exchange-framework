/**
 * MXF Desktop — Conversation Area Component
 *
 * Scrollable message list that displays all conversation entries.
 * Auto-scrolls to the bottom when new messages arrive unless the
 * user has scrolled up to review history.
 *
 * @author Brad Anderson <BradA1878@pm.me>
 */

import React, { useEffect, useRef, useCallback } from 'react';
import { useAppState } from '../state/appState';
import { MessageBubble } from './MessageBubble';
import { ActivityCard } from './ActivityCard';
import { StreamPreview } from './StreamPreview';

export const ConversationArea: React.FC = () => {
    const messages = useAppState((s) => s.messages);
    const entryFilter = useAppState((s) => s.entryFilter);
    const showAgentActivity = useAppState((s) => s.showAgentActivity);
    const containerRef = useRef<HTMLDivElement>(null);
    const isUserScrolledUpRef = useRef(false);

    // Apply entry filter if set
    const filteredMessages = entryFilter
        ? messages.filter((m) => m.type === entryFilter)
        : messages;

    // Track whether the user has scrolled up from the bottom
    const handleScroll = useCallback(() => {
        const el = containerRef.current;
        if (!el) return;
        const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
        isUserScrolledUpRef.current = distanceFromBottom > 50;
    }, []);

    // Auto-scroll to bottom on new messages (unless user scrolled up)
    useEffect(() => {
        if (!isUserScrolledUpRef.current && containerRef.current) {
            containerRef.current.scrollTop = containerRef.current.scrollHeight;
        }
    }, [messages]);

    return (
        <div
            ref={containerRef}
            style={styles.container}
            onScroll={handleScroll}
        >
            {filteredMessages.length === 0 ? (
                messages.length === 0 ? <WelcomeMessage /> : (
                    <div style={{ color: 'var(--text-dim)', textAlign: 'center', padding: '32px' }}>
                        No {entryFilter} messages. Use /filter all to clear.
                    </div>
                )
            ) : (
                <>
                    {filteredMessages.map((msg) => (
                        msg.type === 'activity' && showAgentActivity
                            ? <ActivityCard key={msg.id} message={msg} />
                            : <MessageBubble key={msg.id} message={msg} />
                    ))}
                    <StreamPreview />
                </>
            )}
        </div>
    );
};

/** Welcome message shown when no conversation has started */
const WelcomeMessage: React.FC = () => (
    <div style={styles.welcome}>
        <h2 style={styles.welcomeTitle}>Welcome to MXF Interactive</h2>
        <p style={styles.welcomeText}>
            Type a task in natural language. The Concierge will handle simple
            requests directly and delegate complex work to specialist agents.
        </p>
        <div style={styles.welcomeHints}>
            <span>Use <code>@agent</code> to direct a message to a specific agent</span>
            <span>Use <code>/help</code> to see available commands</span>
            <span>Use <code>!command</code> to run shell commands</span>
            <span>Press <kbd>Shift+Enter</kbd> for newline</span>
        </div>
    </div>
);

const styles: Record<string, React.CSSProperties> = {
    container: {
        flex: 1,
        overflowY: 'auto',
        padding: '16px',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
    },
    welcome: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        flex: 1,
        gap: '16px',
        padding: '32px',
        textAlign: 'center',
    },
    welcomeTitle: {
        fontSize: '20px',
        fontWeight: 600,
        color: 'var(--accent)',
    },
    welcomeText: {
        fontSize: '14px',
        color: 'var(--text-dim)',
        maxWidth: '500px',
        lineHeight: '1.5',
    },
    welcomeHints: {
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
        fontSize: '13px',
        color: 'var(--text-dim)',
    },
};
